import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeGate, type GateDeps, type InsertResult } from '../src/lib/gateCheckin.ts';
import type { Visit } from '../src/lib/types';

const visit = { id: 'v1', coordinator_id: 'c1', outlet_id: 0, checkin_at: '2026-10-29T08:00:00Z' } as Visit;
const photo = new Blob(['jpeg']);
const args = (pending: Promise<InsertResult> | null) => ({
  visitId: 'v1', existing: null, pending, photo, path: 'visits/v1/p1.jpg', photoId: 'p1', pos: { lat: 30, lng: 31 },
});

/** Records every call; inserts answer from `answers` in order. */
function fakes(answers: InsertResult[]) {
  const calls = { insert: 0, fetch: 0, upload: [] as string[], gate: [] as unknown[] };
  const deps: GateDeps = {
    insertVisit: async () => { calls.insert++; return answers.shift()!; },
    fetchVisit: async () => { calls.fetch++; return visit; },
    uploadPhoto: async (path) => { calls.upload.push(path); },
    insertGatePhoto: async (row) => { calls.gate.push(row); },
  };
  return { calls, deps };
}

test('the insert sent on the tap is awaited, not repeated', async () => {
  const { calls, deps } = fakes([]);
  const res = await completeGate(args(Promise.resolve({ data: visit, error: null })), deps);
  assert.deepEqual(res, { k: 'ready', visit });
  assert.equal(calls.insert, 0);
  assert.deepEqual(calls.upload, ['visits/v1/p1.jpg']);
  assert.deepEqual(calls.gate, [{ id: 'p1', visit_id: 'v1', kind: 'gate', path: 'visits/v1/p1.jpg', lat: 30, lng: 31 }]);
});

test('a 23505 on the visit insert re-fetches the row and uploads the gate photo once', async () => {
  const { calls, deps } = fakes([]);
  const dup = Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
  const res = await completeGate(args(dup), deps);
  assert.equal(res.k, 'ready');
  assert.equal(calls.fetch, 1);
  assert.equal(calls.upload.length, 1);
  assert.equal(calls.gate.length, 1);
});

test('checkin_reason_required after the photo returns the decision; the retry inserts again', async () => {
  const { calls, deps } = fakes([{ data: visit, error: null }]);
  const refused = Promise.resolve({ data: null, error: { message: 'checkin_reason_required:200' } });
  const first = await completeGate(args(refused), deps);
  assert.deepEqual(first, { k: 'fence', decision: { k: 'reason', distance: 200 } });
  assert.equal(calls.upload.length, 0, 'no upload before a row exists');

  const retry = await completeGate(args(null), deps);          // GateStep consumed the tap's promise
  assert.equal(retry.k, 'ready');
  assert.equal(calls.insert, 1);
  assert.equal(calls.upload.length, 1);
});

test('any other insert error throws so the photo is kept for a retry', async () => {
  const { calls, deps } = fakes([]);
  const net = Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
  await assert.rejects(completeGate(args(net), deps), { message: 'Failed to fetch' });
  assert.equal(calls.upload.length, 0);
});

test('an existing visit skips the insert', async () => {
  const { calls, deps } = fakes([]);
  const res = await completeGate({ ...args(null), existing: visit }, deps);
  assert.equal(res.k, 'ready');
  assert.equal(calls.insert, 0);
  assert.equal(calls.upload.length, 1);
});
