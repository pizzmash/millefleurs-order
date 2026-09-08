import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { calculatePurchases } from './purchases';
import { inventorySignature } from '../shared/inventory';
import type { Drink, PurchaseRecommendation } from '../shared/types';

export function PurchaseSuggestions({
  drinks,
  updating,
  catalogVersion,
}: {
  drinks: Drink[] | undefined;
  updating: boolean;
  catalogVersion?: string;
}) {
  const [limit, setLimit] = useState(5);
  const [result, setResult] = useState<PurchaseRecommendation | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    request.current?.abort();
    setCalculating(false);
    setResult(null);
  }, [catalogVersion]);
  const signature = drinks ? inventorySignature(drinks) : null;
  const stale = !!result && result.inventorySignature !== signature;
  useEffect(() => {
    request.current?.abort();
    setCalculating(false);
  }, [signature, updating]);

  async function calculate() {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setCalculating(true);
    setResult(null);
    setError('');
    try {
      const next = await calculatePurchases(limit, controller.signal);
      if (!controller.signal.aborted) setResult(next);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setCalculating(false);
    }
  }

  return (
    <details className="purchase-panel">
      <summary>
        <Sparkles size={20} aria-hidden="true" />
        <span>買い足しで増やす</span>
      </summary>
      <div className="purchase-body">
        <p className="purchase-intro">
          いくつ買い足すと、何が作れる？ 今ある材料から、最もカクテルが増える組み合わせを探します。
        </p>
        <div className="purchase-controls">
          <label htmlFor="purchase-limit">
            買い足す種類数の上限
            <select
              id="purchase-limit"
              value={limit}
              disabled={calculating}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setResult(null);
                setError('');
              }}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((count) => (
                <option key={count} value={count}>
                  {count}種類まで
                </option>
              ))}
            </select>
          </label>
          <button disabled={calculating || updating || !drinks} onClick={calculate}>
            {calculating ? '計算中…' : 'おすすめを計算'}
          </button>
        </div>
        <p className="purchase-note">
          同じ種類で代用できる材料は1種類として数えます。水・氷は常備品です。
        </p>
        <div role="status" aria-live="polite">
          {calculating && (
            <p className="purchase-wait">組み合わせを調べています。最大20秒ほどかかります。</p>
          )}
          {stale && !calculating && (
            <p className="purchase-wait">在庫が変わりました。もう一度計算してください。</p>
          )}
        </div>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {result && !stale && !updating && (
          <section className="purchase-result" aria-label="購入提案の結果">
            <p className="purchase-gain">
              <strong>＋{result.addedCount}</strong>種類のカクテル
            </p>
            <p className="purchase-count">
              現在 {result.currentCount} → 購入後 {result.totalCount}種類
            </p>
            {result.addedCount === 0 ? (
              <p>
                {result.limit}種類までの買い足しでは、新たに作れるカクテルはありません。
                {result.limit < 10 && '上限を増やして試せます。'}
              </p>
            ) : (
              <>
                <h2>おすすめの買い足し · {result.purchases.length}種類</h2>
                <ul className="purchase-list">
                  {result.purchases.map((purchase) => (
                    <li key={purchase.key}>
                      <strong>{purchase.name}</strong>
                      <span>
                        {purchase.options.length > 1 && 'この中から1つ：'}
                        {purchase.options.map((option) => option.name).join(' ／ ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="purchase-note">
                  このセット全体で増える数です。同種代用を含みます。購入後は在庫を「ある」に変更してください。
                </p>
                <details className="purchase-cocktails">
                  <summary>新たに作れるカクテルを見る（{result.addedCount}種類）</summary>
                  <p className="purchase-note">
                    材料・分量は原レシピです。同じ種類の購入材料や在庫で代用できます。
                  </p>
                  <ul>
                    {result.cocktails.map((cocktail) => (
                      <li key={cocktail.id}>
                        <details>
                          <summary>{cocktail.name}</summary>
                          <ul className="purchase-recipe">
                            {cocktail.ingredients.map((ingredient, index) => (
                              <li key={index}>
                                <span>{ingredient.name}</span>
                                <span>{ingredient.quantity}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </section>
        )}
      </div>
    </details>
  );
}
