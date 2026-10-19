# HALO full-app wireframe completion matrix

October 12–13, 2026. Editable frontend review. This document supersedes the **missing frontend workflows** section of FRONTEND_WRAPUP_AUDIT.md after the implementation and validation recorded in the completion receipt. It does not supersede source qualifications, immutable approvals or backend ownership.

## What completion means

The scope is the master plan, frontend build plan, feature acceptance register and later user decisions in AGENTS.md. A workflow is a real interactive frontend path with local state, validation and recovery, or an explicit unavailable/permission state where an external capability is required. A successful wireframe transition is not an account write, source observation, AI response, email, subscription, registration or delivered reminder.

All primary pages remain in the 430px HALO shell. My Week leads, followed by Today, Homeguard and Explore. Public Map remains a specialist view. No approved archive is overwritten. Further visual approval belongs to Yogi.

## Requirement coverage

| IDs | Frontend surfaces and interactions |
| --- | --- |
| G01 | Approved onboarding and reveal, retry/partial/error gates, public no-home Learn/Map entry, return to setup, recovery entry, home lookup/review/cancel/history, exact selected-task links. Changed homes invalidate old environmental context without deleting history. |
| T01–T06 | Today and four factors, source/coverage/date detail, partial/missing/zero, refresh/error/offline, household guidance, contextual Learn and shared action creation. No home-water values enter Today. |
| H01–H05 | Compact home workspace above the house, water/radon/lead guidance, private-water branches, seven household categories, contextual map and records. Previous-home records are not current-home readings. |
| H06 | Tests, collection/milestones, expected dates, attachment review, transcription/correction, original units and qualifiers, compatible comparison, archive/history and export. |
| H07 | Routines, cadence, pause/resume/skip/snooze/replacement, observations and follow-up. Optional moisture photos now use metadata-free raster copies, cancellation and private review. |
| H08 | Section/record/date/privacy selection, genuine local PDF, readable fallback, print/download/share, cancellation and missing sections. Scores use the shared preview selector; a new home cannot export its predecessor’s readings as its own. |
| F01–F06 | Kitchen catalogue/inventory, fish scope and notes, garden/site/source/test records, food evidence and questions, grower preparation/follow-up, water stewardship and comparable usage. Original source scope and unknown states remain. |
| A01–A03 | Balanced Explore entry, location and preferences, upcoming/rolling opportunity discovery, organization/program essentials, official handoff, registration-opened versus user-reported participation, changed-event review. |
| A04 | Tailored full/short idea batches, refresh, direct interests/preferences, cancellable generation, activity-specific imagery, practical instructions/materials/safety, canonical project/step continuation and follow-up. New-home context invalidates old generated reasons while saved projects remain. |
| A05 | Need/place-based public-contact review, independent recipient drafts, exact outgoing evidence, confirmation, cancellation, blocked/unknown/send-status outcomes and explicit external handoff. No actual provider send occurs. |
| A06 | Private note creation/edit/case/follow-up, photo signature/size/decode checks, metadata-free preview/consent/remove/Undo, separately reviewed image download, version-bound prepared copy and export history, official form opened versus user-reported submission, archive/filter/restore. No agency acknowledgment is invented. |
| M01–M03 | Public/owned map capability modes, layered atlas/list/search, renderer-failure list, source selection, water compound/quarter timeline, air/facilities/county radon, transparent record-density Patterns, reversible utility follow. |
| M04 | Deliberate two-record selection, search/replace/cancel/remove, aligned per-factor values, dates/units/method/period/version compatibility, zero versus missing, public/unlocated records, source detail and accessible reading layout. |
| M05 | District/state/county scope and denominators, partial geography and boundary dates, reviewed public brief, copy/download/share and permission fallbacks. Public output uses a strict allowlist. |
| P01–P02 | Week/month/agenda, all shared tasks and legitimate connected dates, precise task opening, editing/status/delete, saved-for-later/focus, confirmed scheduling/batch moves, calendar export, optional action streak, reminder and recurrence intent. |
| P03 | Date/place/activity/duration, comparable supported periods, per-factor tradeoffs, issue times/horizons/unknowns, expired/changed forecast review before replacing a choice, preparation and canonical saved task. |
| P04 | First-use retrospective, explicit fine/symptoms/severity/group/illness/note, owned history, retained edits, delete/Undo and failed/offline states. Unlogged is not fine. |
| P05 | Twelve-week grid and day edit, date/group/factor filtering, original-reading chart/table, same-date joined history, distinct logged/comparable/environment counts, exclusions, sparse/no-pattern/loading/error states and descriptive comparisons. |
| P06 | Actual season boundaries, partial-season coverage, environment history and source basis, actual completed work, tests/participation, exact record/task drilldown and scoped export. No inferred impact or cause. |
| X01 | Searchable seven-topic Learn library and glossary, topic filter, matching/empty/loading/error/retry, existing complete factor guides and dated source links. |
| X02 | Shared Luna conversation, authorized-context controls, task and note ambiguity resolution, exact revision-bound create/update/delete/complete/reopen/wait/unschedule, project/step tools, review/cancel/failure and unknown-outcome reconciliation. Unknown writes block destructive conversation/data clearing until reconciled. |
| X03 | Canonical inbox, explicit read/dismiss/Undo, exact destinations, categories/follows/reminder requests, separate device permission and registration review, denied/unsupported/expired/failure/unsubscribe states. |
| X04–X05 | Six searchable settings sections, draft/Save/Cancel/rebase, System/Light/Dark, text/motion/calendar/locale fallback, home context, explicit recovery and device revocation, least-privilege email/calendar connection reviews, scoped inspection/export/clearing. Generic exports exclude photos and exact locations, and include only owned task metadata. |
| X06 | Responsive shell, enlarged text, themes/contrast, visible keyboard focus, map list/chart tables, meaningful status and missing-data semantics, reduced-motion authority, hidden/offscreen pause, retained drafts, safe offline write refusal and share fallbacks. Physical-device and assistive-technology acceptance remains below. |
| X07 | A compact isolated source-operations review outside consumer navigation: role denial, source/revision comparison, anomalous import quarantine, approve/publish/withdraw, dated last-valid retention, bounded retry, translation-version review, unknown-outcome reconciliation and audit history. Client role selection is never production authorization. |

