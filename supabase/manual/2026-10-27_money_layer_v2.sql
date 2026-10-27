-- Tannourine OS — money layer v2 (27 Oct 2026)
-- Run in the Supabase SQL Editor on tlrhztjnzptuvkrkrjod, section by section, in order.
-- Forward only. Never `supabase db push` / `db reset` against this project.
--
--   A  run today (safe, reversible, no workflow change)
--   B  run with CC batch 1 (approval chain, dispatch role, portal-mirror invoice)
--   C  run with CC batch 2 (إذن استلام match, chains, due dates, allocations, hold list)

-- ============================================================================
-- A. coordinators never read money · invoice_open honours RLS · ETA reference
-- ============================================================================
drop policy if exists inv_sel on public.invoices;
create policy inv_sel on public.invoices for select using (my_role() <> 'coordinator');
drop policy if exists col_sel on public.collections;
create policy col_sel on public.collections for select using (my_role() <> 'coordinator');
alter view public.invoice_open set (security_invoker = on);
alter table public.invoices add column if not exists eta_ref text;
-- rollback A:  create policy inv_sel ... using (true); create policy col_sel ... using (true);

-- ============================================================================
-- B. batch 1 — roles, two-step approval, مروه edit/cancel, invoice = portal mirror
-- ============================================================================

-- B1. new role `dispatch` (علي). مروه stays `router` (relabelled in the app).
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('mgmt','router','dispatch','invoice','finance','supervisor','coordinator'));
-- data (run after confirming علي's profile id):
-- update public.profiles set role = 'dispatch' where full_name = 'علي' and role = 'router';

-- B2. order states: pending → leader_approved → approved → invoiced | rejected | cancelled
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','leader_approved','approved','rejected','cancelled','invoiced'));
alter table public.orders
  add column if not exists leader_decided_by uuid references public.profiles(id),
  add column if not exists leader_decided_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists edited_by uuid references public.profiles(id),
  add column if not exists edited_at timestamptz;
alter table public.orders drop constraint if exists orders_cancel_reason_chk;
alter table public.orders add constraint orders_cancel_reason_chk
  check (status <> 'cancelled' or cancel_reason is not null);

-- who may move an order where:
--   supervisor: pending → leader_approved | rejected, only for coordinators they supervise (or scope الكل)
--   router (مروه): leader_approved → approved | rejected; any non-invoiced → cancelled; edits lines
--   email orders (source='email') are created by router already `leader_approved`
--   invoice (عمرو): approved → invoiced (unchanged)
--   mgmt: anything
drop policy if exists orders_ins_router on public.orders;
create policy orders_ins_router on public.orders for insert with check (
  my_role() in ('router','mgmt') and created_by = auth.uid()
  and decided_by is null and decided_at is null
  and ((source = 'email' and status = 'leader_approved') or status = 'pending'));

drop policy if exists orders_upd on public.orders;
create policy orders_upd on public.orders for update
  using (
    my_role() = 'mgmt'
    or (my_role() = 'router' and status in ('pending','leader_approved','approved'))
    or (my_role() = 'invoice' and status = 'approved')
    or (my_role() = 'supervisor' and status = 'pending' and exists (
          select 1 from profiles c where c.id = orders.created_by
          and (c.supervisor_id = auth.uid() or my_scope() = 'الكل')))
  )
  with check (
    my_role() = 'mgmt'
    or (my_role() = 'invoice' and status = 'invoiced')
    or (my_role() = 'supervisor' and status in ('leader_approved','rejected')
        and leader_decided_by = auth.uid())
    or (my_role() = 'router' and (
          status in ('approved','rejected','cancelled')
          or status in ('pending','leader_approved')   -- line edits keep the state
        ))
  );

-- order_lines: router may edit lines while the order is not yet invoiced
drop policy if exists ol_upd_router on public.order_lines;
create policy ol_upd_router on public.order_lines for update
  using (my_role() in ('router','mgmt') and exists (
    select 1 from orders o where o.id = order_lines.order_id and o.status not in ('invoiced','cancelled','rejected')))
  with check (my_role() in ('router','mgmt'));
drop policy if exists ol_ins_router on public.order_lines;
create policy ol_ins_router on public.order_lines for insert
  with check (my_role() in ('router','mgmt') and exists (
    select 1 from orders o where o.id = order_lines.order_id and o.status not in ('invoiced','cancelled','rejected')));
drop policy if exists ol_del_router on public.order_lines;
create policy ol_del_router on public.order_lines for delete
  using (my_role() in ('router','mgmt') and exists (
    select 1 from orders o where o.id = order_lines.order_id and o.status not in ('invoiced','cancelled','rejected')));

-- B3. invoice = mirror of the portal invoice: ETA number required to exist as `issued`
alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('created','issued','dispatched','delivered','matched','short','void'));
alter table public.invoices
  add column if not exists driver text,
  add column if not exists receipt_path text,           -- إذن استلام photo
  add column if not exists matched_by uuid references public.profiles(id),
  add column if not exists matched_at timestamptz;
