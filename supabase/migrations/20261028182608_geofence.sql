-- Batch A4: geofence — soft on check-in, flag on check-out, pins proposed from visit data.
--
-- Only 46 of 264 active outlets have a pin, and at least one is 30 km off, so no existing
-- pin is trusted: every outlet starts pin_verified = false and the fence hardens per outlet
-- as a supervisor confirms its pin (confirm_outlet_pin, the B2 «تثبيت الموقع» button).
--
--   check-in, no pin                        → allowed
--   check-in, unverified pin, > 150 m       → allowed with checkin_reason, flag far_checkin
--   check-in, verified pin,   > 150 m       → refused (checkin_blocked:<m>)
--   check-in, no GPS fix                    → allowed (no_checkin_gps at checkout, as before)
--   check-out, > 300 m from the check-in point → never blocked, flag far_checkout
--
-- 150 m, not less: urban GPS in Cairo malls and fuel-station stores is routinely 30–80 m off.
-- The app checks the same thresholds first for the Arabic prompt; these triggers are the
-- authority, so an old cached client cannot skip them.

alter table outlets add column if not exists pin_verified boolean not null default false;
alter table outlets add column if not exists pin_proposed_lat double precision;
alter table outlets add column if not exists pin_proposed_lng double precision;
alter table visits  add column if not exists checkin_reason text;
alter table visits  add column if not exists checkout_distance_m integer;

create or replace function geo_distance_m(lat1 double precision, lng1 double precision,
                                          lat2 double precision, lng2 double precision)
returns integer language sql immutable as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::int
$$;

-- ---------- check-in ----------
create or replace function visits_checkin_fence()
returns trigger language plpgsql set search_path = public as $$
declare
  o outlets;
  d int;
begin
  new.gate_required := true;
  new.checkin_reason := nullif(btrim(new.checkin_reason), '');
  select * into o from outlets where id = new.outlet_id;
  if o.lat is null or o.lng is null or new.checkin_lat is null or new.checkin_lng is null then
    return new;
  end if;
  d := geo_distance_m(new.checkin_lat, new.checkin_lng, o.lat, o.lng);
  if d <= 150 then return new; end if;
  if o.pin_verified then
    raise exception 'checkin_blocked:%', d;
  end if;
  if new.checkin_reason is null then
    raise exception 'checkin_reason_required:%', d;
  end if;
  if not ('far_checkin' = any(new.flags)) then new.flags := new.flags || 'far_checkin'::text; end if;
  return new;
end $$;

drop trigger if exists visits_checkin_fence on visits;
create trigger visits_checkin_fence before insert on visits
  for each row execute function visits_checkin_fence();

-- visits_ins required flags = '{}'; the trigger above may add far_checkin before the check.
drop policy if exists visits_ins on visits;
create policy visits_ins on visits for insert to authenticated
  with check (
    coordinator_id = auth.uid() and my_role() = 'coordinator' and status = 'pending'
    and reviewed_by is null and reviewed_at is null
    and checkout_at is null and checkout_lat is null and checkout_lng is null
    and dwell_seconds is null and distance_m is null and checkout_distance_m is null
    and flags <@ array['far_checkin']::text[]
  );

-- ---------- check-out ----------
-- While a visit is open the check-in facts are frozen and far_checkin cannot be dropped.
-- The coordinator's checkout (checkout_at null → set) must carry a full count and, for visits
-- checked in after Batch A, a gate photo. The supervisor's «قفل الزيارة» (flag unclosed)
-- closes an unfinished visit and skips both checks.
create or replace function visits_checkout_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  d int;
begin
  if old.checkout_at is not null then return new; end if;

  new.checkin_at := old.checkin_at;
  new.checkin_lat := old.checkin_lat;
  new.checkin_lng := old.checkin_lng;
  new.checkin_reason := old.checkin_reason;
  new.outlet_id := old.outlet_id;
  new.gate_required := old.gate_required;
  if 'far_checkin' = any(old.flags) and not ('far_checkin' = any(new.flags)) then
    new.flags := new.flags || 'far_checkin'::text;
  end if;

  if new.checkout_at is null or 'unclosed' = any(new.flags) then return new; end if;

  if (select count(*) from visit_lines l join skus s on s.id = l.sku_id
       where l.visit_id = new.id and s.active)
     < (select count(*) from skus where active) then
    raise exception 'visit_incomplete';
  end if;
  if new.gate_required
     and not exists (select 1 from visit_photos p where p.visit_id = new.id and p.kind = 'gate') then
    raise exception 'gate_photo_required';
  end if;

  if new.checkin_lat is not null and new.checkout_lat is not null then
    d := geo_distance_m(new.checkin_lat, new.checkin_lng, new.checkout_lat, new.checkout_lng);
    new.checkout_distance_m := d;
    if d > 300 and not ('far_checkout' = any(new.flags)) then
      new.flags := new.flags || 'far_checkout'::text;
    end if;
  else
    new.checkout_distance_m := null;
  end if;
  return new;
