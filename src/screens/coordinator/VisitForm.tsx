import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText, BUCKET_VISITS } from '../../lib/supabase';
import {
  MAX_VISIT_PHOTOS, VISIT_PHOTO_EDGE, compressImage, insertVisitPhoto, uploadPhoto, visitPhotoPath,
} from '../../lib/photo';
import {
  FAR_FROM_PIN_METRES, SHORT_VISIT_SECONDS, getPosition, haversine,
} from '../../lib/geo';
import { PHOTO_KIND_LABEL, REASONS } from '../../lib/format';
import {
  blankLine, clearDraft, lineComplete, lineTouched, loadDraft, restorable, saveDraft,
  type DraftLine, type DraftPhoto,
} from '../../lib/visitDraft';
import { ErrLine, Hint, SecureImage, Segmented, Stepper } from '../../components/ui';
import LastVisit, { type LastVisitData } from './LastVisit';
import type { Outlet, PhotoKind, Visit, VisitLine, VisitPhoto } from '../../lib/types';

const DRAFT_DEBOUNCE_MS = 300;
/** Stepper ± taps never blur, so a complete line also syncs after a short pause. */
const LINE_SYNC_MS = 1500;

const EXTRA_KINDS: PhotoKind[] = ['shelf', 'cooler', 'other'];

/** Checkout-trigger errors, in the coordinator's words. */
function submitError(e: unknown): string {
  const t = errText(e);
  if (t.includes('gate_photo_required')) return 'صورة باب الفرع ناقصة — ارجع وادخل الزيارة تاني من «كمّل الزيارة»';
  if (t.includes('visit_incomplete')) return 'في أصناف ما اتسجلتش على السيرفر';
  return t;
}

/**
 * Stock check for a checked-in visit. Submitting is the checkout.
 *
 * Every keystroke is mirrored to localStorage (`visit_draft:<visit_id>`, 300 ms debounce) and
 * every complete line is upserted to visit_lines as the coordinator moves on, so a refresh, an
 * app switch or a killed tab loses nothing (Batch A1). Photos upload as they are taken and the
 * draft keeps only their paths. A failed submit keeps everything for «حاول تاني» (PRD §15.9).
 */
