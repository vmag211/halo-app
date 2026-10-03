# HALO Backend Working Specification (partial copy)

Version 1, October 3, 2026. Prepared for Vibhav to implement the expanded backend; Yogi retains frontend design ownership.

**Provenance and limitation.** This file is the portion of the working specification that was pasted into the 2026-10-03 Claude Code session. The paste was cut off partway through BE-032 (`/api/journal/retrospective`, "472 KB left"). **Not received yet:** BE-033 onward (rest of the route inventory, field and relationship tables, security, retention, rollout), all of DS (source acquisition), MP, UI, AC, ST, WF, AG, MA, VR and every feature packet (G01 to X07). This is a requirements document, not proof that anything exists. Where a package needs a missing section, the tracker marks the dependency and the work does not guess at the missing field tables. The authoritative full text is the original Markdown/PDF Vibhav holds.

Workflow rules from the orientation section that bind every session: work one dependency-bounded package (B01 to B12) at a time; keep a persistent tracker with a disposition for every ID; split compound requirements into testable child checks; code present is not test passed; HTTP 200 is not correct data semantics; a mock is not a live integration; end each session with a checkpoint (branch/commit, changed files, migrations, passing and failing commands, IDs completed, unresolved gates, next package); no production mutations, no external sends, no paid-provider stress tests, no secrets in fixtures; no em dashes in app-facing copy.

---

## Shared: Implementation order and delivery gates (HO)

HO-002 This is the entry point for implementing the added backend behind HALO's complete app plan. It connects all 45 planned feature groups to existing code, external sources, new owned records, jobs and acceptance gates. Yogi remains the frontend owner. No implementation, deployment, paid account changes or new visual approval is implied by these documents.

HO-003 Use this handoff with the Backend and Data Plan, Source Acquisition Guide, Master Plan, Frontend Build Plan and Feature Acceptance. The backend plan contains the 22-route baseline, proposed field requirements, relationships, transactions, security, retention and rollout requirements. This handoff adds source verification and an ordered implementation checklist; it does not replace those requirements with a shorter feature list.

HO-005 The application can be developed in connected stages using the existing Next.js and Supabase architecture. Shared actions, private tests, gardens, Plan, participation and reminders do not require a separate external data API for every screen. They require properly owned records and the evidence that actually applies to each record.

HO-006 External-source research identified working public samples for Open-Meteo, NWS, US Drought Monitor, openFDA food recalls, water-boundary metadata, ECHO query initialization, NC fish-advisory records and NC conservation-status records. Keyed providers, complete production imports, account rights and the deployed database still need the explicit gates below. No blanket promise of local food measurements, current advisories, full geographic coverage or production readiness is made.

HO-008 PFAS in food includes sampled findings, applicable official notices, fish advisories and private reports. No verified source here supports an all-products or all-farms PFAS safety lookup.

HO-009 Fish and conservation ArcGIS services are technically accessible. Fish sample inconsistencies prevent automatic health-guidance publication; conservation status requires separate utility instructions.

HO-010 Backend completeness includes migrations, security, jobs, source permissions, fixtures, error states and operational ownership, not just a set of successful GET responses.

HO-012 Keep Today as air, UV, pollen and mold. PFAS stays in Homeguard; lead is displayed but unscored. Preserve original Journal, summary, outreach, alerts, Learn and volunteer capabilities through relocation. Today and its existing factor detail pages are not to be substantially shortened. The immutable approved archives remain untouched. The proposed fourth tab is Plan, subject to the documented product decision; backend records must not depend on a tab label.

HO-013 Household categories describe presence, not a named person, diagnosis or exact age. Food advisory audiences are selected using the official definitions, not guessed from HALO's booleans. No completion state improves an environmental score. No text or animation can disguise a proxy or missing measurement. No app-facing em dashes.

HO-015 Source IDs refer to the Source Acquisition Guide. A User record uses S24. A row lists the additional work, not a claim that it already exists. All rows also inherit ownership, validation, missing-data, accessibility-supporting errors, export/deletion and source-provenance requirements.

### Backend implementation order

