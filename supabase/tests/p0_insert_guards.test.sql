-- RLS negative tests for Batch 1 (20261019120000_p0_insert_guards.sql and
-- 20261019120100_p0_storage_upd_owner.sql).
--
-- BRANCH DB ONLY. Never run this on the live project (tlrhztjnzptuvkrkrjod). It writes
-- fixtures, and although everything is inside one transaction that ends in ROLLBACK, it
-- has no business touching production.
--
-- Run as postgres on a branch where schema.sql, the existing migrations and both Batch 1
-- migrations are applied: `psql "$BRANCH_DB_URL" -f supabase/tests/p0_insert_guards.test.sql`
-- or paste into the branch's SQL editor.
--
-- Reading the result: every check raises on failure, which aborts the run with
-- "FAIL <label>: …". A run that completes ("Success. No rows returned" in the SQL editor,
-- or the final NOTICE in psql) means every check passed.
--
-- Each forged insert is run as a real authenticated user (`set local role authenticated`
-- plus request.jwt.claims), so it goes through RLS and triggers exactly as a PostgREST
-- call from the app would. Positive controls prove the app's normal writes still land.

begin;

-- ---------- helpers (live only inside this transaction) ----------
create schema p0_test;
grant usage on schema p0_test to authenticated;

-- PASS when the statement is rejected by RLS (42501) or by a guard trigger (23514) with a
-- message containing `expect`. Anything else — accepted, or rejected for another reason
-- (FK, not-null) — is a FAIL, so a broken fixture can never pass as a working guard.
create function p0_test.expect_denied(label text, stmt text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege or check_violation then
    if position(expect in sqlerrm) = 0 then
      raise exception 'FAIL %: rejected for the wrong reason: % (%)', label, sqlerrm, sqlstate;
    end if;
    raise notice 'PASS  % → %', label, sqlerrm;
    return;
  when others then
    raise exception 'FAIL %: rejected for the wrong reason: % (%)', label, sqlerrm, sqlstate;
  end;
  raise exception 'FAIL %: forged insert was accepted', label;
end $$;

create function p0_test.expect_ok(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  % → accepted', label;
exception when others then
  raise exception 'FAIL %: legitimate write was rejected: % (%)', label, sqlerrm, sqlstate;
end $$;

create function p0_test.act_as(uid uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

grant execute on all functions in schema p0_test to authenticated;

-- ---------- fixtures (as postgres) ----------
-- c1, c2: coordinators · rt: router · fn: finance
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-0000000000c1', 'p0-c1@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000c2', 'p0-c2@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000a1', 'p0-rt@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000f1', 'p0-fn@test.invalid', 'authenticated', 'authenticated');

insert into profiles (id, full_name, role) values
  ('00000000-0000-4000-a000-0000000000c1', 'p0 منسق ١', 'coordinator'),
  ('00000000-0000-4000-a000-0000000000c2', 'p0 منسق ٢', 'coordinator'),
  ('00000000-0000-4000-a000-0000000000a1', 'p0 أوردرات', 'router'),
  ('00000000-0000-4000-a000-0000000000f1', 'p0 مالية', 'finance')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into outlets (id, chain, gov, name, ordering_mode, payment_path) values
  (990001, 'p0', 'القاهرة', 'p0 فرع ١', 'central', 'cheque'),
  (990002, 'p0', 'القاهرة', 'p0 فرع ٢', 'central', 'cheque');

insert into invoices (id, outlet_id, amount, status, created_by) values
  ('00000000-0000-4000-b000-00000000000d', 990001, 1000, 'delivered', '00000000-0000-4000-a000-0000000000f1'),
  ('00000000-0000-4000-b000-00000000000c', 990001,  500, 'created',   '00000000-0000-4000-a000-0000000000f1');

-- Submitted but unreviewed, as they are when VisitForm raises the follow-up.
insert into visits (id, coordinator_id, outlet_id, checkin_at, checkout_at) values
  ('00000000-0000-4000-c000-0000000000c1', '00000000-0000-4000-a000-0000000000c1', 990001,
   now() - interval '20 minutes', now()),
  ('00000000-0000-4000-c000-0000000000c2', '00000000-0000-4000-a000-0000000000c2', 990001,
   now() - interval '20 minutes', now());

insert into storage.buckets (id, name, public) values
  ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('visit-photos', 'p0test/c1.jpg',
   '00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-0000000000c1');

-- ============================================================
-- coordinator c1
-- ============================================================
set local role authenticated;
select p0_test.act_as('00000000-0000-4000-a000-0000000000c1');

-- ---------- orders (F02) ----------
select p0_test.expect_ok('orders: coordinator pending order',
  $q$insert into orders (outlet_id, source, created_by)
     values (990001, 'coordinator', '00000000-0000-4000-a000-0000000000c1')$q$);
select p0_test.expect_denied('orders: coordinator forges status=approved',
  $q$insert into orders (outlet_id, source, created_by, status)
     values (990001, 'coordinator', '00000000-0000-4000-a000-0000000000c1', 'approved')$q$,
  'row-level security');
select p0_test.expect_denied('orders: coordinator forges status=invoiced',
  $q$insert into orders (outlet_id, source, created_by, status)
     values (990001, 'coordinator', '00000000-0000-4000-a000-0000000000c1', 'invoiced')$q$,
  'row-level security');
select p0_test.expect_denied('orders: coordinator forges decided_by/decided_at',
  $q$insert into orders (outlet_id, source, created_by, decided_by, decided_at)
     values (990001, 'coordinator', '00000000-0000-4000-a000-0000000000c1',
             '00000000-0000-4000-a000-0000000000a1', now())$q$,
  'row-level security');

-- ---------- collections (F01) ----------
select p0_test.expect_denied('collections: coordinator forges status=cleared',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by, status)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'cheque', 100, current_date,
             '00000000-0000-4000-a000-0000000000c1', 'cleared')$q$,
  'row-level security');
select p0_test.expect_denied('collections: coordinator forges status=deposited',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by, status, deposited_at)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'cheque', 100, current_date,
             '00000000-0000-4000-a000-0000000000c1', 'deposited', now())$q$,
  'row-level security');
