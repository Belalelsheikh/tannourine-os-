import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { INVOICE_STATUS_LABEL, fmt, stampOf } from '../../lib/format';
import { Empty, Pill, Sect } from '../../components/ui';
import type { Invoice } from '../../lib/types';

/**
 * عمرو's invoices — drafts and issued, read-only. Issuing happens on «للفوترة»; from
 * `issued` on, the invoice belongs to التوصيل (علي) and then المالية (سلمي).
 */
export default function Invoices() {
  const { outletById } = useApp();

  const { data: invoices } = useQuery<Invoice[]>(
    async () => {
      const { data, error } = await sb.from('invoices').select('*')
        .in('status', ['created', 'issued'])
        .order('invoice_no', { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
    [],
    [],
  );

  const drafts = invoices.filter((i) => i.status === 'created');
  const issued = invoices.filter((i) => i.status === 'issued');

  const card = (inv: Invoice) => {
    const ot = outletById(inv.outlet_id);
    return (
      <div className={`card feeditem ${inv.status === 'issued' ? 'ok' : 'pend'}`} key={inv.id}>
        <b>{ot?.name ?? '؟'}</b> — فاتورة {inv.invoice_no} · {inv.invoice_date}
        <br />
        <b className="mono">{fmt(inv.amount)} ج</b>{' '}
        <Pill tone={inv.status === 'issued' ? 'g' : 'n'}>{INVOICE_STATUS_LABEL[inv.status]}</Pill>
        {inv.eta_ref && <> <span className="small mono">ETA {inv.eta_ref}</span></>}
        <br />
        <span className="small">اتعملت {stampOf(inv.created_at)}</span>
      </div>
    );
  };

  return (
    <>
      <Sect>مسودات ({drafts.length})</Sect>
      {drafts.length === 0 && <Empty>—</Empty>}
      {drafts.map(card)}

      <Sect>صادرة — عند التوصيل ({issued.length})</Sect>
      {issued.length === 0 && <Empty>—</Empty>}
      {issued.map(card)}
    </>
  );
}