HO-063 These are build packages, not separate teams or additional owners. Each package delivers migrations, server schemas, pure logic tests, route tests, fixtures and operational notes. Keep the existing approved contracts compatible while adding fields or versioned routes.

**B01 Baseline and private identity**

HO-065 Read the installed Next.js guides and repository instructions before implementation. Audit the actual deployed schema, migration ledger and RLS read-only with authorized access. Do not infer a reproducible baseline from migrations that reference pre-existing tables. Capture a schema-only baseline without private rows or secret values.

HO-066 Harden date/coordinate/range validation, household transactionality, directory error states and authorization. Introduce home-context revisions and context-bound history/backfill. Decide optional recovery before valuable uploads. Extend retention/privacy disclosures before enabling sensitive input. Required test: two identities cannot read, mutate, link or export one another's nested records through either routes or direct authenticated database access.

**B02 Evidence and source operations**

HO-068 Create the registry, source runs, public evidence/revisions, content reviews, published pointers, thresholds and source events. Define parser interfaces, allowlisted bounded network acquisition, snapshot-retention policy and rollback. Build the reviewed-import path first so a source without a stable API still has a legitimate operation.

HO-069 A release has staging validation, completeness checks, units/geography/date validation, comparison with the prior release and atomic publication. Publish corrections/withdrawals as explicit revisions. Do not use a generic JSON blob as the sole schema for incompatible food, water, weather and private evidence.

**B03 Shared actions Plan and durable delivery**

HO-071 Create actions, recommendation dispositions, parent/child relations, occurrences, reminders, subscriptions, source events and outbox/delivery attempts. Saves return an authoritative record; retried requests resolve to the original write. Revision conflicts preserve the user's draft. Complete, skip, cancel, snooze and reopen have different effects.

HO-072 Implement a durable scheduler/worker compatible with the chosen hosting plan. The existing daily 11:00 UTC cron cannot satisfy a 15-minute reminder target. Jobs lease, retry, resume and reconcile; they recheck deletion/consent/context before private work. Fixed calendar recurrence and completion-relative recurrence need separate algorithms and DST tests. Push permission is not required for Plan or the inbox.

**B04 Existing evidence enrichment**

HO-074 Add source metadata to daily/history/home/map and score explanations without inventing factor /100 values. Fix or justify the null-precipitation assumption. Acquire and reconcile a complete UCMR release, retaining qualifiers and sampling context. Audit static radon, lead, boundary and district versions. Confirm Google Pollen and Mapbox storage rights before expanded persistence. Each provider can fail independently without generating healthy defaults.

**B05 Tests maintenance gardens and attachments**

HO-076 Add owned tests/results/revisions, assets, moisture observations and garden sites. Support source matrix, original units, qualifiers and confirmed transcription. Garden irrigation and household tap contexts are independent. Add optional interest preferences without changing required onboarding.

HO-077 Select private object storage, scanning and temporary-upload cleanup. Use upload intents, quarantine, finalize-to-owned-record, signed retrieval and complete deletion. Extraction is optional, never auto-confirmed. A failure can preserve an uninterpreted user record while blocking an unsafe derived comparison. Tie follow-up to B03 rather than inventing per-feature task stores.

**B06 Food advisories and grower resources**

HO-079 Implement separate FDA study, food recall, local notice and reviewed fish-rule record types. Start official NC fish ingestion as reviewed candidate records: retain raw discrepancies, full official source and review decision. A point or five-mile buffer is not the advisory extent. Resolve source reuse and exact audience/combined-limit semantics before personalized matching.

HO-080 Add advisory lookup/detail/version follow, private fish notes, reviewed lab/Extension/NRCS catalogue and grower inquiry records. Retain terminated recalls and withdrawn advisories as dated historical records. Do not turn a keyword search, empty response or local producer directory into a safety verdict. Every published card must support an actual applicability explanation and useful next action, not only an article link.

**B07 Water stewardship**

HO-082 Add USDM release ingestion and categorical regional history, NC utility status acquisition, PWSID crosswalk validation, separately reviewed utility instructions and subscriptions. Store optional user meter/bill readings with period, unit, context and method. Test cumulative-meter reset/rollover, gaps and unlike periods before displaying usage differences. Do not claim attributed water savings or prescribe irrigation from county drought.

