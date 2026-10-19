import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, calendarDaysAgo, closeUnfinishedPatch, reviewQueue } from '../src/lib/review.ts';
import type { Visit } from '../src/lib/types.ts';

const visit = (p: Partial<Visit>): Visit => ({
  id: 'v', coordinator_id: 'c', outlet_id: 0,
  checkin_at: '2026-10-18T10:00:00', checkin_lat: null, checkin_lng: null,
  checkout_at: '2026-10-18T10:10:00', checkout_lat: null, checkout_lng: null,
  dwell_seconds: 600, distance_m: null, photo_path: null,
  status: 'pending', reviewed_by: null, reviewed_at: null,
  flags: [], off_route: false, created_at: '2026-10-18T10:00:00',
  ...p,
});

test('reviewQueue keeps submitted pending visits from any day, oldest first', () => {
  const q = reviewQueue([
    visit({ id: 'today', checkin_at: '2026-10-19T09:00:00' }),
    visit({ id: 'sept', checkin_at: '2026-09-09T12:00:00' }),
    visit({ id: 'open', checkout_at: null }),
    visit({ id: 'done', status: 'approved' }),
    visit({ id: 'flagged', status: 'flagged' }),
  ]);
  assert.deepEqual(q.map((v) => v.id), ['sept', 'today']);
});

test('calendarDaysAgo counts calendar days, not 24h blocks', () => {
  const now = new Date('2026-10-19T08:00:00');
  assert.equal(calendarDaysAgo('2026-10-19T00:30:00', now), 0);
  assert.equal(calendarDaysAgo('2026-10-18T23:30:00', now), 1); // 8.5h ago, still yesterday
  assert.equal(calendarDaysAgo('2026-09-09T12:00:00', now), 40);
});

test('ageLabel is silent for today and Arabic for older', () => {
  assert.equal(ageLabel(0), null);
  assert.equal(ageLabel(1), 'إمبارح');
  assert.equal(ageLabel(40), 'من 40 يوم');
});

test('closeUnfinishedPatch checks the visit out as flagged without inventing a dwell', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  const p = closeUnfinishedPatch(visit({ checkout_at: null, flags: ['no_checkin_gps'] }), 'sup', now);
  assert.equal(p.status, 'flagged');
  assert.equal(p.checkout_at, now.toISOString());
  assert.equal(p.reviewed_by, 'sup');
  assert.equal(p.reviewed_at, now.toISOString());
  assert.deepEqual(p.flags, ['no_checkin_gps', 'unclosed']);
  assert.equal('dwell_seconds' in p, false);
});

test('closeUnfinishedPatch does not duplicate the unclosed flag', () => {
  const p = closeUnfinishedPatch(visit({ checkout_at: null, flags: ['unclosed'] }), 'sup', new Date());
  assert.deepEqual(p.flags, ['unclosed']);
});
