import { useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText, BUCKET_VISITS } from '../../lib/supabase';
import { uploadPhoto } from '../../lib/photo';
import {
  FAR_FROM_PIN_METRES, SHORT_VISIT_SECONDS, getPosition, haversine,
} from '../../lib/geo';
import { REASONS } from '../../lib/format';
import { ErrLine, Hint, PhotoPicker, Stepper } from '../../components/ui';
import type { Outlet, Visit, ZeroReason } from '../../lib/types';

interface LineState { shelf: number | null; warehouse: number | null; sold: number | null; reason: ZeroReason | null; }
const blankLine = (): LineState => ({ shelf: null, warehouse: null, sold: null, reason: null });

/**
 * Stock check for an already-checked-in visit. Submitting is the checkout.
 * The whole pipeline is replayable: a failure keeps every field and the photo
 * in state so «حاول تاني» resumes exactly where it stopped (PRD §15.9).
 */
export default function VisitForm({
  visit, outlet, onDone, onCancel,
}: { visit: Visit; outlet: Outlet; onDone: (zeroCount: number) => void; onCancel: () => void }) {
  const { skus, toast } = useApp();
  const [lines, setLines] = useState<Record<string, LineState>>(
    () => Object.fromEntries(skus.map((s) => [s.id, blankLine()])),
  );
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (id: string, p: Partial<LineState>) =>
    setLines((prev) => {
      const next = { ...prev[id], ...p };
      // Leaving zero clears the reason chip — it no longer applies.
      if (p.shelf !== undefined && p.shelf !== 0) next.reason = null;
      return { ...prev, [id]: next };
    });

  const submit = async () => {
    setErr(null);
    for (const s of skus) {
      const l = lines[s.id];
      if (l.shelf === null || l.warehouse === null || l.sold === null) {
        setErr('في خانات فاضية — اكتب صفر لو مفيش');
        return;
      }
      if (l.shelf === 0 && !l.reason) {
        setErr('حدد سبب الصفر لكل صنف ناقص');
        return;
      }
    }
    if (!photo) { setErr('صورة الرف مطلوبة'); return; }

    setBusy(true);
    try {
      // 1) photo (upsert: a retry overwrites instead of colliding)
      const photoPath = `${visit.id}.jpg`;
      await uploadPhoto(BUCKET_VISITS, photoPath, photo);

      // 2) lines (upsert on the composite PK so a replay is idempotent)
      const rows = skus.map((s) => ({
        visit_id: visit.id,
        sku_id: s.id,
        shelf: lines[s.id].shelf as number,
        warehouse: lines[s.id].warehouse as number,
        sold_cases: lines[s.id].sold as number,
        zero_reason: lines[s.id].reason,
      }));
      const lineRes = await sb.from('visit_lines').upsert(rows, { onConflict: 'visit_id,sku_id' });
      if (lineRes.error) throw lineRes.error;

      // 3) checkout: second and final GPS read
      const pos = await getPosition();
      const checkoutAt = new Date();
      const dwell = Math.max(0, Math.round((checkoutAt.getTime() - new Date(visit.checkin_at).getTime()) / 1000));

      let distance: number | null = null;
      if (outlet.lat != null && outlet.lng != null && visit.checkin_lat != null && visit.checkin_lng != null) {
        distance = haversine(
          { lat: visit.checkin_lat, lng: visit.checkin_lng },
          { lat: outlet.lat, lng: outlet.lng },
        );
      }

      const flags: string[] = [];
      if (dwell < SHORT_VISIT_SECONDS) flags.push('short_visit');
      if (distance != null && distance > FAR_FROM_PIN_METRES) flags.push('far_from_pin');
      if (visit.checkin_lat == null) flags.push('no_checkin_gps');
      if (!pos) flags.push('no_checkout_gps');

      const upd = await sb.from('visits').update({
        checkout_at: checkoutAt.toISOString(),
        checkout_lat: pos?.lat ?? null,
        checkout_lng: pos?.lng ?? null,
        dwell_seconds: dwell,
        distance_m: distance,
        photo_path: photoPath,
        flags,
      }).eq('id', visit.id);
      if (upd.error) throw upd.error;

      // 4) follow-up for central/mixed outlets with zero shelf (PRD §10).
      // The visit is already committed by now, so a failure here must never roll it back —
      // but it must not be silent either: this row is the whole of مروه's تنبيهات queue,
      // and nothing else will ever re-attempt it.
      const zeroSkus = skus.filter((s) => lines[s.id].shelf === 0).map((s) => s.id);
      let followupWarning: string | null = null;
      if (zeroSkus.length > 0 && outlet.ordering_mode !== 'rep') {
        const existing = await sb.from('followups')
          .select('id').eq('outlet_id', outlet.id).eq('status', 'open').limit(1);
        if (existing.error) {
          followupWarning = errText(existing.error);
        } else if ((existing.data?.length ?? 0) === 0) {
          const ins = await sb.from('followups').insert({
            outlet_id: outlet.id, visit_id: visit.id, zero_skus: zeroSkus,
          });
          if (ins.error) followupWarning = errText(ins.error);
        }
      }

      if (followupWarning) {
        toast(`الزيارة اتبعتت — لكن التنبيه ما اتسجلش: ${followupWarning}. بلّغ المشرف.`);
      } else {
        toast(zeroSkus.length ? `اتسجل ${zeroSkus.length} صنف ناقص — المشرف هيشوفهم` : 'تم — كل الأصناف متوفرة');
      }
      onDone(zeroSkus.length);
    } catch (e) {
      setErr(`ما اتبعتش: ${errText(e)} — البيانات محفوظة، اضغط إرسال تاني`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Hint>
        <b>{outlet.name}</b> — اكتب صفر لو مفيش — ممنوع خانة فاضية
      </Hint>

      {skus.map((s) => {
        const l = lines[s.id];
        return (
          <div className="sku" key={s.id}>
            <h3>
              {s.name_ar}
              <span className="tag">{s.line === 'VIA' ? 'ڤيا' : ''}</span>
            </h3>
            <div className="fields">
              <div className="fcell">
                <label>رف <em>*</em></label>
                <Stepper allowEmpty value={l.shelf} onChange={(v) => patch(s.id, { shelf: v })} />
              </div>
              <div className="fcell">
                <label>مخزن <em>*</em></label>
                <Stepper allowEmpty value={l.warehouse} onChange={(v) => patch(s.id, { warehouse: v })} />
              </div>
              <div className="fcell span">
                <label>بيع من آخر زيارة (كرتونة) <em>*</em></label>
                <Stepper allowEmpty value={l.sold} onChange={(v) => patch(s.id, { sold: v })} />
              </div>
            </div>
            {l.shelf === 0 && (
              <div className="reason">
                <p>الرف صفر — حدد السبب</p>
                <div className="chips">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={l.reason === r}
                      onClick={() => patch(s.id, { reason: r })}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <PhotoPicker
        label="📷 صورة الرف (مطلوبة)"
        blob={photo}
        onPick={setPhoto}
        onError={(m) => setErr(m)}
      />

      <ErrLine>{err}</ErrLine>
      <button className="send" onClick={() => void submit()} disabled={busy}>
        {busy ? 'جارٍ الإرسال…' : 'إرسال'}
      </button>
      <button className="ghost" onClick={onCancel} disabled={busy}>رجوع (الزيارة تفضل مفتوحة)</button>
    </>
  );
}
