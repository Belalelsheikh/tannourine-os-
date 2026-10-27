import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fetchOrdersWithLines, leaderApprovableIds, linesToMap, type OrderWithLines } from '../../lib/orders';
import { fmt, stampOf } from '../../lib/format';
import { linesText, useOrderAmount } from '../../components/OrderLines';
import { ActionButton, Empty, ErrLine, Hint } from '../../components/ui';

/**
 * «اعتماد الأوردرات» — first approval of a coordinator's order by their own supervisor.
 * Approved orders move on to خدمة العملاء (مروه) for the final approval.
 */
export default function Approvals() {
  const { profile, profiles, outletById, skuById, profileById, bump, toast } = useApp();
  const amountOf = useOrderAmount();
  const [err, setErr] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const mine = leaderApprovableIds(profile, profiles);
  const { data: orders } = useQuery<OrderWithLines[]>(
    async () => (await fetchOrdersWithLines(['pending'])).filter((o) => mine.includes(o.created_by)),
    [mine.join(',')],
    [],
  );

  const decide = async (o: OrderWithLines, status: 'leader_approved' | 'rejected') => {
    if (!profile) return;
    setErr(null);
    if (status === 'rejected' && !reason.trim()) { setErr('اكتب سبب الرفض'); return; }
    const { data, error } = await sb.from('orders').update({
      status,
      leader_decided_by: profile.id,
      leader_decided_at: new Date().toISOString(),
      ...(status === 'rejected' ? { cancel_reason: reason.trim() } : {}),
    }).eq('id', o.id).eq('status', 'pending').select('id');
    if (error) { setErr(errText(error)); return; }
    if ((data?.length ?? 0) === 0) { setErr('الأوردر اتغير من حد تاني — حدّث الشاشة'); bump(); return; }
    toast(status === 'leader_approved' ? 'اتعتمد — راح لخدمة العملاء' : 'اترفض');
    setRejectFor(null);
    setReason('');
    bump();
  };

  return (
    <>
      <Hint>أوردرات المنسقين بتوعك — اعتمادك بيبعتها لخدمة العملاء للاعتماد النهائي</Hint>
      <ErrLine>{err}</ErrLine>
      {orders.length === 0 && <Empty>مفيش أوردرات مستنية اعتمادك</Empty>}

      {orders.map((o) => {
        const ot = outletById(o.outlet_id);
        const map = linesToMap(o.lines);
        return (
          <div className="card feeditem pend" key={o.id}>
            <b>{ot?.name ?? '؟'}</b> — {ot?.chain ?? ''}
            <br />
            <span className="small">{profileById(o.created_by)?.full_name ?? '؟'} · {stampOf(o.created_at)}</span>
            <br />
            <span className="small">{linesText(map, (id) => skuById(id)?.name_ar)}</span>
            <br />
            <b className="mono">{fmt(amountOf(map))} ج</b> <span className="small">شامل الضريبة</span>

            {rejectFor === o.id ? (
              <>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="سبب الرفض"
                  style={{ marginTop: 8 }}
                />
                <div className="btnrow">
                  <ActionButton className="mini red" disabled={!reason.trim()} onClick={() => decide(o, 'rejected')}>
                    تأكيد الرفض
                  </ActionButton>
                  <button className="mini" onClick={() => { setRejectFor(null); setReason(''); }}>رجوع</button>
                </div>
              </>
            ) : (
              <div className="btnrow">
                <ActionButton className="mini grn" onClick={() => decide(o, 'leader_approved')}>اعتماد</ActionButton>
                <button className="mini red" onClick={() => { setRejectFor(o.id); setReason(''); setErr(null); }}>
                  رفض
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
