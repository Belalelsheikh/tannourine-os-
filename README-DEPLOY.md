# تنورين مصر — دليل التشغيل (Deployment guide)

Click-by-click, written for someone who is **not** a developer. Total time: about 45 minutes.
Do the steps in order. Do not skip step 4 — nothing works without it.

---

## What you need before you start

- A laptop with internet.
- A Google or GitHub account (to sign in to Supabase and Netlify — both free to start).
- This folder, unzipped.

---

## Step 1 — Create the Supabase project (the database)

1. Go to **https://supabase.com** → **Start your project** → sign in.
2. Click **New project**.
3. Fill in:
   - **Name:** `tannourine-ops`
   - **Database Password:** click **Generate a password** and **save it somewhere safe** (you will
     not need it daily, but you cannot recover it later).
   - **Region:** choose **Europe (Frankfurt)** — closest to Egypt of the standard options.
4. Click **Create new project** and wait ~2 minutes until the status dot turns green.

---

## Step 2 — Run the database script

1. In the left sidebar click **SQL Editor** → **New query**.
2. Open the file `schema.sql` from this folder in any text editor, select everything
   (Ctrl+A / Cmd+A), copy it.
3. Paste it into the SQL editor and click **Run** (bottom right).
4. You should see **Success. No rows returned**.

> **If you see `must be owner of table objects`** — that is the storage section at the very
> bottom of the file. Everything above it already ran. Skip to **Step 3b** below and create the
> two storage policies by hand instead. Nothing else is affected.

Now load the reference data, one at a time, each in a **New query**:

5. Paste all of `seed/skus.seed.sql` → **Run**. (8 products)
6. Paste all of `seed/outlets.seed.sql` → **Run**. (255 branches)

---

## Step 3 — Storage buckets (for the shelf photos and delivery notes)

`schema.sql` already created both buckets and their policies. Verify:

1. Left sidebar → **Storage**. You should see **visit-photos** and **pods**, both marked *Private*.
2. If they are there, skip to Step 4.

### Step 3b — only if Step 2 showed the ownership error

1. **Storage** → **New bucket** → name `visit-photos` → leave **Public bucket** OFF → **Save**.
2. Repeat for a bucket named `pods`.
3. Go to **Storage** → **Policies** → next to `objects` click **New policy** → **For full customization**.
   - Policy name: `sto_ins`
   - Allowed operation: **INSERT**
   - Target roles: **authenticated**
   - WITH CHECK expression: `bucket_id in ('visit-photos','pods')`
   - **Review** → **Save policy**.
4. Add a second policy the same way:
   - Policy name: `sto_sel`
   - Allowed operation: **SELECT**
   - Target roles: **authenticated**
   - USING expression: `bucket_id in ('visit-photos','pods')`
   - **Review** → **Save policy**.

---

## Step 4 — Copy your two keys

1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy **Project URL** — looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon / public** key — a very long string starting with `eyJ...`.

> ⚠️ On the same page there is a **service_role** key. **Never** put that one in the app,
> in the website, or in a chat. It bypasses every security rule. It is only used once, on your
> own laptop, in Step 6.

Now in this folder, make a copy of the file `.env.example` and rename the copy to `.env`.
Open `.env` and fill it in:

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
```

Save the file.

---

## Step 5 — Turn on live updates

Live badges (new visit, new order, new cheque appearing on someone else's screen without a
refresh) need the tables published. `schema.sql` does this for you. To confirm:

1. Left sidebar → **Database** → **Publications** → click **supabase_realtime**.
2. `visits`, `orders`, and `collections` should be listed. If any is missing, toggle it on.

---

## Step 6 — Create the 14 user accounts

On your laptop, open Terminal in this folder and run:

```bash
npm install
SUPABASE_URL=https://abcdefgh.supabase.co \
SUPABASE_SERVICE_KEY=eyJ...your-SERVICE-role-key... \
npm run provision
```

Use the **service_role** key here (this is the one place it is used — it never leaves your
laptop). The script prints one line per user and finishes with something like:

```
Done. Temp password: Tan@2026x
Supervisor links: 0 set, 7 coordinator(s) with null supervisor_email — assign those in-app from الفريق (mgmt).
```

Everyone's temporary password is `Tan@2026x`. Usernames are the Latin handles in
`scripts/users.json` — e.g. **ندي** logs in as `nada`, **عمرو** as `amr`, **سلمي** as `salma`.
The app adds `@tannourine.local` automatically, so staff only ever type `nada`.

To change the temporary password, add `TEMP_PASSWORD=YourPassword` to the same command.

---

## Step 7 — Deploy the user-creation function (optional but recommended)

This is what lets الحاج add staff from inside the app later.

```bash
npm install -g supabase
supabase login
supabase link --project-ref abcdefgh      # the code from your project URL
supabase functions deploy admin-create-user
```

If you skip this, everything else still works — new users just have to be added by re-running
Step 6 with an extra entry in `scripts/users.json`.

---

## Step 8 — Build the app

In Terminal, in this folder:

```bash
npm run build
```

This creates a folder called **dist**. That folder *is* the app.

---

## Step 9 — Put it online (Netlify)

1. Go to **https://app.netlify.com/drop**.
2. Drag the **dist** folder onto the page.
3. Wait ~20 seconds. Netlify gives you an address like
   `https://sparkly-otter-123abc.netlify.app`.
