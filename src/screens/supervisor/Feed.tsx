import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { coordinatorsInScope } from '../../lib/scope';
import { FLAG_LABEL, dwellText, fmt, stampOf, timeOf, todayISO } from '../../lib/format';
import { ageLabel, calendarDaysAgo, closeUnfinishedPatch, missingPhoto, reviewQueue } from '../../lib/review';
import { ActionButton, Empty, ErrLine, Pill, Sect, VisitPhotos } from '../../components/ui';
import { VisitCompare, type CountSide } from '../../components/VisitCompare';
import type { CountLine } from '../../lib/compare';
import type { Visit, VisitLine } from '../../lib/types';

/** Row of `previous_visits()`: the visit before each card's visit, at the same outlet. */
interface PrevRow {
  visit_id: string;
  prev_id: string;
  prev_checkin_at: string;
  prev_checkout_at: string;
  prev_coordinator_id: string;
  prev_lines: CountLine[];
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

interface FeedData {
  queue: Visit[];
  reviewedToday: Visit[];
  todayAll: Visit[];
  open: Visit[];
  lines: VisitLine[];
  /** Keyed by the card's visit id; absent = first visit at the outlet. */
  prev: Record<string, CountSide>;
  routedIds: string[];
}

const EMPTY: FeedData = { queue: [], reviewedToday: [], todayAll: [], open: [], lines: [], prev: {}, routedIds: [] };

export default function Feed() {
  const { profile, profiles, outletById, skuById, profileById, bump, toast } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);

  // Active team drives the silent banner; review work also covers deactivated coordinators,
  // whose last visits would otherwise sit pending or open with nobody able to see them.
  const team = useMemo(() => coordinatorsInScope(profile, profiles), [profile, profiles]);
  const reviewTeam = useMemo(
    () => coordinatorsInScope(profile, profiles, { includeInactive: true }),
    [profile, profiles],
  );
  const reviewIds = useMemo(() => reviewTeam.map((t) => t.id), [reviewTeam]);

  // The review list is a queue, not a day view: every submitted visit still pending, from any
  // day, oldest first. Today's visits are fetched separately for the silent banner and the
  // «اتراجعت النهارده» list. Open visits have no date filter so an unclosed one never vanishes.
  const { data } = useQuery<FeedData>(
    async () => {
      if (reviewIds.length === 0) return EMPTY;
      const from = `${todayISO()}T00:00:00`;
      const team = () => sb.from('visits').select('*').in('coordinator_id', reviewIds);
      const [p, v, o, r] = await Promise.all([
        team().eq('status', 'pending').not('checkout_at', 'is', null).order('checkin_at'),
        team().gte('checkin_at', from).order('checkin_at', { ascending: false }),
        team().is('checkout_at', null).order('checkin_at', { ascending: false }),
        sb.from('routes').select('coordinator_id').in('coordinator_id', reviewIds)
          .eq('weekday', new Date().getDay()),
      ]);
      for (const res of [p, v, o, r]) if (res.error) throw res.error;

      const queue = reviewQueue((p.data ?? []) as Visit[]);
      const todayAll = (v.data ?? []) as Visit[];
      const reviewedToday = todayAll.filter((x) => x.checkout_at != null && x.status !== 'pending');
      const ids = [...new Set([...queue, ...reviewedToday].map((x) => x.id))];
      let lines: VisitLine[] = [];
      const prev: Record<string, CountSide> = {};
      if (ids.length) {
        // One batched call for every card's comparison base, not one per card (B3).
        const [l, pv] = await Promise.all([
          sb.from('visit_lines').select('*').in('visit_id', ids),
          sb.rpc('previous_visits', { p_visits: ids }),
        ]);
        if (l.error) throw l.error;
        if (pv.error) throw pv.error;
        lines = (l.data ?? []) as VisitLine[];
        for (const r of (pv.data ?? []) as PrevRow[]) {
          prev[r.visit_id] = { checkin_at: r.prev_checkin_at, coordinator_id: r.prev_coordinator_id, lines: r.prev_lines };
        }
      }
      const routedIds = [...new Set(((r.data ?? []) as { coordinator_id: string }[]).map((x) => x.coordinator_id))];
      return { queue, reviewedToday, todayAll, open: (o.data ?? []) as Visit[], lines, prev, routedIds };
    },
    [reviewIds.join(',')],
    EMPTY,
  );

  const stale = data.open.filter(
    (v) => Date.now() - new Date(v.checkin_at).getTime() > FOUR_HOURS_MS,
  );
  const silent = team.filter(
    (c) => data.routedIds.includes(c.id) && !data.todayAll.some((v) => v.coordinator_id === c.id),
  );

  const review = async (v: Visit, status: 'approved' | 'flagged') => {
    if (!profile) return;
    setErr(null);
    const upd = await sb.from('visits').update({
      status, reviewed_by: profile.id, reviewed_at: new Date().toISOString(),
    }).eq('id', v.id);
    if (upd.error) { setErr(errText(upd.error)); return; }

    // Approval is the verification that sets a pin-less outlet's location (PRD §5.6).
    if (status === 'approved' && v.checkin_lat != null && v.checkin_lng != null) {
      const outlet = outletById(v.outlet_id);
      if (outlet && outlet.lat == null) {
        const rpc = await sb.rpc('set_outlet_pin', {
          p_outlet: v.outlet_id, p_lat: v.checkin_lat, p_lng: v.checkin_lng,
        });
        if (rpc.error) toast(`الاعتماد تم لكن الموقع ما اتسجلش: ${errText(rpc.error)}`);
        else toast('اتعتمدت — واتسجل موقع الفرع');
      } else toast('اتعتمدت');
    } else toast(status === 'approved' ? 'اتعتمدت' : 'اترفضت');
    bump();
  };

