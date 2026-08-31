# PRD — Tannourine Egypt Operations System (production build)

**One sentence:** an installable Arabic-RTL PWA on Supabase that runs the entire order-to-cash loop of a water-import distributor — field visits with GPS check-in/out, orders (field + email), invoicing with proof-of-delivery photos, cheque custody lifecycle, receivables aging — for 14 named users in 6 roles across 255 retail branches and 8 SKUs.

This replaces a validated single-file pilot (`reference/pilot.html` if provided). Every workflow below was designed against the real operation; do not simplify workflows, only implementation.

---

## 1. Context (read once, it explains every decision)

- Importer/distributor of Lebanese bottled water in Egypt. Two lines: **Tannourine PET** (4 SKUs) and **Via glass, still + sparkling** (4 SKUs). Same branches sell both.
- 255 branches across 6 chains (Circle K, Master, On The Run, Seoudi, Zahran, Gourmet) in Cairo + Alexandria. Seeded from real data (`seed/outlets.seed.sql`).
- Two order channels: field coordinators collect orders on visits; **Gourmet and some Seoudi branches order centrally by email** (`ordering_mode` per outlet: `rep` / `central` / `mixed`).
- Two payment paths: **Gourmet pays by bank transfer**; everyone else pays by **cheque physically collected by field coordinators** (`payment_path`: `transfer` / `cheque` / `unknown` — 121 Circle K rows are `unknown`, management fixes in-app).
- **The invoice is the goods-release document** — nothing leaves the warehouse without one. Warehouse staff and drivers have **no logins**; dispatch/delivery is recorded by office roles.
- Cash cycle is the business's core constraint. Cheque custody (coordinator pocket → office → bank → cleared/returned) must be a recorded state machine.
- Team language: Egyptian Arabic. Field staff are called **منسق** (coordinator), their approvers **مشرف** (supervisor).

## 2. Locked stack — do not substitute

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Plain CSS (design tokens in §11) — **no Tailwind** |
| Backend | Supabase: Postgres + Auth + Storage (`schema.sql` is the contract — run as-is) |
| PWA | vite-plugin-pwa, autoUpdate, offline app-shell |
| Hosting | Netlify or Vercel static deploy |
| State/data | @supabase/supabase-js v2 + light client cache; Supabase Realtime on `visits`, `orders`, `collections` for live badges |

