# HALO Source Acquisition Guide

Prepared for Vibhav and Yogi on October 3, 2026. This is the source-level companion to the [Backend and Data Plan](HALO_BACKEND_AND_DATA_PLAN.md) and [Backend Build Handoff](HALO_BACKEND_BUILD_HANDOFF.md). It identifies where the full planned product obtains its information, what must be stored, and which interpretations cannot ship yet. It is a development specification, not a claim that the integrations are implemented or that production credentials and permissions have been checked.

The audit covers all 45 feature groups in the master plan. Existing Today detail pages retain their approved depth. No feature is removed because its source needs review. Where automated acquisition cannot support a claim, the implementation uses reviewed official records, an honest coverage state, or an explicitly private user record. It must not substitute fabricated measurements.

## Verification and limitations

Four evidence levels are used below:

- **Sample checked:** a bounded public request returned a payload whose relevant fields were inspected. This does not establish complete coverage, permission to retain data, or reliability.
- **Documentation checked:** the official documentation or publication was read. A production credential, complete import, or parser has not been tested.
- **Reviewed content:** the source supports a human-reviewed record and external handoff. Do not imply a supported transactional API.
- **User record:** the household supplies the information; HALO supplies storage, validation, provenance and follow-through, not independent measurement.

The [verification report](verification/SOURCE_CHECKS_2026-10-03.md) records actual requests, selected response fields, hashes and failures. The [public probe script](verification/probe-public-sources.mjs) is explicit-run, read-only and does not read environment files, credentials or household information. No HALO production route, cron, mutation, provider billing account or deployed Supabase schema was tested. Do not mistake this documentation audit for a deployment audit.

## Findings that change implementation

1. **Food notices have a real API option.** openFDA food enforcement returned PFAS-related historical recall records. Use this for scoped notices, not laboratory concentrations or a universal food checker. The sampled recall was terminated, so the status must survive every transformation.
2. **NC fish data is accessible but not ready for automatic interpretation.** Public services behind the official dashboard were located and sampled. One row has truncated advisory text and an apparent audience/meal-limit conflict. The full official advisory must resolve it before publication.
3. **NC utility conservation status has a public service.** Its sampled fields support dated utility status. They do not contain the complete local restrictions or prove that the endpoint has a support or reuse agreement.
4. **Google Pollen needs explicit retention classes.** Existing code stores pollen in daily history. The current non-EEA service-specific terms allow today's forecast values for 365 days and other forecast/heatmap values for 24 hours, with deletion afterward. Confirm account applicability and implement the correct retention classes rather than assuming a blanket storage ban or indefinite retention. Map display, exports and model-context rights still need review. Do not delete existing user history as part of this planning task.
5. **Geocoding storage needs a licence check.** Current onboarding uses Mapbox v5 and stores rounded coordinates. Rounding is not evidence of storage permission. Check the actual account/version entitlement before expanding home contexts.
6. **A source can be technically reachable but semantically unusable.** NWS null precipitation is not established as zero by this audit; the current proxy parser's assumption needs correction or authoritative justification. EPA regulatory comparisons need versioned interpretation and cannot become automatic violation claims.
7. **Dataset versions matter.** The WQP legacy service has a documented recent-USGS-data limitation. District boundaries, service boundaries, regulatory references and static lead inventories must carry release versions, not just download dates.

## Registry required for every external source

Implement one source registry. A source may have several endpoints, parsers and coverage classes. Fields below are proposed HALO fields, not assertions that providers return them.

| Record | Required fields and invariants |
| --- | --- |
| Identity and access | `source_id`, issuer, official landing URL, endpoint allowlist, access mode, secret reference name only, source owner/contact, operational owner, enabled domains, supported geography. No credentials in records or client bundles. |
| Permission | Terms URL, checked date, applicable account agreement, attribution text/assets, retention rules, redisplay/export/model-context rights, map restrictions, approval state and next review. Unknown permission blocks the affected use, not every unrelated page. |
| Cost and cadence | Quota by interval, account billing tier, request weights, maximum daily/monthly spend, expected source release cadence, HALO check interval, stale policy, timeout and retry policy. Values must be verified for the actual account. |
| Acquisition run | Requested URL with secrets removed, request parameters excluding private data, HTTP status, provider request ID if supplied, start/end, bytes, content hash, ETag/Last-Modified if supplied, parser version, expected and received counts, pagination completion, rejects and failure class. |
| Publication | Source record identity, raw snapshot reference only where permitted, normalized revision, exact source locator, scope, source dates, review status, reviewer, publication/withdrawal event, superseded revision. Never treat `retrieved_at` as sample date. |
| Coverage | Parameter/matrix/geography/time coverage, unsupported queries, known exclusions, dataset complete/partial status, available history/forecast horizon and actual resolution. Missing data is not zero. |

