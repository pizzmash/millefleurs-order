import type { Drink } from './types.ts';

export const purchaseGroup = (drinkId: number, kindId: number | null) =>
  kindId === null ? `d${drinkId}` : `k${kindId}`;

export const inventorySignature = (drinks: Drink[]) =>
  JSON.stringify(drinks.map((drink) => [drink.id, drink.kindId, drink.available]));
