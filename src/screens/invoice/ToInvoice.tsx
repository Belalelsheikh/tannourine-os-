import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fetchOrdersWithLines, linesToMap, type OrderWithLines } from '../../lib/orders';
import { fmt, stampOf } from '../../lib/format';
import { linesText, useOrderAmount } from '../../components/OrderLines';
import { ActionButton, Empty, ErrLine, Hint, Sect } from '../../components/ui';
import type { Invoice } from '../../lib/types';

/** A draft still not issued on the portal a day later is holding goods back. */
const STALE_DRAFT_MS = 24 * 3600 * 1000;

/**
 * Approved orders → invoices. The invoice is the goods-release document (PRD §1),
 * so nothing here is speculative: order flips to `invoiced` first (the only
 * transition RLS grants this role), then the invoice and its price snapshot land.
 *
 * The app invoice mirrors the e-invoice on the portal: it stays a draft (`created`) until
 * عمرو types the portal's ETA number, which is what makes it `issued` and visible to التوصيل.
 */
export default function ToInvoice() {
  const { profile, skus, outletById, skuById, bump, toast } = useApp();
  const amountOf = useOrderAmount();
  const [err, setErr] = useState<string | null>(null);

  const [eta, setEta] = useState<Record<string, string>>({});

  const { data: orders } = useQuery<OrderWithLines[]>(
    () => fetchOrdersWithLines(['approved']),
    [],
    [],
  );

  const { data: drafts } = useQuery<Invoice[]>(
    async () => {
      const { data, error } = await sb.from('invoices').select('*')
        .eq('status', 'created').order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
    [],
    [],
  );

  const issue = async (inv: Invoice) => {
    setErr(null);
    const ref = (eta[inv.id] ?? '').trim();
    if (!ref) { setErr('اكتب رقم الفاتورة الإلكترونية الأول'); return; }
    const { data, error } = await sb.from('invoices').update({ status: 'issued', eta_ref: ref })
      .eq('id', inv.id).eq('status', 'created').select('id');
    if (error) { setErr(`ما اتسجلش: ${errText(error)} — الرقم لسه مكتوب، حاول تاني`); return; }
    if ((data?.length ?? 0) === 0) { setErr('الفاتورة اتغيرت من حد تاني — حدّث الشاشة'); bump(); return; }
    toast(`فاتورة ${inv.invoice_no} صادرة — راحت للتوصيل`);
    setEta(({ [inv.id]: _, ...rest }) => rest);
    bump();
  };

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

      toast(`اتعملت مسودة فاتورة ${inv.data.invoice_no} — اكتب رقم الفاتورة الإلكترونية تحت`);
      bump();
    } catch (e) {
      setErr(`ما اتعملتش: ${errText(e)} — حاول تاني`);
      bump();
    }
  };

  return (
    <>
      <Hint>أوردرات معتمدة — أنشئ الفاتورة، أصدرها على البوابة، واكتب رقمها هنا</Hint>
      <ErrLine>{err}</ErrLine>

      <Sect>مسودات — مستنية رقم الفاتورة الإلكترونية ({drafts.length})</Sect>
      {drafts.length === 0 && <Empty>—</Empty>}
      {drafts.map((inv) => {
        const ot = outletById(inv.outlet_id);
        const stale = Date.now() - new Date(inv.created_at).getTime() > STALE_DRAFT_MS;
        return (
          <div className={`card feeditem ${stale ? 'bad' : 'pend'}`} key={inv.id}>
            <b>{ot?.name ?? '؟'}</b> — {ot?.chain ?? ''} · فاتورة {inv.invoice_no}
            <br />
            <b className="mono">{fmt(inv.amount)} ج</b>{' '}
            <span className="small">اتعملت {stampOf(inv.created_at)}</span>
            {stale && <><br /><b className="err" style={{ margin: 0 }}>لم تصدر بعد</b></>}
            <input
              value={eta[inv.id] ?? ''}
              onChange={(e) => setEta({ ...eta, [inv.id]: e.target.value })}
              placeholder="رقم الفاتورة الإلكترونية"
              inputMode="text"
              style={{ marginTop: 8 }}
            />
            <div className="btnrow">
              <ActionButton
                className="mini grn"
                disabled={!(eta[inv.id] ?? '').trim()}
                onClick={() => issue(inv)}
              >
                تم الإصدار
              </ActionButton>
            </div>
          </div>
        );
      })}

      <Sect>أوردرات معتمدة ({orders.length})</Sect>
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
