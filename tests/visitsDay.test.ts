import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySections, zeroSummary } from '../src/lib/visitsDay.ts';
import type { Profile, RouteRow, Visit, VisitLine } from '../src/lib/types.ts';

const prof = (id: string, full_name: string, active = true): Profile => ({
  id, full_name, role: 'coordinator', scope: 'القاهرة', supervisor_id: null, active, created_at: '',
});
const visit = (id: string, coordinator_id: string, outlet_id: number, checkin_at: string, p: Partial<Visit> = {}): Visit => ({
  id, coordinator_id, outlet_id, checkin_at, checkin_lat: null, checkin_lng: null,
  checkout_at: checkin_at, checkout_lat: null, checkout_lng: null, dwell_seconds: 600, distance_m: null,
  photo_path: null, status: 'pending', reviewed_by: null, reviewed_at: null, flags: [], off_route: false,
  created_at: checkin_at, ...p,
});
const route = (coordinator_id: string, outlet_id: number, seq: number | null): RouteRow =>
  ({ coordinator_id, weekday: 2, outlet_id, seq });

const rana = prof('rana', 'رنا');
const ragab = prof('ragab', 'رجب أحمد');
const gone = prof('gone', 'محمد عبد الباسط', false);
const idle = prof('idle', 'دنيا');

const routes = [
  route('rana', 173, 1), route('rana', 250, 2), route('rana', 193, 3), route('rana', 194, 4), route('rana', 239, 5),
  route('ragab', 10, 2), route('ragab', 0, 1), // outlet 0 is real (داندى مول) — must not be dropped
];
const visits = [
  visit('v2', 'rana', 250, '2026-10-20T07:46:00Z'),
  visit('v1', 'rana', 173, '2026-10-20T06:29:00Z'),
  visit('v3', 'rana', 194, '2026-10-20T08:35:00Z', { checkout_at: '2026-10-20T09:36:00Z' }),
  visit('v4', 'rana', 999, '2026-10-20T10:00:00Z', { off_route: true, checkout_at: null }),
  visit('g1', 'gone', 5, '2026-10-20T09:00:00Z'),
];

test('daySections: done/planned, not-visited in seq order, times', () => {
  const s = daySections([rana, ragab, gone, idle], visits, routes, 'الكل');
  const r = s.find((x) => x.coord.id === 'rana')!;
  assert.deepEqual(r.visits.map((v) => v.id), ['v1', 'v2', 'v3', 'v4']);
  assert.equal(r.planned.length, 5);
  assert.equal(r.done, 3);
  assert.equal(r.offRoute, 1);
  assert.deepEqual(r.notVisited, [193, 239]);
  assert.equal(r.firstIn, '2026-10-20T06:29:00Z');
  assert.equal(r.lastOut, '2026-10-20T09:36:00Z'); // the open visit has no checkout
});

test('daySections: routed coordinator with no visits lists every planned outlet, outlet 0 included', () => {
  const s = daySections([rana, ragab, gone, idle], visits, routes, 'ragab');
  assert.equal(s.length, 1);
  assert.equal(s[0].done, 0);
  assert.deepEqual(s[0].notVisited, [0, 10]);
  assert.equal(s[0].firstIn, null);
});

test('daySections: inactive coordinator appears only with visits; idle unrouted coordinator is omitted', () => {
  const ids = daySections([rana, ragab, gone, idle], visits, routes, 'الكل').map((x) => x.coord.id);
  assert.deepEqual(ids, ['rana', 'ragab', 'gone']);
  const noGone = daySections([rana, gone], [], routes, 'الكل').map((x) => x.coord.id);
  assert.deepEqual(noGone, ['rana']);
});

test('zeroSummary counts zero-shelf lines by reason and by SKU, most first', () => {
  const lines: VisitLine[] = [
    { visit_id: 'v1', sku_id: 't15', shelf: 0, warehouse: 0, sold_cases: 0, zero_reason: 'أوردر متأخر' },
    { visit_id: 'v1', sku_id: 'vg1', shelf: 0, warehouse: 0, sold_cases: 0, zero_reason: 'الفرع لم يطلب' },
    { visit_id: 'v2', sku_id: 't15', shelf: 0, warehouse: 0, sold_cases: 0, zero_reason: 'المخزن فاضي' },
    { visit_id: 'v3', sku_id: 't15', shelf: 0, warehouse: 2, sold_cases: 0, zero_reason: 'الفرع لم يطلب' },
    { visit_id: 'v3', sku_id: 't500', shelf: 7, warehouse: 0, sold_cases: 0, zero_reason: null },
    { visit_id: 'other', sku_id: 'vs1', shelf: 0, warehouse: 0, sold_cases: 0, zero_reason: 'المخزن فاضي' },
  ];
  const z = zeroSummary(lines, new Set(['v1', 'v2', 'v3']));
  assert.equal(z.total, 4);
  assert.deepEqual(z.byReason, [['الفرع لم يطلب', 2], ['أوردر متأخر', 1], ['المخزن فاضي', 1]]);
  assert.deepEqual(z.bySku, [['t15', 3], ['vg1', 1]]);
});
