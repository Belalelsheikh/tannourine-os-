import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVisit, type InsertResult } from '../src/lib/checkin.ts';
import type { Visit } from '../src/lib/types';

const visit = { id: 'v1', coordinator_id: 'c1', outlet_id: 0, checkin_at: '2026-11-05T08:00:00Z' } as Visit;

const run = (answer: InsertResult) => {
  let fetched = 0;
  return {
    result: createVisit({
      insertVisit: async () => answer,
      fetchVisit: async () => { fetched++; return visit; },
    }),
    fetched: () => fetched,
  };
};

test('a new visit is ready straight after the insert', async () => {
  const r = run({ data: visit, error: null });
  assert.deepEqual(await r.result, { k: 'ready', visit });
  assert.equal(r.fetched(), 0);
});

test('23505: the row landed and its response was lost, so it is re-fetched', async () => {
  const r = run({ data: null, error: { code: '23505', message: 'duplicate key' } });
  assert.deepEqual(await r.result, { k: 'ready', visit });
  assert.equal(r.fetched(), 1);
});

test('the fence trigger hands back a decision, not an error', async () => {
  const blocked = run({ data: null, error: { message: 'checkin_blocked:420' } });
  assert.deepEqual(await blocked.result, { k: 'fence', decision: { k: 'blocked', distance: 420 } });
  const reason = run({ data: null, error: { message: 'checkin_reason_required:200' } });
  assert.deepEqual(await reason.result, { k: 'fence', decision: { k: 'reason', distance: 200 } });
});

test('any other failure is thrown so the screen can offer a retry', async () => {
  await assert.rejects(run({ data: null, error: { message: 'network' } }).result);
  await assert.rejects(run({ data: null, error: null }).result);
});
