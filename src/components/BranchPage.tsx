import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../lib/app';
import { sb, errText } from '../lib/supabase';
import { cairoDateOf, cairoTime, cairoToday, weekdayOf } from '../lib/cairo';
import { DAY_LABELS, fmt0 } from '../lib/format';
import { mapsUrl } from '../lib/geo';
import { medianPoint } from '../lib/branches';
import { dayDiff, type VisitWithLines } from '../lib/visitsHistory';
import { ActionButton, Empty, ErrLine, Hint, Pill, Sect } from './ui';
import { VisitCompare } from './VisitCompare';
import { RowDetail } from './VisitRowDetail';
import { visitStatus } from './VisitDetail';

/** Enough for 8 visits, 20 check-ins and a comparison base behind a few supervisor-closed ones. */
const FETCH = 60;
const SHOWN_VISITS = 8;
const SHOWN_CHECKINS = 20;
/** Same radius the check-in fence uses (visits_checkin_fence). */
const FENCE_M = 150;

type BranchVisit = VisitWithLines & { visit_photos: { count: number }[] };

const label = (ts: string) => {
  const d = cairoDateOf(ts);
  return `${DAY_LABELS[weekdayOf(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)} · ${cairoTime(ts)}`;
};

/** A comparison base: completed and not closed by the supervisor, as last_visit_for_outlet. */
const completed = (v: BranchVisit) => v.checkout_at != null && !v.flags.includes('unclosed');

/**
 * One branch (Batch B2): the latest completed visit against the one before it, the last
 * visits, and the location record with «تثبيت الموقع». Opened from «الفروع» and «سجل الفرع».
 * Shows every coordinator's visits at the outlet: the branch, not the person, is the subject.
 */
