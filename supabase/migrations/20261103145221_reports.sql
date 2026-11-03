-- Batch C: «التقارير» (mgmt, read-only) and a separate «الصنف مش في الفرع» zero reason.
--
-- DEPLOY ORDER: apply this before the app build that ships with it. The new build saves
-- «الصنف مش في الفرع» from the existing button, which the old constraint refuses.

-- ---------- C4: zero reason ----------
-- Until now the «الصنف مش في الفرع» button saved «الفرع لم يطلب», so the two read as one in
-- every count. Old lines keep what they were saved with; reports show both values apart.
alter table visit_lines drop constraint if exists visit_lines_zero_reason_check;
alter table visit_lines add constraint visit_lines_zero_reason_check
  check (zero_reason in ('المخزن فاضي','الفرع لم يطلب','أوردر متأخر','مساحة الرف','الصنف مش في الفرع'));

-- ---------- C1: report_lines ----------
-- One row per visit_line on a completed visit (supervisor-closed `unclosed` visits excluded).
-- security_invoker: the caller's RLS applies (visits_sel lets mgmt read every visit).
-- Visits with no lines (the 17 submitted before the checkout trigger required a full count)
-- have no row here. Outlet pin columns are the current pin, for distance computed on read.
create or replace view report_lines with (security_invoker = true) as
select
  l.visit_id,
  v.coordinator_id,
  c.full_name                                   as coordinator_name,
  c.supervisor_id,
  s.full_name                                   as supervisor_name,
  v.outlet_id,
  o.name                                        as outlet_name,
  o.chain,
  o.gov,
  o.lat                                         as outlet_lat,
  o.lng                                         as outlet_lng,
  l.sku_id,
  k.name_ar                                     as sku_name,
  k.line                                        as sku_line,
  (v.checkin_at at time zone 'Africa/Cairo')::date as cairo_date,
  v.checkin_at,
  v.checkout_at,
  l.shelf,
  l.warehouse,
  l.sold_cases,
  l.zero_reason,
  v.dwell_seconds,
  v.off_route,
  v.flags,
  v.status,
  v.checkin_lat,
  v.checkin_lng,
  v.checkout_lat,
  v.checkout_lng,
  (select count(*) from visit_photos p where p.visit_id = v.id and p.kind <> 'gate')::int as extra_photos
from visit_lines l
join visits   v on v.id = l.visit_id
join profiles c on c.id = v.coordinator_id
left join profiles s on s.id = c.supervisor_id
join outlets  o on o.id = v.outlet_id
join skus     k on k.id = l.sku_id
where v.checkout_at is not null and not ('unclosed' = any(v.flags));

revoke all on report_lines from public, anon;
grant select on report_lines to authenticated;
