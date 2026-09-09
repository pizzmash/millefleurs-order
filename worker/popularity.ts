import type { D1Database } from '@cloudflare/workers-types';
import type { CocktailOrderCount } from '../shared/types';

export async function orderCounts(db: D1Database, barId: string) {
  const rows = await db
    .prepare(
      'SELECT cocktail_id AS id,cocktail_name AS name,order_count AS orderCount FROM cocktail_order_counts WHERE bar_id=?',
    )
    .bind(barId)
    .all<CocktailOrderCount>();
  return rows.results;
}

export function byPopularity(a: CocktailOrderCount, b: CocktailOrderCount) {
  return b.orderCount - a.orderCount || a.name.localeCompare(b.name, 'ja') || a.id - b.id;
}
