# HALO frontend depth review

September 30, 2026. These are recommendations and editable design proposals, not an approved baseline. The scope is frontend only, using the existing backend. No backend features, schema changes, new scoring model, or production account writes are proposed here.

## Main conclusion

HALO already has more analytical capability than the current preview exposes. The opportunity is to make that capability understandable and useful. Each page should connect a specific question to evidence, a practical choice, and a next step. Extra scores, paragraphs, and animations do not by themselves create depth.

The current preview contains developed Personal Hero and factor views, while Map, Journal, Act, and Settings are still foundation demonstrations. The recommendations below distinguish later page work from this visual revision.

## What was reviewed

The review used the two supplied videos, their exported automatic transcripts, sampled demo screenshots, official winner profiles, the updated HALO specification's feature sections, and relevant local backend contracts. The competitors' live applications and source code were not independently audited. Narrated performance, AI, and scale claims remain creator claims. Exact content inventories for unshown screens cannot be verified from a short demo.

### Mazah

The demo presents preference onboarding, food inventory, receipt and manual entry, expiry awareness, daily meal planning, ingredient-based recipes, environmental impact information, and food-bank discovery. The inspected inventory screen around 1:29 uses storage groups and compact rows of name, quantity, and expiry. Around 2:23, the planner pairs a date selector with expandable impact information, two headline measures, a reuse bar, and ingredient chips. This is useful density: each field supports the task. [Demo](https://www.youtube.com/watch?v=d6Hnww_djtw)

The official profile connects the idea to food redistribution experience. The demo attributes onboarding questions to research into household waste. These are planning accounts, not access to an unpublished roadmap. The design lesson for HALO is my inference: keep one consistent visual language while varying the information structure for each task. Do not copy its exact palette or reproduce unverified impact calculations. [Official winner profile](https://www.congressionalappchallenge.us/25-NC08/)

### Relink

The demo connects employment support, location recommendations, and an AI counselor. The inspected job flow around 1:16 asks for experience, skills, preferences, and a resume. The location flow around 1:52 to 1:57 makes the map dominant, followed by a recommendation and reasons; loading/source information is visible. Some technical explanation is presentation material, not actual page UI. Model accuracy, bias resistance, safety, partnerships, and scale were not independently verified. [Demo](https://www.youtube.com/watch?v=dgnUpziLaU8)

The official creator account describes reentry volunteering, an initial resource-document idea, and an evolution toward location and guidance support over seven months. My inference for HALO: show why an output applies, identify the data supporting it, and provide a relevant next step. Do not copy high-stakes prediction claims or add new models. [Official winner profile](https://www.congressionalappchallenge.us/25-ca16/)

### Other relevant winners

- Vision of Grove, 2024 CA-28: the official announcement describes satellite-based mangrove-loss and community-vulnerability analysis for protective decisions. Exact page layouts were not inspected. The transferable frontend pattern is map, selected location, evidence, limitations, then action. HALO can use its existing map responses without adding satellite analysis. [Representative Chu's announcement](https://chu.house.gov/media-center/press-releases/rep-chu-announces-winners-2024-congressional-app-challenge)
- 'Iwa, 2025 HI-02: the official profile describes mapping and drone imagery for marine-debris identification. Exact screen layouts were not inspected. The transferable pattern is a clearly identified observation with location, provenance, and response. For HALO, distinguish monitoring stations, utility service areas, county estimates, and actual property information. [Official winner profile](https://www.congressionalappchallenge.us/25-HI02/)
- Hawai'iAlert.jp, 2025 HI-01: the official announcement describes bilingual disaster information using official NWS information and LINE delivery, with source and timestamp. Translation accuracy and full screen structure were not independently verified. The transferable frontend pattern is to place trust information beside the claim, not behind a distant About page. No new alert or translation pipeline is proposed. [Representative Case's announcement](https://case.house.gov/news/documentsingle.aspx?DocumentID=4804)

## Frontend recommendations by page

### Personal Hero

1. Lead with the existing daily takeaway, actual retrieval time, and what needs attention. Keep missing inputs and estimated inputs visible beside the score.
2. Explain contributions in plain language. Keep the score and raw environmental units distinct: higher HALO scores are better, while lower AQI means less pollution.
3. Give each factor its own explanatory shape. Air: dominant pollutant and available history. UV: returned protection window, not an invented hourly curve. Pollen: tree, grass, and weed comparisons. Mold: weather conditions and the indoor-measurement limitation.
4. Show PFAS as a separately dated water insight using Homeguard data. A fresh app retrieval must not make an old utility sample look current.
5. Place Learn's contextual explanation beside the chart or value it explains; put practical guidance near the next action, and sources near factual claims.
6. Provide deep links, accessible chart tables, missing-data gaps, reduced motion, clear retry states, and retained readings when refresh fails.

Existing support: `/api/daily-score`, `/api/history`, `/api/learn`, and `/api/home-guard` for water. See `lib/dailyPayload.js` and `lib/frontend/factor-preview.ts`.

Important boundary: the existing daily total includes air, UV, pollen, and mold. It does not supply a PFAS-inclusive daily total or direct per-factor display scores. The current review ring and factor scores are explicitly illustrative design proposals. Under this frontend-only scope, live integration must retain the server's daily score and show water separately, not create a new composite or ask for backend expansion.

### Personal Hero family page

1. Show which existing household categories the guidance considers, rather than creating named people or profiles.
2. Combine current factor context, one applicable household note per topic, and practical guidance. Allow a simple Outdoors or At home filter.
3. Use the existing UV window for an understandable daily planning visual. Do not call it the safest time across all environmental factors.
4. Show the reading and its date with each explanation. Missing readings keep general education available but cannot support a current interpretation.
5. Offer a small visit-only checklist with explicit reset behavior. Checking an item is not evidence of reduced exposure and never changes a score.
6. Connect to Journal when its full page is built. Household findings must not be relabeled as individual medical predictions.

Existing support: profile household fields and Learn content. The seven booleans are toddler, child, teen, adult, senior, pregnancy, and respiratory condition. They change wording and action ordering, not measurements, severity, or scores. Learn returns one highest-priority applicable note per topic, not a person-by-factor risk matrix. See `lib/household.js` and `app/api/learn/route.js`.

A later Homeguard family view should focus on water, radon, plumbing, and the existing household action plan, rather than duplicate daily outdoor guidance.

### Homeguard

1. Organize the page around the building: water supply, ground/foundation, and plumbing. An interactive house visual can route to the existing details.
2. Display the assessment's basis together: source water type, utility, build year, dates, coverage, confidence, and measured versus estimated evidence.
3. Use compound-specific threshold bars and actual sample dates. Distinguish enforceable limits, health benchmarks, unregulated detections, and results excluded from scoring. Lithium remains shown but not scored.
4. Make the private-well or spring branch a useful testing plan, with the existing reason, cadence, provider guidance, and cost fields rather than an empty score screen.
5. Surface the existing ranked action plan with renter/owner wording, costs, and relevant certification details.
6. Keep county radon potential separate from a home test. Keep building-era lead estimates and utility-wide service-line information separate from address-level facts.

Existing support: `/api/home-guard` fields including water results, coverage, test plan, action plan, score breakdown, lead inventory, and assembly time. No home sensor or new risk engine is needed.

### Map

1. Give Water, Radon, Facilities, and Air distinct but consistent layer controls and legends.
2. Add the existing contaminant selection, quarterly sample sequence, and clearly different Latest position.
3. Make selected-location details useful: what the marker represents, reading, date, source, missing information, and a contextual factor link.
4. Show the household utility without implying an actual tap sample or a contamination plume.
5. Expose existing district/state comparison and county ranking with explicit denominators. Distinguish unlocated systems from absent data and real zero values.
6. Preserve mobile map area, keyboard controls, layer-specific errors, cached views, deep links, and a text alternative if rendering fails.

Existing support: `/api/map` and `/api/district`. Facilities cover a selected regional set, not every nearby source. Missing markers or compound values must not imply safety, no testing, or spreading contamination.

### Journal

1. Make the existing retrospective calendar an approachable first-use flow, without requiring weeks of new logging before the person sees value.
2. Make daily entry fast: Felt fine, group, symptoms, severity, optional note, and possible illness.
3. Put symptom markers on the existing 12-week environmental history and let a day reveal its actual readings and entries.
4. Explain findings with the returned statement, comparison counts, and paired rates. Separate enough-reading-days progress from enough-comparable-symptom-days progress.
5. Give equal care to no clear pattern, insufficient data, illness exclusions, and missing readings. Do not turn associations into causal conclusions.
6. Surface existing seasonal summaries and reliable edit/delete/undo flows.

Existing support: `/api/journal`, `/api/history`, `/api/journal/retrospective`, `/api/journal/findings`, and `/api/journal/summary`. Current findings are household-level, not person-specific analytics.

### Act

1. Connect recommendations to the finding that motivated them.
2. Make organization discovery usable by cause and service area. Preserve an unknown verification date as Not yet verified.
3. Present utility, landlord, and representative letter drafts alongside the cited measurement. Allow editing, recipient-specific edit retention, copy/share, and an honest unavailable state.
4. Make the existing home-health-card concept useful for print/share, including source dates, missing values, and top actions or well tests.
5. Connect personal evidence to the existing district context without inventing recipient lookup or automatically sending messages.

Existing support: current organization, letter, Homeguard, district, and profile contracts. These are frontend workflows, not new delivery services.

### Settings and shared trust features

1. Show stored household categories back to the user and explain what correcting them changes. Submit complete household updates through the existing contract.
2. Preview text-size, contrast, and motion changes accessibly. Keep product appearance aligned with device preference; the wireframe's appearance selector is a review tool.
3. Make source dates, estimated values, stale data, unavailable data, and privacy boundaries consistent across pages.
4. In Alerts, explain what changed and link to the relevant factor. Opening the inbox must not mark every alert read; failed optimistic changes must recover.
5. Keep the assistant visually restrained. Its full later flow should distinguish source-grounded answers, unsupported requests, unavailable service, and refusal states. Do not assert unverified guarantees about what information is sent to a model.
6. Keep approved onboarding untouched and preserve its logo, handwriting, typography, and no-em-dash rule.

## Visual direction in this revision

Use restrained painted-realism environments with HALO's marine blue and teal base. Keep warm UV, botanical pollen/mold, cool water, and subtle architectural earth accents local to their factors. The generated set remains near the realistic end of that range, with a softened presentation rather than a cartoon treatment.

Use distinct Air, UV, Pollen, Mold, PFAS, Personal Hero, Home/Radon, and Lead assets. Mushrooms are atmospheric decoration, not a depiction of indoor mold. Water color and floating particles do not encode measured contamination. A cross-section is conceptual, not a survey of the user's home.

Blend scenery into the reading surface with a gradient, a small overlapping navigation or summary, and a faint continuing background texture. Keep data readable on calm surfaces. Use short contextual disclosures instead of repeating identical large educational cards. Preserve meaningful animation with a pause control, reduced-motion support, and offscreen/background-tab pauses.

The imagegen skill supplied eight original bitmap assets through the built-in tool. Their exact prompts and file mappings are recorded in `public/preview-scenes/editorial-prompts.json`; optimized project assets end in `-editorial.webp`. Existing assets remain available, and no approved design archive was replaced.

## Implementation scope and next order

This revision implements the factor-specific scenes, shared visual integration, smaller assistant control, factor education disclosures, in-page navigation, and Personal Hero family preview. It does not claim to implement the full later Map, Journal, Act, Homeguard action-plan, or Settings workflows described above.

The PFAS preview's practical steps now use more precise frontend copy about model-specific certification, maintenance, and utility results. This avoids repeating unsupported blanket claims about bottled water or implying that a generic certification guarantees PFAS removal. The shared backend Learn content was not changed. [EPA filter guidance](https://www.epa.gov/water-research/identifying-drinking-water-filters-certified-reduce-pfas)

Recommended sequence after visual review: finish the current factor/family composition, expose Homeguard's existing depth, build Journal, build the full Map exploration flow, then complete Act. Finish each stage's accessibility, trust information, and failure states alongside that stage rather than leaving them for the end.

These remain editable mock wireframes. Production adapters, real account changes, external messages, and backend changes are outside this revision. No new backend work is required by these recommendations.
