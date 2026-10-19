# HALO backend: current state

One page, regenerated as work lands. **Read this first**, then `WORKFLOW.md` for how to work, then the
package plan you are continuing. `checkpoint.md` holds the per-package detail this page summarises.

Updated 2026-10-19 (B05 Task 7 merged as `bf5f2b8`). Branch `vmag211/backend`, 120 commits ahead of
`origin/main`, nothing merged to main. On the merged head **3,100 tests pass**, 0 fail, 0 skipped;
`npm run typecheck` clean; `npm run lint` 0 errors and 5 pre-existing warnings (district, backfill,
assistantRag.test, uploadData, daily-score).

## What exists

41 route files under `app/api` on `vmag211/backend` at `5354ccd`, exporting 54 method handlers. The
frontend registry declares **72 operations**, each with a path and a method
(`lib/frontend/production/runtime.ts` on `origin/codex/october15-review-refinement`). **23 have a backend
route at the declared path and method; 49 do not.** Re-measured 2026-10-19, not quoted. Method: every
`'<op>': {path, method}` entry of `productionOperations` (the method defaults to GET), matched as an exact
method-and-path pair against every `export ... GET|POST|PUT|PATCH|DELETE` in `app/api/**/route.js`, read
with `git grep` on the `vmag211/backend` tip. A match means only that a route exists at that path and
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

B06 Task 3 (`actions.load`) is in review and not counted. The count was 14 of 72 on 2026-10-18, and the
frontend closeout note's 68 operations is four short.

**The remaining work is backend, not wiring.** The frontend half is already written. Components call
`runtime.request('<operation>')`, the registry resolves the path, and a validator checks the response, so
a route landing at the declared path and method with a body the validator accepts makes an operation live
with no frontend edit. That file says so itself: "These are explicit frontend contracts, not claims that
the backend implements them." Two exceptions need frontend work: recovery needs the client to send a
Turnstile token field, and `evidence.read` waits on the provenance decision below.

What is NOT covered by that: the two halves have never been in one tree or run together, so nothing has
been driven end to end through a browser. The per-package conformance tests, which run the real handlers
against validators transcribed verbatim from the frontend, are the stand-in and have caught three
design-breaking mismatches before implementation. They are not a substitute for one integration pass.

| Package | State |
| --- | --- |
| B01 baseline, identity, home context | Complete |
| B02 identity linking and recovery | Complete except two tasks dropped on purpose, see below |
| B03 Luna, conversational MVP | Complete. Six endpoints, answers and cites, does not act |
| B04 settings and alerts | Routes merged: 2a settings (`85c0b2a`, atomic `save_settings`, database-owned revision, Rulings S11 to S13) and 2b alerts. One follow-up in flight (S14 stored receipts carry no lock list, S15 settings settles its own ledger row, 0021 nits incl. a deadlock to fix before apply), then the contracts task |
| B05 discovery and summaries | Complete except what was dropped, blocked or gated, see below. Four operations built, two map routes fixed, contract `b05-1` |
| B06 My Week (tasks) | In progress. Tasks 1 (migration 0023), 2 (rules and planner) and 5 (week routes) merged; Task 3 (`actions.load`) in review; Task 4 (`actions.commit`) next. Behind the `tasks` flag, off until task retention is approved (Vibhav, 2026-10-18) |

## Migrations

**0001 to 0018 are applied to production** (0015 and 0016 on 2026-10-17 with 0015's four checks
validated; 0017 and 0018 the same day; the `TRUNCATE` privilege remedy in `YOUR_TODO.md` 2.7 also
applied). Use the state query in `YOUR_TODO.md` 2.6 rather than trusting any document, including this one.

**0019 to 0023 are written and applied nowhere** (0021 merged 2026-10-18 and amended 2026-10-19 with `save_settings` and the revision and tenure triggers, Rulings S11 to S13, and carries no tenure/renter_mode cross-check, Ruling S7; 0022, `explore_areas`, for B05; 0023, My Week's tasks, `YOUR_TODO.md` 2.12). All five are additive and none rewrites data. **Do not apply 0021 until the B04 follow-up lands**: it fixes a deadlock between a first-time notifications write and `save_settings`.
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
  lists what unblocks each. **Task 6, a public read for the map routes, did not run**: it waits on
  Vibhav's open question 1, so the default `/map` renders no live data and only `?access=owned` works.
- **`map.comparison` can never say "Aligned".** Every pair is "Not comparable", with reasons. That is the
  truth about the data HALO holds (no method, release or non-detect qualifier), not a defect. Only data
  acquisition under HO-074 changes it.

## Decisions only Vibhav can make

1. **Evidence basis**: record daily maxima in the pipeline, or add a contract word for app-time
   observations. Blocks `GET /api/evidence`.
2. **Household data to a free-tier model**: whether readings and symptom names may reach it. Blocks Luna
   answering from the household's own records. The assistant's own default is fail-safe off.
3. **Retention periods**, every one still unapproved, now including conversation turns (free text a
   person typed) and preference rows. Independently gates B05 sensitive input.
4. **Backup and restore coverage** (BE-307): free tier, no scheduled backups, no PITR.
5. **Recovery objectives** (BE-360) and the **Turnstile keys** (BE-340, both of them).
6. **Two product numbers that look like configuration**: the app-wide 450-questions-a-day ceiling, which
   buys far fewer conversations than it bought one-shot questions, and Luna's 60-per-conversation limit,
   where the suite pins only relationships and every integer from 21 to 89 passes.
7. **Whether Luna and Explore generation are in v1.** They are the largest remaining surfaces and the
   denominator moves more by cutting them than by any implementation speed.
8. **B05's five open questions** (detail in `checkpoint.md`): public map access (Q1, gates Task 6),
   city and ZIP search (Q2), shipping a comparison that never aligns and whether to acquire the UCMR
   qualifiers (Q3), retention for `explore_areas` rows (Q4), and applying 0022 (Q5).

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
