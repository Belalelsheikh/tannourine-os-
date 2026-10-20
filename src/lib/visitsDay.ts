import type { Profile, RouteRow, Visit, VisitLine } from './types';

export interface DaySection {
  coord: Profile;
  /** The coordinator's visits that day, by check-in. */
  visits: Visit[];
  /** Route outlets for the weekday, in planned order (seq; nulls last). */
  planned: number[];
  /** Planned outlets with at least one visit (an open visit counts — it is under way). */
  done: number;
  offRoute: number;
  /** Planned outlets nobody has visited yet, in planned order. */
  notVisited: number[];
  firstIn: string | null;
  lastOut: string | null;
}

/**
 * One section per coordinator for a single day. A coordinator appears when they had a route
 * that weekday or logged a visit; deactivated coordinators appear only for visits, since their
 * old route rows describe nobody's plan. `chip` is 'الكل' or a coordinator id.
 */
export function daySections(
  coordinators: Profile[],
  visits: Visit[],
  routes: RouteRow[],
  chip: string,
): DaySection[] {
  const out: DaySection[] = [];
  for (const coord of coordinators) {
    if (chip !== 'الكل' && coord.id !== chip) continue;

    const mine = visits
      .filter((v) => v.coordinator_id === coord.id)
      .sort((a, b) => +new Date(a.checkin_at) - +new Date(b.checkin_at));
    const planned = coord.active
      ? routes
        .filter((r) => r.coordinator_id === coord.id)
        .sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.outlet_id - b.outlet_id)
        .map((r) => r.outlet_id)
      : [];
    if (mine.length === 0 && planned.length === 0) continue;

    const seen = new Set(mine.map((v) => v.outlet_id));
    const outs = mine.map((v) => v.checkout_at).filter((t): t is string => t != null);
    out.push({
      coord,
      visits: mine,
      planned,
      done: planned.filter((id) => seen.has(id)).length,
      offRoute: mine.filter((v) => v.off_route).length,
      notVisited: planned.filter((id) => !seen.has(id)),
      firstIn: mine[0]?.checkin_at ?? null,
      lastOut: outs.length ? outs.reduce((a, b) => (+new Date(b) > +new Date(a) ? b : a)) : null,
    });
  }
  return out;
}

export interface ZeroSummary {
  total: number;
  /** [reason, count], most first; ties keep first-seen order. */
  byReason: [string, number][];
  /** [sku_id, count], most first. */
  bySku: [string, number][];
}

/** Zero-shelf lines among `visitIds` — the "sales or supply problem?" view. */
export function zeroSummary(lines: VisitLine[], visitIds: Set<string>): ZeroSummary {
  const reasons = new Map<string, number>();
  const skus = new Map<string, number>();
  let total = 0;
  for (const l of lines) {
    if (l.shelf !== 0 || !visitIds.has(l.visit_id)) continue;
    total += 1;
    const r = l.zero_reason ?? '—';
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
    skus.set(l.sku_id, (skus.get(l.sku_id) ?? 0) + 1);
  }
  const ranked = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { total, byReason: ranked(reasons), bySku: ranked(skus) };
}