## Failure and privacy model

- Default unavailable services never acquire authority because a button was clicked. Populated/verified service responses are chosen in external review controls and never call provider/auth endpoints.
- Input is retained on validation, offline and known failure. Confirmation binds to exact current records and revisions. Unknown outcomes require reconciliation, not blind replay.
- Private photos, coordinates, household details and conversation text do not silently enter general exports, public map briefs or Luna proposals. Visible identifying details in a processed photo remain a user review responsibility.
- Original records, dates, source revisions and completed history remain distinct from tasks, proposed schedules and user-reported outcomes.
- Public browsing does not expose household scores, private tasks, home pins, own-utility ranking or private Luna. It is a capability wireframe, not an authentication implementation.

## Review and release boundaries

Frontend design coverage is not proof of every possible browser/input combination. The final receipt records the executed checks and any remaining failures precisely. Production integration still requires authenticated ownership/revisions/idempotency, durable data/files and recovery, actual geocoding and providers, evidence adapters/freshness, reviewed AI/tool execution, project generation, calendar/email authorization, device registration/delivery, operator roles and safe deployment/cache behavior.

The supported-language fallback is designed; a fully reviewed Spanish catalogue is **not** supplied by an English fallback or synthetic translation approval. Scientific/content review, source rights, physical Safari/Android, screen-reader/zoom/installation/native-share and performance on low-cost devices remain explicit release gates. No screen approval or backend readiness is inferred.

## Detailed evidence

- [Account, onboarding, public browsing and Learn](ACCOUNT_LEARN_COMPLETION_REVIEW.md)
- [Map](MAP_COMPLETION_REVIEW.md)
- [Week evidence, forecasts and field notes](WEEK_COMPLETION_REVIEW.md)
- [Luna](LUNA_COMPLETION_REVIEW.md)
- [Source operations](SOURCE_OPERATIONS_REVIEW.md)
- [Prior complete feature audit](FRONTEND_WRAPUP_AUDIT.md)
- [Completion verification and publication receipt](../continuation/WIREFRAME_COMPLETION_RECEIPT.md)

Vibhav’s final whole-app backend packet remains deferred. These local implementation notes preserve the required contracts for that later handoff; nothing has been sent to him.
