import { useState } from 'react';
import { useApp } from '../../lib/app';
import { cairoDayMonth } from '../../lib/cairo';
import { dwellText } from '../../lib/format';
import type { ZeroReason } from '../../lib/types';

export interface LastVisitLine { sku_id: string; shelf: number; warehouse: number; sold_cases: number; zero_reason: ZeroReason | null; }
export interface LastVisitData {
  id: string;
  checkin_at: string;
  checkout_at: string;
  dwell_seconds: number | null;
  coordinator_name: string | null;
  lines: LastVisitLine[];
}

/** «آخر زيارة: 23 أكتوبر — رنا», tap to see that visit's counts (Batch A2). */
export default function LastVisit({ last }: { last: LastVisitData }) {
  const { skus } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="card lastvisit">
      <button type="button" className="ghost" style={{ margin: 0 }} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        آخر زيارة: {cairoDayMonth(last.checkin_at)} — {last.coordinator_name ?? '؟'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <>
          <p className="small">مدة {dwellText(last.dwell_seconds)}</p>
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>الصنف</th><th>رف</th><th>مخزن</th><th>بيع</th><th>سبب الصفر</th></tr></thead>
              <tbody>
                {skus.map((s) => {
                  const l = last.lines.find((x) => x.sku_id === s.id);
                  return (
                    <tr key={s.id}>
                      <td>{s.name_ar}</td>
                      <td className="mono">{l ? l.shelf : '—'}</td>
                      <td className="mono">{l ? l.warehouse : '—'}</td>
                      <td className="mono">{l ? l.sold_cases : '—'}</td>
                      <td>{l?.zero_reason ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
