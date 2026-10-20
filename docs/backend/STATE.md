# HALO backend: current state

One page, regenerated as work lands. **Read this first**, then `WORKFLOW.md` for how to work, then the
package plan you are continuing. `checkpoint.md` holds the per-package detail this page summarises.

Updated 2026-10-20 after the night run: B04 to B07 and B10 are complete (B10 except Task 5, gated on
Vibhav), B11 to B17 are built and merged (B15 saved summaries, B16 Explore projects without generative AI,
B17 outreach preparation that never sends), B08 is partly merged, and **the frontend is merged in**
(`1253025`, the frontend ref at `5ac06f6`). `vmag211/backend` is not merged to main. At
`origin/vmag211/backend` (`ce9e1e2`), `node --test test/*.test.mjs` runs
**5,133 tests: 5,133 pass, 0 fail, 0 skipped**; `npm run typecheck` clean; `npm run lint` 0 errors and
6 warnings (all pre-existing). `next build` needs no secrets since the clients became lazy (see below),
but run any build in a scratch worktree anyway: `next build` auto-loads `.env.local`, which the boundary
forbids reading (it last passed with placeholder Supabase variables on 2026-10-19; not re-run since the
lazy-client change).

## What exists

77 route files under `app/api` on `vmag211/backend`, exporting 93 method handlers. The frontend
registry declares **72 operations**, each with a path and a method (`lib/frontend/production/runtime.ts`;
the file is identical on `origin/codex/october15-review-refinement`). **60 have a backend route at the
declared path and method; 12 do not. Of the 60, 28 answer with no configuration beyond what is already
applied**, and 32 are built but answer "unavailable" (or a failed receipt) until Vibhav turns something
on:

- `actions.load`, `actions.commit` (flag `tasks`; 0023 is applied, so the flag can be turned on);
- `workspace.load`, `workspace.execute` (flag `workspace`, and 0026);
- `attachments.upload`, `attachments.inspect`, `attachments.download`, `attachments.remove` (flag
  `attachments`, which also needs `workspace` on, 0028 and `sharp` in `package.json`);
- `privacy.status`, `privacy.inspect`, `privacy.export`, `privacy.clear` (0024 and
  `HALO_PRIVACY_REVIEW_KEY`; no flag);
- `sourceOps.read`, `sourceOps.history`, `sourceOps.command` (0027, then an `operator_roles` row granted by
  SQL; until the row exists every caller gets the contract's denied snapshot);
- `summary.prepare`, `summary.list`, `summary.read` (flag `summaries`, which also needs `workspace` on, and
  0029);
- `projects.generate`, `projects.current`, `projects.generation`, `projects.cancel`, `projects.guide`,
  `projects.start` (flag `projects`, and 0030; `projects.start` also needs `workspace` on and 0026);
- `contacts.resolve`, `outreach.context`, `outreach.connection`, `outreach.prepare`, `outreach.history`,
  `outreach.status`, `outreach.connect`, `outreach.send` (flag `outreach`; drafts need 0031).
  `outreach.connect` and `outreach.send` are routed only to refuse: with the flag on they still answer 403
  `email_sending_unsupported`, because nothing in HALO sends email.

Measured 2026-10-20 on `ce9e1e2` (it was 43 routed on `7fa4574`; B15 added three, B16 six and B17 eight,
all behind flags, so the 28 that answer now did not change; it was 30 routed and 24 answering on `a5268be`). Method: every `'<op>': {path, method}` entry of `productionOperations`
(the method defaults to GET), matched as an exact method-and-path pair against every exported
`GET|POST|PUT|PATCH|DELETE` in `app/api/**/route.js`. A match means only that a route exists at that path
and method. It does not mean the body passes the operation's validator: the per-package conformance suites
are what show that. The 28 that answer now, by the package that made them answer:

| Package | Operations |
| --- | --- |
| Before the packages | `map.layer`, `map.district`, `alerts.read` (the legacy inbox route) |
| B02 | `operations.read`, `account.read`, `account.command`, `recovery.request`, `recovery.status` |
| B03 | `luna.capabilities`, `luna.conversations`, `luna.clear`, `luna.message`, `luna.run`, `luna.cancel` |
| B04 2a | `settings.read`, `settings.save` (`GET`/`PATCH /api/settings`) |
| B04 2b | `alerts.update` (`POST /api/alerts/state`), and `GET /api/alerts` extended to the contract read |
| B05 | `locations.search`, `explore.area.read`, `explore.area.save`, `map.comparison`; and `map.layer` and `map.district` fixed (`quarter=latest`, the incomplete geography) and conformance-tested |
| B06 Task 5 | `week.changes`, `week.acknowledge` |
| B10 | `forecast.read` (`GET /api/forecast`; Open-Meteo and NWS only, AirNow not yet) |
| B12 | `food.search`, `fish.read`, `water.read`, `growers.search` (signed in, static reviewed data files, no migration) |

The 12 with no route: `capabilities.read` (dropped on purpose), `opportunities.search` and
`opportunities.detail`, `organizations.search` (blocked), `community.read` (dropped),
`luna.proposal.edit`, `luna.proposal.cancel`, `luna.operation`, `luna.confirm` (Luna does not act),
`map.brief` (dropped), `evidence.read` (built but held, E25) and `recovery.complete` (unbuilt). The reasons
are in the table under "What is deliberately not built". The count was 14 of 72 on 2026-10-18, and the
frontend closeout note's 68 operations is four short.

**The remaining work is backend, not wiring.** The frontend half is already written. Components call
`runtime.request('<operation>')`, the registry resolves the path, and a validator checks the response, so
a route landing at the declared path and method with a body the validator accepts makes an operation live
with no frontend edit. That file says so itself: "These are explicit frontend contracts, not claims that
the backend implements them." Two exceptions need frontend work: recovery needs the client to send a
Turnstile token field, and `evidence.read` is built but held (ruling E25, see B08 below).

The two halves are now in one tree (`1253025`), but **nothing has yet been driven end to end through a
browser**. The per-package conformance tests run the real handlers against the frontend's own code: since
`9ebb597` the contract suites import the real `lib/frontend/production` validators, runtime and adapters
wherever Node's type stripping can load them (B11 to B13 do from the start; a few older suites still carry
transcribed copies with a drift test), then assert what the screen shows. They caught every
design-breaking mismatch so far, including two that shipped (Luna's empty conversation, the account
receipt that locked itself). They are not a substitute for one browser pass. The next integration steps,
in order: one browser pass against `test:stage` / `test:production`'s local server; decide who owns
`X-Halo-Home-Context`; and finish replacing the remaining transcribed validators. About 31 Playwright UI
tests already fail on the frontend ref alone (partly a Sunday week-start hydration bug), so a UI run must
be compared against that baseline.

