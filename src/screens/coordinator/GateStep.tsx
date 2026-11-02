import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText, BUCKET_VISITS } from '../../lib/supabase';
import { getPosition, type Coords } from '../../lib/geo';
import { blockedText, checkinDecision, type CheckinDecision } from '../../lib/geofence';
import { VISIT_PHOTO_EDGE, compressImage, insertVisitPhoto, uploadPhoto, visitPhotoPath } from '../../lib/photo';
import { completeGate, type InsertResult } from '../../lib/gateCheckin';
import {
  STALE_FILE_TEXT, cameraErrorText, fileAgeSeconds, fileFresh, sha256Hex, type GatePhotoMeta,
} from '../../lib/gatePhoto';
import LiveCamera from '../../components/LiveCamera';
import { clearGateDraft, saveGateDraft, type GateDraft } from '../../lib/visitDraft';
import { ErrLine, Field, Hint } from '../../components/ui';
import type { Outlet, Visit } from '../../lib/types';

/**
 * Check-in (Batch A3/A4/A5/A6): GPS fix → fence → camera-only gate photo → the count form.
 *
 * The gate photo comes from the in-page camera (A6, LiveCamera): a file input's `capture` is
 * only a hint and some browsers offer the gallery through it. Only when getUserMedia fails is
 * the file input shown, after the permission hint; its photo must be fresh by lastModified
 * and is tagged `source = 'file'` for the supervisor. There is no input without `capture`.
 *
 * The visit row is inserted on the camera tap, before the camera opens (A5): phones kill the
 * page while the camera app holds the memory, and a visit that only existed in this component
 * vanished with it. With the row (and `visit_active`) already written, the reload lands back
 * here through RouteToday's resume() with `existing` set. A `draft` covers a kill between the
 * tap and the server ack: same ids, outlet and check-in time, and the insert is sent again.
 * Every step is replayable: the compressed photo and the ids survive a failed attempt.
 */
