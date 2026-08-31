import { useApp } from '../lib/app';
import { fmt } from '../lib/format';
import { Stepper } from './ui';

export type CaseMap = Record<string, number>;

/** Cases-per-SKU grid shared by the coordinator order form, router intake, and container entry. */
export default function OrderLines({
  value, onChange, unitLabel = 'كرتونة',
}: { value: CaseMap; onChange: (v: CaseMap) => void; unitLabel?: string }) {
  const { skus } = useApp();
  return (
    <>
      {skus.map((s) => (
        <div className="sku" key={s.id}>
          <h3>
            {s.name_ar}
            <span className="tag">{s.line === 'VIA' ? 'ڤيا' : ''}</span>
          </h3>
          <div className="fields one">
            <div className="fcell">
              <label>{unitLabel} ({s.case_size} زجاجة)</label>
              <Stepper
                value={value[s.id] ?? 0}
                onChange={(v) => onChange({ ...value, [s.id]: v ?? 0 })}
              />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/** Σ cases × price_case_incl_vat — the amount shown everywhere (PRD §6). */
export function useOrderAmount() {
  const { skuById } = useApp();
  return (lines: CaseMap) =>
    Object.entries(lines).reduce(
      (sum, [id, cases]) => sum + (skuById(id)?.price_case_incl_vat ?? 0) * cases,
      0,
    );
}

export function linesText(lines: CaseMap, nameOf: (id: string) => string | undefined): string {
  return Object.entries(lines)
    .filter(([, c]) => c > 0)
    .map(([id, c]) => `${nameOf(id) ?? id}: ${fmt(c)}`)
    .join(' · ');
}
