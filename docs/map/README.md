# Map wireframe, editable review

Status: PROPOSED. This is not approved, frozen, production-integrated, or a new visual baseline. No approved archive was created or changed. Yogi will refine this stage before approval.

Entry: `/foundation/preview/map`. The existing preview's Map tab opens this isolated review. The production shell and `/map` are unchanged. Use the outside-product review controls for named scenarios, device/light/dark appearance, text size, contrast and reduced motion. All environmental observations and household data are fixtures, not live readings. No auth/API request, location permission, IndexedDB write, or household mutation occurs.

## References and contract decisions

- Updated specification: `../foundation/reference/HALO_Frontend_Specification_2026-09-29.pdf`, B7 pages61-67, shared shell/sheet/accessibility rules.
- September30 frontend depth review, existing `app/api/map`, `app/api/district`, map/district/geometry helpers and tests.
- `../WIREFRAME_WORKFLOW.md` supersedes old assignments. Existing approved source/archive remain untouched.
- The prototype uses an interactive Canvas atlas with the repo's actual U.S. Census county and119th-Congress district geometry, loaded only by this route. It uses no external tiles, billing account or new dependencies. The Mapbox GL renderer, live transport and identity-scoped IndexedDB cache are deferred to the approved production build. Canvas demonstrates pan, touch/pinch, keyboard, nearest22px hit selection, population-size circles and facility clustering. It is not represented as Mapbox or an aerial/street map.
- Geography converter: `scripts/build-map-preview-geography.mjs`; source geometry is not simplified further. Lazy public atlas JSON is distinct from the server source. The radon fixture copies the existing county zones.
- District fixture totals are verified against the sample water coordinates and real district containment. Its unlocated count/list is statewide, not a fabricated district membership.
- Spec correction: the90% geography-failure guard needs statewide `count` and `located` from the water layer. It must not divide statewide `unlocated_systems` by district-only `total_systems`.
- Quarter data is samples *within* the selected quarter, not accumulated data or evidence of a moving plume. Assembly time stays that of Latest. Missing points are not clean areas.
- Source flags about proposed regulatory changes are described as source flags with a pre-launch verification requirement, not asserted current law. No backend or scoring changes.

## Element and interaction coverage

| B7 feature | Review implementation |
| --- | --- |
| Four layers | Water/Radon/Facilities/Air radio controls, arrow-key selection, independent viewport |
| Water selector | Overall, PFOA, PFOS, PFHxS, PFNA, GenX, hazard index; recolors sample markers, count line, own-system ring |
| Water detail | System ID, served population/null, five compound rows, date/limit/ratio, zero vs absent, truncated bar annotation, hazard/latest-sample context, unregulated detection, Learn |
| Timeline |12 returned fixture quarters plus distinct Latest, pending old-data state, keyboard steps/Home/End, cancellation, failed request restoration, no-sample and single-quarter states |
| Radon |100 actual county boundaries, returned zone/severity fixture, county details and contextual Learn; no home concentration claim |
| Facilities | Distinct points, nearby grouping and zoom expansion, compliance status, programs, quarters in noncompliance, programs in violation, penalties, inspection/null, NC08-subset disclosure |
| Air | Diamond markers, station AQI, pollutant, observation date/time, source agency and computed distance from approximate sample home |
| Household | Approximate pin on every layer, own water ring, Locate, missing/outside-NC branch, home detail with session sample Today score |
| Map controls | Pan, pinch, keyboard arrows,+/-, zoom controls, locate, selection, attribution, legend panel |
| Text alternative | Searchable list per layer; water includes unlocated records. This local filter adds no backend search requirement |
| District |70%-style shared sheet, hero/fallback/minimum/zero, district/state comparison, all nine counties with partial-county tags, compound denominators/populations, unlocated list and dated boundaries |
| Comparison | Household rank uses ranked denominator, unranked/missing hides; nearest-air/facilities/radon variants; narrow-height suppression with timeline |
| History | Filters replace; opening selection/panel pushes one entry; replacement sheets/Learn reuse it; Back closes; pasted selection closes in place |
| Navigation | Existing Today/Homeguard/factor/Settings previews remain reachable; Map reuses shared rounded navigation and Luna preview |
| Provenance | Assembly separate from observation/sample dates, dataset scope, Census attribution,119th Congress boundary version, mock label |
| Accessibility | Shared modal focus/restore/Escape, native controls, canvas keyboard plus text list, word/shape alongside color, light/dark, high contrast,150% review size, reduced motion |

## Named review states

Ready; loading; slow source; independent layer error; empty viewport; offline saved water; offline no saved layer; failed quarter; empty quarter; one-quarter/no timeline; no location; outside NC; unranked county; district request error; district geography failure; missing population; incomplete population; zero exceedances; missing comparison; map renderer failure/text fallback; long label; session verification required.

Direct links accept `layer`, water-only `contaminant` and valid available `quarter`, `system`, and `panel=district`. Review-only `mapScenario`, `appearance`, `scale`, `motion`, `contrast` are not account settings. Unknown selections are ignored. Household values are never stored in the URL.

## Deliberate boundaries

- Prototype loading, retry and offline controls simulate requests. They do not prove production caching, authentication, Mapbox performance or source availability.
- Luna reuses the existing sample conversation. It does not contact a model. Learn sheets use readable sample explanations and show their eventual existing-API binding.
- Unverified named district facts are omitted, as required. The household-system/district-comparison proposal remains deferred because the current response lacks explicit system district membership.
- No new score, exposure inference, plume, address search, arbitrary-district selector, statewide county ranking table, live location access, or background notification service.
- Capture evidence belongs in ignored `test-results/map-review`, never an approved folder. No snapshot baseline can be frozen until explicit approval.

## Verification

October 1 refinement remains unapproved: Patterns/Locations presentation, a persistent compact legend, a viewport-driven area brief, and an expanded desktop atlas. The design takes the map-first, explain-the-result direction from the earlier Relink review, not its data model or unsupported claims.

The basemap now includes a locally packaged subset of Natural Earth rivers and place labels, created by `scripts/build-map-preview-context.mjs`. Source URLs and retrieval date are recorded in `public/data/map-preview-context.json`. [Natural Earth data](https://www.naturalearthdata.com/about/terms-of-use/) is public domain. This generalized context is not street-level cartography or environmental evidence. Its optional loading failure leaves the Census atlas and observations usable. Both sources are credited in the map.

Water/facility heat is explicitly **record density**, not contamination, service coverage, an interpolated measurement, or exposure. Each qualifying record has equal weight; a compact quadratic kernel has a35km support radius and a fixed two-kernel color ceiling. These are frontend display parameters, not scientific parameters. Source dots remain selectable. Water qualification uses supplied comparison ratios (or supplied hazard flag), facilities use reported compliance status. Missing measurements are never included as clean readings. Air remains station-only, and radon retains source county zones. No new API fields or backend work are introduced. The area brief separates the map-window counts from statewide coverage and the existing county rank.

Run `npm run typecheck`, scoped ESLint, and `npx playwright test test/ui/map-preview.spec.ts`. Browser tests block external and API requests. Run `npm run preservation:verify` to confirm earlier archives remain untouched. The hosted review exports the same Map component and fixtures but does not include production API/auth code.
