# Homeguard connected workflow review

Later October 11 simplification: the editable home-care overview retains tests, milestones, maintenance, Food and Garden and summary creation in the same approved-core ordering, with shorter introductions and stronger heading typography. Repeated quick-note/assistant toolbars are removed. The existing global Luna launcher uses one shared conversational preview across expanded screens. Successful sample updates use a short dismissible toast; failures/conflicts remain visible and retain input. Production/non-expanded Luna and the immutable core archive are unchanged.

October 3, 2026. Editable, unapproved wireframes for H06, H07, H08 and F01 through F06. These replace the expanded edition's four Homeguard outline destinations. They do not replace the approved Homeguard overview, house illustration, selected household guidance, factor pages or onboarding.

This is an interaction implementation with synthetic records, not a production frontend handoff. The user reviews and refines these visuals before a new approval archive or live integration is made. The sealed October 1 archive is unchanged.

## Open and navigate

Open `/foundation/preview/expanded/?tab=home`. The open Home workspace enters Tests, Maintenance, Food and Garden, and Summary. A compact native Home workspace selector replaces the four internal section buttons; Workspace overview returns from record detail to the actual destination overview. Back to Homeguard remains available, and Homeguard stays selected in the app's four-tab navigation.

October 11 refinement consolidates the editable below-the-house overview into one workbench: test continuation and milestones, maintenance rows, compact illustrated food/garden entries and a document-style summary entrance. All destination content, original score/factor/household/house ordering, record counts and failure states remain available. Contextual Quick note and Work with Luna use the same isolated Explore notebook and selected-note action preview. Neither these controls nor the selector changes the approved archive, production assistant or backend. See `components/expanded/EXPLORE_REVIEW.md` and `EXPLORE_BACKEND_DELTA.md` for tool/privacy gaps.

The review uses `destination`, `homeView` and opaque `record` identifiers. These are preview URLs, not new production routes. Form contents, notes, household categories and uploaded bytes do not enter the URL. Existing appearance, text scale, motion, contrast and decorative time choices continue through navigation.

| Destination | Review views | Implemented interactions |
| --- | --- | --- |
| `tests` (H06) | `list`, `new`, `prepare`, `report`, `detail`, `edit`, `collect`, `awaiting`, `results`, `attachments`, `history`, `compare`, `export` | Separate plan-a-test and add-an-existing-report paths; search and kind/status/context/archive filters; preparation; arrange/sample/pending/result/follow-up states; original result rows and qualifiers; transcription confirmation; correction reasons/history; compatible comparison; local report preview; retained drafts; export privacy; archive/restore; confirmed deletion; one shared Plan follow-up. |
| `maintenance` (H07) | `list`, `create`, `detail`, `edit`, `occurrence`, `observation`, `observation-detail`, `observation-edit` | Equipment or routine details; instruction and interval basis; fixed-calendar versus completion-relative cadence; completion, skip, snooze, pause, resume and replacement; history; end date; moisture/timezone/reading/source/optional local photo; linked tests/actions; editing and confirmed routine or observation deletion. Separate linked records and Plan actions are retained. |
| `summary` (H08) | `selection`, `preview` | Purpose, date range, sections, individual records, private-field opt-ins, selected household categories, public/private-water branches, two-score/all-seven-factor snapshot, original source dates, optional appendix, local partial omission, paginated on-device PDF with progress/cancel/retry, HTML file, PNG image, print and native share with fallbacks. |
| `food` (F01) | `list` | Optional interests reorder five destinations; saved references, source follows and garden continuation; coverage explanation; no mandatory questionnaire. |
| Food: at home | `pantry`, `pantry-add`, `pantry-custom`, `pantry-detail`, `pantry-saved`, `pantry-note`, `pantry-edit` | Search 148 common foods or enter a custom name; use a short storage-first add flow; small illustrated icons only, no food photos; separate source-backed PFAS/lead study panels; five broader food group guides; origin-sensitive next steps; fridge/pantry/freezer save, edit, move and remove; one shared Plan follow-up. |
| Food: fish (F02) | `fish`, `fish-detail`, `fish-notes`, `fish-note-new`, `fish-note-detail`, `fish-note-edit` | Waterbody search with jurisdiction/extent, species and independently selected official-style audience; overlapping statewide/local rules kept distinct; unresolved/no-match outcomes; original source wording/version; save/follow/source-only share; private catch/consumption creation, correction, deletion and export. |
| Food: gardens (F03) | `gardens`, `garden-new`, `garden-detail`, `garden-edit`, `garden-links` | Separate growing sites; optional coarse place; explicit unknowns; irrigation distinct from drinking water; user confirmation of shared source; soil context, purpose and questions; site revision history; focused test-link editing and preparation; consultation follow-up; site brief export; confirmed deletion retains separate tests and actions. |
| Food: evidence (F04) | `evidence`, `evidence-detail` | Supported geography/category/type filters; scoped notice versus broader-study records; applicability and original dates; changed/superseded context; source/save/follow/share; private questions and optional confirmed report link; empty coverage paths. |
| Food: resources (F05) | `growers`, `grower-detail` | Region/concern filters; compare two service scopes; method/medium/availability limitations; preparation checklist; site and confirmed-test links; questions; explicit external handoff; user-reported inquiry/application progress and reference/response; separate saved follow-up; export/delete inquiry. |
| Food: stewardship (F06) | `water`, `usage`, `usage-new`, `usage-detail`, `usage-edit`, `usage-compare` | Dated categorical county distribution/history; separate utility match/notice/missing/stale examples; follows; shared practical actions; original interval or cumulative usage entry; correction history; measured compatible comparison; reset/mismatched-source/estimated/unequal-period guards; export/delete. |

