import { fenceError, type CheckinDecision } from './geofence.ts';
import type { Coords } from './geo.ts';
import type { Visit } from './types';

/**
 * Check-in after the gate photo returns (Batch A5). For a new visit the insert was already
 * sent on the camera tap (`pending`), so the row exists even if the browser is killed in the
 * camera; here we only wait for it, then upload the photo and record the gate row.
 *
 *   23505 on the insert          → the row landed but its response was lost: re-fetch it
 *   checkin_blocked / _reason    → no row was created; hand the decision back, keep the photo,
 *                                  and the retry inserts again
 */

/** supabase-js resolves `{ data, error }`; network failures are folded into `error`, never thrown. */
export interface InsertResult { data: Visit | null; error: { code?: string; message: string } | null; }

export interface GateDeps {
  insertVisit: () => Promise<InsertResult>;
  fetchVisit: (id: string) => Promise<Visit>;
  uploadPhoto: (path: string, blob: Blob) => Promise<void>;
  insertGatePhoto: (row: { id: string; visit_id: string; kind: 'gate'; path: string; lat: number | null; lng: number | null }) => Promise<unknown>;
}

export type GateResult = { k: 'ready'; visit: Visit } | { k: 'fence'; decision: CheckinDecision };

export async function completeGate(
  a: {
    visitId: string;
    existing: Visit | null;
    /** The insert started on the camera tap; null on a retry, which inserts again. */
    pending: Promise<InsertResult> | null;
    photo: Blob;
    path: string;
    photoId: string;
    pos: Coords | null;
  },
  d: GateDeps,
): Promise<GateResult> {
  let visit = a.existing;
  if (!visit) {
    const ins = await (a.pending ?? d.insertVisit());
    if (ins.error?.code === '23505') visit = await d.fetchVisit(a.visitId);
    else if (ins.error) {
      const decision = fenceError(ins.error.message);
      if (decision) return { k: 'fence', decision };
      throw ins.error;
    } else if (!ins.data) throw new Error('ما رجعش صف الزيارة');
    else visit = ins.data;
  }

  await d.uploadPhoto(a.path, a.photo);
  await d.insertGatePhoto({
    id: a.photoId, visit_id: visit.id, kind: 'gate', path: a.path,
    lat: a.pos?.lat ?? null, lng: a.pos?.lng ?? null,
  });
  return { k: 'ready', visit };
}
