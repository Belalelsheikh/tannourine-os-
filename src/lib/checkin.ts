import { fenceError, type CheckinDecision } from './geofence.ts';
import type { Visit } from './types';

/**
 * Create the visit row at check-in (Batch A7). The id is generated once on the client, so a
 * retry is safe:
 *
 *   23505                        → the row landed but its response was lost: re-fetch it
 *   checkin_blocked / _reason    → no row was created; hand the decision back
 */

/** supabase-js resolves `{ data, error }`; network failures are folded into `error`, never thrown. */
export interface InsertResult { data: Visit | null; error: { code?: string; message: string } | null; }

export interface CheckinDeps {
  insertVisit: () => Promise<InsertResult>;
  fetchVisit: () => Promise<Visit>;
}

export type CheckinResult = { k: 'ready'; visit: Visit } | { k: 'fence'; decision: CheckinDecision };

export async function createVisit(d: CheckinDeps): Promise<CheckinResult> {
  const ins = await d.insertVisit();
  if (ins.error?.code === '23505') return { k: 'ready', visit: await d.fetchVisit() };
  if (ins.error) {
    const decision = fenceError(ins.error.message);
    if (decision) return { k: 'fence', decision };
    throw ins.error;
  }
  if (!ins.data) throw new Error('ما رجعش صف الزيارة');
  return { k: 'ready', visit: ins.data };
}
