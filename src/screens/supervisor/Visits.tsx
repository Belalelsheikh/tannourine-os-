import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { addDays, cairoDateOf, cairoDayRange, cairoTime, cairoToday, weekdayOf } from '../../lib/cairo';
import { DAY_LABELS, FLAG_LABEL } from '../../lib/format';
import {
  cairoRange, dayDiff, filterVisits, groupByCoordinator, historyCoordinators, lastWeek, outletTimeline, zeroCount,
  type HistoryFilter, type VisitWithLines,
} from '../../lib/visitsHistory';
import { Empty, ErrLine, Field, Hint, Pill, Sect, Segmented } from '../../components/ui';
import { VisitDetail, visitStatus } from '../../components/VisitDetail';
import type { Followup, Order, OrderLine, VisitStatus } from '../../lib/types';

/** PostgREST's default row cap; past it the oldest visits in the range are silently cut. */
const LIMIT = 1000;

const RANGES = ['آخر 7 أيام', 'آخر 30 يوم', 'الكل', 'تاريخ محدد'] as const;
type RangeKey = typeof RANGES[number];

const STATUS_OPTS: [string, HistoryFilter['status']][] = [
  ['الكل', 'الكل'], ['مستنية', 'pending'], ['اتعتمدت', 'approved'], ['اترفضت', 'flagged'],
];

const NO_FILTER: HistoryFilter = { coordinator: 'الكل', status: 'الكل', chain: 'الكل', q: '' };

/** `[from, to)` for the chosen range; null means all time. */
function bounds(key: RangeKey, custom: { from: string; to: string }) {
  const today = cairoToday();
  if (key === 'الكل') return null;
  if (key === 'تاريخ محدد') return cairoRange(custom.from, custom.to);
  if (key === 'آخر 30 يوم') return cairoRange(addDays(today, -29), today);
  const w = lastWeek(today);
  return cairoRange(w.from, w.to);
}

const label = (ts: string) => {
  const d = cairoDateOf(ts);
  return `${DAY_LABELS[weekdayOf(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)} · ${cairoTime(ts)}`;
};

interface Extras { followups: Followup[]; orders: Order[]; orderLines: OrderLine[] }

/** Follow-ups and same-day orders for one visit; loaded only once the row is opened. */
function RowDetail({ v, onOpenOutlet, onOpenFeed }: {
  v: VisitWithLines;
  onOpenOutlet?: () => void;
  onOpenFeed: () => void;
}) {
  const [photo, setPhoto] = useState(false);
  const { data } = useQuery<Extras>(
    async () => {
      const { from, to } = cairoDayRange(cairoDateOf(v.checkin_at));
      const [f, o] = await Promise.all([
        sb.from('followups').select('*').eq('visit_id', v.id),
        sb.from('orders').select('*').eq('outlet_id', v.outlet_id).gte('created_at', from).lt('created_at', to)
          .order('created_at'),
      ]);
      for (const res of [f, o]) if (res.error) throw res.error;
      const orders = (o.data ?? []) as Order[];
      let orderLines: OrderLine[] = [];
      if (orders.length) {
        const l = await sb.from('order_lines').select('*').in('order_id', orders.map((x) => x.id));
        if (l.error) throw l.error;
        orderLines = (l.data ?? []) as OrderLine[];
      }
      return { followups: (f.data ?? []) as Followup[], orders, orderLines };
    },
    [v.id],
    { followups: [], orders: [], orderLines: [] },
  );
  const pending = v.status === 'pending' && v.checkout_at != null;

  return (
    <>
      {(onOpenOutlet || pending) && (
        <div className="btnrow" style={{ marginTop: 10 }}>
          {onOpenOutlet && <button type="button" className="mini" onClick={onOpenOutlet}>سجل الفرع</button>}
          {pending && <button type="button" className="mini" onClick={onOpenFeed}>راجعها في المتابعة ←</button>}
        </div>
      )}
      <VisitDetail
        v={v}
        lines={v.visit_lines}
        followups={data.followups}
        orders={data.orders}
        orderLines={data.orderLines}
        photoShown={photo}
        onShowPhoto={() => setPhoto(true)}
      />
    </>
  );
}

