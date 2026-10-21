# HALO Today and Homeguard Backend Supplement

Prepared for Vibhav, October 3, 2026, America/New_York. Audit completed after midnight UTC on October 4. This document reconciles the current Today and Homeguard wireframes with the original backend working specification and the backend code published to GitHub. It is an implementation handoff, not a claim that the new services exist or that the wireframes are production-connected.

## Read this first

Use this supplement **with the complete original `HALO_BACKEND_WORKING_SPEC.md`**, not instead of it. The original contains 45 feature packets and the shared security, sources, fields, relationships, jobs and release requirements. Its SHA-256 is `fc1fec4b180dc5057b2edf1c2203143d85535b43364502e674d34e04d415be86`. The original is unchanged.

An important intake issue exists: at backend commit `76acc4f8a2f830e7d8e09eb03c666bc229192f06`, `docs/product/HALO_BACKEND_WORKING_SPEC.partial.md:5` says the Claude session's paste stopped during BE-032. It lists the remaining BE sections, DS, MP, UI, AC, ST, WF, AG, MA, VR and all feature packets as not received by that session. This is evidence about that checked-in session, not proof of what Vibhav has read elsewhere. Put the full Markdown file in the backend working repository and let the coding assistant read it in bounded sections. Do not rely on another long chat paste.

Most missing implementation is **already specified** in the original. The genuinely later additions are kitchen inventory/catalogue and exact food-evidence matching, independent test milestones, more precise cross-record/Plan/deletion behavior, and integration details for local summaries. New branch response shapes also require an explicit frontend bridge. This document consolidates those additions and clarifications without asking for a second implementation of already-planned services.

### Audited baselines and limits

| Baseline | Inspected reference | Meaning |
| --- | --- | --- |
| Current frontend | Local `codex/map-wireframes`, HEAD `66a3246c5fde222754df100e1e5bb74784e7296d`, plus the current uncommitted review files | HEAD alone does not contain the expanded Homeguard work. The accompanying audit manifest fingerprints those files. |
| Hosted visual review | HALO Wireframe Review version 19, source `da641dc08dcb13f426975a29a6ca0274f416dc8c` | Sample-only review; not live account storage. |
| GitHub main | `9f1ef88fe2d99aa82e96285ce7aa152e99a5acb0` | Existing core backend; no expanded private-record service families. |
| GitHub backend branch | `vmag211/backend`, `76acc4f8a2f830e7d8e09eb03c666bc229192f06` | New validation, bounded reads, safe errors and route-isolation work are present. Still 22 API route files and 14 migration files, through 0014. |
| Original delivered specification | `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` and its coverage manifest | Historical October 3 snapshot. Later source documents changed; do not regenerate this file over the original. |
| Later planning additions | Homeguard delta in Backend and Data Plan; Food Evidence Extension; latest frontend/acceptance/workflow decisions | Not embedded in the original packet. Reconciled below. |

This audit reviewed code, types, interactions, fixtures, tests, migrations, remote branches and requirement blocks. It did not inspect private production rows, run production migrations, contact providers using private credentials, or verify deployed storage/RLS/jobs. Unpushed work on Vibhav's computer is outside the evidence. There is no claim that every future feature or unknown deployment defect has been ruled out.

## Current decisions that override older wording

1. Tabs are Today, Homeguard, Act and Plan in the current shell. Map belongs under Act; Journal belongs under Plan. Full Act and Plan workflows remain later-stage work, not completed because a destination link exists.
2. Today keeps air, UV, pollen and outdoor mold. PFAS belongs only to Homeguard. Lead remains visible but unscored. Preserve the depth of Today and its factor pages.
3. Homeguard order is overall score, factor scorecards, then household context/house and the remaining sections. This is frontend-only.
4. Remove blanket Save this step from general educational tips and household guidance. Keep explicit test, routine, food-question and other Plan workflows, including an optional date and Saved for later. Viewing guidance, checking a local checklist, adding a record or clicking Next never creates or completes a task automatically. Existing saved actions remain.
5. Actual food photographs are removed. Small illustrations are frontend assets. A product-image pipeline, image attribution panel, camera recognition and barcode lookup are **not required to release the current reviewed kitchen screens**. Optional future identity assistance cannot infer chemicals and needs a separate enabled capability.
6. Kitchen indicators concern PFAS and lead only. Official fish advisories retain every contaminant and instruction in their source. The kitchen restriction must not truncate fish advice.
7. Luna is available throughout the shared app shell. The timeline robot and report-generation label are UI elements, not model processing. Neither justifies sending private tests or summaries to an AI provider.
8. All current expanded records are session-only examples. Production must replace the fixture providers with authenticated adapters; never use fixture data when a live request fails. No app-facing em dashes.

## Coverage of the existing screens

Status key: **Existing** means relevant code is present, not that deployment was reverified. **Planned** means the original sent specification already requires it. **Delta** means a newer requirement or a now-specific integration clarification below. **Client** means no new backend service is needed. All private rows inherit the common security and lifecycle contract later in this document.

