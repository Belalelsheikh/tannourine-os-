-- Batch A5 dry-run: apply 20261029090000_checkin_server_time.sql inside a transaction, run as a
-- real coordinator under RLS, report, and roll back. Same pattern as batch_a_visits.test.sql:
-- the block ends with `raise exception 'RESULTS …'` so nothing is ever kept.
-- Expected: 1 ok; 2 ok; 3 gate_photo_required; 4 ok dwell=600 short=false; 5 dwell=60 short=true;
do $$
declare
  c uuid; o int; v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid();
  out text := ''; t timestamptz; d int; f text[];
begin
  select r.coordinator_id, r.outlet_id into c, o
    from routes r join profiles p on p.id = r.coordinator_id
   where p.role = 'coordinator' and p.active limit 1;
  update outlets set lat = null, lng = null, pin_verified = false where id = o;
  update visits set checkout_at = now(), flags = flags || '{unclosed}'::text[]
   where coordinator_id = c and checkout_at is null;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. phone 58 min fast → server time
  insert into visits (id, coordinator_id, outlet_id, checkin_at)
  values (v1, c, o, now() + interval '58 minutes');
  select checkin_at into t from visits where id = v1;
  out := out || '1 ' || case when abs(extract(epoch from t - now())) <= 5 then 'ok' else 'FAIL ' || t end || '; ';

  -- 2. phone 2 min ahead → client value kept
  insert into visits (id, coordinator_id, outlet_id, checkin_at)
  values (v2, c, o, now() + interval '2 minutes');
  select checkin_at into t from visits where id = v2;
  out := out || '2 ' || case when t = now() + interval '2 minutes' then 'ok' else 'FAIL ' || t end || '; ';

  -- 3. complete count, no gate photo → still refused
  insert into visit_lines (visit_id, sku_id, shelf, warehouse, sold_cases)
  select v1, id, 3, 2, 1 from skus where active;
  begin
    update visits set checkout_at = now(), dwell_seconds = 1, flags = '{}' where id = v1;
    out := out || '3 FAIL no error; ';
  exception when others then out := out || '3 ' || sqlerrm || '; ';
  end;

  -- 4. gate photo in, checked in 10 min ago; the phone checks out 58 min fast with a dwell and
  --    short_visit computed off its own clock → checkout_at = now(), dwell 600, no short_visit.
  insert into visit_photos (visit_id, kind, path) values (v1, 'gate', 'visits/' || v1 || '/g.jpg');
  execute 'reset role';
  alter table visits disable trigger visits_checkout_guard;   -- it freezes checkin_at while open
  update visits set checkin_at = now() - interval '10 minutes' where id = v1;
  alter table visits enable trigger visits_checkout_guard;
  execute 'set local role authenticated';
  update visits set checkout_at = now() + interval '58 minutes', dwell_seconds = 4080, flags = '{short_visit}'
   where id = v1;
  select dwell_seconds, flags, checkout_at into d, f, t from visits where id = v1;
  out := out || '4 ' || case when t = now() then 'ok' else 'FAIL ' || t end
              || ' dwell=' || d || ' short=' || ('short_visit' = any(f)) || '; ';

  -- 5. a genuinely short visit still gets short_visit even if the phone left it out
  insert into visit_lines (visit_id, sku_id, shelf, warehouse, sold_cases)
  select v2, id, 3, 2, 1 from skus where active;
  insert into visit_photos (visit_id, kind, path) values (v2, 'gate', 'visits/' || v2 || '/g.jpg');
  update visits set checkout_at = now() + interval '3 minutes', dwell_seconds = 60, flags = '{}' where id = v2;
  select dwell_seconds, flags into d, f from visits where id = v2;
  out := out || '5 dwell=' || d || ' short=' || ('short_visit' = any(f)) || '; ';

  execute 'reset role';
  raise exception 'RESULTS %', out;
end $$;
