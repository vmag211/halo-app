# HALO review requirement verification

Historical snapshot of the October 15 source. Subsequent redesigns, fixes and current verification are recorded in [October 16 implementation](OCTOBER16_REDESIGN_IMPLEMENTATION.md); the findings below are retained rather than retroactively rewritten.

## Conclusion

The October 15 revision substantially implemented the review's highest-priority frontend phase, but it did not finish every requirement in the PDF. Several client-side requirements are partial, one older responsive regression still fails, and real backend/provider acceptance is outstanding. Existing capabilities were reused, not all rebuilt in that revision.

This is a verification report, not another application change or a revised claim of completion. Application code, backend contracts, Vibhav's lane, approved archives and the published preview were not changed during this check. The report is local and was not pushed or sent to anyone.

Source: the user's 19-page `# HALO App — Congressional App Challenge Review.pdf`, read in full and rendered for inspection. SHA-256: `a887cba2d79f154a3456ca32868b9cdaeeb631beaae6185f92f9e5c43cd0dfbd`. Reviewed application commit: `5df88be8faf9f274cec311b84e460cfc30730f8a`; checkout HEAD: `1eb1784c7cdc52675096b161fd53de41f72254d9`. The three previously disclosed local changes remain separate from that commit.

The PDF repeats some requests in its introduction, grading, main instructions and closing priorities. The tables consolidate those repetitions without treating a numerical grade, suggested target score or illustrative domain as an implementation requirement. No new competition-readiness score is assigned.

## Status meanings

- **Implemented:** concrete frontend code exists with relevant test evidence. This does not certify every device or the connected backend.
- **Partial:** part exists, but an explicit requirement still needs implementation, design work or broader verification.
- **Service acceptance:** frontend contracts exist; actual authentication, persistence, retrieval, model behavior or delivery is not verified live.
- **Not delivered:** the requested capability or evidence was not produced.
- **Deployment:** requires verified production hosting/configuration rather than an invented domain or client-side assertion.

## Findings that prevent an all complete claim

1. **Homeguard's main action remains too far down on phones.** `PersonalHero.tsx:52-74` puts the scene, score explanation and factor cards before the test/report workspace. The inspected 375px production screenshot places the first testing action approximately 1,600px down a 2,847px page. A jump link helps but is not the requested testing/results-first hierarchy.
2. **Explore retains overlapping project setup controls.** `ExploreProjects.tsx:191-193` can show Find ideas, Adjust my project choices, Refresh ideas and Preferences together in its empty state. The selected opportunity also has no direct date/place handoff to environmental-condition checking.
3. **Opportunity date conversion has a real edge-case defect.** `ExploreOpportunities.tsx:84` copies `startsAt.slice(0,10)` into the participation calendar date. A UTC start of `2026-10-16T01:00:00Z` yields October 16, while the New York venue date is October 15. The current opportunity type has no explicit venue timezone. This was confirmed against the exact conversion expression, not claimed as a completed live-event browser test. Preserve an authoritative venue timezone or local date rather than guessing from the user's home.
4. **Luna does not explicitly separate facts from interpretation.** `production/luna-service.ts:5` exposes one message text and optional sources. `ProductionLunaConversation.tsx:89` renders one paragraph and a sources disclosure. Citations and exact action reviews exist; claim-level grounding and distinct fact/interpretation presentation do not.
5. **Reminders are not end to end on the frontend either.** `MyWeekWorkspace.tsx:162` hardcodes notifications unavailable; `HomepageHub.tsx:62-63` hardcodes scheduling/delivery not connected. Device registration is implemented, but there is no connected per-reminder registered/delivered/failed state display. Preparation, automatic-repeat intent and source-follow drafts also remain visit-local.
6. **The design system is only partly consolidated.** Newly declared spacing, radius and shadow variables in `responsive-shell.css:3-5` have no consumers. Existing color/theme/focus systems are real, but repeated literal styles remain.
7. **The requested reduction of decorative motion is incomplete.** `EnvironmentalScene.tsx:39` still creates nine page or eighteen hero particles, with infinite drift. Reduced-motion and visibility handling exist, but the PDF specifically asks to avoid random floating ornamentation.
8. **Not all current regressions pass.** A fresh run of the 1280px connected-layout sweep failed because `frontend-wrapup.spec.ts:77` still requires a maximum width of 430px. The new 1280px shell is intentional; the stale assertion must be updated without removing overflow, route or error checks, then the relevant full suites rerun.
9. **The required performance and full acceptance evidence is incomplete.** One 500-task functional/timing run is not route/CLS/render/chart/animation profiling. A complete concern-to-later-measurement production journey, physical-device/assistive-technology acceptance and a timed working demonstration are still missing.
10. **Full Spanish is not delivered.** The language preference and English fallback exist, but the interface remains English. The PDF makes this conditional; it still cannot be marked implemented.

