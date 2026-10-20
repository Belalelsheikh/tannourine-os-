import { useEffect, useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, BUCKET_VISITS } from '../../lib/supabase';
import { addDays, cairoDateOf, cairoDayRange, cairoTime, cairoToday, weekdayOf } from '../../lib/cairo';
import { DAY_LABELS, FLAG_LABEL, ORDER_STATUS_LABEL, fmt } from '../../lib/format';
import { daySections, zeroSummary, type DaySection } from '../../lib/visitsDay';
import { Empty, ErrLine, Hint, Pill, SecureImage, Sect } from '../../components/ui';
import type {
  Followup, Order, OrderLine, RouteRow, Visit, VisitLine,
} from '../../lib/types';

/** Opening a specific visit from elsewhere (the dashboard's «آخر النشاط»). */
export interface VisitFocus { visitId: string; day: string; }

interface DayData {
  visits: Visit[];
  routes: RouteRow[];
  lines: VisitLine[];
  followups: Followup[];
  orders: Order[];
  orderLines: OrderLine[];
}
const EMPTY: DayData = { visits: [], routes: [], lines: [], followups: [], orders: [], orderLines: [] };

/** Batched `.in()` read; skips the round-trip when there is nothing to ask for. */
async function inIds<T>(table: string, col: string, ids: string[]): Promise<T[]> {
  if (ids.length === 0) return [];
  const { data, error } = await sb.from(table).select('*').in(col, ids);
  if (error) throw error;
  return (data ?? []) as T[];
}

const STATUS: Record<string, { label: string; tone: 'r' | 'g' | 'y' | 'n' }> = {
  open: { label: 'لسه مفتوحة', tone: 'n' },
  pending: { label: 'مستنية', tone: 'y' },
  approved: { label: 'اتعتمدت', tone: 'g' },
  flagged: { label: 'اترفضت', tone: 'r' },
};

const minutes = (s: number | null) => (s == null ? '—' : `${Math.round(s / 60)} د`);

/**
 * «الزيارات» — what each coordinator actually recorded on one Cairo day: per-SKU counts and
 * zero reasons, what was planned and missed, and what followed (review, follow-up, order).
 * Read-only for every role that has it; reviewing stays in «المتابعة».
 */
