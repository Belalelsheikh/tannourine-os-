import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText, BUCKET_PODS } from '../../lib/supabase';
import { uploadPhoto } from '../../lib/photo';
import { INVOICE_STATUS_LABEL, fmt } from '../../lib/format';
import { ActionButton, Empty, ErrLine, PhotoPicker, Pill, SecureImage, Sect } from '../../components/ui';
import type { Invoice } from '../../lib/types';

/** Invoice lifecycle: created → dispatched → delivered (POD photo required) — PRD §7. */
export default function Invoices() {
  const { outletById, bump, toast } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [podFor, setPodFor] = useState<string | null>(null);
  const [pod, setPod] = useState<Blob | null>(null);
  const [showPod, setShowPod] = useState<string | null>(null);

  const { data: invoices } = useQuery<Invoice[]>(
    async () => {
      const { data, error } = await sb.from('invoices').select('*')
        .neq('status', 'void')
        .order('invoice_no', { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
    [],
    [],
  );

  const active = invoices.filter((i) => i.status === 'created' || i.status === 'dispatched');
  const delivered = invoices.filter((i) => i.status === 'delivered').slice(0, 15);

  const dispatch = async (inv: Invoice) => {
    setErr(null);
    const { error } = await sb.from('invoices').update({
      status: 'dispatched', dispatched_at: new Date().toISOString(),
    }).eq('id', inv.id);
    if (error) { setErr(errText(error)); return; }
    toast('خرجت من المخزن');
    bump();
  };

  /** POD photo is mandatory: upload first, only then flip to delivered. */
  const deliver = async (inv: Invoice) => {
    setErr(null);
    if (!pod) { setErr('صورة الإذن مطلوبة قبل تسجيل التسليم'); return; }
    try {
      const path = `${inv.id}.jpg`;
      await uploadPhoto(BUCKET_PODS, path, pod);
      const { error } = await sb.from('invoices').update({
        status: 'delivered', delivered_at: new Date().toISOString(), pod_path: path,
      }).eq('id', inv.id);
      if (error) throw error;
      toast('اتسجل التسليم بإذن موقّع');
      setPodFor(null);
      setPod(null);
      bump();
    } catch (e) {
      setErr(`ما اتسجلش: ${errText(e)} — الصورة لسه محفوظة، حاول تاني`);
    }
  };

  const Card = ({ inv }: { inv: Invoice }) => {
    const ot = outletById(inv.outlet_id);
    const cls = inv.status === 'delivered' ? 'ok' : inv.status === 'dispatched' ? 'pend' : '';
    const tone = inv.status === 'created' ? 'n' : inv.status === 'dispatched' ? 'y' : 'g';
    return (
      <div className={`card feeditem ${cls}`}>
        <b>{ot?.name ?? '؟'}</b> — فاتورة {inv.invoice_no} · {inv.invoice_date}
        {inv.legacy && <> <Pill tone="v">رصيد سابق</Pill></>}
        <br />
        <b className="mono">{fmt(inv.amount)} ج</b>{' '}
        <Pill tone={tone}>{INVOICE_STATUS_LABEL[inv.status]}</Pill>

        {inv.status === 'created' && (
          <div className="btnrow">
            <ActionButton className="mini dark" onClick={() => dispatch(inv)}>خرجت من المخزن</ActionButton>
          </div>
        )}

        {inv.status === 'dispatched' && (
          podFor === inv.id ? (
            <>
              <PhotoPicker
                label="📷 صورة الإذن (مطلوبة)"
                blob={pod}
                onPick={setPod}
                onError={setErr}
              />
              <div className="btnrow">
                <ActionButton className="mini grn" disabled={!pod} onClick={() => deliver(inv)}>
                  تأكيد التسليم
                </ActionButton>
                <button className="mini" onClick={() => { setPodFor(null); setPod(null); }}>إلغاء</button>
              </div>
            </>
          ) : (
            <div className="btnrow">
              <button className="mini grn" onClick={() => { setPodFor(inv.id); setPod(null); setErr(null); }}>
                تسليم + صورة الإذن
              </button>
            </div>
          )
        )}

        {inv.status === 'delivered' && inv.pod_path && (
          showPod === inv.id
            ? <SecureImage bucket={BUCKET_PODS} path={inv.pod_path} />
            : (
              <div className="btnrow">
                <button className="mini" onClick={() => setShowPod(inv.id)}>شوف إذن التسليم</button>
              </div>
            )
        )}
      </div>
    );
  };

  return (
    <>
      <ErrLine>{err}</ErrLine>
      <Sect>فواتير شغالة ({active.length})</Sect>
      {active.length === 0 && <Empty>—</Empty>}
      {active.map((i) => <Card key={i.id} inv={i} />)}

      <Sect>آخر المسلَّم</Sect>
      {delivered.length === 0 && <Empty>—</Empty>}
      {delivered.map((i) => <Card key={i.id} inv={i} />)}
    </>
  );
}
