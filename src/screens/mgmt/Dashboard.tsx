import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { coordinatorsInScope } from '../../lib/scope';
import { fmt, timeOf, todayISO } from '../../lib/format';
import { Empty, Hint, Sect, StatTiles } from '../../components/ui';
import TeamNow from '../supervisor/TeamNow';
import type { BookStock, Collection, InvoiceOpen, Visit, VisitLine } from '../../lib/types';

interface Data {
  visits: Visit[];
  zeroLines: number;
  routedIds: string[];
  pendingOrders: number;
  undelivered: number;
  custody: Collection[];
  open: InvoiceOpen[];
  stock: BookStock[];
}

const EMPTY: Data = {
  visits: [], zeroLines: 0, routedIds: [], pendingOrders: 0,
  undelivered: 0, custody: [], open: [], stock: [],
};

/** Management dashboard — PRD §9. `readOnly` renders the same view for the router role. */
export default function Dashboard({ readOnly = false }: { readOnly?: boolean }) {
  const { profile, profiles, outletById, profileById } = useApp();

  const { data } = useQuery<Data>(
    async () => {
      const from = `${todayISO()}T00:00:00`;
      const head = { count: 'exact' as const, head: true };
      const [v, r, po, ud, cu, op, st] = await Promise.all([
        sb.from('visits').select('*').gte('checkin_at', from).order('checkin_at', { ascending: false }),
        sb.from('routes').select('coordinator_id').eq('weekday', new Date().getDay()),
        sb.from('orders').select('id', head).eq('status', 'pending'),
        sb.from('invoices').select('id', head).in('status', ['created', 'dispatched']),
        sb.from('collections').select('*').eq('type', 'cheque').eq('status', 'received'),
        sb.from('invoice_open').select('*').gt('open_amount', 0).eq('status', 'delivered'),
        sb.from('book_stock').select('*'),
      ]);
      for (const res of [v, r, po, ud, cu, op, st]) if (res.error) throw res.error;

      const visits = (v.data ?? []) as Visit[];
      let zeroLines = 0;
      if (visits.length) {
        const l = await sb.from('visit_lines').select('visit_id, shelf')
          .in('visit_id', visits.map((x) => x.id));
        if (l.error) throw l.error;
        zeroLines = ((l.data ?? []) as Pick<VisitLine, 'shelf'>[]).filter((x) => x.shelf === 0).length;
      }

      return {
        visits,
        zeroLines,
        routedIds: [...new Set(((r.data ?? []) as { coordinator_id: string }[]).map((x) => x.coordinator_id))],
        pendingOrders: po.count ?? 0,
        undelivered: ud.count ?? 0,
        custody: (cu.data ?? []) as Collection[],
        open: (op.data ?? []) as InvoiceOpen[],
        stock: (st.data ?? []) as BookStock[],
      };
    },
    [],
    EMPTY,
  );

  const team = coordinatorsInScope(profile, profiles);
  const silent = team.filter(
    (c) => data.routedIds.includes(c.id) && !data.visits.some((v) => v.coordinator_id === c.id),
  );
  const custodyAmount = data.custody.reduce((a, c) => a + Number(c.amount), 0);
  const totalOpen = data.open.reduce((a, i) => a + Number(i.open_amount), 0);

  return (
    <>
      {readOnly && <Hint>عرض فقط — لوحة متابعة</Hint>}

      <StatTiles
        items={[
          { n: data.visits.length, label: 'زيارات اليوم', tone: 'good' },
          { n: silent.length, label: 'منسقين صامتين', tone: silent.length ? 'bad' : undefined },
          { n: data.zeroLines, label: 'أصناف صفر اليوم', tone: data.zeroLines ? 'bad' : undefined },
          { n: data.pendingOrders, label: 'أوردرات معلقة', tone: data.pendingOrders ? 'w' : undefined },
          { n: data.undelivered, label: 'فواتير لم تُسلَّم', tone: data.undelivered ? 'w' : undefined },
          { n: data.custody.length, label: 'شيكات بالعهدة', tone: data.custody.length ? 'w' : undefined },
        ]}
      />

      <div className="card">
        <span className="small">إجمالي المستحقات المفتوحة</span>
        <br />
        <b className="mono" style={{ fontSize: 22 }}>{fmt(totalOpen)} ج</b>
        <br />
        <span className="small">منها {fmt(custodyAmount)} ج شيكات لسه في عهدة المنسقين</span>
      </div>

      {silent.length > 0 && (
        <div className="card feeditem bad">
          <b>بدون زيارات اليوم:</b>
          <br />
          <span className="small">{silent.map((s) => s.full_name).join(' · ')}</span>
        </div>
      )}

      <TeamNow embedded />

      <Sect>رصيد الدفاتر (كرتونة)</Sect>
      <div className="tscroll">
        <table className="t">
          <thead><tr><th>الصنف</th><th>وارد</th><th>خرج</th><th>الرصيد</th></tr></thead>
          <tbody>
            {data.stock.map((s) => {
              const bal = Number(s.cases_in) - Number(s.cases_out);
              return (
                <tr key={s.sku_id}>
                  <td>{s.name_ar}</td>
                  <td className="mono">{fmt(s.cases_in)}</td>
                  <td className="mono">{fmt(s.cases_out)}</td>
                  <td className="mono" style={bal <= 0 ? { color: 'var(--crit)' } : undefined}>{fmt(bal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Sect>آخر النشاط</Sect>
      {data.visits.length === 0 && <Empty>مفيش نشاط لسه</Empty>}
      {data.visits.slice(0, 8).map((v) => (
        <div className="card" key={v.id}>
          <span className="small mono">{timeOf(v.checkin_at)}</span> —{' '}
          <b>{profileById(v.coordinator_id)?.full_name ?? '؟'}</b> زار{' '}
          {outletById(v.outlet_id)?.name ?? '؟'}
          {v.checkout_at == null && <span className="small"> · لسه مفتوحة</span>}
        </div>
      ))}
    </>
  );
}
