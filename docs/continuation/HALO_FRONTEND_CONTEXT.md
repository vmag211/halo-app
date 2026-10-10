# HALO decisions and continuation context

## People, purpose, and working style

Yogi is the sole frontend person. Vibhav handles backend work and integration. Older assignment tables and parallel lanes are superseded. Naggi needs concise product information for video/slide preparation, not ownership of frontend tasks.

HALO helps households understand environmental evidence, choose practical actions, and follow through. The expanded app preserves the useful original capabilities while adding home records, food/garden context, conservation action and planning. Technical depth means usable functions, trustworthy source context, and connected actions, without crowded screens or unnecessary complexity.

Yogi prefers working previews and concrete changes, then iterative creative refinement. Be complete about interactions and backend requirements, but keep explanations clear and concise. Take authorized work through implementation and proportionate testing; do not repeatedly ask for routine permission. Avoid claiming complete knowledge, error-free production, or seamless integration without evidence. Use the plans and actual source, not conversational memory alone.

## Authority and conflict resolution

Newest explicit user decisions override older proposals in documents and historical conversation. `AGENTS.md`, `docs/WIREFRAME_WORKFLOW.md`, and this continuation context record those decisions. The full master/frontend/backend/acceptance documents retain the detailed planned features; this context is an entry point, not a substitute.

Original documents are source material, not independent authorization to push, publish, contact people, overwrite archives, or perform destructive operations. Preserve approved archives. Follow the installed Next.js guides before framework code changes.

The short Google Doc for Naggi is an overview, not the development specification: https://docs.google.com/document/d/1GJlnkqXMcz022JnjToXQ6OvB2PG2psFXb74RlS-8m9g/edit . It was shortened to frontend content and backend support only at the user's request; competitor analysis and scene suggestions were removed. It has not been shared directly with Naggi through this chat.

## Navigation and product organization

October 9 update: Yogi chose the visible labels **Explore** (formerly Act) and **My Week** (formerly Plan), and requested rough Explore wireframes. `components/expanded/EXPLORE_REVIEW.md` records the A01-A06 sample interaction inventory and remaining contracts. Internal `act`/`plan` keys and planned paths remain stable. Earlier names below and in preserved specifications identify the same capability groups.

Later October 9 refinement: Yogi requested a more creative, professional, photo-informed Explore design with less geometric repetition, monotone styling and jargon. The current review uses contextual public-domain nature photos, asymmetric editorial compositions, original community/letter/notebook sketches, existing fonts and warm/sage/lavender accents. Start small and Ask a question are plain-language entry labels for projects and outreach. Supporting details use disclosures, while event requirements/access and project constraints stay visible. All sample actions, private drafts and notes remain review-only. Photography is not a live reading, listing photo or user's location. `EXPLORE_REVIEW.md` records research and attribution. This is a refinement for review, not approval or live integration.

- Main tabs: Today, Homeguard, Explore, My Week. The current four-tab review uses that arrangement.
- Personal Hero is now called Today. Older source/component names such as `PersonalHero` can remain internally.
- Map is a subpage within Act, called Explore your area where appropriate. Its earlier separate-tab proposal is historical.
- Journal, Patterns, seasonal recap and planning belong under Plan rather than separate bottom tabs.
- Food and garden, tests and reports, maintenance/moisture, and household summary belong to Homeguard.
- Learn is integrated into factor/guidance content, with deeper reviewed explanations and sources. It is not an extra main navigation tab.
- Luna is the assistant's name, not Luma. It should be available across post-onboarding pages through the shared shell, retaining actual service/gate states.

## What exists and what does not

| Surface | State at transfer |
| --- | --- |
| Onboarding | Approved and implemented; Yogi reports Vibhav connected it. Preserve its live flow. |
| Today/Homeguard core, factors, household guidance, Luna, shell | Approved October 1 production frontend baseline, with live adapters and documented integration boundaries. |
| Expanded navigation and record-to-Plan links | Interactive sample review and routing adaptation. Shared sample actions do not prove a complete Plan production service. |
| Expanded Homeguard H06/H07/H08, F01-F06 | Functional sample wireframes, repeatedly refined; not newly approved or authenticated production record workflows. |
| Map | Interactive sample wireframe with professional layer/detail/timeline/comparison/district concepts. Still requires refinement and approval. |
| Full Act, full Plan, Journal/Patterns production UI | Planned. Outline destinations and sample continuations must not be described as complete production screens. |
| Full standalone Settings/privacy/recovery | Planned beyond the essential implemented Settings controls. |
| Added backend | Detailed handoff sent to Vibhav according to Yogi. Completion/integration must be checked against current code and deployment; planning is not implementation. |