Done 2026-10-20: `next build` needs no secrets (Supabase and Redis clients are built on first use,
`lib/lazyClient.js`), and the stage server takes `HALO_STAGE_SUPABASE_URL`, default
`http://127.0.0.1:54321`; `test:stage` 37/37 and `test:production` 120/120 passed with no service-role key
(measured before B11 to B14; not re-run).

| Package | State |
| --- | --- |
| B01 baseline, identity, home context | Complete |
| B02 identity linking and recovery | Complete except two tasks dropped on purpose, see below |
| B03 Luna, conversational MVP | Complete. Six endpoints, answers and cites, does not act |
| B04 settings and alerts | Complete. Four operations (`settings.read`, `settings.save`, `alerts.read`, `alerts.update`), contract `b04-1` with the reconcile, Rulings S1 to S16. `GET /api/capabilities` dropped, see below |
| B05 discovery and summaries | Complete except what was dropped, blocked or gated, see below. Four operations built, two map routes fixed, contract `b05-2` |
| B06 My Week (tasks) | Complete. `actions.load`, `actions.commit`, `week.changes`, `week.acknowledge` and the `actions` reconcile, migration 0023, contract `b06-1`, Rulings H1 to H33. `actions.*` behind the `tasks` flag; task retention decided 2026-10-19, so the flag may be turned on once 0023 is applied; the week strip is ungated |
| B07 privacy | Complete. `privacy.status`, `privacy.inspect`, `privacy.export`, `privacy.clear`, migration 0024, contract `b07-1`, Rulings P1 to P18. Off until 0024 is applied and `HALO_PRIVACY_REVIEW_KEY` is set (no flag); clear all is not account deletion |
| B08 evidence | Partly merged. Merged: migration 0025 (`daily_maxima`), the method, and the recorder cron `GET\|POST /api/cron/daily-maxima` (`vercel.json`, 12:00 UTC). **Built but held, unmerged, on `origin/vmag211/b08-evidence-held`:** `GET /api/evidence`, `GET /api/profile`'s additive `home_context`, and Task 6 (contract `b08-1`, `docs/backend/contracts/b08.openapi.json`, client-path conformance over PGlite and a real recorder run, tracker and checkpoint rows; head `45bd933`, on top of `f2b49e3`). Ruling E25: emitting `home_context` makes the frontend remount (`ProductionApp.tsx:35` keys on the revision) and drop unsaved drafts, so the branch waits for Yogi (`YOUR_TODO.md` Part 4 items 24 and 25) |
| B09 Luna household context | Planned, not built (`plans/b09-luna-context.md`); household context stays off by decision 2 |
| B10 forecast | Complete except Task 5, the AirNow forecast adapter, gated on Vibhav capturing the AirNow docs (`YOUR_TODO.md` Part 3 item 10). `forecast.read`, contract `b10-1`; air is "not checked" until Task 5 lands. No migration |
| B11 Homeguard workspace | Complete. `workspace.load`, `workspace.execute` and a `workspace` overlay on `GET /api/operations`; migration 0026 (`household_workspace_records`, the read and commit functions, the privacy clear trigger); contract `b11-1`, Rulings W1 to W15. Fourteen collections stored; `weekJournal` and `homeTransitions` answer unavailable by design. Behind flag `HALO_FEATURE_WORKSPACE`, off. Plan `plans/b11-homeguard-workspace.md` |
| B12 public fish, water, food and grower reads | Complete. `fish.read`, `water.read`, `food.search`, `growers.search`; no migration; built from reviewed static files in `lib/data/` by `scripts/build-public-evidence.mjs` (never fetches; sources retrieved 2026-10-20). Fish advisories with cut-off source text are withheld with a link, not shown partially. Food notices (openFDA) stay empty and NRCS is dropped. Drought and utility status are a dated copy that needs a weekly manual rebuild. Plan `plans/b12-public-evidence.md` |
| B13 operator source operations | Complete as far as the data supports. `sourceOps.read`, `sourceOps.history`, `sourceOps.command`; migration 0027 (`operator_roles`, append-only `source_ops_audit`); `operator_roles` is granted by SQL only (`YOUR_TODO.md` 2.18). Every decision (approve, publish, retry, rollback and so on) is refused and audited, because no release registry exists to act on; `allowedDecisions` is `[]` so the screen offers none. Plan `plans/b13-source-operations.md` |
| B14 private photo attachments | Complete. `attachments.upload`, `.inspect`, `.download`, `.remove`; migration 0028 (`household_attachments`, the object sweep queue, the private `household-attachments` bucket); files are re-encoded with `sharp` so no metadata survives; JPEG, PNG and WebP only (PDF and HEIC refused); lifts B11's W4 when on. Behind flag `HALO_FEATURE_ATTACHMENTS`, off, and needs `workspace` on. **`sharp` is not yet in `package.json`**: it is in `node_modules` and `package-lock.json` only as an optional dependency of Next, at 0.35.5, so run `npm install sharp@0.35.5` and commit before turning the flag on. Plan `plans/b14-private-attachments.md` |
| B15 saved household summaries | Complete, with scores and factors not yet composed (S15-6). `summary.prepare`, `summary.list`, `summary.read`; migration 0029 (`household_summaries`, immutable once saved, the commit function that settles its own ledger row, a clear-all trigger); every refusal settles `failed`, never `cancelled`. Behind flag `HALO_FEATURE_SUMMARIES`, off, and needs `workspace` on. Plan `plans/b15-saved-summaries.md`, Rulings S15-1 to S15-11, `YOUR_TODO.md` 2.20 |
| B16 Explore projects, no generative AI | Complete. `projects.generate`, `.current`, `.generation`, `.cancel`, `.guide`, `.start`; migration 0030 (`household_project_generations`); "generation" is a deterministic, explainable selection from a sourced library of 17 projects (`lib/data/exploreProjectLibrary.json`), no model and no paid service; the async contract (status, cancel) is still honoured. A started project's guide cannot be changed through `workspace.execute` (J13, `project_guide_locked`). Behind flag `HALO_FEATURE_PROJECTS`, off; Vibhav's decision 7 is still open. Plan `plans/b16-explore-projects.md`, Rulings J1 to J14, `YOUR_TODO.md` 2.21 |
| B17 outreach preparation, never sends | Complete. `contacts.resolve` and the seven `outreach.*` operations; migration 0031 (`outreach_drafts`); official public offices from a static, source-recorded directory (`lib/data/ncOutreachContacts.json`), copy-only drafts, `outreach.connection` always "not connected", `outreach.connect` and `outreach.send` refused. Nothing sends email, calls a mail or OAuth provider or contacts anyone. Behind flag `HALO_FEATURE_OUTREACH`, off. Plan `plans/b17-outreach-preparation.md`, Rulings O1 to O8, `YOUR_TODO.md` 2.22 |

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
`YOUR_TODO.md` 2.12). All five are additive and none rewrites data. **0021 was final as far as review could tell
when it was applied**: the fourth review approved it, and both deadlocks are fixed. Those were a
first-time notifications write against a save, and a save during account deletion. They were reasoned
through on paper, because PGlite has one connection. Its steps, including the 100-row "Mark all
as read" gateway check, are `YOUR_TODO.md` 2.10.
They were applied as one batch; each keeps its apply steps and a tested back-out block in `YOUR_TODO.md`
(0022 is 2.11). Once the backend branch is deployed, both Explore area verbs work against the applied 0022.

