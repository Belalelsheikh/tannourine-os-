-- Cheque custody moves from coordinators to supervisors (decided by Belal, 20 Oct 2026):
-- supervisors collect cheques from branches; coordinators never receive one. The intake
-- screen moved from the coordinator tabs to the supervisor tabs in the same change.
--
-- Replaces col_ins_coord (20261019120000_p0_insert_guards.sql) with col_ins_sup. Same
-- guards — a new cheque starts in custody, in the inserting user's own name — only the role
-- changes. The collections_check_invoice trigger (delivered invoice, same outlet, amount ≤
-- open) applies unchanged. col_ins_fin is untouched.

drop policy if exists col_ins_coord on collections;
drop policy if exists col_ins_sup on collections;
create policy col_ins_sup on collections for insert to authenticated
  with check (
    my_role() = 'supervisor' and type = 'cheque' and received_by = auth.uid()
    and status = 'received' and deposited_at is null and settled_at is null
  );

-- Drift guard, as in p0_insert_guards: any other permissive insert policy on collections
-- would bypass this one.
do $$
declare
  v_stray text;
begin
  select string_agg(policyname || ' (' || cmd || ')', ', ')
    into v_stray
  from pg_policies
  where schemaname = 'public' and tablename = 'collections'
    and permissive = 'PERMISSIVE'
    and cmd in ('INSERT','ALL')
    and policyname not in ('col_ins_sup', 'col_ins_fin');

  if v_stray is not null then
    raise exception 'cheques_by_supervisors: unexpected permissive insert policies on collections: %', v_stray;
  end if;
end
$$;
