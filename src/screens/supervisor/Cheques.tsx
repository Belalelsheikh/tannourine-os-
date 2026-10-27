import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { COLLECTION_STATUS_LABEL, daysSince, fmt, todayISO } from '../../lib/format';
import { parseAmount } from '../../lib/numerals';
import { ActionButton, Empty, ErrLine, Field, Sect } from '../../components/ui';
import type { Collection, InvoiceOpen } from '../../lib/types';

/**
 * Cheque intake — PRD §8, changed Oct 2026: supervisors collect cheques from branches,
 * coordinators do not. Custody starts here: received_by is the supervisor until finance
 * banks it. RLS (col_ins_sup) only lets a supervisor insert a cheque in their own name.
 */
export default function SupCheques() {
  const { profile, outlets, outletById, toast, bump } = useApp();
  const [outletId, setOutletId] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const chequeOutlets = outlets.filter((o) => o.payment_path !== 'transfer');

  const { data: custody } = useQuery<Collection[]>(
    async () => {
      if (!profile) return [];
      const { data, error } = await sb.from('collections').select('*')
        .eq('received_by', profile.id).eq('type', 'cheque').eq('status', 'received')
        .order('received_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Collection[];
    },
    [profile?.id],
    [],
  );

  const { data: open } = useQuery<InvoiceOpen[]>(
    async () => {
      if (outletId == null) return [];
      const { data, error } = await sb.from('invoice_open').select('*')
        .eq('outlet_id', outletId)
        // Money only lands on invoices matched to their إذن استلام (legacy balances excepted).
        .or('status.eq.matched,legacy.eq.true')
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
    const amount = parseAmount(amounts[inv.id] ?? String(inv.open_amount));
    const chequeDate = dates[inv.id] ?? '';
    if (amount == null || amount <= 0) { setErr('اكتب مبلغ صحيح'); return; }
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
      <Sect>شيكات في عهدتي ({custody.length})</Sect>
      {custody.length === 0 && <Empty>مفيش شيكات في عهدتك</Empty>}
      {custody.map((c) => (
        <div className="card" key={c.id}>
          <b>{outletById(c.outlet_id)?.name ?? '؟'}</b> — <span className="mono">{fmt(c.amount)}</span> ج
          <br />
          <span className="small">
            تاريخ الشيك {c.cheque_date} · {COLLECTION_STATUS_LABEL[c.status]} من {daysSince(c.received_at)} يوم
          </span>
        </div>
      ))}

      <Sect>تسجيل استلام شيك من فرع</Sect>
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
