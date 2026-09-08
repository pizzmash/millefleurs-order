import type { Drink } from './types';
export function candidates(drinkId: number, kindId: number | null, drinks: Drink[]) {
  const exact = drinks.find((d) => d.id === drinkId && d.available);
  if (exact) return [{ id: exact.id, name: exact.name }];
  return kindId === null
    ? []
    : drinks
        .filter((d) => d.available && d.kindId === kindId)
        .map((d) => ({ id: d.id, name: d.name }));
}
