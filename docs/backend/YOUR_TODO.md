# Backend: what you (Vibhav) need to do

Updated 2026-10-17. Part 1 is complete and the throwaway-project trial has passed. Production has NOT been migrated yet.

## Morning checklist (2026-10-20)

Do these in order. The detail for each lives in the section named; this list does not repeat it. State of
the branch as of the night run: `docs/backend/STATE.md`.

1. **Apply the eight pending migrations, in order: 0024, 0025, 0026, 0027, 0028, 0029, 0030, 0031.** For
   each, paste `docs/backend/apply/apply-00NN.sql` in the SQL Editor, then paste
   `docs/backend/apply/verify-00NN.sql` and check the one row says every column is true (anything false:
   stop and send the row). Then run `notify pgrst, 'reload schema';`. Sections 2.14 (0024), 2.15 (0025),
   2.17 (0026), 2.18 (0027), 2.19 (0028), 2.20 (0029), 2.21 (0030) and 2.22 (0031) hold the reason, the
   quiet-time note and the tested back-out block for each. 0028 and 0029 need 0017 and 0026 first; 0030
   and 0031 need 0017 (0030's project start and 0031's notes also read 0026). Applying a migration turns
   nothing on. **0032** (the participation directory, 2.23) is new from B18 and needs only 0004, so it can
   go at any point in the list; it serves nothing until a person writes and verifies listings (2.23).
2. **Set the environment variables** (server side, Sensitive, then redeploy; names only, never a value in
   the repository):
   - `HALO_PRIVACY_REVIEW_KEY`, the only switch for privacy (2.16).
   - `NWS_CONTACT`, before the forecast goes live (Part 3 item 8).
   - Feature flags only if you want the feature on now: `HALO_FEATURE_TASKS` (My Week, 2.12),
     `HALO_FEATURE_LUNA` (with the two model ids, 2.13 step 3), `HALO_FEATURE_WORKSPACE` (Homeguard
     workspace, 2.17), and `HALO_FEATURE_ATTACHMENTS` (private photos, 2.19) **only after
     `npm install sharp@0.35.5` is committed**, because `sharp` is not yet in `package.json`, and only with
     `HALO_FEATURE_WORKSPACE` also on. `HALO_FEATURE_SUMMARIES` (saved summaries, 2.20) also needs
     `HALO_FEATURE_WORKSPACE` on. `HALO_FEATURE_PROJECTS` (Explore project ideas from a sourced library, no
     generative AI, 2.21) needs `HALO_FEATURE_WORKSPACE` on only to start a project. `HALO_FEATURE_OUTREACH`
     (prepared outreach copies that are never sent, 2.22) stands alone. Each of the three waits on the
     decisions in its plan (`STATE.md`, "Decisions only Vibhav can make"). `HALO_FEATURE_PARTICIPATION`
     (the participation directory, 2.23) stands alone and waits on the B18 rulings and on verified listings.
3. **Grant yourself the operator role** with the SQL in 2.18 step 4 (after 0027). Until you do, the
   operations screen shows the denied snapshot.
4. **Merge the geo hotfix PR to main**: `vmag211/hotfix-geo-outage` (`50ae6cb`), so main stops overwriting
   good water and district rows during an ArcGIS outage (`STATE.md`, "Known live risks"). Open the PR from
   that branch if one is not open.
5. **Deploy the backend branch** `vmag211/backend`. Migrations missing or flags off answer "unavailable",
   so the order against step 1 does not break anything. Afterwards trigger one daily cron run while ArcGIS
   is healthy (the geography check in the same "Known live risks" entry), and do the staging check in 1.4.
6. **Capture the AirNow forecast documentation** (Part 3 item 10): the forecast web service docs (endpoint,
   parameters, response fields) and one real North Carolina response, so B10 Task 5 can be built.

---

**2026-10-17 progress:**

- **1.1 audit: done.** Findings in `docs/backend/baseline-audit.deployed.json`. `ucmr5_utilities` is healthy (RLS on, one public SELECT policy), so the guarded remedy was NOT needed and was NOT run. The remedy's policy name was wrong and has been corrected here and in the baseline. Production is **PostgreSQL 17.6**, not the 18 the test suite runs on.
- **1.2 old push subscriptions: done.** No rows.
- **1.3 direct browser writes: done** on this branch. Five hits, all server-side service-role code, none on the four locked tables. Still needs confirming against whatever is actually deployed, which is Yogi's.
- **Part 2 trial: done and passed**, on a throwaway Supabase project at Postgres 17.6, using `docs/backend/trial-schema-0001-0014.sql`. Applied 0015 and its three checks, seeded two households, applied 0016 (all nine columns true, backfill created 2 contexts and linked every reading), backed both out and verified, then re-applied and re-checked. The back-out blocks are therefore no longer PGlite-only.
- **Backup:** free plan, no scheduled backups or PITR available. CSV exports taken instead. Note these two migrations modify no pre-existing column or row; the only data writes are inserts into the new `home_contexts` table and population of the new nullable `daily_scores.home_context_id`.
- **0015 and 0016 are APPLIED to production.** Confirmed 2026-10-17 with the state query in 2.6: `save_household` present, the four checks present, the revoke in effect, `home_contexts` and `daily_scores.home_context_id` present. They were applied after the 1.1 audit was captured, so `baseline-audit.deployed.json` holds the pre-migration catalog and should be re-captured.
- **0015's four checks are validated** (2026-10-17, `m15_validated` 4). 0015 and 0016 are therefore complete on production.
- **0017 and 0018 are applied to production** (2026-10-17). Both verifications returned every column true, including `no_client_access`, so the revokes closed `anon` and `authenticated` on both new tables. **Migrations 0001 to 0018 are now all applied.**
- **Post-migration catalog captured** and saved over `docs/backend/baseline-audit.deployed.json` (2026-10-17). It found one latent privilege gap, and **the 2.7 remedy was applied the same day**, so `anon` and `authenticated` no longer hold TRUNCATE, REFERENCES or TRIGGER on any public table.
- **Nothing is outstanding on production.** The database is at 0001 to 0018 with 0015 validated and the privilege gap closed. What remains is the decisions in Part 3, not database work.

Status right now:

- Last implementation before the work was resumed: Tasks 1 to 9c, through `4b07435`. That starting point passed all 1,723 tests when the work was resumed.
- Task 10 is committed at `d492e9e`: rejected writes no longer replace identity or replay; recovery options and a complete privacy inventory are documented. Neither decision is approved.
- Task 11: executable API contracts, synthetic fixtures, handler conformance, requirements tracker and current checkpoint are written. Final test counts and commit evidence are in `docs/backend/checkpoint.md`.
- Branch and push state: `vmag211/backend` is the working branch, and the controller pushes it after each reviewed task. Run `git log origin/vmag211/backend..HEAD` to see which commits are not pushed yet (an empty list means everything is pushed). Nothing was merged to main.
- Migration state: **0001 to 0018 are all applied to production** (0015 and 0016 on 2026-10-17 with the four checks validated, 0017 and 0018 the same day, each verified). Applying them activated nothing: `origin/main` has no reference to `operations` or `recovery_challenges`, the routes that use them are unpushed and undeployed, and recovery stays behind a flag that is off.
- Back-out blocks: the 0015 and 0016 blocks passed the throwaway-project trial above. The **0017 and 0018 blocks, and the guarded `ucmr5_utilities` remedy (1.1), are tested only on the local PGlite copy** (`test/migrationBackout.test.mjs`), not on Supabase. Each of the two is a single `drop table`, so there is less to get wrong, but that is not the same as having been run there. They now matter more, because both tables are live.
- 0017 (operation ledger) and 0018 (recovery challenges) are new in B02. Applying 0018 does not turn recovery on: it stays behind a server-enforced flag that is off, and the Turnstile key, backup coverage and retention decisions are all still open.
- `docs/backend-progress.md` is an older September status; use the checkpoint for B01.
- Your next actions are re-capturing the deployed catalog, and the recovery/privacy decisions. **The full spec is no longer missing:** it is in this repository at `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` on `origin/codex/october15-review-refinement`, 521,027 bytes, sha256 `fc1fec4b...415be86`, verified 2026-10-17 against the figure in Yogi's wiring packet. The instructions below remain the manual checklist.

The sections below are in the order to do them. Part 1 can be done today and is read only, with ONE exception: the guarded `ucmr5_utilities` fix in 1.1 changes your database, and you run it only if the audit says to. Part 2 changes your database, so do it only when you are ready.

---

## Part 1. Read-only checks (change nothing, except the one guarded fix in 1.1)

### 1.1 Run the schema audit once

Why: the test database is rebuilt from your migrations and from the code, not captured from your real database. This query lets us compare the two.

1. Open the HALO project in the Supabase dashboard.
2. Click **SQL Editor**, then **New query**.
3. Open the file `docs/backend/baseline-audit.sql` in this repo, copy all of it, paste it in, press **Run**.
4. The result is one row with one cell called `halo_baseline_audit`. Copy that cell's whole value (not CSV). It must start with `{` and end with `}`.
5. Save it as `docs/backend/baseline-audit.deployed.json` and either tell Claude it is there or paste it into the chat. It holds table definitions, policies and grants only. No data rows, no secrets. Read it before sharing.

Things to watch for in the result (Claude will diff it for you):

- `ucmr5_utilities`: we ASSUMED it has row level security on with a public read policy. If it is off, anyone with the public anon key can write to that table. This is the single most important thing the audit answers.
- Any table with `rls_enabled` false, or a policy that is not in the migrations.
- If the audit errors on the `supabase_migrations` part or the cell is too big to copy, tell Claude what the error says. It was only tested on a local copy of Postgres, not on Supabase's editor.

**THIS BLOCK CHANGES YOUR DATABASE. Run it ONLY if the audit shows `ucmr5_utilities` with `rls_enabled` false, or a policy on it that lets `anon` or `authenticated` write.** Supabase gives `anon` and `authenticated` INSERT, UPDATE and DELETE grants on every public table by default, and with row level security on and only a public read policy those grants are harmless, so seeing the grants alone is NOT a reason to run this. If the table is healthy and you run it anyway, it is harmless: it only removes those unused default write grants. In a **New query**:

Why it is safe: the only thing that writes this table is `uploadData.js`, which uses the service role key, and the service role is not affected. Every read keeps working: the server routes read it with the service role, and `app/api/home-guard/route.js` reads it with the public anon key, which the public read policy below allows. The policy name and shape are the ones the reconstructed baseline assumes. Safe to run twice.

<!-- remedy-ucmr5 -->
```sql
alter table public.ucmr5_utilities enable row level security;
drop policy if exists "Allow public read access on ucmr5_utilities" on public.ucmr5_utilities;
create policy "Allow public read access on ucmr5_utilities" on public.ucmr5_utilities
  for select using (true);
revoke insert, update, delete on public.ucmr5_utilities from anon, authenticated;
```

Then run the audit again and check `ucmr5_utilities`: `rls_enabled` true, one SELECT policy, and no INSERT, UPDATE or DELETE for `anon` or `authenticated`. If the audit showed other policies on this table, tell Claude: this block does not remove them.

### 1.2 Check for old push subscriptions

Why: before the endpoint allowlist existed, any https address could be stored as a push endpoint, and the daily job would send to it. New code refuses those and the send step now skips them, but the old rows are still in the table.

1. SQL Editor, **New query**, paste this, press **Run**:

```sql
select profile_id, endpoint
  from push_subscriptions
 where endpoint !~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/';
```

2. No rows: nothing to do.
3. Rows: tell Claude how many (do not paste the endpoints anywhere public, they are per-device addresses). Claude can write a delete for them. They are harmless to leave for now, the daily job skips them.

### 1.3 Check the frontend does not write these tables directly

Why: migration 0015 takes away the ability of a signed-in browser to write `profiles`, `household_bands`, `symptom_logs` and `notification_prefs` straight to the database. All writes must go through the API routes. Claude searched this branch and found no direct writes. Run it again on whatever code is actually deployed, because the frontend is Yogi's.

1. In the repo root, run:

```sh
grep -rnE "supabase\.(from|rpc|storage)" app components lib
```

2. Expected on this branch: exactly these 5 lines (line numbers can shift a little). They are fine: all are server code that writes with a service role client handed in by the route, and none touches the four tables.

```text
lib/backfill.js:161:  let { error } = await supabase.from('daily_scores').insert(attempt);
lib/backfill.js:165:    ({ error } = await supabase.from('daily_scores').insert(attempt));
lib/backfill.js:168:    ({ error } = await supabase.from('daily_scores').insert(attempt.map(({ details, ...r }) => r)));
lib/homeContextRpc.js:336:  const { data, error } = await supabase.rpc(name, {
lib/homeContextRpc.js:363:  const { data, error } = await supabase.rpc(name, {
```

3. That search misses a call split over two lines (`supabase` on one line, `.from(...)` on the next), so also run:

```sh
grep -rnE "\.from\(['\"](profiles|household_bands|symptom_logs|notification_prefs)['\"]\)" app components lib
```

   Expected on this branch: about 34 lines, every one in a file under `app/api/` or in `lib/assistantContextData.js` (server code using `supabaseAdmin`), and none under `components/` or `lib/frontend/`.

4. If you see a browser file (anything under `components/`, `lib/frontend/`, or a page under `app/` outside `app/api/`) calling `.from('profiles')`, `.from('symptom_logs')`, `.from('household_bands')` or `.from('notification_prefs')` with insert, update, upsert or delete, STOP and tell Claude before doing Part 2.

### 1.4 Staging check: the public map's shared cache (B05 Task 6)

Read only. Do this on a **named staging (Preview) deployment** of `vmag211/backend`, never on production, after the daily job has run there at least once (so `map_layers` holds the layers) and with Upstash configured. Everything the tests can prove offline is proved (`test/routesMapPublic.test.mjs`). What they cannot prove is what the CDN in front of the deployment does with the headers, so tracker row BE-047 (the CDN row) stays open until you have done this. Replace `STAGING` with the staging URL.

1. Anonymous answers are cached for 10 minutes. Run this twice, a few seconds apart:

```sh
curl -s -D - -o /dev/null "https://STAGING/api/map?layer=radon"
```

   Expected: status 200 both times, `vary: Authorization`, and the CDN's cache header saying the second one was served from its cache (on Vercel, `x-vercel-cache: HIT`). The `cache-control` the route sends is `public, max-age=0, s-maxage=600`; a CDN may rewrite it on the way out, which is fine.

2. A warm anonymous answer is never served to a household, and a household's answer is never cached. Take a session token for a test household on staging (from the browser's developer tools on the staging site, never a production one).

   1. Warm the anonymous entry first. Run this until it shows `x-vercel-cache: HIT` (usually the second time):

```sh
curl -s -D - -o /dev/null "https://STAGING/api/district"
```

   2. Then, while that entry is warm, send the signed-in request:

```sh
curl -s -D - -H "Authorization: Bearer TOKEN" "https://STAGING/api/district"
```

   Expected: **not** a cache hit, `cache-control: private, no-store`, and a body that **has** a `household_county` key. If it is a HIT or has no `household_county`, the CDN served the shared visitor answer to a signed-in household (nothing leaks, but the household loses its own county for up to 10 minutes). Run the anonymous request once more afterwards: its body must have **no** `household_county` key, or the CDN served a signed-in answer to a visitor. In either case, stop and tell Claude.

   A cached anonymous answer carries the `x-request-id` of the request that filled the cache, which the server chose, so several visitors can see the same id. That is expected.

