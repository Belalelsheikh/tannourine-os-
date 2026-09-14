> **SUPERSEDED — never implemented (2026-09-14).** `ali.sup@tannourine.local` does not exist
> in `auth.users`. محمد عبد الحميد is supervised by مروه (role `supervisor`, scope `الكل`), who
> reaches him through the `scope = 'الكل'` branch of `coordinatorsInScope` — which is why the
> problem this ADR solves never actually bit. The reasoning below still holds for why علي could
> not take the role directly; only the chosen remedy was abandoned. Kept for that reasoning.

# Alexandria gets a second account for علي, not a role change

محمد عبد الحميد (coordinator, الإسكندرية) needs a supervisor, and علي is the only person who
knows Alexandria. He cannot hold the role directly: `profiles.role` is a single-value check
(`schema.sql:11`), `TABS.router` has no supervisor screens (`src/App.tsx:41`), and both
`visits_upd_review` and `set_outlet_pin()` gate on `my_role() in ('supervisor','mgmt')` — as
router he could not approve a visit or set an outlet pin at all.

So علي gets a **second account** (`ali.sup@…`, role `supervisor`, scope `الإسكندرية`): one
human, two logins, no schema change, and the awkwardness is honest about being temporary.
Changing his primary role instead would strip تسجيل وارد and الأوردرات and leave nobody doing
intake.

**This is temporary and collapses the moment phase two has a real Alexandria supervisor.**
Recorded because a second account for one human is exactly the kind of arrangement a later
reader "tidies up" without knowing why it existed.
