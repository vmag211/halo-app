# B06 checkpoint: My Week (tasks, their planning details, and the week strip)

Date: 2026-10-19. Branch: `vmag211/backend`. Plan: `docs/backend/plans/b06-home-actions-week.md`. Contract digest and rulings: `.superpowers/sdd/b06-home-actions-week/` (`contract-digest.md`, `progress.md`, the task reviews; gitignored scratch).

The B05, B03, B02 and B01 checkpoints follow this section unchanged. Nothing here is a deployment, provider or approval claim. **My Week's tasks are not live anywhere.** The `tasks` capability is off in every environment and stays off until Vibhav approves a retention period for tasks. Migration 0023 is applied nowhere. `docs/backend/STATE.md` is not updated by this task; the controller regenerates it after the B04 and B06 contract tasks both merge.

## Five things a reader would otherwise assume wrongly

1. **My Week still cannot load in production, by decision.** The routes are built and tested, but the `tasks` flag is off by default (Rulings H1, H17), and Vibhav confirmed on 2026-10-18 that it stays off until retention for tasks is approved. Until then the load is a non-retryable 503, and My Week shows exactly what it shows today with no route: "Your tasks could not load. Reconnect and try again." (open question 4).
2. **The week strip will never show a change in this release.** `week.changes` always answers `{"changes":[],"unresolvedOperations":[...]}` (Ruling H4). No source of a change exists: organizer events, forecasts and the home record collections are unbuilt, and deriving a change from water alerts would invent a link no record makes (C4). `week.acknowledge` validates the body and then refuses, every time, through the ledger (Ruling H19). The strip renders nothing for that answer, which is its own designed empty state.
3. **This is not the spec's P01 and P02 in full.** It is what the client contract needs today: three states, not the spec's seven (C5); recurrence driven by the client, with no occurrence table; no reminders or scheduler (HO-072); no evidence snapshots, parents or dispositions; and the `clear` command kind refused (Ruling H14). The tracker marks every broad row partial.
4. **"B06" is the backend's numbering.** The spec's own B06 is "Food advisories and grower resources", and the spec calls this work "B03 Shared actions Plan and durable delivery". The registry's routes win over the spec's REST names (HO-096 permits renaming).
5. **Tasks belong to the household, not a home** (Ruling H2). `X-Halo-Home-Context` is ignored on all four routes, so a move carries nothing (`portableTasks`). The unique key can widen later without moving data (open question 2).

## Where B06 stands

| Task | State |
| --- | --- |
| 1. Migration 0023, its read function and its atomic commit function | Merged (`b6746d3`, `9e71225`; merge `615f7d6`) |
| 2. `lib/actionRules.js`, the client's rules and the command planner | Merged (`722201a`, `cbaaa4e`; merge `5354ccd`) |
| 3. `GET /api/frontend/actions` (`actions.load`), the store library, the flag | Merged (`a2d296d`, `a9d1a22`; merge `0928320`) |
| 4. `POST /api/frontend/actions/commands` (`actions.commit`) and the `actions` reconcile in `operations.read` | Merged (`f9700c4`, `d69e8bb`, `faaf33d`; merge `b5e978c`) |
| 5. `GET /api/week/changes` and `POST /api/week/changes/acknowledge` | Merged (`a1825a0`, `631bc14`; merge `18a0829`) |
| 6. Contracts, conformance, tracker, checkpoint | This section. Built on `b5e978c`; the contract commit and the docs commit that carries this section |

Every task before 6 had an independent review, and each review is in `.superpowers/sdd/b06-home-actions-week/`. Task 6 itself has not been reviewed yet. Nothing is merged to main.

## What was built

