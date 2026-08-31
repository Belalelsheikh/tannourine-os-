import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fetchOrdersWithLines, linesToMap, type OrderWithLines } from '../../lib/orders';
import { fmt } from '../../lib/format';
import { linesText, useOrderAmount } from '../../components/OrderLines';
import { ActionButton, Empty, ErrLine, Hint } from '../../components/ui';

/**
 * Approved orders → invoices. The invoice is the goods-release document (PRD §1),
 * so nothing here is speculative: order flips to `invoiced` first (the only
 * transition RLS grants this role), then the invoice and its price snapshot land.
 */
export default function ToInvoice() {
  const { profile, skus, outletById, skuById, bump, toast } = useApp();
  const amountOf = useOrderAmount();
  const [err, setErr] = useState<string | null>(null);

  const { data: orders } = useQuery<OrderWithLines[]>(
    () => fetchOrdersWithLines(['approved']),
    [],
    [],
  );

  const createInvoice = async (o: OrderWithLines) => {
    if (!profile) return;
    setErr(null);
    const map = linesToMap(o.lines);
    const amount = amountOf(map);

    try {
      // 1) claim the order (approved → invoiced)
      const claim = await sb.from('orders').update({ status: 'invoiced' })
        .eq('id', o.id).eq('status', 'approved').select('id');
      if (claim.error) throw claim.error;
      if ((claim.data?.length ?? 0) === 0) {
        setErr('الأوردر اتفوتر أو اتغير من حد تاني — حدّث الشاشة');
        bump();
        return;
      }

      // 2) invoice header
      const inv = await sb.from('invoices').insert({
        order_id: o.id,
        outlet_id: o.outlet_id,
        amount,
        created_by: profile.id,
      }).select('id, invoice_no').single();
      if (inv.error) throw inv.error;

      // 3) line snapshot at today's prices
      const rows = o.lines.map((l) => ({
        invoice_id: inv.data.id,
        sku_id: l.sku_id,
        cases: l.cases,
        price_case: skus.find((s) => s.id === l.sku_id)?.price_case_incl_vat ?? 0,
      }));
      const lineRes = await sb.from('invoice_lines').insert(rows);
      if (lineRes.error) throw lineRes.error;

      toast(`اتعملت فاتورة ${inv.data.invoice_no} — البضاعة تخرج بيها`);
      bump();
    } catch (e) {
      setErr(`ما اتعملتش: ${errText(e)} — حاول تاني`);
      bump();
    }
  };

  return (
    <>
      <Hint>أوردرات معتمدة — أنشئ الفاتورة وبها تخرج البضاعة من المخزن</Hint>
      <ErrLine>{err}</ErrLine>
      {orders.length === 0 && <Empty>مفيش أوردرات جاهزة للفوترة</Empty>}

      {orders.map((o) => {
        const ot = outletById(o.outlet_id);
        const map = linesToMap(o.lines);
        return (
          <div className="card" key={o.id}>
            <b>{ot?.name ?? '؟'}</b> — {ot?.chain ?? ''}{' '}
            <span className="small">{o.order_date}{o.po_number ? ` · ${o.po_number}` : ''}</span>
            <br />
            <span className="small">{linesText(map, (id) => skuById(id)?.name_ar)}</span>
            <br />
            <b className="mono">{fmt(amountOf(map))} ج</b> <span className="small">شامل الضريبة</span>
            <div className="btnrow">
              <ActionButton className="mini dark" onClick={() => createInvoice(o)}>إنشاء فاتورة</ActionButton>
            </div>
          </div>
        );
      })}
    </>
  );
}
