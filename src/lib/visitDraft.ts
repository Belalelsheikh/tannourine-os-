import type { PhotoKind, Visit, ZeroReason } from './types';

/**
 * The open visit's form, mirrored to localStorage so a refresh, an app switch, a PWA update
 * or a killed tab gives every number back (Batch A1). The visit row itself is already on the
 * server; the draft only carries what the coordinator typed and which photos are uploaded.
 */

export interface DraftLine { shelf: number | null; warehouse: number | null; sold: number | null; reason: ZeroReason | null; }
export interface DraftPhoto { id: string; path: string; kind: PhotoKind; }

export interface VisitDraft {
  v: 1;
  visit_id: string;
  coordinator_id: string;
  outlet_id: number;
  lines: Record<string, DraftLine>;
  /** Already in storage — referenced by path, never re-uploaded. */
  photos: DraftPhoto[];
  saved_at: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const PREFIX = 'visit_draft:';
export const draftKey = (visitId: string) => `${PREFIX}${visitId}`;
/** Which visit form was on screen, so a reload lands back in it rather than on the route list. */
export const activeKey = (uid: string) => `visit_active:${uid}`;

export const blankLine = (): DraftLine => ({ shelf: null, warehouse: null, sold: null, reason: null });

/** Complete enough for the server: visit_lines is NOT NULL and a zero shelf needs a reason. */
export function lineComplete(l: DraftLine): boolean {
  return l.shelf !== null && l.warehouse !== null && l.sold !== null && (l.shelf > 0 || l.reason !== null);
}

export const lineTouched = (l: DraftLine) =>
  l.shelf !== null || l.warehouse !== null || l.sold !== null || l.reason !== null;

export function parseDraft(raw: string | null): VisitDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<VisitDraft>;
    if (d.v !== 1 || typeof d.visit_id !== 'string' || typeof d.coordinator_id !== 'string'
      || typeof d.lines !== 'object' || d.lines == null || !Array.isArray(d.photos)) return null;
    return d as VisitDraft;
  } catch {
    return null;
  }
}

/** Restore only onto the caller's own visit while it is still open. */
export function restorable(d: VisitDraft | null, visit: Pick<Visit, 'id' | 'coordinator_id' | 'checkout_at'>, uid: string): d is VisitDraft {
  return d != null && d.visit_id === visit.id && d.coordinator_id === uid
    && visit.coordinator_id === uid && visit.checkout_at == null;
}

// Storage can throw (private mode, quota); a lost draft must never break the visit itself.
const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export const loadDraft = (s: Store, visitId: string) => safe(() => parseDraft(s.getItem(draftKey(visitId))), null);
export const saveDraft = (s: Store, d: VisitDraft) => safe(() => { s.setItem(draftKey(d.visit_id), JSON.stringify(d)); return true; }, false);
export const clearDraft = (s: Store, visitId: string) => safe(() => s.removeItem(draftKey(visitId)), undefined);

export function draftVisitIds(s: Store): string[] {
  return safe(() => {
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }, []);
}

/**
 * Drop drafts whose visit is no longer open for this coordinator (submitted, or closed by a
 * supervisor). A gate draft may belong to a visit whose insert never reached the server, so
 * it goes only once that visit is known closed, or after a day.
 */
export function pruneDrafts(s: Store, openVisitIds: Set<string>, closedVisitIds = new Set<string>(), now = Date.now()): void {
  for (const id of draftVisitIds(s)) if (!openVisitIds.has(id)) clearDraft(s, id);
  for (const id of gateDraftVisitIds(s)) {
    if (openVisitIds.has(id)) continue;
    const d = loadGateDraft(s, id);
    if (!d || closedVisitIds.has(id) || now - Date.parse(d.saved_at) > GATE_DRAFT_TTL_MS) clearGateDraft(s, id);
  }
}

/**
 * The check-in in flight (Batch A5), written on the camera tap before the visit insert is
 * acknowledged. If the browser is killed in the camera before the insert lands, a reload
 * reopens the gate step with the same ids, outlet and check-in time instead of the route list.
 */
export interface GateDraft {
  v: 1;
  visit_id: string;
  photo_id: string;
  coordinator_id: string;
  outlet_id: number;
  checkin_at: string;
  off_route: boolean;
  reason: string;
  pos: { lat: number; lng: number } | null;
  saved_at: string;
}

const GATE_PREFIX = 'gate_draft:';
const GATE_DRAFT_TTL_MS = 24 * 3600 * 1000;
export const gateDraftKey = (visitId: string) => `${GATE_PREFIX}${visitId}`;

export function parseGateDraft(raw: string | null): GateDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<GateDraft>;
    if (d.v !== 1 || typeof d.visit_id !== 'string' || typeof d.photo_id !== 'string'
      || typeof d.coordinator_id !== 'string' || typeof d.outlet_id !== 'number'
      || typeof d.checkin_at !== 'string' || typeof d.saved_at !== 'string') return null;
    return d as GateDraft;
  } catch {
    return null;
  }
}

export const loadGateDraft = (s: Store, visitId: string) => safe(() => parseGateDraft(s.getItem(gateDraftKey(visitId))), null);
export const saveGateDraft = (s: Store, d: GateDraft) => safe(() => { s.setItem(gateDraftKey(d.visit_id), JSON.stringify(d)); return true; }, false);
export const clearGateDraft = (s: Store, visitId: string) => safe(() => s.removeItem(gateDraftKey(visitId)), undefined);

export function gateDraftVisitIds(s: Store): string[] {
  return safe(() => {
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(GATE_PREFIX)) out.push(k.slice(GATE_PREFIX.length));
    }
    return out;
  }, []);
}