Unknown or removed record IDs have a useful unavailable state. They never load another household's sample record as a replacement.

## State ownership and cross-feature continuity

- `HomeWorkspaceProvider` lives in the preview layout. It owns isolated in-memory collections and drafts. It imports no authenticated transport and does not use local storage, cookies, a database or provider APIs.
- All entry points start with the same synthetic tests, equipment, observations, garden and usage fixtures. Opening Summary first is not dependent on visiting an editor first.
- Domain records remain distinct typed objects in `home-test-preview.ts`, `home-maintenance-preview.ts` and `home-food-preview.ts`. The shared collection wrapper is not a proposed server schema.
- Garden test preparation passes the selected site context into Tests. A site's current irrigation description must not relabel an earlier collected sample. Existing report links do not turn a household water sample into a garden-soil result.
- PFAS, radon and lead factor pages expose related current-home sample tests separately from public evidence. They link to the same test records and retain the factor context for preparation/filtering.
- `ExpandedPreviewProvider` remains the sole sample Plan action owner. Homeguard follow-ups use stable `home:<origin-id>` keys, independent of a later title edit. Reopening edits the existing action, not a second task. Completion never changes a contaminant reading or score.
- Summary consumes the same collections and sample actions. It does not create its own copies of the records or make new measurements.
- Form drafts survive internal navigation and failed saves. Browser exit protection is best effort for edited record drafts. View filters do not themselves imply unsaved record changes. Reload still clears this explicitly labelled review session.
- Successful synthetic writes increment revisions centrally. Simulated failure/conflict does not overwrite a record. Duplicate pending writes to the same record are blocked. Offline writes are rejected without an offline queue.

## Review states

The existing **Expanded app review** disclosure contains a Homeguard state selector:

| State | Review behavior |
| --- | --- |
| Ready | Interactive fictional records and local changes. |
| Empty | Clears sample collections for a first-use review. Reset restores fixtures. |
| Loading | Visible loading state and explicit finish control. |
| Error | Section failure with retry; no empty-as-success substitution. |
| Offline | Retained sample information can be read. Record saves are not queued or reported successful. |
| Stale | Notice to inspect original evidence dates; records remain distinct from dated environmental evidence. |
| Conflict | Save is rejected, local draft retained, no overwrite. This is a scenario demonstration, not a live server conflict resolver. |
| Save error | Save is rejected and edits retained for a deliberate retry. |

Food also supplies local no-coverage, unknown audience/species, unresolved source, notice scope and utility-association cases. Summary can omit one optional unavailable section without losing the others. The failure selector is in the external Expanded app review controls, not the household Summary screen. Resetting records does not silently delete independently saved Plan actions; those have their own review reset.

## Evidence and privacy boundaries

