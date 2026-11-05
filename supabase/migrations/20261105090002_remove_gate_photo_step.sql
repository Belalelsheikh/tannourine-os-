-- Batch A7: the gate photo is no longer part of a visit. Check-in rests on GPS and the fence.
-- Existing gate photos and the gate_required values on closed visits are kept as history.
-- Apply BEFORE deploying the app: the new app never takes a gate photo, so against the old
-- triggers every new visit would be refused at checkout.

create or replace function public.visits_checkin_fence()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  o outlets;
  d int;
begin
  if new.checkin_at is null or abs(extract(epoch from new.checkin_at - now())) > 300 then
    new.checkin_at := now();
  end if;
  new.gate_required := false;
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
end $function$;

create or replace function public.visits_checkout_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  d int;
begin
  if old.checkout_at is not null then return new; end if;

  new.checkin_at := old.checkin_at;
  new.checkin_lat := old.checkin_lat;
  new.checkin_lng := old.checkin_lng;
  new.checkin_reason := old.checkin_reason;
  new.outlet_id := old.outlet_id;
  if 'far_checkin' = any(old.flags) and not ('far_checkin' = any(new.flags)) then
    new.flags := new.flags || 'far_checkin'::text;
  end if;

  if new.checkout_at is null then return new; end if;
  if abs(extract(epoch from new.checkout_at - now())) > 300 then
    new.checkout_at := now();
  end if;
  if new.dwell_seconds is not null then
    new.dwell_seconds := greatest(0, round(extract(epoch from new.checkout_at - new.checkin_at)))::int;
  end if;

  if 'unclosed' = any(new.flags) then return new; end if;

  if (select count(*) from visit_lines l join skus s on s.id = l.sku_id
       where l.visit_id = new.id and s.active)
     < (select count(*) from skus where active) then
    raise exception 'visit_incomplete';
  end if;

  -- 240 s mirrors SHORT_VISIT_SECONDS in src/lib/geo.ts.
  new.flags := array_remove(new.flags, 'short_visit');
  if new.dwell_seconds is not null and new.dwell_seconds < 240 then
    new.flags := new.flags || 'short_visit'::text;
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
end $function$;

alter table public.visits alter column gate_required set default false;

-- Visits open right now are released, so nobody stays stuck on the camera.
update public.visits set gate_required = false where checkout_at is null and gate_required;
