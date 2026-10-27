import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cairoRange, dayDiff, filterVisits, groupByCoordinator, historyCoordinators, lastWeek, outletTimeline, zeroCount,
} from '../src/lib/visitsHistory.ts';
import type { Outlet, Profile, Scope, Visit, VisitLine } from '../src/lib/types.ts';

const prof = (id: string, role: Profile['role'], scope: Scope, p: Partial<Profile> = {}): Profile => ({
  id, full_name: id, role, scope, supervisor_id: null, active: true, created_at: '', ...p,
});
const visit = (id: string, coordinator_id: string, outlet_id: number, checkin_at: string, p: Partial<Visit> = {}): Visit => ({
  id, coordinator_id, outlet_id, checkin_at, checkin_lat: null, checkin_lng: null,
  checkout_at: checkin_at, checkout_lat: null, checkout_lng: null, dwell_seconds: 600, distance_m: null,
  photo_path: null, status: 'pending', reviewed_by: null, reviewed_at: null, flags: [], off_route: false,
  created_at: checkin_at, ...p,
});

const marwa = prof('marwa', 'supervisor', 'الكل');
const hossam = prof('hossam', 'supervisor', 'القاهرة');
const alex = prof('alex', 'coordinator', 'الإسكندرية', { supervisor_id: 'marwa' });
const rana = prof('rana', 'coordinator', 'القاهرة', { supervisor_id: 'ragab' });
const gone = prof('gone', 'coordinator', 'القاهرة', { active: false });
const all = [marwa, hossam, alex, rana, gone];

test('scope الكل sees every coordinator, ignoring supervisor_id', () => {
  assert.deepEqual(historyCoordinators(marwa, all).map((p) => p.id), ['alex', 'rana', 'gone']);
});

test('a governorate supervisor sees that governorate, including other supervisors\' and inactive coordinators', () => {
  assert.deepEqual(historyCoordinators(hossam, all).map((p) => p.id), ['rana', 'gone']);
});

test('no viewer sees nothing', () => {
  assert.deepEqual(historyCoordinators(null, all), []);
});

test('lastWeek is seven Cairo days ending today', () => {
  assert.deepEqual(lastWeek('2026-10-27'), { from: '2026-10-21', to: '2026-10-27' });
  // Cairo is UTC+3 in October 2026 (summer time).
  assert.deepEqual(cairoRange('2026-10-21', '2026-10-27'), {
    from: '2026-10-20T21:00:00.000Z', to: '2026-10-27T21:00:00.000Z',
  });
});

const outlets: Record<number, Outlet> = {
  0: { id: 0, chain: 'كارفور', name: 'داندى مول' } as Outlet,
  1: { id: 1, chain: 'سبينيس', name: 'سموحة' } as Outlet,
};
const byId = (id: number) => outlets[id];
const vs = [
  visit('a', 'rana', 0, '2026-10-21T08:00:00Z', { status: 'approved' }),
  visit('b', 'alex', 1, '2026-10-22T08:00:00Z', { status: 'flagged' }),
  visit('c', 'alex', 0, '2026-10-23T08:00:00Z', { checkout_at: null }),
];
const none = { coordinator: 'الكل', status: 'الكل', chain: 'الكل', q: '' } as const;

test('filters combine; outlet 0 is a real outlet', () => {
  assert.deepEqual(filterVisits(vs, none, byId).map((v) => v.id), ['a', 'b', 'c']);
  assert.deepEqual(filterVisits(vs, { ...none, coordinator: 'alex' }, byId).map((v) => v.id), ['b', 'c']);
  assert.deepEqual(filterVisits(vs, { ...none, chain: 'كارفور' }, byId).map((v) => v.id), ['a', 'c']);
  assert.deepEqual(filterVisits(vs, { ...none, q: 'داندى' }, byId).map((v) => v.id), ['a', 'c']);
  assert.deepEqual(filterVisits(vs, { ...none, coordinator: 'alex', status: 'approved' }, byId), []);
});

test('an open visit counts as pending', () => {
  assert.deepEqual(filterVisits(vs, { ...none, status: 'pending' }, byId).map((v) => v.id), ['c']);
});

test('zeroCount counts zero-shelf lines', () => {
  const l = (shelf: number) => ({ shelf } as VisitLine);
  assert.equal(zeroCount([l(0), l(3), l(0)]), 2);
});

test('dayDiff counts calendar days', () => {
  assert.equal(dayDiff('2026-10-21', '2026-10-27'), 6);
  assert.equal(dayDiff('2026-09-30', '2026-10-01'), 1);
});

test('outletTimeline is newest first with gaps in Cairo days', () => {
  const t = outletTimeline([
    visit('x', 'rana', 0, '2026-10-24T08:00:00Z'),
    // 23:30 UTC on the 14th is 02:30 on the 15th in Cairo.
    visit('w', 'rana', 0, '2026-10-14T23:30:00Z'),
    visit('y', 'rana', 0, '2026-10-24T12:00:00Z'),
  ]);
  assert.deepEqual(t.map((e) => [e.visit.id, e.gap]), [['y', 0], ['x', 9], ['w', null]]);
});

test('groupByCoordinator: latest-active coordinator first, each group newest first', () => {
  const g = groupByCoordinator([
    visit('r1', 'rana', 0, '2026-10-21T08:00:00Z'),
    visit('a1', 'alex', 1, '2026-10-22T08:00:00Z'),
    visit('r2', 'rana', 1, '2026-10-23T08:00:00Z'),
    visit('a2', 'alex', 0, '2026-10-20T08:00:00Z'),
  ]);
  assert.deepEqual(g.map((x) => [x.coordinatorId, x.visits.map((v) => v.id)]), [
    ['rana', ['r2', 'r1']],
    ['alex', ['a1', 'a2']],
  ]);
  assert.deepEqual(groupByCoordinator([]), []);
});
