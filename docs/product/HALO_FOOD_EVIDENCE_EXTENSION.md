# HALO food evidence and kitchen integration

Latest visual decision, October 3: Yogi removed all actual food photographs. Catalogue and kitchen cards use illustrated icons; add/detail pages have no portrait, photo placeholder or attribution panel. This supersedes photo-display requirements and photo-specific release gates below. Product photo acquisition/delivery is not required for the current food UI; retained image-provider notes are historical options, not active work. Food identity, custom entry, chemical evidence, inventory and Plan requirements remain unchanged.

October 3, 2026. Addendum to F01, F04, H06 and P01/P02 for Yogi and Vibhav. This extends the existing plans, not the backend implementation. The review now demonstrates real, source-linked study findings alongside the user's food inventory. Wider catalogue search, branded-product photos, current notices and private laboratory matching remain integration work.

The product is an evidence-aware kitchen, not a nutrient tracker or a chemical scanner. A household can add any food, inspect what credible sources actually tested, keep product or growing-site context, and save a specific next step to Plan. A food name, image or barcode cannot reveal the current contents of the user's package. Published statistics add real depth while remaining separate from a household measurement.

## Four evidence levels

| Level | Frontend presentation | What it can support |
| --- | --- | --- |
| General guidance | Short PFAS and lead explanations, relevant official links | Pathways and questions, not a concentration |
| Published food study | Original tested food/preparation, compound, statistics, sample period and source | Findings in the sampled foods, not the current inventory item or a personal dose |
| Potentially applicable notice | Product, brand, package/lot, dates, current official status and a compare-details step | Source instructions only after their actual scope is established; no invented concentration |
| Owned matching food-sample report | Private sample identity, original analyte/value/unit/qualifier, lab/method, collection date and review state | The reported result for that sample. User transcription is not independent laboratory verification |

Keep the inventory item's chemical level `unknown` unless the fourth level, or an explicitly reviewed exact product/lot measurement, supports it. A historical study card can have numbers while the item still says unmeasured. No-match, unavailable, unsupported food form, below detection, stale notice and withdrawal are distinct states. A missing result is never zero or a safety clearance.

## User flow

1. Search ordinary food names and aliases. Show a compact result list, then the selected food's detail view. A catalogue group is a discovery aid, not a chemical category score.
2. Offer Add my own food whenever a name is missing. Only a readable name and storage section are needed to save. Group, origin, brand, barcode, package size, lot and question can be optional or requested later for a concrete evidence match. Do not block saving while a photo or study is unavailable.
3. Open the food to see an actual identity-matched photo when available, or a clearly labeled illustration/no-photo fallback. Keep source attribution accessible. The picture is never chemical evidence.
4. Show PFAS and lead indicators, with study availability separate from the user's level. The selected food automatically resolves reviewed evidence by stable identity; it does not copy a study value into the private food record.
5. Put a concise published finding and its two most useful statistics above an expandable source/method/sample section. A source link and an actionable question are more useful than many colored badges. Preserve the original units and period. A detection percentage is a percentage of those study samples, not the probability that this household's food is contaminated.
6. Let a user attach an authorized food-matrix test, compare a notice with their package, retain a growing-site question, or deliberately save one follow-up to Plan. Adding food alone does not create tasks. Later edit/remove affects the inventory, not scores or public evidence. Retain the existing linked-action snapshot and removal policy.

A barcode lookup and optional package-photo transcription can streamline entry. Both require user confirmation of product identity and a manual alternative. Photo recognition may suggest a label but must not infer analyte levels, exact lot, brand or ingredients from an ambiguous picture. Household photos are private by default and must never be automatically contributed to a public food database.

## Verified initial study records

The four readonly examples are implemented in `lib/frontend/food-evidence.ts`. Original tables were checked, including visual table-column verification. They are a small curated subset, not comprehensive coverage or a live feed. Review date means HALO checked the source, not that samples were collected recently.

| Catalogue match | Chemical and findings | Scope and original locator |
| --- | --- | --- |
| Tuna and canned tuna | PFOS detected in 5 of 10 samples; detected values 50 to 195 ppt (ng/kg); other five below a 39 ng/kg method detection limit | FDA 2022 seafood survey, retail sampling 2021-2022, PDF page 1, tuna 1-1 through 1-10 |
| Salmon | PFDoA detected in 8 of 10 samples; detected values 20 to 45 ppt (ng/kg); other two below a 16 ng/kg method detection limit | Same survey, PDF page 2, farmed Atlantic salmon 1-1 through 1-10, Chile/Norway/Canada origins |
| Milk | Lead reported not detected in all 27 fluid whole-milk samples; reporting limit 1 ppb | FDA FY2018-FY2020 TDS supplement, PDF page 1, food 1, Lead Pb row |
| Spinach | Lead detected in 21 of 27 raw-spinach samples; six not detected; maximum 18 ppb; reporting limit 4 ppb | Same TDS supplement, PDF pages 55-56, food 408, Lead Pb row |