Env: `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Never ship the service key in the client. Provisioning script (§13) uses service key locally only.

## 3. Roles & users

Roles (in `profiles.role`): `mgmt`, `router`, `invoice`, `finance`, `supervisor`, `coordinator`.

Real users to provision (temp password each, e.g. `Tan@2026x`; synthetic emails `<latin>@tannourine.local`):

| Name | Role | Scope | Notes |
|---|---|---|---|
| الحاج | mgmt | الكل | CEO — primarily dashboard |
| علي | router | الكل | Sales manager; order hub; also sees dashboard |
| حسام | supervisor | القاهرة | Separate Cairo areas — v1 scope by governorate; per-supervisor coordinator assignment via `profiles.supervisor_id` |
| محمد رجب | supervisor | القاهرة | |
| مروه | supervisor | الكل | Customer service: follow-ups queue + silent-coordinator chasing. Can approve, discouraged socially not in code |
| ندي، رنا، دنيا، محمد حلمي، رجب أحمد، محمد عبد الباسط، عبدالمنعم | coordinator ×7 | set at provisioning (default القاهرة) | Field: visits, orders, cheque custody |
| عمرو | invoice | الكل | Creates invoices, dispatch, delivery+POD |
| سلمي | finance | الكل | Cheque lifecycle, transfers, aging, voids, legacy import |

Admin (mgmt) can create/deactivate users **in-app** via a Supabase Edge Function `admin-create-user` (service role inside the function; callable only by `mgmt` — verify JWT role server-side).

## 4. Information architecture (tabs per role)

- **coordinator:** خط اليوم · الشيكات · سجلّي
- **supervisor:** المتابعة (feed+approve) · الفريق الآن (live team board, §5.8) · تنبيهات (follow-ups) · الفريق الصامت is a banner inside المتابعة
- **router:** تسجيل وارد · الأوردرات (board) · لوحة (read dashboard)
- **invoice:** للفوترة · الفواتير
- **finance:** الشيكات · التحويلات · الأعمار · تصحيحات (voids/edits + legacy import)
- **mgmt:** اللوحة (includes «الفريق الآن» section, §5.8) · المخزون · الفريق · الخطوط · الفروع

Desktop (≥900px): office roles (router, invoice, finance, mgmt) render tables/multi-column layouts; field roles stay phone-layout centered. Same routes, responsive CSS.

## 5. Visit flow with GPS (core new capability)

1. Coordinator opens **خط اليوم** — outlets from `routes` for `new Date().getDay()`, plus «＋ زيارة خارج الخط» (search all outlets; marks `off_route=true`).
2. Taps outlet → **«بدء الزيارة»**: request geolocation (high accuracy, 10s timeout). Store `checkin_at`, `checkin_lat/lng`. If GPS denied/failed: proceed, coords null, flag `no_checkin_gps`. Never block on GPS.
3. Visit form (identical to pilot): per SKU (all 8): رف / مخزن / بيع (cases) — all required, zero allowed; shelf=0 forces one `zero_reason` chip; **shelf photo required** (compress client-side: max 1024px, JPEG q0.7, upload to `visit-photos/{visitId}.jpg`).
   - Outlet `ordering_mode='central'`: no order option; qualifying zeros auto-create `followups` row.
   - `rep`/`mixed`: after check, optional «عمل أوردر» (cases per SKU ≥1 line) → `orders` with `source='coordinator'`.
4. **إرسال** = checkout: capture GPS again → `checkout_at/lat/lng`, `dwell_seconds`, `distance_m` (haversine vs outlet pin, null if pin unset).
5. **Flags computed on submit** (client sets, server stores): `short_visit` (<240s), `far_from_pin` (>300m when pin exists), `no_checkin_gps` / `no_checkout_gps`. Flags inform, never block.
6. **Pin logic:** outlets have no coordinates initially. On supervisor **approval** of a visit with valid check-in coords for a pin-less outlet → write outlet `lat/lng` from that visit (the approval is the verification). mgmt can reset a pin (الفروع → «إعادة تحديد الموقع» → audit_log `reset_pin`).
7. Unclosed visits (checked in, never submitted) auto-flag in supervisor feed after 4h as «زيارة لم تُغلق».
8. **«الفريق الآن» — live team board (supervisor, marwa, mgmt).** One row per coordinator in scope; realtime-updated from `visits` and `collections` events. Scope rule: if any coordinators have this supervisor's id in `profiles.supervisor_id`, show exactly those; otherwise fall back to governorate scope; marwa/mgmt see all. Row states: (a) **في زيارة الآن** — open visit (checked in, not submitted): outlet + منذ HH:MM, green; (b) **آخر نشاط** — last event today: type (زيارة/شيك), outlet, relative time, «افتح في الخرائط» link `https://maps.google.com/?q={lat},{lng}` when coords exist; (c) **لم يبدأ اليوم** — routed today, zero events, red. Tapping a row opens today's trail: chronological events with time, outlet, dwell, distance badge. Honesty rule in UI copy: positions are per-event snapshots — «آخر موقع مسجَّل، لا يوجد تتبع مستمر». No polling hacks; no background geolocation.

Location privacy line (show once at first GPS prompt): «الموقع يُسجَّل مرتين فقط: عند بدء الزيارة وعند الإرسال — لا يوجد تتبع مستمر.»

## 6. Orders

- Sources: coordinator (in-visit) and email (router logs: outlet, PO number optional, cases per SKU). Router intake outlet dropdown: `central`/`mixed` outlets first, `rep` outlets under «استثناء».
- Board (router): pending list (source badge إيميل/منسق, PO, amount from SKU prices) → اعتماد / رفض. Approved section shows what awaits invoicing.
- Amount display everywhere = Σ cases × `price_case_incl_vat`.

## 7. Invoices, dispatch, delivery, POD

- Invoice from approved order (order → `invoiced`): snapshot `invoice_lines.price_case` from current SKU price; `amount` = Σ. Sequential `invoice_no`.
- Lifecycle buttons: `created` →«خرجت من المخزن»→ `dispatched` →«تسليم + صورة الإذن»→ `delivered` (POD photo **required**, upload `pods/{invoiceId}.jpg`).
- **Void** (finance or mgmt only): requires reason; sets `status='void'`; audit-logged; stock and aging exclude voids. No hard deletes anywhere.

