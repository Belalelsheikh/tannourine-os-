import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fetchOrdersWithLines, linesToMap, saveOrderLines, type OrderWithLines } from '../../lib/orders';
import { audit } from '../../lib/audit';
import { fmt, stampOf } from '../../lib/format';
import OrderLines, { useOrderAmount, linesText, type CaseMap } from '../../components/OrderLines';
import { ActionButton, Empty, ErrLine, Hint, Pill, Sect } from '../../components/ui';

type Mode = { k: 'edit'; id: string; lines: CaseMap } | { k: 'reject' | 'cancel'; id: string; reason: string };
type ReasonMode = Extract<Mode, { reason: string }>;

/**
 * «الأوردرات» — خدمة العملاء's final approval. The queue is what a supervisor approved plus
 * email orders; orders still with a supervisor and orders waiting for عمرو sit folded below
 * so the whole pipe is visible from one screen.
 *
 * Card pieces are plain render functions, not components: they hold inputs, and a component
 * declared inside this one would remount on every keystroke and drop focus.
 */
export default function Board() {
  const { profile, profiles, outletById, skuById, profileById, bump, toast } = useApp();
  const amountOf = useOrderAmount();
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [showApproved, setShowApproved] = useState(false);

  const { data: orders } = useQuery<OrderWithLines[]>(
    () => fetchOrdersWithLines(['pending', 'leader_approved', 'approved']),
    [],
    [],
  );

  // Coordinators who report to this account directly have no other supervisor to do the
  // first approval, so their pending orders come straight to this queue.
  const ownTeam = new Set(
    profiles.filter((p) => p.role === 'coordinator' && profile && p.supervisor_id === profile.id).map((p) => p.id),
  );
  const isOwn = (o: OrderWithLines) => o.status === 'pending' && ownTeam.has(o.created_by);
  const queue = orders.filter((o) => o.status === 'leader_approved' || isOwn(o));
  const pending = orders.filter((o) => o.status === 'pending' && !isOwn(o));
  const approved = orders.filter((o) => o.status === 'approved');

  /** Every write is guarded on the status the card was drawn from, so a stale screen can't overwrite. */
  const move = async (o: OrderWithLines, patch: Record<string, unknown>, done: string) => {
    setErr(null);
    const { data, error } = await sb.from('orders').update(patch)
      .eq('id', o.id).eq('status', o.status).select('id');
    if (error) { setErr(errText(error)); return false; }
    if ((data?.length ?? 0) === 0) { setErr('الأوردر اتغير من حد تاني — حدّث الشاشة'); bump(); return false; }
    toast(done);
    setMode(null);
    bump();
    return true;
  };

  const approve = async (o: OrderWithLines) => {
    if (!profile) return;
    const now = new Date().toISOString();
    await move(o, {
      status: 'approved',
      decided_by: profile.id,
      decided_at: now,
      ...(o.status === 'pending' ? { leader_decided_by: profile.id, leader_decided_at: now } : {}),
    }, 'اتعتمد — راح للفواتير');
  };

  const decideWithReason = async (o: OrderWithLines, m: ReasonMode) => {
    if (!profile) return;
    const reason = m.reason.trim();
    if (!reason) { setErr(m.k === 'reject' ? 'اكتب سبب الرفض' : 'اكتب سبب الإلغاء'); return; }
    const status = m.k === 'reject' ? 'rejected' : 'cancelled';
    const ok = await move(o, {
      status, decided_by: profile.id, decided_at: new Date().toISOString(), cancel_reason: reason,
    }, m.k === 'reject' ? 'اترفض' : 'اتلغى');
    if (ok && status === 'cancelled') {
      const auditErr = await audit(profile.id, 'cancel_order', 'orders', o.id, { from: o.status, reason });
      if (auditErr) setErr(`اتلغى بس سجل المراجعة ما اتكتبش: ${auditErr}`);
    }
  };

  const saveEdit = async (o: OrderWithLines, lines: CaseMap) => {
    if (!profile) return;
    setErr(null);
    if (!Object.values(lines).some((c) => c > 0)) { setErr('الأوردر لازم يفضل فيه صنف واحد على الأقل — أو الغيه'); return; }
    try {
      const { before, after } = await saveOrderLines(o, lines);
      const { error } = await sb.from('orders').update({
        edited_by: profile.id, edited_at: new Date().toISOString(),
      }).eq('id', o.id);
      if (error) throw error;
      const auditErr = await audit(profile.id, 'edit_order', 'orders', o.id, { before, after });
      if (auditErr) setErr(`اتعدل بس سجل المراجعة ما اتكتبش: ${auditErr}`);
      toast('اتعدل الأوردر');
      setMode(null);
      bump();
    } catch (e) {
      setErr(`ما اتعدلش: ${errText(e)} — التعديل لسه مفتوح، حاول تاني`);
      bump();
    }
  };

  const head = (o: OrderWithLines) => {
    const ot = outletById(o.outlet_id);
    const map = linesToMap(o.lines);
    return (
      <>
        <b>{ot?.name ?? '؟'}</b> — {ot?.chain ?? ''}{' '}
        <Pill tone={o.source === 'email' ? 'v' : 'n'}>
          {o.source === 'email' ? `إيميل${o.po_number ? ` · ${o.po_number}` : ''}` : 'منسق'}
        </Pill>
        {o.edited_at && <> <Pill tone="y">معدّل</Pill></>}
        <br />
        <span className="small">
          {o.source === 'coordinator' && <>{profileById(o.created_by)?.full_name ?? '؟'} · </>}
          {o.leader_decided_by && o.status !== 'pending' && <>اعتمده {profileById(o.leader_decided_by)?.full_name ?? '؟'} · </>}
          {stampOf(o.created_at)}
        </span>
        <br />
        <span className="small">{linesText(map, (id) => skuById(id)?.name_ar)}</span>
        <br />
        <b className="mono">{fmt(amountOf(map))} ج</b> <span className="small">شامل الضريبة</span>
      </>
    );
  };

  const reasonBox = (o: OrderWithLines, m: ReasonMode) => (
    <>
      <input
        autoFocus
        value={m.reason}
        onChange={(e) => setMode({ ...m, reason: e.target.value })}
        placeholder={m.k === 'reject' ? 'سبب الرفض' : 'سبب الإلغاء'}
        style={{ marginTop: 8 }}
      />
      <div className="btnrow">
        <ActionButton className="mini red" disabled={!m.reason.trim()} onClick={() => decideWithReason(o, m)}>
          {m.k === 'reject' ? 'تأكيد الرفض' : 'تأكيد الإلغاء'}
        </ActionButton>
        <button className="mini" onClick={() => setMode(null)}>رجوع</button>
      </div>
    </>
  );

  const open = (m: Mode) => { setErr(null); setMode(m); };

  const queueCard = (o: OrderWithLines) => {
    const m = mode?.id === o.id ? mode : null;
    return (
      <div className="card feeditem pend" key={o.id}>
        {head(o)}
        {isOwn(o) && <><br /><Pill tone="v">منسقك — اعتماد واحد</Pill></>}

        {m?.k === 'edit' && (
          <>
            <OrderLines value={m.lines} onChange={(lines) => setMode({ ...m, lines })} />
            <div className="card">
              <span className="small">الإجمالي بعد التعديل</span>{' '}
              <b className="mono">{fmt(amountOf(m.lines))} ج</b>
            </div>
            <div className="btnrow">
              <ActionButton className="mini dark" onClick={() => saveEdit(o, m.lines)}>حفظ التعديل</ActionButton>
              <button className="mini" onClick={() => setMode(null)}>رجوع</button>
            </div>
          </>
        )}
        {m && m.k !== 'edit' && reasonBox(o, m)}
        {!m && (
          <div className="btnrow">
            <ActionButton className="mini grn" onClick={() => approve(o)}>اعتماد نهائي</ActionButton>
            <button className="mini" onClick={() => open({ k: 'edit', id: o.id, lines: linesToMap(o.lines) })}>تعديل</button>
            <button className="mini red" onClick={() => open({ k: 'reject', id: o.id, reason: '' })}>رفض</button>
            <button className="mini" onClick={() => open({ k: 'cancel', id: o.id, reason: '' })}>إلغاء</button>
          </div>
        )}
      </div>
    );
  };

  /** Rows further down the pipe: read-only, but cancel stays available until عمرو invoices. */
  const pipeCard = (o: OrderWithLines, note: string) => {
    const m = mode?.id === o.id && mode.k === 'cancel' ? mode : null;
    return (
      <div className={`card feeditem ${o.status === 'approved' ? 'ok' : ''}`} key={o.id}>
        {head(o)}
        <br />
        <span className="small">{note}</span>
        {m ? reasonBox(o, m) : (
          <div className="btnrow">
            <button className="mini" onClick={() => open({ k: 'cancel', id: o.id, reason: '' })}>إلغاء</button>
          </div>
        )}
      </div>
    );
  };

  const fold = (isOpen: boolean, toggle: () => void, label: string) => (
    <button type="button" className="foldrow" aria-expanded={isOpen} onClick={toggle}>
      <span>{label}</span>
      <span className="chev">{isOpen ? '▴' : '▾'}</span>
    </button>
  );

  const supervisorOf = (o: OrderWithLines) =>
    profileById(profileById(o.created_by)?.supervisor_id ?? null)?.full_name ?? 'المشرف';

  return (
    <>
      <Hint>الاعتماد النهائي — بعده الأوردر بيروح لعمرو للفوترة</Hint>
      <ErrLine>{err}</ErrLine>

      <Sect>للاعتماد النهائي ({queue.length})</Sect>
      {queue.length === 0 && <Empty>مفيش أوردرات مستنية اعتمادك</Empty>}
      {queue.map(queueCard)}

      {fold(showPending, () => setShowPending((v) => !v), `عند المشرف (${pending.length})`)}
      {showPending && pending.map((o) => pipeCard(o, `مستني ${supervisorOf(o)}`))}

      {fold(showApproved, () => setShowApproved((v) => !v), `معتمد — عند عمرو للفوترة (${approved.length})`)}
      {showApproved && approved.map((o) => pipeCard(o, 'مستني الفاتورة'))}
    </>
  );
}
