import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankLine, clearDraft, draftKey, draftVisitIds, lineComplete, loadDraft, parseDraft,
  pruneDrafts, restorable, saveDraft, type VisitDraft,
} from '../src/lib/visitDraft.ts';

class MemStore {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const draft = (p: Partial<VisitDraft> = {}): VisitDraft => ({
  v: 1, visit_id: 'v1', coordinator_id: 'c1', outlet_id: 0,
  lines: { A: { shelf: 0, warehouse: 4, sold: 1, reason: 'المخزن فاضي' } },
  photos: [{ id: 'p1', path: 'visits/v1/p1.jpg', kind: 'shelf' }],
  saved_at: '2026-10-28T10:00:00Z',
  ...p,
});

test('a saved draft round-trips under visit_draft:<visit_id>', () => {
  const s = new MemStore();
  saveDraft(s, draft());
  assert.ok(s.getItem(draftKey('v1')));
  assert.deepEqual(loadDraft(s, 'v1'), draft());
  clearDraft(s, 'v1');
  assert.equal(loadDraft(s, 'v1'), null);
});

test('garbage and old shapes are ignored, not thrown', () => {
  assert.equal(parseDraft('{not json'), null);
  assert.equal(parseDraft(JSON.stringify({ v: 2, visit_id: 'v1' })), null);
  assert.equal(parseDraft(null), null);
});

test('restores only onto the same coordinator\'s still-open visit', () => {
  const v = { id: 'v1', coordinator_id: 'c1', checkout_at: null };
  assert.equal(restorable(draft(), v, 'c1'), true);
  assert.equal(restorable(draft(), v, 'c2'), false);
  assert.equal(restorable(draft(), { ...v, checkout_at: '2026-10-28T11:00:00Z' }, 'c1'), false);
  assert.equal(restorable(draft({ visit_id: 'v9' }), v, 'c1'), false);
});

test('a line is server-ready only when every field is set and a zero shelf has a reason', () => {
  assert.equal(lineComplete(blankLine()), false);
  assert.equal(lineComplete({ shelf: 0, warehouse: 2, sold: 0, reason: null }), false);
  assert.equal(lineComplete({ shelf: 0, warehouse: 2, sold: 0, reason: 'مساحة الرف' }), true);
  assert.equal(lineComplete({ shelf: 3, warehouse: 0, sold: 0, reason: null }), true);
});

test('pruneDrafts drops drafts for visits that are no longer open', () => {
  const s = new MemStore();
  saveDraft(s, draft({ visit_id: 'open' }));
  saveDraft(s, draft({ visit_id: 'closed' }));
  s.setItem('tn_gps_notice_seen', '1');
  pruneDrafts(s, new Set(['open']));
  assert.deepEqual(draftVisitIds(s), ['open']);
  assert.equal(s.getItem('tn_gps_notice_seen'), '1');
});
