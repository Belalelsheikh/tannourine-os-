# Batch 0: data and ops handoff (19 Oct 2026)

Companion to `2026-10-app-review.md` §7 Batch 0. Data pulled read-only from the live DB on 19 Oct; times are Cairo time.

## Done

- **`admin-create-user` deployed** (v1, `verify_jwt` on). It refuses a call with no session (401) or with only the anon key (401 «جلسة غير صالحة»), and answers the CORS preflight. Creating a real user from الفريق has **not** been tested, because that needs a mgmt login. Known gap: the form does not send `supervisor_id`, so assign the supervisor from the coordinator's row after creating them (fix is in Batch 7).

## Pending visits: none of these can be reviewed in the app today

`Feed.tsx` only lists visits from today. Every visit below is from an earlier day, so it does not appear on any supervisor's screen. The tab badge still counts them.

**Decide one of these:**
- **(a)** Wait for the Batch 3 queue fix (code change; it makes these show up in المتابعة).
- **(b)** Belal or mgmt sends me a decision per visit, and I apply it with a one-off SQL update that is written to `audit_log`.

| Supervisor | Coordinator | Started | Outlet | State | Zero SKUs | Flags |
|---|---|---|---|---|---|---|
| مروه | محمد عبد الحميد | 09-09 15:35 | Zahran كفر عبده | submitted | 1 | — |
| مروه | محمد عبد الحميد | 09-14 13:08 | Circle K رشدى | **never submitted** | — | — |
| مروه | محمد عبد الحميد | 09-15 10:32 | Zahran سموحه | submitted | 1 | — |
| مروه | محمد عبد الحميد | 09-15 11:43 | On The Run سموحه | submitted | 6 | — |
| مروه | محمد عبد الحميد | 09-15 12:01 | Circle K انطونيادس | submitted | 8 | short |
| مروه | محمد عبد الحميد | 09-15 13:20 | Zahran كفر عبده | submitted | 2 | — |
| مروه | محمد عبد الحميد | 09-15 15:04 | Circle K جليم | submitted | 8 | short |
| مروه | محمد عبد الحميد | 09-16 11:11 | Zahran المعموره | submitted | 6 | — |
| مروه | محمد عبد الحميد | 09-16 14:08 | Circle K ش45 | submitted | 8 | short, no GPS |
| مروه | محمد عبد الحميد | 09-16 14:08 | Circle K سيدى بشر | submitted | 8 | short, no GPS |
| مروه | محمد عبد الحميد | 09-16 15:18 | Zahran سوريا | submitted | 0 | short, no GPS |
| مروه | محمد عبد الحميد | 10-17 14:47 | Seoudi مول العرب | **never submitted** | — | — |
| حسام | ندي | 10-17 14:52 | Circle K الاهلى 2 | submitted (31 h dwell) | 3 | no checkout GPS |
| حسام | دنيا | 10-18 21:50 | Circle K الجامعه | submitted | 0 | — |
| حسام | ندي | 10-18 21:53 | Circle K الحريه | submitted | 0 | short, no check-in GPS |
| محمد رجب | رنا | 10-18 21:25 | Seoudi ديستريك5 | submitted | 0 | no GPS |
| محمد رجب | رنا | 10-18 22:08 | Seoudi ديستريك5 | submitted (repeat visit) | 0 | short |
| — (deactivated) | محمد عبد الباسط | 10-06 16:25 | Circle K A1 وادى النطرون | **never submitted** | — | — |

**Things to check in this list:**
- The two 14:08 visits on 16 Sep (ش45 and سيدى بشر) started within the same minute, at different outlets, with no GPS. They were probably entered from one place rather than at the shelves. Worth asking محمد عبد الحميد.
- Eight Alexandria outlets showed 6–8 zero SKUs in mid-September, and nobody followed up.

## Orders: questions for عمرو and علي

| Status | Outlet | Raised by | Date | Lines | Amount (EGP incl. VAT) |
|---|---|---|---|---|---|
| approved 20 Sep | Zahran كفر عبده (Alex) | محمد عبد الحميد | 15 Sep | 1 case × 4 SKUs | 1,744.20 |
| approved 20 Sep | Zahran المعموره (Alex) | محمد عبد الحميد | 16 Sep | 2+1+2 cases | 2,982.24 |
| pending | Circle K الدقى (Cairo) | عبدالمنعم | 18 Oct | 25 cases | 11,764.80 |
| pending | Circle K التعمير1 (**Alex**) | رنا (Cairo) | 18 Oct | 20 × Via sparkling 1 L + 1 case × 5 | 17,134.20 |
| pending | Circle K الرحاب1 (Cairo) | رنا | 18 Oct | 1–2 cases × 8 SKUs | 7,671.06 |

**Questions:**
- **To عمرو:** were the two Zahran orders invoiced outside the app, or never shipped? At 1–2 cases per SKU they may have been test orders from his first days. If they were tests, علي should mark them rejected rather than عمرو invoicing them.
- **To علي, before approving:** رنا works in Cairo, but التعمير1 is an Alexandria outlet. This is probably a wrong pick from the outlet search (the review notes the picker problem). Confirm the outlet with her.
- **All three pending orders are for Circle K outlets with payment path `unknown`.** Set the payment path in الفروع before they are invoiced.

## Inputs needed from you

1. **Routes for 5 coordinators:** رجب أحمد, محمد حلمي, ندي, دنيا, عبدالمنعم. For each one, give the outlets per weekday in visiting order (the same format as رنا's route). Either you enter them in الخطوط, or you send me the lists and I insert them with `save_route_day`.
2. **Opening stock:** physical cases per SKU (t330, t500, sport, t15, vg330, vg1, vs330, vs1) as of a count date. This goes in المخزون as «رصيد افتتاحي».
3. **The 3 never-submitted visits:** close them as not completed? They will stay open until Batch 3 adds a close action, or until you approve a one-off SQL close.
