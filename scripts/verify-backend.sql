-- ============================================================
-- Tannourine — backend state verification  (PRD §15 step 1)
-- Paste into Supabase Dashboard → SQL Editor → Run.
-- READ-ONLY: this script creates nothing and changes nothing.
-- Every row of the result should read PASS.
-- ============================================================

with results as (

  -- ---------- seed data ----------
  select 1 as ord, 'skus rows' as check_name, '8' as expected,
         count(*)::text as actual from skus
  union all
  select 2, 'outlets rows', '255', count(*)::text from outlets
  union all
  select 3, 'outlets min id (must be 0, not 1)', '0',
         coalesce(min(id)::text, '(no rows)') from outlets
  union all
  select 4, 'outlets payment_path=unknown (Circle K)', '121',
         count(*)::text from outlets where payment_path = 'unknown'
  union all
  select 5, 'outlets ordering_mode=central (20 Gourmet + 3 Seoudi)', '23',
         count(*)::text from outlets where ordering_mode = 'central'
  union all
  select 6, 'profiles rows (0 before provisioning, 14 after)', '0 or 14',
         count(*)::text from profiles

  -- ---------- helper functions + RPCs ----------
  union all
  select 7, 'function my_role()', '1', count(*)::text
    from pg_proc where proname = 'my_role'
  union all
  select 8, 'function my_scope()', '1', count(*)::text
    from pg_proc where proname = 'my_scope'
  union all
  select 9, 'RPC set_outlet_pin()', '1', count(*)::text
    from pg_proc where proname = 'set_outlet_pin'
  union all
  select 10, 'RPC reset_outlet_pin()', '1', count(*)::text
    from pg_proc where proname = 'reset_outlet_pin'

  -- ---------- views ----------
  union all
  select 11, 'view invoice_open', '1', count(*)::text
    from pg_views where schemaname = 'public' and viewname = 'invoice_open'
  union all
  select 12, 'view book_stock', '1', count(*)::text
    from pg_views where schemaname = 'public' and viewname = 'book_stock'

  -- ---------- v1.1 / v1.2 policies (the whole point of the patches) ----------
  union all
  select 13, 'policy visits_upd_own', '1', count(*)::text
    from pg_policies where tablename = 'visits' and policyname = 'visits_upd_own'
  union all
  select 14, 'policy visits_upd_review', '1', count(*)::text
    from pg_policies where tablename = 'visits' and policyname = 'visits_upd_review'
  union all
  select 15, 'policy vlines_upd (retry safety)', '1', count(*)::text
    from pg_policies where tablename = 'visit_lines' and policyname = 'vlines_upd'
  union all
  select 16, 'policy orders_upd', '1', count(*)::text
    from pg_policies where tablename = 'orders' and policyname = 'orders_upd'
  union all
  select 17, 'policy inv_upd', '1', count(*)::text
    from pg_policies where tablename = 'invoices' and policyname = 'inv_upd'
  union all
  select 18, 'policy col_upd', '1', count(*)::text
    from pg_policies where tablename = 'collections' and policyname = 'col_upd'
  union all
  select 19, 'policy fu_upd', '1', count(*)::text
    from pg_policies where tablename = 'followups' and policyname = 'fu_upd'
  union all
  select 20, 'policy profiles_upd_mgmt', '1', count(*)::text
    from pg_policies where tablename = 'profiles' and policyname = 'profiles_upd_mgmt'
  union all
  select 21, 'policy w_outlets', '1', count(*)::text
    from pg_policies where tablename = 'outlets' and policyname = 'w_outlets'

  -- ---------- storage policies (the "must be owner of table objects" case) ----------
  union all
  select 22, 'storage policy sto_ins', '1', count(*)::text
    from pg_policies where schemaname = 'storage'
     and tablename = 'objects' and policyname = 'sto_ins'
  union all
  select 23, 'storage policy sto_sel', '1', count(*)::text
    from pg_policies where schemaname = 'storage'
     and tablename = 'objects' and policyname = 'sto_sel'

  -- ---------- buckets: must exist AND be private ----------
  union all
  select 24, 'bucket visit-photos exists', '1', count(*)::text
    from storage.buckets where id = 'visit-photos'
  union all
  select 25, 'bucket visit-photos is PRIVATE', 'false',
         coalesce((select public::text from storage.buckets where id = 'visit-photos'), '(missing)')
  union all
  select 26, 'bucket pods exists', '1', count(*)::text
    from storage.buckets where id = 'pods'
  union all
  select 27, 'bucket pods is PRIVATE', 'false',
         coalesce((select public::text from storage.buckets where id = 'pods'), '(missing)')

  -- ---------- realtime publication (silent-failure risk, ACCEPTANCE §15.3) ----------
  union all
  select 28, 'realtime: visits published', '1', count(*)::text
    from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename = 'visits'
  union all
  select 29, 'realtime: orders published', '1', count(*)::text
    from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename = 'orders'
  union all
  select 30, 'realtime: collections published', '1', count(*)::text
    from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename = 'collections'

  -- ---------- RLS actually enabled ----------
  union all
  select 31, 'tables with RLS enabled', '15',
         count(*)::text from pg_tables
   where schemaname = 'public' and rowsecurity = true
)
select
  ord as "#",
  check_name as "check",
  expected,
  actual,
  case
    when expected = '0 or 14' and actual in ('0','14') then 'PASS'
    when expected = actual then 'PASS'
    else 'FAIL  <<<<<<'
  end as verdict
from results
order by ord;
