import { haversine, type Coords } from './geo.ts';
import type { Outlet } from './types';

/**
 * Check-in fence (Batch A4). Mirrors the `visits_checkin_fence` trigger, which is the
 * authority; this copy only decides which Arabic prompt to show before the insert.
 * 150 m, not less: urban GPS in Cairo malls and fuel-station stores is routinely 30–80 m off.
 */
export const CHECKIN_FENCE_METRES = 150;
/** Check-out more than this from the check-in point adds `far_checkout` (DB-side). */
export const CHECKOUT_FAR_METRES = 300;

export type CheckinDecision =
  | { k: 'ok'; distance: number | null }
  | { k: 'reason'; distance: number }
  | { k: 'blocked'; distance: number };

/** No pin or no GPS fix → ok; unverified pin far → reason; verified pin far → blocked. */
export function checkinDecision(
  outlet: Pick<Outlet, 'lat' | 'lng' | 'pin_verified'>,
  pos: Coords | null,
): CheckinDecision {
  if (outlet.lat == null || outlet.lng == null || pos == null) return { k: 'ok', distance: null };
  const distance = haversine(pos, { lat: outlet.lat, lng: outlet.lng });
  if (distance <= CHECKIN_FENCE_METRES) return { k: 'ok', distance };
  return outlet.pin_verified ? { k: 'blocked', distance } : { k: 'reason', distance };
}

/** The fence trigger raises `checkin_blocked:<m>` / `checkin_reason_required:<m>`. */
export function fenceError(message: string): CheckinDecision | null {
  const m = message.match(/(checkin_blocked|checkin_reason_required):(\d+)/);
  if (!m) return null;
  const distance = Number(m[2]);
  return m[1] === 'checkin_blocked' ? { k: 'blocked', distance } : { k: 'reason', distance };
}

export const blockedText = (distance: number) => `أنت على بعد ${distance} م من الفرع`;
