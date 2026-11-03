import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coordinatorBranches, filterTeam, lastByOutlet, matchesBranch, medianPoint, overdue, unroutedBranches,
} from '../src/lib/branches.ts';
import type { Outlet, Profile, RouteRow } from '../src/lib/types.ts';

const outlet = (id: number, name: string, p: Partial<Outlet> = {}): Outlet => ({
  id, chain: 'كارفور', gov: 'القاهرة', name, ordering_mode: 'rep', payment_path: 'unknown',
  manager_name: null, manager_phone: null, lat: null, lng: null, pin_set_by: null, pin_set_at: null,
  pin_verified: false, pin_proposed_lat: null, pin_proposed_lng: null, active: true, ...p,
});
const outlets = [outlet(0, 'المعادي'), outlet(1, 'مدينتي'), outlet(2, 'الرحاب'), outlet(3, 'سموحة', { gov: 'الإسكندرية' }), outlet(4, 'قديم', { active: false })];
const byId = (id: number) => outlets.find((o) => o.id === id);
const route = (coordinator_id: string, weekday: number, outlet_id: number): RouteRow => ({ coordinator_id, weekday, outlet_id, seq: null });
const routes = [route('rana', 0, 0), route('rana', 3, 0), route('rana', 1, 1), route('ali', 2, 2)];
const sum = (coordinator_id: string, outlet_id: number, last_checkin_at: string) => ({ coordinator_id, outlet_id, last_checkin_at, n: 1 });
const summary = [
  sum('rana', 0, '2026-11-02T08:00:00Z'),
  sum('ali', 0, '2026-10-20T08:00:00Z'),
  sum('rana', 2, '2026-10-30T08:00:00Z'),
];
const today = '2026-11-03';

test('route branches include never-visited ones, never-visited first; off-route visits are tagged', () => {
  const rows = coordinatorBranches('rana', routes, summary, byId, today);
  assert.deepEqual(rows.map((r) => [r.outlet.id, r.days, r.offRoute]), [[1, null, false], [2, 4, true], [0, 1, false]]);
  assert.deepEqual(rows.find((r) => r.outlet.id === 0)?.weekdays, [0, 3]);
});

test('last visit is the outlet\'s latest by anyone', () => {
  assert.equal(lastByOutlet(summary).get(0)?.coordinator_id, 'rana');
  const ali = coordinatorBranches('ali', routes, summary, byId, today);
  assert.deepEqual(ali.map((r) => [r.outlet.id, r.lastBy]), [[2, 'rana'], [0, 'rana']]);
});

test('unrouted: active outlets on nobody\'s route, limited to the governorate', () => {
  assert.deepEqual(unroutedBranches(outlets, routes, summary, 'القاهرة', today).map((r) => r.outlet.id), []);
  assert.deepEqual(unroutedBranches(outlets, routes, summary, null, today).map((r) => r.outlet.id), [3]);
});

test('overdue above seven days or never', () => {
  const rows = coordinatorBranches('rana', routes, summary, byId, today);
  assert.deepEqual(rows.map(overdue), [true, false, false]);
});

test('search matches chain and name', () => {
  const [r] = coordinatorBranches('rana', routes, summary, byId, today);
  assert.equal(matchesBranch(r, 'كارفور مدينتي'), true);
  assert.equal(matchesBranch(r, 'الرحاب'), false);
  assert.equal(matchesBranch(r, '  '), true);
});

test('median needs three points and is coordinate-wise', () => {
  assert.equal(medianPoint([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]), null);
  assert.deepEqual(medianPoint([{ lat: 30, lng: 31.5 }, { lat: 30.2, lng: 31 }, { lat: 35, lng: 31.1 }]), { lat: 30.2, lng: 31.1 });
});

test('filterTeam', () => {
  const p = (id: string) => ({ id } as Profile);
  assert.deepEqual(filterTeam('mine', [p('a')], [p('a'), p('b')]).map((x) => x.id), ['a']);
  assert.deepEqual(filterTeam('all', [p('a')], [p('a'), p('b')]).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(filterTeam('b', [p('a')], [p('a'), p('b')]).map((x) => x.id), ['b']);
});