Advisory wording, waterbodies, example products, quantities, sample dates and county distributions in the record workflows are clearly identified as fictional review data. Official URLs are reference destinations, not proof the displayed fixture came from that agency. No real notice, meal limit, medical recommendation or live source-monitoring service is represented as active. The separate Food at home guide uses real, curated FDA, EPA and NC State Extension educational sources, checked October 3, 2026. Its editorial review date is not a sample date or a live fetch. The guide never estimates an individual food's contents, concentration, dose or safety.

## October 3 usability refinement

Luna availability follow-up: the shared app launcher is available on expanded destinations and Settings, as well as Today, Homeguard, factor and household pages. Map retains its existing launcher. Explicit service-off/review-off flags and session gates are preserved; onboarding is unchanged. Luna does not read private form drafts automatically. Opening and closing the panel preserves the underlying page and unsaved Homeguard form text. Verified 35 representative routes, the draft-return check, eight expanded regressions and five isolated live-adapter checks, including Settings request context. TypeScript, static build, isolated main build and archive integrity checks passed.

The new subpages now use the existing Instrument Sans family, centered headings, restrained section-specific line illustrations, stronger borders, aligned icon controls and single-column form fields. Search icons are contained in their inputs. Motion respects reduced-motion settings; decorative art is omitted in high contrast. All changes are scoped to these unapproved Homeguard workspaces.

Tests now starts with **Plan a test** and **Add a report**. Existing results can be recorded without fabricating earlier arrangement or collection milestones. Maintenance separates recurring home care from moisture observations. Summary keeps its two environmental choices visible, with private records and extra fields behind explicit opt-in disclosures. Food keeps every existing branch and puts the practical Food at home entry first. Source definitions and qualifiers remain available, not discarded for brevity.

Food at home's search, category guidance, origin-sensitive next step and source references can ship as versioned frontend content. It does not require a contamination-scanning service, ingredient database, inventory platform or new environmental feed. Its optional saved food notes currently live only in the isolated session. For production, first assess reuse of the planned private food-question contract; if it cannot retain guide ID/version, origin, question and ownership/revision metadata, document and agree a small contract extension. Do not silently treat the preview `PantryItem` shape as an approved backend schema. The public educational catalogue needs a source-review lifecycle, and saved notes need authenticated persistence/deletion. Reuse the existing Plan contract for follow-up, rather than adding a second task system.

The interface deliberately preserves:

- Original reported values, units, qualifiers and reporting limits. Non-detect, less-than, numeric zero, missing and unclear are not interchangeable.
- Uninterpreted records and visible clarification reasons. User transcription confirmation is not laboratory validation or a safety determination.
- Public utility samples versus home measurements, county radon estimates versus home tests, outdoor mold estimates versus indoor observations, and unscored lead context.
- Full food/advisory scope. A distribution area is not a company address. A fish marker or radius is not the official advisory extent. Serving allowances are never summed or calculated from logs.
- Routine fertility testing versus contaminant testing. Regional water or soil data does not measure a crop or justify a local PFAS food score.
- County drought proportions versus household classification; source-dated utility rules versus regional drought; private meter use versus attributed savings.
- Explicit selection of private records and fields in Summary. Household categories, place labels, notes and attachment references start off. Original file contents/metadata are excluded from the summary. Selected record titles may themselves contain text entered by the user and should be reviewed before sharing.

Local test files are previewed only in the current attachment view and are not uploaded or saved to a private file service. No extraction is claimed. Moisture photos are local review data only. All file paths are omitted from URLs. Summary exports contain selected information, use neutral filenames, and create no public summary link. External resource links transmit only the public URL, not the private checklist or reports.

## Production work still required after visual review

The existing [frontend plan](../../docs/product/HALO_FRONTEND_BUILD_PLAN.md), [backend plan](../../docs/product/HALO_BACKEND_AND_DATA_PLAN.md), [source acquisition guide](../../docs/product/HALO_SOURCE_ACQUISITION_GUIDE.md) and [feature acceptance](../../docs/product/HALO_FEATURE_ACCEPTANCE.md) remain authoritative. Vibhav's delivered backend handoff is not rewritten by these prototype record shapes.

