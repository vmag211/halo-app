# Backend: what you (Vibhav) need to do

Updated 2026-10-17. Part 1 is complete and the throwaway-project trial has passed. Production has NOT been migrated yet.

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

**Not applied yet.** Needs 0018 first.

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

**Not applied yet.** Needs 0019 first (only because the migrations are applied in order; 0020 touches nothing 0018 or 0019 created).

Quiet, like 2.3 and 2.4: it creates three new tables and one index and does not read or write any existing table, so nothing else is blocked while it runs. Creating the foreign keys to `profiles` takes a brief SHARE ROW EXCLUSIVE on that table, so a new anonymous sign-up could wait a moment.

What it is for: Luna, the conversational assistant, holds the conversation on the server. The browser sends one new sentence per turn and never puts the person's own message on the screen itself, so the stored transcript, including their own turn, is the only thing that can give their question back to them. A run is one attempt to answer one turn: `POST /api/luna/messages` has to answer inside the browser's 20 second timeout, so it records the question, starts a run and returns it, and the answer is collected afterwards by polling.

**Applying this does not turn Luna on.** The capability stays behind a server-enforced feature flag that is off by default (BE-351), so nothing is reachable until `HALO_FEATURE_LUNA` is set to `on` in an environment deliberately. Two more things are open before Luna ships: no retention period for a stored conversation turn has been approved (see Part 3 item 4 and the three `luna_*` rows in `docs/backend/privacy-and-retention.md`), and the model ids must be set explicitly in the deployment (`ASSISTANT_EMBED_MODEL` and `ASSISTANT_CHAT_MODEL`; an unset one now fails loudly instead of quietly selecting a paid OpenAI model).

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

**Not applied yet.** Needs 0020 first (only because the migrations are applied in order; 0021 touches nothing 0020 created).

Quieter than 2.3 and 2.4, and a little busier than 2.8. It creates one new table, adds one column to `profiles` and five to `alerts`, and creates three functions and seven triggers (see the settings bullets below). Every added column has either no default or a constant one, so Postgres records it in the catalog instead of rewriting either table and no existing row is scanned; the lock it takes on each of those two tables is held for the moment the catalog is written. Its one check on `profiles` and four on `alerts` are added as full constraints rather than `NOT VALID`, which does scan those two tables, because no existing row can fail them: a new column starts null on an existing row, and `alerts.revision` starts at the constant 1. Both tables are small (one row per household, a handful of alerts each). Creating the foreign key to `profiles` takes a brief SHARE ROW EXCLUSIVE on it, so a new anonymous sign-up could wait a moment. Creating the triggers takes the same brief lock on `profiles`, `notification_prefs` and `household_bands` (a re-run drops each trigger first, which locks its table for a moment), so a save on one of those could also wait a moment.

What it is for: neither of this package's two surfaces can be served from the tables that already exist.

