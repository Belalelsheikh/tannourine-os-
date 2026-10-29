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

## Build notes from Batch A (2026-10-28: drafts, last visit, photos, geofence)
- One exception to "GPS never blocks": a check-in > 150 m from a **verified** pin (`outlets.pin_verified`) is refused by the `visits_checkin_fence` trigger. Unverified pins only ask for `checkin_reason`; no pin or no GPS fix never blocks. Check-out is never blocked.
- Pins are verified only through `confirm_outlet_pin()` (supervisor/mgmt, audited). `propose_outlet_pins()` runs nightly via pg_cron and only writes `pin_proposed_lat/lng`.
- Photos live in `visit_photos` under `visit-photos/visits/<visit_id>/`. `visits.photo_path` is kept for one release (first non-gate photo) and then dropped.
- The open visit's form is mirrored to `localStorage` `visit_draft:<visit_id>`; the checkout trigger refuses an incomplete count or a missing gate photo.
- Check-in order (A5, 2026-10-29): **row first, then photo.** On the camera tap, in the same gesture: write `gate_draft:<visit_id>` + `visit_active`, `click()` the file input synchronously (iOS refuses it after an await), then send the visits insert. The upload and gate row follow when the photo returns (`completeGate`). Phones kill the page while the camera is open; the reload resumes the open visit (or the gate draft if the insert never landed) on the photo step. Never move the insert back behind the camera.
- `checkin_at` / `checkout_at` are the server's when the phone is > 5 min off; `dwell_seconds` and `short_visit` are recomputed from the stored stamps by `visits_checkout_guard`. Don't trust phone time for ordering or dwell.
- `compressImage` (src/lib/compress.ts) resizes during decode via `createImageBitmap` where supported; the `<img>` path is the fallback. Don't decode full-resolution captures on the main path.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`Belalelsheikh/tannourine-os-`), driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
