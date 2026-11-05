import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { getPosition, type Coords } from '../../lib/geo';
import { blockedText, checkinDecision, type CheckinDecision } from '../../lib/geofence';
import { createVisit, type InsertResult } from '../../lib/checkin';
import { ErrLine, Field, Hint } from '../../components/ui';
import type { Outlet, Visit } from '../../lib/types';

/**
 * Check-in (Batch A7): GPS fix → fence → visit row → the count form. There is no photo at
 * check-in any more (the gate photo was removed on 2026-11-05 after repeated camera failures).
 * Within the fence, or with no pin or no GPS fix, the visit opens with no further tap.
 */
export default function CheckinStep({
  outlet, offRoute, onReady, onCancel,
}: {
  outlet: Outlet;
  offRoute: boolean;
  onReady: (visit: Visit) => void;
  onCancel: () => void;
}) {
  const { profile } = useApp();
  // Stable across retries, so a lost response can never open a second visit.
  const visitId = useRef(crypto.randomUUID());
  const checkinAt = useRef(new Date().toISOString());
  const autoStarted = useRef(false);

  const [pos, setPos] = useState<Coords | null | undefined>(undefined);
  const [decision, setDecision] = useState<CheckinDecision | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locate = async () => {
    setPos(undefined);
    setErr(null);
    autoStarted.current = false;
    const p = await getPosition();           // null is fine — GPS denial never blocks
    setPos(p);
    setDecision(checkinDecision(outlet, p));
  };
  useEffect(() => { void locate(); }, []);

  const checkIn = async () => {
    if (!profile || pos === undefined || !decision) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await createVisit({
        // supabase-js builders are lazy: awaiting the single() call sends the request.
        insertVisit: async (): Promise<InsertResult> => {
          try {
            const r = await sb.from('visits').insert({
              id: visitId.current,
              coordinator_id: profile.id,
              outlet_id: outlet.id,
              checkin_at: checkinAt.current,
              checkin_lat: pos?.lat ?? null,
              checkin_lng: pos?.lng ?? null,
              checkin_reason: decision.k === 'reason' ? reason.trim() : null,
              off_route: offRoute,
            }).select('*').single();
            return { data: r.data as Visit | null, error: r.error };
          } catch (e) {
            return { data: null, error: { message: errText(e) } };
          }
        },
        fetchVisit: async () => {
          const again = await sb.from('visits').select('*').eq('id', visitId.current).single();
          if (again.error) throw again.error;
          return again.data as Visit;
        },
      });
      if (res.k === 'fence') { setDecision(res.decision); return; }
      onReady(res.visit);
    } catch (e) {
      setErr(`ما اتسجلش: ${errText(e)} — اضغط حاول تاني`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (decision?.k !== 'ok' || autoStarted.current) return;
    autoStarted.current = true;
    void checkIn();
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
        <button className="ghost" onClick={onCancel}>رجوع</button>
      </>
    );
  }

  const needReason = decision.k === 'reason';
  const reasonOk = !needReason || reason.trim().length > 0;
  // While the automatic check-in is running there is nothing to press.
  const waiting = !needReason && !err;

  return (
    <>
      <Hint><b>{outlet.name}</b></Hint>
      {needReason && (
        <Field label={`إنت على بعد ${decision.distance} م من موقع الفرع المسجل — ليه؟`} required>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: الفرع جوه المول" />
        </Field>
      )}
      <ErrLine>{err}</ErrLine>
      {waiting ? (
        <p className="empty">جارٍ تسجيل الدخول…</p>
      ) : (
        <>
          <button className="send" disabled={busy || !reasonOk} onClick={() => void checkIn()}>
            {busy ? 'جارٍ التسجيل…' : err ? 'حاول تاني' : 'تسجيل الدخول'}
          </button>
          <button className="ghost" onClick={onCancel} disabled={busy}>رجوع</button>
        </>
      )}
    </>
  );
}