Every source adapter returns `records`, `coverage`, `source_run_id`, `complete`, `next_cursor`, `warnings` and classified errors. Publication is a separate operation. A successful first page cannot publish an apparently complete dataset or withdraw all missing records.

## Outdoor conditions and forecasts

### S01 AirNow

**Status:** existing adapter; documentation checked, authenticated calls not made. Read the [service catalogue](https://docs.airnowapi.org/webservices) and [FAQ](https://docs.airnowapi.org/faq). Observation latitude/longitude queries return reporting-area data, not necessarily an individual nearby monitor. Forecasts can be category-only and have variable coverage. The FAQ recommends appropriate caching and file products for bulk database acquisition instead of looping over locations.

**Acquire:** existing `https://www.airnowapi.org/aq/observation/latLong/current/` with bounded latitude, longitude, distance, JSON format and server-side `AIRNOW_API_KEY`. Existing station layer uses `https://www.airnowapi.org/aq/data/` with dates, bounding box and parameters. For forecasts, obtain the exact current reporting-area request and sample from the authenticated service documentation before implementing it; an unverified forecast URL is not specified here as working.

**HALO mapping:** preserve `DateObserved`, `HourObserved`, `LocalTimeZone`, `ReportingArea`, `StateCode`, coordinates, `ParameterName`, `AQI` and category when supplied. Validate provider sentinel values and time-zone conversion. Keep station identity/time separate from area maxima. Dominant pollutant calculation must retain all available inputs.

**Operations:** share permitted requests by actual reporting area, not arbitrary home rounding; initial target hourly observations and source-cadence forecasts. Test category-only forecasts, missing pollutant, empty coverage, stale dates, rate limit and changing area association. Current per-household cron acquisition needs a source-budget review before scale-up.

### S02 Open Meteo

**Status:** current UV and air payloads sample checked. [Forecast documentation](https://open-meteo.com/en/docs), [air quality documentation](https://open-meteo.com/en/docs/air-quality-api) and [terms](https://open-meteo.com/en/terms) were checked. Free-service eligibility and commercial use differ; verify HALO's actual use and account. Retain required attribution, including the air model provider where required.

**Acquire:** `https://api.open-meteo.com/v1/forecast` for supported UV/weather fields and `https://air-quality-api.open-meteo.com/v1/air-quality` for modelled AQI. The probe includes exact successful query examples. Current free requests need no key; a paid deployment may require a customer endpoint and credential configured separately.

**HALO mapping:** latitude/longitude of returned grid, time zone/offset, `current.time`, `current.interval`, current units, hourly timestamps/units and values. Label modelled/forecast values accurately. `generationtime_ms` is processing duration, not model issue time. If a model run time is unavailable, return unknown rather than substituting retrieval time.

**Build:** per-factor forecast periods, UV windows that preserve gaps, history basis metadata and source-specific null handling. Preserve time offsets through DST. Existing backfill uses daily maxima and must not be merged invisibly with current snapshots. Validate the current `past_days` and requested daily variables with real historical fixtures before claiming backfill readiness. One successful present-day probe does not prove historical endpoints.

### S03 NWS weather alerts and mold inputs

**Status:** points and hourly forecast sample checked; [official API documentation](https://www.weather.gov/documentation/services-web-api) checked. No key is currently required by the documented workflow; use an identifying User-Agent with a maintained contact and the actual provider's limits.

**Acquire:** `https://api.weather.gov/points/{lat},{lon}`, then its returned `properties.forecastHourly`; alerts through `https://api.weather.gov/alerts/active?point={lat},{lon}`. Do not hardcode a grid forever. Sampled grid was `GSP/127,74`, which is a test location, not a production default.

**HALO mapping:** forecast generation/update times, time zone, each period's start/end, native units, relative humidity, precipitation probability, temperature and wind. Alert records need official ID, event, status, message type, sent/effective/onset/expires/ends, severity/certainty/urgency, affected area, description, instructions and update/cancel references when returned.

**Critical gate:** `moldFromNws` currently converts null precipitation to zero under a code comment. Treat missing input as unknown unless an endpoint-specific documented exception is proven. Select the interval applicable to now, not blindly the first array entry. Version any changed proxy and test before updating historical interpretations. This remains a weather-based indicator, not a spore measurement.

### S04 Google Pollen

**Status:** adapter exists; [request schema](https://developers.google.com/maps/documentation/pollen/reference/rest/v1/forecast/lookup), [billing](https://developers.google.com/maps/documentation/pollen/usage-and-billing) and [policy](https://developers.google.com/maps/documentation/pollen/policies) checked. No paid credential call was made. The schema supports one to five daily records, subject to actual coverage, not hourly pollen.

**Acquire:** `GET https://pollen.googleapis.com/v1/forecast:lookup`, location, `days`, optional language and paging. Server key `GOOGLE_POLLEN_API_KEY`, enabled billing and restricted key scopes. Map `regionCode`, `dailyInfo.date`, pollen type code, `inSeason`, `indexInfo` value/category/code and missing types; keep the provider index separate from concentration.

**Retention implementation:** the [current non-EEA service-specific terms, section 16](https://cloud.google.com/maps-platform/terms/maps-service-terms) explicitly permit caching today's forecast values for 365 consecutive days and other forecast/heatmap values for 24 hours, followed by deletion. These exceptions are more specific than the policy page's general summary. Confirm HALO's account jurisdiction/agreement; classify each acquired value at acquisition and store a rights-based expiry. Do not retain a multi-day forecast indefinitely because its valid date later becomes today. Review treatment of derived values, exports, backups and Luna context separately.

**Display gate:** the policy prohibits displaying pollen results on non-Google maps and specifies attribution. Ordinary cards do not require a map. Do not add a pollen layer to HALO's non-Google map incidentally. A properly permitted one-year today-value history may support the planned history window; longer retention needs separate rights. Test expiry and incomplete older series without deleting unrelated Journal entries or task records. No alternative provider is required merely because these retention classes exist.

### S05 OpenUV fallback

**Status:** current adapter inspected; [provider site](https://www.openuv.io/) was reachable but exposed no useful text in the research tool. Current plan entitlement and quota remain unverified.

**Acquire:** existing `https://api.openuv.io/api/v1/uv?lat={lat}&lng={lon}` with server `OPENUV_API_KEY` in `x-access-token`. The existing fallback guard is reused. Confirm `result.uv`, source time, units, error shape, retention and attribution using the real account before enabling it. Do not rely on the code comment about a free daily allowance as a current entitlement.

**Failure:** fallback unavailable means missing UV, not zero. This source does not automatically supply every hourly forecast period required by outdoor planning.

## Water home risks and geography

### S06 UCMR occurrence data

**Status:** official download index checked; complete current release not downloaded or parsed in this audit. [EPA's occurrence page](https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule) links nationwide and state text archives. The index currently identifies a July 2026 summary. The year in an archive URL is not the data's release date.

**Acquire:** `https://www.epa.gov/system/files/other-files/2023-08/ucmr5-occurrence-data-by-state.zip` or the corresponding `ucmr5-occurrence-data.zip` linked from that index. Public download, no account key identified. Use a bounded scheduled import, not a browser request or a 60-second page handler. Retain a release manifest/checksum and reviewed dictionary; bound compressed and expanded sizes.

**HALO target fields:** source system ID/PWSID, system name/state/type where supplied, sample/event/point IDs, collection date, analyte identity and source label, reported result text, numeric value only if valid, units, qualifier, reporting limit, method, water/sample context and release revision. Exact upstream column mapping must be completed against the downloaded dictionary before ingestion. Preserve non-detect and tested-but-not-detected rows. Existing utility aggregates alone cannot recover discarded sampling metadata.

**Build:** deterministic import and reconciliation, stable sample identities, corrections/deletions after complete-release validation, legacy aggregate compatibility, `tested_count` with a valid denominator, new-publication events and map quarter queries. No reproducible UCMR acquisition script was found in the inspected `scripts` directory. Obtain the existing import procedure and reconcile it before replacing its output.

### S07 Water service boundaries

**Status:** existing layer metadata sample checked; [EPA source page](https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas) links the same service. It describes mixed authoritative and modelled boundaries and version updates. Association is not proof that a particular property is served.

**Acquire:** `https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query`. Use point intersection for association, PWSID for record retrieval, explicit spatial reference and paginated/ID-batched queries. Metadata returned a 2,000-record maximum.

**HALO mapping:** `PWSID`, `PWS_Name`, `Population_Served_Count`, `Original_Data_Provider`, `Data_Source`, `Model_Method`, `Verification_Status`, `Original_Data_Created_Date`, geometry and source revision. Existing code currently requests fewer fields. Store candidate matches and association method. Overlaps need disambiguation; no match does not establish private-well use. Never relabel a modelled polygon match as a measured household result.

**Operations:** review on source releases, bounded refresh, geometry checks, coordinate reference tests and index validation. Keep the prior context on a failed address transition without assigning its utility to the new location. Verify reuse terms and attribution at the dataset/item level; an empty copyright field is not a permission grant.

### S08 Radon context and testing guidance

**Status:** existing static county lookup; [EPA zone source](https://www.epa.gov/radon/epa-map-radon-zones) checked. County zones are regional context and cannot decide a home's test result.

**Acquire:** reviewed county zone release and documented source link; no new live sensor API. Preserve state plus county FIPS, zone, release/version and matching method. Audit the existing NC lookup against the official release and store unknown outside coverage. Reviewed testing content supplies method/duration/unit interpretation requirements. Household reports use private tests, not replacement county values.

**Gate:** map every current static county value to a source revision; verify test guidance before shipping interpretation or reminders. An operator review updates public guidance, not past private test values.

### S09 Lead inventory and plumbing

**Status:** repo static July 2025 inventory source inspected; [NC DEQ inventory page](https://www.deq.nc.gov/about/divisions/water-resources/drinking-water/lead-service-line-inventory) checked. Repo data references `https://www.deq.nc.gov/water-resources/pws/lead-service-line-inventory-july-2025/download?attachment`. The current complete download and column mapping were not re-imported.

**HALO mapping:** PWSID, inventory reporting date, source release, lead/galvanized/non-lead/unknown counts and any source definitions. Keep home-year estimate separate from utility totals and private plumbing evidence. A stored note saying no address-level data exists must not be generalized into a claim that no utility has published a newer local inventory.

**Build:** reviewed release importer, null-aware totals and utility correction pathway. A specific service-line result requires an actual utility/property record and user-confirmed applicability. Lead remains shown but excluded from the approved composite. No new source is required merely to let a household save a question or test.

### S10 ECHO facilities

**Status:** a bounded current query returned a QueryID and 11 rows for the test county; result-page ingestion was not validated end to end. [ECHO services](https://echo.epa.gov/tools/web-services) and [all-program search](https://echo.epa.gov/tools/web-services/facility-search-all-data) are the official references.

**Acquire:** existing `https://echodata.epa.gov/echo/echo_rest_services.get_facilities` followed by `.get_qid`, retaining the documented columns and all pages. Use the existing active-major/repeat-noncompliance selection deliberately; it is not a complete census of every local facility. QueryID is transient, not a stable facility identity.

**HALO mapping:** registry/program IDs, name, coordinates, program scope, compliance categories and time basis, quarters in noncompliance, inspection/penalty dates and amounts where supplied, official detail URL. Program counts are not distinct violation counts. Public regulatory evidence does not identify the cause of household exposure.

**Operations:** use bulk downloads if scale warrants, source-appropriate refresh, last-good dated cache, explicit partial coverage, schema drift checks and coordinate-null list entries. No public layer may include a private home pin in shared exports.

### S11 County and district geometry

**Status:** [Census TIGER files](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) and [NC legislative redistricting source](https://www.ncleg.gov/Redistricting) checked. The latter distinguishes the enacted 2025 plan for the 2026 elections. Do not confuse election boundaries with the currently serving district at another effective date.

**Acquire:** versioned official boundary download with state/county/district identifiers, coordinate reference and effective use dates. Validate the chosen product against `lib/data/nc08District.json`, `lib/data/ncCounties.json` and the map preview assets. Record a checksum and the exact download URL in the import manifest before production.

**Build:** boundary-version-aware aggregation, point/polygon attribution, partial-county flags, explicit denominator and missing-population counts. Geographic assignment by centroid is an approximation and cannot allocate all utility customers precisely to districts. A changing geometry version requires aggregate recomputation and separately labelled history, not silent rewriting. Representative contact links need a current official directory review before automatic addressing.

## Food fish gardens and stewardship

### S12 FDA food sampling publications

**Status:** [FDA PFAS testing publication](https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure) checked. It describes limited food sampling and targeted investigations. It does not establish a universal local-product lookup or a continuous farm monitoring service. Study-table extraction remains a reviewed-import task.

**Acquire:** follow the publication's study/result links, retain their original locator and revision, and manually validate the selected table extraction. Store study/sample identity, commodity, tested matrix, analyte, concentration/unit/basis, qualifier/limit, method, collection dates and geographic/product scope only where actually supplied. Unknown brand, lot or farm stays unknown.

**HALO behavior:** broader research findings are visibly separate from an applicable notice. A food category result must not be assigned to every item in that category. Guidance and questions can lead to Plan; a user-held laboratory report stays private. Water thresholds cannot interpret food or soil concentrations.

**Gate:** reviewed real rows and units, a permission/attribution review, publication-date parsing and checks against the original table. No API, local contamination rate, ingestion frequency or product coverage is invented to fill this gap.

### S13 NC fish advisory records

**Status:** public service schemas and sample rows checked. Discovery chain: [official landing](https://epi.dph.ncdhhs.gov/oee/fish/arcg.html), [official StoryMap](https://storymaps.arcgis.com/stories/eab23dd84e8b403b95dc1223703aa487), [embedded dashboard](https://experience.arcgis.com/experience/470cb0bb993a47969f065e6087282286/). Its public configuration exposes the following services:

- `https://services.arcgis.com/iFBq2AW9XO0jYYF7/arcgis/rest/services/FA_Lakes_Rivers_Points2/FeatureServer/32`
- `https://services.arcgis.com/iFBq2AW9XO0jYYF7/arcgis/rest/services/FA_Lakes_Rivers_Points_Complete/FeatureServer/38`

**Acquire:** metadata `?f=json`; bounded `/query` with selected fields, pagination, `returnGeometry` and explicit `outSR=4326` when requesting geometry. Public samples needed no key. This establishes technical access, not a supported feed agreement. Official item metadata had no explicit licence; confirm permitted retention/redisplay and maintain a reviewed-content fallback.

**Mapping:** `Wtr_Bdy`, `Site`, `Fsh_Spc`, `Polltnt`/`Pollutnt`, `Popultn`, `MlsAllw`, `Advisry`/`Advisory`, source item/layer ID and row key. Layer 32 supplies `FAURL` for source material. Do not treat FID alone as permanent across source republication.

**Critical sample findings:** FID 1 paired a sensitive-population label and a one-per-month value with text indicating that population should not eat the specified fish. Both advice text fields are limited to 254 characters and the sample ends mid-sentence. `Lat` and `Long` contained projected coordinates, not valid latitude/longitude. The layer geometry is a point, not a waterbody advisory boundary. The dashboard also references a five-mile buffer layer, which must never become the official advisory extent. Some linked fish images are third-party stock imagery; do not copy them as government-owned assets.

**Build:** quarantine automatic advice; join the complete official document, exact audience, species grouping, serving definition, combined limits, effective/withdrawn status and actual extent under review. Publish a reviewed rule revision, not the raw `MlsAllw` field. Test against complete official examples such as the [Cape Fear announcement](https://www.ncdhhs.gov/news/press-releases/2023/07/13/ncdhhs-recommends-limiting-fish-consumption-middle-and-lower-cape-fear-river-due-contamination). Do not assume that a historical announcement establishes today's status.

### S14 FDA food recall notices

**Status:** public JSON sample checked, including a PFAS keyword query. [API description](https://open.fda.gov/apis/food/enforcement/), [fields](https://open.fda.gov/apis/food/enforcement/searchable-fields/), [authentication](https://open.fda.gov/apis/authentication/), [licence](https://open.fda.gov/license/) and [terms](https://open.fda.gov/terms/) checked. This is a useful new acquisition path for F04, not a general recall dashboard expansion.

**Acquire:** `https://api.fda.gov/food/enforcement.json`. The probe's `search=reason_for_recall:PFAS&limit=1` returned two matches and a historical terminated recall. That count only describes this search at that time, not all PFAS incidents. Use reviewed contaminant synonyms and periodic complete reconciliation of the selected domain; a keyword query alone cannot guarantee recall coverage. Do not filter by `state` as if it were consumer distribution: the firm location and distribution text are different fields.

**Mapping:** source key `recall_number` with `event_id`, `status`, `classification`, product/lot descriptions, `code_info`, `reason_for_recall`, `distribution_pattern`, initiation/report/termination dates, dataset `meta.last_updated` and official notice link when verified. No concentration field is assumed. Preserve source lifecycle without turning a terminated recall into either a current alert or a product safety certificate.

**Operations:** source documentation says weekly updates; HALO can check daily conditionally, but must not advertise immediate recall alerts. Obtain a free server key for deployment; recheck its actual quota. Applicable openFDA data is generally CC0 subject to stated exceptions and service terms. Credit FDA without implying endorsement. Cache public revisions, preserve changes, and link to the issuing notice for exact consumer instructions.

### S15 Water Quality Portal

**Status:** [service guide](https://www.waterqualitydata.us/webservices_documentation/) and [user guide](https://www.waterqualitydata.us/portal_userguide/) checked; an actual NC PFAS result fixture was not acquired. Optional environmental sampling extension, not a dependency for the initial food hub.

**Acquire:** documented `/data/Station/search`, `/data/Result/search` and domain lookup services with bounded state/site/characteristic/date filters and supported output. Pin the API/profile version: the guide warns that legacy WQX 2.2 excludes USGS data added after March 11, 2024 and points to WQX 3.0 beta. Do not assume a legacy query is complete recent coverage.

**HALO mapping:** organization, project/station/activity/result identifiers; sample medium; characteristic/analyte; value/unit; detection condition and limits; analytical method; sample date/time/depth/basis; coordinates and location method. Verify exact field names against the chosen profile. No reviewed concentration interpolation, household tap equivalence or crop safety inference is authorized.

**Gate:** real filtered fixtures, completeness assessment, provider-specific attribution, detection-limit parsing, station/result joins, retained method/matrix and no-result state. Leave this optional layer disabled until those checks pass; food notices and private garden records can work independently.

### S16 US Drought Monitor

**Status:** documented REST and a county sample checked. [Service documentation](https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx) defines area, date range and statistics format; [permission page](https://droughtmonitor.unl.edu/About/Permission.aspx) gives map attribution requirements.

**Acquire:** `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi={FIPS}&startdate={M/D/YYYY}&enddate={M/D/YYYY}&statisticsType=2`, `Accept: application/json`. Public sample required no key. Store `mapDate`, string FIPS, county/state, `none`, `d0` to `d4`, `validStart`, `validEnd`, `statisticFormatID`. Format 2 is categorical; do not sum cumulative format 1 as if mutually exclusive.

**Build:** weekly regional history, compatible-release differences, area-category distribution, explicit source and release dates. Validate percentages and identity. If a home-point map is later needed, acquire the matching dated geometry; county maximum is not a home measurement. Follow source map attribution instructions when reproducing its maps; separate source attribution from HALO branding.

### S17 NC water conservation status

**Status:** [official table](https://www.ncwater.org/WUDC/conservation-status), linked map configuration, schema and one record checked. The official map exposes:

`https://services2.arcgis.com/kCu40SDxsCGcuUWO/arcgis/rest/services/NC_Drought_Monitor_Water_System_Conservation_Status/FeatureServer/0/query`

**Acquire:** bounded ArcGIS queries with pagination and selected fields. No key was needed for the sample. Verify automated reuse and update expectations with the source policy or maintainer before enabling ingestion. A public endpoint is not a service-level agreement.

**Mapping:** `systemPWSID`, `systemName`, `countyName`, `conserveStatus`, `conserveReason`, `conserveDateEffective`; keep `countyDroughtStatus`/`countyDroughtDate` separate. Raw IDs such as `03-63-020` require a validated crosswalk to the federal PWSID namespace, not a name-only join. Preserve both IDs and reject ambiguous matches.

**Build:** source revisions, utility watches and separately reviewed official restriction instructions/contact URLs. The service's status alone does not specify allowed watering days, exemptions or enforcement. Keep old effective dates visible; a new fetch is not a new notice. Failed reads retain dated prior evidence, not Not Restricted. A proposed daily check needs approved access and workload limits.

### S18 Labs Extension and garden preparation

**Status:** reviewed-content acquisition. [NC lab directory guidance](https://www.deq.nc.gov/about/divisions/water-resources/drinking-water/drinking-water-laboratories), [certified laboratory search](https://slphreporting.dph.ncdhhs.gov/Certification/CertifiedLaboratory.asp), [Extension contacts](https://www.ces.ncsu.edu/local-county-center/), [soil testing](https://www.ncagr.gov/Divisions/Agronomic-Services/soil-testing) and [PFAS guide](https://content.ces.ncsu.edu/Guide-to-Understanding-and-Addressing-PFAS-in-our-communities) were checked.

**Acquire:** curated provider/resource entries with exact source URL, service region, supported matrix/analyte/method, certification identifier and checked date where actually verified, contact method, preparation requirements and last review. No supported appointment, payment, laboratory-result or universal certification API was established. Routine fertility tests are not contaminant clearance.

**Build:** searchable reviewed resource catalogue plus private site/test/inquiry records. Show unknown price or availability honestly; version quoted estimates with date, region and basis. Explain lab-specific sampling requirements through the official provider instead of inventing a universal PFAS collection protocol. User-entered results are not independently lab-verified.

### S19 NRCS conservation assistance

**Status:** reviewed official programme content. The [national activity list](https://www.nrcs.usda.gov/programs-initiatives/eqip-environmental-quality-incentives/cpas-dias-and-cemas) includes CEMA 207 and 209; [NC EQIP information](https://www.nrcs.usda.gov/programs-initiatives/environmental-quality-incentives-program/north-carolina/environment-quality) supplies the state entry point. This audit did not validate eligibility for an individual applicant or a live application API.

**Acquire:** programme/activity ID, jurisdiction, fiscal year, scope, official eligibility/checklist/deadline/contact references, review date and replaced version. Read the selected current activity requirements before publishing detailed instructions. A national directory listing is not proof the activity is funded locally this year.

**Build:** preparation checklist, chosen site/test references, official handoff, optional user-reported application/reference/response state, linked follow-up task. Do not upload reports to an agency or promise assistance approval without a separately authorized integration.

## Action content and platform dependencies

### S20 Organizations and opportunities

**Status:** existing directory plus curated expansion. [Yadkin Riverkeeper's official events](https://www.yadkinriverkeeper.org/events) was checked and includes dated event pages and calendar links. It is an example of an organizer source, not an established universal feed or partnership.

**Acquire:** reviewed organizer/service areas and event-specific source URL, stable organizer/event IDs, cause, start/end/time zone, location, age/supervision/accessibility requirements, cost/materials, registration link, cancelled/updated status and checked date. Missing metadata stays unknown. Calendar links can aid verified import but do not prove registration or attendance.

**Build:** source-specific approved adapters or curator entry, version diff/review, event expiry, user participation and Plan linkage. Recheck approaching events daily if access permits; review broader directories monthly as a proposed starting policy. No new booking/payment/organizer messaging service is required. All original directory causes remain available.

### S21 Official reporting destinations

**Status:** [NC Stream Watch](https://www.deq.nc.gov/about/divisions/water-resources/water-resources-public-information/water-education-programs/water-education-and-outreach/nc-stream-watch) and [NC DEQ algal bloom reporting](https://www.deq.nc.gov/about/divisions/water-resources/water-sciences-section/algal-blooms) checked. These have different purposes. Stream Watch invites publicly shared observations; it is not a substitute for incident/emergency reporting.

**Acquire:** reviewed destination type, jurisdiction, official URL, appropriate observation classes, privacy/publication warning, urgency instructions, required user-supplied fields and review date. No automated submission/receipt integration was verified.

**Build:** private factual observations, sanitized attachments, report preview, explicit external handoff and user-reported submission/reference state. Alert users before leaving HALO if the receiving programme publishes observations. Do not transmit photos, locations or notes just because an official form exists. Refresh destination ownership/contact information, particularly around programme changes.

### S22 Guidance thresholds translations and certification

**Status:** existing Learn/corpus plus new editorial work. Existing source URLs live in `lib/learnContent.js` and `scripts/ingest-corpus.mjs`. [EPA PFAS rule information](https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas) currently distinguishes the 2024 rule and 2026 proposals. [NSF's contaminant-claim directory](https://www.nsf.org/consumer-resources/articles/contaminant-reduction-claims-guide) provides a model-specific verification path, not a general filter performance API.

**Acquire:** topic/claim ID, authoritative source, exact supporting section, publication/effective/review dates, domain/audience/matrix/units, original and reviewed translated text, legal/advisory status and method version. Supplement with qualified review for health interpretation. A translation must preserve audience and numerical meaning; no automatic synonym substitution for official rules.

**Build:** source-reviewed templates, glossary, contextual explanations, source changes and withdrawals, score-method registry and model-specific certification links. Separate legal limit, health benchmark and HALO display threshold. Existing scoring comments do not establish present compliance status. No single sample automatically proves a violation, and no standard number alone proves a product reduces every PFAS. Retrieval corpus publication follows content review and respects source rights.

### S23 Geocoding basemap and search

**Status:** existing Mapbox v5 adapter; [current Mapbox geocoding documentation](https://docs.mapbox.com/api/search/geocoding/) checked. It distinguishes temporary and permanent storage. Account rights and exact legacy-version terms were not inspected.

**Acquire:** existing `/geocoding/v5/mapbox.places/{query}.json` with server `MAPBOX_TOKEN`; proposed migration only after validating the chosen endpoint/response. Keep address queries out of logs. Current returned center/context parsing is not automatically compatible with v6.

**Build:** exact account/storage decision, restricted rendering token if needed, basemap style/tile attribution and budget, response-version adapter, candidate disambiguation, location bounds and rounded storage under the privacy policy. Do not add POI search, navigation or continuous GPS as hidden requirements. An accessible public-record search can use HALO's own published catalogue without an external search API.

### S24 Household records and platform services

**Status:** user records and existing platform dependencies, not missing environmental feeds. Actions, Plan, tests, garden observations, fish notes, water-use records, participation, Journal, outreach and summaries can use owned Supabase records plus reviewed content and the sources above.

**Build dependencies:** actual database schema/RLS audit; private storage with quarantine and a chosen scanning mechanism; durable job execution; identity recovery via a supported Supabase flow; browser Web Push subscription/service worker; secret management and current provider budgets. Luna keeps its existing configured chat/embedding provider until deliberately reviewed. No additional external AI provider is required by this plan.

**Unresolved operational choices:** storage/scanning provider, scheduler frequency and hosting tier, recovery flow, retention durations, account costs and deployment credentials must be recorded by the implementation owner before launch. These are explicit tasks, not assumed free capabilities. No external calendar API is necessary for one-way ICS export; bidirectional sync is outside the established target. Public official data must never absorb household notes or lab attachments.

## Shared normalization and matching requirements

| Problem | Required implementation and test |
| --- | --- |
| Chemical identity | Maintain source label plus reviewed analyte identifier/aliases. PFAS is a family, not one interchangeable measured substance. Preserve mixtures and method scope. |
| Units and sample matrix | Retain raw text/unit/qualifier. Normalization includes conversion version and matrix. Water mass-per-volume, soil mass-per-mass and food tissue results cannot share one automatic threshold. Wet/dry basis and nondetect limits remain explicit. |
| Time | Distinguish sample/observation, issue, valid, publication, retrieval and review times. Preserve date-only records as dates and user schedules with IANA time zone. Never invent midnight UTC observation time. |
| Identity | Namespace PWSIDs, station IDs, facility registry IDs, advisory IDs, programme IDs and source row keys. Preserve raw values and reviewed crosswalks. Fuzzy names can suggest candidates, not confirm identity. |
| Geography | Store point/area/segment plus CRS, geometry release and matching method. Source point, centroid and buffer are not exposure boundaries. Keep approximate user context separate from public source geography. |
| Completeness | Know which pages/files/parameters were fetched. Distinguish not tested, nondetect, no coverage, fetch failure, stale, withdrawn and valid zero. No record count becomes a testing denominator without its population definition. |
| Corrections | A new revision can correct metadata without indicating worsening conditions. Saved tasks retain evidence snapshots and flag material changes. Withdrawal invalidates current guidance but preserves provenance. |
| Scope | No household location inference from event attendance, no pregnancy/age inference from general categories, no food inference from water, no agency receipt from an opened link. |

## Source release checklist

Before enabling a source-dependent feature, attach the following evidence to its implementation PR:

1. Exact source/request and applicable terms review, with no key values.
2. Successful representative raw fixture or permitted minimal derivative, source checksum, parser version and expected canonical output.
3. Coverage tests for in-region, out-of-region, ambiguous, empty, stale and unsupported inputs.
4. Unit/qualifier/date/geometry tests and complete pagination reconciliation.
5. Source-to-screen field mapping, including which source fields are unavailable rather than silently derived.
6. Approved refresh interval, quota/cost ceiling, timeout/retry limits and last-good-data behavior within storage rights.
7. Content review and actual official instructions for every personalized or actionable interpretation.
8. Versioned source-change matching, withdrawal handling, dedupe and notification tests.
9. Attribution in cards, maps, exports and model context as applicable.
10. Feature flag, stale/error UI contract, operational owner and rollback procedure.

The source remains conditional until its applicable checklist is complete. A page can ship with honest unavailable sections only after that fallback is explicitly accepted; that must not be reported as full live feature completion.