1. Obtain visual approval, then capture a separate immutable baseline. Do not overwrite an older approved archive.
2. Add authorized production routes, context/identity ownership and on-demand typed clients to the existing StageSession/StageRuntime path. Never mount this fixture provider as a fallback on a live route.
3. Implement agreed server revision/idempotency/error/unknown-write reconciliation and retained-draft conflict resolution. The in-memory delay is not a backend adapter.
4. Connect private home/site/test/result/asset/observation/inquiry/use records, historical context and deletion/export lifecycle. Validate ownership and linked record revisions server-side.
5. Connect reviewed fish geography/audiences/full wording/versioning, food distribution/sample/recall scope, grower directory data, drought categories and applicable utility notices. Add live paging, request cancellation, retries and per-source freshness. The fish-advisory geography renderer depends on the separate Map stage; text extent is not that renderer.
6. Connect upload/quarantine/size/type/scanning/signed preview/deletion and optional extraction confirmation. No local file viewer certifies a file or its contents.
7. Finish shared Plan scheduling, occurrence IDs, reminders, source-watch delivery and deep-link return behavior. Current shared Plan supports a local all-day date and simple status only; H07's cadence math is a preview, not a background scheduler.
8. Review actual health/environmental wording and source attribution, translation, locale/date/number formatting and supported export formats. The summary now creates a real local PDF, with HTML/image/print alternatives. This is not a server-generated report or AI analysis. No new PDF/export service is assumed.
9. Run authenticated integration, real contract fixtures, accessibility/keyboard/screen reader, physical mobile Safari, permissions/native sharing and live performance tests. Chromium emulation and stubbed share-sheet errors do not establish those results.

Act, full Plan, Journal, full Settings and richer Luna contracts are separate stages. Building these Homeguard flows does not imply those destinations are complete.

## Verification

### Food-photo removal, October 3

The latest user revision removes all actual food photographs: catalogue thumbnails, kitchen shelf photos, add/detail portraits, photo credits and no-photo placeholders. Small illustrated food icons remain. Food entry, kitchen records and published PFAS/lead evidence are unchanged. This supersedes photo coverage in the historical revision notes below and in earlier backend suggestions.

Validation: 27 browser checks, 11 food logic checks, TypeScript, scoped ESLint and the static production build passed. Tests reject any food-image request and check all five formerly photographed foods across search, add, saved detail and kitchen views. Both approved archives remain intact. The removed image files have a recoverable local copy under `tmp/removed-food-photos-20261003`; the prior Sites version also preserves them.

### October 3 food evidence and blue Luna refinement

Luna now carries a paper stack with both arms, moves for 4.2 seconds and has bouncing top sheets. Recorded checks appear in sequence and remain unobscured. Unrecorded steps deliberately stay empty; users can explicitly fill an earlier event through the collapsed menu. The illustration is decorative, not a lab connection or an AI review.

Food at home now supports direct custom entry and optional details, food-specific illustrations, five licensed representative photographs, and four historical FDA study records. Public findings for tuna, salmon, whole milk and spinach include original compound, units, sample counts, period, analytical limits, source and scope. They never populate the household item's unknown level. Catalogue aliases and user labels are discovery aids, not product/lot matching. Missing photos or studies never prevent saving. All kitchen saves remain session-only. Broad provider search, product images/barcodes, source ingestion, exact food-report linkage and evidence updates are documented in [the new integration addendum](../../docs/product/HALO_FOOD_EVIDENCE_EXTENSION.md), not claimed as implemented services.

Garden utilities use compact Edit/Export rows, a separate Manage site disclosure, and a focused test-link editor. Existing reports keep their original context. No backend routes, schemas, approved visuals or score logic changed.

Final verification: all 425 repository logic tests and 132 static-export browser checks passed. Coverage includes custom entry, failed saves, photo failure, source scope/units, non-detect semantics, hidden-field validation, garden link conflicts, blue Luna motion and checks, retained prior PDF/Plan/food/map flows, and 320px/150 percent text in both appearances. TypeScript, scoped ESLint, isolated main production build and static export passed. The Windows Sites helper's existing npm shim-path issue was bypassed using the unchanged project's Next build entry. Both archives remain intact: 204 onboarding files and 146 foundation files. Physical-device Safari, authenticated integrations and real chemistry estimation remain unverified or unimplemented as described above.

