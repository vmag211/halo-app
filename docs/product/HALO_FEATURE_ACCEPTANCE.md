# HALO Feature Preservation and Acceptance Plan

Version 1.1, October 2, 2026, prepared for Yogi and Vibhav. This document defines what must be preserved and what would constitute a complete implementation of the proposed full HALO product. It is a planning and acceptance document, not a statement that the new features are implemented, the new navigation is approved, or the live deployment has passed validation.

Read this with [HALO Master Plan](HALO_MASTER_PLAN.md), [HALO Frontend Build Plan](HALO_FRONTEND_BUILD_PLAN.md) and [HALO Backend and Data Plan](HALO_BACKEND_AND_DATA_PLAN.md). The feature identifiers link the documents and remain stable when a feature moves to another page. Build order is not removal from the product scope. A feature identifier covers its pages, forms, states and underlying services, not just one screen.

October 3 source audit: the [Backend Build Handoff](HALO_BACKEND_BUILD_HANDOFF.md) adds the complete feature-to-backend matrix and implementation tests. The [Source Acquisition Guide](HALO_SOURCE_ACQUISITION_GUIDE.md) adds source-specific release gates. Require proof of permitted pollen history/map use, permitted geocoding persistence, fish-rule contradiction/truncation handling, food notice lifecycle, utility crosswalk/restriction instructions and source-version-aware comparisons. Public HTTP samples are not substitutes for integration, RLS, source-review or deployment tests.

