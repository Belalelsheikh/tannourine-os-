export interface Coords { lat: number; lng: number; }

/**
 * High-accuracy fix with a 10s cap (PRD §5.2). Resolves null on denial, timeout,
 * or an unsupported browser — GPS never blocks a workflow.
 */
export function getPosition(timeoutMs = 10000): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) { resolve(null); return; }
    let settled = false;
    const done = (v: Coords | null) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); done({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(timer); done(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/** Metres between two points. */
export function haversine(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export const SHORT_VISIT_SECONDS = 240;
export const FAR_FROM_PIN_METRES = 300;

/** «افتح في الخرائط» — PRD §5.8. */
export const mapsUrl = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;

export const GPS_PRIVACY_LINE =
  'الموقع يُسجَّل مرتين فقط: عند بدء الزيارة وعند الإرسال — لا يوجد تتبع مستمر.';

const PRIVACY_KEY = 'tn_gps_notice_seen';
export const gpsNoticeSeen = () => localStorage.getItem(PRIVACY_KEY) === '1';
export const markGpsNoticeSeen = () => localStorage.setItem(PRIVACY_KEY, '1');
