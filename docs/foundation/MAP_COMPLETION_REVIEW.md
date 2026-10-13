# Map frontend completion review

October 12, 2026. Editable wireframes, not visual approval, a production map, or verified live environmental data.

## Completed in this pass

M04 now has a real two-public-record interaction rather than treating the existing county rank or compound rows as record comparison. A user can enter from a water system or air monitor, search for the second record, replace either selection, cancel replacement, remove the second record, choose a water compound, inspect both observations and their dates/periods, inspect source details, return to the original record, or clear the comparison. Unlocated systems remain selectable. Browser history uses the existing single-sheet entry and replaces comparison changes instead of creating a long Back trail.

The layout is an aligned reading list. It uses the existing HALO palette and type, 44px controls and the existing accessible modal. After both records are selected, replacement controls fold into Change records so the readings appear sooner. Source coverage is shown before values. At 320px and 150% type, the reading pair stacks rather than squeezing two tiny maps or hiding the comparison. The first browser pass found a collision with the old `halo-map-comparison` rank-banner class, which hid the body at 150%; the new record-comparison container has its own scoped class.

M01 renderer failure now offers a direct searchable location list. It no longer requires opening About to discover the list. Selection, comparison and available public evidence continue without a working canvas.

M02 owned-mode water-system following uses the existing `settings:follows` registry. It records a public record ID plus the source label, deduplicates the same source/name, is reversible, retains the prior state on offline/save-error/conflict/pending conditions, and explicitly says update delivery is not connected. Following is not task creation, registration, verified utility association or delivered notification.

M05 now has a collapsed public district brief. A user reviews the exact outgoing text before copy, JSON download or native share. Permission-denied copy retains selectable text; unavailable/cancelled native sharing has explicit feedback. The JSON uses an explicit public allowlist, not a spread of profile or workspace state. Source dates, numeric-result denominators, partial-county membership, unknown population, unlocated records, centroid limitations and boundary vintage survive the export. Because this is a review, exported text and data explicitly identify the fictional records; the export must not masquerade as a verified civic finding. Source/geography failure does not expose an export of fabricated zeroes.

## Public access mode

`access=public` is an explicit frontend access-capability review, not an authentication implementation. It hides the home pin, own-system outline, household rank, home distance, private notes and private Luna launchers. The public map does not restore or replace the private map-session viewport or saved layer preference. A pasted `system=home` is invalidated; a pasted assistant sheet displays About rather than private conversation. Public explanatory sheets keep public sources but do not link to personalized factor surfaces. District evidence, comparison, map tools and public export remain available. Header Back goes to expanded My Week with `access=public`; other app navigation retains the mode.

A confirmed home transition also invalidates the original household pin, utility match, ranking, distance and saved household viewport. Public atlas evidence remains available, while Luna receives unavailable household environmental context. Project personalization filters current-home records and current garden tests; untagged legacy records remain with the original home. A home-bound context key invalidates stale suggestion reasons after repeated moves without rewriting saved project workspaces.

## Evidence rules

- Values come unchanged from the existing isolated water and air fixture modules. This pass adds no new environmental readings or live requests.
- `map-comparison-preview.ts` is an explicit review-only adapter. Source and method versions used to demonstrate a valid normalized contract are authored fixtures. They are not derived from the current live API and must not be reused as production defaults.
- Comparison requires different public IDs and available records; matching analyte/pollutant, original units, evidence kind, geographic scope, observation period, method, comparison basis and source version; and finite reported values. Missing, estimated, censored, withdrawn or incompatible evidence cannot become a numeric best/worst ranking.
- Zero stays zero. Missing values stay unavailable. Nondetect is not converted to zero. A combined hazard index remains a separate unit and binds its component-method identity.
- Latest is each record's latest observation, not a synchronized date. Water rows bind to the actual sample quarter. Different within-quarter dates stay visible and qualified. Air binds to the pollutant and observation hour; the three existing stations therefore demonstrate meaningful incompatibility where their pollutant or hour differs.
- Detection-only water coverage and one-hour monitor coverage remain partial. No difference, trend, percentage change, exposure, source attribution or recommendation to change utility is calculated.
- Radon county categories and facility program counts are not silently treated as comparable concentration records. These layers explain why numeric comparison is unsupported and preserve their own public detail/source paths.
- Exact source-record URLs are unavailable in the existing fixtures. The UI says so and labels EPA/AirNow links as official background, not the measured record. Review controls outside the product demonstrate unit, period, method, denominator, scope, source revision, withdrawal, loading and request-failure cases.

