import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import {
  imageCandidates,
  isImage,
  resolveImage,
  serializeCsv,
} from '../server/update-image-urls.ts';

test('旧ファイル名を保持し、追加番号とハイフン番号の候補を生成する', () => {
  assert.deepEqual(
    imageCandidates(
      'https://cocktaillog.com/ja/assets/images/cocktail-w120/cocktail_gin_tonic_01.jpg?v=2',
    ),
    [
      'https://assets.cocktaillog.com/images/cocktail-w600/cocktail_gin_tonic_01.jpg',
      'https://assets.cocktaillog.com/images/cocktail-w600/cocktail_gin_tonic_01_01.jpg',
      'https://assets.cocktaillog.com/images/cocktail-w600/cocktail_gin_tonic-01_01.jpg',
    ],
  );
  assert.deepEqual(imageCandidates('https://unrelated.example/cocktail_gin_01.jpg'), []);
});
test('成功した画像URLだけ採用し、通常名で成功すれば追加候補へ進まない', async () => {
  const row = {
    id: '0',
    name: 'Gin',
    image: 'https://cocktaillog.com/ja/assets/images/cocktail-w120/cocktail_gin_tonic_01.jpg',
  };
  const fallback = await resolveImage(row, async (url) => ({
    ok: url.endsWith('-01_01.jpg'),
    status: url.endsWith('-01_01.jpg') ? 200 : 404,
  }));
  assert.equal(fallback.result, 'updated');
  assert.equal(fallback.attempts.length, 3);
  assert.ok(fallback.url.endsWith('-01_01.jpg'));
  const direct = await resolveImage(row, async () => ({ ok: true, status: 200 }));
  assert.equal(direct.attempts.length, 1);
});
test('取得失敗時は元URLを維持し、拒否・制限時は候補の試行を止める', async () => {
  const row = {
    id: '1',
    name: 'Blue',
    image: 'https://cocktaillog.com/ja/assets/images/cocktail-w120/cocktail_blue_lady_01.jpg',
  };
  for (const status of [404, 403, 429]) {
    const result = await resolveImage(row, async () => ({ ok: false, status }));
    assert.equal(result.result, 'failed');
    assert.equal(result.url, row.image);
    if (status !== 404) assert.equal(result.attempts.length, 1);
  }
});
test('200のHTML応答を画像として扱わない', () => {
  assert.equal(isImage(new TextEncoder().encode('<html>error</html>'), 'image/jpeg'), false);
  const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
  assert.equal(isImage(jpeg, 'image/jpeg'), true);
  assert.equal(isImage(jpeg, 'text/html'), false);
});
test('CSVの日本語・カンマ・引用符・改行を保持する', () => {
  const rows = [
    {
      id: '0',
      name: '名前,"引用"',
      description: '説明\n次の行',
      image: 'https://assets.example/image.jpg',
    },
  ];
  const csv = serializeCsv(rows, Object.keys(rows[0]), '\r\n');
  assert.deepEqual(parse(csv, { columns: true }), rows);
  assert.ok(csv.endsWith('\r\n'));
});

test('再取り込みは一致する注文画像だけ更新し、受付時の名前・材料を保持する', async () => {
  const { openDb } = await import('../server/db.ts');
  const { importCatalog } = await import('../server/import.ts');
  const { createApp } = await import('../server/app.ts');
  const db = openDb(':memory:');
  try {
    importCatalog(db);
    const expected = db.prepare('SELECT image FROM cocktails WHERE id=0').get() as {
      image: string;
    };
    db.exec(
      "UPDATE cocktails SET image='legacy-image.jpg',name='受付時のカクテル名' WHERE id=0; INSERT INTO inventory VALUES(0,1),(1,1)",
    );
    const app = createApp(db);
    const join = await app.request('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '画像確認' }),
    });
    const cookie = join.headers.get('set-cookie')!.split(';')[0];
    const order = await (
      await app.request('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ cocktailId: 0, requestKey: 'image-history-test-01' }),
      })
    ).json();
    assert.equal(order.image, 'legacy-image.jpg');
    const ingredients = (
      db.prepare('SELECT ingredients FROM orders WHERE id=?').get(order.id) as {
        ingredients: string;
      }
    ).ingredients;
    importCatalog(db);
    const updated = db
      .prepare('SELECT image,cocktail_name,ingredients FROM orders WHERE id=?')
      .get(order.id) as { image: string; cocktail_name: string; ingredients: string };
    assert.equal(updated.image, expected.image);
    assert.equal(updated.cocktail_name, '受付時のカクテル名');
    assert.equal(updated.ingredients, ingredients);
    db.prepare('UPDATE orders SET image=? WHERE id=?').run('custom-image.jpg', order.id);
    importCatalog(db);
    assert.equal(
      (db.prepare('SELECT image FROM orders WHERE id=?').get(order.id) as { image: string }).image,
      'custom-image.jpg',
    );
  } finally {
    db.close();
  }
});
