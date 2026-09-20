import { useEffect, useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { coordinatorsInScope, usingGovFallback } from '../../lib/scope';
import { mapsUrl } from '../../lib/geo';
import { dwellText, fmt, relTime, sinceHHMM, timeOf, todayISO } from '../../lib/format';
import { Empty, Hint, Pill, Sect } from '../../components/ui';
import type { Collection, Profile, Visit } from '../../lib/types';

interface Event {
  kind: 'زيارة' | 'شيك';
  at: string;
  outletId: number;
  lat: number | null;
  lng: number | null;
  visit?: Visit;
  amount?: number;
}

/** One coordinator's standing on the board, computed once so sorting and rendering agree. */
interface TeamEntry {
  c: Profile;
  events: Event[];
  openVisit: Visit | null;
  routed: boolean;
}

/** Collapse the no-route group only once it is big enough to be the noise it was named for. */
const COLLAPSE_MIN = 3;

/**
 * «الفريق الآن» — PRD §5.8. Positions are per-event snapshots, never a live track:
 * everything here is derived from visit check-in/checkout rows and cheque rows
 * that already exist, pushed in by realtime. No polling, no background geolocation.
 */
export default function TeamNow({ embedded = false }: { embedded?: boolean }) {
  const { profile, profiles, outletById } = useApp();
  const [openTrail, setOpenTrail] = useState<string | null>(null);
  const [showIdle, setShowIdle] = useState(false);
  const [, setClock] = useState(0);

  // Display-only clock so «منذ HH:MM» stays honest between realtime pushes.
  useEffect(() => {
    const t = window.setInterval(() => setClock((c) => c + 1), 30000);
    return () => window.clearInterval(t);
  }, []);

  const team = useMemo(() => coordinatorsInScope(profile, profiles), [profile, profiles]);
  const teamIds = useMemo(() => team.map((t) => t.id), [team]);
  const fallback = usingGovFallback(profile, profiles);

  const { data } = useQuery<{ visits: Visit[]; cheques: Collection[]; routedIds: string[] }>(
    async () => {
      if (teamIds.length === 0) return { visits: [], cheques: [], routedIds: [] };
      const from = `${todayISO()}T00:00:00`;
      const [v, c, r] = await Promise.all([
        sb.from('visits').select('*').in('coordinator_id', teamIds)
          .gte('checkin_at', from).order('checkin_at', { ascending: false }),
        sb.from('collections').select('*').in('received_by', teamIds).eq('type', 'cheque')
          .gte('received_at', from).order('received_at', { ascending: false }),
        sb.from('routes').select('coordinator_id').in('coordinator_id', teamIds)
          .eq('weekday', new Date().getDay()),
      ]);
      if (v.error) throw v.error;
      if (c.error) throw c.error;
      if (r.error) throw r.error;
      return {
        visits: (v.data ?? []) as Visit[],
        cheques: (c.data ?? []) as Collection[],
        routedIds: [...new Set(((r.data ?? []) as { coordinator_id: string }[]).map((x) => x.coordinator_id))],
      };
    },
    [teamIds.join(',')],
    { visits: [], cheques: [], routedIds: [] },
  );

  const eventsFor = (id: string): Event[] => {
    const visitEvents: Event[] = data.visits
      .filter((v) => v.coordinator_id === id)
      .map((v) => ({
        kind: 'زيارة',
        at: v.checkout_at ?? v.checkin_at,
        outletId: v.outlet_id,
        lat: v.checkout_lat ?? v.checkin_lat,
        lng: v.checkout_lng ?? v.checkin_lng,
        visit: v,
      }));
    const chequeEvents: Event[] = data.cheques
      .filter((c) => c.received_by === id)
      .map((c) => ({
        kind: 'شيك',
        at: c.received_at,
        outletId: c.outlet_id,
        lat: null,          // cheque rows carry no coordinates
        lng: null,
        amount: c.amount,
      }));
    return [...visitEvents, ...chequeEvents].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  };

  /**
   * The board exists to show who is working, so it is ordered by that and nothing else:
   * (0) في زيارة now, (1) has a route today **or** has logged anything today, (2) neither.
   *
   * Bucket 1 keys on activity, not on the route alone. A coordinator with no route can still
   * log an off-route visit (RouteToday) or a cheque, and ranking on `routed` alone would sweep
   * someone demonstrably working into the collapsed group and hide them.
   */
  const rankOf = (e: TeamEntry) => (e.openVisit ? 0 : e.routed || e.events.length > 0 ? 1 : 2);

  const entries = useMemo<TeamEntry[]>(() => {
    const list: TeamEntry[] = team.map((c) => ({
      c,
      events: eventsFor(c.id),
      openVisit: data.visits.find((v) => v.coordinator_id === c.id && v.checkout_at == null) ?? null,
      routed: data.routedIds.includes(c.id),
    }));
    return list.sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        // Most recently active first inside a bucket; no-activity rows fall back to name.
        +new Date(b.events[0]?.at ?? 0) - +new Date(a.events[0]?.at ?? 0) ||
        a.c.full_name.localeCompare(b.c.full_name, 'ar'),
    );
  }, [team, data]);

  const quiet = entries.filter((e) => rankOf(e) === 2);
  const folded = quiet.length >= COLLAPSE_MIN;
  const listed = folded ? entries.filter((e) => rankOf(e) !== 2) : entries;

  const Row = ({ e: { c, events, openVisit, routed } }: { e: TeamEntry }) => {
    const last = events[0];
    const idle = !openVisit && events.length === 0 && routed;

    const tone = openVisit ? 'ok' : idle ? 'bad' : '';
    const trailOpen = openTrail === c.id;

    return (
      <div className={`card feeditem ${tone}`}>
        <button
          type="button"
          onClick={() => setOpenTrail(trailOpen ? null : c.id)}
          style={{
            all: 'unset', cursor: 'pointer', display: 'block', width: '100%',
            fontFamily: 'inherit', color: 'inherit',
          }}
        >
          <b>{c.full_name}</b>
          <br />
          {openVisit ? (
            <>
              <Pill tone="g">في زيارة الآن</Pill>{' '}
              <span className="small">
                {outletById(openVisit.outlet_id)?.name ?? '؟'} — منذ {sinceHHMM(openVisit.checkin_at)}
              </span>
            </>
          ) : last ? (
            <>
              <Pill tone="n">آخر نشاط</Pill>{' '}
              <span className="small">
                {last.kind} · {outletById(last.outletId)?.name ?? '؟'} · {relTime(last.at)}
                {last.kind === 'شيك' && last.amount != null && ` · ${fmt(last.amount)} ج`}
              </span>
            </>
          ) : routed ? (
            <Pill tone="r">لم يبدأ اليوم</Pill>
          ) : (
            <span className="small">مفيش خط سير النهارده</span>
          )}
        </button>

        {last?.lat != null && last.lng != null && (
          <div className="btnrow">
            <a
              className="mini"
              href={mapsUrl(last.lat, last.lng)}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              افتح في الخرائط
            </a>
          </div>
        )}

        {trailOpen && (
          <>
            <Sect>خط اليوم — {c.full_name}</Sect>
            {events.length === 0 && <Empty>مفيش نشاط النهارده</Empty>}
            {events.map((e, i) => (
              <div className="card" key={i} style={{ marginBottom: 6 }}>
                <span className="small mono">{timeOf(e.at)}</span> — <b>{e.kind}</b>{' '}
                {outletById(e.outletId)?.name ?? '؟'}
                {e.visit && (
                  <>
                    <br />
                    <span className="small">
                      مدة {dwellText(e.visit.dwell_seconds)}
                      {e.visit.distance_m != null && ` · ${fmt(e.visit.distance_m)} م من الفرع`}
                      {e.visit.checkout_at == null && ' · لسه مفتوحة'}
                    </span>
                  </>
                )}
                {e.kind === 'شيك' && e.amount != null && (
                  <>
                    <br />
                    <span className="small mono">{fmt(e.amount)} ج</span>
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      {!embedded && <Hint>آخر موقع مسجَّل، لا يوجد تتبع مستمر — الموقع يتسجل عند بدء الزيارة وعند الإرسال بس.</Hint>}
      {embedded && <Sect>الفريق الآن</Sect>}

      {fallback && (
        <div className="card feeditem pend">
          <span className="small">
            مفيش منسقين متعيّنين ليك — بنعرض كل منسقي {profile?.scope}. الإدارة تقدر تحدد المشرف لكل منسق من «الفريق».
          </span>
        </div>
      )}

      {team.length === 0 && <Empty>مفيش منسقين في نطاقك</Empty>}
      {listed.map((e) => <Row key={e.c.id} e={e} />)}

      {folded && (
        <>
          <button
            type="button"
            className="foldrow"
            aria-expanded={showIdle}
            onClick={() => setShowIdle((v) => !v)}
          >
            <span>
              {quiet.length} {quiet.length > 10 ? 'منسق' : 'منسقين'} بدون خط سير النهارده
            </span>
            <span className="chev">{showIdle ? '▴' : '▾'}</span>
          </button>
          {showIdle && quiet.map((e) => <Row key={e.c.id} e={e} />)}
        </>
      )}

      {embedded && <p className="small">آخر موقع مسجَّل، لا يوجد تتبع مستمر.</p>}
    </>
  );
}
