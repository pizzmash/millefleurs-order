export type Drink = {
  id: number;
  name: string;
  kindId: number | null;
  kindName: string;
  available: boolean;
  staple: boolean;
};
export type Ingredient = {
  id: number;
  drinkId: number;
  name: string;
  kindId: number | null;
  quantity: string;
  candidates: { id: number; name: string }[];
  substitute: boolean;
};
export type Cocktail = {
  id: number;
  name: string;
  description: string;
  alcohol: string;
  alcoholLow: number | null;
  alcoholHigh: number | null;
  image: string;
  glass: string;
  technique: string;
  ingredients: Ingredient[];
  available: boolean;
  substitution: boolean;
};
export type OrderIngredient = {
  recipeId: number;
  drinkId: number;
  name: string;
  kindId: number | null;
  quantity: string;
  selectedId: number | null;
  selectedName: string | null;
};
export type Order = {
  id: string;
  nickname: string;
  cocktailId: number;
  cocktailName: string;
  image: string;
  technique: string;
  glass: string;
  status: 'pending' | 'completed';
  createdAt: string;
  completedAt: string | null;
  ingredients: (OrderIngredient & {
    candidates: { id: number; name: string }[];
    missing: boolean;
  })[];
};
export type Menu = {
  items: Cocktail[];
  total: number;
  availableTotal: number;
  page: number;
  pages: number;
  kinds: { id: number; name: string }[];
};
export type Guest = { id: string; nickname: string };

export type PurchaseRecommendation = {
  limit: number;
  inventorySignature: string;
  currentCount: number;
  addedCount: number;
  totalCount: number;
  purchases: {
    key: string;
    name: string;
    options: { id: number; name: string }[];
  }[];
  cocktails: {
    id: number;
    name: string;
    ingredients: { name: string; quantity: string }[];
  }[];
};
