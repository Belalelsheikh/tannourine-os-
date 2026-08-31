import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fmt, todayISO } from '../../lib/format';
import OrderLines, { type CaseMap } from '../../components/OrderLines';
import { ActionButton, Empty, ErrLine, Field, Hint, Sect } from '../../components/ui';
import type { BookStock, Container, ContainerLine } from '../../lib/types';

/** Book stock = containers in − non-legacy invoiced out (PRD §9). */
export default function Stock() {
  const { profile, skuById, bump, toast } = useApp();
  const [lines, setLines] = useState<CaseMap>({});
  const [arrival, setArrival] = useState(todayISO());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const { data } = useQuery<{ stock: BookStock[]; containers: Container[]; lines: ContainerLine[] }>(
    async () => {
      const [s, c] = await Promise.all([
        sb.from('book_stock').select('*'),
        sb.from('containers').select('*').order('arrival_date', { ascending: false }).limit(8),
      ]);
      if (s.error) throw s.error;
      if (c.error) throw c.error;
      const containers = (c.data ?? []) as Container[];
      let cl: ContainerLine[] = [];
      if (containers.length) {
        const l = await sb.from('container_lines').select('*')
          .in('container_id', containers.map((x) => x.id));
        if (l.error) throw l.error;
        cl = (l.data ?? []) as ContainerLine[];
      }
      return { stock: (s.data ?? []) as BookStock[], containers, lines: cl };
    },
    [],
    { stock: [], containers: [], lines: [] },
  );

  const isFirst = data.containers.length === 0;

  const save = async () => {
    if (!profile) return;
    setErr(null);
    const filled = Object.entries(lines).filter(([, c]) => c > 0);
    if (filled.length === 0) { setErr('اكتب كميات الحاوية'); return; }

    try {
      const ins = await sb.from('containers').insert({
        arrival_date: arrival,
        note: note.trim() || (isFirst ? 'رصيد افتتاحي' : null),
        created_by: profile.id,
      }).select('id').single();
      if (ins.error) throw ins.error;

      const lineRes = await sb.from('container_lines').insert(
        filled.map(([sku_id, cases]) => ({ container_id: ins.data.id, sku_id, cases })),
      );
      if (lineRes.error) throw lineRes.error;

      toast('اتسجلت الحاوية');
      setLines({});
      setNote('');
      bump();
    } catch (e) {
      setErr(`ما اتسجلتش: ${errText(e)} — الكميات محفوظة، حاول تاني`);
    }
  };

  return (
    <>
      <Sect>رصيد الدفاتر (كرتونة) — وارد الحاويات ناقص المفوتر</Sect>
      <div className="tscroll">
        <table className="t">
          <thead><tr><th>الصنف</th><th>وارد</th><th>خرج</th><th>الرصيد</th></tr></thead>
          <tbody>
            {data.stock.map((s) => {
              const bal = Number(s.cases_in) - Number(s.cases_out);
              return (
                <tr key={s.sku_id}>
                  <td>{s.name_ar}</td>
                  <td className="mono">{fmt(s.cases_in)}</td>
                  <td className="mono">{fmt(s.cases_out)}</td>
                  <td className="mono" style={bal <= 0 ? { color: 'var(--crit)' } : undefined}>{fmt(bal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Hint>الرصيد دفتري — قارنه بالجرد الفعلي دوريًا. أي فرق = تسرب أو خطأ تسجيل. الفواتير الملغاة والأرصدة السابقة لا تُحتسب.</Hint>

      <Sect>{isFirst ? 'تسجيل الرصيد الافتتاحي' : 'تسجيل وصول حاوية'}</Sect>
      <Field label="تاريخ الوصول" required>
        <input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} />
      </Field>
      <Field label="ملاحظة">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isFirst ? 'رصيد افتتاحي' : 'مثال: حاوية أغسطس'}
        />
      </Field>
      <OrderLines value={lines} onChange={setLines} />
      <ErrLine>{err}</ErrLine>
      <ActionButton className="send" onClick={save}>
        {isFirst ? 'تسجيل الرصيد الافتتاحي' : 'تسجيل الحاوية'}
      </ActionButton>

      <Sect>حاويات سابقة</Sect>
      {data.containers.length === 0 && <Empty>لسه مفيش حاويات مسجلة</Empty>}
      {data.containers.map((c) => (
        <div className="card" key={c.id}>
          <b>{c.arrival_date}</b>{c.note ? ` — ${c.note}` : ''}
          <br />
          <span className="small">
            {data.lines.filter((l) => l.container_id === c.id)
              .map((l) => `${skuById(l.sku_id)?.name_ar ?? l.sku_id}: ${fmt(l.cases)}`)
              .join(' · ') || '—'}
          </span>
        </div>
      ))}
    </>
  );
}