## Primary objective and feature preservation

| PDF request | Status | Evidence or remaining work |
| --- | --- | --- |
| Retain all features; tune and partially rebuild rather than replace the app | Implemented with verification limits | The 45-feature inventory and canonical service architecture remain. The revision does not intentionally delete feature groups; scoped tests are not proof every possible interaction is unchanged. |
| Minimize additional backend work | Implemented | No API handlers, migrations, operation registry, payload types or score formulas changed in `5df88be`. Any new timezone, Luna grounding or reminder display fields need a small explicit compatibility review, not a silent backend change. |
| Understand environmental conditions and household-specific concerns | Implemented / Service acceptance | Today, factor detail, Homeguard and household guidance exist; source freshness and personalization must be accepted with real data. |
| Explain why concerns matter using credible sources | Implemented / Service acceptance | Source/date/provenance disclosures and contextual Learn exist. Actual retrieval quality is not established by synthetic responses. |
| Choose realistic actions and track tasks, tests, observations and later changes | Partial | The pieces exist and are tested separately. No complete production-contract journey traverses concern, explanation, task, completion, later report and compatible comparison. |
| Separate completed actions from evidence of improved conditions | Implemented | Score transparency, record comparisons and week summaries explicitly separate action completion from measured environmental change. |
| Verified technical depth rather than appearance alone | Partial | Real domain logic, typed adapters and mutation protection exist. Live service acceptance, profiling and complete demonstration remain. |
| Spanish version if possible | Not delivered | English interface with requested-language preference and disclosed fallback; no complete reviewed translation catalogue. |

## Desktop and mobile presentation

