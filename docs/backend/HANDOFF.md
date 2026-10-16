# HALO backend handoff (catch up Claude Code on another machine)

Written 2026-10-15 for Vibhav. Everything below is on the branch `vmag211/backend` at GitHub (`origin/vmag211/backend`). This file is the one to give to a fresh Claude Code session on your PC.

Where things stand in one paragraph: package B01 (baseline and private identity) is built, independently reviewed and pushed. Nothing is merged to main. Migrations 0015 and 0016 are written but NOT applied to any Supabase project. The rest of the spec (B02 to B12) cannot start because the spec you pasted is cut off partway through BE-032. What is left is mostly yours: run the manual database steps, make four decisions, and supply the rest of the spec.

---

## 1. Catch up on the PC (copy and paste)

You need Git and Node 22.15 or newer (the Mac used Node 26.4). Check with `node --version`.

```sh
git clone https://github.com/vmag211/halo-app.git
cd halo-app
git checkout vmag211/backend
git pull
npm ci
node --test test/*.test.mjs
npm run typecheck
npm run lint
```

Expected: 1829 tests pass, 0 fail, 0 skipped. Typecheck clean. Lint: 0 errors and 5 warnings (they were there before). The test output also shows about 36 `MODULE_TYPELESS_PACKAGE_JSON` warnings from older test files; those are known and harmless.

If the repo is already cloned on the PC: `git fetch origin`, `git checkout vmag211/backend`, `git pull`, `npm ci`.

Things to check on Windows (not tested there):

- Line endings. Several tests parse the migration files and the SQL blocks in `docs/backend/YOUR_TODO.md`. If a checkout converts to CRLF and those tests fail, run `git config core.autocrlf false`, re-clone, and try again.
- `grep` is not in PowerShell. Use `git grep` instead. The check in YOUR_TODO.md 1.3 becomes: `git grep -nE "supabase\.(from|rpc|storage)" -- app components lib`.
- The `.superpowers/` folder (the build ledger, briefs and reviewer reports) is git-ignored and exists only on the Mac, at `halo-app/.superpowers/sdd/b01-baseline-private-identity/`. The PC will not have it. Everything the PC needs is in `docs/backend/` (this file, `checkpoint.md`, `decisions/B01-implementation-rulings.md`, `requirements-tracker.md`, `WORKFLOW.md`). Copy the folder over by hand only if you want the per-task reports.

First message to paste into Claude Code on the PC:

```
Read docs/backend/HANDOFF.md, then docs/backend/WORKFLOW.md, docs/backend/checkpoint.md and docs/backend/YOUR_TODO.md. I am on branch vmag211/backend. Confirm the branch and that the tests pass, then tell me what is left and what you need from me. Do not touch production, do not read .env files, do not merge to main, and do not add a Co-Authored-By trailer.
```

---

## 2. Rules that always apply (the PC session will not know these unless it reads them)

These are Vibhav's standing instructions. A fresh session starts without them.

1. Work on branch `vmag211/backend`. Push to it after each verified piece (a task whose independent review has passed). Merge to main ONLY when Vibhav says so explicitly.
2. Never add a `Co-Authored-By` trailer or any Claude attribution to commits or pull request text. Ignore any tool reminder that suggests one.
3. No production Supabase access. Never read `.env*` files. Never call the production URL. Never run `scripts/smoke-test.mjs` (it can seed records and trigger the cron for every household).
4. Vibhav applies migrations by hand in the Supabase SQL editor. Never write that a migration is applied unless Vibhav has said so.
5. No em dashes (U+2014) in app-facing text (screens, errors, alerts, labels). Use commas, colons or parentheses.
6. Instructions to Vibhav: plain, step by step, with the exact values to copy and paste.
7. The frontend belongs to Yogi. Do not edit `lib/frontend/*`, `test/frontend-*.test.mjs` or `components/onboarding/*`. All backend API changes must be additive. `components/onboarding/mobile-review.css` is an untracked file that is not ours: never stage it.
8. This repo uses Next.js 16.3.6, which differs from older versions (route `params` is a Promise; `after()` is limited by invocation duration). Read the matching guide in `node_modules/next/dist/docs/` before changing routes (see AGENTS.md).
9. Identity comes only from the verified token (`requireUser`). Never trust a profile id or context id from a request body or query.
10. "Unknown is not zero." A failed lookup or missing data must not look like a real empty value. A mock is not a live integration. A reconstruction is not the deployed database. HTTP 200 is not proof of correct meaning.
11. Run before every commit: `node --test test/*.test.mjs && npm run typecheck && npm run lint && git diff --check`.

