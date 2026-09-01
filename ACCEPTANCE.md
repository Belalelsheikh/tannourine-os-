# ACCEPTANCE — PRD §15 items 1–10

**Executed:** 2026-09-01 against the live project `tlrhztjnzptuvkrkrjod`
**Schema:** base + `v1.1 PATCH` + `v1.2 PATCH` + `v1.3 PATCH` — all applied
**Build:** `npm run build` clean, 109 modules, 0 TS errors
**Result:** **30 / 30** acceptance checks · **8 / 8** RLS negatives · 0 FAIL

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

### Defect 1 — storage upsert refused, breaking the §15.9 retry path · **FIXED, APPLIED, RE-VERIFIED**

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

Applied to the database and re-run:

```
[PASS] photo re-upload with upsert — overwrote, no duplicate
```

§15.9 now passes in both halves.

### Defect 2 — storage policies are bucket-scoped, not owner-scoped · **OPEN**

Discovered while verifying Defect 1's fix. Executed:

```
nada uploads own photo : ok
rana overwrites it     : SUCCEEDED
```

Both `sto_ins` and `sto_upd` test only `bucket_id in ('visit-photos','pods')`. Any
authenticated user can therefore overwrite any other user's object — one coordinator can
replace another's shelf photo, including on an already-approved visit.

`sto_ins` always had this looseness for *new* paths, but before v1.3 an existing object was
effectively immutable because no UPDATE policy existed. **The v1.3 fix widened that window**:
it bought the §15.9 retry at the cost of making every stored photo overwritable. That is a
worse trade than it needs to be, because the retry only ever requires a user to overwrite
their **own** upload.

Recommended tightening — but **check first**, because if `owner` is not populated this
policy matches nothing and re-breaks §15.9:

```sql
-- 1. diagnose: are owner / owner_id populated on existing objects?
select id, name, owner, owner_id from storage.objects limit 5;

-- 2. then the matching variant (owner is uuid; owner_id is text)
drop policy if exists sto_upd on storage.objects;
create policy sto_upd on storage.objects for update to authenticated
  using      (bucket_id in ('visit-photos','pods') and owner = auth.uid())
  with check (bucket_id in ('visit-photos','pods') and owner = auth.uid());
```

Not applied. `schema.sql` still carries the permissive v1.3 that matches the live database;
it should not be tightened in the file until the variant is confirmed against a real row.

### Defect 3 — three bugs in my own harness (no product impact)

Recorded because each initially looked like a product result:

1. `acceptance-run.mjs` queried `invoice_open.invoice_id`; the view exposes `id` and
   `open_amount`. §15.5 reported NOT RUN until fixed; it passes.
2. The realtime check wrote immediately after `SUBSCRIBED`, which fires *before* the server
   finishes binding the `postgres_changes` filter. That raced and reported a FAIL. An
   isolated probe passed **6/6 across two roles at 200–600 ms** once a 1500 ms settle was
   added, so the earlier 501 ms pass was luck, not evidence. Real screens subscribe on mount
   and receive events long afterwards, so this never affected the app.
3. `acceptance-teardown.mjs` deleted visits only at outlets `[1,180]`, while the runner
   picked `central` with `limit(1)` and no `order by` — so successive runs used 180, 181,
   182 and the teardown silently left 2 visits, 4 lines, 2 follow-ups, 2 pins and 4 storage
   objects behind. The runner now orders deterministically and the teardown is exhaustive.

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
| Realtime: second client sees the check-in | PASS — 200-600 ms over 6 trials |
| Intake ordering / board layout | **NOT RUN** — UI |

Realtime was verified with two independent authenticated clients rather than two devices,
and separately probed 6/6 across two roles at 200-600 ms. The publication is live and events
are delivered — the silent-failure risk flagged in the previous revision is **cleared**.

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

## §15.9 — Failed write preserves form and retries · **PASS (data layer)**

| Check | Result |
|---|---|
| `visit_lines` resubmit converges, no PK collision | PASS — 2 lines, no duplicates |
| Photo re-upload with `upsert: true` | **PASS** — overwrote, no duplicate (after v1.3) |
| Form state preserved across a failed submit | **NOT RUN** — UI |

The `vlines_upd` policy added in v1.2 does its job, and the `sto_upd` policy added in v1.3
fixes the photo half. Both were executed twice — failing before the patch, passing after.

## §15.10 — «الفريق الآن» · **PASS (scope + realtime)**

| Check | Result |
|---|---|
| Assigned coordinators resolve to their supervisor | PASS |
| marwa (scope الكل) sees all 7 coordinators | PASS |
| Check-in on client A appears on client B | PASS — 200-600 ms (§15.3) |
| Row states, trail, maps link, honesty copy | **NOT RUN** — UI |

---

## Summary

| Item | Verdict |
|---|---|
| §15.7 RLS negatives | **8/8 PASS** |
| §15.1 – §15.6, §15.10 | **PASS at the data layer**; UI-layer checks NOT RUN |
| §15.8 PWA | **Partial PASS** — build artefacts pass, device install NOT RUN |
| §15.9 retry | **PASS** — lines converge and photo re-uploads |
| Edge function `admin-create-user` | **NOT RUN** — needs a Supabase PAT |

**30 PASS · 0 FAIL · 0 NOT RUN** from the runner, plus **8/8** from the negatives.

## Database state after this run

All test data was removed and reference data restored to seed values. Verified:

```
every transactional table (visits, visit_lines, orders, order_lines, invoices,
invoice_lines, collections, followups, routes, audit_log, containers, container_lines) = 0
outlets 255 · skus 8 · profiles 14
payment_path='unknown' = 121   outlets with a pin = 0   storage objects = 0
```

Re-run with `scripts/acceptance-run.mjs`, clean up with `scripts/acceptance-teardown.mjs`.

## What still has to happen

1. **Decide on Defect 2** — storage objects are overwritable by any authenticated user.
   Run the diagnostic above, then apply the owner-scoped `sto_upd` if `owner` is populated.
2. **Deploy `admin-create-user`** — needs a Supabase personal access token; the service key
   returns 401 against `api.supabase.com`.
3. **UI walkthrough on a real browser with network** — the client-side guards, photo
   compression, form-state preservation on failure, and the PWA install on Android/iOS.
4. **Aging fixture** — three delivered invoices for one chain at today / −45d / −100d for
   1,000 / 2,000 / 3,000 EGP; expect buckets 1,000 / 2,000 / 3,000 and 5,000 over 60 days.
5. **Rotate the service_role key** and update the edge function secret with the rotated one.