### October 3 Luna timeline, virtual kitchen and PDF revision

- Tests now have a measured vertical progress track with an in-view Luna robot run, paper stack, hover/focus/tap introduction and sequential checks. Only actually recorded stages check off, including when a report was imported without earlier steps. Completed-stage pencils open the existing editors. Result transcription and the linked Plan follow-up retain their distinct meanings. Reduced-motion users see the final state directly.
- Food at home has 148 named catalogue entries and searchable aliases, with Fridge/Pantry/Freezer shelves, add/edit/move/remove and retained optional questions. PFAS and lead are the only kitchen contaminants. Levels remain Unknown without exact supporting evidence. FDA food guidance is real, but catalogue membership is not laboratory coverage. Kitchen records remain in-memory for the review session, not durable account data.
- Household Summary generates a text-selectable, paginated PDF on the device. Luna is the interface guide, not an AI reviewer. The local builder has staged progress, cancel/retry, font/error fallback, download/open and capability-checked native file sharing. Optional private records/fields remain off by default; original source dates and omissions are retained. No report data leaves the device during generation. HTML, image and print alternatives remain under Other formats, and included content can be expanded for review.
- The PDF libraries are loaded on demand. `scripts/build-report-font.py` derives a static Instrument Sans instance from the existing licensed font, avoiding a variable-WOFF2 subset failure. Onest and the standard PDF font provide additional scientific-unit glyph coverage; unsupported glyphs fail explicitly and offer the intact accessible-text export, never silently replacing a value. This build-time font helper is not a production Python dependency.
- Product plans now specify canonical Plan links for user-chosen follow-ups, not duplicate tasks for every saved measurement or food. New pantry persistence/catalogue/matching and per-stage provenance requirements are explicit in the backend delta. The previously delivered hashed working packet is historical; `docs/product/ai/README.md` directs Vibhav to the new delta.
- Dependency audit reports eight existing high-severity toolchain dependency findings. None are attributed to the new PDF packages; no unrelated forced dependency upgrade was applied.

Final verification for this revision: 420 repository logic tests passed, including four new PDF layout/generation/cancellation tests. The final static build passed 121 browser checks covering old journeys plus the timeline, optional-question kitchen CRUD, PDF creation/cancel/retry/font failure, selected-result warnings, downloads, share outcomes, keyboard use and 320px/150 percent text in both appearances. An earlier combined run passed 119 before the final optional-question and report-context checks were added. Both production builds and TypeScript passed. Default and selected-test PDFs were parsed and rendered for visual inspection, confirming original dates, qualifiers, missing-unit/basis warnings and excluded private records. The 204 onboarding and 146 foundation preserved files remain intact. Physical-device Safari and real native share-sheet delivery remain unverified.

Refinement verification, October 3: 415 logic tests passed, including five new food-guide tests. The final rebuilt static export passed 101 browser checks, including 41 Homeguard checks and 60 existing expanded/map/navigation/hosted-entry regressions. A keyboard-focus race found under concurrent load was corrected so initial hydration does not steal focus from an already selected control; the targeted keyboard journey passed ten consecutive runs, followed by the full 101-check pass. Result qualifier labels and wrapped-button/search-icon alignment were also checked directly. Both appearances, 320px/150 percent text, normal phone screenshots, reduced motion, high contrast, private defaults, offline/failure drafts, report shortcuts and food-note Plan identity were covered. TypeScript, the isolated main application build, static build, and both archive integrity checks passed. Existing physical-device/native-share/authenticated-backend limitations below still apply.

Logic coverage lives in `test/frontend-home-*.test.mjs`. Browser coverage lives in `test/ui/home-*.spec.ts`, alongside the expanded/map/section-navigation regressions. Browser checks reject backend and third-party requests; local sample mutations and downloads are intentional.

Run the repository typecheck and logic suite, archive integrity checks, a static production export, then the browser suites against `scripts/serve-wireframe-export.mjs` on a separate loopback port. Review screenshots belong in test output, never in approved archive directories.

October 3 verification: 410 repository logic tests passed, including 27 new Homeguard domain tests. Repository TypeScript and focused lint for the new components/helpers/browser tests passed. The isolated fake-auth main application production build passed; the final separate static review production build also passed.