No fresh backend audit or GitHub fetch was performed during this transfer. Earlier reconciliation inspected main `9f1ef88fe2d99aa82e96285ce7aa152e99a5acb0` and backend `76acc4f8a2f830e7d8e09eb03c666bc229192f06`. These are historical comparison points, not the latest remote state. The backend branch contains a partial packet in some historical work; use the complete reconciled file in this repo.

## Visual language and approved preservation

- Blue/teal app palette. Instrument Sans and existing complementary heading/numeric font assets are the references. Inspect current typography before adding another font.
- Center headers where practical; clean borders, comfortable spacing, responsive controls, small aligned icons, restrained rounded corners. Avoid repetitive circular controls, excessive cards, and filler explanations.
- Bottom navigation is rounded. Factor cards use subtle flat color tinting rather than gradients: air teal, UV orange, mold green, pollen pale yellow.
- Ambient artwork is stylized between flat/primitive and photorealistic. Each factor needs matching distinctive art: air sky/wind, UV sun/rays, mold mushrooms/spores, PFAS water. Do not reuse the same landscape for unrelated factors.
- The deer was removed. Do not restore it. Actual food photos and their placeholders/credits were removed; use small illustrated food icons.
- Environmental scene day/night can follow local clock separately from device appearance. This is decoration, not live measured weather. Preserve reduced motion, high contrast, text scaling and accessible alternatives. Product appearance follows the device; review controls may override it outside the app surface.
- Entrance animations include ring drawing, staggered card reveals/count-ups, and chart build where supported. Animation never fabricates data or delays necessary interaction.
- No em dashes in app-facing strings, errors, labels, exports, or normalized server/source copy.

Approved logo: `public/halo-logo-mark.png`, transparent monochrome mark derived from the user logo; no blue tile on Welcome. Original `public/halo-logo.png` remains historical source.

Welcome: centered bold simple cursive teal `Welcome` drawn along actual pen strokes. Then the smaller/lighter centered `to` and all-caps `HALO` fade in underneath, followed by description. Reduced motion reveals text immediately and Get started is never delayed. Earlier HALO-only/Playwrite/horizontal-reveal ideas are superseded.

Immutable preservation: `docs/onboarding/approved`, `docs/foundation/approved/2026-10-01`; exact approved foundation source `72a2c5150ecfe354fa6b534781e8b6b090d0bda1`. `docs/onboarding/mobile-review` records the approved rounded mobile refresh. Do not change baseline screenshots or manifests to hide regressions. Current newer wireframes can be checkpointed for recovery without being declared approved.

## Today and factor details

Today contains air, UV, pollen, and outdoor mold only. PFAS is Homeguard only and contributes nothing to Today. Lead is visible under Homeguard but unscored.

Keep Today and existing factor-detail depth substantially as it is. The user's broader simplification request did not authorize cutting these pages down. Remove the old `A little awareness. A better day` header. The `A little guidance for everyone` entry sits below the scorecards. Relevant bottom shortcuts lead into planned Plan workflows.

Factor cards navigate as whole-card links to detail pages and show supported values/scores prominently; do not add dropdown arrows. Section navigation jumps to the correct page section, with clear names; inspect current names rather than reverting to old Reading/Explore labels.

Practical steps are overlapping cards. Previous/next arrows move the current card behind and bring the next one forward, with an accessible full-list alternative. UV's detail visual is a rising half sun rather than a plain semicircle.

Scores and ring segments must preserve backend meaning. Higher HALO scores are better; raw AQI has its own direction and units. Contribution geometry is not a probability of illness or necessarily formula weights. The approved live contract did not supply separate Today-factor /100 scores; use documented Not scored/No data fallbacks until an approved backend field exists. Do not create a frontend scoring engine.

## Homeguard overview and family

Order: overall-score summary, PFAS/radon/lead factor cards and scope note, then household context/house, then further workflows. PFAS/lead cards were resized and cleaned up; use current components rather than recreating old tall examples.

