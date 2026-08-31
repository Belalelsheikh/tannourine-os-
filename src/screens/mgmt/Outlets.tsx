import { useMemo, useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { ORD_LABEL, PAY_LABEL } from '../../lib/format';
import { mapsUrl } from '../../lib/geo';
import { ActionButton, Empty, ErrLine, Field, Pill, Segmented } from '../../components/ui';
import type { Outlet, OrderingMode, PaymentPath } from '../../lib/types';

const ORDER_MODES: OrderingMode[] = ['rep', 'central', 'mixed'];
const PAY_PATHS: PaymentPath[] = ['cheque', 'transfer', 'unknown'];

/** Outlet editor — mgmt fixes the 121 `unknown` Circle K payment paths here (PRD §15.6). */
export default function OutletsEditor() {
  const { profile, outlets, reloadRef, toast } = useApp();
  const [chain, setChain] = useState('الكل');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const chains = useMemo(() => ['الكل', ...new Set(outlets.map((o) => o.chain))], [outlets]);
  const unknownCount = outlets.filter((o) => o.payment_path === 'unknown').length;
  const pinned = outlets.filter((o) => o.lat != null).length;

  const needle = q.trim();
  const list = outlets.filter(
    (o) =>
      (chain === 'الكل' || o.chain === chain) &&
      (!needle || (o.name + o.chain + (o.manager_name ?? '')).includes(needle)),
  ).slice(0, 80);

  const patch = async (o: Outlet, field: 'ordering_mode' | 'payment_path', value: string) => {
    if (!profile) return;
    setErr(null);
    const { error } = await sb.from('outlets').update({ [field]: value }).eq('id', o.id);
    if (error) { setErr(errText(error)); return; }
    await audit(profile.id, 'edit_outlet', 'outlets', String(o.id), { field, from: o[field], to: value });
    toast('اتحدّث الفرع');
    await reloadRef();
  };

  const resetPin = async (o: Outlet) => {
    if (!profile) return;
    setErr(null);
    const { error } = await sb.rpc('reset_outlet_pin', { p_outlet: o.id });
    if (error) { setErr(errText(error)); return; }
    await audit(profile.id, 'reset_pin', 'outlets', String(o.id), { name: o.name });
    toast('اتشال الموقع — هيتسجل تاني مع أول زيارة معتمدة');
    await reloadRef();
  };

  return (
    <>
      {unknownCount > 0 && (
        <div className="card feeditem bad">
          <b>{unknownCount} فرع طريقة دفعهم غير مسجلة</b>{' '}
          <span className="small">(أغلبهم Circle K) — حدّدها من هنا</span>
        </div>
      )}
      <p className="small" style={{ marginBottom: 10 }}>
        {pinned} من {outlets.length} فرع اتسجل موقعهم من زيارة معتمدة.
      </p>

      <Segmented options={chains} value={chain} onChange={setChain} />
      <Field label="بحث">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الفرع أو المدير" />
      </Field>

      <ErrLine>{err}</ErrLine>
      {list.length === 0 && <Empty>لا نتائج</Empty>}

      {list.map((o) => (
        <div className="card" key={o.id}>
          <b>{o.name}</b> <span className="small">— {o.chain} · {o.gov}</span>
          <br />
          <span className="small">{o.manager_name ?? ''}{o.manager_phone ? ` · ${o.manager_phone}` : ''}</span>
          <br />
          <Pill tone={o.ordering_mode === 'central' ? 'v' : 'n'}>{ORD_LABEL[o.ordering_mode]}</Pill>{' '}
          <Pill tone={o.payment_path === 'transfer' ? 'g' : o.payment_path === 'unknown' ? 'r' : 'y'}>
            {PAY_LABEL[o.payment_path]}
          </Pill>

          <div className="f" style={{ marginTop: 8, marginBottom: 0 }}>
            <label>طريقة الأوردر</label>
            <select value={o.ordering_mode} onChange={(e) => void patch(o, 'ordering_mode', e.target.value)}>
              {ORDER_MODES.map((m) => <option key={m} value={m}>{ORD_LABEL[m]}</option>)}
            </select>
          </div>
          <div className="f" style={{ marginBottom: 0 }}>
            <label>طريقة الدفع</label>
            <select value={o.payment_path} onChange={(e) => void patch(o, 'payment_path', e.target.value)}>
              {PAY_PATHS.map((p) => <option key={p} value={p}>{PAY_LABEL[p]}</option>)}
            </select>
          </div>

          <div className="btnrow">
            {o.lat != null && o.lng != null ? (
              <>
                <a className="mini" href={mapsUrl(o.lat, o.lng)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  شوف الموقع
                </a>
                <ActionButton className="mini red" onClick={() => resetPin(o)}>إعادة تحديد الموقع</ActionButton>
              </>
            ) : (
              <span className="small">الموقع لسه ما اتحددش — هيتسجل مع أول زيارة معتمدة</span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
