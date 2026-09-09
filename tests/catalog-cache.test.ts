import test from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { catalog, catalogDrinks, catalogCocktail } from '../worker/catalog';
import { catalogSql } from '../scripts/cloud/catalog';
import { resolveCocktail } from '../shared/catalog';
import type { Cocktail } from '../shared/types';
import { recommendPurchases } from '../shared/purchase-recommendations';
import { setup } from './cloud-fixture';

function track(db: D1Database) {
  const queries: string[] = [];
  const measured = {
    prepare(sql: string) {
      queries.push(sql);
      return db.prepare(sql);
    },
    batch: db.batch.bind(db),
  } as D1Database;
  return { db: measured, queries };
}
const masterReads = (queries: string[]) =>
  queries.filter((sql) => /FROM catalog_(drinks|entries|kinds)\b/.test(sql));

test('catalog cache avoids master reads while keeping inventory fresh and bars isolated', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    const b = await s.bootstrap('bob');
    const t = track(s.db);
    const first = await catalog(t.db, a.id);
    assert.equal(masterReads(t.queries).length, 3);
    assert.equal(first.cocktails[0].available, false);
    await s.db.prepare('INSERT INTO inventory VALUES(?,1,1)').bind(a.id).run();
    t.queries.length = 0;
    const stocked = await catalog(t.db, a.id);
    assert.equal(stocked.cocktails[0].available, true);
    assert.equal((await catalog(t.db, b.id)).cocktails[0].available, false);
    assert.equal(masterReads(t.queries).length, 0);
    // A caller's changes must not corrupt the immutable cached master.
    stocked.drinks[0].name = 'changed';
    stocked.cocktails[0].ingredients[0].name = 'changed';
    stocked.kinds[0].name = 'changed';
    const fresh = await catalog(t.db, a.id);
    assert.equal(fresh.drinks[0].name, first.drinks[0].name);
    assert.equal(fresh.cocktails[0].ingredients[0].name, first.cocktails[0].ingredients[0].name);
    assert.equal(fresh.kinds[0].name, first.kinds[0].name);
    await s.db.prepare('UPDATE inventory SET available=0 WHERE bar_id=?').bind(a.id).run();
    assert.equal((await catalog(t.db, a.id)).cocktails[0].available, false);
    assert.equal(masterReads(t.queries).length, 0);
  } finally {
    await s.mf.dispose();
  }
});

test('catalog activation and rollback replace cached masters; DB bindings do not share data', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    const t = track(s.db);
    await catalog(t.db, a.id);
    await s.db.batch([
      s.db.prepare("INSERT INTO catalog_versions VALUES('v2','2026-09-09')"),
      s.db.prepare(
        "INSERT INTO catalog_drinks SELECT 'v2',drink_id,json_set(payload,'$.name','新版材料') FROM catalog_drinks WHERE version='v1'",
      ),
      s.db.prepare(
        "INSERT INTO catalog_entries SELECT 'v2',cocktail_id,json_set(payload,'$.name','新版カクテル') FROM catalog_entries WHERE version='v1'",
      ),
      s.db.prepare(
        "INSERT INTO catalog_kinds SELECT 'v2',kind_id,'新版分類' FROM catalog_kinds WHERE version='v1'",
      ),
    ]);
    assert.equal((await catalog(t.db, a.id)).catalogVersion, 'v1');
    await s.db.prepare("UPDATE catalog_state SET version='v2'").run();
    const v2 = await catalog(t.db, a.id);
    assert.equal(v2.drinks[0].name, '新版材料');
    assert.equal(v2.cocktails[0].name, '新版カクテル');
    assert.equal(v2.kinds[0].name, '新版分類');
    await s.db.prepare("UPDATE catalog_state SET version='v1'").run();
    const rolledBack = await catalog(t.db, a.id);
    assert.equal(rolledBack.catalogVersion, 'v1');
    assert.equal(rolledBack.drinks[0].name, '材料1');
    const other = await setup();
    try {
      await other.db
        .prepare(
          "UPDATE catalog_drinks SET payload=json_set(payload,'$.name','別DB') WHERE drink_id=1",
        )
        .run();
      assert.equal((await catalog(other.db, 'unused')).drinks[0].name, '別DB');
      assert.equal((await catalog(t.db, a.id)).drinks[0].name, '材料1');
    } finally {
      await other.mf.dispose();
    }
  } finally {
    await s.mf.dispose();
  }
});