| PDF request | Status | Evidence or remaining work |
| --- | --- | --- |
| Responsive shell, consistent navigation and collapsible left sidebar | Implemented | `AppSidebar.tsx`, `responsive-shell.css`; actual desktop screenshots and navigation tests. |
| Clear page header and contextual actions | Implemented / Partial | Main headers and task actions improved. Homeguard testing action remains too low on phones. |
| Primary, secondary and tertiary hierarchy | Partial | My Week calendar/agenda leads and setup is disclosed; competing Explore actions and Homeguard priority still need work. |
| Consistent grid and bounded card/readability widths | Implemented | Tablet max width, desktop sidebar/content constraints, bounded detail forms and container-based week columns. |
| Scannable dashboard rather than many equal cards | Implemented / Partial | Flat supporting rows, filter sheet and compact scene improve My Week; not every deeper workflow was redesigned. |
| Reduce repeated cards, borders, shadows and nesting | Partial | Main planner/workspace styling improved; layered feature-specific styles remain across the app. |
| Remove redundant headings and instructional paragraphs | Partial | Some overview copy shortened; duplicate project setup controls and long deeper content remain. |
| Use spacing rather than repeated dividers | Partial | Layout gaps improved, but numerous divider-heavy feature styles remain. |
| Keep primary call to action visible without excessive scrolling | Partial | Add task is prominent; mobile Homeguard testing/results still follows several large sections. |
| Purpose-built desktop compositions, not stretched phone cards | Implemented | Desktop sidebar and main/supporting week composition; Today/Homeguard use bounded overview columns. |
| Calendar, tasks, environmental context and follow-up have separate jobs | Implemented / Partial | My Week main/support columns and named disclosures improve roles; broader usability acceptance not performed. |
| Preserve HALO identity and make landscape secondary | Implemented / Partial | Existing palette, fonts and art retained; week scene reduced, but other large scenes/particles remain. |
| Deliberate phone navigation and four/five clear destinations | Implemented | Existing four-tab bottom navigation retained, desktop sidebar replaces it at wide widths. No independent user usability study performed. |
| All 11 specified widths | Implemented for primary journeys | 320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440, 1920px are exercised in primary navigation/editor and week task journeys. Not all feature/state combinations at every width. |
| Safe areas, no horizontal overflow and content clear of bottom navigation | Implemented / Partial | Safe-area CSS and tested overflow constraints exist; physical browser chrome and every deep state remain unverified. |
| At least 44px touch targets where practical | Partial | Numerous target assertions and control minimums exist; no exhaustive current control inventory measuring every target. |
| Mobile calendar and accessible filter sheets | Implemented | Compact day grid, dedicated filter sheet, focus restoration and keyboard tests. |
| Forms usable with virtual keyboard | Partial | Dynamic viewport bounds and Luna VisualViewport handling exist. No physical iOS/Android keyboard acceptance. |
| Avoid oversized headers and competing calls to action | Partial | My Week compacted; Homeguard and Explore issues above remain. |
| Readable type and contrast | Partial | Shared themes and targeted contrast fixes exist. No complete computed contrast/assistive audit after redesign. |
| Appropriate buttons/cards/charts/sheets | Partial | Primary views inspected; every deeper chart/form has not been revalidated across all breakpoints. |
| Landscape and bounded dialogs | Implemented / Partial | Short-landscape and dynamic-height checks exist; physical devices unverified. |
| Usable dropdowns, date pickers and charts on phones | Implemented / Partial | Date-picker/keyboard and targeted narrow tests exist; not all deep forms/charts in all requested widths. |
| Long text, dynamic text scaling and reduced motion | Implemented / Partial | 150% narrow-text and device-motion tests exist. OS text scaling and a full fresh motion suite remain. |
| Improve less-natural-looking images | Not delivered as a separate image pass | Existing imagery was preserved; no specific asset replacement or image-quality acceptance was performed in the October 15 revision. |

## Design system and motion

| PDF request | Status | Evidence or remaining work |
| --- | --- | --- |
| Primary/secondary and semantic warning/critical/success/info colors | Implemented | Existing shared theme/severity variables retained in global/foundation/interface styles. |
| Typography and spacing scales | Partial | Typography is coherent, but feature styles contain repeated sizes. New spacing variables are declared but unused. |
| Card variants, radii, elevation and shadows | Partial | Existing component styles provide variants; new shared radius/shadow tokens are unused. |
| Form states and button hierarchy | Implemented / Partial | Shared controls and disabled/error/loading states exist; every surface not independently consolidated. |
| Focus rings | Implemented | Shared focus styling and focused keyboard/sheet tests. |
| Loading, empty and error states | Implemented / Service acceptance | Concrete source/record/task/generation states exist; real failures need connected verification. |
| Data visualization styles | Implemented / Partial | Existing factor, map and history visuals retained; not a newly centralized complete chart system. |
| Light and dark themes | Implemented | Both appearances tested and photographed across representative layouts. |
| Responsive layout tokens | Implemented | Sidebar/content/reading widths are consumed; spacing/radius/shadow consolidation remains partial. |
| Restrained color, recognizable identity and readable type | Implemented / Partial | Existing visual language preserved; complete contrast and usability acceptance remains. |
| Motion explains state and does not delay actions | Implemented / Partial | Finite transitions and accessible loading exist; decorative infinite layers still compete with the requested restraint. |
| Respect reduced motion | Implemented | Device reduction takes precedence; hidden/offscreen ambient work pauses. Latest full motion regression was not rerun. |
| Avoid unnecessary gradients/blur/glow/floating decoration | Partial | New week treatment is quieter, but particles and moving atmospheric layers remain. |

