-- Proposed amendments to 2026-10-27_money_layer_v2.sql — found while building batch 1.
-- Nothing here has been run. Belal reviews; each block says where it belongs.
-- Run by hand in the SQL Editor. Never `supabase db push` / `db reset`.

-- ----------------------------------------------------------------------------
-- 1. With section B — legacy invoices have no ETA number.
--    B3's invoices_eta_chk rejects «تصحيحات» → رصيد سابق (status delivered/matched, legacy,
--    no eta_ref) the moment B runs. Replace the B3 constraint with this one.
-- ----------------------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_eta_chk;
alter table public.invoices add constraint invoices_eta_chk
  check (legacy or status in ('created','void') or eta_ref is not null);

-- ----------------------------------------------------------------------------
-- 2. With section B — the people moves. Both must land together with B:
--    مروه is `supervisor` scope الكل in the DB today. Left as supervisor she would
--    leader-approve every coordinator's order and never see her own final queue.
--    Confirm the names match exactly one row each before running.
-- ----------------------------------------------------------------------------
-- update public.profiles set role = 'dispatch' where full_name = 'علي'  and role = 'router';
-- update public.profiles set role = 'router'   where full_name = 'مروه' and role = 'supervisor';
-- محمد عبد الحميد (الإسكندرية) keeps supervisor_id = مروه; the app routes his pending orders
-- straight to her final queue (router may set leader_approved/approved on pending under B2).

-- ----------------------------------------------------------------------------
-- 3. With section B — علي's «لوحة» reads visits; visits_sel does not admit `dispatch`,
--    so the dashboard silently shows 0 visits for him.
-- ----------------------------------------------------------------------------
drop policy if exists visits_sel on public.visits;
create policy visits_sel on public.visits for select using (
  coordinator_id = auth.uid()
  or my_role() in ('mgmt','supervisor','router','dispatch','invoice','finance'));

-- ----------------------------------------------------------------------------
-- 4. With section B — invoices now move between three desks; the app subscribes to them,
--    but the table is not in the realtime publication, so badges only refresh on «تحديث».
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table invoices;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 5. Section C8 — `create or replace view` cannot insert columns (eta_ref, chain) in the
--    middle of an existing view's column list; Postgres refuses. Drop it first:
-- ----------------------------------------------------------------------------
-- drop view if exists public.invoice_open;
-- create view public.invoice_open with (security_invoker = on) as ... (C8 body unchanged)
