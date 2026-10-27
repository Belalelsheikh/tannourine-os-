import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { fmt, stampOf, telHref, todayISO } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Hint, Sect } from '../../components/ui';
import type { Invoice } from '../../lib/types';

/** Out with a driver this long and still not delivered → someone has to call the branch. */
const LATE_MS = 48 * 3600 * 1000;
const DRIVERS_KEY = 'tannourine.drivers';

/** Recent driver names on this device — convenience only, so storage failures are ignored. */
function loadDrivers(): string[] {
  try { return JSON.parse(localStorage.getItem(DRIVERS_KEY) ?? '[]') as string[]; } catch { return []; }
}
function rememberDriver(name: string) {
  try {
    const next = [name, ...loadDrivers().filter((d) => d !== name)].slice(0, 12);
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(next));
  } catch { /* private window */ }
}

const dayOf = (ts: string) => ts.slice(0, 10);

function byDay(list: Invoice[], key: (i: Invoice) => string): [string, Invoice[]][] {
  const m = new Map<string, Invoice[]>();
  for (const i of list) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * «التوصيل» — issued invoices leave the warehouse with a driver, then come back delivered.
 * No photo here: the signed إذن استلام goes back to المالية, who match it against the invoice.
 */
export default function Delivery() {
  const { outletById, bump, toast } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [driver, setDriver] = useState<Record<string, string>>({});
  const [date, setDate] = useState<Record<string, string>>({});
  const drivers = loadDrivers();

  const { data: invoices } = useQuery<Invoice[]>(
    async () => {
      const { data, error } = await sb.from('invoices').select('*')
        .in('status', ['issued', 'dispatched'])
        .order('invoice_no', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
    [],
    [],
  );

  const issued = invoices.filter((i) => i.status === 'issued');
  const out = invoices.filter((i) => i.status === 'dispatched');

  const update = async (inv: Invoice, patch: Partial<Invoice>, done: string) => {
    setErr(null);
    const { data, error } = await sb.from('invoices').update(patch)
      .eq('id', inv.id).eq('status', inv.status).select('id');
    if (error) { setErr(`ما اتسجلش: ${errText(error)} — حاول تاني`); return false; }
    if ((data?.length ?? 0) === 0) { setErr('الفاتورة اتغيرت من حد تاني — حدّث الشاشة'); bump(); return false; }
    toast(done);
    bump();
    return true;
  };

  const dispatch = async (inv: Invoice) => {
    const name = (driver[inv.id] ?? '').trim();
    if (!name) { setErr('اكتب اسم السواق'); return; }
    const ok = await update(inv, {
      status: 'dispatched', driver: name, dispatched_at: new Date().toISOString(),
    }, `فاتورة ${inv.invoice_no} خرجت مع ${name}`);
    if (ok) rememberDriver(name);
  };

  const deliver = async (inv: Invoice) => {
    const d = date[inv.id] ?? todayISO();
    // Today keeps the real time; a back-dated delivery lands at midday so it never slips a day in UTC.
    const at = d === todayISO() ? new Date().toISOString() : new Date(`${d}T12:00:00`).toISOString();
    await update(inv, { status: 'delivered', delivered_at: at }, `فاتورة ${inv.invoice_no} اتسلمت`);
  };

  const head = (inv: Invoice) => {
    const ot = outletById(inv.outlet_id);
    const tel = telHref(ot?.manager_phone ?? null);
    return (
      <>
        <b>{ot?.name ?? '؟'}</b> — {ot?.chain ?? ''}
        <br />
        <span className="small">
          فاتورة {inv.invoice_no}{inv.eta_ref && <> · ETA <span className="mono">{inv.eta_ref}</span></>}
          {' · '}<b className="mono">{fmt(inv.amount)} ج</b>
        </span>
        {tel && <><br /><a className="small" href={tel}>📞 {ot?.manager_name ?? 'الفرع'}</a></>}
      </>
    );
  };

  return (
    <>
      <Hint>الفواتير الصادرة — سجّل خروجها مع السواق، وبعدين تسليمها</Hint>
      <ErrLine>{err}</ErrLine>
      <datalist id="drivers">{drivers.map((d) => <option key={d} value={d} />)}</datalist>

      <Sect>جاهزة للخروج ({issued.length})</Sect>
      {issued.length === 0 && <Empty>مفيش فواتير مستنية الخروج</Empty>}
      {byDay(issued, (i) => i.invoice_date).map(([day, list]) => (
        <div key={day}>
          <p className="small">{day} · {list.length}</p>
          {list.map((inv) => (
            <div className="card feeditem pend" key={inv.id}>
              {head(inv)}
              <input
                list="drivers"
                value={driver[inv.id] ?? ''}
                onChange={(e) => setDriver({ ...driver, [inv.id]: e.target.value })}
                placeholder="اسم السواق"
                style={{ marginTop: 8 }}
              />
              <div className="btnrow">
                <ActionButton
                  className="mini dark"
                  disabled={!(driver[inv.id] ?? '').trim()}
                  onClick={() => dispatch(inv)}
                >
                  خرجت من المخزن
                </ActionButton>
              </div>
            </div>
          ))}
        </div>
      ))}

      <Sect>خرجت — مستنية التسليم ({out.length})</Sect>
      {out.length === 0 && <Empty>—</Empty>}
      {byDay(out, (i) => dayOf(i.dispatched_at ?? i.created_at)).map(([day, list]) => (
        <div key={day}>
          <p className="small">خرجت {day} · {list.length}</p>
          {list.map((inv) => {
            const late = inv.dispatched_at != null && Date.now() - new Date(inv.dispatched_at).getTime() > LATE_MS;
            return (
              <div className={`card feeditem ${late ? 'bad' : 'ok'}`} key={inv.id}>
                {head(inv)}
                <br />
                <span className="small">
                  مع {inv.driver ?? '؟'} · خرجت {inv.dispatched_at ? stampOf(inv.dispatched_at) : '—'}
                </span>
                {late && <><br /><b className="err" style={{ margin: 0 }}>أكتر من ٤٨ ساعة ولسه ما اتسلمتش</b></>}
                <div className="btnrow">
                  <input
                    type="date"
                    value={date[inv.id] ?? todayISO()}
                    max={todayISO()}
                    onChange={(e) => setDate({ ...date, [inv.id]: e.target.value })}
                    style={{ width: 'auto' }}
                  />
                  <ActionButton className="mini grn" onClick={() => deliver(inv)}>اتسلمت</ActionButton>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