**0024 to 0031 are written, merged to `vmag211/backend`, and applied nowhere: pending for Vibhav, in
order** (0029 to 0031 are described after the 0024 to 0028 paragraph).
0024 is privacy (`clear_household_records`, the fingerprint and count functions, the receipt purge and
the freeze trigger; no table; `YOUR_TODO.md` 2.14). 0025 is `daily_maxima` for B08 (2.15); apply it as
soon as the recorder is deployed, because a day is recorded only from the first run on and cannot be
backfilled. 0026 is the Homeguard workspace for B11 (2.17): one table, `household_workspace_records`,
and its functions. 0027 is operator roles and the append-only source operations audit for B13 (2.18):
two tables, and a role is granted by SQL. 0028 is private attachments for B14 (2.19): two tables and a
private storage bucket; it needs 0017 and 0026. 0024 and 0025 are independent, and the clear handles
0025's, 0026's and 0028's tables whichever goes first. Every package degrades to its contract's
unavailable answer until its migration is applied, so deploying first is safe. One-paste bundles with
verify scripts, one pair per migration: `docs/backend/apply/apply-0024.sql` and `verify-0024.sql`, and
likewise `0025`, `0026`, `0027`, `0028` (each verify prints one row; every column must be true).
Applying 0024 turns nothing on; the key does, and 0026 and 0028 are likewise inert until their flags.

