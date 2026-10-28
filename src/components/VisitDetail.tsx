import { useApp } from '../lib/app';
import { cairoDateOf, cairoTime } from '../lib/cairo';
import { FLAG_LABEL, ORDER_STATUS_LABEL, fmt } from '../lib/format';
import { Pill, VisitPhotos } from './ui';
import type { Followup, Order, OrderLine, Visit, VisitLine } from '../lib/types';

const STATUS: Record<string, { label: string; tone: 'r' | 'g' | 'y' | 'n' }> = {
  open: { label: 'لسه مفتوحة', tone: 'n' },
  pending: { label: 'مستنية', tone: 'y' },
  approved: { label: 'اتعتمدت', tone: 'g' },
  flagged: { label: 'اترفضت', tone: 'r' },
};

/** Status chip for a visit; a visit never submitted shows as open, whatever its status column. */
export const visitStatus = (v: Visit) => STATUS[v.checkout_at == null ? 'open' : v.status];

export const minutes = (s: number | null) => (s == null ? '—' : `${Math.round(s / 60)} د`);

/**
 * The expanded body of a visit, shared by every «الزيارات» screen: per-SKU counts and zero
 * reasons, times and GPS, flags, review, follow-up, orders raised for the outlet, and the photo.
 * Read-only. The photo toggle is lifted to the caller so it survives parent re-renders.
 */
export function VisitDetail({
  v, lines, followups, orders, orderLines, photoShown, onShowPhoto,
}: {
  v: Visit;
  lines: VisitLine[];
  followups: Followup[];
  orders: Order[];
  orderLines: OrderLine[];
  photoShown: boolean;
  onShowPhoto: () => void;
}) {
  const { skus, skuById, profileById } = useApp();
  const zeroCount = lines.filter((l) => l.shelf === 0).length;
  const day = cairoDateOf(v.checkin_at);
  // Time alone on the visit's own day; later events (a review two days on) get the date too.
  const stamp = (ts: string) => {
    const d = cairoDateOf(ts);
    return `${d === day ? '' : `${d.slice(8, 10)}/${d.slice(5, 7)} `}${cairoTime(ts)}`;
  };

  return (
    <div className="vbody">
      {lines.length === 0 ? (
        <p className="small">لسه ما اتبعتتش — مفيش جرد متسجل.</p>
      ) : (
        <div className="tscroll">
          <table className="t">
            <thead>
              <tr><th>الصنف</th><th>رف</th><th>مخزن</th><th>بيع</th><th>سبب الصفر</th></tr>
            </thead>
            <tbody>
              {skus.map((s) => {
                const l = lines.find((x) => x.sku_id === s.id);
                const dry = l != null && l.shelf === 0 && l.warehouse === 0;
                return (
                  <tr key={s.id} className={dry ? 'crit' : ''}>
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
      )}

      <p className="small">
        من <span className="mono">{cairoTime(v.checkin_at)}</span>
        {v.checkout_at ? <> لـ <span className="mono">{cairoTime(v.checkout_at)}</span></> : ' — لسه مفتوحة'}
        {' · '}مدة {minutes(v.dwell_seconds)}
        <br />
        GPS البدء {v.checkin_lat != null ? '✓' : '✗'} · الإرسال{' '}
        {v.checkout_at == null ? '—' : v.checkout_lat != null ? '✓' : '✗'}
        {' · '}
        {v.distance_m == null ? 'الموقع لسه ما اتحددش' : `${fmt(v.distance_m)} م من الفرع`}
        {v.checkout_distance_m != null && <> · الإرسال على بعد {fmt(v.checkout_distance_m)} م من البدء</>}
        {v.checkin_reason && <><br />سبب البعد عند البدء: {v.checkin_reason}</>}
      </p>

      {v.flags.length > 0 && (
        <div className="btnrow">
          {v.flags.map((f) => <Pill key={f} tone="y">{FLAG_LABEL[f] ?? f}</Pill>)}
        </div>
      )}

      <p className="small" style={{ marginTop: 8 }}>
        {v.reviewed_by
          ? <>راجعها {profileById(v.reviewed_by)?.full_name ?? '؟'}{v.reviewed_at ? ` · ${stamp(v.reviewed_at)}` : ''}</>
          : v.checkout_at == null ? 'لسه ما اتبعتتش للمراجعة' : 'لسه ما اتراجعتش'}
      </p>

      {followups.map((f) => (
        <p className="small" key={f.id}>
          {f.status === 'done'
            ? <>المتابعة مع السلسلة اتقفلت — {profileById(f.done_by)?.full_name ?? '؟'}{f.done_at ? ` · ${stamp(f.done_at)}` : ''}</>
            : <>متابعة مع السلسلة مفتوحة — لسه محدش قفلها</>}
        </p>
      ))}

      {orders.length > 0 ? orders.map((o) => (
        <div className="small" key={o.id} style={{ marginTop: 4 }}>
          <Pill tone={o.status === 'rejected' ? 'r' : o.status === 'pending' ? 'y' : 'g'}>
            أوردر · {ORDER_STATUS_LABEL[o.status] ?? o.status}
          </Pill>{' '}
          {orderLines.filter((l) => l.order_id === o.id)
            .sort((a, b) => skus.findIndex((s) => s.id === a.sku_id) - skus.findIndex((s) => s.id === b.sku_id))
            .map((l) => `${skuById(l.sku_id)?.name_ar ?? l.sku_id}: ${l.cases}`).join(' · ')}
        </div>
      )) : zeroCount > 0 && <p className="small" style={{ color: 'var(--crit)' }}>مفيش أوردر اتعمل</p>}

      {v.checkout_at != null && (
        photoShown
          ? <VisitPhotos visitId={v.id} legacyPath={v.photo_path} />
          : (
            <div className="btnrow">
              <button className="mini" onClick={onShowPhoto}>شوف الصور</button>
            </div>
          )
      )}
    </div>
  );
}
