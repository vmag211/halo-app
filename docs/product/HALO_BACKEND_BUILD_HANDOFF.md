# HALO Backend Build Handoff

Latest October 3 reconciliation: read [Today and Homeguard Backend Supplement](HALO_TODAY_HOMEGUARD_BACKEND_SUPPLEMENT.md) with the complete original working specification. It consolidates later kitchen, timeline, record lifecycle, Plan and summary details, credits work already on the current backend branch, and documents concrete frontend adapter risks. It does not replace the original 45-feature specification or declare deployment complete.

Prepared for Vibhav on October 3, 2026. This is the entry point for implementing the added backend behind HALO's complete app plan. It connects all 45 planned feature groups to existing code, external sources, new owned records, jobs and acceptance gates. Yogi remains the frontend owner. No implementation, deployment, paid account changes or new visual approval is implied by these documents.

Use this handoff with the [Backend and Data Plan](HALO_BACKEND_AND_DATA_PLAN.md), [Source Acquisition Guide](HALO_SOURCE_ACQUISITION_GUIDE.md), [Master Plan](HALO_MASTER_PLAN.md), [Frontend Build Plan](HALO_FRONTEND_BUILD_PLAN.md) and [Feature Acceptance](HALO_FEATURE_ACCEPTANCE.md). The backend plan contains the 22-route baseline, proposed field requirements, relationships, transactions, security, retention and rollout requirements. This handoff adds source verification and an ordered implementation checklist; it does not replace those requirements with a shorter feature list.

