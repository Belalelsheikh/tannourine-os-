import type { ZeroReason } from './types';

/**
 * One visit's count against the visit before it at the same outlet (Batch B).
 *
 * The markers only inform — nothing here rejects a visit or scores a coordinator. A base is a
 * completed visit not closed by the supervisor (`unclosed`), as in last_visit_for_outlet.
 */

export interface CountLine {
  sku_id: string;
  shelf: number;
  warehouse: number;
  sold_cases: number;
  zero_reason?: ZeroReason | null;
}

/** Shelf + warehouse. */
export const stockOf = (l: CountLine) => l.shelf + l.warehouse;

export interface CompareRow {
  skuId: string;
  before: CountLine | null;
  now: CountLine | null;
  /** Total stock is higher than at the visit before. */
  rose: boolean;
}

/** One row per SKU in catalogue order; a SKU missing on either side shows «—» there. */
export function compareLines(skus: { id: string }[], now: CountLine[], before: CountLine[]): CompareRow[] {
  return skus.map((s) => {
    const n = now.find((l) => l.sku_id === s.id) ?? null;
    const b = before.find((l) => l.sku_id === s.id) ?? null;
    return { skuId: s.id, before: b, now: n, rose: n != null && b != null && stockOf(n) > stockOf(b) };
  });
}

/** SKUs whose total stock went up since the visit before, in catalogue order. */
export function risenSkus(skus: { id: string }[], now: CountLine[], before: CountLine[]): string[] {
  return compareLines(skus, now, before).filter((r) => r.rose).map((r) => r.skuId);
}

/**
 * «نفس أرقام الزيارة اللي فاتت»: every SKU with stock on either visit has the same shelf and
 * warehouse on both. Needs at least one stocked SKU, so two all-zero visits don't match.
 */
export function sameAsBefore(now: CountLine[], before: CountLine[]): boolean {
  if (now.length === 0 || before.length === 0) return false;
  const ids = new Set([...now, ...before].filter((l) => stockOf(l) > 0).map((l) => l.sku_id));
  if (ids.size === 0) return false;
  for (const id of ids) {
    const n = now.find((l) => l.sku_id === id);
    const b = before.find((l) => l.sku_id === id);
    if (!n || !b || n.shelf !== b.shelf || n.warehouse !== b.warehouse) return false;
  }
  return true;
}
