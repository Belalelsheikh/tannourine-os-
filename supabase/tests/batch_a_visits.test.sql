-- Batch A dry-run: apply the three 20261028 migrations inside a transaction, run as a real
-- coordinator under RLS, report, and roll back. Run the migrations first in the same
-- transaction; the block ends with `raise exception 'RESULTS …'` so nothing is ever kept.
do $$
declare
  c uuid; c2 uuid; o int; v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid();
  out text := ''; msg text; j jsonb; i int;
begin
  select r.coordinator_id, r.outlet_id into c, o
    from routes r join profiles p on p.id = r.coordinator_id
   where p.role = 'coordinator' and p.active limit 1;
  select id into c2 from profiles where role = 'coordinator' and id <> c limit 1;
  update outlets set lat = 30.0, lng = 31.0, pin_verified = false where id = o;
  update visits set checkout_at = now() where coordinator_id = c and checkout_at is null and outlet_id = o;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. unverified pin, 200 m, no reason → refused with reason prompt
  begin
    insert into visits (id, coordinator_id, outlet_id, checkin_at, checkin_lat, checkin_lng)
    values (v1, c, o, now() - interval '10 minutes', 30.0018, 31.0);
    out := out || '1 FAIL no error; ';
  exception when others then out := out || '1 ' || sqlerrm || '; ';
  end;
  -- 2. same with reason → allowed, far_checkin
  insert into visits (id, coordinator_id, outlet_id, checkin_at, checkin_lat, checkin_lng, checkin_reason)
  values (v1, c, o, now() - interval '10 minutes', 30.0018, 31.0, 'الفرع جوه المول');
  select array_to_string(flags, ',') into msg from visits where id = v1;
  out := out || '2 flags=' || msg || '; ';

  -- 5. checkout with no lines
  begin
    update visits set checkout_at = now(), checkout_lat = 30.0018, checkout_lng = 31.0, flags = '{}' where id = v1;
    out := out || '5 FAIL; ';
  exception when others then out := out || '5 ' || sqlerrm || '; ';
  end;
  insert into visit_lines (visit_id, sku_id, shelf, warehouse, sold_cases)
  select v1, id, 3, 2, 1 from skus where active;
  -- 6. lines ok, no gate photo
  begin
    update visits set checkout_at = now(), checkout_lat = 30.0018, checkout_lng = 31.0, flags = '{}' where id = v1;
    out := out || '6 FAIL; ';
  exception when others then out := out || '6 ' || sqlerrm || '; ';
  end;
  insert into visit_photos (visit_id, kind, path) values (v1, 'gate', 'visits/' || v1 || '/g.jpg');
  -- second gate → unique violation
  begin
    insert into visit_photos (visit_id, kind, path) values (v1, 'gate', 'visits/' || v1 || '/g2.jpg');
    out := out || 'gate2 FAIL; ';
  exception when others then out := out || 'gate2 ' || sqlstate || '; ';
  end;
  for i in 1..6 loop
    insert into visit_photos (visit_id, kind, path) values (v1, 'shelf', 'visits/' || v1 || '/s' || i || '.jpg');
  end loop;
  -- 8. seventh non-gate photo
  begin
    insert into visit_photos (visit_id, kind, path) values (v1, 'shelf', 'visits/' || v1 || '/s7.jpg');
    out := out || '8 FAIL; ';
  exception when others then out := out || '8 ' || sqlstate || '; ';
  end;
  -- wrong folder
  begin
    insert into visit_photos (visit_id, kind, path) values (v1, 'other', 'visits/xyz/s.jpg');
    out := out || 'path FAIL; ';
  exception when others then out := out || 'path ' || sqlstate || '; ';
  end;
  -- gate cannot be deleted, shelf can
  delete from visit_photos where visit_id = v1 and kind = 'gate';
  delete from visit_photos where visit_id = v1 and path like '%/s6.jpg';
  select count(*) into i from visit_photos where visit_id = v1;
  out := out || 'del rows_left=' || i || '; ';
  -- 7. checkout 400 m from check-in, client drops far_checkin from flags
  update visits set checkout_at = now(), checkout_lat = 30.0054, checkout_lng = 31.0, flags = '{short_visit}' where id = v1;
  select array_to_string(flags, ',') || ' d=' || checkout_distance_m into msg from visits where id = v1;
  out := out || '7 ' || msg || '; ';

  -- storage folder checks
  out := out || 'sto own_new=' || visit_photo_upload_ok('visits/' || gen_random_uuid() || '/a.jpg')
              || ' closed=' || visit_photo_upload_ok('visits/' || v1 || '/a.jpg')
              || ' junk=' || visit_photo_upload_ok('visits/abc/a.jpg') || '; ';

  -- 9. last visit RPC
  j := last_visit_for_outlet(o);
  out := out || '9 id_match=' || ((j->>'id')::uuid = v1) || ' lines=' || jsonb_array_length(j->'lines')
              || ' who=' || coalesce(j->>'coordinator_name', '?') || '; ';
  -- off-route outlet → null
  select id into i from outlets where id not in (select outlet_id from routes where coordinator_id = c) limit 1;
  out := out || '9b offroute=' || coalesce(last_visit_for_outlet(i)::text, 'null') || '; ';

  -- 12. other coordinator's visit is invisible / unwritable
  if c2 is not null then
    execute 'reset role';
    insert into visits (id, coordinator_id, outlet_id, checkin_at) values (v2, c2, o, now());
    execute 'set local role authenticated';
    out := out || '12 sto_other=' || visit_photo_upload_ok('visits/' || v2 || '/a.jpg') || ' ';
    begin
      insert into visit_photos (visit_id, kind, path) values (v2, 'shelf', 'visits/' || v2 || '/x.jpg');
      out := out || 'row FAIL; ';
    exception when others then out := out || 'row ' || sqlstate || '; ';
    end;
  end if;

  -- 3/4. verified pin
  execute 'reset role';
  update outlets set pin_verified = true where id = o;
  execute 'set local role authenticated';
  begin
    insert into visits (coordinator_id, outlet_id, checkin_at, checkin_lat, checkin_lng, checkin_reason)
    values (c, o, now(), 30.0018, 31.0, 'any');
    out := out || '3 FAIL; ';
  exception when others then out := out || '3 ' || sqlerrm || '; ';
  end;
  insert into visits (coordinator_id, outlet_id, checkin_at, checkin_lat, checkin_lng)
  values (c, o, now(), 30.0004, 31.0);
  out := out || '4 50m ok; ';
  -- coordinator cannot confirm a pin
  begin
    perform confirm_outlet_pin(o, 30, 31);
    out := out || 'confirm FAIL; ';
  exception when others then out := out || 'confirm ' || sqlerrm || '; ';
  end;

  execute 'reset role';
  out := out || '11 proposed=' || propose_outlet_pins() || ' gate_req_old=' ||
    (select count(*) from visits where not gate_required) || ' photos_backfilled=' ||
    (select count(*) from visit_photos where kind = 'shelf' and path not like 'visits/%') || ' cron=' ||
    (select count(*) from cron.job where jobname = 'propose-outlet-pins');
  raise exception 'RESULTS %', out;
end $$;
