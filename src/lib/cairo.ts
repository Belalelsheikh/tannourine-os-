/**
 * Calendar days in Cairo time.
 *
 * Postgres reads a bare `2026-10-20T00:00:00` as UTC, so "today" built from the device date
 * starts at 02:00 or 03:00 Cairo time. A visit between midnight and then lands on the wrong
 * day. Screens that bucket by day use these helpers, which return exact UTC instants for
 * Cairo midnight and handle Egypt's summer time.
 */

const TZ = 'Africa/Cairo';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** `YYYY-MM-DD` of an instant, in Cairo. */
export const cairoDateOf = (ts: string | number | Date): string => dateFmt.format(new Date(ts));

export const cairoToday = (): string => cairoDateOf(Date.now());

/** `HH:MM` of an instant, in Cairo. */
export const cairoTime = (ts: string): string => timeFmt.format(new Date(ts));

const ymd = (day: string) => day.split('-').map(Number) as [number, number, number];

export function addDays(day: string, n: number): string {
  const [y, m, d] = ymd(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0=Sun … 6=Sat — the `routes.weekday` convention (JS getDay). */
export function weekdayOf(day: string): number {
  const [y, m, d] = ymd(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Cairo's UTC offset at an instant, in ms. */
function offsetAt(ms: number): number {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of 00:00 Cairo on `day`. */
function cairoMidnight(day: string): number {
  const [y, m, d] = ymd(day);
  const wall = Date.UTC(y, m - 1, d);
  // Two passes: the offset at the guess can differ from the offset at the answer on a
  // summer-time change day.
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return t;
}

/** `[from, to)` UTC instants covering one Cairo calendar day — for `.gte()` / `.lt()`. */
export function cairoDayRange(day: string): { from: string; to: string } {
  return {
    from: new Date(cairoMidnight(day)).toISOString(),
    to: new Date(cairoMidnight(addDays(day, 1))).toISOString(),
  };
}
