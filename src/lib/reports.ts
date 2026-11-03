import { addDays, weekdayOf } from './cairo.ts';
import { haversine } from './geo.ts';
import { dayDiff } from './visitsHistory.ts';
import type { Outlet, RouteRow, VisitStatus, ZeroReason } from './types';

/**
 * «التقارير» (Batch C): aggregates over `report_lines`, one row per SKU line of a completed
 * visit. Shelf and warehouse are never added across SKUs — units are not confirmed per SKU.
 */

export interface ReportLine {
  visit_id: string;
  coordinator_id: string;
  coordinator_name: string;
  supervisor_id: string | null;
  supervisor_name: string | null;
  outlet_id: number;
  outlet_name: string;
  chain: string;
  gov: string;
  outlet_lat: number | null;
  outlet_lng: number | null;
  sku_id: string;
  sku_name: string;
  sku_line: 'PET' | 'VIA';
  cairo_date: string;
  checkin_at: string;
  checkout_at: string;
  shelf: number;
  warehouse: number;
  sold_cases: number;
  zero_reason: ZeroReason | null;
  dwell_seconds: number | null;
  off_route: boolean;
  flags: string[];
  status: VisitStatus;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkout_lat: number | null;
  checkout_lng: number | null;
  extra_photos: number;
}

export const ALL = 'الكل';
export interface ReportFilter {
  from: string;
  to: string;
  coordinator: string;
  chain: string;
  outlet: string; // outlet id as text, or ALL
  sku: string;
  gov: string;
}

/** Same radius as the check-in fence; distance is to the outlet's current pin. */
export const FAR_M = 150;
export const SHORT_DWELL_S = 600;

/** One entry per visit, taken from its first line. */
export function visitsOf(rows: ReportLine[]): ReportLine[] {
  const seen = new Map<string, ReportLine>();
  for (const r of rows) if (!seen.has(r.visit_id)) seen.set(r.visit_id, r);
  return [...seen.values()];
}

export const noGps = (v: ReportLine) => v.checkin_lat == null || v.checkout_lat == null;

export function farFromPin(v: ReportLine): boolean {
  if (v.checkin_lat == null || v.checkin_lng == null || v.outlet_lat == null || v.outlet_lng == null) return false;
  return haversine({ lat: v.checkin_lat, lng: v.checkin_lng }, { lat: v.outlet_lat, lng: v.outlet_lng }) > FAR_M;
}

export interface Planned { coordinator_id: string; day: string; outlet_id: number }

/**
 * Route stops due in `[from, to]`: each day's weekday against today's routes. Routes keep no
 * history, so a route changed mid-range is counted as it is now.
 */
export function plannedStops(
  routes: RouteRow[], from: string, to: string, keep: (r: RouteRow) => boolean,
): Planned[] {
  const out: Planned[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    for (const r of routes) if (r.weekday === wd && keep(r)) out.push({ coordinator_id: r.coordinator_id, day: d, outlet_id: r.outlet_id });
  }
  return out;
}

/** Route filter matching the report filter (SKU does not apply to a stop). */
export function routeKeep(f: ReportFilter, outletById: (id: number) => Outlet | undefined) {
  return (r: RouteRow) => {
    const o = outletById(r.outlet_id);
    if (f.coordinator !== ALL && r.coordinator_id !== f.coordinator) return false;
    if (f.outlet !== ALL && String(r.outlet_id) !== f.outlet) return false;
    if (f.chain !== ALL && o?.chain !== f.chain) return false;
    if (f.gov !== ALL && o?.gov !== f.gov) return false;
    return true;
  };
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((100 * n) / d));

