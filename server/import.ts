import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.ts';
// These IDs in the supplied master describe spirits, liqueurs, bitters, wine and beer.
const ALCOHOLIC_KINDS = new Set(Array.from({ length: 58 }, (_, id) => id));
type Row = Record<string, string>;
const id = (value: string): number => { if (!/^\d+$/.test(value)) throw new Error(`Invalid id: ${value}`); return Number(value); };
export function normalizeAlcohol(value: string): [number | null, number | null] {
  const text = value.normalize('NFKC');
  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) { const n = Number(percent[1]); return n <= 100 ? [n, n] : [null, null]; }
  if (text.includes('8度以下')) return [0, 8];
  if (text.includes('9度') && text.includes('24度')) return [9, 24];
  if (text.includes('25度以上')) return [25, 100];
  return [null, null];
}
export function importCatalog(db: DatabaseSync, directory = 'data/raw') {
  const tables = ['drink_kind', 'technique', 'glass', 'drink', 'cocktail', 'cocktail_drink'] as const;
  const data = Object.fromEntries(tables.map(name => {
    const rows = parse(readFileSync(join(directory, `${name}.csv`)), { columns: true, bom: true, skip_empty_lines: true }) as Row[];
    if (!rows.length) throw new Error(`Empty CSV: ${name}`);
    const ids = rows.map(r => id(r.id));
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate IDs: ${name}`);
    return [name, rows];
  })) as Record<typeof tables[number], Row[]>;
  const refs = (rows: Row[]) => new Set(rows.map(r => r.id));
  const kinds = refs(data.drink_kind), drinks = refs(data.drink), cocktails = refs(data.cocktail), glasses = refs(data.glass), techniques = refs(data.technique);
  for (const d of data.drink) if (d.kind_id.trim() && !kinds.has(d.kind_id)) throw new Error(`Unknown kind: drink ${d.id}`);
  for (const c of data.cocktail) if ((c.glass_id && !glasses.has(c.glass_id)) || (c.technique_id && !techniques.has(c.technique_id))) throw new Error(`Unknown glass/technique: cocktail ${c.id}`);
  for (const r of data.cocktail_drink) if (!drinks.has(r.drink_id) || !cocktails.has(r.cocktail_id)) throw new Error(`Broken recipe ${r.id}`);
  const withRecipe = new Set(data.cocktail_drink.map(r => r.cocktail_id));
  const warnings = data.cocktail.filter(c => !withRecipe.has(c.id)).map(c => `No recipe: ${c.id} ${c.name}`);
  transaction(db, () => {
    const k = db.prepare('INSERT INTO kinds VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, alcoholic=excluded.alcoholic');
    for (const r of data.drink_kind) k.run(id(r.id), r.name, +ALCOHOLIC_KINDS.has(id(r.id)));
    for (const [source, target] of [['technique', 'techniques'], ['glass', 'glasses']] as const) {
      const st = db.prepare(`INSERT INTO ${target} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`);
      for (const r of data[source]) st.run(id(r.id), r.name);
    }
    const d = db.prepare('INSERT INTO drinks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind_id=excluded.kind_id');
    for (const r of data.drink) d.run(id(r.id), r.name, r.kind_id.trim() ? id(r.kind_id) : null);
    const c = db.prepare('INSERT INTO cocktails VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,alcohol=excluded.alcohol,alcohol_low=excluded.alcohol_low,alcohol_high=excluded.alcohol_high,image=excluded.image,glass_id=excluded.glass_id,technique_id=excluded.technique_id');
    for (const r of data.cocktail) c.run(id(r.id), r.name, r.description, r.alcohol, ...normalizeAlcohol(r.alcohol), r.image, r.glass_id ? id(r.glass_id) : null, r.technique_id ? id(r.technique_id) : null);
    db.exec('DELETE FROM recipes');
    const recipe = db.prepare('INSERT INTO recipes VALUES(?,?,?,?)');
    for (const r of data.cocktail_drink) recipe.run(id(r.id), id(r.cocktail_id), id(r.drink_id), r.quantity);
    // Remove obsolete catalog records without deleting user inventory or order snapshots.
    const stale = db.prepare('SELECT id FROM cocktails').all() as { id: number }[];
    const remove = db.prepare('DELETE FROM cocktails WHERE id=?');
    for (const r of stale) if (!cocktails.has(String(r.id))) remove.run(r.id);
  });
  db.exec('PRAGMA optimize');
  return { counts: Object.fromEntries(tables.map(t => [t, data[t].length])), warnings };
}
