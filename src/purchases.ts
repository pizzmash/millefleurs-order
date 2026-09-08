import { api } from './api';
import type { Cocktail, Drink, PurchaseRecommendation } from '../shared/types';
type Versions = { inventoryVersion: number; catalogVersion: string };
export async function calculatePurchases(
  limit: number,
  signal: AbortSignal,
): Promise<PurchaseRecommendation> {
  const input = await api<Versions & { drinks: Drink[]; cocktails: Cocktail[] }>(
    '/api/host/purchase-input',
    { signal },
  );
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const result = await new Promise<PurchaseRecommendation>((resolve, reject) => {
    const worker = new Worker(new URL('./purchase.worker.ts', import.meta.url), { type: 'module' });
    const finish = (value?: PurchaseRecommendation, error?: Error) => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(undefined, new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          new Error('時間内に計算できませんでした。購入種類数を減らしてください。'),
        ),
      20000,
    );
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (e) =>
      e.data.error ? finish(undefined, new Error(e.data.error)) : finish(e.data.result);
    worker.onerror = () =>
      finish(undefined, new Error('計算できませんでした。もう一度お試しください。'));
    worker.postMessage({ ...input, limit });
  });
  const latest = await api<Versions>('/api/host/versions', { signal });
  if (
    latest.inventoryVersion !== input.inventoryVersion ||
    latest.catalogVersion !== input.catalogVersion
  )
    throw new Error('在庫またはレシピが変わりました。再計算してください。');
  return result;
}
