-- Save one coordinator's route for one weekday atomically.
--
-- RoutesBuilder previously ran delete-then-insert from the client: an insert that failed
-- after the delete landed left the day empty and destroyed its seq values, which are
-- planning work a human produced. Both statements now sit inside one function call, so a
-- failure rolls the delete back too.
--
-- Seq rules match the client behaviour they replace:
--   • an outlet already on the day keeps its seq
--   • additions take max(seq)+1 upward, in p_outlets order
--   • removals leave gaps, which ordering ignores
--   • a day whose rows are all seq null stays null — numbering it here would present an
--     arbitrary order to the coordinator as though someone had planned his route
--
-- SECURITY INVOKER on purpose: routes RLS (w_routes_ins / w_routes_del, mgmt+router only)
-- must still apply to the caller. This function must never become SECURITY DEFINER — that
-- would hand every authenticated role, coordinators included, the ability to rewrite any
-- coordinator's route.
create or replace function save_route_day(
  p_coordinator uuid,
  p_weekday     int,
  p_outlets     int[]
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prev        jsonb;    -- outlet_id::text -> seq, existing rows that carried an order
  v_was_ordered boolean;
  v_next        int;      -- first seq handed to an addition
begin
  if p_coordinator is null or p_weekday is null then
    raise exception 'save_route_day: coordinator and weekday are required';
  end if;

  if p_outlets is not null
     and cardinality(p_outlets) <> (select count(distinct x) from unnest(p_outlets) as x)
  then
    raise exception 'save_route_day: p_outlets contains duplicate outlet ids';
  end if;

  select coalesce(jsonb_object_agg(outlet_id::text, seq) filter (where seq is not null), '{}'::jsonb),
         coalesce(bool_or(seq is not null), false),
         coalesce(max(seq), 0) + 1
    into v_prev, v_was_ordered, v_next
  from routes
  where coordinator_id = p_coordinator and weekday = p_weekday;

  delete from routes
  where coordinator_id = p_coordinator and weekday = p_weekday;

  if p_outlets is null or cardinality(p_outlets) = 0 then
    return;
  end if;

  insert into routes (coordinator_id, weekday, outlet_id, seq)
  select p_coordinator,
         p_weekday,
         i.outlet_id,
         case
           when not v_was_ordered then null
           when v_prev ? i.outlet_id::text then (v_prev ->> i.outlet_id::text)::int
           -- nth addition (in array order) takes v_next + n - 1
           else v_next - 1 + (count(*) filter (where not (v_prev ? i.outlet_id::text))
                              over (order by i.ord rows unbounded preceding))
         end
  from unnest(p_outlets) with ordinality as i(outlet_id, ord);
end $$;

revoke execute on function save_route_day(uuid, int, int[]) from public, anon;
grant  execute on function save_route_day(uuid, int, int[]) to authenticated;
