import { sb } from './supabase';
import type { Order, OrderLine, Profile } from './types';

export interface OrderWithLines extends Order {
  lines: OrderLine[];
}

/** Orders plus their lines in two round-trips — used by the router board and the invoice queue. */
export async function fetchOrdersWithLines(statuses: Order['status'][]): Promise<OrderWithLines[]> {
  const { data, error } = await sb.from('orders').select('*')
    .in('status', statuses)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const orders = (data ?? []) as Order[];
  if (orders.length === 0) return [];

  const lineRes = await sb.from('order_lines').select('*').in('order_id', orders.map((o) => o.id));
  if (lineRes.error) throw lineRes.error;
  const lines = (lineRes.data ?? []) as OrderLine[];

  return orders.map((o) => ({ ...o, lines: lines.filter((l) => l.order_id === o.id) }));
}

export const linesToMap = (lines: OrderLine[]): Record<string, number> =>
  Object.fromEntries(lines.map((l) => [l.sku_id, l.cases]));

/**
 * Coordinators whose pending orders this viewer may leader-approve. Mirrors `orders_upd`
 * exactly — assigned coordinators, or everyone at scope الكل — with no governorate
 * fallback, so the queue never shows a card the database will refuse.
 */
export function leaderApprovableIds(viewer: Profile | null, all: Profile[]): string[] {
  if (!viewer) return [];
  const coordinators = all.filter((p) => p.role === 'coordinator');
  if (viewer.role === 'mgmt' || viewer.scope === 'الكل') return coordinators.map((c) => c.id);
  return coordinators.filter((c) => c.supervisor_id === viewer.id).map((c) => c.id);
}

/**
 * Rewrite an order's lines to `next`: update changed, insert new, delete zeroed.
 * Returns the before/after maps for the audit row.
 */
export async function saveOrderLines(order: OrderWithLines, next: Record<string, number>) {
  const before = linesToMap(order.lines);
  const after = Object.fromEntries(Object.entries(next).filter(([, c]) => c > 0));
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const sku_id of ids) {
    const was = before[sku_id] ?? 0;
    const now = after[sku_id] ?? 0;
    if (was === now) continue;
    const q = sb.from('order_lines');
    const res = now === 0
      ? await q.delete().eq('order_id', order.id).eq('sku_id', sku_id)
      : was === 0
        ? await q.insert({ order_id: order.id, sku_id, cases: now })
        : await q.update({ cases: now }).eq('order_id', order.id).eq('sku_id', sku_id);
    if (res.error) throw res.error;
  }
  return { before, after };
}
