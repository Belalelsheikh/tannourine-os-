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
