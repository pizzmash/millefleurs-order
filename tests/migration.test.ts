import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db';
import { setup } from './cloud-fixture';

test('legacy migration: dry run, consistent backup, wrong-owner rejection and partial retry', async () => {
  const s = await setup();
  const directory = mkdtempSync(join(tmpdir(), 'milleflewrs-migration-'));
  try {
    const a = await s.bootstrap('alice');
    const source = join(directory, 'source.sqlite');
    const old = openDb(source);
    old.exec(
      "INSERT INTO drinks VALUES(1,'材料1',NULL); INSERT INTO inventory VALUES(1,1); INSERT INTO guests VALUES('old-guest','ゲスト');",
    );
    const ingredients = JSON.stringify([
      {
        recipeId: 1,
        drinkId: 1,
        name: "古い'材料",
        kindId: null,
        quantity: '30ml',
        selectedId: 1,
        selectedName: '材料1',
      },
    ]);
    old
      .prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        'old-order',
        'old-guest',
        'ゲスト',
        1,
        '古い名前',
        '',
        'ステア',
        'グラス',
        'completed',
        '2026-01-01',
        '2026-01-02',
        'legacy-key-12345',
        ingredients,
      );
    old.close();
    const cli = resolve('scripts/cloud/migrate-legacy.ts'),
      tsx = resolve('node_modules/tsx/dist/cli.mjs');
    const run = (uid: string, write = false) =>
      execFileSync(
        process.execPath,
        [tsx, cli, '--source', source, '--bar', a.id, '--uid', uid, ...(write ? ['--write'] : [])],
        { cwd: directory, encoding: 'utf8' },
      );
    assert.match(run('alice'), /"dryRun": true/);
    assert.equal(existsSync(join(directory, '.runtime/cloud/legacy-import.sql')), false);
    run('bob', true);
    const wrong = readFileSync(join(directory, '.runtime/cloud/legacy-import.sql'), 'utf8');
    await assert.rejects(s.db.exec(wrong.replaceAll('\n', ' ')));
    assert.equal(
      (await s.db.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>())!.n,
      0,
    );
    const output = run('alice', true);
    assert.match(output, /"dryRun": false/);
    const sql = readFileSync(join(directory, '.runtime/cloud/legacy-import.sql'), 'utf8');
    const statements = sql
      .trim()
      .split(';\n')
      .map((x) => x.replace(/;$/, ''));
    for (const statement of statements.slice(0, 7)) await s.db.prepare(statement).run();
    for (const statement of statements) await s.db.prepare(statement).run();
    for (const statement of statements) await s.db.prepare(statement).run();
    assert.equal(
      (await s.db.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>())!.n,
      1,
    );
    const row = await s.db.prepare('SELECT * FROM orders').first();
    assert.equal(row!.bar_id, a.id);
    assert.equal(row!.cocktail_name, '古い名前');
    assert.equal(row!.ingredients, ingredients);
    assert.equal(
      (await s.db.prepare('SELECT COUNT(*) AS n FROM guest_sessions').first<{ n: number }>())!.n,
      0,
    );
    const hash = JSON.parse(output.slice(output.indexOf('{'))).sourceHash;
    const backup = new DatabaseSync(
      join(directory, `.runtime/cloud/legacy-${hash.slice(0, 12)}.sqlite`),
      { readOnly: true },
    );
    assert.equal((backup.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n, 1);
    backup.close();
  } finally {
    await s.mf.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
