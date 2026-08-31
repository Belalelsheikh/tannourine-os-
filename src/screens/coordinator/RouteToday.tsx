import { useMemo, useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { GPS_PRIVACY_LINE, getPosition, gpsNoticeSeen, markGpsNoticeSeen } from '../../lib/geo';
import { ORD_LABEL, isToday, stampOf, todayISO } from '../../lib/format';
import { Empty, ErrLine, Field, Hint, Pill, StatTiles } from '../../components/ui';
import VisitForm from './VisitForm';
import OrderForm from './OrderForm';
import type { Outlet, Visit } from '../../lib/types';

type View =
  | { k: 'list' }
  | { k: 'search' }
  | { k: 'outlet'; outletId: number; offRoute: boolean }
  | { k: 'form'; visit: Visit; outlet: Outlet }
  | { k: 'order'; outlet: Outlet };

export default function RouteToday() {
  const { profile, outlets, routes, outletById, bump, toast } = useApp();
  const [view, setView] = useState<View>({ k: 'list' });
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState(!gpsNoticeSeen());

  const weekday = new Date().getDay();

  const routeOutlets = useMemo(() => {
    if (!profile) return [];
    const ids = routes
      .filter((r) => r.coordinator_id === profile.id && r.weekday === weekday)
      .map((r) => r.outlet_id);
    return ids.map((id) => outletById(id)).filter((o): o is Outlet => o != null);
  }, [routes, profile?.id, weekday, outletById]);

  // Today's visits drive the "تمت" markers. Open visits are fetched without a date filter:
  // a visit started last night and never submitted must still be resumable, otherwise it is
  // stranded `pending` forever with no way to close it (PRD §5.7).
  const { data: myVisits } = useQuery<Visit[]>(
    async () => {
      if (!profile) return [];
      const mine = () => sb.from('visits').select('*').eq('coordinator_id', profile.id);
      const [today, open] = await Promise.all([
        mine().gte('checkin_at', `${todayISO()}T00:00:00`).order('checkin_at', { ascending: false }),
        mine().is('checkout_at', null).order('checkin_at', { ascending: false }),
      ]);
      if (today.error) throw today.error;
      if (open.error) throw open.error;
      const byId = new Map<string, Visit>();
      for (const v of [...(open.data ?? []), ...(today.data ?? [])] as Visit[]) byId.set(v.id, v);
      return [...byId.values()].sort((a, b) => +new Date(b.checkin_at) - +new Date(a.checkin_at));
    },
    [profile?.id],
    [],
  );

  const doneOutletIds = new Set(
    myVisits.filter((v) => v.checkout_at != null && isToday(v.checkin_at)).map((v) => v.outlet_id),
  );
  const openVisit = myVisits.find((v) => v.checkout_at == null) ?? null;

  const startVisit = async (outlet: Outlet, offRoute: boolean) => {
    if (!profile) return;
    setErr(null);
    setStarting(true);
    if (notice) { markGpsNoticeSeen(); setNotice(false); }
    try {
      // Resume today's open visit for this outlet instead of opening a second one.
      // A stale one from a previous day is deliberately NOT resumed here — reusing it would
      // record a dwell of many hours. It stays visible in the banner so it can still be closed.
      const existing = myVisits.find(
        (v) => v.outlet_id === outlet.id && v.checkout_at == null && isToday(v.checkin_at),
      );
      if (existing) { setView({ k: 'form', visit: existing, outlet }); return; }

      const pos = await getPosition();          // never blocks — null is fine
      const { data, error } = await sb.from('visits').insert({
        coordinator_id: profile.id,
        outlet_id: outlet.id,
        checkin_at: new Date().toISOString(),
        checkin_lat: pos?.lat ?? null,
        checkin_lng: pos?.lng ?? null,
        off_route: offRoute,
      }).select('*').single();
      if (error) throw error;
      bump();
      setView({ k: 'form', visit: data as Visit, outlet });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setStarting(false);
    }
  };

  // ---------- visit form ----------
  if (view.k === 'form') {
    return (
      <VisitForm
        visit={view.visit}
        outlet={view.outlet}
        onCancel={() => { bump(); setView({ k: 'list' }); }}
        onDone={() => {
          bump();
          if (view.outlet.ordering_mode === 'central') setView({ k: 'list' });
          else setView({ k: 'outlet', outletId: view.outlet.id, offRoute: false });
        }}
      />
    );
  }

  if (view.k === 'order') {
    return (
      <OrderForm
        outlet={view.outlet}
        onCancel={() => setView({ k: 'list' })}
        onDone={() => { bump(); setView({ k: 'list' }); }}
      />
    );
  }

  // ---------- outlet detail ----------
  if (view.k === 'outlet') {
    const o = outletById(view.outletId);
    if (!o) return <Empty>الفرع مش موجود</Empty>;
    const checkedToday = doneOutletIds.has(o.id);
    const canOrder = o.ordering_mode !== 'central';
    const resumable = openVisit?.outlet_id === o.id;

    return (
      <>
        <Hint>
          <b>{o.name}</b> — {o.chain}
          {o.ordering_mode === 'central' && (
            <>
              <br />
              <Pill tone="v">الأوردر مركزي — جرد فقط، النواقص تروح متابعة للسلسلة</Pill>
            </>
          )}
        </Hint>

        {notice && <p className="small" style={{ marginBottom: 10 }}>{GPS_PRIVACY_LINE}</p>}
        <ErrLine>{err}</ErrLine>

        <button
          className="rowbtn"
          disabled={starting}
          onClick={() => void startVisit(o, view.offRoute)}
        >
          <span>
            <span className="nm">{resumable ? 'إكمال الزيارة المفتوحة' : checkedToday ? 'جرد تاني' : 'بدء الزيارة'}</span>
            <span className="sub">رف · مخزن · بيع لكل صنف (تنورين + ڤيا)</span>
          </span>
          {checkedToday && <Pill tone="g">تمت</Pill>}
        </button>

        {canOrder && (
          <button className="rowbtn" onClick={() => setView({ k: 'order', outlet: o })}>
            <span>
              <span className="nm">عمل أوردر</span>
              <span className="sub">طلب كميات — يوصل لمسؤول الأوردرات</span>
            </span>
          </button>
        )}

        <button className="ghost" onClick={() => setView({ k: 'list' })}>رجوع لخط اليوم</button>
      </>
    );
  }

  // ---------- off-route search ----------
  if (view.k === 'search') {
    const needle = q.trim();
    const results = needle
      ? outlets.filter((o) => (o.name + o.chain).includes(needle)).slice(0, 25)
      : outlets.slice(0, 25);
    return (
      <>
        <Hint>زيارة خارج الخط — هتتسجل كـ «خارج الخط» للمشرف</Hint>
        <Field label="ابحث عن الفرع">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الفرع أو السلسلة" />
        </Field>
        {results.length === 0 && <Empty>لا نتائج</Empty>}
        {results.map((o) => (
          <button key={o.id} className="rowbtn" onClick={() => setView({ k: 'outlet', outletId: o.id, offRoute: true })}>
            <span>
              <span className="nm">{o.name}</span>
              <span className="sub">{o.chain} · {o.gov}</span>
            </span>
          </button>
        ))}
        <button className="ghost" onClick={() => setView({ k: 'list' })}>رجوع</button>
      </>
    );
  }

  // ---------- today's route ----------
  const remaining = routeOutlets.filter((o) => !doneOutletIds.has(o.id)).length;

  return (
    <>
      <StatTiles
        items={[
          { n: doneOutletIds.size, label: 'زيارات اليوم', tone: 'good' },
          { n: remaining, label: 'باقي بالخط' },
        ]}
      />

      {openVisit && (
        <div className="card feeditem pend">
          <b>{isToday(openVisit.checkin_at) ? 'عندك زيارة مفتوحة' : 'عندك زيارة قديمة لم تُغلق'}</b>
          <br />
          <span className="small">
            {outletById(openVisit.outlet_id)?.name ?? '؟'} — بدأت {stampOf(openVisit.checkin_at)}
          </span>
          <div className="btnrow">
            <button
              className="mini dark"
              onClick={() => {
                const o = outletById(openVisit.outlet_id);
                if (o) setView({ k: 'form', visit: openVisit, outlet: o });
                else toast('الفرع مش موجود');
              }}
            >
              كمّل الزيارة
            </button>
          </div>
        </div>
      )}

      {routeOutlets.length === 0 && (
        <Hint>لا يوجد خط سير لليوم — كلم المشرف أو سجّل زيارة خارج الخط.</Hint>
      )}

      {routeOutlets.map((o) => {
        const done = doneOutletIds.has(o.id);
        return (
          <button
            key={o.id}
            className={`rowbtn ${done ? 'ok' : ''}`}
            onClick={() => setView({ k: 'outlet', outletId: o.id, offRoute: false })}
          >
            <span>
              <span className="nm">{o.name}</span>
              <span className="sub">
                {o.chain} · {o.gov}
                {o.ordering_mode !== 'rep' && ` · ${ORD_LABEL[o.ordering_mode]}`}
              </span>
            </span>
            {done && <Pill tone="g">تمت</Pill>}
          </button>
        );
      })}

      <button className="ghost" onClick={() => { setQ(''); setView({ k: 'search' }); }}>
        ＋ زيارة خارج الخط
      </button>
    </>
  );
}
