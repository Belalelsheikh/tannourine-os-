import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { telHref } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Hint } from '../../components/ui';
import type { Followup } from '../../lib/types';

/** تنبيهات — central/mixed outlets with zero shelf need chasing at the chain, not the branch (PRD §10). */
export default function Followups() {
  const { profile, outletById, skuById, bump, toast } = useApp();
  const [err, setErr] = useState<string | null>(null);

  const { data: list } = useQuery<Followup[]>(
    async () => {
      const { data, error } = await sb.from('followups').select('*')
        .eq('status', 'open').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Followup[];
    },
    [],
    [],
  );

  const close = async (f: Followup) => {
    if (!profile) return;
    setErr(null);
    const { error } = await sb.from('followups').update({
      status: 'done', done_by: profile.id, done_at: new Date().toISOString(),
    }).eq('id', f.id);
    if (error) { setErr(errText(error)); return; }
    toast('اتسجلت المتابعة');
    bump();
  };

  return (
    <>
      <Hint>فروع أوردرها مركزي وعندها نواقص — لازم متابعة مع مشتري السلسلة</Hint>
      <ErrLine>{err}</ErrLine>
      {list.length === 0 && <Empty>مفيش متابعات مطلوبة</Empty>}

      {list.map((f) => {
        const o = outletById(f.outlet_id);
        const tel = telHref(o?.manager_phone ?? null);
        return (
          <div className="card feeditem bad" key={f.id}>
            <b>{o?.name ?? '؟'}</b> — {o?.chain ?? ''}
            <br />
            <span className="small">
              {new Date(f.created_at).toLocaleDateString('en-GB')} ·{' '}
              {f.zero_skus.map((s) => skuById(s)?.name_ar ?? s).join('، ')}
            </span>
            {o?.manager_name && (
              <>
                <br />
                <span className="small">{o.manager_name}{o.manager_phone ? ` · ${o.manager_phone}` : ''}</span>
              </>
            )}
            <div className="btnrow">
              {tel && <a className="mini" href={tel} style={{ textDecoration: 'none' }}>اتصل بمدير الفرع</a>}
              <ActionButton className="mini dark" onClick={() => close(f)}>تم التواصل مع السلسلة</ActionButton>
            </div>
          </div>
        );
      })}
    </>
  );
}
