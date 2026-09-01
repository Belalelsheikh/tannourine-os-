// ============================================================
// Tannourine — PRD §15.7 RLS negative tests  (automated)
//
// Run AFTER provisioning:
//   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/rls-negatives.mjs
// or simply, once .env exists:
//   node --env-file=.env scripts/rls-negatives.mjs
//
// Uses the ANON key and real logins only — never the service key. That is the
// point: these tests must exercise the same path a real staff session takes.
//
// Each test expects a REFUSAL. A test only passes when the database refuses the
// write; a test that finds no row to attack reports INCONCLUSIVE rather than
// passing, because "0 rows changed" is not evidence of a policy when there was
// nothing there to change.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const PASSWORD = process.env.TEMP_PASSWORD || 'Tan@2026x';

if (!url || !anon) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or use --env-file=.env)');
  process.exit(1);
}

const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const client = () => createClient(url, anon, opts);

async function signIn(email) {
  const sb = client();
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login failed for ${email}: ${error.message}`);
  return sb;
}

const results = [];
function record(n, as, attempt, verdict, detail) {
  results.push({ n, as, attempt, verdict, detail });
  const mark = verdict === 'PASS' ? 'PASS ' : verdict === 'FAIL' ? 'FAIL ' : 'INCON';
  console.log(`[${mark}] ${n}. as ${as}: ${attempt}${detail ? ` — ${detail}` : ''}`);
}

// A refusal shows up two ways in PostgREST:
//   - USING clause excludes the row   -> no error, 0 rows returned
//   - WITH CHECK rejects the new row  -> error 42501
// Both are a pass. Rows actually coming back is the failure.
function judgeWrite({ data, error }) {
  if (error) {
    const blocked = error.code === '42501' || /row-level security|permission denied/i.test(error.message);
    return blocked
      ? { verdict: 'PASS', detail: `refused (${error.code || 'rls'})` }
      : { verdict: 'INCONCLUSIVE', detail: `unexpected error: ${error.message}` };
  }
  if (Array.isArray(data) && data.length === 0) return { verdict: 'PASS', detail: 'refused (0 rows)' };
  return { verdict: 'FAIL', detail: `WRITE SUCCEEDED — ${JSON.stringify(data)?.slice(0, 120)}` };
}

// `visibleRows` is what a privileged session can see in the same relation. Without
// it, "0 rows" is ambiguous: an empty table returns 0 rows to everyone, and reading
// that as a policy win is a vacuous pass. Only an empty result from a relation that
// demonstrably HAS rows is evidence of RLS.
function judgeRead({ data, error }, visibleRows) {
  if (error) {
    const blocked = error.code === '42501' || /permission denied/i.test(error.message);
    return blocked ? { verdict: 'PASS', detail: 'refused' }
                   : { verdict: 'INCONCLUSIVE', detail: error.message };
  }
  if (!data || data.length === 0) {
    if (visibleRows === 0) {
      return { verdict: 'INCONCLUSIVE', detail: 'relation is empty — 0 rows proves nothing' };
    }
    return { verdict: 'PASS', detail: `0 rows (privileged session sees ${visibleRows})` };
  }
  return { verdict: 'FAIL', detail: `LEAKED ${data.length} row(s)` };
}

/** How many rows a privileged (mgmt) session can see, for the check above. */
async function visibleTo(sb, relation) {
  const { data, error } = await sb.from(relation).select('*').limit(50);
  if (error) return 0;
  return data?.length ?? 0;
}

// ------------------------------------------------------------
async function main() {
  console.log(`Target: ${url}\n`);

  // mgmt session is used ONLY to discover ids that genuinely exist, so that a
  // "0 rows" result from a coordinator means "refused", not "nothing there".
  const mgmt = await signIn('elhag@tannourine.local');
  const { data: invRows } = await mgmt.from('invoices').select('id,status,outlet_id').limit(1);
  const { data: colRows } = await mgmt.from('collections').select('id,status').limit(1);
  const { data: ordRows } = await mgmt.from('orders').select('id,status').eq('status', 'pending').limit(1);
  const invoiceId = invRows?.[0]?.id ?? null;
  const invoiceOutlet = invRows?.[0]?.outlet_id ?? null;
  const collectionId = colRows?.[0]?.id ?? null;
  const pendingOrderId = ordRows?.[0]?.id ?? null;

  console.log(`fixtures — invoice:${invoiceId ? 'yes' : 'NONE'} `
            + `collection:${collectionId ? 'yes' : 'NONE'} `
            + `pending order:${pendingOrderId ? 'yes' : 'NONE'}\n`);

  // ---------- coordinator (nada) ----------
  const nada = await signIn('nada@tannourine.local');

  if (invoiceId) {
    const r = judgeWrite(await nada.from('invoices')
      .update({ status: 'dispatched' }).eq('id', invoiceId).select());
    record(1, 'nada (coordinator)', 'update invoices → dispatched', r.verdict, r.detail);
  } else record(1, 'nada (coordinator)', 'update invoices → dispatched', 'INCONCLUSIVE', 'no invoice exists yet');

  if (collectionId) {
    const r = judgeWrite(await nada.from('collections')
      .update({ status: 'cleared' }).eq('id', collectionId).select());
    record(2, 'nada (coordinator)', 'update collections → cleared', r.verdict, r.detail);
  } else record(2, 'nada (coordinator)', 'update collections → cleared', 'INCONCLUSIVE', 'no collection exists yet');

  {
    const seen = await visibleTo(mgmt, 'audit_log');
    const r = judgeRead(await nada.from('audit_log').select('*').limit(5), seen);
    record(3, 'nada (coordinator)', 'select audit_log', r.verdict, r.detail);
  }

  // ---------- invoice role (amr) ----------
  const amr = await signIn('amr@tannourine.local');

  // type='transfer' avoids the cheque_date check constraint, so a refusal here is
  // unambiguously RLS rather than a column check firing first.
  if (invoiceId) {
    const r = judgeWrite(await amr.from('collections').insert({
      invoice_id: invoiceId, outlet_id: invoiceOutlet, type: 'transfer',
      amount: 1, status: 'received',
    }).select());
    record(4, 'amr (invoice)', 'insert into collections', r.verdict, r.detail);
  } else record(4, 'amr (invoice)', 'insert into collections', 'INCONCLUSIVE', 'needs an invoice to reference');

  if (invoiceId) {
    const r = judgeWrite(await amr.from('invoices')
      .update({ status: 'void' }).eq('id', invoiceId).select());
    record(5, 'amr (invoice)', 'update invoices → void (WITH CHECK)', r.verdict, r.detail);
  } else record(5, 'amr (invoice)', 'update invoices → void', 'INCONCLUSIVE', 'no invoice exists yet');

  if (pendingOrderId) {
    const r = judgeWrite(await amr.from('orders')
      .update({ status: 'invoiced' }).eq('id', pendingOrderId).select());
    record(6, 'amr (invoice)', 'pending order → invoiced (USING needs approved)', r.verdict, r.detail);
  } else record(6, 'amr (invoice)', 'pending order → invoiced', 'INCONCLUSIVE', 'no pending order exists yet');

  // ---------- anonymous ----------
  const anonSb = client();
  {
    const seen = await visibleTo(mgmt, 'invoice_open');
    const r = judgeRead(await anonSb.from('invoice_open').select('*').limit(5), seen);
    record(7, 'anonymous', 'select invoice_open (view)', r.verdict, r.detail);
  }
  {
    const seen = await visibleTo(mgmt, 'outlets');
    const r = judgeRead(await anonSb.from('outlets').select('*').limit(5), seen);
    record(8, 'anonymous', 'select outlets', r.verdict, r.detail);
  }

  // ---------- summary ----------
  const pass = results.filter(r => r.verdict === 'PASS').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const inc  = results.filter(r => r.verdict === 'INCONCLUSIVE').length;
  console.log(`\n${pass} PASS · ${fail} FAIL · ${inc} INCONCLUSIVE  (of ${results.length})`);
  if (inc) console.log('INCONCLUSIVE items need fixture rows — walk §15.4/§15.5 first, then re-run.');
  if (fail) { console.log('\nFAIL means a role wrote something it must not. Do not deploy.'); process.exit(2); }
}

main().catch(e => { console.error('\nharness error:', e.message); process.exit(1); });