| Screen or interaction group | Existing implementation and original requirements | Disposition |
| --- | --- | --- |
| Today composite, four factors, refresh, missing/partial readings | `/api/daily-score`; T01, BE-110 to BE-118, ST-029/042 to 046 | Existing core; enriched provenance Planned. Individual factor `/100` methodology remains a gate, not a forgotten API. |
| Segmented ring and contribution bar | Current risk inputs; BE-113/114 | Client geometry. Label relative input shares honestly; they are not personal health-risk percentages or automatically formula weights. |
| Air native reading, pollutant, chart/table/point selection, source basis | Daily/history; T02, HO-019 | Existing native values/history; timing, comparable acquisition basis and forecasts Planned. |
| UV reading, rising-sun window, daily maximum, trend | Daily UV peak window/history; T03, HO-020 | Existing; valid times, timezone, missing/all-low/incomplete distinctions Planned. Animation Client. |
| Pollen types, dominant type, chart and sources | Daily tree/grass/weed/history; T04, HO-021, S04 | Existing; expanded series/source rights Planned. No invented extra forecast days. |
| Mold proxy and moisture entrance | Daily proxy/Learn; T05 | Existing outdoor estimate; owned indoor observations Planned, detailed in HGX-05. |
| Factor explanation, Learn, step deck, expand-all, anchors, sources | `/api/learn`; X01 and factor packets | Existing single-priority-note model; reviewed multiple-category notes Planned. Partial-response bridge HGX-01. |
| Today family page, filters, selected categories, local checklist | Household flags/daily/Learn; T06 | Existing/static reviewed content; richer evidence binding Planned. Checklist checks are visit-local, not saved actions. |
| Today change disclosure and saved-next-step link | T01, HO-018/101, P01/P02 | Planned `/api/changes` and canonical action summaries. Current disclosure does not compute a change. |
| Homeguard overall score and PFAS/radon/lead cards | `/api/home-guard`; H01, ST-030/044/049 | Existing core; private summaries Planned. Card order Client. |
| PFAS utility/analyte rows, original sample dates, history, coverage | Home water payload, `waterPresentation`; H02, HO-025, S06/S07 | Existing subset; complete qualified sampling and release provenance Planned. |
| Well/spring/unmatched/failed-lookup branches and testing resources | Home `water.test_plan`; H02, ST-052 | Existing distinctions. Never substitute nearby utility data for private water. |
| Radon zone and test entry | Home county estimate; H03 | Existing estimate; private tests Planned. County zone never becomes a home measurement. |
| Lead age estimate, utility inventory and home correction | Home/profile; H04 | Existing; property evidence and tested results Planned. Utility counts do not identify this property's pipe. |
| Home recommended actions, costs, renter variants, standards | Home `action_plan`, `lib/actionPlan.js`; H01 to H04 | Existing recommendations, not persisted Plan tasks. Preserve original source and reviewed qualifiers. |
| House figures and seven category guides | Seven `has_*` flags; H05, AC-100 | Existing categories/static content; related-record summaries Planned. Not seven named-person accounts or a resident count. |
| Tests list, search, kind/status/context/archive filters and reset | H06, UI-077, BE-186/211/240 | Planned list/detail/create APIs. Full view inventory below. |
| Prepare test or add existing report, arrangement and sample forms | H06, MP-203/204, BE-211 | Planned; explicit independent milestones HGX-04. |
| Result rows, ambiguous values, transcription check, corrections/history | H06, BE-136 to 138/259 | Planned; typed fields, append-only revisions, food-matrix gate HGX-03/04. |
| Timeline, pencils, missing-stage entry, follow-up | H06; later Homeguard delta | Recorded evidence HGX-04; canonical Plan reference HGX-06; robot/checkmark motion Client. |
| Attachment preview, compatible comparison, export, archive/restore/delete | H06, BE-315 to 318 | Planned owned files/comparison/deletion. Current local file viewer is not an upload service. |
| Maintenance list/detail/create/edit and occurrence history | H07, BE-139/212/241 | Planned; complete projection HGX-05. |
| Complete, skip, snooze, pause/resume, replace, cadence/end-date | H07, BE-131/257 | Planned recurrence engine. One canonical occurrence, not a second Homeguard scheduler. |
| Moisture create/detail/edit/delete, optional photo, routine/test link | T05/H07, UI-078 | Planned concept; explicit standalone typed observation HGX-05. |
| Food hub, interests, coverage, resume/followed sources | F01, UI-082 | Planned; pantry is a later extra destination, HGX-02. |
| Kitchen search, aliases/custom entry, fridge/pantry/freezer, move/edit/remove | Not explicit in the historical F01/F04 packet | Delta HGX-02. Catalogue is not a contaminant database. |
| Food guidance, PFAS/lead indicators, published findings, methods and questions | F04/S12 plus later Food Evidence Extension | Original study pipeline Planned; identity-to-study/item-match contracts HGX-03. |
| Fish selector, source-defined audiences, overlapping rules, extent/history | F02, BE-141/142/214, S13 | Planned. Complete reviewed source rules required; illustrative diagram is not authoritative geometry. |
| Fish catch/consumption note create/read/edit/delete/export | F02, BE-143/189/215/244 | Planned. No dose, remaining meal allowance or inferred safety. |
| Garden site create/detail/edit/history/export/delete and linked tests | F03, BE-144/213/242 | Planned; context version and link/delete clarification HGX-08/06. |
| Notice/study filters, lifecycle, scope, source details and private question | F04, BE-216 | Planned; exact private-question shape and link rules HGX-08. |
| Save a source reference, follow updates, copy/download reference | F01 to F06, X03, BE-161/194/224 | Planned follows; separate bookmark/watch contract HGX-07. |
| Grower search/filters, two-resource comparison, checklist and inquiry | F05, BE-217 | Planned; explicit inquiry fields, related-record and external-handoff rules HGX-08. |
| Drought history/categories and utility restrictions | F06, S16/S17, BE-147/218 | Planned acquisition/review. Neither county drought nor status alone creates watering rules. |
| Water-use interval/meter records, edits/history/comparison/export/delete | F06, BE-148/218/244 | Planned; projection and compatibility details HGX-08. |
| Bill/leak checks and all explicit record follow-ups | P01/P02, BE-209/210 | Planned actions; exact keys, optional dates and cross-view invalidation HGX-06. |
| Summary choices/date/sections/individual records/privacy/appendix | H08, BE-159/222 | Planned authorized composition; snapshot contract HGX-09. |
| PDF/progress/cancel/retry, HTML/image/print/native share | H08, MP-218 | Client local generation; authoritative inputs and omissions HGX-09. No new AI/export worker required. |
| Luna suggestions, question/send/cancel/retry/refusal/citations/new chat | `/api/assistant`; X02, ST-063 to 067 | Existing basic transport; capabilities/consent/selected-record context Planned, bridge HGX-10. |
| Alerts, unread/read/dismiss and linked destination | `/api/alerts`; X03 | Existing basic inbox; pagination/global counts, watches/outbox Planned. |
| Household/home Settings, address change and session recovery | Profile/household/onboard; G01/X04/X05 | Existing baseline; new branch compatibility HGX-01. Atomic revisioned writes/home contexts already Planned. |
| Themes, font scale, motion, contrast, scenes, icons, navigation/Back | Shared frontend; X06 | Client. Device time is decorative, not measured weather; no backend day/night engine. |

## HGX-00 Complete specification intake

Before new migrations, reconcile the backend branch's partial intake with the complete original file. Keep its existing progress and implementation work. Add a persistent tracker that maps each original requirement and HGX section to implemented, tested, blocked or not started, with code/migration/test evidence. Missing text is not permission to invent fields.

Credit the branch's existing flat error envelope, validators, bounded reads, profile/household/Learn availability markers, push-endpoint ownership fix and fake-backed isolation tests. Do not mark the original B01 package complete merely because these changes exist. Atomic household writes, revisions, deployed-schema/RLS evidence and home-context/backfill isolation still need their original gates. A migration file is not proof it was applied.

Read current installed Next.js documentation when implementation begins. Preserve approved archives and the separate unapproved expanded preview. Keep API names additive or document a versioned adapter. No design rewrite or production mutation is authorized by this supplement itself.

## HGX-01 Bridge the current backend branch and frontend

### Household read availability

On the inspected backend branch, profile GET may return HTTP 200 with `unavailable: true` and `reason: household_unavailable` alongside normalized false booleans. Current `StageSession` and `StageSettings` can mistake that for an authoritative empty household. Editing a category can then replace all seven categories using an incomplete baseline.

Backend must distinguish a genuinely absent household record from query failure. Return the same availability semantics on profile GET, profile PATCH's post-save read and household GET. The inspected profile PATCH calls `profileResponse(userId)` without GET's bands-error callback, so post-save read failure can lose the marker. Propagate it or return an explicit partial result that retains the successful home-field write and the failed household read separately. Do not pretend the entire mutation rolled back if it actually committed.

Frontend must keep environmental information usable, but not show invented household figures or allow seven-flag replacement until authoritative household data loads. Keep the last authorized selection labelled unavailable/stale when appropriate; preserve the unsaved draft. A valid absent row can initialize an empty selection. Successful writes return all seven fields and revision. The original atomic transaction and revision requirements remain.

### Learn and history

Preserve `unavailable` and `reason` from Learn, including `learn_content_unavailable` and `household_unavailable`; preserve requested/delivered locale and content version when supplied. General reviewed fallback must not imply successful personalized content or translation. The current `stage-api.ts` parser drops these availability fields.

Preserve `history.truncated`, requested/returned coverage and completeness. A bounded partial result is not a complete timeline with healthy missing days. More detailed pagination/source-basis metadata is already required by the original specification. Never compute a meaningful change over incomplete or incompatible data.

### Errors and mutation outcomes

Keep the backend branch's additive flat envelope, including legacy `error`:

