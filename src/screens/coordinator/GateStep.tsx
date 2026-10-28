import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText, BUCKET_VISITS } from '../../lib/supabase';
import { getPosition, type Coords } from '../../lib/geo';
import { blockedText, checkinDecision, fenceError, type CheckinDecision } from '../../lib/geofence';
import { VISIT_PHOTO_EDGE, compressImage, insertVisitPhoto, uploadPhoto, visitPhotoPath } from '../../lib/photo';
import { ErrLine, Field, Hint } from '../../components/ui';
import type { Outlet, Visit } from '../../lib/types';

/**
 * Check-in (Batch A3/A4): GPS fix → fence → camera-only gate photo → the count form.
 *
 * The visit id is minted here so the gate photo can be uploaded under `visits/<id>/` before
 * the row exists; the visit and its gate row then land together. An `existing` visit (opened
 * before the app was killed, or before Batch A) skips the fence and only needs the photo.
 * Every step is replayable: the compressed photo and the id survive a failed attempt.
 */
export default function GateStep({
  outlet, offRoute, existing, onReady, onCancel,
}: {
  outlet: Outlet;
  offRoute: boolean;
  existing: Visit | null;
  onReady: (visit: Visit) => void;
  onCancel: () => void;
}) {
  const { profile } = useApp();
  const visitId = useRef(existing?.id ?? crypto.randomUUID());
  const photoId = useRef(crypto.randomUUID());
  const checkinAt = useRef(existing?.checkin_at ?? new Date().toISOString());
  const inputRef = useRef<HTMLInputElement>(null);

  const [pos, setPos] = useState<Coords | null | undefined>(undefined);
  const [decision, setDecision] = useState<CheckinDecision | null>(null);
  const [reason, setReason] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
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
  useEffect(() => { void locate(); }, []);

  useEffect(() => {
    if (!blob) { setPreview(null); return; }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const checkIn = async (photo: Blob) => {
    if (!profile || pos === undefined) return;
    setErr(null);
    setBusy(true);
    const path = visitPhotoPath(visitId.current, photoId.current);
    try {
      await uploadPhoto(BUCKET_VISITS, path, photo);

      let visit = existing;
      if (!visit) {
        const ins = await sb.from('visits').insert({
          id: visitId.current,
          coordinator_id: profile.id,
          outlet_id: outlet.id,
          checkin_at: checkinAt.current,
          checkin_lat: pos?.lat ?? null,
          checkin_lng: pos?.lng ?? null,
          checkin_reason: decision?.k === 'reason' ? reason.trim() : null,
          off_route: offRoute,
        }).select('*').single();
        if (ins.error && ins.error.code === '23505') {
          // The first attempt landed but its response was lost.
          const again = await sb.from('visits').select('*').eq('id', visitId.current).single();
          if (again.error) throw again.error;
          visit = again.data as Visit;
        } else if (ins.error) {
          const fence = fenceError(errText(ins.error));
          if (fence) { setDecision(fence); setBusy(false); return; }
          throw ins.error;
        } else visit = ins.data as Visit;
      }

      await insertVisitPhoto({
        id: photoId.current, visit_id: visit.id, kind: 'gate', path,
        lat: pos?.lat ?? null, lng: pos?.lng ?? null,
      });
      onReady(visit);
    } catch (e) {
      setErr(`ما اتسجلش: ${errText(e)} — الصورة محفوظة، اضغط حاول تاني`);
    } finally {
      setBusy(false);
    }
  };

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
        <button className="ghost" onClick={onCancel}>رجوع</button>
      </>
    );
  }

  const needReason = decision.k === 'reason';
  const reasonOk = !needReason || reason.trim().length > 0;

  return (
    <>
      <Hint>
        <b>{outlet.name}</b> — {existing ? 'كمّل الزيارة: ' : ''}صوّر باب الفرع الأول
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
          try {
            const b = await compressImage(file, VISIT_PHOTO_EDGE);
            setBlob(b);
            await checkIn(b);
          } catch (er) {
            setErr(er instanceof Error ? er.message : 'فشل تجهيز الصورة');
          }
        }}
      />

      <ErrLine>{err}</ErrLine>
      {blob && err ? (
        <button className="send" disabled={busy || !reasonOk} onClick={() => void checkIn(blob)}>
          {busy ? 'جارٍ التسجيل…' : 'حاول تاني'}
        </button>
      ) : (
        <button
          type="button"
          className="photo"
          disabled={busy || !reasonOk}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'جارٍ التسجيل…' : '📷 صورة باب الفرع (إجباري — كاميرا فقط)'}
        </button>
      )}
      <button className="ghost" onClick={onCancel} disabled={busy}>رجوع</button>
    </>
  );
}
