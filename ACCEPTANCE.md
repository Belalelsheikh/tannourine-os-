# ACCEPTANCE — PRD §15 items 1–10

**Executed:** 2026-09-01 against the live project `tlrhztjnzptuvkrkrjod`
**Schema:** base + `v1.1 PATCH` + `v1.2 PATCH` + `v1.3 PATCH` (v1.3 written this run, **not yet applied** — see Defect 1)
**Build:** `npm run build` clean, 109 modules, 0 TS errors

## How to read this

| Verdict | Meaning |
|---|---|
| **PASS** | Executed against the live database, this run. Method stated. |
| **FAIL** | Executed and refused/misbehaved. |
| **NOT RUN** | Could not be executed here. Reason stated. Never inferred from code. |

**No item is marked PASS on the strength of having written the code.** Where a check
produced a result that was *technically* green but proved nothing, it was rewritten and
re-run rather than banked — see the note on vacuous passes below.

## Method and its limits

Everything below was driven through **real role sessions using the anon key** — the same
path the app takes — via `scripts/acceptance-run.mjs` and `scripts/rls-negatives.mjs`.
The service key was used only for test-fixture setup and teardown, never in an app path.

**The UI layer was not exercised.** Chromium is present in this environment but has no
network: the egress proxy is process-aware interception rather than a listening socket, so
a raw `connect()` to it returns `ECONNREFUSED` and the browser reports
`ERR_PROXY_CONNECTION_FAILED` on every outbound request. The app's login screen renders
correctly (verified: `dir=rtl`, `lang=ar`, Arabic copy, both inputs) but no session can be
established, so client-side form guards, photo compression, and cross-device UI behaviour
are **NOT RUN** and are listed as such. Realtime *is* reachable from Node, so the
two-device check was executed with two independent authenticated clients instead of two
browsers — stated per item.

### On vacuous passes

Two read negatives initially "passed" against empty tables, where 0 rows proves nothing.
`scripts/rls-negatives.mjs` now establishes what a privileged session can see before
accepting an empty result, and reports INCONCLUSIVE otherwise. Both were re-run and pass
for the right reason. This is the same class of error §6 of the project handoff warned
about, and it did survive the first pass here too.

---

## Defects found this run

### Defect 1 — storage upsert refused, breaking the §15.9 retry path · **FIXED IN SCHEMA, NOT YET APPLIED**

`sto_ins` covers INSERT only. Supabase Storage `upload(..., { upsert: true })` against an
**existing** object performs an UPDATE on `storage.objects`, for which no policy existed.
Executed result:

```
[FAIL] photo re-upload with upsert — new row violates row-level security policy
```

