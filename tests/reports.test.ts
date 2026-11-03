import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL, byBranch, byChain, byCoordinator, bySku, farFromPin, latestVisitLines, plannedStops, routeKeep, toCsv, visitsOf,
  type ReportFilter, type ReportLine,
} from '../src/lib/reports.ts';
import type { Outlet, RouteRow } from '../src/lib/types.ts';

const line = (p: Partial<ReportLine>): ReportLine => ({
  visit_id: 'v1', coordinator_id: 'rana', coordinator_name: 'رنا', supervisor_id: 's', supervisor_name: 'محمد رجب',
  outlet_id: 1, outlet_name: 'مدينتي', chain: 'كارفور', gov: 'القاهرة', outlet_lat: 30, outlet_lng: 31,
  sku_id: 'a', sku_name: 'نص لتر', sku_line: 'PET', cairo_date: '2026-11-01',
  checkin_at: '2026-11-01T08:00:00Z', checkout_at: '2026-11-01T08:20:00Z',
  shelf: 3, warehouse: 2, sold_cases: 4, zero_reason: null, dwell_seconds: 1200, off_route: false, flags: [],
  status: 'approved', checkin_lat: 30, checkin_lng: 31, checkout_lat: 30, checkout_lng: 31, extra_photos: 1, ...p,
});

// 2026-11-01 is a Sunday (weekday 0).
const rows = [
  line({}),
  line({ sku_id: 'b', sku_name: 'لتر ونص', shelf: 0, warehouse: 0, sold_cases: 0, zero_reason: 'الصنف مش في الفرع' }),
  line({ visit_id: 'v2', outlet_id: 2, outlet_name: 'الرحاب', cairo_date: '2026-11-02', checkin_at: '2026-11-02T08:00:00Z',
    checkout_at: '2026-11-02T08:05:00Z', dwell_seconds: 300, status: 'flagged', checkin_lat: 30.01, checkout_lat: null,
    extra_photos: 0, off_route: true, sold_cases: 1 }),
  line({ visit_id: 'v2', outlet_id: 2, outlet_name: 'الرحاب', cairo_date: '2026-11-02', checkin_at: '2026-11-02T08:00:00Z',
    checkout_at: '2026-11-02T08:05:00Z', sku_id: 'b', sku_name: 'لتر ونص', shelf: 0, zero_reason: 'الفرع لم يطلب',
    dwell_seconds: 300, status: 'flagged', checkin_lat: 30.01, checkout_lat: null, extra_photos: 0, off_route: true, sold_cases: 2 }),
];
const route = (coordinator_id: string, weekday: number, outlet_id: number): RouteRow => ({ coordinator_id, weekday, outlet_id, seq: null });
const routes = [route('rana', 0, 1), route('rana', 0, 3), route('ali', 1, 2)];
const outlets: Outlet[] = [1, 2, 3].map((id) => ({ id, chain: 'كارفور', gov: 'القاهرة', name: String(id) } as Outlet));
const f: ReportFilter = { from: '2026-11-01', to: '2026-11-02', coordinator: ALL, chain: ALL, outlet: ALL, sku: ALL, gov: ALL };

test('visits are counted once, not once per line', () => {
  assert.equal(visitsOf(rows).length, 2);
});

test('planned stops expand each day of the range against route weekdays', () => {
  const p = plannedStops(routes, f.from, f.to, routeKeep(f, (id) => outlets.find((o) => o.id === id)));
  assert.deepEqual(p.map((x) => `${x.coordinator_id}${x.day.slice(8)}${x.outlet_id}`), ['rana011', 'rana013', 'ali022']);
  const onlyRana = plannedStops(routes, f.from, f.to, routeKeep({ ...f, coordinator: 'rana' }, (id) => outlets.find((o) => o.id === id)));
  assert.equal(onlyRana.length, 2);
});

test('coordinator stats', () => {
  const p = plannedStops(routes, f.from, f.to, () => true);
  const stats = byCoordinator(rows, p, (id) => id);
  const ali = stats.find((x) => x.coordinator_id === 'ali')!;
  const rana = stats.find((x) => x.coordinator_id === 'rana')!;
  assert.deepEqual([ali.planned, ali.plannedVisited, ali.visits], [1, 0, 0]);
  assert.deepEqual(
    [rana.planned, rana.plannedVisited, rana.completion, rana.visits, rana.branches, rana.avgDwellS, rana.short],
    [2, 1, 50, 2, 2, 750, 1],
  );
  assert.deepEqual([rana.noGps, rana.far, rana.offRoute, rana.withPhotos, rana.approved, rana.rejected, rana.zeroLines, rana.sold],
    [1, 1, 1, 1, 1, 1, 2, 7]);
});

test('far from pin is measured on read against the current pin', () => {
  assert.equal(farFromPin(line({ checkin_lat: 30.001 })), false); // ~111 m
  assert.equal(farFromPin(line({ checkin_lat: 30.002 })), true); // ~222 m
  assert.equal(farFromPin(line({ outlet_lat: null })), false);
});

test('SKU stats keep the two not-stocked reasons apart', () => {
  const [a, b] = bySku(rows, ['a', 'b']);
  assert.equal(a.sku_id, 'a');
  assert.deepEqual([b.lines, b.zeroPct, b.sold], [2, 100, 2]);
  assert.deepEqual(b.reasons, { 'الصنف مش في الفرع': 1, 'الفرع لم يطلب': 1 });
  assert.deepEqual(a.top.map((t) => t.outlet_id), [1, 2]);
});

test('chain and branch stats; latest visit grid', () => {
  const [c] = byChain(rows, '2026-11-03');
  assert.deepEqual([c.visits, c.days, c.zeroPct, c.sold], [2, 1, 50, 7]);
  const br = byBranch(rows, '2026-11-03');
  assert.deepEqual(br.map((b) => [b.outlet_id, b.days]), [[1, 2], [2, 1]]);
  assert.deepEqual(latestVisitLines(rows, ['b', 'a']).map((r) => `${r.visit_id}${r.sku_id}`), ['v2b', 'v2a']);
});

test('CSV starts with a BOM and quotes commas and quotes', () => {
  const csv = toCsv([{ header: ['أ', 'ب'], rows: [['x,y', 'قال "لا"'], [null, ['a', 'b']]] }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv, '﻿أ,ب\r\n"x,y","قال ""لا"""\r\n,a b\r\n');
});