select p0_test.expect_denied('collections: coordinator forges settled_at on a received cheque',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by, settled_at)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'cheque', 100, current_date,
             '00000000-0000-4000-a000-0000000000c1', now())$q$,
  'row-level security');
select p0_test.expect_denied('collections: cheque on an undelivered invoice',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by)
     values ('00000000-0000-4000-b000-00000000000c', 990001, 'cheque', 100, current_date,
             '00000000-0000-4000-a000-0000000000c1')$q$,
  'ما اتسلمتش');
select p0_test.expect_denied('collections: cheque for another outlet than the invoice',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by)
     values ('00000000-0000-4000-b000-00000000000d', 990002, 'cheque', 100, current_date,
             '00000000-0000-4000-a000-0000000000c1')$q$,
  'فرع الفاتورة');
select p0_test.expect_denied('collections: cheque above the invoice amount',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'cheque', 1500, current_date,
             '00000000-0000-4000-a000-0000000000c1')$q$,
  'أكبر من المفتوح');
select p0_test.expect_ok('collections: coordinator received cheque 400 of 1000',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'cheque', 400, current_date,
             '00000000-0000-4000-a000-0000000000c1')$q$);
select p0_test.expect_denied('collections: second cheque 700 exceeds the 600 still open',
  $q$insert into collections (invoice_id, outlet_id, type, amount, cheque_date, received_by)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'cheque', 700, current_date,
             '00000000-0000-4000-a000-0000000000c1')$q$,
  'أكبر من المفتوح');

-- ---------- visits (F11, insert half) ----------
select p0_test.expect_ok('visits: coordinator check-in',
  $q$insert into visits (coordinator_id, outlet_id, checkin_at, checkin_lat, checkin_lng)
     values ('00000000-0000-4000-a000-0000000000c1', 990002, now(), 30.0, 31.0)$q$);
select p0_test.expect_denied('visits: coordinator forges status=approved',
  $q$insert into visits (coordinator_id, outlet_id, checkin_at, status)
     values ('00000000-0000-4000-a000-0000000000c1', 990002, now(), 'approved')$q$,
  'row-level security');
select p0_test.expect_denied('visits: coordinator forges reviewed_by/reviewed_at',
  $q$insert into visits (coordinator_id, outlet_id, checkin_at, reviewed_by, reviewed_at)
     values ('00000000-0000-4000-a000-0000000000c1', 990002, now(),
             '00000000-0000-4000-a000-0000000000c1', now())$q$,
  'row-level security');
