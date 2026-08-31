import { useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fmt } from '../../lib/format';
import OrderLines, { useOrderAmount, type CaseMap } from '../../components/OrderLines';
import { ErrLine, Hint } from '../../components/ui';
import type { Outlet } from '../../lib/types';

/** In-visit order for rep/mixed outlets — PRD §5.3. */
export default function OrderForm({
  outlet, onDone, onCancel,
}: { outlet: Outlet; onDone: () => void; onCancel: () => void }) {
  const { profile, toast } = useApp();
  const amountOf = useOrderAmount();
  const [lines, setLines] = useState<CaseMap>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    const filled = Object.entries(lines).filter(([, c]) => c > 0);
    if (filled.length === 0) { setErr('اكتب كمية لصنف واحد على الأقل'); return; }
    if (!profile) return;

    setBusy(true);
    try {
      const ins = await sb.from('orders').insert({
        outlet_id: outlet.id,
        source: 'coordinator',
        created_by: profile.id,
      }).select('id').single();
      if (ins.error) throw ins.error;

      const lineRes = await sb.from('order_lines').insert(
        filled.map(([sku_id, cases]) => ({ order_id: ins.data.id, sku_id, cases })),
      );
      if (lineRes.error) throw lineRes.error;

      toast('الأوردر وصل لمسؤول الأوردرات');
      onDone();
    } catch (e) {
      setErr(`ما اتبعتش: ${errText(e)} — الكميات محفوظة، حاول تاني`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Hint><b>{outlet.name}</b> — الكميات بالكرتونة</Hint>
      <OrderLines value={lines} onChange={setLines} />
      <div className="card">
        <span className="small">إجمالي الأوردر</span>
        <br />
        <b className="mono" style={{ fontSize: 20 }}>{fmt(amountOf(lines))} ج</b>{' '}
        <span className="small">شامل الضريبة</span>
      </div>
      <ErrLine>{err}</ErrLine>
      <button className="send" onClick={() => void submit()} disabled={busy}>
        {busy ? 'جارٍ الإرسال…' : 'إرسال الأوردر'}
      </button>
      <button className="ghost" onClick={onCancel} disabled={busy}>رجوع</button>
    </>
  );
}