export default function BranchPage({ outletId, onBack, backLabel, onOpenFeed }: {
  outletId: number;
  onBack: () => void;
  backLabel: string;
  onOpenFeed?: () => void;
}) {
  const { profile, outletById, profileById, reloadRef, toast } = useApp();
  const o = outletById(outletId);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery<BranchVisit[]>(
    async () => {
      const { data, error } = await sb.from('visits').select('*, visit_lines(*), visit_photos(count)')
        .eq('outlet_id', outletId).order('checkin_at', { ascending: false }).limit(FETCH);
      if (error) throw error;
      return (data ?? []) as BranchVisit[];
    },
    [outletId],
    [],
  );

  const [latest, before] = useMemo(
    () => list.data.filter(completed)
      .sort((a, b) => +new Date(b.checkout_at as string) - +new Date(a.checkout_at as string)),
    [list.data],
  );
  const checkins = list.data.filter((v) => v.checkin_lat != null && v.checkin_lng != null).slice(0, SHOWN_CHECKINS);
  const name = (id: string) => profileById(id)?.full_name ?? '؟';

  if (!o) return <Empty>الفرع مش موجود</Empty>;

  const hasPin = o.lat != null && o.lng != null;
  const proposed = o.pin_proposed_lat != null && o.pin_proposed_lng != null
    ? { lat: o.pin_proposed_lat, lng: o.pin_proposed_lng, src: 'المقترح الليلي من الزيارات' }
    : (() => {
      const m = medianPoint(checkins.map((v) => ({ lat: v.checkin_lat as number, lng: v.checkin_lng as number })));
      return m ? { ...m, src: `متوسط آخر ${checkins.length} بداية زيارة` } : null;
    })();
  const target = hasPin ? { lat: o.lat as number, lng: o.lng as number } : proposed;
  // confirm_outlet_pin is supervisor/mgmt only.
  const canPin = !o.pin_verified && target != null && (profile?.role === 'supervisor' || profile?.role === 'mgmt');

  const confirmPin = async () => {
    if (!target) return;
    setErr(null);
    if (!window.confirm(
      `تثبيت موقع ${o.chain} ${o.name}؟\nبعد التثبيت أي بداية زيارة أبعد من ${FENCE_M} م عن الموقع ده هتترفض.`,
    )) return;
    const { error } = await sb.rpc('confirm_outlet_pin', { p_outlet: o.id, p_lat: target.lat, p_lng: target.lng });
    if (error) { setErr(errText(error)); return; }
    toast('اتثبت موقع الفرع');
    await reloadRef();
  };

  return (
    <>
      <div className="btnrow" style={{ marginTop: 0, marginBottom: 10 }}>
        <button type="button" className="mini" onClick={onBack}>→ {backLabel}</button>
      </div>
      <Sect><bdi>{o.chain} {o.name}</bdi>{!o.active && ' (موقوف)'}</Sect>
      <ErrLine>{list.error}</ErrLine>
      {list.loading && list.data.length === 0 && <p className="small">جارٍ التحميل…</p>}

      <Sect>آخر زيارة والزيارة اللي قبلها</Sect>
      {latest
        ? (
          <VisitCompare
            now={{ checkin_at: latest.checkin_at, coordinator_id: latest.coordinator_id, lines: latest.visit_lines }}
            before={before
              ? { checkin_at: before.checkin_at, coordinator_id: before.coordinator_id, lines: before.visit_lines }
              : null}
          />
        )
        : !list.loading && <Empty>مفيش زيارات مكتملة للفرع ده</Empty>}
      {latest && (
        <p className="small">
          آخر زيارة {(() => {
            const n = dayDiff(cairoDateOf(latest.checkin_at), cairoToday());
            return n === 0 ? 'النهارده' : <>من <span className="mono">{n}</span> يوم</>;
          })()}
        </p>
      )}

      <Sect>آخر {SHOWN_VISITS} زيارات</Sect>
      {!list.loading && list.data.length === 0 && <Empty>مفيش زيارات متسجلة للفرع ده</Empty>}
      {list.data.slice(0, SHOWN_VISITS).map((v) => {
        const st = visitStatus(v);
        const photos = v.visit_photos[0]?.count ?? 0;
        const isOpen = open === v.id;
        return (
          <div key={v.id} className="card feeditem">
            <button type="button" className="vhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.id)}>
              <span>
                <span className="mono">{label(v.checkin_at)}</span> · {name(v.coordinator_id)}
                <br />
                <Pill tone={st.tone}>{st.label}</Pill>{' '}
                <Pill tone="n">{photos} {photos === 1 ? 'صورة' : 'صور'}</Pill>
                {v.off_route && <> <Pill tone="v">خارج الخط</Pill></>}
              </span>
              <span className="chev">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && <RowDetail v={v} onOpenFeed={onOpenFeed} />}
          </div>
        );
      })}

      <Sect>الموقع</Sect>
      <p className="small">
        {hasPin
          ? <>
            <a href={mapsUrl(o.lat as number, o.lng as number)} target="_blank" rel="noreferrer">موقع الفرع على الخريطة</a>
            {' '}{o.pin_verified ? <Pill tone="g">متثبت</Pill> : <Pill tone="y">مش متثبت</Pill>}
          </>
          : 'الفرع مالوش موقع متسجل'}
      </p>
      {!hasPin && (
        proposed
          ? (
            <p className="small">
              موقع مقترح ({proposed.src}):{' '}
              <a href={mapsUrl(proposed.lat, proposed.lng)} target="_blank" rel="noreferrer">شوفه على الخريطة</a>
            </p>
          )
          : <Hint>محتاج 3 بدايات زيارة على الأقل بـ GPS عشان نقترح موقع.</Hint>
      )}
      <ErrLine>{err}</ErrLine>
      {canPin && (
        <div className="btnrow">
          <ActionButton className="mini dark" onClick={confirmPin}>
            {hasPin ? 'تثبيت الموقع' : 'تثبيت الموقع المقترح'}
          </ActionButton>
        </div>
      )}

      <p className="small" style={{ marginTop: 10 }}>آخر {SHOWN_CHECKINS} بداية زيارة بـ GPS</p>
      {checkins.length === 0
        ? <Empty>مفيش بدايات زيارة بـ GPS</Empty>
        : (
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>اليوم</th><th>المنسق</th><th>البعد عن الفرع</th><th></th></tr></thead>
              <tbody>
                {checkins.map((v) => {
                  const far = v.distance_m != null && v.distance_m > FENCE_M;
                  return (
                    <tr key={v.id} className={far ? 'rose' : ''}>
                      <td className="mono">{label(v.checkin_at)}</td>
                      <td>{name(v.coordinator_id)}</td>
                      <td>
                        {v.distance_m == null ? '—' : <span className="mono">{fmt0(v.distance_m)} م</span>}
                        {far && <> <Pill tone="y">أبعد من {FENCE_M} م</Pill></>}
                      </td>
                      <td>
                        <a href={mapsUrl(v.checkin_lat as number, v.checkin_lng as number)} target="_blank" rel="noreferrer">خريطة</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <Hint>البعد هو المتسجل وقت الإرسال (من الموقع اللي كان متسجل ساعتها). الأيام والأوقات بتوقيت القاهرة.</Hint>
    </>
  );
}
