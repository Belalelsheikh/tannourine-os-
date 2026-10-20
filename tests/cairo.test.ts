import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, cairoDateOf, cairoDayRange, cairoTime, weekdayOf } from '../src/lib/cairo.ts';

test('cairoDateOf reads the Cairo calendar date, not UTC', () => {
  // 22:30 UTC on 19 Oct is 01:30 on 20 Oct in Cairo (UTC+3 in October 2026).
  assert.equal(cairoDateOf('2026-10-19T22:30:00Z'), '2026-10-20');
  assert.equal(cairoDateOf('2026-10-20T09:00:00Z'), '2026-10-20');
});

test('cairoDayRange spans Cairo midnight to midnight in UTC', () => {
  assert.deepEqual(cairoDayRange('2026-10-20'), {
    from: '2026-10-19T21:00:00.000Z', to: '2026-10-20T21:00:00.000Z',
  });
  // Winter time, UTC+2.
  assert.deepEqual(cairoDayRange('2026-12-01'), {
    from: '2026-11-30T22:00:00.000Z', to: '2026-12-01T22:00:00.000Z',
  });
});

test('every instant inside a day range maps back to that day', () => {
  for (const day of ['2026-09-16', '2026-10-20', '2026-10-29', '2026-10-30', '2026-12-01']) {
    const { from, to } = cairoDayRange(day);
    assert.equal(cairoDateOf(from), day, `${day} start`);
    assert.equal(cairoDateOf(new Date(+new Date(to) - 1000).toISOString()), day, `${day} end`);
    assert.notEqual(cairoDateOf(to), day, `${day} after end`);
  }
});

test('addDays steps across month ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
});

test('weekdayOf uses the JS getDay convention routes are stored in (0=Sun)', () => {
  assert.equal(weekdayOf('2026-10-20'), 2); // Tuesday
  assert.equal(weekdayOf('2026-10-17'), 6); // Saturday
  assert.equal(weekdayOf('2026-10-18'), 0); // Sunday
});

test('cairoTime formats HH:MM in Cairo', () => {
  assert.equal(cairoTime('2026-10-20T06:29:00Z'), '09:29');
});
