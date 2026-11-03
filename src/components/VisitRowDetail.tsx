import { useState } from 'react';
import { useQuery } from '../lib/app';
import { sb } from '../lib/supabase';
import { cairoDateOf, cairoDayRange } from '../lib/cairo';
import { VisitDetail } from './VisitDetail';
import type { Followup, Order, OrderLine, Visit, VisitLine } from '../lib/types';

interface Extras { followups: Followup[]; orders: Order[]; orderLines: OrderLine[] }

/** Follow-ups and same-day orders for one visit; loaded only once the row is opened. */
export function RowDetail({ v, onOpenOutlet, onOpenFeed }: {
  v: Visit & { visit_lines: VisitLine[] };
  onOpenOutlet?: () => void;
  /** Absent where there is no «المتابعة» to send a pending visit to. */
  onOpenFeed?: () => void;
}) {
  const [photo, setPhoto] = useState(false);
  const { data } = useQuery<Extras>(
    async () => {
      const { from, to } = cairoDayRange(cairoDateOf(v.checkin_at));
      const [f, o] = await Promise.all([
        sb.from('followups').select('*').eq('visit_id', v.id),
        sb.from('orders').select('*').eq('outlet_id', v.outlet_id).gte('created_at', from).lt('created_at', to)
          .order('created_at'),
      ]);
      for (const res of [f, o]) if (res.error) throw res.error;
      const orders = (o.data ?? []) as Order[];
      let orderLines: OrderLine[] = [];
      if (orders.length) {
        const l = await sb.from('order_lines').select('*').in('order_id', orders.map((x) => x.id));
        if (l.error) throw l.error;
        orderLines = (l.data ?? []) as OrderLine[];
      }
      return { followups: (f.data ?? []) as Followup[], orders, orderLines };
    },
    [v.id],
    { followups: [], orders: [], orderLines: [] },
  );
  const pending = onOpenFeed != null && v.status === 'pending' && v.checkout_at != null;

  return (
    <>
      {(onOpenOutlet || pending) && (
        <div className="btnrow" style={{ marginTop: 10 }}>
          {onOpenOutlet && <button type="button" className="mini" onClick={onOpenOutlet}>سجل الفرع</button>}
          {pending && <button type="button" className="mini" onClick={onOpenFeed}>راجعها في المتابعة ←</button>}
        </div>
      )}
      <VisitDetail
        v={v}
        lines={v.visit_lines}
        followups={data.followups}
        orders={data.orders}
        orderLines={data.orderLines}
        photoShown={photo}
        onShowPhoto={() => setPhoto(true)}
      />
    </>
  );
}