end $$;

drop trigger if exists visits_checkout_guard on visits;
create trigger visits_checkout_guard before update on visits
  for each row execute function visits_checkout_guard();

-- ---------- pins ----------
-- B2 «تثبيت الموقع»: the supervisor confirms the proposal (or a pin dragged on the map).
create or replace function confirm_outlet_pin(p_outlet int, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
declare
  o outlets;
begin
  if my_role() not in ('supervisor','mgmt') then raise exception 'not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'bad coordinates';
  end if;
  select * into o from outlets where id = p_outlet for update;
  if not found then raise exception 'outlet not found'; end if;
  update outlets
     set lat = p_lat, lng = p_lng, pin_verified = true, pin_set_by = auth.uid(), pin_set_at = now()
   where id = p_outlet;
  insert into audit_log (actor, action, entity, entity_id, detail)
  values (auth.uid(), 'confirm_pin', 'outlets', p_outlet::text, jsonb_build_object(
    'old_lat', o.lat, 'old_lng', o.lng, 'lat', p_lat, 'lng', p_lng,
    'proposed_lat', o.pin_proposed_lat, 'proposed_lng', o.pin_proposed_lng));
end $$;
revoke execute on function confirm_outlet_pin(int, double precision, double precision) from public, anon;
grant  execute on function confirm_outlet_pin(int, double precision, double precision) to authenticated;

-- A reset pin is no longer verified.
create or replace function reset_outlet_pin(p_outlet int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'mgmt' then raise exception 'not allowed'; end if;
  update outlets set lat = null, lng = null, pin_set_by = null, pin_set_at = null, pin_verified = false
   where id = p_outlet;
end $$;
revoke execute on function reset_outlet_pin from public, anon;
grant  execute on function reset_outlet_pin to authenticated;

-- Nightly proposal: median of the last 30 days' check-in points for every unverified outlet
-- with 3+ completed visits, recomputed after dropping points > 1 km from the first median.
create or replace function propose_outlet_pins()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  with pts as (
    select v.outlet_id, v.checkin_lat as lat, v.checkin_lng as lng
      from visits v join outlets o on o.id = v.outlet_id
     where not o.pin_verified
       and v.checkout_at is not null and not ('unclosed' = any(v.flags))
       and v.checkin_lat is not null and v.checkin_lng is not null
       and v.checkin_at >= now() - interval '30 days'
  ), med as (
    select outlet_id,
           percentile_cont(0.5) within group (order by lat) as lat,
           percentile_cont(0.5) within group (order by lng) as lng
      from pts group by outlet_id having count(*) >= 3
  ), inliers as (
    select p.outlet_id,
           percentile_cont(0.5) within group (order by p.lat) as lat,
           percentile_cont(0.5) within group (order by p.lng) as lng
      from pts p join med m using (outlet_id)
     where geo_distance_m(p.lat, p.lng, m.lat, m.lng) <= 1000
     group by p.outlet_id
  )
  update outlets o
     set pin_proposed_lat = i.lat, pin_proposed_lng = i.lng
    from inliers i
   where o.id = i.outlet_id and not o.pin_verified;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function propose_outlet_pins() from public, anon, authenticated;

create extension if not exists pg_cron;
-- 23:00 UTC = 01:00/02:00 Cairo, after the field day. Re-running the migration replaces the job.
select cron.schedule('propose-outlet-pins', '0 23 * * *', 'select public.propose_outlet_pins()');
