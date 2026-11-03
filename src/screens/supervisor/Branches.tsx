import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { cairoDayMonth, cairoToday } from '../../lib/cairo';
import { DAY_LABELS, DAY_ORDER } from '../../lib/format';
import { coordinatorsInScope } from '../../lib/scope';
import { historyCoordinators } from '../../lib/visitsHistory';
import {
  OVERDUE_DAYS, coordinatorBranches, filterTeam, matchesBranch, overdue, unroutedBranches,
  type BranchFilter, type BranchRow, type VisitSummaryRow,
} from '../../lib/branches';
import { Empty, ErrLine, Field, Hint, Pill, Sect, Segmented } from '../../components/ui';
import BranchPage from '../../components/BranchPage';
import Locations from './Locations';

const SEGMENTS = ['الفروع', 'المواقع'] as const;

function BranchLine({ r, groupCoordinator, onOpen }: { r: BranchRow; groupCoordinator?: string; onOpen: () => void }) {
  const { profileById } = useApp();
  const days = [...r.weekdays].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return (
    <button type="button" className={`rowbtn ${overdue(r) ? 'warn' : 'ok'}`} onClick={onOpen}
      style={{ display: 'block' }}>
      <b><bdi>{r.outlet.chain} {r.outlet.name}</bdi></b>
      {r.offRoute && <> <Pill tone="v">خارج الخط</Pill></>}
      <br />
      <span className="small">
        {r.lastAt == null
          ? <span style={{ color: 'var(--crit)', fontWeight: 600 }}>ما اتزارش</span>
          : (
            <>
              آخر زيارة {cairoDayMonth(r.lastAt)}
              {r.lastBy && r.lastBy !== groupCoordinator && <> — {profileById(r.lastBy)?.full_name ?? '؟'}</>}
              {' · '}
              <span className="mono" style={r.days != null && r.days > OVERDUE_DAYS ? { color: 'var(--crit)' } : undefined}>
                {r.days === 0 ? 'النهارده' : `من ${r.days} يوم`}
              </span>
            </>
          )}
        {days.length > 0 && <> · {days.map((d) => DAY_LABELS[d]).join('، ')}</>}
      </span>
    </button>
  );
}

/**
 * «الفروع» (Batch B1/B7): every branch per coordinator, longest unvisited first, then outlets
 * on nobody's route; a second segment maps one coordinator's day. Read-only except the pin
 * confirmation on the branch page.
 */
export default function Branches({ onOpenFeed }: { onOpenFeed?: () => void }) {
  const { profile, profiles, outlets, routes, outletById } = useApp();
  const [seg, setSeg] = useState<typeof SEGMENTS[number]>('الفروع');
  const [who, setWho] = useState<BranchFilter>('mine');
  const [q, setQ] = useState('');
  const [drill, setDrill] = useState<number | null>(null);

  const mine = useMemo(() => coordinatorsInScope(profile, profiles), [profile, profiles]);
  const area = useMemo(() => historyCoordinators(profile, profiles), [profile, profiles]);
  const team = useMemo(() => filterTeam(who, mine, area), [who, mine, area]);
  // The viewer's governorate for «مش على خط حد»; الكل sees the whole estate.
  const gov = profile && profile.role !== 'mgmt' && profile.scope !== 'الكل' ? profile.scope : null;

  const summary = useQuery<VisitSummaryRow[]>(
    async () => {
      const { data, error } = await sb.rpc('outlet_visit_summary');
      if (error) throw error;
      return (data ?? []) as VisitSummaryRow[];
    },
    [],
    [],
  );

  const today = cairoToday();
  const groups = useMemo(
    () => team
      .map((c) => ({ c, rows: coordinatorBranches(c.id, routes, summary.data, outletById, today) }))
      .filter((g) => g.rows.length > 0),
    [team, routes, summary.data, outletById, today],
  );
  const unrouted = useMemo(
    () => unroutedBranches(outlets, routes, summary.data, gov, today),
    [outlets, routes, summary.data, gov, today],
  );

  if (drill != null) {
    return <BranchPage outletId={drill} onBack={() => setDrill(null)} backLabel="رجوع للفروع" onOpenFeed={onOpenFeed} />;
  }

  const header = <Segmented options={[...SEGMENTS]} value={seg} onChange={(v) => setSeg(v as typeof SEGMENTS[number])} />;
  if (seg === 'المواقع') return <>{header}<Locations team={area} mine={mine} /></>;

  const shownUnrouted = unrouted.filter((r) => matchesBranch(r, q));

  return (
    <>
      {header}
      <div className="cols">
        <Field label="المنسق">
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="mine">فريقي</option>
            <option value="all">كل الفريق</option>
            {area.map((c) => <option key={c.id} value={c.id}>{c.full_name}{!c.active && ' (موقوف)'}</option>)}
          </select>
        </Field>
        <Field label="الفرع">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الفرع أو السلسلة" />
        </Field>
      </div>

      <ErrLine>{summary.error}</ErrLine>
      {summary.loading && summary.data.length === 0 && <p className="small">جارٍ التحميل…</p>}
      {!summary.loading && groups.length === 0 && <Empty>مفيش خطوط للمنسقين دول</Empty>}

      {groups.map(({ c, rows }) => {
        const shown = rows.filter((r) => matchesBranch(r, q));
        if (q.trim() && shown.length === 0) return null;
        const late = rows.filter(overdue).length;
        return (
          <div key={c.id}>
            <Sect>
              {c.full_name}{!c.active && ' (موقوف)'} · <span className="mono">{rows.length}</span> فرع
              {late > 0 && <> · <span className="mono" style={{ color: 'var(--crit)' }}>{late}</span> متأخر</>}
            </Sect>
            {shown.map((r) => (
              <BranchLine key={r.outlet.id} r={r} groupCoordinator={c.id} onOpen={() => setDrill(r.outlet.id)} />
            ))}
          </div>
        );
      })}

      {shownUnrouted.length > 0 && (
        <>
          <Sect>مش على خط حد · <span className="mono">{unrouted.length}</span> فرع</Sect>
          {shownUnrouted.map((r) => <BranchLine key={r.outlet.id} r={r} onOpen={() => setDrill(r.outlet.id)} />)}
        </>
      )}

      <Hint>
        آخر زيارة = آخر زيارة اتبعتت من أي منسق (الزيارة المفتوحة واللي المشرف قفلها مش محسوبين).
        الأحمر = أكتر من {OVERDUE_DAYS} أيام أو ما اتزارش. الأيام بتوقيت القاهرة.
      </Hint>
    </>
  );
}