## M01 to M05 coverage audit

| Feature | Current wireframe paths and relevant states |
| --- | --- |
| M01 | Four layers, pan/zoom/touch/pinch/keyboard, fit and previous view, locate when household context exists, labels, location search, viewport/all-record scope, name/distance sorting, unlocated records, one focused sheet, Back/close, direct public/no-home mode, independent loading/error/session/offline states, renderer fallback with direct text-list entry. |
| M02 | Overall/five compounds/hazard index, zero/missing/unscoreable/excluded evidence, full selected-system detail, individual dates, source-sized symbols, own-system context only when available, Latest versus sample quarters, retained pending data, request cancellation and failed-quarter restoration, empty quarter/no timeline, comparison, private factual-question route and canonical follows. |
| M03 | County radon potential with testing explanation; selected facility dataset, grouped locations, programs versus violations, inspection/null, official source; air pollutant/AQI/hour/agency and approximate-home distance only with household context. Record-density patterns never become a concentration surface, wind field or forecast. |
| M04 | Selection/search/replace/cancel/remove/exit, query reconstruction, same-record and missing-ID handling, compound alignment, compatibility reasons, source/coverage/date disclosure, no-home and unlocated selections, loading/error/retry/offline, contrast/theme/large text and keyboard paths. |
| M05 | District/state ratios with exact numeric-result denominator, per-compound detail, nine county rows and partial membership, population minimum/unknown/zero, unlocated source records, geography failure, boundary vintage, public brief review/copy/download/share and failure fallbacks. |

## Backend contracts still required

Inspection of `app/api/map/route.js`, `lib/mapBuild.js` and `lib/mapData.js` confirms layer/quarter transport, public-system identifiers, compound values, dates, limits, location and population fields already exist. Their presence does not provide the complete normalized comparison contract. Vibhav must supply/verify:

1. Stable evidence and release IDs, original matrix/analyte/unit/qualifier, measurement method, exact observed time/date and declared compatible period, evidence kind and geographic scope.
2. Comparison aggregation/denominator definitions, coverage and missing-result reasons, accepted unit conversions if any, source-version compatibility, withdrawal/correction lifecycle and immutable selected evidence.
3. A comparable result or explicit incompatibility reasons from a reviewed adapter/query. Numeric comparisons must never be inferred from severity colors or missing values.
4. Exact source-record URLs and source dates, separate from explanatory agency pages and assembly timestamps; ingestion, permissions and freshness verified for each provider.
5. Stable source IDs on owned follows, identity/ownership, revision/idempotency/conflict handling, durable storage, unsubscribe and separate delivery capability acknowledgements. A successful local follow is not proof of push delivery.
6. Public/no-home read capabilities while retaining real authentication policies; do not simply remove `requireUser` from private APIs. No household fields in public briefs, caches, URLs or link metadata.
7. Production renderer, tile attribution/token policy, safe lazy loading, identity-scoped/offline caching and the canonical production route. The current canvas atlas and visit-local data are deliberately isolated previews.
8. District boundary release verification, complete actual-returned quarters, tested/nondetect coverage and source-versioned district denominators. The preview explicitly retains the 119th-Congress/2023 boundary limitation rather than claiming 2026 election coverage.

These are integration/release requirements, not simulated backend delivery. No backend files, accounts, subscriptions, emails or immutable approved archives were changed. Physical-device Safari, screen-reader, native-share and real provider validation remain separate from desktop emulation.

## Validation

- New pure-logic suite: 16 tests passed, including a privacy allowlist export check with injected private fields.
- Map component/module scoped ESLint passed.
- Typecheck passed before other concurrent implementation edits; root performs the final integrated typecheck/build.
- Static browser regression before the final compact-disclosure and home-isolation refinements: all 75 map cases passed (21 new and 54 existing). The initial run's 150%-type class collision and two overly broad expectations were corrected before this passing run.
- Final rebuilt static-export targeted regression: all 22 cases passed, including compact comparison disclosure, keyboard focus after replacement/cancel, saved prior suggestions and map viewport through a confirmed home change, public privacy and small-screen layout.
- Combined map/project pure-logic regression: all 26 tests passed. Two new project-context tests cover historical exclusion, current-home/site inclusion and repeated empty-home changes.
- New browser cases cover comparison control flow, compatibility/failures, public access, zero/missing/unlocated data, source detail, follows, export/share fallbacks, history and 320/375/430/1280px dimensions.
- Final static-export and aggregate regression evidence belongs in the parent completion receipt. This document is not a screen-approval or publication receipt.
