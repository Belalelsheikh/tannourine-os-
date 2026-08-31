# ACCEPTANCE — PRD §15 items 1–10

Build: v1.2 package · `schema.sql` sha256 `fe5c4494…` · 2026-08-31

## How to read this

There is **no live Supabase project** in this environment — no project URL, no keys, no
provisioned users, no seeded rows. Every item below therefore carries one of three verdicts,
and none of them is inflated:

| Verdict | Meaning |
|---|---|
| **PASS** | A check was actually executed here. The method is stated. |
| **READY — manual** | Code is complete and type-checked; the behaviour needs a human on a real device or a second device. Steps given. |
| **BLOCKED — needs live project** | Cannot be executed at all until Steps 1–9 of `README-DEPLOY.md` are done. |

**No item is marked PASS on the strength of having written the code.**

## What was executed here

| Check | Result |
|---|---|
| `npm install` (path contains spaces) | PASS — 370 packages, exit 0 |
| `npm run build` (`tsc -b && vite build`) | PASS — clean, 0 TS errors, 0 warnings |
| App boots, React mounts, no console errors | PASS — only the intentional "env missing" error in the unconfigured build |
| RTL + Arabic typography | PASS — `dir=rtl`, `lang=ar`, IBM Plex Sans Arabic rendering (screenshotted) |
| Design tokens match PRD §11 / pilot | PASS — ported verbatim from `reference/pilot.html` |
| PWA manifest | PASS — name «تنورين مصر», short_name «تنورين», standalone, portrait-primary, theme `#10222E`, start_url `/` |
| PWA icons | PASS — 192 / 512 / 512-maskable all fetch 200 `image/png` |
| Service worker | PASS — registered, scope `/`, state `activated` |
| Lighthouse (mobile, navigation) | PASS — Accessibility 96, Best Practices 96 |
| One `<main>` landmark | PASS |

---

## §15.1 — Coordinator: route → check-in → form validation → submit

**BLOCKED — needs live project** (login, `routes`, and storage are all server-side).

Code complete: `src/screens/coordinator/RouteToday.tsx`, `VisitForm.tsx`, `OrderForm.tsx`.

Sub-checks and where each is enforced:

| Requirement | Implementation |
|---|---|
| Today's route renders from `routes` | `RouteToday.tsx` filters `routes` on `coordinator_id` + `new Date().getDay()` |
| Check-in captures GPS | `getPosition()` — high accuracy, 10s cap, resolves `null` rather than blocking |
| Empty field blocks | `VisitForm.submit()` rejects any `null` shelf/warehouse/sold before any write |
| Zero without reason blocks | Same guard; the DB `check` constraint is the second line of defence |
| Missing photo blocks | `if (!photo) return` before the upload step |
| Stores visit + lines + photo + dwell + flags | Ordered pipeline: photo upsert → `visit_lines` upsert → `visits` update |
| Order creates pending order | `OrderForm` inserts `orders` with `source='coordinator'` |
| Central outlet shows no order option | `canOrder = ordering_mode !== 'central'` |
| Central zeros create a follow-up | Step 4 of the pipeline; skipped when an `open` follow-up already exists |

Step 4 runs after the visit is committed, so it cannot roll the visit back — but it is **not**
silent: if the follow-up insert fails, the coordinator gets «الزيارة اتبعتت — لكن التنبيه ما
اتسجلش … بلّغ المشرف» rather than a success toast. Nothing else would ever retry that row, and
it is the entire input to مروه's تنبيهات queue.

**Manual steps:** log in as `nada`, open a routed branch, tap «بدء الزيارة», allow location,
leave one field blank → expect «في خانات فاضية»; set a shelf to 0 without a chip → expect
«حدد سبب الصفر»; remove the photo → expect «صورة الرف مطلوبة»; then complete and submit.

## §15.2 — Supervisor: feed, badges, pin on approval, silent banner, 4h unclosed

**BLOCKED — needs live project.**

Code complete: `src/screens/supervisor/Feed.tsx`.

Photo (signed URL), dwell, distance badge, and flag pills all render per visit. Approval calls
`set_outlet_pin(p_outlet, p_lat, p_lng)`; the RPC itself is `where id = p_outlet and lat is null`,
so only the *first* approved visit with coordinates sets the pin. The silent banner compares
today's routed coordinators against today's visits. Unclosed visits surface after 4h via
`FOUR_HOURS_MS`.

