import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fetchOrdersWithLines, linesToMap, type OrderWithLines } from '../../lib/orders';
import { fmt } from '../../lib/format';
import { useOrderAmount, linesText } from '../../components/OrderLines';
import { ActionButton, Empty, ErrLine, Pill, Sect } from '../../components/ui';

/** Order board — approve/reject; approved rows are what the invoice desk sees (PRD §6). */
export default function Board() {
  const { profile, outletById, skuById, bump, toast } = useApp();
  const amountOf = useOrderAmount();
  const [err, setErr] = useState<string | null>(null);

  const { data: orders } = useQuery<OrderWithLines[]>(
    () => fetchOrdersWithLines(['pending', 'approved']),
    [],
    [],
  );

  const pending = orders.filter((o) => o.status === 'pending');
  const approved = orders.filter((o) => o.status === 'approved');

  const decide = async (o: OrderWithLines, status: 'approved' | 'rejected') => {
    if (!profile) return;
    setErr(null);
    const { error } = await sb.from('orders').update({
      status, decided_by: profile.id, decided_at: new Date().toISOString(),
    }).eq('id', o.id);
    if (error) { setErr(errText(error)); return; }
    toast(status === 'approved' ? 'اتعتمد — راح للفواتير' : 'اترفض');
    bump();
  };

  const describe = (o: OrderWithLines) => linesText(linesToMap(o.lines), (id) => skuById(id)?.name_ar);

  return (
    <>
      <ErrLine>{err}</ErrLine>

      <Sect>في انتظار الاعتماد ({pending.length})</Sect>
      {pending.length === 0 && <Empty>مفيش أوردرات معلقة</Empty>}
      {pending.map((o) => {
        const ot = outletById(o.outlet_id);
        return (
          <div className="card feeditem pend" key={o.id}>
            <b>{ot?.name ?? '؟'}</b> — {ot?.chain ?? ''}{' '}
            <Pill tone={o.source === 'email' ? 'v' : 'n'}>
              {o.source === 'email' ? `إيميل${o.po_number ? ` · ${o.po_number}` : ''}` : 'منسق'}
            </Pill>
            <br />
            <span className="small">{describe(o)}</span>
            <br />
            <b className="mono">{fmt(amountOf(linesToMap(o.lines)))} ج</b>{' '}
            <span className="small">شامل الضريبة · {o.order_date}</span>
            <div className="btnrow">
              <ActionButton className="mini grn" onClick={() => decide(o, 'approved')}>اعتماد</ActionButton>
              <ActionButton className="mini red" onClick={() => decide(o, 'rejected')}>رفض</ActionButton>
            </div>
          </div>
        );
      })}

      <Sect>معتمد — عند الفواتير ({approved.length})</Sect>
      {approved.length === 0 && <Empty>—</Empty>}
      {approved.map((o) => {
        const ot = outletById(o.outlet_id);
        return (
          <div className="card feeditem ok" key={o.id}>
            <b>{ot?.name ?? '؟'}</b> — {ot?.chain ?? ''}
            <br />
            <span className="small">{describe(o)}</span>
            <br />
            <b className="mono">{fmt(amountOf(linesToMap(o.lines)))} ج</b>
          </div>
        );
      })}
    </>
  );
}