export default function GateStep({
  outlet, offRoute, existing, draft, onStart, onReady, onCancel,
}: {
  outlet: Outlet;
  offRoute: boolean;
  existing: Visit | null;
  draft: GateDraft | null;
  /** Marks this visit as the one on screen, so a reload comes back to it. */
  onStart: (visitId: string) => void;
  onReady: (visit: Visit) => void;
  onCancel: () => void;
}) {
  const { profile } = useApp();
  const visitId = useRef(existing?.id ?? draft?.visit_id ?? crypto.randomUUID());
  const photoId = useRef(draft?.photo_id ?? crypto.randomUUID());
  const checkinAt = useRef(existing?.checkin_at ?? draft?.checkin_at ?? new Date().toISOString());
  const inputRef = useRef<HTMLInputElement>(null);
  /** The visit insert sent on the camera tap; consumed by checkIn, so a retry inserts again. */
  const pending = useRef<Promise<InsertResult> | null>(null);

  const [pos, setPos] = useState<Coords | null | undefined>(undefined);
  const [decision, setDecision] = useState<CheckinDecision | null>(null);
  const [reason, setReason] = useState(draft?.reason ?? '');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [meta, setMeta] = useState<GatePhotoMeta | null>(null);
  /** idle → live (in-page camera open) → fallback (camera refused: hint + file input). */
  const [mode, setMode] = useState<'idle' | 'live' | 'fallback'>('idle');
  const [camErr, setCamErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locate = async () => {
    setPos(undefined);
    setErr(null);
    const p = existing
      ? (existing.checkin_lat != null && existing.checkin_lng != null
        ? { lat: existing.checkin_lat, lng: existing.checkin_lng } : null)
      : await getPosition();                 // null is fine — GPS denial never blocks
    setPos(p);
    setDecision(existing ? { k: 'ok', distance: null } : checkinDecision(outlet, p));
  };
  useEffect(() => {
    // A recovered tap keeps the fix it was taken with.
    if (draft && !existing) { setPos(draft.pos); setDecision(checkinDecision(outlet, draft.pos)); }
    else void locate();
  }, []);

  useEffect(() => {
    if (!blob) { setPreview(null); return; }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // supabase-js builders are lazy: Promise.resolve() sends the request now, not on first await.
  const insertVisit = (): Promise<InsertResult> => {
    const row = {
      id: visitId.current,
      coordinator_id: profile!.id,
      outlet_id: outlet.id,
      checkin_at: checkinAt.current,
      checkin_lat: pos?.lat ?? null,
      checkin_lng: pos?.lng ?? null,
      checkin_reason: decision?.k === 'reason' ? reason.trim() : null,
      off_route: offRoute,
    };
    return Promise.resolve(sb.from('visits').insert(row).select('*').single()).then(
      (r) => ({ data: r.data as Visit | null, error: r.error }),
      (e) => ({ data: null, error: { message: errText(e) } }),
    );
  };

  /** First camera tap: mark the visit active and send the insert (A5). Later taps no-op. */
  const startCheckin = () => {
    if (existing || pending.current || !profile || pos === undefined) return;
    saveGateDraft(localStorage, {
      v: 1, visit_id: visitId.current, photo_id: photoId.current, coordinator_id: profile.id,
      outlet_id: outlet.id, checkin_at: checkinAt.current, off_route: offRoute,
      reason: reason.trim(), pos, saved_at: new Date().toISOString(),
    });
    onStart(visitId.current);
    pending.current = insertVisit();
  };

  const openCamera = () => {
    startCheckin();
    setCamErr(null);
    setMode('live');
  };

  /** Fallback only: the input's click() must stay synchronous inside the tap (iOS). */
  const openFileCamera = () => {
    inputRef.current?.click();
    startCheckin();
  };

  const checkIn = async (photo: Blob, m: GatePhotoMeta) => {
    if (!profile || pos === undefined) return;
    setErr(null);
    setBusy(true);
    const tap = pending.current;
    pending.current = null;
    try {
      const res = await completeGate({
        visitId: visitId.current, existing, pending: tap, photo, meta: m,
        path: visitPhotoPath(visitId.current, photoId.current), photoId: photoId.current, pos,
      }, {
        insertVisit,
        fetchVisit: async (id) => {
          // The first attempt landed but its response was lost.
          const again = await sb.from('visits').select('*').eq('id', id).single();
          if (again.error) throw again.error;
          return again.data as Visit;
        },
        uploadPhoto: (path, b) => uploadPhoto(BUCKET_VISITS, path, b),
        insertGatePhoto: insertVisitPhoto,
      });
      if (res.k === 'fence') { setDecision(res.decision); return; }
      clearGateDraft(localStorage, visitId.current);
      onReady(res.visit);
    } catch (e) {
      setErr(`ما اتسجلش: ${errText(e)} — الصورة محفوظة، اضغط حاول تاني`);
    } finally {
      setBusy(false);
    }
  };

  // «رجوع» before a photo leaves the row as an open visit (no deletes); wait briefly for an
  // insert in flight so the open-visit banner sees it.
  const cancel = async () => {
    setBusy(true);
    clearGateDraft(localStorage, visitId.current);
    const tap = pending.current;
    if (tap) await Promise.race([tap, new Promise((r) => setTimeout(r, 5000))]);
    onCancel();
  };

  const takePhoto = async (b: Blob, m: Omit<GatePhotoMeta, 'sha256'>) => {
    const full = { ...m, sha256: await sha256Hex(b).catch(() => null) };
    setBlob(b);
    setMeta(full);
    setMode('idle');
    await checkIn(b, full);
  };

  // A resumed visit (killed page, or the tap's insert never acked) goes straight to the camera.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !(existing || draft) || blob || !decision || decision.k === 'blocked') return;
    resumed.current = true;
    if (decision.k === 'ok') openCamera();
  }, [decision]);

  if (pos === undefined || !decision) {
    return <><Hint><b>{outlet.name}</b></Hint><p className="empty">جارٍ تحديد الموقع…</p></>;
  }

  if (decision.k === 'blocked') {
    return (
      <>
        <Hint><b>{outlet.name}</b></Hint>
        <p className="err">{blockedText(decision.distance)}</p>
        <p className="small">موقع الفرع متأكد منه — قرّب من الفرع وحاول تاني.</p>
        <button className="send" onClick={() => void locate()}>حاول تاني</button>
        <button className="ghost" onClick={() => void cancel()} disabled={busy}>رجوع</button>
      </>
    );
  }

  const needReason = decision.k === 'reason';
  const reasonOk = !needReason || reason.trim().length > 0;

  return (
    <>
      <Hint>
        <b>{outlet.name}</b> — {existing || draft ? 'كمّل الزيارة: ' : ''}صوّر باب الفرع الأول
      </Hint>

      {needReason && (
        <Field label={`إنت على بعد ${decision.distance} م من موقع الفرع المسجل — ليه؟`} required>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: الفرع جوه المول" />
        </Field>
      )}

      {preview && <img className="thumb" src={preview} alt="صورة باب الفرع" />}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          // Before compressing: the re-encode drops everything that says when it was taken.
          const age = fileAgeSeconds(file.lastModified);
          if (!fileFresh(age)) { setErr(STALE_FILE_TEXT); return; }
          try {
            const b = await compressImage(file, VISIT_PHOTO_EDGE);
            await takePhoto(b, { source: 'file', file_age_s: age });
          } catch (er) {
            setErr(er instanceof Error ? er.message : 'فشل تجهيز الصورة');
          }
        }}
      />

      {mode === 'live' && !blob && (
        <LiveCamera
          maxEdge={VISIT_PHOTO_EDGE}
          onCapture={(b) => void takePhoto(b, { source: 'live', file_age_s: null })}
          onCancel={() => setMode('idle')}
          onError={(name) => { setCamErr(cameraErrorText(name)); setMode('fallback'); }}
        />
      )}

      {mode === 'fallback' && !blob && (
        <>
          <p className="err">{camErr}</p>
          <button type="button" className="send" disabled={busy || !reasonOk} onClick={openCamera}>
            حاول تاني
          </button>
          <button type="button" className="photo" disabled={busy || !reasonOk} onClick={openFileCamera}>
            📷 صوّر بكاميرا الموبايل
          </button>
          <p className="small">الصورة لازم تكون متصورة دلوقتي — المشرف هيشوف إنها اترفعت من ملف.</p>
        </>
      )}

      <ErrLine>{err}</ErrLine>
      {/* A taken photo is kept: a failed upload, or the server asking for a reason, never needs a retake. */}
      {blob && meta ? (
        <button className="send" disabled={busy || !reasonOk} onClick={() => void checkIn(blob, meta)}>
          {busy ? 'جارٍ التسجيل…' : err ? 'حاول تاني' : 'تسجيل الدخول'}
        </button>
      ) : mode === 'idle' && (
        <button
          type="button"
          className="photo"
          disabled={busy || !reasonOk}
          onClick={openCamera}
        >
          {busy ? 'جارٍ التسجيل…' : '📷 صورة باب الفرع (إجباري — كاميرا فقط)'}
        </button>
      )}
      {mode !== 'live' && <button className="ghost" onClick={() => void cancel()} disabled={busy}>رجوع</button>}
    </>
  );
}
