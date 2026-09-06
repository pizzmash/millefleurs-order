import type { Cocktail, Drink, PurchaseRecommendation } from '../shared/types.ts';
import { inventorySignature, purchaseGroup } from '../shared/inventory.ts';
import { solvePurchases, type PurchaseRequirement } from './purchase-search.ts';

export async function recommendPurchases(
  drinks: Drink[],
  catalog: Cocktail[],
  limit: number,
  timeoutMs?: number,
): Promise<PurchaseRecommendation> {
  const satisfied = new Set(
    drinks.filter((drink) => drink.available).map((drink) => purchaseGroup(drink.id, drink.kindId)),
  );
  const groups = new Map<string, PurchaseRecommendation['purchases'][number]>();
  for (const drink of drinks) {
    const key = purchaseGroup(drink.id, drink.kindId);
    if (satisfied.has(key)) continue;
    const group = groups.get(key) || {
      key,
      name: drink.kindId === null ? drink.name : drink.kindName,
      options: [],
    };
    group.options.push({ id: drink.id, name: drink.name });
    groups.set(key, group);
  }
  const missingByCocktail = catalog
    .filter((cocktail) => !cocktail.available && cocktail.ingredients.length > 0)
    .map((cocktail) => ({
      cocktail,
      missing: [...new Set(cocktail.ingredients.map((i) => purchaseGroup(i.drinkId, i.kindId)))]
        .filter((key) => !satisfied.has(key))
        .sort(),
    }))
    .filter((row) => row.missing.length > 0 && row.missing.length <= limit);
  const requirements = new Map<string, PurchaseRequirement>();
  for (const { missing } of missingByCocktail) {
    const key = JSON.stringify(missing);
    const edge = requirements.get(key);
    if (edge) edge.weight++;
    else requirements.set(key, { missing, weight: 1 });
  }
  const solution = await solvePurchases([...requirements.values()], limit, timeoutMs);
  const selected = new Set(solution.keys);
  const cocktails = missingByCocktail
    .filter((row) => row.missing.every((key) => selected.has(key)))
    .map(({ cocktail }) => ({
      id: cocktail.id,
      name: cocktail.name,
      ingredients: cocktail.ingredients.map(({ name, quantity }) => ({ name, quantity })),
    }));
  const currentCount = catalog.filter((cocktail) => cocktail.available).length;
  return {
    limit,
    inventorySignature: inventorySignature(drinks),
    currentCount,
    addedCount: cocktails.length,
    totalCount: currentCount + cocktails.length,
    purchases: [...solution.keys].sort().map((key) => groups.get(key)!),
    cocktails,
  };
}
