import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup } from './cloud-fixture';
import { menu } from '../worker/catalog';
import type { Cocktail } from '../shared/types';

test('bar name setup persists only on valid name save, remains isolated and preserves existing bars', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    assert.equal(a.nameConfigured, false);
    assert.equal(a.acceptingOrders, true);
    assert.equal((await s.bootstrap('alice')).nameConfigured, false);
    for (const name of ['', '  ', 'x'.repeat(61), 42]) {
      assert.equal(
        (await s.request('/api/host/bar', { uid: 'alice', method: 'PATCH', body: { name } }))
          .status,
        400,
      );
    }
    await s.request('/api/host/bar', {
      uid: 'alice',
      method: 'PATCH',
      body: { acceptingOrders: false },
    });
    assert.equal((await s.bootstrap('alice')).acceptingOrders, false);
    assert.equal((await s.bootstrap('alice')).nameConfigured, false);
    const saved = await s.request('/api/host/bar', {
      uid: 'alice',
      method: 'PATCH',
      body: { name: '  小さなバー  ' },
    });
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as any).nameConfigured, true);
    const again = await s.bootstrap('alice');
    assert.equal(again.name, '小さなバー');
    assert.equal(again.id, a.id);
    assert.equal(again.nameConfigured, true);
    assert.equal(again.acceptingOrders, false);
    assert.equal((await s.bootstrap('bob')).nameConfigured, false);
    // Recreate the pre-migration schema to check existing rows receive the completed default.
    await s.db.exec('ALTER TABLE bars DROP COLUMN name_configured');
    await s.db.exec(
      readFileSync('migrations/0003_bar_name_setup.sql', 'utf8').replaceAll('\n', ' '),
    );
    assert.equal((await s.bootstrap('alice')).nameConfigured, true);
    assert.equal((await s.bootstrap('bob')).nameConfigured, true);
  } finally {
    await s.mf.dispose();
  }
});

test('host catalog shows all recipes, isolates inventory and counts, and uses indexed reads without history scans', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice'),
      b = await s.bootstrap('bob');
    // Add a recipe with no substitutes before warming the immutable catalog.
    const source = await s.db
      .prepare('SELECT payload FROM catalog_entries WHERE cocktail_id=1')
      .first<{ payload: string }>();
    const extra = JSON.parse(source!.payload) as Cocktail;
    extra.id = 3;
    extra.name = '不足カクテル';
    extra.ingredients[0].drinkId = 3;
    extra.ingredients[0].kindId = null;
    await s.db
      .prepare("INSERT INTO catalog_entries VALUES('v1',3,?)")
      .bind(JSON.stringify(extra))
      .run();
    await s.request('/api/host/inventory/1', {
      uid: 'alice',
      method: 'PUT',
      body: { available: true },
    });
    await s.db.batch([
      s.db
        .prepare('INSERT INTO cocktail_order_counts VALUES(?,?,?,?)')
        .bind(a.id, 1, 'カクテル1', 1),
      s.db
        .prepare('INSERT INTO cocktail_order_counts VALUES(?,?,?,?)')
        .bind(a.id, 2, 'カクテル2', 5),
      s.db
        .prepare('INSERT INTO cocktail_order_counts VALUES(?,?,?,?)')
        .bind(a.id, 3, '不足カクテル', 100),
      s.db
        .prepare('INSERT INTO cocktail_order_counts VALUES(?,?,?,?)')
        .bind(b.id, 1, 'カクテル1', 200),
    ]);
    assert.equal((await s.request('/api/host/menu')).status, 401);
    assert.equal((await s.request('/api/host/cocktails/1')).status, 401);
    const queries: string[] = [];
    s.env.DB = {
      prepare(sql: string) {
        queries.push(sql);
        return s.db.prepare(sql);
      },
      batch: s.db.batch.bind(s.db),
    } as typeof s.db;
    const get = async (path: string, uid = 'alice') => {
      const r = await s.request(path, { uid });
      assert.equal(r.status, 200);
      return (await r.json()) as any;
    };
    const first = await get(`/api/host/menu?bar_id=${b.id}`);
    assert.deepEqual(
      first.items.map((c: Cocktail) => c.id),
      [2, 1, 3],
    );
    assert.equal(first.availableTotal, 2);
    assert.equal(first.items[0].ingredients[0].substitute, true);
    assert.equal(first.items[1].ingredients[0].candidates[0].id, 1);
    assert.equal(first.items[2].ingredients[0].candidates.length, 0);
    queries.length = 0;
    await get('/api/host/menu');
    assert.equal(
      queries.some((q) => /FROM catalog_(drinks|entries|kinds)\b|FROM orders\b/.test(q)),
      false,
    );
    const dataQueries = queries.filter((q) => /FROM (inventory|cocktail_order_counts)\b/.test(q));
    assert.equal(dataQueries.length, 2);
    for (const sql of dataQueries) {
      const plan = await s.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(a.id)
        .all<{ detail: string }>();
      assert.ok(
        plan.results.every((r) => !/SCAN/.test(r.detail)),
        JSON.stringify(plan.results),
      );
      assert.ok(
        plan.results.some((r) => /SEARCH.*INDEX/.test(r.detail)),
        JSON.stringify(plan.results),
      );
    }
    queries.length = 0;
    assert.equal((await get('/api/host/cocktails/3')).available, false);
    assert.equal(
      queries.some((q) => /cocktail_order_counts|FROM orders\b/.test(q)),
      false,
    );
    assert.equal((await get('/api/host/menu', 'bob')).availableTotal, 0);
    assert.equal((await s.request('/api/host/cocktails/999', { uid: 'alice' })).status, 404);
    for (const query of ['page=-1', 'page=1.5', 'kind=no', 'min=20&max=10'])
      assert.equal((await s.request(`/api/host/menu?${query}`, { uid: 'alice' })).status, 400);
    assert.equal((await get('/api/host/menu?q=不足')).items[0].id, 3);
    assert.equal((await get('/api/host/menu?kind=1')).total, 2);
    assert.equal((await get('/api/host/menu?min=50')).total, 0);
  } finally {
    await s.mf.dispose();
  }
});

test('host availability and popularity sort precedes pagination including zero-count ties', () => {
  const cocktails = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: `同名`,
    available: i < 25,
    ingredients: [],
    alcoholLow: 10,
    alcoholHigh: 10,
  })) as unknown as Cocktail[];
  const counts = new Map([
    [25, 10],
    [50, 1000],
  ]);
  const data = { cocktails, drinks: [], kinds: [], catalogVersion: 'test' };
  const result = [1, 2, 3].flatMap(
    (page) => menu(data, new URLSearchParams({ page: String(page) }), counts, true).items,
  );
  assert.equal(result.length, 50);
  assert.equal(new Set(result.map((c) => c.id)).size, 50);
  assert.deepEqual(
    result.slice(0, 3).map((c) => c.id),
    [25, 1, 2],
  );
  assert.equal(result[24].id, 24);
  assert.equal(result[25].id, 50);
  assert.equal(menu(data, new URLSearchParams(), counts).total, 25);
});
