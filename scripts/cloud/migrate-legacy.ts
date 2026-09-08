import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sqlValue } from './catalog';
const args = process.argv.slice(2);
const option = (key: string) => {
  const i = args.indexOf(key);
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Required ${key}`);
  return args[i + 1];
};
const source = option('--source'),
  bar = option('--bar'),
  uid = option('--uid');
const db = new DatabaseSync(source, { readOnly: true });
const inventory = db.prepare('SELECT * FROM inventory ORDER BY drink_id').all();
const guests = db.prepare('SELECT * FROM guests ORDER BY id').all();
const orders = db.prepare('SELECT * FROM orders ORDER BY id').all();
const hash = createHash('sha256')
  .update(JSON.stringify({ inventory, guests, orders }))
  .digest('hex');
const importId = `legacy:${hash}:${bar}`;
const stable = (kind: string, id: unknown) =>
  createHash('sha256').update(`${importId}:${kind}:${id}`).digest('hex');
const q = sqlValue;
const target = `SELECT id FROM bars WHERE id=${q(bar)} AND owner_uid=${q(uid)}`;
const rows = [
  // The guard fails before user data is inserted if the selected owner is wrong.
  'CREATE TABLE IF NOT EXISTS legacy_import_guard (id INTEGER PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));',
  `INSERT INTO legacy_import_guard VALUES(1,(SELECT COUNT(*) FROM bars WHERE id=${q(bar)} AND owner_uid=${q(uid)})) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok;`,
  // Allow a fresh empty bar or a retry of this exact import. Never merge into live inventory/orders.
  `INSERT INTO legacy_import_guard VALUES(2,CASE WHEN EXISTS(SELECT 1 FROM legacy_imports WHERE id=${q(importId)}) OR (NOT EXISTS(SELECT 1 FROM inventory WHERE bar_id=${q(bar)}) AND NOT EXISTS(SELECT 1 FROM orders WHERE bar_id=${q(bar)})) THEN 1 ELSE 0 END) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok;`,
  `UPDATE bars SET accepting_orders=0 WHERE id IN (${target});`,
  `INSERT INTO legacy_imports VALUES(${q(importId)},${q(bar)},${q(hash)},${q(new Date().toISOString())}) ON CONFLICT(id) DO NOTHING;`,
];
for (const g of guests)
  rows.push(
    `INSERT INTO guests(id,bar_id,nickname,created_at) SELECT ${q(stable('guest', g.id))},id,${q(g.nickname)},${q(new Date().toISOString())} FROM bars WHERE id IN (${target}) ON CONFLICT(id) DO NOTHING;`,
  );
for (const i of inventory)
  rows.push(
    `INSERT INTO inventory SELECT id,${q(i.drink_id)},${q(i.available)} FROM bars WHERE id IN (${target}) ON CONFLICT(bar_id,drink_id) DO NOTHING;`,
  );
const columns = [
  'nickname',
  'cocktail_id',
  'cocktail_name',
  'image',
  'technique',
  'glass',
  'status',
  'created_at',
  'completed_at',
  'request_key',
  'ingredients',
];
for (const o of orders)
  rows.push(
    `INSERT INTO orders(id,bar_id,guest_id,${columns.join(',')}) SELECT ${q(stable('order', o.id))},id,${q(stable('guest', o.guest_id))},${columns.map((k) => q(o[k])).join(',')} FROM bars WHERE id IN (${target}) ON CONFLICT(id) DO NOTHING;`,
  );
rows.push(`UPDATE bars SET inventory_version=inventory_version+1 WHERE id IN (${target});`);
if (args.includes('--write')) {
  mkdirSync('.runtime/cloud', { recursive: true });
  await backup(db, `.runtime/cloud/legacy-${hash.slice(0, 12)}.sqlite`);
  writeFileSync('.runtime/cloud/legacy-import.sql', rows.join('\n') + '\n');
  console.log(
    'Backup and idempotent SQL written to .runtime/cloud. No target database was modified.',
  );
}
console.log(
  JSON.stringify(
    {
      dryRun: !args.includes('--write'),
      bar,
      sourceHash: hash,
      inventory: inventory.length,
      guests: guests.length,
      orders: orders.length,
    },
    null,
    2,
  ),
);
db.close();
