import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { openDb } from '../server/db.ts';
import { importCatalog } from '../server/import.ts';
import { getCatalog, getDrinks } from '../server/catalog.ts';
import { createApp } from '../server/app.ts';
import { recommendPurchases } from '../server/purchase-recommendations.ts';
import {
  searchPurchaseSets,
  solvePurchases,
  PurchaseTimeout,
  type PurchaseRequirement,
} from '../server/purchase-search.ts';
import type { PurchaseRecommendation } from '../shared/types.ts';

function syncSolve(edges: PurchaseRequirement[], limit: number) {
  const search = searchPurchaseSets(edges, limit);
  let step = search.next();
  while (!step.done) step = search.next();
  return step.value;
}

// Independent exhaustive enumeration: no credit bound, candidate sorting or
// recursive pruning shared with the production solver.
function exhaustive(edges: PurchaseRequirement[], limit: number) {
  const keys = [...new Set(edges.flatMap((edge) => edge.missing))];
  let gain = 0;
  let count = 0;
  for (let mask = 0; mask < 2 ** keys.length; mask++) {
    const selected = keys.filter((_, i) => mask & (1 << i));
    if (selected.length > limit) continue;
    const score = edges.reduce(
      (sum, edge) => sum + (edge.missing.every((key) => selected.includes(key)) ? edge.weight : 0),
      0,
    );
    if (score > gain || (score === gain && selected.length < count)) {
      gain = score;
      count = selected.length;
    }
  }
  return { gain, count };
}

test('購入探索: 単品効果より複数購入の相乗効果を選ぶ', () => {
  const result = syncSolve(
    [
      { missing: ['a'], weight: 3 },
      { missing: ['b', 'c'], weight: 10 },
    ],
    2,
  );
  assert.equal(result.gain, 10);
  assert.deepEqual(result.keys.sort(), ['b', 'c']);
});

test('購入探索: 同点なら少ない購入数、増加ゼロなら購入なし', () => {
  const result = syncSolve(
    [
      { missing: ['a', 'b'], weight: 2 },
      { missing: ['c'], weight: 2 },
    ],
    2,
  );
  assert.deepEqual(result.keys, ['c']);
  assert.equal(syncSolve([{ missing: ['a', 'b'], weight: 3 }], 1).gain, 0);
  assert.deepEqual(syncSolve([], 10).keys, []);
});

test('購入探索: 200個の再現可能なランダム問題を全列挙と照合する', () => {
  let seed = 907;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * n);
  };
  for (let trial = 0; trial < 200; trial++) {
    const edges: PurchaseRequirement[] = [];
    for (let i = 0; i < 20; i++) {
      const missing = [...new Set(Array.from({ length: 1 + random(5) }, () => `k${random(8)}`))];
      edges.push({ missing, weight: 1 + random(8) });
    }
    const limit = 1 + random(10);
    const expected = exhaustive(edges, limit);
    const actual = syncSolve(edges, limit);
    assert.equal(actual.gain, expected.gain, `gain: trial ${trial}`);
    assert.equal(actual.keys.length, expected.count, `count: trial ${trial}`);
    assert.equal(
      actual.gain,
      edges.reduce(
        (sum, edge) =>
          sum + (edge.missing.every((key) => actual.keys.includes(key)) ? edge.weight : 0),
        0,
      ),
    );
  }
});

test('購入探索: 時間超過では未確定の結果を返さない', async () => {
  await assert.rejects(solvePurchases([{ missing: ['a'], weight: 1 }], 1, 0), PurchaseTimeout);
});

