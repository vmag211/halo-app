# Backend: what you (Vibhav) need to do

Updated 2026-10-10 after Codex resumed Claude Code's B01 work on `vmag211/backend`.
No database changes were applied by this continuation. Production remains unaudited here.

Status right now:

- Claude's last completed implementation: Tasks 1 to 9c, through `4b07435`. The starting branch passed all 1,723 tests during this continuation.
- Task 10 is committed at `d492e9e`: rejected writes no longer replace identity or replay; recovery options and a complete privacy inventory are documented. Neither decision is approved.
- Task 11: executable API contracts, synthetic fixtures, handler conformance, requirements tracker and current checkpoint are written. Final test counts and commit evidence are in `docs/backend/checkpoint.md`.
- Branch and push state: `vmag211/backend` is the working branch, and the controller pushes it after each reviewed task. Run `git log origin/vmag211/backend..HEAD` to see which commits are not pushed yet (an empty list means everything is pushed). Nothing was merged to main.
- Migrations 0015 and 0016 are written and locally tested but NOT applied anywhere (not to production, and not to any staging or disposable project by this work).
- `docs/backend-progress.md` is an older September status; use the checkpoint for B01.
- Your next actions are still the read-only audit, disposable-project migration verification, recovery/privacy decisions and supplying the missing full spec. The instructions below remain the manual checklist.

The sections below are in the order to do them. Part 1 can be done today and is read only. Part 2 changes your database, so do it only when you are ready.

---

## Part 1. Read-only checks (safe, change nothing)

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

2. Expected: nothing that writes to those four tables from browser code (server routes using `supabaseAdmin` are fine). If you see a browser file calling `.from('profiles')`, `.from('symptom_logs')`, `.from('household_bands')` or `.from('notification_prefs')` with insert, update, upsert or delete, STOP and tell Claude before doing Part 2.

---

## Part 2. Database changes (apply by hand, in this order)

Both migrations are files in `supabase/migrations/`. They are safe to run twice. The existing household/onboard/history routes work with or without them; explicit home-context routes return a non-retryable 503 until 0016 exists (the household save answers `"transactional": false` until 0015 is in, and onboarding answers `"home_context": null` until 0016 is in).

Recommended order of operations:

1. Wait until the B01 checkpoint is reviewed and the branch is approved, merged and deployed (see Part 3). The new routes tolerate the migrations being missing, so deploying first is safe.
2. Optional but safer: try both migrations on a throwaway Supabase project first.
3. Then apply 0015, then 0016, on production. Do 0016 soon after 0015 and after the new code is live, so the old onboarding code does not move a household without updating its home context.

### 2.1 Apply 0015 (transactional household save and database constraints)

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

### 2.2 Apply 0016 (home contexts), at a quiet time

Run it when few people are using the app. While it runs, `daily_scores` cannot be read or written. Needs 0015 first.

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
4. Optional: `select origin, count(*) from public.home_contexts group by origin;` shows how many legacy contexts the migration created.

Known limit (documented in the migration): readings from before a past move cannot be told apart, so a household's older readings are attributed to its legacy context and flagged `legacy_migration`.

### 2.3 Later, once the old rows are clean

Only when the optional check in 2.1 step 2 returned no rows (fix or delete what it listed first). This turns the new checks into full constraints:

```sql
alter table public.symptom_logs validate constraint symptom_logs_band_check;
alter table public.symptom_logs validate constraint symptom_logs_severity_check;
alter table public.symptom_logs validate constraint symptom_logs_note_length_check;
alter table public.symptom_logs validate constraint symptom_logs_symptoms_count_check;
alter table public.symptom_logs validate constraint symptom_logs_entry_date_check;
```

If one of them fails, an old row still breaks that rule. Fix or delete the rows the check in 2.1 step 2 lists, then run it again.

---

## Part 3. Decisions only you can make

1. **Merging to main.** Claude will not merge. When B01 is finished it will tell you, and nothing reaches main until you say so explicitly. The branch `vmag211/backend` is the working branch and the controller pushes it after each reviewed task, so `git log origin/vmag211/backend..HEAD` shows what is not pushed yet.
2. **The rest of the spec.** The spec you pasted is cut off partway through BE-032 (`/api/journal/retrospective`); BE-033 onward was not received. Missing: the rest of BE-032 and of the route inventory, the field and relationship tables (BE-033 on), security, retention and rollout sections, plus DS, MP, UI, AC, ST, WF, AG, MA, VR and every feature packet. B01 is fully covered. B02 is only partly covered. B03 to B12 cannot start without them. Fix: save the full Markdown as a file under `docs/product/` or paste the next sections into the chat.
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

## Part 4. For Yogi (frontend), when convenient

None of this blocks the backend; all the API changes are additive.

1. After a move, the app should ask for water source and year built again (the API now clears them for the new home).
2. Onboarding shows "address required" for every 400. The API now sends `field_errors` with the exact field and code, and the address is limited to 200 characters.
3. `GET /api/history` now returns `home_context_id` and `comparability` per point and a `context` object. `?context=all` shows readings from earlier homes, so the chart can draw a break at a move.
4. The API now has `GET /api/home-contexts`, `GET` and `PATCH /api/home-contexts/{id}`. PATCH needs `expected_revision` and can return 409.
5. The profile and home-context PATCH saves can return 409 in rare races or for stale revisions. Household PUT does not currently emit 409. The client currently treats any 409 as a generic error, which is fine.
6. Browser code must not write `profiles`, `household_bands`, `symptom_logs` or `notification_prefs` directly after 0015. Only the API routes can.
7. Water utility screens: a missing utility after a failed lookup should read "we could not check", not "no utility". `app/api/home-guard/route.js` (around line 451) still says "No water utility could be matched" for a null pwsid. That route still needs to consult the current context's `service_area_status`.

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