## 8. Collections — cheque state machine + transfers

- Coordinator (الشيكات tab): pick outlet (`payment_path`≠`transfer`) → open **delivered** invoices (`invoice_open.open_amount>0`) → log cheque: amount (default open), **cheque_date required** → `received` (custody = that coordinator).
- Finance board: `received` (shows holder + days-in-custody) →«اتودع البنك»→ `deposited` →«تحصّل»→ `cleared` / «مرتد» → `returned` (invoice reopens automatically since returned amounts don't count).
- Transfers (Gourmet): finance picks open delivered invoice of `transfer` outlet → amount → collection `type='transfer'`, `status='cleared'` immediately.
- Finance can edit a collection amount/date before `cleared` (audit-logged `edit_collection`).

## 9. Aging, dashboard, stock

- **Aging (finance + mgmt):** from `invoice_open` where `open_amount>0` and (`delivered` or `legacy`): buckets 0-30/31-60/61-90/90+, totals + per-chain table (count, open, >60 highlighted). KPI cards: total open, cheques in custody (count+EGP), returned cheques count.
- **Dashboard (mgmt; router read-only):** today's visits, silent coordinators (routed today, no visit), zero-shelf lines today, pending orders, undelivered invoices, custody cheques, total open receivables, book stock table, last activity feed. Realtime updates.
- **Stock:** `book_stock` view (containers in − non-legacy invoiced out). mgmt logs container arrivals; first entry titled «رصيد افتتاحي». Show reconciliation hint: book vs physical count.
- **Legacy receivables import (finance, تصحيحات):** form to create `legacy=true, status='delivered'` invoices (outlet, date, amount, no lines) so pre-app receivables age truthfully. CSV paste optional nice-to-have.

## 10. Follow-ups (تنبيهات)

Auto-created on submitted visit at `central`/`mixed` outlet with ≥1 zero-shelf SKU (skip if an `open` follow-up already exists for that outlet). Card: outlet, chain, zero SKUs, visit date, branch-manager phone (tap-to-call `tel:`), «تم التواصل مع السلسلة» → done (records who/when). Marwa's primary screen.

## 11. Design system (from the approved pilot — keep it)

- Fonts: `IBM Plex Sans Arabic` (UI), `IBM Plex Mono` (numbers). `dir="rtl"`, `lang="ar"` everywhere; numerals western.
- Tokens: ink `#10222E` · slate `#33505E` · paper `#EDF0EE` · card `#FBFCFB` · line `#D3DAD7` · crit `#B23A26` · warn `#C58218` · ok `#0E6E63` · violet `#5B4A8A` · mute `#7C8B92`.
- Language: sharp rectangles, 4px right-border status accents on list rows, pill badges, stepper inputs (− value +) for all quantities, bottom tab bar with count badges (mobile), dark ink top bar with role chip.
- All copy Egyptian Arabic, matching pilot tone: «اكتب صفر لو مفيش — ممنوع خانة فاضية», «حدد سبب الصفر», «اتودع البنك», «مرتد», «تم التواصل مع السلسلة».

## 12. PWA + platforms

- Installable: manifest (name «تنورين مصر», short_name «تنورين», standalone, portrait-primary for phones, theme `#10222E`, maskable 192/512 icons — generate simple wordmark icons), service worker autoUpdate, offline shell with «لا يوجد اتصال» state.
- Online-required for writes in v1: failed submits keep the form intact with retry — **never lose entered data**. (Full offline queue = out of scope v1.)
- Must work: Android Chrome (install prompt), iOS Safari ≥16.4 (add-to-home-screen; geolocation prompts per-site), desktop Chrome/Edge (laptops in office — responsive per §4).

## 13. Provisioning & deploy (deliverables in repo)

- `schema.sql` (provided) — run first in Supabase SQL editor. Then `seed/skus.seed.sql`, `seed/outlets.seed.sql`.
- `scripts/provision-users.mjs` — reads `scripts/users.json` (provided), creates auth users via service key + inserts `profiles`. Idempotent.
- Storage buckets `visit-photos`, `pods` (private) + policies: authenticated insert/select.
- Edge function `admin-create-user` (mgmt-only user creation from الفريق).
- `README-DEPLOY.md`: click-by-click for a non-developer: Supabase project → run SQL → buckets → env keys → `npm run build` → Netlify drop → install on Android/iPhone (with screenshots described in text).

## 14. SKU seed (also in `seed/skus.seed.sql`)

| id | name_ar | line | case | price_case_incl_vat |
|---|---|---|---|---|
| t330 | تنورين ٣٣٠ مل | PET | 12 | 410.40 |
| t500 | تنورين ٥٠٠ مل | PET | 12 | 478.80 |
| sport | تنورين ٥٠٠ سبورت | PET | 12 | 547.20 |
| t15 | تنورين ١.٥ لتر | PET | 6 | 307.80 |
| vg330 | ڤيا زجاج ٣٣٠ مل | VIA | 12 | 998.64 |
| vg1 | ڤيا زجاج ١ لتر | VIA | 6 | 725.04 |
| vs330 | ڤيا سباركلينج ٣٣٠ | VIA | 6 | 513.00 |
| vs1 | ڤيا سباركلينج ١ لتر | VIA | 6 | 743.85 |

## 15. Acceptance criteria (test all before done)

1. Coordinator: login → today's route renders from `routes` → check-in captures GPS → form validates (empty field blocks; zero without reason blocks; missing photo blocks) → submit stores visit + lines + photo + dwell + flags; order creates pending order; central outlet shows no order option and zeros create a follow-up.
2. Supervisor: feed shows pending visits with photo, dwell, distance badge, flags; approve sets outlet pin when unset; silent-coordinators banner correct; flagged unclosed visits appear after 4h.
3. Router: email PO intake creates order; board approve/reject; badges update in realtime on a second device.
4. Invoice: create from approved order (correct amount + line snapshot); dispatch; deliver blocks without POD photo; void (finance) requires reason, excluded from aging+stock, audit-logged.
5. Finance: cheque received→deposited→cleared; returned reopens invoice open_amount; transfer path for Gourmet; aging buckets and per-chain table correct against hand-computed fixture; legacy invoice ages correctly.
6. mgmt: user create via edge function works from الفريق; route builder writes `routes`; container entry moves book stock; outlet payment_path edit clears the «غير مسجلة» banner count; supervisor assignment from الفريق writes `profiles.supervisor_id` and reshapes both supervisors' «الفريق الآن» boards.
7. RLS verified negative: coordinator cannot update invoices/collections lifecycle or read audit_log; invoice role cannot insert collections; anonymous gets nothing.
8. PWA installs on Android + iOS; app updates without user action on redeploy; laptop layout shows tables for office roles.
9. A failed write (airplane mode mid-submit) preserves the filled form and retries successfully.
10. «الفريق الآن»: with supervisor_id assigned, each supervisor sees exactly his coordinators; a check-in on device A appears on the supervisor's board on device B within seconds without refresh; maps link opens last event coords; a routed coordinator with no events shows red.

## 16. Out of scope v1 (do not build)

Offline write queue · WhatsApp/notification integrations · returns & partial deliveries (breakage credit notes) · per-chain price exceptions · route optimization/maps UI · analytics history charts · cheque-portfolio financing math · Arabic/English toggle.

## 17. Build order for one shot

1. Scaffold Vite+React+TS+PWA, tokens/CSS, RTL shell, Supabase client, auth screen.
2. Reference data hooks (profiles/outlets/skus/routes) + role router + tab shells.
3. Coordinator visit flow end-to-end (GPS, form, photo upload, flags, follow-up creation, order creation).
4. Supervisor feed + approval + pin-setting + silent banner + تنبيهات.
5. Router intake + board. 6. Invoice lifecycle + POD + void.
7. Finance: cheques, transfers, aging, legacy import, edits+audit.
8. mgmt: dashboard, stock, team (edge function) — الفريق must include a supervisor assignment control: each coordinator row has a «المشرف» select writing `profiles.supervisor_id` — routes builder, outlets editor.
9. Realtime badges, desktop layouts, PWA polish, README-DEPLOY, acceptance pass.