**B08 Act and reporting workflows**

HO-084 Extend organizations, opportunities, event revisions, user participation and project templates. Add outreach draft snapshots and private observations, report export and official destination directory. Existing letter modes and edited drafts are preserved. No booking, message delivery, public incident map or agency write access is implied. Explicit user action is required to transmit content to an external recipient.

**B09 Forecasts and regional exploration**

HO-086 Implement per-factor forecast capability and period arrays, issue/valid times, source-specific maximum horizon and missing periods. Store an outdoor plan's selected interval and source references; watches flag material change without moving it. Air category-only forecasts and daily pollen stay at their native resolution.

HO-087 Extend map detail/filter/compare contracts and geographic release metadata, preserving unlocated records and last-good permitted data. The WQP sampling layer is optional and cannot block unrelated Map features. Source-backed area charts and accessible lists share the same records and counts as their visual map.

**B10 Journal analysis and seasonal summaries**

HO-089 Preserve existing entry workflows while adding revisions, protected retrospective batch saves, all-time first-use state and backfill readiness. Recompute descriptive findings only from eligible logged dates and comparable environmental series, with category-specific scope and transparent exclusions. Carry source/method and permitted retention into historical records. Align seasonal summaries with the same versioned analysis.

**B11 Learn Luna and cross feature integration**

HO-091 Version and review guidance/translations once, reuse it in factor pages, tasks, food/garden and Luna. Expose effective server capabilities and model-context consent before any private context leaves the app. Authorize selected records on the server, exclude Journal free text by default, and distinguish provider retention from local transcript storage.

HO-092 Luna proposals are structured previews; confirmation revalidates ownership, current source/applicability and proposal expiry, then commits once. Test malicious retrieved text, invented citations, source contradictions, prompt leakage, rate limits and duplicate confirmation. A model must not invent missing laboratory values or resolve disputed fish rules.

**B12 Release operations and handoff**

HO-094 Finish full export/deletion, storage cleanup, reauthentication/recovery, backup/restore, source outage drills, observability and cost limits. Record code/schema/source/guidance versions and enabled features. Test end-to-end journeys in isolated staging with disposable identities, not shared production household records. Give Yogi the actual contract/fixtures and integration status before connecting each frontend stage.

### Contracts the frontend needs

HO-096 Use the field and relationship tables in the backend plan as the baseline. Before implementing each package, check in a versioned OpenAPI or equivalent executable server schema and derive frontend types/test fixtures from it. Names below are proposed paths; if Vibhav chooses different names, update the shared contract before frontend integration. Do not leave two competing undocumented contracts.

