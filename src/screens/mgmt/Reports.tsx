import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { addDays, cairoDayMonth, cairoToday } from '../../lib/cairo';
import { ALL_REASONS, dwellText, fmt0 } from '../../lib/format';
import {
  ALL, RAW_HEADER, byBranch, byChain, byCoordinator, bySku, latestVisitLines, plannedStops, rawRow, routeKeep, toCsv,
  type MarketStat, type ReportFilter, type ReportLine,
} from '../../lib/reports';
import { Empty, ErrLine, Field, Hint, Sect, Segmented } from '../../components/ui';
import type { ZeroReason } from '../../lib/types';

const PAGE = 1000;
const RANGES = ['آخر 7 أيام', 'آخر 30 يوم', 'تاريخ محدد'] as const;
type RangeKey = typeof RANGES[number];
const VIEWS = ['المنسقين', 'الأصناف', 'الأسواق'] as const;
type View = typeof VIEWS[number];
const SOLD = 'كراتين مباعة (حسب تسجيل المنسق)';

const reasonsText = (r: Partial<Record<ZeroReason, number>>) =>
  ALL_REASONS.filter((k) => r[k]).map((k) => `${k}: ${r[k]}`).join(' · ') || '—';
const pctText = (n: number | null) => (n == null ? '—' : `${n}%`);

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Every matching row, paged past PostgREST's 1000-row cap so totals are never cut. */
async function fetchAll(f: ReportFilter): Promise<ReportLine[]> {
  const out: ReportLine[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('report_lines').select('*').gte('cairo_date', f.from).lte('cairo_date', f.to);
    if (f.coordinator !== ALL) q = q.eq('coordinator_id', f.coordinator);
    if (f.chain !== ALL) q = q.eq('chain', f.chain);
    if (f.outlet !== ALL) q = q.eq('outlet_id', Number(f.outlet));
    if (f.sku !== ALL) q = q.eq('sku_id', f.sku);
    if (f.gov !== ALL) q = q.eq('gov', f.gov);
    const { data, error } = await q.order('visit_id').order('sku_id').range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as ReportLine[]));
    if ((data ?? []).length < PAGE) return out;
  }
}

/**
 * mgmt «التقارير» (Batch C): read-only views over `report_lines`. Every row narrows the shared
 * filters and moves to the next view. Shelf and warehouse are never summed across SKUs.
 */