test('order lists skip empty catalogs and never load recipes even on a cold cache', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    const g = await s.join(a.id, await s.invite('alice'));
    const t = track(s.db);
    s.env.DB = t.db;
    for (const [url, options] of [
      ['/api/host/orders', { uid: 'alice' }],
      [`/api/b/${a.id}/orders`, { cookie: g.cookie }],
    ] as const) {
      const r = await s.request(url, options);
      assert.equal(r.status, 200);
      assert.deepEqual(((await r.json()) as any).orders, []);
    }
    assert.equal(masterReads(t.queries).length, 0);
    assert.ok(!t.queries.some((sql) => /FROM inventory\b/.test(sql)));
    await s.request('/api/host/inventory/1', {
      uid: 'alice',
      method: 'PUT',
      body: { available: true },
    });
    const created = await s.request(`/api/b/${a.id}/orders`, {
      cookie: g.cookie,
      method: 'POST',
      body: { cocktailId: 1, requestKey: 'cache-test-order-123' },
    });
    assert.equal(created.status, 201);
    for (const [url, options] of [
      ['/api/host/orders', { uid: 'alice' }],
      [`/api/b/${a.id}/orders`, { cookie: g.cookie }],
    ] as const) {
      const cold = track(s.db);
      s.env.DB = cold.db;
      const r = await s.request(url, options);
      assert.equal(r.status, 200);
      assert.equal(((await r.json()) as any).orders.length, 1);
      assert.equal(masterReads(cold.queries).length, 1);
      assert.ok(masterReads(cold.queries)[0].includes('catalog_drinks'));
    }
  } finally {
    await s.mf.dispose();
  }
});

test('real CSV: warm catalog reads only version and bar inventory; failed loads can retry', async (context) => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    const data = catalogSql();
    for (let i = 0; i < data.rows.length; i += 50)
      await s.db.batch(data.rows.slice(i, i + 50).map((sql) => s.db.prepare(sql)));
    await s.db.prepare(data.activate).run();
    await s.db
      .prepare(
        'INSERT INTO inventory SELECT ?,drink_id,1 FROM catalog_drinks WHERE version=? ORDER BY drink_id LIMIT 20',
      )
      .bind(a.id, data.version)
      .run();
    const before = await s.db.batch([
      s.db.prepare('SELECT version FROM catalog_state WHERE id=1'),
      s.db
        .prepare(
          'SELECT d.payload, COALESCE(i.available,0) AS available FROM catalog_drinks d LEFT JOIN inventory i ON i.drink_id=d.drink_id AND i.bar_id=? WHERE d.version=? ORDER BY d.drink_id',
        )
        .bind(a.id, data.version),
      s.db
        .prepare('SELECT payload FROM catalog_entries WHERE version=? ORDER BY cocktail_id')
        .bind(data.version),
      s.db
        .prepare('SELECT kind_id AS id,name FROM catalog_kinds WHERE version=? ORDER BY kind_id')
        .bind(data.version),
    ]);
    const t = track(s.db);
    let failOnce = true;
    const originalBatch = t.db.batch;
    t.db.batch = (async (...args: Parameters<D1Database['batch']>) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('temporary D1 failure');
      }
      return originalBatch(...args);
    }) as D1Database['batch'];
    await assert.rejects(catalog(t.db, a.id), /temporary D1 failure/);
    const full = await catalog(t.db, a.id);
    assert.equal(full.drinks.length, data.counts.drinks);
    assert.equal(full.cocktails.length, data.counts.cocktails);
    t.queries.length = 0;
    assert.deepEqual(await catalog(t.db, a.id), full);
    assert.equal(t.queries.length, 2);
    assert.equal(masterReads(t.queries).length, 0);
    const after = await s.db.batch(
      t.queries.map((sql) =>
        sql.includes('FROM inventory') ? s.db.prepare(sql).bind(a.id) : s.db.prepare(sql),
      ),
    );
    const beforeReads = before.reduce((sum, result) => sum + result.meta.rows_read, 0);
    const afterReads = after.reduce((sum, result) => sum + result.meta.rows_read, 0);
    assert.ok(afterReads < beforeReads / 10, `${beforeReads} -> ${afterReads}`);
    context.diagnostic(
      `Local D1 catalog rows_read, 20 inventory rows: ${beforeReads} -> ${afterReads} (warm cache)`,
    );
    assert.deepEqual((await catalogDrinks(t.db, a.id)).drinks, full.drinks);
  } finally {
    await s.mf.dispose();
  }
});

