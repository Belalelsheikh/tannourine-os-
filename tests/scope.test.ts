import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorsInScope, usingGovFallback } from '../src/lib/scope.ts';
import { historyCoordinators } from '../src/lib/visitsHistory.ts';
import type { Profile, Scope } from '../src/lib/types.ts';

const prof = (id: string, role: Profile['role'], scope: Scope, p: Partial<Profile> = {}): Profile => ({
  id, full_name: id, role, scope, supervisor_id: null, active: true, created_at: '', ...p,
});

const marwa = prof('marwa', 'router', 'الكل');
const hossam = prof('hossam', 'supervisor', 'القاهرة');
const alex = prof('alex', 'coordinator', 'الإسكندرية', { supervisor_id: 'marwa' });
const nada = prof('nada', 'coordinator', 'القاهرة', { supervisor_id: 'hossam' });
const loose = prof('loose', 'coordinator', 'القاهرة');
const gone = prof('gone', 'coordinator', 'الإسكندرية', { supervisor_id: 'marwa', active: false });
const all = [marwa, hossam, alex, nada, loose, gone];

test('a router supervises only her assigned coordinators, despite scope الكل', () => {
  assert.deepEqual(coordinatorsInScope(marwa, all).map((p) => p.id), ['alex']);
  assert.deepEqual(coordinatorsInScope(marwa, all, { includeInactive: true }).map((p) => p.id), ['alex', 'gone']);
});

test('a router with no assigned coordinators gets nobody, not the governorate fallback', () => {
  assert.deepEqual(coordinatorsInScope(prof('r2', 'router', 'القاهرة'), all), []);
  assert.equal(usingGovFallback(prof('r2', 'router', 'القاهرة'), all), false);
});

test('a router\'s visit history stays scope-based', () => {
  assert.deepEqual(historyCoordinators(marwa, all).map((p) => p.id), ['alex', 'nada', 'loose', 'gone']);
});

test('supervisors are unchanged', () => {
  assert.deepEqual(coordinatorsInScope(hossam, all).map((p) => p.id), ['nada']);
  assert.equal(usingGovFallback(hossam, all), false);
});
