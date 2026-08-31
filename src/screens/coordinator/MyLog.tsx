import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { COLLECTION_STATUS_LABEL, FLAG_LABEL, dwellText, fmt, timeOf, todayISO } from '../../lib/format';
import { Empty, Hint, Pill, Sect } from '../../components/ui';
import type { Collection, Visit, VisitLine } from '../../lib/types';

export default function MyLog() {
  const { profile, outletById } = useApp();

  const { data } = useQuery<{ visits: Visit[]; lines: VisitLine[]; cheques: Collection[] }>(
    async () => {
      if (!profile) return { visits: [], lines: [], cheques: [] };
      const from = `${todayISO()}T00:00:00`;
      const [v, c] = await Promise.all([
        sb.from('visits').select('*').eq('coordinator_id', profile.id)
          .gte('checkin_at', from).order('checkin_at', { ascending: false }),
        sb.from('collections').select('*').eq('received_by', profile.id).eq('type', 'cheque')
          .order('received_at', { ascending: false }).limit(30),
      ]);
      if (v.error) throw v.error;
      if (c.error) throw c.error;
      const visits = (v.data ?? []) as Visit[];
      let lines: VisitLine[] = [];
      if (visits.length) {
        const l = await sb.from('visit_lines').select('*').in('visit_id', visits.map((x) => x.id));
        if (l.error) throw l.error;
        lines = (l.data ?? []) as VisitLine[];
      }
      return { visits, lines, cheques: (c.data ?? []) as Collection[] };
    },
    [profile?.id],
    { visits: [], lines: [], cheques: [] },
  );

  const custody = data.cheques.filter((c) => c.status === 'received');

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

      <Sect>شيكات في عهدتي ({custody.length})</Sect>
      {custody.length === 0 && <Empty>مفيش شيكات في عهدتك</Empty>}
      {custody.map((c) => (
        <div className="card" key={c.id}>
          <b>{outletById(c.outlet_id)?.name ?? '؟'}</b> — <span className="mono">{fmt(c.amount)}</span> ج
          <br />
          <span className="small">تاريخ الشيك {c.cheque_date} · {COLLECTION_STATUS_LABEL[c.status]}</span>
        </div>
      ))}
    </>
  );
}