0029 is saved summaries for B15 (`YOUR_TODO.md` 2.20): `household_summaries`, immutable once saved; it
needs 0016, 0017 and 0026. 0030 is Explore project idea sets for B16 (2.21): `household_project_generations`;
it needs 0017, and `projects.start` also needs 0026. 0031 is outreach drafts for B17 (2.22):
`outreach_drafts`; it needs 0017 only (a draft that includes saved notes also reads 0026). Each has the same
pair, `docs/backend/apply/apply-00NN.sql` and `verify-00NN.sql`, a tested back-out block, and a clear-all
trigger, and each is inert until its flag (`HALO_FEATURE_SUMMARIES`, `HALO_FEATURE_PROJECTS`,
`HALO_FEATURE_OUTREACH`).

## Environment variables Vibhav must set

Names only; never write a value or an address into the repository. Server side, Sensitive, in every
environment that should have the feature, then redeploy.

- `HALO_PRIVACY_REVIEW_KEY` (32+ random characters, never `NEXT_PUBLIC_`, never the recovery key's
  value): the only switch for privacy (`YOUR_TODO.md` 2.16). Staging first, one browser pass, then
  production.
- `NWS_CONTACT`: the contact the National Weather Service asks for in the `User-Agent`. Unset or left at
  the placeholder, the forecast makes no NWS request and "Official notices" shows the fallback
  (`YOUR_TODO.md` Part 3 item 8).
- `HALO_FEATURE_TASKS=on` (My Week) once 0023 is applied, and `HALO_FEATURE_LUNA=on` with
  `ASSISTANT_CHAT_MODEL` and `ASSISTANT_EMBED_MODEL` set explicitly (`YOUR_TODO.md` 2.13 step 3).
- `HALO_FEATURE_WORKSPACE=on` (Homeguard workspace) once 0026 is applied and the retention in B11 W1 is
  accepted (`YOUR_TODO.md` 2.17).
- `HALO_FEATURE_ATTACHMENTS=on` (private photos) only after 0028 is applied, `workspace` is on, and
  `sharp` is added to `package.json` with `npm install sharp@0.35.5` and committed (`YOUR_TODO.md` 2.19).
- `HALO_FEATURE_SUMMARIES=on` (saved summaries) once 0029 is applied, `workspace` is on and the B15
  retention (S15-4) is accepted (`YOUR_TODO.md` 2.20).
- `HALO_FEATURE_PROJECTS=on` (Explore project ideas) once 0030 is applied and you accept the library-only
  selection (J1, decision 7); starting a project also needs `workspace` on and 0026 (`YOUR_TODO.md` 2.21).