function reasonSplit(rows: ReportLine[]): Partial<Record<ZeroReason, number>> {
  const out: Partial<Record<ZeroReason, number>> = {};
  for (const r of rows) if (r.shelf === 0 && r.zero_reason) out[r.zero_reason] = (out[r.zero_reason] ?? 0) + 1;
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function groupBy<K>(rows: ReportLine[], key: (r: ReportLine) => K): Map<K, ReportLine[]> {
  const m = new Map<K, ReportLine[]>();
  for (const r of rows) { const g = m.get(key(r)); if (g) g.push(r); else m.set(key(r), [r]); }
  return m;
}

// ---------- «المنسقين» ----------
export interface CoordinatorStat {
  coordinator_id: string;
  name: string;
  planned: number;
  plannedVisited: number;
  completion: number | null;
  visits: number;
  branches: number;
  avgDwellS: number | null;
  short: number;
  noGps: number;
  far: number;
  offRoute: number;
  withPhotos: number;
  approved: number;
  rejected: number;
  zeroLines: number;
  sold: number;
}

export function byCoordinator(rows: ReportLine[], planned: Planned[], names: (id: string) => string): CoordinatorStat[] {
  const done = new Set(visitsOf(rows).map((v) => `${v.coordinator_id}|${v.cairo_date}|${v.outlet_id}`));
  const ids = new Set([...rows.map((r) => r.coordinator_id), ...planned.map((p) => p.coordinator_id)]);
  const lines = groupBy(rows, (r) => r.coordinator_id);
  return [...ids].map((id) => {
    const ls = lines.get(id) ?? [];
    const vs = visitsOf(ls);
    const pl = planned.filter((p) => p.coordinator_id === id);
    const hit = pl.filter((p) => done.has(`${p.coordinator_id}|${p.day}|${p.outlet_id}`)).length;
    const dw = vs.map((v) => v.dwell_seconds).filter((d): d is number => d != null);
    return {
      coordinator_id: id,
      name: ls[0]?.coordinator_name ?? names(id),
      planned: pl.length,
      plannedVisited: hit,
      completion: pct(hit, pl.length),
      visits: vs.length,
      branches: new Set(vs.map((v) => v.outlet_id)).size,
      avgDwellS: dw.length ? Math.round(sum(dw) / dw.length) : null,
      short: dw.filter((d) => d < SHORT_DWELL_S).length,
      noGps: vs.filter(noGps).length,
      far: vs.filter(farFromPin).length,
      offRoute: vs.filter((v) => v.off_route).length,
      withPhotos: vs.filter((v) => v.extra_photos > 0).length,
      approved: vs.filter((v) => v.status === 'approved').length,
      rejected: vs.filter((v) => v.status === 'flagged').length,
      zeroLines: ls.filter((r) => r.shelf === 0).length,
      sold: sum(ls.map((r) => r.sold_cases)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

// ---------- «الأصناف» ----------
export interface SkuStat {
  sku_id: string;
  name: string;
  line: 'PET' | 'VIA';
  lines: number;
  zeroPct: number | null;
  reasons: Partial<Record<ZeroReason, number>>;
  sold: number;
  /** Up to three branches by cartons sold. */
  top: { outlet_id: number; label: string; sold: number }[];
}

export function bySku(rows: ReportLine[], order: string[]): SkuStat[] {
  const out = [...groupBy(rows, (r) => r.sku_id)].map(([id, ls]) => {
    const per = [...groupBy(ls, (r) => r.outlet_id)]
      .map(([oid, g]) => ({ outlet_id: oid, label: `${g[0].chain} ${g[0].outlet_name}`, sold: sum(g.map((r) => r.sold_cases)) }))
      .filter((x) => x.sold > 0)
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 3);
    return {
      sku_id: id, name: ls[0].sku_name, line: ls[0].sku_line,
      lines: ls.length,
      zeroPct: pct(ls.filter((r) => r.shelf === 0).length, ls.length),
      reasons: reasonSplit(ls),
      sold: sum(ls.map((r) => r.sold_cases)),
      top: per,
    };
  });
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? Infinity : i; };
  return out.sort((a, b) => rank(a.sku_id) - rank(b.sku_id));
}

// ---------- «الأسواق» ----------
export interface MarketStat {
  key: string;
  label: string;
  outlet_id: number | null;
  visits: number;
  lastAt: string | null;
  days: number | null;
  zeroPct: number | null;
  reasons: Partial<Record<ZeroReason, number>>;
  sold: number;
}

function market(key: string, label: string, outlet_id: number | null, ls: ReportLine[], today: string): MarketStat {
  const vs = visitsOf(ls);
  const last = vs.reduce<ReportLine | null>((a, v) => (!a || v.checkin_at > a.checkin_at ? v : a), null);
  return {
    key, label, outlet_id,
    visits: vs.length,
    lastAt: last?.checkin_at ?? null,
    days: last ? dayDiff(last.cairo_date, today) : null,
    zeroPct: pct(ls.filter((r) => r.shelf === 0).length, ls.length),
    reasons: reasonSplit(ls),
    sold: sum(ls.map((r) => r.sold_cases)),
  };
}

export const byChain = (rows: ReportLine[], today: string): MarketStat[] =>
  [...groupBy(rows, (r) => r.chain)].map(([c, ls]) => market(c, c, null, ls, today))
    .sort((a, b) => a.label.localeCompare(b.label, 'ar'));

export const byBranch = (rows: ReportLine[], today: string): MarketStat[] =>
  [...groupBy(rows, (r) => r.outlet_id)].map(([id, ls]) => market(String(id), ls[0].outlet_name, id, ls, today))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.label.localeCompare(b.label, 'ar'));

/** The branch's latest visit in the rows, its lines in catalogue order. */
export function latestVisitLines(rows: ReportLine[], order: string[]): ReportLine[] {
  const last = visitsOf(rows).reduce<ReportLine | null>((a, v) => (!a || v.checkout_at > a.checkout_at ? v : a), null);
  if (!last) return [];
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? Infinity : i; };
  return rows.filter((r) => r.visit_id === last.visit_id).sort((a, b) => rank(a.sku_id) - rank(b.sku_id));
}

// ---------- CSV ----------
const cell = (v: unknown) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 with BOM so Excel opens Arabic correctly; CRLF rows. */
export function toCsv(sections: { header: string[]; rows: unknown[][] }[]): string {
  const blocks = sections.map((s) => [s.header, ...s.rows].map((r) => r.map(cell).join(',')).join('\r\n'));
  return `﻿${blocks.join('\r\n\r\n')}\r\n`;
}

export const RAW_HEADER = [
  'التاريخ', 'المنسق', 'المشرف', 'المحافظة', 'السلسلة', 'الفرع', 'رقم الفرع', 'الصنف', 'الخط',
  'رف', 'مخزن', 'بيع (حسب تسجيل المنسق)', 'سبب الصفر', 'المدة (ث)', 'خارج الخط', 'ملاحظات', 'الحالة',
  'بداية lat', 'بداية lng', 'إرسال lat', 'إرسال lng', 'زيارة',
];

export const rawRow = (r: ReportLine): unknown[] => [
  r.cairo_date, r.coordinator_name, r.supervisor_name, r.gov, r.chain, r.outlet_name, r.outlet_id, r.sku_name, r.sku_line,
  r.shelf, r.warehouse, r.sold_cases, r.zero_reason, r.dwell_seconds, r.off_route ? 'نعم' : '', r.flags, r.status,
  r.checkin_lat, r.checkin_lng, r.checkout_lat, r.checkout_lng, r.visit_id,
];
