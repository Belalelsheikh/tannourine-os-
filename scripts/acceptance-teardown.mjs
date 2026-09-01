// Companion to acceptance-run.mjs: removes every row the run created and restores
// outlets/profiles to seed values. Service key (bypasses RLS by design).
//
//   NODE_USE_ENV_PROXY=1 SB_URL=... SB_SERVICE=... node scripts/acceptance-teardown.mjs
//
// Deliberately exhaustive rather than targeted: it clears ALL transactional rows
// and ALL pins. An earlier version deleted only visits at outlets [1,180], which
// silently missed rows once the runner picked a different `central` outlet — it
// left 2 visits, 4 lines, 2 follow-ups, 2 pins and 4 storage objects behind.
// Safe precisely because this is a pre-launch project with no real data: run it
// against a project that has live staff data and you WILL destroy that data.
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SB_URL, process.env.SB_SERVICE, { auth: { persistSession: false } });
const log = (n, e) => console.log(e ? `  x  ${n}: ${e.message}` : `  ok ${n}`);
const ALL_UUID = '00000000-0000-0000-0000-000000000000';

// ---- storage: list and remove everything in both buckets ----
for (const bucket of ['visit-photos', 'pods']) {
  const { data, error } = await sb.storage.from(bucket).list('', { limit: 1000 });
  if (error) { log(`${bucket} list`, error); continue; }
  const names = (data ?? []).map(o => o.name);
  if (names.length) {
    const { error: re } = await sb.storage.from(bucket).remove(names);
    log(`${bucket} (${names.length} objects)`, re);
  } else log(`${bucket} (already empty)`);
}

// ---- transactional tables, children before parents ----
log('followups',    (await sb.from('followups').delete().neq('id', ALL_UUID)).error);
log('visit_lines',  (await sb.from('visit_lines').delete().neq('sku_id', '~none~')).error);
log('visits',       (await sb.from('visits').delete().neq('id', ALL_UUID)).error);
log('collections',  (await sb.from('collections').delete().neq('id', ALL_UUID)).error);
log('invoice_lines',(await sb.from('invoice_lines').delete().neq('sku_id', '~none~')).error);
log('invoices',     (await sb.from('invoices').delete().neq('id', ALL_UUID)).error);
log('order_lines',  (await sb.from('order_lines').delete().neq('sku_id', '~none~')).error);
log('orders',       (await sb.from('orders').delete().neq('id', ALL_UUID)).error);
log('container_lines', (await sb.from('container_lines').delete().neq('sku_id', '~none~')).error);
log('containers',   (await sb.from('containers').delete().neq('id', ALL_UUID)).error);
log('routes',       (await sb.from('routes').delete().neq('weekday', -1)).error);
log('audit_log',    (await sb.from('audit_log').delete().neq('id', -1)).error);

// ---- reference data back to seed values ----
log('all pins cleared',
  (await sb.from('outlets').update({ lat: null, lng: null, pin_set_by: null, pin_set_at: null })
     .not('lat', 'is', null)).error);
log("Circle K payment_path → unknown",
  (await sb.from('outlets').update({ payment_path: 'unknown' }).eq('chain', 'Circle K')).error);
log('coordinator supervisor_id → null',
  (await sb.from('profiles').update({ supervisor_id: null }).eq('role', 'coordinator')).error);

console.log('\nVerify: every transactional table should now count 0, pins 0, storage 0.');