The final static export passed all 90 combined browser checks, with third-party and backend requests rejected: 30 new Homeguard checks plus 60 expanded/map/section-navigation/hosted-entry regressions. Coverage includes all five Food branches, garden-to-test continuity, result corrections and conflicts, cadence and occurrence inspection, private-summary choices, actual downloads, share cancellation/denial/unsupported outcomes, offline and missing records, keyboard focus, and 25 deep-link views at 320px/150 percent text in both appearances. Phone/desktop screenshots were inspected. The enlarged-text section navigation and route focus were corrected after the first review. A separate earlier combined run also passed 90 checks before the final local-file reset and heading-focus styling refinements; the final run was repeated against the rebuilt export.

Both immutable archives passed integrity checks: 204 onboarding files and 146 foundation files. No approval screenshots were replaced. Physical-device Safari, authenticated backend integration and real native share-sheet delivery remain unverified. The Windows Sites build helper hit an npm shim-path error; invoking the project's existing Next build entry directly produced the tested static export without changing dependencies.

## October 3 finishing pass

- Fixed the fish extent button's oversized icon by restricting diagram styles to the actual illustration. Labels remain readable at 320px with 150 percent text.
- Spaced facts, disclosures and actions; stacked enlarged fact lists; retained the existing Instrument Sans hierarchy and restrained illustrations. Results and comparison tables now have readable columns, a scroll hint and keyboard-focusable labelled regions.
- Red trash icons and visible Delete labels identify destructive record tools. Confirmation names the target and consequences, uses Delete/Cancel, blocks duplicate/offline changes, and shows failed mutations inside the modal. Test records with result/correction history retain the deliberate typed confirmation.
- Added routine deletion. It removes that routine and its history, not separate tests, moisture observations or saved Plan actions. Removed associations are explained; editors preserve the prior link until the user chooses to unlink it. Production implementation must use owner checks and the existing revision/deletion contracts, not the preview collection filter.
- Simplified routine tools, made observation labels readable, fixed singular recurrence copy, and added test-search reset. Exact origin keys prevent a similarly named record from borrowing another record's Plan action.
- Food evidence retains exact values, units, non-detect qualifiers and item-versus-study boundaries. Repeated narrative is in source details, not repeated around the metrics; the duplicate food-guidance disclosure is removed. Food photographs remain absent.
- Food tools are near the record heading. Moving food returns to the correct storage section. Fish search clears a selection that no longer appears in its results. Copied and downloaded references retain the same title, source version and scope. Reference saving/following is disabled offline; source reading and sharing remain available.
- Summary failure simulation is in the external review toolbar. Report generation resets by report/attempt identity, so an old PDF link cannot linger when another selection begins generating. Privacy opt-ins and on-device generation are preserved.
- Design checks used [GOV.UK button guidance](https://design-system.service.gov.uk/components/button/), [supporting details guidance](https://design-system.service.gov.uk/components/details/) and [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). These informed clearer action labels, restrained disclosures and retained 44px touch targets, not a replacement of HALO's visual style.

All changes remain an unapproved, sample-only review. No backend routes, authenticated persistence, actual food-level estimates or approved archive contents were added or changed. The new focused regressions live in `home-food-polish.spec.ts`, `home-records-polish.spec.ts` and `home-polish.spec.ts`.

Final validation for this pass: 426 logic tests and 158 browser checks against the rebuilt static export passed. Coverage includes source matching, record CRUD and cancelled/failed deletions, retained linked records and Plan actions, keyboard table scrolling, responsive icon geometry, large text in both appearances, PDF create/cancel/retry/fallback, Luna, shared factors and map regressions. TypeScript, Homeguard scoped ESLint, isolated main production build and static export passed. Both immutable archives verified intact (204 onboarding and 146 foundation files). A Windows/OneDrive build-cache unlink error was resolved by moving only the generated `.next-stage-test` output to `tmp/homeguard-build-pre-polish-20261003` and rebuilding; no source was removed. Physical-device Safari and authenticated backend integration remain unverified.

## Published review

October 3 scorecard/action refinement: Homeguard now shows its three factor cards and lead-scope note directly after the score summary, above household guidance and the house. Generic Save this step controls were removed from all factor and household advice, including the duplicate family save-only section. Guidance, step navigation and scan-all text are unchanged. Explicit Save to Plan controls on record/planning workflows, existing actions and optional scheduling remain. Validation passed: 59 static-export browser checks, all 426 logic tests, TypeScript, scoped lint, static production build and both archive integrity checks. No backend or immutable archive was changed.

**Current version 19** publishes the scorecard order and selective Plan-control refinement at the same public [HALO Wireframe Review](https://halo-wireframe-review.yogirajapaturi.chatgpt.site/foundation/preview/expanded/?tab=home). Source `da641dc08dcb13f426975a29a6ca0274f416dc8c`; saved version `appgprj_6abd679629688191ae2eea6173fb2b49~appgver_150927e7a9108191bf223fb7e3e58526`; deployment `appgdep_6ac1b783d4d08191b446feae1026e9e6` succeeded October 3, 2026 (America/New_York). The tested static archive is `halo-homeguard-order-20261003.tar.gz` in the existing Codex visualization workspace. Audience and review URL are unchanged. This is not a GitHub push, PR or backend deployment.

Version 18 published the Homeguard finishing pass. Source `b82151f22c16cd78067d6d894eaddd067a10f484`; saved version `appgprj_6abd679629688191ae2eea6173fb2b49~appgver_454ab9e2d4488191ae70b73675af3b18`; deployment `appgdep_6ac19e4ea4bc819189febcfeb550aa82` succeeded October 3, 2026 (America/New_York). The prior static archive is `halo-homeguard-polish-20261003.tar.gz` in the existing Codex visualization workspace.

Version 17 removed all actual food photographs while retaining illustrations and the food workflows. Source `2e3bada8d4c5b0b37d393f64467ba541cdf8691b`; deployment `appgdep_6ac195ee19bc8191960f8f135efa14a1` succeeded October 3, 2026. It and the versions below are historical. No approval archive or live backend changed.

The food evidence, blue Luna and cleaner garden revision was published as **version 16**, source `b5428b00aeda2a6f67e5ccd7c68e7c5a14f3a6a9`. Deployment `appgdep_6ac190dbc5688191bfa249740c8c38ca` succeeded October 3, 2026 at the same public [HALO Wireframe Review](https://halo-wireframe-review.yogirajapaturi.chatgpt.site/foundation/preview/expanded/?tab=home&destination=food&homeView=pantry). It is superseded by version 17, not production integration or visual approval. Local source and product requirements remain in the halo-app working tree; this publication does not push GitHub or create a PR.

The prior Luna timeline, virtual kitchen and local household PDF were published as **version 15**, source `4f335e718ade8bf83a2116bf1646648f6f599363`. Deployment `appgdep_6ac18515f52c8191b295b4acc9c7d992` succeeded October 3, 2026 at the same public review URL.

Luna's shared-page availability was published as **version 14**, source `74c396a5620ea7a3c33b258f17da34653c00b655`. The Sites deployment `appgdep_6ac169ac99e48191ac08fa0faf079704` succeeded October 3, 2026, preserving the same audience and URL.

The usability refinement is published as **version 13** at [HALO Homeguard review](https://halo-wireframe-review.yogirajapaturi.chatgpt.site/foundation/preview/expanded/?tab=home&destination=food), using the Sites workflow and preserving the audience. Exact source commit: `5f2efad73400ecb3baa905bce4e0993a422e7a79`. Native deployment `appgdep_6ac1673cee2081918458f49e14b164e5` reported success on October 3, 2026. This supersedes version 12 for review only, not as an approval baseline or production integration.

The previous candidate was published successfully as **version 12** at [HALO Homeguard review](https://halo-wireframe-review.yogirajapaturi.chatgpt.site/foundation/preview/expanded/?tab=home), preserving the existing Site audience. The separate Sites source commit is `2bdc76e8f92de66dbef36d18322f692ec51910eb`; the archive was built from that exact pushed source. The native deployment reported success on October 3, 2026.

This publication is the phone-accessible wireframe Site, not the production HALO website. It does not imply a GitHub push, a new PR, backend integration or approval of these visuals. Local implementation and this coverage note are in the existing repo working tree; unrelated work was preserved. The static QA server was used only for verification and is stopped after publication.