October 3 later Homeguard refinement adds the [acceptance checks below](#homeguard-refinement-acceptance-october-3) and corresponding [backend delta](HALO_BACKEND_AND_DATA_PLAN.md#october-3-homeguard-integration-delta). They do not assert that the sample-session wireframe has production persistence or that the previously compiled backend packet already includes kitchen records.

## Authority and preservation

Current user decisions override conflicting instructions or older visual proposals in the supplied specification. The specification remains a functional reference. [The wireframe workflow](../WIREFRAME_WORKFLOW.md) governs design review, and the [approved-stage handoff](../foundation/STAGE_FRONTEND_HANDOFF.md) records the production frontend contract and its known limits.

- Keep the immutable October 1 foundation archive at `docs/foundation/approved/2026-10-01` and its source baseline `72a2c5150ecfe354fa6b534781e8b6b090d0bda1` unchanged.
- Keep approved onboarding archives and the approved rounded mobile onboarding intact.
- A new product plan does not freeze new wireframes. New navigation, new screens, and material changes to approved screens need Yogi's visual review and explicit approval before freezing or production implementation.
- Preserve unrelated local changes. The Map is an unapproved review prototype, not an accepted production integration.
- Yogi is the sole frontend decision maker. Old assignment tables and parallel human lanes are superseded. Vibhav handles backend integration and development coordination.
- No app-facing em dashes, including returned content, errors, accessibility text, exports, notifications, and Luna responses.

## Decision ledger

| Area | Current decision or recommendation | Acceptance consequence |
| --- | --- | --- |
| App purpose | Environmental evidence, household relevance, action, and follow-up | New features must identify a real decision or action, their evidence, and a useful follow-up. More screens alone are not a feature. |
| Navigation | Today, Homeguard, and Act are requested tabs; Plan is the recommended fourth tab | Plan's label and the final tab order still require Yogi's review. Keep a migration map for existing URLs. |
| Map | Move Map beneath a main section while retaining its functionality | Recommended home is Act, with direct contextual entry from Today, Homeguard, and Food & Garden. No capability loss from relocation. |
| Journal | Rework its purpose and placement without casually deleting useful functions | Recommended home is Plan. Preserve original recording, history, and comparison capabilities until an explicit reviewed replacement is agreed. |
| Today | Latest name is Today, not Personal Hero | Visible labels, document titles, announcements, exports, and links use Today. Legacy names may remain only in historical archives. |
| Today page depth | October 3, 2026: Today and its air, UV, pollen and mold details stay substantially as they are for now | Preserve current sections, useful information, visuals and overall layout. No substantial shortening or hiding existing content behind extra taps solely to simplify. Substantial cuts or restructuring need a separate user decision. |
| PFAS | Homeguard only, not a Today factor or score input | Tests must prove PFAS never contributes to Today geometry or totals. It remains reachable through water, Map, food advisories, and contextual Learn. |
| Homeguard score | Water and radon; lead remains shown and not scored | New home records or completed tasks do not silently change existing score semantics. A later scoring change requires a separately reviewed versioned methodology. |
| Factor navigation | Whole cards navigate to dedicated pages, without dropdown arrows | Older PDF expandable-card instructions are superseded by the approved stage. Keep raw reading, provenance, details, tips, and sources. |
| Household illustration | Selected categories only, beneath its heading and above home factors | Do not draw unselected categories. Categories are not named people or a count of distinct people. A person may match more than one category. |
| General household advice | Children, teens, and adults may use general advice | Existing approved category routes remain supported, but do not invent demographic distinctions merely to fill them. Dedicated guidance appears where evidence justifies it. |
| Respiratory label | Respiratory Issue(s) | Replace the earlier Breathing label in visible UI while keeping stable backend category keys. |
| Tips | Overlapping step cards with previous and next arrows | Next brings the next card forward. Provide a nonanimated and scan-all equivalent. Browsing a step does not mark it complete. |
| Factor styles | Slight whole-card tints, not gradients; unique matching scenes | UV orange, air teal, mold green, pollen light yellow. No deer. Visual identity remains distinct from severity colors. |
| UV feature | Rising half-sun rather than a generic semicircle | Preserve the approved rising-sun detail and its readable forecast information. |
| Luna | Name Luna, teal geometric mark, approved assistant composition | Do not restore Ask HALO as the product name or copy another company's branding. Preserve source and privacy distinctions. |
| Onboarding | Transparent white logo on dark Welcome band, true cursive handwriting, then centered lowercase to and uppercase HALO | No return to the blue logo tile, HALO-only header, Playwrite Argentina, or horizontal text wipe. Access to Get started never waits for animation. |
| Appearance | Follow the device; review controls are outside the product | Do not turn the preview appearance switch into a product preference. Atmospheric day and night are separate from light and dark appearance. |
| Settings writes | Approved essential Settings uses explicit Save and retained drafts | PDF autosave instructions do not override the approved production behavior. New form behavior must be consistent and reviewed. |
| Luna data use | Current backend context setting is not verifiable through the existing GET contract | Never assume context is off when a flag is missing. New privacy controls require a working server contract and provider review. |
| Data growth | User accepts additional backend work | This permits planning real capabilities, not presenting absent sources as available or silently implementing changes. |

## Twenty preservation groups from the existing specification

These are twenty audit groups, not a claim that the original PDF labels exactly twenty features. Together they cover its original functional areas and the later approved stage. The reference is [HALO Frontend Specification](../foundation/reference/HALO_Frontend_Specification_2026-09-29.pdf), especially Parts A, B, and C. Physical page numbers below refer to that 83-page reference.

| Group | Capability to retain | Proposed home and identifiers | Source |
| --- | --- | --- | --- |
| 1 | Anonymous session bootstrap, four onboarding steps, address or ZIP, optional GPS, household skip, home details, results reveal, resumable failure and address change | Onboarding and Settings, G01 and X04 | B1, pages 32 to 35; stage handoff |
| 2 | Daily overview, four stable factor positions, partial-score notices, contribution display, freshness, manual and return refresh | Today, T01 | B2, pages 36 to 39; stage handoff |
| 3 | Air reading and measured/modelled provenance, UV window, pollen categories, mold weather basis, history and factor-specific explanations | Dedicated factor pages, T02 to T05 | B2; approved factor routes |
| 4 | Household-relevant wording and selected household category guidance | Today family and Homeguard guides, T06 and H05 | A4, page 17; approved family and household routes |
| 5 | Homeguard overview, evidence coverage, separate home score, house visual and home factors | Homeguard, H01 | B3, pages 40 to 46; approved household illustration |
| 6 | Utility identity, compound rows, threshold and benchmark types, sample histories, dates, unregulated and excluded results | Water detail, H02 | B3, pages 42 to 43 |
| 7 | Private-well and spring branches, prioritized testing reasons, cadence, locations, estimated costs and unknowns | Water and Tests, H02 and H06 | B3, page 44 |
| 8 | County radon estimate and home-test distinction; lead building-era estimate and utility-wide service-line context | Radon and Lead, H03 and H04 | B3, pages 44 to 45 |
| 9 | Ranked home action plan, reason, certification, estimated cost, renter and owner alternatives | Homeguard and saved actions, H01, H07, P02 | B3, page 45 |
| 10 | Journal first-use retrospective calendar, selectable past rough days, coverage notice, immediate descriptive result and failed-date retry | Journal, P04 | B4, pages 47 to 48 |
| 11 | Daily and past check-ins, group selector, symptoms, subjective severity, possible illness, notes, felt-fine entry, update, recent entries, delete and undo | Journal, P04 | B4, pages 48 to 49 |
| 12 | Twelve-week heat grid, day details, environmental trend, finding counts and limitations, seasonal prompts and summaries | Patterns and recap, P05 and P06 | B4, pages 49 to 51 |
| 13 | County and cause-matched organizations, scope, links, and human verification dates | Act organizations, A02 | B5, page 52 |
| 14 | Practical civic guidance tied to water, radon and available facility evidence, plus useful general participation guidance | Act issues and projects, A01 and A04 | B5, page 53 |
| 15 | Utility, Landlord, and Representative letters, independent editable drafts, cited reading, copy, native share, reset, and no-result branches | Outreach, A05 | B5, pages 53 to 54 |
| 16 | Household health card with two scores, all factor readings, household notes, top actions or tests, dated sources, image save and clean print | Household summary, H08 | B5, pages 54 to 55 |
| 17 | Household/home/renter settings, address change, reviewed language, accessibility, notifications, inspectable data, clear Journal, delete account, methodology and sources | Settings and privacy, X04 to X06 | B6, pages 56 to 60 |
| 18 | Four Map layers, water compounds and quarters, selected records, home context, legends, geographic limits, district comparisons and accessible text fallback | Map, M01 to M05 | B7, pages 61 to 67; Map README |
| 19 | Contextual Learn with reading, meaning, household relevance, steps, sources, language and incomplete-data behavior | Integrated throughout, X01 | C1, pages 68 to 69 |
| 20 | Cited assistant, refusal and unavailable states, privacy marker, alert inbox/read/dismiss/undo, typed notification preferences and opt-in device push | Luna and alerts, X02 and X03 | C2 and C3, pages 70 to 73; B6; stage handoff |

Retain all useful content while resolving outdated claims through reviewed source updates. Preservation does not require repeating an inaccurate statement. For example, missing private-well results means HALO lacks a result, not that no agency or person has ever tested the well.

## Original twenty capability crosswalk

The [original context document](../onboarding/reference/HALO_Codex_Context.md) has its own numbered twenty-capability list in section 2.4. This table maps those exact capability numbers independently of the twenty audit groups above. Historical statements about law, competitors, universal coverage, testing availability or completion are not accepted as current facts merely because they appeared in that document.

| Original number | Preserved capability | Target and necessary qualification |
| --- | --- | --- |
| 1 | Address to environmental picture without mandatory account registration or retaining the typed address | G01, X05. Preserve the original under-10-second flow as a measured target, not a promise that every provider responds within ten seconds. Partial results remain honest. |
| 2 | Four daily factors and combined assessment with missing/estimated inputs | T01 to T05. Backend scoring and distinct data gaps remain authoritative. |
| 3 | Utility water, county radon and building-era lead | H01 to H04. Lead remains unscored; estimates are not property measurements. |
| 4 | Different water situations without absence-as-safety | H02. Test actual current discriminated states and coverage; the historical count of five does not limit new honest states. |
| 5 | Private-well testing plan | H02, H06. Now includes a real record and follow-up lifecycle rather than a fabricated reading. |
| 6 | Household-relevant wording without named people or ages | T06, H05, X01. Categories stay optional; new voluntary documents require truthful expanded privacy wording. |
| 7 | Ranked practical actions with costs, certification context and renter/owner alternatives | H01, H07, P02. Preserve source review and user control; do not treat an estimated cost as a current quote. |
| 8 | Statewide water/compound view and historical scrubbing where supported | M01, M02. Returned dates and coverage control the timeline. |
| 9 | Symptom recording and supported patterns | P04, P05. Preserve recording while correcting denominator and measurement-basis interpretation. |
| 10 | Source-cited household assistant with diagnostic refusal | X02. Actual provider context and privacy behavior must match disclosure. |
| 11 | Contextual contaminant explanations, protective steps and sources | X01, T02 to T05, H02 to H04. New topics extend reviewed content, not unchecked AI text. |
| 12 | Verified local organizations matched to findings | A02. Directory errors are not a successful zero-match response. |
| 13 | Ready-to-review sourced letter | A05. All recipient modes retained; missing evidence produces an information request. |
| 14 | Shareable printable household summary | H08. Select private fields explicitly and retain original observation dates. |
| 15 | Public aggregate district evidence without personal data | M05. Permit civic exploration without address onboarding; existing anonymous-token authentication is distinct from a completed household profile. |
| 16 | Meaningful changes with earlier eligible sensitive-group alerts | X03. Versioned server policy, genuine data changes and deduplication must be tested. |
| 17 | Offline last-known evidence and reconnection | X06. Dated cached reads are not proof of offline mutations or a service worker. |
| 18 | Complete English and reviewed Spanish experience | X04, X01, X06. Include UI, errors, exports, guidance and source-locale disclosure for the advertised translated scope. |
| 19 | Keyboard, screen-reader and redundant severity communication | X06 and every screen. Test complete workflows as well as individual controls. |
| 20 | Delete the household's stored data | X05, X04. Cover rows, files, queues and caches, with accurate backup/provider retention limits rather than an immediate universal-erasure promise. |

## Feature specific acceptance

Each feature is incomplete until it passes the shared requirements later in this document as well as its own criteria. These criteria are target behavior, not current test results.

### Entry and Today

| Feature | Required behavior and evidence of completion |
| --- | --- |
| G01 Onboarding | Preserve approved layout and handwriting; support address, US ZIP and voluntary GPS without automatic permission requests; keep data on Back and failed save; confirm ambiguous writes using request identifiers; use authoritative completion state; distinguish out-of-region coverage from lookup failure; continue honestly when a provider cannot return a result. Test a new home, changed home, same address, skipped household, private well, spring, unknown year, offline interruption, timeout after successful write, and identity replacement. |
| T01 Today overview | Four factors only, fixed card order, real source timestamps, explicit partial coverage, unknown distinct from zero, proper refresh cooldown, cached-reading notice, and meaningful change comparison using compatible time, coverage and methodology. A source arriving after an outage must not be described as worsening conditions. Ring and contributions must not claim percentages of health risk or formula weights when only visual input shares exist. |
| T02 Air | Show real AQI and dominant pollutant when provided, observation context, provenance, seven-day gaps, accessible chart data, and a link to the relevant monitor/map context. Save an applicable step into the shared action system and return to the same detail position. Unknown provenance is neither measured nor modelled. |
| T03 UV | Preserve rising-sun composition; distinguish observed/current reading, daily maximum and forecast window; include timezone and forecast issue time when supplied; allow inspecting a supported time and saving a chosen step. A null window must not imply low UV all day. Do not fill unavailable forecast hours with interpolated values. |
| T04 Pollen | Show tree, grass and weed separately with units or category definitions, source coverage and dominant category. Changing category updates its chart and accessible summary together. Seasonal text is reviewed and geographically appropriate, not a replacement for current data. Link to optional Journal without suggesting pollen caused a reported symptom. |
| T05 Mold | Explicitly label the current weather-based estimate; show humidity/rainfall basis only when present; offer moisture-check guidance and records without claiming indoor spore detection. If users later enter sensor readings or observations, maintain their separate origin, units, timestamps and scope. |
| T06 Daily family | Selected categories and general guidance both work; combine applicable messages without duplicate instructions or conflicting priorities; explain which environmental evidence prompted a suggestion; save the same action record used elsewhere. Skipping household selection must not disable the useful daily app. |

### Homeguard

| Feature | Required behavior and evidence of completion |
| --- | --- |
| H01 Homeguard | Preserve home score semantics, separate evidence gaps, selected-category house, water/radon/lead routing and ranked actions. Clicking a house figure opens its category guide with a reliable return path. Private water has a testing pathway, not an invented water or combined score. A completed action does not change a measurement or score without new evidence. |
| H02 Water | Show matched utility and mapping limitations; support complete, partial, no detections recorded, excluded-only, unscoreable, no published result, failed lookup, no utility match and private-source states distinctly. Retain compound units, sample dates, history, enforceable limit versus benchmark, unregulated/excluded evidence and source revision. Follow the utility, inspect on Map, start a test, or prepare outreach using the exact selected record. Do not label a detection-only source as complete testing coverage. |
| H03 Radon | Keep county potential separate from a household concentration. Testing workflow supports planned, awaiting result, result recorded, review and follow-up states. Result units, method, start/end dates and source are required as appropriate. Guidance and reminder timing must be source-reviewed; a saved test suppresses an obsolete no-test reminder only under an explicit rule. |
| H04 Lead | Keep age estimate and utility service-line totals distinct from property evidence; show unscored status permanently. Unknown year is not newer construction. User-supplied or verified property information is separately identified. Routes to home correction, testing, certification guidance and renter outreach retain context. |
| H05 Household guides | Only selected categories appear in the house; direct URLs for unavailable categories have a clear general-guidance or edit-selection explanation, not fixture people. General child/teen/adult guidance remains supported. Clinical-sounding age-specific claims need reviewed sources. Category overlap must not become a false count of residents. |
| H06 Tests and records | Create, edit, archive/delete and inspect a test record; retain test type, purpose, dates, lab/provider or user origin, specimen/site context, units, result qualifiers, reporting limits, attachments if supported, review status and related actions. Draft, ordered or arranged, sampled, awaiting result, recorded and follow-up are distinct. Pending tests are not negative results. Uploaded extraction is unconfirmed until the user verifies it. |
| H07 Maintenance | Save specific equipment or upkeep information only when useful; retain installation/service dates, product or source instructions, user-chosen cadence, last completion and next due. Snooze, skip, complete, change cadence and stop reminders without losing history. A filter replacement reminder neither verifies the product's certification nor proves contaminant reduction. |
| H08 Household summary | Preview and choose included evidence; retain original two-score/all-factor/source/top-action capability; identify missing, old, estimated and user-reported information; private-water version shows tests rather than no action. Print cleanly in light black-on-white with no app chrome, use readable labels rather than color alone, and support image export with permission/error fallbacks. Export generation date must not replace observation dates. Sharing is explicit and excludes sensitive additions by default. |

### Food and Garden

| Feature | Required behavior and evidence of completion |
| --- | --- |
| F01 Food and Garden overview | Show concise entrances to fish, gardens, local food, grower resources and water stewardship; optional interest selection changes relevance, not scientific conclusions. Surface only real notices and records, with coverage and dates. Empty regional coverage offers useful source and testing pathways rather than fabricated local findings. |
| F02 Fish advisories | Resolve a selected waterbody and species against the actual advisory geography and audience categories. Distinguish statewide from specific advice, effective from superseded records, no matching advisory from known unrestricted status, and source outage from no advisory. Show the exact official recommendation with units and qualifications; save/follow it and alert on meaningful revisions. Existing household category labels must not silently approximate advisory age or audience definitions. Optional catch/consumption notes support private create/edit/delete/export with original dates, species, waterbody and quantity/unit; they do not compute dose or remaining allowances and are not required for advisory access. |
| F03 Garden records and guidance | Optional setup captures relevant growing-site, water-source and test context without requiring names or exact residential coordinates. Guide the user to suitable sampling/resources, connect test results and chosen stewardship tasks, and retain useful notes over time. Routine fertility testing is not contaminant testing. Regional water or soil data cannot become a measurement of the plot or crop. |
| F04 Local food information | Distinguish local official notices, product/sample-specific tests, broader monitoring and research. Filter by supported geography or product category without claiming every local food is covered. Users can inspect source and sample date, save/follow a specific notice, prepare questions and record their own relevant source-linked information. No universal PFAS food score, product absence-as-safe claim, or unsupported farm contamination inference. |
| F05 Grower resources | Support genuinely useful water/soil sampling preparation, relevant Extension and testing contacts, source-linked records and conservation program details. Separate growing sites only where needed, with accessible labels and optional coarse location. A grower can save a resource, prepare questions, attach a confirmed test and plan a follow-up. Do not give crop-specific agronomic prescriptions without suitable evidence and review. |
| F06 Water stewardship | Show dated US Drought Monitor county category distributions, or a point classification only when a valid dated source geometry supports it; never use the county maximum as the home's status. Separately show source-dated utility conservation notices where verified ingestion exists. Regional drought, enforceable or voluntary utility notice, and plot moisture are different facts. Optional meter/bill/irrigation records require units, period, source and edit history. Compare only compatible measured periods; identify estimated entries and interval length. Report measured usage difference, not savings caused by HALO or a task without a validated attribution method. Do not infer moisture or irrigation quantities from a regional drought class. |

### Act and Map

| Feature | Required behavior and evidence of completion |
| --- | --- |
| A01 Act hub | Keep original organizations, ways to help, letters and household summary reachable while introducing conservation depth. Personalization explains relevance but does not prevent browsing another cause. Local issue pages connect evidence to organizations, projects, outreach and Map. Good or missing readings do not leave the page empty. |
| A02 Organizations | Preserve county/served-area and cause matching, actual contact/site links, human verification status and date. Working URLs are not proof of organizational verification. Distinguish no matches, unsupported geography, stale records and failed request. Users can broaden filters and report stale listing information without creating a public accusation. |
| A03 Opportunities | Distinguish an organization from a dated opportunity. Show organizer, actual place/service area, time and timezone, requirements, accessibility information when supplied, cost, age restrictions and registration link. Saving to Plan does not register; clicking registration does not prove completion. Support cancelled, full, postponed, date changed, unknown capacity and expired states, with change notices for saved events. |
| A04 Stewardship projects | A project has a reviewed purpose, suitability, materials, real ordered steps, constraints, completion criteria and follow-up. Save once into Plan, record progress and stop or revise it. Count user-reported actions as participation, not measured pollution removal or health improvement. Source-backed protocols are required before describing observations as monitoring data. |
| A05 Outreach | Keep Utility, Landlord and Representative recipients with separate draft edits and current-recipient reset. Show cited evidence and applicable legal versus benchmark status. Include information-request/testing variants when no exceedance is established and hide irrelevant utility templates for wells. Copy and share have permission, cancellation and unsupported-device fallbacks. An outbound click is not sent status; sending and replies are user-confirmed unless a verified integration exists. Recipient discovery and legal guidance require reliable current sources. |
| A06 Private field observations | Users can privately record a date/time, observation category, factual description, optional coarse location and optional photo. Do not infer a contaminant from appearance or odor. Provide export and an official-reporting handoff, not automatic submission or publication on a shared map. Strip or explicitly protect precise photo metadata and exact location; preview what leaves the app. Status distinguishes draft, exported, official site opened and user-confirmed report. Emergency situations point to appropriate official channels, not Luna. |
| M01 Map shell | Preserve four layer controls, pan, zoom, touch/pinch, keyboard controls, locate, home context, attribution, legend, selection, independent layer failure and renderer fallback. Accessible searchable text list works without the map and includes records lacking coordinates. Lazy loading and responsive layout preserve the rest of the app. |
| M02 Water and timeline | Preserve compound selectors, Overall and hazard index, own-system ring, population/null handling, complete selected-record detail, available quarters plus distinct Latest, loading retention, cancellation and failed-quarter restoration. Latest is each system's latest observation, not a single synchronized date. Empty quarter differs from no stored detections. Historical sample points do not describe a moving plume. |
| M03 Other layers | Radon county polygons show zone context, never home concentration; facilities preserve selected-dataset scope, compliance-program counts, inspection/date/null and grouped points; air stations show observation time, pollutant/source and approximate distance. Missing or filtered-out dots never mean clean geography. |
| M04 Comparisons | Compare only like units, periods, evidence kinds, denominator definitions and geographic scopes. Display coverage and date differences before interpreting them. Household rank uses its actual ranked denominator and hides when unranked. Public-system comparison never implies residents can choose their supplier. A smooth density display is labelled record density, not pollution intensity. |
| M05 District | Preserve district/state summary, county rows including partial-county tags, compound-specific denominators, affected-population completeness, unlocated records and boundary version. Avoid misidentifying a household district from a partially included county. System centroids do not establish exact service-area membership. Geography failure is distinct from zero exceedances. |

### Plan and shared systems

| Feature | Required behavior and evidence of completion |
| --- | --- |
| P01 Your Week | Show saved actions, routines, tests, events and optional outdoor plans in one agenda with accessible date navigation. Permit unscheduled saves. Preserve all-day dates versus timed events, timezone changes and daylight-saving transitions. Rescheduling an item updates the shared record, not an unrelated calendar copy. Clearly label a calendar export as an export unless synchronization actually exists. |
| P02 Shared actions | Save from any relevant screen; deduplicate the same action under explicit rules; retain origin, reason, evidence version, user edits, chosen due date and status. Create, edit, schedule, snooze, complete, reopen, archive/delete and review changed source guidance. Duplicate taps, retries and unknown-write outcomes do not create duplicate reminders or false completion. |
| P03 Outdoor planning | Ask only useful activity, place, date and time information; show supported per-factor forecasts, issue time, horizon, uncertainty and missing periods. Compare practical options with tradeoffs rather than an unvalidated safest-time score. Expired forecasts require review. No continuous background location tracking or inference that a user was exposed at a planned place. |
| P04 Journal | Preserve first-use retrospective, Log today instead, past dates, group selector, seven symptom labels, severity without a default, possible illness, optional note, felt-fine action, recent entries, prefilled update, visible delete and undo. Guard against blank overwrites while entries load. Retrospective batch retry sends only failed days and preserves existing records; a blank day is not a felt-fine day. A useful immediate result can be descriptive environmental context, including insufficient data. |
| P05 Patterns | Preserve twelve-week heat grid, missing-factor mark, accessible legend, per-day readings and logged entries, edit-from-day detail, score trend, finding bars and counts, and optional group filtering. Logged counts, comparable counts and environmental-history counts are distinct. Revised symptom comparisons must distinguish unlogged and explicitly fine days, retrospective recollection, illness flags and missing readings. Show sample sizes, method and limits; no causation or diagnostic conclusion. |
| P06 Seasonal recap | Retain season summaries and dismissible relevant prompts without streaks or pressure. Alert links open the actual recap. Show period, logged-day coverage, environmental coverage, excluded days and limits. Show completed actions as user-reported follow-through, not proof that those actions changed health or environmental conditions. |
| X01 Learn | Retain reading-specific explanation, what it is, why this reading, household relevance, concrete protective steps and dated source links. Integrate it into factor/feature details rather than recreating a competing tab. Omit unsupported personalized sections instead of filler. The proposed glossary/topic index is a new addition, with entry from contextual Learn or Sources and methods, search over reviewed topics, clear no-match behavior and return-to-context. New food/garden topics require new supported content contracts and reviewed translations. |
| X02 Luna | Preserve approved name/visuals, suggestions, grounded replies, citations, refusal, no-source, unavailable, unconfigured, rate-limit, cancel and retry states. New conversation context and action tools are explicit backend extensions. Server derives authorized household context; show real controls and provider-use status before implying privacy. Draft actions require preview and confirmation. Cancel/retry does not duplicate a message or execute an action twice. Do not promise diagnosis, treatment or arbitrary live web knowledge. |
| X03 Alerts and watchlists | Preserve unread badge, read one/all, full-message expansion, explicit related-page link, dismiss and undo. Support the original five preference types plus separately reviewed subscriptions/reminders. Meaningful changes deduplicate by event and evidence version. Marking an alert read differs from acknowledging an action; opening inbox alone does not clear all unread items. Push is opt-in and unsupported browsers still have an inbox. |
| X04 Settings | Retain full household edit, home details, confirmed address change, renter/owner mode, accessibility, notification preferences, reviewed language, privacy, About, dynamic source list and methodology. Explicit saves preserve drafts and untouched fields across refetches. A household replacement always contains all seven booleans. Unknown profile state disables writes. No product appearance picker unless separately approved. |
| X05 Privacy and recovery | Inspect stored values and categories, export selected/all supported data, clear Journal with a real count, and delete all household data with typed confirmation. Deletion covers new tables, private files, queues, subscriptions and derived caches, with honest provider-retention limits. Optional recovery or device linking requires dedicated secure design and consent; anonymous use remains viable. |
| X06 Offline and accessibility | Cached evidence keeps original source dates and visible offline status; new private records are not silently cached. If offline drafts or queues are implemented, label pending/unconfirmed state, provide cancel, and synchronize only for the same verified identity. Every key action has keyboard and screen-reader equivalents; reduced motion and large text remain functional. |
| X07 Source operations | Each external feed and curated resource has an owner, coverage, update expectation, source date, last successful fetch, review status and failure behavior. A feed outage cannot publish an empty replacement as clean conditions. Changed or retracted advice links to affected saved actions for review. No user-facing monitoring promise before source access and refresh reliability are demonstrated. |

## Shared interaction acceptance

### Homeguard refinement acceptance, October 3

- Test timeline: entering view animates the bar and paper-carrying Luna to the current recorded stage, and checks genuinely recorded milestones in order. An imported existing report does not complete missing Arranged, Collected or Awaiting stages. Animation does not save data or imply laboratory tracking. Reduced motion shows the final state immediately; decorative running stops on arrival.
- Timeline edits: completed editable stages have labelled keyboard/touch-accessible pencil targets, visible focus and retained correction/validation/conflict behavior. Incomplete milestones still expose usable next actions. The Luna introduction works on hover and focus/touch, not hover alone. At 320px and 150% text, the robot, labels and controls neither overlap nor clip.
- Result/follow-up simplification: original values, qualifiers, units, transcription status and scientific limits remain accessible. Existing result corrections retain original versions and a reason. One linked Plan follow-up is reused; a stage label cannot falsely certify action completion or a laboratory result.
- Kitchen inventory: common-food names and aliases are searchable; no-match is useful. Add without a mandatory question, open, move storage, edit origin and remove with confirmation all work. State survives in-session navigation and Luna use. Preview copy discloses session-only saves; separately prove authorized persistence, revision conflicts, identity changes, export and deletion before production claims.
- Kitchen evidence: only PFAS and lead indicators appear here, without removing other official fish-advisory contaminants elsewhere. Unknown remains distinct from zero and non-detect. A contextual study or recall lacking concentrations cannot be displayed as this household item's numeric level. Any supported result includes matching scope, original compound/value/qualifier/unit/basis/date/source. No automatic food score or water-to-food conversion is permitted.
- Household report: generating creates a valid multi-page-capable PDF, not an HTML file renamed with a PDF suffix. Progress describes actual work or is indeterminate. Render and inspect long reports for readable fonts, wrapped text, sensible page breaks and no clipped values/navigation. Test original units and qualifiers, missing sections and source dates. Keep optional image/print capability and explicit share fallbacks.
- Report privacy/recovery: default output excludes private records and notes unless deliberately selected. Selected records/revisions remain one snapshot; a changed selection or record requires regeneration. Cancelling, failed generation, denied/unsupported sharing and retry retain choices. Temporary object URLs are cleaned up. The local path makes no model or upload request, despite Luna's presentation role. A downloaded copy is not revocable.
- Plan integration: save one chosen follow-up from each supported Homeguard domain and verify the same ID in the origin and Plan. Check scheduled, unscheduled, repeated-save, intentional-repeat, edit, complete, reopen and deleted-origin states. Merely adding a food, result or reading creates no unsolicited task; completing a task changes neither evidence nor scores. Scheduled routines use one occurrence per logical recurrence, not independent screen copies.

### Navigation and continuity

- Direct links reconstruct authorized data and open the intended subpage or section. Invalid factors, household categories, records, quarters and return URLs have safe behavior, never fixture fallbacks or open redirects.
- Browser Back closes a sheet before leaving the parent page. Closing restores focus to the opener and the underlying scroll position. A new sheet replaces the existing sheet, not an inaccessible stack.
- Cross-feature navigation carries stable record identifiers and public filter state, not household details, notes, credentials, exact home coordinates or transcript text in the URL.
- Map opened from a compound, monitor, advisory or organization returns to the initiating feature with the relevant context intact. A direct Map visit has a predictable default.
- Build `/journal` and `/map` as the stable planned destinations; they are not currently implemented production pages. Preserve applicable legacy notification/query formats through validated migration or aliases. Notification links, saved bookmarks, exported links and Settings links receive migration tests.
- Extend StageApp's live-route recognition, safe return allowlists, active-tab ownership, page titles and assistant context tokens together with every new route. A new page file that renders outside the shared gate is not an integrated page. Unknown destinations remain safe errors, not arbitrary redirects.
- Public Map/district and civic browsing have a tested no-home-profile mode. Existing anonymous authentication is reused or a separate public-read policy is explicitly approved. No address, household categories, home pin or personalized ranking is required or invented. Private records still enforce owner/profile requirements.
- A source or organization link opens safely and does not imply that HALO owns, verified, or submitted content on that destination.
- Long forms warn before discarding unsaved changes when appropriate. Returning from a source, native share dialog or external registration must not erase the draft.

### Honest mutation behavior

- Explicit user intent is required for save, schedule, subscribe, upload, share, send/handoff, clear and delete. Following a suggestion or reading a step does not create a commitment automatically.
- Loading actions prevent accidental duplicate submission but preserve layout and readable status. Validation identifies the field and retains all values.
- Confirm success only from an authoritative mutation result under the same identity. Unknown outcomes are reconciled with an idempotency key or status lookup before retrying.
- Revisions detect conflicting edits rather than overwriting a newer device's record. Server ownership is derived from authentication, not a household ID supplied in the request body.
- Recurring actions disclose calendar-anchored versus completion-relative timing. Completing late or skipping must not move a fixed-date series. Duplicate scheduler/completion events create only one next occurrence, and this occurrence versus future-series edits have distinct outcomes.
- Home-context changes retain historical test/location associations. A failed lookup for a genuinely new home cannot attach the old utility to its new coordinates. Unknown legacy context remains unknown. Validate atomic retries, timezone boundaries, portable-task confirmation and subscription review.
- Saved outdoor plans retain location/timezone, chosen interval, duration and forecast revisions. An opted-in change watch applies only to that plan's supported factors, area and periods. Updated forecasts can request review but never silently move the event.
- A failed save stays actionable with its draft, not only a disappearing toast. Confirmations and Undo may use a toast, but important errors remain visible.
- Delete one Journal entry retains the full entry for Undo. Clear Journal and Delete everything have separate scope and irreversible-action confirmations.
- Never announce that nothing was deleted after a partial or unknown multi-step failure. Reconcile the result and state what is known.

### Data states

Every relevant page, panel and independently fetched section must distinguish:

| State | Required meaning and response |
| --- | --- |
| Loading first data | Stable skeleton or labelled progress, not plausible placeholder readings. |
| Updating with prior data | Keep dated prior evidence visible and indicate refresh; do not reset to zero. |
| No user records | Invite a useful optional first action; do not claim environmental data is unavailable. |
| No source coverage | Explain the geographic, temporal or category coverage limit and offer a genuine alternative. |
| Source has no matching result | State that absence precisely; never imply safety or that testing was performed. |
| Valid measured zero | Preserve zero and its units as actual data. |
| Non-detect | Preserve reporting qualifier and detection/reporting limit when available; do not turn it into measured zero. |
| Partial evidence | Show usable data and missing components independently. |
| Stale evidence | Keep source observation time visible, distinguish fetch time, and explain relevant limits. |
| No data at all | Show no-data score/reading, not a favorable score built from nothing. |
| Failed request | Explain retryable failure without dumping raw provider/database diagnostics. |
| Offline with cache | Show saved evidence and its age; disable or explicitly queue unsupported mutations. |
| Offline without cache | State that the view is unavailable, with useful existing offline information only. |
| Pending user action | Show planned/awaiting/unsent state, not a completed test, registration, observation report or task. |
| Unverified record | Show user-reported or unreviewed origin; never style it as a verified measurement. |
| Expired or withdrawn source | Retain historical context where appropriate, mark it, and avoid offering outdated guidance as current. |
| Identity cannot be verified | Private data and edits are unavailable; do not replace the identity just because a service returned an availability error. |

All asynchronous screens need cancellation and out-of-order-response tests. Changing a factor, date, map layer, identity, household or location must prevent late responses from overwriting the new context.

### Existing protocol preservation

- Preserve additive contracts. Do not rename, remove or retype existing fields when introducing the proposed evidence records, action routes or new screens. Introduce explicit versions/adapters where a semantic change cannot be additive.
- Use canonical `severity` values `good`, `moderate`, `elevated`, `high`, `severe` and `no_data`; an unknown severity becomes `no_data`. Never use legacy `status` as a severity. Water's `water.status` remains a valid branch discriminator, and lead's `level` remains its documented severity field.
- Bind water sample dates through `*_iso` fields. Calendar dates, timestamps and local forecast times have distinct parsing/formatting rules. Preserve raw analyte values and units; do not translate codes, make a non-detect zero or use retrieval time as sample time.
- Format fractional district shares as percentages exactly once; Journal rates already expressed from 0 to 100 must not be multiplied again. Lithium display conversion from ppt to micrograms per litre is explicit and tested against its source units. Population counts remain complete, with unknown and incomplete coverage qualified rather than rounded into unsupported precision or exposure counts.
- A definitively invalid identity and an unavailable auth service have different recovery paths. A retryable 503 cannot create a new anonymous household. A 401 recovery cannot silently pretend old valuable records were restored. Recheck identity around writes and unknown outcomes.
- Daily refresh rate limits retain usable readings and show the returned cooldown honestly. History range clamps, Journal note/date/band constraints, full-replacement household writes and whole-record Journal upserts are tested against the actual current route, not only an old PDF example.
- Preserve private-well/spring, failed lookup, no match, no published data, excluded/unscoreable and usable measurement branches without collapsing all into no data. Coverage and score inclusion remain distinct.
- History exposes stored measurement basis and backfill metadata. Daily-peak modelled history is not silently plotted or analysed as equivalent to an instantaneous measured value. Incompatible periods are labelled, split or excluded under reviewed rules.
- Journal first-use detection uses authoritative all-time record presence, not absence in a 90-day range. Test a returning user with only older entries, pending onboarding backfill, partial history and retrospective retries over existing rich entries. Preserve or explicitly revise the 90-day regular-entry window, 12-week grid, seven recent entries and 62-date retrospective maximum.
- Map uses actual returned quarters and source versions, not a permanently hardcoded 2023 to 2025 list. An empty quarter list hides the unavailable timeline. District ratios retain their exact denominator and unknown population states.
- Keep earlier air-alert eligibility for the server-defined sensitive groups, with current policy fixtures and versioning. Existing weather coverage is flood/heat, not an implied active boil-water feed. New subscription/channel semantics must preserve or explicitly migrate existing preferences.

### Relevant action and synchronization acceptance

- Recommendation ranking is deterministic and explainable, with source freshness, applicability and current task state. No medical-risk ranking is delegated to unvalidated model output.
- Save from two different factor/category entrances resolves to the intended single canonical action unless a deliberate repeat is requested. Dismissal, already doing this and completion are different states and can be revised.
- An official notice, a severe measurement and an overdue task retain distinct meanings. Lack of measurement is not treated as a severe measurement or healthy reading.
- Every mutation invalidates the relevant dependent views described in the master plan. In particular, Journal edits recalculate applicable summaries, source corrections mark saved evidence for review, and event cancellations update linked Plan records without losing their history.
- File upload retry, abandonment and record deletion do not leave publicly readable or permanently orphaned attachments. Only authorized confirmed attachments become available in exports or selected Luna context.
- Current and new feature gates cannot expose a fixture fallback when a source, migration or provider configuration is absent. Incomplete features remain clearly unavailable in production rather than apparently functional mock screens.

## Accessibility and visual acceptance

- Test 320px and 375px mobile widths, typical larger phones, desktop, portrait and usable landscape. No horizontal page overflow or clipped controls at supported text settings.
- Verify light and dark appearances, higher contrast, full motion and system/device reduced motion. Current approved controls support 100%, 115%, 130% and 150% text sizes; an older PDF also mentions 175%. Do not claim support for that additional step until designed and tested. Also test browser zoom independently.
- Severity always has text and an icon or shape as well as color. A factor's brand tint must not be mistaken for its risk severity.
- Charts have labelled units, a short descriptive takeaway and accessible data. Missing periods remain gaps. Keyboard and touch inspection select the same record.
- Calendar grids provide meaningful dates, selected state, disabled future dates, arrow-key behavior and an equivalent list where needed.
- The interactive house exposes category names, selection and navigation without depending on recognizing a silhouette. Do not encode sensitive categories in public image descriptions or share previews by default.
- The stacked tip cards support visible previous/next controls and a scan-all route. Reduced motion shows the new front card immediately and keeps focus predictable.
- Map controls and lists support keyboard use, meaningful labels, zoom alternatives and visible focus. A failed canvas or map renderer does not destroy access to records.
- Primary and core interactive controls retain the original 44px minimum target requirement. Any intentional exception needs explicit accessibility review rather than quietly weakening the rule. Swiping, dragging, hovering and color cannot be the only way to act.
- Screen-reader live regions announce important results once, without rereading an entire dashboard or every animated number.
- Mobile keyboard and safe-area tests cover Luna, letter drafts, Journal, new records and bottom navigation. Send/Save must remain reachable on physical iPhone Safari.
- Ambient scenes pause when offscreen and under reduced motion. They do not announce actual local weather, particles, measured contamination or resident exposure.
- Prolonged nonessential motion can also be paused by the user; reduced-motion device preference is not the only control. Verify the complete processes against the WCAG 2.2 AA target, not just an automated color check.
- New screens reuse approved tokens, typography, spacing, logo, rounded navigation and restrained motion. They use task-appropriate layouts rather than putting every paragraph into another card.
- All app copy, notification bodies, source labels, exports and assistant rendering are scanned for prohibited em dashes without changing scientific meaning or required units.
- All new app-owned strings use the translation catalogue, including screen-reader text, validation, chart descriptions, empty states, print/export labels and notification templates. Reviewed Spanish must be complete for its advertised scope. Requested locale, served-source locale, page language, dates, number formatting and fallback labels agree.
- Audit and retain the approved mark across favicon/app-icon sizes, manifest and generic social metadata. No private household information enters metadata or a public share image. Device appearance theme-color and supported standalone display do not obscure navigation or keyboard controls.
- Browser installation and push are tested on their actual supported browser configurations. Service-worker updates do not strand users on an incompatible API client or cache private authenticated responses by default. Existing environmental caches do not count as proof of an offline app shell or successful background push.

### Performance and resilience budgets

Retain the original specification's frontend targets as measured release goals: first useful content under 1.5 seconds, reading an existing local cache under 200 milliseconds, an already-loaded tab transition under 100 milliseconds, and initial map rendering under 2 seconds on a declared representative test profile. Record device, network, cache and cold/warm conditions; these targets are not current performance claims or guarantees under every network. Backend request-latency and source-refresh budgets in the backend plan are separate measurements.

Load the map renderer and heavy assets only when needed. Bound list/history payloads, pause offscreen scenes, avoid layout movement during pending actions, and measure memory after repeated sheet/route navigation. A slow optional source cannot block unrelated useful content. Retry limits, offline reconnection, provider quota exhaustion and a failed background job must preserve honest state rather than spin indefinitely.

## Privacy and safety acceptance

- Collect a field only when its use is explained. New Food & Garden interests, household equipment and observation records do not lengthen mandatory onboarding.
- Existing approximate location, household categories and symptom records remain private. No new feature silently changes the promise that names, birthdates and raw street addresses are not required or routinely stored.
- Optional files, free text and photos may contain identifying information. Document retention, restricted access, metadata handling and export/deletion before allowing uploads.
- Reconcile privacy notices with optional lab documents, fish notes, garden records, outreach and field images. Do not retain an absolute claim that the app never stores medical or identifying material once users can deliberately upload it. Onboarding address disposal and voluntary document contents are different data flows.
- Disclose anonymous-session loss and actual recovery options before the first valuable upload, not only afterward. Continue-anonymously remains available without implying that browser storage can be recovered after it is cleared.
- Shared household recovery or device linking, if selected, includes expiring credentials, revocation, rate limits, ownership checks and no guessable household lookup. It is not implemented by placing a session token in a URL.
- Luna's privacy indicator reflects actual data sent, not only whether an answer happened to cite household data. Household context, transcript retention and third-party processing need separately testable controls.
- Refusal and source checks cover diagnosis/treatment prompts, false citations, malicious instructions embedded in retrieved sources, and requests for another household's data. No-source is a valid answer.
- Official advisories are quoted or summarized within source permissions and kept separate from HALO interpretation. Legal status, certification claims, health thresholds and audience-specific advice require current authoritative review.
- Expanded health-related interpretations and public Luna/product claims receive qualified review before release. A disclaimer is not evidence of regulatory exemption or clinical validation. Do not claim HALO is the first or only app without a separately supportable basis.
- Alerts do not claim continuous monitoring or emergency coverage when a source is refreshed periodically. The app explains refresh cadence and provides official emergency channels where relevant.
- Export previews disclose all selected content. Photo metadata and exact observation coordinates are stripped or deliberately retained only after explicit informed choice. Default export must not reveal exact home location or symptom notes.
- A field observation is not a diagnosis of pollution and is not an official complaint. Clicking an agency link is not a completed submission. HALO does not publish private observations to a community map.
- Clear Journal removes associated findings and derived private caches. Delete everything includes all newly introduced records, files, reminder jobs, subscriptions and recoverable server relationships under an explicit retention policy.
- No analytics that capture household health, location, notes or behavior are introduced silently. Existing no-behavioral-analytics expectations must be honored unless explicitly reconsidered with clear consent and review.

## Connected journey acceptance

Each journey must pass with real supported data in a separate test environment, then with controlled fixtures for adverse states. Success means the user understands and completes the action, not that every screen rendered.

### Utility result to household follow up

1. Open H02 from H01 and identify the utility, source date and selected compound.
2. Inspect the same record through Learn and Map without changing its units or legal status.
3. Choose a feasible renter/owner action and save one P02 record.
4. Generate A05 for the chosen recipient with an evidence preview; retain independent recipient edits.
5. Schedule follow-up in P01, then include only selected evidence in H08.
6. Receive a meaningful new-source notice, review the saved action and keep the original reason available.

Pass conditions: no false address-level water claim, no duplicate action, no invented legal exceedance, no automatic sending, no score improvement from completion. Repeat with no result, a benchmark-only result, a failed lookup and outdated evidence.

### Private water and garden testing

1. Onboard a well household with unknown construction year.
2. Open the testing plan rather than a fabricated water score.
3. Add optional garden water context and choose an appropriate reviewed testing/resource path.
4. Save a test, record sample dates, mark awaiting result and later confirm result values and qualifiers.
5. View result alongside, not substituted for, regional evidence; choose a reviewed next step.
6. Update reminders without claiming that a missing or non-detect result proves all water or produce is safe.

Pass conditions: pending is not negative, reported units and limits survive round trips, private uploads remain private, information about the water sample does not become a crop measurement.

### Daily conditions to outdoor planning

1. Open Today, inspect a factor's real data and forecast scope.
2. Compare available times using P03 without filling missing hours.
3. Save a user-chosen activity and one appropriate action.
4. Receive a chosen update only when the applicable forecast or official notice changes meaningfully.
5. Optionally log how the day felt and inspect the day's evidence in P05.

Pass conditions: no promised safe period, no assumption the activity happened, no causal health conclusion, and the full flow remains useful without a Journal entry.

### Fish advisory to conservation participation

1. Select a waterbody and species, then the applicable official advisory audience.
2. Inspect the advisory geography on Map and its source/version.
3. Follow the advisory and save any chosen guidance.
4. Find a relevant organization and a genuine opportunity with current details.
5. Save the opportunity, register externally, then explicitly confirm registration or attendance if desired.

Pass conditions: household age groups do not misclassify advice, saving is not registration, cancelled events update, and participation is not described as removing a specific contaminant.

### Private observation to official handoff

1. Record a factual observation, optional approximate location and optional photo.
2. Inspect what metadata will be kept and shared.
3. Export selected content and open the appropriate official reporting channel.
4. Optionally mark an external report submitted and set a follow-up.

Pass conditions: the record remains private, no automatic accusation/report occurs, no precise hidden metadata leaks, the official channel is verified, and a link click never changes status to submitted.

### Long term records and privacy

1. Save Journal entries, tests, plans, equipment and an observation using a disposable household.
2. Change household categories and home location; confirm current guidance refreshes while history retains the correct original context.
3. Export selected data and verify it has the intended fields only.
4. Clear Journal and verify unrelated home records remain.
5. Delete everything and verify server rows, private attachments, push subscription handling, queued jobs, local caches and session cleanup.

Pass conditions: no cross-household access, no history silently relabelled as belonging to a new address, no unknown result presented as deletion success. Never run this journey against the configured shared production project.

## Test fixtures and monitoring proof

The fixture library must include normal, real-zero, non-detect, missing, partial, stale, excluded, failed, unsupported-region, identity-change and malformed-response cases. New feature fixtures include cancelled events, withdrawn advisories, amended test reports, mismatched units, duplicate saves, changed source versions, local date boundaries, daylight-saving changes, abandoned uploads and unknown mutation outcomes.

Source ingestion acceptance requires more than displaying a sample record:

1. Prove access, permission, source terms, geographic matching and required fields on representative records.
2. Run the proposed refresh schedule in a test environment and measure actual update latency and failures.
3. Validate record deduplication, amended/superseded versions and out-of-order updates.
4. Simulate source outage, schema change, implausible units and empty response. Keep the last good dataset with an honest status instead of replacing it with empty healthy conditions.
5. Prove a genuine source change creates the intended single update, reaches an opted-in household, and deep-links to the exact revised evidence.
6. Confirm recovery does not flood the inbox with duplicate historical alerts.

Do not claim that a feature monitors real things until this sequence works against the actual authorized source. Manual review workflows must show their true review cadence and cannot be labelled live.

## Release gates

| Gate | Required evidence before advancing |
| --- | --- |
| Product scope | The full preservation matrix and proposed additions are reviewed; unresolved decisions are visible; no capability silently vanishes during navigation changes. |
| Source feasibility | Every promised monitored source has a demonstrated access path, useful coverage, rights/terms review, update expectation and honest fallback. |
| Backend contract | Versioned payloads, units, status vocabulary, ownership, mutation idempotency, deletion and source metadata are agreed. No placeholder field is marketed as live. |
| Wireframe review | Final-looking mock screens cover normal and adverse states plus connected flows. Yogi reviews new arrangements and refines them before approval. |
| Visual preservation | Explicit approval creates a new immutable archive; old archives remain unchanged. Source, copy, assets, state inventory and both appearances at narrow widths are preserved. |
| Implementation | Approved geometry is reused with live adapters. Unit/contract tests, typecheck, lint, build and isolated interaction tests pass; no fixture data leaks into live routes. |
| Integration | Real source and deployed API behavior is checked with a separate backend or disposable identity, including authentication, quotas, cancellation, refresh and mutation outcomes. |
| Accessibility and devices | Physical mobile Safari and a second browser are checked for focus, keyboard, charts, calendar, large text, offline behavior and native sharing/printing. |
| Privacy and safety | Cross-household authorization, file access, Luna provider/configuration behavior, deletion and adversarial-source tests pass; copy matches actual processing. |
| User validation | Representative users can interpret evidence and complete the connected tasks without assistance; misunderstandings are recorded and corrected. Preference for a visual alone is not task validation. |
| Operations | Source freshness, content review, failures, quotas, backups, job retries and rollback have explicit owners and observable behavior. |
| Handoff | Known gaps and completed gates are documented accurately; branch/PR preserves attribution and source; Vibhav has integration contracts and reproduction commands. |

Historical test counts in the approved-stage handoff establish only that stage's recorded fixture checks. They do not prove the new full app, the current deployment, source reliability, physical-device behavior or live model safety.

## Food evidence refinement acceptance, October 3

- Custom names can be saved when the catalogue has no match, edited, moved between storage areas and removed with confirmation. A food group only selects guidance; it never silently maps a custom item to a study.
- Catalogue and kitchen cards use illustrated food icons only. Add/detail pages show no actual food photos, photo placeholders or photo credits. Photo endpoints are never requested by these views. This supersedes the earlier photographed-food direction.
- PFAS and lead study coverage remains separate from the item's unknown level. Historical sample count, original unit, compound, period, analytical limit and source locator remain readable. Non-detect is not zero; a reporting limit is not a safety threshold.
- Narrow and large-text views must keep contaminant tabs stacked, statistics and provenance readable, and all controls reachable. Expanding optional fields does not create a hidden invalid-control trap.
- Only actually recorded timeline facts receive checkmarks. Blue Luna runs with both arms carrying the stack, top sheets bounce, and completed checks are unobscured. Reduced motion immediately exposes final progress. Adding earlier facts requires an explicit editor save.
- Garden Edit and Export remain accessible as utilities; deletion is confirmed separately. Test links have a focused editor, retain original report context and enforce revision/error behavior.
- Wider catalogue/product lookup, source ingestion, owned food-sample reports and evidence updates require the additional release gates in [Food evidence and kitchen integration](HALO_FOOD_EVIDENCE_EXTENSION.md). Preview behavior is not proof those integrations exist.

## Source reconciliation notes

- [Specification](../foundation/reference/HALO_Frontend_Specification_2026-09-29.pdf), B1 to B7 and C1 to C3: retained functional depth. Assignment and old visual instructions are superseded where the current workflow or user decisions differ.
- [Approved-stage handoff](../foundation/STAGE_FRONTEND_HANDOFF.md): currently delivered routes, API seams, live missing-data behavior, explicit Settings saves, source dates, assistant privacy gap and acceptance limits.
- [Map review](../map/README.md): complete unapproved interaction inventory, named failure states, district corrections, density semantics and prototype/live separation.
- [Journal route](../../app/api/journal/route.js): date/group upsert replaces the whole record. The new planning work must not accidentally erase omitted fields.
- [Journal analysis](../../lib/journalAnalysis.js): current comparisons use environmental-history days and logged symptom dates. Future wellness comparisons must explicitly resolve unlogged versus felt-fine denominators and the treatment of retrospective entries.
- [Account deletion](../../app/api/account/route.js), [notification preferences](../../app/api/notifications/route.js), and [push subscription](../../app/api/push/subscribe/route.js): existing operations need complete coverage when new records, files, subscriptions and jobs are introduced.

Final open decisions are the fourth-tab label/order, reviewed wireframes for new surfaces, which newly feasible sources can support launch promises, optional recovery/device linking, optional private upload handling, the daily factor score methodology, and any explicit expansion of the current privacy model. These are decisions to resolve, not hidden reasons to discard the planned features.
