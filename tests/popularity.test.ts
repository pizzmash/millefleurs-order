import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup } from './cloud-fixture';
import { menu } from '../worker/catalog';
import type { Cocktail, OrderCounts } from '../shared/types';

test('D1 popularity: migration, isolation, retries, reset and atomic ordering', async () => {
  const s = await setup({ popularity: false });
  try {
    const a = await s.bootstrap('alice'),
      b = await s.bootstrap('bob');
    for (const uid of ['alice', 'bob'])
      await s.request('/api/host/inventory/1', { uid, method: 'PUT', body: { available: true } });
    const ag = await s.join(a.id, await s.invite('alice'));
    const bg = await s.join(b.id, await s.invite('bob'));
    const order = (barId: string, cookie: string, cocktailId: number, requestKey: string) =>
      s.request(`/api/b/${barId}/orders`, {
        cookie,
        method: 'POST',
        body: { cocktailId, requestKey },
      });
    const counts = async (uid = 'alice', query = '') => {
      const r = await s.request(`/api/host/order-counts${query}`, { uid });
      assert.equal(r.status, 200, await r.clone().text());
      return (await r.json()) as OrderCounts;
    };
    const reset = (uid = 'alice') =>
      s.request('/api/host/order-counts/reset', { uid, method: 'POST', body: {} });
    const old = await order(a.id, ag.cookie, 1, 'old-order-key-00001');
    const oldId = ((await old.json()) as any).id;
    await s.request(`/api/host/orders/${oldId}/complete`, {
      uid: 'alice',
      method: 'POST',
      body: {},
    });
    await order(a.id, ag.cookie, 2, 'old-order-key-00002');
    await order(b.id, bg.cookie, 1, 'other-order-key-001');
    await s.db.exec(
      readFileSync('migrations/0002_cocktail_popularity.sql', 'utf8').replaceAll('\n', ' '),
    );
    assert.equal((await counts()).totalCount, 2);
    assert.equal((await counts('bob')).totalCount, 1);
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => order(a.id, ag.cookie, 2, 'duplicate-order-001')),
    );
    for (const r of responses) assert.ok([200, 201].includes(r.status));
    assert.equal((await counts()).totalCount, 3);
    assert.equal((await counts()).items[0].id, 2);
    assert.equal((await order(a.id, ag.cookie, 1, 'duplicate-order-001')).status, 409);
    assert.equal((await order(a.id, ag.cookie, 999, 'unknown-order-0001')).status, 404);
    assert.equal((await counts()).totalCount, 3);
    const am = await s.request(`/api/b/${a.id}/menu`, { cookie: ag.cookie });
    const bm = await s.request(`/api/b/${b.id}/menu`, { cookie: bg.cookie });
    assert.deepEqual(
      ((await am.json()) as any).items.map((x: any) => x.id),
      [2, 1],
    );
    assert.deepEqual(
      ((await bm.json()) as any).items.map((x: any) => x.id),
      [1, 2],
    );
    assert.equal((await counts('alice', '?q=カクテル1')).totalCount, 3);
    assert.equal((await counts('alice', '?q=カクテル1')).items.length, 1);
    assert.equal((await s.request('/api/host/order-counts', { cookie: ag.cookie })).status, 401);
    assert.equal((await reset('')).status, 401);
    assert.equal(
      (
        await s.request('/api/host/order-counts/reset', {
          uid: 'alice',
          method: 'POST',
          body: {},
          customOrigin: 'https://evil.example',
        })
      ).status,
      403,
    );
    const before = await s.db.prepare('SELECT * FROM orders ORDER BY id').all();
    assert.equal((await reset()).status, 200);
    assert.equal((await counts()).totalCount, 0);
    assert.equal((await counts('bob')).totalCount, 1);
    assert.deepEqual(
      (await s.db.prepare('SELECT * FROM orders ORDER BY id').all()).results,
      before.results,
    );
    assert.equal((await order(a.id, ag.cookie, 1, 'old-order-key-00001')).status, 200);
    await s.request(`/api/host/orders/${oldId}/complete`, {
      uid: 'alice',
      method: 'POST',
      body: {},
    });
    assert.equal((await counts()).totalCount, 0);
    const resetMenu = await s.request(`/api/b/${a.id}/menu`, { cookie: ag.cookie });
    assert.deepEqual(
      ((await resetMenu.json()) as any).items.map((x: any) => x.id),
      [1, 2],
    );
    // Distinct concurrent requests must all increment once.
    const fresh = await Promise.all(
      [1, 2, 3].map((i) => order(a.id, ag.cookie, 2, `fresh-order-key-000${i}`)),
    );
    for (const r of fresh) assert.equal(r.status, 201);
    assert.equal((await counts()).totalCount, 3);
    // A racing reset can linearize before or after the insert, never leave a partial count.
    const racing = await Promise.all([reset(), order(a.id, ag.cookie, 1, 'racing-order-key-01')]);
    assert.equal(racing[0].status, 200);
    assert.equal(racing[1].status, 201);
    assert.ok([0, 1].includes((await counts()).totalCount));
    // A trigger failure must roll back the order itself.
    await s.db.exec(
      "CREATE TRIGGER fail_count BEFORE UPDATE ON cocktail_order_counts BEGIN SELECT RAISE(ABORT,'test rollback'); END;",
    );
    assert.equal((await order(a.id, ag.cookie, 1, 'rollback-order-001')).status, 503);
    assert.equal(
      await s.db.prepare("SELECT id FROM orders WHERE request_key='rollback-order-001'").first(),
      null,
    );
    await s.db.exec('DROP TRIGGER fail_count;');
    // Removed cocktails remain visible; unavailable and never-ordered catalog entries appear as zero.
    await s.db.prepare('DELETE FROM catalog_entries WHERE cocktail_id=2').run();
    await s.db.prepare('UPDATE inventory SET available=0 WHERE bar_id=?').bind(a.id).run();
    assert.ok((await counts()).items.some((x) => x.id === 2));
    await s.db
      .prepare("INSERT INTO catalog_entries VALUES('v1',3,?)")
      .bind(JSON.stringify({ name: '未注文' }))
      .run();
    assert.equal((await counts()).items.find((x) => x.id === 3)?.orderCount, 0);
    for (let i = 4; i <= 34; i++)
      await s.db
        .prepare("INSERT INTO catalog_entries VALUES('v1',?,?)")
        .bind(i, JSON.stringify({ name: `追加${i}` }))
        .run();
    const first = await counts(),
      second = await counts('alice', '?page=2');
    assert.equal(first.items.length, 30);
    assert.equal(second.items.length, 4);
    assert.equal(new Set([...first.items, ...second.items].map((x) => x.id)).size, 34);
  } finally {
    await s.mf.dispose();
  }
});