- `HALO_FEATURE_OUTREACH=on` (prepared outreach copies, never sent) once 0031 is applied and the draft
  retention (O8) is accepted (`YOUR_TODO.md` 2.22).
- No variable switches B12 (always on, signed in) or B13 (the `operator_roles` row is the switch).

## What is deliberately not built, and why

What remains unbuilt, in one table (the 12 operations with no route, plus the AirNow forecast). The bullets
below hold the detail.

| Operation or feature | State | Why |
| --- | --- | --- |
| `organizations.search` | Blocked | Needs human-written, verified listings: no participation content exists, the cause vocabulary is disjoint, and "complete" has no stated meaning (B05) |
| `opportunities.search`, `opportunities.detail` | Not built | Same need: dated volunteer opportunities must be human-written and verified; HALO will not scrape or invent them |
| `luna.proposal.edit`, `luna.proposal.cancel`, `luna.confirm`, `luna.operation` | Not built, by ruling | Luna answers and cites but does not act, so there is nothing to propose, confirm or track |
| `recovery.complete` | Deferred by Vibhav | Recovery completion waits until after the competition (decision 5); the flag stays off |
| `capabilities.read`, `community.read`, `map.brief` | Dropped | No consumer, validator or type on the frontend ref |
| `evidence.read` | Built, held | Ruling E25: emitting `home_context` remounts the frontend and drops drafts; on `origin/vmag211/b08-evidence-held` until Yogi's fix |
| AirNow forecast (B10 Task 5) | Not built | Needs Vibhav to capture the AirNow forecast docs and one real North Carolina response (`YOUR_TODO.md` Part 3 item 10); air shows "not checked" until then |

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
- **`GET /api/evidence` is built but held, not merged** (it was dropped until the provenance conflict was
  decided). Its validator accepts only a `daily maximum` basis while `daily_scores` holds app-time
  observations, so B08 serves only `daily_maxima` and never relabels `daily_scores`. Both it and
  `GET /api/profile`'s `home_context` wait on ruling E25 (see the B08 row); until then `evidence.read`
  has no route and the app shows its own empty state.