The seafood counts/ranges are HALO summaries of the published rows, not national prevalence estimates. Each PFAS compound stays named; these are not total PFAS. TDS samples are composites. No means are displayed here, avoiding concealed nondetect substitution. A reporting/detection limit is an analytical boundary, not a safe concentration. Wet/dry bases are not invented or converted. These historical findings are not active recalls.

Sources: [FDA seafood analytical table](https://www.fda.gov/media/159570/download), [FDA TDS analytical supplement](https://www.fda.gov/media/159751/download), [FDA TDS study design and methods report](https://www.fda.gov/media/159745/download). The TDS report defines mass-fraction units and documents EAM 4.7 ICP-MS for lead in foods; the seafood table documents instrument-specific detection limits.

## Backend acquisition paths

These are proposed acquisition paths, not assertions that APIs have been wired. Recheck provider documentation, terms and representative fixtures before release. Do not scrape an undocumented dashboard endpoint as a permanent contract.

| Purpose | Primary source | Acquisition and boundary |
| --- | --- | --- |
| More common food names | [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/) | Search/details and downloadable data can support stable external food IDs, descriptions, aliases and food forms. Server-side API key, cache and bounded requests. It is primarily a nutrient dataset, not a PFAS/lead assay service. USDA documents CC0 data and requests attribution. |
| Product identity and photos | [Open Food Facts API documentation](https://openfoodfacts.github.io/openfoodfacts-server/api/) | Optional barcode product lookup and selected product images. Treat community data as unverified identity suggestions. Confirm locale/product/package and handle missing images. Follow the documented supported API version, current quotas and required app identification; do not send one remote search per keystroke. Database ODbL and image CC BY-SA obligations require review, including attribution and rights in pictured packaging. Keep this provider separable from the owned inventory and official evidence catalogue. |
| PFAS food findings | [FDA PFAS testing and dietary exposure](https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure) | Reviewed imports of actual linked analytical tables and subsequent revisions. Retain compound/matrix/sample identity. FDA describes limited TDS collections and targeted seafood sampling, not a universal local-food estimator. Current source also describes follow-up clam work and additional bivalve data under review; unpublished results must not be filled in. |
| Lead food statistics | [FDA TDS results](https://www.fda.gov/food/fda-total-diet-study-tds/fda-total-diet-study-tds-results) | Use official download/dashboard exports and their data keys. At this review, the results page describes dashboard collections through 2022 and downloadable FY2018-FY2020 tables. Broader reviewed imports can add many food forms. Respect composite sampling, preparation, regional/national design and reporting limits. Never label an old sample with today's collection date. |
| Additional food lead evidence | [FDA Closer to Zero data](https://www.fda.gov/food/environmental-contaminants-food/closer-zero-reducing-childhood-exposure-contaminants-foods) | Official targeted food/juice/baby-food datasets supplement TDS. Keep targeted sampling separate from representative surveys. Preserve the intended food/audience scope, without deriving personalized intake advice. |
| Product notices | [openFDA food enforcement](https://open.fda.gov/apis/food/enforcement/) and linked FDA/state notices | Existing S14 plan applies: recall/event IDs, product/lot, distribution, reason, lifecycle and original dates. A terminated recall is not a current alert. Keyword matching is a discovery step, not complete coverage or a confirmed product match. A notice may contain no measured value. |
| Self-caught fish | Existing reviewed state fish-advisory pipeline S13 | Match actual waterbody extent, species, source-defined audience and rule revision. Preserve all official contaminants here; the PFAS/lead-only inventory does not truncate a fish advisory. |
| Household food sample | Existing private test/report workflow, extended deliberately to food matrix if unsupported | Confirm backend accepts food/tissue matrix, preparation and wet/dry basis. Do not relabel water/soil results as food. Retain original file, transcription and review status independently. Normal ownership, consent, retention and deletion rules apply. |

## Proposed data contract

Reuse the existing evidence/action architecture. Proposed names below describe responsibilities, not already-shipped endpoints or tables.

**Food identity** needs internal catalogue ID, version, ordinary label, aliases, parent food, species/variety and preparation where meaningful, locale, optional provider ID, barcode and product/package details. Household overrides do not overwrite the public catalogue. Exact identity confirmation is separate from a fuzzy discovery suggestion.

**Images** need source URL or approved cached asset, stable external food/product identity, selected image revision, alternative text, width/height, rights/licence, creator/provider attribution, original source link, retrieval date and whether it depicts the exact package or a representative food. Use an allowlisted image delivery pipeline with content-type/size validation and an accessible failure state. Do not use generative imagery as product-identification evidence. Generic illustrations remain labeled illustrations.

**Study and sample evidence** needs issuer, canonical source ID/URL, source publication/revision, source-file hash, review state and reviewer, collection period, food ID and exact original description, preparation, sample ID, sample/composite count, sampling design, geography/origin, matrix and basis. Analytical rows retain analyte identity, original value text, parsed value only if valid, original unit, qualifier, limit value/type, method and exclusions. Aggregates retain their included sample IDs, count, detects/nondetects, aggregation version and nondetect treatment. Do not mix ng/kg food mass with ng/L water volume, PFAS compounds with total PFAS, or different wet/dry bases.

**Evidence match response** needs inventory identity/revision, coverage per contaminant, matched evidence IDs/revisions, matching level, reason, missing identity fields, original sample dates, stale/withdrawn state, source links and limitations. Return item-level `unknown` separately from the studies array. Numeric fields are not present merely because the food name matches a study. Product/lot or owned-sample claims require an explicit reviewed match and scope.

Suggested interfaces are catalogue search/detail, optional barcode lookup, owned inventory CRUD, evidence-by-food, notice applicability, link-owned-test and saved evidence-watch/action. Use bounded pagination and explicit empty/loading/stale/error/unsupported states. Integrate with existing server authentication, ownership/RLS, revision conflicts, idempotent retries, limits and audit coverage. A shared household read must follow the existing member authorization, not URL possession. Provider keys and private identifiers never reach public preview builds.

## What an evidence based estimate can mean

Ship published study statistics first. Calling a sampled range a result in this package is not justified. Calling a national average a current local estimate requires a separate validated model and is not an automatic backend improvement.

A future model would need a clearly defined target quantity, matching commodity/species/form/region/time, adequate representative samples, detection-limit treatment, uncertainty intervals, external validation and qualified scientific review. It must expose version/assumptions and abstain when input scope is unsupported. Barcode, nutritional facts, photo, storage location, water score, farm proximity and ingredient order are not sufficient chemical predictors. Do not derive a personal dose, meal allowance or medical safety decision from the kitchen inventory. No such estimator is implemented or approved by this addendum.

HALO can truthfully track changing evidence and user actions now: a saved notice revision, a selected follow-up, a reported sample, a current missing detail, and the difference between an unmeasured item and a published food finding. A user can subscribe to reviewed evidence changes once the existing watch contract is implemented. Do not claim continuous chemistry monitoring.

## Release checks

- Source extraction must be compared with original table columns, units, qualifiers, sample counts and dates. Preserve original files/revisions under the source retention policy. Review amended tables without silently rewriting an old household export.
- Catalogue coverage and evidence coverage are reported separately. Unmatched/custom foods still save. Milk studies cannot attach to plant drinks or infant formula; raw spinach cannot become a spinach-pie measurement; broad seafood guidance cannot become a fish sample result.
- Display all sample denominators with percentages/ranges. Nondetect stays nondetect, missing stays unknown. Never use laboratory reporting limits as risk bands. No colour-coded safe/unsafe grade or HALO score mutation.
- Test matched and unmatched photos, slow providers, missing imagery, wrong barcode, ambiguous package/lot, inactive notice, stale evidence and denied private-test access. Deleting an item must clean private data while preserving an understandable linked Plan action history under the chosen policy.
- Test no public provider writes, no accidental photo publication, no secret keys in browser/static source and no private data in URLs. Test the empty, offline, error and retry flows without substituting fake chemical values.
- Keyboard, touch, 320px width, large text, light/dark and reduced motion must keep food details readable. Every important source and limitation remains available without hover. Luna remains accessible without discarding the form draft.

This addendum supplements [Frontend Build Plan](HALO_FRONTEND_BUILD_PLAN.md), [Backend and Data Plan](HALO_BACKEND_AND_DATA_PLAN.md), [Source Acquisition Guide](HALO_SOURCE_ACQUISITION_GUIDE.md) and [Feature Acceptance](HALO_FEATURE_ACCEPTANCE.md). It does not replace already-delivered backend handoff files or imply that newly proposed integrations are complete.