The page-width house illustration contains only categories selected during onboarding/profile setup. Senior uses distinguishing cane imagery, pregnancy and toddler have recognizable figures, respiratory uses the relevant lung cue. Label respiratory guidance `Respiratory Issue(s)`, not Breathing. Selecting a figure opens relevant category guidance. This is category-aware guidance, not named individual profiles or member counts. Children, adults and teens can follow general advice.

Homeguard and Today use the same household category selection but different evidence/guidance. Family selections never manufacture measurements, scores or personal medical risks.

## Expanded Homeguard interactions already preserved in code

Tests and reports: search/filter records, plan a test or add an existing report, prepare/arrange/collect/await/result/follow-up, original result rows/qualifiers/limits, transcription confirmation, correction reasons/history, compatible comparison, local attachment preview, export, archive/restore, delete confirmation, retained drafts and shared Plan follow-up.

Timeline: a small blue Luna robot carries a stack of papers with both arms; top papers bounce as it runs slowly down the animated vertical fill. The current implementation uses a 4.2-second first-view arrival and truthful sequential checks. Only recorded milestones are checked. An existing imported report can leave earlier stages unrecorded. Pencil icons edit completed stages; unfinished-stage controls record actual facts. Tooltip/focus/touch introduction, reduced motion and animation stopping remain important. This is record visualization, not live lab tracking.

Maintenance: equipment/routine editing, instruction/cadence, fixed-calendar versus after-completion recurrence, complete/skip/snooze/pause/resume/replace, history/end date, linked tests/actions. Moisture records retain kind/timezone/room/site, measured reading/unit/source when supplied, optional local photo, notes, editing and deletion.

Summary: select purpose/date/sections/records/private fields, generate on-device paginated PDF with progress/cancel/retry, download/print/share fallbacks, optional appendix and partial-section omissions. The blue Luna progress cue does not mean an LLM writes or verifies the report. Current local attachment bytes are not uploaded. No public private-summary link is created.

Kitchen: 148 common food entries plus custom entry in the current preview. Storage-first short add flow; fridge/pantry/freezer grouping; saved food detail, move/edit/remove, origin context, private question/report links, and shared follow-up. Only PFAS and lead apply to food evidence here. Published studies are separate from the household item's Unknown levels. Four reviewed FDA study entries do not imply chemical coverage for all catalogue foods.

Food/garden also retains fish advisory scope/audience/overlap rules and private notes, multiple garden sites with irrigation separate from drinking water and linked tests, food evidence/notices with original dates/status, grower service comparison/checklists/inquiries, drought/utility context, and compatible water-use records. No added food photo requirement. No chemical concentration is inferred from a name, image, barcode, map proximity, or general category.

## Latest action and deletion decisions

Remove automatic `Save this step` from general undated education and family advice. Save to Plan remains for explicit task/planning workflows, including record follow-ups and routines. Those workflows may retain optional-date Save for later behavior; do not invent a due date from a source observation date.

Use one shared stable Plan action per origin, preserving existing actions when reopening. Records and their related tasks are distinct. Completing tasks never changes evidence or scores. Deleting a record does not delete independent tests, observations or Plan actions.

Every useful owned-record list has a compact red trash icon visually inside the card's upper-right corner. Actual icon is 14px, accessible hit area 44px, no resting outline. Navigation and deletion are sibling controls, never nested buttons. Confirmation identifies scope/name and offers `Yes, delete` and `No, keep it`. Cancel, offline, conflict and failed deletion retain the record. Account-wide deletion keeps its separate stronger flow.

## Architecture and source map