**Later October 3 addition, after the compiled packet was handed off:** reconcile the [Homeguard integration delta](HALO_BACKEND_AND_DATA_PLAN.md#october-3-homeguard-integration-delta) before wiring the revised screens. It adds owned fridge/pantry records and catalogue/matching boundaries for PFAS and lead, explicit per-stage test progress evidence and canonical follow-up links. The animated Luna timeline and preferred locally generated PDF do not require a new AI service or export worker. The historical compiled Markdown/PDF and coverage manifest remain unchanged; they do not yet incorporate this delta.

**Further food evidence revision:** read [Food evidence and kitchen integration](HALO_FOOD_EVIDENCE_EXTENSION.md) alongside that delta. It adds exact acquisition paths for a broad food catalogue, optional product photos/barcodes, reviewed FDA food chemistry, evidence-match contracts and an explicit boundary against unvalidated item-level estimates. This addendum is not included in the historical compiled packet either.

## What can be built and what is still conditional

The application can be developed in connected stages using the existing Next.js and Supabase architecture. Shared actions, private tests, gardens, Plan, participation and reminders do not require a separate external data API for every screen. They require properly owned records and the evidence that actually applies to each record.

External-source research identified working public samples for Open-Meteo, NWS, US Drought Monitor, openFDA food recalls, water-boundary metadata, ECHO query initialization, NC fish-advisory records and NC conservation-status records. [Verification details](verification/SOURCE_CHECKS_2026-10-03.md) are limited to those checks. Keyed providers, complete production imports, account rights and the deployed database still need the explicit gates below. No blanket promise of local food measurements, current advisories, full geographic coverage or production readiness is made.

Three especially important distinctions:

- PFAS in food includes sampled findings, applicable official notices, fish advisories and private reports. No verified source here supports an all-products or all-farms PFAS safety lookup.
- Fish and conservation ArcGIS services are technically accessible. Fish sample inconsistencies prevent automatic health-guidance publication; conservation status requires separate utility instructions.
- Backend completeness includes migrations, security, jobs, source permissions, fixtures, error states and operational ownership, not just a set of successful GET responses.

## Rules that must survive the expansion

Keep Today as air, UV, pollen and mold. PFAS stays in Homeguard; lead is displayed but unscored. Preserve original Journal, summary, outreach, alerts, Learn and volunteer capabilities through relocation. Today and its existing factor detail pages are not to be substantially shortened. The immutable approved archives remain untouched. The proposed fourth tab is Plan, subject to the documented product decision; backend records must not depend on a tab label.

Household categories describe presence, not a named person, diagnosis or exact age. Food advisory audiences are selected using the official definitions, not guessed from HALO's booleans. No completion state improves an environmental score. No text or animation can disguise a proxy or missing measurement. No app-facing em dashes.

## Feature to backend coverage matrix

Source IDs refer to the [Source Acquisition Guide](HALO_SOURCE_ACQUISITION_GUIDE.md). A User record uses S24. A row lists the additional work, not a claim that it already exists. All rows also inherit ownership, validation, missing-data, accessibility-supporting errors, export/deletion and source-provenance requirements.

| Feature | Evidence and existing foundation | Added backend and required proof |
| --- | --- | --- |
| G01 Entry and household setup | S07 S23 S24; onboard/profile/household | Atomic home-context transition, reliable household read/write, context-bound backfill, civic anonymous entry, recoverable request outcomes. Prove failed utility match cannot retain the previous home's utility. |
| T01 Today overview | S01 S02 S03 S04 S05; daily/history | Evidence times and scope, coverage, method version, compatible-change response, truthful score/contribution semantics, linked action summary. No invented factor score. |
| T02 Air quality | S01 S02; daily/history/map | Pollutant/area/station distinctions, permitted history, forecast intervals, source-basis comparison, Map and Plan evidence links. Test area maxima versus station data. |
| T03 UV | S02 S05; UV window/history | Hourly periods and gaps, actual valid times and peak-window basis, preparation actions. Test all-low, all-missing and incomplete windows separately. |
| T04 Pollen | S04; three existing types | Actual daily forecast horizon, type-specific series and permissions for retained history/exports. Resolve Google storage/display gate before expansion. |
| T05 Mold and moisture | S03 S22 S24; proxy/Learn | Reviewed proxy inputs/version, missing-value handling, private room humidity/leak records and follow-up. No spore or image-diagnosis claim. |
| T06 Today household guidance | Conditions plus household/Learn | Multiple applicable reviewed notes, evidence binding, deterministic priority and canonical action dedupe. Category changes cannot alter measurements. |
| H01 Homeguard overview | S06 S07 S08 S09; home-guard | Coverage explanation plus owned tests/actions/maintenance summaries. Private-water no result cannot become a healthy reading. |
| H02 Water and PFAS | S06 S07 S22; water evidence | Complete sample/provenance import, analyte aliases, tested/nondetect coverage, threshold versions, subscriptions, utility correction and private-well workflow. |
| H03 Radon | S08 S22 S24; county zone | Owned test timeline, collection duration/method/unit, confirmed transcription and reviewed follow-up; pending-test reminders respect real records. |
| H04 Lead and plumbing | S09 S22 S24; year estimate | Versioned inventory, property-specific document records, separate water sample evidence, home-year correction and outreach. No address material inferred from totals. |
| H05 Home household guidance | Household/home/Learn | Selected-category applicability with related owned tasks/tests; no named-person database. Removed-category links return general guidance without deleting history. |
| H06 Tests and records | S18 S22 S24 | Structured tests/results, correction revisions, private attachments, quarantine/scan, interpretation gates and export/delete. Unknown units allow uninterpreted storage, not comparison. |
| H07 Maintenance and moisture | S22 S24; action templates | Assets, meter/room observations, recurrence mode, completion records, instructions and shared Plan actions. No inferred filter efficacy. |
| H08 Household summary | Existing daily/home/household | Authorized selected record composition, omissions manifest, local or short-lived private export, sensitive-field preview. No default public URL. |
| F01 Food and Garden hub | S12 S13 S14 S16 S17 S18 S19 | Optional interest preferences, coverage-aware summary, saved records and links. General use works without a site or consumption log. |
| F02 Fish and waterways | S13 S22 S24 | Reviewed full advisory rules, waterbody/species/audience lookup, overlapping rules, version watches; optional private catch/consumption CRUD. Quarantine conflicting raw fields. |
| F03 Garden workspace | S18 S22 S24, applicable S17 | Private sites, independent irrigation context, tests/observations, known/unknown summary and advice preparation. Old samples keep their original site/source version. |
| F04 Food evidence and notices | S12 S14 S22, applicable S13 | Separate study/sample/recall/local-notice records, scope matching, update/termination states, source-linked action and optional private report. No fabricated local food score. |
| F05 Grower support | S18 S19 S22 S24 | Reviewed service/programme catalogue, eligibility and source revisions, inquiry/checklist/reference records, test and follow-up links. No grant or lab booking promise. |
| F06 Water stewardship | S16 S17 S24 | Categorical county history, utility crosswalk/status and reviewed restriction text, subscriptions and optional meter/bill usage records. Compare compatible periods only. |
| A01 Act overview | Existing volunteer/map/home/district | Reviewed deterministic recommendations, relevant opportunities/projects and saved participation summary. Do not create a second task system. |
| A02 Organizations | S20; volunteer directory | Stable reviewed organizer IDs, service areas, reporting-outdated flow and archived state; distinguish query failure from no matching organizations. |
| A03 Opportunities | S20 S24 | Versioned event catalogue, filters, cancellations, participation lifecycle, Plan link and reminder. Opening registration is not registration. |
| A04 Guided projects | S19 S20 S21 S22 S24 | Reviewed project templates, prerequisites/safety, shared parent/child actions, progress and follow-up. No unmeasured cleanup or health benefit totals. |
| A05 Outreach | Public evidence plus existing recipient modes | Versioned source-bound drafts, independent recipient edits, optional private saved drafts with retention choice, user-reported sent/reply and Plan follow-up. No automatic send. |
| A06 Field observations | S21 S24 | Private factual observations/photos, precise/coarse location choice, sanitized reporting preview/export and external handoff states. No public contamination feed. |
| M01 Map shell | S07 S10 S11 S23; map route | Production layer capability/coverage, query bounds, selection lookup, accessible list pagination, source dates and safe public cache. Preview geometry is not deployment proof. |
| M02 Water map | S06 S07; water layer | Sample quarter/detail/query contracts, non-detect/tested metadata, per-compound coverage, utility boundary/source distinction and follows. Density is not exposure. |
| M03 Other map layers | S01 S08 S10 S11; optional S13 S15 S16 | Layer-specific evidence, CRS/geometry checks, facility labels, station dates and honest failure. Optional sample/advisory overlays remain gated. |
| M04 Public comparison | Published normalized evidence | Comparable analyte/unit/matrix/method/time rules and an explicit incompatibility result. Missing cannot rank as best. |
| M05 District evidence | S06 S07 S10 S11; district view | Versioned geometry/aggregates, defined mapped/tested denominators and partial-population flags, public export with no household fields. |
| P01 Your Week | S24; shared actions | Bounded agenda/unscheduled reads, occurrences, timezone handling, filters, one-way calendar export and canonical records. Cancellation updates every view. |
| P02 Shared actions | S22 S24; current recommendations | Action CRUD, recommendation dispositions, versioned evidence, idempotency, conflicts, lifecycle, parent steps, occurrence and reminder transactions. |
| P03 Outdoor planning | S01 S02 S03 S04 S24 | Normalized per-factor forecast capability, planning location/context, chosen interval, preparation tasks, optional expiring change watch. Never auto-reschedule. |
| P04 Journal | S24; journal/history/retrospective | Real date/vocabulary validation, all-time first-use read, safe whole-entry revisions, create-if-absent batch and per-date outcomes, backfill status. |
| P05 Patterns and history | Authorized Journal plus permitted history | Versioned logged-day denominator/category analysis, acquisition-basis exclusions, counts and insufficient-evidence state. No causal or clinical claims. |
| P06 Seasonal review | Existing summary plus S24 | Consistent analysis version and owned action/test/participation joins; season identity, dismissals and summary deep links. Separate activity from measured change. |
| X01 Learn and sources | S22 plus selected evidence | Reviewed topic index/search, locale/version, contextual source bindings, source detail and withdrawn/unavailable states. No arbitrary web search required. |
| X02 Luna | Existing assistant/RAG plus S24 | Effective capabilities/consent, authorized selected-record context, bounded conversation, deletion and single-use confirmed action proposals. Verify corpus rights and citation support. |
| X03 Alerts and watches | Existing alerts/push, applicable sources | Entity subscriptions, channel-specific preference migration, durable source events/outbox, retries/quiet hours/expiry and correct unread pagination/count. |
| X04 Settings | Existing profile/household/preferences | Atomic revisioned edits, interests/new feature preferences, locale and home transition, truthful data/export/delete/recovery controls. No invisible loss of categories. |
| X05 Privacy and recovery | S24; auth/account | Supported optional recovery, file/row/job deletion orchestration, export manifests, retention and restore drills. Anonymous session replacement is not recovery. |
| X06 Accessibility and offline | Existing frontend caches plus S24 | Identity-scoped permitted caches, explicit stale states, idempotent draft replay if enabled, bounded payloads and safe service-worker policy. No silent sensitive offline storage. |
| X07 Source operations | All enabled external sources | Operator roles, registry, acquisition/review/publication, translations, source health, bounded resumable jobs, spend controls, rollback and correction delivery. |

## Backend implementation order

These are build packages, not separate teams or additional owners. Each package delivers migrations, server schemas, pure logic tests, route tests, fixtures and operational notes. Keep the existing approved contracts compatible while adding fields or versioned routes.

### B01 Baseline and private identity

Read the installed Next.js guides and repository instructions before implementation. Audit the actual deployed schema, migration ledger and RLS read-only with authorized access. Do not infer a reproducible baseline from migrations that reference pre-existing tables. Capture a schema-only baseline without private rows or secret values.

Harden date/coordinate/range validation, household transactionality, directory error states and authorization. Introduce home-context revisions and context-bound history/backfill. Decide optional recovery before valuable uploads. Extend retention/privacy disclosures before enabling sensitive input. Required test: two identities cannot read, mutate, link or export one another's nested records through either routes or direct authenticated database access.

### B02 Evidence and source operations

Create the registry, source runs, public evidence/revisions, content reviews, published pointers, thresholds and source events. Define parser interfaces, allowlisted bounded network acquisition, snapshot-retention policy and rollback. Build the reviewed-import path first so a source without a stable API still has a legitimate operation.

A release has staging validation, completeness checks, units/geography/date validation, comparison with the prior release and atomic publication. Publish corrections/withdrawals as explicit revisions. Do not use a generic JSON blob as the sole schema for incompatible food, water, weather and private evidence.

### B03 Shared actions Plan and durable delivery

Create actions, recommendation dispositions, parent/child relations, occurrences, reminders, subscriptions, source events and outbox/delivery attempts. Saves return an authoritative record; retried requests resolve to the original write. Revision conflicts preserve the user's draft. Complete, skip, cancel, snooze and reopen have different effects.

Implement a durable scheduler/worker compatible with the chosen hosting plan. The existing daily 11:00 UTC cron cannot satisfy a 15-minute reminder target. Jobs lease, retry, resume and reconcile; they recheck deletion/consent/context before private work. Fixed calendar recurrence and completion-relative recurrence need separate algorithms and DST tests. Push permission is not required for Plan or the inbox.

### B04 Existing evidence enrichment

Add source metadata to daily/history/home/map and score explanations without inventing factor `/100` values. Fix or justify the null-precipitation assumption. Acquire and reconcile a complete UCMR release, retaining qualifiers and sampling context. Audit static radon, lead, boundary and district versions. Confirm Google Pollen and Mapbox storage rights before expanded persistence. Each provider can fail independently without generating healthy defaults.

### B05 Tests maintenance gardens and attachments

Add owned tests/results/revisions, assets, moisture observations and garden sites. Support source matrix, original units, qualifiers and confirmed transcription. Garden irrigation and household tap contexts are independent. Add optional interest preferences without changing required onboarding.

Select private object storage, scanning and temporary-upload cleanup. Use upload intents, quarantine, finalize-to-owned-record, signed retrieval and complete deletion. Extraction is optional, never auto-confirmed. A failure can preserve an uninterpreted user record while blocking an unsafe derived comparison. Tie follow-up to B03 rather than inventing per-feature task stores.

### B06 Food advisories and grower resources

Implement separate FDA study, food recall, local notice and reviewed fish-rule record types. Start official NC fish ingestion as reviewed candidate records: retain raw discrepancies, full official source and review decision. A point or five-mile buffer is not the advisory extent. Resolve source reuse and exact audience/combined-limit semantics before personalized matching.

Add advisory lookup/detail/version follow, private fish notes, reviewed lab/Extension/NRCS catalogue and grower inquiry records. Retain terminated recalls and withdrawn advisories as dated historical records. Do not turn a keyword search, empty response or local producer directory into a safety verdict. Every published card must support an actual applicability explanation and useful next action, not only an article link.

### B07 Water stewardship

Add USDM release ingestion and categorical regional history, NC utility status acquisition, PWSID crosswalk validation, separately reviewed utility instructions and subscriptions. Store optional user meter/bill readings with period, unit, context and method. Test cumulative-meter reset/rollover, gaps and unlike periods before displaying usage differences. Do not claim attributed water savings or prescribe irrigation from county drought.

### B08 Act and reporting workflows

Extend organizations, opportunities, event revisions, user participation and project templates. Add outreach draft snapshots and private observations, report export and official destination directory. Existing letter modes and edited drafts are preserved. No booking, message delivery, public incident map or agency write access is implied. Explicit user action is required to transmit content to an external recipient.

### B09 Forecasts and regional exploration

Implement per-factor forecast capability and period arrays, issue/valid times, source-specific maximum horizon and missing periods. Store an outdoor plan's selected interval and source references; watches flag material change without moving it. Air category-only forecasts and daily pollen stay at their native resolution.

Extend map detail/filter/compare contracts and geographic release metadata, preserving unlocated records and last-good permitted data. The WQP sampling layer is optional and cannot block unrelated Map features. Source-backed area charts and accessible lists share the same records and counts as their visual map.

### B10 Journal analysis and seasonal summaries

Preserve existing entry workflows while adding revisions, protected retrospective batch saves, all-time first-use state and backfill readiness. Recompute descriptive findings only from eligible logged dates and comparable environmental series, with category-specific scope and transparent exclusions. Carry source/method and permitted retention into historical records. Align seasonal summaries with the same versioned analysis.

### B11 Learn Luna and cross feature integration

Version and review guidance/translations once, reuse it in factor pages, tasks, food/garden and Luna. Expose effective server capabilities and model-context consent before any private context leaves the app. Authorize selected records on the server, exclude Journal free text by default, and distinguish provider retention from local transcript storage.

Luna proposals are structured previews; confirmation revalidates ownership, current source/applicability and proposal expiry, then commits once. Test malicious retrieved text, invented citations, source contradictions, prompt leakage, rate limits and duplicate confirmation. A model must not invent missing laboratory values or resolve disputed fish rules.

### B12 Release operations and handoff

Finish full export/deletion, storage cleanup, reauthentication/recovery, backup/restore, source outage drills, observability and cost limits. Record code/schema/source/guidance versions and enabled features. Test end-to-end journeys in isolated staging with disposable identities, not shared production household records. Give Yogi the actual contract/fixtures and integration status before connecting each frontend stage.

## Contracts the frontend needs

Use the field and relationship tables in the backend plan as the baseline. Before implementing each package, check in a versioned OpenAPI or equivalent executable server schema and derive frontend types/test fixtures from it. Names below are proposed paths; if Vibhav chooses different names, update the shared contract before frontend integration. Do not leave two competing undocumented contracts.

| Surface | Proposed endpoints and minimum response additions |
| --- | --- |
| Capabilities and coverage | `GET /api/capabilities`: contract version, enabled operations, per-domain/source coverage and horizon, effective locale and privacy choices, unavailable reasons. Do not expose operator configuration or secrets. |
| Context and preferences | Home-context list/detail/transition; interests/preferences read and revisioned update. Return actual saved profile/context, match method and backfill state. |
| Evidence and source detail | `GET /api/evidence/:id`, source list/detail and reviewed topic search/detail; return evidence revision, original/native values, scope, source dates, freshness, attribution and allowed uses. |
| Conditions | Additive daily/history/home fields; `GET /api/forecast` and `/api/changes`. Return per-factor availability, supported granularity, source issue/valid dates, source basis and comparability reasons. |
| Actions and recommendations | `/api/actions`, `/api/actions/:id`, occurrence completion/reopen/skip, recommendation dispositions and reminder operations. Return stable IDs, revision, canonical related IDs, allowed transitions and duplicate match. |
| Plan and outdoor plans | `GET /api/plan`, outdoor-plan CRUD and watch operations. Keep unscheduled/all-day/timed items distinct, return date/timezone and per-source forecast limits; calendar export is one-way. |
| Tests and maintenance | Test/result/correction, asset/maintenance and attachment intent/finalize/read/delete. Return original and normalized data, qualifier, workflow state, interpretation blocked reason and authorized signed download. |
| Food and gardens | Advisory list/detail/match, food-report list/detail, garden CRUD, fish-note CRUD, grower resource/inquiry operations. Preserve kind, geography/audience/product scope, official action, current revision and coverage. |
| Stewardship | Drought history and utility-conservation reads; water-use CRUD/comparison. Separate regional, official-rule and private measurement records. |
| Act | Organizer/opportunity/project reads, participation CRUD, outreach draft/follow-up, private observation/report preview/export. Source status and user-reported status remain separate. |
| Map | Extend existing layers/detail/quarter/compare/district reads; server-backed public record search and list pagination. Respond with the same record set, filtering definition and source versions used by the map. |
| Journal | Extend existing entry/findings/retrospective/summary contracts; authoritative first-use/backfill status and per-date batch outcomes. Return analysis version and included/excluded denominators. |
| Luna | Capabilities, questions with authorized context refs, bounded conversations/delete, proposal and explicit confirmation. Response citations bind claims to reviewed evidence. |
| Alerts and subscriptions | Existing alert/preferences routes plus entity subscriptions, cursor pagination and exact unread total. Return effective channels, watch status and source event identity. |
| Data controls | Owned export job/status/download/cancel, selective deletion, full deletion job/receipt and supported recovery/device flow. Return true completion/partial states, not optimistic success. |
| Operators | Source acquisition/review/publication/withdrawal and job monitoring behind dedicated roles. Never expose service-role operations merely through a hidden frontend route. |

### Required data envelopes

For an evidence-backed value, the frontend needs the following fields or explicitly named equivalents:

```text
id, revision, kind, source_id, source_record_id
native_value, native_unit, qualifier, detection_limit, reporting_limit
normalized_value, normalized_unit, conversion_version
sample_matrix, analyte_id, method, basis
observed_at OR sample_date, issued_at, valid_from, valid_to
published_at, retrieved_at, reviewed_at
scope_type, geometry_ref, geography_version, association_method
coverage, missing_reason, freshness, interpretation_version
source_locator, attribution, permitted_uses
```

Fields not applicable to a domain are absent or explicitly null under its typed schema. They are never guessed to fill this template. Use separate typed envelopes for observations, forecasts, advisory rules, notices, guidance and private records. Evidence revisions are not mutable user tasks.

List responses need `items`, stable pagination, applied filters, coverage, source versions and true empty/unavailable distinction. Mutations need an authoritative saved record and revision. Errors need a stable code, safe message, field errors, retryable flag and request ID; add `Retry-After` where applicable. Use 409 or a documented precondition response for stale revisions. Do not leak existence across owners when returning authorization failures.

Each new form must have complete create/read/edit/delete/export rules, a retained draft on error, optional-field semantics, linked-record validation and a maximum payload size. A task with no date, a test with unknown units, or an advisory search with unknown species can be valid states; none authorizes a fabricated result.

## Source and schema mapping examples

These are proposed mappings from inspected fields, not complete production parsers.

| Input | HALO normalized output | Required guard |
| --- | --- | --- |
| USDM `mapDate`, `fips`, `none`, `d0` to `d4`, `statisticFormatID=2` | Regional release and mutually exclusive county area percentages | Preserve FIPS as string and categorical mode; do not use county maximum as a home class. |
| NC conservation `systemPWSID`, `conserveStatus`, `conserveReason`, `conserveDateEffective` | Utility status evidence plus raw ID and validated federal-ID crosswalk | No fabricated restriction wording or matching solely by utility name. |
| openFDA `recall_number`, product/code/distribution fields, lifecycle dates/status | Food recall revision with specific applicability | Firm state is not distribution; terminated historical record cannot trigger a current recall alarm. |
| NC fish `Popultn`, `MlsAllw`, `Advisory`, `Site` | Unpublished candidate requiring full-document review | Contradiction, truncation or missing extent blocks automatic personalized advice. |
| User lab report and entered value | Owned report plus separately verified transcription revision | Verification confirms transcription, not laboratory authenticity; uncertain matrix/unit blocks comparison. |
| Current environmental source with missing date | Record with unknown observation time and real retrieval time | Do not label as observed just now or merge into a dated trend without a reviewed basis. |

## Completion tests for the added backend

Build tests alongside each package, not as an end-of-project manual check. Required scenario groups are:

1. **Identity and authorization:** no foreign ID linking, no public/private cache mixing, no service-role bypass in nested reads, invalid/expired sessions preserve drafts and do not create replacement identities silently during a write.
2. **Source acquisition:** missing key, 401/403, quota/429, timeout, malformed 200, partial pagination, duplicate row, source schema change, revised release, empty-but-unexpected result and revoked source rights.
3. **Scientific meaning:** unknown versus zero/nondetect, differing units/matrices, unavailable method, forecast versus observation, model versus monitor, advisory conflict, date-only records and explicitly incomparable history.
4. **Concurrency:** repeated create key, same key with different payload, two tabs editing, out-of-order refresh, two recurrence workers, interrupted publication/fanout, stale Luna proposal and duplicate confirmation.
5. **Calendar and reminders:** DST gaps/folds, user timezone change, all-day dates, late completion, skipped occurrence, cancelled event, expired forecast watch, quiet hours and delayed push. Test with a controlled clock rather than real waiting.
6. **Attachments:** claimed versus actual type, oversized upload, malware/scan failure, abandoned upload, foreign attachment link, expired URL, extraction disagreement, metadata leakage and original/derivative deletion.
7. **Lifecycle:** source correction/withdrawal, advisory supersession, event reschedule/cancellation, house move, category deselection, test correction, record deletion and consent revocation while jobs are queued.
8. **Food and agriculture:** product/lot mismatch, broad distribution, ambiguous fish species, overlapping advisory rules, conflicting raw audience/limit, missing effective status, unrelated garden water source and unsupported crop-safety request.
9. **Operational recovery:** worker crash/retry, cache loss, source unavailable, quota ceiling, failed export, partial delete, restore with deletion replay and source-parser rollback.
10. **Full connected journeys:** save guidance to Plan; schedule test and record result; follow fish advisory revision; inspect applicable food recall and prepare a question; create garden site and lab inquiry; compare drought releases and record usage; save event and handle cancellation; prepare official observation report; Journal edit recomputes eligible analysis; Luna confirmed proposal saves exactly once.

No external registration, message send, agency submission, shared-production delete or paid-provider stress test belongs in automated tests without a specifically authorized isolated setup. Stress tests use fixtures and isolated local/staging services first.

## Open decisions with explicit closure evidence

| Gate | Required closure before dependent release |
| --- | --- |
| Google Pollen retention and map rights | Confirm applicable agreement and enforce distinct expiry classes. Current non-EEA terms allow today's forecast values for 365 days, other forecast/heatmap values for 24 hours; see S04. Review exports/derived/model uses and map restrictions. Audit existing data without destructive planning changes. |
| Mapbox persistence | Confirm the actual account/version storage entitlement; use an appropriate permanent-storage request/plan if required. Rounding alone is not a resolution. |
| Keyed provider configuration | Redacted account-level success and quota/billing checks for AirNow, Google Pollen and optional OpenUV; no secrets in fixtures. |
| Source imports | Complete UCMR release/dictionary mapping and count reconciliation; reviewed radon/lead/geography versions; no arbitrary sample treated as complete coverage. |
| Fish rules | Resolve contradictory/truncated sample fields against full official source, verify current status/extent and source reuse, then test all supported audience/species combinations. |
| Food studies and local notices | Real reviewed study rows and notice scope, exact source/table locators and a defined supported region. No suitable local evidence returns unavailable, not safe. |
| Utility conservation | Confirm acquisition rights/cadence, PWSID crosswalk and official local restriction instructions. Status alone cannot generate detailed rules. |
| WQP extension | Select/version supported profile, acquire a real filtered result fixture and prove required matrix/method/limit fields. Optional layer stays conditional otherwise. |
| Scores and interpretation | Review factor `/100` meaning, contribution semantics, proxy handling, threshold effective status and expanded health guidance. Native measures remain the truthful fallback. |
| Platform and budget | Choose and verify scheduler, private storage/scanning, recovery mechanism, retention periods, source review capacity and actual cost limits. |
| Deployment baseline | Authorized schema/RLS/config audit and isolated migration/restore tests. Do not apply speculative migrations to unknown production state. |
| New visuals | Yogi's review remains necessary for new pages. Backend implementation does not grant permission to replace approved frontend geometry or archives. |

These gates are work to complete, not reasons to delete planned functionality or claims that permission has already been granted. If a gate cannot be resolved, document the precise affected promise and obtain a product decision about its fallback before marking that feature complete.

## What Vibhav should return for frontend integration

For every completed build package, provide:

- Migration identifiers and safe rollout/backfill/rollback instructions.
- Versioned executable API schema, generated or validated frontend types and documented compatibility changes.
- Representative success, partial, empty, unavailable, stale, conflict and unauthenticated fixtures with no real private data.
- Source manifest with verified request/coverage/rights, parser tests, reviewed interpretation and actual refresh policy.
- Endpoint and job test results, RLS isolation results, cost limits and source freshness monitoring.
- Enabled feature/capability list and any remaining source/operation blockers.
- A staging demonstration of the complete connected journey, including reload persistence and failure recovery.

The frontend can then integrate against explicit contracts instead of guessing source semantics. Calling the package ready for integration does not mean every data source or feature in the entire app has shipped.

## Repository status of this handoff

This documentation and its verification tools were saved locally in the existing repository. This task does not itself create a PR, push a branch, contact Vibhav, alter approved archives or implement backend routes. Preserve the unrelated map work in the current working tree. The source checks can be rerun explicitly; results and permissions must be revalidated at implementation and release time.