alter table public.invoices drop constraint if exists invoices_eta_chk;
alter table public.invoices add constraint invoices_eta_chk
  check (status in ('created','void') or eta_ref is not null);

-- who writes which invoice state
drop policy if exists inv_upd on public.invoices;
create policy inv_upd on public.invoices for update
  using (
    my_role() = 'mgmt'
    or (my_role() = 'invoice'  and status in ('created','issued'))
    or (my_role() = 'dispatch' and status in ('issued','dispatched'))
    or (my_role() = 'finance')
  )
  with check (
    my_role() = 'mgmt'
    or (my_role() = 'invoice'  and status in ('created','issued'))
    or (my_role() = 'dispatch' and status in ('dispatched','delivered'))
    or (my_role() = 'finance'  and status in ('delivered','matched','short','void'))
  );

-- collections may only hit invoices that are matched (was: delivered)
create or replace function public.collections_check_invoice() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_inv invoices%rowtype; v_open numeric(12,2);
begin
  perform pg_advisory_xact_lock(hashtext('collections:' || new.invoice_id::text));
  select * into v_inv from invoices where id = new.invoice_id;
  if not found then raise exception 'الفاتورة مش موجودة' using errcode = '23514'; end if;
  if v_inv.status not in ('matched') and not v_inv.legacy then
    raise exception 'مينفعش تسجّل تحصيل على فاتورة لسه ما اتطابقتش بإذن الاستلام' using errcode = '23514';
  end if;
  if new.outlet_id is distinct from v_inv.outlet_id then
    raise exception 'الفرع مش هو فرع الفاتورة' using errcode = '23514';
  end if;
  select v_inv.amount - coalesce(sum(c.amount), 0) into v_open
  from collections c where c.invoice_id = new.invoice_id and c.status <> 'returned';
  if new.amount > v_open then
    raise exception 'المبلغ أكبر من المفتوح على الفاتورة (المفتوح %)', v_open using errcode = '23514';
  end if;
  return new;
end $$;

-- ============================================================================
-- C. batch 2 — chains, إذن استلام match, short flags, allocations, due dates, hold list
-- ============================================================================

-- C1. chains: the contract rule lives here, not in people's heads
create table if not exists public.chains (
  code text primary key,                       -- matches outlets.chain exactly
  name_ar text not null,
  credit_days int not null default 45,
  count_from text not null default 'month_end'
    check (count_from in ('month_end','invoice_date','delivery_date')),
  withholding_pct numeric not null default 0,  -- Circle K 25
  pay_on_sold boolean not null default false,
  deductions jsonb not null default '[]',      -- [{"label":"خصم فاتورة","pct":10},{"label":"ريبيت سنوي","pct":1.5}]
  default_payment_path text not null default 'cheque' check (default_payment_path in ('cheque','transfer')),
  active boolean not null default true
);
alter table public.chains enable row level security;
create policy ch_sel on public.chains for select using (my_role() <> 'coordinator');
create policy ch_upd on public.chains for all
  using (my_role() in ('finance','mgmt')) with check (my_role() in ('finance','mgmt'));

insert into public.chains (code, name_ar, credit_days, count_from, withholding_pct, pay_on_sold, default_payment_path) values
  ('Zahran',     'زهران',       30, 'month_end',    0,  false, 'cheque'),
  ('Gourmet',    'جورميه',      45, 'month_end',    0,  false, 'transfer'),
  ('Seoudi',     'سعودي',       45, 'month_end',    0,  false, 'cheque'),
  ('On The Run', 'أون ذا رن',   60, 'invoice_date', 0,  false, 'cheque'),
  ('Circle K',   'سيركل كيه',   65, 'month_end',    25, true,  'cheque'),
  ('Master',     'ماستر',       45, 'month_end',    0,  false, 'cheque'),   -- no contract on file: سلمي confirms
  ('Sunny',      'صني',         45, 'month_end',    0,  false, 'cheque')    -- سلمي confirms
