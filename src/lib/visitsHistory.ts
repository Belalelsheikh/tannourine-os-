import { addDays, cairoDateOf, cairoDayRange } from './cairo.ts';
import type { Outlet, Profile, Visit, VisitLine, VisitStatus } from './types';

/** A visit with its SKU lines embedded (`select('*, visit_lines(*)')`). */
export type VisitWithLines = Visit & { visit_lines: VisitLine[] };

/**
 * Whose visits a supervisor sees in the history.
 *
 * Deliberately not `coordinatorsInScope()`: there, assigned coordinators win (PRD §5.8), which
 * routes approvals. Follow-up covers the whole team in the supervisor's area, so history goes
 * by scope alone: 'الكل' sees everyone, otherwise coordinators whose scope matches. Inactive
 * coordinators are included because their old visits are still history.
 */
export function historyCoordinators(viewer: Profile | null, all: Profile[]): Profile[] {
  const coordinators = all.filter((p) => p.role === 'coordinator');
  if (!viewer) return [];
  if (viewer.role === 'mgmt' || viewer.scope === 'الكل') return coordinators;
  return coordinators.filter((c) => c.scope === viewer.scope);
}

/** `[from, to)` UTC instants covering Cairo days `fromDay`..`toDay`, both inclusive. */
export function cairoRange(fromDay: string, toDay: string): { from: string; to: string } {
  return { from: cairoDayRange(fromDay).from, to: cairoDayRange(toDay).to };
}

/** The default view: today and the six days before it. */
export const lastWeek = (today: string) => ({ from: addDays(today, -6), to: today });

export interface HistoryFilter {
  coordinator: string; // 'الكل' or a profile id
  status: 'الكل' | VisitStatus;
  chain: string; // 'الكل' or a chain name
  q: string;
}

/** Client-side filters over an already date-bounded list. An open visit counts as pending. */
export function filterVisits<V extends Visit>(
  visits: V[],
  f: HistoryFilter,
  outletById: (id: number) => Outlet | undefined,
): V[] {
  const q = f.q.trim();
  return visits.filter((v) => {
    if (f.coordinator !== 'الكل' && v.coordinator_id !== f.coordinator) return false;
    if (f.status !== 'الكل' && v.status !== f.status) return false;
    const o = outletById(v.outlet_id);
    if (f.chain !== 'الكل' && o?.chain !== f.chain) return false;
    if (q && !(o && `${o.chain} ${o.name}`.includes(q))) return false;
    return true;
  });
}

export const zeroCount = (lines: VisitLine[]) => lines.filter((l) => l.shelf === 0).length;

/** Whole Cairo calendar days from `a` to `b` (both `YYYY-MM-DD`). */
export function dayDiff(a: string, b: string): number {
  const ms = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((ms(b) - ms(a)) / 86400000);
}

export interface OutletEntry<V extends Visit> {
  visit: V;
  /** Days since the visit before this one at the outlet; null for the first on record. */
  gap: number | null;
}

/** One outlet's visits, newest first, each with the gap since the previous visit there. */
export function outletTimeline<V extends Visit>(visits: V[]): OutletEntry<V>[] {
  const asc = [...visits].sort((a, b) => +new Date(a.checkin_at) - +new Date(b.checkin_at));
  return asc
    .map((visit, i) => ({
      visit,
      gap: i === 0 ? null : dayDiff(cairoDateOf(asc[i - 1].checkin_at), cairoDateOf(visit.checkin_at)),
    }))
    .reverse();
}

export interface CoordinatorGroup<V extends Visit> {
  coordinatorId: string;
  /** Newest first, as the list arrives. */
  visits: V[];
}

/**
 * The list split per coordinator, keeping each one's visits newest first. Coordinators are
 * ordered by their latest visit, so whoever was in the field most recently comes first.
 */
export function groupByCoordinator<V extends Visit>(visits: V[]): CoordinatorGroup<V>[] {
  const groups = new Map<string, V[]>();
  for (const v of [...visits].sort((a, b) => +new Date(b.checkin_at) - +new Date(a.checkin_at))) {
    const g = groups.get(v.coordinator_id);
    if (g) g.push(v); else groups.set(v.coordinator_id, [v]);
  }
  return [...groups].map(([coordinatorId, vs]) => ({ coordinatorId, visits: vs }));
}
