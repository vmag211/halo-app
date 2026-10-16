# October 15 HALO review: audit and implementation plan

Prepared before application changes on October 15, 2026, from the supplied Congressional App Challenge review, current source, the 45-feature completion matrix and production integration contracts. The user wants all features retained, a clearer experience and minimal additional work for Vibhav.

## 1. Existing feature inventory

The complete inventory remains [WIREFRAME_COMPLETION_MATRIX.md](../foundation/WIREFRAME_COMPLETION_MATRIX.md). All 45 groups remain in scope:

| Groups | Existing capabilities to retain |
| --- | --- |
| G01 | Onboarding, public browsing, authentication boundaries, recovery, home selection/change and historical home context. |
| T01-T06 | Today, air/UV/pollen/mold detail, score explanation, sources/dates/coverage, refresh, household guidance, learning and history. |
| H01-H05 | Homeguard water/radon/lead context, private-water branches, assessment actions, household categories and relevant records/map. |
| H06-H08 | Tests, original results and qualifiers, attachments, correction/history/comparison, routines, moisture observations, follow-ups and immutable selected household summaries. |
| F01-F06 | Kitchen, food evidence, fish advice/notes, gardens and tests, grower support, drought/notices and comparable recorded water usage. |
| A01-A06 | Location-aware future/rolling opportunities, organizations, participation, generated projects and versioned guides, outreach/contact resolution, private notes/cases/photos and follow-up. |
| M01-M05 | Public/owned map, source layers, filters/list, timeline, utility follows, compatible comparisons, geographic summaries and public briefs. |
| P01-P06 | Canonical tasks/calendar/connected dates, focus/preparation, reminders/recurrence, outdoor planning, Journal, Patterns, seasonal review and export. |
| X01-X07 | Learn, conversational Luna and confirmed tools, alerts, six Settings groups, privacy/account/device/provider controls, accessibility and restricted source operations. |

The active app is `ProductionApp`, with authenticated adapters and 72 registered operations. The hosted review has separate sample state. The reviewer saw the hosted review; claims about simulated data do not establish that production adapters are absent. Actual deployment, sources, persistence, AI and delivery still require Vibhav's backend and connected acceptance.

## 2. UX audit

The strongest existing journey is concern -> dated evidence -> test or practical action -> saved follow-up -> later record/comparison. Its pieces exist, but their entrances compete with unrelated tools. My Week puts calendar, filters, agenda, three quick cards, utilities, score gauges, Journal/outdoors, progress, focus, saved items and rail panels into a long sequence. Homeguard places current test continuation inside Quick access, while four workspace rows have equal weight. Settings repeats feedback and mixes actual device controls with local review summaries.

The redesign should change priority and disclosure, preserving canonical records and deep links. It should make the next relevant action apparent and keep optional analysis, exports and setup reachable in named secondary sections. No feature is removed to reduce visual density.

## 3. Desktop findings

- The prior explicit 430px shell rule leaves wide screens with a narrow stack. The new user instruction supersedes that desktop rule.
- Existing calendar/rail layouts are overridden to one column; a deliberate main planner plus supporting column is appropriate at sufficient width.
- Repeated cards and nested borders assign similar weight to primary work and secondary tools.
- Reuse the HALO blue/teal palette, sans type, environmental imagery and semantic colors. Constrain reading columns instead of stretching text across the screen.

## 4. Mobile findings

These are source-based risks, not a claim that the review's provisional mobile score is a measured defect. The current shell already has bottom navigation, safe-area handling, a shared date picker, focus management, reduced motion and enlarged text support.

- Always-visible search/category controls and multiple quick cards compete with the selected agenda.
- Lower-priority sections create excessive vertical travel.
- Filters should open in the existing accessible sheet pattern. Calendar, current agenda and one primary creation action should lead.
- Verify long labels, 150% text, 320px width, short landscape heights, sheet scrolling and bottom-nav clearance in actual browser rendering.

The first baseline build encountered a locked existing `.next-stage-test` output directory. Use a new isolated test output directory; do not remove another running build or treat this as an application defect.

## 5. Navigation and routing

Production already uses short `/plan`, `/today`, `/home`, `/act` and `/settings` routes. Preview controls are already omitted in production, and preview routes have an environment gate. Operator tools are outside consumer navigation and require backend role authority.

Add recognizable `/app`, `/app/today`, `/app/homeguard`, `/app/plan`, `/app/explore`, `/app/journal` and `/app/settings` presentation routes while retaining old paths, internal `plan`/`act` keys, safe return paths, alert/Luna targets and backend endpoints. Preserve destination/detail links through one mapping layer. Provide a public entry and a gated `/dev/preview` entry. Do not register a domain or deploy a live service implicitly.

