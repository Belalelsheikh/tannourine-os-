import { useApp } from '../lib/app';
import { cairoDateOf, cairoDayMonth } from '../lib/cairo';
import { compareLines, sameAsBefore, type CountLine } from '../lib/compare';
import { dayDiff } from '../lib/visitsHistory';
import { Pill } from './ui';

export interface CountSide {
  checkin_at: string;
  coordinator_id: string;
  lines: CountLine[];
}

/** RTL: «قبل ← دلوقتي» reads right to left, the arrow pointing at the newer count. */
const arrow = (b: number | undefined, n: number | undefined) =>
  `${b ?? '—'} ← ${n ?? '—'}`;

/**
 * «قبل ← دلوقتي» per SKU: a visit's count against the visit before it at the outlet (Batch B).
 * Shared by the branch page and the Feed card. Markers inform only; nothing auto-rejects.
 */
export function VisitCompare({ now, before }: { now: CountSide; before: CountSide | null }) {
  const { skus, skuById, profileById } = useApp();
  const name = (id: string) => profileById(id)?.full_name ?? '؟';
  const base = before && before.lines.length > 0 ? before.lines : [];
  const rows = compareLines(skus, now.lines, base);
  // A SKU no longer in the catalogue but counted on either visit still gets its row.
  const extra = [...new Set([...now.lines, ...base].map((l) => l.sku_id))]
    .filter((id) => !skus.some((s) => s.id === id));
  const all = [...rows, ...compareLines(extra.map((id) => ({ id })), now.lines, base)];

  return (
    <div className="compare">
      <p className="small">
        دلوقتي: <b>{cairoDayMonth(now.checkin_at)}</b> — {name(now.coordinator_id)}
        {before && (
          <>
            <br />
            قبلها: <b>{cairoDayMonth(before.checkin_at)}</b> — {name(before.coordinator_id)}
            {' · '}الفرق <span className="mono">{dayDiff(cairoDateOf(before.checkin_at), cairoDateOf(now.checkin_at))}</span> يوم
          </>
        )}
      </p>
      <div className="btnrow" style={{ marginTop: 0, marginBottom: 6 }}>
        {!before && <Pill tone="n">أول زيارة — مفيش مقارنة</Pill>}
        {before && base.length === 0 && <Pill tone="n">الزيارة اللي قبلها ما فيهاش جرد — مفيش مقارنة</Pill>}
        {sameAsBefore(now.lines, base) && <Pill tone="y">نفس أرقام الزيارة اللي فاتت</Pill>}
      </div>
      <div className="tscroll">
        <table className="t">
          <thead>
            <tr><th>الصنف</th><th>رف قبل ← دلوقتي</th><th>مخزن قبل ← دلوقتي</th><th>بيع</th></tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={r.skuId} className={r.rose ? 'rose' : ''}>
                <td>
                  {skuById(r.skuId)?.name_ar ?? r.skuId}
                  {r.rose && <><br /><Pill tone="y">زاد عن الزيارة اللي فاتت</Pill></>}
                </td>
                <td className="mono">{arrow(r.before?.shelf, r.now?.shelf)}</td>
                <td className="mono">{arrow(r.before?.warehouse, r.now?.warehouse)}</td>
                <td className="mono">{r.now ? r.now.sold_cases : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