on conflict (code) do nothing;
-- deductions per chain are entered by سلمي in the app (jsonb), from the contract file.

alter table public.outlets add constraint outlets_chain_fk foreign key (chain) references public.chains(code) not valid;

-- C2. invoice money fields: due date and expected net, computed by default, overridable by finance
alter table public.invoices
  add column if not exists due_date date,
  add column if not exists due_date_2 date,                 -- Circle K withheld 25%
  add column if not exists expected_net numeric,
  add column if not exists override_by uuid references public.profiles(id),
  add column if not exists override_at timestamptz,
  add column if not exists override_note text;

create or replace function public.compute_invoice_terms() returns trigger
language plpgsql set search_path to 'public' as $$
declare r chains%rowtype; base date; ded numeric := 0; d jsonb;
begin
  select ch.* into r from chains ch join outlets o on o.chain = ch.code where o.id = new.outlet_id;
  if not found then return new; end if;
  if new.override_by is not null then return new; end if;          -- finance override wins
  base := case r.count_from
            when 'month_end' then (date_trunc('month', new.invoice_date) + interval '1 month - 1 day')::date
            when 'delivery_date' then coalesce(new.delivered_at::date, new.invoice_date)
            else new.invoice_date end;
  new.due_date := base + r.credit_days;
  new.due_date_2 := case when r.withholding_pct > 0 then null else null end;  -- set by finance when sell-out report lands
  for d in select * from jsonb_array_elements(r.deductions) loop
    ded := ded + coalesce((d->>'pct')::numeric, 0);
  end loop;
  new.expected_net := round(new.amount * (1 - ded / 100.0), 2);
  return new;
end $$;
drop trigger if exists invoices_terms on public.invoices;
create trigger invoices_terms before insert or update of amount, invoice_date, delivered_at, outlet_id
  on public.invoices for each row execute function public.compute_invoice_terms();

-- C3. received quantities on the إذن استلام
alter table public.invoice_lines add column if not exists received_cases int;

-- C4. short-delivery flag seen by عمرو، مروه، سلمي
create table if not exists public.delivery_flags (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  diff_cases int not null,
  diff_amount numeric not null,
  status text not null default 'open' check (status in ('open','invoice_fixed','branch_confirmed','closed')),
  resolution text check (resolution in ('credit_note','corrected_invoice','accepted_as_is')),
  invoice_note text,     -- عمرو: credit note / corrected invoice number
  branch_note text,      -- مروه: what the branch said
  opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  invoice_by uuid references public.profiles(id), invoice_at timestamptz,
  branch_by uuid references public.profiles(id),  branch_at timestamptz,
  closed_by uuid references public.profiles(id),  closed_at timestamptz
);
alter table public.delivery_flags enable row level security;
create policy df_sel on public.delivery_flags for select using (my_role() <> 'coordinator');
create policy df_ins on public.delivery_flags for insert
  with check (my_role() in ('finance','mgmt') and opened_by = auth.uid());
create policy df_upd on public.delivery_flags for update
  using (my_role() in ('invoice','router','finance','mgmt'))
  with check (my_role() in ('invoice','router','finance','mgmt'));

-- C5. one payment → many invoices
create table if not exists public.collection_allocations (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id),
  amount numeric not null check (amount > 0),
  unique (collection_id, invoice_id)
);
alter table public.collection_allocations enable row level security;
create policy ca_sel on public.collection_allocations for select using (my_role() <> 'coordinator');
create policy ca_all on public.collection_allocations for all
  using (my_role() in ('finance','mgmt')) with check (my_role() in ('finance','mgmt'));
-- collections.invoice_id becomes optional: a chain cheque is logged once, then allocated
alter table public.collections alter column invoice_id drop not null;
drop trigger if exists collections_check_invoice on public.collections;  -- the per-invoice check moves to allocations
create or replace function public.allocation_check() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_inv invoices%rowtype; v_open numeric; v_unalloc numeric;
begin
  select * into v_inv from invoices where id = new.invoice_id;
  if v_inv.status <> 'matched' and not v_inv.legacy then
    raise exception 'الفاتورة لسه ما اتطابقتش بإذن الاستلام' using errcode = '23514';
  end if;
  select coalesce(v_inv.expected_net, v_inv.amount) - coalesce(sum(a.amount),0) into v_open
    from collection_allocations a join collections c on c.id = a.collection_id
    where a.invoice_id = new.invoice_id and c.status <> 'returned' and a.id <> coalesce(new.id, gen_random_uuid());
  if new.amount > v_open then
    raise exception 'المبلغ أكبر من المفتوح على الفاتورة (المفتوح %)', v_open using errcode = '23514';
  end if;
  select c.amount - coalesce(sum(a.amount),0) into v_unalloc
    from collections c left join collection_allocations a on a.collection_id = c.id and a.id <> coalesce(new.id, gen_random_uuid())
    where c.id = new.collection_id group by c.amount;
  if new.amount > v_unalloc then
    raise exception 'المبلغ أكبر من المتبقي في الشيك/التحويل (المتبقي %)', v_unalloc using errcode = '23514';
  end if;
  return new;