function Row({ v, gap, hideCoordinator, open, onToggle, onOpenOutlet, onOpenFeed }: {
  v: VisitWithLines;
  gap?: number | null;
  /** Inside a coordinator's group the name is already in the heading. */
  hideCoordinator?: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenOutlet?: () => void;
  onOpenFeed: () => void;
}) {
  const { outletById, profileById } = useApp();
  const st = visitStatus(v);
  const zeros = zeroCount(v.visit_lines);
  const o = outletById(v.outlet_id);
  const tone = v.checkout_at == null ? 'pend' : v.status === 'approved' ? 'ok' : v.status === 'flagged' ? 'bad' : 'pend';

  return (
    <div className={`card feeditem ${tone}`}>
      <button type="button" className="vhead" aria-expanded={open} onClick={onToggle}>
        <span>
          <b><bdi>{o ? `${o.chain} ${o.name}` : '؟'}</bdi></b>
          <br />
          <span className="small">
            <span className="mono">{label(v.checkin_at)}</span>
            {!hideCoordinator && <> · {profileById(v.coordinator_id)?.full_name ?? '؟'}</>}
            {gap != null && <> · بعد <span className="mono">{gap}</span> يوم من اللي قبلها</>}
          </span>
          <br />
          <Pill tone={st.tone}>{st.label}</Pill>
          {v.flags.map((f) => <span key={f}> <Pill tone="y">{FLAG_LABEL[f] ?? f}</Pill></span>)}
          {zeros > 0 && <> <Pill tone="r">{zeros} {zeros === 1 ? 'صنف صفر' : 'أصناف صفر'}</Pill></>}
          {' '}
          {v.photo_path ? <Pill tone="n">فيها صورة</Pill> : <Pill tone="v">من غير صورة</Pill>}
        </span>
        <span className="chev">{open ? '▴' : '▾'}</span>
      </button>
      {open && <RowDetail v={v} onOpenOutlet={onOpenOutlet} onOpenFeed={onOpenFeed} />}
    </div>
  );
}

/**
 * Supervisor «الزيارات» — visit history for team and outlet follow-up: every visit in the
 * supervisor's area across statuses and days, plus an all-time timeline per outlet. Read-only;
 * reviewing stays in «المتابعة». Who is in the area: see `historyCoordinators()`.
 */
