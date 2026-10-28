-- Batch A3: many photos per visit, with a camera-only gate photo taken at check-in.
--
-- visit_photos replaces visits.photo_path. photo_path stays for one release: the app keeps
-- writing the first non-gate photo there so photo-rate stats and any cached old client keep
-- working, then a later migration drops it.
--
-- Paths are `visits/<visit_id>/<photo_id>.jpg` in bucket visit-photos. The gate photo is
-- uploaded *before* the visit row exists (the app mints the visit id), so the storage insert
-- policy cannot require an existing visit; it only refuses a folder that names somebody
-- else's visit or a closed one. Ownership is enforced on the visit_photos row.
--
-- If the storage.objects statements fail with `must be owner of table objects` (CLAUDE.md
-- v1.2 note), apply the two storage policies at the bottom from Dashboard → Storage →
-- Policies with the same USING / WITH CHECK expressions, then record this version in
-- supabase_migrations.schema_migrations by hand.

-- ---------- table ----------
create table if not exists visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  kind text not null check (kind in ('gate','shelf','cooler','other')),
  path text not null,
  taken_at timestamptz default now(),
  lat double precision,
  lng double precision
);
create index if not exists visit_photos_visit_idx on visit_photos (visit_id, taken_at);
-- One gate photo per visit: a retried check-in hits this instead of adding a second.
create unique index if not exists visit_photos_one_gate on visit_photos (visit_id) where kind = 'gate';

-- Backfill: every existing single photo becomes a shelf photo.
insert into visit_photos (visit_id, kind, path, taken_at, lat, lng)
select v.id, 'shelf', v.photo_path, coalesce(v.checkout_at, v.checkin_at), v.checkout_lat, v.checkout_lng
  from visits v
 where v.photo_path is not null
   and not exists (select 1 from visit_photos p where p.visit_id = v.id and p.path = v.photo_path);

-- Visits that existed before this migration never had a gate photo; only new ones need one
-- to check out (enforced in 20261028182608_geofence.sql).
alter table visits add column if not exists gate_required boolean not null default true;
update visits set gate_required = false where gate_required;

-- ---------- RLS ----------
alter table visit_photos enable row level security;

drop policy if exists vphotos_sel on visit_photos;
create policy vphotos_sel on visit_photos for select to authenticated
  using (exists (
    select 1 from visits v
     where v.id = visit_id
       and (v.coordinator_id = auth.uid() or my_role() in ('supervisor','mgmt','router'))
  ));

-- A policy on visit_photos cannot select from visit_photos (42P17 recursion), so the
-- 6-photo cap counts through a definer function.
create or replace function visit_photo_extra_count(p_visit uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from visit_photos where visit_id = p_visit and kind <> 'gate'
$$;
revoke execute on function visit_photo_extra_count(uuid) from public, anon;
grant  execute on function visit_photo_extra_count(uuid) to authenticated;

-- Own visit, still open, path under that visit's folder, at most 6 non-gate photos.
drop policy if exists vphotos_ins on visit_photos;
create policy vphotos_ins on visit_photos for insert to authenticated
  with check (
    path like 'visits/' || visit_id::text || '/%'
    and exists (
      select 1 from visits v
       where v.id = visit_id and v.coordinator_id = auth.uid()
         and v.status = 'pending' and v.checkout_at is null
    )
    and (kind = 'gate'
         or visit_photo_extra_count(visit_id) < 6)
  );

-- Removing a photo from a count still in progress is a draft edit, not evidence: allowed only
-- on the caller's own open visit, never the gate photo. The storage object is left in place.
drop policy if exists vphotos_del on visit_photos;
create policy vphotos_del on visit_photos for delete to authenticated
  using (
    kind <> 'gate'
    and exists (
      select 1 from visits v
       where v.id = visit_id and v.coordinator_id = auth.uid()
         and v.status = 'pending' and v.checkout_at is null
    )
  );

-- ---------- storage ----------
-- Sees every visit (RLS would hide other coordinators' visits and let their folders through).
create or replace function visit_photo_upload_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select my_role() = 'coordinator' and case
    when (storage.foldername(p_name))[1] = 'visits' then
      (storage.foldername(p_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and not exists (
        select 1 from visits v
         where v.id::text = (storage.foldername(p_name))[2]
           and (v.coordinator_id <> auth.uid() or v.checkout_at is not null)
      )
    -- Legacy root `<visit_id>.jpg` from a cached old client; drop with photo_path.
    else exists (
      select 1 from visits v
       where p_name = v.id::text || '.jpg'
         and v.coordinator_id = auth.uid() and v.checkout_at is null
    )
  end
$$;
revoke execute on function visit_photo_upload_ok(text) from public, anon;
grant  execute on function visit_photo_upload_ok(text) to authenticated;

drop policy if exists sto_ins on storage.objects;
create policy sto_ins on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pods'
    or (bucket_id = 'visit-photos' and public.visit_photo_upload_ok(name))
  );

-- Visit photos: supervisors and above, plus the uploader (draft thumbnails after a reload).
-- Root-level legacy objects stay readable by the same roles.
drop policy if exists sto_sel on storage.objects;
create policy sto_sel on storage.objects for select to authenticated
  using (
    bucket_id = 'pods'
    or (bucket_id = 'visit-photos' and (
      public.my_role() in ('supervisor','mgmt','router')
      or owner_id = auth.uid()::text
      or owner = auth.uid()
    ))
  );
