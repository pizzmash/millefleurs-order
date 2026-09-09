import type { D1Database } from '@cloudflare/workers-types';
import type { Cocktail, Drink, Menu } from '../shared/types';
import { byPopularity } from './popularity';
import { resolveCocktail } from '../shared/catalog';
type CatalogSnapshot = {
  version: string;
  drinks?: Drink[];
  individual?: Map<number, Cocktail>;
  recipes?: { cocktails: Cocktail[]; kinds: { id: number; name: string }[] };
};
// Catalog versions are content hashes and are immutable after publication.
// Keep only one version per binding; never cache inventory or in-flight D1 I/O.
const snapshots = new WeakMap<D1Database, CatalogSnapshot>();

async function snapshot(db: D1Database) {
  const state = await db
    .prepare('SELECT version FROM catalog_state WHERE id=1')
    .first<{ version: string }>();
  if (!state) throw new Error('Catalog has not been deployed');
  let cached = snapshots.get(db);
  if (!cached || cached.version !== state.version) {
    cached = { version: state.version };
    snapshots.set(db, cached);
  }
  return cached;
}

async function drinksForBar(db: D1Database, barId: string, data: CatalogSnapshot) {
  if (!data.drinks) {
    const rows = await db
      .prepare('SELECT payload FROM catalog_drinks WHERE version=? ORDER BY drink_id')
      .bind(data.version)
      .all<{ payload: string }>();
    data.drinks = rows.results.map((row) => JSON.parse(row.payload) as Drink);
  }
  const inventory = await db
    .prepare('SELECT drink_id, available FROM inventory WHERE bar_id=?')
    .bind(barId)
    .all<{ drink_id: number; available: number }>();
  const available = new Set(
    inventory.results.filter((row) => row.available).map((row) => row.drink_id),
  );
  return data.drinks.map((d) => ({ ...d, available: d.staple || available.has(d.id) }));
}

export async function catalogDrinks(db: D1Database, barId: string) {
  const data = await snapshot(db);
  return { drinks: await drinksForBar(db, barId, data), catalogVersion: data.version };
}

async function recipes(db: D1Database, data: CatalogSnapshot) {
  if (data.recipes) return data.recipes;
  const [cs, ks] = await db.batch([
    db
      .prepare('SELECT payload FROM catalog_entries WHERE version=? ORDER BY cocktail_id')
      .bind(data.version),
    db
      .prepare('SELECT kind_id AS id,name FROM catalog_kinds WHERE version=? ORDER BY kind_id')
      .bind(data.version),
  ]);
  data.recipes = {
    cocktails: (cs.results as { payload: string }[]).map(
      (row) => JSON.parse(row.payload) as Cocktail,
    ),
    kinds: ks.results as { id: number; name: string }[],
  };
  return data.recipes;
}

export async function catalogSource(db: D1Database, barId: string) {
  const data = await snapshot(db);
  const [drinks, source] = await Promise.all([drinksForBar(db, barId, data), recipes(db, data)]);
  return {
    drinks,
    cocktails: structuredClone(source.cocktails),
    kinds: source.kinds.map((kind) => ({ ...kind })),
    catalogVersion: data.version,
  };
}

export async function catalog(db: D1Database, barId: string) {
  const data = await snapshot(db);
  const [drinks, source] = await Promise.all([drinksForBar(db, barId, data), recipes(db, data)]);
  return {
    drinks,
    cocktails: source.cocktails.map((c) => resolveCocktail(c, drinks)),
    kinds: source.kinds.map((kind) => ({ ...kind })),
    catalogVersion: data.version,
  };
}

async function recipe(db: D1Database, data: CatalogSnapshot, id: number) {
  if (data.recipes) return data.recipes.cocktails.find((c) => c.id === id);
  const cached = data.individual?.get(id);
  if (cached) return cached;
  const row = await db
    .prepare('SELECT payload FROM catalog_entries WHERE version=? AND cocktail_id=?')
    .bind(data.version, id)
    .first<{ payload: string }>();
  if (!row) return undefined;
  const cocktail = JSON.parse(row.payload) as Cocktail;
  const individual = (data.individual ??= new Map());
  // Bound point-lookup storage until the full catalog is requested.
  if (individual.size >= 64) individual.delete(individual.keys().next().value!);
  individual.set(id, cocktail);
  return cocktail;
}

export async function catalogCocktail(db: D1Database, barId: string, id: number) {
  const data = await snapshot(db);
  const [drinks, source] = await Promise.all([drinksForBar(db, barId, data), recipe(db, data, id)]);
  return {
    drinks,
    cocktail: source ? resolveCocktail(source, drinks) : undefined,
    catalogVersion: data.version,
  };
}
export function menu(
  data: Awaited<ReturnType<typeof catalog>>,
  q: URLSearchParams,
  counts: Map<number, number> = new Map(),
): Menu {
  const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase('ja');
  const available = data.cocktails.filter((c) => c.available);
  const keyword = norm((q.get('q') || '').trim());
  const items = available.filter(
    (c) =>
      (!keyword ||
        norm(
          [
            c.name,
            ...c.ingredients.flatMap((i) => [i.name, ...i.candidates.map((d) => d.name)]),
          ].join(' '),
        ).includes(keyword)) &&
      (!q.get('kind') || c.ingredients.some((i) => i.kindId === Number(q.get('kind')))) &&
      (!q.get('min') || (c.alcoholLow !== null && c.alcoholLow >= Number(q.get('min')))) &&
      (!q.get('max') || (c.alcoholHigh !== null && c.alcoholHigh <= Number(q.get('max')))),
  );
  items.sort((a, b) =>
    byPopularity(
      { ...a, orderCount: counts.get(a.id) ?? 0 },
      { ...b, orderCount: counts.get(b.id) ?? 0 },
    ),
  );
  const pages = Math.max(1, Math.ceil(items.length / 24));
  const page = Math.min(pages, Math.max(1, Number(q.get('page')) || 1));
  return {
    items: items.slice((page - 1) * 24, page * 24),
    total: items.length,
    availableTotal: available.length,
    page,
    pages,
    kinds: data.kinds,
  };
}