3. A refusal is never cached. Ask for something with nothing stored, for example `curl -s -D - -o /dev/null "https://STAGING/api/map?layer=water&quarter=1999Q1"` right after a deploy (an anonymous water quarter needs the geography cache warm, so it may be a 503). Whatever the status, a 503 or 429 must show `cache-control: private, no-store` and never a cache hit.

4. The limiter. From one machine, run 61 anonymous requests within a minute, with a different `layer` or `ids` each time so the CDN cannot answer them from its cache: `for i in $(seq 1 61); do curl -s -o /dev/null -w "%{http_code}\n" "https://STAGING/api/map/comparison?layer=radon&ids=%5B%22$i%22%5D"; done`. Expected: 200s, then a 429 with `retry-after: 60` once that machine has made 60. A request from a second network is still answered.

Tell Claude the results; the tracker row moves only on them.

---

## Part 2. Database changes (apply by hand, in this order)

Both migrations are files in `supabase/migrations/`. They are safe to run twice. The existing household/onboard/history routes work with or without them; explicit home-context routes return a non-retryable 503 until 0016 exists (the household save answers `"transactional": false` until 0015 is in, and onboarding answers `"home_context": null` until 0016 is in).

Recommended order of operations:

1. Wait until the B01 checkpoint is reviewed and the branch is approved, merged and deployed (see Part 3). The new routes tolerate the migrations being missing, so deploying first is safe.
2. Take a backup of production first. In the Supabase dashboard, open **Database**, then **Backups**: if your plan lists a recent backup, note its time, so you know what a restore would go back to. If it lists none (as far as I know the free plan keeps none you can restore yourself; check your plan), make your own copy with the Supabase CLI and keep the files private: they hold household data. Commands (log in and link the CLI to the project first, with `supabase login` then `supabase link --project-ref <your project ref>`; `supabase db dump` may also need Docker running):

   ```sh
   supabase db dump -f halo-schema.sql
   supabase db dump --data-only -f halo-data.sql
   ```

   I have NOT checked these dashboard and CLI steps against the current Supabase dashboard or CLI. If anything differs, follow Supabase's own backup instructions; the point is to have a copy you can restore from before step 4.
