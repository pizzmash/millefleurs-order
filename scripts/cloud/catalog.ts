import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openDb } from '../../server/db';
import { importCatalog } from '../../server/import';
import { getCatalog, getDrinks } from '../../server/catalog';
export const sqlValue = (v: unknown): string =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
export function catalogSql() {
  const db = openDb(':memory:');
  importCatalog(db);
  const drinks = getDrinks(db),
    cocktails = getCatalog(db),
    kinds = db.prepare('SELECT id,name FROM kinds WHERE alcoholic=1 ORDER BY id').all();
  const version = createHash('sha256')
    .update(JSON.stringify({ drinks, cocktails, kinds }))
    .digest('hex');
  const rows: string[] = [
    `INSERT INTO catalog_versions VALUES(${sqlValue(version)},${sqlValue(new Date().toISOString())}) ON CONFLICT(id) DO NOTHING;`,
  ];
  for (const d of drinks) {
    rows.push(`INSERT INTO drinks VALUES(${d.id}) ON CONFLICT(id) DO NOTHING;`);
    rows.push(
      `INSERT INTO catalog_drinks VALUES(${sqlValue(version)},${d.id},${sqlValue(JSON.stringify(d))}) ON CONFLICT(version,drink_id) DO NOTHING;`,
    );
  }
  for (const c of cocktails)
    rows.push(
      `INSERT INTO catalog_entries VALUES(${sqlValue(version)},${c.id},${sqlValue(JSON.stringify(c))}) ON CONFLICT(version,cocktail_id) DO NOTHING;`,
    );
  for (const k of kinds)
    rows.push(
      `INSERT INTO catalog_kinds VALUES(${sqlValue(version)},${k.id},${sqlValue(k.name)}) ON CONFLICT(version,kind_id) DO NOTHING;`,
    );
  const activate = `INSERT INTO catalog_state VALUES(1,${sqlValue(version)}) ON CONFLICT(id) DO UPDATE SET version=excluded.version;`;
  db.close();
  return {
    version,
    rows,
    activate,
    counts: { drinks: drinks.length, cocktails: cocktails.length },
  };
}
if (process.argv[1]?.endsWith('/catalog.ts')) {
  const data = catalogSql();
  mkdirSync('.runtime/cloud', { recursive: true });
  writeFileSync('.runtime/cloud/catalog.sql', data.rows.join('\n') + '\n');
  writeFileSync('.runtime/cloud/activate-catalog.sql', data.activate + '\n');
  writeFileSync(
    '.runtime/cloud/catalog-manifest.json',
    JSON.stringify({ version: data.version, counts: data.counts }, null, 2),
  );
  console.log('Catalog staged SQL:', data.counts, 'Activate only after import succeeds.');
}
