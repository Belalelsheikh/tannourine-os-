-- Batch B dry-run: apply 20261103120000_batch_b_branches_compare.sql in the same transaction,
-- then run this. It acts as a real coordinator under RLS, reports, and rolls back
-- (`raise exception 'RESULTS …'`), so nothing is kept.
do $$
declare
  c uuid; o int; v1 uuid := gen_random_uuid(); sku text;
  out text := ''; i int; j record;
begin
  -- An outlet with a completed, non-unclosed visit, so check 4 has a base to find.
  select r.coordinator_id, r.outlet_id into c, o
    from routes r join profiles p on p.id = r.coordinator_id
   where p.role = 'coordinator' and p.active
     and exists (select 1 from visits x
                  where x.outlet_id = r.outlet_id
                    and x.checkout_at is not null and not ('unclosed' = any(x.flags)))
   limit 1;
  if c is null then raise exception 'SETUP no routed outlet has a completed visit'; end if;
  select id into sku from skus where active order by id limit 1;
  -- Close the coordinator's open visits the way a supervisor does (`unclosed` skips the
  -- checkout guard's count and gate checks), so the insert below is not a second open visit.
  update visits set checkout_at = now(), flags = flags || '{unclosed}'
   where coordinator_id = c and checkout_at is null;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- No GPS fix: the fence never blocks.
  insert into visits (id, coordinator_id, outlet_id, checkin_at) values (v1, c, o, now() - interval '10 minutes');
  insert into visit_lines (visit_id, sku_id, shelf, warehouse, sold_cases)
  select v1, id, 3, 2, 1 from skus where active;

  -- 1. open visit: plain update and upsert both change the line
  update visit_lines set shelf = 4 where visit_id = v1 and sku_id = sku;
  get diagnostics i = row_count;
  out := out || '1 open_update_rows=' || i || '; ';
  insert into visit_lines (visit_id, sku_id, shelf, warehouse, sold_cases) values (v1, sku, 5, 2, 1)
    on conflict (visit_id, sku_id) do update set shelf = excluded.shelf;
  select shelf into i from visit_lines where visit_id = v1 and sku_id = sku;
  out := out || '1b open_upsert_shelf=' || i || '; ';

  insert into visit_photos (visit_id, kind, path) values (v1, 'gate', 'visits/' || v1 || '/g.jpg');
  update visits set checkout_at = now(), flags = '{}' where id = v1;

  -- 2. submitted visit: plain update touches nothing
  update visit_lines set shelf = 99 where visit_id = v1 and sku_id = sku;
  get diagnostics i = row_count;
  out := out || '2 closed_update_rows=' || i || '; ';
  -- 3. submitted visit: the app's upsert raises
  begin
    insert into visit_lines (visit_id, sku_id, shelf, warehouse, sold_cases) values (v1, sku, 99, 2, 1)
      on conflict (visit_id, sku_id) do update set shelf = excluded.shelf;
    out := out || '3 FAIL no error; ';
  exception when others then out := out || '3 ' || sqlstate || '; ';
  end;
  select shelf into i from visit_lines where visit_id = v1 and sku_id = sku;
  out := out || 'shelf_kept=' || i || '; ';

  execute 'reset role';
  -- 4. comparison helpers
  select * into j from previous_visits(array[v1]);
  if j.prev_id is null then raise exception 'FAIL 4 prev=none at outlet % (%)', o, out; end if;
  out := out || '4 prev=' || j.prev_id::text
              || ' lines=' || coalesce(jsonb_array_length(j.prev_lines), 0) || '; ';
  select count(*) into i from outlet_visit_summary() s where s.coordinator_id = c and s.outlet_id = o;
  out := out || '5 summary_row=' || i || '; ';
  raise exception 'RESULTS %', out;
end $$;