test('menu popularity sorts before pagination and preserves all filters and tie breaks', () => {
  const cocktails: Cocktail[] = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: `カクテル${String(i + 1).padStart(2, '0')}`,
    description: '',
    alcohol: '10%',
    alcoholLow: 10,
    alcoholHigh: 10,
    image: '',
    glass: '',
    technique: '',
    available: true,
    substitution: false,
    ingredients: [
      {
        id: i,
        drinkId: 1,
        name: 'ジン',
        kindId: 1,
        quantity: '',
        candidates: [],
        substitute: false,
      },
    ],
  }));
  cocktails[49].available = false;
  const data = { cocktails, drinks: [], kinds: [], catalogVersion: 'test' };
  const counts = new Map([
    [49, 100],
    [50, 200],
    [48, 100],
  ]);
  const first = menu(data, new URLSearchParams('q=ジン&kind=1&min=5&max=15'), counts);
  assert.deepEqual(
    first.items.slice(0, 3).map((x) => x.id),
    [48, 49, 1],
  );
  assert.equal(first.total, 49);
  const pages = [1, 2, 3].flatMap(
    (page) => menu(data, new URLSearchParams(`page=${page}`), counts).items,
  );
  assert.equal(new Set(pages.map((x) => x.id)).size, 49);
  assert.equal(menu(data, new URLSearchParams('min=20'), counts).total, 0);
  assert.equal(menu(data, new URLSearchParams('kind=2'), counts).total, 0);
  cocktails[47].name = cocktails[48].name;
  assert.deepEqual(
    menu(data, new URLSearchParams(), counts)
      .items.slice(0, 2)
      .map((x) => x.id),
    [48, 49],
  );
  assert.equal(cocktails[0].id, 1); // shared catalog order was not mutated
});