| Surface | Proposed endpoints and minimum response additions |
| --- | --- |
| HO-098 Capabilities and coverage | GET /api/capabilities: contract version, enabled operations, per-domain/source coverage and horizon, effective locale and privacy choices, unavailable reasons. Do not expose operator configuration or secrets. |
| HO-099 Context and preferences | Home-context list/detail/transition; interests/preferences read and revisioned update. Return actual saved profile/context, match method and backfill state. |
| HO-100 Evidence and source detail | GET /api/evidence/:id, source list/detail and reviewed topic search/detail; return evidence revision, original/native values, scope, source dates, freshness, attribution and allowed uses. |
| HO-101 Conditions | Additive daily/history/home fields; GET /api/forecast and /api/changes. Return per-factor availability, supported granularity, source issue/valid dates, source basis and comparability reasons. |
| HO-102 Actions and recommendations | /api/actions, /api/actions/:id, occurrence completion/reopen/skip, recommendation dispositions and reminder operations. Return stable IDs, revision, canonical related IDs, allowed transitions and duplicate match. |
| HO-103 Plan and outdoor plans | GET /api/plan, outdoor-plan CRUD and watch operations. Keep unscheduled/all-day/timed items distinct, return date/timezone and per-source forecast limits; calendar export is one-way. |
| HO-104 Tests and maintenance | Test/result/correction, asset/maintenance and attachment intent/finalize/read/delete. Return original and normalized data, qualifier, workflow state, interpretation blocked reason and authorized signed download. |
| HO-105 Food and gardens | Advisory list/detail/match, food-report list/detail, garden CRUD, fish-note CRUD, grower resource/inquiry operations. Preserve kind, geography/audience/product scope, official action, current revision and coverage. |
| HO-106 Stewardship | Drought history and utility-conservation reads; water-use CRUD/comparison. Separate regional, official-rule and private measurement records. |
| HO-107 Act | Organizer/opportunity/project reads, participation CRUD, outreach draft/follow-up, private observation/report preview/export. Source status and user-reported status remain separate. |
| HO-108 Map | Extend existing layers/detail/quarter/compare/district reads; server-backed public record search and list pagination. Respond with the same record set, filtering definition and source versions used by the map. |
| HO-109 Journal | Extend existing entry/findings/retrospective/summary contracts; authoritative first-use/backfill status and per-date batch outcomes. Return analysis version and included/excluded denominators. |
| HO-110 Luna | Capabilities, questions with authorized context refs, bounded conversations/delete, proposal and explicit confirmation. Response citations bind claims to reviewed evidence. |
| HO-111 Alerts and subscriptions | Existing alert/preferences routes plus entity subscriptions, cursor pagination and exact unread total. Return effective channels, watch status and source event identity. |
| HO-112 Data controls | Owned export job/status/download/cancel, selective deletion, full deletion job/receipt and supported recovery/device flow. Return true completion/partial states, not optimistic success. |
| HO-113 Operators | Source acquisition/review/publication/withdrawal and job monitoring behind dedicated roles. Never expose service-role operations merely through a hidden frontend route. |

HO-115 For an evidence-backed value, the frontend needs the following fields or explicitly named equivalents:

HO-116 `id, revision, kind, source_id, source_record_id`; `native_value, native_unit, qualifier, detection_limit, reporting_limit`; `normalized_value, normalized_unit, conversion_version`; `sample_matrix, analyte_id, method, basis`; `observed_at OR sample_date, issued_at, valid_from, valid_to`; `published_at, retrieved_at, reviewed_at`; `scope_type, geometry_ref, geography_version, association_method`; `coverage, missing_reason, freshness, interpretation_version`; `source_locator, attribution, permitted_uses`.

HO-117 Fields not applicable to a domain are absent or explicitly null under its typed schema. They are never guessed to fill this template. Use separate typed envelopes for observations, forecasts, advisory rules, notices, guidance and private records. Evidence revisions are not mutable user tasks.

HO-118 List responses need items, stable pagination, applied filters, coverage, source versions and true empty/unavailable distinction. Mutations need an authoritative saved record and revision. Errors need a stable code, safe message, field errors, retryable flag and request ID; add Retry-After where applicable. Use 409 or a documented precondition response for stale revisions. Do not leak existence across owners when returning authorization failures.

HO-119 Each new form must have complete create/read/edit/delete/export rules, a retained draft on error, optional-field semantics, linked-record validation and a maximum payload size. A task with no date, a test with unknown units, or an advisory search with unknown species can be valid states; none authorizes a fabricated result.

### Source and schema mapping examples

HO-121 These are proposed mappings from inspected fields, not complete production parsers.

| Input | HALO normalized output | Required guard |
| --- | --- | --- |
| HO-123 USDM mapDate, fips, none, d0 to d4, statisticFormatID=2 | Regional release and mutually exclusive county area percentages | Preserve FIPS as string and categorical mode; do not use county maximum as a home class. |
| HO-124 NC conservation systemPWSID, conserveStatus, conserveReason, conserveDateEffective | Utility status evidence plus raw ID and validated federal-ID crosswalk | No fabricated restriction wording or matching solely by utility name. |
| HO-125 openFDA recall_number, product/code/distribution fields, lifecycle dates/status | Food recall revision with specific applicability | Firm state is not distribution; terminated historical record cannot trigger a current recall alarm. |
| HO-126 NC fish Popultn, MlsAllw, Advisory, Site | Unpublished candidate requiring full-document review | Contradiction, truncation or missing extent blocks automatic personalized advice. |
| HO-127 User lab report and entered value | Owned report plus separately verified transcription revision | Verification confirms transcription, not laboratory authenticity; uncertain matrix/unit blocks comparison. |
| HO-128 Current environmental source with missing date | Record with unknown observation time and real retrieval time | Do not label as observed just now or merge into a dated trend without a reviewed basis. |

