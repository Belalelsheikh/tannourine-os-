# PATCHLOG — v1.2 patch application

Applied: 2026-08-31. Base: `prd/schema.sql` from the zip (18,709 b, contained `v1.1 PATCH`).

## 0. Base selection

The loose `schema.sql` was the stale 14,239-byte pre-v1.1 version
(`17bb67ed…`). It was overwritten from the zip before patching, per instruction.
The loose `PRD.md` already matched the zip (`a9d3bb0e…`).

## 1. Changes applied

| # | Target | Change |
|---|---|---|
| 1 | `schema.sql` | Appended `v1.2 PATCH` section verbatim: `vlines_upd`, `visits_upd_own` (now gated on `checkout_at is null`), `orders_upd` (invoice role: `approved` → `invoiced` only), `profiles_upd_mgmt`, `sto_ins`, `sto_sel` |
| 2 | `scripts/users.json` | `"supervisor_email": null` added to all 7 coordinator entries; roles and all other entries unchanged |
| 3 | `scripts/provision-users.mjs` | Rewritten two-pass: pass 1 creates users + upserts profiles, recording `idByEmail`; pass 2 resolves `supervisor_email` → uid and updates `profiles.supervisor_id`. Idempotent; logs `linked:` / `link FAIL` per user; final line reports the count of null-supervisor coordinators to assign in-app (الفريق) |
| 4 | `PRD.md` | §4 mgmt line now names «الفريق الآن»; §17 step 8 requires the «المشرف» select writing `profiles.supervisor_id`; §15 item 6 extended with the assignment acceptance clause |
| 5 | `CLAUDE.md` | Added v1.2 build notes: `storage.objects` ownership fallback via Dashboard → Storage → Policies (and the README-DEPLOY requirement), zip-`prd/` as single source of truth with sha256 parity, visit-submit/retry semantics, invoice-role order transition |

### Deviation from the literal instruction (1 item)

Instruction §1 said *append only*, but §6 requires **every** `create policy` in the
v1.1/v1.2 sections to have a matching drop-guard. Four v1.1 statements were created
without one — `visits_upd_own`, `profiles_upd_mgmt`, `sto_ins`, `sto_sel` — so the
criterion could not pass by appending alone. A `drop policy if exists` line was added
above each of those four in the v1.1 section. No policy semantics changed; the file is
now re-runnable end to end instead of hard-erroring on the second run.

`CLAUDE.md` "Walk acceptance §15 items 1–9" was also corrected to "1–10", since §15
item 10 exists as of the current PRD.

## 2. Verification results

**Section markers — PASS**

```
grep -c "v1.1 PATCH" schema.sql  → 1
grep -c "v1.2 PATCH" schema.sql  → 1
```

**Drop-guard coverage across v1.1 + v1.2 — PASS (`unguarded_policies=0`)**

```
col_upd              drop=1 create=1 OK
fu_upd               drop=1 create=1 OK
inv_upd              drop=1 create=1 OK
orders_upd           drop=2 create=2 OK
profiles_upd_mgmt    drop=2 create=2 OK
sto_ins              drop=2 create=2 OK
sto_sel              drop=2 create=2 OK
visits_upd_own       drop=2 create=2 OK
visits_upd_review    drop=1 create=1 OK
vlines_upd           drop=1 create=1 OK
w_outlets            drop=1 create=1 OK
```

(Policies with `drop=2 create=2` are defined in v1.1 and redefined in v1.2; the v1.2
definition is the effective one.)

**sha256 parity, loose vs zip — PASS**

```
9ef3e435046dd2f22daa922aad798a92f6f056b9bd7af048e1ac4215108690a8  PRD.md
9ef3e435046dd2f22daa922aad798a92f6f056b9bd7af048e1ac4215108690a8  prd/PRD.md
fe5c44946db11b4cdcb2c99c7aec0158f6b424bb2434530c65b8c82df842828e  schema.sql
fe5c44946db11b4cdcb2c99c7aec0158f6b424bb2434530c65b8c82df842828e  prd/schema.sql
```

**Package integrity — PASS**

- Zip repacked, 14 files, all original members retained (`seed/`, `reference/pilot.html`, `.env.example` byte-unchanged).
- `users.json` parses; 14 entries; 7 coordinators carry `supervisor_email`, 0 non-coordinators do.
- `node --check scripts/provision-users.mjs` clean.

## 3. Notes carried into the build

- `set_outlet_pin()` / `reset_outlet_pin()` RPCs are the only path that writes `outlets.lat/lng` from a supervisor session.
- Both Cairo supervisors (حسام, محمد رجب) share `scope='القاهرة'`. Until `supervisor_id` is assigned, §5.8's fallback gives them identical «الفريق الآن» boards — expected, and the reason §15.6 now tests the assignment control.
- Outlet ids start at 0 — `outletId != null`, never truthiness.
