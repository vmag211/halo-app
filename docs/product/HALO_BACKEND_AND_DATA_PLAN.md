# HALO Backend and Data Plan

This document defines the proposed backend and data target for HALO's full product plan. It is written for Yogi and Vibhav so each interface has a credible source, a complete action workflow, and an explicit implementation boundary. It complements the [HALO Master Plan](HALO_MASTER_PLAN.md), [Frontend Build Plan](HALO_FRONTEND_BUILD_PLAN.md), and [HALO Feature Acceptance](HALO_FEATURE_ACCEPTANCE.md).

Version 1.2, October 3, 2026. This is the proposed full-app backend target and implementation specification, not implemented functionality, verified deployment readiness, or approval of new visuals. Existing capability statements below describe inspected repository code, not an assertion that every provider, migration, credential, or scheduled job is configured in production. No existing feature is removed by this plan. Endpoint and table names introduced here are proposals; implementation may consolidate them without losing their behavior. The route inventory and hardening list make explicit what can be reused and what must change before the richer product can depend on it.

Start implementation with the [Backend Build Handoff](HALO_BACKEND_BUILD_HANDOFF.md), which maps all 45 feature groups to backend work and completion gates. The [Source Acquisition Guide](HALO_SOURCE_ACQUISITION_GUIDE.md) adds exact acquisition paths, inspected field mappings, permissions and unresolved source-specific constraints. Its [verification report](verification/SOURCE_CHECKS_2026-10-03.md) records fourteen public sample requests, not production validation. These companions supersede earlier statements that no NC fish or conservation endpoint had been located; actual public services were found, with important interpretation and operational gates still open.

