# B16 Explore projects without generative AI: plan

Base: `origin/vmag211/backend` at `3e727d0`. Migration number **0030**. Rulings use the prefix **J** (J1, J2, ...).

## The frontend contract found

- Registry: `lib/frontend/production/runtime.ts:40-45` (`POST /api/projects/generations`, `GET .../generations/current`, `GET /api/projects/guides/detail`, `POST /api/projects/start`, `GET .../generations/status`, `POST .../generations/cancel`). Any 5xx on a mutation is `unknown_outcome` (`:144`); a top-level `data` key is unwrapped (`:149-152`).
- Validators: `lib/frontend/production/explore-service.ts:13-44` (`validProjectConstraints`, `validProjectGuide`, `validProjectGeneration`: a completed result binds `contextKey`, every item has its guide, every evidence and source id resolves, at most 15 items and 60 evidence items).
- Generation screen: `components/expanded/ProductionProjectGeneration.tsx:21` (mount read of `projects.current`), `:30` (adopts a saved set only for its own `scopeKey`; `pendingStart` restores the start lock), `:38-50` (generate, then poll `projects.generation` every 1.5 s; the contextKey is compared BEFORE the status), `:55` (cancel accepts only completed, cancelled or failed).
- Projects screen: `components/expanded/ExploreProjects.tsx:48` (`projects.guide` by id), `:50-58` (start: `{record, collection}`, the record an `exploreProjects` row whose guide id and version are the started ones, in the collection).
- Contract prose: `docs/product/HALO_BACKEND_WIRING_CURRENT.md:664-681`; workspace record shape `:522` and B11 (`lib/workspaceRecords.js`).

## What is built

1. **Library** `lib/data/exploreProjectLibrary.json`, built by `scripts/build-project-library.mjs` from the reviewed source-backed guides in `lib/frontend/explore-project-guides.ts`: 17 projects, each with its sources (publisher, title, HTTPS URL, checked date), stable step ids and fit metadata; a recorded list of exact rewordings; two guides excluded with reasons. `--check` and a test fail when the file is stale.
2. **Selection** `lib/projectSelection.js` (pure, deterministic) and **evidence** `lib/projectEvidence.js` (best-effort reads, server-written labels).
3. **Migration 0030** `household_project_generations`: one row per request, first write wins, retention prune, privacy counts, the clear-all trigger, verification and back-out blocks; bundle `docs/backend/apply/apply-0030.sql`.
4. **Routes** under `app/api/projects/`; `lib/projectsStore.js` holds the shared answers.
5. **Privacy**: inventory entry (explore group, `idea_set` private), counts merged in `privacyStore`, disclosure row in `docs/backend/privacy-and-retention.md`.
6. **Flag** `projects` (`HALO_FEATURE_PROJECTS`), off by default.

## Rulings

