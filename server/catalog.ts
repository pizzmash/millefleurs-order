import type { DatabaseSync } from 'node:sqlite';
import type { Cocktail, Drink, Ingredient, Menu } from '../shared/types.ts';
export const STAPLES = new Set([67, 90]);
export const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja');
export function getDrinks(db: DatabaseSync): Drink[] {
  return (
    db
      .prepare(
        "SELECT d.id,d.name,d.kind_id AS kindId,COALESCE(k.name,'未分類') AS kindName,COALESCE(i.available,0) AS available FROM drinks d LEFT JOIN kinds k ON k.id=d.kind_id LEFT JOIN inventory i ON i.drink_id=d.id ORDER BY d.id",
      )
      .all() as unknown as Drink[]
  ).map((d) => ({
    ...d,
    available: !!d.available || STAPLES.has(d.id),
    staple: STAPLES.has(d.id),
  }));
}
export function candidates(drinkId: number, kindId: number | null, drinks: Drink[]) {
  const exact = drinks.find((d) => d.id === drinkId && d.available);
  if (exact) return [{ id: exact.id, name: exact.name }];
  return kindId === null
    ? []
    : drinks
        .filter((d) => d.available && d.kindId === kindId)
        .map((d) => ({ id: d.id, name: d.name }));
}
export function getCatalog(db: DatabaseSync): Cocktail[] {
  const drinks = getDrinks(db);
  const rows = db
    .prepare(
      'SELECT r.id,r.cocktail_id AS cocktailId,r.drink_id AS drinkId,d.name,d.kind_id AS kindId,r.quantity FROM recipes r JOIN drinks d ON d.id=r.drink_id ORDER BY r.id',
    )
    .all() as unknown as (Ingredient & { cocktailId: number })[];
  const recipes = new Map<number, Ingredient[]>();
  for (const row of rows) {
    const options = candidates(row.drinkId, row.kindId, drinks);
    const ingredient = {
      id: row.id,
      drinkId: row.drinkId,
      name: row.name,
      kindId: row.kindId,
      quantity: row.quantity,
      candidates: options,
      substitute: !!options.length && options[0].id !== row.drinkId,
    };
    recipes.set(row.cocktailId, [...(recipes.get(row.cocktailId) || []), ingredient]);
  }
  const list = db
    .prepare(
      "SELECT c.id,c.name,c.description,c.alcohol,c.alcohol_low AS alcoholLow,c.alcohol_high AS alcoholHigh,c.image,COALESCE(g.name,'未登録') AS glass,COALESCE(t.name,'未登録') AS technique FROM cocktails c LEFT JOIN glasses g ON g.id=c.glass_id LEFT JOIN techniques t ON t.id=c.technique_id ORDER BY c.id",
    )
    .all() as unknown as Cocktail[];
  return list.map((c) => {
    const ingredients = recipes.get(c.id) || [];
    return {
      ...c,
      ingredients,
      available: ingredients.length > 0 && ingredients.every((i) => i.candidates.length > 0),
      substitution: ingredients.some((i) => i.substitute),
    };
  });
}
export function getMenu(db: DatabaseSync, query: URLSearchParams): Menu {
  const available = getCatalog(db).filter((c) => c.available);
  const keyword = normalize((query.get('q') || '').trim());
  const kind = query.get('kind');
  const min = query.get('min') ? Number(query.get('min')) : null;
  const max = query.get('max') ? Number(query.get('max')) : null;
  const items = available.filter((c) => {
    const haystack = normalize(
      [c.name, ...c.ingredients.flatMap((i) => [i.name, ...i.candidates.map((d) => d.name)])].join(
        ' ',
      ),
    );
    return (
      (!keyword || haystack.includes(keyword)) &&
      (!kind || c.ingredients.some((i) => i.kindId === Number(kind))) &&
      (min === null || (c.alcoholLow !== null && c.alcoholLow >= min)) &&
      (max === null || (c.alcoholHigh !== null && c.alcoholHigh <= max))
    );
  });
  const pages = Math.max(1, Math.ceil(items.length / 24));
  const page = Math.min(pages, Math.max(1, Number(query.get('page')) || 1));
  const kinds = db.prepare('SELECT id,name FROM kinds WHERE alcoholic=1 ORDER BY id').all() as {
    id: number;
    name: string;
  }[];
  return {
    items: items.slice((page - 1) * 24, page * 24),
    total: items.length,
    availableTotal: available.length,
    page,
    pages,
    kinds,
  };
}
