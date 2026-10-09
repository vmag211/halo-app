# HALO Public Source Verification

Audit date October 3, 2026. These are read-only development checks supporting the [Source Acquisition Guide](../HALO_SOURCE_ACQUISITION_GUIDE.md). They are not production integration tests, a complete source import, a terms-of-use clearance or validation of health advice. No secrets, environment files, private household records, HALO cron routes or paid provider accounts were accessed.

## Reproduction

Run `node docs/product/verification/probe-public-sources.mjs` from the repository root. Optional positional arguments select known probe IDs. The script only calls fixed public URLs, uses a test point near Concord rather than a household address, caps each response at 1 MiB, times out after 20 seconds and emits diagnostics to stdout. Its only discovered follow-up is an hourly forecast URL restricted to `https://api.weather.gov`. Run deliberately, not as a recurring production health probe.

The first run covered ten requests, including the discovered NWS hourly request, at 04:43:48 to 04:43:51 UTC. A second selected run covered four NC service schema/sample requests at 04:47:10 to 04:47:11 UTC. All fourteen returned HTTP 200. Payload meaning was inspected separately; HTTP success is not an interpretation test. Full raw payloads were not saved. Hashes below identify the exact retrieved bodies, not locally archived files. The script can produce new snapshots with new hashes when upstream data changes.

## Inspected responses

| Probe | Result at audit time | What this establishes and does not establish |
| --- | --- | --- |
| `open-meteo-uv` | JSON, 24 hourly periods, New York timezone; current UV zero at local 00:30 | Actual current/hourly shape works for one point/date. Does not prove all model/history queries or uptime. |
| `open-meteo-air` | JSON, current US AQI 37 and pollutant subindices, 24 hourly periods | Model output exists for that sample. Not a monitoring-station measurement. |
| `nws-points` | GeoJSON, grid `GSP/127,74`, hourly URL and timezone | Official grid discovery succeeds. Not a fixed grid for every household. |
| `nws-hourly` | 156 periods; first period humidity 87 percent and precipitation probability 3 percent; generation and update times differ | Preserve both times and period validity. No evidence that a null probability always means zero. |
| `usdm-county` | Five categorical releases for FIPS `37025` in September 2026 | First returned release September 29 has D0 52.02 percent and D1 47.98 percent. This is county area distribution, not the home condition. |
| `openfda-food` | JSON results and dataset metadata, last updated September 23, 2026 | API and metadata shape work. Default first result is not necessarily newest or relevant. |
| `openfda-pfas-search` | Two matches for this exact keyword query; sampled recall `F-1508-2022`, status `Terminated` | A real PFAS-related recall acquisition path exists. It is neither complete PFAS recall coverage nor a food concentration API. |
| `water-boundary-schema` | Public layer metadata, 2,000-record limit, PWSID plus provider/method/verification fields | Existing service can supply better association provenance. A layer schema alone does not validate any individual home association. |
| `echo-query` | JSON QueryID and 11 query rows | Query initialization works for the selected county/filter. No complete result-page or nationwide acquisition test was run. |
| `nc-fish-landing` | HTML titled North Carolina Fish Consumption Advisories | Direct fetch succeeded although the web research tool returned 502. Page embeds the official StoryMap. |
| `nc-fish-schema` | Public point layer 38, FID key, advisory fields capped at 254 characters | Typed fields are accessible, but their lengths and semantics need caution. |
| `nc-fish-sample` | One row, `exceededTransferLimit=true`; projected coordinate attributes; conflicting-looking audience/limit/text | Raw personalized advice must be quarantined. A one-row query deliberately did not fetch the whole dataset. |
| `nc-conservation-schema` | Public point layer with utility ID, status, reason and effective-date fields | Supports a concrete adapter candidate; terms/cadence and full restriction instructions remain separate. |
| `nc-conservation-sample` | Utility raw ID `03-63-020`, Voluntary, effective August 18, 2026; county drought date September 22 | Status and drought dates are separate. This is historical audit evidence, not current advice for that utility. |

## Body hashes