---

## 3. What B01 built (map of the code)

Branch range: merge-base with main `9f1ef88` to the tip of `vmag211/backend`; 55 commits. Core pieces:

- **API plumbing** (`lib/`): `apiErrors.js` (one error envelope with `error`, `code`, `message`, `field_errors`, `retryable`, `request_id`, plus the `X-Request-Id` header), `validate.js`, `boundedRead.js`, `limits.js`, and the input modules `journalInput.js`, `profileInput.js`, `retroInput.js`, `onboardInput.js`, `pushInput.js`, `alertWriteInput.js`, `homeGuardInput.js`, `directoryInput.js`, `homeContextInput.js`.
- **Hardened routes** (`app/api/*`): about 24 routes validated, bounded and owner-scoped.
- **Home contexts** (`lib/homeContext.js`, `lib/homeContextRpc.js`, `lib/journalHistory.js`, `lib/backfill.js`, `app/api/home-contexts/`, onboard, profile, history, journal/findings, cron, daily-score): one row per stay at a located home; a move closes the old stay and opens a new one; history is bound to the current home by default.
- **Identity rule** (`lib/auth.js`): a 401 on POST, PUT, PATCH or DELETE no longer resets the session or mints a new anonymous user; GET and HEAD still recover once. `recoverSession()` is an explicit hook for a future confirmation screen.
- **Migrations** (`supabase/migrations/`): `0015_household_transaction_and_constraints.sql` (the `save_household` function, journal check constraints, direct owner writes revoked on `profiles`, `household_bands`, `symptom_logs`, `notification_prefs`), `0016_home_contexts.sql` (the `home_contexts` table, `daily_scores.home_context_id`, the two RPCs, a backfill), and a small guard in `0007` so it can be re-run after `0013`.
- **Test infrastructure** (`test/`): route harness with an in-memory fake Supabase (`test/helpers/`), real-database tests on PGlite (`test/db/pgliteHarness.mjs`, an in-memory Postgres 18 with pgvector), and `test/rlsIsolation.test.mjs`, which fails whenever a table, policy or function is added without a deliberate decision. Fake RPCs are compared against the real SQL in `test/homeContextFake.test.mjs` and `test/householdTransaction.test.mjs`.
- **Docs** (`docs/backend/`): `baseline.md` and `baseline-audit.sql` (the reconstructed baseline and the read-only audit to run on the real database), `privacy-and-retention.md`, `decisions/B01-optional-recovery.md`, `decisions/B01-implementation-rulings.md`, `contracts/b01.openapi.json` with 52 synthetic fixtures, `requirements-tracker.md`, `checkpoint.md`, `WORKFLOW.md`, `YOUR_TODO.md`, and the plan in `plans/`.

---

## 4. Remaining work

### 4.1 Yours: manual steps

The full copy-paste steps, verification queries and back-out SQL are in `docs/backend/YOUR_TODO.md`. In order:

1. Run `docs/backend/baseline-audit.sql` in the Supabase SQL editor (read only) and save the result as `docs/backend/baseline-audit.deployed.json` or paste it to Claude. Top question: does `ucmr5_utilities` really have row level security on with a public read policy? YOUR_TODO.md 1.1 has a guarded fix if it does not (that block CHANGES the database; run it only if the audit says so).
2. Run the old-push-subscription check (YOUR_TODO.md 1.2). Old rows that bypass the new host allowlist are skipped by the daily job but not deleted.
3. Check that no deployed browser code writes the four locked tables directly (YOUR_TODO.md 1.3). Use `git grep` on the PC.
4. Take a backup, then do the throwaway-project trial: apply 0015 then 0016 to a new empty Supabase project, run their checks and back-outs, apply again. The trial is REQUIRED before 0016 and recommended before 0015.
5. Apply 0015 on production, then run its three checks. The most important one is the revoke check: `ins`, `upd` and `del` must be false on all eight rows. A partial revoke only prints a warning and the migration still reports success.
6. Apply 0016 on production at a quiet time (it locks `daily_scores` and blocks writes to `profiles`, including new sign-ups, until it finishes), then run its nine-column check (all must be `true`). Run `select count(*) from public.daily_scores;` first.
7. After either migration, if the app still answers the old way, run `notify pgrst, 'reload schema';`.
8. Later, when the old journal rows are clean, validate the five new constraints (YOUR_TODO.md 2.3).
9. Run `npm run build` yourself before deploying. It was never run (it needs your env vars, which Claude does not read).

