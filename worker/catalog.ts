import type { D1Database } from '@cloudflare/workers-types';
import type { Cocktail, Drink, Menu } from '../shared/types';
import { candidates } from '../shared/catalog';
export async function catalog(db: D1Database, barId: string) {
  const state = await db
    .prepare('SELECT version FROM catalog_state WHERE id=1')
    .first<{ version: string }>();
  if (!state) throw new Error('Catalog has not been deployed');
  const version = state.version;
  const [ds, cs, ks] = await db.batch([
    db
      .prepare(
        'SELECT d.payload, COALESCE(i.available,0) AS available FROM catalog_drinks d LEFT JOIN inventory i ON i.drink_id=d.drink_id AND i.bar_id=? WHERE d.version=? ORDER BY d.drink_id',
      )
      .bind(barId, version),
    db
      .prepare('SELECT payload FROM catalog_entries WHERE version=? ORDER BY cocktail_id')
      .bind(version),
    db
      .prepare('SELECT kind_id AS id,name FROM catalog_kinds WHERE version=? ORDER BY kind_id')
      .bind(version),
  ]);
  const drinks = (ds.results as { payload: string; available: number }[]).map((row) => {
    const d = JSON.parse(row.payload) as Drink;
    return { ...d, available: d.staple || !!row.available };
  });
  const cocktails = (cs.results as { payload: string }[]).map((row) => {
    const c = JSON.parse(row.payload) as Cocktail;
    const ingredients = c.ingredients.map((i) => {
      const options = candidates(i.drinkId, i.kindId, drinks);
      return {
        ...i,
        candidates: options,
        substitute: !!options.length && options[0].id !== i.drinkId,
      };
    });
    return {
      ...c,
      ingredients,
      available: ingredients.length > 0 && ingredients.every((i) => i.candidates.length),
      substitution: ingredients.some((i) => i.substitute),
    };
  });
  return {
    drinks,
    cocktails,
    kinds: ks.results as { id: number; name: string }[],
    catalogVersion: version,
  };
}
export function menu(data: Awaited<ReturnType<typeof catalog>>, q: URLSearchParams): Menu {
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