- **B05 dropped `community.read` and `map.brief`** (no consumer, validator or type on the frontend ref),
  and **blocked `organizations.search`** (no participation content, a disjoint cause vocabulary, no
  stated meaning for `complete`). The summaries trio, blocked there for want of record collections, was
  built in B15 once B11 stored them. The plan lists what unblocks each. **Task 6, the public cache-only read for the map routes, is built**
  (Vibhav's yes to open question 1, 2026-10-19): with no Authorization header `/api/map`, `/api/district`
  and `/api/map/comparison` answer from what is stored, else 503, limited to 60 a minute per visitor.
  The CDN's handling of the shared-cache header is a staging check (`YOUR_TODO.md` 1.4).
- **`map.comparison` can never say "Aligned".** Every pair is "Not comparable", with reasons. That is the
  truth about the data HALO holds (no method, release or non-detect qualifier), not a defect. Only data
  acquisition under HO-074 changes it.
- **B11 left two workspace collections and one command unstored.** `weekJournal` and `homeTransitions`
  answer unavailable (W2, W3), and the client's "clear private" command is refused in favour of the
  privacy panel (W9). No OpenAPI-style negative contract for them was written.
- **B12 left four things empty or dated.** Food notices (openFDA recalls) are blocked on a provider-terms
  review, NRCS conservation activities are dropped (the page refused the build host and is national),
  utility rule text (watering days) is in no state dataset, and drought and utility status are a dated copy.
- **B13 can show sources but not act on them.** Every operator decision is refused and audited because
  there is no release registry, candidate, quarantine, publication pointer or translation job. The
  forecast adapters, Mapbox and OpenUV on its own are not listed as sources because no run record exists.
- **B14 refuses PDF and HEIC, has no malware scanner or quarantine, and cannot take uploads over
  4.5 MB** on Vercel (the platform answers 413 before the route runs).
- **B15 saves no scores or factors yet.** A selected Scores or Factors section is saved with one sentence
  saying it is not included, because the server holds no Homeguard score and the private-water conflict
  (H01) is open (S15-6). There is no per-summary delete; clear all and account deletion are the only removal.
- **B16 generates nothing.** Ideas are a deterministic selection from 17 sourced library projects; there is
  no web retrieval, model safety review or geographic suitability check. Two guides were excluded because
  they would send households to programs that do not serve them. EPA pages could not be re-verified from
  the build machine (J4).
- **B17 sends nothing, ever.** No Gmail or OAuth connection, no token storage, no send attempt, no
  per-person staff emails, no landlord lookup. `attempts` in the history is truthfully empty. Draft deletion
  and an on-screen disclosure that drafts are kept have no route or copy in the frontend (a Yogi item).

## Decisions only Vibhav can make

1. **Evidence basis: decided 2026-10-19, record daily maxima.** The recorder is merged (0025 pending). What
   remains is Yogi's frontend remount fix (`YOUR_TODO.md` Part 4 items 24 and 25) before `GET /api/evidence`
   and `home_context` are merged.
2. **Household data to a free-tier model. Decided 2026-10-19: no.** Luna's configured free tier
   (OpenRouter's NVIDIA endpoints) trains on, logs and keeps inputs, and NVIDIA's trial terms forbid
   health and personal data and production use (`plans/b09-luna-context.md`). Household context stays
   off and B09 is not built. Ordinary Luna questions stay on that free tier by Vibhav's choice, with a
   notice in the Luna panel that questions go to a third-party model service that may use them (a Yogi
   item).
3. **Retention periods. Partly decided 2026-10-19:** tasks and their details, Luna conversations and
   turns, settings preferences and saved Explore areas are kept until the person deletes them or the
   account, no timed purge (small user base). Still open: journals, home and location history,
   environmental history, alerts, operation receipts, recovery challenges, abandoned anonymous accounts,
   backups and logs (`privacy-and-retention.md`).
4. **Backup and restore coverage** (BE-307): free tier, no scheduled backups, no PITR. **Decided 2026-10-19: no backups, an accepted risk for the competition.**
5. **Recovery objectives** (BE-360) and the **Turnstile keys** (BE-340, both of them). **Decided 2026-10-19: recovery completion waits until after the competition; it stays off.**
6. **Two product numbers that look like configuration**: the app-wide 450-questions-a-day ceiling, which
   buys far fewer conversations than it bought one-shot questions, and Luna's 60-per-conversation limit,
   where the suite pins only relationships and every integer from 21 to 89 passes.
7. **Whether Luna and Explore generation are in v1.** They are the largest remaining surfaces and the
   denominator moves more by cutting them than by any implementation speed. Still open: B16 proposes the
   conservative answer for Explore (ruling J1, a library selection with no model, behind a flag), and
   Luna's stay as built.
8. **B05's open questions** (detail in `checkpoint.md`): public map access (Q1, answered 2026-10-19,
   Task 6 built), city and ZIP search (Q2), shipping a comparison that never aligns and whether to acquire the UCMR
   qualifiers (Q3), retention for `explore_areas` rows (Q4), and applying 0022 (Q5, done 2026-10-19).
9. **B04's two settings defaults** (detail in `checkpoint.md`): Luna's context switches default off,
   the fail-safe answer to decision 2, and `calendar_linked` defaults false, because nothing is linked.
   Confirm both, and say whether `GET /api/capabilities` should exist at all.

Each package below made its own product calls, chosen conservatively and marked "proposed, Vibhav to
confirm" in its plan. Nothing waits on them except where a line says so; say which to change. Ruling
numbers are the plan's own.

**B11 Homeguard workspace** (`plans/b11-homeguard-workspace.md`)

- W1: the workspace sits behind `HALO_FEATURE_WORKSPACE`, off, with retention until the person deletes the record, clears all or deletes the account.
- W2: `weekJournal` answers unavailable, because journal retention is still open and the journal already lives in `symptom_logs`.
- W3: `homeTransitions` answers unavailable, because home changes go through the account service.
- W4: private files are refused while the attachments flag is off (lifted by B14 A7 when it is on).
- W5: a reconcile of a succeeded save returns the current rows of the collections it touched, because the ledger keeps ids and revisions only.
- W6: the snapshot carries no collection revision; per-record revisions are the concurrency control.
- W7: limits of 1,000,000 bytes per request, 262,144 per record, 1,000 records and 1,500,000 bytes per collection.
- W8: a privacy clear all deletes the workspace rows through a trigger on the ledger, not by editing 0024.
- W9: the client's own "clear private" command is refused, so `privacy.clear` is the only clearing path.
- W10: a reference a write adds must name the caller's own record; unchanged references are not re-checked.
- W11: removing a note also removes its case record in the same commit.
- W12: the server assigns revisions (1 on create, plus one per update); a stale or duplicate write is a `conflict`.
- W13: a stored project guide is the household's own copy, with provenance not verified, until a generation service exists.
- W14: a second save while one is unsettled is still accepted; the per-record checks keep it honest.
- W15: a replayed save whose record was since deleted elsewhere is answered `failed` / `changed_elsewhere`, not as a success.

**B12 public fish, water, food and grower reads** (`plans/b12-public-evidence.md`)

- Publish complete NC DHHS advisory text verbatim, and withhold every cut-off row with a link to the official graphic.
- Take the statewide mercury rules from the DHHS safefish page, applied to every listed water and `nc-other-waters`, with the regional footnotes quoted rather than applied as geometry.
- Expand each advisory per species, treat the catfish family as one, and let "all fish" cover every catalogue species.
- Signed in only, 120 reads a minute per identity, `private, max-age=600` on success.
- Food notices stay empty until an openFDA acquisition review (W:2647, HO-125), and NRCS is dropped from growers.
- Drought and utility status are a dated copy refreshed by hand weekly until a scheduled ingest exists (that would need a migration).

**B13 operator source operations** (`plans/b13-source-operations.md`)

- Roles live in `operator_roles`, granted only by SQL with no grant API, and anonymous-auth accounts are always denied.
- `operator_roles` and `source_ops_audit` have no foreign key to `profiles`, so they stay out of the privacy export and clear and the audit outlives an account.
- Refused commands are audited, but the snapshot and history show only applied entries; audit retention is not set.
- A live feed is `current` under 36 hours old, a reference dataset for 365 days after retrieval; live feeds show `nextReview` "Not scheduled".
- `link` is the latest record's result (no probing), `rejected` is 0 and `attempts` 1 where nothing counts them, `owner` is "Not assigned", `terms` is the file's licence or "Not recorded in HALO".
- Source and registry revisions are 1 plus applied audit entries, so they stay 1 until a decision can apply; every decision is refused until a release registry exists.

**B14 private photo attachments** (`plans/b14-private-attachments.md`)

- A1: flag `HALO_FEATURE_ATTACHMENTS`, off; a file is kept until removed, its record is removed or edited, clear all, or account deletion; an unlinked staged upload expires after 24 hours.
- A2: JPEG, PNG and WebP only; PDF lab reports and HEIC are refused (the report screen offers PDF and will show a generic error).
- A3: 10 MiB as received, 40 megapixels, 15 MiB after processing, 20 files per record, 200 files and 500 MiB per household, 30 uploads an hour; Vercel's 4.5 MB body limit is the real ceiling.
- A4: every file is decoded and re-encoded synchronously with `sharp`; there is no malware scanner and no quarantine state.
- A5: lab reports are stripped as well, although the screen says they may keep metadata.
- A6: flag off or 0028 missing gives upload 403, remove a failed receipt, and the reads a non-retryable 503.
- A7: a report upload links to its test at once; observation and note photos link on the acknowledged workspace write.
- A8: removal needs the exact revision, drops the record's reference and returns canonical rows.
- A9: objects live at `<profile id>/<attachment id>` in a private bucket, deleted through a sweep queue the remove route, the clear route and the daily cron drain.
- A10: downloads stream bytes with `private, no-store`, `nosniff` and a generic file name, and need the exact revision.
- A11: the ledger domain is `attachments`, receipts hold ids and reason codes only, never a file name.
- A12: the privacy export carries file metadata only, never bytes.

**B15 saved household summaries** (`plans/b15-saved-summaries.md`)

- S15-1: every prepare creates a new summary with a new id and revision 1; nothing is ever rewritten and there is no lineage.
- S15-2: a summary freezes the household's current home context as the server holds it; a sent `homeContextId` or header is only a check, and a mismatch is `failed` `home_changed`.
- S15-3: every refusal and every abandoned prepare settles `failed`, never `cancelled`.
- S15-4: summaries are kept until clear all or account deletion; there is no per-summary delete route yet.
- S15-5: each selected record must be the household's own at exactly the sent revision, at read and again at commit, else `failed` `changed`.
- S15-6: Scores and Factors sections are saved with a sentence saying they are not included yet, because the server holds no Homeguard score and the H01 private-water conflict is open.
- S15-7: the actions section reads 0023's tasks only when `tasks` is on; task details and notes are never included.
- S15-8: private text follows the person's opt-ins exactly as the client's preview does; attachment bytes, photo data and file metadata are never read.
- S15-9: limits of 1,000,000 bytes per request, 500 records per summary, 2,000,000 bytes per saved snapshot and 200 summaries per household; a line over 20,000 characters is shortened and said so.
- S15-10: flag off, 0029 or 0017 missing answers a non-retryable 503 on reads and a recorded-nowhere 200 `failed` receipt on prepare, so no 5xx parks an id that was never recorded.
- S15-11: ledger domain `summary`, kind `summary.prepare`, receipt holds the summary id or reason code only; a summary removed since is answered `failed` `gone`.

**B16 Explore projects without generative AI** (`plans/b16-explore-projects.md`)

- J1: "generation" is a deterministic selection from the sourced library, with no model and no paid service (your open decision 7).
- J2: flag `HALO_FEATURE_PROJECTS`, off by default; starting a project also needs `workspace`.
- J3: no 5xx for a known outcome; a known refusal is a 200 `failed` result, 403, 404 or 409, so a screen never parks an attempt that was recorded.
- J4: library text is the frontend's reviewed adaptation of official public guidance, 17 projects, two excluded, 19 exact rewordings that remove "safe"; EPA pages were not re-verified from the build machine.
- J5: evidence is the home's water source and building year, the newest daily reading within 7 days, and with `workspace` on the household's own gardens, observations and filter records; no typed text is copied.
- J6: the request's Idempotency-Key is the job id, the first write wins, and a cancel that arrives first records `cancelled`.
- J7: the requested count is a ceiling, and a direct-interest text keeps only projects it names.
- J8: ranking follows the reviewed preview, with evidence boosts, interests, diversity, rotation and previous ideas last.
- J9: the newest 20 idea sets per household and always its newest completed set are kept; clear all deletes all.
- J10: the context key must start with the session's id and name the current home and revision, and `<user>:none:0` is also served for a client that was never told its home.
- J11: one start at a time per household; a second is 409 `start_pending`.
- J12: a start is a `workspace` ledger operation, so the pending start needs no new table, and a start for a guide no longer in the library blocks but is not reported as `pendingStart`.
- J13: `workspace.execute` refuses to change the `guide`, `guideId` or `guideVersion` of a started project (`project_guide_locked`); the person's own fields still save.
- J14: the stored idea set carries no owner or home id; the context key is its own withheld column and is put back on read.

**B17 outreach preparation, never sending** (`plans/b17-outreach-preparation.md`)

- O1: flag `HALO_FEATURE_OUTREACH`, off; off answers 503 on reads and 403 on the four POSTs, with nothing read or recorded.
- O2: no email provider at all; `outreach.connection` is always "not connected" and `outreach.connect` and `outreach.send` are refused before the body is read.
- O3: contacts are official public offices from a static, dated directory, never a person's address or a guess; landlords are not looked up, and a city or ZIP maps to a county.
- O4: public context is the county's drought release and the listed public water systems' conservation status, for drinking water only.
- O5: prepare builds a copy-only draft from the selected notes and the public context, read at their exact revisions; it is never a send review.
- O6: one draft per household, recipient class and lowercased address, revision raised only when the content changes, at most 100 drafts.
- O7: history `attempts` is truthfully empty and a draft id's status is the draft; any other id is 404.
- O8: drafts are kept until clear all or account deletion with no delete route; name, address, subject, body and notes are private text in the export. The flag stays off until you confirm this.

## Known live risks

- **`origin/main` carries the old geography defect in the daily cron.** On main, `app/api/cron/daily/route.js`
  passes a bare Map to `buildAndStoreAll`, and `vercel.json` runs it daily at 11:00 UTC. A failed or
  truncated ArcGIS lookup resolves rather than rejects, so a run during an outage overwrites yesterday's
  good water and district rows with "0 people, complete", served until a later run succeeds.
  `vmag211/backend` fixes it (`389e897`, `86ba259`): the pre-build keeps the stored rows, a live water
  build is marked partial and not stored, and a live district build is a 503. If production deploys
  main, the defect is live today. Deploy the fix, then trigger one cron run while ArcGIS is healthy, or
  check that the stored water row has `located > 0`. A smaller fix for main alone is on
  `origin/vmag211/hotfix-geo-outage` (`50ae6cb`, "a failed geography lookup is not stored as a complete
  map"); merging it to main closes the defect before the backend branch ships.

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
- **`HALO_PRIVACY_REVIEW_KEY`** is the privacy switch and must be a different value from the recovery key.
  Rotating it only voids reviews younger than ten minutes. Clear all is irreversible and no browser pass
  has run: staging first (`YOUR_TODO.md` 2.16).
- **The AirNow forecast is not built**: until Vibhav captures the AirNow docs (B10 Task 5), the forecast's
  Air coverage says air was not checked, and Air and Pollen cards show "Unavailable".
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
   `git diff --check`. Report real counts (5,133 tests at `ce9e1e2`).
6. Process, from 2026-10-20: there are no separate reviewer agents. Each task is built by its implementer
   and tested once by the implementer's own test subagent, which fixes or reports what it finds.
