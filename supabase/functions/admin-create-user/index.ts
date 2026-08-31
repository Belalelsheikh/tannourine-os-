// Edge Function: admin-create-user
// Creates an auth user + profile. Callable only by a caller whose profile.role='mgmt'
// — the role is re-checked server-side, never trusted from the request body (PRD §3).
//
// Deploy:  supabase functions deploy admin-create-user
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
//          by the platform; no manual secret is required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DOMAIN = '@tannourine.local';
const ROLES = ['mgmt', 'router', 'invoice', 'finance', 'supervisor', 'coordinator'];
const SCOPES = ['القاهرة', 'الإسكندرية', 'الكل'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'لازم تسجيل دخول' }, 401);

  // 1) who is calling?
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'جلسة غير صالحة' }, 401);

  // 2) are they mgmt? (service client so RLS can't be gamed)
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: me, error: meErr } = await admin
    .from('profiles').select('role, active').eq('id', userData.user.id).maybeSingle();
  if (meErr) return json({ error: meErr.message }, 500);
  if (!me || me.role !== 'mgmt' || !me.active) {
    return json({ error: 'الإدارة بس اللي تقدر تضيف مستخدمين' }, 403);
  }

  // 3) validate input
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'body غير صالح' }, 400); }

  const fullName = String(body.full_name ?? '').trim();
  const handle = String(body.handle ?? '').trim().toLowerCase();
  const role = String(body.role ?? '');
  const scope = String(body.scope ?? '');
  const password = String(body.password ?? '');
  const supervisorId = body.supervisor_id ? String(body.supervisor_id) : null;

  if (!fullName) return json({ error: 'الاسم مطلوب' }, 400);
  if (!/^[a-z0-9._-]{2,}$/.test(handle)) return json({ error: 'اسم المستخدم غير صالح' }, 400);
  if (!ROLES.includes(role)) return json({ error: 'الدور غير صالح' }, 400);
  if (!SCOPES.includes(scope)) return json({ error: 'المحافظة غير صالحة' }, 400);
  if (password.length < 8) return json({ error: 'الرقم السري ٨ حروف على الأقل' }, 400);

  const email = handle.includes('@') ? handle : handle + DOMAIN;

  // 4) create the auth user
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'فشل إنشاء الحساب';
    return json({ error: /already/i.test(msg) ? 'اسم المستخدم موجود بالفعل' : msg }, 400);
  }

  // 5) profile — roll the auth user back if this fails, so no orphan login survives
  const { error: profErr } = await admin.from('profiles').insert({
    id: created.user.id,
    full_name: fullName,
    role,
    scope,
    supervisor_id: supervisorId,
    active: true,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profErr.message }, 500);
  }

  return json({ ok: true, id: created.user.id, email });
});