Open visits are queried **without a date filter**, deliberately: a visit started at 8pm and never
submitted must not vanish at midnight from either the supervisor's feed or the coordinator's
resume banner, or it would sit `pending` forever with no path to close it. Today's visits and
open visits are two separate queries so the silent-team banner still counts only today.

> ⚠️ The 4h check runs when the screen renders or a realtime event arrives. A supervisor who
> leaves the tab open and untouched past the 4h mark sees the row on the next event or refresh,
> not on a timer. This matches "auto-flag in supervisor feed" but is worth knowing.

**Manual steps:** submit a visit as a coordinator on device A; approve on device B; confirm the
branch gains a pin in **الفروع**; approve a second visit at the same branch and confirm the pin
does *not* move.

## §15.3 — Router: intake, board approve/reject, realtime on a second device

**BLOCKED — needs live project and two devices.**

Code complete: `src/screens/router/Intake.tsx`, `Board.tsx`.

Intake puts `central`/`mixed` outlets first and `rep` outlets under «فروع أوردر مندوب (استثناء)»,
exactly as PRD §6 specifies. Realtime is wired in `src/lib/app.tsx` — one channel subscribing to
`visits`, `orders`, and `collections`, bumping a tick that every screen query and every tab badge
depends on.

**Prerequisite:** `alter publication supabase_realtime add table …` must have run (it is in the
v1.1 section of `schema.sql`; verify per README Step 5). Without it this item fails **silently** —
no error appears, badges simply never move.

## §15.4 — Invoice: create, dispatch, deliver blocks without POD, void

**BLOCKED — needs live project.**

Code complete: `src/screens/invoice/ToInvoice.tsx`, `Invoices.tsx`, `finance/Corrections.tsx`.

Creation follows the CLAUDE.md ordering note: the order is claimed first with
`.eq('status','approved')` so a double-click or a second operator loses the race cleanly
(«الأوردر اتفوتر أو اتغير من حد تاني») rather than producing two invoices. Line prices are
snapshotted from the current SKU price into `invoice_lines.price_case`.

Delivery uploads the POD **before** flipping status, so a failed upload cannot produce a
delivered invoice with no proof. Void lives in **المالية → تصحيحات**, requires a reason, and
writes `audit_log`. Voids leave both aging and book stock automatically — `invoice_open` and
`book_stock` filter `status <> 'void'` in SQL, not in the client.

## §15.5 — Finance: cheque lifecycle, returned reopens, transfers, aging, legacy

**BLOCKED — needs live project.** Aging arithmetic additionally needs a hand-computed fixture.

Code complete: `src/screens/finance/{Cheques,Transfers,Aging,Corrections}.tsx`.

`received → deposited → cleared | returned` is implemented as status updates with the matching
timestamps. A returned cheque reopens the invoice with no write-back: `invoice_open` sums only
collections `where status <> 'returned'`.

**Fixture to hand-check aging:** create three delivered invoices for one chain dated today,
45 days ago, and 100 days ago, at 1,000 / 2,000 / 3,000 EGP. Expect buckets 0-30 = 1,000,
31-60 = 2,000, +90 = 3,000; per-chain row = 3 invoices, 6,000 open, 5,000 over 60 days.

## §15.6 — mgmt: user create, route builder, container, payment_path, supervisor assignment

**Split verdict.**

- User create via edge function — **BLOCKED**: needs the function deployed (README Step 7).
- Route builder, container entry, `payment_path` editing, supervisor assignment —
  **BLOCKED — needs live project**; all four are implemented in
  `src/screens/mgmt/{Team,RoutesBuilder,Stock,Outlets}.tsx`.

The v1.2 acceptance clause — *supervisor assignment from الفريق writes `profiles.supervisor_id`
and reshapes both supervisors' «الفريق الآن» boards* — is implemented as the «المشرف» select on
every coordinator row in **الفريق**. Until it is used, `coordinatorsInScope()` falls back to
governorate and both Cairo supervisors see the same board; **الفريق** shows a standing banner
saying exactly that, with the count of unassigned coordinators.

## §15.7 — RLS negatives

**BLOCKED — needs live project.** This item must be tested against the database, not the UI.

The UI does not offer these actions to the wrong role, but that is not the test. Run each as the
named user, with a real session, and expect a **failure**:

