// Companion to acceptance-run.mjs: removes every row that run created and
// restores outlets/profiles to seed values. Service key (bypasses RLS by design).
//   NODE_USE_ENV_PROXY=1 SB_URL=... SB_SERVICE=... node scripts/acceptance-teardown.mjs
// Verify afterwards that visits/orders/invoices/collections/routes are all 0.

import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SB_URL, process.env.SB_SERVICE, {auth:{persistSession:false}});
const log=(n,e)=>console.log(e?`  x ${n}: ${e.message}`:`  ok ${n}`);

// test visits = any visit created today by the acceptance run at outlets 1/180
const { data: visits } = await sb.from('visits').select('id,photo_path')
  .in('outlet_id',[1,180]);
const vids = (visits??[]).map(v=>v.id);

if (vids.length) {
  log('followups', (await sb.from('followups').delete().in('visit_id',vids)).error);
  log('visit_lines',(await sb.from('visit_lines').delete().in('visit_id',vids)).error);
  const paths = vids.map(v=>`${v}.jpg`);
  const { error: se } = await sb.storage.from('visit-photos').remove(paths);
  log(`visit-photos (${paths.length})`, se);
  log('visits',      (await sb.from('visits').delete().in('id',vids)).error);
}

// invoices/collections/orders from both marker sets
const { data: ords } = await sb.from('orders').select('id')
  .in('po_number',['ACCEPTANCE-RUN','ACCEPTANCE-FIXTURE']);
const oids=(ords??[]).map(o=>o.id);
const { data: invs } = await sb.from('invoices').select('id').in('order_id', oids.length?oids:['00000000-0000-0000-0000-000000000000']);
const iids=(invs??[]).map(i=>i.id);
if (iids.length){
  log('collections',(await sb.from('collections').delete().in('invoice_id',iids)).error);
  const { error: pe } = await sb.storage.from('pods').remove(iids.map(i=>`${i}.jpg`));
  log('pods', pe);
  log('invoices',   (await sb.from('invoices').delete().in('id',iids)).error);
}
if (oids.length){
  log('order_lines',(await sb.from('order_lines').delete().in('order_id',oids)).error);
  log('orders',     (await sb.from('orders').delete().in('id',oids)).error);
}

// reference data restored to seed values
log('outlet 1 payment_path → unknown',
  (await sb.from('outlets').update({payment_path:'unknown'}).eq('id',1)).error);
log('outlet 180 pin cleared',
  (await sb.from('outlets').update({lat:null,lng:null,pin_set_by:null,pin_set_at:null}).eq('id',180)).error);
log('nada supervisor_id → null',
  (await sb.from('profiles').update({supervisor_id:null}).eq('role','coordinator')).error);
log('routes cleared',    (await sb.from('routes').delete().neq('weekday',-1)).error);
log('audit_log probe',   (await sb.from('audit_log').delete().eq('entity_id','ACCEPTANCE-FIXTURE')).error);
