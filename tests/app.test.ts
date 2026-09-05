import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb } from '../server/db.ts';
import { importCatalog, normalizeAlcohol } from '../server/import.ts';
import { candidates, getCatalog, getDrinks, getMenu } from '../server/catalog.ts';
import { createApp } from '../server/app.ts';
import type { Order } from '../shared/types.ts';

function fixture(path = ':memory:') {
  const db = openDb(path);
  db.exec(`INSERT INTO kinds VALUES(0,'ジン',1),(59,'トニック',0),(60,'水',0);
    INSERT INTO techniques VALUES(0,'ビルド'); INSERT INTO glasses VALUES(0,'タンブラー');
    INSERT INTO drinks VALUES(0,'ドライ・ジン',0),(1,'タンカレー',0),(2,'トニック',59),(3,'未分類A',NULL),(4,'未分類B',NULL),(67,'クラッシュドアイス',NULL),(70,'熱湯',60),(90,'水',60),(131,'バニラアイスクリーム',NULL);
    INSERT INTO cocktails VALUES(0,'ジン・トニック','爽やかな一杯','度数 約 12 %',12,12,'',0,0),(1,'ミステリー','','',NULL,NULL,'',0,0),(2,'水と氷','','ノンアルコール (0%)',0,0,'',0,0),(3,'レシピなし','','',NULL,NULL,'',0,0);
    INSERT INTO recipes VALUES(0,0,0,'30 ml'),(1,0,2,'90 ml'),(2,1,3,'1 dash'),(3,2,70,'90 ml'),(4,2,67,'1 個');`);
  const app = createApp(db);
  const stock = (id: number, available = true) =>
    db
      .prepare(
        'INSERT INTO inventory VALUES(?,?) ON CONFLICT(drink_id) DO UPDATE SET available=excluded.available',
      )
      .run(id, +available);
  const request = (path: string, method = 'GET', body?: unknown, cookie?: string) =>
    app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const guest = async (name = '客人') => {
    const response = await request('/api/join', 'POST', { nickname: name });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  return { db, app, stock, request, guest };
}

test('CSVコピーのハッシュと955種類の取り込み・再取り込み', () => {
  const manifest = JSON.parse(readFileSync('data/source-manifest.json', 'utf8'));
  for (const [file, info] of Object.entries(manifest.files))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join('data/raw', file)))
        .digest('hex'),
      (info as { sha256: string }).sha256,
    );
  const db = openDb(':memory:');
  try {
    const result = importCatalog(db);
    assert.equal(result.counts.cocktail, 955);
    assert.deepEqual(result.warnings, []);
    db.prepare('INSERT INTO inventory VALUES(0,1)').run();
    importCatalog(db);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cocktails').get() as { n: number }).n, 955);
    assert.equal(
      (
        db.prepare('SELECT available FROM inventory WHERE drink_id=0').get() as {
          available: number;
        }
      ).available,
      1,
    );
    assert.equal(
      (db.prepare('SELECT kind_id FROM drinks WHERE id=67').get() as { kind_id: null }).kind_id,
      null,
    );
  } finally {
    db.close();
  }
});
test('度数の数値・範囲・0%・不明を区別する', () => {
  assert.deepEqual(normalizeAlcohol('度数 約 12.4 %'), [12.4, 12.4]);
  assert.deepEqual(normalizeAlcohol('ノンアルコール (0%)'), [0, 0]);
  assert.deepEqual(normalizeAlcohol('度数 弱い (8度以下)'), [0, 8]);
  assert.deepEqual(normalizeAlcohol('度数 普通 (9度〜24度)'), [9, 24]);
  assert.deepEqual(normalizeAlcohol('度数 強い (25度以上)'), [25, 100]);
  assert.deepEqual(normalizeAlcohol(''), [null, null]);
});
test('材料の完全一致を優先し、欠品時だけ同種代用する', () => {
  const { db, stock } = fixture();
  try {
    stock(1);
    stock(2);
    const c = getCatalog(db).find((c) => c.id === 0)!;
    assert.equal(c.available, true);
    assert.equal(c.substitution, true);
    assert.deepEqual(
      c.ingredients[0].candidates.map((d) => d.id),
      [1],
    );
    stock(0);
    assert.deepEqual(
      getCatalog(db)[0].ingredients[0].candidates.map((d) => d.id),
      [0],
    );
    stock(2, false);
    assert.equal(getCatalog(db)[0].available, false);
  } finally {
    db.close();
  }
});
test('空欄kind_id同士は代用不可・完全一致は可・水氷のみ常備', () => {
  const { db, stock } = fixture();
  try {
    stock(4);
    assert.deepEqual(candidates(3, null, getDrinks(db)), []);
    stock(3);
    assert.deepEqual(candidates(3, null, getDrinks(db)), [{ id: 3, name: '未分類A' }]);
    assert.equal(getCatalog(db).find((c) => c.id === 2)!.available, true);
    assert.equal(getDrinks(db).find((d) => d.id === 131)!.available, false);
    assert.equal(getCatalog(db).find((c) => c.id === 3)!.available, false);
  } finally {
    db.close();
  }
});
test('複合フィルターは代用品名でも検索し、度数不明を数値範囲から除く', () => {
  const { db, stock } = fixture();
  try {
    stock(1);
    stock(2);
    stock(3);
    assert.deepEqual(
      getMenu(db, new URLSearchParams('q=タンカレー&kind=0&min=9&max=24')).items.map((c) => c.id),
      [0],
    );
    assert.equal(getMenu(db, new URLSearchParams('min=0&max=0')).total, 1);
    assert.equal(getMenu(db, new URLSearchParams('q=ミステリー&min=0')).total, 0);
  } finally {
    db.close();
  }
});
test('同名客人の注文が分離され、Cookieで参加状態を復元する', async () => {
  const { db, stock, request, guest } = fixture();
  try {
    stock(0);
    stock(2);
    const a = await guest('同じ名前'),
      b = await guest('同じ名前');
    assert.notEqual(a, b);
    const response = await request(
      '/api/orders',
      'POST',
      { cocktailId: 0, requestKey: 'same-name-order-0001' },
      a,
    );
    assert.equal(response.status, 201);
    assert.equal(
      (await (await request('/api/orders', 'GET', undefined, a)).json()).orders.length,
      1,
    );
    assert.equal(
      (await (await request('/api/orders', 'GET', undefined, b)).json()).orders.length,
      0,
    );
    assert.equal(
      (await (await request('/api/session', 'GET', undefined, a)).json()).guest.nickname,
      '同じ名前',
    );
  } finally {
    db.close();
  }
});
test('注文確定時に在庫を再判定し、残量は減らさない', async () => {
  const { db, stock, request, guest } = fixture();
  try {
    const cookie = await guest();
    stock(0);
    stock(2);
    assert.equal(
      (
        await request(
          '/api/orders',
          'POST',
          { cocktailId: 0, requestKey: 'inventory-check-0001' },
          cookie,
        )
      ).status,
      201,
    );
    assert.equal(getDrinks(db).find((d) => d.id === 0)!.available, true);
    stock(2, false);
    assert.equal(
      (
        await request(
          '/api/orders',
          'POST',
          { cocktailId: 0, requestKey: 'inventory-check-0002' },
          cookie,
        )
      ).status,
      409,
    );
    assert.equal((await (await request('/api/host/orders')).json()).orders.length, 1);
  } finally {
    db.close();
  }
});
test('同一キーの通信再試行は一件のみ、別カクテルへの使い回しは拒否', async () => {
  const { db, stock, request, guest } = fixture();
  try {
    const cookie = await guest();
    stock(0);
    stock(2);
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(
          '/api/orders',
          'POST',
          { cocktailId: 0, requestKey: 'repeatable-request-001' },
          cookie,
        ),
      ),
    );
    const orders = await Promise.all(responses.map((r) => r.json()));
    assert.equal(orders[0].id, orders[1].id);
    stock(0, false); // Even after depletion, retry returns the previously accepted order.
    assert.equal(
      (
        await request(
          '/api/orders',
          'POST',
          { cocktailId: 0, requestKey: 'repeatable-request-001' },
          cookie,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await request(
          '/api/orders',
          'POST',
          { cocktailId: 2, requestKey: 'repeatable-request-001' },
          cookie,
        )
      ).status,
      409,
    );
  } finally {
    db.close();
  }
});
test('家主が代用品を選択して提供完了、再送でも完了時刻は不変', async () => {
  const { db, stock, request, guest } = fixture();
  try {
    stock(1);
    stock(2);
    const cookie = await guest();
    const order: Order = await (
      await request(
        '/api/orders',
        'POST',
        { cocktailId: 0, requestKey: 'substitute-order-0001' },
        cookie,
      )
    ).json();
    assert.equal(order.ingredients[0].selectedId, null);
    assert.equal((await request(`/api/host/orders/${order.id}/complete`, 'POST', {})).status, 409);
    assert.equal(
      (await request(`/api/host/orders/${order.id}/ingredients/0`, 'PUT', { drinkId: 2 })).status,
      409,
    );
    assert.equal(
      (await request(`/api/host/orders/${order.id}/ingredients/0`, 'PUT', { drinkId: 1 })).status,
      200,
    );
    const completed: Order = await (
      await request(`/api/host/orders/${order.id}/complete`, 'POST', {})
    ).json();
    assert.equal(completed.status, 'completed');
    assert.equal(completed.ingredients[0].selectedName, 'タンカレー');
    const repeated = await (
      await request(`/api/host/orders/${order.id}/complete`, 'POST', {})
    ).json();
    assert.equal(repeated.completedAt, completed.completedAt);
    assert.equal((await (await request('/api/host/orders')).json()).orders.length, 0);
    assert.equal(
      (await (await request('/api/host/orders?status=completed')).json()).orders.length,
      1,
    );
    assert.equal(
      (await request(`/api/host/orders/${order.id}/ingredients/0`, 'PUT', { drinkId: 0 })).status,
      409,
    );
    assert.equal(
      (await (await request('/api/orders', 'GET', undefined, cookie)).json()).orders[0].status,
      'completed',
    );
  } finally {
    db.close();
  }
});
test('在庫が変わった代用品の選択を拒否し受付注文を保持する', async () => {
  const { db, stock, request, guest } = fixture();
  try {
    stock(1);
    stock(2);
    const cookie = await guest();
    const order = await (
      await request(
        '/api/orders',
        'POST',
        { cocktailId: 0, requestKey: 'inventory-race-0001' },
        cookie,
      )
    ).json();
    stock(1, false);
    assert.equal(
      (await request(`/api/host/orders/${order.id}/ingredients/0`, 'PUT', { drinkId: 1 })).status,
      409,
    );
    const list = await (await request('/api/host/orders')).json();
    assert.equal(list.orders.length, 1);
    assert.equal(list.orders[0].ingredients[0].missing, true);
  } finally {
    db.close();
  }
});
test('注文・在庫・代用記録はDB再接続後も残る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bar-test-'));
  const path = join(dir, 'test.sqlite');
  const { db, stock, request, guest } = fixture(path);
  try {
    stock(1);
    stock(2);
    const cookie = await guest();
    const order = await (
      await request(
        '/api/orders',
        'POST',
        { cocktailId: 0, requestKey: 'persistent-order-001' },
        cookie,
      )
    ).json();
    await request(`/api/host/orders/${order.id}/ingredients/0`, 'PUT', { drinkId: 1 });
    await request(`/api/host/orders/${order.id}/complete`, 'POST', {});
    db.close();
    const reopened = openDb(path);
    try {
      const app = createApp(reopened);
      const data = await (await app.request('/api/host/orders?status=completed')).json();
      assert.equal(data.orders[0].ingredients[0].selectedName, 'タンカレー');
      assert.equal(getDrinks(reopened).find((d) => d.id === 1)!.available, true);
    } finally {
      reopened.close();
    }
  } finally {
    try {
      db.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
test('家主認証不要、客人キャンセルなし、参加と在庫入力を検証', async () => {
  const { db, request } = fixture();
  try {
    assert.equal((await request('/api/host/inventory')).status, 200);
    assert.equal((await request('/api/join', 'POST', { nickname: '   ' })).status, 400);
    assert.equal(
      (await request('/api/orders', 'POST', { cocktailId: 0, requestKey: 'no-guest-order-0001' }))
        .status,
      401,
    );
    assert.equal((await request('/api/orders/example', 'DELETE', {})).status, 404);
    assert.equal((await request('/api/host/inventory/0', 'PUT', { available: 'yes' })).status, 400);
    assert.equal(
      (await request('/api/host/inventory/67', 'PUT', { available: false })).status,
      400,
    );
    assert.equal((await request('/api/menu?min=20&max=10')).status, 400);
  } finally {
    db.close();
  }
});
test('QR設定はlocalhostを公開しない', async () => {
  const { db } = fixture();
  try {
    const local = await (
      await createApp(db, { publicUrl: 'http://localhost:3000' }).request('/api/host/connection')
    ).json();
    assert.equal(local.publicUrl, null);
    const lan = await (
      await createApp(db, { publicUrl: 'http://192.168.1.10:3000' }).request('/api/host/connection')
    ).json();
    assert.equal(lan.publicUrl, 'http://192.168.1.10:3000');
  } finally {
    db.close();
  }
});
test('原マスターの名前が変わっても注文の材料・カクテル名を保持する', async () => {
  const { db, stock, request, guest } = fixture();
  try {
    stock(0);
    stock(2);
    const cookie = await guest();
    await request(
      '/api/orders',
      'POST',
      { cocktailId: 0, requestKey: 'snapshot-order-0001' },
      cookie,
    );
    db.exec(
      "UPDATE cocktails SET name='新しい名前' WHERE id=0; UPDATE drinks SET name='新しい材料名' WHERE id=0;",
    );
    const data = await (await request('/api/orders', 'GET', undefined, cookie)).json();
    assert.equal(data.orders[0].cocktailName, 'ジン・トニック');
    assert.equal(data.orders[0].ingredients[0].name, 'ドライ・ジン');
  } finally {
    db.close();
  }
});
test('不正なページ番号と別オリジンからの更新を拒否する', async () => {
  const { db, app, request } = fixture();
  try {
    assert.equal((await request('/api/host/orders?page=Infinity')).status, 400);
    assert.equal((await request('/api/host/orders?page=-1')).status, 400);
    const response = await app.request('/api/host/inventory/0', {
      method: 'PUT',
      headers: { Origin: 'http://other.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ available: true }),
    });
    assert.equal(response.status, 403);
    assert.equal(getDrinks(db)[0].available, false);
  } finally {
    db.close();
  }
});
