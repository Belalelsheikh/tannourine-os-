import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText, BUCKET_VISITS } from '../../lib/supabase';
import { coordinatorsInScope } from '../../lib/scope';
import { FLAG_LABEL, dwellText, fmt, stampOf, timeOf, todayISO } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Pill, SecureImage, Sect } from '../../components/ui';
import type { Visit, VisitLine } from '../../lib/types';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export default function Feed() {
  const { profile, profiles, outletById, skuById, bump, toast } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);

  const team = useMemo(() => coordinatorsInScope(profile, profiles), [profile, profiles]);
  const teamIds = useMemo(() => team.map((t) => t.id), [team]);

  // Today's visits feed the review list and the silent-team banner. Open visits are fetched
  // separately with no date filter — an unclosed visit from a previous day must not disappear
  // at midnight, which is the only way it would ever get chased (PRD §5.7).
  const { data } = useQuery<{ visits: Visit[]; open: Visit[]; lines: VisitLine[]; routedIds: string[] }>(
    async () => {
      if (teamIds.length === 0) return { visits: [], open: [], lines: [], routedIds: [] };
      const from = `${todayISO()}T00:00:00`;
      const team = () => sb.from('visits').select('*').in('coordinator_id', teamIds);
      const [v, o, r] = await Promise.all([
        team().gte('checkin_at', from).order('checkin_at', { ascending: false }),
        team().is('checkout_at', null).order('checkin_at', { ascending: false }),
        sb.from('routes').select('coordinator_id').in('coordinator_id', teamIds)
          .eq('weekday', new Date().getDay()),
      ]);
      if (v.error) throw v.error;
      if (o.error) throw o.error;
      if (r.error) throw r.error;
      const visits = (v.data ?? []) as Visit[];
      let lines: VisitLine[] = [];
      if (visits.length) {
        const l = await sb.from('visit_lines').select('*').in('visit_id', visits.map((x) => x.id));
        if (l.error) throw l.error;
        lines = (l.data ?? []) as VisitLine[];
      }
      const routedIds = [...new Set(((r.data ?? []) as { coordinator_id: string }[]).map((x) => x.coordinator_id))];
      return { visits, open: (o.data ?? []) as Visit[], lines, routedIds };
    },
    [teamIds.join(',')],
    { visits: [], open: [], lines: [], routedIds: [] },
  );

  const submitted = data.visits.filter((v) => v.checkout_at != null);
  const stale = data.open.filter(
    (v) => Date.now() - new Date(v.checkin_at).getTime() > FOUR_HOURS_MS,
  );
  const silent = team.filter(
    (c) => data.routedIds.includes(c.id) && !data.visits.some((v) => v.coordinator_id === c.id),
  );

  const review = async (v: Visit, status: 'approved' | 'flagged') => {
    if (!profile) return;
    setErr(null);
    const upd = await sb.from('visits').update({
      status, reviewed_by: profile.id, reviewed_at: new Date().toISOString(),
    }).eq('id', v.id);
    if (upd.error) { setErr(errText(upd.error)); return; }

    // Approval is the verification that sets a pin-less outlet's location (PRD §5.6).
    if (status === 'approved' && v.checkin_lat != null && v.checkin_lng != null) {
      const outlet = outletById(v.outlet_id);
      if (outlet && outlet.lat == null) {
        const rpc = await sb.rpc('set_outlet_pin', {
          p_outlet: v.outlet_id, p_lat: v.checkin_lat, p_lng: v.checkin_lng,
        });
        if (rpc.error) toast(`الاعتماد تم لكن الموقع ما اتسجلش: ${errText(rpc.error)}`);
        else toast('اتعتمدت — واتسجل موقع الفرع');
      } else toast('اتعتمدت');
    } else toast(status === 'approved' ? 'اتعتمدت' : 'اترفضت');
    bump();
  };

  return (
    <>
      {silent.length > 0 && (
        <div className="card feeditem bad">
          <b>الفريق الصامت — لسه مفيش زيارات من:</b>
          <br />
          <span className="small">{silent.map((s) => s.full_name).join(' · ')}</span>
        </div>
      )}

      {stale.length > 0 && (
        <>
          <Sect>زيارات لم تُغلق ({stale.length})</Sect>
          {stale.map((v) => (
            <div className="card feeditem bad" key={v.id}>
              <b>{outletById(v.outlet_id)?.name ?? '؟'}</b>{' '}
              <span className="small">
                — {profiles.find((p) => p.id === v.coordinator_id)?.full_name ?? '؟'} · بدأت {stampOf(v.checkin_at)}
              </span>
              <br />
              <Pill tone="r">زيارة لم تُغلق</Pill>
            </div>
          ))}
        </>
      )}

      <ErrLine>{err}</ErrLine>

      <Sect>زيارات اليوم ({submitted.length})</Sect>
      {submitted.length === 0 && <Empty>مفيش زيارات النهارده</Empty>}

      {submitted.map((v) => {
        const o = outletById(v.outlet_id);
        const who = profiles.find((p) => p.id === v.coordinator_id);
        const zeros = data.lines.filter((l) => l.visit_id === v.id && l.shelf === 0);
        const cls = v.status === 'approved' ? 'ok' : v.status === 'flagged' ? 'bad' : 'pend';
        return (
          <div className={`card feeditem ${cls}`} key={v.id}>
            <b>{o?.name ?? '؟'}</b>{' '}
            <span className="small">— {who?.full_name ?? '؟'} · {timeOf(v.checkin_at)}</span>
            {v.off_route && <> <Pill tone="v">خارج الخط</Pill></>}
            <br />
            <span className="small">
              مدة {dwellText(v.dwell_seconds)} ·{' '}
              {v.distance_m == null ? 'الموقع لسه ما اتحددش' : `${fmt(v.distance_m)} م من الفرع`}
            </span>
            <br />
            {zeros.length > 0
              ? (
                <>
                  <Pill tone="r">{zeros.length} صنف صفر</Pill>{' '}
                  <span className="small">{zeros.map((z) => skuById(z.sku_id)?.name_ar ?? z.sku_id).join('، ')}</span>
                </>
              )
              : <Pill tone="g">متوفر</Pill>}

            {v.flags.length > 0 && (
              <div className="btnrow">
                {v.flags.map((f) => <Pill key={f} tone="y">{FLAG_LABEL[f] ?? f}</Pill>)}
              </div>
            )}

            {v.photo_path && (
              openPhoto === v.id
                ? <SecureImage bucket={BUCKET_VISITS} path={v.photo_path} />
                : (
                  <div className="btnrow">
                    <button className="mini" onClick={() => setOpenPhoto(v.id)}>شوف صورة الرف</button>
                  </div>
                )
            )}

            {v.status === 'pending' && (
              <div className="btnrow">
                <ActionButton className="mini grn" onClick={() => review(v, 'approved')}>اعتماد</ActionButton>
                <ActionButton className="mini red" onClick={() => review(v, 'flagged')}>رفض</ActionButton>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
