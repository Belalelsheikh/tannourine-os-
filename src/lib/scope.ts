import type { Profile } from './types';

/**
 * Which coordinators a viewer supervises — PRD §5.8.
 * Assigned coordinators win; governorate scope is the fallback; 'الكل' (marwa, mgmt) sees all.
 */
export function coordinatorsInScope(viewer: Profile | null, all: Profile[]): Profile[] {
  const coordinators = all.filter((p) => p.role === 'coordinator' && p.active);
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