test('single cocktail reads one recipe and revalidates inventory, version and duplicate orders', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    const g = await s.join(a.id, await s.invite('alice'));
    await s.db.prepare('INSERT INTO inventory VALUES(?,1,1)').bind(a.id).run();
    const t = track(s.db);
    s.env.DB = t.db;
    const detail = await s.request(`/api/b/${a.id}/cocktails/1`, { cookie: g.cookie });
    assert.equal(detail.status, 200);
    const value = await detail.json();
    assert.deepEqual(value, (await catalog(s.db, a.id)).cocktails[0]);
    const recipeReads = t.queries.filter((sql) => sql.includes('FROM catalog_entries'));
    assert.equal(recipeReads.length, 1);
    assert.ok(recipeReads[0].includes('cocktail_id=?'));
    assert.ok(!t.queries.some((sql) => sql.includes('catalog_kinds')));
    t.queries.length = 0;
    const input = { cocktailId: 1, requestKey: 'single-recipe-order-123' };
    const created = await s.request(`/api/b/${a.id}/orders`, {
      cookie: g.cookie,
      method: 'POST',
      body: input,
    });
    assert.equal(created.status, 201);
    assert.equal(masterReads(t.queries).length, 0);
    await s.db.prepare('UPDATE inventory SET available=0 WHERE bar_id=?').bind(a.id).run();
    assert.equal((await catalogCocktail(t.db, a.id, 1)).cocktail!.available, false);
    assert.equal(
      (
        await s.request(`/api/b/${a.id}/orders`, {
          cookie: g.cookie,
          method: 'POST',
          body: { ...input, requestKey: 'missing-stock-order-123' },
        })
      ).status,
      409,
    );
    const duplicate = await s.request(`/api/b/${a.id}/orders`, {
      cookie: g.cookie,
      method: 'POST',
      body: input,
    });
    assert.equal(duplicate.status, 200);
    assert.equal(((await duplicate.json()) as any).id, ((await created.json()) as any).id);
    assert.equal((await catalogCocktail(t.db, a.id, 999)).cocktail, undefined);
    await s.db.batch([
      s.db.prepare("INSERT INTO catalog_versions VALUES('single-v2','2026-09-09')"),
      s.db.prepare(
        "INSERT INTO catalog_drinks SELECT 'single-v2',drink_id,payload FROM catalog_drinks WHERE version='v1'",
      ),
      s.db.prepare(
        "INSERT INTO catalog_entries SELECT 'single-v2',cocktail_id,json_set(payload,'$.name','新版') FROM catalog_entries WHERE version='v1'",
      ),
      s.db.prepare("UPDATE catalog_state SET version='single-v2'"),
    ]);
    assert.equal((await catalogCocktail(t.db, a.id, 1)).cocktail!.name, '新版');
    await s.db.prepare("UPDATE catalog_state SET version='v1'").run();
    assert.equal((await catalogCocktail(t.db, a.id, 1)).cocktail!.name, 'カクテル1');
  } finally {
    await s.mf.dispose();
  }
});

test('raw purchase source resolves in the browser to the legacy API result, including substitutions', async () => {
  const s = await setup();
  try {
    const a = await s.bootstrap('alice');
    await s.db.prepare('INSERT INTO inventory VALUES(?,2,1)').bind(a.id).run();
    assert.equal((await s.request('/api/host/purchase-source')).status, 401);
    const sourceResponse = await s.request('/api/host/purchase-source', { uid: 'alice' });
    assert.equal(sourceResponse.status, 200);
    const source = (await sourceResponse.json()) as any;
    const legacy = (await (
      await s.request('/api/host/purchase-input', { uid: 'alice' })
    ).json()) as any;
    assert.equal(source.cocktails[0].available, false);
    const resolved = source.cocktails.map((c: Cocktail) => resolveCocktail(c, source.drinks));
    assert.deepEqual(resolved, legacy.cocktails);
    assert.equal(resolved[0].substitution, true);
    assert.deepEqual(
      await recommendPurchases(source.drinks, resolved, 1),
      await recommendPurchases(legacy.drinks, legacy.cocktails, 1),
    );
    assert.equal(source.inventoryVersion, legacy.inventoryVersion);
    assert.equal(source.catalogVersion, legacy.catalogVersion);
  } finally {
    await s.mf.dispose();
  }
});