function fixture() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO kinds VALUES(0,'ジン',1),(59,'トニック',0),(60,'水',0);
    INSERT INTO drinks VALUES(0,'ジンA',0),(1,'ジンB',0),(2,'トニック',59),(3,'未分類A',NULL),(4,'未分類B',NULL),(67,'クラッシュドアイス',NULL),(70,'熱湯',60),(90,'水',60);
    INSERT INTO cocktails VALUES(0,'ジントニック','','',NULL,NULL,'',NULL,NULL),(1,'未分類Aのみ','','',NULL,NULL,'',NULL,NULL),(2,'常備品','','',NULL,NULL,'',NULL,NULL),(3,'空レシピ','','',NULL,NULL,'',NULL,NULL),(4,'未分類Bのみ','','',NULL,NULL,'',NULL,NULL),(5,'ジン2行','','',NULL,NULL,'',NULL,NULL);
    INSERT INTO recipes VALUES(0,0,0,'30 ml'),(1,0,2,'90 ml'),(2,1,3,'1 dash'),(3,2,70,'90 ml'),(4,2,67,'1個'),(5,4,4,'1個'),(6,5,0,'15 ml'),(7,5,1,'15 ml');`);
  return db;
}

test('購入提案: 同種をまとめ、常備品を除外、nullは独立、空レシピと重複行を正しく扱う', async () => {
  const db = fixture();
  try {
    const before = getDrinks(db);
    const result = await recommendPurchases(before, getCatalog(db), 10);
    assert.equal(result.currentCount, 1);
    assert.equal(result.addedCount, 4);
    assert.equal(result.totalCount, 5);
    assert.equal(result.purchases.length, 4);
    assert.deepEqual(
      result.purchases.find((p) => p.key === 'k0')!.options.map((p) => p.id),
      [0, 1],
    );
    assert.deepEqual(
      result.purchases.map((p) => p.key),
      ['d3', 'd4', 'k0', 'k59'],
    );
    assert.deepEqual(getDrinks(db), before);
    assert.ok(!result.cocktails.some((c) => c.id === 3));
    db.prepare('INSERT INTO inventory VALUES(1,1)').run();
    const stocked = await recommendPurchases(getDrinks(db), getCatalog(db), 1);
    assert.equal(stocked.currentCount, 2);
    assert.ok(!stocked.purchases.some((p) => p.key === 'k0'));
    db.exec('INSERT OR REPLACE INTO inventory SELECT id,1 FROM drinks');
    const full = await recommendPurchases(getDrinks(db), getCatalog(db), 10);
    assert.equal(full.currentCount, 5);
    assert.equal(full.addedCount, 0);
    assert.deepEqual(full.purchases, []);
    assert.deepEqual(full.cocktails, []);
  } finally {
    db.close();
  }
});

test('購入提案API: 1〜10のみ受理し、在庫を変えず結果を返す', async () => {
  const db = fixture();
  const app = createApp(db);
  try {
    for (const limit of ['', '0', '11', '-1', '1.5', 'NaN', '01', '1e0']) {
      const response = await app.request(`/api/host/purchase-recommendations?limit=${limit}`);
      assert.equal(response.status, 400, limit);
    }
    const before = getDrinks(db);
    for (const limit of [1, 5, 10]) {
      const response = await app.request(`/api/host/purchase-recommendations?limit=${limit}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = (await response.json()) as PurchaseRecommendation;
      assert.equal(result.limit, limit);
      assert.ok(result.purchases.length <= limit);
      assert.equal(result.addedCount, result.cocktails.length);
    }
    assert.deepEqual(getDrinks(db), before);
  } finally {
    db.close();
  }
});

test('購入提案: 実データで購入を反映した作成可能判定と件数・カクテルIDが一致する', async () => {
  const db = openDb(':memory:');
  try {
    importCatalog(db);
    const baseline = getCatalog(db);
    const result = await recommendPurchases(getDrinks(db), baseline, 5);
    for (const p of result.purchases)
      db.prepare('INSERT INTO inventory VALUES(?,1)').run(p.options[0].id);
    const after = getCatalog(db).filter((c) => c.available);
    assert.equal(after.length, result.totalCount);
    const oldIds = new Set(baseline.filter((c) => c.available).map((c) => c.id));
    assert.deepEqual(
      after.filter((c) => !oldIds.has(c.id)).map((c) => c.id),
      result.cocktails.map((c) => c.id),
    );
  } finally {
    db.close();
  }
});

test('購入提案API: 探索中も在庫APIに応答、重複計算を拒否、在庫変更は409で再計算可能', async () => {
  const db = openDb(':memory:');
  let pending: Promise<Response> | undefined;
  try {
    importCatalog(db);
    const app = createApp(db);
    let completed = false;
    pending = Promise.resolve(app.request('/api/host/purchase-recommendations?limit=5'));
    void pending.then(() => {
      completed = true;
    });
    await setImmediate();
    const inventory = await app.request('/api/host/inventory');
    assert.equal(inventory.status, 200);
    assert.equal(completed, false);
    const duplicate = await app.request('/api/host/purchase-recommendations?limit=5');
    assert.equal(duplicate.status, 429);
    const update = await app.request('/api/host/inventory/0', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available: true }),
    });
    assert.equal(update.status, 200);
    assert.equal((await pending).status, 409);
    assert.equal((await app.request('/api/host/purchase-recommendations?limit=1')).status, 200);
  } finally {
    await pending;
    db.close();
  }
});