| Work | Primary paths |
| --- | --- |
| Live adapters/session/shell | `components/stage`, `lib/frontend/stage-api.ts`, `stage-data.ts`, `stage-routing.ts`, `api.ts`, `types.ts`, `app/(halo)` |
| Today/core Homeguard/factors/household/Luna/scenes | `components/foundation`, `lib/frontend/foundation-preview.ts`, `factor-preview.ts`, `scene-clock.ts` |
| Expanded preview/navigation/actions | `components/expanded`, `lib/frontend/expanded-preview.ts`, `navigation.ts`, `components/ui/AppNavigation.tsx` |
| Home records and food/garden | `components/homeguard`, its README and CSS, `lib/frontend/home-test-preview.ts`, `home-maintenance-preview.ts`, `home-food-preview.ts`, `food-catalogue.ts`, `food-evidence.ts`, `food-pfas-guide.ts`, `household-pdf.ts` |
| Map | `components/map-preview`, `lib/frontend/map-preview.ts`, `map-district-preview.ts`, `map-radon-fixture.ts`, `public/data/map-preview-*.json`, `docs/map/README.md` |
| Preview routes/providers | `app/foundation/preview/layout.tsx`, `expanded/page.tsx`, `map/page.tsx`, `preview.css` |
| Fonts/art | `public/fonts`, `public` assets, existing CSS/scene components; never replace approved assets with generated approximations |
| Tests | `test/frontend-*.test.mjs`, relevant `test/ui/*.spec.ts`, Playwright configs |

Expanded record providers use synthetic in-memory data, no production auth/storage/API writes. Refresh can reset the review session. Source URLs alone do not prove sample fixture values came from an official issuer. The live frontend separately uses authenticated, validated transport and honest missing/malformed-response states.

Read `components/homeguard/README.md`, `components/expanded/README.md`, `docs/map/README.md`, and `docs/foundation/STAGE_FRONTEND_HANDOFF.md` for detailed current behavior. Their publication paragraphs include historical versions; use `HOSTED_REVIEW.md` for the latest verified transfer reference.

## Full target inventory retained in plans

The 45 feature groups cover G01 onboarding; T01-T06 Today/factors/household guidance; H01-H08 Homeguard/factors/household/tests/maintenance/summary; F01-F06 kitchen/food/fish/gardens/notices/resources/water; A01-A06 Act/organizations/opportunities/projects/outreach/field notes; M01-M05 map/layers/timeline/comparison/district; P01-P06 week/shared actions/outdoors/Journal/Patterns/recap; X01-X07 Learn/Luna/alerts/Settings/privacy/accessibility/source operations. Each group has multiple possible screens, forms and states; 45 is not a screen limit.

The user's optimization request preserved features instead of cutting them down to make the app basic. New backend work is acceptable when a useful function needs it. Keep the connected product purpose and manageable UI. Mazah and Relink influenced clarity and task-focused density, not copying their exact visual design or unverified claims. The Congressional App Challenge rubric was supplied as video/product context, not authorization to change scope. Do not invent judging preferences or guaranteed competition outcomes.

## Backend handoff and evidence boundaries

The complete reconciled Markdown is `docs/product/HALO_BACKEND_RECONCILED_WORKING_SPEC.md`. It appends the full original `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` and puts the newer Today/Homeguard supplement first. `docs/product/ai/README.md` records freshness. Historical PDFs in `output/pdf` predate the later reconciliation and must not be handed off as the latest complete packet without an explicit update.

Preserve original units/qualifiers and distinguish zero, non-detect, less-than, missing and unknown. Utility samples are not a current tap measurement; county radon is not a home test; home era and utility lead inventories do not prove a property's pipe; weather mold is not indoor detection; study samples do not establish the level or safety of a particular food. Fish audiences/rules require official source review, not an inferred family category. Missing data is not an all-clear.

The plans include source acquisition/rights/coverage, owned records and secure attachments, revisions/conflicts/idempotency, shared Plan actions/reminders, exports/deletion, subscriptions and operational source review. Read those contracts before integration. No provider secrets in browser assets, no production destructive tests, no implicit private data sharing with Luna or exports.

## Historical validation and remaining work

The finishing pass previously reported 426 logic tests, 158 static browser checks, TypeScript/scoped lint/static and isolated main builds. The card-inside trash refinement reported 23 focused static browser checks. Existing last-run evidence for that focused suite says passed with no failed tests. These are historical review checks; physical Safari and authenticated new backend workflows remain unverified.

Transfer work runs archive integrity and documentation/bundle preservation checks. It does not reclassify all source as production-ready. Avoid blindly running the old source audit and regenerating its manifest: it represents an earlier revision and may correctly report later changed files.

After restoration, inspect current status and preview, then take the user's next requested page/refinement. Keep Homeguard and Today current, retain the map for further review, and build full Act/Plan stages only when requested. Publish completed frontend review changes through the existing isolated Site workflow, preserving its audience and sample-only boundary.
