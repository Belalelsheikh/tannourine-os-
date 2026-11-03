-- Batch B: «الفروع», visit-to-visit comparison, counts locked after submit.
--
-- B6. vlines_upd also requires the visit to be open (checkout_at is null). VisitForm writes
-- every line before the checkout update, so a failed checkout still retries freely; once
-- the checkout lands, a coordinator can no longer rewrite the count the supervisor reviews.
-- An `upsert` (INSERT … ON CONFLICT DO UPDATE) on a submitted visit now raises instead of
-- updating; the app checks the server's checkout_at on that error (lost-response retry).
--
-- B1/B3 read helpers are security invoker: supervisor, router and mgmt already read every
-- visit through visits_sel, and a coordinator calling them sees only their own.
-- A comparison base is a completed visit that was not closed by the supervisor (`unclosed`),
-- the same rule as last_visit_for_outlet.

-- ---------- B6 ----------
drop policy if exists vlines_upd on visit_lines;
create policy vlines_upd on visit_lines for update to authenticated
  using (exists (select 1 from visits v
                 where v.id = visit_id and v.coordinator_id = auth.uid()
                   and v.status = 'pending' and v.checkout_at is null))
  with check (exists (select 1 from visits v
                 where v.id = visit_id and v.coordinator_id = auth.uid()
                   and v.status = 'pending' and v.checkout_at is null));

-- ---------- B3: the visit before each of these, at the same outlet ----------
-- "Before" is by checkout_at, not "latest at the outlet": a queued visit from three days ago
-- is compared with what came before it, not with a newer visit.
create or replace function previous_visits(p_visits uuid[])
returns table (
  visit_id uuid,
  prev_id uuid,
  prev_checkin_at timestamptz,
  prev_checkout_at timestamptz,
  prev_coordinator_id uuid,
  prev_lines jsonb
) language sql stable set search_path = public as $$
  select v.id, p.id, p.checkin_at, p.checkout_at, p.coordinator_id,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'sku_id', l.sku_id, 'shelf', l.shelf, 'warehouse', l.warehouse,
             'sold_cases', l.sold_cases, 'zero_reason', l.zero_reason))
             from visit_lines l where l.visit_id = p.id
         ), '[]'::jsonb)
    from visits v
    join lateral (
      select * from visits x
       where x.outlet_id = v.outlet_id and x.id <> v.id
         and x.checkout_at is not null and not ('unclosed' = any(x.flags))
         and x.checkout_at < v.checkout_at
       order by x.checkout_at desc
       limit 1
    ) p on true
   where v.id = any(p_visits) and v.checkout_at is not null
$$;
revoke execute on function previous_visits(uuid[]) from public, anon;
grant  execute on function previous_visits(uuid[]) to authenticated;

-- ---------- B1: last completed visit per coordinator and outlet ----------
-- One row per (coordinator, outlet) they completed a visit at, so «الفروع» never pages past
-- PostgREST's 1000-row cap as visits grow.
create or replace function outlet_visit_summary()
returns table (coordinator_id uuid, outlet_id int, last_checkin_at timestamptz, n int)
language sql stable set search_path = public as $$
  select v.coordinator_id, v.outlet_id, max(v.checkin_at), count(*)::int
    from visits v
   where v.checkout_at is not null and not ('unclosed' = any(v.flags))
   group by v.coordinator_id, v.outlet_id
$$;
revoke execute on function outlet_visit_summary() from public, anon;
grant  execute on function outlet_visit_summary() to authenticated;

create index if not exists visits_outlet_checkout_idx on visits (outlet_id, checkout_at desc);
