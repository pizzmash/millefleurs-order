import type { Cocktail, Drink } from './types';
export function candidates(drinkId: number, kindId: number | null, drinks: Drink[]) {
  const exact = drinks.find((d) => d.id === drinkId && d.available);
  if (exact) return [{ id: exact.id, name: exact.name }];
  return kindId === null
    ? []
    : drinks
        .filter((d) => d.available && d.kindId === kindId)
        .map((d) => ({ id: d.id, name: d.name }));
}

// Resolve only the requested recipe, using the same rules on the server and browser.
export function resolveCocktail(c: Cocktail, drinks: Drink[]): Cocktail {
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
    available: ingredients.length > 0 && ingredients.every((i) => i.candidates.length > 0),
    substitution: ingredients.some((i) => i.substitute),
  };
}
