# CLAUDE.md — build instructions

Read PRD.md fully before writing code. It is the single source of truth; schema.sql is the database contract — run it as-is, do not redesign tables or RLS.

## Non-negotiables
- Arabic RTL only, Egyptian-Arabic copy per PRD §11 tone. Design tokens exactly as PRD §11 (no Tailwind, no component library).
- Stack locked (PRD §2): React18+Vite+TS, supabase-js v2, vite-plugin-pwa.
- GPS never blocks a workflow; flags inform (PRD §5). Photos compressed client-side before upload.
- No hard deletes; voids + audit_log only. Service key never in client code.
- Failed writes must preserve form state (PRD §15.9).

## Repo layout
src/ (app) · schema.sql · seed/ (skus.seed.sql, outlets.seed.sql, outlets.json) · scripts/ (users.json, provision-users.mjs) · supabase/functions/admin-create-user/ · README-DEPLOY.md

## Order of work
Follow PRD §17 exactly. After each phase, run the matching acceptance items from §15.

## Verification before declaring done
- `npm run build` clean; Lighthouse PWA installable pass.
- Walk acceptance §15 items 1–10; write results into ACCEPTANCE.md with pass/fail per item.
- Test RLS negatives with a coordinator session (item 7).

## Build notes from schema review (v1.1)
- Outlet ids start at 0 (داندى مول is id 0): always test `outletId != null`, never truthiness.
- Pin setting goes through `set_outlet_pin()` RPC on supervisor approval; never UPDATE outlets directly from supervisor context.
- Invoice creation: set order status='invoiced' (allowed for invoice role) then insert invoice + lines; on any failure, surface retry without losing state.
- schema.sql includes the v1.1 patch section at the end — run the whole file once on a fresh project.

## Build notes from schema review (v1.2)
- `storage.objects` policies can fail with `must be owner of table objects` on some Supabase projects. Fallback: create the same insert/select policies via Dashboard → Storage → Policies (authenticated INSERT and SELECT on buckets `visit-photos` and `pods`). README-DEPLOY.md must document exactly that fallback.
- Single source of truth is `prd/` inside `tannourine-build-package.zip`. Any loose `PRD.md` / `schema.sql` must be sha256-identical to the zip's copies; on mismatch the zip wins.
- Visit submit is an UPDATE on the coordinator's own `pending` visit where `checkout_at is null`; retries after a partial failure may re-write `visit_lines` (policy `vlines_upd` allows upsert while the visit is still `pending`).
- Invoice role may only move an order from `approved` to `invoiced` — the RLS `using`/`with check` pair enforces both ends.
