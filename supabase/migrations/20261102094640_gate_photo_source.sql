-- Batch A6: where the gate photo came from.
--
-- `capture="environment"` on a file input is only a hint; some Android browsers show a chooser
-- with the gallery, so an old photo could pass as today's gate. The app now takes the gate
-- photo from an in-page camera (getUserMedia, source 'live') and only falls back to the file
-- input when that camera fails (source 'file'), with the file's age at pick time. sha256 of
-- the uploaded JPEG lets review spot the same picture on two visits.
--
-- Existing rows all came through the file input, hence the 'file' default; non-gate photos
-- keep it (the gallery is allowed there). Additive only; RLS unchanged.

alter table visit_photos add column if not exists source text not null default 'file'
  check (source in ('live','file'));
alter table visit_photos add column if not exists file_age_s int;
alter table visit_photos add column if not exists sha256 text;
create index if not exists visit_photos_sha256_idx on visit_photos (sha256) where sha256 is not null;
