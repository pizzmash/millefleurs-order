import { recommendPurchases } from '../shared/purchase-recommendations';
import type { Cocktail, Drink } from '../shared/types';
self.onmessage = async (
  event: MessageEvent<{ drinks: Drink[]; cocktails: Cocktail[]; limit: number }>,
) => {
  try {
    self.postMessage({
      result: await recommendPurchases(event.data.drinks, event.data.cocktails, event.data.limit),
    });
  } catch {
    self.postMessage({
      error: '時間内に最適な組み合わせを確定できませんでした。購入種類数を減らしてお試しください。',
    });
  }
};