export default function SupervisorVisits({ onOpenFeed }: { onOpenFeed: () => void }) {
  const { profile, profiles, outlets, outletById, profileById } = useApp();
  const [range, setRange] = useState<RangeKey>('آخر 7 أيام');
  const [custom, setCustom] = useState(() => lastWeek(cairoToday()));
  const [f, setF] = useState<HistoryFilter>(NO_FILTER);
  const [drill, setDrill] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const team = useMemo(() => historyCoordinators(profile, profiles), [profile, profiles]);
  const ids = useMemo(() => team.map((c) => c.id), [team]);
  const span = bounds(range, custom);
  const chains = useMemo(() => [...new Set(outlets.map((o) => o.chain))].sort(), [outlets]);

  const base = () => sb.from('visits').select('*, visit_lines(*)').in('coordinator_id', ids)
    .order('checkin_at', { ascending: false }).limit(LIMIT);

  const list = useQuery<VisitWithLines[]>(
    async () => {
      if (ids.length === 0) return [];
      let q = base();
      if (span) q = q.gte('checkin_at', span.from).lt('checkin_at', span.to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as VisitWithLines[];
    },
    [ids.join(','), span?.from, span?.to],
    [],
  );

  // An outlet's whole record, not just the visits inside the current range.
  const outletList = useQuery<VisitWithLines[]>(
    async () => {
      if (drill == null || ids.length === 0) return [];
      const { data, error } = await base().eq('outlet_id', drill);
      if (error) throw error;
      return (data ?? []) as VisitWithLines[];
    },
    [drill, ids.join(',')],
    [],
  );

  const shown = useMemo(() => filterVisits(list.data, f, outletById), [list.data, f, outletById]);
  const groups = useMemo(() => groupByCoordinator(shown), [shown]);
  const toggle = (id: string) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const set = <K extends keyof HistoryFilter>(k: K, val: HistoryFilter[K]) => setF((x) => ({ ...x, [k]: val }));

  if (drill != null) {
    const o = outletById(drill);
    const timeline = outletTimeline(outletList.data);
    const last = timeline[0]?.visit;
    return (
      <>
        <div className="btnrow" style={{ marginTop: 0, marginBottom: 10 }}>
          <button type="button" className="mini" onClick={() => setDrill(null)}>→ رجوع للزيارات</button>
        </div>
        <Sect>سجل الفرع · <bdi>{o ? `${o.chain} ${o.name}` : '؟'}</bdi></Sect>
        <ErrLine>{outletList.error}</ErrLine>
        {outletList.loading && outletList.data.length === 0 && <p className="small">جارٍ التحميل…</p>}
        {last && (
          <p className="small" style={{ marginBottom: 10 }}>
            <span className="mono">{timeline.length}</span> زيارة · آخر زيارة{' '}
            {(() => {
              const n = dayDiff(cairoDateOf(last.checkin_at), cairoToday());
              return n === 0 ? 'النهارده' : <>من <span className="mono">{n}</span> يوم</>;
            })()}
          </p>
        )}
        {!outletList.loading && timeline.length === 0 && <Empty>مفيش زيارات متسجلة للفرع ده</Empty>}
        {timeline.map(({ visit, gap }) => (
          <Row
            key={visit.id}
            v={visit}
            gap={gap}
            open={open.has(visit.id)}
            onToggle={() => toggle(visit.id)}
            onOpenFeed={onOpenFeed}
          />
        ))}
        <Hint>الأيام والأوقات بتوقيت القاهرة.</Hint>
      </>
    );
  }

  return (
    <>
      <Segmented options={[...RANGES]} value={range} onChange={(v) => setRange(v as RangeKey)} />
      {range === 'تاريخ محدد' && (
        <div className="cols">
          <Field label="من">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
          </Field>
          <Field label="لحد">
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
          </Field>
        </div>
      )}

      <div className="seg">
        {STATUS_OPTS.map(([lbl, val]) => (
          <button key={val} type="button" className={f.status === val ? 'on' : ''} onClick={() => set('status', val as 'الكل' | VisitStatus)}>
            {lbl}
          </button>
        ))}
      </div>

      <div className="cols">
        <Field label="المنسق">
          <select value={f.coordinator} onChange={(e) => set('coordinator', e.target.value)}>
            <option value="الكل">الكل</option>
            {team.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}{!c.active && ' (موقوف)'}</option>
            ))}
          </select>
        </Field>
        <Field label="السلسلة">
          <select value={f.chain} onChange={(e) => set('chain', e.target.value)}>
            <option value="الكل">الكل</option>
            {chains.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="الفرع">
        <input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="اسم الفرع أو السلسلة" />
      </Field>

      <ErrLine>{list.error}</ErrLine>
      {list.loading && list.data.length === 0 && <p className="small">جارٍ التحميل…</p>}
      {!list.loading && (
        <p className="small" style={{ marginBottom: 8 }}>
          <span className="mono">{shown.length}</span> زيارة
          {f !== NO_FILTER && shown.length !== list.data.length && <> من <span className="mono">{list.data.length}</span></>}
        </p>
      )}
      {list.data.length === LIMIT && (
        <Hint>بيظهر آخر {LIMIT} زيارة بس في المدة دي — ضيّق التاريخ عشان تشوف الأقدم.</Hint>
      )}
      {!list.loading && shown.length === 0 && <Empty>مفيش زيارات بالفلاتر دي</Empty>}

      {groups.map((g) => {
        const c = profileById(g.coordinatorId);
        const zeros = g.visits.reduce((n, v) => n + zeroCount(v.visit_lines), 0);
        return (
          <div key={g.coordinatorId}>
            <Sect>
              {c?.full_name ?? '؟'}{c && !c.active && ' (موقوف)'} · <span className="mono">{g.visits.length}</span> زيارة
              {zeros > 0 && <> · <span className="mono">{zeros}</span> صنف صفر</>}
            </Sect>
            {g.visits.map((v) => (
              <Row
                key={v.id}
                v={v}
                hideCoordinator
                open={open.has(v.id)}
                onToggle={() => toggle(v.id)}
                onOpenOutlet={() => setDrill(v.outlet_id)}
                onOpenFeed={onOpenFeed}
              />
            ))}
          </div>
        );
      })}

      <Hint>الأيام والأوقات بتوقيت القاهرة.</Hint>
    </>
  );
}