select p0_test.expect_denied('visits: coordinator inserts an already-checked-out visit',
  $q$insert into visits (coordinator_id, outlet_id, checkin_at, checkout_at, dwell_seconds)
     values ('00000000-0000-4000-a000-0000000000c1', 990002, now() - interval '20 minutes', now(), 1200)$q$,
  'row-level security');
select p0_test.expect_denied('visits: coordinator presets flags',
  $q$insert into visits (coordinator_id, outlet_id, checkin_at, flags)
     values ('00000000-0000-4000-a000-0000000000c1', 990002, now(), '{short_visit}')$q$,
  'row-level security');

-- ---------- followups (F37) ----------
select p0_test.expect_ok('followups: open follow-up from own visit',
  $q$insert into followups (outlet_id, visit_id, zero_skus)
     values (990001, '00000000-0000-4000-c000-0000000000c1', '{PET-1}')$q$);
select p0_test.expect_denied('followups: forged status=done',
  $q$insert into followups (outlet_id, visit_id, zero_skus, status, done_by, done_at)
     values (990001, '00000000-0000-4000-c000-0000000000c1', '{PET-1}', 'done',
             '00000000-0000-4000-a000-0000000000c1', now())$q$,
  'row-level security');
select p0_test.expect_denied('followups: from another coordinator''s visit',
  $q$insert into followups (outlet_id, visit_id, zero_skus)
     values (990001, '00000000-0000-4000-c000-0000000000c2', '{PET-1}')$q$,
  'row-level security');
select p0_test.expect_denied('followups: own visit but a different outlet',
  $q$insert into followups (outlet_id, visit_id, zero_skus)
     values (990002, '00000000-0000-4000-c000-0000000000c1', '{PET-1}')$q$,
  'row-level security');
select p0_test.expect_denied('followups: coordinator without a visit',
  $q$insert into followups (outlet_id, zero_skus) values (990001, '{PET-1}')$q$,
  'row-level security');

-- ---------- storage (F09): owner can overwrite (upsert retry), others cannot ----------
do $$
declare n int;
begin
  update storage.objects set metadata = '{"p0":"owner"}'
  where bucket_id = 'visit-photos' and name = 'p0test/c1.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL storage: owner update touched % rows, expected 1', n; end if;
  raise notice 'PASS  storage: owner can update own object';
end $$;

select p0_test.act_as('00000000-0000-4000-a000-0000000000c2');
do $$
declare n int;
begin
  update storage.objects set metadata = '{"p0":"overwritten"}'
  where bucket_id = 'visit-photos' and name = 'p0test/c1.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL storage: non-owner overwrote % rows', n; end if;
  raise notice 'PASS  storage: non-owner update touches 0 rows';
end $$;

-- ============================================================
-- router
-- ============================================================
select p0_test.act_as('00000000-0000-4000-a000-0000000000a1');
select p0_test.expect_ok('orders: router pending email order',
  $q$insert into orders (outlet_id, source, po_number, created_by)
     values (990001, 'email', 'PO-P0', '00000000-0000-4000-a000-0000000000a1')$q$);
select p0_test.expect_denied('orders: router forges status=approved on insert',
  $q$insert into orders (outlet_id, source, created_by, status, decided_by, decided_at)
     values (990001, 'email', '00000000-0000-4000-a000-0000000000a1', 'approved',
             '00000000-0000-4000-a000-0000000000a1', now())$q$,
  'row-level security');
select p0_test.expect_ok('followups: router raises one without a visit',
  $q$insert into followups (outlet_id, zero_skus) values (990002, '{PET-1}')$q$);

-- ============================================================
-- finance: transfers still land as cleared, but the open check applies to them too
-- ============================================================
select p0_test.act_as('00000000-0000-4000-a000-0000000000f1');
select p0_test.expect_ok('collections: finance cleared transfer for the remaining 600',
  $q$insert into collections (invoice_id, outlet_id, type, amount, status, settled_at)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'transfer', 600, 'cleared', now())$q$);
select p0_test.expect_denied('collections: finance transfer on a fully collected invoice',
  $q$insert into collections (invoice_id, outlet_id, type, amount, status, settled_at)
     values ('00000000-0000-4000-b000-00000000000d', 990001, 'transfer', 1, 'cleared', now())$q$,
  'أكبر من المفتوح');

reset role;
do $$ begin raise notice 'ALL P0 INSERT GUARD CHECKS PASSED'; end $$;

rollback;
