# HALO backend: current state

One page, regenerated as work lands. **Read this first**, then `WORKFLOW.md` for how to work, then the
package plan you are continuing. `checkpoint.md` holds the per-package detail this page summarises.

Updated 2026-10-19: B04, B05 and B06 complete, and **the frontend merged in** (`1253025`, the frontend
ref at `5ac06f6`). `vmag211/backend` is not merged to main. On the merged tree **3,739 tests pass**
(3,384 backend, 709 frontend, 354 shared), 0 fail, 0 skipped; `npm run typecheck` clean;
`npm run lint` 0 errors and 7 warnings (the backend's five: district, backfill, assistantRag.test,
uploadData, daily-score; and two of the frontend's own); `next build` passes with placeholder Supabase
variables. Run any build in a scratch worktree: `next build` auto-loads `.env.local`, which the
boundary forbids reading.

## What exists

43 route files under `app/api` on `vmag211/backend`, exporting 56 method handlers. The frontend
registry declares **72 operations**, each with a path and a method (`lib/frontend/production/runtime.ts`
on `origin/codex/october15-review-refinement`). **25 have a backend route at the declared path and
method; 47 do not. Of the 25, 23 answer**: `actions.load` and `actions.commit` answer 503 while the
`tasks` flag is off. Measured 2026-10-19 by the B04 Task 3 reviewer on `b5e978c` plus B04 Task 3; B06
Task 6 added no route. Method: every
`'<op>': {path, method}` entry of `productionOperations` (the method defaults to GET), matched as an exact
method-and-path pair against every `export ... GET|POST|PUT|PATCH|DELETE` in `app/api/**/route.js`, read
with `git grep` on the tip being measured. A match means only that a route exists at that path and
method. It does not mean the body passes the operation's validator: the per-package conformance suites
are what show that. The 23, by the package that made them answer:

| Package | Operations |
| --- | --- |
| Before the packages | `map.layer`, `map.district`, `alerts.read` (the legacy inbox route) |
| B02 | `operations.read`, `account.read`, `account.command`, `recovery.request`, `recovery.status` |
| B03 | `luna.capabilities`, `luna.conversations`, `luna.clear`, `luna.message`, `luna.run`, `luna.cancel` |
| B04 2a | `settings.read`, `settings.save` (`GET`/`PATCH /api/settings`) |
| B04 2b | `alerts.update` (`POST /api/alerts/state`), and `GET /api/alerts` extended to the contract read |
| B05 | `locations.search`, `explore.area.read`, `explore.area.save`, `map.comparison`; and `map.layer` and `map.district` fixed (`quarter=latest`, the incomplete geography) and conformance-tested |
| B06 Task 5 | `week.changes`, `week.acknowledge` |

B06 `actions.load` and `actions.commit` are merged behind the `tasks` flag, which answers 503 while
off, so they are not counted as answering. The count was 14 of 72 on 2026-10-18, and the frontend
closeout note's 68 operations is four short.

**The remaining work is backend, not wiring.** The frontend half is already written. Components call
`runtime.request('<operation>')`, the registry resolves the path, and a validator checks the response, so
a route landing at the declared path and method with a body the validator accepts makes an operation live
with no frontend edit. That file says so itself: "These are explicit frontend contracts, not claims that
the backend implements them." Two exceptions need frontend work: recovery needs the client to send a
Turnstile token field, and `evidence.read` waits on the provenance decision below.

The two halves are now in one tree (`1253025`), but **nothing has yet been driven end to end through a
browser**. The per-package conformance tests run the real handlers against validators transcribed
verbatim from the frontend, and the client's own consumption logic; they caught every design-breaking
mismatch so far, including two that shipped (Luna's empty conversation, the account receipt that locked
itself). They are not a substitute for one browser pass. The next integration steps, in order: point
`scripts/stage-test-server.mjs` at a localhost Supabase placeholder and run `test:stage` /
`test:production` (they hardcode a `halo-test.supabase.co` URL today); decide who owns
`X-Halo-Home-Context`; replace transcribed validators with imports of the real
`lib/frontend/production/*-service.ts` where Node's type stripping allows; and make the Supabase clients
lazy so `next build` needs no secrets. About 31 Playwright UI tests already fail on the frontend ref alone
(partly a Sunday week-start hydration bug), so a UI run must be compared against that baseline.

| Package | State |
| --- | --- |
| B01 baseline, identity, home context | Complete |
| B02 identity linking and recovery | Complete except two tasks dropped on purpose, see below |
| B03 Luna, conversational MVP | Complete. Six endpoints, answers and cites, does not act |
| B04 settings and alerts | Complete. Four operations (`settings.read`, `settings.save`, `alerts.read`, `alerts.update`), contract `b04-1` with the reconcile, Rulings S1 to S16. `GET /api/capabilities` and `GET /api/evidence` dropped, see below |
| B05 discovery and summaries | Complete except what was dropped, blocked or gated, see below. Four operations built, two map routes fixed, contract `b05-2` |
| B06 My Week (tasks) | Complete. `actions.load`, `actions.commit`, `week.changes`, `week.acknowledge` and the `actions` reconcile, migration 0023, contract `b06-1`, Rulings H1 to H33. `actions.*` behind the `tasks` flag; task retention decided 2026-10-19, so the flag may be turned on once 0023 is applied; the week strip is ungated |

## Migrations

**0001 to 0018 are applied to production** (0015 and 0016 on 2026-10-17 with 0015's four checks
validated; 0017 and 0018 the same day; the `TRUNCATE` privilege remedy in `YOUR_TODO.md` 2.7 also
applied). Use the state query in `YOUR_TODO.md` 2.6 rather than trusting any document, including this one.

**0019 to 0023 are applied to production** (2026-10-19, by Vibhav, in one paste of
`docs/backend/apply/apply-0019-to-0023.sql`; `verify-0019-to-0023.sql` returned
`all_migrations_ok = true, checks_run = 26, failing = none`). Production still runs `main`, which does
not use these tables, so nothing changes for users until the backend branch is deployed. History: (0021 merged 2026-10-18 and amended three times by
2026-10-19: `save_settings` and the revision and tenure triggers, Rulings S11 to S13; review fixes A
to D with S15, the save settling its own ledger row; and fixes E and F. It carries no
tenure/renter_mode cross-check, Ruling S7. 0022, `explore_areas`, for B05; 0023, My Week's tasks,
`YOUR_TODO.md` 2.12). All five are additive and none rewrites data. **0021 is final and safe to apply
as far as review can tell**: the fourth review approved it, and both deadlocks are fixed. Those were a
first-time notifications write against a save, and a save during account deletion. They were reasoned
through on paper, because PGlite has one connection. Its apply steps, including the 100-row "Mark all
as read" gateway check, are `YOUR_TODO.md` 2.10.
Apply them as one batch when ready; each has apply steps and a tested back-out block in `YOUR_TODO.md`
(0022 is 2.11). Until 0022 is applied both Explore area verbs answer a non-retryable 503.

## What is deliberately not built, and why

- **Account recovery cannot complete end to end.** Vibhav stopped the package on 2026-10-18 to move to
  features. `/api/recovery/complete` and the verification step (the thing that marks a challenge
  `verified`) are unbuilt. Five things block recovery shipping: the Turnstile site key, the Turnstile
  secret key, the frontend sending a token field, the verification step, and backup plus retention
  decisions. `/api/recovery/request` and `/api/recovery/status` exist and are safe; the capability flag
  is off.
- **Ruling 31 binds whoever builds the verification step.** The challenge row is keyed by the caller's
  nonce and the emailed link carries no nonce binding, so without binding the clicker to the nonce a
  stranger can request recovery for someone else's address, persuade them to click, and collect the
  credential. Dormant only because nothing marks a row verified today.
- **Device listing and revocation are impossible** with the installed SDK: no session enumeration exists
  and `signOut` needs a JWT the server never holds for another device. `recovery.devices` is an empty
  list by documented decision, `revoke-device` is honestly refused, and an inverted test fails if a
  future SDK adds the capability. A lost phone cannot be revoked until its session expires.
- **`GET /api/capabilities` is dropped.** It has no consumer: nothing calls it, there is no response
  validator, and the mechanism is harmful on reads, since `runtime.ts` refuses to dispatch an operation
  whose `enabled` is false, so a disabled read leaves the UI's snapshot null forever. The working pattern
  is the per-domain `{enabled, reason}` snapshot on `GET /api/account`.
- **`GET /api/evidence` is dropped** until Vibhav resolves a provenance conflict: its validator accepts
  only a `daily maximum` comparison basis while `daily_scores` holds app-time observations, so a truthful
  response cannot validate and a validating one is a false claim about how the number was derived.
- **B05 dropped `community.read` and `map.brief`** (no consumer, validator or type on the frontend ref),
  and **blocked `organizations.search`** (no participation content, a disjoint cause vocabulary, no
  stated meaning for `complete`) and **the summaries trio** (no record collections to freeze). The plan
  lists what unblocks each. **Task 6, the public cache-only read for the map routes, is built**
  (Vibhav's yes to open question 1, 2026-10-19): with no Authorization header `/api/map`, `/api/district`
  and `/api/map/comparison` answer from what is stored, else 503, limited to 60 a minute per visitor.
  The CDN's handling of the shared-cache header is a staging check (`YOUR_TODO.md` 1.4).
- **`map.comparison` can never say "Aligned".** Every pair is "Not comparable", with reasons. That is the
  truth about the data HALO holds (no method, release or non-detect qualifier), not a defect. Only data
  acquisition under HO-074 changes it.

## Decisions only Vibhav can make

1. **Evidence basis**: record daily maxima in the pipeline, or add a contract word for app-time
   observations. Blocks `GET /api/evidence`.
2. **Household data to a free-tier model**: whether readings and symptom names may reach it. Blocks Luna
   answering from the household's own records. The assistant's own default is fail-safe off.
3. **Retention periods. Partly decided 2026-10-19:** tasks and their details, Luna conversations and
   turns, settings preferences and saved Explore areas are kept until the person deletes them or the
   account, no timed purge (small user base). Still open: journals, home and location history,
   environmental history, alerts, operation receipts, recovery challenges, abandoned anonymous accounts,
   backups and logs (`privacy-and-retention.md`).
4. **Backup and restore coverage** (BE-307): free tier, no scheduled backups, no PITR.
5. **Recovery objectives** (BE-360) and the **Turnstile keys** (BE-340, both of them).
6. **Two product numbers that look like configuration**: the app-wide 450-questions-a-day ceiling, which
   buys far fewer conversations than it bought one-shot questions, and Luna's 60-per-conversation limit,
   where the suite pins only relationships and every integer from 21 to 89 passes.
7. **Whether Luna and Explore generation are in v1.** They are the largest remaining surfaces and the
   denominator moves more by cutting them than by any implementation speed.
8. **B05's open questions** (detail in `checkpoint.md`): public map access (Q1, answered 2026-10-19,
   Task 6 built), city and ZIP search (Q2), shipping a comparison that never aligns and whether to acquire the UCMR
   qualifiers (Q3), retention for `explore_areas` rows (Q4), and applying 0022 (Q5).
9. **B04's two settings defaults** (detail in `checkpoint.md`): Luna's context switches default off,
   the fail-safe answer to decision 2, and `calendar_linked` defaults false, because nothing is linked.
   Confirm both, and say whether `GET /api/capabilities` should exist at all.

## Known live risks

- **`origin/main` carries the old geography defect in the daily cron.** On main, `app/api/cron/daily/route.js`
  passes a bare Map to `buildAndStoreAll`, and `vercel.json` runs it daily at 11:00 UTC. A failed or
  truncated ArcGIS lookup resolves rather than rejects, so a run during an outage overwrites yesterday's
  good water and district rows with "0 people, complete", served until a later run succeeds.
  `vmag211/backend` fixes it (`389e897`, `86ba259`): the pre-build keeps the stored rows, a live water
  build is marked partial and not stored, and a live district build is a 503. If production deploys
  main, the defect is live today. Deploy the fix, then trigger one cron run while ArcGIS is healthy, or
  check that the stored water row has `located > 0`.

- **RESOLVED 2026-10-18: one abandoned operation no longer locks a surface forever.** A reaper in
  `lib/operations.js` settles stale owned pending rows to `failed` (`reason: 'abandoned'`) on list, replay
  and reconcile, race-safe and owner scoped; every ledger route exports `maxDuration = 60` under the 120 s
  staleness window, pinned by a structural test. Residual, accepted: a late `settle` can overwrite a
  reaped row with the real outcome (converges to the truth). The original analysis follows for history.
- *(History)* **One abandoned operation locks a surface read-only forever.**
  `effectiveStatus` only reports a stale pending row as `unknown` (`lib/operations.js:104-109`) while
  `listUnresolvedOperations` filters stored `status = pending` (`:226-244`), and no reaper exists:
  `settle(..., failed)` (`:168`) runs only when `execute` throws in-process, so a serverless timeout
  leaves the row pending for good. `unresolvedOperations` is a lock, so such a row disables its whole
  surface. Reach today is just `lib/account.js:200` (domain `account`); it becomes a real freeze when
  B04 adds `settings` and `alerts` and B05 adds `summary`. A reaper must settle to `failed`, never
  `cancelled` (`validSummaryReceipt` rejects `cancelled` though the CHECK allows it). Verified in the
  tree, not relayed. Do not fix this by widening the filter; Ruling S1 is right that the filter is.

- **Push on Apple devices does not work** and is accepted as pending: iOS web push needs an installed
  Home Screen app and there is no install flow. Android works. So on iOS the in-app alert surface is the
  only delivery path, and no alert may be designed assuming a push arrives.
- **`HALO_RECOVERY_TOKEN_KEY`** has no `.env.example` home, no rotation story, and a floor that cannot
  check entropy. Rotating it invalidates every outstanding restore token.
- **Model ids must be pinned in the deployment.** An unset `ASSISTANT_CHAT_MODEL` or
  `ASSISTANT_EMBED_MODEL` used to select a paid OpenAI default; `988074d` makes that fail loudly, but set
  both explicitly anyway.
- **`capacitor.config.json` is dead** (no dependency, nothing imports it) and carries `cleartext: true`.
  Safe to delete; HALO ships as a responsive web app, no store, no native build.

## How to resume

1. Read this page, then `WORKFLOW.md`, then the plan under `docs/backend/plans/` for the package in
   progress.
2. The full spec is NOT missing. `git show origin/codex/october15-review-refinement:docs/product/ai/HALO_BACKEND_WORKING_SPEC.md`,
   521,027 bytes, sha256 `fc1fec4b...415be86`.
3. Before planning a package, write a cited contract digest from the frontend branch first. It has caught
   a design-breaking error before implementation three times out of three: `available: false` would have
   rendered Luna as a dead screen, `POST /messages` had to return a run inside a 20-second client
   timeout, and `unresolvedOperations` is a lock that would have frozen two surfaces read-only.
4. One writer per checkout. Parallel implementers get worktrees, which provision from `origin/main`, so
   each must `git reset --hard vmag211/backend` first.
5. Gate before every commit: `node --test test/*.test.mjs`, `npm run typecheck`, `npm run lint`,
   `git diff --check`. Report real counts.