Settings currently pushes the same URL for panel navigation and closes panels on every popstate. Make the chosen panel URL-derived so direct links, refresh, Back and Forward have consistent destinations.

## 6. Functionality gaps and concrete defects

| Finding | Required response | Backend effect |
| --- | --- | --- |
| Home workspace retry uses an indirect scenario transition | Use explicit retry and suppress it while loading. Deeper trace confirmed the old production scenario transition already delegates to retry; it was not a broken backend call. | None |
| Editing a previously same-day Journal entry later marks it recalled | Preserve original logging basis on edits | None |
| Luna clear feedback appears three times in Settings | Render one status message | None |
| Settings source follows are memory drafts yet report saved | Show honest draft status until the already-specified subscription service is connected | Existing handoff integration item |
| Settings device summary reads local review flags | Use canonical device state or neutral entry copy | None |
| Seasonal history always asks for the latest 84 days | Use selected season bounds through existing from/to contract | None |
| Patterns export includes context-excluded entries | Export the same eligible context as the visible view | None |
| Calendar scans all actions repeatedly for each date/category | Build a memoized day index | None |

Luna already has source links, context permissions, typed action confirmation, refusal/rate/unavailable states and unknown-operation recovery. Projects already have actual generation adapters, cancellation/status and immutable guide versions. Reminders have preference/recurrence and device-registration contracts; delivery requires the existing backend scheduler. Do not implement a second backend or report a model/provider as verified from mocked tests.

## 7. Priorities

1. Responsive shell with desktop sidebar and mobile bottom navigation.
2. Clear My Week planner/agenda and supporting attention/context layout.
3. Prominent Homeguard continuation and evidence-to-record workflow.
4. Correct concrete Journal, history/export, Settings and retry defects.
5. Semantic routes and preserved navigation/history.
6. Verify all requested widths, meaningful journeys and service-contract preservation.
7. Spanish support assessment: the language preference already exists, but complete reviewed scientific translations do not. Build localization only where coverage is explicit; never label an English fallback as a complete Spanish app.

## 8. Responsive design system

- Mobile below 768px: compact single column and four-tab bottom navigation. Primary content stays comfortable at phone widths; touch areas target 44px.
- Tablet 768-1023px: wider constrained reading surface with bottom navigation and non-stretched forms.
- Desktop from 1024px: collapsible left navigation, bounded content canvas, main/supporting columns where meaningful. Detail forms retain readable widths.
- Use existing HALO primary, secondary, severity, background, surface and focus variables. Add shared spacing, reading-width, sidebar and layout tokens, rather than another independent palette.
- Preserve light/dark/system themes, strong focus rings, disabled/loading/error states, safe areas and device reduced-motion authority. Ambient scenes remain secondary and pause offscreen.
- Dialogs remain within dynamic viewport height, scroll internally, retain drafts and restore focus. Enlarged text can stack desktop columns.

## 9. Implementation order and ownership

The root task owns shell, routing, common tokens, responsive verification and integration notes. Separate agents own My Week composition, Homeguard/Today presentation, and concrete Settings/Journal/evidence defects. Each uses the existing service contracts; no endpoint registry, payload schema, migration or backend branch is changed for presentation work. The three pre-existing local edits and historical approval archives are preserved.

## 10. Testing plan

- Run TypeScript, scoped lint, frontend/domain unit tests and archive preservation.
- Add focused regression tests for changed routes/history, Journal recall, seasonal date requests, export context and retry behavior.
- Exercise actual browser journeys at 320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440 and 1920px. Check overflow, navigation, calendar, task opening/editing, Homeguard records, Settings and filters.
- Cover light/dark, long text, enlarged text, reduced motion, keyboard/focus, short landscape, empty/large/error/loading data and offline behavior proportionate to changed surfaces.
- Run existing production interaction suites with intercepted services. Verify source timestamps, revisions, idempotency, unknown outcomes and context isolation are retained.
- Inspect screenshots from actual runs. Record real outcomes and remaining limitations. Browser emulation does not establish physical iOS/Android keyboard, screen reader, push delivery or battery behavior.
- Re-run the backend handoff audit after frontend changes, preserving the historical packet and recording any actual contract delta separately.

Implementation and validation results will be recorded in a separate completion receipt. This audit precedes code changes; it does not claim planned tests have passed.
