import { useState, type ReactNode } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { daysSince, fmt } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Sect } from '../../components/ui';
import type { Collection } from '../../lib/types';

/**
 * Cheque custody state machine — PRD §8.
 * received (coordinator's pocket) → deposited (bank) → cleared | returned.
 * A returned cheque reopens the invoice automatically: `invoice_open` excludes
 * returned rows, so nothing needs to be written back to the invoice.
 */
export default function FinCheques() {
  const { profile, outletById, profileById, bump, toast } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState('');

  const { data: cheques } = useQuery<Collection[]>(
    async () => {
      const { data, error } = await sb.from('collections').select('*')
        .eq('type', 'cheque').order('received_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Collection[];
    },
    [],
    [],
  );

  const group = (s: Collection['status']) => cheques.filter((c) => c.status === s);

  const move = async (c: Collection, status: Collection['status']) => {
    setErr(null);
    const patch: Partial<Collection> = { status };
    if (status === 'deposited') patch.deposited_at = new Date().toISOString();
    if (status === 'cleared' || status === 'returned') patch.settled_at = new Date().toISOString();
    const { error } = await sb.from('collections').update(patch).eq('id', c.id);
    if (error) { setErr(errText(error)); return; }
    toast(
      status === 'deposited' ? 'اتودع البنك'
        : status === 'cleared' ? 'تحصّل'
        : 'اتسجل الارتداد — الفاتورة رجعت مفتوحة',
    );
    bump();
  };

  const saveEdit = async (c: Collection) => {
    if (!profile) return;
    setErr(null);
    const newAmount = parseFloat(amt);
    if (!newAmount || newAmount <= 0) { setErr('اكتب مبلغ صحيح'); return; }
    if (!date) { setErr('تاريخ الشيك مطلوب'); return; }

    const { error } = await sb.from('collections')
      .update({ amount: newAmount, cheque_date: date }).eq('id', c.id);
    if (error) { setErr(errText(error)); return; }

    const auditErr = await audit(profile.id, 'edit_collection', 'collections', c.id, {
      from: { amount: c.amount, cheque_date: c.cheque_date },
      to: { amount: newAmount, cheque_date: date },
    });
    if (auditErr) toast(`اتعدل — لكن السجل ما اتكتبش: ${auditErr}`);
    else toast('اتعدل الشيك واتسجل في السجل');
    setEditing(null);
    bump();
  };

  const Card = ({ c, actions }: { c: Collection; actions?: ReactNode }) => {
    const holder = profileById(c.received_by);
    const editable = c.status === 'received' || c.status === 'deposited';
    return (
      <div className="card">
        <b>{outletById(c.outlet_id)?.name ?? '؟'}</b> — <span className="mono">{fmt(c.amount)}</span> ج
        <br />
        <span className="small">
          تاريخ الشيك {c.cheque_date} · استلمه {holder?.full_name ?? '؟'} من{' '}
          {daysSince(c.received_at)} يوم
        </span>

        {editing === c.id ? (
          <>
            <div className="f" style={{ marginTop: 8 }}>
              <label>المبلغ</label>
              <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
            </div>
            <div className="f">
              <label>تاريخ الشيك</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="btnrow">
              <ActionButton className="mini dark" onClick={() => saveEdit(c)}>حفظ التعديل</ActionButton>
              <button className="mini" onClick={() => setEditing(null)}>إلغاء</button>
            </div>
          </>
        ) : (
          <div className="btnrow">
            {actions}
            {editable && (
              <button
                className="mini"
                onClick={() => {
                  setEditing(c.id);
                  setAmt(String(c.amount));
                  setDate(c.cheque_date ?? '');
                  setErr(null);
                }}
              >
                تعديل
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const received = group('received');
  const deposited = group('deposited');
  const returned = group('returned');
  const cleared = group('cleared').slice(0, 15);

  return (
    <>
      <ErrLine>{err}</ErrLine>

      <Sect>في العهدة — لسه ما اتودعش ({received.length})</Sect>
      {received.length === 0 && <Empty>—</Empty>}
      {received.map((c) => (
        <Card
          key={c.id}
          c={c}
          actions={<ActionButton className="mini dark" onClick={() => move(c, 'deposited')}>اتودع البنك</ActionButton>}
        />
      ))}

      <Sect>مودع — في انتظار التحصيل ({deposited.length})</Sect>
      {deposited.length === 0 && <Empty>—</Empty>}
      {deposited.map((c) => (
        <Card
          key={c.id}
          c={c}
          actions={
            <>
              <ActionButton className="mini grn" onClick={() => move(c, 'cleared')}>تحصّل</ActionButton>
              <ActionButton className="mini red" onClick={() => move(c, 'returned')}>مرتد</ActionButton>
            </>
          }
        />
      ))}

      <Sect>مرتد ({returned.length})</Sect>
      {returned.length === 0 && <Empty>—</Empty>}
      {returned.map((c) => <Card key={c.id} c={c} />)}

      <Sect>آخر المحصَّل</Sect>
      {cleared.length === 0 && <Empty>—</Empty>}
      {cleared.map((c) => <Card key={c.id} c={c} />)}
    </>
  );
}
