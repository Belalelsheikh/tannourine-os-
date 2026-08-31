import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fmt, todayISO } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Field, Hint } from '../../components/ui';
import type { Collection, InvoiceOpen } from '../../lib/types';

/**
 * Coordinator cheque intake — PRD §8. Custody starts here: received_by is the
 * coordinator until finance banks it.
 */
export default function CoordCheques() {
  const { profile, outlets, toast, bump } = useApp();
  const [outletId, setOutletId] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const chequeOutlets = outlets.filter((o) => o.payment_path !== 'transfer');

  const { data: open } = useQuery<InvoiceOpen[]>(
    async () => {
      if (outletId == null) return [];
      const { data, error } = await sb.from('invoice_open').select('*')
        .eq('outlet_id', outletId)
        .eq('status', 'delivered')
        .gt('open_amount', 0)
        .order('invoice_date');
      if (error) throw error;
      return (data ?? []) as InvoiceOpen[];
    },
    [outletId],
    [],
  );

  const logCheque = async (inv: InvoiceOpen) => {
    if (!profile) return;
    setErr(null);
    const amount = parseFloat(amounts[inv.id] ?? String(inv.open_amount));
    const chequeDate = dates[inv.id] ?? '';
    if (!amount || amount <= 0) { setErr('اكتب مبلغ صحيح'); return; }
    if (amount > inv.open_amount) { setErr('المبلغ أكبر من المفتوح على الفاتورة'); return; }
    if (!chequeDate) { setErr('تاريخ الشيك مطلوب'); return; }

    const row: Partial<Collection> = {
      invoice_id: inv.id,
      outlet_id: inv.outlet_id,
      type: 'cheque',
      amount,
      cheque_date: chequeDate,
      received_by: profile.id,
    };
    const { error } = await sb.from('collections').insert(row);
    if (error) { setErr(errText(error)); return; }
    toast('اتسجل — الشيك في عهدتك لحد ما يوصل المالية');
    setAmounts((a) => ({ ...a, [inv.id]: '' }));
    setDates((d) => ({ ...d, [inv.id]: '' }));
    bump();
  };

  return (
    <>
      <Hint>تسجيل استلام شيك من فرع</Hint>
      <Field label="الفرع">
        <select
          value={outletId ?? ''}
          onChange={(e) => setOutletId(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">— اختر —</option>
          {chequeOutlets.map((o) => (
            <option key={o.id} value={o.id}>{o.chain} — {o.name}</option>
          ))}
        </select>
      </Field>

      <ErrLine>{err}</ErrLine>

      {outletId != null && open.length === 0 && <Empty>لا فواتير مفتوحة مسلَّمة لهذا الفرع</Empty>}

      {open.map((inv) => (
        <div className="card" key={inv.id}>
          <b>فاتورة {inv.invoice_no}</b> — {inv.invoice_date} · مفتوح:{' '}
          <b className="mono">{fmt(inv.open_amount)}</b> ج
          <div className="f" style={{ marginTop: 8 }}>
            <label>مبلغ الشيك</label>
            <input
              inputMode="decimal"
              value={amounts[inv.id] ?? String(inv.open_amount)}
              onChange={(e) => setAmounts((a) => ({ ...a, [inv.id]: e.target.value }))}
            />
          </div>
          <div className="f">
            <label>تاريخ الشيك <em>*</em></label>
            <input
              type="date"
              value={dates[inv.id] ?? ''}
              max={todayISO().slice(0, 4) + '-12-31'}
              onChange={(e) => setDates((d) => ({ ...d, [inv.id]: e.target.value }))}
            />
          </div>
          <ActionButton className="mini dark" onClick={() => logCheque(inv)}>استلمت الشيك</ActionButton>
        </div>
      ))}
    </>
  );
}