- **J1, no model, no paid service (proposed, Vibhav to confirm; his open decision 7).** "Generation" is a deterministic, explainable selection from the curated library, ranked by the household's dated evidence and stated choices. It completes inside its own request; the async contract (status, cancel) is still honoured.
- **J2, flag (proposed).** `projects` off by default: generate answers a settled `failed` result with the flag's sentence; the reads 503; start 403; cancel `cancelled`. Starting also needs `workspace` (B11 W1).
- **J3, no 5xx for a known outcome.** The runtime reads any 5xx on a mutation as "not confirmed" and parks the attempt. So flag off, 0030 or 0017 missing, and a changed home are a 200 `failed` result for generate; start answers 403 `feature_unavailable` (flags, 0026 or 0017 missing), 404 (guide not in the library), 409 (other version, a pending start, the collection limit). Only a lost database answer is a 500. Reads use the house 503.
- **J4, library content (proposed).** Text comes from the frontend's reviewed adaptations of official public guidance (US EPA, NC State Extension, NASA, US Fish and Wildlife Service, University of Minnesota Extension); the build adds nothing but stable ids and 19 exact rewordings that remove the word "safe" or "safely" wherever it could read as a claim. Excluded: `community-cleanup` (City of Charlotte's supply program) and `community-garden` (one county's program), which would send households elsewhere to programs that do not serve them. The two preview ids `demo-*` become `native-pollinator-space` and `water-report-check`. Every guide version is `2026-10-20.1`; each source keeps the date it was checked against the text (2026-10-11, the frontend's editorial pass). I spot-checked the NC State bee-hotel page on 2026-10-20 (tunnel count, 5 ft mounting, overhang, emergence box all match); EPA pages could not be fetched from this machine (certificate error), so the rest were not re-verified today.
- **J5, evidence.** Home water source and building year (home context, else profile), the newest daily reading within 7 days for the current home (air with pollutant, UV, pollen, outdoor mold; older than today is `stale`), and with `workspace` on: gardens, indoor observations, PFAS filter records and test reports needing clarification, for the current home only. A missing reading is an `unknown` item. No typed text (names, notes) is copied: labels and values are fixed phrases.
- **J6, ids and cancellation.** The request's Idempotency-Key is the job id. The primary key `(profile_id, generation_id)` makes the first write win: a cancel that arrives first records `cancelled`, and the late request answers `cancelled` and stores nothing. Cancel of a stored id answers it as stored (`completed` included). Cancel goes through the ledger under a name-based id from the household and the `cancel:<id>` header.
- **J7, count and shortlist.** The requested count is a ceiling: projects that do not fit a stated choice are never added, and the result's `message` says how many fit. `interpret` with text keeps only projects the text names (the client's direct-interest shortlist); none matching returns no items and says so.
- **J8, ranking.** The preview's reviewed ranking (`explore-personalization.ts:135-172`) with server evidence: evidence boosts (filtration only for a current PM2.5 AQI over 100), interest words, diversity by kind, rotation by generation number, previous ideas ranked last. Checks name what to confirm: requirements, current outdoor conditions (with the reading's date when stale), NC-only guidance outside NC, owner permission for renters.
- **J9, retention (proposed).** The newest 20 rows per household and always its newest completed set; older rows are deleted by the next request. Clear all deletes all (0030 trigger); account deletion cascades.
- **J10, context key.** The key must start with the session's id (else 400) and, when home contexts are readable, equal `<user>:<current home>:<revision>` (else a settled failed answer telling the person to reload). Before 0016 only the identity part is checked.
- **J11, one start at a time.** A start while another of the household's starts is unresolved is 409 `start_pending`; repeating the unresolved one reconciles it.
- **J12, pending start without a new table.** A start is a `workspace` ledger operation (kind `projects.start`) committed by 0026's `commit_household_workspace`, so Homeguard's pending list and `/api/operations?domain=workspace` cover it. The ledger keeps only a hash of `{guideId, guideVersion}`; `pendingStart` is the library guide whose input hashes to it. A start for a guide no longer in the library still blocks, but is not reported as `pendingStart`.
- **J13, snapshot immutability (proposed follow-up, not built).** `workspace.execute` can still change a started project's `guide` (B11 W13 stores it as sent). The production client always resends the same guide. Refusing a guide change needs a new B11 refusal, OpenAPI entry and fixture; left for a B11 follow-up.
- **J14, the stored set carries no owner id.** `contextKey` is its own column (withheld from export) and is stripped from the stored `idea_set` and put back on read; evidence ids never name a home id.

## Answers

- generate: 200 `ProjectGenerationResult` (`completed`, or `failed`/`cancelled`/`queued` with `message`); 400 malformed or another identity's key; 409 a reused id with other input.
- current: 200 `{data: result}` or `{data: null}`, with `pendingStart` when one is unresolved.
- status: 200 result; an unknown id is `failed` "not found" (never 404), `queued` while its request is in flight.
- cancel: 200, always terminal.
- guide: 200 guide (library current version, or an owned project's snapshot), 404 otherwise.
- start: 200 `{record, collection}`; 403, 404, 409 as J3; 503 retryable for a replay still pending; 500 a lost answer.

## Dropped or left

- No web retrieval, model safety review, geographical suitability checks or provider spend: nothing is generated.
- Project preferences, batches and step-review endpoints from the older contract section (`:2814`) are not part of the registry and not built.
- No B16 OpenAPI file or fixture set.
- `docs/backend/YOUR_TODO.md` is not edited; the back-out block lives in the migration and is run by `test/projectsSchema.test.mjs`.
- `test/dbMigrations` and `test/applyBundle` fail on this branch alone because 0029 belongs to another package; they pass once it merges.
