import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { FLAG_LABEL, ORDER_STATUS_LABEL, dwellText, stampOf, timeOf, todayISO } from '../../lib/format';
import { linesToMap, type OrderWithLines } from '../../lib/orders';
import { linesText } from '../../components/OrderLines';
import { Empty, Hint, Pill, Sect } from '../../components/ui';
import type { Order, OrderLine, Visit, VisitLine } from '../../lib/types';

const ORDER_TONE: Record<Order['status'], 'r' | 'g' | 'y' | 'n'> = {
  pending: 'y', leader_approved: 'y', approved: 'g', invoiced: 'g', rejected: 'r', cancelled: 'r',
};

/** Orders this coordinator placed in the last week, with where each one stands. */
function MyOrders() {
  const { profile, outletById, skuById } = useApp();
  const { data: orders } = useQuery<OrderWithLines[]>(
    async () => {
      if (!profile) return [];
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const o = await sb.from('orders').select('*').eq('created_by', profile.id)
        .gte('created_at', since).order('created_at', { ascending: false });
      if (o.error) throw o.error;
      const rows = (o.data ?? []) as Order[];
      if (rows.length === 0) return [];
      const l = await sb.from('order_lines').select('*').in('order_id', rows.map((x) => x.id));
      if (l.error) throw l.error;
      const lines = (l.data ?? []) as OrderLine[];
      return rows.map((x) => ({ ...x, lines: lines.filter((y) => y.order_id === x.id) }));
    },
    [profile?.id],
    [],
  );

  return (
    <>
      <Sect>أوردراتي — آخر ٧ أيام</Sect>
      {orders.length === 0 && <Empty>مفيش أوردرات</Empty>}
      {orders.map((o) => (
        <div className="card" key={o.id}>
          <b>{outletById(o.outlet_id)?.name ?? '؟'}</b> <span className="small">{stampOf(o.created_at)}</span>{' '}
          <Pill tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Pill>
          <br />
          <span className="small">{linesText(linesToMap(o.lines), (id) => skuById(id)?.name_ar)}</span>
          {o.cancel_reason && (o.status === 'cancelled' || o.status === 'rejected') && (
            <><br /><span className="small">السبب: {o.cancel_reason}</span></>
          )}
        </div>
      ))}
    </>
  );
}

export default function MyLog() {
  const { profile, outletById } = useApp();

  // Cheques left this screen in Oct 2026: supervisors collect them, coordinators never hold one.
  const { data } = useQuery<{ visits: Visit[]; lines: VisitLine[] }>(
    async () => {
      if (!profile) return { visits: [], lines: [] };
      const from = `${todayISO()}T00:00:00`;
      const v = await sb.from('visits').select('*').eq('coordinator_id', profile.id)
        .gte('checkin_at', from).order('checkin_at', { ascending: false });
      if (v.error) throw v.error;
      const visits = (v.data ?? []) as Visit[];
      let lines: VisitLine[] = [];
      if (visits.length) {
        const l = await sb.from('visit_lines').select('*').in('visit_id', visits.map((x) => x.id));
        if (l.error) throw l.error;
        lines = (l.data ?? []) as VisitLine[];
      }
      return { visits, lines };
    },
    [profile?.id],
    { visits: [], lines: [] },
  );

  return (
    <>
      <Hint>نشاطي اليوم</Hint>

      {data.visits.length === 0 && <Empty>لسه مفيش زيارات النهارده</Empty>}

      {data.visits.map((v) => {
        const o = outletById(v.outlet_id);
        const zeros = data.lines.filter((l) => l.visit_id === v.id && l.shelf === 0).length;
        const open = v.checkout_at == null;
        const cls = open ? 'pend' : v.status === 'approved' ? 'ok' : v.status === 'flagged' ? 'bad' : 'pend';
        return (
          <div className={`card feeditem ${cls}`} key={v.id}>
            <b>{o?.name ?? '؟'}</b> <span className="small">{timeOf(v.checkin_at)}</span>
            {v.off_route && <> <Pill tone="v">خارج الخط</Pill></>}
            <br />
            <span className="small">
              {open
                ? 'زيارة مفتوحة — لسه ما اتبعتتش'
                : `${zeros ? `${zeros} صنف صفر · ` : ''}${dwellText(v.dwell_seconds)} · ${
                    v.status === 'approved' ? 'اعتمدها المشرف'
                      : v.status === 'flagged' ? 'مرفوضة — راجع المشرف'
                      : 'في انتظار الاعتماد'
                  }`}
            </span>
            {v.flags.length > 0 && (
              <div className="btnrow">
                {v.flags.map((f) => <Pill key={f} tone="y">{FLAG_LABEL[f] ?? f}</Pill>)}
              </div>
            )}
          </div>
        );
      })}

      <MyOrders />
    </>
  );
}
