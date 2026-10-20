-- Batch 1 (docs/review/2026-10-app-review.md §7): P0 insert guards. Covers F01, F02, F11
-- (insert half), F37. The storage half (F09) is 20261019120100_p0_storage_upd_owner.sql,
-- kept separate because storage.objects DDL can fail with "must be owner of table objects"
-- and that failure must not roll back these money guards.
--
-- Forward-only. The base schema was pasted by hand and is not in migration history, so
-- every policy is dropped by name with `if exists` and recreated.
--
-- Each insert policy below keeps its schema.sql check and adds: the row must start in the
-- state its workflow begins in. Later states are reached only through UPDATE policies held
-- by the role that owns that step (router decides orders, finance moves cheques, supervisor
-- reviews visits, supervisor/mgmt/router close follow-ups).

-- ---------- orders: a new order is pending and undecided (F02) ----------
drop policy if exists orders_ins_coord on orders;
create policy orders_ins_coord on orders for insert to authenticated
  with check (
    my_role() = 'coordinator' and source = 'coordinator' and created_by = auth.uid()
    and status = 'pending' and decided_by is null and decided_at is null
  );

drop policy if exists orders_ins_router on orders;
create policy orders_ins_router on orders for insert to authenticated
  with check (
    my_role() in ('router','mgmt') and created_by = auth.uid()
    and status = 'pending' and decided_by is null and decided_at is null
  );

-- ---------- collections: a coordinator cheque starts in custody (F01) ----------
-- col_ins_fin is deliberately unchanged: finance logs transfers as `cleared` on arrival.
drop policy if exists col_ins_coord on collections;
create policy col_ins_coord on collections for insert to authenticated
  with check (
    my_role() = 'coordinator' and type = 'cheque' and received_by = auth.uid()
    and status = 'received' and deposited_at is null and settled_at is null
  );

-- Every collection, from any role, must land on a delivered invoice of the same outlet and
-- must not exceed what is still open on it. Open = amount minus non-returned collections,
-- the same rule as the invoice_open view.
--
-- SECURITY INVOKER: plain SELECTs suffice because inv_sel and col_sel are using (true).
-- Not SELECT … FOR UPDATE: that would apply inv_upd's USING, which a coordinator fails,
-- and the invoice would look missing. Concurrent inserts on one invoice are serialised with
-- a transaction-scoped advisory lock instead, so two cheques cannot both pass the open check.
create or replace function collections_check_invoice() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv  invoices%rowtype;
  v_open numeric(12,2);
begin
  perform pg_advisory_xact_lock(hashtext('collections:' || new.invoice_id::text));

  select * into v_inv from invoices where id = new.invoice_id;
  if not found then
    raise exception 'الفاتورة مش موجودة' using errcode = '23514';
  end if;

  if v_inv.status <> 'delivered' then
    raise exception 'مينفعش تسجّل تحصيل على فاتورة لسه ما اتسلمتش'
      using errcode = '23514';
  end if;

  if new.outlet_id is distinct from v_inv.outlet_id then
    raise exception 'الفرع مش هو فرع الفاتورة'
      using errcode = '23514';
  end if;

  select v_inv.amount - coalesce(sum(c.amount), 0) into v_open
  from collections c
  where c.invoice_id = new.invoice_id and c.status <> 'returned';

  if new.amount > v_open then
    raise exception 'المبلغ أكبر من المفتوح على الفاتورة (المفتوح %)', v_open
      using errcode = '23514';
  end if;

  return new;
end
$$;

drop trigger if exists collections_check_invoice on collections;
create trigger collections_check_invoice
  before insert on collections
  for each row execute function collections_check_invoice();

-- ---------- visits: a check-in is pending, unreviewed and not yet checked out (F11) ----------
-- Submit stays an UPDATE through visits_upd_own; review stays visits_upd_review.
drop policy if exists visits_ins on visits;
create policy visits_ins on visits for insert to authenticated
  with check (
    coordinator_id = auth.uid() and my_role() = 'coordinator'
    and status = 'pending' and reviewed_by is null and reviewed_at is null
    and checkout_at is null and checkout_lat is null and checkout_lng is null
    and dwell_seconds is null and distance_m is null
    and flags = '{}'
  );

-- ---------- followups: open, and raised from the caller's own visit (F37) ----------
-- Coordinators raise them from VisitForm after submit; supervisor/mgmt/router, who already
-- close them through fu_upd, may also raise one without a visit.
drop policy if exists fu_ins on followups;
create policy fu_ins on followups for insert to authenticated
  with check (
    status = 'open' and done_by is null and done_at is null
    and (
      my_role() in ('supervisor','mgmt','router')
      or exists (
        select 1 from visits v
        where v.id = followups.visit_id
          and v.coordinator_id = auth.uid()
          and v.outlet_id = followups.outlet_id
      )
    )
  );

-- ---------- drift guard ----------
-- Permissive policies OR together, and the live DB has drifted from schema.sql before
-- (sto_upd). Any other permissive INSERT/ALL policy on these tables would make the guards
-- above a no-op, so fail the whole migration and name it rather than apply silently.
do $$
declare
  v_stray text;
begin
  select string_agg(tablename || '.' || policyname || ' (' || cmd || ')', ', ')
    into v_stray
  from pg_policies
  where schemaname = 'public'
    and permissive = 'PERMISSIVE'
    and cmd in ('INSERT','ALL')
    and (tablename, policyname) not in (
      ('orders','orders_ins_coord'), ('orders','orders_ins_router'),
      ('collections','col_ins_coord'), ('collections','col_ins_fin'),
      ('visits','visits_ins'),
      ('followups','fu_ins')
    )
    and tablename in ('orders','collections','visits','followups');

  if v_stray is not null then
    raise exception 'p0_insert_guards: unexpected permissive insert policies would bypass the guards: %', v_stray;
  end if;
end
$$;
