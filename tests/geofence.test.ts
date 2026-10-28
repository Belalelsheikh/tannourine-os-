import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinDecision, fenceError } from '../src/lib/geofence.ts';

const pin = { lat: 30.0, lng: 31.0 };
const at = (northMetres: number) => ({ lat: 30.0 + northMetres / 111195, lng: 31.0 });

test('no pin or no GPS fix never blocks', () => {
  assert.deepEqual(checkinDecision({ lat: null, lng: null, pin_verified: false }, at(5000)), { k: 'ok', distance: null });
  assert.deepEqual(checkinDecision({ ...pin, pin_verified: true }, null), { k: 'ok', distance: null });
});

test('within 150 m is fine whatever the pin state', () => {
  assert.equal(checkinDecision({ ...pin, pin_verified: true }, at(140)).k, 'ok');
  assert.equal(checkinDecision({ ...pin, pin_verified: false }, at(150)).k, 'ok');
});

test('200 m from an unverified pin asks for a reason; from a verified pin it is refused', () => {
  assert.deepEqual(checkinDecision({ ...pin, pin_verified: false }, at(200)), { k: 'reason', distance: 200 });
  assert.deepEqual(checkinDecision({ ...pin, pin_verified: true }, at(200)), { k: 'blocked', distance: 200 });
});

test('fenceError reads the trigger messages', () => {
  assert.deepEqual(fenceError('checkin_blocked:412'), { k: 'blocked', distance: 412 });
  assert.deepEqual(fenceError('ERROR: checkin_reason_required:200'), { k: 'reason', distance: 200 });
  assert.equal(fenceError('visit_incomplete'), null);
});