export default function Visits({ focus, onFocusDone }: { focus?: VisitFocus | null; onFocusDone?: () => void }) {
  const { profiles, skus, outletById, skuById, profileById } = useApp();
  const [day, setDay] = useState(() => focus?.day ?? cairoToday());
  const [chip, setChip] = useState('الكل');
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus.visitId] : []));
  const [photos, setPhotos] = useState<Set<string>>(new Set());

  // A tap-through from the dashboard while this tab is already mounted.
  useEffect(() => {
    if (!focus) return;
    setDay(focus.day);
    setChip('الكل');
    setOpen((s) => new Set(s).add(focus.visitId));
  }, [focus?.visitId, focus?.day]);

  const { data, loading, error } = useQuery<DayData>(
    async () => {
      const { from, to } = cairoDayRange(day);
      const [v, r, o] = await Promise.all([
        sb.from('visits').select('*').gte('checkin_at', from).lt('checkin_at', to).order('checkin_at'),
        sb.from('routes').select('*').eq('weekday', weekdayOf(day)),
        sb.from('orders').select('*').gte('created_at', from).lt('created_at', to).order('created_at'),
      ]);
      for (const res of [v, r, o]) if (res.error) throw res.error;
      const visits = (v.data ?? []) as Visit[];
      const orders = (o.data ?? []) as Order[];
      const ids = visits.map((x) => x.id);
      const [lines, followups, orderLines] = await Promise.all([
        inIds<VisitLine>('visit_lines', 'visit_id', ids),
        inIds<Followup>('followups', 'visit_id', ids),
        inIds<OrderLine>('order_lines', 'order_id', orders.map((x) => x.id)),
      ]);
      return { visits, routes: (r.data ?? []) as RouteRow[], lines, followups, orders, orderLines };
    },
    [day],
    EMPTY,
  );

  // Scroll a tapped-through visit into view once its card exists.
  useEffect(() => {
    if (!focus || loading) return;
    const el = document.getElementById(`visit-${focus.visitId}`);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    onFocusDone?.();
  }, [focus?.visitId, loading, data]);

  const visitedBy = useMemo(() => new Set(data.visits.map((v) => v.coordinator_id)), [data.visits]);
  const coordinators = useMemo(
    () => profiles.filter((p) => p.role === 'coordinator' && (p.active || visitedBy.has(p.id))),
    [profiles, visitedBy],
  );
  const sections = useMemo(
    () => daySections(coordinators, data.visits, data.routes, chip),
    [coordinators, data, chip],
  );
  const shownIds = useMemo(
    () => new Set(sections.flatMap((s) => s.visits.map((v) => v.id))),
    [sections],
  );
  const zeros = useMemo(() => zeroSummary(data.lines, shownIds), [data.lines, shownIds]);

  const isToday = day === cairoToday();
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };
  const stamp = (ts: string) => {
    const d = cairoDateOf(ts);
    return `${d === day ? '' : `${d.slice(8, 10)}/${d.slice(5, 7)} `}${cairoTime(ts)}`;
  };
  const outletLabel = (id: number) => {
    const o = outletById(id);
    return o ? `${o.chain} ${o.name}` : '؟';
  };

  const VisitCard = ({ v }: { v: Visit }) => {
    const isOpen = open.has(v.id);
    const st = STATUS[v.checkout_at == null ? 'open' : v.status];
    const lines = data.lines.filter((l) => l.visit_id === v.id);
    const zeroCount = lines.filter((l) => l.shelf === 0).length;
    const fu = data.followups.filter((f) => f.visit_id === v.id);
    const orders = data.orders.filter((o) => o.outlet_id === v.outlet_id);
    const tone = v.checkout_at == null ? 'pend' : v.status === 'approved' ? 'ok' : v.status === 'flagged' ? 'bad' : 'pend';

    return (
      <div className={`card feeditem ${tone}`} id={`visit-${v.id}`}>
        <button
          type="button"
          className="vhead"
          aria-expanded={isOpen}
          onClick={() => setOpen((s) => toggle(s, v.id))}
        >
          <span>
            <b><bdi>{outletLabel(v.outlet_id)}</bdi></b>
            <br />
            <span className="small">
              <span className="mono">{cairoTime(v.checkin_at)}</span> · {minutes(v.dwell_seconds)}
            </span>{' '}
            <Pill tone={st.tone}>{st.label}</Pill>
            {zeroCount > 0 && <> <Pill tone="r">{zeroCount} صنف صفر</Pill></>}
            {v.off_route && <> <Pill tone="v">خارج الخط</Pill></>}
          </span>
          <span className="chev">{isOpen ? '▴' : '▾'}</span>
        </button>

        {isOpen && (
          <div className="vbody">
            {lines.length === 0 ? (
              <p className="small">لسه ما اتبعتتش — مفيش جرد متسجل.</p>
            ) : (
              <div className="tscroll">
                <table className="t">
                  <thead>
                    <tr><th>الصنف</th><th>رف</th><th>مخزن</th><th>بيع</th><th>سبب الصفر</th></tr>
                  </thead>
                  <tbody>
                    {skus.map((s) => {
                      const l = lines.find((x) => x.sku_id === s.id);
                      const dry = l != null && l.shelf === 0 && l.warehouse === 0;
                      return (
                        <tr key={s.id} className={dry ? 'crit' : ''}>
                          <td>{s.name_ar}</td>
                          <td className="mono">{l ? l.shelf : '—'}</td>
                          <td className="mono">{l ? l.warehouse : '—'}</td>
                          <td className="mono">{l ? l.sold_cases : '—'}</td>
                          <td>{l?.zero_reason ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="small">
              من <span className="mono">{cairoTime(v.checkin_at)}</span>
              {v.checkout_at ? <> لـ <span className="mono">{cairoTime(v.checkout_at)}</span></> : ' — لسه مفتوحة'}
              {' · '}مدة {minutes(v.dwell_seconds)}
              <br />
              GPS البدء {v.checkin_lat != null ? '✓' : '✗'} · الإرسال{' '}
              {v.checkout_at == null ? '—' : v.checkout_lat != null ? '✓' : '✗'}
              {' · '}
              {v.distance_m == null ? 'الموقع لسه ما اتحددش' : `${fmt(v.distance_m)} م من الفرع`}
            </p>

            {v.flags.length > 0 && (
              <div className="btnrow">
                {v.flags.map((f) => <Pill key={f} tone="y">{FLAG_LABEL[f] ?? f}</Pill>)}
              </div>
            )}

            <p className="small" style={{ marginTop: 8 }}>
              {v.reviewed_by
                ? <>راجعها {profileById(v.reviewed_by)?.full_name ?? '؟'}{v.reviewed_at ? ` · ${stamp(v.reviewed_at)}` : ''}</>
                : v.checkout_at == null ? 'لسه ما اتبعتتش للمراجعة' : 'لسه ما اتراجعتش'}
            </p>

            {fu.map((f) => (
              <p className="small" key={f.id}>
                {f.status === 'done'
                  ? <>المتابعة مع السلسلة اتقفلت — {profileById(f.done_by)?.full_name ?? '؟'}{f.done_at ? ` · ${stamp(f.done_at)}` : ''}</>
                  : <>متابعة مع السلسلة مفتوحة — لسه محدش قفلها</>}
              </p>
            ))}

            {orders.length > 0 ? orders.map((o) => (
              <div className="small" key={o.id} style={{ marginTop: 4 }}>
                <Pill tone={o.status === 'rejected' ? 'r' : o.status === 'pending' ? 'y' : 'g'}>
                  أوردر · {ORDER_STATUS_LABEL[o.status] ?? o.status}
                </Pill>{' '}
                {data.orderLines.filter((l) => l.order_id === o.id)
                  .sort((a, b) => skus.findIndex((s) => s.id === a.sku_id) - skus.findIndex((s) => s.id === b.sku_id))
                  .map((l) => `${skuById(l.sku_id)?.name_ar ?? l.sku_id}: ${l.cases}`).join(' · ')}
              </div>
            )) : zeroCount > 0 && <p className="small" style={{ color: 'var(--crit)' }}>مفيش أوردر اتعمل</p>}

            {v.photo_path && (
              photos.has(v.id)
                ? <SecureImage bucket={BUCKET_VISITS} path={v.photo_path} />
                : (
                  <div className="btnrow">
                    <button className="mini" onClick={() => setPhotos((s) => toggle(s, v.id))}>شوف صورة الرف</button>
                  </div>
                )
            )}
          </div>
        )}
      </div>
    );
  };

  const Section = ({ s }: { s: DaySection }) => (
    <>
      <Sect>
        {s.coord.full_name}{!s.coord.active && ' (موقوف)'} ·{' '}
        <span className="mono">{s.done}</span> من <span className="mono">{s.planned.length}</span>
        {s.offRoute > 0 && <> + {s.offRoute} خارج الخط</>}
        {s.firstIn && (
          <span className="small">
            {' · '}من <span className="mono">{cairoTime(s.firstIn)}</span>
            {s.lastOut && <> لـ <span className="mono">{cairoTime(s.lastOut)}</span></>}
          </span>
        )}
      </Sect>
      {s.notVisited.length > 0 && (
        <div className="card feeditem bad">
          <b>لسه ما اتزارتش ({s.notVisited.length}):</b>{' '}
          <span className="small">
            {s.notVisited.map((id, i) => (
              <span key={id}>{i > 0 && ' · '}<bdi>{outletLabel(id)}</bdi></span>
            ))}
          </span>
        </div>
      )}
      {s.planned.length > 0 && s.notVisited.length === 0 && <p className="small">كل الخط اتزار ✓</p>}
      {s.visits.length === 0 && <p className="small" style={{ marginBottom: 8 }}>مفيش زيارات في اليوم ده.</p>}
      {s.visits.map((v) => <VisitCard key={v.id} v={v} />)}
    </>
  );

  return (
    <>
      <div className="daynav">
        <button type="button" className="mini" onClick={() => setDay((d) => addDays(d, -1))} aria-label="اليوم اللي قبله">→ قبل</button>
        <span>
          <b>{DAY_LABELS[weekdayOf(day)]}</b> <span className="mono">{day.slice(8, 10)}/{day.slice(5, 7)}</span>
          {isToday && <span className="small"> · النهارده</span>}
        </span>
        <button type="button" className="mini" disabled={isToday} onClick={() => setDay((d) => addDays(d, 1))} aria-label="اليوم اللي بعده">بعد ←</button>
      </div>
      {!isToday && (
        <div className="btnrow" style={{ marginTop: -4, marginBottom: 10 }}>
          <button type="button" className="mini" onClick={() => setDay(cairoToday())}>رجوع للنهارده</button>
        </div>
      )}

      <div className="seg">
        {['الكل', ...coordinators.map((c) => c.id)].map((id) => (
          <button key={id} type="button" className={chip === id ? 'on' : ''} onClick={() => setChip(id)}>
            {id === 'الكل' ? 'الكل' : profileById(id)?.full_name ?? '؟'}
          </button>
        ))}
      </div>

      {!isToday && (
        <Hint>«X من Y» والفروع اللي ما اتزارتش محسوبة على خط اليوم ده زي ما هو متسجل دلوقتي — لو الخط اتغير بعدها، الأرقام القديمة مش هتطابق.</Hint>
      )}

      <ErrLine>{error}</ErrLine>
      {loading && data.visits.length === 0 && <p className="small">جارٍ التحميل…</p>}

      {zeros.total > 0 && (
        <>
          <Sect>أصناف صفر على الرف ({zeros.total})</Sect>
          <div className="cols">
            <div className="tscroll">
              <table className="t">
                <thead><tr><th>السبب</th><th>عدد</th></tr></thead>
                <tbody>
                  {zeros.byReason.map(([r, n]) => <tr key={r}><td>{r}</td><td className="mono">{n}</td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="tscroll">
              <table className="t">
                <thead><tr><th>الصنف</th><th>عدد</th></tr></thead>
                <tbody>
                  {zeros.bySku.map(([id, n]) => (
                    <tr key={id}><td>{skuById(id)?.name_ar ?? id}</td><td className="mono">{n}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && sections.length === 0 && (
        <Empty>{chip === 'الكل' ? 'مفيش خط سير ولا زيارات في اليوم ده' : 'المنسق ده مالوش خط ولا زيارات في اليوم ده'}</Empty>
      )}
      {sections.map((s) => <Section key={s.coord.id} s={s} />)}

      <Hint>الأيام والأوقات بتوقيت القاهرة.</Hint>
    </>
  );
}