end $$;
create trigger allocation_check before insert or update on public.collection_allocations
  for each row execute function public.allocation_check();

-- C6. cheque custody: supervisor pocket → office drawer → bank
alter table public.collections
  add column if not exists handed_to_office_at timestamptz,
  add column if not exists office_received_by uuid references public.profiles(id);

-- C7. hold list
alter table public.outlets
  add column if not exists on_hold boolean not null default false,
  add column if not exists hold_set_by uuid references public.profiles(id),
  add column if not exists hold_set_at timestamptz,
  add column if not exists hold_reason text;
-- router (مروه) cannot final-approve an on-hold outlet; mgmt can (audited in app)
drop policy if exists orders_upd on public.orders;
create policy orders_upd on public.orders for update
  using (
    my_role() = 'mgmt'
    or (my_role() = 'router' and status in ('pending','leader_approved','approved'))
    or (my_role() = 'invoice' and status = 'approved')
    or (my_role() = 'supervisor' and status = 'pending' and exists (
          select 1 from profiles c where c.id = orders.created_by
          and (c.supervisor_id = auth.uid() or my_scope() = 'الكل')))
  )
  with check (
    my_role() = 'mgmt'
    or (my_role() = 'invoice' and status = 'invoiced')
    or (my_role() = 'supervisor' and status in ('leader_approved','rejected') and leader_decided_by = auth.uid())
    or (my_role() = 'router' and (
          status in ('rejected','cancelled','pending','leader_approved')
          or (status = 'approved' and not exists (select 1 from outlets o where o.id = orders.outlet_id and o.on_hold))
        ))
  );

-- C8. open-receivables view by due date and expected net (replaces invoice_open semantics)
create or replace view public.invoice_open with (security_invoker = on) as
select i.id, i.invoice_no, i.eta_ref, i.outlet_id, o.chain, i.invoice_date, i.amount, i.expected_net,
  i.due_date, i.due_date_2, i.legacy, i.status,
  coalesce(i.expected_net, i.amount)
    - coalesce((select sum(a.amount) from collection_allocations a join collections c on c.id = a.collection_id
                where a.invoice_id = i.id and c.status <> 'returned'), 0)
    - coalesce((select sum(c.amount) from collections c where c.invoice_id = i.id and c.status <> 'returned'
                and not exists (select 1 from collection_allocations a where a.collection_id = c.id)), 0) as open_amount,
  current_date - i.invoice_date as age_days,
  current_date - i.due_date as days_past_due
from invoices i join outlets o on o.id = i.outlet_id
where i.status <> 'void';

-- C9. follow-up kinds (مروه's queue gets delivery + dispute; finance gets collection)
alter table public.followups
  add column if not exists kind text not null default 'shelf' check (kind in ('shelf','delivery','dispute','collection')),
  add column if not exists owner_id uuid references public.profiles(id),
  add column if not exists due_date date,
  add column if not exists invoice_id uuid references public.invoices(id),
  add column if not exists outcome text;
drop policy if exists fu_ins on public.followups;
create policy fu_ins on public.followups for insert with check (
  status = 'open' and done_by is null and done_at is null and (
    my_role() in ('supervisor','mgmt','router','finance','invoice','dispatch')
    or exists (select 1 from visits v where v.id = followups.visit_id and v.coordinator_id = auth.uid() and v.outlet_id = followups.outlet_id)));
drop policy if exists fu_upd on public.followups;
create policy fu_upd on public.followups for update
  using (my_role() in ('supervisor','mgmt','router','finance')) with check (my_role() in ('supervisor','mgmt','router','finance'));

-- C10. audit visible to finance + mgmt only (unchanged); dispatch may write audit rows
-- (audit_ins already allows any actor = auth.uid())
