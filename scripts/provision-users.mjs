// Run locally: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/provision-users.mjs
// Idempotent: skips existing emails. Sets temp password for all; force change on first login is out of scope v1.
// Two passes: (1) create auth users + upsert profiles, (2) link profiles.supervisor_id from supervisor_email.
import { createClient } from '@supabase/supabase-js';
import users from './users.json' with { type: 'json' };

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if(!url || !key){ console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY'); process.exit(1); }
const TEMP_PASSWORD = process.env.TEMP_PASSWORD || 'Tan@2026x';
const sb = createClient(url, key, { auth: { autoRefreshToken:false, persistSession:false } });

const idByEmail = new Map();

// ---------- pass 1: users + profiles ----------
for (const u of users) {
  const { data: created, error } = await sb.auth.admin.createUser({
    email: u.email, password: TEMP_PASSWORD, email_confirm: true,
    user_metadata: { full_name: u.name }
  });
  let uid = created?.user?.id;
  if (error) {
    if (String(error.message).toLowerCase().includes('already')) {
      const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
      uid = data.users.find(x => x.email === u.email)?.id;
      console.log('exists:', u.email);
    } else { console.error('FAIL', u.email, error.message); continue; }
  } else console.log('created:', u.email);
  if (uid) {
    idByEmail.set(u.email, uid);
    const { error: pe } = await sb.from('profiles').upsert({
      id: uid, full_name: u.name, role: u.role, scope: u.scope, active: true
    });
    if (pe) console.error('profile FAIL', u.email, pe.message);
  }
}

// ---------- pass 2: supervisor links ----------
let linked = 0, pending = 0;
for (const u of users) {
  if (!u.supervisor_email) { if (u.role === 'coordinator') pending++; continue; }
  const uid = idByEmail.get(u.email), sid = idByEmail.get(u.supervisor_email);
  if (!uid)  { console.error('link FAIL', u.email, 'user not provisioned'); continue; }
  if (!sid)  { console.error('link FAIL', u.email, 'supervisor not found:', u.supervisor_email); continue; }
  const { error: le } = await sb.from('profiles').update({ supervisor_id: sid }).eq('id', uid);
  if (le) console.error('link FAIL', u.email, le.message);
  else { console.log('linked:', u.email, '->', u.supervisor_email); linked++; }
}

console.log(`Done. Temp password: ${TEMP_PASSWORD}`);
console.log(`Supervisor links: ${linked} set, ${pending} coordinator(s) with null supervisor_email — assign those in-app from الفريق (mgmt).`);