4. Click **Site configuration** → **Change site name** to something like `tannourine-ops`
   so the address becomes `https://tannourine-ops.netlify.app`.

> **Every time you rebuild**, drag the new `dist` folder onto the same site
> (Deploys → drag-and-drop area). Staff get the update automatically — the app refreshes itself
> in the background, no reinstall needed.

**Vercel alternative:** run `npx vercel deploy --prod dist` instead of steps 1–3.

---

## Step 10 — Install on phones

### Android (Chrome)
1. Open the address in Chrome.
2. A bar appears at the bottom: **Add تنورين to Home screen** → tap **Install**.
3. If it does not appear: menu (⋮) → **Add to Home screen**.
4. The app opens full-screen with no browser bar, and shows the water-drop icon.

### iPhone (Safari, iOS 16.4 or newer)
1. Open the address in **Safari** (not Chrome — iOS only installs from Safari).
2. Tap the **Share** button (square with an arrow, at the bottom).
3. Scroll down → **Add to Home Screen** → **Add**.
4. Open it from the home screen icon.

> **Location on iPhone:** the first time a coordinator taps «بدء الزيارة», iOS asks for location
> permission. They must tap **Allow**. If they tap Don't Allow by mistake:
> Settings → تنورين → Location → **While Using the App**.
> The visit still works without location — it is just flagged for the supervisor.

### Laptop (office staff)
Just open the address in Chrome or Edge. On screens wider than 900px the office roles
(الأوردرات، الفواتير، المالية، الإدارة) automatically switch to wide tables.

---

## Step 11 — First run inside the app

Log in as **الحاج** (`elhag` / `Tan@2026x`) and do these once, in order:

1. **الفريق** — for each of the 7 coordinators pick a **المشرف** from the dropdown.
   Until you do this, حسام and محمد رجب both see *all* Cairo coordinators in «الفريق الآن».
2. **الفروع** — the red banner says how many branches have **غير مسجلة** payment. Work through
   the Circle K list and set each to شيك or تحويل بنكي.
3. **الخطوط** — pick a coordinator, pick a day, tap the branches for that day, **حفظ**.
   Repeat for each coordinator and each working day.
4. **المخزون** — enter the opening container. The first entry is automatically labelled
   **رصيد افتتاحي**.
5. Finally, tell everyone to change nothing else — and have **سلمي** enter the pre-app
   receivables in **المالية → تصحيحات** so the aging report is truthful from day one.

---

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| «الإعدادات ناقصة» | `.env` is missing or empty | Redo Step 4, then Step 8, then Step 9 |
| «اسم المستخدم أو الرقم السري غلط» | Wrong handle or password | Handles are in `scripts/users.json`; password is from Step 6 |
| «لا يوجد ملف مستخدم (profile) لهذا الحساب» | Auth user exists but the profile row does not | Re-run Step 6 — the script is safe to run again |
| «الحساب موقوف» | Someone set the user inactive | الحاج → الفريق → **تفعيل** |
| Badges never update on a second device | Realtime publication is empty | Redo Step 5 |
| Shelf photo will not upload | Storage policies missing | Redo Step 3b |
| «الإدارة بس اللي تقدر تضيف مستخدمين» | Non-mgmt user hit the function | Expected — only الحاج can add users |

---

## Daily backup (recommended)

Supabase keeps automatic daily backups on paid plans. On the free plan, once a week:
**Database** → **Backups** → **Download**. Keep the file somewhere safe. The cheque and
receivables history is the part of this system you cannot rebuild from memory.