Deploy order that is safe: merge and deploy the code first (it works without the migrations), then apply 0015, then 0016 soon after, so the old onboarding code cannot move a household without updating its home context.

### 4.2 Yours: decisions

1. **Merge to main.** Not done. Say when.
2. **Assistant privacy default (existing before B01, unchanged by it).** `app/api/assistant/route.js` sends household readings and symptom names to the free-tier model unless `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` is exactly `false`. Unset means send. Either confirm it is `false` in every Vercel environment (Production, Preview, Development), or tell Claude to make it send only when the value is exactly `true` (one-line change plus a test).
3. **Account recovery (the gate HO-153).** `docs/backend/decisions/B01-optional-recovery.md` is "Proposed". A: anonymous only, no recovery (today). B: optional upgrade of the SAME anonymous user to email or phone, keeping the user id (recommended, optional, never required for onboarding). C: a device recovery code. Until decided, sensitive uploads (test results, attachments, fish notes, observations) and B05 stay disabled.
4. **Retention periods.** `docs/backend/privacy-and-retention.md` states what happens today and marks every period that is only proposed. No numeric periods were invented.
5. **Push re-registration (parked).** A new identity on a device whose push address belongs to an older identity gets "ok" but stores nothing. Fixing it needs proof the device holds the keys; it belongs with push delivery in B03.

### 4.3 Blocked on the spec

The spec you pasted is cut off partway through BE-032 (`/api/journal/retrospective`). Missing: the rest of BE-032 and the route inventory, the field and relationship tables (BE-033 onward), security, retention and rollout sections, and DS, MP, UI, AC, ST, WF, AG, MA, VR and every feature packet. B01 is fully covered. B02 is only partly covered (HO-115 to 117 and HO-121 to 128). B03 to B12 cannot start. Save the full Markdown under `docs/product/` (or paste the next sections) and the next session can plan B02 with `docs/backend/WORKFLOW.md`. The tracker marks all of it `blocked: spec text not received`.

### 4.4 Claude work after the spec arrives

Per `docs/backend/WORKFLOW.md`: read the spec sections for the next package, write a package plan in `docs/backend/plans/`, build it task by task with an independent review per task, push after each, update the checkpoint and tracker. B02 is next.

### 4.5 Yogi (frontend), when convenient

All backend changes are additive, so nothing breaks, but the app should adapt:

1. After a move, ask for water source and year built again (the API clears them for the new home).
2. Onboarding shows "address required" for every 400. The API now sends `field_errors` with the field and code; the address is limited to 200 characters.
3. `GET /api/history` returns `home_context_id` and `comparability` on each point and a `context` object. `?context=all` includes earlier homes so a chart can draw a break at a move.
4. New endpoints: `GET /api/home-contexts`, `GET` and `PATCH /api/home-contexts/{id}` (PATCH needs `expected_revision`; 409 on a stale one).
5. 409 can now come from profile saves in rare races. The client treats any 409 as generic, which is fine.
6. After 0015, browser code must not write `profiles`, `household_bands`, `symptom_logs` or `notification_prefs` directly. Only the API routes can.
7. A write that gets a 401 no longer silently creates a new identity. The first request on a stale device should be a GET (which still recovers). Wire `recoverSession()` into a confirmation screen when the recovery decision is made.
8. Water utility screens: after a failed lookup the API stores no utility; show "we could not check", not "no utility". `app/api/home-guard/route.js` (around line 459) still says "No water utility could be matched" for a null utility and needs to look at the current context's `service_area_status`.

