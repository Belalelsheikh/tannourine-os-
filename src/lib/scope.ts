import type { Profile } from './types';

/**
 * Which coordinators a viewer supervises — PRD §5.8.
 * Assigned coordinators win; governorate scope is the fallback; 'الكل' (marwa, mgmt) sees all.
 *
 * `includeInactive` is for review work only: a coordinator deactivated mid-week can still
 * leave a pending or never-closed visit, and leaving them out hides it from everyone.
 */
export function coordinatorsInScope(
  viewer: Profile | null,
  all: Profile[],
  { includeInactive = false } = {},
): Profile[] {
  const coordinators = all.filter((p) => p.role === 'coordinator' && (includeInactive || p.active));
  if (!viewer) return [];
  if (viewer.role === 'mgmt' || viewer.scope === 'الكل') return coordinators;

  const assigned = coordinators.filter((c) => c.supervisor_id === viewer.id);
  if (assigned.length > 0) return assigned;

  return coordinators.filter((c) => c.scope === viewer.scope || c.scope === 'الكل');
}

/** True when the fallback is in play — both Cairo supervisors then see the same board. */
export function usingGovFallback(viewer: Profile | null, all: Profile[]): boolean {
  if (!viewer || viewer.role === 'mgmt' || viewer.scope === 'الكل') return false;
  return !all.some((p) => p.role === 'coordinator' && p.active && p.supervisor_id === viewer.id);
}
