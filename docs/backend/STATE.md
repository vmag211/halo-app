# HALO backend: current state

One page, regenerated as work lands. **Read this first**, then `WORKFLOW.md` for how to work, then the
package plan you are continuing. `checkpoint.md` holds the per-package detail this page summarises.

Updated 2026-10-18. Branch `vmag211/backend`, 43 commits ahead of origin, nothing merged to main.
**2,498 tests pass**, 0 fail, 0 skipped; `npm run typecheck` clean; `npm run lint` 0 errors and 5
pre-existing warnings (district, backfill, assistantRag.test, uploadData, daily-score).

## What exists

34 route files under `app/api`. The frontend registry declares **72 operations**, each with a path and a
method (`lib/frontend/production/runtime.ts` on `origin/codex/october15-review-refinement`). **14 have a
backend route; 58 do not.** Measured on 2026-10-18 by diffing registry paths against `app/api/**/route.js`,
not quoted: the 68 in the frontend closeout note is four short. Re-measure rather than trust this line.

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
| B04 settings and alerts | In progress. Migration 0021 merged (reviewed, Rulings S7 to S10); routes 2a and 2b next |
| B05 discovery and summaries | Planned (`plans/b05-discovery-and-summaries.md`), Tasks 1 and 2 in progress |

## Migrations

**0001 to 0018 are applied to production** (0015 and 0016 on 2026-10-17 with 0015's four checks
validated; 0017 and 0018 the same day; the `TRUNCATE` privilege remedy in `YOUR_TODO.md` 2.7 also
applied). Use the state query in `YOUR_TODO.md` 2.6 rather than trusting any document, including this one.

**0019, 0020 and 0021 are written and applied nowhere** (0021 merged 2026-10-18; it no longer carries a tenure/renter_mode cross-check, Ruling S7). All three are additive and none rewrites data.
Apply them as one batch when ready; each has apply steps and a tested back-out block in `YOUR_TODO.md`.

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

## Known live risks

- **One abandoned operation locks a surface read-only forever. A reaper is built and in review** (reaps to `failed` on list, replay and reconcile); until it merges this bullet stands.
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