### Completion tests for the added backend

HO-130 Build tests alongside each package, not as an end-of-project manual check. Required scenario groups are:

HO-131 1. Identity and authorization: no foreign ID linking, no public/private cache mixing, no service-role bypass in nested reads, invalid/expired sessions preserve drafts and do not create replacement identities silently during a write.

HO-132 2. Source acquisition: missing key, 401/403, quota/429, timeout, malformed 200, partial pagination, duplicate row, source schema change, revised release, empty-but-unexpected result and revoked source rights.

HO-133 3. Scientific meaning: unknown versus zero/nondetect, differing units/matrices, unavailable method, forecast versus observation, model versus monitor, advisory conflict, date-only records and explicitly incomparable history.

HO-134 4. Concurrency: repeated create key, same key with different payload, two tabs editing, out-of-order refresh, two recurrence workers, interrupted publication/fanout, stale Luna proposal and duplicate confirmation.

HO-135 5. Calendar and reminders: DST gaps/folds, user timezone change, all-day dates, late completion, skipped occurrence, cancelled event, expired forecast watch, quiet hours and delayed push. Test with a controlled clock rather than real waiting.

HO-136 6. Attachments: claimed versus actual type, oversized upload, malware/scan failure, abandoned upload, foreign attachment link, expired URL, extraction disagreement, metadata leakage and original/derivative deletion.

HO-137 7. Lifecycle: source correction/withdrawal, advisory supersession, event reschedule/cancellation, house move, category deselection, test correction, record deletion and consent revocation while jobs are queued.

HO-138 8. Food and agriculture: product/lot mismatch, broad distribution, ambiguous fish species, overlapping advisory rules, conflicting raw audience/limit, missing effective status, unrelated garden water source and unsupported crop-safety request.

HO-139 9. Operational recovery: worker crash/retry, cache loss, source unavailable, quota ceiling, failed export, partial delete, restore with deletion replay and source-parser rollback.

HO-140 10. Full connected journeys: save guidance to Plan; schedule test and record result; follow fish advisory revision; inspect applicable food recall and prepare a question; create garden site and lab inquiry; compare drought releases and record usage; save event and handle cancellation; prepare official observation report; Journal edit recomputes eligible analysis; Luna confirmed proposal saves exactly once.

HO-141 No external registration, message send, agency submission, shared-production delete or paid-provider stress test belongs in automated tests without a specifically authorized isolated setup. Stress tests use fixtures and isolated local/staging services first.

### Open decisions with explicit closure evidence

| Gate | Required closure before dependent release |
| --- | --- |
| HO-144 Google Pollen retention and map rights | Confirm applicable agreement and enforce distinct expiry classes. Current non-EEA terms allow today's forecast values for 365 days, other forecast/heatmap values for 24 hours; see S04. Review exports/derived/model uses and map restrictions. Audit existing data without destructive planning changes. |
| HO-145 Mapbox persistence | Confirm the actual account/version storage entitlement; use an appropriate permanent-storage request/plan if required. Rounding alone is not a resolution. |
| HO-146 Keyed provider configuration | Redacted account-level success and quota/billing checks for AirNow, Google Pollen and optional OpenUV; no secrets in fixtures. |
| HO-147 Source imports | Complete UCMR release/dictionary mapping and count reconciliation; reviewed radon/lead/geography versions; no arbitrary sample treated as complete coverage. |
| HO-148 Fish rules | Resolve contradictory/truncated sample fields against full official source, verify current status/extent and source reuse, then test all supported audience/species combinations. |
| HO-149 Food studies and local notices | Real reviewed study rows and notice scope, exact source/table locators and a defined supported region. No suitable local evidence returns unavailable, not safe. |
| HO-150 Utility conservation | Confirm acquisition rights/cadence, PWSID crosswalk and official local restriction instructions. Status alone cannot generate detailed rules. |
| HO-151 WQP extension | Select/version supported profile, acquire a real filtered result fixture and prove required matrix/method/limit fields. Optional layer stays conditional otherwise. |
| HO-152 Scores and interpretation | Review factor /100 meaning, contribution semantics, proxy handling, threshold effective status and expanded health guidance. Native measures remain the truthful fallback. |
| HO-153 Platform and budget | Choose and verify scheduler, private storage/scanning, recovery mechanism, retention periods, source review capacity and actual cost limits. |
| HO-154 Deployment baseline | Authorized schema/RLS/config audit and isolated migration/restore tests. Do not apply speculative migrations to unknown production state. |
| HO-155 New visuals | Yogi's review remains necessary for new pages. Backend implementation does not grant permission to replace approved frontend geometry or archives. |