export default function Reports() {
  const { profiles, outlets, skus, routes, outletById, profileById } = useApp();
  const today = cairoToday();
  const [range, setRange] = useState<RangeKey>('آخر 7 أيام');
  const [custom, setCustom] = useState({ from: addDays(today, -6), to: today });
  const [view, setView] = useState<View>('المنسقين');
  const [sel, setSel] = useState({ coordinator: ALL, chain: ALL, outlet: ALL, sku: ALL, gov: ALL });

  const span = range === 'تاريخ محدد' ? custom
    : { from: addDays(today, range === 'آخر 30 يوم' ? -29 : -6), to: today };
  const f: ReportFilter = { ...span, ...sel };
  const set = (p: Partial<typeof sel>) => setSel((s) => ({ ...s, ...p }));

  const coordinators = profiles.filter((p) => p.role === 'coordinator');
  const govs = useMemo(() => [...new Set(outlets.map((o) => o.gov))].sort(), [outlets]);
  const chains = useMemo(
    () => [...new Set(outlets.filter((o) => sel.gov === ALL || o.gov === sel.gov).map((o) => o.chain))].sort(),
    [outlets, sel.gov],
  );
  const branchOpts = outlets.filter((o) =>
    (sel.chain === ALL || o.chain === sel.chain) && (sel.gov === ALL || o.gov === sel.gov));
  const order = skus.map((s) => s.id);

  const list = useQuery<ReportLine[]>(
    () => fetchAll(f),
    [f.from, f.to, f.coordinator, f.chain, f.outlet, f.sku, f.gov],
    [],
  );
  const rows = list.data;

  const coordStats = useMemo(
    () => byCoordinator(rows, plannedStops(routes, f.from, f.to, routeKeep(f, outletById)),
      (id) => profileById(id)?.full_name ?? '؟'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, routes, f.from, f.to, f.coordinator, f.chain, f.outlet, f.gov],
  );
  const skuStats = useMemo(() => bySku(rows, order), [rows, skus]);
  const chainStats = useMemo(() => byChain(rows, today), [rows, today]);
  const branchStats = useMemo(() => byBranch(rows, today), [rows, today]);
  const grid = useMemo(() => (sel.outlet === ALL ? [] : latestVisitLines(rows, order)), [rows, sel.outlet, skus]);

  const marketLevel = sel.outlet !== ALL ? 'branch' : sel.chain !== ALL ? 'branches' : 'chains';
  const markets: MarketStat[] = marketLevel === 'chains' ? chainStats : branchStats;

  const exportCsv = () => {
    const raw = { header: RAW_HEADER, rows: rows.map(rawRow) };
    let summary: { header: string[]; rows: unknown[][] };
    if (view === 'المنسقين') {
      summary = {
        header: ['المنسق', 'محطات مخططة', 'اتزارت منها', 'نسبة الإنجاز %', 'زيارات', 'فروع', 'متوسط المدة (ث)',
          'أقل من 10 د', 'من غير GPS', 'أبعد من 150 م', 'خارج الخط', 'بصور', 'اتعتمدت', 'اترفضت', 'أصناف صفر', SOLD],
        rows: coordStats.map((c) => [c.name, c.planned, c.plannedVisited, c.completion, c.visits, c.branches, c.avgDwellS,
          c.short, c.noGps, c.far, c.offRoute, c.withPhotos, c.approved, c.rejected, c.zeroLines, c.sold]),
      };
    } else if (view === 'الأصناف') {
      summary = {
        header: ['الصنف', 'الخط', 'سطور', 'صفر %', ...ALL_REASONS, SOLD, 'أعلى الفروع'],
        rows: skuStats.map((s) => [s.name, s.line, s.lines, s.zeroPct, ...ALL_REASONS.map((k) => s.reasons[k] ?? 0), s.sold,
          s.top.map((t) => `${t.label} (${t.sold})`).join(' | ')]),
      };
    } else {
      summary = {
        header: [marketLevel === 'chains' ? 'السلسلة' : 'الفرع', 'زيارات', 'آخر زيارة', 'من كام يوم', 'صفر %', ...ALL_REASONS, SOLD],
        rows: markets.map((m) => [m.label, m.visits, m.lastAt?.slice(0, 10), m.days, m.zeroPct,
          ...ALL_REASONS.map((k) => m.reasons[k] ?? 0), m.sold]),
      };
    }
    download(`tannourine-${view}-${f.from}_${f.to}.csv`, toCsv([summary, raw]));
  };

  const filtered = Object.values(sel).some((v) => v !== ALL);

  return (
    <>
      <Segmented options={[...RANGES]} value={range} onChange={(v) => setRange(v as RangeKey)} />
      {range === 'تاريخ محدد' && (
        <div className="cols">
          <Field label="من">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
          </Field>
          <Field label="لحد">
            <input type="date" value={custom.to} min={custom.from} max={today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
          </Field>
        </div>
      )}

      <div className="cols-3">
        <Field label="المنسق">
          <select value={sel.coordinator} onChange={(e) => set({ coordinator: e.target.value })}>
            <option value={ALL}>الكل</option>
            {coordinators.map((c) => <option key={c.id} value={c.id}>{c.full_name}{!c.active && ' (موقوف)'}</option>)}
          </select>
        </Field>
        <Field label="المحافظة">
          <select value={sel.gov} onChange={(e) => set({ gov: e.target.value, chain: ALL, outlet: ALL })}>
            <option value={ALL}>الكل</option>
            {govs.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="الصنف">
          <select value={sel.sku} onChange={(e) => set({ sku: e.target.value })}>
            <option value={ALL}>الكل</option>
            {skus.map((s) => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
          </select>
        </Field>
        <Field label="السلسلة">
          <select value={sel.chain} onChange={(e) => set({ chain: e.target.value, outlet: ALL })}>
            <option value={ALL}>الكل</option>
            {chains.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="الفرع">
          <select value={sel.outlet} onChange={(e) => set({ outlet: e.target.value })}>
            <option value={ALL}>الكل</option>
            {branchOpts.map((o) => <option key={o.id} value={String(o.id)}>{o.chain} {o.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="btnrow" style={{ marginTop: 0, marginBottom: 8 }}>
        {filtered && (
          <button type="button" className="mini" onClick={() => setSel({ coordinator: ALL, chain: ALL, outlet: ALL, sku: ALL, gov: ALL })}>
            امسح الفلاتر
          </button>
        )}
        <button type="button" className="mini dark" disabled={list.loading} onClick={exportCsv}>تصدير CSV</button>
      </div>

      <Segmented options={[...VIEWS]} value={view} onChange={(v) => setView(v as View)} />

      <ErrLine>{list.error}</ErrLine>
      {list.loading && <p className="small">جارٍ التحميل…</p>}
      {!list.loading && (
        <p className="small" style={{ marginBottom: 8 }}>
          <span className="mono">{fmt0(new Set(rows.map((r) => r.visit_id)).size)}</span> زيارة ·{' '}
          <span className="mono">{fmt0(rows.length)}</span> سطر صنف · من {cairoDayMonth(`${f.from}T12:00:00Z`)} لـ {cairoDayMonth(`${f.to}T12:00:00Z`)}
        </p>
      )}

      {view === 'المنسقين' && (
        coordStats.length === 0 ? <Empty>مفيش بيانات بالفلاتر دي</Empty> : (
          <div className="tscroll">
            <table className="t">
              <thead>
                <tr>
                  <th>المنسق</th><th>مخطط</th><th>اتزار</th><th>إنجاز</th><th>زيارات</th><th>فروع</th><th>متوسط المدة</th>
                  <th>أقل من 10 د</th><th>من غير GPS</th><th>أبعد من 150 م</th><th>خارج الخط</th><th>بصور</th>
                  <th>اتعتمدت</th><th>اترفضت</th><th>أصناف صفر</th><th>{SOLD}</th>
                </tr>
              </thead>
              <tbody>
                {coordStats.map((c) => (
                  <tr key={c.coordinator_id} className="clickrow"
                    onClick={() => { set({ coordinator: c.coordinator_id }); setView('الأصناف'); }}>
                    <td>{c.name}</td>
                    <td className="mono">{c.planned}</td>
                    <td className="mono">{c.plannedVisited}</td>
                    <td className="mono">{pctText(c.completion)}</td>
                    <td className="mono">{c.visits}</td>
                    <td className="mono">{c.branches}</td>
                    <td className="mono">{dwellText(c.avgDwellS)}</td>
                    <td className="mono">{c.short}</td>
                    <td className="mono">{c.noGps}</td>
                    <td className="mono">{c.far}</td>
                    <td className="mono">{c.offRoute}</td>
                    <td className="mono">{c.withPhotos}</td>
                    <td className="mono">{c.approved}</td>
                    <td className="mono">{c.rejected}</td>
                    <td className="mono">{c.zeroLines}</td>
                    <td className="mono">{fmt0(c.sold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {view === 'الأصناف' && (
        skuStats.length === 0 ? <Empty>مفيش بيانات بالفلاتر دي</Empty> : (
          <div className="tscroll">
            <table className="t">
              <thead>
                <tr><th>الصنف</th><th>سطور</th><th>صفر</th><th>أسباب الصفر</th><th>{SOLD}</th><th>أعلى الفروع</th></tr>
              </thead>
              <tbody>
                {skuStats.map((s) => (
                  <tr key={s.sku_id} className="clickrow" onClick={() => { set({ sku: s.sku_id }); setView('الأسواق'); }}>
                    <td>{s.name}{s.line === 'VIA' && <span className="tag"> ڤيا</span>}</td>
                    <td className="mono">{s.lines}</td>
                    <td className="mono">{pctText(s.zeroPct)}</td>
                    <td className="small">{reasonsText(s.reasons)}</td>
                    <td className="mono">{fmt0(s.sold)}</td>
                    <td className="small">{s.top.map((t) => `${t.label} (${t.sold})`).join('، ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {view === 'الأسواق' && (
        <>
          {marketLevel !== 'chains' && (
            <div className="btnrow" style={{ marginTop: 0, marginBottom: 8 }}>
              <button type="button" className="mini" onClick={() => set(marketLevel === 'branch' ? { outlet: ALL } : { chain: ALL })}>
                → {marketLevel === 'branch' ? `كل فروع ${sel.chain === ALL ? 'السلسلة' : sel.chain}` : 'كل السلاسل'}
              </button>
            </div>
          )}
          {markets.length === 0 ? <Empty>مفيش بيانات بالفلاتر دي</Empty> : (
            <div className="tscroll">
              <table className="t">
                <thead>
                  <tr>
                    <th>{marketLevel === 'chains' ? 'السلسلة' : 'الفرع'}</th><th>زيارات</th><th>آخر زيارة</th><th>من كام يوم</th>
                    <th>صفر</th><th>أسباب الصفر</th><th>{SOLD}</th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m) => (
                    <tr key={m.key} className={marketLevel === 'branch' ? '' : 'clickrow'} onClick={() => {
                      if (marketLevel === 'chains') set({ chain: m.key });
                      else if (marketLevel === 'branches' && m.outlet_id != null) set({ outlet: String(m.outlet_id) });
                    }}>
                      <td><bdi>{m.label}</bdi></td>
                      <td className="mono">{m.visits}</td>
                      <td>{m.lastAt ? cairoDayMonth(m.lastAt) : '—'}</td>
                      <td className="mono" style={m.days != null && m.days > 7 ? { color: 'var(--crit)' } : undefined}>{m.days ?? '—'}</td>
                      <td className="mono">{pctText(m.zeroPct)}</td>
                      <td className="small">{reasonsText(m.reasons)}</td>
                      <td className="mono">{fmt0(m.sold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {marketLevel === 'branch' && grid.length > 0 && (
            <>
              <Sect>
                آخر زيارة في المدة · {cairoDayMonth(grid[0].checkin_at)} — {grid[0].coordinator_name}
              </Sect>
              <div className="tscroll">
                <table className="t">
                  <thead><tr><th>الصنف</th><th>رف</th><th>مخزن</th><th>بيع (حسب تسجيل المنسق)</th><th>سبب الصفر</th></tr></thead>
                  <tbody>
                    {grid.map((r) => (
                      <tr key={r.sku_id} className={r.shelf === 0 && r.warehouse === 0 ? 'crit' : ''}>
                        <td>{r.sku_name}</td>
                        <td className="mono">{r.shelf}</td>
                        <td className="mono">{r.warehouse}</td>
                        <td className="mono">{r.sold_cases}</td>
                        <td>{r.zero_reason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <Hint>
        الأرقام من الزيارات اللي اتبعتت بس (مش المفتوحة ولا اللي المشرف قفلها). المخطط = خطوط النهارده على كل يوم في المدة.
        البعد محسوب من موقع الفرع الحالي. الرف والمخزن مش بيتجمعوا بين الأصناف. البيع حسب تسجيل المنسق. الأيام بتوقيت القاهرة.
      </Hint>
    </>
  );
}
