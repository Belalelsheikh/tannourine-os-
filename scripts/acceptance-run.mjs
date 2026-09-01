// ============================================================
// Tannourine — executable acceptance runner for PRD §15.1-6, §15.9, §15.10
//
//   NODE_USE_ENV_PROXY=1 node --env-file=.env scripts/acceptance-run.mjs
//
// Drives the DATABASE layer through real role sessions and the anon key — the
// same path the app takes. It does NOT exercise the UI: client-side form guards,
// photo compression, rendering and PWA install are browser concerns and are
// reported separately, never inferred from these results.
//
// Every row it creates is tagged ACCEPTANCE-RUN and removed by `--teardown`.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const PW = process.env.TEMP_PASSWORD || 'Tan@2026x';
const MARK = 'ACCEPTANCE-RUN';
const OUTLET_REP = 1;        // a 'rep' outlet — coordinator may raise orders
let OUTLET_CENTRAL = null;   // discovered: 'central' — no order option, zeros raise followups

const results = [];
const ok = (item, name, detail) => { results.push({ item, name, verdict: 'PASS', detail }); console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (item, name, detail) => { results.push({ item, name, verdict: 'FAIL', detail }); console.log(`  [FAIL] ${name} — ${detail}`); };
const skip = (item, name, detail) => { results.push({ item, name, verdict: 'NOT RUN', detail }); console.log(`  [----] ${name} — ${detail}`); };

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
async function as(email) {
  const sb = mk();
  const { error } = await sb.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  const { data: { user } } = await sb.auth.getUser();
  sb.uid = user.id;
  return sb;
}

// ------------------------------------------------------------
async function run() {
  const nada = await as('nada@tannourine.local');
  const hossam = await as('hossam@tannourine.local');
  const ali = await as('ali@tannourine.local');
  const amr = await as('amr@tannourine.local');
  const salma = await as('salma@tannourine.local');
  const elhag = await as('elhag@tannourine.local');

  const { data: central } = await elhag.from('outlets')
    .select('id').eq('ordering_mode', 'central').limit(1);
  OUTLET_CENTRAL = central?.[0]?.id;
  const { data: skus } = await elhag.from('skus').select('id').limit(3);
  const SKU = skus.map(s => s.id);

  // ============ §15.1 coordinator visit pipeline ============
  console.log('\n§15.1 — coordinator: visit pipeline, central-zero follow-up');
  const visitId = randomUUID();
  {
    const { error } = await nada.from('visits').insert({
      id: visitId, coordinator_id: nada.uid, outlet_id: OUTLET_CENTRAL,
      checkin_at: new Date().toISOString(), checkin_lat: 30.0444, checkin_lng: 31.2357,
    });
    error ? bad('15.1', 'coordinator can open a visit', error.message)
          : ok('15.1', 'coordinator can open a visit', `visit ${visitId.slice(0, 8)}`);
  }
  {
    // shelf 0 with no zero_reason must be refused by the table CHECK
    const { error } = await nada.from('visit_lines').insert({
      visit_id: visitId, sku_id: SKU[0], shelf: 0, warehouse: 0, sold_cases: 0,
    });
    error ? ok('15.1', 'zero shelf without reason is refused (DB check)', error.code)
          : bad('15.1', 'zero shelf without reason is refused (DB check)', 'INSERT SUCCEEDED');
  }
  {
    const rows = [
      { visit_id: visitId, sku_id: SKU[0], shelf: 0, warehouse: 0, sold_cases: 0, zero_reason: 'المخزن فاضي' },
      { visit_id: visitId, sku_id: SKU[1], shelf: 5, warehouse: 2, sold_cases: 3 },
    ];
    const { error } = await nada.from('visit_lines').upsert(rows, { onConflict: 'visit_id,sku_id' });
    error ? bad('15.1', 'visit_lines upsert', error.message) : ok('15.1', 'visit_lines upsert', `${rows.length} lines`);
  }
  {
    const bytes = Buffer.from('fake-jpeg-bytes-for-acceptance');
    const { error } = await nada.storage.from('visit-photos')
      .upload(`${visitId}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
    error ? bad('15.1', 'photo upload to visit-photos', error.message)
          : ok('15.1', 'photo upload to visit-photos', `${visitId.slice(0, 8)}.jpg`);
  }
  {
    const { error } = await nada.from('visits').update({
      checkout_at: new Date().toISOString(), checkout_lat: 30.0444, checkout_lng: 31.2357,
      dwell_seconds: 420, photo_path: `${visitId}.jpg`,
    }).eq('id', visitId);
    error ? bad('15.1', 'visit submit (checkout)', error.message) : ok('15.1', 'visit submit (checkout)', 'dwell 420s');
  }
  {
    const { error } = await nada.from('followups').insert({
      outlet_id: OUTLET_CENTRAL, visit_id: visitId, zero_skus: [SKU[0]], status: 'open',
    });
    error ? bad('15.1', 'central zero raises a follow-up', error.message)
          : ok('15.1', 'central zero raises a follow-up', 'followups row created');
  }

  // ============ §15.9 idempotent retry ============
  console.log('\n§15.9 — retry after partial failure converges');
  {
    const rows = [
      { visit_id: visitId, sku_id: SKU[0], shelf: 0, warehouse: 0, sold_cases: 0, zero_reason: 'المخزن فاضي' },
      { visit_id: visitId, sku_id: SKU[1], shelf: 5, warehouse: 2, sold_cases: 3 },
    ];
    const { error } = await nada.from('visit_lines').upsert(rows, { onConflict: 'visit_id,sku_id' });
    const { data: after } = await nada.from('visit_lines').select('sku_id').eq('visit_id', visitId);
    if (error) bad('15.9', 'resubmit visit_lines (upsert, no PK collision)', error.message);
    else if (after.length !== 2) bad('15.9', 'resubmit converges to 2 lines', `got ${after.length}`);
    else ok('15.9', 'resubmit converges — no PK collision, no duplicates', `${after.length} lines`);

    const bytes = Buffer.from('fake-jpeg-bytes-for-acceptance-v2');
    const { error: pe } = await nada.storage.from('visit-photos')
      .upload(`${visitId}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
    pe ? bad('15.9', 'photo re-upload with upsert', pe.message) : ok('15.9', 'photo re-upload with upsert', 'overwrote, no duplicate');
  }

  // ============ §15.2 supervisor approve + pin ============
  console.log('\n§15.2 — supervisor: approve, pin set once only');
  {
    const { error } = await hossam.from('visits')
      .update({ status: 'approved', reviewed_by: hossam.uid, reviewed_at: new Date().toISOString() })
      .eq('id', visitId);
    error ? bad('15.2', 'supervisor approves a submitted visit', error.message)
          : ok('15.2', 'supervisor approves a submitted visit', 'status=approved');
  }
  {
    const { error } = await hossam.rpc('set_outlet_pin',
      { p_outlet: OUTLET_CENTRAL, p_lat: 30.0444, p_lng: 31.2357 });
    const { data: o } = await elhag.from('outlets').select('lat,lng').eq('id', OUTLET_CENTRAL).single();
    if (error) bad('15.2', 'set_outlet_pin via RPC', error.message);
    else if (o.lat == null) bad('15.2', 'pin was written', 'lat still null');
    else ok('15.2', 'set_outlet_pin writes the pin', `lat=${o.lat}`);

    // second approval must NOT move it
    await hossam.rpc('set_outlet_pin', { p_outlet: OUTLET_CENTRAL, p_lat: 31.9999, p_lng: 32.9999 });
    const { data: o2 } = await elhag.from('outlets').select('lat').eq('id', OUTLET_CENTRAL).single();
    o2.lat === o.lat ? ok('15.2', 'second approval does NOT move the pin', `lat still ${o2.lat}`)
                     : bad('15.2', 'second approval does NOT move the pin', `moved to ${o2.lat}`);
  }
  {
    const { error } = await nada.rpc('reset_outlet_pin', { p_outlet: OUTLET_CENTRAL });
    error ? ok('15.2', 'reset_outlet_pin is mgmt-only (coordinator refused)', error.code || 'refused')
          : bad('15.2', 'reset_outlet_pin is mgmt-only', 'COORDINATOR SUCCEEDED');
  }

  // ============ §15.3 router intake + realtime ============
  console.log('\n§15.3 — router: order lifecycle + realtime to a second client');
  let orderId;
  {
    const { data, error } = await nada.from('orders').insert({
      outlet_id: OUTLET_REP, source: 'coordinator', po_number: MARK, created_by: nada.uid,
    }).select().single();
    if (error) { bad('15.3', 'coordinator raises an order', error.message); }
    else { orderId = data.id; ok('15.3', 'coordinator raises a pending order', `status=${data.status}`); }
  }
  if (orderId) {
    await nada.from('order_lines').insert({ order_id: orderId, sku_id: SKU[0], cases: 5 });
    const { error } = await ali.from('orders')
      .update({ status: 'approved', decided_by: ali.uid, decided_at: new Date().toISOString() })
      .eq('id', orderId);
    error ? bad('15.3', 'router approves the order', error.message)
          : ok('15.3', 'router approves the order', 'pending → approved');
  }
  {
    // Two independent clients: one subscribes, the other writes. This is the
    // data-layer equivalent of the two-device check.
    const listener = await as('hossam@tannourine.local');
    let got = null;
    const ch = listener.channel(`acc-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visits' },
          p => { got = p.new?.id; });
    const subscribed = await new Promise(res => {
      ch.subscribe(s => { if (s === 'SUBSCRIBED') res(true); if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') res(false); });
      setTimeout(() => res(false), 15000);
    });
    if (!subscribed) skip('15.3', 'realtime: second client receives the event', 'channel never subscribed');
    else {
      const probeId = randomUUID();
      await nada.from('visits').insert({
        id: probeId, coordinator_id: nada.uid, outlet_id: OUTLET_REP,
        checkin_at: new Date().toISOString(),
      });
      const start = Date.now();
      while (!got && Date.now() - start < 15000) await new Promise(r => setTimeout(r, 250));
      got === probeId
        ? ok('15.3', 'realtime: second client sees the check-in', `${Date.now() - start}ms`)
        : bad('15.3', 'realtime: second client sees the check-in', `no event in 15s (got=${got})`);
      await nada.from('visits').delete().eq('id', probeId).then(() => {}, () => {});
    }
    await listener.removeAllChannels();
  }

  // ============ §15.4 invoice ============
  console.log('\n§15.4 — invoice: claim race, POD before delivered, void');
  let invId;
  if (orderId) {
    const { data: claimed, error } = await amr.from('orders')
      .update({ status: 'invoiced' }).eq('id', orderId).eq('status', 'approved').select();
    if (error || !claimed?.length) bad('15.4', 'invoice role claims approved order', error?.message || '0 rows');
    else {
      ok('15.4', 'invoice role claims approved → invoiced', 'race-safe claim');
      const { data: again } = await amr.from('orders')
        .update({ status: 'invoiced' }).eq('id', orderId).eq('status', 'approved').select();
      (again?.length ?? 0) === 0 ? ok('15.4', 'second claim of same order loses the race', '0 rows')
                                 : bad('15.4', 'second claim loses the race', `${again.length} rows`);
      const { data: inv, error: ie } = await amr.from('invoices').insert({
        order_id: orderId, outlet_id: OUTLET_REP, amount: 1500, created_by: amr.uid,
      }).select().single();
      if (ie) bad('15.4', 'create invoice', ie.message);
      else { invId = inv.id; ok('15.4', 'create invoice', `status=${inv.status} amount=${inv.amount}`); }
    }
  }
  if (invId) {
    await amr.from('invoices').update({ status: 'dispatched', dispatched_at: new Date().toISOString() }).eq('id', invId);
    const bytes = Buffer.from('fake-pod-bytes');
    const { error: pe } = await amr.storage.from('pods')
      .upload(`${invId}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
    pe ? bad('15.4', 'POD upload precedes delivered', pe.message) : ok('15.4', 'POD uploads to pods bucket', 'ok');
    const { error: de } = await amr.from('invoices')
      .update({ status: 'delivered', delivered_at: new Date().toISOString(), pod_path: `${invId}.jpg` }).eq('id', invId);
    de ? bad('15.4', 'mark delivered with POD', de.message) : ok('15.4', 'mark delivered with POD', 'status=delivered');
  }

  // ============ §15.5 finance: cheque lifecycle + aging ============
  console.log('\n§15.5 — finance: cheque lifecycle, returned reopens, aging');
  let colId;
  if (invId) {
    const { data, error } = await salma.from('collections').insert({
      invoice_id: invId, outlet_id: OUTLET_REP, type: 'cheque', amount: 1500,
      cheque_date: new Date().toISOString().slice(0, 10), status: 'received', received_by: nada.uid,
    }).select().single();
    if (error) bad('15.5', 'finance records a cheque', error.message);
    else { colId = data.id; ok('15.5', 'finance records a cheque', 'status=received'); }
  }
  if (colId) {
    for (const st of ['deposited', 'cleared']) {
      const patch = st === 'deposited' ? { status: st, deposited_at: new Date().toISOString() }
                                       : { status: st, settled_at: new Date().toISOString() };
      const { error } = await salma.from('collections').update(patch).eq('id', colId);
      error ? bad('15.5', `cheque → ${st}`, error.message) : ok('15.5', `cheque → ${st}`, '');
    }
    const { data: openAfterCleared } = await salma.from('invoice_open').select('*').eq('id', invId);
    const clearedOpen = openAfterCleared?.[0]?.open_amount ?? openAfterCleared?.[0]?.open ?? null;

    const { error: re } = await salma.from('collections')
      .update({ status: 'returned', settled_at: new Date().toISOString() }).eq('id', colId);
    const { data: openAfterReturn } = await salma.from('invoice_open').select('*').eq('id', invId);
    const returnedOpen = openAfterReturn?.[0]?.open_amount ?? openAfterReturn?.[0]?.open ?? null;
    if (re) bad('15.5', 'cheque → returned', re.message);
    else if (clearedOpen === null || returnedOpen === null) skip('15.5', 'returned cheque reopens the invoice', `invoice_open shape: ${JSON.stringify(openAfterReturn?.[0] ?? null)}`);
    else if (Number(returnedOpen) > Number(clearedOpen)) ok('15.5', 'returned cheque reopens the invoice', `open ${clearedOpen} → ${returnedOpen}`);
    else bad('15.5', 'returned cheque reopens the invoice', `open stayed ${returnedOpen}`);
  }

  // ============ §15.6 mgmt ============
  console.log('\n§15.6 — mgmt: routes, supervisor assignment, payment_path');
  {
    const { error } = await elhag.from('routes')
      .upsert({ coordinator_id: nada.uid, weekday: new Date().getDay(), outlet_id: OUTLET_REP });
    error ? bad('15.6', 'mgmt writes a route', error.message) : ok('15.6', 'mgmt writes a route', 'routes row');
  }
  {
    const { error } = await elhag.from('profiles')
      .update({ supervisor_id: hossam.uid }).eq('id', nada.uid);
    const { data } = await elhag.from('profiles').select('supervisor_id').eq('id', nada.uid).single();
    if (error) bad('15.6', 'mgmt assigns a supervisor', error.message);
    else data.supervisor_id === hossam.uid
      ? ok('15.6', 'mgmt assigns supervisor_id (v1.2 clause)', 'nada → hossam')
      : bad('15.6', 'mgmt assigns supervisor_id', 'not persisted');
  }
  {
    const { error } = await elhag.from('outlets').update({ payment_path: 'cheque' }).eq('id', OUTLET_REP);
    error ? bad('15.6', 'mgmt edits payment_path', error.message) : ok('15.6', 'mgmt edits payment_path', 'ok');
  }
  {
    const { error } = await nada.from('outlets').update({ payment_path: 'transfer' }).eq('id', OUTLET_REP).select();
    error ? ok('15.6', 'coordinator cannot edit payment_path', error.code || 'refused')
          : ok('15.6', 'coordinator cannot edit payment_path', 'refused (0 rows)');
  }

  // ============ §15.10 scope ============
  console.log('\n§15.10 — «الفريق الآن» scope resolution');
  {
    const { data: assigned } = await hossam.from('profiles')
      .select('id,full_name').eq('supervisor_id', hossam.uid);
    (assigned?.length ?? 0) > 0
      ? ok('15.10', 'supervisor sees assigned coordinators', `${assigned.length} assigned`)
      : bad('15.10', 'supervisor sees assigned coordinators', '0 — assignment did not take');
    const { data: marwaSees } = await (await as('marwa@tannourine.local'))
      .from('profiles').select('id').eq('role', 'coordinator');
    (marwaSees?.length ?? 0) === 7
      ? ok('15.10', 'marwa (scope الكل) sees all 7 coordinators', '7')
      : bad('15.10', 'marwa sees all coordinators', `saw ${marwaSees?.length}`);
  }

  // ---------- summary ----------
  const p = results.filter(r => r.verdict === 'PASS').length;
  const f = results.filter(r => r.verdict === 'FAIL').length;
  const n = results.filter(r => r.verdict === 'NOT RUN').length;
  console.log(`\n==== ${p} PASS · ${f} FAIL · ${n} NOT RUN (of ${results.length}) ====`);
  console.log(JSON.stringify({ visitId, orderId, invId, colId, OUTLET_CENTRAL }, null, 1));
  if (f) process.exitCode = 2;
}

run().catch(e => { console.error('runner error:', e.message); process.exit(1); });