```json
{
  "error": "Review the date.",
  "code": "validation_failed",
  "message": "Review the date.",
  "field_errors": [{"field": "planned_date", "code": "invalid_date", "message": "Choose a valid date."}],
  "retryable": false,
  "request_id": "synthetic-request-01"
}
```

The frontend adapter must allowlist safe codes, map fields, retain request ID and `Retry-After`, and support legacy responses. Not every daily 400 means no location; not every Homeguard 400 means no county. Preserve drafts on 400/409/413, do not create a new identity on a transient auth503, and reconcile unknown write outcomes through the same idempotency key. Cancellation of a fetch does not prove a committed server mutation was undone.

**Acceptance:** failed household GET and PATCH reread, truly absent row, recovery with dirty draft, two-tab category conflict, Learn fallback in English for requested Spanish, truncated history, legacy error, field400, auth401/403/503, revision409, payload413 and quota429.

## HGX-02 Owned kitchen and broad food identity

This is the substantive new private-record domain beyond the original food-information plan. Reuse ownership, evidence and action services. Do not add nutrient tracking, consumption requirements or a separate chemical scoring engine.

### Record and API responsibilities

Proposed route names are illustrative; provide an executable shared contract and generated client types before integration:

| Operation | Minimum responsibility |
| --- | --- |
| `GET /api/foods` | Bounded name/alias/category/locale search; stable food ID, ordinary label, form/group, catalogue version, supported evidence availability, cursor and explicit failure/no-match distinction. |
| `GET /api/foods/:id` | Canonical identity/form, reviewed guidance version, catalogue status and provenance. Include public study evidence or a separate evidence-by-catalogue-ID read so the Add food screen can show findings before inventory creation. Retired IDs remain understandable in saved records. |
| `GET/POST /api/kitchen/items` | Owned inventory with storage filter and pagination; create with idempotency and optional catalogue identity. A custom name always remains possible. |
| `GET/PATCH/DELETE /api/kitchen/items/:id` | Authoritative detail/revision, edit name/origin/question, move storage and remove with revision/conflict handling and linked-action policy. |
| `GET /api/kitchen/items/:id/evidence` | Authorized item identity revision, separate PFAS/lead item status, matching studies/notices and limitations, as HGX-03. |
| Owned food-question operations | Preserve standalone food-group questions as well as an inventory item's optional question. Do not require a storage location for an existing standalone note. |

Inventory fields: `id`, session-derived owner, optional home-context ID, `revision`, `created_at`, `updated_at`, user label, optional `food_id` and catalogue revision, `guide_id` and `guide_revision`, `storage` (`fridge`, `pantry`, `freezer`), `origin` (`store`, `homegrown`, `caught`, `unknown`), optional question. The current prototype uses `PantryItem` for both inventory and old food notes; production should use an explicit record kind or validated union so a missing storage value is not ambiguous.

Only the readable food name and storage are needed to add an inventory item. Question is optional and initially blank. Existing standalone notes require their question. Current UI bounds are 80 characters for the label and 500 for the question; agree and enforce matching server/client limits. Brand, lot, package, preparation, provider ID and sample identity are optional extensions requested only to resolve a concrete evidence match. Do not silently require fields the current add form cannot provide.

Public catalogue identity should support ordinary names/aliases, locale, category, species/variety/preparation when meaningful, optional provider namespace/ID and version. Private label edits do not mutate the public catalogue or silently rematch studies. Use explicit identity confirmation when a changed description would change the match. Preserve custom/retired names, unknown form and original labels. Foods may be duplicated deliberately; name alone is not a uniqueness key.

The preview's 148-name catalogue is a starter, not exhaustive provider coverage. A versioned curated catalogue can ship without an external call for every search. To expand, USDA FoodData Central has search/details and downloadable datasets; keep its API key server-side, cache permitted public identity data, debounce/bound queries and retain a manual alternative. Its documented primary purpose is nutrient data, not PFAS or lead assays. See the [official API guide](https://fdc.nal.usda.gov/api-guide/). Optional barcode lookup is not a current release dependency; product photos are superseded.

### Ownership and lifecycle

All inventory/question reads, writes, exports and links enforce verified owner plus RLS. No private names/questions in public caches, analytics or source queries. Adding/moving/removing food changes only inventory. It does not change scores, infer ingestion or create tasks. Explicit follow-up reuses the canonical action; removal preserves that independent action with an understandable removed-origin state, not a dead private URL or automatic completion. Full account deletion/export/recovery coverage includes both item and note record kinds.

**Acceptance:** no-result search and custom save; alias/form ambiguity; provider outage while custom save works; empty question; food-note required question; duplicate intentional items; move and return to correct storage; rename without false rematch; retired catalogue ID; concurrent edits/deletion; reload persistence; two owners; remove with retained Plan action; no image fetch or hidden chemical inference.

## HGX-03 Food chemical evidence and item matching

The original already plans FDA studies, notices and private reports. The later requirement is the explicit relationship between these sources and each saved kitchen item. A food's name cannot measure its PFAS or lead. The current four reviewed entries are historical study findings, not a live national food-chemistry catalogue.

### Required separation

| Evidence class | Output and limits |
| --- | --- |
| Reviewed guidance | Source/version and useful explanation; no numerical item concentration. |
| Published study | Tested identity/form, named analyte, sample statistics, original dates and limits. It describes those samples, not the household item. |
| Official notice | Current or historical lifecycle, exact product/lot/distribution/audience scope, source instructions and applicability outcome. A recall need not contain a concentration. |
| Owned matching sample | Authorized report/result/sample IDs, exact matrix/form/identity, original analyte/value/unit/qualifier, lab/method/date and transcription status. The result describes that sample, not every item of its type. |

Minimum public study fields: issuer, source identity/URL/locator and revision, file hash, publication and collection dates separately, review status, original food description and normalized form/species only when justified, sample IDs, sampling design, composite versus individual sample, region/origin and limits, matrix/basis, method. Analytical rows retain named compound or lead analyte, original text/unit, parsed value only when valid, qualifier, detection/reporting limit and type, exclusions and revision. Aggregate fields retain included sample IDs, total/detected/nondetect counts, statistic type and version, and explicit nondetect handling. Do not average censored results under an unstated zero-substitution rule.

Minimum match result: inventory ID/revision and identity, per-contaminant coverage and item-status reason, separate study and notice matches, evidence IDs/revisions, match level, matching rule version, missing identity fields, dates, lifecycle, exact source links and limitations. A successful empty search is different from unavailable acquisition. A stale/withdrawn study cannot silently remain current. Never copy a study range into the private item's concentration field.

```json
{
  "item_id": "synthetic-item-01",
  "item_revision": 2,
  "contaminants": {
    "pfas": {"item_status": "unknown", "reason": "no_matching_item_measurement"},
    "lead": {"item_status": "unknown", "reason": "no_matching_item_measurement"}
  },
  "studies": [{"evidence_id": "published-study-id", "revision": "reviewed-revision", "match_level": "food_form_context", "applies_to_item_measurement": false}],
  "notices": [],
  "coverage": {"notices": "not_checked", "studies": "limited_reviewed_catalogue"},
  "missing_identity_fields": [],
  "matching_version": "agreed-server-version"
}
```

