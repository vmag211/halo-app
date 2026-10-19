# B05 Discovery and summaries: implementation plan

Spec: `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` on `origin/codex/october15-review-refinement`, sha256 `fc1fec4b180dc5057b2edf1c2203143d85535b43364502e674d34e04d415be86`, 521,027 bytes (re-verified 2026-10-18). Branch: `vmag211/backend`.

Primary requirements: **BE-034** (`/api/map`), **BE-035** (`/api/district`); **BE-047**, **MP-080**, **UI-038**, **AC-148** (access classified by data; a truly unauthenticated route needs a separately reviewed cache, abuse and quota policy); **MP-294 to MP-297**, **HO-044**, **AC-120** (map shell, safe public cache); **MP-309 to MP-311**, **UI-101**, **HO-047**, **AC-123** (public comparison with an explicit incompatibility result); **MP-260**, **UI-090** (Explore your area); **DS-016**, **DS-138 to DS-140**, **BE-341**, tracker **HO-074** (geocoding storage rights before expanded persistence); **BE-197** (operation ledger), **BE-199**/**BE-201** (validation, safe envelopes), **BE-230** (ownership). Release gates: none closed by this package.

Contract digest, cited and binding where it quotes the frontend: `.superpowers/sdd/b05-discovery-and-summaries/contract-digest.md` (1,477 lines, file:line per claim; `F:` is the frontend ref, `W:` this tree). Where it says "ambiguous", the rulings below decide.

## What this package is, and what it deliberately leaves out

The registry names ten operations for this wave (F: `runtime.ts:45-49,69,71,74-76`). This package builds four, fixes two shipped routes the frontend already calls, and leaves six alone for stated reasons.

**Dropped: `community.read` and `map.brief`.** Neither has a consumer, a validator or a type on the authoritative ref; the frontend calls both "reserved contracts, not automatic requests or proof of connected services" (F: `docs/product/HALO_BACKEND_WIRING_CURRENT.md:369`), and the brief is already built client-side from district data (F: `lib/frontend/map-public-brief.ts:5-39`). *Unblocked by:* the frontend publishing a validator and a consumer.

**Blocked, not planned: `organizations.search`.** `volunteer_orgs` has 8 columns (W: `0004_volunteer_orgs.sql:13-22`, plus `link_checked` from 0012) against a validator requiring 14 strings, a four-value `interest`, `scopes` and ordered `steps` (F: `explore-service.ts:62-65`). The cause vocabulary `water, pfas, radon, air, wells, advocacy` (W: `0004:18`) is disjoint from `Cleanup | Trees & habitat | Gardening | Community learning`. The empty-string loophole (`text()` accepts `''`) is rejected on purpose: MP-271, "Filters hide unsupported fields rather than inventing defaults". *Unblocked by all of:* human-written participation content per organization; a person's verification of each listing (`last_verified` is NULL by design); a migration holding it keyed by `volunteer_orgs.id`; a frontend contract change so a failed directory read is not rendered as "no matches" (9.3; AC-074, AC-115, HO-039); a stated meaning for `complete` (digest ambiguity 8).

**Blocked, not planned: `summary.prepare`, `summary.list`, `summary.read`.** No migration creates the `tests`, `assets`, `observations` or `gardens` collections a snapshot freezes (digest 7, 8.5). *Unblocked by all of:* the record collections and their read APIs (HO-076, HO-104), themselves gated on the open sensitive-input decisions (recovery option, `YOUR_TODO.md` Part 3 item 3; retention, STATE decision 3); a ruling on per-version versus per-report `summary.read` id (digest 4.1; per-version recommended); a home-context precedence rule (9.7); the reaper landed and settling to `failed`, never `cancelled` (9.4); a retention period for saved summaries; then a migration.

**In scope:** `/api/map` and `/api/district` wiring fixes plus their first conformance test against the frontend's parsers; `GET /api/locations/search` over a licence-free NC county gazetteer; migration 0022 and `GET`/`PATCH /api/explore/area`; `GET /api/map/comparison`, honestly degraded; and a fully specified public-read policy built only on Vibhav's yes.

## Rulings made before execution

- **Ruling D1, public access: the spec decides policy, the registry declares transport.** The registry marks `map.layer`, `map.comparison`, `map.district` and `map.brief` `public: true` (F: `runtime.ts:68-71`) and `/map` builds a credential-free runtime unless `?access=owned` (F: `components/production/PublicFrontend.tsx:14-16,23`), while every map route calls `requireUser` (W: `app/api/map/route.js:50`, `app/api/district/route.js:28`). BE-047: "A truly unauthenticated public route would require a separately reviewed read-only cache, abuse and quota policy; this plan does not silently remove existing route authentication." The registry disclaims authority over the backend (F: `runtime.ts:16`). B05 ships no anonymous access; Task 6 is that policy, dispatched only on Vibhav's yes (Open question 1). Cost if wrong: until a decision, the default `/map` URL renders no live layer, district or comparison; only `?access=owned` works.
- **Ruling D2, `latest` is the absence of a quarter, on every map route.** The client sends `quarter=latest` on comparison (F: `LiveMapComparison.tsx:15`) and pagination (F: `MapPreview.tsx:127`), omits it only on the first layer page (F: `MapPreview.tsx:119`), and resets to `latest` on every layer change (F: `MapPreview.tsx:231`). `latest` is accepted for every layer and treated exactly as omission, checked before `quarter_not_applicable`, so `layer=air&quarter=latest` is 200. Every other non-`YYYYQn` keeps its 400 (W: `app/api/map/route.js:32,62-71`), and keeps its existing code: a malformed quarter on a non-water layer stays `quarter_not_applicable` (applicability is checked before format, as before; the client maps every 400 to `validation` and discards the code, `runtime.ts:144-145`). Task 5 uses the same order through the same parser. One shared parser so `/api/map` and comparison cannot drift. Honest reach: latent on `map.layer` today, blocking for `map.comparison`.
- **Ruling D3, `map.comparison` ships, and can never say "Aligned".** Without a route the UI says "Load this layer before comparing its records." (F: `copy/map-comparison.ts:41`, `MapComparison.tsx:41`) on a loaded layer, a false statement. With it, both records render side by side (F: `MapComparison.tsx:59-77`), each `Not comparable` with reasons, as MP-310, HO-047, UI-101 and AC-123 ask. Provenance fixed by rule (digest 10.1, 10.2): `method: null`, `sourceVersion: null`, every `qualifier: 'unknown'`, `coverage: 'partial'` never `'complete'`, `denominator` only the basis that is truly ours (one latest scored result per compound and system, W: `lib/mapData.js:134-137`), no hazard-index value. Reads only from the stored layer or the static utilities table, never a live upstream build. The only route to "Aligned" is data acquisition (HO-074), not code.
- **Ruling D4, `locations.search` resolves to NC counties from a licence-free gazetteer.** DS-016 and HO-074 gate Mapbox storage rights before expanded persistence, and the only Mapbox limiter is one global 500-a-day window (W: `lib/ratelimit.js:8-12`) that onboarding spends (W: `app/api/onboard/route.js:235`). The repo holds a public-domain Census TIGERweb county set (`lib/data/ncCounties.json`, read by `lib/geoContainment.js:13`). Candidate: `id: 'us-county:<GEOID>'`, `place: '<Name> County'`, `state: 'NC'`, `label: '<Name> County, NC'`, `timezone: 'America/New_York'`. City and ZIP queries return `{candidates: []}` until Open question 2.
- **Ruling D5, the saved area belongs to the household, not to a home context.** One row per `profile_id`. `X-Halo-Home-Context` is ignored on every B05 route (9.7).
- **Ruling D6, never-saved is revision 1 with no row; storage is migration 0022.** The read must return `revision >= 1` with `place: null` (F: `explore-service.ts:69`); `revision: 0` makes every save refuse (F: `ExploreDiscovery.tsx:60`). No row means `{place: null, revision: 1}`; the first save inserts revision 2 (a plain insert whose unique violation is the conflict); later saves update `where profile_id = $1 and revision = $2`. Rejected: deriving from the ledger (not atomic, ledger as state store, contrary to B04 S4); riding on 0021's preferences table (couples the area into the settings revision).
- **Ruling D7, `pendingOperation` is never emitted in B05.** Optional, and omission is valid (F: `explore-service.ts:69`); the ledger stores a hash of the input (W: `lib/operations.js:147-156`), so the attempted `place` cannot be reported truthfully; the client parks and replays its own lost-response operation (F: `ExploreDiscovery.tsx:36,60`).
- **Ruling D8, the server canonicalizes the place.** `PATCH` resolves `place.id` against the gazetteer and stores and returns the canonical five fields. An unknown id is a validation failure.
- **Ruling D9, `explore.area.save` copies the Luna clear pattern** (W: `app/api/luna/conversations/clear/route.js:37-58,196-260`): body exactly `{place, revision}`, unknown keys refused; `If-Match`, when present, must equal the body revision (else 400); `Idempotency-Key` required and a UUID (9.6); precondition checked inside `runOperation` so a replay gets the first outcome; a refusal stored as `{status: 'failed', reason, revision}` and returned as 409. **One deliberate difference:** a replay that finds a settled `failed` row the route did not itself refuse, in either of its two shapes, is a terminal **409, not** the in-flight 5xx, because a 409 clears the client's parked operation (F: `ExploreDiscovery.tsx:60`). The two shapes are what the reaper leaves, `result: {status: 'failed', reason: 'abandoned'}`, and a row whose `execute` threw in-process, `result: null`. *(Amended after the reaper review: the plan first described only the null shape, so a route built from it would have passed its test and still answered an abandoned save with a false reason.)*
- **Ruling D10, no B05 response is wrapped.** No top-level `data` key (F: `runtime.ts:149-153`, 9.8). This is scoped to B05: B03's absent conversation read, `{ data: null }`, is the one deliberate top-level `data` body in the backend and must not be "fixed" by a sweep, because it is what keeps the Luna composer enabled for a new household. No U+2014 in any readable string.
- **Ruling D11, no B05 surface populates `unresolvedOperations`, and B05 writes nothing in the `summary` domain.**

## The nine contradictions, ruled

| # | Contradiction (digest 9) | Ruling | Owner |
|---|---|---|---|
| 9.1 | `public: true` against `requireUser` 401 | Spec authoritative; no anonymous access without approval (D1); Task 6 designed and gated | **Ask Vibhav** (Q1); flag Yogi that reusing anonymous bootstrap on `/map` is BE-047-permitted with no backend change |
| 9.2 | `quarter=latest` 400s | `latest` means omitted, every layer, shared parser (D2) | Backend, Task 1 |
| 9.3 | `organizations.search` cannot say "directory unavailable" | Not built. When built, an unreadable directory is a 5xx, never `items: []`; the contract needs an availability field like `opportunities.search` (F: `explore-service.ts:42,55`) | Flag frontend |
| 9.4 | Ledger allows `cancelled`; `validSummaryReceipt` rejects it | Never settle a `summary` operation as `cancelled`, binding on any future writer and the reaper | Backend rule; flag frontend to treat `cancelled` as terminal |
| 9.5 | Stale pending rows never settle | Owned by the reaper task; B05 maps a reaped `failed` replay to 409 (D9) | Backend, reaper |
| 9.6 | Operation id in body (house) vs header only (client) | Header only, required; body `revision` must equal `If-Match` (D9) | Backend, Task 4 |
| 9.7 | `X-Halo-Home-Context` sent and unknown | Ignored in B05 (D5) | Flag frontend; summary precedence to Vibhav later |
| 9.8 | Bare payloads vs `data` unwrap | No wrapping, no `data` key, asserted by test (D10) | Backend, every task |
| 9.9 | District no-population branch fails `parseMapDistrict` | Task 1 proves reachability first (`buildDistrictView` defaults `geo` to `new Map()`, W: `lib/districtView.js:41`; `withPop = geo instanceof Map`, W: `lib/district.js:67`). If reachable, emit truthful counters (`over_population_unknown = over`, `population_over: null`, `affected_population_complete: false`, `over_limit_population_unknown = systems_over_limit`); if not, pin with a test and change nothing | Backend, Task 1 |

Further findings from planning:

- **F1:** the default `/map` is public, so `map.layer` and `map.district` 401 today too (F: `PublicFrontend.tsx:23`). Covered by D1.
- **F2:** the compound selector is keyed on a copy string, `isWater = first?.scope === c.scopeWater` (F: `MapComparison.tsx:36`); the backend must send the literal `'Public water system'`. Flag Yogi to key on a code.
- **F3:** the chooser copy promises city and ZIP ("For example, Charlotte or 28208", "Try a nearby city or a ZIP code", F: `ExploreDiscovery.tsx:59,62`) while D4 serves counties, and `validPlaces` cannot say "unsupported geography" (AC-115). Flag Yogi.
- **F4:** the comparison request carries every visible id in one uncapped GET parameter (F: `MapPreview.tsx:316`). Server caps at 2,000 (`loadUtilities`' limit, W: `lib/mapBuild.js:22-25`). Flag Yogi to send only the pair.
- **F5:** a reaped row becomes a permanent 5xx on Luna clear: `if (!outcome.result) return inFlight(...)` in `app/api/luna/conversations/clear/route.js`, since `replayExisting` returns `result: null` for a `failed` row with no stored result (W: `lib/operations.js:196-197`). Sent to the reaper task owner.

## Dependencies outside this package

- **B04 Task 1 (0021) must merge before Task 3.** 0022 follows it and both edit `test/helpers/tables.mjs`, `test/helpers/isolationSeed.mjs`, `test/rlsIsolation.test.mjs`, `test/migrationBackout.test.mjs`, `test/haloTables.test.mjs`, `docs/backend/YOUR_TODO.md`, `docs/backend/privacy-and-retention.md`.
- **The reaper (separate task, `lib/operations.js`).** Task 4 does not need it to merge (its test seeds the reaped row), but production enablement of `explore.area.save` does. Binding note: B05 never calls `listUnresolvedOperations`, so the reaper must also settle stale rows on the replay path (`replayExisting`, `readOperation`).
- No B05 task edits `lib/operations.js`.

## Global constraints (every task, every reviewer)

Everything in B01 to B04: identity only from the verified token with owner scoping on the query; additive responses; no app-facing em dashes (U+2014); server-side validation on every mutation; nothing proof-bearing in responses, logs or envelopes; idempotent migrations that degrade cleanly; mutations idempotent only through the ledger, here domain `'explore'`; `unresolvedOperations` is a lock (S1); new tables service-role only (RLS on, no policy, explicit revoke from `anon` and `authenticated`, as 0017, 0018, 0020); `node --test` only; the full gate before every commit (`node --test test/*.test.mjs`, `npm run typecheck`, `npm run lint` with 0 errors and the 5 baseline warnings, `git diff --check`); one-line mutation proofs; conventional commits with **no `Co-Authored-By` and no Claude attribution**; no `.env*`, no real Supabase, no production URL, never `scripts/smoke-test.mjs`.

Additions:

- **No outbound network call from any B05 route.** The harness fetch stub throws on any host and tests assert it.
- **Never compose a provenance word.** `method`, `sourceVersion`, `qualifier`, `coverage` fixed by D3; a reviewer rejects any path that fills them from a timestamp, a hash or HALO's own formula.
- Frontend validators **transcribed verbatim** with `git show`, with a self-check that the transcription rejects what the client rejects (B03 precedent, `test/contractsB03.test.mjs:21-30`).
- Worktrees provision from `origin/main`: verify base, `git reset --hard vmag211/backend`. Commit, do not merge, rebase or push.
- B05 rulings use the `D` prefix.

## Tasks

| Task | Depends on | Migration | Parallel with | Shared-file collision |
|---|---|---|---|---|
| 1 Map wiring fixes and conformance | none | none | 2, 3 | none |
| 2 Gazetteer and `locations.search` | none | none | 1, 3 | `ROUTE_COVERAGE` line |
| 3 Migration 0022 and storage lib | B04 Task 1 merged | **0022** | 1, 2 | B04 guardrail files, resolved by ordering |
| 4 `GET`/`PATCH /api/explore/area` | 2, 3; reaper for production | none | 5 | `ROUTE_COVERAGE` |
| 5 `GET /api/map/comparison` | 1 | none | 4 | `ROUTE_COVERAGE` |
| 6 Public read policy (gated) | 1, 5, Vibhav's yes | none | none | edits Task 1 and 5 files |
| 7 Contracts, conformance, tracker, checkpoint | all built | none | none | docs |

### Task 1: map wiring fixes, and the first conformance test of the shipped map routes

**Build:** `lib/mapQuarter.js` (new, to avoid colliding with B04 edits to `lib/validate.js`) exporting `parseMapQuarter(value, layer)`: `{ok, quarter: null}` for absent or `latest`; `{ok, quarter}` for `YYYYQn` on water; `quarter_not_applicable` for `YYYYQn` elsewhere; `invalid_quarter` otherwise. `app/api/map/route.js` uses it (D2). 9.9 per the table.

**Files:** `lib/mapQuarter.js`, `app/api/map/route.js`, `test/mapQuarter.test.mjs`, `test/routesMapDistrict.test.mjs` (additive), `test/routesMapConformance.test.mjs`; `lib/district.js` and `test/district.test.mjs` only if 9.9 is reachable.

**Acceptance:** `mapQuarter.test` full truth table (`Latest`/`LATEST` invalid; existing `BAD_QUARTERS` unchanged). `routesMapDistrict`: `?layer=<each>&quarter=latest` deep-equals the request without `quarter` (ignoring request id) and reads the same tables; `layer=air&quarter=latest` is 200; existing quarter tests unmodified. `routesMapConformance`: `parseMapLayer` and `parseMapDistrict` transcribed verbatim (F: `lib/frontend/map-service.ts:15-19,24-56,82-96`, helpers from F: `lib/frontend/stage-values.ts`) with self-checks; the real handlers for all four layers and for district (stored view, live build with populated geography, live build with empty geography Map) all parse; water feature count equals `body.features.length` with `partial` false. If 9.9 is reachable, a `district.test` case for the no-population branch.

### Task 2: the county gazetteer and `GET /api/locations/search`

**Build:** `lib/places.js`, pure, importing `lib/data/ncCounties.json` as `lib/geoContainment.js:13` does: `searchPlaces({query, state})`, `placeById(id)` per D4. Matching case-insensitive, whitespace and punctuation tolerant, optional trailing "County"/"Co.", exact first then prefix for queries of 2+ characters, at most 20 results (F: `explore-service.ts:67`). State `''`, `NC`, `N.C.`, `North Carolina` (any case) mean NC; any other non-empty state is `{candidates: []}`. Route: `requireUser`; validate `query` (trimmed, 1 to 80, no control characters) and `state` (0 to 40), else 400 field error; answer `{candidates}` bare, 200 when empty (F: `ExploreDiscovery.tsx:59`).

**Files:** `lib/places.js`, `app/api/locations/search/route.js`, `test/places.test.mjs`, `test/routesLocationsSearch.test.mjs`, one `ROUTE_COVERAGE` line.

**Acceptance:** `places.test`: exactly 100 counties, GEOIDs `37xxx`, unique ids; each found by exact name with and without "County" in any case; `placeById` round-trips, unknown/malformed id gives null; "Charlotte" and "28208" give `[]`; non-NC state gives `[]`; every candidate passes `validPlaces` transcribed verbatim (F: `explore-service.ts:8-9,66-67`); no U+2014. `routesLocationsSearch`: 401 without session; 400 for missing, blank or 81-character query, 41-character state, control characters; 200 `{candidates: []}` for no match; no database read and zero fetch calls; no `data` key.

### Task 3: migration 0022 and the area storage library (after B04 Task 1 merges)

```sql
create table if not exists public.explore_areas (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  place_id   text,
  place      text,
  state      text,
  label      text,
  timezone   text,
  revision   integer not null,
  updated_at timestamptz not null default now()
);
```

Constraints: `revision >= 2` (1 is the implicit never-saved state, D6); the five place columns null together or non-null together; each at most 300 characters with no control characters outside tab, LF, CR (mirroring F: `explore-service.ts:9`); RLS on, no policy, `revoke all ... from anon, authenticated`; idempotent re-run following 0020.

`lib/exploreArea.js`: `readArea(db, profileId)` gives `{place: null, revision: 1}` with no row; `writeArea(db, {profileId, expectedRevision, place})` gives `{ok, area}` or `{ok: false, reason: 'conflict', revision}` via the D6 compare-and-set; `isExploreAreaUnavailable` (42P01, PGRST205, as `lib/operations.js:67`) and a non-retryable 503 helper following `isLunaUnavailable`.

**Files:** the migration, `lib/exploreArea.js`, `test/exploreArea.test.mjs`, `test/exploreAreaSchema.test.mjs` (PGlite); edits to `test/helpers/tables.mjs`, `test/helpers/isolationSeed.mjs`, `test/rlsIsolation.test.mjs`, `test/haloTables.test.mjs`, `test/migrationBackout.test.mjs`; `docs/backend/YOUR_TODO.md` (apply steps and a tested `<!-- backout-0022 -->` block); `docs/backend/privacy-and-retention.md` ("chosen discovery area, county level, not the home address, deleted with the account, retention undecided").

**Acceptance:** 0022 applies over 0001 to 0021 and re-applies; CHECKs reject revision 1, a partial place, a 301-character label, a control character; profile delete cascades; two concurrent first inserts leave one row and the loser sees a unique violation; a stale-revision update touches zero rows. `exploreArea`: no-row read; expected 1 inserts 2; N updates to N+1; stale gives conflict with current revision; missing table detected. `rlsIsolation`: no privilege for `anon`/`authenticated`. `migrationBackout`: 0022 block runs and leaves 0021 intact.

### Task 4: `GET` and `PATCH /api/explore/area`

Makes the Explore area chooser live (F: `ExploreWorkspace.tsx:32,47`); its value feeds `opportunities.search`, `outreach.context`, `contacts.resolve` and Luna (F: `ExploreOpportunities.tsx:38,51`, `ProductionOutreach.tsx:26,40,57`, `LunaConversation.tsx:76`).

**Build:** `GET` returns `readArea` bare, never `pendingOperation` (D7). `PATCH` per D8 and D9: domain `'explore'`, kind `'explore.area.save'`, ledger input `{place, revision}` as sent; success returns the canonical `DiscoveryArea` with the post-write revision (F: `ExploreDiscovery.tsx:60`). Missing 0022 or 0017 is a non-retryable 503 decided before the ledger claim.

**Files:** `app/api/explore/area/route.js`, `test/routesExploreArea.test.mjs`, two `ROUTE_COVERAGE` lines.

**Acceptance:** with `validDiscoveryArea` transcribed verbatim (F: `explore-service.ts:68-69`): never-saved is exactly `{place: null, revision: 1}`; no `pendingOperation` even with a pending `explore` row seeded; 401 without session. Round trip: save at 1 gives 2 with canonical place and `GET` agrees; clear gives 3 with `place: null`; returned revision accepted as next `If-Match`. Validation 400 with ledger untouched: unknown key, missing `revision`, `revision` 0, 1.5 or `"2"`, non-object `place`, unknown `place.id`, `If-Match` differing from body, missing or non-UUID `Idempotency-Key`. Conflict: stale is 409 `reason: 'stale_revision'` with current revision; two PATCHes at the same revision with different keys give one 200 and one 409. Replay: same key and body gives the same body with no second write; same key different body is 409 `operation_mismatch`; replay after conflict is 409; **a seeded `failed` row with null result, and a seeded reaped row with `reason: 'abandoned'`, are each a 409 with an accurate reason, not 5xx and not `stale_revision` (D9)**; a pending row is the in-flight 5xx (documented as reaper-dependent). Ownership: A invisible to B; B's PATCH changes only B; a foreign `X-Halo-Home-Context` changes nothing. Unavailable: 0022 missing gives 503 `feature_unavailable` on both verbs with no ledger row. No `data` key, no U+2014.

### Task 5: `GET /api/map/comparison`

**Build:** `lib/mapComparison.js` (pure) `comparisonRecords(layer, features)` per D3. Water: `kind: 'Reported water result'`, `scope: 'Public water system'` (F: `copy/map-comparison.ts:55-56`, F2), `denominator: 'One reported result per compound and system, not an annual average.'`, `coverageLabel: 'Detection-only release. Complete testing coverage is unknown.'`, `backgroundUrl: 'https://www.epa.gov/dwucmr'`, `sourceUrl: null`; one value per regulated compound with the UI's labels (`PFOA`, `PFOS`, `PFHxS`, `PFNA`, `GenX` for `HFPO-DA`, F: `lib/frontend/map-preview.ts:5,7`), value only when `value_ppt` is a number else null, `unit: 'ppt'`, `observedAt` the reading's `date_iso`, `period` that sample's own date; no hazard index. Air: same rules with air copy (F: `copy/map-comparison.ts:44,55-60`), dominant pollutant, `unit: 'AQI'`, station reading time. Every record: `status: 'available'`, `coverage: 'partial'`, `method: null`, `sourceVersion: null`, `qualifier: 'unknown'`.

Route: same auth as `/api/map` (so Task 6 flips both); `layer` one of four; `quarter` via `parseMapQuarter`; `ids` a JSON array of 1 to 2,000 entries each passing the client's `key()` rule (F: `map-service.ts:18`). Data: water `latest` from the stored layer; water `YYYYQn` or no stored layer from `ucmr5_utilities` through `contaminantsInQuarter`/`assembleWaterFeatures` (W: `lib/mapBuild.js:28-35`) **with no geography fetch**; air from the stored layer only, else 503; facilities and radon `{records: []}` (F: `MapPreview.tsx:319`). Returns only requested ids that exist, `{records}` bare.

**Files:** `lib/mapComparison.js`, `app/api/map/comparison/route.js`, `test/mapComparison.test.mjs`, `test/routesMapComparison.test.mjs`, one `ROUTE_COVERAGE` line ("reads no household table").

**Acceptance:** the honesty test: `parseMapComparisons` and `compareEvidence` transcribed verbatim with helpers and reason copy (F: `map-service.ts:58-65`, `map-comparison-preview.ts:25-29,77-96`, `copy/map-comparison.ts:64-71`); for every fixture pair and compound `compatible === false` with method, source and qualifier reasons, so nothing renders `Aligned evidence` or `Limited comparison`. `mapComparison`: exact D3 values; water `scope` equals the copy literal; null `value_ppt` gives `value: null`, never 0; no hazard index; no U+2014. `routesMapComparison`: 400 for bad layer, bad quarter, `YYYYQn` on air, malformed JSON, non-array, 2,001 ids, non-string id, control character; unknown ids omitted; facilities and radon `{records: []}`; water `latest` with no stored layer answers from utilities; air with no stored layer is 503; tables read are a subset of `map_layers` and `ucmr5_utilities`; zero fetch calls; 401 without session (until Task 6); no `data` key.

### Task 6: public read for the map routes (GATED on Vibhav's yes to Open question 1)

BE-047's "separately reviewed read-only cache, abuse and quota policy". **Build:** `lib/publicAccess.js`: no `Authorization` header is anonymous; any `Authorization` header is `requireUser` exactly as today (an expired token stays 401, never downgraded). Anonymous requests to `/api/map`, `/api/district`, `/api/map/comparison` are cache-only: a stored layer, or a water quarter only when the geography cache is warm (a cache-only option on `getWaterGeo`), else 503, never an upstream fetch; district reads no `profiles` row and omits `household_county`. Abuse: per-client limiter in `lib/ratelimit.js` keyed by a digest of the forwarded client address (as `app/api/recovery/request/route.js`), 429 with `Retry-After`; anonymous responses carry a public shared-cache header, authenticated stay private. Limits, cache lifetime and fail-open are Vibhav's numbers (proposed: fail open, since cache-only reads cost no provider spend).

**Files:** `lib/publicAccess.js`, `lib/ratelimit.js`, `lib/waterGeo.js`, the three map routes, `test/routesMapPublic.test.mjs`, `test/routesMapDistrict.test.mjs` (the "missing session is a 401" cases change, listed before and after), `ROUTE_COVERAGE` notes.

**Acceptance:** anonymous stored-layer read deep-equals the authenticated body; anonymous with no stored layer is 503 with zero fetches; anonymous district touches no household table; malformed or expired bearer still 401; limiter deny path 429 with `Retry-After`; cache headers only on anonymous responses. CDN behaviour is a named-staging human check recorded in `YOUR_TODO.md`.

### Task 7: contracts, conformance, tracker, checkpoint (last)

`docs/backend/contracts/b05.openapi.json` and `fixtures/b05/`; `test/contractsB05.test.mjs` running the real handlers against verbatim validators (`validPlaces`, `validDiscoveryArea`, `parseMapComparisons`, `compareEvidence`, `parseMapLayer`, `parseMapDistrict`, each self-checked); cross-route agreement (a `locations.search` candidate saved through `PATCH` and read through `GET` is the same object on all three surfaces, and the save's revision is accepted as the next `If-Match`); no `data` key or U+2014; header documentation both ways. Tracker: BE-034, BE-035, UI-090, MP-260; HO-047 and AC-123 **partial** (incompatibility result only, alignment blocked on HO-074); BE-047 and AC-148 **blocked on decision** unless Task 6 ran; DS-016 and HO-074 respected, not closed. Checkpoint; regenerate `docs/backend/STATE.md` and re-measure the registry; add the Yogi items (9.3, 9.4, 9.7, F2, F3, F4, the D1 alternative) to `YOUR_TODO.md` Part 4.

## Open questions for Vibhav, tracked not worked around

1. **Public map access (D1).** Today the default `/map` shows no live data. (a) Approve Task 6's cache-only public read and set its numbers; (b) have Yogi reuse anonymous bootstrap on `/map` (permitted, no backend change, but an auth user per visitor); (c) keep `/map` owned-only and drop the public default. Recommended: (a).
2. **City and ZIP search (D4).** County-only works now. For city and ZIP: Census place-to-county and ZCTA relationship files (public domain, no budget, one reviewed data download; recommended), or Mapbox (needs the storage-rights answer, DS-016/HO-074, and a budget separate from onboarding's 500 a day).
3. **The comparison that never aligns (D3).** Confirm shipping it (recommended over the current false "Load this layer" message), and whether to acquire UCMR5 method, release and non-detect qualifiers (HO-074) so alignment is ever possible.
4. **Retention for `explore_areas` rows.**
5. **Migration 0022 hand-apply**, the fourth pending after 0019, 0020, 0021.
6. **For summaries, when planned:** per-version vs per-report `id` (digest 4.1), home-context precedence (9.7), and the order of the record-collections work (HO-076, HO-104).
7. **Organizations content.** Who writes and verifies it, and which set: the 13 NC-08 county-tagged organizations in `volunteer_orgs`, or the Charlotte organizations in the frontend fixture (they do not overlap, digest 8.4).