HO-156 These gates are work to complete, not reasons to delete planned functionality or claims that permission has already been granted. If a gate cannot be resolved, document the precise affected promise and obtain a product decision about its fallback before marking that feature complete.

### What Vibhav should return for frontend integration

HO-158 For every completed build package, provide:

HO-159 Migration identifiers and safe rollout/backfill/rollback instructions.

HO-160 Versioned executable API schema, generated or validated frontend types and documented compatibility changes.

HO-161 Representative success, partial, empty, unavailable, stale, conflict and unauthenticated fixtures with no real private data.

HO-162 Source manifest with verified request/coverage/rights, parser tests, reviewed interpretation and actual refresh policy.

HO-163 Endpoint and job test results, RLS isolation results, cost limits and source freshness monitoring.

HO-164 Enabled feature/capability list and any remaining source/operation blockers.

HO-165 A staging demonstration of the complete connected journey, including reload persistence and failure recovery.

HO-166 The frontend can then integrate against explicit contracts instead of guessing source semantics. Calling the package ready for integration does not mean every data source or feature in the entire app has shipped.

HO-168 This documentation and its verification tools were saved locally in the existing repository. This task does not itself create a PR, push a branch, contact Vibhav, alter approved archives or implement backend routes. Preserve the unrelated map work in the current working tree.

---

## Shared: Backend database and operations (BE), received through BE-032

BE-002 This document defines the proposed backend and data target for HALO's full product plan. Each interface has a credible source, a complete action workflow, and an explicit implementation boundary.

BE-003 Version 1.2, October 3, 2026. This is the proposed full-app backend target and implementation specification, not implemented functionality, verified deployment readiness, or approval of new visuals. Existing capability statements below describe inspected repository code, not an assertion that every provider, migration, credential, or scheduled job is configured in production. No existing feature is removed by this plan. Endpoint and table names introduced here are proposals; implementation may consolidate them without losing their behavior.

BE-004 Start implementation with the Backend Build Handoff (HO). The Source Acquisition Guide (DS) adds exact acquisition paths, inspected field mappings, permissions and unresolved source-specific constraints. Its verification report records fourteen public sample requests, not production validation.

BE-006 Extend the existing Next.js application and Supabase database rather than introducing a service for each feature. Shared evidence, saved actions, source references, and reminder delivery should connect the product. Public source ingestion is separate from household-owned records. A new food advisory, household test, conservation event, and daily air reading are different evidence types, not interchangeable inputs to a universal safety score.

BE-007 The central connection is an immutable reference to evidence plus a mutable household action. A user can save a recommendation from Today, Homeguard, Act, Food and Garden, Map, or Luna and manage that same action in Plan. Completing it changes task state, not the environmental measurement or medical interpretation.

BE-008 Public data may be cached and reused across nearby households where the source's resolution permits it. Private notes, household composition, appointments, test attachments, and check-ins never enter public map layers or shared provider caches.

Existing backend baseline (inspected implementation, implication for the target):

BE-011 Identity and household: anonymous Supabase sessions, verified API identity, seven presence categories, profile home details. Reuse ownership and low-friction onboarding. Recovery of a rejected session currently creates a new anonymous identity; it does not recover the old household's records.

