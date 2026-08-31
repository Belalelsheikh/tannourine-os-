import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fmt, todayISO } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Hint } from '../../components/ui';
import type { InvoiceOpen } from '../../lib/types';

/** Gourmet pays by bank transfer — logged as a collection that is `cleared` on arrival (PRD §8). */
export default function Transfers() {
  const { outlets, outletById, bump, toast } = useApp();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const transferOutletIds = useMemo(
    () => outlets.filter((o) => o.payment_path === 'transfer').map((o) => o.id),
    [outlets],
  );

  const { data: open } = useQuery<InvoiceOpen[]>(
    async () => {
      if (transferOutletIds.length === 0) return [];
      const { data, error } = await sb.from('invoice_open').select('*')
        .in('outlet_id', transferOutletIds)
        .eq('status', 'delivered')
        .gt('open_amount', 0)
        .order('invoice_date');
      if (error) throw error;
      return (data ?? []) as InvoiceOpen[];
    },
    [transferOutletIds.join(',')],
    [],
  );

  const logTransfer = async (inv: InvoiceOpen) => {
    setErr(null);
    const amount = parseFloat(amounts[inv.id] ?? String(inv.open_amount));
    if (!amount || amount <= 0) { setErr('اكتب مبلغ صحيح'); return; }
    if (amount > inv.open_amount) { setErr('المبلغ أكبر من المفتوح على الفاتورة'); return; }

    const { error } = await sb.from('collections').insert({
      invoice_id: inv.id,
      outlet_id: inv.outlet_id,
      type: 'transfer',
      amount,
      status: 'cleared',
      settled_at: new Date().toISOString(),
      note: `تحويل بنكي ${todayISO()}`,
    });
    if (error) { setErr(errText(error)); return; }
    toast('اتسجل التحويل');
    setAmounts((a) => ({ ...a, [inv.id]: '' }));
    bump();
  };

  return (
    <>
      <Hint>فواتير التحويل البنكي (جورميه) المفتوحة — سجّلي التحويل عند وصوله</Hint>
      <ErrLine>{err}</ErrLine>
      {open.length === 0 && <Empty>مفيش فواتير تحويل مفتوحة</Empty>}

      {open.map((inv) => (
        <div className="card" key={inv.id}>
          <b>{outletById(inv.outlet_id)?.name ?? '؟'}</b> — فاتورة {inv.invoice_no} · {inv.invoice_date} ·
          عمرها {inv.age_days} يوم
          <br />
          مفتوح: <b className="mono">{fmt(inv.open_amount)} ج</b>
          <div className="f" style={{ marginTop: 8 }}>
            <label>مبلغ التحويل</label>
            <input
              inputMode="decimal"
              value={amounts[inv.id] ?? String(inv.open_amount)}
              onChange={(e) => setAmounts((a) => ({ ...a, [inv.id]: e.target.value }))}
            />
          </div>
          <div className="btnrow">
            <ActionButton className="mini grn" onClick={() => logTransfer(inv)}>وصل التحويل</ActionButton>
          </div>
        </div>
      ))}
    </>
  );
}