| Probe | SHA256 |
| --- | --- |
| open-meteo-uv | `36a36c61c65e9a6dcea83464d04f8471e8ab0801629a4420a7529d997e27edd4` |
| open-meteo-air | `ae5158517cdb5f1b8ea514296a86402a2fbe610fe9acaceddc862ced8a2c957f` |
| nws-points | `c098566864046f90daae676ff1563cb9c2ae4daf0f61c5718dd49ad5dfb492fe` |
| nws-hourly | `026f7f844879653806133ed7f42f17debffda8474f7a95ad259af368c8117950` |
| usdm-county | `ca6181e7da1e38f45e662a6258868af97f7c51582519ef6f7e779def7d14198f` |
| openfda-food | `2fd3886e428864b1f95da7ef8c66a0bb6ac232327ddadf69962fe4c2644e1ddb` |
| openfda-pfas-search | `af550e109694dc2cd50f142448f865653e61294377488d595c240cea76ae7f53` |
| water-boundary-schema | `61d36df5d8d9337cf845eba6bf48c70d89dceac524f677f38f573004d4900224` |
| echo-query | `1681447997abd3a388d0d98455d76a5241f6ddbe2b52f4447954f4c2e331a91d` |
| nc-fish-landing | `ab5b063a2ed65a5389b4b52d61328b8825175375a6653746c7746bf079e12953` |
| nc-fish-schema | `8b5cd516c763c05434339df6a5992d173cf9ed047fa7894635a52d1391e7760c` |
| nc-fish-sample | `03ed8220cff08144238e383d0011395c5f4d8eccffe2044a45e334d0b9166350` |
| nc-conservation-schema | `7cdc2664c4d80ed6782b5bc55b3ba1df1ab01a82bc09f3b318a01e6965dc72d4` |
| nc-conservation-sample | `9f8fc70cf4b629ba55eb4d4d8efa2cd05bbda83305103736307056767c0e62c0` |

## Additional discovery checks

The official NC fish page linked to `https://arcg.is/1LOrHy1`, which resolved to StoryMap item `eab23dd84e8b403b95dc1223703aa487`. Its public ArcGIS item data linked to dashboard `470cb0bb993a47969f065e6087282286`. That dashboard's `dataSources` identified fish services 32 and 38. Both metadata and one-row queries were inspected. Public item `licenseInfo` was null, which does not establish reuse permission.

The sample row used a sensitive-population label with `MlsAllw=1/month`, while the associated truncated prose indicated avoiding those fish for the sensitive group. This is an apparent source-field inconsistency, not a determination of the correct health instruction. The source text ends mid-sentence. No rule was published or transmitted to users. Before release, a reviewer must inspect the complete authoritative document and actual current advisory status.

The NC conservation table linked to experience `18ef543c15be47b4b3711d87c99054ea`; its web map `32fe2759fdd84f76a409a37688450cd4` identified the sampled conservation service. It is no longer accurate to describe this source as only an HTML table with no located endpoint. It remains conditional on permission, stability, matching and complete official instructions.

The EPA occurrence page's download links were inspected directly. The two archives identified in the guide were not downloaded; the audit does not claim their header schema or completeness has been verified. Official documentation and links for the remaining sources were reviewed as stated in the guide. Failed guessed URLs were replaced with official discovered landing pages, not treated as evidence that a source does not exist.

## Checks still required during implementation

Final repository checks passed: the structural validator accounts for all 45 master feature groups and 24 source families, and verifies local documentation links, table structure and punctuation. Both verification scripts pass Node syntax checks. The preservation check confirms all 204 archived onboarding files and 146 immutable foundation approval files are unchanged. `git diff --check` reported no whitespace errors. These are documentation and archive checks, not proof that proposed backend features have been implemented or integration-tested. No application code was changed by this source audit.

The final policy check included Google's current non-EEA service-specific terms, section 16. These explicitly allow defined temporary pollen storage, including 365 days for today's forecast values, despite the policy summary's general storage language. The guide therefore specifies retention classes rather than asserting pollen history is prohibited. Applicability to the actual account and all intended uses still needs verification.

Authenticated AirNow, Google Pollen, Mapbox and OpenUV behavior; account-specific storage/redisplay rights and pricing; full UCMR import; live database schema and policies; actual deployment scheduling; household isolation; complete advisory review; FDA study-table parsing; WQP real-result fixtures; trusted content translations; attachment scanning; recovery; export/deletion; and load/restore testing remain implementation or release gates.

No comprehensive local-food PFAS dataset was established. This negative finding is limited to this audit, not a claim that no local investigation or laboratory record can ever exist. Expand supported coverage only after reviewing the specific source and its scope.