- **Migration 0023** creates three tables: `household_actions` (one row per task, keyed by the household and the client's task key), `household_action_preferences` (the six My Week preferences) and `household_action_state` (one internal counter per household). It also creates one index, ten CHECK constraints, the read function `read_household_actions`, the atomic commit function `commit_household_actions`, and a guard trigger on 0017's `operations`. All of it is service-role only: RLS is on with no policy, and the browser roles have no privilege on the tables and no EXECUTE on the functions.
- **`lib/actionRules.js`** is the client's own rules, transcribed with types stripped and nothing improved (Ruling H15): `validActionDate`, `actionDraftError`, `revisedActionBatch`, `eventInstant`, `actionMetadataError`, `validActionPreferences`, `validActionSnapshot` and `sameValue`. It also holds `parseActionCommand`, which settles every 400 that needs no stored state, and `planActionCommand`, which applies a command in the reference order and validates the whole resulting snapshot.
- **`GET /api/frontend/actions`** reads the household's whole snapshot in one statement, so a household over 1,000 tasks is not cut short (F1). It reads the unresolved list before the snapshot, and returns a stored snapshot exactly as read even when the server's own validator refuses it, logging only ids and codes (Rulings H24, H31).
- **`POST /api/frontend/actions/commands`** checks, in order: the session, the body (at most 4,000,000 bytes), the operation id and `Idempotency-Key`, the flag, `If-Match` (refused), and the whole command. It then reads the snapshot and the live list, claims the ledger row, and plans and commits through the one database function, retrying a lost race at most three times. Every refusal is the contract's own 200 `failed` receipt, or a terminal 409 on a replay (Ruling H11).
- **`GET /api/operations`** answers a succeeded `actions` operation with the household's CURRENT snapshot and the live list minus the operation itself, at the top level and at `snapshot` (Rulings H18, S16). Every other status and domain is replayed as stored.
- **`GET /api/week/changes`** and **`POST /api/week/changes/acknowledge`** need only 0017 and are not behind the flag (they collect no free text).
- **`docs/backend/contracts/b06.openapi.json`** is version `b06-1`, with 59 fixtures under `fixtures/b06/`. Each fixture is the normalised answer of a real handler, and a test fails if one drifts. **`test/contractsB06.test.mjs`** (77 tests) runs the handlers against the contract and through the client's own consumption logic, transcribed once in `test/helpers/frontendB06.mjs`. Task 6 moved the week strip transcription there from `routesWeekChanges`, so the per-route suites and the contract share one copy. It covers every documented status, including:
  - the flag-off 503;
  - the empty household;
  - the H11 400;
  - the five 200 refusal reasons and the disabled receipt;
  - the four 409 reasons;
  - the in-flight 503;
  - the stored refusal's `check`;
  - the S14 and S16 list shapes.

  It checks three cross-route agreements: a receipt's snapshot is the next load; a reconcile is the current snapshot plus the live list in both places; and the empty household is the same bytes on the load, a receipt and its reconcile. A drift test holds `lib/actionRules.js` to the independent transcription on a corpus of more than 800 comparisons. **No disagreement was found.** No B06 body has a top-level `data` key or a U+2014.

## Rulings

H1 to H7 were the controller's before planning, H8 to H24 were made in planning, and H25 to H33 were made during execution. All are in `progress.md` and the plan. The ones that most shape behaviour:

- **H8: a task write exists if and only if its operation is `succeeded`.** The commit function settles the save's own ledger row, in the transaction that writes the tasks. So when a reaped save reconciles, the client's "No save was applied. Your draft is kept for review." is always true.
- **H25 (amends T5): whole-snapshot validation refuses only failures the command adds.** A stored row that only the server's time zone data rejects (H24 drift) does not block unrelated saves, and a save that fixes or deletes the bad row still works. As first planned, one such row would have blocked every save while the client still showed My Week.
- **H28: a guard trigger on `operations` freezes the status of a settled `actions` row.** Without it, `runOperation` would overwrite the function's in-transaction `succeeded` with `failed` when the response is lost, and the client would be told nothing was saved. It applies to domain `actions` only, and the reaper, which touches pending rows only, is unaffected.
- **H29: the commit function locks its own pending ledger row first.** A row the reaper has already settled aborts the commit, so a reaped row never becomes `succeeded` without its write, and a committed task is never reaped.
- **H32 (amends H16): a live success reads the unresolved list once, after the snapshot probe and before the claim**, in the same order as the load. Every operation already claimed when the list is read is then either listed, or in the snapshot the commit returns. The residual is under Known limits.
- Also in force:
  - **H3:** the ledger holds ids, revisions and reason codes only.
  - **H9:** one read function builds every snapshot.
  - **H10:** a household version serialises commits, because metadata moves no per-task revision.
  - **H12:** signatures are parsed and deep-compared, all first.
  - **H13:** echo exactly, and refuse only what cannot round-trip: U+0000, a lone surrogate, a non-finite number, year 0000.
  - **H17:** the flag.
  - **H21:** `Idempotency-Key` required and equal to the body's id, `If-Match` refused, `maxDuration = 60`.
  - **H26:** nesting is capped at 32.
  - **H27:** the body id is lowercased and never trimmed.
  - **H30:** years 1 to 9999.
  - **H31:** log codes, not text.
  - **H33:** a stored `invalid_result` refusal may carry `check`, one of nine fixed codes, never typed text.
  - **S14 and S16:** carried from B04. A stored receipt carries `unresolvedOperations: []`, and a reconcile carries the live list.

## Migration 0023

**Written, merged, and applied nowhere.** 0023 is the **fifth pending migration**, after 0019, 0020, 0021 and 0022. 0001 to 0018 are applied to production. Its apply steps, its six-column verification query (expect one row, all true, including `ten_checks`, meaning exactly 10 CHECK constraints), and its tested back-out block (`<!-- backout-0023 -->`) are in `YOUR_TODO.md` 2.12. The back-out is tested on PGlite only. Applying it takes a brief SHARE ROW EXCLUSIVE on `profiles` and on `operations` (the guard trigger). Applying it turns nothing on: the flag decides that.

## Verification

Gate at the Task 6 docs commit, on `b5e978c` plus Task 6:

- `node --test test/*.test.mjs`: **3,304 passed, 0 failed, 0 skipped, 0 todo**. That is the 3,227 of the Task 4 merge plus the 77 contract tests. Moving the strip transcription changed no per-route count.
- B06 suites: `actionsSchema` 24, `actionRules` 26, `actionsStore` 18, `routesActionsLoad` 26, `routesActionsCommit` 27, `routesActionsCommitDb` 12, `routesWeekChanges` 34, `contractsB06` 77, plus the B06 cases in `routesOperations`, `rlsIsolation`, `migrationBackout`, `haloTables` and `routeIsolation`.
- `npm run typecheck`: clean.
- `npm run lint`: **0 errors and the 5 pre-existing warnings**.
- `git diff --check`: clean.

Task 6's mutation checks, each restored afterwards:

- Removing `not_applied` from the contract's 409 reason enum failed 6 tests: two fixtures, the coverage test, both mutation conformance tests, and the fixture-to-handler comparison.
- Renaming `revisions` to `revision` in the commit route's refusal body failed 4: the commit and reconcile conformance, the fixture comparison, and the header test (a test that stops early stops sending the headers it would have).
- Dropping the top-level live list from the `actions` reconcile in `app/api/operations/route.js` failed 3, including the cross-route agreement.

The earlier tasks' mutations are in their reviews. Everything runs on local fakes or PGlite. No `.env*` was read, no Supabase project or production URL was contacted, and `scripts/smoke-test.mjs` was not run.

## Dropped and blocked, and why

- **Dropped:** the `clear` command kind. It has no production sender, and clearing belongs to `privacy.clear`. It is a 400. Also dropped: `reminderStates` (no scheduler), occurrence tables (recurrence is client-driven), and acknowledgement storage (nothing was ever emitted to acknowledge).
- **Blocked:** turning the flag on, on retention (BE-320). `week.changes` with content, on a change source. `portableTasks` and carry-forward on a move, on open question 2. Export and deletion under `privacy.*`, on B12; until then deletion is the account cascade.

## Open questions for Vibhav

1. **Retention for tasks, their planning details and task preferences** (BE-320, BE-323). **This gates the flag** (Ruling H1, confirmed 2026-10-18). Until it is answered, My Week stays as it is today in production.
2. **Tasks per household or per home** (Ruling H2). Per household now. Per home would make carry-forward (BE-206) and `portableTasks` meaningful. The key can widen later without moving data.
3. **Weekly availability as a schedule** (Ruling H5). It is last-write-wins per key, which BE-264 does not accept for schedules. A conflict mechanism needs a precondition in the client contract from Yogi.
4. **Whether a dead My Week is acceptable while the flag is off.** The client's sentence suggests a fix the person cannot make. The alternative is an availability field from Yogi (`YOUR_TODO.md` Part 4 item 18).
5. **The week strip's change source.** Whether organizer events, forecasts or the home record collections are in v1 decides whether `week.changes` ever has content. Until one is, the strip is empty by design.
6. **Whether tasks may reach Luna.** Tasks now exist to send. 0021's `luna_tasks` switch is the gate, and this joins STATE decision 2.
7. **Unbounded task history** (BE-327, Ruling H23). `meta.history` grows on every change with no bound, and every save carries it, so a long-lived task eventually cannot be saved under the 4 MB cap. It needs a bound in the contract (Yogi) that you agree to.
8. **Applying 0023**, the fifth pending migration (`YOUR_TODO.md` 2.12). It can go in one batch with 0019 to 0022.

## Known limits and deferred minors

- **The H32 residual.** An operation claimed after a save's list read, which then commits after that save, is in neither the save's list nor its snapshot. The load accepts the same residual. It cannot be told apart from a commit that lands just after the answer, which the client never polls for. Closing it would mean returning the list from inside the commit function's transaction, a 0023 change that is not recommended now.
- **PGlite cannot show true concurrency.** It runs one connection. The H10 race test interleaves two commits from one base, and the H29 and reaper tests interleave conditional updates. Postgres's row locks and `where version = ...` under real parallel sessions are argued from the SQL, not observed.
- **Time zone data can still disagree between Node and a browser** (digest 9.5). H24 and H25 keep such a row loadable and other saves working. The residual is recorded, not solved.
- **The client does not reload after a refusal or a 409** (F4), and **a reconcile 404 locks My Week until a page reload** (F7). Both are client-side, and both are in `YOUR_TODO.md` Part 4 for Yogi.
- **A reaped row with a late refused commit can replay as `not_applied` rather than `abandoned`** (Task 4 review O-a). Both are terminal 409s, and with `maxDuration = 60` under the 120-second window it is unreachable.
- **A `cancelled` actions row with no receipt would answer the in-flight 503.** The actions domain never writes `cancelled` (Task 4 review O-b).
- **`YOUR_TODO.md` 2.6's "which migrations are applied" query still stops at 0019.** 2.12 says to use 0023's own verification query instead.
- **Fixtures are regenerated, not hand-edited.** After a deliberate contract change, run `node test/contractsB06.test.mjs --write-b06-fixtures` and review the diff.

**Constraint for later packages: project, step and engagement ids must stay ASCII.** A task key is capped at 1,000 UTF-8 bytes (Task 1 review L1: a longer key fails in the unique index). Keys are composed from those ids, so 200 non-ASCII characters per id could exceed the cap, and the save would be refused.

## Next

1. Review Task 6, then merge it onto `vmag211/backend` with the B04 contracts task, and re-run the gate on the merge. The controller then regenerates `STATE.md` and re-measures the registry: four more operations answer.
2. Answer open question 1. It alone unblocks the flag. Then apply 0019 to 0023 as one batch.
3. Give Yogi `YOUR_TODO.md` Part 4 items 16 to 22 and the B06 contract.

---

# B05 checkpoint: discovery (the map routes, Explore your area, an honest comparison)

Date: 2026-10-19. Branch: `vmag211/backend`. Plan: `docs/backend/plans/b05-discovery-and-summaries.md`. Contract digest: `.superpowers/sdd/b05-discovery-and-summaries/contract-digest.md` (gitignored scratch).

The B03, B02 and B01 checkpoints follow this section unchanged. Nothing here is a deployment, provider or approval claim. **The Explore area is not live anywhere:** it needs migration 0022, and 0022 is applied nowhere.

## Five things a reader would otherwise assume wrongly

1. **"Summaries" in the package name built nothing.** The registry names ten operations for this wave. B05 built four (`locations.search`, `explore.area.read`, `explore.area.save`, `map.comparison`) and fixed the two shipped map routes the frontend already calls (`map.layer`, `map.district`). It **dropped** `community.read` and `map.brief`: neither has a consumer, a validator or a type on the frontend ref, and the brief is already built client side from district data. It **blocked** `organizations.search`: there is no participation content, the cause vocabulary is disjoint from the frontend's, and nothing says what `complete` means. It also **blocked** `summary.prepare`, `summary.list` and `summary.read`, because no migration creates the record collections a snapshot freezes. The plan lists what unblocks each one.
2. **The default `/map` still shows no live data.** The registry marks the map operations public, and `/map` runs without credentials unless `?access=owned`. Every map route requires a session (Ruling D1), and BE-047 says a truly unauthenticated route needs a separately reviewed cache, abuse and quota policy. Task 6 is that policy, designed and **not built**, because it waits for Vibhav's answer to open question 1.
3. **`map.comparison` can never say "Aligned".** Every record has no method, no source version, every qualifier `unknown` and coverage `partial` (Ruling D3). So the client's own `compareEvidence` answers "Not comparable", with the method, source and qualifier reasons, for every pair, including two systems with identical readings on the same day. That is the truth about the data HALO holds, not a defect, and the contract schema pins it. The only way to alignment is acquiring UCMR 5 method, release and non-detect qualifiers (HO-074, open question 3). Without the route, the UI would say "Load this layer before comparing its records." about a loaded layer, which is false.
4. **Explore your area is counties, not cities or ZIP codes.** `locations.search` reads the repo's public-domain Census county set and calls no geocoder (DS-016 and HO-074 gate Mapbox storage rights, and the one Mapbox window belongs to onboarding). "Charlotte" and "28208" answer no candidates, while the chooser's own copy asks for a city or a ZIP (F3). Open question 2.
5. **`origin/main` carries the geography defect that B05 fixed.** On main, the daily cron hands `buildAndStoreAll` a bare Map (`app/api/cron/daily/route.js:162`), and `vercel.json` runs it every day at 11:00 UTC. A failed ArcGIS lookup resolves rather than rejects, so a run during an outage overwrites good water and district rows with "0 people, complete". This predates B05, and a Task 1 reviewer found it. `vmag211/backend` fixes it. If production deploys main, the defect is live today (STATE, Known live risks).

## Where B05 stands

| Task | State |
| --- | --- |
| 1. Map wiring fixes, first conformance test of `/api/map` and `/api/district` | Merged (`a6d04ef`, `244f4c9`, `d9f2e1c`; merge `9ad9989`) |
| 2. County gazetteer and `GET /api/locations/search` | Merged (`9c91b08`, `530bcf7`; merges `94146d6`, `6c46ade`) |
| 3. Migration 0022 and `lib/exploreArea.js` | Merged (`8d67f9f`, `53008ec`, `3f14de5`; merge `0cf2287`) |
| Geography outage fix (found in review, predates B05) | Merged (`389e897`, `86ba259`; merges `3e91fd3`, `48e4b11`) |
| 4. `GET` and `PATCH /api/explore/area` | Merged (`18ad7e2`; merge `192f40e`) |
| 5. `GET /api/map/comparison` | Merged (`4bc7d63`, `fad5cf6`; merges `31c5f17`, `48e4b11`) |
| 6. Public read for the map routes | **Not run**: gated on open question 1 |
| 7. Contracts, conformance, tracker, checkpoint | This section. Built on `48e4b11`; commits `58f2d33`, `fd3aa39` and the docs commit that carries this section |

Every task before 7 had an independent review, and each review is in `.superpowers/sdd/b05-discovery-and-summaries/`. Task 7 itself has not been reviewed yet. Nothing is merged to main.

## What exists

- **`GET /api/map`** treats `quarter=latest` as no quarter on every layer, checked before applicability. It uses one parser, `lib/mapQuarter.js`, which the comparison shares (D2). A live water build whose service-area lookup did not complete is answered with `geography_complete: false`, `meta.availability: 'partial'` and a note naming the failed lookup, and it is stored nowhere. The daily pre-build keeps the stored rows.
- **`GET /api/district`** answers a 503 rather than totals the lookup could not support. Its boundary source lines no longer carry U+2014. Contradiction 9.9 (the no-population branch the client rejects) is unreachable through every producer and is pinned by test.
- **`GET /api/locations/search`** answers up to 20 NC counties as the client's `DiscoveryPlace`, bare, with no table read and no outbound call (D4).
- **Migration 0022** (`explore_areas`) and **`GET`/`PATCH /api/explore/area`** are built. A never-saved household reads `{place: null, revision: 1}` (D6), and the read never carries `pendingOperation` (D7). The server stores the gazetteer's own copy of the place (D8). Idempotency is the operation ledger, with `Idempotency-Key` required and `If-Match` equal to the body (D9). Every refusal is a terminal 409 with a reason: `stale_revision`, `revision_exhausted`, `operation_mismatch`, `abandoned` or `attempt_failed`. A pending attempt inside its window is the retryable 503.
- **`GET /api/map/comparison`** reads the stored layer or the UCMR 5 table, never a live upstream build. It makes no outbound call, reads no household table and sends no `sourceName` (D3).
- **`docs/backend/contracts/b05.openapi.json`** is version `b05-1`, with 52 synthetic fixtures, each produced by the real handler. **`test/contractsB05.test.mjs`** (67 tests) runs the handlers against it and against the frontend's own `validPlaces`, `validDiscoveryArea`, `parseMapLayer`, `parseMapDistrict`, `parseMapComparisons` and `compareEvidence`. Those six are transcribed once in `test/helpers/frontendB05.mjs`, now shared by the five per-route suites, which used to carry their own copies (`validPlaces` three times). Its cross-route checks: a `locations.search` candidate saved through `PATCH` and read through `GET` is the same object on all three surfaces, each revision is accepted as the next `If-Match`, and every id `map.layer` gives the client finds its record in `map.comparison`. **No disagreement was found.** No B05 body has a top-level `data` key or a U+2014 (D10). Request and response headers are checked both ways.

## Migrations

**0022 is written and applied nowhere**, and **0019, 0020 and 0021 are still pending** too. 0001 to 0018 are applied to production. All four pending migrations are additive. 0022's apply steps and its tested back-out block (`<!-- backout-0022 -->`) are `YOUR_TODO.md` 2.11. The back-out is tested on PGlite only. Until 0022 is applied, both Explore area verbs answer a non-retryable 503 `feature_unavailable`, and no operation id is claimed. Production enablement of the save also needs the reaper, which is merged: a stale pending attempt is settled to `failed` on the replay path.

## Verification

Gate at the Task 7 docs commit, on `48e4b11` plus Task 7: `node --test test/*.test.mjs` **2,848 passed, 0 failed, 0 skipped, 0 todo**. That is the 2,781 of the follow-ups merge plus the 67 contract tests; the transcription move changed no per-route count. `npm run typecheck` clean. `npm run lint` **0 errors and the 5 pre-existing warnings**. `git diff --check` clean. `vmag211/backend` has since moved to `3d54cdc` (B04 2b), which touches none of Task 7's files. Re-run the gate on the merge.

Task 7's mutation checks, each restored afterwards:

- Renaming `revision_exhausted` in the schema's 409 reason enum failed 3 tests: the coverage test, that fixture, and the save conformance.
- Making the comparison's coverage `complete` in `lib/mapComparison.js` failed 2: the honesty conformance and the layer-to-comparison agreement.
- Wrapping the save's answer with a `data` key in `app/api/explore/area/route.js` failed 2: the save conformance and the three-surface agreement.
- Uppercasing the gazetteer's `place` failed 2.

The earlier tasks' mutations are in their reviews. Everything runs on local fakes or PGlite. No `.env*` was read, no Supabase project or production URL was contacted, and `scripts/smoke-test.mjs` was not run.

## Dropped and blocked, and why

- **Dropped:** `community.read` and `map.brief`. They have no consumer, validator or type, and the frontend calls them "reserved contracts". Unblocked by the frontend publishing a validator and a consumer.
- **Blocked:** `organizations.search`. The blockers are human-written participation content and its verification, a migration, an availability field in the contract (9.3), and a meaning for `complete`. The empty-string loophole is refused on purpose (MP-271).
- **Blocked:** the summaries trio. The blockers are the record collections (HO-076, HO-104), themselves gated on the sensitive-input decisions; the per-version or per-report `id` ruling; the home-context precedence (9.7); and a retention period.
- **Not run:** Task 6. It waits for open question 1. Its forward note from the geography review: a cache-only `getWaterGeo` miss must report `complete: false`, or the route must answer 503.

## Open questions for Vibhav

1. **Public map access (D1).** (a) Approve Task 6's cache-only public read and set its numbers; (b) have Yogi reuse the anonymous bootstrap on `/map`, which needs no backend change but creates an auth user per visitor; or (c) keep `/map` owned only and drop the public default. Recommended: (a).
2. **City and ZIP search (D4).** Census place-to-county and ZCTA relationship files (public domain, no budget, one reviewed download; recommended), or Mapbox, which needs the storage-rights answer (DS-016, HO-074) and a budget separate from onboarding's 500 a day. Either way the privacy row for `explore_areas` must be revised, because a ZIP is finer than a county.
3. **The comparison that never aligns (D3).** Confirm shipping it (recommended over the false "Load this layer" message), and decide whether to acquire the UCMR 5 method, release and non-detect qualifiers (HO-074) so alignment is ever possible.
4. **Retention for `explore_areas` rows.** It is undecided, like every other period. The row holds a county, not the home address, and is deleted with the account.
5. **Applying migration 0022**, the fourth pending migration after 0019, 0020 and 0021 (`YOUR_TODO.md` 2.11).

Later, when summaries are planned: per-version or per-report `summary.read` id (digest 4.1), home-context precedence (9.7), and the order of the record-collections work. Separately, who writes and verifies the organizations content, and which set: the 13 NC-08 county-tagged rows in `volunteer_orgs`, or the Charlotte organizations in the frontend fixture. They do not overlap.

## Known limits and deferred minors

- **Air can still show the blocked comparison copy.** While the stored air layer is stale, `/api/map` answers a live air build and the comparison answers 503, until the asynchronous store lands (Task 5 N5).
- **2,000 comparison ids pass the server cap but exceed common URL limits** at about 780 NC ids, which then fail with a 431. Today's layer is about 290 systems (Task 5 N3, F4).
- **An empty `ids` array is a 400.** A deep link can send one before the layer loads. It is harmless: the effect re-requests when the ids change (Task 5 N4).
- **Comparison period labels are raw ISO strings** (Task 5 N6). This is formatting, not honesty.
- **The gazetteer's 20-candidate cap and exact-first ordering cannot be observed on today's data.** They are argued, not killed by a test. Factor the matcher out when the gazetteer grows (Task 2 N2).
- **The 9.9 call-site scan is a tripwire, not a guard.** An aliased import evades it. The behaviour tests are the guard (Task 1 N3). The district parser self-check also misses three shapes that share covered paths (Task 1 N4).
- **Source-provided names (ECHO `FacName`, AirNow `SiteName`) pass through unstripped.** An upstream U+2014 would reach a body. The client's `safeText` strips it at display, but AGENTS.md covers source copy at the API too. Not fixed in B05.
- **A stale pending save whose reap fails to write stays the retryable 503.** That is the honest "not confirmed" answer (Task 4 observation).
- **`YOUR_TODO.md` 2.6's "which migrations are applied" query still stops at 0019** (Task 3 nit 7, pre-existing).
- **`resolveDefaultStore` in `lib/waterGeo.js` memoises per process.** A future route test that calls the geography outside a harness call, with `UPSTASH_*` exported, could pin a real client. Today's convention of always passing `store` avoids this (follow-ups O3).
- **The Task 4 review's nit N2 also applies to the contract digest** (line 822, "persisted draft"). The drafts are in-memory session state that survives a remount, not a reload. The digest is gitignored scratch and was not edited. The test comments are corrected.

## Next

1. Review Task 7, then merge it onto `vmag211/backend` and re-run the gate on the merge.
2. Answer open questions 1 to 5. Question 1 alone unblocks Task 6.
3. Apply 0019 to 0022 as one batch when ready, and deploy the geography fix before relying on the daily pre-build.
4. Give Yogi `YOUR_TODO.md` Part 4 items 8 to 15 and the B05 contract.

---

# B03 checkpoint: Luna, the conversational MVP

Date: 2026-10-18. Branch: `vmag211/backend`. Plan: `docs/backend/plans/b03-luna-conversational-mvp.md`.

The B02 and B01 checkpoints follow this section unchanged and remain the handoff for everything they cover. Nothing here is a deployment, provider or approval claim. **Luna cannot be used by anybody:** the capability flag is off in every environment and the migration it needs is applied nowhere.

## Six things a reader would otherwise assume wrongly

These are recorded, not decided. Each one is a thing somebody reading "Luna is built" would get wrong.

1. **Luna answers and cites. Luna does not act.** The client's registry (`lib/frontend/production/runtime.ts:58-67`) holds exactly **ten** Luna operations. **Six are built** (`luna.capabilities`, `luna.conversations`, `luna.clear`, `luna.message`, `luna.run`, `luna.cancel`) and **four are deliberately unbuilt**: `luna.proposal.edit`, `luna.proposal.cancel`, `luna.confirm` and `luna.operation`. The `proposal` payload that would ride on a message is a **response field this release never emits**, not a fifth unbuilt operation, and it is the half that matters most, because every one of those four operations' controls renders only inside a `message.proposal` block. The absence is reported in the contract's own vocabulary, through `capabilities` answering `available: true` with `tools: []`. That is the supported way and `available: false` is not: `available` is a single boolean for the whole assistant and it feeds the client's `blocked`, which disables the Send button, every starter prompt and every choice button, so reporting the unbuilt half that way would disable the half that was built and turn a scope decision into a dead screen. Because the proposal controls render only inside a `message.proposal` block, never attaching a proposal removes the action surface entirely: no empty state, no disabled button, no placeholder. `docs/backend/contracts/b03.openapi.json` forbids `proposal` on a message, so building the tool half needs a new contract version.
2. **Luna reads no household data.** Public corpus only. Not "does not today": the household's own tables are seeded with markers in the tests and the assertions are on the bytes that actually left and on every statement the route ran. `noteContext` and `guide` are accepted and validated and then deliberately unused, because the client always sends them and a 400 would make Luna unusable from any screen with a note selected. The reason this is not a feature gap to be closed quietly: **whether household readings and symptom names may reach a free-tier model is Vibhav's decision and it is unresolved.** `capabilities` therefore reports `context: { tasks: false, home: false, projects: false }`, which the client renders as "Tasks off, home records off, projects off", and it is read from nothing: a person who had switched those settings on would otherwise be told Luna uses records it cannot see.
3. **Nothing has run against a real model or a real Supabase project.** Every provider call in every test goes to a fake that throws on an unexpected host; retrieval goes to a fake RPC; the database is the in-memory fake or PGlite. No `.env*` was read, no production URL was contacted, `scripts/smoke-test.mjs` was not run. The capability flag is off in every environment, so applying the migration would not turn Luna on and deploying this branch would not either.
4. **Migration 0020 is written and applied nowhere, and 0019 likewise.** Migrations 0001 to 0018 are applied to production (confirmed 2026-10-17; see the B02 section). 0019 and 0020 are not applied anywhere. 0020's apply steps and its tested back-out block are `YOUR_TODO.md` 2.9 with the `<!-- backout-0020 -->` marker, and the back-out is tested on PGlite only, like 0017's and 0018's. Until 0020 is applied every Luna route answers a non-retryable 503 `feature_unavailable`, which is deliberately a different answer from "this household has no conversation".
5. **Degrade-to-retrieval does not cover a missing provider key.** Ruling L4 promises that a chat model which will not answer degrades to the retrieved cited passages rather than to an error, and it does. It cannot cover a deployment with no key, because `answerFromCorpus` calls `embedQuestion` **before** `retrievePassages`, so with no key nothing is embedded, nothing is retrieved, and there are no passages to fall back to. Two agents established this independently from different angles. The degradation ladder therefore has two rungs owned in different places: "the chat model would not answer" is handled inside the generation, and "this deployment cannot answer at all" is a capability fact decided before a run exists, which is why `messages` refuses with a 503 and `capabilities` reports `available: false` rather than creating runs that must all fail.
6. **Retention for a conversation turn is undecided.** Like every other retention period in `docs/backend/privacy-and-retention.md`, and this one is more sensitive than most: a turn is free text a person typed. It is why `GET /api/luna/conversations` was changed to write nothing (Ruling L10): opening Settings calls that read too, so starting a conversation there would have manufactured records nobody has decided how long to keep, for a person who never used Luna. `capabilities` states no period, because none is approved; what it does say is true, that the person can end it themselves and that clearing really deletes the turns.

## Two numbers that look like configuration and are product decisions

- **60 questions per conversation per day is a product number, and a green suite is not evidence that it is right.** The window choice is forced (an hourly thread budget above the household's hourly 20 could never bite, so it would be a bound that never binds) and the suite pins only the relationships. The latitude was measured rather than inferred: swapping the limit through 19, 20, 21, 60, 89, 90 and 91 shows 20 failing, 21 passing, 89 passing and 90 failing, so **every integer from 21 to 89 inclusive satisfies the tests**. Anything in that band needs no test change. Vibhav picks the number.
- **The free-tier ceiling is a product decision disguised as configuration.** The existing app-wide bound is 450 questions a day at roughly two provider requests each, sized against one-shot questions. A conversation re-sends its history every turn, so the same ceiling buys far fewer conversations than it bought questions, and Luna shares the ceiling and the per-household hourly bound with `/api/assistant` deliberately: both spend from one provider quota, and a second window over the same money is not a bound. A household that has used the legacy assistant twenty times this hour cannot ask Luna until the window moves.

## Where B03 stands

| Task | State |
| --- | --- |
| 1. Migration 0020 and `lib/luna.js` | Complete locally at `e24c3cc` |
| 2b. `GET /api/luna/conversations`, `POST /api/luna/conversations/clear` | Complete locally at `f3ea6f4` |
| 2c. `GET /api/luna/capabilities`, `GET /api/luna/runs/status`, `POST /api/luna/runs/cancel` | Complete locally at `7ffef87` |
| 2a. `POST /api/luna/messages` | Complete locally at `028441d` |
| 3. Integration, contracts, tracker, checkpoint | Complete locally; this section |

Commits in order: `92b2ba4`, `988074d`, `934963c`, `e24c3cc` (task 1); `ff1111d`, `f3ea6f4` (task 2b); `2927992`, `11d5bca`, `7ffef87` (task 2c); `0ff6550`, `028441d` (task 2a); `83a2a3b`, `c9c11e4` and this commit (task 3). `7278073` is B02 task 7's limiter-stub fix, which landed between the merge and task 3 and which task 3 consumed. Tasks 2a, 2b and 2c were built in parallel worktrees and cherry-picked onto this branch; the only textual conflict was the shared `ROUTE_COVERAGE` map, exactly as predicted, and it was additive both times. Nothing is merged to main, and main/release approval is still Vibhav's.

## What exists

Migration `0020_luna_conversations.sql` adds `public.luna_conversations`, `public.luna_turns` and `public.luna_runs`: one conversation per household, turns with an explicit order column because the contract has no timestamp on a message and array order is what the client renders, and runs keyed by both the run id and the originating `clientMessageId` because the client looks up by either. Service role only, row level security on with no policy, privileges revoked, owner cascade, following 0017 and 0018.

`lib/luna.js` is the conversation store, the run model and the answer path, and it has no code path that reads household data at all. The run model is the part worth reading twice, because three mechanisms make a generation that the platform kills survivable: the generation gives itself less time than the invocation has, every settle is a compare-and-set from a non-terminal status so an answer that arrives after a cancellation cannot move the run, and a run left unsettled past its staleness window **reads** as failed whatever the row says, so nothing has to notice that a process died.

Six routes, all behind the flag:

- `GET /api/luna/capabilities` reports what the deployment can do, identically for every household because none of it is household data. Three facts can mean Luna cannot answer and they answer differently on purpose: the flag off is a 200 with `available: false` and the reason, 0020 absent is a 503, and the flag on with no provider key is a 200 with `available: false`. The flag is evaluated first because an off capability must read nothing, and discovering that 0020 is absent requires a read.
- `GET /api/luna/conversations` answers the caller's one conversation, including the `pendingRequest` and `unresolvedOperations` a reload recovers from, or `{ data: null }` when the household has never asked anything (was `{ conversation: null }` until `f2de924`, which disabled the composer for every new household, because the client unwraps an own `data` key and treats any other non-conversation body as invalid). It writes nothing.
- `POST /api/luna/conversations/clear` deletes the turns rather than marking them, keeps the conversation id and raises the revision, which is the receipt the client accepts and the one that does not strand a live session.
- `POST /api/luna/messages` does not answer. It validates, stores the person's turn, creates a run, schedules the generation in `after()` and returns the run, with the conversation attached whatever the status so the person's own question is never invisible while they wait.
- `GET /api/luna/runs/status` reports a run, by its own id or by the client's message id, always answering with the canonical run id. An id with no run is a failed run and never a 404, because the client stops polling only on a terminal status and a 404 would park the attempt for ever.
- `POST /api/luna/runs/cancel` settles a run and answers with what actually happened to it, including `completed` when the generation won the race.

`docs/backend/contracts/b03.openapi.json` is contract version `b03-1` for those six, with 59 synthetic fixtures, and `test/contractsB03.test.mjs` runs the real handlers through the isolated harness against both the document and the frontend's own validators, transcribed from `lib/frontend/production/luna-service.ts` on `origin/codex/october15-review-refinement`. What that suite adds over the four route suites is agreement: the client validates the conversation returned by five different routes with one function and holds a single conversation pointer, so the suite asserts those five are byte-identical for the same state and that the two run routes answer the same settled run identically. **No disagreement was found**, which is the honest result of the check rather than a reason to skip it.

## Verification

Gate on this commit: `node --test test/*.test.mjs` **2,459 passed, 0 failed, 0 skipped, 0 todo**; `npm run typecheck` clean; `npm run lint` **0 errors and the same 5 pre-existing warnings**; `git diff --check` clean. Task 1's gate was 2,169 passing and the three merged route tasks brought the branch to 2,303; B02 task 7's limiter-stub fix and three later commits from other packages landed while this task was running, which is most of the rest of the difference. B03's own share is the 2,303 plus 80 tests added by this task.

Mutation checks were run rather than assumed, and each task recorded its own. Task 3's thirteen, with what each broke: dropping `unresolvedOperations` from the conversation payload broke 13 tests including the cross-route agreement one; reporting revision 0 broke 58; attaching the conversation to a still-open run broke the run-route agreement test; never attaching it on a cancel broke 8; claiming a tool that is not built broke the capabilities contract constraint; dropping the reason from the off answer broke 5; answering `{}` instead of `{ conversation: null }` broke the documented `oneOf`; answering a bare run from `messages` broke 20 including Ruling L12's own test; keeping the revision on a clear broke 9; and taking each of the three budgets' limiters down in turn broke exactly the one new test that pins that budget's direction and nothing else, which is the evidence that each direction is pinned once and precisely.

Fix round 1 added six more, all caught: removing the owner filter from the capabilities schema probe, making that probe run three times, giving a fixture a `sourceIndex` past its own sources (which the document allows and the client rejects, so it isolates the fixture-validator loop from the schema loop), stopping `claimRun` moving a run to `generating`, and giving each of the two run routes a different staleness window from the other. The last two are worth a note: a window mutated to zero is NOT caught, because the in-memory database answers inside one millisecond so `Date.now() - created_at > 0` is false, and the agreement test therefore catches a wrong window rather than an imperceptibly different one.

Everything runs on local fakes or PGlite. No `.env` file was read, no real Supabase project or production URL was contacted, and `scripts/smoke-test.mjs` was not run.

**The reviews in this package were subagent reviews of the three route diffs, not of task 3.** Task 3's own work has not been independently reviewed; the evidence is labelled accordingly rather than described as reviewed.

## Rulings made during execution

L10 to L15 were made while the routes were being built and are recorded with their costs in the plan. In short: a conversation read must not write (L10); `capabilities` reports the flag being off as `available: false` rather than refusing, while the acting routes keep the 503 (L11); `POST /api/luna/messages` must return the conversation including the person's own turn (L12); the flag-off fact is evaluated before the schema probe, because off means nothing is read (L13, which corrected the controller's own ordering); the messages route declares `maxDuration = 60`, and the requirement is the ordering `deadline 45s < ceiling 60s < staleness 75s` rather than the numbers (L14); and a per-conversation quota exists because the per-household hourly bound alone lets one household spend more in a day than the app-wide ceiling holds (L15).

Task 3's own two judgements, both recorded because a later reader will wonder:

- **The five-line "find the run, attach the conversation when terminal" shape stays duplicated** across `runs/status` and `runs/cancel` rather than being hoisted into `lib/luna.js`. Judged with all six routes in view rather than two: `POST /api/luna/messages` is the third route that answers a `LunaRun` and it deliberately attaches the conversation on **every** status, so a shared helper would serve two of three and would read as the house rule rather than as the choice those two made. What the duplication risks is the two drifting apart, and that is now pinned behaviourally in the contract suite, which is a better guard than shared code because it tests the thing we actually want.
- **The limiter fallback directions moved from the route's source to behaviour.** Task 2a had to pin them by reading the route file, because the harness's stub discarded `checkLimit`'s options and no test could provoke an outage. B02 task 7's `LIMITER_UNAVAILABLE` sentinel landed on this branch between the merge and this task, so each budget now has a test that takes its own limiter down and asserts the direction it fails in. What is left of the source-shape test is the half nothing behavioural can reach: the stub ignores the limiter object, so binding the app-wide ceiling to a per-household key would change which window a budget spends from and break no behavioural test.

## Deferred minors, collected from the three route tasks so the final review can triage them

None of these is a defect with a known fix that was skipped; each is a judgement, a cost or a thing a test cannot reach.

1. **`upstream_unavailable` is the code for an unconfirmed outcome.** No `ERROR_CODES` entry means "the outcome is not known", so a clear whose earlier attempt has not settled answers 503 `upstream_unavailable`, retryable, which the client maps to `unknown_outcome` and renders as "The result is not confirmed. Check its status before trying again." Adding a dedicated code is a one-line change to `lib/apiErrors.js` and a change in one route.
2. **A refused clear consumes its `Idempotency-Key`.** `runOperation` claims the row before the effect, so a 409 leaves a settled failed row and a same-key retry replays the same 409. Harmless for a stale revision or an unknown conversation, where retrying the same input is pointless by construction; for `run_open` the revision is still current, so a retry after the run finished would be meaningful and is refused. The client's own preflight refuses to clear while a request is pending, so this needs a stale view to reach, and the fix on that side is a re-read. The alternative was checked and is worse: checking for an open run before the claim breaks replay in a different race.
3. **`revision: "4"` is accepted** on the clear, because the shared `parseBoundedInt` takes an integer string as well as a number. The contract declares a number. The value still has to equal the stored revision, so the leniency carries no behavioural risk, and a bespoke check here would be a second way to do what the shared parser does.
4. **A partially applied 0020 can leave a settled failed ledger row.** The realistic case, none of 0020 applied, writes nothing: `messages` proves the table before claiming the ledger id. If only `luna_conversations` existed, the turn insert would throw inside the operation, which settles that `clientMessageId` as failed and answers the same honest 503. The person's next question has a new id, so nothing is stuck.
5. **The happy path on `messages` runs five statements before responding**, not the "validate and queue" the ruling's prose implies. All are indexed single-row operations, nowhere near the client's 20 second bound, and the extra reads are what buy a ledger receipt with no content in it and the conversation in every response.
6. ~~**The capabilities schema probe is not proved to be owner-scoped by a test.**~~ **Closed in fix round 1.** The test now asserts that the probe is the route's only statement and that it is filtered by `profile_id` = the caller, through the shared `auditOwnerScope`, and its name no longer claims more than it asserts. What stays unprovable, and is now written into the `ROUTE_COVERAGE` comment rather than into a line, is the probe's count mode: the query log records a table, an operation and its filters and nothing else, so no test can assert that the probe reads no rows.
7. **`observedAt` is never emitted on an evidence block.** `assistant_corpus.retrieved` is a `date` column and the client's `sourceInstant` rejects a date-only string, so populating it would mean fabricating a time. The field is optional, so the honest choice is to omit it; displaying a source date later means storing an instant.
8. **`after()` sending the response before the callback runs is a platform promise**, not something proved here. The derived failed status is what makes a broken promise survivable rather than silent.
9. **A stale paragraph in `docs/backend/privacy-and-retention.md`.** Its "Assistant: what leaves the app" section still says the code computes `sendContext = process.env.ASSISTANT_SEND_HOUSEHOLD_CONTEXT !== 'false'` and defaults to sending household context. `app/api/assistant/route.js` has compared against `=== 'true'` since `bae920c`, so the paragraph overstates the leak in the safe direction. Not corrected here because it belongs to whoever owns that document next.
10. **One conversation per household is narrower than the digest's inferred key.** If Luna is later scoped per home, the key changes and migrations here are applied by hand. No data has to move: it is one unique constraint and a pointer column.

## Known limits and open gates

- **Luna is not usable.** The flag is off everywhere and 0020 is applied nowhere. Applying 0020 does not turn it on.
- **Vibhav's three open decisions, none of them worked around:** whether household readings and symptom names may reach a free-tier model (blocks the context half, not this package); the retention period for a conversation turn; and the per-conversation and app-wide spend numbers.
- **The model ids must be pinned in the deployment.** An unset `ASSISTANT_CHAT_MODEL` or `ASSISTANT_EMBED_MODEL` now fails loudly rather than selecting a paid OpenAI default, and the route reports the capability unavailable rather than creating runs that must fail, but a deployment should still set both explicitly along with `ASSISTANT_MODEL_KEY`.
- **The invocation ceiling is a deployment fact.** `export const maxDuration = 60` is declared on the messages route and the ordering `45s < 60s < 75s` is pinned by a test, but a platform that does not honour the declaration would kill every generation mid-answer and report every run failed.
- **The tool half is a package, not a gap to fill in.** It carries revision-bound proposals, immutable snapshots per revision, per-tool field allowlists, reauthorization at execution and a proposal-to-operation map, and the client's hardest requirement is there too: a `succeeded` or `cancelled` receipt without the canonical conversation is unrecoverable from the UI.
- **No contract test proves a live integration.** `test/contractsB03.test.mjs` proves the handlers agree with the document and with transcribed validators; it does not prove the frontend branch still has those validators, and the frontend file is not checked out in this repository.
- Every B02 and B01 limit in the sections below still applies.

## Next

The final review of this package, then Vibhav's three decisions. Nothing in B03 should be deployed or enabled before the retention period for a conversation turn is approved, because turning the flag on starts storing free text that nobody has decided how long to keep.

---

# B02 checkpoint: identity linking and account recovery

Date: 2026-10-17. Branch: `vmag211/backend`. Plan: `docs/backend/plans/b02-identity-linking-and-recovery.md`.

The B01 checkpoint follows this section unchanged and is still the handoff for everything B01 covers. Nothing here is a deployment, provider or approval claim.

## Where B02 stands

| Task | State |
| --- | --- |
| 1. Capability proof and recovery schema | Complete locally at `b529f41` |
| 2. Operation ledger primitive | Complete locally at `6a66347` |
| 3. `GET /api/account`, recovery feature | Complete locally at `44d0b72` |
| 4. Link intent via `POST /api/account/commands` | Not started |
| 5. `POST /api/recovery/request` | Not started |
| 6. Turnstile verification | Built and reviewed, acceptance blocked on three things, not one: the site key, the SECRET key, and the frontend sending the token field. BE-340's accessible fallback is separately NOT met and needs a product and ops decision no key supplies |
| 7. `POST /api/recovery/status` | Not started |
| 8. `POST /api/recovery/complete` | Not started |
| 9. Device listing and revocation | Not started |
| 10. Contracts, fixtures, tracker, checkpoint | Not started (this file is the interim checkpoint) |

Commits in order: `6a66347` (task 2, from the previous session), `b529f41` (task 1), `44d0b72` (task 3). **All three are unpushed**; `git log origin/vmag211/backend..HEAD` is the current list. Nothing is merged to main, and main/release approval is still Vibhav's.

## What exists

Migration 0017 adds `public.operations`, the idempotency ledger for all 72 frontend operations, with `recovery` as the one domain allowed a null owner because it runs before sign-in. `lib/operations.js` claims an id with an atomic insert-if-absent, so exactly one of several concurrent callers runs the effect; a pending row past its window reads as `unknown` rather than `pending`, and `unknown` is never reported as failure. `GET /api/operations` replays a settled receipt verbatim, and a stranger's id is byte-identical to a nonexistent one. `listUnresolvedOperations` answers the inventory every initial read carries.

Migration 0018 adds `public.recovery_challenges`. Hashes only: `email_hash`, `nonce_hash` and `restore_token_hash` each accept 64 lowercase hex characters and nothing else, so a plaintext address, nonce or token cannot be written to the column. Service role only: row level security on, zero policies, privileges revoked, so not even the owner reads their own challenge. A verified row must carry a token hash, and `consumed_at` cannot be set on a row that never had one. Only the statuses the frontend accepts are storable; `unknown` is never stored.

`GET /api/account?feature=recovery` returns the contract's `AccountSnapshot` for one feature. The capability is off unless `HALO_FEATURE_RECOVERY` is `on` or `true`, enforced in the handler, and while it is off the route reads neither the database nor the auth provider. When on it reports the linked method as a mask with its verification date, the one open challenge with its expiry, an empty `devices` list and the unresolved operation inventory.

## Verification

Gate at `44d0b72`: `node --test test/*.test.mjs` **1,925 passed, 0 failed, 0 skipped, 0 todo**; `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; `git diff --check` clean. The starting point for this session was 1,871 passing.

Mutation checks were run rather than assumed, and each is recorded in its commit: removing 0018's `revoke` fails 3 tests, gutting a back-out block in `YOUR_TODO.md` fails 5, making the capability flag return true fails 3, returning the address unmasked fails 2, flattening the revision fails 2, and naming a method the SDK does not have fails the capability probe. Everything runs on local fakes or PGlite. No `.env` file was read, no real Supabase project or production URL was contacted, and `scripts/smoke-test.mjs` was not run.

**The review for both tasks was done in this session. It was not an independent subagent review**, which is what the workflow prefers; the evidence is labelled accordingly rather than described as independent.

## Deliberate departures from the plan, with their cost

Recorded in full in the plan's "Rulings made during execution" section: `recovery_operations` is not built because 0017's generic ledger serves recovery too (cost: a recovery-only retention rule is harder to express, and is logged as an open retention decision rather than designed around); the schema ships as 0018 rather than inside 0017 so the ledger can be applied without the recovery schema; and task 1's capability proof is a presence proof, not an end-to-end exchange, because that needs provider access the local boundary excludes.

## Corrections made to existing documents

The spec was being reported as missing. It is not: the complete 521,027-byte working spec is in this repository's git objects on `origin/codex/october15-review-refinement`, sha256 `fc1fec4b...415be86`, which matches the figure in Yogi's wiring packet manifest and was verified this session. `WORKFLOW.md` step 2 now gives the command to read it, `YOUR_TODO.md` Part 3 item 2 is resolved rather than blocking, and the tracker header says which rows came from which source. The stale `Spec text not received` blockers on the DS/MP/UI/AC/ST/WF/AG/MA/VR placeholder rows are marked stale in the header but deliberately not mass-edited: re-baselining the tracker against all 1,630 named requirements is its own task.

`YOUR_TODO.md` gained apply steps and tested back-out blocks for 0017 and 0018 as sections 2.3 and 2.4 (the old 2.3 is now 2.5). 0017's back-out existed only as a comment in the migration and was never in the file the back-out test runs, so it was untested until now.

## Known limits and open gates

- **Recovery is not usable.** Tasks 4, 5, 7, 8 and 9 do not exist, so nothing can link an address or recover an account yet. The flag is off and applying 0018 does not turn it on.
- `recovery.devices` is always an empty list. That is not a claim that a household has no devices; task 9 populates it.
- The end-to-end Supabase session-minting exchange is unproven. Task 8 depends on it and keeps the stated fallback.
- **0015 and 0016 are applied to production** (confirmed 2026-10-17 by the state query in `YOUR_TODO.md` 2.6: `save_household` present, the four checks present, the revoke in effect, `home_contexts` and `daily_scores.home_context_id` present). They were applied after `baseline-audit.deployed.json` was captured, so that file records the pre-migration catalog and is now stale. 0015's four checks were validated the same day (`m15_validated` 4), so 0015 and 0016 are complete there. **0017 and 0018 are also applied to production** (2026-10-17, each verified with every column true, including that the revoke closed `anon` and `authenticated`). Migrations 0001 to 0018 are therefore all applied. Both back-out blocks are tested on PGlite only, unlike the 0015 and 0016 blocks which passed a throwaway-project trial, and they now matter more because both tables are live. Applying them activated nothing: the routes that read these tables are unpushed, `origin/main` does not reference them, and recovery stays behind a flag that is off.
- Vibhav's blockers are unchanged and were not worked around: no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in any environment (BE-340, blocks task 6), no backup or restore coverage on the current Supabase plan (BE-307), no recorded recovery objectives (BE-360), and no approved retention periods, including none for a consumed or expired challenge or for settled recovery receipts.
- **One unexplained test failure, seen once and not reproduced.** On a docs-only commit, `routeIsolation.test.mjs` "a request with a junk or foreign-looking token never reaches household data" failed in a full-suite run. It then passed 20 consecutive runs (12 of that file alone, 8 full-suite), and the assertion detail was not captured, so the cause is unknown. Nothing is being claimed about it: it is recorded here because an intermittent failure in an identity-isolation test deserves a prior sighting if it happens again. That test asserts a 401 and an empty query log for three bad tokens across four routes, so a limiter answering 429 or late async work reaching the log are the shapes worth checking first.
- Every B01 limit in the section below still applies.

## Next

Task 4, the link intent, in its own commit with its own review. It must attach a verified email to the signed-in anonymous identity while leaving `auth.users.id`, `profiles.id` and every owned row untouched, treat an address already linked elsewhere as a collision and never a merge, and keep link and recover on separate code paths.

---

# B01 continuation checkpoint

Date: 2026-10-11. Branch: `vmag211/backend`.

This was the current handoff until the B02 section above was added, and it remains the authority for everything B01 covers. `docs/backend-progress.md` records the older September baseline. B01 implementation began at `7894bd7`; the last implementation commit before the work was resumed in a later session was `4b07435` (Task 9c), with carries in `b5bf647`. This continuation began at `4b07435`, committed Task 10 at `d492e9e` and committed Task 11 at `405f2b9`, the commit that first contained this checkpoint. Later commits on the branch are review fixes to Tasks 10 and 11; `git log 405f2b9..HEAD` lists them. Push state: the controller pushes `vmag211/backend` after each reviewed task, so `git log origin/vmag211/backend..HEAD` shows what is not pushed yet. Nothing was merged to main. Main/release approval is still Vibhav's decision.

## What is complete locally

Tasks 1-9c: shared safe errors and validators, isolated route harness, identity/isolation tests, route hardening, reconstructed baseline and read-only audit query, migrations 0015/0016, home list/detail/revision updates, onboarding transitions, backfill state, context-linked daily writes and current-home history/findings. The starting branch's 1,723 tests passed during this session. The 9c review was performed in this session by reading its report, shared history/ownership changes, cron/findings wiring and tests; it was not an independent subagent review. Final risk-focused review also covered verified-token handling, service-role ownership boundaries, shared validation/errors, 0015 transaction/revoke behaviour, 0016 transition/update functions and ownership/cascade test evidence. No blocking issue surfaced in that reviewed scope; this was a self-review, not a comprehensive independent audit. Known limits are listed below.

Task 10: rejected POST/PUT/PATCH/DELETE writes return the original 401 response without replacement identity or replay. GET/HEAD retain one recovery attempt; 503 never triggers identity recovery. `recoverSession()` exposes user-confirmed replacement without replay, not restoration of an old household. Recovery ADR remains proposed. Privacy inventory covers every table in the migrations and reconstructed baseline; a test checks inventory completeness. Existing frontend tests were not edited.

Task 11: OpenAPI 3.1 version `b01-1` for six operations, synthetic success/failure/fallback fixtures, Ajv schema validation and real-handler conformance through the isolated harness, complete received-ID tracker, and this checkpoint/workflow. Frontend types remain handwritten; schema generation/integration is still open. Contracts do not certify source meaning or live provider rights.

Completed local child criteria: HO-065 reconstruction/replay (not deployed capture); HO-066 validation, transactionality, current-home/history and existing route/RLS isolation; HO-099 home operations (not interests/preferences expansion); HO-118 existing envelope/list/conflict semantics (not full pagination/coverage); HO-119 bounded existing writes and rejected-write response retention (not frontend recovery UX/export); HO-131 existing route/database identity isolation and rejected-write behaviour (the row for frontend identity-scoped caches in `lib/frontend/*` is Yogi's and rests on the existing frontend tests); HO-154 local replay/audit tests (not production audit/restore); BE-011, BE-019, BE-020 and BE-024-BE-031 only for the tested child criteria in `requirements-tracker.md`. No full B02-B12 requirement is claimed complete.

## Verification

Gate at `405f2b9` (2026-10-10): `node --test test/*.test.mjs` **1,816 passed, 0 failed, 0 skipped/todo**; `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; `git diff --check` clean. The tracker covers all 119 distinct received HO/BE definitions with 165 child/dependency rows, and the contract directory contains 52 synthetic JSON fixtures. Task 10: 1,741 tests passed, 0 failed, 0 skipped/todo; typecheck clean; lint 0 errors and 5 pre-existing warnings. Focused contract checks at `405f2b9`: 73 passed after adding internal-error fixtures and removing an unsupported onboarding 409 fixture. All use local fakes or PGlite, never production. The first contract run found two test-setup errors (duplicate seed and accidentally declared missing table), both corrected; the first inventory run found a regex excluding digits in table names, corrected. No unresolved failure is being hidden.

Review fix round after `405f2b9` (independent reviews of Tasks 10 and 11): `node --test test/*.test.mjs` **1,821 passed, 0 failed, 0 skipped/todo** (the 1,816 above plus one contract header-drift test, two Request-object recovery tests and two disclosure validation tests); `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; the 36 `MODULE_TYPELESS_PACKAGE_JSON` warnings are pre-existing; `git diff --check` clean. The tracker has 165 rows after BE-019 was split. Migrations 0015 and 0016 are still not applied anywhere.

Final-review fix round (after `f56918c`): `node --test test/*.test.mjs` **1,829 passed, 0 failed, 0 skipped/todo** (the 1,821 above plus the 8 tests of `test/migrationBackout.test.mjs`); `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; the 36 `MODULE_TYPELESS_PACKAGE_JSON` warnings are pre-existing; `git diff --check` clean. The tracker has 166 rows (one HO-159 row for the back-out blocks). The back-out blocks and the `ucmr5_utilities` remedy in `YOUR_TODO.md` are verified locally on PGlite only, not on any Supabase project. The 0016 apply-time locks (ACCESS EXCLUSIVE on `daily_scores`, SHARE ROW EXCLUSIVE on `profiles`, both until commit) were measured on PGlite.

A build and live browser flow were not run because the plan excludes loading `.env*` and real project/provider access. Those remain separate staging/human checks. The existing Node module-type warnings and legacy log lines are not newly introduced by this change. The five lint warnings remain in daily-score, district, backfill, assistantRag.test and uploadData.

## Changed files

This continuation modifies `lib/auth.js`, adds `test/authRecovery.test.mjs` and `test/privacyDisclosure.test.mjs`, and creates `docs/backend/decisions/B01-optional-recovery.md` and `docs/backend/privacy-and-retention.md`. The Task 11 commit also adds two tests to `test/authRecovery.test.mjs` (explicit recovery with no stored session creates one identity, and a failed session read during explicit recovery never signs out or signs in) and corrects the geocoding sentence in `docs/backend/privacy-and-retention.md` (the precise geocoded point goes to service-area lookup before rounding for storage). Task 11 adds `docs/backend/contracts/b01.openapi.json`, `docs/backend/contracts/README.md`, all JSON fixtures in `docs/backend/contracts/fixtures/b01/`, `test/contractsB01.test.mjs`, `docs/backend/requirements-tracker.md`, `docs/backend/checkpoint.md` and `docs/backend/WORKFLOW.md`, and the preserved ruling log at `docs/backend/decisions/B01-implementation-rulings.md`. It adds a current-checkpoint pointer to the historical `docs/backend-progress.md`. It adds dev dependencies `ajv` and `ajv-formats` in `package.json`/`package-lock.json`, and updates/records the existing user TODO. The review fix round also changes `lib/auth.js` (a Request-object write is treated as a write), `test/authRecovery.test.mjs`, `test/contractsB01.test.mjs` (documented and sent `X-Request-Id`/`Retry-After` headers are compared), `test/privacyDisclosure.test.mjs` (cell-level validation), the OpenAPI/README header wording, the privacy disclosure (assistant outbound data), the recovery decision (B and C dependencies) and this documentation set. The final-review fix round rewrites the 0016 header comments (wiring and measured locks; no executable SQL changed), adds `test/migrationBackout.test.mjs`, the tested back-out blocks, the guarded `ucmr5_utilities` remedy and the required throwaway-project trial to `YOUR_TODO.md`, drops a plan reference from a comment in `lib/limits.js`, and updates the tracker, the rulings log and this checkpoint. The full B01 file set is available from `git diff --name-only 7894bd7..HEAD`.

The pre-existing untracked `components/onboarding/mobile-review.css` is unrelated and remains untouched and uncommitted.

## Migrations and human checks

**0015 and 0016 were not applied anywhere at the time this B01 section was written.** They have since been applied to production (2026-10-17); see the B02 section above. Nothing in this B01 section applied them. Do not run `supabase/baseline/reconstructed_baseline.sql` on the real project: it is a local reconstruction with auth stubs.

1. **Done 2026-10-17**, findings in `docs/backend/baseline-audit.deployed.json`. That capture predates the 0015 and 0016 apply, so it now records the pre-migration schema and is marked superseded in the file; re-run `baseline-audit.sql` to capture the post-migration catalog.
2. Check legacy push endpoints and browser writes as described in `YOUR_TODO.md`.
3. **Done.** The throwaway-project trial passed at Postgres 17.6 for 0015 and 0016 (including both back-out blocks and re-applying), Vibhav applied 0015 and 0016 to production on 2026-10-17 and validated 0015's four checks, then applied 0017 and 0018 the same day, each with its verification query returning every column true. 0017 and 0018 had no disposable-project trial of their own: each is a single `create table` that touches nothing existing, and their back-outs are tested on PGlite only. Do not infer authorization to apply anything else from this checkpoint.
4. Review the recovery ADR and privacy disclosure. No choice or retention period is approved. B05 sensitive input remains disabled until both decisions are approved and selected safeguards pass tests.
5. **Resolved:** the complete working spec is in this repository's git objects on `origin/codex/october15-review-refinement` at `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md`, sha256 `fc1fec4b...415be86`, verified 2026-10-17. `WORKFLOW.md` step 2 has the command to read it. Nothing further is needed from Vibhav here.

## Unresolved gates and known limits

- HO-152 interpretation/threshold review, HO-153 recovery, scheduler, storage/scanning, retention and budget decisions, and HO-154 live schema/config audit and restore drill remain open. HO-144 pollen retention and HO-145 geocoder storage rights remain unverified; code tests do not settle them.
- No recovery of an old household is implemented. A confirmed replacement loses access to the old data. GET/HEAD recovery can still replace identity, as the approved Task 10 scope explicitly retained. Yogi must add any explicit recovery/draft resubmission interface.
- No capabilities endpoint, complete export, new attachments, transcript storage or retention purge is implemented. Account cascades cover the existing local schema, not backups or provider copies.
- Homeguard's null utility wording still needs the current context's `service_area_status` to distinguish failed lookup from no match (carried 9b finding, BE-028).
- History reads are bounded before home filtering; very large earlier-home datasets can consume the read cap. `context=all` returns one point per date/home. Legacy unlinked readings are assumed current; pre-context historical moves cannot be reconstructed.
- The onboarding replay's four location fields reflect the saved context; other top-level utility/attribute fields still echo the request. Numeric but out-of-range geocoder points can reach SQL and return 500. Today's cache/assistant/source reads remain household-wide. These carried 9c concerns are not changes in this continuation.
- Profile PATCH's transitional located/no-context race and partial-0016 fallback can leave attributes inconsistent; complete rollout minimizes those already documented windows. Backfill retries can create duplicate date rows; history collapses latest refreshes.
- Migration 0015 can report success after a partial privilege revoke; the manual privilege check is necessary. The TRUNCATE/REFERENCES/TRIGGER grants are no longer a vague deferred item: the 2026-10-17 post-migration catalog shows `anon` and `authenticated` holding all three on every public table, and row level security does not govern TRUNCATE, so an authenticated role that could reach raw SQL could empty `symptom_logs` outright (proved locally; DELETE is denied, TRUNCATE is not). It is not reachable through the deployed surface, because PostgREST has no TRUNCATE verb and the two functions those roles may execute return trigger types Postgres refuses to invoke directly. The tested remedy in `YOUR_TODO.md` 2.7 was applied to production on 2026-10-17, so the privileges are gone. Multidimensional symptom-array checks remain a deferred hardening item.
- Some older backend copy still has em dashes; new app-facing text in this continuation has none. Approved frontend/archive files were not changed.

## Next package

B01 local code/docs handoff is the stopping boundary, not a deployment claim. Resolve the audit and recovery/privacy decisions and obtain the full spec. B02 evidence/source operations is next, with a new dependency-bounded plan only after its field, relationship and source-acquisition sections are received. B03-B12 must not be guessed from the partial handoff.
