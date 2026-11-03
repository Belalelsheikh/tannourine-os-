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

## Build notes from Batch A6 (2026-11-02: gate photo source, form clarity)
- Gate photo is camera-only: the main path is the in-page camera (`LiveCamera`, getUserMedia, `visit_photos.source = 'live'`), because a file input's `capture` is only a hint and some Android browsers offer the gallery through it. The file input is a visible fallback after getUserMedia fails, never automatic; it refuses files older than 120 s by `lastModified` (checked before `compressImage`, which drops metadata) and records `source = 'file'` + `file_age_s`. Every gate row carries `sha256` for reuse detection. Never add an `<input type="file">` without `capture` to the gate step.
- With LiveCamera the page is no longer killed by a camera app, but keep A5's order: draft + `visit_active` + insert on the first camera tap.
- Visit form errors name the SKU and field via `firstIncomplete()` (src/lib/visitDraft.ts); last-visit counts are a line under the SKU name, never a Stepper placeholder (it read as a typed value).

## Build notes from Batch B/C (2026-11-03: branches, comparison, reports)
- Migrations `20261103120000_batch_b_branches_compare.sql` and `20261103120100_reports.sql` must be applied **before** this build ships: «الفروع» calls `outlet_visit_summary()`, the Feed calls `previous_visits()`, «التقارير» reads `report_lines`, and the «الصنف مش في الفرع» button now saves that value, which the old `visit_lines_zero_reason_check` refuses.
- Visit lines lock at checkout: `vlines_upd` requires `checkout_at is null`. VisitForm writes lines before the checkout update, so a failed checkout retries as before; a retry whose checkout already landed gets an RLS error on the upsert, and the form then reads the server's `checkout_at` and finishes instead of failing. `vlines_ins` still has no `checkout_at` check.
- Comparison base («قبل ← دلوقتي») = the outlet's previous completed visit not flagged `unclosed`, by `checkout_at` — the same rule as `last_visit_for_outlet`. Markers (stock rose, same numbers, first visit) inform only; no auto-reject, no per-coordinator score. Logic: `src/lib/compare.ts`.
- A line whose shelf + warehouse rose vs the last visit makes a `kind='shelf'` photo required at submit (client-side only; the checkout trigger does not check it, so an old cached client can skip it). Off-route visits get no last visit, so the rule cannot fire there.
- «تثبيت الموقع» on the branch page confirms the existing pin, else `pin_proposed_lat/lng`, else the client median of ≥3 loaded check-ins. supervisor/mgmt only (router sees no button).
- «المواقع» and reports compute distance on read against the outlet's **current** pin (haversine), not the stored `distance_m`. The branch page's check-in list shows stored `distance_m`.
- Reports: never add shelf or warehouse across SKUs; sold is labelled «حسب تسجيل المنسق». `report_lines` has one row per line, so the 17 legacy visits submitted with no lines are not in it. Planned stops use today's routes for every day in the range (routes keep no history).
- mgmt's outlet editor tab is now «بيانات الفروع»; «الفروع» is the visit view.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`Belalelsheikh/tannourine-os-`), driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
