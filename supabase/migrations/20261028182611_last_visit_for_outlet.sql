-- Batch A2: «آخر زيارة» on the visit screen.
--
-- visits_sel limits a coordinator to their own visits, but the reference they need is the
-- outlet's last count by anyone. This reads it as the definer and opens it to a coordinator
-- only for outlets on their routes; every other role can already read visits.
-- An off-route visit gets no panel. «قفل الزيارة» (unclosed) visits carry no count, so skip them.

create or replace function last_visit_for_outlet(p_outlet int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v visits;
begin
  if auth.uid() is null then return null; end if;
  if my_role() = 'coordinator'
     and not exists (select 1 from routes r where r.coordinator_id = auth.uid() and r.outlet_id = p_outlet) then
    return null;
  end if;

  select * into v from visits
   where outlet_id = p_outlet and checkout_at is not null and not ('unclosed' = any(flags))
   order by checkout_at desc
   limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'id', v.id,
    'checkin_at', v.checkin_at,
    'checkout_at', v.checkout_at,
    'dwell_seconds', v.dwell_seconds,
    'coordinator_name', (select full_name from profiles where id = v.coordinator_id),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku_id', l.sku_id, 'shelf', l.shelf, 'warehouse', l.warehouse,
        'sold_cases', l.sold_cases, 'zero_reason', l.zero_reason))
        from visit_lines l where l.visit_id = v.id
    ), '[]'::jsonb)
  );
end $$;
revoke execute on function last_visit_for_outlet(int) from public, anon;
grant  execute on function last_visit_for_outlet(int) to authenticated;
