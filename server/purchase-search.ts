import { setImmediate } from 'node:timers/promises';

export type PurchaseRequirement = { missing: string[]; weight: number };
export type PurchaseSolution = { keys: string[]; gain: number; nodes: number };
export class PurchaseTimeout extends Error {}

// Each completed requirement contributes its full weight to the credits of its
// selected keys. Incomplete requirements only add nonnegative credit. Therefore
// the top k credits bound the gain achievable with k remaining purchases.
export function* searchPurchaseSets(
  requirements: PurchaseRequirement[],
  limit: number,
): Generator<void, PurchaseSolution> {
  let best: PurchaseSolution = { keys: [], gain: 0, nodes: 0 };
  let nodes = 0;
  function* visit(
    edges: PurchaseRequirement[],
    slots: number,
    gain: number,
    chosen: string[],
  ): Generator<void> {
    if (++nodes % 128 === 0) yield;
    if (gain > best.gain || (gain === best.gain && chosen.length < best.keys.length))
      best = { keys: chosen, gain, nodes };
    if (!slots || !edges.length) return;
    const credits = new Map<string, number>();
    for (const edge of edges) {
      if (edge.missing.length > slots) continue;
      for (const key of edge.missing)
        credits.set(key, (credits.get(key) || 0) + edge.weight / edge.missing.length);
    }
    const ordered = [...credits].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    const upper = gain + ordered.slice(0, slots).reduce((sum, item) => sum + item[1], 0);
    // Allow for floating-point roundoff. If only a tie is possible, prune only
    // when even ONE more purchase cannot improve the purchase-count tie-break.
    if (
      upper + 1e-7 < best.gain ||
      (upper + 1e-7 < best.gain + 1 && chosen.length + 1 >= best.keys.length)
    )
      return;
    if (!ordered.length) return;
    const key = ordered[0][0];
    const included: PurchaseRequirement[] = [];
    let added = 0;
    for (const edge of edges) {
      const missing = edge.missing.filter((item) => item !== key);
      if (!missing.length) added += edge.weight;
      else if (missing.length <= slots - 1) included.push({ missing, weight: edge.weight });
    }
    yield* visit(included, slots - 1, gain + added, [...chosen, key]);
    yield* visit(
      edges.filter((edge) => !edge.missing.includes(key)),
      slots,
      gain,
      chosen,
    );
  }
  yield* visit(requirements, limit, 0, []);
  return { ...best, nodes };
}

export async function solvePurchases(
  requirements: PurchaseRequirement[],
  limit: number,
  timeoutMs = 20_000,
): Promise<PurchaseSolution> {
  const started = performance.now();
  const search = searchPurchaseSets(requirements, limit);
  try {
    while (true) {
      if (performance.now() - started >= timeoutMs) throw new PurchaseTimeout();
      const step = search.next();
      if (performance.now() - started >= timeoutMs) throw new PurchaseTimeout();
      if (step.done) return step.value;
      await setImmediate();
    }
  } finally {
    search.return({ keys: [], gain: 0, nodes: 0 });
  }
}