BE-012 Today: daily readings, source-specific failure handling, score, factor severities, household wording, saved history. Extend observation metadata and forecasts. Do not rebuild the current daily pipeline as a separate feature.

BE-013 Homeguard: water contaminant detail, county radon estimate, lead building-era estimate, private-water testing guidance, deterministic action recommendations. Add saved records and follow-through while retaining all existing source distinctions.

BE-014 Journal: entries by date and household category, history, retrospective entries, findings, season summaries. Preserve these capabilities and correct comparison semantics before presenting stronger patterns.

BE-015 Map: cached water, radon, air monitor, facilities, and district layers. Reuse data and geography. Map is not currently a continuous contamination measurement surface.

BE-016 Act: public organization directory, cause and county matching. Extend into opportunities and participation. An organization entry is not an event feed.

BE-017 Luna: curated-source retrieval, cited answers, household context, diagnostic refusal, rate limits. Add explicit privacy capabilities, selected-record context, conversation handling, and confirmed action proposals.

BE-018 Notifications: alert inbox, read/dismiss handling, five preference groups, browser push, deduplication. Extend entity subscriptions and scheduled reminders instead of creating a second notification stack.

BE-019 Account deletion: verified-session deletion through the auth user with database cascades. Extend coverage to every new table, attachment, conversation record, and queued job.

BE-020 The current migrations assume some original tables already exist, including profiles, daily_scores, home_risks, and ucmr5_utilities. Before new migrations, capture and review the actual database schema and policies. The files in supabase/migrations alone must not be assumed to constitute a complete fresh-install baseline.

Current route inventory (22 route files under app/api; every household route calls the verified-bearer-token helper; public-reference responses still require a session at the route even where database read policies allow public reference access; the daily job instead requires its scheduler secret):

BE-024 /api/onboard POST: address, optional water_source, home_year, request_id; geocodes, matches service area, stores approximate location, returns location/utility and request marker, starts 28-day history backfill. Session supplies owner; legacy profile_id must match. Preserve request-outcome reconciliation. Current request_id is a stored marker, not a full idempotency transaction.

BE-025 /api/profile GET and PATCH: reads onboarding flags, home/profile and seven household booleans; PATCH accepts water_source and/or home_year. Keep existing field names and null behavior. Renter and locale writes currently belong to household PUT, not profile PATCH.

BE-026 /api/household GET and PUT: reads composition, renter mode and locale; PUT replaces the seven booleans and optionally writes renter_mode, locale. Omitted booleans become false. Preserve full replacement or add an explicitly separate partial-update contract. Current bands/preferences writes are not one transaction.

BE-027 /api/daily-score GET: optional lat, lng, fresh=1, legacy matching profile_id; returns air, uv, pollen, mold, score, retrieved_at, cached. Other-point lookup does not write home history. Current own-location cache lasts one hour and provider refresh is limited per household. Extend source times without renaming current fields.

BE-028 /api/home-guard GET: profile defaults with county, utility, water-source and home-year overrides; returns radon, water, score, lead, action_plan, breakdown, assembled_at. Overrides allow public context exploration; do not expose another household's private tests through them. Keep private-water/no-match/lookup-failed distinctions.

BE-029 /api/history GET: days defaults to 90 and is capped at 365 when used, or from, to; newest stored row per household date becomes a history point. Owner scoped. Explicit ranges currently need stronger validation/bounds. Add retained source/basis metadata before richer comparisons.

BE-030 /api/journal GET, POST and DELETE: GET date range; POST whole date/category record: entry_date, band, symptoms, severity, note, retrospective, possibly_illness; DELETE id or all=true. Unique date/category upsert. Preserve all fields during edit or Undo. DELETE returns actual row count. New revision checking must coexist with legacy upsert.

BE-031 /api/journal/findings GET: current household-level 90-day analysis and readiness/counts. No current category-filter contract. New category analysis must compute scoped findings, not relabel existing results.

BE-032 /api/journal/retrospective POST: (text cut off in the received paste; the remainder of the route inventory and everything after it was not received.)