- **Settings.** The snapshot's year, water source, language, five notification booleans and seven household bands already have homes (`profiles`, `notification_prefs`, `household_bands`) and are left exactly where they are. Its display choices, quiet hours, calendar values and the three switches that say what Luna may be told have none, and neither does the one `revision` a save is checked against. Those go in the new `public.profile_preferences`, one row per household, keyed by the profile. Nothing already housed is copied into it.
- **Tenure.** The contract needs `owner`, `renter` or `other`, and `profiles.renter_mode boolean` cannot tell an owner from an other. `profiles.tenure` is the new three-value column. `renter_mode` is left exactly as it is, because every existing reader uses it, and **nothing is backfilled**: a backfill would have to call every non-renter an owner, which is the very claim the boolean cannot support. A household reads as unanswered until somebody is asked. There is deliberately **no** check tying `tenure` to `renter_mode`: the existing household save writes `renter_mode` on its own, and such a check would turn that valid save into an error and lose the household change with it. Instead a trigger keeps the two in step inside the same row write, for every writer: a `renter_mode` of true makes an owner or other a renter, false makes a renter unanswered, and a new three-state answer sets `renter_mode` from it. An unanswered tenure is shown as renter when `renter_mode` is true and as other otherwise.
- **Settings saves and the settings revision.** `public.save_settings` makes a whole settings save one transaction: the revision check and every table it writes, home details included, so a save that fails applies nothing. Triggers on `profile_preferences`, `profiles`, `notification_prefs` and `household_bands` advance the settings revision whenever any other screen (notifications, household, profile, onboarding, home details) changes a value the settings screen shows, so a settings screen open on another device has to reload instead of putting the old value back. A write that changes nothing advances nothing.
- **Alerts.** Each alert gains `revision` (not null, 1 on every existing row), which is the whole optimistic-concurrency contract for marking one read or dismissed, plus `category` and a navigation target (`target_tab`, `target_destination`, `target_learn`). The four presentation columns start null, meaning "no producer named one".

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0021_settings_preferences_and_alerts.sql` and run it. Safe to re-run.
2. Run the verification query in the comment at the end of that file. Expect one row, all seven columns true. `no_client_access` false is the one that matters: it means the browser roles can still reach the preferences table, and you should send Claude the row rather than leaving it. `revision_kept_by_the_database` false means a trigger or the save function is missing or callable by a browser role; send Claude the row for that too.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, `GET` and `PATCH /api/settings`, and `POST /api/alerts/state`, answer 503 `feature_unavailable` and nothing is written. `GET /api/alerts` never answers 503 for this: it keeps every key the current app reads (`alerts`, `count`, `unread`, `truncated`) and only leaves out the new fields.

Until this is applied, the settings and alerts-state routes report the feature as unavailable, and `GET /api/alerts` keeps every key the current app reads and degrades only the new fields; it never answers 503. `PUT /api/notifications` and `PUT /api/household` read nothing this migration adds. Once it is applied, the database advances the settings revision when either changes a value the settings screen shows, and keeps `tenure` in step with the household save's `renter_mode` in the same row write (B04 Rulings S12 and S13); neither save can fail because of it. One visible change after it is applied: the current `GET /api/alerts` reads with `select *`, so each alert in its response gains `revision` and nulls for the four presentation columns. That is additive and no approved screen reads those keys.

#### If you need to back out 0021

The settings and alerts-state routes go back to answering a non-retryable 503 `feature_unavailable`, exactly as before it was applied, so this disables the two new surfaces rather than breaking the existing app. `GET /api/alerts` keeps every legacy key and drops only the new fields. The table is dropped first, then the triggers and the three functions, then the columns (the triggers name the tenure column, so they have to go before it). In a **New query**, paste and run this (safe to run twice).

<!-- backout-0021 -->

```sql
drop table if exists public.profile_preferences;
drop trigger if exists profiles_tenure_reconcile on public.profiles;
drop trigger if exists profiles_settings_revision on public.profiles;
drop trigger if exists notification_prefs_settings_revision on public.notification_prefs;
drop trigger if exists notification_prefs_settings_revision_insert on public.notification_prefs;
drop trigger if exists household_bands_settings_revision on public.household_bands;
drop trigger if exists household_bands_settings_revision_insert on public.household_bands;
drop function if exists public.save_settings(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb);
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

What this does NOT restore or undo: every household's display, quiet-hours, calendar and Luna-context choices are deleted for good, and the settings revision with them, because the whole table goes. Every alert keeps its title, message, read and dismissed state; what is lost is each one's revision, category and navigation target, so a browser holding a revision can no longer mark that alert read and has to reload. Revisions restart at 1 when 0021 is reapplied, for alerts and the settings row alike, so once a row has been changed back up to the number a stale browser still holds, that browser's revision would match again: after a back-out and reapply, have every open browser reload. The tenure answer is lost too, and reapplying leaves every household unanswered again rather than guessing from `renter_mode`. Nothing cascades: `renter_mode`, the notification preferences and the household bands are untouched, so the existing settings screens keep their values, and the household, notifications, profile and onboarding saves go back to working exactly as they did before 0021.

### 2.11 Apply 0022 (a household's saved discovery area)

**Not applied yet.** Needs 0021 first (only because the migrations are applied in order; 0022 touches nothing 0021 created).

Quiet, like 2.3, 2.4 and 2.9: it creates one new table and does not read or write any existing table, so nothing else is blocked while it runs. Creating the foreign key to `profiles` takes a brief SHARE ROW EXCLUSIVE on that table, so a new anonymous sign-up could wait a moment.

