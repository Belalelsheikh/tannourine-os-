-- Batch 1 (docs/review/2026-10-app-review.md §7), storage half: F09.
--
-- Live has an `sto_upd` policy that is not in schema.sql and lets any authenticated user
-- UPDATE any object in visit-photos / pods, so visit and POD evidence can be overwritten.
-- Replace it with one scoped to the uploader. Upload retries keep working: uploadPhoto()
-- uses upsert, and a retry comes from the same user who wrote the object first.
--
-- Owner match covers both columns: newer storage-api writes `owner_id` (text) and may leave
-- the deprecated `owner` (uuid) null. Both name the uploader, so either matching is enough.
--
-- If this fails with `must be owner of table objects` (see CLAUDE.md v1.2 note), apply it
-- from Dashboard → Storage → Policies instead: delete `sto_upd`, then add an UPDATE policy
-- for role `authenticated` on buckets visit-photos and pods with this USING and WITH CHECK:
--   bucket_id in ('visit-photos','pods')
--   and (owner = auth.uid() or owner_id = auth.uid()::text)
-- and record the version in supabase_migrations.schema_migrations by hand.

drop policy if exists sto_upd on storage.objects;
create policy sto_upd on storage.objects for update to authenticated
  using (
    bucket_id in ('visit-photos','pods')
    and (owner = auth.uid() or owner_id = auth.uid()::text)
  )
  with check (
    bucket_id in ('visit-photos','pods')
    and (owner = auth.uid() or owner_id = auth.uid()::text)
  );

-- Drift guard: any other permissive UPDATE/ALL policy on storage.objects would reopen F09.
do $$
declare
  v_stray text;
begin
  select string_agg(policyname || ' (' || cmd || ')', ', ')
    into v_stray
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and permissive = 'PERMISSIVE'
    and cmd in ('UPDATE','ALL')
    and policyname <> 'sto_upd';

  if v_stray is not null then
    raise exception 'p0_storage_upd_owner: unexpected permissive update policies on storage.objects: %', v_stray;
  end if;
end
$$;
