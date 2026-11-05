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

export type LineField = 'shelf' | 'warehouse' | 'sold' | 'reason';

/**
 * The first gap in form order (A6), so the error can name the SKU and the field instead of
 * «في خانات فاضية». A missing line counts as blank.
 */
export function firstIncomplete(
  lines: Record<string, DraftLine>, skus: { id: string }[],
): { skuId: string; field: LineField } | null {
  for (const s of skus) {
    const l = lines[s.id] ?? blankLine();
    if (l.shelf === null) return { skuId: s.id, field: 'shelf' };
    if (l.warehouse === null) return { skuId: s.id, field: 'warehouse' };
    if (l.sold === null) return { skuId: s.id, field: 'sold' };
    if (l.shelf === 0 && l.reason === null) return { skuId: s.id, field: 'reason' };
  }
  return null;
}

/** The «الصنف مش في الفرع» shortcut: all zero, branch didn't order. */
export const NOT_STOCKED: DraftLine = { shelf: 0, warehouse: 0, sold: 0, reason: 'الفرع لم يطلب' };
export const isNotStocked = (l: DraftLine) =>
  l.shelf === 0 && l.warehouse === 0 && l.sold === 0 && l.reason === NOT_STOCKED.reason;

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
 * supervisor), plus any `gate_draft:` key left on a phone from before Batch A7 removed the
 * gate photo.
 */
export function pruneDrafts(s: Store, openVisitIds: Set<string>): void {
  for (const id of draftVisitIds(s)) if (!openVisitIds.has(id)) clearDraft(s, id);
  safe(() => {
    const stale: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith('gate_draft:')) stale.push(k);
    }
    stale.forEach((k) => s.removeItem(k));
  }, undefined);
}
