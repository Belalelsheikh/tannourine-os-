import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { INVOICE_STATUS_LABEL, fmt, todayISO } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Field, Hint, Pill, Sect } from '../../components/ui';
import type { Invoice } from '../../lib/types';

/**
 * تصحيحات — voids and pre-app receivables (PRD §7, §9).
 * Nothing is ever hard-deleted: a void is a status plus a reason plus an audit row.
 */
export default function Corrections() {
  const { profile, outlets, outletById, bump, toast } = useApp();
  const [q, setQ] = useState('');
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // legacy import form
  const [lgOutlet, setLgOutlet] = useState<number | null>(null);
  const [lgDate, setLgDate] = useState(todayISO());
  const [lgAmount, setLgAmount] = useState('');
  const [lgErr, setLgErr] = useState<string | null>(null);

  const { data: invoices } = useQuery<Invoice[]>(
    async () => {
      const { data, error } = await sb.from('invoices').select('*')
        .order('invoice_no', { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
    [],
    [],
  );

  const needle = q.trim();
  const matches = invoices.filter((i) => {
    if (!needle) return i.status !== 'void';
    const o = outletById(i.outlet_id);
    return (
      String(i.invoice_no).includes(needle) ||
      (o ? (o.name + o.chain).includes(needle) : false)
    );
  }).slice(0, 40);

  const voidInvoice = async (inv: Invoice) => {
    if (!profile) return;
    setErr(null);
    if (!reason.trim()) { setErr('سبب الإلغاء مطلوب'); return; }

    const { error } = await sb.from('invoices').update({
      status: 'void',
      void_reason: reason.trim(),
      voided_by: profile.id,
      voided_at: new Date().toISOString(),
    }).eq('id', inv.id);
    if (error) { setErr(errText(error)); return; }

    const auditErr = await audit(profile.id, 'void_invoice', 'invoices', inv.id, {
      invoice_no: inv.invoice_no, amount: inv.amount, reason: reason.trim(),
    });
    if (auditErr) toast(`اتلغت — لكن السجل ما اتكتبش: ${auditErr}`);
    else toast('اتلغت الفاتورة — خرجت من الأعمار والمخزون');
    setVoidFor(null);
    setReason('');
    bump();
  };

  const addLegacy = async () => {
    if (!profile) return;
    setLgErr(null);
    const amount = parseFloat(lgAmount);
    if (lgOutlet == null) { setLgErr('اختر الفرع'); return; }
    if (!amount || amount <= 0) { setLgErr('اكتب مبلغ صحيح'); return; }
    if (!lgDate) { setLgErr('تاريخ الفاتورة مطلوب'); return; }

    // legacy = true, delivered, no lines — ages truthfully but never touches book stock.
    const ins = await sb.from('invoices').insert({
      outlet_id: lgOutlet,
      invoice_date: lgDate,
      amount,
      status: 'delivered',
      legacy: true,
      delivered_at: new Date(lgDate).toISOString(),
      created_by: profile.id,
    }).select('id, invoice_no').single();
    if (ins.error) { setLgErr(errText(ins.error)); return; }

    await audit(profile.id, 'legacy_invoice', 'invoices', ins.data.id, {
      invoice_no: ins.data.invoice_no, outlet_id: lgOutlet, amount, invoice_date: lgDate,
    });
    toast(`اتسجل رصيد سابق — فاتورة ${ins.data.invoice_no}`);
    setLgAmount('');
    bump();
  };

  return (
    <>
      <Sect>إلغاء فاتورة</Sect>
      <Hint>الإلغاء لا يحذف — الفاتورة تفضل بسبب مسجَّل وتخرج من الأعمار والمخزون.</Hint>
      <Field label="ابحث برقم الفاتورة أو اسم الفرع">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: 12 أو جورميه" />
      </Field>
      <ErrLine>{err}</ErrLine>
      {matches.length === 0 && <Empty>لا نتائج</Empty>}

      {matches.map((inv) => (
        <div className={`card ${inv.status === 'void' ? 'feeditem bad' : ''}`} key={inv.id}>
          <b>فاتورة {inv.invoice_no}</b> — {outletById(inv.outlet_id)?.name ?? '؟'} · {inv.invoice_date}
          <br />
          <b className="mono">{fmt(inv.amount)} ج</b>{' '}
          <Pill tone={inv.status === 'void' ? 'r' : inv.status === 'delivered' ? 'g' : 'n'}>
            {INVOICE_STATUS_LABEL[inv.status]}
          </Pill>
          {inv.legacy && <> <Pill tone="v">رصيد سابق</Pill></>}

          {inv.status === 'void' ? (
            <>
              <br />
              <span className="small">السبب: {inv.void_reason}</span>
            </>
          ) : voidFor === inv.id ? (
            <>
              <div className="f" style={{ marginTop: 8 }}>
                <label>سبب الإلغاء <em>*</em></label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: خطأ في الكمية" />
              </div>
              <div className="btnrow">
                <ActionButton className="mini red" onClick={() => voidInvoice(inv)}>تأكيد الإلغاء</ActionButton>
                <button className="mini" onClick={() => { setVoidFor(null); setReason(''); }}>تراجع</button>
              </div>
            </>
          ) : (
            <div className="btnrow">
              <button className="mini red" onClick={() => { setVoidFor(inv.id); setReason(''); setErr(null); }}>
                إلغاء الفاتورة
              </button>
            </div>
          )}
        </div>
      ))}

      <Sect>تسجيل مديونية سابقة (قبل النظام)</Sect>
      <Hint>فواتير قديمة لسه مفتوحة — تتسجل من غير أصناف عشان تتعمّر صح ولا تأثر على المخزون.</Hint>
      <Field label="الفرع" required>
        <select
          value={lgOutlet ?? ''}
          onChange={(e) => setLgOutlet(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">— اختر —</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.chain} — {o.name}</option>)}
        </select>
      </Field>
      <Field label="تاريخ الفاتورة" required>
        <input type="date" value={lgDate} onChange={(e) => setLgDate(e.target.value)} />
      </Field>
      <Field label="المبلغ المفتوح (ج)" required>
        <input inputMode="decimal" value={lgAmount} onChange={(e) => setLgAmount(e.target.value)} />
      </Field>
      <ErrLine>{lgErr}</ErrLine>
      <ActionButton className="send" onClick={addLegacy}>تسجيل الرصيد السابق</ActionButton>
    </>
  );
}