3. Trial run on a throwaway Supabase project: **required before 0016**, and strongly recommended before 0015. Make a new, empty project, give it production's schema (no data: for example the schema-only `supabase db dump` from step 2, pasted into the new project's SQL editor), then in that project: apply 0015 and run its checks (2.1), apply 0016 and run its checks (2.2), run both "If you need to back out" blocks (0016's first), then apply 0015 and 0016 again and repeat the checks. Every step should succeed. If the schema dump does not load cleanly, or any step fails, stop and tell Claude what it said. Delete the throwaway project afterwards.
4. Then apply 0015, then 0016, on production. Do 0016 soon after 0015 and after the new code is live, so the old onboarding code does not move a household without updating its home context.

Each migration below ends with an **If you need to back out** block. Back out 0016 before 0015 when undoing both. A back-out is the last resort, not a routine step: read what it does not restore first.

### 2.1 Apply 0015 (transactional household save and database constraints)

**Done on production, 2026-10-17.** Kept for the record, for the back-out block below, and in case it is ever applied to another project. The four checks still need validating: see 2.5.

Needs 0001 to 0014 applied first (they are).

1. SQL Editor, **New query**.
2. Optional check first: does any old journal row break the new rules? It shows no note or symptom text. Paste and run:

```sql
select id, entry_date, band, severity,
       char_length(note) as note_characters,
       coalesce(array_length(symptoms, 1), 0) as symptom_count
  from public.symptom_logs
 where band not in ('has_toddler', 'has_child', 'has_teen', 'has_adult',
                    'has_senior', 'has_pregnant', 'has_respiratory', 'household')
    or (severity is not null and severity not in ('mild', 'moderate', 'bad'))
    or char_length(note) > 500
    or coalesce(array_length(symptoms, 1), 0) > 20
    or entry_date < date '2000-01-01';
```

3. **New query**, paste the whole of `supabase/migrations/0015_household_transaction_and_constraints.sql`, press **Run**. Expect success.
4. Check the function (read only). Expect one row: `prosecdef` false, `proconfig` `{search_path=public}`, `anon` false, `authenticated` false, `service_role` true.

```sql
select p.oid::regprocedure, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
  from pg_proc p
 where p.oid = 'public.save_household(uuid, jsonb, boolean, text)'::regprocedure;
```

5. Check the constraints (read only). Expect 5 rows: `symptom_logs_band_check`, `_entry_date_check`, `_note_length_check`, `_severity_check`, `_symptoms_count_check`. The new ones show `convalidated` false.

```sql
select conname, convalidated from pg_constraint
 where conrelid = 'public.symptom_logs'::regclass and contype = 'c' order by conname;
```

6. Check the revoke (read only). This one matters most. Expect 8 rows. `sel` true for authenticated, and `ins`, `upd`, `del` false on EVERY row.

```sql
select t, r,
       has_table_privilege(r, t, 'SELECT') as sel,
       has_any_column_privilege(r, t, 'INSERT') as ins,
       has_any_column_privilege(r, t, 'UPDATE') as upd,
       has_table_privilege(r, t, 'DELETE') as del
  from unnest(array['public.profiles', 'public.household_bands', 'public.symptom_logs', 'public.notification_prefs']) as t
 cross join unnest(array['anon', 'authenticated']) as r;
```

   If any `ins`, `upd` or `del` is true, the revoke only partly worked (Postgres just prints a warning when the role running the SQL did not make the original grant, and the migration still says success). Send Claude the rows.

7. In the app, save the household. The `PUT /api/household` answer should now include `"transactional": true`. If it still says `false` a minute later, run `notify pgrst, 'reload schema';` and try again.

#### If you need to back out 0015

Only if 0015 breaks something you cannot wait to fix. If 0016 is applied, back it out first (2.2). Until it finishes, `symptom_logs` can be neither read nor written (dropping a check takes ACCESS EXCLUSIVE, measured on a local copy); it changes no rows, so that should be moments. In a **New query**, paste and run this (safe to run twice):

<!-- backout-0015 -->
```sql
-- Give anon and authenticated back the direct writes they had before 0015
-- (Supabase's default grants). Row level security still decides which rows.
grant insert, update, delete
  on public.profiles, public.household_bands, public.symptom_logs, public.notification_prefs
  to anon, authenticated;

-- The household save function.
drop function if exists public.save_household(uuid, jsonb, boolean, text);

-- The four journal checks 0015 added. symptom_logs_severity_check is NOT
-- dropped: it comes from 0003 and was there before 0015.
alter table public.symptom_logs drop constraint if exists symptom_logs_band_check;
alter table public.symptom_logs drop constraint if exists symptom_logs_note_length_check;
alter table public.symptom_logs drop constraint if exists symptom_logs_symptoms_count_check;
alter table public.symptom_logs drop constraint if exists symptom_logs_entry_date_check;
```

Then run `notify pgrst, 'reload schema';`. The household save goes back to two steps and answers `"transactional": false`.

Then re-run the step 6 check from 2.1: this time `ins`, `upd` and `del` should be `true` on every row (a GRANT, like a REVOKE, only prints a warning when the role running it did not make the original grants, so the check is how you know it worked).

What this does NOT restore or undo:

- It reopens the hole 0015 closed: a signed-in browser can again write its own `profiles`, `household_bands`, `symptom_logs` and `notification_prefs` rows directly, skipping the routes' checks.
- It gives back exactly INSERT, UPDATE and DELETE on the whole table, which is what Supabase's defaults grant. If your audit from 1.1 (taken before 0015) showed something narrower, such as a grant on some columns only, send Claude that part of the audit instead of running this: 0015's revoke also removed column grants, and this block does not recreate them.
- Journal rows saved while the checks were in place stay as they are.

### 2.2 Apply 0016 (home contexts), at a quiet time

**Done on production, 2026-10-17.** Kept for the record and for the back-out block below.

Run it when few people are using the app. Needs 0015 first.

The SQL editor runs the whole file as one transaction, so its locks are held until it finishes (measured on a local copy of Postgres): `daily_scores` cannot be read or written at all (ACCESS EXCLUSIVE), and every write to `profiles` waits (SHARE ROW EXCLUSIVE, because `home_contexts` has a foreign key to it). So while it runs, today's reading, history, journal findings and the daily job wait, and so do `/api/onboard`, `PATCH /api/profile` and every new anonymous sign-up (the `handle_new_user` insert into `profiles`). Reading `profiles` still works.

Before you start, see how many readings the backfill UPDATE will touch, so you can pick a quiet time (read only):

```sql
select count(*) from public.daily_scores;
```

1. SQL Editor, **New query**, run this. Expect `true`. If not, apply 0015 first.

```sql
select to_regprocedure('public.save_household(uuid, jsonb, boolean, text)') is not null as has_0015;
```

2. **New query**, paste the whole of `supabase/migrations/0016_home_contexts.sql`, press **Run**. Expect `Success. No rows returned`.
3. **New query**, paste this read-only check, press **Run**. Expect one row, all nine columns `true`.

```sql
select
  (select relrowsecurity from pg_class where oid = 'public.home_contexts'::regclass)
    as home_contexts_rls_on,
  (select array_agg(cmd::text) from pg_policies
    where schemaname = 'public' and tablename = 'home_contexts') = array['SELECT']
    as owner_select_policy_only,
  not (has_any_column_privilege('authenticated', 'public.home_contexts', 'INSERT')
    or has_any_column_privilege('authenticated', 'public.home_contexts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.home_contexts', 'DELETE')
    or has_any_column_privilege('anon', 'public.home_contexts', 'SELECT')
    or has_any_column_privilege('anon', 'public.home_contexts', 'INSERT')
    or has_any_column_privilege('anon', 'public.home_contexts', 'UPDATE')
    or has_table_privilege('anon', 'public.home_contexts', 'DELETE'))
    as no_direct_writes,
  has_table_privilege('service_role', 'public.home_contexts', 'SELECT')
    and has_table_privilege('service_role', 'public.home_contexts', 'INSERT')
    and has_table_privilege('service_role', 'public.home_contexts', 'UPDATE')
    and has_table_privilege('service_role', 'public.home_contexts', 'DELETE')
    as service_role_can_write,
  not (has_function_privilege('anon', 'public.transition_home_context(uuid, jsonb, jsonb, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.transition_home_context(uuid, jsonb, jsonb, uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.update_home_context_attributes(uuid, uuid, integer, jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.update_home_context_attributes(uuid, uuid, integer, jsonb)', 'EXECUTE'))
    and has_function_privilege('service_role', 'public.transition_home_context(uuid, jsonb, jsonb, uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.update_home_context_attributes(uuid, uuid, integer, jsonb)', 'EXECUTE')
    as functions_service_role_only,
  exists (select 1 from pg_constraint
           where conrelid = 'public.daily_scores'::regclass and conname = 'daily_scores_home_context_fkey')
    as readings_link_checked,
  not exists (select 1 from public.profiles p
               where p.lat is not null
                 and not exists (select 1 from public.home_contexts h where h.profile_id = p.id))
    as every_located_household_has_a_context,
  not exists (select 1 from public.daily_scores s
               join public.home_contexts h
                 on h.profile_id = s.profile_id and h.origin = 'legacy_migration' and h.effective_to is null
               where s.home_context_id is null)
    as legacy_readings_linked,
  not exists (select 1 from public.profiles p
               join public.home_contexts h on h.profile_id = p.id and h.effective_to is null
               where p.lat is distinct from h.lat or p.lng is distinct from h.lng)
    as profiles_match_current_context;
```

   - An error saying `public.home_contexts` does not exist means step 2 did not run.
   - `service_role_can_write` false means the server cannot write contexts. Send Claude the row.
   - `profiles_match_current_context` false for a household whose address changed through the OLD onboarding code after it already had a context: expected for a few households if you applied 0016 well before deploying the new code. Tell Claude if you see it.
4. Run `notify pgrst, 'reload schema';` so the API sees the new table, column and functions straight away. Until it reloads, the home-contexts routes answer 503 `feature_unavailable`, onboarding answers `"home_context": null`, and history, journal findings and the daily writers carry on without home contexts (they fall back, they do not fail).
5. Optional: `select origin, count(*) from public.home_contexts group by origin;` shows how many legacy contexts the migration created.

Known limit (documented in the migration): readings from before a past move cannot be told apart, so a household's older readings are attributed to its legacy context and flagged `legacy_migration`.

#### If you need to back out 0016

Only if 0016 breaks something you cannot wait to fix. The new code keeps working without 0016 (it falls back exactly as it does before 0016 is applied). Run it at a quiet time too: until it finishes, both `daily_scores` and `profiles` can be neither read nor written (ACCESS EXCLUSIVE on both, measured on a local copy; dropping `home_contexts` locks `profiles` because of its foreign key). It changes no rows, so it should take moments, but it also waits for any request already using those tables. In a **New query**, paste and run this (safe to run twice). The order matters: the functions first, then the link from `daily_scores`, then the table (the table cannot be dropped while a foreign key still points at it).

<!-- backout-0016 -->
```sql
-- 1. The two functions, which read and write home_contexts.
drop function if exists public.transition_home_context(uuid, jsonb, jsonb, uuid);
drop function if exists public.update_home_context_attributes(uuid, uuid, integer, jsonb);

-- 2. The link from each reading to its home: the foreign key, then the column.
--    Dropping the column would also drop the foreign key and the column's
--    index (daily_scores_profile_context_date); the foreign key is named here
--    so the order is plain.
alter table public.daily_scores drop constraint if exists daily_scores_home_context_fkey;
alter table public.daily_scores drop column if exists home_context_id;

-- 3. The table. Every row in it is deleted for good.
drop table if exists public.home_contexts;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo:

- Every home context is gone for good, with the history of moves: which home each stay was, when it started and ended, its revision and its backfill progress. Applying 0016 again makes one new legacy context per located household from today's profile, not the old ones.
- Every reading loses its link to a home. The readings themselves stay, but afterwards nothing tells an old home's readings from the current home's, so history shows them all together again.
- A reading deleted by a move (the old home's reading for the day of the move) stays deleted.
- What the routes saved to `profiles` through the functions (address, county, state, utility, water source, year built, and the cleared `zip`) stays as saved.

### 2.3 Apply 0017 (operation ledger)

**Done on production, 2026-10-17**, verification all five columns true. Kept for the record and for the back-out block below.

Needs 0016 first. This one is quiet: it creates one new table and its indexes and does not read or write any existing table, so nothing else is blocked while it runs. Creating its foreign key takes a brief SHARE ROW EXCLUSIVE on `profiles`, so a new anonymous sign-up could wait a moment.

What it is for: the new frontend sends an `Idempotency-Key` on every mutation and treats a lost response as "unknown" rather than failure, then asks `GET /api/operations` what actually happened. The table is that answer.

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0017_operations_ledger.sql` and run it. Safe to re-run.
2. Run the verification query in the comment at the end of that file. Expect one row, all five columns true. `no_client_access` false is the one that matters: it means the browser roles can still reach the table, and you should send Claude the row rather than leaving it.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, every route that records an operation answers 503 `feature_unavailable` and nothing is written.

Until this is applied, the new operation routes report the feature as unavailable. The existing app does not use the ledger and is unaffected.

#### If you need to back out 0017

The operation routes go back to answering 503 `feature_unavailable`, exactly as before it was applied, so this disables them rather than breaking the existing app. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0017 -->
```sql
drop table if exists public.operations;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every recorded outcome is deleted for good. A client still holding an `operationId` for an operation whose response it lost can no longer find out what happened to it; it is told the feature is unavailable rather than given a stale answer. The effects those operations already applied stay applied.

### 2.4 Apply 0018 (account recovery challenges)

**Done on production, 2026-10-17**, verification all five columns true including `seven_checks`. Kept for the record and for the back-out block below.

Needs 0017 first. Quiet in the same way: one new table and its indexes, no existing table read or written, a brief SHARE ROW EXCLUSIVE on `profiles` for the foreign key.

What it is for: one row per attempt to prove ownership of an email that is already linked to an identity, for the Restore access flow. Only hashes are stored, never the address, the client nonce or the restore token.

**Applying this does not turn recovery on.** The capability stays behind a server-enforced feature flag that is off by default (BE-351), and three things are still open before it ships: the Turnstile site key does not exist in any environment, backup and restore coverage does not exist on the current Supabase plan, and no retention period for these rows has been approved. Applying it early is still useful: the routes stop reporting the feature as missing schema, and the audit below proves the privileges are closed.

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0018_identity_recovery.sql` and run it. Safe to re-run.
2. Run the verification query in the comment at the end of that file. Expect one row, all five columns true. This table is the one place where `no_client_access` false would be serious: these rows are the only thing between a stranger and someone's household, so if it comes back false, stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.

#### If you need to back out 0018

The recovery routes go back to answering 503 `feature_unavailable`. No owned household record is touched: nothing outside this table references it. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0018 -->
```sql
drop table if exists public.recovery_challenges;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every challenge in flight is deleted, so anyone part way through proving ownership of their address has to start again once it is reapplied. Nothing else is affected, and no account that was already recovered loses anything.

### 2.5 Validate 0015's four checks

**Done on production, 2026-10-17** (`m15_validated` 4). Kept for the record and for any other project.

0015 adds its four checks `NOT VALID`, so they constrain new rows but are not checked against existing ones until this runs. The state query in 2.6 reports the unvalidated state as `m15_checks` 4 with `m15_validated` 0.

Only when the optional check in 2.1 step 2 returned no rows (fix or delete what it listed first). This turns the new checks into full constraints:

```sql
alter table public.symptom_logs validate constraint symptom_logs_band_check;
alter table public.symptom_logs validate constraint symptom_logs_severity_check;
alter table public.symptom_logs validate constraint symptom_logs_note_length_check;
alter table public.symptom_logs validate constraint symptom_logs_symptoms_count_check;
alter table public.symptom_logs validate constraint symptom_logs_entry_date_check;
```

If one of them fails, an old row still breaks that rule. Fix or delete the rows the check in 2.1 step 2 lists, then run it again.

`symptom_logs_severity_check` comes from 0003 and is already validated, so validating it again is a harmless no-op. The other four are the ones that matter.

### 2.6 Which migrations are applied (read only, run any time)

One query, nothing changed. Use it instead of trusting any document in this repository, including this one. It was checked against a local copy with 0001 to 0014 applied and again with every migration applied, so the answers are known to discriminate.

```sql
select
  to_regprocedure('public.save_household(uuid, jsonb, boolean, text)') is not null as m15_function,
  (select count(*) from pg_constraint
     where conrelid = 'public.symptom_logs'::regclass and contype = 'c'
       and conname in ('symptom_logs_band_check','symptom_logs_entry_date_check',
                       'symptom_logs_note_length_check','symptom_logs_symptoms_count_check')) as m15_checks,
  (select count(*) from pg_constraint
     where conrelid = 'public.symptom_logs'::regclass and contype = 'c' and convalidated
       and conname in ('symptom_logs_band_check','symptom_logs_entry_date_check',
                       'symptom_logs_note_length_check','symptom_logs_symptoms_count_check')) as m15_validated,
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT') as m15_revoked,
  to_regclass('public.home_contexts') is not null as m16_table,
  to_regprocedure('public.transition_home_context(uuid, jsonb, jsonb, uuid)') is not null as m16_function,
  exists (select 1 from pg_attribute where attrelid = 'public.daily_scores'::regclass
            and attname = 'home_context_id' and not attisdropped) as m16_column,
  to_regclass('public.operations') is not null as m17_table,
  to_regclass('public.recovery_challenges') is not null as m18_table,
  exists (select 1 from pg_attribute where attrelid = 'public.recovery_challenges'::regclass
            and attname = 'intent' and not attisdropped) as m19_column;
```

Reading it: a migration is applied when all of its columns are true (`m15_checks` 4). `m15_validated` is 0 even after a correct 0015 apply, because those checks go in `NOT VALID`; 4 and 0 together mean 0015 is applied and 2.5 is still outstanding.

Production on 2026-10-17 ended the day with every column satisfied except the last: 0015 and 0016 applied and validated, 0017 and 0018 applied, 0019 not written yet, so the query now returns `true, 4, 4, true, true, true, true, true, true, false`. Two earlier readings the same day returned `m15_validated` 0 (before 2.5) and `m17_table`/`m18_table` false (before 2.3 and 2.4). `m19_column` turns true once 2.8 is applied; it is the one column that discriminates 0019, and `m18_table` false with `m19_column` true is impossible, because the column lives on that table.

### 2.7 Close the TRUNCATE gap

**Done on production, 2026-10-17.** Kept for the record, for the check query, and in case it is ever needed on another project.

Found in the 2026-10-17 post-migration catalog. `anon` and `authenticated` hold `TRUNCATE`, `REFERENCES` and `TRIGGER` on every table in `public`, because that is what Supabase's default privileges grant and no migration took them back. 0015 revoked INSERT, UPDATE and DELETE on the four written tables, which was the right fix for those, but it did not touch these three.

Why these three are different from the write grants: **row level security does not govern TRUNCATE.** The leftover INSERT/UPDATE/DELETE grants on the other tables are genuinely inert, because RLS has no policy allowing those commands and so refuses them. TRUNCATE is not refused. Proved on a local copy: an authenticated role is denied `delete from public.symptom_logs` and yet allowed `truncate public.symptom_logs`, which would empty every household's journal at once.

**It is not reachable today, which is why this is not urgent.** PostgREST has no TRUNCATE verb, so the Supabase REST API cannot issue one. The only functions `anon` and `authenticated` may execute are `handle_new_user` and `rls_auto_enable`, and both return trigger types that Postgres refuses to call directly ("trigger functions can only be called as triggers"). So this is a privilege that should not exist rather than a door standing open. Close it anyway: it is the difference between "RLS protects this" and "RLS protects this and the privilege is gone too".

In a **New query**, paste and run this. It changes no data and is safe to run twice.

<!-- remedy-truncate -->
```sql
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
```

Then run `notify pgrst, 'reload schema';`.

Check it (expect `held` false on every row):

```sql
select c.relname as table_name, r.rolname as role_name,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
         or has_table_privilege(r.rolname, c.oid, 'REFERENCES')
         or has_table_privilege(r.rolname, c.oid, 'TRIGGER') as held
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname, r.rolname;
```

What this does NOT change: the service role keeps every privilege, so no route is affected. Owners keep reading their own rows and the public reference tables stay readable. Tested in `test/migrationBackout.test.mjs`, which runs this exact block and checks the reads still work.

Not done here, and your call whether it is worth it: the other tables still grant `anon` and `authenticated` INSERT, UPDATE and DELETE (`alerts`, `daily_scores`, `home_risks`, `push_subscriptions`, and the public reference tables). Those really are inert under RLS, which denies every one of those commands for lack of a policy. Revoking them would be belt and braces rather than a fix, and it is a wider change, so it is left as a separate decision.

### 2.8 Apply 0019 (which intent wrote a recovery challenge)

**Applied to production 2026-10-19** (with 2.13, all 26 checks true). Needed 0018 first.

Quiet, and quieter than 2.3 and 2.4: it adds one column with a constant default and one check to `recovery_challenges`, a table nothing else references. Postgres records a constant default in the catalog instead of rewriting the table, so no existing row is scanned; the lock it takes on that one table is held for the moment the catalog is written. No other table is read or written, and no row changes.

What it is for: two different operations write that table and 0018 cannot tell their rows apart. Signed in, `POST /api/account/commands` attaches an address to your own identity. Not signed in, `POST /api/recovery/request` proves ownership of an address that is already linked. A fresh row of either kind looks identical, and the signed-in one clears whatever the household had open before it writes, which would silently cancel a recovery that was in flight. The `intent` column is what lets each statement name the rows it means. It defaults to `link`, so any row that already exists keeps the meaning it was written with.

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0019_recovery_challenge_intent.sql` and run it. Safe to re-run.
2. Run the verification query in the comment at the end of that file. Expect one row, all three columns true.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, `POST /api/recovery/request` and the account surface answer 503 `feature_unavailable` and nothing is written.

Until this is applied, the recovery routes report the feature as unavailable, and so does `GET /api/account?feature=recovery` while the capability flag is on: without this column the account surface cannot tell a link challenge from a recovery one, so it says "unavailable" rather than guessing. With the flag off, which is how it ships, nothing changes for anyone. The rest of the app is unaffected.

#### If you need to back out 0019

The recovery routes and the account surface go back to answering 503 `feature_unavailable`, exactly as before it was applied, so this disables recovery rather than breaking the existing app. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0019 -->
```sql
alter table public.recovery_challenges drop column if exists intent;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: no challenge row is deleted, but which intent wrote each one is lost for good. If you reapply 0019 afterwards, every surviving row reads as a `link` row, because that is the only answer the column can give once the distinction is gone. In practice that means a recovery attempt that was in flight during the back-out can be superseded by the owner linking an address, which is exactly the problem the column exists to prevent, so prefer backing out 0018 (2.4) if you want recovery off altogether.

### 2.9 Apply 0020 (Luna's conversations, turns and runs)

**Applied to production 2026-10-19** (with 2.13, all 26 checks true). Needed 0019 first (only because the migrations are applied in order; 0020 touches nothing 0018 or 0019 created).

Quiet, like 2.3 and 2.4: it creates three new tables and one index and does not read or write any existing table, so nothing else is blocked while it runs. Creating the foreign keys to `profiles` takes a brief SHARE ROW EXCLUSIVE on that table, so a new anonymous sign-up could wait a moment.

What it is for: Luna, the conversational assistant, holds the conversation on the server. The browser sends one new sentence per turn and never puts the person's own message on the screen itself, so the stored transcript, including their own turn, is the only thing that can give their question back to them. A run is one attempt to answer one turn: `POST /api/luna/messages` has to answer inside the browser's 20 second timeout, so it records the question, starts a run and returns it, and the answer is collected afterwards by polling.

**Applying this does not turn Luna on.** The capability stays behind a server-enforced feature flag that is off by default (BE-351), so nothing is reachable until `HALO_FEATURE_LUNA` is set to `on` in an environment deliberately. Retention for conversation turns was decided on 2026-10-19 (kept until the person clears the conversation or deletes the account; the three `luna_*` rows in `docs/backend/privacy-and-retention.md`). One thing is still open before Luna ships: the model ids must be set explicitly in the deployment (`ASSISTANT_EMBED_MODEL` and `ASSISTANT_CHAT_MODEL`; an unset one now fails loudly instead of quietly selecting a paid OpenAI model).

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0020_luna_conversations.sql` and run it. Safe to re-run.
2. Run the verification query in the comment at the end of that file. Expect one row, all five columns true. `no_client_access` false is the one that matters here: a turn is free text somebody typed, so if it comes back false, stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, every Luna route answers 503 `feature_unavailable` and nothing is written.

Until this is applied, the Luna routes report the feature as unavailable. The existing app is unaffected, and so is the older assistant at `/api/assistant`, which does not use these tables and is not being replaced.

#### If you need to back out 0020

Every Luna route goes back to answering a non-retryable 503 `feature_unavailable`, exactly as before it was applied, so this disables Luna rather than breaking the existing app. The three drops are in child-first order. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0020 -->

```sql
drop table if exists public.luna_runs;
drop table if exists public.luna_turns;
drop table if exists public.luna_conversations;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every conversation, every turn and every run is deleted for good, which means every question somebody asked Luna and every answer it gave. A run still in flight can no longer be collected by the browser waiting on it; it is told the feature is unavailable rather than given a stale answer. No owned household record is touched, because nothing outside these three tables references them.

### 2.10 Apply 0021 (settings preferences, tenure, and the alerts columns)

**Applied to production 2026-10-19** (with 2.13, all 26 checks true). Needed 0020 first (only because the migrations are applied in order; 0021 touches nothing 0020 created).

**Final form, safe to apply as far as review can tell (2026-10-19).** The file was amended three times after Task 1 merged: `save_settings` and the revision and tenure triggers (Rulings S11 to S13), then the review fixes A to D with the save settling its own ledger row (Ruling S15), then fixes E and F. The fourth review approved it. The two deadlocks the reviews found are fixed. A first-time notifications or household write against a save is fixed by creating that group's row before the revision lock, and only when that group is sent, so `household_set` stays false for a household that never answered. A save during account deletion is fixed by locking the profile before the ledger row, the same order as the delete's cascade. Both fixes were reasoned through on paper. The local database (PGlite) has one connection, so no test can run two transactions against each other. The only change since the approval is one reflowed comment line.

Quieter than 2.3 and 2.4, and a little busier than 2.8. It creates one new table, adds one column to `profiles` and five to `alerts`, and creates four functions and eight triggers (see the settings bullets below). Every added column has either no default or a constant one, so Postgres records it in the catalog instead of rewriting either table and no existing row is scanned; the lock it takes on each of those two tables is held for the moment the catalog is written. Its one check on `profiles` and four on `alerts` are added as full constraints rather than `NOT VALID`, which does scan those two tables, because no existing row can fail them: a new column starts null on an existing row, and `alerts.revision` starts at the constant 1. Both tables are small (one row per household, a handful of alerts each). Creating the foreign key to `profiles` takes a brief SHARE ROW EXCLUSIVE on it, so a new anonymous sign-up could wait a moment. Creating the triggers takes the same brief lock on `profiles`, `notification_prefs`, `household_bands` and `operations` (a re-run drops each trigger first, which locks its table for a moment), so a save on one of those, or any ledger claim or settle, could also wait a moment.

What it is for: neither of this package's two surfaces can be served from the tables that already exist.

- **Settings.** The snapshot's year, water source, language, five notification booleans and seven household bands already have homes (`profiles`, `notification_prefs`, `household_bands`) and are left exactly where they are. Its display choices, quiet hours, calendar values and the three switches that say what Luna may be told have none, and neither does the one `revision` a save is checked against. Those go in the new `public.profile_preferences`, one row per household, keyed by the profile. Nothing already housed is copied into it.
- **Tenure.** The contract needs `owner`, `renter` or `other`, and `profiles.renter_mode boolean` cannot tell an owner from an other. `profiles.tenure` is the new three-value column. `renter_mode` is left exactly as it is, because every existing reader uses it, and **nothing is backfilled**: a backfill would have to call every non-renter an owner, which is the very claim the boolean cannot support. A household reads as unanswered until somebody is asked. There is deliberately **no** check tying `tenure` to `renter_mode`: the existing household save writes `renter_mode` on its own, and such a check would turn that valid save into an error and lose the household change with it. Instead a trigger keeps the two in step inside the same row write, for every writer: a `renter_mode` of true makes an owner or other a renter, false makes a renter unanswered, and a new three-state answer sets `renter_mode` from it. An unanswered tenure is shown as renter when `renter_mode` is true and as other otherwise.
- **Settings saves and the settings revision.** `public.save_settings` makes a whole settings save one transaction: the revision check and every table it writes, home details included, so a save that fails applies nothing. The same transaction settles the save's own entry in the operation ledger as succeeded, so a save whose answer is lost on the way back still reads as saved, and a trigger on `operations` stops anything relabelling a settled settings entry afterwards. A save of the values already stored changes nothing, the revision included. Triggers on `profile_preferences`, `profiles`, `notification_prefs` and `household_bands` advance the settings revision whenever any other screen (notifications, household, profile, onboarding, home details) changes a value the settings screen shows, so a settings screen open on another device has to reload instead of putting the old value back. A write that changes nothing advances nothing.
- **Alerts.** Each alert gains `revision` (not null, 1 on every existing row), which is the whole optimistic-concurrency contract for marking one read or dismissed, plus `category` and a navigation target (`target_tab`, `target_destination`, `target_learn`). The four presentation columns start null, meaning "no producer named one".

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0021_settings_preferences_and_alerts.sql` and run it. Safe to re-run.
2. Run the verification query in the comment at the end of that file. Expect one row, all seven columns true. `no_client_access` false is the one that matters: it means the browser roles can still reach the preferences table, and you should send Claude the row rather than leaving it. `revision_kept_by_the_database` false means a trigger (the ledger guard included) or the save function is missing or callable by a browser role; send Claude the row for that too. What the counts cover: `nine_checks` is the preferences table's 9 checks, and `tenure_and_alert_columns` is the 6 new columns (1 on `profiles`, 5 on `alerts`). `revision_kept_by_the_database` needs all **8 triggers** by name and the service role, and only the service role, able to run `save_settings`. Together they prove all **4 functions**. Each of the eight triggers runs `advance_settings_revision` (six of them), `reconcile_profile_tenure` or `guard_settled_settings_operation`, and a trigger cannot exist without its function. The privilege check fails with an error, rather than answering false, if `save_settings` is missing.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, `GET` and `PATCH /api/settings`, and `POST /api/alerts/state`, answer 503 `feature_unavailable` and nothing is written. `GET /api/alerts` never answers 503 for this: it keeps every key the current app reads (`alerts`, `count`, `unread`, `truncated`) and only leaves out the new fields.
4. Check **Mark all as read** at its limit, through the real gateway (B04 Task 2b review R2). That change is a single update whose filter names every selected row with its revision. At 100 rows, the most one change may select, the request line is about 7.2 KB through Supabase's gateway, and nothing local can say whether the gateway accepts that. Use a test household of your own, signed in on the production app, and its profile id (a fresh test household is the newest row of `select id, created_at from auth.users order by created_at desc limit 1;` right after it signs in). In a **New query**, give it 100 unread alerts:

   ```sql
   insert into public.alerts (profile_id, type, title, message, dedupe_key)
   select '<test profile id>', 'weather_advisory', 'Gateway check ' || n,
          'A test alert for the 100-row check.', 'gateway-check-' || n
     from generate_series(1, 100) as n;
   ```

   Reload the alerts screen and press **Mark all as read** once. Expect all 100 read in one answer, with no "not confirmed" message, and `select count(*) from public.alerts where dedupe_key like 'gateway-check-%' and read and revision = 2;` to give 100. Then remove them: `delete from public.alerts where profile_id = '<test profile id>' and dedupe_key like 'gateway-check-%';`. If the change answers 414 or 431, or the app says the update is not confirmed, send Claude what you saw: the fix is a database function for the change, whose rows then travel in the request body.

Until this is applied, the settings and alerts-state routes report the feature as unavailable, and `GET /api/alerts` keeps every key the current app reads and degrades only the new fields; it never answers 503. `PUT /api/notifications` and `PUT /api/household` read nothing this migration adds. Once it is applied, the database advances the settings revision when either changes a value the settings screen shows, and keeps `tenure` in step with the household save's `renter_mode` in the same row write (B04 Rulings S12 and S13); neither save can fail because of it. One visible change after it is applied: the current `GET /api/alerts` reads with `select *`, so each alert in its response gains `revision` and nulls for the four presentation columns. That is additive and no approved screen reads those keys.

#### If you need to back out 0021

The settings and alerts-state routes go back to answering a non-retryable 503 `feature_unavailable`, exactly as before it was applied, so this disables the two new surfaces rather than breaking the existing app. `GET /api/alerts` keeps every legacy key and drops only the new fields. The triggers go first (the ledger guard on `operations` among them), then the guard and save functions, then the table, then the other two functions, then the columns. The triggers write the table and name the tenure column, so dropping them first keeps every step safe even if the statements are run one at a time. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0021 -->

```sql
drop trigger if exists operations_settings_settled_guard on public.operations;
drop trigger if exists profiles_tenure_reconcile on public.profiles;
drop trigger if exists profiles_settings_revision on public.profiles;
drop trigger if exists notification_prefs_settings_revision on public.notification_prefs;
drop trigger if exists notification_prefs_settings_revision_insert on public.notification_prefs;
drop trigger if exists household_bands_settings_revision on public.household_bands;
drop trigger if exists household_bands_settings_revision_insert on public.household_bands;
drop function if exists public.guard_settled_settings_operation();
drop function if exists public.save_settings(uuid, uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb);
drop table if exists public.profile_preferences;
drop function if exists public.reconcile_profile_tenure();
drop function if exists public.advance_settings_revision();
alter table public.alerts
  drop column if exists target_learn,
  drop column if exists target_destination,
  drop column if exists target_tab,
  drop column if exists category,
  drop column if exists revision;
alter table public.profiles drop column if exists tenure;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every household's display, quiet-hours, calendar and Luna-context choices are deleted for good, and the settings revision with them, because the whole table goes. Every alert keeps its title, message, read and dismissed state; what is lost is each one's revision, category and navigation target, so a browser holding a revision can no longer mark that alert read and has to reload. Revisions restart at 1 when 0021 is reapplied, for alerts and the settings row alike, so once a row has been changed back up to the number a stale browser still holds, that browser's revision would match again: after a back-out and reapply, have every open browser reload. The tenure answer is lost too, and reapplying leaves every household unanswered again rather than guessing from `renter_mode`. Nothing cascades: `renter_mode`, the notification preferences and the household bands are untouched, so the existing settings screens keep their values, and the household, notifications, profile and onboarding saves go back to working exactly as they did before 0021. Ledger entries for settings saves stay; with the guard gone they are ordinary entries again.

### 2.11 Apply 0022 (a household's saved discovery area)

**Applied to production 2026-10-19** (with 2.13, all 26 checks true). Needed 0021 first (only because the migrations are applied in order; 0022 touches nothing 0021 created).

Quiet, like 2.3, 2.4 and 2.9: it creates one new table and does not read or write any existing table, so nothing else is blocked while it runs. Creating the foreign key to `profiles` takes a brief SHARE ROW EXCLUSIVE on that table, so a new anonymous sign-up could wait a moment.

What it is for: the Explore screen lets a household choose the area it wants to discover things in, and that choice has to be kept by the server so every device sees the same one. It goes in the new `public.explore_areas`, one row per household, keyed by the profile (not by the home: the area does not move when the household moves). What is stored is the North Carolina county, city or town, or ZIP code the household picked from the location search (its id, name, state, label and time zone), not the home address. A household that has never saved one has no row at all and reads as "no area, revision 1"; the first save writes revision 2, which is why a check refuses anything lower. Clearing the area keeps the row with an empty place and a higher revision.

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0022_explore_areas.sql` and run it. Safe to re-run. If an earlier copy of 0022 was ever run anywhere, run the back-out first (the block below, then `notify pgrst, 'reload schema';`), because a re-run keeps a check it already has under the same name rather than replacing it.
2. Run the verification query in the comment at the end of that file. Expect one row, all five columns true. `no_client_access` false is the one that matters: it means the browser roles can still reach the table, and you should send Claude the row rather than leaving it.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, `GET` and `PATCH /api/explore/area` answer 503 `feature_unavailable` and nothing is written.

Until this is applied, the discovery-area routes report the feature as unavailable. Nothing else reads this table, so the existing app is unaffected either way. Retention for a saved area was decided on 2026-10-19: kept until the person clears it or deletes the account (the `explore_areas` row in `docs/backend/privacy-and-retention.md`).

#### If you need to back out 0022

`GET` and `PATCH /api/explore/area` go back to answering a non-retryable 503 `feature_unavailable`, exactly as before it was applied, so this disables the saved discovery area rather than breaking the existing app. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0022 -->

```sql
drop table if exists public.explore_areas;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every household's chosen discovery area is deleted for good, and its revision with it, because the whole table goes. Revisions restart at 1 (never saved) when 0022 is reapplied, so once a household has saved back up to the number a stale browser still holds, that browser's revision would match again: after a back-out and reapply, have every open browser reload. Nothing cascades: no other table references this one, and 0021's table and columns are untouched.

### 2.12 Apply 0023 (a household's tasks for My Week)

**Applied to production 2026-10-19** (with 2.13, all 26 checks true). Needed 0022 first (only because the migrations are applied in order; 0023 touches nothing 0022 created).

Quiet, like 2.11, with one difference. It creates three new tables, one index and two functions, none of which anything is waiting on, and the foreign keys to `profiles` take a brief SHARE ROW EXCLUSIVE on that table, so a new anonymous sign-up could wait a moment. It also adds one trigger to `public.operations` (0017's ledger), which takes the same brief lock on that table: any save that is claiming or settling its ledger row at that moment waits for it. Nothing existing is read or rewritten.

What it is for: My Week (`/app`, `/plan`) shows "Your tasks could not load" today because nothing on the server can hold a task. 0023 adds:

- `public.household_actions`: one row per task, keyed by the household (not the home: tasks do not move when the household moves). It holds the title, reason, origin, date, state (`saved`, `waiting` or `completed`), a per-task revision, and the task's planning details as one `meta` value exactly as the app sent it (time, duration, time zone, recurrence, completion date, a private note of up to 3,000 characters and a history of changes). **The title and the note are free text somebody typed.**
- `public.household_action_preferences`: the six My Week preferences (the week's focus sentence, food topics, weekly availability, dismissed season prompts, the weekly review time and an outdoor plan with a place name).
- `public.household_action_state`: one counter per household that a save is checked against, so two saves at once cannot each pass a check the other then breaks. It is never shown to anyone.
- `read_household_actions` (the one snapshot every My Week read uses) and `commit_household_actions` (one save: every task, detail and preference change and the save's own ledger receipt commit together or not at all, so a save that "did not apply" really did not).
- A guard on `public.operations`: once a My Week save's ledger row says `succeeded` or `failed`, its status can no longer change, so a save whose response is lost on the way back can never be recorded as failed after its task was written. Every other kind of operation is unaffected.

**Applying this does not turn My Week's tasks on.** The routes that use it are now built (B06): `GET /api/frontend/actions`, `POST /api/frontend/actions/commands` and the `actions` reconcile in `GET /api/operations`. All three stay behind a server flag that is off by default, `HALO_FEATURE_TASKS`, until you turn it on. You decided task retention on 2026-10-19 (kept until the household deletes the task or the account; the three `household_action*` rows in `docs/backend/privacy-and-retention.md`), so **after applying 0023, set `HALO_FEATURE_TASKS=on` in the deployment's environment** to make My Week live. While the flag is off, the load and a succeeded reconcile answer 503 `feature_unavailable`, and a save answers "Saving tasks in My Week is not available yet. Nothing was saved." with nothing recorded. That holds whether or not 0023 is applied. The week strip routes (`GET /api/week/changes` and its acknowledge) need only 0017, which is already applied, and are not behind the flag.

What the final 0023 creates, so you can recognise it:

- three tables;
- one index, `household_actions_owner_created`, plus the unique key on `(profile_id, action_key)`, which Postgres names `household_actions_profile_id_action_key_key`;
- ten CHECK constraints: seven on `household_actions` (state, revision, title, key, meta, note and due date), two on `household_action_preferences` (key and value) and one on `household_action_state` (version);
- three functions: `read_household_actions`, `commit_household_actions` and the guard's own `guard_settled_action_operation`;
- one trigger on `public.operations`, `operations_actions_settled_guard`.

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0023_household_actions.sql` and run it. Safe to re-run. If an earlier copy of 0023 was ever run anywhere, run the back-out first (the block below, then `notify pgrst, 'reload schema';`), because a re-run keeps a check it already has under the same name rather than replacing it.
2. Run the verification query in the comment at the end of that file. Expect **one row with all six columns true**:
   - `rls_on`: row level security is on for all three tables;
   - `no_policies`: no policy exists on any of them, so the count of policies is 0;
   - `no_client_access`: `anon` and `authenticated` have no SELECT, INSERT, UPDATE or DELETE on any of the three;
   - `functions_service_role_only`: neither browser role can execute either function, and `service_role` can execute both;
   - `settled_guard_on`: the trigger is on `public.operations`;
   - `ten_checks`: exactly 10 CHECK constraints across the three tables.

   `no_client_access` false is the one that matters: a task is free text somebody typed, so if it comes back false, stop and send Claude the row. `ten_checks` false means an older copy of 0023 was run before. Run the back-out block, then apply again.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, the My Week routes answer 503 `feature_unavailable` and nothing is written.

Until this is applied, the My Week task routes report the feature as unavailable. Nothing else reads these tables, so the existing app is unaffected either way. Note that the read-only query in 2.6 still stops at 0019, so it does not show 0023. The 0023 verification query above is the check to use. 0023 is the fifth pending migration, after 0019, 0020, 0021 and 0022, and it can be applied in the same batch.

#### If you need to back out 0023

The My Week task routes go back to answering a non-retryable 503 `feature_unavailable`, exactly as before it was applied, so this disables tasks rather than breaking the existing app. The guard and the functions are dropped first, then the three tables. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0023 -->

```sql
drop trigger if exists operations_actions_settled_guard on public.operations;
drop function if exists public.guard_settled_action_operation();
drop function if exists public.commit_household_actions(uuid, uuid, bigint, jsonb);
drop function if exists public.read_household_actions(uuid);
drop table if exists public.household_action_state;
drop table if exists public.household_action_preferences;
drop table if exists public.household_actions;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every household's tasks, their notes and histories, and their My Week preferences are deleted for good, and the save counter with them. The ledger rows for My Week saves stay in `public.operations`; they hold only ids, revisions and statuses, no task content, and with the guard gone they are ordinary ledger rows again. After a back-out and reapply, every open browser should reload: a stale tab's next save is refused rather than applied. Nothing cascades: no other table references these three, and 0022's table is untouched.

### 2.13 Or apply 0019 to 0023 in one paste (your choice, 2026-10-19)

This does the same as 2.8 to 2.12 together. Needs 0001 to 0018 first, which production has.

1. SQL Editor, **New query**: paste the whole of `docs/backend/apply/apply-0019-to-0023.sql` and run it. It is the five migration files verbatim inside one transaction, so if anything fails nothing is changed (run `rollback;` if the editor says the transaction is aborted, then send me the error). Safe to run twice. It ends with `notify pgrst, 'reload schema';`.
2. **New query**: paste `docs/backend/apply/verify-0019-to-0023.sql` and run it. Expect one row: `all_migrations_ok = true`, `checks_run = 26`, `failing = none`. If anything failed, `failing` names it (for example `0022.no_client_access`). If the query itself errors with "relation does not exist", step 1 did not apply.
3. Then, to make the features live, set in the deployment's environment: `HALO_FEATURE_TASKS=on` (My Week) and `HALO_FEATURE_LUNA=on` with `ASSISTANT_CHAT_MODEL` and `ASSISTANT_EMBED_MODEL` set explicitly (Luna). Nothing changes for users until the backend branch is deployed.

Both files are generated by `node scripts/build-apply-bundle.mjs` from the migration files, and `test/applyBundle.test.mjs` proves on PGlite that the bundle applies over 0001 to 0018, is safe to run twice, passes the check, leaves nothing applied when a statement fails, and that the check names a broken grant. The back-out blocks in 2.8 to 2.12 still apply one migration at a time, newest first.

### 2.14 Apply 0024 (privacy: clearing a household's records, and the checks around it)

**Written, applied nowhere yet.** Needs 0023 first, and refuses to apply without it: its first statement checks for every table it uses (from 0016, 0017, 0020, 0021, 0022 and 0023) and for `profiles.tenure`, and stops with `HALO 0024 cannot be applied: missing ...` naming what is not there.

Quiet: it creates six functions and one trigger, and no table. Nothing existing is read or rewritten. The trigger goes on `public.operations` (0017's ledger), which takes a brief SHARE ROW EXCLUSIVE on that table, so any save that is claiming or settling its ledger row at that moment waits for it, as with 0021 and 0023.

What it is for: the Settings privacy panel's two clears and the checks behind its review step (B07 plan, `docs/backend/plans/b07-privacy.md`, Task 1).

- `clear_household_records`: one clear, either **Clear Journal** (the symptom journal and the season summaries made from it) or **clear all** (every record the household has, its home, home history, household answers and settings included, so the person goes back through onboarding; your decision D-P1). It runs as one transaction: the records are deleted, the profile is reset to how it was at sign-up, and the request's own receipt is settled, all together or not at all, so a clear that "was not applied" really changed nothing. The sign-in, the profile row itself (reset, not deleted), account recovery records and the clear's own short receipt are kept. It refuses while the household has anything else in flight.
- `privacy_fingerprint`: a check value over the household's records, so a clear only goes ahead when the records are still the ones the person reviewed. It never leaves the server and is never stored.
- `privacy_counts`: how many records a clear would remove, for the review screen.
- `purge_privacy_receipts`: deletes privacy receipts 24 hours after they settle (the plan's Open question 1 proposes that period; confirm or change it).
- `privacy_schema_version`: lets the privacy status check tell whether 0024 is applied.
- A guard on `public.operations`: once a privacy request's ledger row says `succeeded` or `failed`, its status can no longer change, so a clear whose answer is lost on the way back can never be recorded as "not applied" after the records were deleted. Every other kind of operation is unaffected.

**Applying this does not turn privacy on.** The four privacy routes are built (B07 Tasks 3 to 6), and they stay unavailable until the review key is set (2.16). Nothing calls these functions until then.

1. **Before applying, run this read-only check against production.** It lists any profile column the clear's reset does not name, because the reconstructed baseline may not know every column the deployed table has. **Expect no rows.** If it returns any, stop and send Claude the column names: the reset must name every one before 0024 is applied, or clear all would leave that column's value behind.

   <!-- check-0024-profiles -->

   ```sql
   select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name not in ('id', 'created_at', 'address', 'lat', 'lng', 'zip', 'county',
                              'pwsid', 'build_year', 'water_source', 'home_year', 'renter_mode',
                              'locale', 'state', 'onboard_request_id', 'tenure');
   ```

2. SQL Editor, **New query**: paste the whole of `supabase/migrations/0024_privacy_clear.sql` and run it, or paste `docs/backend/apply/apply-0024.sql`, which is the same file inside one transaction (run `rollback;` if the editor says the transaction is aborted, then send the error). Either is safe to re-run.
3. Run the verification query: the comment at the end of the migration file, or `docs/backend/apply/verify-0024.sql`. The file's query returns **one row with all five columns true**; the bundle's returns `all_migrations_ok = true`, `checks_run = 5`, `failing = none`:
   - `functions_service_role_only`: neither browser role can execute any of the six functions, and `service_role` can execute the five that are called;
   - `functions_invoker_pinned`: all six run with the caller's rights and a fixed search path;
   - `settled_guard_on`: the trigger is on `public.operations`;
   - `probe_answers`: `privacy_schema_version()` returns 1;
   - `profiles_reset_complete`: step 1's check, again, after the apply.

   `functions_service_role_only` false is the one that matters: a browser role that can run the clear could delete a household's records without going through the routes, so stop and send Claude the row. `profiles_reset_complete` false means step 1 was skipped or a column was added since: send Claude the step 1 result before any clear is run.
4. Run `notify pgrst, 'reload schema';`.

Until this is applied, the privacy routes, once they exist, report privacy as unavailable. Nothing else uses these functions, so the existing app is unaffected either way.

#### If you need to back out 0024

The privacy routes go back to reporting privacy as unavailable, exactly as before it was applied, so this disables privacy requests rather than breaking the existing app. The trigger is dropped before its function. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0024 -->

```sql
drop trigger if exists operations_privacy_settled_guard on public.operations;
drop function if exists public.guard_settled_privacy_operation();
drop function if exists public.purge_privacy_receipts(uuid);
drop function if exists public.clear_household_records(uuid, uuid, text, text);
drop function if exists public.privacy_counts(uuid, text);
drop function if exists public.privacy_fingerprint(uuid, text[]);
drop function if exists public.privacy_schema_version();
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: **a clear that already ran stays done.** Records it deleted are gone for good, and backing out does not bring them back. Otherwise nothing is lost, because 0024 creates no table and the back-out drops none. Privacy receipts already in `public.operations` stay; they hold an operation id, a status and a scope, no record content, and with the guard gone they are ordinary ledger rows again, and they are no longer purged after 24 hours until 0024 is applied again. Nothing cascades, and 0023 is untouched.

### 2.15 Apply 0025 (each day's recorded maximum, for Patterns and Season)

**Written, applied nowhere yet.** Needs only 0016, which production has, so it can go **before or after 0024**: its first statement checks for `public.home_contexts` and stops with `HALO 0025 cannot be applied: missing public.home_contexts (0016)` otherwise. Apply it as soon as the recorder is deployed (B08 Tasks 1 to 3): a day is recorded only from the first run on, and a day that passes before that can never be recorded (no backfill, B08 Ruling E9).

Quiet, like 2.11: it creates two new tables, one index and five functions, and one trigger on its own new table, none of which anything is waiting on. The two foreign keys take a brief SHARE ROW EXCLUSIVE on `profiles` and `home_contexts` as they are created, so an onboarding save or a new anonymous sign-up could wait a moment. Nothing existing is read or rewritten.

What it is for: the Patterns and Season screens compare check-ins with the environment, and only accept a series of **daily maxima**. Nothing holds one today (B08 plan, `docs/backend/plans/b08-evidence.md`, Task 1):

- `public.daily_maxima`: one row per home, day (America/New_York) and factor (Air or UV): that day's largest hourly value, or why there is none (`pending` while the recorder may still look, then `source_gap` or `unavailable` for good), the source as a code (`airnow_station` measured, `open_meteo_cams` or `open_meteo_forecast` modeled), the AirNow station code for a measured home, and how many hours the day had and how many were observed. A value needs at least three quarters of the day's hours. Your decisions of 2026-10-19 are in it: modeled maxima are allowed and marked modeled, a home never mixes measured and modeled in one series (the write function refuses a second source), and rows are **kept until deleted** (clear all, or deleting the account).
- `public.daily_maxima_recorder`: one row, the first recorded day (`recording_from`, set once, never moved) and the last run's counts. No household data.
- `record_daily_maxima`, `begin_daily_maxima_run`, `finish_daily_maxima_run` and the probe `daily_maxima_schema_version`, all for the service role only. A row that would break one of the table's rules, or change a home's source, is refused on its own and counted (by rule name, never with an id or a value), and the rest of its batch is still written, so one bad row costs only its own day. Two recorder batches never run at once: each takes one advisory lock (key `800250`) for its own transaction, and nothing else in HALO uses advisory locks. The last run's counts keep `refused` beside `skipped`.
- A trigger, `daily_maxima_final_guard`: a recorded value, or a final missing day, can never be changed afterwards, by anyone.

Deleting a home deletes its maxima, and so does deleting the account (both links cascade, unlike `daily_scores`). 0024's clear all deletes them and counts them in the review, whichever of the two is applied first; Clear Journal keeps them.

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0025_daily_maxima.sql` and run it, or paste `docs/backend/apply/apply-0025.sql`, which is the same file inside one transaction (run `rollback;` if the editor says the transaction is aborted, then send the error). Either is safe to re-run.
2. Run the verification query: the comment at the end of the migration file, or `docs/backend/apply/verify-0025.sql`. The file's query returns **one row with all nine columns true**; the bundle's returns `all_migrations_ok = true`, `checks_run = 9`, `failing = none`:
   - `rls_on`, `no_policies`, `no_client_access`: both tables are closed to the browser roles;
   - `functions_service_role_only`: neither browser role can execute any of the five functions, and `service_role` can execute the four that are called;
   - `functions_invoker_pinned`: all five run with the caller's rights and a fixed search path;
   - `final_guard_on`: the trigger is on `public.daily_maxima`;
   - `both_links_cascade`: the links to `profiles` and `home_contexts` both delete with their parent;
   - `fourteen_checks`: exactly 14 CHECK constraints on `public.daily_maxima`;
   - `station_check_closed`: the station rule is the current one, which refuses a station code on a row with no source.

   `no_client_access` false is the one that matters: the rows reveal where a household lives and when, so stop and send Claude the row. `fourteen_checks` or `station_check_closed` false means an older copy of 0025 was run before: run the back-out block, then apply again.
3. Run `notify pgrst, 'reload schema';`.

Until this is applied, the recorder and `GET /api/evidence`, once deployed, report the feature as unavailable. Nothing else reads these tables, so the existing app is unaffected either way.

#### If you need to back out 0025

The recorder and `GET /api/evidence` go back to reporting the feature as unavailable, exactly as before it was applied, so this stops recording rather than breaking the existing app. The probe is dropped first, so both stop at once. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0025 -->

```sql
drop function if exists public.daily_maxima_schema_version();
drop function if exists public.begin_daily_maxima_run(date);
drop function if exists public.record_daily_maxima(jsonb);
drop function if exists public.finish_daily_maxima_run(jsonb);
drop table if exists public.daily_maxima;
drop table if exists public.daily_maxima_recorder;
drop function if exists public.guard_final_daily_maximum();
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: **every recorded daily maximum is deleted for good**, and `recording_from` with it, because both tables go. The days already recorded cannot be recorded again (no backfill), so a back-out leaves a permanent gap in the history from the first recorded day to the reapply. Nothing else is touched: 0024's clear keeps working (it reads this table only when it exists), and `daily_scores`, `home_contexts` and everything 0016 to 0024 created stay as they are.

### 2.17 Apply 0026 (the Homeguard workspace: tests, home care, kitchen, fish notes, gardens and Explore records)

**Written, applied nowhere yet.** Needs 0016 and 0017, which production has; it does not need 0023, 0024 or 0025 and may go before or after any of them. Quiet, like 2.11: one new table, one index and five functions, plus two triggers on `public.operations`, each taking a brief SHARE ROW EXCLUSIVE on that table as it is created (a ledger claim or settle at that moment waits for it). Nothing existing is read or rewritten.

What it is for (B11 plan, `docs/backend/plans/b11-homeguard-workspace.md`): Homeguard and Explore load and save a household's own records through `GET /api/frontend/workspace` and `POST /api/frontend/workspace/commands`. One table, `public.household_workspace_records`, holds every record of fourteen collections as the app's own row check accepted it; a commit function writes each change at its exact revision and settles its own ledger row in the same transaction, a guard keeps a settled `workspace` row from being turned `failed`, and a second trigger makes **privacy clear all delete the household's workspace inside the clear's own transaction** (0024 resets the profile rather than deleting it, so the profile cascade would not). The week journal, home-change history and private files are not stored.

**Applying this does not turn the workspace on.** The routes stay behind `HALO_FEATURE_WORKSPACE`, off by default, until you confirm the retention (B11 Ruling W1, proposed: kept until the person deletes the record, clears all, or deletes the account, as for tasks).

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0026_household_workspace.sql`, or `docs/backend/apply/apply-0026.sql` (the same file inside one transaction). Either is safe to re-run.
2. Run the verification query (the comment at the end of the file, or `docs/backend/apply/verify-0026.sql`): **one row, all seven columns true** (`rls_on`, `no_policies`, `no_client_access`, `functions_service_role_only`, `functions_invoker_pinned`, `triggers_on`, `five_checks`). `no_client_access` false is the one that matters: stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.

#### If you need to back out 0026

The workspace routes go back to answering "unavailable", exactly as before. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0026 -->

```sql
drop trigger if exists operations_privacy_clear_workspace on public.operations;
drop trigger if exists operations_workspace_settled_guard on public.operations;
drop function if exists public.clear_workspace_with_privacy_clear();
drop function if exists public.guard_settled_workspace_operation();
drop function if exists public.workspace_privacy_counts(uuid);
drop function if exists public.commit_household_workspace(uuid, uuid, jsonb);
drop function if exists public.read_household_workspace(uuid, text[]);
drop table if exists public.household_workspace_records;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: **every household's workspace records are deleted for good**, because the table goes. Ledger rows in domain `workspace` stay; they hold collection names, record ids, revisions and statuses only. Nothing else is touched.


### 2.16 Turn privacy on: `HALO_PRIVACY_REVIEW_KEY` (B07)

**Pending for you: 0024 and 0025 are both written and applied nowhere** (2.14 and 2.15). Privacy needs 0024 and the key below; 0025 is independent of it (B08's daily maxima), and the clear handles it whichever is applied first.

The key is the switch (B07 Ruling P18): there is no capability flag. While it is unset, or shorter than 32 characters, every privacy route answers "unavailable" and the Settings privacy panel says "Privacy requests are unavailable." That is the honest off state, and it is the state today. It signs the short-lived review a person opens before an export or a clear (ten minutes, stored nowhere).

1. **Generate a key** of 32 or more random characters, for example with `openssl rand -base64 48`. Never reuse `HALO_RECOVERY_TOKEN_KEY`: a separate key means rotating one never voids the other.
2. **Set it server side only**, in Vercel, as a Sensitive variable named `HALO_PRIVACY_REVIEW_KEY`. Never `NEXT_PUBLIC_`: a key in the browser lets anyone mint reviews. Redeploy after setting it.
3. **Add an empty placeholder line** `HALO_PRIVACY_REVIEW_KEY=` to `.env.example` yourself. Claude does not open `.env*` files.
4. **Rotating it** only voids reviews younger than ten minutes: anyone mid-review is asked to review again. Nothing stored depends on it.

**Order (plan Open question 4): clear all is irreversible and nothing has been driven through a browser yet.**

1. Apply 0024 on staging (2.14, including its pre-apply profiles check).
2. Set the key on staging only.
3. One browser pass on staging: open Settings, Privacy; review and download an export (with and without private text); Clear Journal; then clear all on a throwaway household, typing DELETE, and check that the app goes back through onboarding and that Settings still opens.
4. Only then apply 0024 on production and set the key there.

**Decisions this leaves with you** (the B07 plan's Open questions, `docs/backend/plans/b07-privacy.md`): how long review tokens, export rebuilds and privacy receipts are kept (proposed ten minutes, ten minutes and 24 hours, the shortest the contract allows, D-P3); whether recovery challenges survive clear all (proposed yes); whether language resets to English on clear all (proposed yes); the 4,000,000-byte export cap and the limit of 30 privacy reviews and exports per household per hour; the in-flight cron residual F2 (accept, or add a "cleared at" marker); `home_risks` columns (re-run the read-only `docs/backend/baseline-audit.sql` and send the column list); and that the export carries the confirmed email only. None of them blocks setting the key on staging.

### 2.18 Apply 0027 (operator roles and the source operations audit, B13)

**Written, applied nowhere yet.** Needs nothing newer than 0001, so it can go before or after 0026; the routes it serves also need 0017, which production has. Quiet: it creates two new tables, one function and two triggers on its own new table, and has no foreign key, so nothing existing is locked, read or rewritten.

What it is for (B13 plan, `docs/backend/plans/b13-source-operations.md`): the `/operations` screen. `public.operator_roles` says who may open it and as what (`viewer`, `reviewer` or `publisher`); an account with no row, and every anonymous account, is denied. **No route can grant a role: only this SQL editor can.** `public.source_ops_audit` keeps every source decision an operator sends, append-only (a trigger refuses any change or removal, by anyone). Today every decision is refused, because none has a real effect yet, and the refusal is what is audited.

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0027_operator_source_ops.sql` and run it, or paste `docs/backend/apply/apply-0027.sql` (the same file in one transaction). Either is safe to re-run.
2. Run the verification query (the comment at the end of the file, or `docs/backend/apply/verify-0027.sql`): one row, all five columns true. `no_client_access` false means a browser could read or grant a role: stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.
4. Grant yourself the role, with your own auth user id (Authentication, Users, or `select id from auth.users where email = '<your email>';`):

```sql
insert into public.operator_roles (profile_id, role, granted_by)
values ('<your auth user id>', 'publisher', 'vibhav')
on conflict (profile_id) do update
  set role = excluded.role, granted_at = now(), granted_by = excluded.granted_by;
```

Remove a role with `delete from public.operator_roles where profile_id = '<auth user id>';`. Until 0027 is applied, the three operator routes answer "unavailable"; nothing else reads these tables.

#### If you need to back out 0027

The operator routes go back to answering "unavailable". Export the audit first if you want it (`select * from public.source_ops_audit order by id;`). In a **New query**, paste and run this (safe to run twice).

<!-- backout-0027 -->

```sql
drop table if exists public.source_ops_audit;
drop table if exists public.operator_roles;
drop function if exists public.guard_source_ops_audit();
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every role grant and every audit entry is deleted, because both tables go. Nothing else is touched.

### 2.19 Apply 0028 (private photo attachments, B14)

**Written, applied nowhere yet.** Needs 0017 and **0026** (apply 2.17 first); it does not need 0024, 0025 or 0027. Quiet: two new tables and seventeen functions, plus two triggers on `public.operations` and two on `public.household_workspace_records`, each taking a brief SHARE ROW EXCLUSIVE on that table as it is created (a ledger claim or a workspace save at that moment waits for it). Nothing existing is read or rewritten. It also creates the **private storage bucket** `household-attachments` (one row in `storage.buckets`, `public = false`, 15 MiB and JPEG/PNG/WebP limits); no storage policy is created, so only the service role reaches its files.

What it is for (B14 plan, `docs/backend/plans/b14-private-attachments.md`): a test report photo, a moisture observation photo or an Explore note photo, uploaded through `POST /api/attachments`. The server decodes and re-encodes every image with `sharp`, so EXIF, GPS and all other metadata are gone before anything is stored, and keeps it private: downloads are owner-checked and never cached. Removing a file, its record, clearing all or deleting the account deletes the file; a trigger queues each storage object and the routes and the daily cron delete them.

**Applying this does not turn attachments on.** The routes stay behind `HALO_FEATURE_ATTACHMENTS` (and need `HALO_FEATURE_WORKSPACE` on too), off by default, until you confirm the B14 decisions (retention, PDF refused, limits).

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0028_household_attachments.sql`, or `docs/backend/apply/apply-0028.sql` (the same file inside one transaction). Either is safe to re-run.
2. Run the verification query (the comment at the end of the file, or `docs/backend/apply/verify-0028.sql`): **one row, all eight columns true**. `no_client_access`, `bucket_private` or `no_bucket_policy` false is the one that matters: stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.
4. In Storage, confirm the bucket `household-attachments` shows as private. Do not add a policy to it.

#### If you need to back out 0028

The attachment routes go back to answering "unavailable" and a Homeguard save naming a file is refused again. **First list the stored objects** (`select object_path from public.household_attachments union select object_path from public.attachment_object_sweep;`), because the rows go and the files do not: afterwards empty and delete the bucket in Storage (the bucket, Empty, then Delete). In a **New query**, paste and run this (safe to run twice).

<!-- backout-0028 -->

```sql
drop trigger if exists operations_privacy_clear_attachments on public.operations;
drop trigger if exists operations_attachments_settled_guard on public.operations;
drop trigger if exists household_workspace_records_delete_attachments on public.household_workspace_records;
drop trigger if exists household_workspace_records_link_attachments on public.household_workspace_records;
drop function if exists public.clear_attachments_with_privacy_clear();
drop function if exists public.guard_settled_attachments_operation();
drop function if exists public.delete_record_attachments();
drop function if exists public.link_workspace_attachments();
drop function if exists public.forget_attachment_objects(text[]);
drop function if exists public.due_attachment_objects(uuid, integer);
drop function if exists public.expire_staged_attachments(integer);
drop function if exists public.attachment_privacy_counts(uuid);
drop function if exists public.remove_household_attachment(uuid, uuid, uuid, integer);
drop function if exists public.commit_household_attachment(uuid, uuid, jsonb);
drop function if exists public.reserve_attachment_object(uuid, uuid, uuid);
drop function if exists public.check_attachment_references(uuid, text, text, text[]);
drop function if exists public.household_attachment_usage(uuid, text, text);
drop function if exists public.read_household_attachment(uuid, uuid);
drop function if exists public.attachment_storage_state();
drop function if exists public.household_attachment_json(public.household_attachments);
drop table if exists public.household_attachments;
drop function if exists public.queue_attachment_object();
drop table if exists public.attachment_object_sweep;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: **every household's file records are deleted for good**, and the files stay in the bucket until you delete them as above. Test records keep any `attachments` list they hold, now naming files that no longer exist. Ledger rows in domain `attachments` stay; they hold ids, collection names and statuses only. The bucket row itself is left (drop it in Storage). Nothing else is touched.

### 2.20 Apply 0029 (saved household summaries, B15)

**Written, applied nowhere yet.** Needs 0016, 0017 and **0026** (apply 2.17 first); it reads 0023's tasks only for a summary that names one, and does not need 0024, 0025, 0027 or 0028. Quiet: one new table, one index and nine functions, plus one trigger on its own table and two on `public.operations`, each taking a brief SHARE ROW EXCLUSIVE on that table as it is created (a ledger claim or settle at that moment waits for it). Nothing existing is read or rewritten.

What it is for (B15 plan, `docs/backend/plans/b15-saved-summaries.md`): Homeguard's Summary saves an immutable snapshot of the records a person selected through `POST /api/summaries`, lists them with `GET /api/summaries` and reopens one with `GET /api/summaries/detail`. A commit function checks the current home and every selected record at its exact revision under share locks, saves, and settles its own ledger row in the same transaction; a trigger refuses any change to a saved summary; a guard keeps a settled `summary` row from being turned `failed`; and a third trigger makes **privacy clear all delete the household's summaries inside the clear's own transaction**. No attachment bytes or photo data are ever stored.

**Applying this does not turn summaries on.** The routes stay behind `HALO_FEATURE_SUMMARIES` (and need `HALO_FEATURE_WORKSPACE` on too), off by default, until you confirm the B15 decisions (retention, scores not included yet, limits).

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0029_household_summaries.sql`, or `docs/backend/apply/apply-0029.sql` (the same file inside one transaction). Either is safe to re-run.
2. Run the verification query (the comment at the end of the file, or `docs/backend/apply/verify-0029.sql`): **one row, all seven columns true** (`rls_on`, `no_policies`, `no_client_access`, `functions_service_role_only`, `functions_invoker_pinned`, `triggers_on`, `five_constraints`). `no_client_access` false is the one that matters: stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.

#### If you need to back out 0029

The summary routes go back to answering "unavailable", exactly as before. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0029 -->

```sql
drop trigger if exists operations_privacy_clear_summaries on public.operations;
drop trigger if exists operations_summary_settled_guard on public.operations;
drop function if exists public.clear_summaries_with_privacy_clear();
drop function if exists public.guard_settled_summary_operation();
drop function if exists public.summary_privacy_counts(uuid);
drop function if exists public.commit_household_summary(uuid, uuid, jsonb);
drop function if exists public.household_summary_usage(uuid);
drop function if exists public.read_household_summary(uuid, uuid);
drop function if exists public.read_household_summaries(uuid, integer);
drop function if exists public.household_summary_json(public.household_summaries);
drop table if exists public.household_summaries;
drop function if exists public.guard_household_summary_update();
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: **every household's saved summaries are deleted for good**, because the table goes. Ledger rows in domain `summary` stay; they hold a summary id or a reason code and a status only. Nothing else is touched.

### 2.21 Apply 0030 (Explore project idea sets, B16)

**Written, applied nowhere yet.** Needs 0017; `projects.start` also needs **0026** (apply 2.17 first). One new table and six functions, plus one trigger on `public.operations` that makes **privacy clear all delete the household's idea sets inside the clear's own transaction**. Nothing existing is read or rewritten. No model or paid service is involved: idea sets are a deterministic selection from the sourced library `lib/data/exploreProjectLibrary.json` (B16 plan, `docs/backend/plans/b16-explore-projects.md`).

**Applying this does not turn projects on.** The routes stay behind `HALO_FEATURE_PROJECTS` (and `projects.start` needs `HALO_FEATURE_WORKSPACE`), off by default, until you confirm the B16 decisions.

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0030_project_generations.sql`, or `docs/backend/apply/apply-0030.sql` (the same file inside one transaction). Either is safe to re-run.
2. Run `docs/backend/apply/verify-0030.sql`: **one row, all six columns true**. If `no_client_access` is false, stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.

#### If you need to back out 0030

The project routes go back to answering "unavailable". Paste and run the `backout-0030` block at the end of `supabase/migrations/0030_project_generations.sql` (uncommented; safe to run twice), then `notify pgrst, 'reload schema';`. Every household's saved idea sets are deleted; workspace project records already started stay.

### 2.22 Apply 0031 (outreach drafts, B17: prepared copies, never sent)

**Written, applied nowhere yet.** Needs 0017 only; it does not need 0018 to 0030 (a draft that includes saved notes checks them against 0026's table, so notes work once 0026 is applied too). Quiet: one new table and six functions, plus two triggers on `public.operations`, each taking a brief SHARE ROW EXCLUSIVE on that table as it is created (a ledger claim at that moment waits for it). Nothing existing is read or rewritten.

What it is for (B17 plan, `docs/backend/plans/b17-outreach-preparation.md`): when a person prepares a question to a public office on the Explore outreach screen, HALO keeps the prepared copy so they can copy it into their own email. **HALO never sends it**: there is no email provider, no Gmail connection and no send attempt anywhere. Clear all and account deletion remove the drafts.

**Applying this does not turn outreach on.** The routes stay behind `HALO_FEATURE_OUTREACH`, off by default, until you confirm the B17 decisions (draft retention above all).

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0031_outreach_drafts.sql`, or `docs/backend/apply/apply-0031.sql` (the same file inside one transaction). Either is safe to re-run.
2. Run the verification query (the comment at the end of the file, or `docs/backend/apply/verify-0031.sql`): **one row, all seven columns true**. `no_client_access` or `functions_service_role_only` false is the one that matters: stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.

#### If you need to back out 0031

The draft routes go back to answering "unavailable"; contacts, public context and the "not connected" answer keep working. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0031 -->

```sql
drop trigger if exists operations_privacy_clear_outreach on public.operations;
drop trigger if exists operations_outreach_settled_guard on public.operations;
drop function if exists public.clear_outreach_with_privacy_clear();
drop function if exists public.guard_settled_outreach_operation();
drop function if exists public.outreach_privacy_counts(uuid);
drop function if exists public.save_outreach_draft(uuid, uuid, jsonb);
drop function if exists public.read_outreach_drafts(uuid, uuid);
drop function if exists public.outreach_draft_json(public.outreach_drafts);
drop table if exists public.outreach_drafts;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: **every household's outreach drafts are deleted for good**. Ledger rows in domain `outreach` stay; they hold draft ids, revisions and statuses only. Nothing was ever sent, so nothing outside HALO is affected. Nothing else is touched.

### 2.23 Apply 0032 (the participation directory, B18: listings a person verified, nothing else)

**Written, applied nowhere yet.** Needs **0004** (`volunteer_orgs`) only, which production has; it does not need 0005 to 0031 and may go before or after any of them. Quiet: two new tables, their indexes and triggers, and thirteen functions. Each foreign key to `volunteer_orgs` takes a brief SHARE ROW EXCLUSIVE on it as it is created; `GET /api/volunteer` reads are not blocked. Nothing existing is read or rewritten.

What it is for (B18 plan, `docs/backend/plans/b18-participation-directory.md`): Explore's "Get involved" lists (`organizations.search`, `opportunities.search`) and an opportunity's detail. **HALO writes no listing.** The two tables, `participation_profiles` (an organization's way to take part) and `participation_opportunities` (a dated event or a rolling program), are filled by a person in the SQL editor with what an organization's official page says, and **a row is served only after that person marks it verified**. Until then every area answers "no reviewed local coverage", which is true.

**Applying this does not turn the directory on.** The routes stay behind `HALO_FEATURE_PARTICIPATION`, off by default, until you confirm the B18 rulings (P1 to P11) and there are verified listings to serve.

1. SQL Editor, **New query**: paste the whole of `supabase/migrations/0032_participation_directory.sql`, or `docs/backend/apply/apply-0032.sql` (the same file inside one transaction). Either is safe to re-run.
2. Run the verification query (the comment at the end of the file, or `docs/backend/apply/verify-0032.sql`): **one row, all seven columns true**. `no_client_access` or `functions_service_role_only` false: stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`.

#### Writing a listing (you or Yogi, by hand)

The fields a person must write, and what each means, are in the plan's "What a person must write per listing". Every `<...>` below is yours to replace: the database refuses any text still holding a `<...>` placeholder, an em dash, or a non-https link, so these blocks cannot be run unedited. Write what the official page says; "Not stated on the official page." is a correct answer for cost, age or access. **Never write a capacity, a distance or "near you"**: there is no column for them.

- **The organization** must already be a `volunteer_orgs` row (`select id, name from public.volunteer_orgs order by name;`). Adding one also shows it in the older `GET /api/volunteer` directory, so add it deliberately, with the 0012 columns (`name`, `description`, `counties`, `causes`, `url`).
- **The areas** (`served_place_ids`) are ids exactly as Explore's area search gives them: `us-county:` plus the county FIPS (Mecklenburg is `us-county:37119`), `us-place:` plus a Census place GEOID, `us-zcta:` plus a ZIP code, or `us-state:NC` for the whole state. A listing for a county is shown for every city and ZIP whose Census center point is in it. To look one up from the repository: `node -e "import('./lib/places.js').then(m => console.log(m.searchPlaces({ query: 'Charlotte' })))"`.

Step 1, add the listing **unverified** (nothing is served yet). An organization's way to take part:

<!-- template-0032-profile -->

```sql
insert into public.participation_profiles
  (id, org_id, title, organizer, interest, area, served_place_ids, mission, work, url, source_title,
   extra_sources, address, address_kind, address_role, contact,
   effort, age, cost, access, steps, bring, followup)
values (
  '<listing id>',                       -- lowercase letters, digits and hyphens, for example 'riverkeeper-cleanups'
  (select id from public.volunteer_orgs where name = '<organization name>'),
  '<the way to take part, as a short title>',
  '<the organization, as people know it>',
  'Cleanup',                            -- or 'Trees & habitat', 'Gardening', 'Community learning'
  '<the area it serves, in words>',
  array['<place id>'],
  '<what the organization does, one or two sentences>',
  '<what a participant actually does>',
  'https://<official page>',
  '<the official page''s title>',
  '[]'::jsonb,                          -- or '[{"title": "<page title>", "url": "https://<another official page>"}]'
  null, null, null,                     -- or '<address>', 'office' (or 'mailing', 'meeting', 'service-area'), '<what this address is, for example Office address, not an event meeting point.>'
  null,                                 -- or '<a public contact the page prints>'
  '<how much commitment it takes>',
  '<who can take part, or Not stated on the official page.>',
  '<cost, or Not stated on the official page.>',
  '<access and suitable tasks, or Not stated on the official page.>',
  '[{"title": "<step title>", "text": "<what to do>"}]'::jsonb,
  '<what to bring or prepare>',
  '<what to do afterwards>'
);
```

A dated event (for a **rolling program**, use `'rolling'`, `null, null` for the two times and `null` for `venue_local_date`; a rolling program carries no dates):

<!-- template-0032-opportunity -->

```sql
insert into public.participation_opportunities
  (id, org_id, organizer, title, interest, artwork, kind, starts_at, ends_at, time_label,
   venue_local_date, venue_timezone, venue_timezone_basis, status, area, served_place_ids,
   venue, meeting_address, url, summary, work, duration, cost, age, access, bring, join_text, safety)
values (
  '<listing id>',
  (select id from public.volunteer_orgs where name = '<organization name>'),
  '<the organizer, as the listing names it>',
  '<the event title>',
  'Cleanup',                            -- or 'Trees & habitat', 'Gardening', 'Community learning'
  'cleanup',                            -- the illustration: 'tree', 'cleanup' or 'garden' (never a photo of the venue)
  'scheduled',
  '2026-11-07 09:00 America/New_York',  -- the start, with its zone
  '2026-11-07 12:00 America/New_York',  -- the end, after the start
  '<the time as the listing puts it, for example Saturday 7 November, 9:00 to 12:00>',
  '2026-11-07', 'America/New_York', 'source',  -- or null, null, null when the listing does not state its zone
  'listed',
  '<the area it serves, in words>',
  array['<place id>'],
  '<the meeting place, as the listing names it>',
  null,                                 -- or '<the meeting place''s address>' (never an office or mailing address)
  'https://<official page>',
  '<what the event is, one or two sentences>',
  array['<one task>', '<another task>'],
  '<how long it lasts>',
  '<cost, or Not stated on the official page.>',
  '<who can join, or Not stated on the official page.>',
  '<access, or Not stated on the official page.>',
  '<what to bring>',
  '<the official next step, for example Register on the organizer''s page.>',
  '<the safety guidance the listing gives>'
);
```

Step 2, after you have checked the row against the official page, **verify it**; only now is it served. Use `participation_profiles` or `participation_opportunities`:

<!-- template-0032-verify -->

```sql
update public.participation_opportunities
   set verified_by = '<your name or initials>', verified_at = now()
 where id = '<listing id>';
```

- **Keep it fresh.** An opportunity is served for 29 days after its verification and a profile for 180; re-check the page and run step 2 again. A scheduled event leaves the lists by itself when it starts.
- **Any change un-verifies.** Changing a served column without also setting a new `verified_at` clears the verification, so a corrected row is hidden until you verify it again. To record a cancellation (or `'full'`, `'postponed'`, only when the organizer says so) and keep it verified in one step: `update public.participation_opportunities set status = 'cancelled', verified_by = '<your name or initials>', verified_at = now() where id = '<listing id>';`
- **Withdraw** a listing with `update ... set verified_by = null, verified_at = null where id = '<listing id>';`, or delete the row.

#### If you need to back out 0032

The three directory routes go back to answering "unavailable". Export the listings first if you want them (`select * from public.participation_profiles;`, then the same for `participation_opportunities`). In a **New query**, paste and run this (safe to run twice).

<!-- backout-0032 -->

```sql
drop function if exists public.read_participation_profiles(text[], timestamptz);
drop function if exists public.read_participation_opportunity(text, timestamptz);
drop function if exists public.read_participation_opportunities(text[], timestamptz);
drop function if exists public.participation_profile_json(public.participation_profiles);
drop function if exists public.participation_opportunity_json(public.participation_opportunities);
drop table if exists public.participation_opportunities;
drop table if exists public.participation_profiles;
drop function if exists public.participation_opportunity_zone_check();
drop function if exists public.participation_listing_guard();
drop function if exists public.participation_sources_ok(jsonb);
drop function if exists public.participation_steps_ok(jsonb);
drop function if exists public.participation_places_ok(text[]);
drop function if exists public.participation_list_ok(text[], integer, integer);
drop function if exists public.participation_url_ok(text);
drop function if exists public.participation_text_ok(text, integer);
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: **every listing a person wrote is deleted for good**. `volunteer_orgs` is not touched. No household data was ever in these tables.

---

## Part 3. Decisions only you can make

1. **Merging to main.** Claude will not merge. When B01 is finished it will tell you, and nothing reaches main until you say so explicitly. The branch `vmag211/backend` is the working branch and the controller pushes it after each reviewed task, so `git log origin/vmag211/backend..HEAD` shows what is not pushed yet.
2. **The rest of the spec: resolved, nothing needed from you.** The copy at `docs/product/HALO_BACKEND_WORKING_SPEC.partial.md` is cut off partway through BE-032, but the complete 521,027-byte spec is already in this repository at `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` on `origin/codex/october15-review-refinement` (sha256 `fc1fec4b...415be86`, verified 2026-10-17 against Yogi's wiring packet manifest). B02 is planned from it. B03 to B12 are no longer blocked on a missing document; they are blocked only on being planned in dependency order.
3. **Account recovery (HO-153, the gate).** Task 10 wrote `docs/backend/decisions/B01-optional-recovery.md`, status "Proposed, awaiting Vibhav's decision". The options:
   - A: anonymous only, no recovery. Losing the device loses the household. This is how it works today.
   - B: optional upgrade of the SAME anonymous user to email or phone, keeping the user id so every record and permission is kept. Claude recommends B, optional, never required for onboarding.
   - C: a device recovery code.
   Until you decide, uploads of sensitive input (test results, attachments, fish notes, observations) stay disabled. This blocks B05.
4. **Retention periods. Partly decided 2026-10-19:** tasks and their details, Luna conversations, settings preferences and saved Explore areas are kept until the person deletes them or the account, with no timed purge. `docs/backend/privacy-and-retention.md` still marks every other period it only PROPOSES (journals, location and environmental history, alerts, operation receipts, recovery challenges, anonymous accounts, backups). Those still need your decision. Claude will not invent retention periods as facts.
5. **Push re-registration (parked).** A new identity on a device whose push address is held by an older identity gets "ok" but stores nothing. Chosen for now: no takeover. To fix properly we need proof that the device holds the keys. That belongs with push delivery in B03. Say if you want it earlier.
6. **Rulings Claude made without asking.** They are preserved in `docs/backend/decisions/B01-implementation-rulings.md`, including the controller log and Task 9c choices. These are implementation rulings, not your approval of release gates. The ones that change what users see:
   - After someone moves, water source and year built become blank for the new home (they are not carried over). The old home's readings stay out of the new home's history by default.
   - A failed utility lookup at a new home stores no utility instead of keeping the old home's.
   - A geocoder result with no usable coordinates is now a 404 "could not find coordinates", not a 500.
   - A stale edit of a home context returns 409 with the current revision.
   If you disagree with any, say so and Claude changes it.
7. **The assistant's household context is now fail-safe, and this item is mostly closed.** It used to send the household's readings and symptom names to the free-tier model unless `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` was exactly `false`, so any unconfigured environment leaked them by default. Fixed in `bae920c`: `app/api/assistant/route.js:143` now sends only when the value is exactly the string `true`, so unset means NOT sent. What is left for you is the positive decision, not a leak to stop. Your September status note says production is `false`; Claude has not verified the live value (it never reads `.env*` or your Vercel settings). Pick one:
   - Confirm in Vercel that `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` is set to `false` in EVERY environment (Production, Preview and Development), or
   - Tell Claude to change the check so it sends only when the value is exactly `true` (fails closed, with a test). With that change an unset variable means "do not send".
   `docs/backend/privacy-and-retention.md` lists exactly what leaves when it sends.
8. **Set `NWS_CONTACT` before the forecast goes live (B10).** The National Weather Service asks every caller of `api.weather.gov` to identify itself with a contact in the `User-Agent`. Set `NWS_CONTACT` to the contact address you chose (2026-10-19) in Vercel, in every environment that should show "Official notices" (Production, Preview and Development), as a Sensitive server-only variable (never `NEXT_PUBLIC_`), then redeploy. The address is deliberately not written anywhere in the repository, which is public: `.env.example` holds only the placeholder `you@example.com`, which the code treats as unset. While it is unset (or left at the placeholder), the forecast makes no NWS request and the Official notices row shows the frontend's own fallback, "Warnings unavailable. Check the official site." It is sent only to `api.weather.gov`, as `(HALO, <your contact>)`, and never logged or returned (`lib/forecast/nwsAlerts.js`). Also confirm that NWS alerts may fill "Official notices" under your "free only" rule (B10 open question 3, F4); if not, the row keeps the frontend's fallback.
9. **Open-Meteo: free only while HALO is non-commercial, and its credit stays visible (B10, DS-036).** The forecast's weather and UV come from Open-Meteo's free API, which needs no key. Its terms allow the free API for non-commercial use only, and count "websites or apps that have subscriptions or display advertisements" as commercial. You decided on 2026-10-19 that HALO is non-commercial, so the free tier applies; if HALO ever charges or advertises, the forecast (and `/api/daily-score`, which uses the same service) needs a paid Open-Meteo plan first. The data is licensed CC BY 4.0, which requires attribution: every forecast's Weather coverage ends "Weather data by Open-Meteo.com (CC BY 4.0)." (`lib/forecast/copy.js`). Keep that sentence, or another visible credit, wherever forecast values are shown.
10. **AirNow forecast: your two actions (B10 open question 2).** (a) **Task 5 stays gated on you.** The AirNow forecast adapter is not built because its request is documented only behind the AirNow login. Capture the forecast web service documentation (endpoint, parameters, response fields) and one real response for a North Carolina point, and hand them over. Until then the forecast makes no AirNow call and Air coverage says air was not checked; nothing else changes when it lands. (b) AirNow's data use guidelines ask that products relying on AirNow data be "made known" to the agencies and the AirNow program, with a form returned to `dmc@airnowtech.org` (the program's published address). Say whether HALO's API key request already covered this, or send that note before launch.
11. **Forecast budgets (B10 open question 4, F10).** 3,000 Open-Meteo forecast calls a day and 200 a minute, 200 AirNow calls an hour, 600 NWS alert calls an hour, and 30 provider-reaching requests per household per hour (`lib/forecast/budgets.js`); the horizon is today plus 6 days at most. These are product numbers chosen as fractions of the free limits. Confirm them or say what to change.

### Decided 2026-10-18 by Vibhav

- **No app store, no native build.** HALO ships as a responsive web app for phone and laptop only. Any
  work that existed only to satisfy store submission or native packaging is out of scope. Note that
  almost nothing in this document was store-driven, so this removes very little: the spec requirements,
  the retention and backup decisions, the scientific review and the source licensing all stand.
  `capacitor.config.json` is a dead leftover (no dependency, no code references it) and can be deleted.
- **Push notifications on Apple devices: accepted as a pending feature.** Web push on iOS works only for
  a web app the person has added to their Home Screen, and there is no install flow, so iOS users get no
  push. Android browsers do get it. The built push stack (migration 0010, `/api/push/subscribe`,
  `web-push`, VAPID, the daily job's delivery step) stays and serves Android. Consequence to design
  around rather than ignore: on iOS the in-app alert surface (`/api/notifications`) is the ONLY way an
  alert reaches someone, so no alert may be designed as if a push will arrive. Worth confirming against
  the iOS version you are targeting, since browser capabilities move.

---

## Part 4. For Yogi (frontend), when convenient

None of this blocks the backend; all the API changes are additive.

1. After a move, the app should ask for water source and year built again (the API now clears them for the new home).
2. Onboarding shows "address required" for every 400. The API now sends `field_errors` with the exact field and code, and the address is limited to 200 characters.
3. `GET /api/history` now returns `home_context_id` and `comparability` per point and a `context` object. `?context=all` shows readings from earlier homes, so the chart can draw a break at a move.
4. The API now has `GET /api/home-contexts`, `GET` and `PATCH /api/home-contexts/{id}`. PATCH needs `expected_revision` and can return 409.
5. The profile and home-context PATCH saves can return 409 in rare races or for stale revisions. Household PUT does not currently emit 409. The client currently treats any 409 as a generic error, which is fine.
6. Browser code must not write `profiles`, `household_bands`, `symptom_logs` or `notification_prefs` directly after 0015. Only the API routes can.
7. Water utility screens: a missing utility after a failed lookup should read "we could not check", not "no utility". `app/api/home-guard/route.js` (around line 451) still says "No water utility could be matched" for a null pwsid. That route still needs to consult the current context's `service_area_status`.

From B05 (discovery). File and line references are to `origin/codex/october15-review-refinement`. The contract is `docs/backend/contracts/b05.openapi.json`, with fixtures under `docs/backend/contracts/fixtures/b05/`.

8. **The public map now answers, with no frontend change (D1, decided 2026-10-19).** Vibhav chose the backend's cache-only public read (B05 Task 6), so the anonymous-bootstrap alternative is not needed. `/map`'s credential-free runtime (`components/production/PublicFrontend.tsx`) sends no Authorization header, and `/api/map`, `/api/district` and `/api/map/comparison` now answer such a request from what is stored. Three things the frontend should know. The anonymous district answer has **no** `household_county` key (not null). With nothing stored, an anonymous request is a 503, which the runtime already maps to `unavailable`. And a visitor making more than 60 map requests a minute gets a 429 with `Retry-After: 60` (`rate_limited`). The public runtime must keep sending no Authorization header at all: any header, even an empty one, is checked as a session and is a 401.
9. **(9.3) `organizations.search` cannot say "directory unavailable".** It is not built. When it is, an unreadable directory will be a 5xx, never `items: []`. The contract also needs an availability field like `opportunities.search` has (`lib/frontend/production/explore-service.ts:42,55`), so that a failed read is not shown as "no matches".
10. **(9.4) Treat a `cancelled` summary operation as terminal.** The operation ledger allows `cancelled`, but `validSummaryReceipt` rejects it, so `useProductionSummary` re-parks the operation for ever. The backend will never settle a `summary` operation as `cancelled`, and the reaper settles to `failed`. The client should still not lock on the word.
11. **(9.7) `X-Halo-Home-Context` is sent, and B05 ignores it.** The saved discovery area belongs to the household, not to a home context, so a foreign or unknown value changes nothing. Which home context a summary uses is Vibhav's decision when summaries are planned.
12. **(F2) Key the comparison's compound selector on a code, not on copy.** `MapComparison.tsx:36` decides water with `first?.scope === c.scopeWater`. The backend sends the literal `'Public water system'` to match, but any rewording of that copy would silently break the selector.
13. **(F3) The Explore area chooser promises city and ZIP.** Its copy says "For example, Charlotte or 28208" and "Try a nearby city or a ZIP code" (`ExploreDiscovery.tsx:59,62`). *(Mostly resolved by B05 Task 8, 2026-10-19.)* The backend now serves North Carolina counties, Census places and ZIP codes, so "Charlotte" and "28208" each answer one candidate and the copy is true for North Carolina. What remains: outside North Carolina every search is empty, and `validPlaces` still has no way to say "unsupported geography" (AC-115), so a person in another state sees only "No matching area was found". The copy could say the chooser covers North Carolina. A ZIP search is a ZIP Code Tabulation Area search, so PO-box and unique ZIPs such as 27699 have no ZCTA and find nothing. "Charlotte, NC", "Charlotte N.C." and "Raleigh, North Carolina" now find the city, "Charlotte, SC" finds nothing, and "Mt Airy" and "Saint Pauls" find Mount Airy and St. Pauls (follow-up round, 2026-10-19).
14. **(F4) Send only the compared pair to `map.comparison`.** `MapPreview.tsx:316` sends every visible id in one GET parameter. The server accepts up to 2,000, but about 780 NC ids already exceed common URL limits (about 18 bytes each once encoded), and a 431 reads as "blocked". Today's layer of about 290 systems fits.
15. **(Account, frontend N1) Drop a receipt's own id from the ids the account surface waits on.** `components/production/useAccountService.ts:21` copies `receipt.snapshot.unresolvedOperations` into `unknown` as it is. The backend now never lists a receipt's own operation there (pinned in `test/routesAccountCommands.test.mjs`, "A receipt never lists its own operation as unresolved"). As defense in depth, filter out the receipt's own `id` at `:21` and at the matching hydrate sites that set `unknown` from a snapshot, so that a self-listing receipt can never lock the surface with no way out but a reload.

From B06 (My Week and its strip). File and line references are to `origin/codex/october15-review-refinement` (5ac06f6). The contract is `docs/backend/contracts/b06.openapi.json`, with fixtures under `docs/backend/contracts/fixtures/b06/`. None of these blocks the backend. The tasks flag is off, so My Week does not load in production yet either way.

16. **(F4) Reload My Week after a refused or conflicting save.** A 200 `failed` receipt (a stale revision, changed details, a task deleted on another device) and a 409 both reach `mutate`, which shows the message and returns `false` (`components/expanded/ExpandedPreviewState.tsx:93`). It does not reload. The person's snapshot stays stale, so the same edit is refused again on every retry until a manual page reload. The server's refusal messages say "Reload My Week" for this reason. A reload on `failed` (as `reconcile` already does at `:114`) would fix it.
17. **(F7) A reconcile that answers 404 locks My Week until a page reload.** A save whose request never reached the server leaves no ledger row, so `operations.read` answers 404. `reconcile` treats any thrown error as "Could not check this save. No new save was sent." and keeps `unknownOperation` (`ExpandedPreviewState.tsx:116`), so nothing can be saved until the page reloads. The backend's 404 is honest: the operation was never recorded. The client could treat a 404 for its own operation id as "nothing was applied", clear the lock and reload. The week strip has the same shape (`WeekUpdates.tsx:23`), but its acknowledgement always reaches the ledger, so it is reachable only when the request never arrived.
18. **The tasks flag is off, and My Week then says "Your tasks could not load. Reconnect and try again."** (`ExpandedPreviewState.tsx:77`). That sentence suggests a fix the person cannot make. If that is not acceptable while retention is being decided, the contract needs an availability field, as `opportunities.search` has, so the screen can say tasks are not available yet. This is open question 4 in the B06 plan.
19. **`meta.history` has no bound.** Every change appends a line (`ExpandedPreviewState.tsx:151`) and every save sends the whole history, so a long-lived task eventually cannot be saved under the 4,000,000-byte cap. The server imposes no cap of its own, because a cap would brick the task at that point (Ruling H23). The contract needs a bound, and Vibhav needs to agree it (BE-327).
20. **The `clear` command kind is a 400.** It has no production sender, and clearing tasks belongs to `privacy.clear`. If a sender is added, it needs a backend ruling first.
21. **Year 0000 is refused by the server.** `validActionDate` accepts `0000-01-01` (`lib/frontend/expanded-preview.ts:30-35`), but a Postgres date cannot hold it, so the server answers a 400 (Ruling H13). Refusing it in the client too would show a field error instead of the generic validation message.
22. **`X-Halo-Home-Context` is ignored for tasks.** Tasks belong to the household, not a home (Ruling H2), so `portableTasks` (`lib/frontend/production/account-service.ts:6`) has nothing to carry on a move yet. Whether tasks should be per home is Vibhav's decision (open question 2 in the B06 plan).
23. **Luna needs a third-party notice (Vibhav, 2026-10-19).** Every Luna question is sent to a free third-party model service (OpenRouter, served by NVIDIA) whose terms let it keep and train on what it is sent. Vibhav chose to keep that free tier for ordinary questions, so the Luna panel must say so plainly before the first question, for example: "Questions you ask Luna are sent to a third-party AI service that may keep and use them. Do not include personal or health details." Household context stays off (the Luna context switches in Settings stay off and report off).
24. **A home save will remount the app and drop drafts, once the profile carries the home context.** B08 makes `GET /api/profile` return `home_context` (needed for score history). `ConnectedApp` is keyed `identity:context:revision` (`components/production/ProductionApp.tsx:35`), so a Settings "Your home" save that changes water source or build year bumps the revision and remounts everything: Luna, journal, note and other Settings drafts are lost with no warning. Please key on identity and context id only, or keep drafts across the remount. The backend holds this change unmerged until then.
25. **A missing `home_context` on a background profile re-read also remounts.** If the home lookup fails transiently, the field is omitted, the key drops to `none:0`, and the next good read remounts again. Please keep the last known context id when a re-read omits it, rather than treating omission as "no home".

From B10 (the outdoor planner's forecast, `forecast.read`). File and line references are to this tree. The contract is `docs/backend/contracts/b10.openapi.json`, with fixtures under `docs/backend/contracts/fixtures/b10/`. None of these blocks the backend.

26. **(N1) The place field promises parks and neighborhoods.** Its placeholder says "A park or neighborhood" (`components/expanded/WeekOutdoors.tsx:42`), but the forecast resolves North Carolina cities, counties and ZIP codes only; "Freedom Park, Charlotte" works because Charlotte does. Suggest "A city, county or ZIP code".
27. **(N2) An expired empty snapshot blocks saving, with no Refresh control.** `validate` refuses any expired forecast (`:33`), and Refresh forecast renders only with periods (`:44`). Empty answers expire 24 hours out, which hides this, but a page left open for a day still sticks until reload. An answer with provider data but no periods (a past date, a date past the horizon, or today after 21:00) now gets the same 24-hour expiry (B10 Task 9 ruling), so it no longer sticks after 90 minutes. Rendering Refresh forecast whenever `expired` is true, even without periods, would close the remaining day-old case.
28. **(N3) Each keystroke flashes "Forecast unavailable".** While a new request loads, `periods` is `[]` (`live.data?.periods ?? []`, `:32`), so the unavailable buttons and `forecastUnavailable` copy show between keystrokes. Keeping the last periods while loading, or showing the loading row only, would avoid it.
29. **(N4) AQI colours.** AirNow's guidelines ask for AQI values "in accordance with the AQI and corresponding RGB colors"; the cards render plain text. A presentation question.
30. **(Open question 5) Contract additions you may want, all additive.** An "Air, daily" label so AirNow's one daily number can be shown in the periods (today it is in Air coverage and the tradeoff text, and `air` is always `null`); a `place: {id, label}` field so the place need not live inside `source` and coverage; and confirmation that the horizon fields are date-only, inclusive and local to `zone` (F12).
31. **(Open question 6) Units.** Temperatures are °F with °C in parentheses (F14). The preview fixture used °C (`lib/frontend/week-evidence-preview.ts:58`), and there is no units preference.
32. **(Open question 7) Period windows and ambiguous names.** Morning is 08:00 to 12:00, Afternoon 12:00 to 17:00 and Evening 17:00 to 21:00, local (F13). "Columbus" resolves to the town rather than the county (F1). Both are product choices stated in coverage, not hidden; say if you want either changed.

From B07 (privacy). File and line references are to this tree (the frontend as merged at `1253025`, ref `5ac06f6`). The contract is `docs/backend/contracts/b07.openapi.json`, with fixtures under `docs/backend/contracts/fixtures/b07/`. None of these blocks the backend, and the panel says "Privacy requests are unavailable." until the review key is set.

33. **(F1) After clear all, go to onboarding.** `accept` (`components/production/ProductionPrivacy.tsx:23`) refreshes the workspace and tasks and clears drafts, but stays on Settings. The next app load does go to onboarding, because `GET /api/profile` now answers `onboarded: false`. Vibhav's decision D-P1 intends the person to go back through onboarding, so navigating there after "Your records were cleared." would match it.
34. **(F4) The two Clear Journal counts differ.** The production panel shows the server's count (symptom logs and season summaries, `ProductionPrivacy.tsx:26`); the review build counts `weekJournal` (`components/expanded/SettingsPrivacy.tsx:34`). Week journal check-ins are not stored on the server yet, and the review says so. Consistent in production; noted so the two do not drift.
35. **(C11) The workspace `clear-private` command is a second clearing path.** `components/homeguard/HomeWorkspaceState.tsx:270` sends a `clear-private` command through `workspace.execute`, which has no server route yet. When `workspace.execute` gets a server route, that command must go through `privacy.clear` or be refused, so two paths never clear the same records differently. **Done in B11 (server side):** `POST /api/frontend/workspace/commands` refuses `clear-private` before any claim with "Use the privacy review in Settings to clear records. Nothing was deleted." (Ruling W9), and privacy clear all now also removes the workspace records (0026, Ruling W8). For Yogi, still: the provider's `clearPrivate` could be removed from the production path entirely.
36. **A too-large export says only "Check the highlighted information and try again."** An export whose file would pass 4,000,000 bytes is refused at review with a 422 `export_too_large` (message "This export is too large to download at once. Choose fewer groups and try again."), which the runtime maps to its generic validation sentence and highlights nothing. Showing the server's message, or a sentence of your own for `export_too_large`, would tell the person what to do.

From B12 (public evidence reads: `fish.read`, `water.read`, `growers.search`, `food.search`). Plan: `docs/backend/plans/b12-public-evidence.md`. None of these blocks the backend.

37. **"I cannot identify the species" should show every advisory at the chosen water.** `matchFishRules` returns `[]` for `species === 'unknown'` (`components/homeguard/FoodFish.tsx:23`), so a person who cannot name the fish sees "Species is unresolved." even at a water whose advisory says do not eat any fish (Little Brier Creek, Brier Creek) or whose advice is withheld pending review. Showing every rule whose `waterbody` is the chosen water (and every statewide rule listing it in `waterbodyIds`) for that choice would surface them; the backend already serves one rule per species, so de-duplicate by title.

## Part 5. Small follow-ups that are NOT scheduled (decide if you want them)

- Revoke the leftover TRUNCATE, REFERENCES and TRIGGER rights from anon and authenticated on the four tables. They are not reachable through the Supabase API today, so this is defense in depth.
- Make migration 0015 fail loudly if the revoke is only partial (a check at the end of the migration). Today only the manual query in 2.1 step 6 catches it.
- Use `cardinality(symptoms)` instead of `array_length(symptoms, 1)` so a multi-dimensional array cannot sneak past the 20-item limit.
- A per-symptom length limit (80 characters) exists in the API but not in the database.
- A per-send timeout for the daily push loop (belongs to B03).
- The backfill can insert the same dates twice if a retry arrives while a backfill is still running. This predates B01.
- 36 "MODULE_TYPELESS_PACKAGE_JSON" warnings in the test output come from older test files. Adding `"type": "module"` to `package.json` would silence them but may affect the frontend build, so it needs a deliberate check.
- The `next build` was not run (it needs your env vars, and Claude does not read them). Run `npm run build` yourself before deploying.

## Part 6. Current handoff and next package

1. Review `docs/backend/checkpoint.md` and `docs/backend/requirements-tracker.md` for the precise locally verified criteria, carried issues and unresolved release gates.
2. Give Yogi `docs/backend/contracts/b01.openapi.json` and the synthetic fixtures under `docs/backend/contracts/fixtures/b01/`. The existing frontend types were not generated from the schema; that integration remains open.
3. Review the recovery proposal and privacy/retention inventory. Sensitive input stays disabled until both are approved and required safeguards are implemented and tested.
4. Run the read-only audit and disposable-project checks above. Production migrations and merging to main remain your actions/decisions.
5. Supply the full spec before B02 proceeds. `docs/backend/WORKFLOW.md` tells a fresh session how to resume.

GET/HEAD still retain the existing one-time replacement-session recovery. Rejected writes now keep the original 401 without resetting identity. `recoverSession()` is an explicit replacement hook; it cannot restore an old household and must only be used after the person confirms. The frontend confirmation/resubmission interface is not implemented by B01.