## Feature behavior

| PDF request | Status | Evidence or remaining work |
| --- | --- | --- |
| Today environmental summary; AQI/pollutants; UV; pollen; supported mold estimate | Implemented / Service acceptance | `stage-data.ts`, `PersonalHero.tsx` and factor-detail rendering. Unsupported data is not synthesized. |
| Today timestamps, location/context, sources/provenance and unavailable/uncertain readings | Implemented / Service acceptance | Dated readings, provenance, missing/partial states and source disclosure. Actual current source ingestion not verified here. |
| Today actionable recommendations and reliable history | Implemented / Service acceptance | Contextual Learn and current-home compatible history. Scientific/source correctness needs real-service acceptance. |
| Explain score calculation | Implemented | New `ScoreTransparency.tsx` describes existing method. This is not independent scientific validation of the composite methodology. |
| Distinguish measurement, forecast, estimate and illustrative data; do not call stale live | Implemented / Service acceptance | Existing qualifiers and source freshness logic retained. Real sources must provide accurate timestamps/versions. |
| Do not equate task completion with environmental improvement | Implemented | Explicit copy and separate record/score models. |
| Homeguard water/radon/soil tests, maintenance, moisture and mold-related records | Implemented / Partial | First five are explicit. Suspected-mold text/photos can use Other observation, but there is no explicit discoverable mold-related record path or dedicated mold test type. Do not add an enum silently. |
| Test and follow-up dates; historical comparisons; evidence; context-specific recommendations | Implemented / Service acceptance | `TestsWorkspace.tsx`, `home-test-preview.ts`, moisture follow-up and current-home links. |
| Exceptionally simple record creation and review | Partial | Results-first detail and continuation improved; mobile entry hierarchy and form usability still need review. |
| Separate verified measurements from user observations | Implemented / Service acceptance | Original result strings/qualifiers/source context retained; moisture is labelled user-entered. Backend must not certify arbitrary user transcription. |
| Avoid a misleading combined score | Partial | Separate unscored lead and limitations are clear, but explaining a composite is not proving its scientific validity. |
| My Week answers what to do, what needs attention, schedule, changes and environmental connections | Implemented / Partial | Calendar/agenda, attention, connected dates and update reviews exist; coherent full workflow proof and further density cleanup remain. |
| Clear Week/Month/Agenda purposes | Implemented | Selected-day, monthly date grid and chronological agenda retained. |
| Intuitive reminders/recurrence and no repetitive cards | Partial | Disclosures reduce clutter, but reminder delivery/automatic scheduling is not wired and setup overlap remains elsewhere. |
| Luna explains readings/records, suggests follow-up, generates documented plans, reasons, cites, navigates and prepares tasks | Implemented client / Service acceptance | Real-service client operations and exact proposals exist. Content quality, retrieval and reasoning are not proven with mocked replies. |
| Luna separates source facts from generated interpretation | Not delivered structurally | One text field plus optional source list; no fact/interpretation blocks or reliable claim-to-source relation. |
| Luna privacy, no invented readings, unavailable/rate-limited states | Implemented / Service acceptance | Selected context, capability/retention labels and service error handling. Client cannot establish that arbitrary model prose is grounded. |
| Luna confirmation, duplicate prevention and record of confirmed operations | Implemented / Service acceptance | Exact proposal revision/expiry, stable operation IDs and unknown-outcome reconciliation; server enforcement still required. |
| Actual AI versus deterministic sample separation | Implemented | Production and review use distinct providers; no fixture fallback in production. Does not mean live AI has been verified. |
| Explore activities, suitability/conditions, saving and participation | Partial | Discovery, saved commitments and participation exist. Conditions planner is separate and does not receive selected opportunity date/place directly. |
| Explore cancellations and schedule changes | Implemented / Service acceptance | Supplied status and versioned update reviews exist. Real organizer freshness and delivery need acceptance. |
| Never claim an activity safe from a composite score | Implemented | Forecast gaps/safety limits remain explicit. |
| Journal/Patterns observations, notes, check-ins, history, comparisons and charts | Implemented / Service acceptance | Existing workspace/Journal/evidence components; concrete recall/export corrections in October 15. |
| Date filtering and source/confidence labels | Implemented / Partial | Seasonal range/export corrections verified. Opportunity-to-calendar UTC/local conversion remains a separate real defect. |
| Insufficient data and no causal inference from trends | Implemented | Compatibility exclusions and descriptive-only comparison copy. |
| Create, edit and disable reminders; recurring schedules; timezone handling | Partial | Task intent/preference editing and manual next occurrence exist. Automatic scheduling and persisted end-to-end reminder lifecycle are not integrated. |
| Notification permission, delivery failures and clear status | Partial | Actual device permission/registration client exists. Per-reminder delivery/failure/status UI does not. |
| Never call a reminder scheduled without persisted registration | Implemented honesty, incomplete capability | Current copy avoids false delivery claims, but permanent unavailable labels do not satisfy end-to-end behavior. |
| Minimal household-sensitive personalization | Implemented / Service acceptance | Household bands/context selection rather than unnecessary exact personal details; server minimization needs acceptance. |
| Explain stored/shared/AI data and connected sources | Implemented / Service acceptance | Settings, context/privacy and capability/retention disclosures exist; truth depends on supplied canonical service state. |
| Delete/export records and revoke permissions | Implemented / Service acceptance | Scoped privacy reviews, exact confirmations, provider/device disconnect and unknown-outcome checks. Actual deletion/revocation not tested live. |

