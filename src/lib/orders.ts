import { sb } from './supabase';
import type { Order, OrderLine } from './types';

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