export default function VisitForm({
  visit, outlet, onDone, onCancel,
}: { visit: Visit; outlet: Outlet; onDone: (zeroCount: number) => void; onCancel: () => void }) {
  const { skus, profile, toast } = useApp();
  const uid = profile?.id ?? '';

  const [initial] = useState(() => {
    const d = loadDraft(localStorage, visit.id);
    return restorable(d, visit, uid) ? d : null;
  });
  const [restored] = useState(() => initial != null && (
    Object.values(initial.lines).some(lineTouched) || initial.photos.length > 0));
  const [lines, setLines] = useState<Record<string, DraftLine>>(() => Object.fromEntries(
    skus.map((s) => [s.id, initial?.lines[s.id] ?? blankLine()]),
  ));
  const [photos, setPhotos] = useState<DraftPhoto[]>(() => initial?.photos ?? []);
  const [kind, setKind] = useState<PhotoKind>('shelf');
  const [last, setLast] = useState<LastVisitData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);

  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  // ---------- server copies: last visit, lines and photos already saved ----------
  useEffect(() => {
    let alive = true;
    void sb.rpc('last_visit_for_outlet', { p_outlet: outlet.id }).then(({ data }) => {
      if (alive && data) setLast(data as LastVisitData);
    });
    // Another device, cleared storage, or a lost draft: the server copy fills whatever the
    // draft does not have, never overwriting what the coordinator typed.
    void sb.from('visit_lines').select('*').eq('visit_id', visit.id).then(({ data }) => {
      if (!alive || !data?.length) return;
      setLines((prev) => {
        const next = { ...prev };
        for (const r of data as VisitLine[]) {
          if (next[r.sku_id] && !lineTouched(next[r.sku_id])) {
            next[r.sku_id] = { shelf: r.shelf, warehouse: r.warehouse, sold: r.sold_cases, reason: r.zero_reason };
          }
        }
        return next;
      });
    });
    void sb.from('visit_photos').select('*').eq('visit_id', visit.id).neq('kind', 'gate')
      .order('taken_at').then(({ data, error }) => {
        if (alive && !error) setPhotos(((data ?? []) as VisitPhoto[]).map(({ id, path, kind: k }) => ({ id, path, kind: k })));
      });
    return () => { alive = false; };
  }, [visit.id, outlet.id]);

  // ---------- draft persistence ----------
  const latest = useRef({ lines, photos });
  latest.current = { lines, photos };
  const persist = useCallback(() => {
    if (done.current || !uid) return;
    saveDraft(localStorage, {
      v: 1, visit_id: visit.id, coordinator_id: uid, outlet_id: outlet.id,
      lines: latest.current.lines, photos: latest.current.photos, saved_at: new Date().toISOString(),
    });
  }, [visit.id, outlet.id, uid]);

  useEffect(() => {
    const t = setTimeout(persist, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [lines, photos, persist]);

  // ---------- per-line server sync ----------
  const synced = useRef<Record<string, string>>({});
  const syncLine = useCallback(async (skuId: string) => {
    const l = latest.current.lines[skuId];
    if (done.current || !l || !lineComplete(l)) return;
    const sig = JSON.stringify(l);
    if (synced.current[skuId] === sig) return;
    const { error } = await sb.from('visit_lines').upsert({
      visit_id: visit.id, sku_id: skuId,
      shelf: l.shelf, warehouse: l.warehouse, sold_cases: l.sold, zero_reason: l.reason,
    }, { onConflict: 'visit_id,sku_id' });
    // A failed sync is harmless: the draft has it and checkout re-sends every line.
    if (!error) synced.current[skuId] = sig;
  }, [visit.id]);

  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flushAll = useCallback(() => {
    persist();
    for (const id of Object.keys(latest.current.lines)) void syncLine(id);
  }, [persist, syncLine]);

  // Backgrounding, a tab switch and a PWA reload all pass through here first.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushAll(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushAll);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushAll);
      flushAll();
      Object.values(pending.current).forEach(clearTimeout);
    };
  }, [flushAll]);

  const patch = (id: string, p: Partial<DraftLine>) => {
    setLines((prev) => {
      const next = { ...prev[id], ...p };
      // Leaving zero clears the reason chip — it no longer applies.
      if (p.shelf !== undefined && p.shelf !== 0) next.reason = null;
      return { ...prev, [id]: next };
    });
    clearTimeout(pending.current[id]);
    pending.current[id] = setTimeout(() => void syncLine(id), LINE_SYNC_MS);
  };

  // ---------- photos ----------
  const addPhotos = async (files: File[]) => {
    if (files.length === 0) return;
    setErr(null);
    const room = Math.max(0, MAX_VISIT_PHOTOS - latest.current.photos.length - uploading);
    const picked = files.slice(0, room);
    if (picked.length < files.length) setErr(`أقصى عدد ${MAX_VISIT_PHOTOS} صور للزيارة`);
    const k = kind;
    for (const file of picked) {
      setUploading((n) => n + 1);
      try {
        const id = crypto.randomUUID();
        const path = visitPhotoPath(visit.id, id);
        await uploadPhoto(BUCKET_VISITS, path, await compressImage(file, VISIT_PHOTO_EDGE));
        await insertVisitPhoto({ id, visit_id: visit.id, kind: k, path, lat: null, lng: null });
        setPhotos((prev) => [...prev, { id, path, kind: k }]);
      } catch (e) {
        setErr(`الصورة ما اترفعتش: ${errText(e)} — جرّب تاني`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const removePhoto = async (p: DraftPhoto) => {
    const { error } = await sb.from('visit_photos').delete().eq('id', p.id);
    if (error) { setErr(errText(error)); return; }
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  };

  // ---------- submit = checkout ----------
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
    if (uploading > 0) { setErr('استنى الصور تخلص رفع'); return; }

    setBusy(true);
    try {
      // 1) lines (upsert on the composite PK so a replay is idempotent)
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

      // 2) checkout: second and final GPS read. The DB checks completeness and the gate photo,
      // keeps far_checkin, and sets checkout_distance_m / far_checkout itself.
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

      const flags: string[] = visit.flags.filter((f) => f === 'far_checkin');
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
        // Kept for one release so photo-rate stats and «بدون صورة» still read it.
        photo_path: photos[0]?.path ?? null,
        flags,
      }).eq('id', visit.id);
      if (upd.error) throw upd.error;

      // Only now is the count safely on the server.
      done.current = true;
      clearDraft(localStorage, visit.id);

      // 3) follow-up for central/mixed outlets with zero shelf (PRD §10).
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
      setErr(`ما اتبعتش: ${submitError(e)} — البيانات محفوظة، اضغط إرسال تاني`);
    } finally {
      setBusy(false);
    }
  };

  const lastLine = (skuId: string) => last?.lines.find((l) => l.sku_id === skuId);
  const full = photos.length + uploading >= MAX_VISIT_PHOTOS;
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    void addPhotos(files);
  };

  return (
    <>
      {restored && <p className="hint restored"><b>تم استرجاع بيانات الزيارة</b></p>}
      {last && <LastVisit last={last} />}
      <Hint>
        <b>{outlet.name}</b> — اكتب صفر لو مفيش — ممنوع خانة فاضية
      </Hint>

      {skus.map((s) => {
        const l = lines[s.id];
        const prev = lastLine(s.id);
        return (
          <div
            className="sku"
            key={s.id}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void syncLine(s.id);
            }}
          >
            <h3>
              {s.name_ar}
              <span className="tag">{s.line === 'VIA' ? 'ڤيا' : ''}</span>
            </h3>
            <div className="fields">
              <div className="fcell">
                <label>رف <em>*</em></label>
                <Stepper allowEmpty value={l.shelf} placeholder={prev ? String(prev.shelf) : undefined}
                  onChange={(v) => patch(s.id, { shelf: v })} />
              </div>
              <div className="fcell">
                <label>مخزن <em>*</em></label>
                <Stepper allowEmpty value={l.warehouse} placeholder={prev ? String(prev.warehouse) : undefined}
                  onChange={(v) => patch(s.id, { warehouse: v })} />
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

      {photos.length > 0 && (
        <div className="pgrid">
          {photos.map((p) => (
            <figure key={p.id} className="pcell">
              <SecureImage bucket={BUCKET_VISITS} path={p.path} />
              <figcaption className="small">{PHOTO_KIND_LABEL[p.kind]}</figcaption>
              <button type="button" className="del" aria-label="مسح الصورة" disabled={busy}
                onClick={() => void removePhoto(p)}>✕</button>
            </figure>
          ))}
        </div>
      )}

      {!full && (
        <>
          <Segmented
            options={EXTRA_KINDS.map((k) => PHOTO_KIND_LABEL[k])}
            value={PHOTO_KIND_LABEL[kind]}
            onChange={(label) => setKind(EXTRA_KINDS.find((k) => PHOTO_KIND_LABEL[k] === label) ?? 'shelf')}
          />
          <input ref={camRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={pick} />
          <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={pick} />
          <div className="photorow">
            <button type="button" className="photo" disabled={busy} onClick={() => camRef.current?.click()}>
              📷 إضافة صورة
            </button>
            <button type="button" className="photo" disabled={busy} onClick={() => galRef.current?.click()}>
              🖼 من المعرض
            </button>
          </div>
        </>
      )}
      <p className="small">
        {uploading > 0 ? 'جارٍ رفع الصور…' : `${photos.length} من ${MAX_VISIT_PHOTOS} صور (اختياري)`}
      </p>

      <ErrLine>{err}</ErrLine>
      <button className="send" onClick={() => void submit()} disabled={busy}>
        {busy ? 'جارٍ الإرسال…' : 'إرسال'}
      </button>
      <button className="ghost" onClick={onCancel} disabled={busy}>رجوع (الزيارة تفضل مفتوحة)</button>
    </>
  );
}