Impact: a coordinator whose submit fails part-way (§15.9's airplane-mode case) cannot
re-upload the shelf photo. The retry does **not** converge — which is precisely the property
§15.9 asserts. The first upload succeeds; only the retry fails, so this would not appear
in a happy-path walkthrough.

Fix appended to `schema.sql` as the **v1.3 PATCH** section:

```sql
drop policy if exists sto_upd on storage.objects;
create policy sto_upd on storage.objects for update to authenticated
  using      (bucket_id in ('visit-photos','pods'))
  with check (bucket_id in ('visit-photos','pods'));
```

**This has not been applied to the database** — applying DDL needs the dashboard or a
Management API token, neither available to the runner. §15.9's photo half stays **FAIL**
until it is applied and re-run.

### Defect 2 — my own harness bug (no product impact)

`acceptance-run.mjs` queried `invoice_open.invoice_id`; the view exposes `id` and
`open_amount`. Fixed, re-run, and §15.5 passes. Recorded because the first run reported it
as NOT RUN and that could have been mistaken for a product problem.

---

## §15.7 — RLS negatives · **8 / 8 PASS**

The highest-value item: the only one that tests the v1.1/v1.2 patches directly.
Executed via `scripts/rls-negatives.mjs`.

| # | As | Attempt | Result |
|---|---|---|---|
| 1 | nada (coordinator) | `update invoices → dispatched` | PASS — refused, 0 rows |
| 2 | nada | `update collections → cleared` | PASS — refused, 0 rows |
| 3 | nada | `select audit_log` | PASS — 0 rows (privileged session sees 1) |
| 4 | amr (invoice) | `insert into collections` | PASS — refused `42501` |
| 5 | amr | `update invoices → void` | PASS — refused `42501` (WITH CHECK) |
| 6 | amr | `pending order → invoiced` | PASS — refused, 0 rows (USING needs `approved`) |
| 7 | anonymous | `select invoice_open` | PASS — refused |
| 8 | anonymous | `select outlets` | PASS — 0 rows (privileged session sees 50) |

Items 5–8 exist because of the v1.1/v1.2 patches and would have passed incorrectly against
the original schema. They pass correctly here.

## §15.1 — Coordinator: visit pipeline · **PASS (data layer)** / UI guards NOT RUN

| Check | Result |
|---|---|
| Coordinator opens a visit with GPS | PASS |
| Shelf 0 with no `zero_reason` refused by DB `check` | PASS — `23514` |
| `visit_lines` upsert (2 lines) | PASS |
| Photo upload to `visit-photos` | PASS |
| Visit submit / checkout with dwell | PASS — dwell 420s |
| Central-outlet zero raises a `followups` row | PASS |
| Client-side guards (empty field, zero-without-reason, missing photo) | **NOT RUN** — needs a browser session |
| Client-side photo compression | **NOT RUN** — needs a browser session |

The DB `check` constraint is the second line of defence and it holds. The first line — the
form refusing to submit — is unverified.

## §15.2 — Supervisor: approve, pin set once · **PASS**

| Check | Result |
|---|---|
| Supervisor approves a submitted visit | PASS |
| `set_outlet_pin()` writes the pin | PASS — lat 30.0444 |
| Second approval does **not** move the pin | PASS — unchanged |
| `reset_outlet_pin()` is mgmt-only | PASS — coordinator refused `P0001` |
| Feed rendering, badges, 4h unclosed, silent banner | **NOT RUN** — UI |

## §15.3 — Router: intake, board, realtime · **PASS**

| Check | Result |
|---|---|
| Coordinator raises a pending order | PASS |
| Router approves it (pending → approved) | PASS |
| Realtime: second client sees the check-in | PASS — **501 ms** |
| Intake ordering / board layout | **NOT RUN** — UI |

Realtime was verified with two independent authenticated clients rather than two devices.
This confirms the publication is live and events are delivered — the silent-failure risk
flagged in the previous revision is **cleared**.

## §15.4 — Invoice: claim race, POD, void · **PASS**

| Check | Result |
|---|---|
| Invoice role claims `approved → invoiced` | PASS |
| Second claim of the same order loses the race | PASS — 0 rows |
| Create invoice | PASS |
| POD uploads to `pods` | PASS |
| Mark delivered with POD | PASS |
| Void flow via المالية → تصحيحات | **NOT RUN** — UI (RLS half covered by §15.7 #5) |

The `.eq('status','approved')` claim is genuinely race-safe: the second attempt returns 0 rows.

## §15.5 — Finance: cheque lifecycle, returned reopens · **PASS**

| Check | Result |
|---|---|
| Finance records a cheque (`received`) | PASS |
| `received → deposited` | PASS |
| `deposited → cleared` | PASS |
| Returned cheque reopens the invoice | PASS — `open_amount` 0 → 1500 |
| Aging bucket arithmetic | **NOT RUN** — needs the 3-invoice dated fixture |

`invoice_open` excludes `returned` collections in SQL, confirmed by observation rather than
by reading the view.

## §15.6 — mgmt · **PASS (data layer)**

| Check | Result |
|---|---|
| mgmt writes a route | PASS |
| mgmt assigns `profiles.supervisor_id` (v1.2 clause) | PASS |
| mgmt edits `payment_path` | PASS |
| Coordinator **cannot** edit `payment_path` | PASS — refused |
| User creation via edge function | **NOT RUN** — function not deployed |
| Route builder / container UI | **NOT RUN** — UI |

## §15.8 — PWA · **Partial PASS**

| Check | Result |
|---|---|
| Build produces manifest, SW, 12 precache entries | PASS |
| Icons 192 / 512 / maskable-512 present in `dist/` | PASS |
| `dir=rtl`, `lang=ar`, Arabic copy render | PASS — observed in Chromium |
| Install on a real Android handset / iPhone | **NOT RUN** — needs devices |
| Auto-update across two real deploys | **NOT RUN** |

## §15.9 — Failed write preserves form and retries · **PARTIAL — one half FAILS**

| Check | Result |
|---|---|
| `visit_lines` resubmit converges, no PK collision | PASS — 2 lines, no duplicates |
| Photo re-upload with `upsert: true` | **FAIL** — see Defect 1 |
| Form state preserved across a failed submit | **NOT RUN** — UI |

The `vlines_upd` policy added in v1.2 does its job. The photo half does not, and the item
cannot pass until the v1.3 patch is applied.

## §15.10 — «الفريق الآن» · **PASS (scope + realtime)**

| Check | Result |
|---|---|
| Assigned coordinators resolve to their supervisor | PASS |
| marwa (scope الكل) sees all 7 coordinators | PASS |
| Check-in on client A appears on client B | PASS — 501 ms (§15.3) |
| Row states, trail, maps link, honesty copy | **NOT RUN** — UI |

---

## Summary

| Item | Verdict |
|---|---|
| §15.7 RLS negatives | **8/8 PASS** |
| §15.1 – §15.6, §15.10 | **PASS at the data layer**; UI-layer checks NOT RUN |
| §15.8 PWA | **Partial PASS** — build artefacts pass, device install NOT RUN |
| §15.9 retry | **PARTIAL** — lines converge, **photo re-upload FAILS** |
| Edge function `admin-create-user` | **NOT RUN** — needs a Supabase PAT |

**28 PASS · 1 FAIL · 1 NOT RUN** from the runner, plus 8/8 from the negatives.

## Database state after this run

All test data was removed and reference data restored to seed values. Verified:

```
visits/visit_lines/orders/order_lines/invoices/collections/followups/routes/audit_log  = 0
outlets 255 · skus 8 · profiles 14
payment_path='unknown' = 121   outlets with a pin = 0   storage objects = 0
```

Re-run with `scripts/acceptance-run.mjs`, clean up with `scripts/acceptance-teardown.mjs`.

## What still has to happen

1. **Apply the v1.3 patch** (the `sto_upd` policy) in the dashboard SQL editor, then re-run
   `acceptance-run.mjs` — §15.9's photo half should flip to PASS. This is a stop-ship until done.
2. **Deploy `admin-create-user`** — needs a Supabase personal access token; the service key
   returns 401 against `api.supabase.com`.
3. **UI walkthrough on a real browser with network** — the client-side guards, photo
   compression, form-state preservation on failure, and the PWA install on Android/iOS.
4. **Aging fixture** — three delivered invoices for one chain at today / −45d / −100d for
   1,000 / 2,000 / 3,000 EGP; expect buckets 1,000 / 2,000 / 3,000 and 5,000 over 60 days.
5. **Rotate the service_role key** and update the edge function secret with the rotated one.
