# HALO Complete App Plan

Version 1.1, October 2, 2026. Prepared for Yogi and Vibhav from the current repository, approved work, original specification, and the product decisions in this conversation. This revision adds the detailed frontend build guide, backend implementation inventory and cross-feature integration requirements.

This is the consolidated target product plan, not a claim that the target is already built, scientifically validated, deployed, or visually approved. It preserves established capabilities and gives the new features concrete jobs, data requirements, interactions, and completion criteria. New layouts still require Yogi's wireframe review. New backend work is planned here, not performed by creating this document.

The recommended navigation is **Today, Homeguard, Act, Plan**. Plan is the recommended fourth tab and remains a product decision for Yogi to confirm. Moving Map and Journal into this structure preserves their capabilities. Implementation order is not a cut list.

Read this document for product behavior, [Frontend Build Plan](HALO_FRONTEND_BUILD_PLAN.md) for screens, controls, state and reuse, [Backend and Data Plan](HALO_BACKEND_AND_DATA_PLAN.md) for implementation contracts, and [Feature Acceptance](HALO_FEATURE_ACCEPTANCE.md) for preservation and release tests. Together they form the plan. None replaces the original reference or an immutable approved archive. The 45 feature identifiers describe capability groups, not a limit of 45 screens; each group can include multiple detail pages, forms, dialogs and states.

October 3 source audit: the [Backend Build Handoff](HALO_BACKEND_BUILD_HANDOFF.md) maps every feature group to implementation work. The [Source Acquisition Guide](HALO_SOURCE_ACQUISITION_GUIDE.md) records exact source paths, inspected payloads, storage/display constraints and remaining gates. Public NC fish and conservation services and an FDA food recall API were located and sampled. Their availability does not establish complete local food coverage or validate raw advisory interpretation.

