import { cairoDateOf } from './cairo.ts';
import { dayDiff } from './visitsHistory.ts';
import type { Coords } from './geo';
import type { Outlet, Profile, RouteRow } from './types';

/** «الفروع» (Batch B1): every branch per coordinator, longest unvisited first. */

/** Row of `outlet_visit_summary()`: completed, not supervisor-closed visits. */
export interface VisitSummaryRow {
  coordinator_id: string;
  outlet_id: number;
  last_checkin_at: string;
  n: number;
}

export interface BranchRow {
  outlet: Outlet;
  /** This coordinator's route weekdays for the outlet; empty when visited off-route. */
  weekdays: number[];
  offRoute: boolean;
  /** Last completed visit at the outlet by anyone. */
  lastAt: string | null;
  lastBy: string | null;
  /** Cairo days since `lastAt`; null = never visited. */
  days: number | null;
}

/** Days past which a branch shows red. */
export const OVERDUE_DAYS = 7;

export const overdue = (r: BranchRow) => r.days == null || r.days > OVERDUE_DAYS;

/** Never-visited first, then the longest since a visit; ties by chain and name. */
export function sortBranches(rows: BranchRow[]): BranchRow[] {
  const rank = (r: BranchRow) => (r.days == null ? Infinity : r.days);
  return [...rows].sort((a, b) =>
    rank(b) - rank(a) || `${a.outlet.chain} ${a.outlet.name}`.localeCompare(`${b.outlet.chain} ${b.outlet.name}`, 'ar'));
}

/** Latest completed visit per outlet across every coordinator. */
export function lastByOutlet(summary: VisitSummaryRow[]): Map<number, VisitSummaryRow> {
  const out = new Map<number, VisitSummaryRow>();
  for (const s of summary) {
    const cur = out.get(s.outlet_id);
    if (!cur || +new Date(s.last_checkin_at) > +new Date(cur.last_checkin_at)) out.set(s.outlet_id, s);
  }
  return out;
}

function row(outlet: Outlet, weekdays: number[], offRoute: boolean, last: VisitSummaryRow | undefined, today: string): BranchRow {
  return {
    outlet, weekdays, offRoute,
    lastAt: last?.last_checkin_at ?? null,
    lastBy: last?.coordinator_id ?? null,
    days: last ? dayDiff(cairoDateOf(last.last_checkin_at), today) : null,
  };
}

/**
 * One coordinator's branches: every outlet on their routes (visited or not), plus outlets they
 * completed a visit at that are on none of their routes today («خارج الخط»). Off-route comes
 * from the current routes, not `visits.off_route`, which is frozen at visit time.
 */
export function coordinatorBranches(
  coordinatorId: string,
  routes: RouteRow[],
  summary: VisitSummaryRow[],
  outletById: (id: number) => Outlet | undefined,
  today: string,
): BranchRow[] {
  const last = lastByOutlet(summary);
  const days = new Map<number, number[]>();
  for (const r of routes) {
    if (r.coordinator_id !== coordinatorId) continue;
    const d = days.get(r.outlet_id) ?? [];
    if (!d.includes(r.weekday)) d.push(r.weekday);
    days.set(r.outlet_id, d);
  }
  const rows: BranchRow[] = [];
  for (const [id, wd] of days) {
    const o = outletById(id);
    if (o) rows.push(row(o, wd, false, last.get(id), today));
  }
  for (const s of summary) {
    if (s.coordinator_id !== coordinatorId || days.has(s.outlet_id)) continue;
    const o = outletById(s.outlet_id);
    if (o) rows.push(row(o, [], true, last.get(s.outlet_id), today));
  }
  return sortBranches(rows);
}

/**
 * «مش على خط حد»: active outlets on nobody's route. `gov` limits it to the viewer's
 * governorate; null (scope الكل) shows the whole estate.
 */
export function unroutedBranches(
  outlets: Outlet[],
  routes: RouteRow[],
  summary: VisitSummaryRow[],
  gov: string | null,
  today: string,
): BranchRow[] {
  const routed = new Set(routes.map((r) => r.outlet_id));
  const last = lastByOutlet(summary);
  return sortBranches(outlets
    .filter((o) => o.active && !routed.has(o.id) && (gov == null || o.gov === gov))
    .map((o) => row(o, [], false, last.get(o.id), today)));
}

/** Search on «السلسلة الفرع», as the visits history does. */
export const matchesBranch = (r: BranchRow, q: string) =>
  !q.trim() || `${r.outlet.chain} ${r.outlet.name}`.includes(q.trim());

/** Coordinate-wise median of check-in points; null under three, like propose_outlet_pins. */
export function medianPoint(points: Coords[]): Coords | null {
  if (points.length < 3) return null;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return { lat: med(points.map((p) => p.lat)), lng: med(points.map((p) => p.lng)) };
}

/** Which coordinators «الفروع» lists for a filter value. */
export type BranchFilter = 'mine' | 'all' | string;
export function filterTeam(f: BranchFilter, mine: Profile[], all: Profile[]): Profile[] {
  if (f === 'mine') return mine;
  if (f === 'all') return all;
  return all.filter((c) => c.id === f);
}