This is a proposed shape, not a response already implemented. An item-specific concentration requires an authorized matching food/tissue report or an explicitly reviewed exact product/lot measurement. The current test form can select tissue as a medium, but its test-kind picker has only `water`, `radon`, `lead`, `soil`, and the kitchen has no typed owned-sample matching flow. Agree a food/tissue-capable test contract and coordinated frontend sample-entry/link UI before advertising that capability. Do not misuse a generic test type, relabel a water/soil result, or treat a private question's report link as a chemical match.

### Acquisition and release gates

- FDA PFAS: acquire actual analytical tables through the [official testing page](https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure); retain source files/hashes under permitted retention, sample scope and table locators. Reviewed imports are acceptable; no general per-product realtime estimator is established.
- Food lead: use official downloads/exports linked by [FDA TDS results](https://www.fda.gov/food/fda-total-diet-study-tds/fda-total-diet-study-tds-results), with food keys, composite design, preparation, units, limits and original periods. Dashboard access is not an undocumented API contract.
- Recalls: preserve the original S14 acquisition, lifecycle, distribution and product/lot rules using [openFDA food enforcement](https://open.fda.gov/apis/food/enforcement/). Keyword discovery is not proof a notice applies or that coverage is complete.
- Reviewed NC fish, Extension/grower and private-laboratory paths remain in S13/S18/S19/S22/S24. No new paid provider is required for the UI animations or catalogue illustrations.

Current curated fixture expectations come from `lib/frontend/food-evidence.ts`: tuna PFOS 5/10 detections, salmon PFDoA 8/10, whole milk lead 27/27 nondetect, raw spinach lead 21/27 detections. Preserve their exact tables, original ranges/limits, sample dates and warnings when importing. These are seed parity checks, not a claim of broad coverage, representativeness or current item contents. The original source review is documented in the Food Evidence Extension; this audit did not rerun every laboratory-table extraction.

**Acceptance:** unknown remains unknown alongside numeric study cards; named PFAS is not total PFAS; nondetect is not zero; mass and volume units never mixed; raw/cooked, whole milk/plant drink/formula, farmed/wild and composite/single-sample differences preserved; exact-lot mismatch; withdrawn notice; foreign/private/mismatched test rejected; source correction changes match revision without rewriting old exports. No safe/unsafe food grade, dose estimate, medical advice or score mutation is inferred.

## HGX-04 Tests and truthful progress

Reuse the original H06 schemas, result revisions and attachment service. The visible stages are **Prepared, Arranged, Collected, Awaiting result, Result recorded, Follow-up**. They are independent evidence of recorded events, not a requirement to fabricate a complete linear history.

An imported report may show Result recorded while Arranged or Awaiting result is unknown. A planned date is a proposed date, not proof collection happened. Store or project each stage's recorded/unknown state, event or supporting record ID, actual/proposed date distinction, source (`user_recorded`, imported report metadata, or linked action), revision and editable operation. Retain server `recorded_at` separately from optional occurrence date/time: backfilling history today does not mean the event happened today. Current prototype booleans `arrangedByUser` and `awaitingRecorded` require durable equivalents. Do not reconstruct them from the highest status alone.

The robot's current position is a presentation projection, separate from the set of checked stages. Users can backfill what actually happened using missing-stage controls, and pencil edits preserve revision history. A completed-looking animation never writes milestone evidence. Reduced motion reveals the same final truth immediately.

### Test data projection

| Family | Fields required by the current screens and original plan |
| --- | --- |
| Test | ID/owner/revision/timestamps, title, kind, purpose, medium/matrix, home or garden context ID and immutable collection-context snapshot/version, provider/lab, planned date, collection start/end, sample-location label, method, expected date, workflow state, archive state. |
| Result row | Stable row/sample ID, analyte identity and original label, original value text/unit, qualifier (`measured`, `less_than`, `non_detect`, `zero`, `absent`, `unknown` or mapped equivalents), limit value/unit and limit type, basis, report date/reference, optional normalized values with conversion version. |
| Review | Not received/unreviewed/needs clarification/user-confirmed transcription, specific reasons and missing fields, confirmation timestamp and actor; this is not scientific certification. |
| Revision | Revision ID/sequence, changed timestamp, correction reason, prior original rows/review state and relevant context. Original report and transcription remain separate. |
| Links | Owned attachments, garden/asset links, canonical follow-up action ID/revision/status. Public evidence remains separate. |

Allow an uninterpreted record when original unit, qualifier or basis is unclear. Reject impossible structured dates or invalid structured fields without silently normalizing the original report. Retain an ambiguous original report date as original text with a null parsed date and clarification reason instead of rejecting the entire original document. Radon collection start/end and method/duration remain meaningful. Preserve legitimate reported zero. Unknown, ND and less-than must remain distinguishable in UI, comparison, history and exports.

Result confirmation and revision creation are atomic. A correction resets/requires transcription confirmation under the documented policy and never overwrites the prior result. Comparison must report each blocking reason: incompatible matrix/basis/analyte/unit/method/site/sample context, unconfirmed transcription, unknown/qualified value or unsuitable collection basis. A comparison is not an exposure trend or safety determination.

Follow-up is derived from one canonical action relationship, not a separately saved boolean or unrelated title match. Creation/reopen/completion/deletion of that action updates both timeline and Plan consistently. If a follow-up is removed, return no active linked action plus documented history; do not leave a checked current follow-up pointing nowhere. Earlier result evidence stays intact.

**Acceptance:** imported report with missing intermediate history; independent arrangement/awaiting edits; collection dates versus proposed dates; result correction with reason and confirmation; unknown units saved but not compared; multiple samples/analytes; concurrent edits; saved action created once after timeout/retry; archive/restore separate from destructive deletion; file upload/scan/finalize failure; future reminders cancelled on deletion while independent actions remain intelligible.

## HGX-05 Maintenance and standalone moisture records

The original already requires H07 assets, observations and recurrence. These fields and state semantics close the gap between that domain plan and the current forms.

Routine/asset projection: ID/owner/context/revision/timestamps, label, optional model, installed date, serviced date, related factor, instructions and their source/version, basis (`user`, `manufacturer`, `reviewed`), recurrence mode (`calendar`, `completion`), positive interval and unit (current UI: days or months), calendar anchor, optional end date, next due, last completed, optional snoozed-until date, status (`active`, `paused`, `replaced`), linked test ID, canonical action/series ID and event history. The prototype's `reviewed` choice is supplied by the user and is not proof of HALO editorial review or product certification; separate claimed basis from a verified guidance revision. Store due date and actual event date separately. Do not take a client-calculated next due as authoritative without server validation.

Events retain ID, occurrence/series version, kind (completed, skipped, snoozed, paused, resumed, replaced, cadence changed), original due date, actual date/timezone, optional note, actor and revision. Existing original recurrence rules still apply: skipped is not completed; calendar anchors do not drift after late completion; completion-relative schedules advance once from a confirmed completion; month ends, DST, end dates, pause/resume and snooze get controlled-clock tests. Resume retains an overdue due date rather than silently skipping or completing it. Paused/replaced routines do not create new occurrence activity until an allowed transition. Replacement retires the old routine/history and creates or links the successor deliberately, not an invented product measurement.

Standalone moisture observation: ID/owner/context/revision/timestamps, title, type (`dampness`, `leak`, `condensation`, `humidity`, `other`), observed local date/time, IANA timezone and resolved instant where resolvable, room/site label, optional original reading/unit, observation source, optional private note, optional owned photo attachment ID, optional asset and test IDs. Preserve zero versus absent. Validate numeric humidity only when the field is explicitly a relative-humidity measurement; a visual leak note can have no number. Handle timezone folds/gaps explicitly. Do not persist browser data URLs as the production attachment contract.

All moisture records can exist without a routine or test. Linking requires same-owner authorization and relation validation; unlinking is explicit. A removed test/routine must remain a readable removed-link state with a deliberately retained non-sensitive snapshot or detached relationship. Reopening an editor must not silently discard a missing link before the user chooses to clear it. Observations are not detected mold, proof of cause or evidence that a completed repair removed a hazard.

Deleting a routine removes its owned recurrence and cancels its future occurrences/reminders. It must not delete independent moisture observations, laboratory tests or explicitly separate follow-up actions. Preserve those with removed-origin state. Archive/pause/replacement retain history; a confirmed destructive delete removes the selected routine's private history subject to disclosed retention. Use HGX-06's deletion response and full-account deletion rules.

**Acceptance:** zero reading, visual-only observation, photo rejection, foreign/missing link, edit after linked deletion, routine retirement, late/skip/month-end recurrence, two completion workers, snooze beyond end date, disabled reminders while paused, independent record retention after delete, Plan and Homeguard show the same occurrence status.

## HGX-06 Canonical Plan links and deletion

The shared action system is already specified in P01/P02 and BE-130 to 134/209/210/256/257. Current preview keys such as `home:<originId>` are temporary dedupe hints, not production identity, authorization or a sufficient cross-domain key.

Use an explicit origin tuple: owner, context, domain, record ID or reviewed template ID, action purpose, and deliberate repeat/occurrence identity when applicable. Record evidence/guidance revisions and a minimal source snapshot. This avoids collisions between a pantry item, test, garden, notice or two inquiries for the same resource. Return canonical action ID, revision, state, schedule, permitted transitions, source status and any existing duplicate. Keep an independent generic bill/leak check distinguished from a particular saved meter record.

Save-to-Plan inputs include title (current UI max 160), optional all-day date or explicit timed schedule, timezone, origin and evidence references. An absent date is valid Saved for later. Test sample dates, result dates, observation times, food-added dates and document-generated dates are not automatically due dates. An optional suggested follow-up date becomes scheduled only through the user's explicit save.

Expose the same action in origin detail, Test Follow-up, Homeguard record summaries, Today saved-next-step and Plan. Completing/reopening changes workflow only. Routines project canonical action occurrences into Plan; the Homeguard view must not create a second independent recurring-task store. Invalidate related reads on acknowledged writes, revision changes, context changes and deletions. Navigation/closing a modal must not imply a durable save; retry unknown outcomes with the original idempotency key.

### Exact deletion policy

| Selected removal | Required retained or removed relationships |
| --- | --- |
| Test | Delete its results/corrections and exclusively bound attachments under retention policy. Cancel test-owned reminder/upload/extraction work. Retain independent garden, routine and saved action; remove/tombstone references and show missing origin. |
| Routine | Cancel its own future recurrence/reminders and remove selected private history when hard-deleted. Retain separate observations, tests and independently saved follow-up actions. |
| Moisture observation | Remove its private note/photo derivatives and selected history. Keep linked routine/test and independent action, without claiming repair completion. |
| Kitchen item or standalone note | Remove its private item/question fields. Keep independently saved Plan action and public catalogue/evidence. Stop only watches explicitly owned by that item, not general public-source follows. |
| Garden site | Remove site-private fields/history as selected; retain independent tests with their collection-context snapshot and independent actions. Do not reassign samples to current home. |
| Fish note, food question, grower inquiry, usage record | Remove that owned record/history and bound files. Public sources, linked tests/sites and independent actions remain. Never delete an entire public evidence object. |
| Source bookmark or follow | Removing bookmark and cancelling notifications are distinct operations unless user explicitly requests both. Public source history remains. |
| Action | Cancel its own occurrences/reminders and return removed-link status to origins. Do not delete the underlying test, food, observation or source. |
| Entire account | Original BE-263/312/332 orchestration applies across every added table, object, derivative, export, watch and queued job. No private history or sensitive tombstone survives beyond disclosed policy. |

Return an authorized deletion receipt containing operation ID, status, selected resource and revision, affected link identifiers/states, cancelled-work counts and cleanup status. Suggested link states: available, archived, removed, inaccessible; do not reveal another owner's existence. If file cleanup is pending, say so and continue a retry-safe cleanup job. Keep tombstones minimal and owner-scoped; they are not permission to retain deleted notes, results or household health details indefinitely. Client downloads cannot be recalled.

If attachments can intentionally have multiple domain references, define that ownership/binding model and retained-reference policy explicitly before deleting a shared object. The current simplest contract is an exclusively owned binding with separately authorized links. Do not destroy another retained record's only original file or retain an undisclosed copy after full deletion.

**Acceptance:** same origin saved twice creates one action, retry after lost response returns it, intentional repeat distinct, identical IDs in different domains do not collide, archived context does not transfer to new home, deletion while reminder leased suppresses send, removed links don't crash editors, cancelling action doesn't delete result, and no record creation silently creates a task.

## HGX-07 Bookmarks and subscriptions are different

Current `FoodFollow` holds `saved` and `following` independently. Preserve that distinction using an owned bookmark and an optional subscription, or a typed record with equivalent independent fields. Source type is fish/food/water/resource plus stable entity ID, saved revision, current revision, owner, home or selected scope, saved state and watch state. Bookmarking an old source keeps its historical reference; following subscribes to reviewed new source events. Neither creates a Plan task.

Subscriptions inherit original channels, quiet hours, timezone, expiry, consent, dedupe and cancel rules. A bookmark must remain usable when updates are unavailable. An unsupported watch must be disabled with a reason, not shown as successfully following. New subscriptions establish a baseline, not a flood of historic alarms. Source changes, withdrawal and correction are distinct from new environmental findings.

Copy and downloaded public reference must use the same canonical source/revision/scope payload, with title, source URL, dates, applicability and limitations. Never include household IDs, tokens, private notes, kitchen contents or private/user-specific precise locations in public share links. Official public advisory extents can remain in the public source reference under their source rights. Use an allowlisted public source destination; the private `/foundation/preview` URL is not an export API.

## HGX-08 Detailed food workspace projections

These are **already-planned domains**, with additional field-level implementation clarification. Do not create duplicate service families just because the frontend has multiple subpages.

### Fish advisories and private notes

Public selectors require stable waterbody/segment/jurisdiction IDs, disambiguating labels, exact reviewed extent and version, species/groups/aliases and exact official audience definitions. Match response returns each applicable current/historical rule, source revision, serving/frequency language, effective/withdrawn dates, scope, conflicts and missing-input reasons. Preserve statewide and local rules separately; do not sum allowances. Unknown audience/species or a conflicting unreviewed rule cannot return guessed personalized advice. The current extent diagram is illustrative; do not publish it as a legal boundary.

Private fish note fields: owner/ID/revision/title, kind (catch or consumption), observed date/timezone, optional waterbody context, original species label or canonical confirmed reference, original quantity/unit, optional private note, advisory ID/revision and correction history. Keep unresolved names and legitimate same-day records. CRUD, per-record/all-record export, confirmation before delete and privacy apply. No inferred intake dose or remaining allowance.

### Gardens and test links

Site fields: owner/ID/revision/title, setup/type, coarse county/context, irrigation source, explicit confirmation when shared with household drinking water, soil description, concern, questions, linked test IDs, created/updated dates and context history (including irrigation/soil/version). Household and irrigation source stay independent. Keep optional observations/actions/resources per original plan.

Link/unlink is an authorized revisioned operation and requires compatible site/context metadata. Creating a test from a site prefills a draft; it does not invent results or confirm the context. Saved tests retain their original collection snapshot across site edits or deletion. Duplicate labels are allowed. Site brief export includes exactly selected source/context/test/question fields, with private disclosure, not a certificate of crop safety.

### Notices, studies and private questions

Notice fields retain distinct kind (recall, study, sample or local notice), jurisdiction/distribution versus issuer address, food/form/product/lot scope, actual analytes, date types, lifecycle, source revision, official action and previous versions. Search/list filters and details use the same record set and coverage. Missing coverage is not an all-clear. A reference remains historical after termination or withdrawal.

Private question fields: owner/ID/revision/title, evidence ID and revision, question, optional private context/note and optional owned report ID. Save/update/delete never sends it to an issuer. Linked report transcription status remains visible; linking it for a question does not make it a matching food assay. Deleting question leaves source, report, bookmark and independent action intact. Expose correction/version behavior and selected export under the common contract.

### Grower resources and inquiries

Public resource fields: stable provider/program ID, version, service scope, region, concern/media/analytes supported, method/certification when actually verified, eligibility/funding limitations, costs/availability when verified, reviewed contact URL, requirements checklist and source/review dates. Compare two resources without converting unknown certification or price to zero or guaranteed eligibility.

Inquiry fields: owner/ID/revision/title, resource ID/version and requirements snapshot, optional garden site and test IDs, selected checklist IDs, questions, user-reported inquiry/application state, contact date, optional follow-up date, reference number and response. The current grower picker allows only user-confirmed transcription reports; preserve that gate and do not label them independently laboratory-verified. Current form may have one inquiry per resource; the contract must state whether additional episodes are allowed and use inquiry identity rather than public resource ID for distinct follow-ups. Opening a contact website sends no private checklist/files and is not an application or agency receipt. Edits/delete/export and removed-link handling apply.

### Water stewardship and own usage

Public drought fields: dated release/version, county FIPS/geometry scope, categorical area percentages (none/D0/D1/D2/D3/D4), source definition and previous releases. Explicitly distinguish mutually exclusive from cumulative percentages. Do not sum incompatible formats or assign county maximum to the home.

Utility fields: verified utility/PWSID crosswalk and association method, status, reason, effective and publication dates, separately reviewed official instructions, voluntary versus mandatory, source URL/version, cached/stale/unsupported state. Utility status alone does not provide a watering rule; county overlap alone does not verify service. Source follow reuses HGX-07.

Owned usage fields: owner/ID/revision/title, kind (`interval` total or cumulative `meter` reading), site/context and meter/account label or stable reference, start/end or observed date, original quantity/unit, basis (`measured`, `estimated`, `user-reported`), source, reset/replacement flag, optional note and correction reason/history including prior originals. Never erase a prior correction or infer exact physical usage from an estimated bill.

Comparison returns compatible flag, reasons, included record revisions, method/version and units. Check same site/meter, unit/method/basis, valid dates, equal comparable interval lengths where required, no overlap, disclosed gaps, and no cumulative reset/rollover ambiguity. Block subtraction of reset meters and automatic attribution of savings. Identical timestamps and estimated values need explicit rejection or a clearly separate unsupported state. Bill/leak follow-ups are explicit Plan workflows, not automatic records.

**Acceptance across F02 to F06:** ambiguous names, unknown audience, same-name different county, source withdrawal/conflicting rules, malformed empty feed, foreign/missing links, context change after sample collection, private question removal, inquiry resume and external-link cancellation, unequal/overlapping usage periods, meter reset, zero versus missing, export includes corrections, no private data sent to public providers.

## HGX-09 Household summary without an unnecessary service

The current PDF is generated on-device with `pdf-lib`, with Luna-themed progress, cancel/retry and download. HTML/image/print/native-share alternatives also exist. Backend work is to supply authorized canonical inputs and a reproducible selection snapshot; a model call, upload, new export worker or public summary URL is not necessary for this path.

Inputs: selected purpose, current/historical home context, private-record date interval, selected sections (scores, factors, tests, actions, maintenance, observations, gardens), individual selected/excluded IDs, optional appendix, explicit category/location/private-note/attachment-reference flags. Defaults include only the environmental scores/factors; private sections and extra sensitive fields are opt-in. Whole-account export is a separate X05 function, not this summary.

Snapshot contract, provided through existing typed reads or a thin authorized aggregation endpoint if necessary:

- Contract/schema version, snapshot ID/hash, generated time, current context and selected scope, each included entity ID/revision, relevant source/guidance/method revisions and original observation/sample dates.
- Two score states and all seven factor evidence, with existing measured/modelled/estimated/unscored/missing distinctions. No fixture values. Private well/spring branches must use their actual available evidence rather than an inferred utility match.
- In particular, the current Summary fixture makes the private-water composite unavailable, but the existing backend can legitimately return a radon-only Homeguard score with limited coverage. Use the authoritative score and coverage; do not change backend scoring to reproduce that fixture assumption.
- Selected test originals, units, qualifiers/limits, matrix/basis/method, collection/report dates, transcription review status/reason and correction version. Selected routine occurrence history keeps due versus actual date and source basis. Actions are canonical records, not a rephrased count of recommendations.
- Stable per-section available/empty/unavailable/omitted states and reason, counts, truncation/cursor or completeness. A failed optional section yields a visible omission; it cannot silently become an empty healthy section.
- Explicit date-selection semantics for each record kind. Tests use an identified collection/report/planned date according to documented precedence; actions use scheduled date or labelled undated; maintenance includes selected occurrence dates; observations use observed date/timezone; sites without an event date remain undated, not manufactured within-range records. Do not silently filter by whatever field happens to be present. Environmental evidence retains its original dates even when older than the private-record interval.
- Attachment names/references only when selected. The current H08 export excludes original file contents and metadata regardless of that switch. Downloadable original files belong to separately authorized H06/X05 operations.

Before composing, reauthorize selected IDs. If records changed since selection, return the actual versions and require review/regeneration, or use a permitted pinned snapshot. Do not mix old labels with new result rows. Selection, privacy flags, context and revisions are part of the generation key. Invalidate an old download when they change; cancellation or a failed attempt cannot expose a previous selection's file as the new one.

Keep free-text privacy honest: omitting dedicated location fields cannot guarantee a title/note contains no address. Show a content preview, not an absolute redaction promise. Local files have no server expiry and cannot be revoked after sharing. If a server-hosted export is later added, original authenticated job/status/cancel/expiry/deletion gates apply separately.

**Acceptance:** mixed source dates, private-water/no-data score, empty versus failed section, record deleted during generation, revision conflict, undated record, opt-in note/title containing location, no original photo metadata, selected attachment names only, no model/network upload, font/render failure fallback, cancellation, changed selection clearing old link and native-share cancellation treated normally.

## HGX-10 Luna on the added pages

The original X02 already requires effective capabilities, privacy choices, selected-record authorization and confirmed action proposals. The current assistant accepts `question` and an allowlisted `page`; it does not automatically understand every open test/food/form or an entire conversation transcript. Do not claim otherwise just because the panel appears on each page.

Keep basic page suggestions and cited question answering. For expanded help, add agreed allowlisted domain context tokens and explicitly selected record/evidence references, loaded and authorized server-side. Do not send form drafts, inventory, reports, notes, photos or household categories merely because a page is open. Expose effective `sends_household_context` behavior and consent/version before sending; the existing contract omission is already recorded in ST-067.

Expand the reviewed guidance corpus for tests, moisture, food-study limitations, notices, garden questions and usage comparisons using the same versioned source store. Missing corpus coverage yields an honest limitation, not fabricated advice. Retrieved documents remain untrusted data. Local PDF generation and the robot carry no assistant consent implication. Any proposed action still needs a preview, current authorization, expiry and exactly-once explicit confirmation under the original contract.

## HGX-11 Common implementation contract

The original BE/HO security and operational requirements remain mandatory. This list binds the new kitchen and clarified link/projection work to them:

1. Verified session supplies owner. RLS and same-owner parent/child constraints apply to every private table, attachment, snapshot and foreign link. Public source writes require operator/service authority. Guessable IDs and URL parameters are not authorization.
2. Typed, bounded schemas with original values and clear optional/null semantics. Stable pagination and secondary sort ID; applied filters, coverage, truncation and source versions in lists. No generic unvalidated JSON store as the entire domain model.
3. Retryable creates use owner/operation/request-hash idempotency. Updates/deletes use expected revision; conflicts preserve the draft and return only the current authorized record. Unknown mutation outcome is reconciled, not automatically repeated with a new key.
4. Multi-record writes are transactional: test confirmation/revision/state; action/occurrence/reminder; occurrence completion/next generation; source publication/event/outbox; home-context transition. A disabled frontend button is not a transaction.
5. Safe errors and unavailable/empty/stale/missing distinction. A code-present endpoint with no acquired data is not an enabled capability. Never replace missing data with a review fixture.
6. Private files use intent, quarantine/type/size/checksum/scan, authorized finalize, bounded short-lived read and cleanup of originals/derivatives. Inspect file bytes, not only extension. No arbitrary file path/URL from the client. Default proposed size remains the original 10 MB gate, not a new guarantee.
7. Source registry and reviewed publication retain parser/content/method versions, provenance, coverage, allowed uses, failure policy and actual source dates. No additional calls per animated frame, keystroke or household when public cached data can be shared under terms.
8. Watches/reminders use one durable queue/outbox, dedupe, retries, cancellation/deletion rechecks and verified cadence. Current daily cron alone cannot provide the planned timely reminders. Opt-in channels remain independent of saving an action.
9. Anonymous-session-loss disclosure, supported recovery, selected export, deletion and retention extend to every added record. Do not silently replace identity during a valuable write. Private drafts are session-only unless an explicit identity-bound persistence design is approved.
10. Keep frontend adapters separate from review providers. Preserve approved geometry/content while replacing fixtures, hardcoded sample IDs/dates/region, source labels and simulated statuses with canonical responses. Routing into planned pages must remain honest until implemented.

## HGX-12 Delivery and verification checklist

Vibhav should supply, per dependency-bounded package:

- Agreed versioned executable API schemas and generated TypeScript types, including all error and partial states; a field map from current prototype models to canonical DTOs.
- Additive migrations, constraints/RLS and rollback notes; schema-only baseline and deployment ledger checked by an authorized operator. No secret values or private rows in handoff fixtures.
- Source import/parser/review evidence with original dates and units, provider-rights/coverage decisions, real unavailable reasons and source-specific flags. General food identity coverage and chemical coverage are reported separately.
- Redacted success, empty, partial, stale, unsupported, validation, conflict, unauthorized, rate-limit and service-failure fixtures. Use synthetic identities and isolated staging for mutation tests.
- Tests for each HGX section plus inherited requirement IDs. Link code, tests and remaining gates in the tracker rather than marking a page done because its GET returns 200.
- Frontend integration evidence for save, reload, reopen/edit, cross-page reflection, cancellation, retries, deletion and export. Do not count session-memory previews as backend persistence.
- Operational checks for source refresh, reminder dispatch/cancel, private file cleanup, complete account deletion and backup/restore with deletion replay before valuable records are accepted.

### Required end to end journeys

1. Today refresh with one failed factor preserves other factors and original timestamps; history truncation stays visible; no fabricated factor score or change claim.
2. Household read outage cannot erase selections; successful edits update Today guides and Homeguard figures; category removal keeps historical actions and uses general direct-link guidance.
3. Public-water, well, spring, no-match and lookup-error Homeguard variants remain distinct; creating a home test never alters public evidence or the composite score.
4. Prepare or import a test, record only actual milestones, attach/review a private original, save ambiguous rows, correct/confirm, compare only compatible results, create one follow-up and see the same state in Plan after reload.
5. Create a routine and moisture observation, link a test, complete/skip/snooze/pause/replace, verify recurrence dates and Plan reflection, then delete the routine without deleting the separate observation or test.
6. Add catalogue and custom foods to three storage areas, inspect study findings while item levels remain unknown, edit/move/remove, and preserve an independently saved question/action without a dead link.
7. Review fish rules with explicit audience/species/waterbody; conflicting rules abstain; save reference and follow independently; edit/export/delete optional notes without changing advisory calculations.
8. Create garden with distinct irrigation, link tests, change site context without relabelling old samples, prepare a grower inquiry and explicit follow-up; opening official contact sends no private data.
9. Review a notice's exact scope/lifecycle, save a private question/report reference, withdraw/update the source and show that state without inventing a current contamination finding.
10. Read drought and verified utility instructions separately; enter/correct meter and interval records; reject incompatible comparisons and reset subtraction; explicitly schedule bill/leak follow-up.
11. Generate a selected household PDF with original dates/revisions, omit failed optional sections honestly, cancel/retry/change privacy choices, and ensure no previous artifact or unselected sensitive field leaks.
12. Repeat core writes with two identities, two tabs, stale revisions, interrupted responses and deletion while work is queued. Test expired auth, no network, rate limits and restored data without production mutations.

### Verification performed for this audit

- Fetched GitHub refs without checking out or merging changes into the frontend worktree. Inspected main and the current backend branch, including the partial-spec intake notice.
- Reviewed current frontend routing, state providers, models, helpers, interactions and relevant tests against the original feature/shared requirement blocks and later deltas.
- Re-ran local `npm test`: **426 passed, 0 failed**. Existing Node module-type warnings remain. These are local logic tests, not proof of the new remote branch's runtime, deployed RLS or expanded live journeys.
- Documentation/manifest checks verify source fingerprints, original packet preservation, requirement references and enumerated view coverage. They do not prove scientific correctness or deploy new services.
- No app/backend source changed, no new wireframe release, no GitHub commit/push/PR and no production write were performed for this audit.

### Remaining release gates

Expanded private APIs, migrations, sources and adapters still need implementation and isolated end-to-end validation. Factor `/100` semantics, legal/scientific interpretation reviews, Google/Mapbox/provider rights, actual fish-rule review, food evidence scope, operational schedules, optional recovery and source availability remain the original explicit gates. No backend can manufacture a current PFAS/lead measurement for every food. These are tracked limitations, not omissions to conceal.

## Frontend integration work that backend completion cannot replace

This audit did not change the app. Preserve these findings in the frontend implementation tracker so a successful backend build is not mistaken for a finished integration:

| Finding | Required integration action |
| --- | --- |
| `FoodEvidence.tsx:37` and `FoodGrower.tsx:34` submit the newest collection revision with a retained older draft | Capture expected revision when the draft opens. Do not silently upgrade it on submit; handle conflict and explicit reapply. Server revision checks cannot protect a client that misstates its baseline. |
| Preview deletes take only ID | Send expected revision and reconcile the authoritative delete/cleanup outcome. Keep the confirmation open with retry/error feedback. |
| Grower inquiry lookup/action key is currently resource-only | State the allowed cardinality. For separate site/consultation episodes use inquiry IDs and distinct origins, not an accidental overwrite of another site's inquiry. |
| Private question and inquiry types omit source/requirements revision snapshots | Add those fields to adapters/drafts and show source-change review state. Server must not silently bind an old question to a newer source. |
| Source-specific live states are broader than global review scenarios | Implement per-source unsupported, no-match, unavailable, parser-review/quarantine, stale, expired, withdrawn and locale fallback states. |
| Current Summary contains sample scores, dates, county and water-context control | Replace all sample assumptions with the authorized projection and retain the actual private-water score/coverage rule above. |
| Kitchen's item status cannot change from Unknown in the current code | Keep that honest default; build explicit supported item-sample matching UI only if its source/capability gate is met. Study statistics remain separate. |
| Existing original-plan items are not all represented in these wireframes | F03 optional garden observations/moisture/rainfall, relevant notice matching and structured consultation records still need frontend reconciliation; F04 exact product/lot comparison and source-bound question handoff are not complete just because explanatory copy exists. They remain original planned work, not newly invented requirements or ready screens. |
| Luna launcher exists everywhere but passes only basic page/question context | Implement disclosed selected-evidence/record context when enabled. Keep private drafts out of automatic context. |
| New English inline content and generic risk labels | Follow reviewed locale/fallback requirements and no-em-dash sanitization; align ring accessibility copy with actual contribution semantics. |

### Input bounds and server parity

These are observed current frontend limits, not permission to truncate source records. Check them into the agreed executable contract or deliberately update both sides together. Limits for fields without a current bound are still a server release requirement under original HO-119/BE-253.

| Fields | Current limit or rule |
| --- | --- |
| Test title/provider/sample label/method | 160 characters each |
| Test purpose/correction reason | 600 characters |
| Result analyte/original value text | 120 characters |
| Original or limit unit | 40 characters |
| Limit text/sample basis | 80 characters |
| Report reference | 160 characters |
| Routine/observation title, model, source, room | 160 characters |
| Instructions, maintenance event note, moisture private note | 2,000 characters |
| Routine interval | Integer 1 through 365; days or months; independent date and recurrence validation still required |
| Moisture unit | 40 characters; relative humidity 0 through 100 when that exact measurement applies |
| Kitchen label/question | 80/500 characters; question optional for inventory, required for standalone food note |
| Plan title | 160 characters; date optional and calendar-valid |
| Test-file review | Preview permits PNG/JPEG/PDF up to 10 MB; production shared attachment capability must specify verified types and limits |
| Moisture-photo review | Preview permits PNG/JPEG/WebP up to 5 MB; no durable upload exists yet |
| Remaining food/site/inquiry/question/usage fields | Explicit server enums, length/count/byte/date/unit and relation limits needed; current HTML controls are not a complete validation contract |

Set maximum analyte rows, linked IDs, checklist entries, history/list pages, attachment count and aggregate export size. Preserve originals when a record is too ambiguous to interpret; reject over-limit input clearly rather than silently cutting laboratory text. Do not turn user-entered arbitrary units into approved conversion units.

### Exact preview view inventory

These are screen states, not a request for one backend endpoint per view. Shared components and services should serve them:

- Tests: `list`, `overview`, `new`, `prepare`, `report`, `detail`, `edit`, `arranged`, `collect`, `awaiting`, `results`, `attachments`, `history`, `compare`, `export`.
- Maintenance: `list`, `create`, `edit`, `detail`, `occurrence`, `observation`, `observation-edit`, `observation-detail`.
- Food and Garden: `list`, `pantry`, `pantry-saved`, `pantry-custom`, `pantry-add`, `pantry-detail`, `pantry-note`, `pantry-edit`, `fish`, `fish-detail`, `fish-notes`, `fish-note-new`, `fish-note-detail`, `fish-note-edit`, `gardens`, `garden-new`, `garden-detail`, `garden-edit`, `garden-links`, `evidence`, `evidence-detail`, `growers`, `grower-detail`, `water`, `usage`, `usage-compare`, `usage-new`, `usage-detail`, `usage-edit`.
- Summary: default selection state (`list`), explicit `selection`, `preview`; PDF progress/download/cancel/retry and alternate-export states inside the preview.
- Shared: loading, empty, error/retry, offline/no-queue, stale, revision conflict, failed save, missing record, retained draft, delete confirmation and success feedback. Review simulation controls are not production APIs.

## Source and view traceability

The companion `HALO_TODAY_HOMEGUARD_AUDIT_MANIFEST.json` records inspected file hashes, current route/migration inventories and each Homeguard view family. Primary code anchors:

- Today and core Homeguard: `components/foundation/PersonalHero.tsx`, `FactorSteps.tsx`, `FamilyGuidance.tsx`, `HomeHousehold.tsx`; `components/stage/StageApp.tsx`, `HomeEvidence.tsx`; `lib/frontend/stage-data.ts`, `factor-preview.ts`.
- Shared/auth/error bridge: `components/stage/StageSession.tsx`, `StageSettings.tsx`; `lib/frontend/api.ts`, `stage-api.ts`; backend-branch `app/api/profile/route.js`, `household/route.js`, `learn/route.js`, `history/route.js`, `lib/apiErrors.js`.
- Expanded routing/actions: `components/expanded/ExpandedConnections.tsx`, `ExpandedPreviewState.tsx`; `lib/frontend/expanded-preview.ts`, `navigation.ts`.
- Home workspace: `components/homeguard/HomeguardWorkspace.tsx`, `HomeWorkspaceState.tsx`, `HomeWorkspaceUI.tsx`. Provider state is explicitly in-memory, with no transport/auth/storage.
- Tests/maintenance: `TestsWorkspace.tsx`, `TestProgress.tsx`, `MaintenanceWorkspace.tsx`; `lib/frontend/home-test-preview.ts`, `home-maintenance-preview.ts`.
- Food: `FoodGardenWorkspace.tsx`, `FoodPantry.tsx`, `FoodFish.tsx`, `FoodGarden.tsx`, `FoodEvidence.tsx`, `FoodGrower.tsx`, `FoodWater.tsx`, `FoodShared.tsx`, `PublishedFoodEvidence.tsx`; `lib/frontend/home-food-preview.ts`, `food-pfas-guide.ts`, `food-catalogue.ts`, `food-evidence.ts`.
- Summary: `SummaryWorkspace.tsx`, `SummaryReport.tsx`, `lib/frontend/household-pdf.ts`.
- Original handoff: [full working specification](ai/HALO_BACKEND_WORKING_SPEC.md). Later sources: [backend delta](HALO_BACKEND_AND_DATA_PLAN.md#october-3-homeguard-integration-delta), [food extension](HALO_FOOD_EVIDENCE_EXTENSION.md), [frontend plan](HALO_FRONTEND_BUILD_PLAN.md), [acceptance](HALO_FEATURE_ACCEPTANCE.md), [workflow](../WIREFRAME_WORKFLOW.md).

The audit maps the current built scope, not every future Act/Plan/Map screen. Those original feature packets remain intact and required in the complete specification. Backend completion and frontend integration are separate acceptance steps; connecting endpoints alone does not eliminate the adapter, privacy, data-quality and device tests above.
