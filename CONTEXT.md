# تنورين مصر — Ops

Field-ops system for Tannourine's Egyptian bottled-water distribution: coordinators walk
routes and log shelf visits, orders flow to invoicing, and finance collects against them.

## Language

**Estate**:
All 255 outlets Tannourine supplies in Egypt, whether or not anyone currently visits them.
_Avoid_: branches, stores, the full list

**Outlet**:
One retail branch that receives stock, identified by an integer id starting at 0.
_Avoid_: store, branch, location, site

**Phase one**:
The first live slice of the rollout: two Cairo coordinators on their existing geographic
routes, roughly 30–40 outlets. Real operations from day one — visits are answered and the
data is kept.
_Avoid_: pilot, trial, shakedown, beta

**Shakedown**:
The thing phase one is explicitly *not*: a throwaway run whose data is discarded once the
system is proven. Named here only so nobody re-reads "phase one" as one.

**Route**:
A coordinator's outlets for one weekday, assigned geographically. Routes are never
organised by chain.
_Avoid_: territory, journey plan, beat

**Territory split**:
A standing division of coordinators between the two Cairo supervisors. Deliberately
undecided; not a synonym for Route.

**Visit**:
One coordinator's stop at one outlet: check-in, shelf and warehouse counts, photo, checkout.
_Avoid_: call, stop, survey

**Ordering mode**:
How an outlet's orders originate — `rep` (the coordinator raises it in-visit), `central`
(head office sends them), or `mixed`.

**Payment path**:
How an outlet settles: `cheque`, `transfer`, or `unknown` where it has never been
established. Circle K's 121 outlets are all currently `unknown`.

**Alexandria supervision**:
محمد عبد الحميد (coordinator, `الإسكندرية`) is supervised by مروه (role `supervisor`, scope
`الكل`), confirmed against the live database on 2026-09-14. She reaches him through the
`scope = 'الكل'` branch of `coordinatorsInScope` (`src/lib/scope.ts:10`), so no Alexandria-scoped
supervisor account is needed.
_Avoid_: ali.sup@, علي's supervisor role, dual role, temporary Alexandria supervisor

The second-account arrangement ADR-0002 proposed (`ali.sup@…`) was **never implemented** — that
account does not exist in `auth.users`. See the superseded note on ADR-0002.

**Supervisor response**:
A supervisor adjudicating a submitted visit as approved or flagged, stamped on the visit as
`reviewed_by` + `reviewed_at`. It is not a written reply — there is no free-text channel back
to the coordinator.
_Avoid_: reply, feedback, answer

**Phase two**:
Alexandria: محمد عبد الحميد and the 67 الإسكندرية outlets. His five-day route (31 stops,
weekdays 0–4, 8/7/5/5/6) went live on 2026-09-14; the remaining 36 Alexandria outlets are in
the estate but on no route.
