import { useState } from 'react';
import { useApp, useQuery } from '../../lib/app';
import { sb } from '../../lib/supabase';
import { cairoDayRange, cairoTime, cairoToday } from '../../lib/cairo';
import { FLAG_LABEL, dwellText, fmt0 } from '../../lib/format';
import { GPS_PRIVACY_LINE, haversine, mapsDirUrl, mapsUrl, type Coords } from '../../lib/geo';
import { Empty, ErrLine, Field, Hint, Pill } from '../../components/ui';
import type { Profile, Visit } from '../../lib/types';

/** The check-in fence radius and the far-checkout threshold (geofence migration). */
const FAR_FROM_PIN_M = 150;
const FAR_SEND_M = 300;

const pt = (lat: number | null, lng: number | null): Coords | null =>
  lat != null && lng != null ? { lat, lng } : null;

function MapLink({ p }: { p: Coords | null }) {
  return p
    ? <a href={mapsUrl(p.lat, p.lng)} target="_blank" rel="noreferrer">خريطة</a>
    : <Pill tone="n">من غير GPS</Pill>;
}

/**
 * «المواقع» (Batch B7): one coordinator's day, start and send points per visit. Distances are
 * computed on read against the outlet's current pin, not the stored distance_m, so a pin fixed
 * later re-measures old visits. Reads only the two points already captured per visit.
 */
export default function Locations({ team, mine }: { team: Profile[]; mine: Profile[] }) {
  const { outletById } = useApp();
  const [who, setWho] = useState(() => (mine[0] ?? team[0])?.id ?? '');
  const [day, setDay] = useState(cairoToday);

  const list = useQuery<Visit[]>(
    async () => {
      if (!who) return [];
      const { from, to } = cairoDayRange(day);
      const { data, error } = await sb.from('visits').select('*').eq('coordinator_id', who)
        .gte('checkin_at', from).lt('checkin_at', to).order('checkin_at');
      if (error) throw error;
      return (data ?? []) as Visit[];
    },
    [who, day],
    [],
  );

  const route = list.data.flatMap((v) =>
    [pt(v.checkin_lat, v.checkin_lng), pt(v.checkout_lat, v.checkout_lng)].filter((p): p is Coords => p != null));

  return (
    <>
      <div className="cols">
        <Field label="المنسق">
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            {team.map((c) => <option key={c.id} value={c.id}>{c.full_name}{!c.active && ' (موقوف)'}</option>)}
          </select>
        </Field>
        <Field label="اليوم">
          <input type="date" value={day} max={cairoToday()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>
      </div>

      {route.length > 0 && (
        <div className="btnrow" style={{ marginTop: 0, marginBottom: 10 }}>
          <a className="mini dark" href={mapsDirUrl(route)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            افتح اليوم على الخريطة
          </a>
        </div>
      )}

      <ErrLine>{list.error}</ErrLine>
      {list.loading && list.data.length === 0 && <p className="small">جارٍ التحميل…</p>}
      {!list.loading && list.data.length === 0 && <Empty>مفيش زيارات في اليوم ده</Empty>}

      {list.data.map((v) => {
        const o = outletById(v.outlet_id);
        const start = pt(v.checkin_lat, v.checkin_lng);
        const send = pt(v.checkout_lat, v.checkout_lng);
        const pin = o ? pt(o.lat, o.lng) : null;
        const fromPin = start && pin ? haversine(start, pin) : null;
        const fromStart = start && send ? haversine(start, send) : null;
        return (
          <div key={v.id} className="card feeditem">
            <b><bdi>{o ? `${o.chain} ${o.name}` : '؟'}</bdi></b>
            {v.off_route && <> <Pill tone="v">خارج الخط</Pill></>}
            <p className="small" style={{ marginTop: 4 }}>
              البداية <span className="mono">{cairoTime(v.checkin_at)}</span> · <MapLink p={start} />
              {' · '}
              {!start ? null : !pin
                ? 'الفرع مالوش موقع متثبت'
                : fromPin != null && fromPin > FAR_FROM_PIN_M
                  ? <Pill tone="y">{fmt0(fromPin)} م من الفرع</Pill>
                  : <><span className="mono">{fmt0(fromPin)}</span> م من الفرع</>}
              <br />
              {v.checkout_at == null
                ? 'لسه مفتوحة'
                : (
                  <>
                    الإرسال <span className="mono">{cairoTime(v.checkout_at)}</span> · <MapLink p={send} />
                    {fromStart != null && (
                      <>
                        {' · '}
                        {fromStart > FAR_SEND_M
                          ? <Pill tone="y">{fmt0(fromStart)} م من البداية</Pill>
                          : <><span className="mono">{fmt0(fromStart)}</span> م من البداية</>}
                      </>
                    )}
                  </>
                )}
              <br />
              مدة {dwellText(v.dwell_seconds)}
            </p>
            {v.flags.length > 0 && (
              <div className="btnrow">
                {v.flags.map((f) => <Pill key={f} tone="y">{FLAG_LABEL[f] ?? f}</Pill>)}
              </div>
            )}
          </div>
        );
      })}

      <Hint>{GPS_PRIVACY_LINE} البعد عن الفرع محسوب من الموقع المتسجل للفرع دلوقتي. الأوقات بتوقيت القاهرة.</Hint>
    </>
  );
}
