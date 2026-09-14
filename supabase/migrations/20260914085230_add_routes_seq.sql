-- Visit order within a (coordinator_id, weekday) route.
-- Nullable with no default and no constraint changes: rows written by RoutesBuilder,
-- which does not yet set seq, keep seq = null and sort to the end (nullsFirst: false).
-- Follow-up: teach src/screens/mgmt/RoutesBuilder.tsx to write seq.
alter table routes add column if not exists seq int;