## Routes and technical implementation

| PDF request | Status | Evidence or remaining work |
| --- | --- | --- |
| Public root and /app, /app/today, /app/homeguard, /app/plan, /app/explore, /app/journal, /app/settings | Implemented | `product-routes.ts` and whitelisted catch-all. Production deployment is separate from static review publication. |
| Optional tests/maintenance/tasks/activities detail routes | Partial optional scope | Tests, maintenance and activities aliases exist; `/app/plan/tasks` does not. Task editor remains reachable through existing task navigation. |
| Separate /dev/preview, no consumer simulation/operator controls | Implemented / Deployment | Environment-gated preview entry; no production reviewer controls; role-guarded operations separate. Deployment must leave preview disabled. |
| Semantic URLs, Back/Forward, direct entry, relevant route state, reload and graceful invalid paths | Implemented | Routing/history tests and final Next history-state correction. Unsaved private drafts remain memory-only, not falsely restored. |
| Canonical URLs where appropriate | Deployment | No verified production canonical origin configured. Private app routes are noindex; public canonical configuration remains. |
| Page metadata, application title and favicon | Implemented | Root HALO metadata/icon and destination titles. |
| No sensitive query leakage and preserve useful deep links | Implemented / Service acceptance | Allowlists and safe return/record identifiers; no private note text, recovery proof or provider secrets in URLs. Server logs/auth still need acceptance. |
| Do not assume domain ownership | Implemented | No invented production domain; existing review site only. |
| Inspect/reuse framework, packages, components, APIs, database/auth/deployment/test setup | Implemented | Preimplementation audit and integration guides; no new framework/dependencies. Vibhav's separate current backend was not audited live. |
| Separate presentation/state/business logic/data access | Implemented | Production shell, shared providers, domain modules, service validators and transport registry. |
| Validate input | Implemented | Malformed data, dates, original results, schema/revision and command validation tests. |
| Persist appropriate data | Partial / Service acceptance | Canonical adapter receipts exist; some visit-local features remain. Actual database durability is not verified on this frontend branch. |
| Loading/errors/permissions/duplicate prevention/accurate outcomes/refresh recovery for every workflow | Partial / Service acceptance | Strong controlled tests cover these categories, but not every workflow state after the redesign and not real backend enforcement. |
| Complete central workflow end to end | Partial | Segments exist, but no complete final production journey through later measurement/comparison or a connected live run. |

