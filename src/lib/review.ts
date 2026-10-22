import type { Visit } from './types';

/**
 * Submitted visits still waiting on a supervisor, oldest first — from every day, not just
 * today. Filtering by date is what hid a month of Alexandria visits: a visit not reviewed
 * on its own day fell off the screen at midnight while the tab badge kept counting it.
 */
export function reviewQueue(visits: Visit[]): Visit[] {
  return visits
    .filter((v) => v.status === 'pending' && v.checkout_at != null)
    .sort((a, b) => +new Date(a.checkin_at) - +new Date(b.checkin_at));
}

/** Whole calendar days between `ts` and `now`, in device-local time (yesterday 23:30 is 1). */
export function calendarDaysAgo(ts: string, now = new Date()): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(now) - day(new Date(ts))) / 86400000);
}

/** Age pill text for a queued visit; null for today, where the time alone says enough. */
export function ageLabel(days: number): string | null {
  if (days <= 0) return null;
  return days === 1 ? 'إمبارح' : `من ${days} يوم`;
}

/**
 * Supervisor closes a visit the coordinator never submitted. It is checked out now so it
 * leaves every "open visit" list, and flagged `unclosed` so nobody mistakes it for a
 * completed visit. dwell is left null: the gap between check-in and now is not a dwell.
 */
export function closeUnfinishedPatch(v: Visit, reviewerId: string, now = new Date()) {
  const at = now.toISOString();
  return {
    checkout_at: at,
    status: 'flagged' as const,
    reviewed_by: reviewerId,
    reviewed_at: at,
    flags: v.flags.includes('unclosed') ? v.flags : [...v.flags, 'unclosed'],
  };
}

/** A visit the coordinator actually submitted — the supervisor's «قفل الزيارة» doesn't count. */
const submitted = (v: Visit) => v.checkout_at != null && !v.flags.includes('unclosed');

/** Shelf photo is optional: a submitted visit without one gets the «بدون صورة» chip. */
export function missingPhoto(v: Visit): boolean {
  return submitted(v) && v.photo_path == null;
}

/** Submitted visits and how many carry a shelf photo, per coordinator. */
export function photoRateByCoordinator(visits: Visit[]): Map<string, { total: number; withPhoto: number }> {
  const out = new Map<string, { total: number; withPhoto: number }>();
  for (const v of visits) {
    if (!submitted(v)) continue;
    const r = out.get(v.coordinator_id) ?? { total: 0, withPhoto: 0 };
    r.total += 1;
    if (v.photo_path != null) r.withPhoto += 1;
    out.set(v.coordinator_id, r);
  }
  return out;
}
