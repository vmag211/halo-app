# HALO Frontend Build Plan

Version 1.1, October 2, 2026. This companion turns the [Master Plan](HALO_MASTER_PLAN.md) into a screen, control, state, and integration inventory for all 45 feature areas. It is for Yogi's design and implementation work and Vibhav's integration work. It describes the complete target, not completed screens, approved new visuals, or verified production readiness.

The [Backend and Data Plan](HALO_BACKEND_AND_DATA_PLAN.md) defines server records and contracts. [Feature Acceptance](HALO_FEATURE_ACCEPTANCE.md) defines release evidence. This document adds the frontend responsibilities between them. Proposed component and route names below are implementation recommendations, not files or APIs that already exist. Keep the existing application, approved design, and data clients as the foundation; do not create a disconnected replacement app.

October 3 source audit: consult the [Backend Build Handoff](HALO_BACKEND_BUILD_HANDOFF.md) and [Source Acquisition Guide](HALO_SOURCE_ACQUISITION_GUIDE.md) before adding live source-dependent controls. In particular, Google Pollen storage/map attribution, Mapbox persistence, full fish-rule review, food recall lifecycle and utility restriction scope are explicit integration gates. Fixtures must not conceal these limitations. Today and its existing detail pages keep their approved content depth.

October 3 Homeguard refinement: the test timeline, Food at home kitchen inventory and generated household report requirements below add to this version. They are wireframe requirements, not approval or proof of production persistence. The backend packet already handed off predates these additions; reconcile the [new integration delta](HALO_BACKEND_AND_DATA_PLAN.md#october-3-homeguard-integration-delta) before wiring them.

October 3 food evidence extension: the [food evidence and kitchen addendum](HALO_FOOD_EVIDENCE_EXTENSION.md) specifies custom food entry, a shorter add flow, separate PFAS/lead study findings, and wider catalogue/product lookup contracts. A historical study is never copied into the household item's chemical level. The review includes 148 catalogue foods, custom entries and four reviewed FDA study records, not comprehensive chemical coverage or live product lookup. Yogi subsequently removed all actual food photographs, including list thumbnails and detail portraits. Use the small illustrated food icons only; no photo placeholders or photo-credit panels. Photo delivery is no longer a frontend or backend requirement for this food UI. Details, original units and sources stay available on each matched food. Unknown foods still save and show guidance without fabricated estimates. A food label can be edited without changing its explicitly displayed catalogue type; custom labels are not silently matched to chemical evidence.

Timeline refinement uses a blue paper-carrying Luna with a 4.2-second first-view animation, sequential checks only for recorded facts, reduced-motion completion, and pencil editors. Unrecorded earlier stages remain unrecorded; a collapsed earlier-step menu permits adding actual facts. Garden utility controls and test linking are separated into compact rows and a focused link editor, preserving all prior record/Plan behavior.

## Verified repository starting point

October 3 navigation/action refinement: Homeguard's overall score is followed by its PFAS, radon and lead cards, then household context and the house. Generic educational tips and family/category guidance no longer expose Save this step. Do not treat a source observation date as a task due date or make ordinary advice calendar-saveable by default. Retain saving where an actual dated action or explicit Plan/calendar workflow exists, including tests, maintenance and chosen record follow-ups; those workflows may still save an unscheduled task for later. Preserve all guidance and existing saved actions. This supersedes blanket tip-saving language elsewhere in the original plan.

These statements describe inspected repository files, not the current deployed website. The [approved-stage handoff](../foundation/STAGE_FRONTEND_HANDOFF.md) records the prior verification scope and outstanding integration checks.

| Existing surface | Actual code boundary | Reuse and required change |
| --- | --- | --- |
| Onboarding | [OnboardingScreen](../../app/OnboardingScreen.tsx), [WelcomeTitle](../../components/onboarding/WelcomeTitle.tsx), [ResultsReveal](../../components/onboarding/ResultsReveal.tsx), onboarding CSS | Preserve approved flow, true handwriting, logo, input behavior, retries, result reveal and reduced motion. New optional features do not become mandatory onboarding fields. Home-context transition requires additive contracts. |
| Live route group | [StageApp](../../components/stage/StageApp.tsx) under [the live layout](<../../app/(halo)/layout.tsx>) | Currently supports Today, Homeguard, seven factors, family, seven household categories, essential Settings. Its route allowlist must be extended deliberately; adding a new page file alone does not mount its session or shell. |
| Identity and initial data | [StageSession](../../components/stage/StageSession.tsx) | Reuse profile gating, abort and identity checks, readings/history/Learn/alerts handling. New page queries should load on demand rather than adding every domain to startup. |
| Protected requests | [api.ts](../../lib/frontend/api.ts), [stage-api.ts](../../lib/frontend/stage-api.ts), [types.ts](../../lib/frontend/types.ts) | Reuse the protected transport and cancellation. Extend typed domain clients and error parsing; no second authentication path or direct provider key in a component. |
| Approved live presentation | [StageRuntime](../../components/foundation/StageRuntime.tsx), [stage-data.ts](../../lib/frontend/stage-data.ts), [stage-values.ts](../../lib/frontend/stage-values.ts) | Keep strict data adapters and honest null handling. A production route must always receive explicit live state. Missing runtime must never select realistic preview fixtures. |
| Score and factor presentation | [PersonalHero](../../components/foundation/PersonalHero.tsx), [SegmentedScore](../../components/foundation/SegmentedScore.tsx), [FactorScoreCard](../../components/foundation/FactorScoreCard.tsx), [FactorTrend](../../components/foundation/FactorTrend.tsx), [FactorSteps](../../components/foundation/FactorSteps.tsx), [FactorReadingGuide](../../components/foundation/FactorReadingGuide.tsx) | Preserve approved geometry and interactions. Names such as PersonalHero are internal legacy names, not authority to rename Today. Extend behavior through reviewed props/composition, not copied page implementations. |
| Household and home evidence | [FamilyGuidance](../../components/foundation/FamilyGuidance.tsx), [HomeHousehold](../../components/foundation/HomeHousehold.tsx), [HomeEvidence](../../components/stage/HomeEvidence.tsx) | Reuse selected-category figures and dedicated guidance. Keep private-water tests, excluded compounds, source dates, service-line scope and ranked actions. New task/record links use stable IDs. |
| Shared controls | [Foundation](../../components/ui/Foundation.tsx), [Button](../../components/ui/Button.tsx), [DataState](../../components/ui/DataState.tsx), [FieldError](../../components/ui/FieldError.tsx), [SeverityPill](../../components/ui/SeverityPill.tsx) | Reuse cards, sheets, segmented controls, chips, switches, callouts, empty states and status vocabulary. Extend only where a new interaction needs it. Existing primitives are not proof every new composition is accessible. |
| Ambient design | [EnvironmentalScene](../../components/foundation/EnvironmentalScene.tsx), [SceneExperience](../../components/foundation/SceneExperience.tsx), [scene-clock.ts](../../lib/frontend/scene-clock.ts), [RisingSun](../../components/foundation/RisingSun.tsx) | Preserve approved light, dark, clock and reduced-motion behavior. Scene time is decoration, not observed weather. New illustrations need review and performance checks. |
| Luna | [LunaAssistant](../../components/foundation/LunaAssistant.tsx), [LunaMark](../../components/foundation/LunaMark.tsx) | Keep approved panel and symbol; currently questions are sent with a page token, without a multi-turn or action-proposal contract. Add capabilities and confirmed proposals before showing richer controls. |
| Essential Settings | [StageSettings](../../components/stage/StageSettings.tsx) and accessibility controls in StageApp | Keep explicit Save, fresh identity/profile preflight, seven-flag replacement semantics, retained failed drafts and change-address confirmation. Full notifications, language, privacy and recovery still need screens. |
| Return routing | [stage-routing.ts](../../lib/frontend/stage-routing.ts) and StageApp sheet history | Existing allowlist excludes all new route families. Extend route validation, section anchors, active-tab ownership and notification targets together. Keep open-redirect defenses. |
| Local storage | [storage.ts](../../lib/frontend/storage.ts) and StageApp device preferences | Existing identity-scoped environmental cache and completion marker are not a generic private-record store. Accessibility lives in `halo.device.accessibility`. Never put Journal, letters, tests, files or transcripts into this cache as an incidental extension. |
| Map wireframe | [MapPreview](../../components/map-preview/MapPreview.tsx), [MapCanvas](../../components/map-preview/MapCanvas.tsx), [DistrictPanel](../../components/map-preview/DistrictPanel.tsx), [Map notes](../map/README.md) | Fixture-driven, unapproved preview with review controls and simulated request states. Preserve the work, but implement production adapters/renderer only after review. Importing this page as the live map would not integrate it. |

The repository currently has no production `/map`, `/journal`, `/act`, or `/plan` page. The old five-item stage navigation has later-stage buttons, not completed destinations. Map, Journal, Act and notification backend routes exist separately; their presence does not mean production frontend screens exist.

The current root layout provides metadata, favicon/apple icon and local fonts, but these are not a completed installable/offline application. The browser push permission/subscription client and service worker are not delivered merely because server push endpoints exist. Those remain explicit frontend work below.

## Navigation and continuity implementation

The target tab structure is **Today, Homeguard, Act, Plan**. Plan's label and the final arrangement still require Yogi's confirmation. Map belongs under Act and Journal under Plan, with direct contextual entry elsewhere. Existing approved routes remain working.

| Destination family | Target entry and owning tab | Exit and deep-link behavior |
| --- | --- | --- |
| `/today`, `/factors/air`, `/factors/uv`, `/factors/pollen`, `/factors/mold`, `/family` | Today and relevant alerts | Preserve approved section hashes and back to originating factor or Today. |
| `/home`, `/factors/pfas`, `/factors/radon`, `/factors/lead`, `/household/[member]` | Homeguard and contextual home links | Back restores house/compound/section context. Deselected category does not display fixture people. |
| Proposed `/home/tests`, test detail/edit; maintenance and summary routes | Homeguard, selected action, relevant factor | Private record ID is authorized on load. Missing/deleted record has an explicit outcome and useful parent link. |
| Proposed `/home/food-garden` and its five branch routes | Homeguard plus relevant Act/Map links | Subpages return to selected site, advisory or list filters, without encoding sensitive draft fields in URLs. |
| Proposed `/act` and organization/opportunity/project/outreach/observation routes | Act and evidence-based suggestions | External handoff preserves private drafts in the supported session. Returning does not imply registration or submission. |
| Planned canonical `/map` | Act, water/air/advisory detail, public links | Public layer/filter/record IDs may be shareable. Restore viewport and selection; never share the home pin by default. |
| Proposed `/plan`, action and outdoor-plan detail | Plan and Save/Schedule links anywhere | Same action ID everywhere. Calendar selection remains when returning; cancelled source event is not silently deleted. |
| Planned canonical `/journal` plus Patterns and recap destinations | Plan, optional Today check-in, alerts | Support validated date/category/summary entry. Keep private note text out of URLs. |
| `/settings`, proposed subsections, source/topic detail | Global menu or contextual help | Return to allowlisted origin; preserve unsaved form state when opening help. |

Before route migration, enumerate the actual URLs emitted by existing alerts, exported links and source references. Support those known formats through allowlisted translation or aliases when the corresponding screens ship. Do not invent a claim that nonexistent page routes are already delivered. An unsupported target must show a useful unavailable destination, not silently become Today.

Use one typed navigation registry for route ownership, titles, safe returns and notification targets. Keep query validation independent from rendering. Dialog/sheet open adds one history entry; switching its content replaces that entry. Close restores opener focus, underlying scroll and relevant selection. Directly linked sheets close without an unexpected extra Back. Private forms need a discard-confirmation path for internal navigation and best-effort browser-exit protection, with no promise that a mobile browser will always deliver an unload event.

Separate route access requirements from the active tab. Public Map/district, organization and opportunity exploration must have a mode that does not require address onboarding. Reuse the current anonymous-token bootstrap or a separately reviewed public-read interface, but do not call current authenticated APIs unauthenticated. Hide home pins, household ranking and matched guidance until profile data exists. This needs a deliberate session-gate change, not removal of authorization from private routes. Any new onboarding Browse your area entrance requires visual review.

## State and component ownership

| State | Owner and lifetime | Required behavior |
| --- | --- | --- |
| Verified identity and current home context | Existing session boundary, extended with server context version | Identity change clears private views, drafts, request owners and subscriptions before new data loads. Home change invalidates current-home queries but retains historical associations. |
| Server records | Typed domain clients and scoped query state | Keys include owner, context, record revision, filters and language where applicable. Server is authoritative; no speculative success or client-only ownership checks. |
| Form edits | Local form state tied to owner and record revision | Dirty fields survive retry/refetch. New identity hides/discards the prior household's draft. Optional persistent drafts require a separately reviewed private-store policy. |
| Selection and navigation | Validated URL for nonsensitive public state; session memory for private selection/scroll | Browser Back works. Secrets, notes, precise locations, household flags and conversation contents never enter query strings. |
| Device choices | Existing accessibility preference mechanism | Text scale, reduced animation and high contrast persist locally when storage works. Appearance remains device-driven. Language scope is specified separately before implementation. |
| Preview scenarios | Isolated fixture adapter and review-only controls | Never create live accounts, write production data, send push or fall through to live API on an unmatched fixture. No preview import as a production fallback. |

Recommended reusable components below are new proposals. Implement only after the first real screen establishes the need; do not create a generic framework for every possible page.

| Proposed component | Responsibility and contract |
| --- | --- |
| EvidenceSummary and SourceDetail | Value/units, evidence kind, scope, original dates, status and supporting source; distinguishes normal data from missing/withdrawn/qualified results. |
| SaveAction and ActionDetail | Deduplicate equivalent recommendations, edit user fields, preview reason, save/schedule explicitly, show confirmed state and linked origin. |
| ScheduleEditor and Agenda | All-day versus timed items, timezone, recurrence scope, reminder channel and status; no hidden calendar synchronization. |
| RecordForm and AttachmentReview | Field validation, dirty-state retention, revision conflict, file upload state, extraction confirmation and private preview. Domain-specific sections remain typed. |
| SourceUpdateNotice | Show what changed and the dated before/after references without overwriting a user's action or text. |
| ChartWithTable | Consistent units, point inspection, gaps, readable table, method/source link and source-specific resolution; no fabricated interpolation. |
| FilteredResults | Search/filter/reset, result count/coverage, pagination, preserve filter state and distinguish no matches from failure. |
| SharePreview | Choose included sections, disclose sensitive content, create/print/download/share, cancellation and permission fallback. |
| ConfirmationDialog | Correct operation scope, record name/count, reversible versus permanent effect, pending/failed/confirmed outcome and focus return. |

Do not add a heavyweight new state library merely to appear advanced. Extend the current patterns first; adopt a query library only after evaluating invalidation, deduplication, server/client compatibility and migration cost. Read the installed Next.js guides before future framework code changes.

## Complete screen and interaction inventory

Every row inherits the common states and form rules later in this document. The rightmost column names dependencies, not a claim that the extension is present. Backend operation groups are defined in the [backend companion](HALO_BACKEND_AND_DATA_PLAN.md).

### Entry and Today

| Feature | Screens and visible controls | Data and behavior needed |
| --- | --- | --- |
| G01 Entry and onboarding | Approved Welcome, address/ZIP and optional location, household chips/skip, home details, results, Back/Next/retry, change-address confirmation | Existing onboarding/profile flow. New home transition review lists records that stay with old home and portable tasks requiring a choice. Keep optional new-feature setup out of this flow. |
| T01 Today | Score hero, four factor links, contribution explanation, meaningful-change disclosure, refresh, alerts, family link below cards, optional existing action/check-in entry | Existing daily/history/alerts. Proposed changes endpoint supplies compatible comparison and cause of change. Missing factor score remains Not scored; no client formula. No PFAS card or Today contribution. |
| T02 Air | AQI/pollutant, provenance, trend and table, point detail, explanation, practical-step deck, monitor map link, compare forecast times, Save action and optional Log this day | Existing reading/history/Learn; forecast and action extensions. Display measured versus modelled and monitor versus regional scope. Native AQI is not the HALO score. |
| T03 UV | Current index, approved rising half-sun protection window, available maximum, trend/table, protection steps, Plan outdoors, Save preparation | Existing UV/window/history/Learn; interval forecast extension. Null window is unknown, not all-day low; graph does not fabricate hourly data from endpoints. |
| T04 Pollen | Tree/grass/weed selector, individual labels/readings, dominant category, compatible trend, seasonal explanation, steps and Plan link | Existing category data/history/Learn; forecasts where supported. Selector retains focus and does not imply that switching category compares the same series. |
| T05 Mold | Estimate heading, humidity/rainfall basis, uncertainty, moisture guidance, Record an observation and Follow up | Existing proxy/Learn; H07 private observations. No spore count or chart without data. Indoor observation stays separate from the outdoor estimate. |
| T06 Daily household | Selected category navigation, applicable current factors, Outdoors/At home context where supported, concise guidance, Save/Open existing action, Edit household | Existing profile/Learn plus compiled guidance/action links. General advice works with no category; one task reused across overlapping categories. |

### Homeguard

| Feature | Screens and visible controls | Data and behavior needed |
| --- | --- | --- |
| H01 Home overview | Approved score and source basis, selected-category house, water/radon/lead links, returned action priorities, compact Tests/Maintenance/Food and Garden/Summary entrances | Existing home/profile/household responses plus owned record summaries. Missing/private water cannot produce an inferred healthy total. Essential coverage stays visible, not hidden in a tooltip. |
| H02 Water and PFAS | Utility identity/match basis, compound selector, sample table/history, threshold detail, excluded/unregulated rows, private-water test plan, map/watch/test/outreach actions | Existing home evidence plus sample provenance, subscriptions and tests. Well and spring branches are distinct from utilities. Unknown association has correction flow, not arbitrary client reassignment. |
| H03 Radon | County zone explanation, test options, own-test timeline, Schedule/Start/Record result, professional follow-up and source detail | Existing regional estimate plus tests/actions. User result is separate dated evidence, never a county-zone replacement. Pending test has no result badge. |
| H04 Lead | Unscored estimate, home-year correction, utility-wide service-line information, property-specific question, test and follow-up links | Existing estimate/inventory plus records/actions. Unknown home year stays unknown. A utility total is not the home's pipe material. |
| H05 Household guides | Seven preserved category routes, selected category summary, applicable factors/tasks/tests, practical-step deck, source links and back to house | Existing category booleans/guidance plus records. Child/teen/adult may reuse general text. Deselecting removes figure but not historical records; unsupported category links have a safe state. |
| H06 Tests and records | Filtered list, animated Luna progress timeline with per-stage pencil editors, arrange/sample/result forms, attachment review, correction history, compatible comparison, one linked follow-up, export/delete | New tests/results/private files and Plan contracts. Completed stages depend on recorded facts, not the furthest status. Form schema below preserves matrix, dates, qualifiers and original units. Unclear results can be saved uninterpreted with a visible reason. |
| H07 Maintenance and moisture | Asset/routine list, detail, create/edit cadence, occurrence detail, moisture/leak record, complete/skip/pause/replace, linked test and instructions | New asset/observation records plus shared action occurrences. Renter alternatives remain available. Completion-relative and fixed-calendar schedules are distinct. |
| H08 Household summary | Purpose/section/date selection, sensitive-field review, Luna generation progress, downloadable PDF and compact report-ready view, optional appendix, print/image/share | Prefer client-side PDF creation from selected data, not a long HTML page as the final deliverable. Partial section failure is local; two-score/all-factor capability preserved. No public private-summary link by default. |

### Food and Garden

| Feature | Screens and visible controls | Data and behavior needed |
| --- | --- | --- |
| F01 Overview | Optional interest chips, relevant verified updates, five destination links plus Food at home kitchen inventory, saved advisory/site continuation and coverage explanation | New preferences, advisory/site/watch summaries and optional private kitchen records. No questionnaire wall. General guidance without local evidence remains useful and honestly labelled. |
| F02 Fish advisories | Waterbody search/extent, species and official audience selectors, advisory detail, overlap explanation, source, map, save/follow/share, optional catch/consumption form | New reviewed matching/versioned advisory service; private optional records. Do not approximate official audiences from HALO household flags or calculate remaining allowances. Ambiguous/no match must not look safe. |
| F03 Garden workspace | Site list/create/edit/detail, known and unknown water/soil context, records, questions, testing preparation, consultation follow-up, export site brief | New site contexts and shared tests/actions. Irrigation source separate from household drinking source; source changes retain older record context. No crop safety score. |
| F04 Food evidence | Supported region/category filters, local notices separated from broader studies, record detail/applicability, follow/source/share/question controls, optional private report link | New reviewed food reports. Preserve product/lot or sample scope. Unsupported local data has source/contact options, not a fictional regional food score or farm ranking. |
| F05 Grower resources | Concern/region selector, service/program list, scope comparison, requirements checklist, official contact/application, private progress/reference and follow-up | New curated resource/program contracts and shared preparation records. Lab matrix/analyte/method scope shown. Application opened, user says applied and approval are different states. |
| F06 Water stewardship | Regional drought distribution/history, separate applicable utility notice, follow, stewardship tasks, optional usage list/entry/comparison/export | New drought/notice source adapters and private use records. County distribution not household class. Compare compatible periods/units; show measured difference, not attributed savings. |

### Act

| Feature | Screens and visible controls | Data and behavior needed |
| --- | --- | --- |
| A01 Act overview | Relevant issue, Get involved, Explore your area, Speak up, Ways to help, saved continuation, cause/area browsing | Existing organizations/home/map plus reviewed recommendations/projects. Maintain household-summary entry. No elevated finding still yields useful participation options. |
| A02 Organizations | Search/filter list, organization detail, mission/service scope, verification date, actual contacts, related opportunities, Save contact and Report outdated listing | Existing volunteer directory extended with IDs/review/archive metadata. Link check distinct from human verification; unknown access info is not an accessibility promise. |
| A03 Opportunities | Cause/date/location filters, list/detail, requirements/access/cost, save/add to Plan, external registration, status review, attendance/hours/note form | New organizer-linked opportunities, revisions and participation. Cancelled/postponed/full/unknown capacity distinct. Opening a form never marks registered or attended. |
| A04 Projects | Project catalogue/detail, suitability/materials/permissions, approved step deck plus scan-all, choose steps or whole project, schedule/progress/pause/follow-up | New reviewed templates and shared action parent/children. Browsing a step is not completion. Count effort/participation as self-reported, never unmeasured pollution removal. |
| A05 Outreach | Purpose, three recipient tabs with independent drafts, evidence picker/preview, editable letter, reset current, copy/share/print, optional follow-up | Existing evidence/district resources plus reviewed templates and optional owned drafts. Missing measurement produces information-request wording. Exact recipients and private fields previewed; no auto-send. |
| A06 Field observations | Private list/detail, factual entry, optional location/photo review, official destination selector, report preview/copy/export, external form, user-reported submission/reference/follow-up | New private observations/files/destination directory. Cause remains unknown unless evidence supports it. No automatic public map, agency receipt or unsafe collection prompt. |

### Regional exploration

| Feature | Screens and visible controls | Data and behavior needed |
| --- | --- | --- |
| M01 Map | Full focused map, four layer controls, zoom/locate/pan, accessible search/list, legend, selected-record sheet, preserved view and failure fallback | Existing backend layers; production renderer/client still needed. Lazy load. Each layer has independent loading/error. Unlocated records remain in list. |
| M02 Water timeline | Overall/compound/hazard selector, Latest versus source quarters, marker/detail/sample rows, own-system ring, watch/action/compare links | Existing map source extended for complete sampling metadata. Failed quarter restores prior selection; stale response cannot override new filter. Density labelled record density, not plume. |
| M03 Other layers | Radon county details/test link; facilities clusters, compliance programs and official record; air monitor pollutant/time/provenance | Existing layers with source metadata and honest nulls. Map symbols distinguish evidence types. Fish/drought overlays only after geography gate, not merely decorative colored polygons. |
| M04 Comparison | Select second compatible public record, aligned values/units/dates/coverage, missing reasons, source drilldown, clear comparison/back | New comparison adapter/query over normalized evidence. Mobile list rather than two tiny maps. Disable unsupported comparisons with reason, not rank missing as best. |
| M05 District | District/state summary, compound control, denominator explanation, county rows/partial tags, supported rank, unlocated coverage, public export/outreach | Existing district aggregation extended/verified. Boundary version visible; people served are not proven exposed. Never include household location/private data in a public brief. |

### Plan

| Feature | Screens and visible controls | Data and behavior needed |
| --- | --- | --- |
| P01 Your Week | Week/day controls, agenda, unscheduled list, overdue/upcoming/waiting groups, filters, optional month jump, item detail, calendar export | New plan/action/occurrence service. All-day dates distinct from instants. Event update affects same record everywhere; calendar download is not sync. |
| P02 Shared actions | Save sheet, existing-action match, editable detail, steps/reason/source, schedule/status/follow-up, complete/reopen/cancel/delete | New owned actions with evidence/context/revision/idempotency. Same ID across every entrance. Mark waiting does not invent a due date or completed result. |
| P03 Outdoor plans | Activity/place/duration/date form, comparable forecast-period chooser, per-factor tradeoffs, official notice, preparation, save/watch/reschedule | New normalized forecast/plan service. Per-source horizon and resolution visible; far future means check later. No safe-time score, route tracking or automatic rescheduling. |
| P04 Journal | First-use retrospective or Log today, date/category picker, symptoms/severity/illness/note or Felt fine, save/update, recent list, delete/undo, partial batch retry | Existing Journal endpoints need production client/screens and stronger logging semantics. Current upsert replaces whole entry; do not send unloaded blanks. Original fields survive edits. |
| P05 Patterns | Twelve-week heat grid and list, factor/date/category controls, day detail, chart/table, findings/counts/method, edit selected entry and export | Existing history/findings with revised analysis contract. Explicit logged versus unlogged, recalled, illness and missing-data counts; no causal conclusion. Unsupported filters not merely cosmetic. |
| P06 Seasonal recap | Season selector, coverage summary, environmental trends, logged entries/actions/tests/participation, source detail, dismiss prompt, export and next review | Existing summary plus owned record joins and revised analysis. No engagement streak or inferred benefit. Alert deep-link opens actual season. |

### Shared experiences

| Feature | Screens and visible controls | Data and behavior needed |
| --- | --- | --- |
| X01 Learn and sources | Inline definition, contextual explanation, reviewed topic index/search, full topic/source detail, linked practical action and return | Existing seven-topic Learn plus proposed index/versioned content. Retain form drafts; search has empty/failure states. Review dates and precise supporting sources visible. |
| X02 Luna | Approved launcher/panel, context disclosure, suggestions, composer/send/cancel/retry/new conversation, citations, proposed action/draft preview and explicit confirmation | Existing assistant with new capabilities/context/conversation/proposal contracts. No fake streaming, hidden household context, unsupported paperclip or automatic effects. |
| X03 Alerts and watchlists | Inbox/unread, expand, read one/all, dismiss/undo, exact target; follows list/detail, channels, reminder snooze, quiet-time controls | Existing alerts/notifications/push plus typed subscriptions and event targets. Browser permission states explicit. Read is not task completion; cancelled event is retained with notice. |
| X04 Settings | Sections for household/home/address/renter mode, notifications, accessibility, reviewed language, privacy, recovery, sources/methods/About/feedback | Existing essential Settings plus new preference contracts. Explicit Save, fresh preflight, conflict and retained drafts. No appearance switch unless separately approved. |
| X05 Privacy and recovery | Stored-data inspector, scoped export, clear Journal, delete all, optional recovery/link flow, device/session list and revoke where supported | Existing deletion extended to all domains; new exports/recovery. Explain current anonymous-session loss honestly. Typed confirmation and operation-status recovery for destructive actions. |
| X06 Offline and accessibility | Cross-app offline/stale badges, retry/draft status, motion pause, high-contrast/text controls, text chart/map/calendar alternatives | Existing environmental cache/accessibility foundation, extended per feature. Private offline writes are not implicitly implemented; queued is not saved. No feature requires animation, hover or gestures. |
| X07 Source operations | Protected operator list/detail for freshness/failure/review, import diff/quarantine, publish/withdraw, translation review and job retry | New internal role-protected UI or equivalent documented admin workflow. No ordinary-user link or service key in browser. Publication/retry has audit reason, expected revision and explicit scope. |

## Forms and exact interaction responsibilities

Forms below are target field/control schemas, not database schemas. The backend must supply allowlisted choices, valid transitions and limits where interpretation depends on them. Required and optional labels must be visible; optional fields never quietly acquire a default that changes meaning.

### Action scheduling and recurrence

Create opens with title, reason and evidence already populated from the selected recommendation. Users may edit their title and optional private note without editing the cited source. Offer Save for later or Schedule, not a forced due date. Show a possible existing action with Open existing and deliberate Create another when appropriate.

Schedule fields are all-day or timed, date, time when timed, timezone, optional end/duration where the task needs it, repeat off/on, calendar-anchored or after-completion basis, interval/end rule, reminder off/on and available channel. Validate end after start, supported recurrence, nonexistent/ambiguous daylight-saving local time and date range. Present a human-readable schedule preview before Save. Calendar event fields use the event timezone; device display timezone is labelled when different.

Editing a recurrence asks This occurrence, Future occurrences or Whole series only where supported. Show affected dates and preserve completed history. Snooze changes the eligible occurrence/reminder, not the source event's date. Skip is not Complete. Cancelling an action cancels future reminders after server confirmation. A pending request shows its state beside the control, not only in a toast.

### Test and result entry

Start with purpose/test kind, current or archived home/site context, sample medium, optional provider/lab and proposed date. Context and medium cannot be inferred from a document's filename. Recording collection adds collection start/end as appropriate, location label and method if known. Awaiting result optionally records expected date without inventing one.

Result rows use analyte, original reported value, original unit, qualifier, detection/reporting limit if given, limit unit, sample basis where relevant, result/report date and optional report reference. Provide add/remove row with duplicate warnings, not automatic merging of separate samples. Less-than, non-detect, numeric zero and absent result are distinct options. Preserve the typed original; normalization is server-returned and explained. Invalid interpretation fields may permit saving a clearly uninterpreted draft, never a confident severity.

Attachment selection shows allowed formats, size/privacy explanation, upload progress, cancel/retry/remove, scanning/unavailable state and confirmed receipt. Preview and any extracted transcription are separate. Users inspect/correct proposed fields and explicitly confirm transcription. Do not call this laboratory verification. Corrections keep original version, reason and current status. Compare opens only compatible records or clearly lists the mismatch.

The test-detail progress line is vertical. A small Luna robot carrying papers follows the fill to the current recorded stage when the timeline first enters view; completed stages check off in sequence. This is a presentation of the user's record, not live laboratory tracking or elapsed-time estimation. Hover, keyboard focus and touch must expose its short introduction without requiring hover to understand progress. Reduced motion shows the final truthful state immediately. Stop decorative running after the arrival animation.

Use distinct Prepared, Arranged, Collected, Awaiting result, Result recorded and Follow-up milestones. Recording an existing report may skip earlier stages; those remain Not recorded, with no fabricated checkmark. A filled track does not count as completion evidence. Each completed, editable stage has an accessible pencil control with a specific label, such as Edit recorded results, a visible focus state and at least a 44px hit target. Unfinished stages retain clear next-action controls. The editors retain validation, dirty drafts, revision conflicts and correction history. A simpler result summary must still show transcription status, original values/qualifiers/units and any interpretation limit. Follow-up opens or creates the same Plan action; an animation or report download never completes it.

### Food at home kitchen inventory

Food at home sits inside F01 and uses F04 evidence. Provide an understandable virtual Fridge, Pantry and optional Freezer view with a readable list alternative, common-food search, no-match state, Add food, open item, change storage/origin, and confirmed remove. Support ordinary household names and aliases across produce, dairy, meat, seafood and staples. The catalogue is a selection aid, not a list of tested foods. Do not require a question or chemical result simply to save a food. Optional source-linked questions remain available and can create one Plan follow-up.

Only PFAS and lead appear as this inventory's contaminant indicators. This does not remove other contaminants from official fish advisories elsewhere. Each item shows both indicators, using Unknown or No matching result unless a relevant measurement exists. A food category study is context, not the current package's level. Any supported value preserves the exact compound, result qualifier, original units/basis, sample date, source and matching scope. Never infer food chemistry from the household water score, cooking/storage choice, food name, nearby facility or generic category. No dose, universal food score or safe/unsafe badge.

The current review stores kitchen items in its sample session and explains that reloading can reset them. Production persistence needs owned records and recovery/export/deletion coverage; do not imply that preview saves already reach an account. Opening Luna or another Homeguard section preserves the current in-session draft and inventory.

### Maintenance and moisture entry

Asset fields are user label, optional product/model, installation/service date, factor/use and optional source instructions. Do not require serial numbers. Routine fields reuse scheduling with an explicit cadence basis. Replacement closes or supersedes the old asset record after confirmation without erasing its history.

Moisture entry accepts observation type, observed time, optional room/site label, optional measured reading and unit, measurement source and optional private note/photo. Label relative humidity as a user-entered measurement; no automatic mold detection. Repair follow-up connects to one shared action. Completion records what the user did, not a claim that the hazard is resolved.

### Fish advisory selection and optional notes

Search returns named waterbodies with jurisdiction/segment cues to disambiguate duplicates. Species can be unresolved; show matching limitations. Audience selector uses source-reviewed definitions and permits I am not sure, with general source guidance. Explain overlapping statewide/local rules and display source-defined servings/time windows without synthesizing allowances.

Optional catch/consumption entry uses record kind, date, species/unresolved label, optional waterbody context, quantity with original unit and optional note. Preserve advisory revision selected at the time. Editing an observation does not change official evidence. No dose, meal balance or automatic diagnosis follows from saving. Separate Delete record from Unfollow advisory.

### Garden and grower setup

Site form uses label, optional coarse place/county, growing setup, irrigation source, known soil/history or Unknown, optional concerns and optional source-linked records. Ask whether using the household water source is accurate before reusing it. Multiple sites use a simple list and selector. Moving/changing source shows what historical records retain their old context.

Grower preparation starts with concern, medium/service need, region and selected resource. Requirements checklist is sourced, not invented. Optional progress records include contact/application date, user-reported state, reference number, response note and chosen next follow-up. Official portal opens externally after the user checks requirements. Access/eligibility unknown is shown explicitly, not treated as guaranteed qualification.

### Water use entry

Choose cumulative meter reading or interval/bill usage before entering values. Capture site/context, observed date or period boundaries, original quantity/unit, measured/estimated/user-reported basis and optional note. Never subtract unlike meters/units, overlapping bills or a rollover as ordinary consumption. Ask to correct or explicitly flag a reset/replacement; the server decides comparability. The comparison states interval length and missing periods. It does not attribute a difference to HALO.

### Participation and observations

Participation form is attached to the exact opportunity revision. Registration opened is informational; an explicit user control records Registered externally. Attendance can be attended/not attended/unknown, with optional hours and note. Hours validate as a nonnegative quantity and remain self-reported. Changed event time prompts review before updating any user-specific plan choice.

Observation form contains category describing what was observed, date/time/timezone, factual description and optional place/photo. A location control explains coarse versus precise sharing; it does not repeatedly request GPS in the background. Show stored and exported metadata separately. Reporting preview lists official destination, included fields and any exact location/photo. Open form is a handoff, followed only by an optional user-reported submitted date/reference. Genuine acknowledgment requires an actual receipt, never inferred navigation.

### Outreach and exports

Outreach uses purpose, recipient class, selected evidence and editable body. Keep independent in-memory drafts per recipient; changing a tab does not overwrite another draft. Reset confirms loss of edits for that recipient only. Optional greeting/signature/contact fields explain local versus server persistence. A stale evidence notice offers review without rewriting user text. Send is not a control until a separately approved actual sending contract exists; Copy, Share and Print are the default delivery tools.

Export selection distinguishes public evidence, household summary and full private data. Choose sections/date range and explicitly include sensitive fields when wanted. Preview readable content and source dates before generation. Download/print/share has progress, retry, cancelled, unsupported and denied outcomes. Native share cancellation retains preview. File names avoid household identifiers. Public map/district exports cannot inherit private selection state. Server export downloads use authenticated short-lived access; expired links offer regeneration instead of a false missing-record claim.

H08's primary result is a real PDF file, generated on this device where feasible. Show Luna organizing the selected report with labelled preparation/rendering/ready states and a progress bar. Use actual work milestones or an indeterminate state, not a fabricated server percentage. Luna here is a visual guide for deterministic local generation, not a claim that private records were sent to an AI. Capture selected records, revisions and source dates as one report snapshot; an edited selection or changed source record requires regeneration rather than silently reusing an outdated file. Keep a compact ready view with file type, creation time, included sections/omissions and Download; preserve optional readable preview, print/image and native sharing capabilities. Cancel or failure retains choices and offers retry. Generated pages need readable light-background formatting, page breaks and no app navigation. Generation time never replaces evidence time. Clean up temporary object URLs and disclose that HALO cannot revoke copies already downloaded.

### Journal and retrospective entry

Load the selected date/category before enabling Save. Entry has symptom choices, explicitly chosen severity when applicable, possible illness, optional note, and Felt fine as a deliberate alternative. Preserve the current backend vocabulary rather than inventing incompatible chips. A clear replacement review prevents switching to Felt fine from silently retaining contradictory symptom fields.

For past rough-day setup, select dates, review which already have records and choose supported per-date content. Future dates are unavailable. Batch results report successes and failed dates separately; Retry failed sends only failures with stable keys. Undo for one deletion restores the complete prior entry, not a blank date. Clear Journal is a separate confirmed operation. Recomputed findings invalidate after a successful edit/delete and retain calculation status instead of displaying an apparently unchanged authoritative result.

First-use detection uses a proposed authoritative all-time presence flag/count, not an empty 90-day query or a blank grid. Preserve the original 90-day regular-entry window, 12-week grid, seven recent entries and 62-date retrospective request maximum unless explicitly revised. Show history-backfill-pending separately from source no-coverage. Retrospective retry cannot overwrite an existing richer record with unspecified symptoms. The normal Save guard waits for the selected date/category to load or an explicit authoritative no-entry result.

### Settings privacy and recovery

Each section shows loaded values, dirty indication, explicit Save/Cancel, field errors, retained failed draft and confirmed success. Profile unknown disables writes. Household Save sends all seven flags after a fresh preflight; unrelated edits are retained. Renter/owner mode and language must have agreed storage contracts before controls imply server persistence. Reviewed Spanish fallback is explicit and the chosen language is not silently reset.

Clear Journal shows the authoritative current record count and scope. Delete all describes records, files, jobs, subscriptions and provider/backup limits, then requires a deliberate confirmation. Pending deletion cannot be dismissed into a false success. Unknown outcome reconciles status before retry. Recovery screens explain identity verification, existing-record collisions, revoked/expired link state and loss of access. Device revoke must not reveal another household's devices. None of these operations uses a household ID in a URL as proof of ownership.

## Data lifecycle and cross feature updates

Successful mutations publish scoped invalidation events or refresh the shared query cache; the names are implementation choices, not new browser-global APIs promised by this document. Every refresh still verifies identity and ignores late responses.

| Confirmed event | Frontend consumers that must update |
| --- | --- |
| Action saved or changed | Origin's Save/Open action control, Plan agenda, action detail, linked project/test/participation summary, reminder state |
| Test result confirmed or corrected | Test detail/list, related factor's own-record section, selected household guide, action follow-up, export preview; not automatic composite rescoring |
| Journal entry edited/deleted | Selected day, recent entries, heat grid, eligible findings/recap, selected export preview; recomputation state explicit |
| Advisory or source revision | Current source view, subscribed notice, saved action review flag, open outreach evidence warning; original snapshot retained |
| Opportunity cancelled or changed | Opportunity detail, participation, linked Plan item, alerts; no silent deletion or completed attendance |
| Household selection saved | House figures, current guidance, allowed optional filter choices; historical records not deleted |
| Home context changed | Current readings, matching, home/garden association review, subscriptions and current-home queries; past tests/history keep original context |
| Identity changed or data deleted | All private views, requests, selected records, local caches permitted for that identity, pending uploads/downloads and notices |

### Homeguard to Plan continuity

Every deliberate Save action or Schedule from tests, routines, maintenance, moisture, garden, food questions and water-use follow-ups resolves to one canonical P02 action and its P01 agenda representation. A scheduled item appears at its chosen date/time; Save for later belongs in the unscheduled list. Routine occurrences reuse the recurrence engine, not a second calendar copy. The originating record remains in Homeguard and is linked from Plan; merely storing a lab result, food item, observation or usage reading does not create an unsolicited task. Never assign a due date from an observation date or report date without the user choosing that schedule.

Returning from Plan restores the originating record. Edits, rescheduling, completion and reopening update both entrances; duplicate saves open the same action unless a repeat is deliberately chosen. Record deletion/archive must describe its effect on existing actions and leave no broken route or silent completion. Completion records the user's action, not cleaner water, improved scores, lab verification or safe food. These are full-frontend integration requirements even while the current Plan surface is only a preview scaffold.

An invalidation event is not a reliable backend job queue. Authoritative updates and notification intent belong on the server. The frontend re-reads after reconnect/focus according to domain freshness rules; it does not assume that every database change happened while the page was open.

## Shared states and error recovery

Every independently fetched section needs first-load progress, populated, valid empty, no coverage, failed request, stale previous data and offline behavior. Not every state needs a full-screen illustration. Show a short local explanation and next action; preserve other working sections.

Forms add dirty, validating, submitting, confirmed, failed with draft, revision conflict and unknown write outcome. Use a stable idempotency key for a logical create and reconcile unknown outcomes before retry. Updating a record sends its known revision. A conflict presents current server values versus local edits and a deliberate resolution, not silent last-write-wins. Cancellation of the browser request does not prove the server mutation was cancelled.

Permission and identity failures hide private data rather than substituting another anonymous household. A transient provider outage is not a reason to create a new identity. Expired/withdrawn/archived public evidence remains inspectable as historical when allowed, with a clear current-state label. Deleted private records do not reveal existence across households.

No fixture values, fake forecasts, invented sources, simulated registration, placeholder safety claims or generated charts enter live fallbacks. A zero is valid only when returned as a valid number; absence is not zero. Lead remains unscored. Daily factor scores stay unsupported until their server semantics are reviewed. Contribution geometry does not claim to reconstruct formula weights.

### Existing data contract details

Keep the canonical severity vocabulary `good`, `moderate`, `elevated`, `high`, `severe`, `no_data`; unsupported severity becomes `no_data`. Do not read a legacy field called `status` as a severity fallback. This does not prohibit valid discriminators such as `water.status`, or the actual supported `lead.level` field mapped through the severity validator. Unknown additional properties in an additive response should not break known valid data; required-field and semantic validation still applies.

Use validated water `date_iso`, `latest_sample_iso` and other specified ISO companions rather than parsing human display dates. Keep date-only values separate from timestamp instants and render the correct timezone. Format source quantities with the provided units and precision; normalize only through a documented conversion while retaining originals. A larger-looking number in another unit must not appear to be an increase.

If adding the specification's concentration-comparison graphic after design review, use one comparable scale across rows with a clearly identified threshold. The original fixed zero-to-two-times comparison range requires a visible overflow/clipping indicator for higher values plus the actual numeric value. Do not silently autoscale each row to make different concentrations look equal. Keep scored rows ordered meaningfully and separate unscored/excluded evidence with an explanation, while preserving already-approved geometry until its revision is approved. A benchmark is not relabelled as an enforceable limit.

## Responsive visual and accessibility requirements

October 3, 2026 user clarification: Today, formerly Personal Hero, and its air, UV, pollen and mold detail pages should remain substantially unchanged for now. Retain current content depth, useful sections, visual treatment and overall layout. Do not interpret app-wide simplification as permission to shorten them substantially or conceal existing detail behind more taps. Small refinements and additive integrations can follow normal review; substantial cuts or restructuring require a separate decision.

Use the approved blue/teal identity, typography, transparent logo, centered headings, rounded navigation, subtly tinted factor cards and distinct restrained scenes. New page identity comes from the task: agenda for Plan, opportunities/projects for Act, aligned evidence for comparison, simple record timelines for tests. Avoid a grid of identical large cards for every feature.

At 320px and 375px, primary actions, labels, units, dates and errors must wrap without horizontal page overflow. Larger phones and desktop can use useful side-by-side evidence/details, with the same reading order and capabilities. Test the approved 100/115/130/150 percent text settings and browser zoom independently. Long translated text, long compound/species names, zero counts and large values are real layouts, not edge cases to truncate blindly.

Semantic headings, labels, buttons and links remain correct when animated. Focus is visible; sheets trap focus only while open and restore it on close. Section navigation offsets fixed headers. Charts expose data tables and keyboard/touch point selection. Map has the same records in a list. Calendar has accessible dates and agenda alternative. Household icons have visible labels. Status is text plus shape/color; the factor tint is not severity.

Retain approved handwriting/ring/card/chart motion, show final values immediately under reduced motion, and never delay inputs. Pause nonessential motion when hidden/offscreen and offer a user pause for prolonged animation. Do not redraw a score or reannounce every count on every background refresh. Avoid continuous GPU-heavy scenes beneath long forms. Lazy load map code, lower-page imagery, attachments and large histories; Today must not fetch all app domains.

Test mobile Safari keyboard height, safe areas, Back behavior, scroll restoration, native share, print and file selection on physical hardware. Desktop emulation does not establish those outcomes. Touch targets should be comfortably large, especially small icons in stacked cards, without depending on hover. No interaction may require dragging, swiping or a subtle color change alone.

Preserve the original minimum 44px target for primary and core interactive controls, including icon buttons. Any deliberate exception needs accessibility review. Inline SVG remains the established chart implementation; do not introduce a charting package simply to add a new series.

No em dashes appear in UI, source-derived labels, generated replies, export templates, announcements or notifications. Normalize source copy without corrupting units, mathematical signs, quotations needed for meaning or official source identity. Keep actual original documents available where licensing allows; app copy cleanup is not source rewriting.

Centralize new visible copy, error messages, accessibility labels, date/unit templates, exports and notification wording in the existing catalogue strategy instead of scattering English literals. Record requested and actually served language for reviewed content; keep an explicit fallback when a translation is unavailable. Update document language and formatting with the real displayed locale. Existing English date helpers and `lang="en"` are starting points, not multilingual support. Preserve source audience definitions and units during translation. Factual copy corrections, such as replacing an unsupported claim that nobody tests private wells with HALO having no result, receive review without editing historical archives.

## Notifications installation and browser lifecycle

The existing five server preference types are air quality change, weather advisory, new water results, radon season and season summary. The current preference contract gates both new inbox alerts and pushes for a disabled type. The frontend must describe that behavior accurately; separating inbox and push preferences is an explicit backend change, not a label-only adjustment. Watchlist and task-reminder controls require the extended contracts and their own clear semantics.

Before asking browser notification permission, explain the feature and let the user choose Enable on this device. Implement unsupported/default/granted/denied permission states, registration failure, expired subscription and unsubscribe. Persist a browser subscription only after identity verification and server acknowledgment; reconcile local and server status after reload or identity change. Do not report notifications enabled solely because the permission is granted. Notification clicks resolve a safe authorized destination and handle a missing/deleted record without opening an unrelated private item.

Installation work includes a reviewed web app manifest, appropriate icon variants, generic non-sensitive social/preview metadata, standalone safe areas and an update/reload experience. Keep the approved logo shape; asset variants need quality checks. Never put household categories, tests, scores or location into metadata crawled by link previews. Installation prompts are optional and cannot block browsing.

If a service worker is introduced for push or offline support, define its scope, cache allowlist, version cleanup and update coordination. Exclude private API responses, authorization-bearing requests, attachment URLs, transcripts and user exports by default. Update prompts must not silently discard a dirty form; activate safely or let the user finish first. Test old-client/new-server compatibility, offline startup, stale shell assets, multi-tab updates and logout/deletion cache cleanup. A worker is not a substitute for idempotent writes or an always-running background monitor.

## Offline privacy and device behavior

The current environmental cache is a useful starting point, not a promise of full offline CRUD. Document per domain whether it is available as a dated cache, temporarily retained in memory, explicitly saved private draft, or online only. Default new sensitive domains to no persistent offline content until reviewed.

If private drafts or an outbox are approved, bind each item to the verified identity and context, expose pending/cancel/retry, enforce retention and lock behavior, and prevent replay after deletion or identity change. Never queue external sending or destructive operations silently for later. A successful local write is labelled On this device, not Saved to HALO. Downloaded exports leave app control; deletion cannot revoke external copies.

Permission screens explain why location, notifications or files are requested at the moment of use. Denial leaves meaningful alternative paths. Browser storage restrictions should preserve an in-memory session as far as possible, with honest loss-of-draft warnings where relevant. App installation is optional; core workflows work in a supported browser without push or PWA installation.

Before the first valuable private upload, disclose the anonymous-session recovery limitation and any actually supported recovery option. Explain that uploaded reports or notes can contain personal information even though onboarding discards its typed address. Update inspection/export/deletion and privacy copy for those optional data classes before release. Do not show a recovery switch or promise unless the ownership-verification flow exists.

## Operator interface requirements

Source operations may begin with a protected internal tool and documented commands rather than a large new dashboard. If a browser interface is built, it needs authenticated roles distinct from household users, audit history and no service credentials in client bundles.

The minimum useful operator surface lists source freshness, last successful run, parser/version, rejected count and review due; opens a run to inspect safe diagnostics and change summaries; compares proposed versus published evidence; quarantines suspect imports; approves/publishes/withdraws reviewed content; and manages translation review. Retry has an explicit scope and idempotency. Publication shows affected interpretation/notification consequences. No operator screen displays private household notes by default or edits a source record without traceable revision.

## Frontend delivery and evidence

Build one connected journey at a time, reusing shared contracts rather than implementing 45 disconnected mock routes. Source feasibility and backend contracts can proceed before visuals are locked; production page implementation waits for Yogi's design approval.

1. Confirm four-tab navigation and cross-links, then review the revised shell with normal, missing and offline states. Extend route ownership and safe return handling together.
2. Review shared Save action, scheduling, evidence detail and private-record forms. Implement their first useful connected journey with isolated contract fixtures and server ownership tests.
3. Add the Today/Homeguard follow-through paths without changing sealed assets. New screenshots belong to a new approved version, not replacement baselines.
4. Complete Act and Map using the preserved unapproved Map work as a starting point. Production renderer, live layer adapters and source semantics are separate checks.
5. Complete Food and Garden branches with real approved source coverage and useful no-coverage paths. Complete Plan, Journal/Patterns and their corrected interpretation contracts.
6. Extend Luna, watchlists and full Settings only when privacy and mutation contracts work. Accessibility, source operations, security and error testing apply throughout, not at the end.

Every feature's wireframe inventory includes populated, meaningful empty, partial/stale, failed/offline, permission-denied and pending/failed-save states where applicable. Test API fixtures are explicitly isolated from the configured shared backend. Snapshot tests preserve approved geometry; interaction tests verify actual states, keyboard/focus and mutation outcomes. New contracts have positive and negative schema tests, identity-switch races, malformed responses and retry tests.

Before handoff, run the repository's relevant logic tests, typecheck, lint, production build, browser suites and preservation verification. Add tests for each new behavior rather than claiming old stage counts cover it. Run controlled live integration against a separate environment or disposable identity with representative real source records. Verify physical devices, translation, source truth, privacy and destructive operations without touching a shared production household. Record failures and known limits honestly.

An approved archive contains source, assets, exact copy, state inventory and screenshots in both appearances at narrow widths. Never overwrite the onboarding archive or `docs/foundation/approved/2026-10-01`. Current Map changes stay unapproved until explicitly accepted. Completion means the [acceptance plan](HALO_FEATURE_ACCEPTANCE.md) is satisfied for the released scope, not that every button produces a toast or every route renders.

## Planning verification and remaining decisions

This inventory covers G01, T01 through T06, H01 through H08, F01 through F06, A01 through A06, M01 through M05, P01 through P06 and X01 through X07. Feature IDs are shared with the master and acceptance plans so relocation cannot hide omissions.

Still required before corresponding implementation: Yogi's fourth-tab and visual approval, agreed new schemas/operation contracts, validated source coverage, factor-score methodology if individual scores are introduced, private-file/retention and optional recovery choices, reviewed content/translations and deployment validation. These are explicit gates, not permission to substitute fixtures or remove features. This documentation adds no code, routes, backend records, migrations, archived screenshots or live-site changes.
