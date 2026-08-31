import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { fmt } from '../../lib/format';
import { Empty, Hint, Sect, StatTiles } from '../../components/ui';
import type { Collection, InvoiceOpen } from '../../lib/types';

const BUCKETS = ['0-30', '31-60', '61-90', '+90'] as const;
type Bucket = typeof BUCKETS[number];

const bucketOf = (age: number): Bucket =>
  age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '+90';

/** Receivables aging — delivered and legacy invoices only; voids never appear (PRD §9). */
export default function Aging() {
  const { outletById } = useApp();

  const { data } = useQuery<{ open: InvoiceOpen[]; cheques: Collection[] }>(
    async () => {
      const [o, c] = await Promise.all([
        sb.from('invoice_open').select('*').gt('open_amount', 0).eq('status', 'delivered'),
        sb.from('collections').select('*').eq('type', 'cheque').in('status', ['received', 'returned']),
      ]);
      if (o.error) throw o.error;
      if (c.error) throw c.error;
      return { open: (o.data ?? []) as InvoiceOpen[], cheques: (c.data ?? []) as Collection[] };
    },
    [],
    { open: [], cheques: [] },
  );

  const buckets: Record<Bucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '+90': 0 };
  const byChain: Record<string, { n: number; amt: number; old: number }> = {};

  for (const inv of data.open) {
    buckets[bucketOf(inv.age_days)] += Number(inv.open_amount);
    const chain = outletById(inv.outlet_id)?.chain ?? '؟';
    byChain[chain] ??= { n: 0, amt: 0, old: 0 };
    byChain[chain].n += 1;
    byChain[chain].amt += Number(inv.open_amount);
    if (inv.age_days > 60) byChain[chain].old += Number(inv.open_amount);
  }

  const totalOpen = Object.values(buckets).reduce((a, b) => a + b, 0);
  const custody = data.cheques.filter((c) => c.status === 'received');
  const custodyAmount = custody.reduce((a, c) => a + Number(c.amount), 0);
  const returnedCount = data.cheques.filter((c) => c.status === 'returned').length;

  return (
    <>
      <StatTiles
        items={[
          { n: fmt(totalOpen), label: 'إجمالي مفتوح (ج)' },
          { n: `${custody.length} · ${fmt(custodyAmount)}`, label: 'شيكات بالعهدة (عدد · ج)', tone: 'w' },
          { n: returnedCount, label: 'شيكات مرتدة', tone: returnedCount ? 'bad' : undefined },
        ]}
      />

      <Sect>أعمار المديونية</Sect>
      <div className="tscroll">
        <table className="t">
          <thead><tr><th>الفترة</th><th>المبلغ (ج)</th></tr></thead>
          <tbody>
            {BUCKETS.map((b) => (
              <tr key={b}>
                <td>{b} يوم</td>
                <td className="mono" style={b === '+90' && buckets[b] > 0 ? { color: 'var(--crit)' } : undefined}>
                  {fmt(buckets[b])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sect>حسب السلسلة</Sect>
      {Object.keys(byChain).length === 0 ? <Empty>مفيش مديونية مفتوحة</Empty> : (
        <div className="tscroll">
          <table className="t">
            <thead>
              <tr><th>السلسلة</th><th>فواتير</th><th>مفتوح (ج)</th><th>فوق ٦٠ يوم</th></tr>
            </thead>
            <tbody>
              {Object.entries(byChain).sort((a, b) => b[1].amt - a[1].amt).map(([chain, d]) => (
                <tr key={chain}>
                  <td>{chain}</td>
                  <td className="mono">{d.n}</td>
                  <td className="mono">{fmt(d.amt)}</td>
                  <td className="mono" style={d.old ? { color: 'var(--crit)' } : undefined}>{fmt(d.old)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Hint>الشيكات المرتدة لا تُحتسب تحصيلًا — الفاتورة بترجع مفتوحة تلقائيًا.</Hint>
    </>
  );
}