October 3 later Homeguard refinement: H06 gains the Luna timeline and stage editors, H08 gains a locally generated PDF, and F01/F04 gain a private kitchen inventory limited to PFAS and lead context. Canonical Plan follow-up rules remain unchanged. These additive wireframe requirements are detailed below and in the [backend integration delta](HALO_BACKEND_AND_DATA_PLAN.md#october-3-homeguard-integration-delta); the earlier compiled backend packet does not yet include them. New visuals remain subject to review.

## Purpose and intended outcomes

HALO helps a household understand environmental conditions, distinguish evidence from uncertainty, act on what matters, and participate in local environmental improvement. Its organizing sequence is **evidence, meaning for this household, practical choice, action, and follow-up**.

The app connects three timescales without mixing their meaning:

- Today's outdoor conditions and available forecasts.
- Longer-lived home, water, soil, and official advisory information.
- The household's own plans, observations, records, and participation over time.

Success means a person can answer a useful question and complete an appropriate next step. Examples include understanding a water result, arranging a test, preparing a sourced question for a utility, checking a fish advisory, choosing between forecast periods, following a conservation opportunity, or recording a maintenance task. A completed task is not proof of lower exposure, better health, or pollution removed.

HALO remains useful with no Journal entries, no notification permission, no linked account, and no purchased hardware. It is not a medical diagnostic system, emergency alert replacement, laboratory, farm certification service, or a declaration that a property or food is safe.

### People the design must work for

| Situation | Product need | Design consequence |
| --- | --- | --- |
| Busy household | Understand the immediate situation without reading an essay | Short landing pages, deeper detail on demand |
| Renter | Options they can actually control | Renter wording, information requests, portable actions, landlord follow-ups |
| Private well or spring user | Useful help even with no utility sample | Testing journey instead of invented results |
| Household with a sensitive category | Relevant explanations without medical profiling | Selected category guidance, no named-person risk predictions |
| Older or low-vision user | Legibility and predictable controls | Larger text, visible labels, low motion, no gesture-only actions |
| Gardener, fisher, or grower | Specific local evidence and practical resources | Optional focused branches, source-aware guidance, test and advisory records |
| Community participant | A credible way to help | Verified opportunities, clear participation requirements, official reporting paths |
| Weak connection or limited device | Core information remains usable | Small initial load, cached evidence with dates, text map alternative |
| Reviewer or professional | Understand how a result was obtained | Sources, methods, limitations, and a private export chosen by the user |

## Established decisions and authority

The latest direct user decisions and repository instructions take precedence over older reference wording. The original PDF is a functional inventory, not an instruction to restore old names, ownership, layout, or deployment commands.

Preserve these decisions:

- Yogi is the sole frontend person. Vibhav handles backend integration. This plan does not reintroduce the PDF's old assignments.
- Today is the page name, not Personal Hero. Its scored factors are air, UV, pollen, and mold. PFAS belongs to Homeguard and never enters the Today score.
- October 3, 2026 clarification: Today and its air, UV, pollen and mold detail pages keep their current content depth, sections, visuals and overall layout for now. Do not substantially shorten them under the broader simplification plan. Small refinements and reviewed additive connections remain possible; substantial cuts or restructuring need a separate user decision.
- Homeguard retains water and radon scoring. Lead remains shown but unscored. Excluded water compounds remain visible with explanations.
- Keep the approved logo, onboarding handwriting, centered Welcome and to HALO treatment, and immediate access under reduced motion.
- Keep the approved blue and teal identity, rounded navigation, factor tints, contextual scenes, selected household figures, Luna name and symbol, and UV rising-sun treatment. No deer.
- Factor cards navigate to dedicated pages. They do not revert to expandable overview cards.
- Keep the step-card deck with previous and next arrows. Browsing a step never marks it completed.
- Household icons appear only for selected categories. Their count is not the number of people in the home. Respiratory Issue(s) replaces the old Breathing label.
- Keep all seven category routes already preserved in the approved stage. Child, teen, and adult guidance can share general content where there is no meaningful distinction; no forced duplicate advice.
- Appearance follows the device. Atmospheric time follows the clock and is not a weather observation. Accessibility preferences remain available.
- No em dashes in app-facing text, including sourced or generated content and accessibility labels.
- Approved Settings use explicit Save and retained drafts, not the older PDF's automatic saves.
- Never replace the sealed onboarding or October 1 foundation archives. New approval receives a separate baseline.

Existing production-stage scope is recorded in [the handoff](../foundation/STAGE_FRONTEND_HANDOFF.md). The current [Map work](../map/README.md) is an unapproved fixture-driven review, not a connected production map. New backend willingness broadens this plan's possibilities; it is not authorization to mutate the production database or deploy unfinished features.

## Build on the existing application

This is an extension of the current HALO application, not a replacement project. Repository code is evidence of an implementation, not proof that the same revision and every credential or job are configured in production. The historical context describes earlier versions and must not override inspected code or newer user decisions.

| Area | Existing foundation to retain | Change required for the target |
| --- | --- | --- |
| Entry and identity | Approved onboarding, anonymous Supabase identity, authoritative profile gate, request recovery | Add optional durable recovery and home-context history deliberately, without adding mandatory registration |
| Live shared shell | StageApp, StageSession, StageRuntime, protected transport and safe return routing | Extend the same shell and route allowlists for reviewed new pages and four-tab navigation |
| Today and factors | Approved components, environmental scenes, daily/history/Learn adapters | Add supported change explanations, saved actions and forecast entry; do not invent missing factor scores |
| Homeguard and family | Existing home response, evidence panels, household flags, action-plan rules and guidance routes | Add owned tests, maintenance, garden contexts and follow-up; keep regional and property evidence separate |
| Luna | Approved UI and current question/page transport, retrieval and source links | Add truthful context capabilities, bounded conversation and confirmed action proposals |
| Alerts | Inbox, read/dismiss, preferences and browser-push server routes | Finish the preference UI, service-worker/device delivery integration, subscriptions and durable reminder delivery |
| Journal | Entry, retrospective, findings and summary server routes | Build the reviewed frontend and correct interpretation semantics without erasing recording capabilities |
| Map | Server map/district datasets and an unapproved interactive preview | Review and implement the production renderer, source/date semantics, query adapters and accessible equivalent |
| Act | Organization lookup and existing home/context data | Build civic pages, letter/export flows, then opportunities, projects and reporting records |
| Full Settings | Essential live forms and device accessibility preferences | Complete language, notification, privacy, export, deletion, source/method and recovery surfaces |
| New persistent domains | Current identity, database, API and source pipeline | Add shared actions, Plan, evidence revisions, tests, food/advisory records and participation within the existing stack |

The current production route set does not yet include working `/map`, `/journal` or `/act` page implementations. Their original planned URLs and notification destinations should guide stable future routes. A backend API, a preview route and a finished live page are three different completion states.

Platform remains a responsive web app with a mobile-first layout and a usable wider-screen presentation. Native iOS/Android packaging, hardware procurement, continuous background location and shared family accounts are not implied. Browser-install/offline capabilities and Web Push require their actual supported browser and service-worker paths to work; a manifest or Capacitor configuration alone does not establish them.

Keep current inline SVG chart patterns and the established component/icon system. A new package needs a concrete functional or maintenance reason, size/accessibility review and approval of any visible changes. Do not replace the existing auth client, create a second global household store, or add a new charting framework simply because a new page needs one chart.

## Navigation and page ownership

Every feature has one primary home and may have several contextual entrances. A contextual entrance reuses the same underlying record and action, not another copy of the feature.

| Primary home | Pages and subpages | Main cross links |
| --- | --- | --- |
| Today | Overview, air, UV, pollen, mold, daily household guidance, meaningful changes | Relevant map record, Journal check-in, outdoor plan, saved action |
| Homeguard | Overview, selected household guides, water, radon, lead, tests, maintenance, household summary, Food and Garden | Plan follow-up, Act outreach, sources, selected utility on Map |
| Act | Overview, organizations, opportunities, stewardship projects, outreach, field observations, Explore Your Area and district view | Plan participation, relevant home evidence, official registration or reporting |
| Plan | Your Week, saved actions, action detail, outdoor plans, Journal and Patterns, seasonal recap | Original reading, test, organization, event, or advisory |
| Shared | Luna, Learn, alerts, source detail, Settings, privacy, accessibility, export preview | Return to the exact originating context |

Recommended route organization preserves delivered destinations and the original planned URL contract:

| Route family | Treatment |
| --- | --- |
| `/onboarding`, `/today`, `/home`, `/factors/[factor]`, `/family`, `/household/[member]`, `/settings` | Preserve existing routes and safe return behavior |
| `/map` | Build the planned canonical map route; discoverable under Act, not a bottom tab. Its current wireframe is at a separate preview route. |
| `/journal` | Build the planned canonical Journal route; discoverable under Plan, not a bottom tab. Current Journal server routes are not a finished page. |
| `/act`, `/act/organizations/[id]`, `/act/opportunities/[id]`, `/act/projects/[id]` | Recommended civic discovery and detail routes |
| `/act/outreach`, `/act/observations` | Recommended outreach and private observation workflows |
| `/plan`, `/plan/actions/[id]`, `/plan/outdoors/[id]` | Recommended commitments and planning routes |
| `/home/tests`, `/home/tests/[id]`, `/home/maintenance`, `/home/summary` | Recommended home record routes |
| `/home/food-garden`, `/home/food-garden/fish`, `/home/food-garden/garden`, `/home/food-garden/food`, `/home/food-garden/growers`, `/home/food-garden/water` | Recommended Food and Garden branches |

Subpages use a clear back control. Opening a sheet adds one history entry; replacing its content does not stack sheets. Filters normally replace the URL state. Private notes, household details, precise locations, and draft letters never enter query strings. Links to public map selections can carry public IDs. Active navigation uses the owning tab; a contextual back link returns to the originating feature without losing its scroll, filters, or unsaved draft. All return paths are allowlisted.

Public civic exploration must not require a household address. Support a reviewed entry into public Map/district evidence, organizations and available public opportunities through the existing anonymous bootstrap or a separately reviewed public-read contract. The current APIs still require an authenticated anonymous token; this is not a promise that they are unauthenticated public endpoints. Before household setup, omit the home pin, personal ranking and household-matched wording. Saving private actions can explain its record/identity requirements without preventing someone from reading public information. Private pages retain their stronger profile and ownership gates. Any new Browse your area entry beside onboarding needs visual review and must not alter the approved Welcome presentation without approval.

## Shared feature requirements

The following apply to every feature below, so they are not repeated as a long checklist on every screen.

### Evidence and monitoring

Every displayed observation or advisory identifies its kind, geographic applicability, source, observation or sample time, publication time when relevant, retrieval time, units, quality, and missing-data reason. Not every source supplies every field; unavailable metadata stays unavailable. Retrieval today cannot turn an old sample into today's measurement.

Measured, modelled, proxy, forecast, official advisory, self-reported, and manually entered laboratory result are different evidence types. No automatic promotion between them. A regional reading is not a property measurement. Non-detect, measured zero, not tested, no record, failed source, and outside coverage are distinct states.

Monitoring means checking a named source or a user's explicitly recorded information at a stated cadence, detecting a defined change, and producing a traceable update. It does not imply an installed sensor, continuous observation, or access to unpublished information. Suggested operating cadences are targets to validate against provider rules and budgets, not current guarantees:

| Information | Proposed monitoring behavior | User meaning |
| --- | --- | --- |
| Air and forecast periods | Scheduled regional refresh plus cached reads; provider-specific freshness | Latest available observation or forecast, not second-by-second exposure |
| Official weather notices | More frequent batched polling with source identifiers, updates, expiry and cancellation | Supplemental information, not a replacement for official emergency channels |
| Utility samples and lead inventories | Check publication feeds or imports on their actual release schedule | A new published record, not a new sample taken by HALO |
| Radon zones | Versioned reference dataset | Background context, not live home monitoring |
| Fish and local advisories | Approved feed checks or documented human review | Last verified advisory status, with stale-source warnings |
| Drought | Source's weekly release | Regional weekly conditions |
| Utility conservation notices | Source-specific checks with original update dates | Published utility status, not an inference from drought |
| Events and organizations | Source checks, expiry rules, and human verification | Known upcoming opportunities, not guaranteed availability |
| Home tests, routines, observations | Updates when the user records them; reminders when chosen | Household record tracking, not automatic sensing |

### Action and interaction contract

Every actionable recommendation has a reason, applicability, source, suggested next step, and a definition of completion. Save and Schedule are separate. A recommendation is not automatically a commitment. User-created tasks can exist without an environmental claim.

The shared action state supports saved, scheduled, in progress, waiting, completed, paused, and cancelled. Only relevant choices appear in a given task. Completion can be reopened; deleting and cancelling are distinct. Original evidence is retained as a dated snapshot while the latest evidence can be viewed separately. Changed evidence flags review rather than silently rewriting a promise or the user's text.

Mutations show pending, confirmed success, failure with retained input, and conflict when another device changed the record. Retrying must not create duplicate tasks, entries, reminders, or exports. External links never imply a registration, purchase, report, or message was completed.

### Relevant guidance without a competing recommendation feed

Keep severity, relevance and urgency separate. Existing Homeguard recommendations already use severity, household context and renter/owner wording; extend that deterministic, reviewed approach rather than asking an AI to rank health risks. Cross-feature suggestions add applicability, source freshness, whether the user already saved an equivalent action, current task state and a clear reason. No hidden personalized health-risk percentage is needed.

Present an official applicable notice distinctly from a household task. Then show the most useful eligible next step, with other suggestions available below it or in detail. A missing result may make obtaining information useful, but must not be ranked as a measured severe condition. An overdue administrative task is not an environmental emergency.

Users can choose Not relevant, Already doing this, Save for later or Stop this reminder where appropriate. Record these as recommendation preferences or task changes, not edits to environmental evidence. Show why a suggestion appeared and how to reverse a dismissal. Changed sources can request review of a dismissal only under a defined rule; they must not create repeated nagging.

### What completion actually records

| Action type | Required user confirmation or record | Follow-up behavior |
| --- | --- | --- |
| Read an explanation | No completion required to use the app | Offer a relevant practical choice without an artificial achievement |
| Arrange or perform a test | Arranged, sample collected and result received are separate events | Await the result, then review the confirmed record and any next step |
| Replace or maintain equipment | Completion date and optional user note | Schedule the next occurrence using the selected recurrence basis |
| Attend an opportunity | User-reported registration and attendance remain distinct | Retain the organizer source and optional personal participation record |
| Send a letter or report | User reports external submission, or a genuine integration supplies a receipt | Track a chosen follow-up and any user-entered reference or reply |
| Complete a project | Required steps resolved and a user-confirmed outcome | Keep observations separate from verified environmental measurements |
| Make an outdoor plan | A selected time and preparation choices | Review a relevant forecast change; do not assume the activity happened |

The shared action detail supports these typed outcomes with a small form relevant to the task. It does not show every possible status field to every user. Completion never updates a source reading, household score, symptom record or public participation total by inference.

### Cross feature changes

| Change | Views that update | Information that must remain unchanged |
| --- | --- | --- |
| Household category edited | Figure selection, eligible guidance and future category-sensitive alerts | Historical records and raw environmental values |
| New home confirmed | Current environmental context, utility association, relevant subscriptions and reminders after review | Prior-home tests, source snapshots and original historical dates |
| Utility result corrected | Water detail, Map record, relevant watch notice and saved-action review flag | Original source revision and the user's earlier draft or action reason |
| Test result corrected | Current test display, compatible comparisons and affected follow-up | Original transcription/document and its correction history |
| Event cancelled or moved | Opportunity page, linked Plan item and applicable alert | The user's original choice, participation history and source revision |
| Journal entry edited or deleted | Calendar, day detail, findings and season summary | Unrelated home records and public history |
| Advisory withdrawn | Advisory detail, watch notice, relevant saved-item review state | Historical evidence and optional catch notes |
| Session expires or identity changes | Authorization gates and current private surfaces | No private record may be reassigned to a replacement identity by guesswork |

Server mutations return the affected stable IDs and versions or trigger a bounded refetch. Frontend invalidation must cover these dependents, not only the originating card. Polling, focus refresh and push cannot independently create three copies of the same event.

### Common states and access

All features support loading, populated, genuine empty, partial evidence, source failure, stale data, outside coverage, offline cached, offline unavailable, and permission or identity failure where applicable. Forms also handle validation, duplicate submission, save failure, unsaved exit, expired referenced records, and deletion confirmation. No realistic fixture appears as live fallback.

Use semantic controls, keyboard paths, focus restoration, text alternatives, visible severity words, large tap targets, and reduced motion. The app must work without hover, swiping, animation, precise dragging, or color perception. Privacy-sensitive offline persistence requires explicit design; do not casually cache Journal notes, letters, photographs, or tests alongside public environmental data.

## Entry and onboarding

### G01 Entry and household setup

**Job:** reach a useful household view with minimal data and without mandatory account creation.

**Keep:** the approved Welcome animation and logo, address flow, selected household categories, home details, result reveal, anonymous session, progress/back behavior, failure recovery, and change-address pathway. Do not add interests, a farm questionnaire, notification permission, or AI consent as mandatory setup steps.

**Data and actions:** the existing onboarding and profile interfaces remain authoritative. Typed addresses are used for lookup and discarded under the existing policy. Household booleans are presence categories, not diagnoses or person counts. Users can skip optional information, correct it in Settings, and inspect how it changes guidance. Unknown water source and unmatched utility must lead to useful correction or testing choices.

**Enhancement:** ask feature-specific optional questions only when opening Food and Garden, outdoor planning, tests, or subscriptions. Offer optional recovery after the person creates something worth keeping, without making it a prerequisite. An address change must not attach old home test results to the new home: archive the old context, explain the transition, and let users deliberately carry appropriate generic tasks forward. This needs new home-context versioning.

Allow public civic browsing without requiring address setup as described in Navigation and page ownership. This is a separate route/access-mode enhancement, not permission to show household-specific mock data to an incomplete profile.

**Done:** first use, returning session, unavailable profile, expired session, denied location, no utility match, outside coverage, interrupted save, and changed-home flows are all exercised without losing or crossing household data.

## Today

### T01 Current conditions and meaningful changes

**Job:** answer what matters now and what the household might do differently.

**Surface:** centered title, approved ambient score hero, plain interpretation, source freshness, compact contribution explanation, fixed four-factor order, household guidance below the cards, then a small relevant planned-action or check-in entrance. Do not stack several recommendation feeds. Expand detail rather than repeating introductory paragraphs.

**Interactions:** tap a factor or ring segment to its detail; inspect score basis and missing inputs; compare a valid previous period; refresh with existing rate-limit feedback; open relevant alerts; save an offered action; resume today's saved action. A notification does not mark a task done. A second refresh does not remove retained readings.

**Real monitoring:** daily observations and history, with a proposed backend change summary distinguishing environmental change, changed source coverage, new publication, and method change. Compare only compatible periods and methods. Suppress unsupported score comparisons.

**Backend:** reuse daily/history/profile/alerts. Add per-source observation metadata and structured change reasons. Define any new factor display scores server-side with reviewed semantics. The existing API does not supply individual daily `/100` scores, so the live fallback remains Not scored, not fabricated values. Explain the ring's visual shares honestly; they are not automatically causal contribution percentages or formula weights.

### T02 Air quality

**Job:** interpret the current outdoor air reading and help choose a practical response.

**Content:** AQI and severity, dominant pollutant, measured or modelled basis, monitor or region when known, a dated trend with gaps, and source-linked household guidance. Keep raw AQI distinct from HALO's higher-is-better score.

**Interactions:** inspect individual trend points and accessible table; open pollutant explanation; view relevant monitor in Map; compare available forecast periods through P03; save an applicable action; open Journal for the same date without implying the air caused symptoms.

**Backend:** existing AQI, source, pollutant and history; add precise source observation metadata and supported forecast periods. Preserve area-versus-station distinctions. A distant monitor does not measure a user's route, classroom, or indoor air. Revalidate provider endpoints, licence terms, budget, and attribution before integration.

History must retain acquisition method and aggregation. The current backfill stores modelled daily-peak air values, while ordinary daily records can reflect a different observation context. A chart must expose this distinction or split the series; connecting them as comparable measurements can create a false apparent change. Extend the history response to carry the stored basis instead of losing it at the API boundary.

**Visual:** detailed sky with slow atmospheric movement and limited particles; chart and action areas remain still and legible. Pollution imagery must not falsely encode an unmeasured concentration.

### T03 UV

**Job:** understand available UV conditions and plan protection or timing.

**Content:** current index, rising half-sun window, available daily maximum, historical trend, protective guidance, and source date. Explicitly distinguish the forecast's local time from decorative sky lighting.

**Interactions:** inspect the returned protection window, open an explanation, compare times when forecast resolution permits, save a preparation step or activity plan, and inspect prior readings. A null window does not assert all-day low UV. Do not invent an hourly curve from two window endpoints.

**Backend:** reuse current UV/window/history; new forecast intervals must retain issue time, valid time, location and missing periods. User reminders are chosen tasks, not medical dosing or automated assurances that going outside is safe.

### T04 Pollen

**Job:** show which category matters and make changes understandable.

**Content:** tree, grass, and weed readings with their own severity; dominant category; genuine history; source-reviewed regional seasonal context; household guidance.

**Interactions:** select a category without moving the page, inspect its history, compare available forecast days, save an action, and view related Journal history. Do not treat a category change as improvement in the same series. General seasonal text is never presented as a current local measurement.

**Backend:** existing categories and dominant values; new multi-day forecasts depend on paid-provider coverage, terms, actual returned horizon, and caching permission. No invented hourly pollen timing from a daily forecast.

**Visual:** warm pale-yellow botanical accents and subtle plant movement; not the same scene as UV.

### T05 Mold conditions and indoor moisture context

**Job:** explain the weather-based indicator and help users address an actual moisture concern without pretending to detect mold.

**Content:** estimate label, humidity/rainfall basis, what the indicator does and does not represent, source-reviewed practical steps, and link to home moisture records. Do not add a fabricated mold trend when the source has none.

**Interactions:** inspect inputs; save a moisture check; record a user-observed leak, condensation, or meter reading in H07; track repair and follow-up; create a landlord information request when appropriate.

**Backend:** reuse proxy data and Learn; add private observation/maintenance records, not a new sensor claim. User-entered relative humidity includes unit, time, room label and measurement source. It remains separate from the outdoor estimate. No image-based mold identification or diagnosis.

**Visual:** restrained botanical/moisture scene with slow drifting detail. Decorative mushrooms are not presented as evidence of the indoor condition.

### T06 Daily household guidance

**Job:** compile what the selected household should consider today without duplicating all factor pages.

**Content:** the selected categories, most relevant current factors, concise source-backed interpretation, practical choices and any already-saved related task. General guidance works with no selected category.

**Interactions:** switch a relevant category or Outdoors/At home view; open the factor; save a step; edit household selection; open a relevant planned activity. Reuse the canonical action if another category suggests the same thing.

**Backend:** existing household and Learn are the starting point. A new compiled guidance response can return multiple applicable notes with evidence IDs, provenance and deduplication, rather than only one priority sentence. Categories affect wording and action priority, not environmental measurements or a person's inferred medical risk.

## Homeguard

### H01 Home overview and evidence coverage

**Job:** understand the home assessment, people it considers, and what needs follow-through.

**Surface:** existing hero and evidence basis, selected-household illustration, water/radon/lead cards, current ranked home actions, then compact entrances to tests, maintenance, Food and Garden, and the household summary. All branches are discoverable without making them giant dashboards on the landing page.

**Interactions:** open a factor or selected household figure, inspect assessment coverage, change incorrect home information, start a relevant test, save an action, or resume a pending follow-up.

**Backend:** reuse home/profile/household/learn. Integrate task and record summaries by stable IDs. Do not treat private-water missing data as a healthy result or re-score the house because a task was checked off. A clear coverage explanation accompanies a partial score.

### H02 Drinking water and PFAS

**Job:** understand the household's water evidence and take a feasible next step.

**Content:** utility identity, association basis, compound results and dates, source-defined comparisons, historical samples, coverage, unregulated detections, excluded substances, and regulatory/benchmark distinctions. PFAS remains prominent without concealing other existing water evidence.

**Interactions:** choose a compound, inspect a threshold row or historical sample, show exact units and methodology, open the utility in Map, follow new results, view certification guidance, save a practical action, draft a sourced utility or landlord question, or arrange a test. Confirm or challenge a utility association through a reviewed correction flow; do not let arbitrary client IDs silently replace verified service-area matching.

**Private water:** show the existing prioritized test plan, reasons, provider guidance, cadence and labelled estimated costs. No utility data is assigned to a well. Say HALO has no result rather than asserting nobody has ever tested the well. Distinguish well and spring context.

**Backend:** retain current home response. Add complete sample provenance, explicit tested/non-detect coverage when available, consistent analyte identities, threshold versions, publication changes, and links to home test records. Detections-only ingestion cannot establish complete testing denominators. Never copy drinking-water thresholds to food or soil results.

### H03 Radon

**Job:** move from regional context to a valid home testing and follow-up process.

**Content:** county zone as regional context; test options and approved source guidance; any household-entered test as a separate dated record; next step based on reviewed interpretation rules where supported.

**Interactions:** understand the zone, save a testing task, record test setup/start/end, track an expected result, enter or attach the report, review confirmed data, record a professional follow-up, and set an appropriate chosen review reminder.

**Backend:** reuse zone and action content; add test lifecycle and source-backed interpretation. Test location, duration, method, unit and report date matter. A user report does not overwrite the county dataset. Stop irrelevant pending-test reminders when a relevant record is confirmed, without inventing a universal retesting interval.

### H04 Lead and plumbing

**Job:** explain the existing estimate and help obtain better property-specific evidence.

**Content:** building-era estimate, unknown-year state, utility-wide service-line inventory where returned, shown-not-scored label, renter/owner options and testing guidance.

**Interactions:** correct the home year; inspect the utility inventory; ask about the specific service line; plan a test; add a report or professional record; track a landlord/utility follow-up. Retain context for well households through the appropriate testing plan.

**Backend:** existing estimate and inventory remain. Proposed records separate plumbing/service-line evidence from water sample results. Utility totals never establish a particular address's material. Lead remains excluded from the composite even when a record is added unless Yogi explicitly revisits that established decision through scientific and product review.

### H05 Household guidance pages

**Job:** compile relevant home guidance for a selected category.

**Content:** relevant evidence, why it matters, feasible actions, existing tasks/tests, and linked sources. The house illustration uses selected categories only and labels their meaning. General advice is shared for categories without a meaningful difference.

**Interactions:** open a household category; inspect the linked factor or test; save a nonduplicate action; return to the same house state. A category deselected in Settings disappears from the house, but does not silently delete historical Journal records or completed tasks. A removed-category deep link offers general guidance and an explanation instead of manufacturing a profile.

**Backend:** seven boolean categories remain default. No names, birthdates, or diagnoses are needed. Named household members, multi-user collaboration, or person-specific analyses are separate future decisions, not requirements hidden in this plan.

### H06 Tests and home records

**Job:** close the gap between advice to test and a useful record with a next step.

**Pages:** record list, test detail, provider/resource selection, sample/result entry, attachment review, and follow-up. The detail page shows a short timeline, not an elaborate project-management board.

**Timeline refinement:** a vertical progress bar and small running Luna robot carrying papers animate to the current recorded stage on first view, with truthful checkmarks appearing sequentially. Reduced motion shows the final state immediately. Hover/focus/touch can introduce Luna. Accessible pencil controls beside completed stages open their existing editors, replacing repetitive correction buttons. Result recorded and Follow-up use concise summaries without removing original values, review limits, correction history or the shared Plan action. An imported report never backfills unrecorded earlier steps; animation is not laboratory tracking.

**Inputs:** home-context ID; test medium and purpose; planned/sample/result dates; sampling location label; laboratory/provider; method if supplied; analyte; original value and unit; qualifier such as less-than or non-detect; detection/reporting limit if supplied; report reference; optional private attachment. Missing fields are explicit, never guessed.

**Actions:** start from an existing test recommendation; schedule; mark collected; await result; enter; validate; confirm; edit with revision history; compare compatible records; prepare questions; create follow-up; export or delete. Retain raw reported values alongside normalized display values. Unknown units or medium prevent automated interpretation, not saving an uninterpreted record.

**States:** planned, collected, awaiting result, draft result, confirmed record, needs clarification, follow-up open, completed/cancelled. These are record workflow states, not safety verdicts. A manually entered laboratory result is user-reported until independent verification exists.

**Backend:** owned structured records, encrypted transport, secure attachment storage, access policies, size/type limits, malware handling and metadata removal, idempotent saves, revisions, export and full deletion. Automatic extraction is optional assistance with human confirmation, not an authoritative result parser.

### H07 Maintenance and moisture follow through

**Job:** help the household carry out and maintain an improvement.

**Examples:** filter replacement, a planned plumbing question, moisture repair follow-up, or a user-chosen periodic home check. These are not claims of automatic equipment monitoring.

**Inputs:** equipment/task label, relevant manufacturer or professional instruction, installation/completion date, chosen cadence, applicable factor, optional meter reading or observation. No sensitive serial number or exact room geometry is required.

**Actions:** create from guidance, choose a due date, mark completed, record what changed, pause, replace a product, adjust a recurrence, attach instructions, and open a related test. Recurrence explicitly distinguishes fixed calendar dates from intervals after completion. A late completion or skipped occurrence does not shift a calendar-anchored series. The scheduler or completion event creates each next occurrence at most once. A skipped occurrence is not silently completed.

**Backend:** reuse the shared Plan task engine and home record store. Certification claims require product/model-specific verified evidence. A generic standard or completed filter task cannot certify current tap quality. User measurements are tagged by source; reminders use documented instructions or the user's chosen interval.

### H08 Household summary and sharing

**Job:** give the household a concise, credible record to discuss with a clinician, landlord, relative, or adviser.

**Keep:** daily and home information, category table, evidence dates, household notes, top actions or well tests, source list, image export and print. Provide a short default summary and optional detail appendix so additional records do not destroy readability.

**Interactions:** choose purpose and included sections, preview, remove sensitive details, choose date range, export image or file, print, use native sharing where supported. Share cancellation is not a failure. A failed source section does not blank everything else. Clipboard refusal has a selectable-text fallback where relevant.

**Report refinement:** make the primary output an actual downloadable PDF rather than a long text panel. Luna can guide preparation with a progress bar and a compact report-ready view. Generate locally from a selected, versioned snapshot where feasible, with readable pages and an optional appendix. This deterministic assembly does not send private records to Luna's model. Retain source dates, privacy choices, omissions, retry/cancellation and the established image/print options. Regenerate after changed selections or records.

**Privacy:** no public household URL by default. Exports are deliberate snapshots with generation time and underlying evidence dates. Distinguish user entries, proxy results and official records. Once downloaded or shared externally, HALO cannot revoke the recipient's copy; say so before enabling any later cloud-share feature.

**Backend:** much of the original summary can be composed from existing responses. New test/action content uses the new owned records. Generate sensitive exports locally where feasible; server generation, if necessary, uses short-lived authenticated retrieval, explicit retention, and no public storage.

## Food and Garden

### F01 Food and Garden overview

**Job:** connect environmental evidence to food, growing, fishing, and water stewardship without turning HALO into an unrelated diet or farm-management product.

**Surface:** a small relevant-updates area and five clear destinations: Fish and waterways, My garden, Food information, Grower resources, and Water stewardship. Show saved advisories and outstanding records only when they exist. A first visit explains what is available and asks optional interests, not an extensive questionnaire.

**Interactions:** choose an interest; select a waterbody, garden context or county; resume a saved item; review coverage; manage followed sources. General guidance remains available without supplying a growing site or personal consumption history.

**Food at home:** add a virtual fridge/pantry (with optional freezer) and a readable item list. Search common household foods, add them without a mandatory question, inspect PFAS and lead context, change storage/origin and remove items. A catalogue improves discoverability but is not a measurement database. Store optional questions and link chosen follow-ups into Plan. Current review saves last for its sample session; production inventory requires owned persistence, export/deletion and honest recovery limits.

**Backend:** optional interest preferences, source registry, advisory records, garden contexts, subscriptions and shared Plan links. A region without verified local food information gets an honest coverage state and useful source/contact paths, not a false all-clear. New backend capacity cannot manufacture measurements that no source has collected.

### F02 Fish and waterway advisories

**Job:** make an official advisory understandable and usable for a specific waterbody and fish selection.

**Data:** authoritative advisory ID and version, exact waterbody segment or published extent, species or group, contaminant, official audience categories, serving definition, frequency/time window, combined-species conditions, effective/update dates, source and supersession status. Preserve overlapping statewide and waterbody-specific advice. Do not reduce several rules to a single badge.

**Interactions:** search/select waterbody; select species with plain labels and reference imagery if useful; choose the official audience category without requiring date of birth or reproductive history; see the matched advisory and its geographic extent; inspect why it applies; save/share a selected advisory; follow revisions; ask Luna about the cited wording; add a planned source check or contact task.

**Deeper records:** optional private catch or consumption notes can record date, species, location context and user-entered quantity. Users can create, correct, inspect, export and delete these records. They remain separate from advisory evidence and optional for using the feature. They do not become an allowance-remaining meter until serving definitions, grouped species, overlapping advisories, and time-window semantics are validated. This keeps the record feature without presenting an unsupported dose calculation.

**Failure and edge cases:** ambiguous species, waterbody with similar names, outside published extent, unspecified category, no advisory record, conflicting notices, withdrawn advisory, old cached version, and unsupported source language. No advisory found does not mean fish are safe to eat.

**Backend:** a curated/versioned advisory ingestion service and matching rules, tested with official examples. The October 3 audit located and sampled public services behind the official [NC fish advisory resources](https://epi.dph.ncdhhs.gov/oee/fish/arcg.html). A sampled record has truncated text and an apparent audience/meal-limit conflict, so the full official document must govern reviewed interpretation. Source S13 in the acquisition guide gives exact paths and guards. Verify reuse, current status and actual advisory extent before publication. Monitoring reports a published advisory change, not real-time contamination in a fish.

### F03 Home garden workspace

**Job:** organize what is known about a garden and turn uncertainty into a practical testing, advice, or stewardship plan.

**Optional inputs:** garden/site label; container, raised bed or in-ground context; approximate location or county; irrigation source, explicitly separate from drinking-water source; known soil source/history; user concerns; dated test records; optional observed moisture or rainfall. Avoid exact plot geometry unless a validated use needs it. Use Unknown rather than forcing guesses.

**Surface:** known information, relevant source notices, open questions, and a short action list. A site detail connects water source, soil records, consultation notes and planned follow-ups. Multiple sites are supported through the same reusable record model if the user needs them, without placing farm-management controls on a normal household page.

**Interactions:** add/edit a site; associate an existing water source only after confirmation; choose the correct test class; prepare questions for Extension/laboratory staff; save sampling preparation; record results; track a chosen stewardship task; export a site brief. Changing irrigation source keeps older results tied to their original context.

**Backend:** owned garden contexts and records linked to H06/H07, reviewed recommendation rules, advisory matching and source links. Routine fertility testing and contaminant testing are distinct services. Do not calculate edible-crop safety from county data, nearby facilities, rainfall, or an unverified water-to-plant transfer model. [NC State Extension's PFAS guide](https://content.ces.ncsu.edu/Guide-to-Understanding-and-Addressing-PFAS-in-our-communities) supports this evidence-and-consultation approach; [NCDA soil testing](https://www.ncagr.gov/Divisions/Agronomic-Services/soil-testing) describes a fertility service, not a general contaminant screen.

### F04 Local food evidence and notices

**Job:** let a family distinguish a real food notice or sampled finding from a general concern and act on information that actually applies.

**Content:** verified local notices where available, broader food monitoring as a separately labelled category, sampled food/analyte/date/geography, evidence limitations, and the issuing organization's instructions. If a notice identifies a product or lot, preserve that specificity. A nearby farm is not included merely because its coordinates are near a water result.

**Interactions:** filter by place or food category when supported; inspect source and sample scope; follow a notice; save a question for the issuer or producer; prepare a source-linked information request; attach a user-held test report as a private record; export the selected notice. Any local-produce directory is a discovery resource, not a safety ranking or certification.

**Backend:** reviewed food notice/study records with stable identifiers, version history, matching scope, withdrawn status and update handling. Current [FDA PFAS food monitoring](https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure) is a source of studies and findings, not a complete local-product lookup API. The feature must declare where no suitable local dataset exists. Do not create a universal PFAS food score, infer brand-level results from a few samples, or imply missing records mean no contamination.

The October 3 audit also sampled openFDA food enforcement records with PFAS-related recall reasons. Source S14 in the acquisition guide defines this concrete notice path, including product/lot scope, distribution and terminated status. These notices complement sampled findings; they do not supply chemical concentrations or cover every local food.

**Depth test:** the feature passes only when a user can identify applicability, inspect evidence, and take the appropriate source-defined step. A static article catalogue alone does not fulfil this feature.

**Kitchen evidence boundary:** PFAS and lead are the only Food at home indicators. Show Unknown unless a relevant measurement supports a value; preserve compound, qualifier, original units/basis, date and matching scope. Broad category studies and recalls without concentrations cannot reveal a household food's chemical contents. A food name, home water result or storage location cannot produce a level or safe/unsafe grade. This restriction does not remove other contaminants or instructions from official fish advisories.

### F05 Grower sampling and conservation support

**Job:** help a grower prepare a useful test, consultation, or conservation-program inquiry rather than guessing at agronomic decisions.

**Flow:** concern and site context, correct test or service class, provider requirements, preparation checklist, contact/application handoff, result or response record, professional follow-up. Preserve agricultural depth without requiring a separate full farm-management system.

**Data:** official program/resource, jurisdiction and service area, applicable matrices/analytes, eligibility description, required documents, dates/deadlines, estimated or verified costs, provider qualifications and last review. Laboratory certification is method/analyte/matrix-specific. A general lab listing is not sufficient evidence that it can run the requested test.

**Interactions:** filter resources by concern and region; compare service scope; save questions/documents needed; open the official application or contact route; mark user-reported progress; record reference number or response; plan a follow-up. HALO does not promise approval, funding, free testing, a booking, or professional certification.

**Sources and backend:** use reviewed [county Extension contacts](https://www.ces.ncsu.edu/local-county-center/), [NC drinking-water laboratory guidance](https://www.deq.nc.gov/about/divisions/water-resources/drinking-water/drinking-water-laboratories), and appropriate [NRCS conservation activity resources](https://www.nrcs.usda.gov/programs-initiatives/eqip-environmental-quality-incentives/cpas-dias-and-cemas). Verify current state applicability and eligibility before surfacing a named program. Add a curated resource catalogue and preparation records; an external portal is not an integration API.

### F06 Water stewardship watch

**Job:** monitor actual regional drought and published utility conservation information, then support appropriate household or garden follow-through.

**Three separate signals:** regional weekly drought; the user's verified utility's published conservation status and rules; optional user-measured household/garden water records. Do not blend them into a new health score. A drought category is not a binding utility restriction, and neither measures a garden's soil moisture.

**Content:** current source release, what changed since a comparable release, utility notice with its own date, known restrictions and official detail link, relevant stewardship choices, and optional private measurement history. County drought statistics show the distribution of county area by category, not a single condition at the home. A point-specific classification requires the appropriate dated source geometry; do not use the county maximum as the household's class. Unmatched utility, absent notice and stale notice are distinct.

**Interactions:** inspect the regional history; open the precise utility rule; follow material updates; save a water-use check, leak investigation or stewardship task; enter dated meter/usage readings with units; compare compatible intervals; correct a reading; export a chosen record. A forecast can supply context but cannot alone determine irrigation quantity.

**Backend:** [US Drought Monitor REST services](https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx) provide documented regional statistics and were sampled on October 3. The official map linked by the [NC conservation-status table](https://www.ncwater.org/WUDC/conservation-status) also exposes a sampled public service. Sources S16 and S17 in the acquisition guide define exact requests and mappings. Reuse/cadence, utility-ID crosswalk and full local restriction instructions remain release gates. Add source-version changes, watch subscriptions and optional measurement records. Show measured consumption change between comparable periods, including interval length and known limitations. Weather and occupancy can also change usage. Attribute savings to a particular intervention only under a separately validated method, never from a completed checklist.

## Act

### A01 Conservation and civic action overview

**Job:** help the household act beyond its own immediate protection while connecting to local evidence.

**Surface:** one relevant issue or opportunity, then Get involved, Explore your area, Speak up, Ways to help, and a small continuation link to saved participation. Preserve original volunteer matching, contextual help, all letter recipients, and household-summary access. No social feed is needed to accomplish these jobs.

**Interactions:** browse by cause or area, see why a recommendation was shown, open evidence, find an organization, save an opportunity/project, prepare outreach, or document an observation. Recommendations never prevent browsing other causes. Nothing elevated should still produce useful community choices.

**Backend:** existing volunteer/home/map/district data plus opportunities, projects and source-reviewed recommendations. Keep issue labels accurate: a reported facility compliance status does not establish the cause of a user's symptoms or a specific pollutant at their property.

### A02 Organizations and trustworthy resources

**Job:** identify who works on the issue and how to engage them.

**Content:** mission and relevant activities, service geography, causes, contact/official site, verified opportunities, accessibility information if supplied, last link check and separate human verification. Explain the match to a household finding without exposing private details externally.

**Interactions:** filter, inspect an organization, follow available updates, save a contact task, open official website, report an outdated listing to the private review process. Unknown access information stays unknown rather than defaulting to accessible. No badge implies a partnership.

**Backend:** extend the existing county/cause directory with stable IDs, verification source/date, archived status and scoped contact fields. Expired/dead listings leave clear history for saved items. Keep unverified records labelled; a successful HTTP response is not human verification.

Correct the current route's database-error behavior before integration: a failed directory query currently falls back to a successful empty organization list. Return a distinguishable unavailable result so the frontend can retain prior dated listings and offer retry. No matches and inability to query must remain different.

### A03 Opportunities and participation

**Job:** help a person find and actually participate in an appropriate event or opportunity.

**Content:** work involved, cause, organizer, location/service area, date/time/timezone, duration, cost, age restrictions, supervision, accessibility, preparation/equipment, registration URL, capacity/deadline only if known, and source verification. Filters hide unsupported fields rather than inventing defaults.

**Interactions:** inspect; save without a date if ongoing; add to Plan; open external registration; record user-reported registration; set an optional reminder; see cancellation/time changes; mark attended/not attended; record optional personal hours or notes; reopen. Saving is not signing up, opening a form is not registration, and a checked attendance box is self-reported.

**Backend:** opportunities linked to organizations, curator/feed provenance, expiry/cancellation detection, user participation records and shared action scheduling. No attendee list, child account, organizer messaging, or booking platform is required. Officially confirmed participation is a separate status possible only with a real integration.

### A04 Guided stewardship projects

**Job:** turn a relevant conservation goal into a practical sequence with a follow-up.

**Examples of project categories:** water stewardship, a source-reviewed garden/habitat activity, preparation for a supervised cleanup, or participation in an established monitoring program. Exact instructions require source and suitability review before publication.

**Anatomy:** purpose, who it suits, prerequisites/permissions, materials, approximate effort/cost with basis, steps, safety constraints, completion evidence chosen by the user, and follow-up. Do not show the same generic environmental tips under every category.

**Interactions:** choose a project, review suitability, save selected steps or the whole project, schedule, record progress, pause, and document an outcome. Reuse P02 tasks instead of a second checklist store. Small-step cards retain the approved interaction with an accessible full-list option.

**Backend:** versioned project templates, source-backed instructions, applicability rules and action relationships. Participation hours or completed steps are valid self-reported metrics. Avoid unmeasured carbon, pollution-removal, water-quality or health-improvement claims. Hazardous collection, entering waterways, and chemical testing require an appropriate official program and safeguards, not an unsupervised app challenge.

### A05 Evidence based outreach

**Job:** enable a useful, informed question to a utility, landlord, representative, or relevant official source.

**Keep:** all three original recipient modes, independent edited drafts per recipient, reset current draft, Copy, native Share and fallback, and transparent evidence selection. Add information-request templates for cases without a measured exceedance so missing data is not a dead end.

**Inputs:** selected public evidence and its date, recipient class, purpose, editable questions, optional local-only greeting/signature. Do not automatically persist names, addresses or landlord details in the existing anonymous profile. Optional saved sensitive drafts require a clear separate consent and retention decision.

**Interactions:** choose purpose and recipient; inspect citations; edit; preview; copy/share/print; optionally save a nonsensitive follow-up task; record user-reported sending and any reference/response; revisit if the evidence changes. A new sample flags an old draft for review rather than changing the user's text. When there is no appropriate measurement, generate a request for information, not an accusation.

**Backend:** source-aware templates and evidence snapshot binding can build on existing home/map/district data. Optional persistent outreach records need owned storage and privacy rules. A sample above a comparison value is not automatically a formally determined legal violation. Recipient directories and current district boundaries need verification before automatic addressing. No automatic external sending in the target workflow.

### A06 Private field observations and official reporting

**Job:** help a user make a clear factual record and reach the appropriate official reporting channel.

**Inputs:** observation type, date/time, plain description, optional approximate or precise location chosen for the purpose, waterbody/site reference, and optional photograph. Avoid asking users to enter water, approach facilities, touch suspect material, or diagnose a bloom from appearance. For immediate danger, show relevant official emergency guidance rather than positioning HALO as a response service.

**Interactions:** create a private draft, review sensitive details, choose the official destination, copy/export the report, open the official form, record user-reported submission/reference number, and schedule a follow-up. User notes remain editable; a sent snapshot stays distinguishable from later changes.

**States:** draft, prepared, official form opened, user-reported submitted, acknowledged only with genuine confirmation, follow-up, archived. HALO cannot invent agency investigation status. Observations are not automatically public or added to a contamination heatmap.

**Backend and source:** private records and attachments, export, location/EXIF controls and a reviewed official destination directory. [NC Stream Watch](https://www.deq.nc.gov/about/divisions/water-resources/water-resources-public-information/water-education-programs/water-education-and-outreach/nc-stream-watch) links observation/reporting forms; public form availability does not establish a submission API or authorization to transmit user data. Use explicit external handoff until a real integration is approved.

## Regional exploration

### M01 Map shell and discovery

**Job:** place a household concern in regional context and let users ask their own questions.

**Keep:** map-first composition, layer controls, muted basemap, select/pan/zoom/locate, accessible list, legend, source/date, contextual sheets, search within available records, preserved viewport, own-system context and approximate home pin. New bottom navigation has no Map tab; build `/map` as the planned canonical production route, reachable from Act and relevant details.

**Interactions:** an incoming link selects its public record/layer; filter changes do not create a long Back trail; selecting a feature opens one sheet; close returns focus; returning from details restores the map. On small screens, overlays must leave usable map space. Keyboard/text-list paths expose the same records as the canvas.

**Backend:** reuse existing map routes and geographic assets. Production renderer, attribution, token restrictions, lazy loading and identity-safe cache require implementation and verification; the current Canvas wireframe does not prove them. Individual layer failure does not blank the whole map. Missing coordinates retain records in the list.

### M02 Water layer and sampling history

**Keep:** overall/compound/hazard selection, source-sized utility markers, selected-system outline, counts, detail by compound/date, historical quarters and distinct Latest. Keep unregulated/excluded evidence and unlocated records visible where applicable.

**Interactions:** choose compound and quarter, inspect exact sample context, compare compatible records, open relevant water guidance, save/follow a public system, or prepare a source-linked question. Keep prior data while a new quarter loads; failed requests restore the prior selection; stale responses cannot overwrite a later choice.

**Truth rules:** a quarter contains samples from that quarter, not accumulated contamination. Absent points are not clean areas. The current Patterns heat layer represents qualifying-record density, not exposure or a continuous pollution plume. A genuine spatial concentration surface requires an appropriate dataset and reviewed method, not just a different color renderer.

**Backend:** complete tested/non-detect metadata, geographic basis and comparable denominators are priority upgrades. Do not imply a centroid is a service boundary or a tap measurement. Current regulatory flags require launch-time source review.

### M03 Radon facilities and air layers

**Radon:** county polygons, zone explanation and no-data state; open testing guidance without implying a home level.

**Facilities:** selected scope, compliance category, regulatory programs, quarters in noncompliance, programs currently in violation, dated penalties/inspection if available, clustering and official record link. Correct labels matter: program counts are not counts of distinct violations. Proximity alone does not attribute a pollutant to a facility.

**Air:** monitor shapes distinct from water, AQI/pollutant/source time, distance from approximate household location, and link to the relevant air explanation. A model grid and a station are different layers or clearly different evidence types.

**Extensions:** fish-advisory extents and drought/conservation context may reuse the map only when sources support their geography. Sampling records from a documented environmental service are an optional extension with matrix/method/date shown, not an automatic swimming or drinking clearance.

### M04 Public record comparison

**Job:** compare two selected records without hiding differences in evidence quality.

**Interactions:** select a second public system or compatible observation; compare the same analyte/unit where possible; inspect dates, coverage, source and missing entries; return to the prior map. On mobile, a compact aligned list is preferable to two crowded maps.

**Backend:** public comparison query or validated join using shared normalized evidence. Define comparability explicitly. Never rank missing as best, compare soil with water, turn regional comparisons into home rankings, or imply people can choose a different utility merely by seeing it. Preserve original denominators and source limitations.

### M05 District and regional evidence

**Job:** explain the scale of a regional issue and support civic discussion with public aggregate evidence.

**Keep:** district/state comparison, per-compound counts, county table with partial-district distinctions, household county ranking where supported, unlocated records and sources. Population totals are people served by included systems, not verified exposed or ill people.

**Interactions:** inspect denominator definitions; change a supported evidence view; open a county or public system; export/share the public summary; open outreach with selected public evidence. Never include the user's home pin or private information in a public district share.

**Backend:** verify current district boundary vintage before release; centroid assignment is only a documented approximation where service-population allocation is unavailable. Suppress invalid rankings, use correct mapped/tested/population denominators, preserve incomplete-population flags, and handle geography-source failure without reporting zero problems. Named local facts require dated verified sources, not old planning examples.

## Plan

### P01 Your Week

**Job:** provide one place for commitments, preparation and follow-up across HALO.

**Surface:** seven-day selector, readable agenda, unscheduled saved items, and a small relevant update summary. Optional month view supports navigation, not another dashboard. Separate overdue, upcoming and waiting items without punitive streaks or guilt copy.

**Interactions:** change day/week, open an item, save or schedule, reschedule, pause, complete, reopen, filter by home/outdoor/community, and export a selected event to a personal calendar. Calendar export is not bidirectional sync and does not prove the external calendar updated. Saved items can exist without a due date.

**Data:** one shared action store, occurrences, source references, timezone, optional reminders and linked records. Environmental context appears only beside an activity it informs. A filter replacement does not need an air chart.

**Homeguard continuity:** chosen routines and test, maintenance, moisture, garden, food and water-use follow-ups appear as the same canonical action in Plan, scheduled when a date is chosen or in Unscheduled otherwise. Original records remain linked in Homeguard; saving data alone does not create an unsolicited task. Rescheduling/completion/reopening updates both entrances without duplication or a score change. Historical observation dates are not automatic due dates.

**Backend:** new Plan and recurrence APIs; device-local display preferences separate from owned tasks. Handle daylight-saving transitions, all-day dates, location changes and event cancellations explicitly. One event update changes all its views, not several independent copies.

### P02 Shared actions and follow up

**Job:** turn any recommendation into a real, resumable task with an outcome.

**Action detail:** title, reason, applicability, source/evidence snapshot, steps, chosen schedule, estimated effort/cost if sourced, status, related record, and next step. A user can edit their own title/note without altering the source's text.

**Interactions:** save from any page; detect an existing equivalent action; schedule later; change status; attach a test or observation; mark waiting for a third party; record completion; choose a follow-up; reopen; cancel/delete. Do not force every simple reminder into a large project form. Completing a project step and completing the whole project are separate.

**Backend:** owned action ID, stable recommendation/template ID, origin feature, evidence version, context version, optional parent/project, due time/timezone, recurrence, status events, revision and idempotency keys. Authority comes from the authenticated identity. A client cannot assign a task to an arbitrary household. Readiness uses actual records rather than guessed completion.

### P03 Outdoor activity planning

**Job:** compare available conditions for a chosen activity and support a practical timing/preparation decision.

**Optional inputs:** activity label/type, approximate location, duration, preferred periods, and relevant household category. No route tracking or continuous GPS is required. Home location can be the default; planning elsewhere does not change the household address or its daily history.

**Content:** aligned weather and environmental periods with source, issue time, valid time, uncertainty and missing factors. Preserve category-only forecasts. Daily pollen cannot be expanded into an invented hourly line. Avoid a single arbitrary safe-time score that hides tradeoffs.

**Interactions:** choose two or more supported periods; inspect tradeoffs; see a relevant official warning; select a time; save a preparation checklist; opt into material-change notification; reschedule explicitly when conditions change. Forecast changes never silently move the user's event. Far-future plans show a date to check again rather than fictitious forecasts.

**Backend:** a normalized forecast service with per-factor horizons, supported geographies, source versions, caching and spend controls. [NWS](https://www.weather.gov/documentation/services-web-api) documents weather forecasts and alerts; [AirNow](https://docs.airnowapi.org/faq) describes variable air forecast coverage; [Google Pollen](https://developers.google.com/maps/documentation/pollen/overview) is a provider candidate subject to coverage, billing and terms. No promise that all factors cover the same seven days.

### P04 Journal and quick entries

**Job:** record how the household felt and inspect environmental context, optionally.

**Keep:** quick entry, explicit Felt fine, household-category selection, symptom chips, symptom severity, possible-illness flag, optional note, prior dates, retrospective first-use calendar, recent entries, edit, delete and undo. Preserve loading/save guards so an unloaded entry cannot be overwritten with blanks. The actual current upsert replaces the whole date/category entry.

**Interactions:** a Today shortcut opens the correct date; choose category and response; save; edit without losing fields; inspect that day's evidence; optionally select remembered rough days; review recalled versus same-day labels. Retrospective batch retry only retries failed dates and reports partial success honestly. A failed write keeps the draft.

**Backend:** reuse existing Journal routes and history, add explicit logging status and appropriate validation if the analysis needs it. Preserve not logged separately from felt fine. Category removal does not erase historical entries. No person-specific conclusions from category records. Free-text notes remain private and excluded from Luna context under the existing policy.

**First use and history:** distinguish never logged from no entries in the current range using a proposed authoritative `has_any_entries` or equivalent aggregate. A household with old records must not be sent through first-use setup again. Preserve the original 90-day regular logging window, 12-week grid and seven-entry recent list unless a reviewed change is explicit; validate the current retrospective maximum of 62 selected dates. A minimum count for a descriptive comparison is not proof of clinical significance. Protect existing richer entries from retrospective overwrite. When onboarding history backfill is pending, show that state and retry rather than implying there was no environmental history or that a pattern has been established.

### P05 Patterns and history

**Job:** show understandable descriptive relationships while being candid about their limits.

**Keep:** 12-week heat grid, dated readings, symptom markers, day detail, accessible tables, trend charts, findings and sample counts, insufficient-data and no-clear-pattern states, optional category filtering. Calendar and analysis views must agree on dates and missing values.

**Improve:** compute wellness comparisons from explicitly logged days if describing how people felt. The current algorithm compares symptom-logging days against all available environmental-history days; those are logging frequencies, not verified symptom-free days. Retrospective recollection, missing factors, possible illness and changing data sources need distinct handling. A category filter must not relabel household findings as individual analytics.

**Interactions:** inspect a day; change the factor/time range/category where supported; see how a statement was calculated; correct an entry; export selected dates; open a source. Changing a filter updates the denominator and disclaimer, not only the plotted dots.

**Backend:** versioned analysis with explicit eligibility counts, evidence provenance, logging denominator, missing-data treatment and tested minimums. Existing minimum-count/difference rules are heuristics, not clinical validation. Expert review must decide supported interpretations and symptom-factor pairings. Do not call a small personal association a cause, diagnosis, statistically proven effect, or exposure estimate. New insights never require users to log more symptoms to earn a reward.

Environmental-history eligibility also depends on measurement basis. Backfilled daily maxima and app-time observations must not be silently pooled as the same statistic. Retain the available source and backfill metadata, state how a series was aggregated, and exclude or separately present incompatible periods. The household's plan location is not evidence that a person was physically there.

### P06 Seasonal and progress review

**Job:** help users understand what changed over a meaningful period and resume useful follow-through.

**Keep:** Journal's seasonal summary and source-reviewed seasonal prompts, with dismissals and appropriate regional relevance. Replace outdated eligibility rules when actual home test records can make a prompt more accurate.

**Content:** available environmental history, explicit check-in counts, completed/pending household actions, recorded tests, and user-reported community participation. Keep measured changes separate from activity completion. A seasonal summary can be valuable even when no symptom pattern is supported.

**Interactions:** select season, inspect underlying dates/actions, choose a next review, export selected material, or dismiss the callout for that season. An alert opens the actual summary, not an unrelated Journal form.

**Backend:** reuse existing summaries while revising their analysis semantics consistently with P05; join owned action/test/participation records. Do not infer health benefits, water savings or environmental remediation from completed tasks.

## Shared experiences

### X01 Contextual Learn and source details

**Job:** explain a term or decision at the moment it becomes useful, with a route to deeper trustworthy material.

**Keep:** the existing contextual factor learning content, citations and sources. Integrate short explanations beside the score, chart, test field or action they explain. **Proposed addition:** a small glossary and searchable topic index, entered through a contextual Learn link or Sources and methods, gives returning users a way to find a known explanation. It is not an existing capability in the original C1 specification. Learn does not need another bottom tab or repeated large lesson section on every page.

**Content:** a plain-language answer, why it matters here, what the evidence can and cannot establish, a practical example when helpful, and dated references. Separate a quick definition from a full topic page. An explanatory diagram should earn its space by clarifying a relationship, not add decoration to every card.

**Interactions:** open a term without losing a form draft; expand a short explanation; search the proposed topic index by plain-language term with clear no-match results; open the source detail; inspect source date and method; follow a relevant action; return to the original scroll position. Topic search operates on reviewed HALO content, not arbitrary live web results. Source cards identify which statement they support. External documents remain labelled as external, and a failed link does not erase the locally reviewed explanation.

**Backend:** reuse existing learning retrieval and curated documents. Add versioned editorial records, topic relationships, evidence applicability and review status. Content matched to a household category explains why it appears without claiming to diagnose that household. Translation requires review of units, medical meaning and official audience definitions, not only a text substitution.

### X02 Luna

**Job:** help people understand their current context, navigate HALO, and prepare a useful next action without inventing evidence or acting without permission.

**Keep:** the approved Luna name, teal geometric symbol, compact launcher, refined conversational panel, greeting, suggested prompts, input and source links. Keep the visual character that was approved; do not recreate another company's branding. An assistant answer is not the only route to any core feature.

**Interactions:** open from any relevant page; see what page or record is in context; choose a suggested question; send, retry or cancel where technically supported; inspect citations; start a new conversation; clear conversation history; return to the underlying page. Handle an empty question, long input, rate limit, provider failure, unavailable sources and unsupported question clearly. Only expose attachment controls after the private upload and interpretation workflow exists.

**Useful new depth:** a person can ask what a water qualifier means, compare two available forecast periods, find the appropriate testing workflow, or turn a reviewed recommendation into a proposed Plan item. A proposal is shown as an editable preview with its reason and sources. The user confirms before any task is saved. Luna can prepare an outreach draft for review, but cannot silently send it, change test values, register for an event, alter a household profile or mark an action done.

**Evidence behavior:** answers distinguish observed readings, forecasts, estimates, official advice and user-entered information. A missing local food result leads to an honest limit and a practical next step, not a nearby-farm risk claim. Calculations use deterministic validated functions and explicit units rather than model-generated arithmetic for important results. Sources support individual claims; adding an unrelated bibliography is not grounding. Medical diagnosis, treatment, emergency triage guarantees, legal determinations and unsupported exposure estimates remain outside scope.

**Privacy and backend:** the current endpoint accepts a question and page, not a full conversation contract. Add an authoritative capability response, transparent model-processing disclosure, authorized selected-record context, minimal conversation retention, deletion, and explicit action confirmation. Correct the current ambiguity where household context can be sent even though the client lacks a reliable capability flag. Free-text Journal notes stay excluded under the established policy. Retrieved text and uploaded documents are untrusted data, never instructions for tool execution. Account deletion and optional recovery must include any newly stored conversation records.

**Quality gate:** test sources, refusals, contradictions, missing data, stale advisories, malicious source text, household isolation and the difference between proposing and completing an action. No claim that Luna is medically validated or always correct.

Obtain qualified review of health-related interpretation and public product claims before releasing expanded decision support. A disclaimer alone does not decide the app's legal or regulatory classification; this plan makes no such determination. Keep behavior and marketing consistent with the functions actually evaluated.

### X03 Alerts and watchlists

**Job:** notify a person about a specific meaningful change or chosen follow-up, with enough context to act.

**Keep:** the existing inbox, unread state, read/dismiss behavior and server notification/push foundations. Complete the required browser permission, device-subscription and delivery UI. Add a quiet watchlist manager for selected utilities, waterbodies, supported locations, organizers or saved actions. Watching is optional and separate from merely opening a page.

Preserve earlier air-quality notice eligibility for the sensitive categories defined by the existing server policy. The inspected rule uses an earlier severity threshold for eligible sensitive households; the frontend must not recreate that decision or silently broaden it to every household category. Store the policy version and explain the reason in plain language. Recheck source coverage before calling an apparent difference worsening air. The existing notification types apply their preference to both inbox creation and push; separate channel controls require an additive backend change, not just two switches.

**Content:** what changed, the relevant place or record, the actual event/publication time, source and direct destination. Distinguish a new published laboratory result, an official advisory, an organizer cancellation, a task reminder and a source correction. A changed risk score and newly available data are not the same event.

The existing weather-alert input accepts actual NWS flood and heat events. A dormant boil-water message in code does not establish an active boil-water feed. New utility/agency notices require the separately verified acquisition path and appropriate official instructions; do not advertise them as currently covered.

**Interactions:** follow or unfollow a supported record; choose a relevant channel; inspect the change and source; open the exact advisory/event/action; snooze an eligible reminder; manage quiet hours; mark read; dismiss. Unfollowing stops future subscription notices without deleting completed actions or historical records. Browser permission denial leaves the inbox usable. A cancelled event updates its linked Plan entry with an explanation, not silent deletion.

**Backend:** reuse the alert and push infrastructure, extend typed subscriptions, deduplication by source revision, durable delivery intent, expiry and safe deep links. Separate source matching from delivery. Show a delay or unavailable source when appropriate. HALO is supplemental and must not encourage people to rely on it instead of official emergency channels. Urgent-source coverage, polling and notification semantics require explicit operational validation before any reliability claim.

### X04 Settings

**Job:** let users understand and control HALO without searching through unrelated screens.

**Sections:** household categories; home and water information; address/home-context change; notifications and subscriptions; accessibility; language; privacy and data; optional recovery; sources and methods; app information and feedback. Keep frequent settings near the top and destructive controls separately labelled. Appearance follows the device under the approved decision; a redesigned manual theme switch is not silently reintroduced.

**Interactions:** load current values; edit a retained draft; review changes; explicitly Save; show confirmed success or retry with the draft intact. Warn before abandoning edits. Handle another-device changes with a conflict choice rather than overwriting. Category changes update guidance and the house figures but do not delete old Journal or test records. A new address starts the home-context transition described in G01.

**Keep from the specification:** inspect stored household data, clear Journal records separately, delete all app data, notification controls, readable text scaling and reviewed Spanish support. Preserve the approved text-scale range rather than silently reinstating an old specification value. If a translation is not available, label the fallback, keep the language preference, and never imply an official advisory was translated by its issuing agency.

Every new app-owned visible string, validation message, accessibility label, date description, empty state, exported heading and notification template belongs in the translation catalogue from its first implementation. Do not scatter new English literals across components and defer their extraction. Use the requested versus served locale distinctly for source content. Official titles and quotations retain their issuing-source identity; translation never changes units or advisory audience rules. Update the document language and formatting consistently when a reviewed locale is selected.

**Backend:** reuse profile, household, notifications and account interfaces, with identity preflight and ownership checks. Add new preference groups only for shipped features. Every new private domain needs export/deletion coverage before its Settings controls can promise complete removal.

### X05 Privacy and recovery

**Job:** make valuable household records controllable and recoverable without turning HALO into a surveillance or identity-heavy app.

**Default:** anonymous use remains available. No named children, birthdates, continuous GPS, public home pin, required medical profile or advertising profile. Feature-specific optional data is collected only when used. Selecting a sensitive household category is not consent to share it with an external model, organizer or export recipient.

**Interactions:** inspect stored fields; preview an export; select what to include; download; clear a specific record or Journal; request complete deletion; optionally link a recovery method; inspect/revoke devices if that capability is built. Explain that the current anonymous-session replacement cannot restore old records. Recovery must actually prove ownership, not accept a household ID or secret-looking URL as sufficient.

Before the first valuable private upload or long-lived record, explain anonymous-session loss and any genuinely available recovery option. Do not wait until after a document has been uploaded to reveal that another browser or a cleared session may lose access. The user can continue anonymously with this understood limitation; a not-yet-built recovery feature is not offered as protection.

**Export:** household summaries and full data exports have different audiences and defaults. A summary is short and readable; an optional detailed appendix preserves sources and dates. Full private export can include structured records plus documents the user owns. Share previews exclude exact locations, category details, symptoms and attachments unless selected. Public community evidence exports never acquire private fields from the current household context.

**Backend:** define retention, ownership, private attachment storage, signed download expiry, encryption appropriate to the hosting stack, deletion of object storage and pending jobs, and recovery collision handling. Explain backup and third-party retention accurately. Restore and deletion drills must cover the database and files. A future shared-household account would need explicit roles and invitations; it is not implied by this plan's category figures or device recovery.

Update the privacy notice before enabling uploads and new private records. Original statements that HALO never stores medical records or identifying text cannot remain absolute once a person can voluntarily attach a lab report or enter sensitive notes. Explain the new optional record classes, possible identifying document contents, recipients, retention and controls at the point of use. Keep raw onboarding address disposal distinct from a user deliberately attaching a document that contains an address.

### X06 Accessibility and offline use

**Job:** preserve the essential meaning and actions on small screens, assistive technology, weak connections and low-power devices.

**Accessibility:** use [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) as the implementation target, verified with both automated and manual checks. Charts have readable tables, the map has a list, icons have labels, status has text, controls have visible focus, and dialogs restore focus. Step decks expose current position and support buttons and keyboard. Forms use field-level messages plus a summary where needed. Test screen-reader reading order, large text, browser zoom, contrast and reduced motion. A figure's shape must not be the only distinction between household categories.

**Motion:** retain handwriting, ring drawing, count-up, staggered cards, chart reveals and ambient scenes where approved, but never delay content or actions. Stop nonessential movement offscreen and when the document is hidden. Provide a user-accessible way to pause prolonged nonessential motion as well as respecting device reduced motion. Reduced motion shows the final values immediately. Decorative day/night follows time; it never masquerades as a measured weather condition. A graph reveal is not a live-data stream.

**Offline:** reuse identity-scoped environmental caches with source timestamps. Do not default-cache private notes, letters, photographs, model chats or lab documents. Offline write support is a separate controlled capability with an explicit local-draft label, retry safety and conflict handling. Never report a queued write as saved to the server. Clear identity-sensitive caches on identity change or deletion. Preserve unsaved input safely across temporary fetch failure without accidentally showing another household's cached state.

**Backend and testing:** consistent error semantics, bounded payloads, cached public source reads, retry/idempotency and session-expiry handling support the frontend. A low-cost phone must not download all scenes, maps and historical series merely to show Today. Performance budgets are defined against measured devices, not desktop animation smoothness alone.

**Browser identity and installation:** retain the existing logo, local fonts, page-title template, icon references and theme-color values, then audit the full favicon/app-icon set, manifest and generic social preview. Do not put household readings, names, location or symptom details in page metadata or share-card generation. A service worker needs an explicit version/update policy, safe private-response exclusions and stable notification click routing. Explain supported installation/push behavior accurately without requiring users to install the app. Installing an icon is not proof that offline writes, push or background refresh work.

### X07 Source and content operations

**Job:** keep evidence accurate after launch, including when an agency changes a file, an organizer cancels an event or a guidance page becomes outdated.

**Operator capabilities:** review incoming records; inspect fetch and parser failures; quarantine suspicious unit or geometry changes; compare revisions; publish reviewed content; withdraw a wrong interpretation; inspect stale sources and broken links; manage translations and supported coverage. Begin with a protected internal workflow that fits the existing stack, not a second elaborate public app.

**Source record:** issuing organization, supporting URL, licence/access terms, geography, method, expected cadence, observed/published/retrieved timestamps, parser/content version, reviewer and next review date. An HTML page is not automatically a stable API or permission to republish everything. Human-reviewed imports are legitimate if labelled and operated honestly.

**Backend:** bounded resumable jobs, public-source caching at permitted resolutions, typed evidence revisions, durable notification intent, spend and quota limits, secret management, private/public separation, access logs without sensitive content, and backup/restore coverage. Expanding the existing one-minute cron with every new feature is not a viable scaling plan. Source failure preserves the last valid dated record and marks it stale; it does not publish an all-clear.

**Quality:** compare incoming record counts, geography, units, dates and required fields against expectations. A successful request returning an unexpectedly empty dataset is not automatically a valid zero. Rollback disables an interpretation or source producer without destroying household records. Changes in scientific or regulatory guidance are reviewed, versioned and communicated rather than silently rewriting history.

## Cohesive visual and interaction system

The app should feel simpler at its entrances and deeper when someone chooses to explore. Depth comes from useful evidence, an appropriate action and continuity, not the number of cards visible at once.

### Page composition

- Landing pages have one clear identity, a short current situation, one primary contextual next step and compact entrances to their domains. Avoid several competing hero banners or repeated AI summaries.
- Factor pages keep the approved score and atmosphere, then use a factor-specific composition. Air emphasizes pollutant and trend; UV emphasizes the rising sun and timing; pollen emphasizes category comparison; mold emphasizes proxy meaning and moisture action. Water, radon and lead each retain their distinct evidence and test journey.
- Detail pages use a short summary, the most relevant evidence visualization, practical choices and expandable supporting material. Do not hide essential limitations in an accordion; optional technical methods and full references can expand.
- Plan uses an agenda and action details. Act uses opportunities and project progression. Food and Garden uses evidence-led routes, not a news feed. Map remains a full, focused exploration surface reached from Act or a contextual link.
- Preserve centered page and section headers where approved. Body text, forms, long lists and comparison values can use alignment that improves scanning. Centering every paragraph would reduce readability.

### Color and visual assets

Keep the blue and teal foundation in both device themes. Use restrained factor-specific tints: teal for air, orange for UV, soft yellow for pollen, green for mold, water-blue for PFAS and appropriate distinct accents for radon and lead. Factor cards stay flat-tinted without gradients. Severity colors communicate evidence categories and are not decorative substitutes for the factor palette.

Retain the illustrated, moderately stylized environmental direction. Each factor has a distinct setting, and scenery fades or overlaps into the content surface without making text float over busy detail. Use atmospheric layers, small loops and shared lighting, not a different visual language on every route. No decorative deer and no photorealistic collage beside otherwise flat generic UI. Exact approved assets remain preserved until a new version is reviewed.

The numerical and heading typography stays consistent with the approved character. Charts share axis, tooltip, missing-data and table conventions. Bottom navigation stays rounded and clear at safe-area insets. Luna stays visually secondary to the page's primary action.

### Controlled depth

For Today and its factor detail pages, preserving the current experience takes precedence over the general simplification guidance below. Do not remove useful sections or hide existing information behind additional taps just to make these pages shorter. Apply the reading-level approach primarily to new content and new pages while keeping these existing pages substantially unchanged for now.

Use three reading levels: immediate answer, practical detail, and evidence/method. Users can take an appropriate next step without opening every level. A substantial source limitation stays at the first level when it changes the decision. Keep one canonical version of an explanation and reuse contextual excerpts rather than duplicating whole essays.

Charts appear only when data and a decision justify them. A short status list can be better than an empty trend. Every new subpage must have a distinct user question; if it only repeats its parent, use an inline explanation instead. Optional growers, observations, Journal and water-use records stay discoverable without becoming mandatory household homework.

## Connected journeys

These are the tests of whether HALO is one app rather than a set of unrelated features.

| Starting situation | Connected path | Credible outcome |
| --- | --- | --- |
| The household notices a higher air reading | Today, air detail, source and forecast comparison, outdoor plan, preparation checklist, optional check-in | A considered plan based on available evidence, not a promise of safe exposure |
| A utility publishes a new PFAS result | Homeguard, water result and date, test or information choices, saved action, outreach draft, Plan follow-up | A sourced question or documented household next step, not an automatic treatment claim |
| A private well has no test record in HALO | Homeguard testing entry, appropriate lab/resource, action, sample context, result entry, reviewed follow-up | An organized testing process and interpretable record, not an assumed normal result |
| A family wants to fish | Food and Garden, waterbody/species/advisory audience, exact official guidance, optional watch, outing plan | A location-specific advisory decision with unresolved matches kept visible |
| A grower sees a published local concern | Food evidence with scope limits, garden/site context, Extension or program resource, test preparation, action follow-up | A relevant professional inquiry and evidence trail, not an inferred contaminated crop |
| A utility changes conservation rules | Water Stewardship, dated applicable notice, chosen practice, Plan reminder, optional comparable water-use records | A documented response to actual rules, without claiming unmeasured savings |
| A resident wants to help locally | Act, Map context or cause, verified organizer/opportunity, external registration, Plan, user-reported participation | A real participation pathway with truthful confirmation state |
| A person observes unusual water | Private observation, safe reporting guidance, preview of location/photo, official form, user-reported submission and follow-up | A better-prepared report, with no automatic chemical identification or agency receipt |
| A household wants to review a season | Plan, check-in history and explicit logging counts, test/action history, seasonal recap, chosen next review | An understandable record of available evidence and completed actions, not a causal health conclusion |

Each path must work without Luna, push permission or a purchased device. Cross links carry public IDs or authorized private references, not copies of sensitive content in URLs.

## Delivery sequence and approval gates

The full target stays in scope. Sequencing reduces integration risk and gives each feature a complete useful first release rather than shipping many empty destinations.

| Phase | Complete outcome | Dependencies and gate |
| --- | --- | --- |
| 0 | Confirm four-tab ownership and preservation map | Yogi confirms Plan or chooses another fourth-tab label without changing its purpose. Verify the current deployed schema and source access read-only. |
| 1 | Shared actions and a small usable Plan | Evidence references, action state, idempotency, ownership, dates/timezones and reminders. Wireframe review of navigation and Plan before visual lock. |
| 2 | Deeper Today and Homeguard follow-through | Testing records, maintenance, source details, category guidance, change explanations and honest score semantics. Existing approved views receive additive reviewed changes. |
| 3 | Connected Act and Map | Preserve current Map refinement work. Complete real layer contracts, comparison, organizations, outreach, summary export, then opportunities and projects with verified coverage. |
| 4 | Food and Garden with substantive evidence | Start source feasibility and expert content review during Phase 0. Release fish advisories, testing/garden guidance, food-evidence limits, grower pathways and Water Stewardship as each full data/action journey passes its gate. |
| 5 | Outdoor planning, Journal and Patterns in Plan | Verified per-factor forecasts, explicit logging semantics, analysis review, retained original Journal capabilities and seasonal summaries. |
| 6 | Richer Luna and watchlists across the app | Truthful context disclosure, authorized record access, confirmed proposals, source-revision notifications and privacy controls. Basic source-grounded Luna remains available before expansion. |
| 7 | Full release verification and preservation | Settings, reviewed translations, recovery where enabled, accessibility, low-end device tests, source outage tests, security, deletion/restore, browser tests and approved design baselines. |

Security, accessibility, source operations and tests are required within each phase, not work deferred until Phase 7. Source feasibility for food, events and forecasts runs early so the frontend is not designed around an imaginary feed. Field Observations follows the private-file/security infrastructure; it does not block the other Act workflows. Current unapproved Map work is preserved and can continue through review while shared contracts are defined.

For each stage, use the established workflow: requirements and contracts, interactive wireframe with clearly labelled fixtures, Yogi refinement, explicit visual approval, immutable baseline, production implementation, backend integration, interaction and failure testing, visual comparison, handoff and version-controlled release. Do not freeze each experimental iteration as a new approved design.

## Decisions and evidence that still require confirmation

The architecture and feature behaviors above are the recommended final target. The following are real decision or validation gates, not missing placeholders that may be filled with guesses:

1. **Fourth tab name:** Plan is recommended because it joins weekly planning, saved actions, follow-up and optional Journal without giving a peripheral topic control of the navigation.
2. **Score semantics:** retain current honest displays until the backend defines any individual factor scores and precise contribution explanation. Any formula change needs a version and review.
3. **New source acquisition:** prove access, geography, freshness, reuse terms and cost for fish advisories, food records, events, utility restrictions and per-factor forecasts. A reviewed manual workflow may be the right implementation for some sources.
4. **Interpretation review:** advisory audience matching, household test comparisons, guidance, symptom findings and regulatory labels need domain review. Source availability alone does not validate HALO's interpretation.
5. **Recovery and retention:** choose the actual identity recovery method and published storage/retention policy before valuable private records depend on them. Multi-person accounts remain a separate decision.
6. **Release coverage:** state which regions and sources are supported at launch. Useful North Carolina depth is preferable to nominal national coverage with unverified local claims, while preserving an architecture that can expand.
7. **New visual approval:** all new layouts and substantive revisions go through Yogi's review. A product plan is not automatic visual approval.

## Evaluation and finishing touches

The lesson from competition references is to make a clear problem, usable interaction and tangible outcome reinforce each other. The official [Mazah winner profile](https://www.congressionalappchallenge.us/25-nc08/) describes food-waste reduction and community connection. That is useful inspiration for a complete action loop, not a reason to copy its identity or turn HALO into an unrelated food marketplace. Earlier demo observations in this repository are distinct from the official profile; this plan does not claim a fresh frame-by-frame verification of every winner video.

The [Congressional App Challenge toolkit](https://www.congressionalappchallenge.us/congress/congressional-toolkit/) supplies judging guidance around functionality and programming, originality and problem-solving, and implementation including user experience. The exact current district panel and local weighting have not been verified here. No feature is justified solely by an assumed judge's interests or a promise of winning.

Retain the original restriction against unverified first-or-only-app claims. Explain HALO through demonstrated capabilities, regional evidence, thoughtful implementation and user outcomes rather than claiming an exhaustive competitive survey or exclusive invention.

Evaluate the app with representative task tests: can a new user explain what a score does not know, find the right source, choose and resume an action, recover from a failed save, and distinguish a public record from their own measurement? Include a renter, private-well household, low-bandwidth phone, keyboard/screen-reader path and someone who never uses Journal. Use consented usability sessions with nonsensitive task-success and confusion notes by default. Production behavioral analytics are not part of this plan's default and require a separate explicit privacy decision; operational failure metrics must not contain private user content.

Finishing requirements include useful empty states, retained drafts, stable return navigation, correct singular/plural copy, local dates and units, source-link checking, event expiry, duplicate prevention, explicit successful saves, safe external-link labels, printable light layouts, careful mobile safe areas, and genuine accessible alternatives to visual controls. These details make the app credible as much as a complex new chart does.

The release demonstration should show several connected real-data journeys rather than every menu item: a daily decision, a home evidence-to-action workflow, a food or water stewardship case, and a civic participation path that appears in Plan. Label any demonstration fixtures visibly and never mix them into a real household session.

## Preservation and completion status

This four-document plan is saved in the repository as reviewable documentation. It does not alter app components, routes, database records, hosted previews, the current unapproved Map work or approved visual archives. A future commit can preserve the reviewed plan with the project's normal Git history; document creation alone does not publish it to GitHub.

Completion of planning means all 45 feature areas have a defined purpose, location, evidence/input model, meaningful interactions, actions, failure behavior and verification requirements across these documents. Completion of implementation is a later claim, requiring the [acceptance checks](HALO_FEATURE_ACCEPTANCE.md), validated data sources, backend integration and visual approval. No document can guarantee every future source, unknown user need or production defect in advance.

## Reference documents

- [Original frontend specification](../foundation/reference/HALO_Frontend_Specification_2026-09-29.pdf), retained as a capability reference rather than overriding newer user decisions.
- [Wireframe workflow](../WIREFRAME_WORKFLOW.md).
- [Approved foundation stage handoff](../foundation/STAGE_FRONTEND_HANDOFF.md).
- [Approved October 1 preservation baseline](../foundation/approved/2026-10-01).
- [Current Map preview notes](../map/README.md).
- [Backend and Data Plan](HALO_BACKEND_AND_DATA_PLAN.md).
- [Frontend Build Plan](HALO_FRONTEND_BUILD_PLAN.md).
- [Feature Acceptance](HALO_FEATURE_ACCEPTANCE.md).

Official source links appear beside the capabilities they support. A linked source's existence establishes neither a working production integration nor reuse permission; those remain explicit acquisition gates.