What it is for: the Explore screen lets a household choose the area it wants to discover things in, and that choice has to be kept by the server so every device sees the same one. It goes in the new `public.explore_areas`, one row per household, keyed by the profile (not by the home: the area does not move when the household moves). What is stored is the county-level place the household picked from the location search (its id, name, state, label and time zone), not the home address. A household that has never saved one has no row at all and reads as "no area, revision 1"; the first save writes revision 2, which is why a check refuses anything lower. Clearing the area keeps the row with an empty place and a higher revision.

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0022_explore_areas.sql` and run it. Safe to re-run. If an earlier copy of 0022 was ever run anywhere, run the back-out first (the block below, then `notify pgrst, 'reload schema';`), because a re-run keeps a check it already has under the same name rather than replacing it.
2. Run the verification query in the comment at the end of that file. Expect one row, all five columns true. `no_client_access` false is the one that matters: it means the browser roles can still reach the table, and you should send Claude the row rather than leaving it.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, `GET` and `PATCH /api/explore/area` answer 503 `feature_unavailable` and nothing is written.

Until this is applied, the discovery-area routes report the feature as unavailable. Nothing else reads this table, so the existing app is unaffected either way. No retention period for a saved area has been approved (see Part 3 item 4 and the `explore_areas` row in `docs/backend/privacy-and-retention.md`).

#### If you need to back out 0022

`GET` and `PATCH /api/explore/area` go back to answering a non-retryable 503 `feature_unavailable`, exactly as before it was applied, so this disables the saved discovery area rather than breaking the existing app. In a **New query**, paste and run this (safe to run twice).

<!-- backout-0022 -->

```sql
drop table if exists public.explore_areas;
```

Then run `notify pgrst, 'reload schema';`.

What this does NOT restore or undo: every household's chosen discovery area is deleted for good, and its revision with it, because the whole table goes. Revisions restart at 1 (never saved) when 0022 is reapplied, so once a household has saved back up to the number a stale browser still holds, that browser's revision would match again: after a back-out and reapply, have every open browser reload. Nothing cascades: no other table references this one, and 0021's table and columns are untouched.

### 2.12 Apply 0023 (a household's tasks for My Week)

**Not applied yet.** Needs 0022 first (only because the migrations are applied in order; 0023 touches nothing 0022 created).

Quiet, like 2.11, with one difference. It creates three new tables, one index and two functions, none of which anything is waiting on, and the foreign keys to `profiles` take a brief SHARE ROW EXCLUSIVE on that table, so a new anonymous sign-up could wait a moment. It also adds one trigger to `public.operations` (0017's ledger), which takes the same brief lock on that table: any save that is claiming or settling its ledger row at that moment waits for it. Nothing existing is read or rewritten.

What it is for: My Week (`/app`, `/plan`) shows "Your tasks could not load" today because nothing on the server can hold a task. 0023 adds:

- `public.household_actions`: one row per task, keyed by the household (not the home: tasks do not move when the household moves). It holds the title, reason, origin, date, state (`saved`, `waiting` or `completed`), a per-task revision, and the task's planning details as one `meta` value exactly as the app sent it (time, duration, time zone, recurrence, completion date, a private note of up to 3,000 characters and a history of changes). **The title and the note are free text somebody typed.**
- `public.household_action_preferences`: the six My Week preferences (the week's focus sentence, food topics, weekly availability, dismissed season prompts, the weekly review time and an outdoor plan with a place name).
- `public.household_action_state`: one counter per household that a save is checked against, so two saves at once cannot each pass a check the other then breaks. It is never shown to anyone.
- `read_household_actions` (the one snapshot every My Week read uses) and `commit_household_actions` (one save: every task, detail and preference change and the save's own ledger receipt commit together or not at all, so a save that "did not apply" really did not).
- A guard on `public.operations`: once a My Week save's ledger row says `succeeded` or `failed`, its status can no longer change, so a save whose response is lost on the way back can never be recorded as failed after its task was written. Every other kind of operation is unaffected.

**Applying this does not turn My Week's tasks on.** The routes that use it are not built yet, and when they are, they stay behind a server flag that is off by default (`HALO_FEATURE_TASKS`), because no retention period for a task has been approved (you confirmed on 2026-10-18 that it stays off until you approve one; see Part 3 item 4 and the three `household_action*` rows in `docs/backend/privacy-and-retention.md`).

1. SQL Editor, **New query**, paste the whole of `supabase/migrations/0023_household_actions.sql` and run it. Safe to re-run. If an earlier copy of 0023 was ever run anywhere, run the back-out first (the block below, then `notify pgrst, 'reload schema';`), because a re-run keeps a check it already has under the same name rather than replacing it.
2. Run the verification query in the comment at the end of that file. Expect one row, all six columns true. `no_client_access` false is the one that matters: a task is free text somebody typed, so if it comes back false, stop and send Claude the row.
3. Run `notify pgrst, 'reload schema';`. Until it reloads, the My Week routes (once built) answer 503 `feature_unavailable` and nothing is written.

Until this is applied, the My Week task routes report the feature as unavailable. Nothing else reads these tables, so the existing app is unaffected either way.

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


---

## Part 3. Decisions only you can make

1. **Merging to main.** Claude will not merge. When B01 is finished it will tell you, and nothing reaches main until you say so explicitly. The branch `vmag211/backend` is the working branch and the controller pushes it after each reviewed task, so `git log origin/vmag211/backend..HEAD` shows what is not pushed yet.
2. **The rest of the spec: resolved, nothing needed from you.** The copy at `docs/product/HALO_BACKEND_WORKING_SPEC.partial.md` is cut off partway through BE-032, but the complete 521,027-byte spec is already in this repository at `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` on `origin/codex/october15-review-refinement` (sha256 `fc1fec4b...415be86`, verified 2026-10-17 against Yogi's wiring packet manifest). B02 is planned from it. B03 to B12 are no longer blocked on a missing document; they are blocked only on being planned in dependency order.
3. **Account recovery (HO-153, the gate).** Task 10 wrote `docs/backend/decisions/B01-optional-recovery.md`, status "Proposed, awaiting Vibhav's decision". The options:
   - A: anonymous only, no recovery. Losing the device loses the household. This is how it works today.
   - B: optional upgrade of the SAME anonymous user to email or phone, keeping the user id so every record and permission is kept. Claude recommends B, optional, never required for onboarding.
   - C: a device recovery code.
   Until you decide, uploads of sensitive input (test results, attachments, fish notes, observations) stay disabled. This blocks B05.
4. **Retention periods.** `docs/backend/privacy-and-retention.md` lists what is kept, for how long TODAY (until the user deletes or the account is deleted), and mark every period it only PROPOSES. Those need your decision. Claude will not invent retention periods as facts.
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

8. **The public map, an alternative to a backend change (D1).** The registry marks `map.layer`, `map.comparison`, `map.district` and `map.brief` public, and `/map` builds a credential-free runtime unless `?access=owned` (`components/production/PublicFrontend.tsx:14-16,23`). Every map route requires a session, so the default `/map` shows no live layer, district or comparison today. Vibhav is deciding whether the backend gets a reviewed cache-only public read (open question 1). The alternative needs no backend change and BE-047 permits it: reuse the anonymous bootstrap on `/map`, so the visitor has a session. The cost is one anonymous auth user per visitor.
9. **(9.3) `organizations.search` cannot say "directory unavailable".** It is not built. When it is, an unreadable directory will be a 5xx, never `items: []`. The contract also needs an availability field like `opportunities.search` has (`lib/frontend/production/explore-service.ts:42,55`), so that a failed read is not shown as "no matches".
10. **(9.4) Treat a `cancelled` summary operation as terminal.** The operation ledger allows `cancelled`, but `validSummaryReceipt` rejects it, so `useProductionSummary` re-parks the operation for ever. The backend will never settle a `summary` operation as `cancelled`, and the reaper settles to `failed`. The client should still not lock on the word.
11. **(9.7) `X-Halo-Home-Context` is sent, and B05 ignores it.** The saved discovery area belongs to the household, not to a home context, so a foreign or unknown value changes nothing. Which home context a summary uses is Vibhav's decision when summaries are planned.
12. **(F2) Key the comparison's compound selector on a code, not on copy.** `MapComparison.tsx:36` decides water with `first?.scope === c.scopeWater`. The backend sends the literal `'Public water system'` to match, but any rewording of that copy would silently break the selector.
13. **(F3) The Explore area chooser promises city and ZIP.** Its copy says "For example, Charlotte or 28208" and "Try a nearby city or a ZIP code" (`ExploreDiscovery.tsx:59,62`). The backend serves North Carolina counties only (D4), so "Charlotte" and "28208" answer no candidates, and `validPlaces` has no way to say "unsupported geography" (AC-115). Until open question 2 is decided, the copy should ask for a county.
14. **(F4) Send only the compared pair to `map.comparison`.** `MapPreview.tsx:316` sends every visible id in one GET parameter. The server accepts up to 2,000, but about 780 NC ids already exceed common URL limits (about 18 bytes each once encoded), and a 431 reads as "blocked". Today's layer of about 290 systems fits.
15. **(Account, frontend N1) Drop a receipt's own id from the ids the account surface waits on.** `components/production/useAccountService.ts:21` copies `receipt.snapshot.unresolvedOperations` into `unknown` as it is. The backend now never lists a receipt's own operation there (pinned in `test/routesAccountCommands.test.mjs`, "A receipt never lists its own operation as unresolved"). As defense in depth, filter out the receipt's own `id` at `:21` and at the matching hydrate sites that set `unknown` from a snapshot, so that a self-listing receipt can never lock the surface with no way out but a reload.

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
