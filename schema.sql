-- ============================================================
-- Tannourine Egypt Ops — Supabase schema  (run in SQL editor)
-- Order: extensions → tables → helper fn → RLS → storage note
-- ============================================================

-- ---------- ENUM-like check constraints kept as text for simplicity ----------

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('mgmt','router','invoice','finance','supervisor','coordinator')),
  scope text not null default 'الكل' check (scope in ('القاهرة','الإسكندرية','الكل')),
  supervisor_id uuid references profiles(id),        -- for coordinators: who approves them
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists outlets (
  id int primary key,
  chain text not null,
  gov text not null,
  name text not null,
  ordering_mode text not null check (ordering_mode in ('rep','central','mixed')),
  payment_path text not null check (payment_path in ('cheque','transfer','unknown')),
  manager_name text,
  manager_phone text,
  lat double precision,               -- pin set from first approved visit
  lng double precision,
  pin_set_by uuid references profiles(id),
  pin_set_at timestamptz,
  active boolean not null default true
);

create table if not exists skus (
  id text primary key,
  name_ar text not null,
  line text not null check (line in ('PET','VIA')),
  case_size int not null,
  price_case_incl_vat numeric(10,2) not null,
  active boolean not null default true
);

create table if not exists routes (
  coordinator_id uuid references profiles(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),   -- JS getDay(): 0=Sun … 6=Sat
  outlet_id int references outlets(id) on delete cascade,
  primary key (coordinator_id, weekday, outlet_id)
);

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  coordinator_id uuid not null references profiles(id),
  outlet_id int not null references outlets(id),
  checkin_at timestamptz not null,
  checkin_lat double precision,
  checkin_lng double precision,
  checkout_at timestamptz,            -- set on submit
  checkout_lat double precision,
  checkout_lng double precision,
  dwell_seconds int,                  -- computed on submit (checkout-checkin)
  distance_m int,                     -- haversine from outlet pin at submit; null if no pin yet
  photo_path text,                    -- storage: visit-photos/{visit_id}.jpg
  status text not null default 'pending' check (status in ('pending','approved','flagged')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  flags text[] not null default '{}', -- e.g. {'short_visit','far_from_pin','no_checkout_gps'}
  off_route boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists visit_lines (
  visit_id uuid references visits(id) on delete cascade,
  sku_id text references skus(id),
  shelf int not null check (shelf >= 0),
  warehouse int not null check (warehouse >= 0),
  sold_cases int not null check (sold_cases >= 0),
  zero_reason text check (zero_reason in ('المخزن فاضي','الفرع لم يطلب','أوردر متأخر','مساحة الرف')),
  primary key (visit_id, sku_id),
  check ( (shelf = 0 and zero_reason is not null) or (shelf > 0) )
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  outlet_id int not null references outlets(id),
  source text not null check (source in ('coordinator','email')),
  po_number text,
  order_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending','approved','rejected','invoiced')),
  created_by uuid not null references profiles(id),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists order_lines (
  order_id uuid references orders(id) on delete cascade,
  sku_id text references skus(id),
  cases int not null check (cases > 0),
  primary key (order_id, sku_id)
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no serial,                          -- human-friendly sequential number
  order_id uuid references orders(id),
  outlet_id int not null references outlets(id),
  invoice_date date not null default current_date,
  amount numeric(12,2) not null,
  status text not null default 'created' check (status in ('created','dispatched','delivered','void')),
  legacy boolean not null default false,      -- true for imported opening receivables
  pod_path text,                              -- storage: pods/{invoice_id}.jpg
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_by uuid references profiles(id),
  void_reason text,
  voided_by uuid references profiles(id),
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists invoice_lines (
  invoice_id uuid references invoices(id) on delete cascade,
  sku_id text references skus(id),
  cases int not null check (cases > 0),
  price_case numeric(10,2) not null,          -- snapshot at invoicing time
  primary key (invoice_id, sku_id)
);

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  outlet_id int not null references outlets(id),
  type text not null check (type in ('cheque','transfer')),
  amount numeric(12,2) not null check (amount > 0),
  cheque_date date,                           -- required when type='cheque'
  status text not null default 'received' check (status in ('received','deposited','cleared','returned')),
  received_by uuid references profiles(id),   -- coordinator holding custody
  received_at timestamptz not null default now(),
  deposited_at timestamptz,
  settled_at timestamptz,                     -- cleared or returned timestamp
  note text,
  check ( type <> 'cheque' or cheque_date is not null )
);

create table if not exists containers (
  id uuid primary key default gen_random_uuid(),
  arrival_date date not null default current_date,
  note text,                                   -- e.g. 'opening balance'
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists container_lines (
  container_id uuid references containers(id) on delete cascade,
  sku_id text references skus(id),
  cases int not null check (cases > 0),
  primary key (container_id, sku_id)
);

create table if not exists followups (
  id uuid primary key default gen_random_uuid(),
  outlet_id int not null references outlets(id),
  visit_id uuid references visits(id),
  zero_skus text[] not null,
  status text not null default 'open' check (status in ('open','done')),
  done_by uuid references profiles(id),
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  actor uuid references profiles(id),
  action text not null,                        -- 'void_invoice','edit_collection','reset_pin',…
  entity text not null,
  entity_id text not null,
  detail jsonb,
  at timestamptz not null default now()
);

-- ---------- helper: current user's role ----------
create or replace function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create or replace function my_scope() returns text
language sql stable security definer set search_path = public as
$$ select scope from profiles where id = auth.uid() $$;

-- ---------- RLS ----------
alter table profiles      enable row level security;
alter table outlets       enable row level security;
alter table skus          enable row level security;
alter table routes        enable row level security;
alter table visits        enable row level security;
alter table visit_lines   enable row level security;
alter table orders        enable row level security;
alter table order_lines   enable row level security;
alter table invoices      enable row level security;
alter table invoice_lines enable row level security;
alter table collections   enable row level security;
alter table containers    enable row level security;
alter table container_lines enable row level security;
alter table followups     enable row level security;
alter table audit_log     enable row level security;

-- Everyone authenticated can read reference data
create policy r_outlets on outlets for select to authenticated using (true);
create policy r_skus    on skus    for select to authenticated using (true);
create policy r_profiles on profiles for select to authenticated using (true);
create policy r_routes  on routes  for select to authenticated using (true);

-- mgmt can edit reference data
create policy w_outlets on outlets for update to authenticated using (my_role()='mgmt');
create policy w_routes_ins on routes for insert to authenticated with check (my_role() in ('mgmt','router'));
create policy w_routes_del on routes for delete to authenticated using (my_role() in ('mgmt','router'));

-- visits: coordinator inserts own; supervisors/mgmt/marwa read all; coordinator reads own
create policy visits_ins on visits for insert to authenticated
  with check (coordinator_id = auth.uid() and my_role()='coordinator');
create policy visits_sel on visits for select to authenticated
  using (coordinator_id = auth.uid() or my_role() in ('mgmt','supervisor','router','invoice','finance'));
create policy visits_upd_review on visits for update to authenticated
  using (my_role() in ('supervisor','mgmt'));
create policy vlines_ins on visit_lines for insert to authenticated
  with check (exists (select 1 from visits v where v.id=visit_id and v.coordinator_id=auth.uid()));
create policy vlines_sel on visit_lines for select to authenticated using (true);

-- orders: coordinator (own, source=coordinator) + router (email); router/mgmt decide
create policy orders_ins_coord on orders for insert to authenticated
  with check (my_role()='coordinator' and source='coordinator' and created_by=auth.uid());
create policy orders_ins_router on orders for insert to authenticated
  with check (my_role() in ('router','mgmt') and created_by=auth.uid());
create policy orders_sel on orders for select to authenticated using (true);
create policy orders_upd on orders for update to authenticated using (my_role() in ('router','mgmt'));
create policy olines_ins on order_lines for insert to authenticated
  with check (exists (select 1 from orders o where o.id=order_id and o.created_by=auth.uid()));
create policy olines_sel on order_lines for select to authenticated using (true);

-- invoices: invoice role creates/updates lifecycle; finance may void; all read
create policy inv_ins on invoices for insert to authenticated with check (my_role() in ('invoice','mgmt','finance'));
create policy inv_sel on invoices for select to authenticated using (true);
create policy inv_upd on invoices for update to authenticated using (my_role() in ('invoice','finance','mgmt'));
create policy ilines_ins on invoice_lines for insert to authenticated
  with check (my_role() in ('invoice','mgmt','finance'));
create policy ilines_sel on invoice_lines for select to authenticated using (true);

-- collections: coordinator logs cheque received; finance updates lifecycle & inserts transfers
create policy col_ins_coord on collections for insert to authenticated
  with check (my_role()='coordinator' and type='cheque' and received_by=auth.uid());
create policy col_ins_fin on collections for insert to authenticated
  with check (my_role() in ('finance','mgmt'));
create policy col_sel on collections for select to authenticated using (true);
create policy col_upd on collections for update to authenticated using (my_role() in ('finance','mgmt'));

-- containers: mgmt only
create policy cont_ins on containers for insert to authenticated with check (my_role()='mgmt');
create policy cont_sel on containers for select to authenticated using (true);
create policy clines_ins on container_lines for insert to authenticated with check (my_role()='mgmt');
create policy clines_sel on container_lines for select to authenticated using (true);

-- followups: auto-created client-side on qualifying visit; supervisors/marwa close
create policy fu_ins on followups for insert to authenticated with check (true);
create policy fu_sel on followups for select to authenticated using (true);
create policy fu_upd on followups for update to authenticated using (my_role() in ('supervisor','mgmt','router'));

-- audit: append-only, mgmt+finance read
create policy audit_ins on audit_log for insert to authenticated with check (actor = auth.uid());
create policy audit_sel on audit_log for select to authenticated using (my_role() in ('mgmt','finance'));

-- ---------- views for dashboards ----------
create or replace view invoice_open as
select i.id, i.invoice_no, i.outlet_id, i.invoice_date, i.amount, i.legacy, i.status,
       i.amount - coalesce((select sum(c.amount) from collections c
                            where c.invoice_id = i.id and c.status <> 'returned'),0) as open_amount,
       (current_date - i.invoice_date) as age_days
from invoices i
where i.status <> 'void';

create or replace view book_stock as
select s.id as sku_id, s.name_ar,
  coalesce((select sum(cl.cases) from container_lines cl where cl.sku_id=s.id),0) as cases_in,
  coalesce((select sum(il.cases) from invoice_lines il
            join invoices i on i.id=il.invoice_id and i.status<>'void' and i.legacy=false
            where il.sku_id=s.id),0) as cases_out
from skus s;

-- ============================================================
-- STORAGE (create in dashboard or via API): buckets
--   visit-photos  (private)   pods (private)
-- Policies: authenticated users may insert; all authenticated may select.
-- ============================================================

-- ============================================================
-- v1.1 PATCH — review fixes (idempotent where possible)
-- ============================================================

-- (1) Coordinator submits own visit: check-in INSERTs, submit UPDATEs own pending row
drop policy if exists visits_upd_own on visits;
create policy visits_upd_own on visits for update to authenticated
  using (coordinator_id = auth.uid() and status = 'pending')
  with check (coordinator_id = auth.uid() and status = 'pending');

-- harden reviewer policy with explicit with check
drop policy if exists visits_upd_review on visits;
create policy visits_upd_review on visits for update to authenticated
  using (my_role() in ('supervisor','mgmt'))
  with check (my_role() in ('supervisor','mgmt'));

-- (2) Pin set on supervisor approval via security definer RPC (no broad outlets UPDATE)
create or replace function set_outlet_pin(p_outlet int, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('supervisor','mgmt') then
    raise exception 'not allowed';
  end if;
  update outlets
     set lat = p_lat, lng = p_lng, pin_set_by = auth.uid(), pin_set_at = now()
   where id = p_outlet and lat is null;          -- first pin only; reset stays mgmt-only
end $$;
revoke execute on function set_outlet_pin from public, anon;
grant  execute on function set_outlet_pin to authenticated;

-- mgmt pin reset (audited by client via audit_log insert)
create or replace function reset_outlet_pin(p_outlet int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'mgmt' then raise exception 'not allowed'; end if;
  update outlets set lat=null, lng=null, pin_set_by=null, pin_set_at=null where id=p_outlet;
end $$;
revoke execute on function reset_outlet_pin from public, anon;
grant  execute on function reset_outlet_pin to authenticated;

-- (3) invoice role may flip order -> invoiced, and only that
drop policy if exists orders_upd on orders;
create policy orders_upd on orders for update to authenticated
  using (my_role() in ('router','invoice','mgmt'))
  with check (
    my_role() in ('router','mgmt')
    or (my_role() = 'invoice' and status = 'invoiced')
  );

-- (4) views: apply caller RLS and cut anon
alter view invoice_open set (security_invoker = true);
alter view book_stock  set (security_invoker = true);
revoke all on invoice_open from anon;
revoke all on book_stock  from anon;

-- (5) realtime publication
do $$ begin
  alter publication supabase_realtime add table visits;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table collections;
exception when duplicate_object then null; end $$;

-- (6) void is finance/mgmt only, enforced in-database
drop policy if exists inv_upd on invoices;
create policy inv_upd on invoices for update to authenticated
  using (my_role() in ('invoice','finance','mgmt'))
  with check ( status <> 'void' or my_role() in ('finance','mgmt') );

-- (7) profiles writable by mgmt (deactivate, supervisor_id assignment)
drop policy if exists profiles_upd_mgmt on profiles;
create policy profiles_upd_mgmt on profiles for update to authenticated
  using (my_role() = 'mgmt') with check (my_role() = 'mgmt');

-- (8) storage: buckets + policies in SQL so "run as-is" is true
insert into storage.buckets (id, name, public) values
  ('visit-photos','visit-photos', false),
  ('pods','pods', false)
on conflict (id) do nothing;
drop policy if exists sto_ins on storage.objects;
create policy sto_ins on storage.objects for insert to authenticated
  with check (bucket_id in ('visit-photos','pods'));
drop policy if exists sto_sel on storage.objects;
create policy sto_sel on storage.objects for select to authenticated
  using (bucket_id in ('visit-photos','pods'));

-- hardening: explicit with check on remaining role-gated updates
drop policy if exists w_outlets on outlets;
create policy w_outlets on outlets for update to authenticated
  using (my_role()='mgmt') with check (my_role()='mgmt');
drop policy if exists col_upd on collections;
create policy col_upd on collections for update to authenticated
  using (my_role() in ('finance','mgmt')) with check (my_role() in ('finance','mgmt'));
drop policy if exists fu_upd on followups;
create policy fu_upd on followups for update to authenticated
  using (my_role() in ('supervisor','mgmt','router'))
  with check (my_role() in ('supervisor','mgmt','router'));

-- ============================================================
-- v1.2 PATCH — retry safety, supervisor assignment, tightenings
-- ============================================================
drop policy if exists vlines_upd on visit_lines;
create policy vlines_upd on visit_lines for update to authenticated
  using (exists (select 1 from visits v
                 where v.id = visit_id and v.coordinator_id = auth.uid()
                   and v.status = 'pending'))
  with check (exists (select 1 from visits v
                 where v.id = visit_id and v.coordinator_id = auth.uid()
                   and v.status = 'pending'));

drop policy if exists visits_upd_own on visits;
create policy visits_upd_own on visits for update to authenticated
  using (coordinator_id = auth.uid() and status = 'pending' and checkout_at is null)
  with check (coordinator_id = auth.uid() and status = 'pending');
-- note: with check intentionally does NOT require checkout_at null — the submit write sets it.

drop policy if exists orders_upd on orders;
create policy orders_upd on orders for update to authenticated
  using ( my_role() in ('router','mgmt')
          or (my_role() = 'invoice' and status = 'approved') )
  with check ( my_role() in ('router','mgmt')
          or (my_role() = 'invoice' and status = 'invoiced') );

drop policy if exists profiles_upd_mgmt on profiles;
create policy profiles_upd_mgmt on profiles for update to authenticated
  using (my_role() = 'mgmt') with check (my_role() = 'mgmt');
drop policy if exists sto_ins on storage.objects;
create policy sto_ins on storage.objects for insert to authenticated
  with check (bucket_id in ('visit-photos','pods'));
drop policy if exists sto_sel on storage.objects;
create policy sto_sel on storage.objects for select to authenticated
  using (bucket_id in ('visit-photos','pods'));

-- ============================================================
-- v1.3 PATCH — storage upsert (found by executed acceptance §15.9, 2026-09-01)
--
-- sto_ins covers INSERT only. Supabase Storage `upload(..., { upsert: true })`
-- against an existing object performs an UPDATE on storage.objects, which had
-- no policy and was refused with 42501. That breaks the retry path §15.9
-- depends on: a coordinator resubmitting after a failed submit could not
-- re-upload the shelf photo, so the retry never converged.
--
-- Same predicate as sto_ins, both sides, so an authenticated user may only
-- overwrite within the two app buckets.
-- ============================================================

drop policy if exists sto_upd on storage.objects;
create policy sto_upd on storage.objects for update to authenticated
  using      (bucket_id in ('visit-photos','pods'))
  with check (bucket_id in ('visit-photos','pods'));