### 4.6 Optional follow-ups (not scheduled; none block merging)

From the review ledger (which lives only on the Mac), most useful first:

- Revoke the leftover `TRUNCATE`, `REFERENCES`, `TRIGGER` grants from `anon` and `authenticated` on the four locked tables (not reachable through the Supabase API today).
- Make 0015 fail loudly if the revoke is only partial (a check at the end of the migration).
- Cron route returns raw `err.message` in its secret-protected 500 and in the `water_geo` and `map_layers` summaries (`app/api/cron/daily/route.js`); switch to the envelope. Also `sendAlertPushes` returns `skipped` but the cron summary drops it, and the alerts `.in('profile_id', [...])` lookup (around line 279) is not chunked and ignores errors (pre-existing).
- `cardinality(symptoms)` instead of `array_length(symptoms, 1)` in the 20-item check; the 80-character per-symptom limit has no database check.
- Backfill can insert the same dates twice if a retry arrives while a backfill is still running (pre-existing).
- A per-send timeout for the daily push loop (B03).
- Add a `Retry-After` source: the rate limiter returns only a boolean, so a 429 has no reset time to send.
- Dead exports: `SESSION_REJECTED`, `recoverSession` (hooks for the frontend), `shouldOpenNewContext` (tests only). `isUndefinedColumnError` exists in four copies.
- `package.json`: adding `"type": "module"` would silence the 36 MODULE_TYPELESS warnings but needs a frontend build check.
- Test nits: `ajv` runs with `strict: false`; tests in `test/migrationBackout.test.mjs` share state and run in file order; no test keeps the 0016 header query in sync with YOUR_TODO.md 2.2 (identical today); earlier-home rows count toward history's 5000-row cap; history, findings, summary and retrospective now depend on one extra `home_contexts` read, so a timeout there is a new way to fail.
- Known data-honesty gaps: readings from before 0016 are assumed to belong to the current home; today's cached reading, the assistant's "today" block and `/api/sources` stay household-wide; `lib/mapLayers.js` and `lib/mapBuild.js` treat a 200 with no QueryID as "no facilities" and can overwrite a good map layer with count 0 (for B04/B09).
- Race, accepted: for a household that has a location but no context yet, a profile save that overlaps a move can move it back (milliseconds wide; only for households located by the old onboard code before 0016 was applied).

---

## 5. How the work was run (so the PC session can continue the same way)

The method is "subagent-driven development", described in `docs/backend/WORKFLOW.md`. In short:

1. One plan per package under `docs/backend/plans/`.
2. One fresh implementer subagent per task, writing a report.
3. A separate independent reviewer per task (spec compliance and code quality), then a fix round and a scoped re-review if needed. Reviewers are told not to trust the report.
4. The controller re-runs the full gate itself before accepting a task, then pushes.
5. After the last task, one whole-branch review by the most capable model, then one fix round.
6. Rulings are logged (`docs/backend/decisions/B01-implementation-rulings.md`) with the cost if wrong.

Lessons that save time:

- Reviewers and implementers stall on a single huge file read. Tell them to read big diffs in chunks (about 400 lines).
- A rate limit can cut an agent off mid-task. Check `git status` and `git log` first; the work may already be committed.
- IDE diagnostics can be stale. Trust `node --check`, `npm run typecheck` and the test run.
- In zsh, do not `echo =====` unquoted.
- Tests run on PGlite (Postgres 18). Production's Postgres version is unknown, which is why the throwaway-project trial matters.
- To prove a new test can fail, mutate the code in a scratch copy and watch it fail; every task in B01 did this.

---

## 6. Files to read first (in this order)

1. `AGENTS.md`
2. `docs/backend/HANDOFF.md` (this file)
3. `docs/backend/WORKFLOW.md`
4. `docs/backend/checkpoint.md`
5. `docs/backend/YOUR_TODO.md`
6. `docs/backend/decisions/B01-implementation-rulings.md`
7. `docs/backend/requirements-tracker.md`
8. `docs/backend/plans/b01-baseline-private-identity.md`