| # | As | Attempt | Expected |
|---|---|---|---|
| 1 | `nada` (coordinator) | `update invoices set status='dispatched'` | 0 rows / policy error |
| 2 | `nada` | `update collections set status='cleared'` | 0 rows / policy error |
| 3 | `nada` | `select * from audit_log` | 0 rows |
| 4 | `amr` (invoice) | `insert into collections …` | policy error |
| 5 | `amr` | `update invoices set status='void'` | rejected by `inv_upd` WITH CHECK |
| 6 | `amr` | flip a `pending` order to `invoiced` | rejected by `orders_upd` USING (needs `approved`) |
| 7 | anonymous | `select * from invoice_open` | 0 rows (`security_invoker`, anon revoked) |
| 8 | anonymous | `select * from outlets` | 0 rows |

Items 5–8 exist specifically because of the v1.1/v1.2 patches; they would have passed
incorrectly against the original schema.

## §15.8 — PWA installs on Android + iOS; auto-update; laptop tables

**Split verdict.**

- Installability preconditions — **PASS** (manifest, icons, active SW; see the table above).
- Auto-update on redeploy — **PASS by construction**: `registerType: 'autoUpdate'` +
  `cleanupOutdatedCaches`. Not observed across two real deploys.
- Actual install on an Android handset and an iPhone (iOS ≥16.4) — **READY — manual**;
  steps are in README-DEPLOY Step 10.
- Laptop tables for office roles — **READY — manual**: `.phone.wide` at ≥900px is in
  `styles.css` and applied to `router`, `invoice`, `finance`, `mgmt`. Not screenshotted, because
  reaching a role screen requires a login.

## §15.9 — Failed write preserves the form and retries successfully

**READY — manual** (airplane mode, real device).

Designed for, throughout:

- Every submit keeps its state in React until the server confirms; nothing is cleared in a
  `finally`.
- Failures render «… — البيانات محفوظة، اضغط إرسال تاني» and the form stays filled, photo included.
- The visit pipeline is **idempotent**, which is what makes the retry safe rather than merely
  possible: the photo uploads with `upsert: true`, `visit_lines` uses
  `upsert(rows, { onConflict: 'visit_id,sku_id' })`, and the `visits` update is a plain
  overwrite. A retry after a partial failure converges instead of colliding on the composite
  primary key.
- `vlines_upd` (added in the v1.2 patch) is what permits that upsert. Without it this item fails
  on the second attempt with a PK violation.

**Manual steps:** fill a visit form completely, enable airplane mode, tap «إرسال», confirm the
error line and that every field and the photo thumbnail survive; disable airplane mode; tap
«إرسال» again; confirm one visit, one set of lines, and one photo — no duplicates.

## §15.10 — «الفريق الآن» (v1.2)

**BLOCKED — needs live project and two devices.**

Code complete: `src/screens/supervisor/TeamNow.tsx`, embedded into **اللوحة** for mgmt.

| Requirement | Implementation |
|---|---|
| Scope: assigned coordinators win, else governorate, marwa/mgmt see all | `coordinatorsInScope()` in `src/lib/scope.ts` |
| Check-in on device A appears on B within seconds | Realtime on `visits` → tick → re-query |
| Maps link opens last event coords | `https://maps.google.com/?q={lat},{lng}`, rendered only when coords exist |
| Routed coordinator with no events shows red | «لم يبدأ اليوم» + `.bad` accent |
| Row states (a)(b)(c) | «في زيارة الآن» + منذ HH:MM / «آخر نشاط» / «لم يبدأ اليوم» |
| Trail on tap | Chronological events with time, outlet, dwell, distance badge |
| Honesty copy | «آخر موقع مسجَّل، لا يوجد تتبع مستمر» |
| No polling, no background geolocation | Only a 30s **display** clock for the elapsed label; all data arrives by realtime push |

> Note: cheque events carry no coordinates (the `collections` table has no lat/lng), so the maps
> link only ever appears for visit events. This is consistent with the PRD's "when coords exist".

---

## Summary

| Item | Verdict |
|---|---|
| Build, PWA, icons, SW, RTL, a11y | **PASS** (executed) |
| §15.1–§15.7, §15.10 | **BLOCKED — needs live project** |
| §15.8 | **Partial PASS** (installability) + manual device install |
| §15.9 | **READY — manual** (airplane mode) |

## What unblocks the rest

Work through `README-DEPLOY.md` Steps 1–9, then re-run this document top to bottom. The single
highest-value check afterwards is **§15.7** — it is the only one that tests the v1.1/v1.2 patches
directly, and it is the one a UI walkthrough cannot substitute for.
