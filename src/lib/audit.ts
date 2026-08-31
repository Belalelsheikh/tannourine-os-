import { sb } from './supabase';

export type AuditAction =
  | 'void_invoice'
  | 'edit_collection'
  | 'reset_pin'
  | 'legacy_invoice'
  | 'set_supervisor'
  | 'deactivate_user'
  | 'activate_user'
  | 'edit_outlet';

/**
 * Append-only trail (no hard deletes anywhere — PRD §7).
 * Never throws: a failed audit write must not roll back the action the user just took,
 * but it does surface so the gap is visible rather than silent.
 */
export async function audit(
  actor: string,
  action: AuditAction,
  entity: string,
  entityId: string,
  detail: Record<string, unknown>,
): Promise<string | null> {
  const { error } = await sb.from('audit_log').insert({
    actor, action, entity, entity_id: entityId, detail,
  });
  return error ? error.message : null;
}