## Verification coverage

Freshly rerun in this check: **681 unit/domain tests passed, zero failed**. An independently selected 79-test subset also passed; this is a subset, not 79 additional distinct tests. Fresh targeted browser reproduction: **one failed** at the outdated desktop-width assertion described above.

| PDF test requirement | Status and evidence |
| --- | --- |
| Score calculation units | Present and fresh unit pass: severity/composite tests. |
| Source freshness units | Present and fresh unit pass: daily readings, water/source and map/data tests. |
| Date units | Present and fresh unit pass: local dates, date input, week timeline/planning. This did not catch the opportunity UTC/local defect. |
| Input validation units | Present and fresh unit pass: home records/results, API/runtime validators. |
| Task state units | Present and fresh unit pass: week actions/planning. |
| Recommendation logic units | Present and fresh unit pass: deterministic action plan, volunteering match and project-personalization logic. Not live LLM quality. |
| Record create/update integration | Controlled contract tests exist; real service persistence not accepted. |
| Task persistence integration | Mocked canonical save/reload exists; real database/device durability not accepted. |
| Assistant confirmation integration | Controlled proposal/receipt tests exist; actual provider/tool run unverified. |
| Account authorization integration | Identity/context and role tests exist; live backend ownership/RLS unverified. |
| Data-source failure integration | Error/malformed/retry tests exist. Real provider failure handling unverified. |
| Duplicate-write integration | Stable IDs and unknown-result recovery tested with doubles; backend ledger acceptance outstanding. |
| Onboarding end-to-end | Existing onboarding/mobile suites; not a full fresh post-redesign regression run. |
| Dashboard navigation end-to-end | All requested widths in current responsive suites. |
| Homeguard test recording end-to-end | Existing test/timeline suites and scoped October 15 checks, not full live flagship journey. |
| Task create/complete end-to-end | Current review journeys and canonical production task tests. |
| History review end-to-end | Existing comparison/correction/archive and date-range cases. |
| Deep links/settings/mobile navigation end-to-end | Current targeted production suites and final history regression. |
| Keyboard accessibility | Concrete keyboard tests; no complete fresh every-screen sweep. |
| Screen-reader labels | Role/name/label assertions; no actual NVDA, VoiceOver or TalkBack acceptance. |
| Contrast | Targeted fixes/screenshots; no comprehensive computed contrast audit found. |
| Focus management | Trapping/restoration and error focus tests; not exhaustive after redesign. |
| Form errors | Validation and retained-draft tests exist. |
| Dynamic text scaling | Narrow 150% cases; native OS/browser scaling unverified. |
| Reduced motion | Existing device/offscreen/motion tests; no full fresh motion suite. |
| Every breakpoint, short/long text, empty/large data, offline/loading/errors/unexpected data | Coverage exists across suites, not every feature-by-width-by-state combination. The stale desktop sweep is a confirmed failure. |
| Route loading performance | No enforced route performance budgets or throttled mobile run found. |
| Layout shifts | No CLS instrumentation/budget found. |
| Unnecessary rerenders | Calendar indexing improved; no React render profiling/count budget found. |
| Chart rendering performance | No chart render budget found. |
| Large datasets | 500-task functional/timing journey exists; no broad account-shape/device stress acceptance. |
| Animation performance | Motion correctness exists; no frame-time/jank/battery profiling found. |
| Run tests, fix failures and document blockers | Partial. Scoped runs occurred and fixes were verified, but the whole relevant suite was not reconciled/rerun after redesign. |