  const closeUnfinished = async (v: Visit) => {
    if (!profile) return;
    const who = profileById(v.coordinator_id)?.full_name ?? 'المنسق';
    if (!window.confirm(`قفل زيارة ${who} في ${outletById(v.outlet_id)?.name ?? '؟'}؟ هتتسجل «ما اتبعتتش».`)) return;
    setErr(null);
    const upd = await sb.from('visits').update(closeUnfinishedPatch(v, profile.id)).eq('id', v.id);
    if (upd.error) { setErr(errText(upd.error)); return; }
    toast('اتقفلت الزيارة');
    bump();
  };

  const VisitCard = ({ v, showDay }: { v: Visit; showDay: boolean }) => {
    const o = outletById(v.outlet_id);
    const who = profileById(v.coordinator_id);
    const zeros = data.lines.filter((l) => l.visit_id === v.id && l.shelf === 0);
    const cls = v.status === 'approved' ? 'ok' : v.status === 'flagged' ? 'bad' : 'pend';
    const age = ageLabel(calendarDaysAgo(v.checkin_at));
    return (
      <div className={`card feeditem ${cls}`}>
        <b>{o?.name ?? '؟'}</b>{' '}
        <span className="small">
          — {who?.full_name ?? '؟'}{who && !who.active ? ' (موقوف)' : ''} ·{' '}
          {showDay ? stampOf(v.checkin_at) : timeOf(v.checkin_at)}
        </span>
        {age && <> <Pill tone="r">{age}</Pill></>}
        {v.off_route && <> <Pill tone="v">خارج الخط</Pill></>}
        <br />
        <span className="small">
          مدة {dwellText(v.dwell_seconds)} ·{' '}
          {v.distance_m == null ? 'الموقع لسه ما اتحددش' : `${fmt(v.distance_m)} م من الفرع`}
          {v.checkout_distance_m != null && ` · الإرسال ${fmt(v.checkout_distance_m)} م من البدء`}
        </span>
        {v.checkin_reason && <><br /><span className="small">سبب البعد عند البدء: {v.checkin_reason}</span></>}
        <br />
        {zeros.length > 0
          ? (
            <>
              <Pill tone="r">{zeros.length} صنف صفر</Pill>{' '}
              <span className="small">{zeros.map((z) => skuById(z.sku_id)?.name_ar ?? z.sku_id).join('، ')}</span>
            </>
          )
          : <Pill tone="g">متوفر</Pill>}

        {(v.flags.length > 0 || missingPhoto(v)) && (
          <div className="btnrow">
            {v.flags.map((f) => <Pill key={f} tone="y">{FLAG_LABEL[f] ?? f}</Pill>)}
            {/* Informs only — the supervisor decides; nothing auto-rejects a photo-less visit. */}
            {missingPhoto(v) && <Pill tone="y">بدون صورة</Pill>}
          </div>
        )}

        {openPhoto === v.id
          ? <VisitPhotos visitId={v.id} legacyPath={v.photo_path} />
          : (
            <div className="btnrow">
              <button className="mini" onClick={() => setOpenPhoto(v.id)}>شوف الصور</button>
            </div>
          )}

        {/* Before → now per SKU, read before deciding. Informs only; never auto-rejects. */}
        <VisitCompare
          now={{ checkin_at: v.checkin_at, coordinator_id: v.coordinator_id, lines: data.lines.filter((l) => l.visit_id === v.id) }}
          before={data.prev[v.id] ?? null}
        />

        {v.status === 'pending' && (
          <div className="btnrow">
            <ActionButton className="mini grn" onClick={() => review(v, 'approved')}>اعتماد</ActionButton>
            <ActionButton className="mini red" onClick={() => review(v, 'flagged')}>رفض</ActionButton>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {silent.length > 0 && (
        <div className="card feeditem bad">
          <b>الفريق الصامت — لسه مفيش زيارات من:</b>
          <br />
          <span className="small">{silent.map((s) => s.full_name).join(' · ')}</span>
        </div>
      )}

      {stale.length > 0 && (
        <>
          <Sect>زيارات لم تُغلق ({stale.length})</Sect>
          {stale.map((v) => (
            <div className="card feeditem bad" key={v.id}>
              <b>{outletById(v.outlet_id)?.name ?? '؟'}</b>{' '}
              <span className="small">
                — {profileById(v.coordinator_id)?.full_name ?? '؟'} · بدأت {stampOf(v.checkin_at)}
              </span>
              <br />
              <Pill tone="r">زيارة لم تُغلق</Pill>
              <div className="btnrow">
                <ActionButton className="mini red" onClick={() => closeUnfinished(v)}>قفل الزيارة</ActionButton>
              </div>
            </div>
          ))}
        </>
      )}

      <ErrLine>{err}</ErrLine>

      <Sect>مستني مراجعة ({data.queue.length}) — الأقدم الأول</Sect>
      {data.queue.length === 0 && <Empty>مفيش زيارات مستنية مراجعة</Empty>}
      {data.queue.map((v) => <VisitCard key={v.id} v={v} showDay />)}

      <Sect>اتراجعت النهارده ({data.reviewedToday.length})</Sect>
      {data.reviewedToday.length === 0 && <Empty>—</Empty>}
      {data.reviewedToday.map((v) => <VisitCard key={v.id} v={v} showDay={false} />)}
    </>
  );
}
