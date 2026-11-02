import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeGate, type GateDeps, type InsertResult } from '../src/lib/gateCheckin.ts';
import type { Visit } from '../src/lib/types';
import {
  CAMERA_PERMISSION_HINT, cameraErrorText, fileAgeSeconds, fileFresh, sha256Hex, type GatePhotoMeta,
} from '../src/lib/gatePhoto.ts';

const visit = { id: 'v1', coordinator_id: 'c1', outlet_id: 0, checkin_at: '2026-10-29T08:00:00Z' } as Visit;
const photo = new Blob(['jpeg']);
const live = { source: 'live' as const, file_age_s: null, sha256: 'abc' };
const args = (pending: Promise<InsertResult> | null, meta: GatePhotoMeta = live) => ({
  visitId: 'v1', existing: null, pending, photo, meta, path: 'visits/v1/p1.jpg', photoId: 'p1', pos: { lat: 30, lng: 31 },
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
  assert.deepEqual(calls.gate, [{
    id: 'p1', visit_id: 'v1', kind: 'gate', path: 'visits/v1/p1.jpg', lat: 30, lng: 31,
    source: 'live', file_age_s: null, sha256: 'abc',
  }]);
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

// ---------- gate photo source (Batch A6) ----------

test('a file-fallback photo records its source and age on the gate row', async () => {
  const { calls, deps } = fakes([]);
  const meta = { source: 'file' as const, file_age_s: 14, sha256: 'def' };
  await completeGate(args(Promise.resolve({ data: visit, error: null }), meta), deps);
  assert.deepEqual(calls.gate, [{
    id: 'p1', visit_id: 'v1', kind: 'gate', path: 'visits/v1/p1.jpg', lat: 30, lng: 31, ...meta,
  }]);
});

test('a 23505 replay still carries the source', async () => {
  const { calls, deps } = fakes([]);
  const dup = Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
  await completeGate(args(dup, { source: 'file', file_age_s: 3, sha256: null }), deps);
  assert.equal((calls.gate[0] as { source: string }).source, 'file');
});

test('a file is fresh only within 2 minutes of the pick, allowing a minute of clock skew', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  assert.equal(fileAgeSeconds(now - 30_000, now), 30);
  assert.equal(fileFresh(fileAgeSeconds(now - 30_000, now)), true);     // camera capture
  assert.equal(fileFresh(fileAgeSeconds(now - 121_000, now)), false);   // gallery pick
  assert.equal(fileFresh(fileAgeSeconds(now + 50_000, now)), true);     // phone clock behind
  assert.equal(fileFresh(fileAgeSeconds(now + 90_000, now)), false);
  assert.equal(fileFresh(fileAgeSeconds(0, now)), false);               // lastModified missing
});

test('camera errors map to Arabic text; a refusal shows the Chrome permission path', () => {
  assert.equal(cameraErrorText('NotAllowedError'), CAMERA_PERMISSION_HINT);
  assert.match(cameraErrorText('NotReadableError'), /مشغولة/);
  assert.match(cameraErrorText('NotFoundError'), /مش لاقي/);
  assert.match(cameraErrorText(undefined), /مش بيفتح/);
});

test('sha256Hex is the hex digest of the bytes', async () => {
  assert.equal(await sha256Hex(new Blob(['abc'])),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
