import { useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fmt } from '../../lib/format';
import OrderLines, { useOrderAmount, type CaseMap } from '../../components/OrderLines';
import { ErrLine, Field, Hint } from '../../components/ui';

/** Email/phone order intake — PRD §6. Central and mixed outlets lead the list; rep outlets are the exception. */
export default function Intake() {
  const { profile, outlets, toast, bump } = useApp();
  const amountOf = useOrderAmount();
  const [outletId, setOutletId] = useState<number | null>(null);
  const [po, setPo] = useState('');
  const [lines, setLines] = useState<CaseMap>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const primary = outlets.filter((o) => o.ordering_mode !== 'rep');
  const exceptions = outlets.filter((o) => o.ordering_mode === 'rep');

  const submit = async () => {
    setErr(null);
    if (outletId == null) { setErr('اختر الفرع'); return; }
    const filled = Object.entries(lines).filter(([, c]) => c > 0);
    if (filled.length === 0) { setErr('اكتب كمية لصنف واحد على الأقل'); return; }
    if (!profile) return;

    setBusy(true);
    try {
      const ins = await sb.from('orders').insert({
        outlet_id: outletId,
        source: 'email',
        po_number: po.trim() || null,
        created_by: profile.id,
      }).select('id').single();
      if (ins.error) throw ins.error;

      const lineRes = await sb.from('order_lines').insert(
        filled.map(([sku_id, cases]) => ({ order_id: ins.data.id, sku_id, cases })),
      );
      if (lineRes.error) throw lineRes.error;

      toast('اتسجل الأوردر');
      setLines({});
      setPo('');
      setOutletId(null);
      bump();
    } catch (e) {
      setErr(`ما اتسجلش: ${errText(e)} — البيانات محفوظة، حاول تاني`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Hint>تسجيل أوردر وارد بالإيميل (أو تليفون)</Hint>

      <Field label="الفرع" required>
        <select
          value={outletId ?? ''}
          onChange={(e) => setOutletId(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">— اختر —</option>
          {primary.map((o) => (
            <option key={o.id} value={o.id}>{o.chain} — {o.name}</option>
          ))}
          <optgroup label="فروع أوردر مندوب (استثناء)">
            {exceptions.map((o) => (
              <option key={o.id} value={o.id}>{o.chain} — {o.name}</option>
            ))}
          </optgroup>
        </select>
      </Field>

      <Field label="رقم الـ PO (لو موجود)">
        <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="مثال: GO-4412" />
      </Field>

      <OrderLines value={lines} onChange={setLines} />

      <div className="card">
        <span className="small">إجمالي الأوردر</span>
        <br />
        <b className="mono" style={{ fontSize: 20 }}>{fmt(amountOf(lines))} ج</b>{' '}
        <span className="small">شامل الضريبة</span>
      </div>

      <ErrLine>{err}</ErrLine>
      <button className="send" onClick={() => void submit()} disabled={busy}>
        {busy ? 'جارٍ التسجيل…' : 'تسجيل الأوردر'}
      </button>
    </>
  );
}
