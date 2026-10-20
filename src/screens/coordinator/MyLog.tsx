import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { FLAG_LABEL, dwellText, timeOf, todayISO } from '../../lib/format';
import { Empty, Hint, Pill } from '../../components/ui';
import type { Visit, VisitLine } from '../../lib/types';

export default function MyLog() {
  const { profile, outletById } = useApp();

  // Cheques left this screen in Oct 2026: supervisors collect them, coordinators never hold one.
  const { data } = useQuery<{ visits: Visit[]; lines: VisitLine[] }>(
    async () => {
      if (!profile) return { visits: [], lines: [] };
      const from = `${todayISO()}T00:00:00`;
      const v = await sb.from('visits').select('*').eq('coordinator_id', profile.id)
        .gte('checkin_at', from).order('checkin_at', { ascending: false });
      if (v.error) throw v.error;
      const visits = (v.data ?? []) as Visit[];
      let lines: VisitLine[] = [];
      if (visits.length) {
        const l = await sb.from('visit_lines').select('*').in('visit_id', visits.map((x) => x.id));
        if (l.error) throw l.error;
        lines = (l.data ?? []) as VisitLine[];
      }
      return { visits, lines };
    },
    [profile?.id],
    { visits: [], lines: [] },
  );

  return (
    <>
      <Hint>نشاطي اليوم</Hint>

      {data.visits.length === 0 && <Empty>لسه مفيش زيارات النهارده</Empty>}

      {data.visits.map((v) => {
        const o = outletById(v.outlet_id);
        const zeros = data.lines.filter((l) => l.visit_id === v.id && l.shelf === 0).length;
        const open = v.checkout_at == null;
        const cls = open ? 'pend' : v.status === 'approved' ? 'ok' : v.status === 'flagged' ? 'bad' : 'pend';
        return (
          <div className={`card feeditem ${cls}`} key={v.id}>
            <b>{o?.name ?? '؟'}</b> <span className="small">{timeOf(v.checkin_at)}</span>
            {v.off_route && <> <Pill tone="v">خارج الخط</Pill></>}
            <br />
            <span className="small">
              {open
                ? 'زيارة مفتوحة — لسه ما اتبعتتش'
                : `${zeros ? `${zeros} صنف صفر · ` : ''}${dwellText(v.dwell_seconds)} · ${
                    v.status === 'approved' ? 'اعتمدها المشرف'
                      : v.status === 'flagged' ? 'مرفوضة — راجع المشرف'
                      : 'في انتظار الاعتماد'
                  }`}
            </span>
            {v.flags.length > 0 && (
              <div className="btnrow">
                {v.flags.map((f) => <Pill key={f} tone="y">{FLAG_LABEL[f] ?? f}</Pill>)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