Production browser configuration explicitly intercepts service/auth calls and blocks service workers. Chrome/Chromium is the configured engine. These checks cannot certify real push delivery, Safari, physical touch/keyboard behavior, database ownership, Gmail or LLM/retrieval quality.

The October 15 result directories contain pass/fail markers and screenshots. Most markers do not preserve per-case names/counts, so earlier scoped totals cannot all be independently reconstructed from those files alone. The historical receipt correctly says its tests were scoped runs, not one uninterrupted full-green suite.

## Demonstration and delivery

| PDF request | Status | Evidence or remaining work |
| --- | --- | --- |
| Explain originality versus weather apps, trackers and generic assistants | Partial | Product overview and central concern/action/history narrative exist; no newly verified complete demonstration. |
| Demonstrate real processing, scoring, provenance, persistence, recovery and algorithms | Partial / Service acceptance | Deterministic code/tests and frontend protections exist. Actual persisted/grounded live workflow remains unverified. |
| Compelling working demonstration under three minutes | Not delivered | Suggested narrative exists, but no timed complete working demonstration was executed or recorded. |
| Problem, household concern, evidence, action, tracking, later measurements, technical originality | Partial | All are covered conceptually; no single accepted demonstration joins them with actual services. |
| Pre-code feature inventory and UX audit | Implemented | `OCTOBER15_REVIEW_AUDIT.md`, sections 1-2. |
| Pre-code desktop/mobile/navigation findings | Implemented | Audit sections 3-5. |
| Pre-code functionality gaps, priorities and responsive system | Implemented | Audit sections 6-8. |
| Pre-code implementation order and testing plan | Implemented | Audit sections 9-10. |
| Implement highest-priority changes while preserving functions | Implemented / Partial | Genuine substantial changes exist; further frontend gaps above remain. |
| Document changed files, features, tests, results, limits and next steps | Implemented | Earlier audit/receipt plus this stricter verification. |
| No fabricated screenshots, benchmarks, integrations or working claims | Implemented | Results are qualified; no target grade, live delivery or full-language claim is warranted. |
| Finished coherent working product rather than a broad wireframe | Not complete | This is the overall product target. Static publication and contract tests do not establish a connected working application. |

## Remaining work in order

1. Correct opportunity venue-date handling with a compatible explicit date/timezone source, and add the midnight-UTC regression.
2. Promote Homeguard's actionable test/result continuation on phones; remove duplicate Explore setup actions; join opportunity date/place to condition checking; make suspected-mold observations discoverable without inventing diagnosis or new backend enums.
3. Complete reminder lifecycle presentation and Luna facts-versus-interpretation presentation against explicit compatible backend fields. Keep unavailable fallback honest until canonical service state is supplied.
4. Finish shared design-token adoption and remove unnecessary page particles while preserving contextual imagery, meaningful transitions and motion controls.
5. Reconcile stale tests with the approved responsive layout, add the full flagship production-contract journey, sweep deeper screens/states, and run the entire relevant suite. Preserve all existing ownership, overflow, error and mutation assertions.
6. Add measured route/CLS/render/chart/animation checks with declared budgets, then perform physical-device, screen-reader and real-backend acceptance with disposable identities.
7. Complete reviewed localization if selected for this release; configure canonical public metadata only after the production origin is verified; rehearse the working demonstration.

These are specific unfinished requirements, not reasons to replace HALO, cut its feature inventory or rewrite Vibhav's backend wholesale. A follow-up implementation pass should track them to actual passing evidence rather than marking a broad category done because its screen or adapter exists.
