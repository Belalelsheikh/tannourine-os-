-- Batch A5: check-in and check-out times come from the server clock.
--
-- checkin_at / checkout_at were whatever the phone said. One coordinator's clock runs ~58 min
-- fast, so his dwell times, visit order and the nightly pin proposal all read wrong. The
-- triggers now keep the client value only when it is within 5 minutes of now() (a slow
-- network should not move the stamp) and otherwise use now().
--
-- dwell_seconds and short_visit were computed on the phone from (phone checkout − checkin);
-- once checkin_at is the server's, a fast phone would inflate dwell by its offset. The
-- checkout guard now recomputes both from the two stored stamps.
--
-- Forward only. Backfill below fixes visits since 28 Oct whose gate photo reached storage
-- before their stamped check-in, one audit_log row each.

-- ---------- check-in ----------
create or replace function visits_checkin_fence()
returns trigger language plpgsql set search_path = public as $$
declare
  o outlets;
  d int;
begin
  if new.checkin_at is null or abs(extract(epoch from new.checkin_at - now())) > 300 then
    new.checkin_at := now();
  end if;
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

-- ---------- check-out ----------
-- As 20261028182608, plus: checkout_at clamped like checkin_at; dwell_seconds (when the client
-- sent one — the supervisor's close leaves it null) and short_visit derived from the stamps.
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
  if new.gate_required
     and not exists (select 1 from visit_photos p where p.visit_id = new.id and p.kind = 'gate') then
    raise exception 'gate_photo_required';
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
end $$;

-- ---------- backfill ----------
-- A gate photo in storage before its own check-in means the phone clock was ahead: the old
-- client stamped checkin_at before opening the camera and uploaded before inserting the row.
-- Move checkin_at to the upload time and checkout_at by the same offset (dwell is unchanged).
-- Supervisor-closed (`unclosed`) visits shift too; their checkout_at was the supervisor's
-- clock, so that one moves by the coordinator's offset — harmless, it carries no dwell.
-- The guard freezes checkin_at on open visits, so it is off for this one statement.
alter table visits disable trigger visits_checkout_guard;

with fix as (
  select v.id, v.checkin_at as old_in, v.checkout_at as old_out, o.created_at as new_in
    from visits v
    join visit_photos p on p.visit_id = v.id and p.kind = 'gate'
    join storage.objects o on o.bucket_id = 'visit-photos' and o.name = p.path
   where v.checkin_at >= timestamptz '2026-10-28 00:00:00+02'
     and o.created_at < v.checkin_at
), upd as (
  update visits v
     set checkin_at = f.new_in,
         checkout_at = f.old_out - (f.old_in - f.new_in)
    from fix f
   where v.id = f.id
  returning v.id
)
insert into audit_log (actor, action, entity, entity_id, detail)
select null::uuid, 'fix_clock', 'visits', f.id::text, jsonb_build_object(
         'old_checkin_at', f.old_in, 'new_checkin_at', f.new_in,
         'old_checkout_at', f.old_out, 'new_checkout_at', f.old_out - (f.old_in - f.new_in),
         'offset_seconds', round(extract(epoch from f.old_in - f.new_in)))
  from fix f join upd u on u.id = f.id;

alter table visits enable trigger visits_checkout_guard;