October 3 later Homeguard refinement: reconcile the [integration delta](#october-3-homeguard-integration-delta) below with the previously delivered backend working packet. Kitchen inventory is an added owned domain; timeline animation and local PDF formatting are frontend work. No backend changes or live-source claims are established by this planning revision.

October 3 food evidence extension: also reconcile [Food evidence and kitchen integration](HALO_FOOD_EVIDENCE_EXTENSION.md). It specifies provider-backed catalogue and product/photo discovery, reviewed FDA analytical imports, evidence levels, matching metadata and optional owned food-sample reports. The curated frontend can display published results now; broad source ingestion, live notices, durable inventory and private sample linkage remain backend work. No validated item-level estimator exists, and a barcode/photo/nutrient API cannot supply chemical readings. This supplement is newer than the backend working packet already delivered.

## Architecture decisions

Later October 3 food visual decision: actual food photographs were removed. Product image fetching/delivery is not needed for the current kitchen UI. The food evidence addendum's identity and chemistry requirements remain; its photo-specific requirements are superseded by the latest decision at its top.

Extend the existing Next.js application and Supabase database rather than introducing a service for each feature. Shared evidence, saved actions, source references, and reminder delivery should connect the product. Public source ingestion is separate from household-owned records. A new food advisory, household test, conservation event, and daily air reading are different evidence types, not interchangeable inputs to a universal safety score.

The central connection is an immutable reference to evidence plus a mutable household action. A user can save a recommendation from Today, Homeguard, Act, Food and Garden, Map, or Luna and manage that same action in Plan. Completing it changes task state, not the environmental measurement or medical interpretation.

Public data may be cached and reused across nearby households where the source's resolution permits it. Private notes, household composition, appointments, test attachments, and check-ins never enter public map layers or shared provider caches.

## Existing backend baseline

| Capability | Inspected implementation | Implication for the target |
| --- | --- | --- |
| Identity and household | Anonymous Supabase sessions, verified API identity, seven presence categories, profile home details | Reuse ownership and low-friction onboarding. Recovery of a rejected session currently creates a new anonymous identity; it does not recover the old household's records. |
| Today | Daily readings, source-specific failure handling, score, factor severities, household wording, saved history | Extend observation metadata and forecasts. Do not rebuild the current daily pipeline as a separate feature. |
| Homeguard | Water contaminant detail, county radon estimate, lead building-era estimate, private-water testing guidance, deterministic action recommendations | Add saved records and follow-through while retaining all existing source distinctions. |
| Journal | Entries by date and household category, history, retrospective entries, findings, season summaries | Preserve these capabilities and correct comparison semantics before presenting stronger patterns. |
| Map | Cached water, radon, air monitor, facilities, and district layers | Reuse data and geography. Map is not currently a continuous contamination measurement surface. |
| Act | Public organization directory, cause and county matching | Extend into opportunities and participation. An organization entry is not an event feed. |
| Luna | Curated-source retrieval, cited answers, household context, diagnostic refusal, rate limits | Add explicit privacy capabilities, selected-record context, conversation handling, and confirmed action proposals. |
| Notifications | Alert inbox, read/dismiss handling, five preference groups, browser push, deduplication | Extend entity subscriptions and scheduled reminders instead of creating a second notification stack. |
| Account deletion | Verified-session deletion through the auth user with database cascades | Extend coverage to every new table, attachment, conversation record, and queued job. |

The current migrations assume some original tables already exist, including `profiles`, `daily_scores`, `home_risks`, and `ucmr5_utilities`. Before new migrations, capture and review the actual database schema and policies. The files in `supabase/migrations` alone must not be assumed to constitute a complete fresh-install baseline.

### Current route inventory

This inventory covers all 22 route files currently under `app/api`. Every household route calls the existing verified-bearer-token helper. Public-reference responses still require a session at the route even where database read policies allow public reference access. The daily job instead requires its scheduler secret. Table entries describe current behavior, including limitations, rather than the desired replacement contract.

| Existing route and methods | Current inputs and response purpose | Ownership and compatibility requirement |
| --- | --- | --- |
| `/api/onboard` POST | `address`, optional `water_source`, `home_year`, `request_id`; geocodes, matches service area, stores approximate location, returns location/utility and request marker, starts 28-day history backfill | Session supplies owner; legacy `profile_id` must match. Preserve request-outcome reconciliation. Current `request_id` is a stored marker, not a full idempotency transaction. |
| `/api/profile` GET and PATCH | Reads onboarding flags, home/profile and seven household booleans; PATCH accepts `water_source` and/or `home_year` | Keep existing field names and null behavior. Renter and locale writes currently belong to household PUT, not profile PATCH. |
| `/api/household` GET and PUT | Reads composition, renter mode and locale; PUT replaces the seven booleans and optionally writes `renter_mode`, `locale` | Omitted booleans become false. Preserve full replacement or add an explicitly separate partial-update contract. Current bands/preferences writes are not one transaction. |
| `/api/daily-score` GET | Optional `lat`, `lng`, `fresh=1`, legacy matching `profile_id`; returns `air`, `uv`, `pollen`, `mold`, `score`, `retrieved_at`, `cached` | Other-point lookup does not write home history. Current own-location cache lasts one hour and provider refresh is limited per household. Extend source times without renaming current fields. |
| `/api/home-guard` GET | Profile defaults with county, utility, water-source and home-year overrides; returns `radon`, `water`, `score`, `lead`, `action_plan`, `breakdown`, `assembled_at` | Overrides allow public context exploration; do not expose another household's private tests through them. Keep private-water/no-match/lookup-failed distinctions. |
| `/api/history` GET | `days` defaults to 90 and is capped at 365 when used, or `from`, `to`; newest stored row per household date becomes a history point | Owner scoped. Explicit ranges currently need stronger validation/bounds. Add retained source/basis metadata before richer comparisons. |
| `/api/journal` GET, POST and DELETE | GET date range; POST whole date/category record: `entry_date`, `band`, `symptoms`, `severity`, `note`, `retrospective`, `possibly_illness`; DELETE `id` or `all=true` | Unique date/category upsert. Preserve all fields during edit or Undo. DELETE returns actual row count. New revision checking must coexist with legacy upsert. |
| `/api/journal/findings` GET | Current household-level 90-day analysis and readiness/counts | No current category-filter contract. New category analysis must compute scoped findings, not relabel existing results. |
| `/api/journal/retrospective` POST | `dates` array, at most 62 accepted dates; returns environmental comparison across the applicable months | This comparison call does not save Journal entries. Separate entry saves need partial-batch reporting and retry reconciliation. |
| `/api/journal/summary` GET | Optional `season`, `year`, otherwise last ended season; returns seasonal descriptive summary | Preserve winter-year definition. Extend with action/test participation records without changing old analysis meaning silently. |
| `/api/map` GET | `layer` accepts water, radon, facilities or air; optional water `quarter`; cached layers or live rebuild | Public-reference layer cached without household fields. Quarter response uses samples in that quarter, not a cumulative plume. |
| `/api/district` GET | NC08 aggregate plus the authenticated household's county context | Shared aggregate and per-household county enrichment must remain separate cache scopes. Geography vintage requires release verification. |
| `/api/volunteer` GET | County and comma-separated causes; defaults county from profile; returns matched organization rows | Reuse directory and matching. A returned empty list with an unavailable note currently differs from a proven no-match result. |
| `/api/learn` GET | `topic`, `locale`, plus factor-specific context query fields; returns definition, reading-specific explanation, one applicable household note, protective steps and sources | Existing seven topics and English fallback remain. New multiple-category guidance, glossary search and additional domains require additive contracts. |
| `/api/assistant` GET and POST | GET page suggestions; POST `question` up to 1,000 characters and optional allowlisted `page`; one cited answer or refusal/unavailable result | No current conversation, upload, selected-record or mutation-tool contract. Household context is assembled server-side. Do not attach private text to GET query parameters. |
| `/api/alerts` GET and POST | GET latest 100 undismissed alerts and unread count in that returned set; POST one read, all read, or one dismissed boolean | Owner scoped and updated count returned. New global unread count/cursor pagination is an explicit addition. Dismissal is not deletion or task completion. |
| `/api/notifications` GET and PUT | Five booleans: `air_quality_change`, `weather_advisory`, `new_water_results`, `radon_season`, `season_summary`; PUT accepts a partial preferences object | Existing false preference suppresses both inbox creation and push. Channel-specific controls need defined migration, not a frontend-only reinterpretation. |
| `/api/push/subscribe` POST and DELETE | Browser subscription JSON, or DELETE `{endpoint}` | Endpoint unique; subscription upsert currently reassigns an existing endpoint to the current verified user. Rebinding and multi-device tests must prevent old-household notifications on a reused device. |
| `/api/sources` GET | Source list and last retrieved values composed from household history and reference datasets | Retrieval metadata is not observation date. Add registry/source-revision detail without breaking the existing list. |
| `/api/account` DELETE | Literal `{confirm: "DELETE"}` then auth-admin user deletion | Current cascade-based delete has no file/job/export lifecycle. Extend deletion before enabling those domains. |
| `/api/health` GET | Authenticated fixed-location probes of providers, database and Redis | Does not prove valid schemas, source freshness, corpus quality, migrations, deployed scheduler, or successful end-to-end workflows. Bound and restrict probe cost before operational use. |
| `/api/cron/daily` GET and POST | Header or legacy query scheduler secret; geography/layers, water-change detection, daily readings, alerts, push | Keep one authorized scheduler entry point while moving expensive work into resumable batches. Never invoke against production as a harmless health check. |

The seven household fields remain `has_toddler`, `has_child`, `has_teen`, `has_adult`, `has_senior`, `has_pregnant`, and `has_respiratory`. Presentational category labels do not change these stored keys. Dates currently follow `America/New_York`; UTC instants and local calendar dates must not be interchanged during expansion.

Access is classified by data, not by whether a bottom tab is visible. Public regional Map, district evidence, organization and reviewed-source browsing should remain useful without a completed household profile. The proposed civic entry can reuse verified anonymous bootstrap without asking for an address. Home pin, household rankings, personalized guidance and all private records remain absent until their own authorized context exists. A truly unauthenticated public route would require a separately reviewed read-only cache, abuse and quota policy; this plan does not silently remove existing route authentication.

### Existing schema and service reuse

| Existing storage or module | Keep and extend | Boundary that must remain visible |
| --- | --- | --- |
| `auth.users`, `profiles`, `household_bands` | Same anonymous identity and household category model; additive home contexts and consent records | `profiles.id` matches the auth identity today. New recovery or membership cannot casually rekey every row. |
| `daily_scores`, `home_risks` | Preserve owned history/cascades and any deployed dependencies; inspect actual use before migration | Daily scores allow multiple writes per date, with newest chosen for history. Do not add date-only uniqueness that loses legitimate revisions. |
| `ucmr5_utilities`, geography cache, reference JSON | Retain import and presentation adapters; add sample provenance and qualified evidence revisions | Existing detections and boundary matches do not prove complete tested denominators or household exposure. |
| `symptom_logs` | Same original Journal records and uniqueness | Preserve note, illness, retrospective, category and dates through migration and export. |
| `volunteer_orgs`, `learn_content` | Extend existing curated catalogs with explicit publication/review/version metadata | Directory name uniqueness is not a permanent source identity. Published guidance and translations need revision history. |
| `alerts`, `notification_prefs`, `push_subscriptions`, `water_snapshots` | Existing inbox and push delivery form the one notification subsystem | Add subscriptions, delivery attempts and outbox rather than a second inbox; migrate old preference semantics deliberately. |
| `map_layers`, `lib/mapBuild.js`, `lib/districtView.js` | Reuse canonical spatial assembly and district calculations | Current stored layers age out after 36 hours and public layer queries are capped. Real source freshness differs by layer. |
| `assistant_corpus`, `match_assistant_corpus`, `lib/assistantRag.js` | Same curated retrieval foundation, source citations and refusal path | Migration 0013 changes embeddings to 2,048 dimensions. Model, dimensions, stored vectors and RPC must match; adding food/garden material needs reviewed source ingestion. |
| `lib/actionPlan.js`, `lib/wellTestData.js`, `lib/explain.js` | Seed versioned action templates and explanations from reviewed existing logic | These generate recommendations, not persistent user actions. P02 adds follow-through, not a second competing recommendation engine. |
| `lib/serverAuth.js`, `lib/authResult.js`, `lib/ratelimit.js` | Verified identity, 401 versus503 handling, rate/spend guards | Service-role access bypasses RLS. Every query and nested record must still be authorized in the server. |

### Baseline hardening before expansion

These are implementation requirements discovered in current code, not fixes performed by this planning document:

1. **Historical comparability:** `lib/backfill.js` retains `backfilled`, daily-peak modelled AQI and daily-max UV basis, but `/api/history` currently omits `details` and `aqi_source`. Return basis/time/quality before comparisons, and keep a current snapshot distinct from a daily peak. New-source history must not rewrite a past measurement as if it were observed then.
2. **Date and request validation:** Journal currently accepts a date-shaped string and arbitrary symptom strings capped at 20, while history explicit ranges are not equivalently bounded. Add real calendar-date validation, permitted vocabulary, finite coordinate bounds, range ordering and payload limits; retain an explicit read-only legacy path for historical unsupported values rather than deleting them.
3. **Atomic household edits:** the existing household read can normalize absent results when some database reads fail, and PUT writes bands before profile preferences. New edits need reliable read-error distinction, transactionality and a revision so partial or stale saves cannot silently erase category selection. Keep the current frontend's identity preflight until a tested replacement exists.
4. **Address transitions:** geocoding can update coordinates while retaining a previous utility after service-area lookup failure. New home contexts must atomically isolate that new location, and queued history backfills must be bound to the old/new context correctly. A request marker alone is not an atomic move.
5. **Durable source-change delivery:** current utility fingerprints are advanced before household alert fanout, and push sends only for newly inserted alerts. A crash can consume a change or lose push retries. Store source-event/outbox intent transactionally and resume each fanout/delivery independently.
6. **Last good map data:** current reads reject a stored layer older than 36 hours and may return 503 after live rebuild failure even though a previous copy remains stored. Serve a clearly dated stale copy under a validated domain policy, suppress unsupported interpretation, and refresh in the background; retaining a row alone is not offline/failure support.
7. **Meaningful freshness:** daily cache retrieval time, map assembly time and source-list fetch time cannot replace provider observation/publication times. Add provider issue/valid times, measurement basis and missing-metadata reason to canonical adapters.
8. **Alerts and reminders:** correct unread pagination/count semantics, add read/dismiss Undo tests, and migrate preference/channel behavior. Existing seasonal radon evaluation hardcodes no home test; use qualified H06 test state instead of continuing to claim none exists.
9. **Explicit degradations:** distinguish missing optional migration, failed query and genuine empty data in Learn, directory, profile and map responses. `/api/volunteer` currently returns 200 with an empty list and unavailable note on any directory database error; add an explicit directory-unavailable state so empty matches are not mistaken for working coverage. Audit legacy raw error forwarding and source/provider copy before new screens depend on it. Keep unknown provenance unknown.
10. **Operational honesty:** `/api/health` is reachability only. Scheduler completion, row counts, actual source lag, deployed RLS, source rights, model context behavior, and device push delivery require separate evidence. No production configuration or secret values were inspected for this plan.
11. **Provider rights and retained history:** the October 3 audit identified specific Google Pollen storage/display restrictions and Mapbox temporary/permanent storage distinctions. Resolve applicable account/version permissions before expanded persistence, exports, model context or map reuse. Do not assume existing implementation proves permission, and do not delete existing data as part of this planning task.
12. **Weather proxy null handling:** `moldFromNws` currently maps null precipitation to zero. The audit did not establish an authoritative basis for that rule. Correct or justify it with endpoint-specific evidence and tests; return missing when required inputs are unknown. Select the applicable time interval rather than assuming array position alone establishes current conditions.

## Common evidence contract

Every evidence-backed screen and recommendation needs the same meaning for provenance and missing information. Additive adapters can provide this contract while older endpoints remain compatible.

| Field group | Required meaning |
| --- | --- |
| Identity | Stable evidence ID, revision, domain, source record ID, and any superseded record ID |
| Value | Original value and unit, normalized value and unit when valid, parameter or analyte, and explicit reporting qualifier |
| Evidence type | Observed, modelled, forecast, proxy, official advisory, user reported, laboratory document, or reviewed guidance |
| Time | Observation or sample time, publication time, provider issue time when relevant, ingestion time, and validity interval. These must not be substituted for each other. |
| Geography | Point, monitor area, utility service area, county, waterbody segment, district, site, or unknown. Include geometry version and association method. |
| Coverage | Parameters available and missing, reporting limits, sampling coverage, and known exclusions |
| Provenance | Source ID, exact supporting URL or document locator, method version, transformation version, and retrieval record |
| Interpretation | Severity where a defensible rule exists, threshold or guidance reference, effective date, and applicability conditions |
| Freshness | Source-specific current, stale, superseded, expired, unavailable, or unknown state with a reason |

An absent value must carry a reason such as no coverage, never collected by HALO, provider failure, not applicable, or insufficient information. Do not encode these states as zero, a healthy status, or an empty chart that resembles an all-clear.

For non-detect laboratory results, retain the qualifier and detection or reporting limit. A result reported below a limit is not a measured zero. Preserve the source's statement rather than coercing it to an exact concentration.

Staleness is domain-specific. An hourly air observation, a county radon map, a dated utility sample, and an event registration notice cannot share one expiration rule. The user should see the actual source date even if the ingestion process ran a minute ago.

## Source registry and acquisition gates

Maintain a small reviewed source registry rather than embedding untracked source assumptions in components. Each entry needs an owner, official landing page, access method, geographic coverage, update cadence, usage terms, attribution, cost or quota, parser version, sample payload, failure policy, and last successful verification. A reviewed manual import is valid when no reliable API exists. It must be described as a reviewed import, not live monitoring.

| Domain | Repository foundation or candidate source family | Proposed acquisition and feasibility gate |
| --- | --- | --- |
| Air | Existing AirNow lookup with Open-Meteo model fallback | Preserve measured versus modelled. Verify observation timestamps, reporting area, parameter coverage, licensing, and permitted forecast access before increasing polling. [AirNow documentation](https://docs.airnowapi.org/faq) describes variable forecast availability and category-only cases; do not manufacture numeric forecasts. |
| UV and weather | Existing Open-Meteo current UV and one-day hourly lookup; NWS hourly data; guarded OpenUV fallback | Add issue time and valid time. Verify forecast horizon and uncertainty per provider. The [NWS API](https://www.weather.gov/documentation/services-web-api) supports weather forecasts, not an automatic seven-day forecast for every HALO factor. |
| Pollen | Existing Google Pollen request for one day | Source S04 documents the one-to-five-day request range and current non-EEA retention exceptions: today's values 365 days, other forecast/heatmap values 24 hours. Verify account applicability, geography, attribution, quota, cost and exports/model/map rights. Preserve categories and retention classes separately; do not promise seven days. |
| Mold | Existing proxy from NWS humidity and precipitation conditions | Version and review the heuristic. It is not a measurement of outdoor spores or indoor mold. No background illustration or wording may imply detection. |
| Utility water | Existing UCMR utility data and geography | Extend import records to retain tested analytes, non-detect qualifiers, dates, sampling context, and source releases where available. Verify current import coverage before claiming a denominator. |
| Radon and lead | Existing county radon map, building-era lead estimate, utility inventory context | Retain geography and estimate basis. Add household test evidence separately. Verify dataset versions and any source-specific limits. |
| Official alerts | Existing NWS weather advisory parsing and stored water-result change detection | Add authoritative utility or agency advisories only through a verified feed or reviewed publication workflow. A NWS warning is not a boil-water notice. |
| Fish advisories | State health agency public ArcGIS records plus reviewed official documents | October 3 samples verified two public services behind the [NC advisory landing page](https://epi.dph.ncdhhs.gov/oee/fish/arcg.html). A sampled row has truncated advice and an apparent audience/limit conflict. Use the exact endpoints and quarantine/review rules in source S13 of the acquisition guide. Complete text, extent, audience, effective status and reuse still require validation. |
| Food information | Official food studies, openFDA food enforcement notices and reviewed local records | Source S14 supplies a sampled openFDA recall API, including historical PFAS-related records. Keep lifecycle/product/lot scope. [FDA sampling publications](https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure) remain separate study imports, not a local-product safety API. Do not label unsampled nearby products or farms. |
| Gardens and growers | Proposed Extension, agriculture agency, certified testing, and conservation program resources | [Routine NC soil testing](https://www.ncagr.gov/Divisions/Agronomic-Services/soil-testing) serves fertility needs, not automatic contaminant clearance. [NC drinking-water laboratory information](https://www.deq.nc.gov/about/divisions/water-resources/drinking-water/drinking-water-laboratories) requires checking certification scope. Store program eligibility and review dates. Guidance must specify when professional advice or testing is required. |
| Environmental water samples | Optional [Water Quality Portal services](https://www.waterqualitydata.us/webservices_documentation/) | Services expose stations, results, and detection-limit information. Gate ingestion by parameter, matrix, method, location, and date. These are contextual environmental samples, not household tap or food clearance. |
| Water stewardship | US Drought Monitor and the public service behind NC utility conservation status | October 3 samples verified a categorical county drought response and the official NC map's conservation service. Sources S16 and S17 in the acquisition guide give exact endpoints and fields. Confirm reuse/cadence, utility ID crosswalk and full official restriction instructions; status alone cannot generate local watering rules. |
| Conservation | Existing reviewed-organization structure; proposed organizer event pages and program feeds | Verify organizers, service areas, source permission, event changes, and registration links. Begin with curated coverage rather than claiming universal listings. |
| Field observations | Proposed private observations and official environmental reporting destinations | [NC Stream Watch](https://www.deq.nc.gov/about/divisions/water-resources/water-resources-public-information/water-education-programs/water-education-and-outreach/nc-stream-watch) offers an official participation/reporting path; no submission API is established here. Verify the appropriate destination, jurisdiction, and form for each report. No agency receipt is assumed. |
| Map context | Existing EPA ECHO, AirNow, public-water geography, and NC district data | Preserve facility selection rules, source dates, district version, and limits of centroid-based association. A facility record is not proof of household exposure. |

Every new source must pass a feasibility review before a live UI promises its output. Required proof is a real sample, parsing tests, coverage assessment, attribution and access review, sustainable refresh cost, and an honest missing-data state. Sources without a usable machine-readable interface can support reviewed content and manual updates without an invented realtime claim.

For grower assistance, the [NRCS conservation evaluation and planning directory](https://www.nrcs.usda.gov/programs-initiatives/eqip-environmental-quality-incentives/cpas-dias-and-cemas) includes CEMA 209 for PFAS assessment and CEMA 207 for site contamination assessment. These are possible official pathways, not an assurance of eligibility, local availability, funding, or approval. The [Extension county-center directory](https://www.ces.ncsu.edu/local-county-center/) supports contact discovery, not an assumed appointment-booking integration.

## Score and interpretation safeguards

Preserve Today as air, UV, pollen, and mold. PFAS remains in Homeguard. Lead remains shown but unscored under the approved contract. Household categories change relevant guidance and priority, not environmental measurements.

Retain the current canonical severity vocabulary and the documented `no_data` fallback. `lead.level` and the water-status union are existing specialized fields, not errors to rename globally. New types may add explicit domain states but must not break Part D clients by replacing existing keys. Preserve dates as ISO fields additively while retaining original source strings where needed. Historical severity comparisons require the methodology version used at the time; `/api/history` currently derives severity with the current code and is not a versioned interpretation archive.

Existing air-change notifications trigger earlier for sensitive categories under `lib/alertRules.js`. The actual cron marks respiratory, toddler and senior presence as sensitive through `hasSensitiveGroup`. Preserve that behavior under a versioned alert policy; do not broaden it to all household categories or revise thresholds without a reviewed rationale. It changes notification relevance, not a reading or score.

The daily API provides risk inputs and a composite display score, but not an independently defined display score for each factor. Decide and validate the server-side meaning of any factor `/100` score before making it a live requirement. Otherwise show the native measure and severity, retaining the approved card structure with honest data states.

Current contribution bars normalize available risk inputs for visual geometry. They are not automatically percentages of the composite equation or shares of a person's health risk. A proposed explanation endpoint should return the actual formula version, included inputs, exclusions, and contribution semantics. Do not derive an unsupported explanation from an attractive ring.

Keep confidence, data coverage, score, and action completion separate. A user installing a filter or completing a test does not establish a measured improvement. Household results can support a separate documented history, but incorporation into a summary assessment requires a reviewed methodology with sample comparability, time, location, and quality rules.

Regulatory limits, health guidance, and HALO display thresholds are different objects. Store their jurisdiction, legal or advisory status, effective date, source, and review state. Verify current sources before changing them; comments in `lib/scoring.js` are not a continuing legal review.

Qualified domain review is a release dependency for expanded health interpretation, symptom findings, audience-specific guidance, test comparisons and product claims. A disclaimer alone does not establish clinical validation, regulatory status or an exemption. This document specifies the review requirement rather than making a legal determination about the finished product.

A single result above a comparison benchmark is not automatically a legal violation. Compliance may depend on averaging, sampling rules, effective dates, and jurisdiction. Separate a reported concentration comparison from an official compliance determination, and cite the specific record supporting either claim.

## Proposed domain records

Use domain tables or clearly validated typed records where fields and ownership differ. Do not create a generic unvalidated JSON record that permits private evidence, public facts, and model-generated suggestions to become interchangeable.

### Evidence and reviewed content

Proposed groups are `sources`, `source_runs`, `evidence_records`, `evidence_revisions`, `guidance_versions`, and `content_reviews`. Public ingestion uses service credentials only. Publication requires validation and, for curated content, a review state. Keep raw source snapshots only when terms and privacy allow; retain a hash and retrieval metadata otherwise.

A recommendation references the evidence revision and guidance version that produced it. Updated evidence may mark a saved recommendation as needing review. It must not silently rewrite what the user originally acted on.

The proposed Learn glossary/topic index uses these reviewed guidance records with topic IDs, related factors, synonyms, language and content version. A bounded text search over published topics is sufficient initially. Search results retain source/review metadata and distinguish no match from a failed search. Do not introduce arbitrary web retrieval or a second unreviewed content store for this index.

### Home contexts and changes of address

Add proposed `home_contexts` with an owner, stable context ID, effective start/end, approximate coordinates, geography and timezone, water-source type, utility association and matching method, verification state, and current/archived status. Relevant daily history, home estimates, tests, garden sites, observations, actions and subscriptions reference the appropriate context. A garden or outdoor activity may instead have its own optional location context; it does not change the home.

An address change must be a validated idempotent transition: resolve or explicitly fail the new association, create the new context, switch the current reference, and retain the old context with its records. A genuinely new home cannot inherit the old utility merely because the new lookup failed. Preserve the entered draft and offer retry or an honest unmatched-utility state. Reconfirm applicable subscriptions and let the user deliberately carry portable generic tasks forward. Do not relabel old tests or daily history as belonging to the new property.

The current onboarding handler updates the profile in place, can retain its previous utility after lookup failure, and refreshes history keyed to household/date. The new context design is an explicit backend change. Preserve legacy history with an unknown context where its original location cannot be established; do not guess from the present address. Define timezone migration for dates, since current date logic assumes America/New_York. Historical calendar dates keep their original interpretation.

### Actions and Plan records

Proposed `household_actions` fields include household owner, action type, template and version, origin page and record, evidence references, selected household categories, title, editable note, priority rationale, optional due time, time zone, state, completion time, and concurrency version. A recommendation key supports duplicate detection without preventing a deliberate repeat test or recurring task.

Proposed `plan_occurrences`, `reminders`, and `action_events` store recurring instances, reminder delivery, and a bounded history of meaningful changes. Recurrence rules are validated and edited as this occurrence, future occurrences, or the whole series. Store calendar-anchored versus completion-relative mode explicitly. A late completion or skipped fixed occurrence must not move the calendar series; completion-relative intervals start from the confirmed completion under a disclosed rule. Scheduler and completion-triggered generation share an occurrence dedupe key. Existing occurrences must not shift unexpectedly when daylight saving changes.

Add proposed `recommendation_preferences` or an equivalent typed owned record for Not relevant, Already doing this, Save for later, and Stop reminder. Key preferences to the recommendation/template version, applicable home/site context, optionally evidence revision, disposition and validity/review date. These choices are reversible and distinct from task completion. Already doing this may offer to link an existing action, but never inserts an unverified completion or improves a score. Stop reminder cancels the chosen reminder scope; it does not hide a relevant official advisory. A materially changed source or context can request review under a disclosed deterministic policy, not silently discard the preference. Recommendation ranking uses reviewed applicability and priority rules, not model-generated health-risk rankings.

Saved, scheduled, in progress, waiting, completed, paused, and cancelled are distinct states. Overdue is normally derived from a due time, not a terminal state. Completion and reopening require an explicit user action. A walkthrough's Next button is navigation, not completion.

Proposed `outdoor_plans` store owner, shared action ID, activity label/type, optional approximate planning location, timezone, duration, preferred/candidate periods, chosen interval, relevant household categories, preparation tasks and referenced forecast revisions. The source issue time and period resolution are retained. A plan can exist before forecasts cover its date. An opt-in `forecast_watch` binds the plan, applicable factors, supported area/period, expiration and reviewed material-change rule; it cannot depend on arbitrary continuously precise tracking. Refreshes mark the plan for review and offer a deliberate reschedule, never silently change the chosen time. Create/edit/cancel/delete and export obey the same ownership, revision, retention and idempotency rules as other private records.

### Tests and maintenance

Proposed `household_tests`, `test_results`, `home_assets`, and `maintenance_records` cover radon, drinking water, relevant soil or garden testing, and user-chosen maintenance. Store test purpose, collection context, planned and sampled dates, lab or provider, analytes, original and normalized units, qualifiers, reporting limits, result document reference, and user verification state.

A result moves through draft, awaiting result, received, needs clarification, user verified, and superseded states as applicable. User verification means the user confirmed transcription, not scientific certification. Preserve original results when corrected. Prevent invalid unit conversions, ambiguous dates, incompatible sample contexts, and missing qualifiers from generating confident interpretation.

Retain the original document and extracted or entered transcription as distinct records for as long as the user's retention choice permits. A normalized value must record its conversion and source value. Units depend on sample matrix: water concentration cannot be compared directly with soil or tissue concentration, and soil results may use dry-weight or wet-weight bases. Any unsupported conversion or missing basis blocks automated comparison rather than silently selecting a default.

Maintenance intervals need an explicit basis such as a manufacturer instruction, reviewed guidance, or user choice. Calendar elapsed time alone cannot establish filter performance or remaining contaminant removal capacity. A completed replacement is a household record, not a verified water improvement.

### Food and Garden

Proposed public groups are `advisories`, `advisory_rules`, `waterbodies`, `food_reports`, `grower_resources`, and `conservation_programs`. Advisory rules retain official species, geographic extent, audience definitions, preparation guidance where present, frequency or restriction text, issue date, and revocation state. Do not infer that HALO's seven household categories exactly match official advisory groups.

Matching also needs species groups and synonyms, waterbody segments, serving definitions, time periods, and any combined limits across species or contaminants. When statewide and local rules overlap, the reviewed source interpretation must decide applicability. Do not add meal allowances from separate advisories or infer a remaining allowance without an explicitly supported method.

Optional private `fish_records` support catch or consumption notes as a distinct user-entered record kind, with owner, observed date, optional waterbody/location context, species or unresolved label, original quantity/unit, linked advisory revision and optional note. Creating, reading, editing with revision history, deleting and exporting are explicit owned operations. These records are optional for advisory lookup and never update official evidence, public map layers, inferred dose or remaining meal allowances. They need the same minimization, retention and complete deletion coverage as Journal records before release.

Proposed private `garden_sites` and `site_observations` are optional. Collect only information used by a feature: irrigation source, approximate site context, user-entered soil or water tests, chosen practices, and relevant task records. Exact property polygons, crop yields, fertility schedules, and inferred contamination are not necessary defaults. Additional grower fields require a concrete user workflow and clear provenance.

The feature may monitor updates to official advisories and saved evidence, test follow-up, and chosen garden activities. It does not monitor the chemistry of crops without a relevant measurement. Water, soil, and food are separate media with separate methods and units.

### Water stewardship

Use typed evidence kinds for regional drought classification, utility conservation notices or restrictions, and optional household or garden water-use records. County statistics retain the category distribution across county area; they are not a point classification at a home. A point lookup requires a valid dated source geometry and intersection method, never the county's maximum class. A weekly regional drought classification is not a plot's soil moisture, a household meter reading, or a utility restriction. Keep issued dates, effective periods, geographic scope, and any superseding notice visible.

Optional `water_use_records` retain date or period, original quantity and unit, whether measured from a meter or reported by the user, applicable site, and notes. Compare only compatible periods and methods, displaying gaps and interval length. Describe this as measured usage change, not savings caused by HALO or a particular task; weather, occupancy and other conditions may differ. Attributed savings need a separately validated method. Do not infer an unmeasured consumption total, assign drought responsibility to a household, or calculate irrigation prescriptions from a regional drought category.

Utility restrictions can lead to reviewed guidance, a saved action, and a chosen subscription. Regional drought updates can provide context and stewardship resources. A saved reminder must defer to the actual applicable restriction and source, not present a generic watering schedule as permission.

### Conservation and participation

Extend `volunteer_orgs` with reviewed service areas, accessibility information when verified, contacts, and status. Proposed `opportunities`, `opportunity_revisions`, and `participation_records` add an organizer, cause, activity description, location, dates, time zone, age restrictions, access requirements, materials, cost, cancellation state, source, and last checked date.

Distinguish saved, external registration opened, user reports registered, attended, cancelled, and follow-up states. An outbound link is not proof of registration. Hours or participation outcomes are user reported unless independently confirmed. Never translate attendance into estimated pollutant removal or health benefit without a defensible measurement method.

### Private field observations and reporting handoff

Proposed `field_observations` contain an owner, observed time, optional approximate location, user-selected observation category, description, optional private image, and attachment metadata. Categories describe what the person saw, such as unusual appearance or odor, rather than asserting a chemical or cause. Images and notes remain unverified reports and never populate a public contamination layer.

The workflow supports draft, saved privately, prepared for reporting, external reporting opened, and user-reports-submitted states. HALO may prepare an export or copyable description and link to a verified official reporting destination. Exact coordinates or images are included only after a user preview. Agency acknowledgement is shown only if an actual receipt is available; an opened browser link cannot establish it.

Provide source-reviewed safety and reporting instructions where applicable. Do not encourage entering hazardous sites, collecting unsafe samples, or approaching wildlife or suspected contamination to improve a report. Public sharing, automated agency submission, or community incident aggregation would require a separately reviewed privacy, moderation, safety, and receipt contract.

### Outreach and summaries

Proposed `outreach_drafts` and `outreach_followups` retain recipient type, cited evidence revisions, template version, editable content, and user-reported sent or reply dates. Draft creation does not send a message. Any later delivery integration requires a preview, exact recipients, explicit confirmation, delivery status, and abuse controls.

Household summaries are generated from a user-selected set of records with source dates and caveats. Prefer on-demand private export. A public or bearer-link share is a separate opt-in capability with expiry and revocation, never the default. The generated record must exclude location, household health categories, Journal notes, or attachments unless explicitly selected.

### October 3 Homeguard integration delta

These additions apply within H06, H08, F01/F04 and P01/P02, not a new replacement architecture. They supplement the already-delivered backend specification. The current wireframe's private edits remain sample-session memory; persistent production behavior requires the contracts and security checks below.

| Area | Required contract or deliberate boundary |
| --- | --- |
| Test milestones H06 | Return the recorded facts for each milestone independently, with available recorded dates and current revision. Arrangement and awaiting-result history cannot be inferred only from the highest workflow status. Adding an existing result must not invent prior arrangement/collection. Stage corrections use existing authorized, revision-checked edits; result corrections retain originals and a reason. The frontend owns Luna's motion, tooltip, bar and pencil controls. No robot-position API or laboratory tracking feed is required. |
| Follow-up H06/P02 | Store or resolve the linked canonical action ID. Saving a follow-up and setting any corresponding workflow state must reconcile atomically or recover an unknown outcome without duplication. Follow-up started is different from action completed. Opening the editor, watching animation and generating a report are not mutations to test progress. |
| Food catalogue F01/F04 | A reviewed, versioned catalogue can begin as bundled frontend content. A future read interface supports stable food IDs, common names, aliases, food-group/guide references, storage suggestions, locale, bounded search/pagination and explicit no match. Catalogue coverage is not measurement coverage. No paid grocery service or chemical assay API is required merely to list common foods. |
| Kitchen inventory F01/F04 | Add a proposed owned `household_food_items` record, or equivalent: stable ID, verified owner, optional relevant home context, catalogue food ID when known, user label, fridge/pantry/freezer storage, origin (store/homegrown/caught/unknown), optional question/note, referenced guide revision, created/updated timestamps and revision. Create/read/update/remove/export use the normal authentication, RLS, limits, expected revision and idempotency rules. Preserve custom or retired-catalogue labels rather than losing the item. No mandatory brand, lot, quantity, consumption diary or question just to add a food. |
| Food evidence matching F04 | PFAS and lead are the two inventory indicators. A matching response needs `unknown`, contextual study, potentially applicable notice or matching sample distinctions, plus source/revision, matching reason/limitations and original sample dates. Exact values require the measured food/sample or product/lot scope, analyte identity (particular PFAS compound, not an invented total), original value/unit, qualifier/limit and wet/dry basis where applicable. Broad food-name matches, recalls without concentrations and environmental water/soil samples cannot become numeric contents of a household item. Do not translate a water threshold into a food limit. Optional product/lot context may be requested only when needed to check a particular notice. |
| Kitchen lifecycle and Plan | Adding/removing a food affects the private inventory, not any score, public evidence or automatic task. An explicitly saved question/follow-up has the item's origin reference and one canonical action ID. Removing an item must have a stated linked-action policy and preserve an intelligible source snapshot without orphaned navigation; it must not mark the action complete. Include this domain in private data inspection, export, account deletion, retention and any approved recovery. |
| Local household PDF H08 | The preferred path fetches authorized selected records and renders a PDF locally. No model request, file upload, export-job endpoint or new background worker is needed for this path. Supply stable record/evidence revisions, original source dates and omission reasons so the client can build one reproducible snapshot. A local PDF manifest has selected scopes/revisions, generated time and omissions; expiry applies only to server-hosted artifacts, not downloaded local files. A changed selection or source revision needs regeneration. |
| Conditional server export H08/X05 | Only if later necessary: authenticated job/status/download/cancel, explicit retention, ownership checks, short-lived retrieval and deletion coverage. Expose actual job progress or an indeterminate state. Keep this separate from the local path and from Luna's conversation/privacy permissions. A decorative Luna generating label must not imply third-party AI processing. |
| Plan joins P01/P02/H07 | Return routines and chosen test/maintenance/moisture/garden/food/usage follow-ups through canonical action/occurrence links. Scheduled items and unscheduled saves have distinct placement; observation dates are not implicit due dates. A private record may have no task, and creating a task must not duplicate the record. Shared status/revision updates invalidate both Plan and origin summaries. Preserve the existing no-score-change and deliberate-repeat rules. |

The food indicator restriction is specific to Food at home. Official fish advisories must still retain every contaminant and instruction present in their reviewed source. Matching a chemical value to a particular food remains conditional on real source availability. An expanded backend cannot manufacture absent measurements.

### Subscriptions and alerts

Proposed `subscriptions` connect a household to a supported public entity or a chosen reminder. Include subscription type, entity ID, selected parameters, notification channels, quiet-time preference, and cancellation state. Extend existing alerts with a stable target, source revision, event time, reason, and delivery state.

Deduplicate by meaningful event identity and revision, not merely text. Keep advisories, source updates, reminders, and organizer changes visually and structurally distinct. Suppressing push does not necessarily remove a relevant in-app record. Make those preference semantics explicit.

### Journal and patterns

Reuse `symptom_logs` and history. Add explicit check-in state if needed to separate felt fine, symptoms, and incomplete entry, with a validated symptom vocabulary and real calendar-date validation. Preserve retrospective and possible-illness flags, edited timestamps, and selected category.

Add an owned all-time `has_any_entries` or exact entry-count read for first-use routing. An empty 90-day or 365-day list cannot prove the household has never used Journal. Expose history-backfill state as pending/running/complete/partial/failed, including coverage dates and source quality; a pending backfill with no rows is not a genuine no-history conclusion. Preserve the existing retrospective comparison maximum of 62 dates, default 90-day entry window, 12-week grid and seven recent entries as presentation/query requirements without inventing an API result for an unimplemented filter.

Retrospective batch entry creation must detect existing date/category records before overwriting them. Add create-if-absent or expected-revision semantics so a recalled rough-day retry cannot erase a richer current entry written by another tab. Return per-date saved/already-present/conflict/failed outcomes with identifiers, and retry only genuinely failed keys. An analysis request alone does not save entries. A corrected/deleted entry invalidates private findings and seasonal summaries using the same analysis version and logging denominator.

The current algorithm's denominator includes environmental-history days without a check-in. Future wellness comparisons must use explicit logged days, expose included and excluded counts, and label retrospective entries. Missing logging is not evidence of feeling well. Category filtering needs category-specific calculation rather than relabelled household findings. A category is not a uniquely identified person.

Version the analysis and validate minimum evidence rules. Show descriptive associations only, with no diagnosis, causal inference, or medical probability. Do not create engagement incentives to report symptoms or imply a finding will appear after a promised number of entries.

### Luna context and proposals

Add a capabilities response that discloses whether household context may be sent, what categories are eligible, provider-processing policy reference, retention setting, and available actions. The existing environment flag enables household context unless exactly `false`; `uses_household_data` in an answer does not prove what was already sent to the provider.

Proposed conversation handling stores minimal context or uses a short-lived server session. The user should be able to start a new conversation and delete stored content. Selected record IDs are authorized and loaded server-side. User-supplied snippets, retrieved documents, and attachment text are data, never instructions to execute tool actions.

Structured proposals contain a proposed action, citations, fields requiring confirmation, and a short expiry. The confirm operation revalidates ownership, evidence, and freshness before saving. Luna does not directly write tests, register for events, send letters, change subscriptions, or schedule tasks without that confirmation. Free-text Journal notes remain excluded by default.

### Recovery and device access

Keep anonymous entry. Optional recovery or account linking can protect long-lived records, but requires a specific authenticated flow, collision handling, device/session management, and an explanation of what is recoverable. Never use possession of a household ID or a public URL as authorization. Current anonymous-session replacement is not a recovery feature.

Shared household accounts, if added, require membership roles, explicit invitations, revocation, and a decision about which health records other members may see. They must not be introduced as an incidental consequence of export or device linking.

## Proposed endpoint and mutation contracts

All paths below are target proposals, not routes that already exist. Existing endpoints should be extended additively or adapted, not broken because navigation changes.

| Operation group | Proposed surface | Contract and state requirements |
| --- | --- | --- |
| Home context | Atomic current-home transition and archived-context reads | Verified owner, idempotent transition, explicit new utility match/failure, retained historical associations, timezone handling, no silent transfer of old tests or utility. |
| Learn index | Proposed reviewed-topic list, search and detail reads | Published content only, bounded query, topic/language/version, no-match versus failure, source metadata, stable links back to originating context. |
| Evidence | `GET /api/evidence/:id` and source detail | Return authorized record, revision, provenance, scope, freshness, and applicability. Removed or withdrawn records return a legible status rather than disappearing from saved actions. |
| Conditions | Extend `/api/daily-score`; add `/api/forecast` and `/api/changes` | Separate observations from forecast issue/valid times. Change reasons identify environmental change, new coverage, source correction, or methodology/profile change. |
| Actions | `GET/POST /api/actions`, `PATCH/DELETE /api/actions/:id` | Owner derived from session, idempotent create, validated state transitions, duplicate suggestion detection, revision conflict detection, explicit delete or archive semantics. |
| Plan | `GET /api/plan`, occurrence and reminder operations | Date range plus time zone, bounded range, recurrence edit scope, save without schedule, explicit reminders, and cancelled-instance handling. |
| Outdoor plans | Proposed plan CRUD, preparation and forecast-watch operations | Authorized optional location, duration/timezone, saved evidence revisions, per-factor horizon/resolution, explicit material-change rules, no automatic rescheduling. |
| Tests | `GET/POST /api/tests`, result and correction operations | Typed measurements, qualifiers, original units, evidence distinction, validation messages, versioned corrections, and no score change merely from task completion. |
| Maintenance | Assets and maintenance operations | User choice or cited interval basis, repeated events, pause/resume, replacement history, no unsupported efficacy estimate. |
| Food and Garden | Advisory search/detail, food reports, grower resources, garden sites | Public records scoped by source geography and actual coverage. Private observations isolated from public evidence. No source match is not a clean result. |
| Fish notes | Optional catch/consumption record CRUD and export | Private owner, original quantity/unit and source context, optional advisory link, revision conflict handling, full deletion, no dose or remaining-allowance calculation. |
| Water stewardship | Drought and utility notice reads, private water-use record operations | Separate regional context, utility rules, and actual user measurements. Date and unit validation, compatible-period comparison, and source-aware subscriptions. |
| Conservation | Opportunities, organizer details, participation operations | Verified source fields, expiry/cancellation, filtering without invented metadata, and explicit user-reported external status. |
| Field observations | Private observation and attachment operations, reporting preview/export | Distinguish observed description from cause. Explicit location/image inclusion, verified destination, no automatic external submission or false agency receipt. |
| Outreach | Draft preview/save, export, user-reported follow-up | Cite actual evidence, preserve edits, validate recipients if delivery is later introduced, never auto-send. |
| Subscriptions | `GET/POST /api/subscriptions`, update/cancel | Supported entities only, opt-in channels, duplicate handling, unsubscribe confirmation, retained history where appropriate. |
| Journal | Extend current entry, findings, retrospective, summary routes | Real date validation, logged-day denominators, category scope, analysis version, corrected-entry recomputation. |
| Luna | Extend assistant capabilities/questions; proposal/confirm | Privacy disclosure before sending, authorized context references, bounded conversation, source-grounded output, confirmed side effects. |
| Export and recovery | Data export job/status/download; separate recovery operations | Reauthentication where appropriate, short-lived private download, ownership checks, lifecycle audit, and deletion handling. |

### Common request behavior

Every mutation must validate an explicit schema on the server. The verified session supplies the owner; clients cannot select another `profile_id`. Database row-level security is required even where service-role route handlers currently perform the operation. Service-role access must be narrowly scoped and tested against cross-household IDs.

Creates that can be retried accept an idempotency key bound to owner, operation, and request hash. Reusing a key with different content returns a conflict. Updates use a revision or `If-Match` precondition. Deleting an already-deleted owned resource has documented idempotent behavior without revealing another household's resource.

Return a consistent error envelope with code, safe message, field errors where relevant, retryability, and request ID. Distinguish validation errors, authentication required, forbidden or inaccessible resource, missing resource, revision conflict, rate limiting, and temporary provider/service failure. Never surface service credentials, raw SQL, private provider payloads, or other users' data in errors.

An offline draft is not a confirmed server save. Show pending sync and retry explicitly. Replayable writes need idempotency and conflict handling; a stored delete or external-send operation must not execute silently after a long offline period. Do not require the frontend to infer success from a closed dialog.

### Typed field requirements for new flows

This table supplies the minimum proposed contract fields beyond the existing endpoints. Optional means the user or source may genuinely omit the field, not that its meaning can be guessed. Use strict server schemas and generate TypeScript clients/fixtures from the agreed schema. Naming can change during implementation; loss of the listed behavior cannot. Do not introduce all these endpoints before the corresponding complete journey is ready.

| Contract and feature IDs | Request and record fields | Required response and behavior |
| --- | --- | --- |
| Current-home transition G01 X04 | Expected profile revision, address lookup reference/request key, confirmed water source/year, prior context ID, carry-forward task choices | New context ID, match status/method, timezone, old-context archive, affected subscriptions, retained records and authoritative current profile. Resolve lookup before atomic transition; no partial cross-context save. |
| Conditions and changes T01 to T06 | Location/context, requested observation or valid period, optional comparison revision | Per-factor native value/unit, severity, evidence kind, source revision/times, coverage, explanation version; changed field and old/new evidence; `comparable` plus reason. No change percent when baseline is null/zero or method incompatible. |
| Forecast and outdoor plan P03 | Supported place reference or bounded optional coordinates, interval and timezone, duration, chosen factors/categories; chosen period and source references on save | Actual period resolution and available horizon per factor, issued/valid times, expired/gap reasons, plan revision and optional watch status. No invented intervals. Rescheduling requires a separate confirmed mutation. |
| Action and project P02 A04 H07 | Action type/template version, origin reference, optional parent, home/site/category applicability, title/note, evidence revision IDs, optional schedule and recurrence | Stable action ID/revision, source snapshot, current state, permitted transitions, duplicate match, linked occurrences and follow-up. Reuse the existing action when selected; intentional repeat gets a distinct occurrence. |
| Plan read P01 | From/to, timezone, bounded filters and cursor | Items with all-day local date or timed instant, item timezone, type, canonical linked record, state and next occurrence. Return unscheduled records separately; one underlying item is never counted once per screen. |
| Test and result H06 H03 H04 F03 F05 | Test type/matrix, purpose, context/site, collection start/end, provider/lab, method, sample label, optional report reference; result analyte, original text/value/unit, qualifier/limits and basis | Saved workflow state, result revisions, validated normalization or blocked reason, transcription verification status, related action, optional reviewed interpretation and its method/source. Permit uninterpreted records when parsing is ambiguous. |
| Home asset and maintenance H07 | Asset type/user label, installation date, optional model/instruction evidence, calendar or completion-relative interval, service action and optional meter/room observation | Last confirmed completion, next due under explicit policy, archived/replaced state and history. Unsupported product/model certification stays unknown. |
| Garden F01 F03 F05 | Site label/type, coarse context, irrigation source independent of tap source, optional soil history, linked test/action/resource IDs | Site revision, evidence summary, relevant source notices, open questions and owned follow-up. Source changes version site context rather than relabelling old samples. |
| Advisory matching F02 | Waterbody/segment reference, species/group reference or unresolved text, exact official audience code, optional valid date | Matching advisory revisions, rule applicability and extent, overlap/conflict explanation, official serving/frequency language, warnings and no-match reason. Never auto-map broad HALO age categories into exact advisory groups. |
| Fish note F02 | Note kind catch/consumption, date/timezone, optional waterbody, species or unresolved label, original quantity/unit, optional advisory reference/note | Owned record and revision, unknown labels preserved, selected export/deletion support. No health dose or allowance computation. |
| Food evidence F04 | Region/food type/search/cursor within actual coverage; detail reference | Notice/study/sample kind, issuer, commodity/lot/site scope, analyte/unit/qualifier, dates, source extent, official action, current/superseded status. Evidence match is not a farm or brand safety certificate. |
| Grower inquiry F05 | Reviewed resource/program ID, optional garden/test references, chosen document checklist, user-reported inquiry/application state | Requirements snapshot, official contact/handoff, optional reference number and follow-up action. User-reported application status never becomes agency approval. |
| Water stewardship F06 | County/dated geometry or verified utility reference; optional usage period, original volume/unit, meter/bill/source, site | Regional category distribution and separately scoped utility notice; private usage series with interval and comparability metadata; update event references. No automatic irrigation prescription. |
| Opportunities A02 A03 | Cause/place/date filters, organizer/opportunity ID; explicit participation-state change and optional hours/note | Source verification, dated event revision, availability/cancellation, required preparation, linked Plan action and user-reported/official status provenance. Age/accessibility unknown is distinct from unrestricted. |
| Outreach A05 | Recipient class, purpose, selected evidence revisions, template revision, optional private draft only under retention consent | Independent draft per recipient, citations, outdated-evidence warning, export/copyable text, user-reported sent/reply state. No recipient email or actual message delivery implied. |
| Observation A06 | Observed time/timezone, factual category/text, optional chosen location precision, attachment IDs, destination record | Private record revision; reporting preview of exact included fields; official destination/review date; state and genuine receipt reference only if supplied. Metadata removal happens before sharing preview. |
| Household summary H08 | Chosen date range/context, included sections/records, allowed category/note/location/attachment choices | Preview manifest with source times and omissions, then generated artifact with scope/hash/time/expiry. One failed optional section returns an omission, not invented content. |
| Learn and guidance X01 T06 H05 | Topic or bounded text query, locale, selected evidence and category context | Reviewed content version, delivered/requested locale, valid contextual notes with evidence bindings, sources and no-match/unavailable state. Persist reviewed explanations once; do not duplicate a new corpus per page. |
| Subscriptions X03 | Supported entity type/ID, event kinds, channels, quiet hours/timezone, optional expiry and parameters | Subscription revision, effective preferences, last evaluation/source state, opt-in status, cancel confirmation and existing-match detection. No arbitrary client URL polling. |
| Luna X02 | Question, approved page/context references, optional bounded conversation ID, privacy choice/version | Capabilities reflecting effective server behavior, answer/refusal/source status, citation IDs, selected-context disclosure, optional structured proposal with expiry. Confirmation supplies proposal revision and idempotency key; reauthorize before write. |
| Export X05 | Explicit scopes, contexts/date ranges, format and attachment inclusion | Export job ID/status or local artifact manifest, counts/omissions, safe private download with expiry, cancellation/deletion state. Never embed a bearer session in a share URL. |
| Recovery X05 | Approved authentication challenge and verified destination, separate link/recover intent, current session where applicable | Verified identity continuity or explicit collision/recovery failure; session/device revocation support and records available. Household ID alone never proves ownership. |
| Source review X07 | Source/run/revision ID, reviewer role, validated publish/withdraw decision and rationale | Atomic published pointer, superseded history, affected-entity event and audit record. An editor cannot publish unvalidated raw import text as advice by merely checking a box. |

### Proposed relationships and database invariants

Keep private ownership as `profile_id` compatible with the current model unless an independently approved household-membership migration changes it. Every private child references both its parent and the same owner using a composite foreign key or equivalently enforced database constraint. A route's ownership check alone does not prevent accidentally linking another household's attachment or test.

| Record family | Relationships and uniqueness | Access and deletion rule |
| --- | --- | --- |
| Source and ingestion run | Source has many runs; run keyed by source/release/parser request; external record stable within its source namespace | Service/operator writes. Public reads expose approved metadata only, never credentials, fetch headers or raw private data. |
| Evidence and revisions | Evidence identity unique by source and stable source record key; revision keyed by canonical content hash plus source revision semantics; current pointer references validated revision | Published public records are read-only to ordinary users. Private measurements remain in owned domains, not a public evidence table row with a forgotten flag. |
| Guidance and project templates | Topic/template, locale and version; published version has sources and review record | Ordinary users read published only. Withdrawal preserves referenced history while blocking new recommendations. |
| Home context | Many per profile, at most one current context; effective dates cannot overlap for current-home interpretation | Ownership enforced; archiving is not deletion. Full deletion includes all historical contexts. |
| Household action | Many per profile; optional parent/project must share owner; optional evidence references public reviewed revisions or owned private record | Parent completion does not silently complete children. Delete/archive policy handles children and linked tests explicitly. |
| Recommendation preference | Unique owner/recommendation/context/version scope; disposition plus validity/review date and optional linked canonical action | Reversible owner control. Suppression and Already doing this never write a completion or hide an official notice; full deletion includes these records. |
| Occurrence and reminder | Unique action/series-version/local occurrence key; unique occurrence/channel/reminder kind; store original timezone/fold decision | Server generates, owner changes authorized schedule; cancellation immediately invalidates future delivery intent. |
| Outdoor plan and forecast watch | Owned plan has one canonical action; watch unique per plan/factor/policy and references supported forecast area/time | Server may flag review, not change selected interval. Removing plan cancels watches and reminder jobs. |
| Test and results | Test belongs to context or garden site; many analytes and corrected revisions; result sequence unique within test | No one-result-per-analyte constraint if a report has multiple sample points. Corrections supersede but do not overwrite original evidence. |
| Assets and maintenance | Owned asset, service records and linked shared actions; replacement can archive one asset and start another | Cascades/explicit unlink must not erase an unrelated laboratory result. Cleanup handles attachments and reminders. |
| Garden and site context | Many optional sites per profile; irrigation/source context versioned; observations/tests retain original context | Do not require unique site labels or use labels as IDs. Delete offers clear linked-record scope. |
| Advisory and audience rules | Issuer/advisory source ID plus version; many species groups, extents and audience/combined-limit rules | Public reviewed reads; no household consumption data in rules. Withdrawal creates a change event. |
| Fish and water-use records | Many private observations; source/advisory links optional; revision checked | Do not prohibit legitimate same-day records with a day-only uniqueness key. Delete/export includes notes and owned files. |
| Opportunity and participation | Public opportunity has organizer and revisions; participation unique by household/opportunity except distinct sessions explicitly modelled | Attendance not inferred from opening a link. Cancelled source retains saved participation context. |
| Outreach and observations | Owner, optional context, selected evidence revisions, snapshots and shared follow-up actions | External-sent snapshot immutable to edits; draft and later amendments separate. Default remains private. |
| Attachment | Owner, private object key, checksum, MIME, byte count, scan state, sanitized derivative references and typed domain binding | Foreign-owner linking blocked. Deletion considers originals, thumbnails, extraction output and temporary upload objects. |
| Subscription and event | Subscription unique by owner/entity/type/parameter set; source event unique by entity/revision/event kind | Viewing is never subscription. All jobs recheck cancelled status and current preferences before delivery. |
| Outbox and delivery attempt | Outbox intent keyed by target household/event; channel/device attempts keyed by outbox/channel/device revision | Service-only leasing; repeated execution safe. Public logs contain IDs and error codes, not private notification bodies. |
| Luna session and proposal | Owner-scoped conversation; proposal references authorized context and expires; confirmation nonce single-use | Provider processing and local/server storage are distinct choices. Private free-text Journal notes excluded by default. |
| Export and deletion job | Owner/request hash/idempotency scope; export manifest and expiry; deletion retains minimal non-content completion marker | No private job result accessible using guessable ID. Deletion status needs a narrow authenticated or scoped receipt flow after auth deletion. |

Index private lists by owner, current status and date/due time; public catalogs by source/status/updated time plus actual filter dimensions; queue polling by status, next-attempt time and lease expiry. Use cursor pagination with a stable secondary ID. Geospatial indexing is warranted only for actual supported intersection queries, not approximate rankings based on invented precision. Validate index plans and payload sizes on representative datasets before publishing load claims.

Database constraints complement RLS: finite validated values and permitted units, real date types, valid state enums, nonnegative durations/quantities where appropriate, start before end, required revision numbers, allowed relation types and ownership-consistent foreign keys. Chemical concentration with a reporting qualifier retains the original text even when a numeric representation is absent. Migration tests must cover both direct authenticated database access and server service-role queries.

### Transaction and concurrency boundaries

Use a database transaction or a tightly scoped RPC for operations spanning records. Existing separate route calls cannot be made atomic by disabling the Save button.

- Saving an action with its initial occurrence, reminder and audit event commits once. A timed-out response is reconciled by the same idempotency key, not a second task.
- Completing an occurrence, recording its completion event, cancelling obsolete reminders and generating a completion-relative next occurrence commits once. Two workers or two tabs cannot generate two next occurrences.
- Publishing a source revision, updating the current pointer and writing a durable source-change event commits once. Fanout checkpoints advance only after their own durable acceptance, not before processing all households.
- Confirming a test transcription creates a result revision and updates linked workflow state together. It never mutates the public regional reading. Attaching a file requires an authorized completed upload, not a client-provided storage path.
- Moving home atomically changes current context and invalidates old-context future matching. Existing backfill jobs carry their original context and cannot write current-home readings after the move.
- Participation state, linked Plan scheduling and event-change notices share canonical references. Source cancellation flags the item without silently claiming the household cancelled or deleting its history.
- A Luna confirmation validates the proposal, owner, latest evidence and field limits again. The consumed proposal key and saved action are atomic. A retry returns the original outcome.
- Delete-everything first blocks new private writes and cancels future processing, then coordinates database/object/export cleanup before removing the identity. Crash recovery resumes without recreating deleted content.

Concurrent PATCH uses an expected revision and returns conflict plus the current authorized version. The client can compare and reapply explicitly; last-write-wins is not acceptable for private test transcriptions, household categories, or schedules. Public caches use source/version keys and single-flight refresh locks to prevent a cold layer request from triggering many parallel provider builds.

## Ingestion and monitoring operations

The existing daily cron performs geography refresh, map construction, history recording, alert evaluation, and push. It has a 60-second maximum and selects up to 5,000 profiles and 2,000 utility rows. Adding every new feature to that handler would risk incomplete coverage and runtime failure.

Keep the public trigger small. Use persisted cursors and bounded job batches for source fetches, validation, canonical publication, household matching, and notification delivery. Begin with the existing deployment's available job mechanism; a durable database-backed work queue is sufficient if it can safely lease, retry, and resume jobs. No new distributed architecture is required merely for appearance.

Each run needs a source, cursor, start and finish time, record counts, rejected records, last successful watermark, parser version, and error classification. Jobs use leases, retry backoff with jitter, maximum attempts, and a review queue for persistent failures. Publishing a partial fetch must not delete records that were simply not reached.

Source changes publish only after validation. Preserve the last successful snapshot with its original dates when an upstream provider fails. Alerting uses a durable outbox so data publication and intent to notify are committed together. Delivery retries reuse a dedupe key. Expired push endpoints are removed as they are today.

### Scheduler and event execution

Current `vercel.json` schedules `/api/cron/daily` at 11:00 UTC, so local wall-clock time changes with daylight saving. A daily trigger cannot promise 15-minute reminders or timely official-advisory updates. New refresh targets require a verified scheduler capability, bounded job runtime and durable queue before those promises appear in the UI. Deployment configuration presence is not proof that the host executes it.

| Worker responsibility | Trigger and durable key | Execution and failure requirements |
| --- | --- | --- |
| Source acquisition | Source-defined next check or explicit operator run; source/release/request key | Use permitted conditional requests, explicit timeout and redirect policy. Store the run and raw/hashed acquisition evidence before parser publication. A partial page never becomes a complete dataset. |
| Validation and publication | Completed acquisition run plus parser/method version | Check required fields, count changes, units, geography and dates; quarantine suspect runs; publish canonical revision and change event transactionally. |
| Public derived views | Published compatible source versions; layer or aggregate/version key | Rebuild Map/district/forecast indexes in bounded batches. Persist assembled-at and original source times independently; keep previous compatible version until success. |
| Household history and matching | Regional observation/source event plus stable home-context ID | Batch by eligible context and permitted shared spatial resolution; persist cursor; preserve actual capture basis; match subscriptions before fanout. Recheck context when executing. |
| Reminder generation | Scheduled scan and completion-relative event; action/series/occurrence key | Materialize a bounded horizon, preserve all-day versus timed semantics, respect timezone and quiet hours, and cancel superseded occurrences. Never replay an obsolete safety-related reminder as timely. |
| Alert fanout | Published source event plus matching policy version; household/event key | Recheck ownership, watch state, current consent/preferences and supported scope. Fanout resumes per checkpoint. Event retained until all intended batches reconcile. |
| Push delivery | Committed outbox item and allowed device/channel | Record attempts, retry transient provider failures, retire 404/410 endpoints, respect expiry and quiet hours. Accepted push is not proof the person read it. |
| Content and link review | Source/template next review date or manual report | Queue a curator review; HTTP 200 is only link reachability. Source changes do not auto-publish new interpretation or translations. |
| Export and deletion cleanup | User-confirmed job or retention expiry | Verify owner and current status at every step; remove temporary files; bounded retries and operator-visible failure. No sensitive payload in queue logs. |

Classify errors as retryable transport, HTTP 429 or 5xx, unauthorized provider, invalid schema, unsupported coverage, or valid no-record response. Retry temporary failures with jitter and a bounded attempt policy; invalid schemas and permission failures require review rather than endless paid retries. A lease expiry permits another worker to resume, not to repeat an external side effect without checking its key. All jobs recheck household deletion state before private reads/writes.

Change detection must be semantic. Reordered JSON, renewed retrieval time or a source wording correction must not create a worsening-condition alert. Retain old/new values, event kind, effective period, applicable scope and source correction flag. A withdrawn advisory, cancelled event or invalidated interpretation creates a distinct update. New subscriptions establish a baseline instead of flooding the inbox with historical changes; the user can still inspect history explicitly.

Forecast watches stop at activity end/cancellation and consider only the periods, factors and region actually supported by the selected provider. Evaluate a source's genuine category change or reviewed material difference, not arbitrary visual rounding. Task snooze affects the selected reminder or occurrence and does not alter the underlying scientific record or official event time.

### Proposed refresh classes

These are planning targets, not source guarantees. Confirm them against provider cadence, terms, quotas, user coverage, and cost before implementation.

| Data class | Proposed approach | User-facing meaning |
| --- | --- | --- |
| Current outdoor conditions | Shared cache refreshed within an appropriate 15 to 60 minute window while used, with measured provider cadence respected | Latest available observation or model output, with its actual time |
| Forecasts | Refresh near provider releases or on stale reads, not once per household request | Forecast issued at a stated time, valid for stated periods |
| Urgent official advisories | Frequent polling or supported feed delivery only where operationally sustainable | Last checked time and link to official instructions; HALO is not an emergency dispatch service |
| Utility laboratory results | Check source releases or scheduled imports; notify after validated new records | New published evidence, not continuous tap monitoring |
| Fish and food advisories | Check official sources on a reviewed schedule, with human review when automated interpretation is unsafe | Current known advisory and last verification, not continuous food testing |
| Drought and conservation notices | Ingest drought on its actual weekly publication cycle; check utility notices on a separately verified schedule | Regional drought and utility restrictions are distinct, with their own dates and scope |
| Conservation events | Recheck approaching events and source changes more often than distant records | Organizer information can change; registration is confirmed by the organizer |
| Tests and maintenance | Monitor household-record states and chosen reminders | HALO tracks the process and reported result, not an absent physical sensor |
| Gardens | Track official updates, entered observations, recorded tests, and chosen tasks | No claim to continuously detect soil or crop chemistry |

No job may infer a normal condition from a failed fetch. Distinguish provider outage, unsupported coverage, missing record, stale record, and withdrawn record. A successful HTTP response with malformed or unexpectedly empty content is an ingestion failure until validated.

## Reliability and cost targets

The following are proposed acceptance budgets to validate in staging, not claims about current performance:

- Cached reads should normally respond within 1 second at the 95th percentile, and ordinary private writes within 2 seconds under the agreed test load. Report provider-dependent operations separately.
- A cached screen must remain usable during source failure, with honest stale labels. Writes should acknowledge only after durable persistence, and jobs only after durable acceptance.
- Paginate lists and job scans. Start with a maximum page size of 100 records and explicit limits for large history queries and exports.
- Set per-provider call and spending budgets, share public source requests by permitted spatial/time resolution, and degrade the affected feature when a budget is reached. Preserve existing assistant global and per-user limits unless deliberately revised.
- Proposed attachment start: allowlisted PDF and common image formats, at most 10 MB per file and a clearly disclosed household storage budget. Review these limits with real test documents before launch. Do not accept executable formats or trust file extensions alone.
- Proposed routine reminders: dispatch within 15 minutes of the selected time under normal operation, with visible delay when the scheduler is impaired. Do not market this as a safety-critical alarm guarantee.
- Monitor request failures, latency, source staleness, queue age, failed job count, missed scheduled jobs, RLS denials, attachment failures, and notification delivery. Page the operator for persistent actionable failures, not every transient retry.
- Establish backup and restore coverage for both database rows and object storage before enabling valuable user records. Define and test recovery objectives against the selected hosting plan rather than inventing a promise.

## Privacy and security requirements

Maintain the existing minimization: approximate home coordinates and category presence without names, birthdates, or required child accounts. Additional details are optional and requested at the point of use. A garden, outing, or event should not require collecting a home address when approximate context is enough.

All private tables require ownership policies, tested positive and negative access cases, and deletion relationships. Public imports have no client write policies. Editorial roles are separate from ordinary users and audited. Logs use request IDs and source/job metadata, not raw Journal notes, precise locations, health summaries, or complete model prompts.

Attachments stay in private buckets. Upload authorization, content-type validation, file scanning where feasible, signed URLs with short expiry, download authorization, quotas, and deletion are required. Extracted text is untrusted input and needs explicit correction before becoming a verified result. Stale preview URLs and object copies must be considered in deletion and retention design.

Deletion cancels future jobs and subscriptions, revokes active shares, removes object storage, clears application caches, and deletes private records. Database cascades alone do not remove blobs or third-party processing history. The privacy explanation must accurately distinguish local deletion, server deletion, backups, and provider retention.

Household categories and symptoms are sensitive even without a name. Consent for notifications, recovery, model context, export, and third-party sharing must remain separate. Product evaluation uses consented usability sessions and nonsensitive research notes by default. Production behavioral analytics are not assumed; adding them requires a separate explicit privacy decision consistent with existing expectations. Operational reliability metrics must not contain free-text notes, source attachments or private prompts.

### Attachment and document lifecycle

Use one private attachment service for tests, site records, instructions, observations and optional exports. Do not independently implement uploads in each feature. Proposed flow is create upload intent, validate owner/domain/quota, upload into quarantine, verify actual type/size/checksum, scan, remove metadata in display/share derivatives, then finalize its authorized record binding. Unscanned, rejected or expired uploads cannot be publicly viewed or passed to Luna. Enforce quotas on both intent and finalization so concurrent uploads cannot bypass them.

Before the first valuable private record or lab upload, explain anonymous-session loss and the actual available recovery/export options. Do not promise recovery that is only on the roadmap, and do not defer this warning until after accepting an irreplaceable file. Anonymous use can continue after an informed choice; new recovery must remain optional and real.

If document extraction is enabled, store its parser version, source-page locator, uncertain fields and original text. The user compares the original and confirms a transcription. Extraction never silently supplies a missing unit, lab, analyte, sample date or limit. Render documents in a restricted viewer; do not execute active HTML/SVG/macros from an upload. Source parsers and external URL fetchers need allowlists, private-network/redirect protection and bounded download/decompression sizes. Files are untrusted content even when uploaded by their owner.

Signed URLs are short-lived and authorized on issuance; revocation stops future issuance but cannot recall an already downloaded copy. Original image metadata may be important to a private record but must not escape through thumbnails or report exports unintentionally. Record the user's chosen exact/coarse/no-location export scope and test the generated file metadata, not only the visual preview.

### Retention and export coverage

Publish actual configured retention periods before collecting new private data. The following target policy identifies required choices without claiming an unimplemented legal or hosting guarantee:

| Data class | Proposed retention and user control | Required release proof |
| --- | --- | --- |
| Household profile and category records | Retained while the household is active; editable; removed through full deletion | Current identity, old home contexts and linked records cannot survive invisibly outside documented retention. |
| Journal and private home records | Retained until user deletion or clearly disclosed inactivity policy; distinct Clear Journal scope | Export and deletion list actual rows, derived findings and attachments. Inactivity purge cannot surprise a user with valuable records. |
| Chat | Default no durable transcript beyond the selected session unless history is explicitly enabled | UI states actual server/browser/provider retention separately. Provider policy is reviewed, not inferred from no local table. |
| Local drafts | Session-only by default; optional device persistence requires disclosure and identity binding | Clear/logout/delete removes owned drafts and sensitive caches. Shared devices do not reveal a former identity's draft. |
| Temporary uploads and export artifacts | Short configured expiry and scheduled cleanup, with cancel/delete available | Interrupted uploads, derivative files and expired downloads are actually removed; signed URL expiry alone is not deletion. |
| Notifications and action audit | Bounded private history with explicit archive/delete policy | Read/dismiss/expiry semantics do not leave hidden sensitive payloads in a separate log forever. |
| Public evidence and guidance revisions | Retained as needed for provenance and referenced history within source terms | Licensing/retraction rules are obeyed and withdrawn content is not reused as current guidance. |
| Operational logs and job receipts | Short, minimized retention; identifiers/error codes rather than private content | Access limited to operators, retention configured and reviewed, diagnostic output does not leak provider secrets. |
| Backups | Provider-specific window documented separately from active-record deletion | Restore procedure reapplies deletions/tombstones before restored data becomes accessible; recovery window and file coverage tested. |

Full export returns a manifest of requested scopes, record counts, schema version, generation time, warnings and omitted unavailable files. Include original values, qualifiers and source links in machine-readable records; a screenshot-only export cannot preserve a laboratory result or Journal history. The human-readable H08 summary is a separately selected subset. Exports are owned artifacts with expiry, not public app routes.

Full deletion needs an orchestration record outside the to-be-deleted private graph containing only the minimum non-content receipt needed to reconcile progress. Stop new jobs and revoke sessions/shares as designed, cancel outbox/reminders, delete blobs/derivatives and private rows, then finalize identity removal. An interrupted multi-step operation must resume and report partial or pending status honestly. The design of a status receipt after identity deletion must not create a household lookup or reusable recovery credential. Do not retain health/location/content snapshots in a deletion audit. Selective deletion must not delete an unrelated garden/test because a shared action points to it.

### Recovery and consent implementation gate

Choose one supported recovery method before advertising recoverability: verified account linking or a carefully designed device-transfer/recovery credential flow. Prefer the existing identity provider's supported capabilities over custom password/session storage. Define verification, replay expiry, account-collision resolution, device revocation, lost-device behavior and rollback. Never merge two identities' records solely because they share an address, email-looking string, device label or household ID. Export does not constitute account recovery.

Consent records need purpose, disclosed policy/version, effective choice/time and revocation. Model-context permission, transcript storage, browser push, reminder channels, private-file processing and external export are separate purposes. A declined purpose must not block unrelated core use. If children can use the product directly rather than an adult managing household-category information, complete a separate audience/privacy review before expanding age collection, accounts or sharing; category selection alone does not authorize collecting children's identities.

## Deployment configuration and operational readiness

Configuration below is identified from source code by variable name only. No secret values, provider account settings, deployed environment, migration ledger, or actual production job execution were inspected. A variable named in source is not evidence that it is correctly configured. Do not add service-role keys, model keys, private VAPID keys or scheduler secrets to `NEXT_PUBLIC_` variables or committed fixtures.

| Configuration group | Current source names or implementation | Verification before release |
| --- | --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; anonymous bootstrap and `requireUser` | Separate development/staging/production projects or demonstrably isolated test identities; anonymous auth/CAPTCHA policy; RLS on all private tables; key rotation and no client secret bundle. |
| Human verification | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and provider-side auth configuration | Domain allowlist and challenge verification actually work; inaccessible challenge has a supported recovery path, not silent bypass. |
| Geocoding and map | `MAPBOX_TOKEN`, ArcGIS adapter; production renderer chosen separately | Server geocoding credential permissions/quotas, public rendering token if needed restricted by origin/scope, attribution, allowed cache and data terms. No reuse of a private server token in a client renderer. |
| Environmental providers | `AIRNOW_API_KEY`, `GOOGLE_POLLEN_API_KEY`, existing Open-Meteo/NWS/OpenUV adapter paths | Verify keys/access, API shape, supported geography, polling limits, declared units/source times and fallback behavior for each adapter. Review any hardcoded provider configuration without exposing it in logs. |
| Redis and budget guards | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, current limiter policies | Connectivity and scopes, shared cache persistence/TTL, circuit breakers and fail-open versus fail-closed spending consequences. Anonymous identity creation is not itself an abuse limit. |
| Luna provider | `ASSISTANT_MODEL_KEY` or `OPENAI_API_KEY`; `ASSISTANT_CHAT_URL`, `ASSISTANT_CHAT_MODEL`, `ASSISTANT_CHAT_FALLBACK_MODELS`, `ASSISTANT_EMBED_URL`, `ASSISTANT_EMBED_MODEL`, `ASSISTANT_EMBED_DIM` | Approved provider processing policy and permitted domains, model/token costs, timeouts and citation tests; model/dimension/corpus/RPC compatibility and retained provenance. Do not switch providers as an undisclosed privacy fallback. |
| Luna privacy and spending | `ASSISTANT_SEND_HOUSEHOLD_CONTEXT`, `ASSISTANT_GLOBAL_DAILY_LIMIT` | Explicit effective configuration returned to clients; missing context flag currently enables context. Proposed user consent must be enforced server-side. Global cap retains fail-closed behavior when budget service fails. |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; browser uses the corresponding public application-server key | Public/private pair, secure service-worker scope, allowlisted notification destinations, subscription lifecycle, browser/platform support and physical-device delivery tests. Backend sender existing does not prove every frontend registration path exists. |
| Scheduler | `CRON_SECRET`, `vercel.json`, current 60-second maximum routes | Host actually dispatches authorized jobs on the supported schedule. Prefer header secret, retire logged query-secret use carefully. New reminder cadence needs real scheduler capacity. |
| Previews and isolated tests | `HALO_ENABLE_FRONTEND_PREVIEW`, `HALO_STAGE_TEST`, fixture routes and isolated build output | No fixture payload on live routes, no test writes to shared production, previews cannot become an authentication bypass or leak private state. |
| Proposed platform additions | Private storage buckets, queue/lease tables, source flags, retention settings, content-review roles | Configure only when the corresponding feature is enabled; stage secret rotation, backup, dead-letter review and rollback before taking user records. These are not existing deployed capabilities. |

The current rate-limit module enables provider-side limiter analytics. Inventory what identifiers/metadata that service records and align actual retention with the privacy explanation. Operational metrics are not automatically anonymous because they exclude names. Do not introduce behavioral analytics as an incidental dependency of the new pages.

Recommended release gates are feature flags per complete capability, not many permanent per-component flags. At minimum distinguish approved core, actions/Plan, private records/uploads, food-advisory sources, opportunities/observations, forecast watches, recovery and expanded Luna. Flags must be enforced server-side where they change writes, provider spending or data processing. Disable unavailable capabilities with an honest explanation; do not expose an enabled-looking control that can never succeed.

Maintain an environment-specific readiness report recording deployed commit, schema version, content/source versions, enabled features, scheduler success/watermarks, provider test outcomes, current budgets, storage/deletion drill, and test evidence. Health probes must be bounded/rate-limited and restricted appropriately; do not have normal page loads repeatedly call all external providers. Public status reveals high-level availability only, not internal addresses, stack traces, credentials or household identifiers.

### Backup recovery and rollback runbook

1. Record the current deployed code/schema/content versions, valid provider credentials without copying values, queue watermarks, storage inventory and latest successful backup.
2. Restore database and private objects in an isolated environment with outbound reminders, model calls, emails and other side effects disabled.
3. Reapply completed deletion records, verify ownership/RLS, validate file hashes and links, and reconcile source/job checkpoints before enabling reads.
4. Test representative household histories, a pending result, recurring action, retained evidence revision and expired share. Demonstrate that restored queues cannot resend old notifications blindly.
5. Switch traffic only under an authorized operational release; observe error rate, latency, stale source count and job backlog. Preserve a reversible prior compatible code version.
6. If a new interpretation is wrong, disable its producer/UI claim and publish correction state while retaining original evidence. If a schema migration fails, forward-fix or disable the dependent feature without destroying user records. Test both source rollback and private-write rollback in staging.

Recovery time, acceptable data-loss window and on-call response targets depend on the chosen hosting tier and budget. Vibhav must record measurable accepted values before release; this plan does not promise a backup feature or recovery objective the deployment has not demonstrated.

## Migration and rollout plan

1. Audit the current deployed schema, migration ledger, policies, scheduled jobs, environment configuration, source permissions, and backup coverage using read-only checks before a migration is prepared.
2. Add versioned, additive tables and fields for shared evidence and actions first. Write policies and cross-household tests with the migration, not after release.
3. Introduce source adapters and feature flags. Shadow-validate new interpretations against stored fixtures without changing existing displayed scores or sending notifications.
4. Backfill in bounded resumable jobs, retaining original source dates and tagging derivations. Quarantine ambiguous units, qualifiers, geography, and legacy records rather than guessing.
5. Expose new contracts to isolated preview and staging fixtures. Keep sample records explicitly separate from live household data.
6. Roll out one complete connected journey at a time after user review, source validation, contract tests, and negative-path testing. A staged delivery order does not remove later planned features.
7. Monitor freshness, job lag, writes, access isolation, and notification volume before increasing coverage.

Rollback should disable the new feature or producer while preserving user-entered records and the older compatible contract. Avoid destructive down-migrations once a feature has user data. If an interpretation is wrong, withdraw that version, label affected records, and recompute from preserved evidence after review. Do not rewrite history as though the incorrect version never existed.

## Backend acceptance requirements

The detailed screen checks live in [HALO Feature Acceptance](HALO_FEATURE_ACCEPTANCE.md). Backend completion additionally requires:

- Every promised live feature has a validated source or a clearly labelled user-input workflow, not only a successful empty response.
- Every mutation is idempotent where retried, ownership-checked, schema-validated, and safe under concurrent edits.
- Unknown, true zero, non-detect, partial coverage, stale, invalid, and withdrawn records have distinct tested outcomes.
- Time zones, daylight saving changes, corrected source records, duplicate imports, and delayed notifications do not corrupt schedules or comparisons.
- Journal denominators, category scope, retrospective status, and illness exclusions are tested against known fixtures.
- Household tests retain original units, qualifiers, and sample context; ambiguous input cannot silently drive a score.
- Source outages, quota exhaustion, dropped connections, job restarts, and attachment failures preserve honest states and allow recovery.
- Export and deletion cover rows, files, derived reports, shares, reminders, and queues, with the provider-retention limitation stated accurately.
- No public layer, cache key, assistant context, signed URL, log, or export leaks another household's data.
- A complete restore drill and a rollback drill succeed in an isolated environment before valuable records are accepted in production.

## Repository evidence

The following inspected files support the existing-capability statements and identified limitations. Relative links refer to this repository, not a verified production deployment.

- [Workflow and preservation](../WIREFRAME_WORKFLOW.md) and [approved stage handoff](../foundation/STAGE_FRONTEND_HANDOFF.md).
- [Daily source acquisition](../../lib/dailyReadings.js), [daily response contract](../../lib/dailyPayload.js), and [scoring](../../lib/scoring.js).
- [Current profile](../../app/api/profile/route.js), [household replacement and preferences](../../app/api/household/route.js), and [onboarding transition](../../app/api/onboard/route.js).
- [Historical backfill basis](../../lib/backfill.js) and [history response](../../app/api/history/route.js).
- [Homeguard route](../../app/api/home-guard/route.js), [action recommendation logic](../../lib/actionPlan.js), and [household categories](../../lib/household.js).
- [Journal route](../../app/api/journal/route.js), [comparison algorithm](../../lib/journalAnalysis.js), and [Journal schema](../../supabase/migrations/0003_symptom_logs.sql).
- [Map sources](../../lib/mapLayers.js) and [map cache schema](../../supabase/migrations/0011_map_layers.sql).
- [Organization route](../../app/api/volunteer/route.js) and [directory review metadata](../../supabase/migrations/0004_volunteer_orgs.sql).
- [Daily scheduled work](../../app/api/cron/daily/route.js), [notification preferences](../../app/api/notifications/route.js), and [alert and push schema](../../supabase/migrations/0010_alerts_notifications.sql).
- [Scheduler configuration](../../vercel.json), [current alert rules](../../lib/alertRules.js), [alert inbox](../../app/api/alerts/route.js), and [push delivery](../../lib/push.js).
- [Assistant route and context flag](../../app/api/assistant/route.js), [household context collection](../../lib/assistantContextData.js), and [client identity handling](../../lib/auth.js).
- [Embedding migration](../../supabase/migrations/0013_assistant_embed_2048.sql), [verified server identity](../../lib/serverAuth.js), [budget guards](../../lib/ratelimit.js), and [reachability probes](../../app/api/health/route.js).
- [Anonymous identity and cascades](../../supabase/migrations/0001_anon_auth.sql), [household ownership](../../supabase/migrations/0002_household_and_profile.sql), [location minimization](../../supabase/migrations/0009_daily_details_and_state.sql), and [account deletion](../../app/api/account/route.js).
