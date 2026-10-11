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

### October 11 semantic symbols and map tools (unapproved)

The point family now communicates evidence type instead of using circles, squares and diamonds: compact water drops, facility silhouettes/numbered building groups and wind strokes for monitors. The atlas, inline key, detailed legend and result list share the same code-native paths. County radon remains source polygon shading. Water-symbol area follows supplied population with a legible minimum and capped maximum; unknown population is never fabricated. Reported over-limit/violation flags use an exclamation, and unavailable comparisons retain a slash. Own-system emphasis follows the supplied system ID, never the nearest utility. Home has a separate compact house badge and accurate approximate-coordinate leader. The source coordinates do not move to avoid collisions.

Canvas labels and source numbers now use HALO's locally bundled Onest with an Instrument/Arial fallback. The map repaints after fonts settle without blocking controls. Numeric callouts explicitly use equal-width digit advances because Canvas does not inherit CSS OpenType tabular-numeral settings. Map counts, readings and district totals use lining/tabular Onest numerals while editorial headings retain Fraunces. Label layout tries alternate anchors and checks earlier numeric labels before suppressing collisions; hiding labels does not hide records or their accessible list. Wind glyphs do not represent wind direction or speed.

Useful frontend additions work over the returned record set, without new server queries: multi-term name/ID search, all-record/current-map-window scope, name sorting or straight-line distance from the approximate sample home, selected-record focus, Fit layer, a one-step Previous view and optional geographic/reading labels. Distance sorting is not offered without household context or for county-zone records; unlocated water systems remain in All records and sort after mapped records. Proximity never identifies a supplier, exposure or route. Focus on map is disabled with an explanation for unlocated records or an unavailable renderer. Focusing preserves filters, closes the single sheet, restores keyboard access to the map and retains a previous-view return. Fit water/facilities/air uses available positions; radon fits the actual bundled NC Census atlas extent. The minimum atlas zoom is now 5 to fit statewide records on a phone. These controls keep URLs free of household coordinates and add no account persistence or permission prompts.

Research: [Mapbox label-placement guidance](https://docs.mapbox.com/help/dive-deeper/optimize-map-label-placement/) informed collision handling, alternate anchors and hierarchy. [Esri location styling guidance](https://doc.arcgis.com/en/arcgis-online/create-maps/style-location-mv.htm) informed a legible symbol family over a restrained basemap, with actual record points taking priority over sparse density shading. These are design references, not imported vendor styles, tiles or a new live renderer. Record density still means density, not concentration or exposure.

The local authenticated `/api/map` and layer parsers were rechecked against the complete M01-M05 requirements. Existing IDs, coordinates, source populations, severities, observation dates and compound values support these local presentation tools. **No new backend fields are required for the additions in this pass.** Production still needs the approved live layer adapter, source freshness/coverage policy, Mapbox integration and identity-safe cache. M04 normalized public-record comparison and durable follow/watch intent remain deferred contracts, not simulated completion. No address-geocoding, geolocation, account writes, messages, backend routes or source calculations were added. Vibhav retains backend ownership. Translations, physical Safari and authenticated production integration remain unverified.

Verification completed: all 71 static Map/Explore-action/hosted checks (54 Map checks), 137 frontend logic checks, main TypeScript, scoped ESLint, isolated 21-page static build and preserved-file integrity (204 onboarding plus 146 immutable foundation files). The new checks cover fit/return pixel equality, visible-scope search, multi-term matches, nearest sorting with unlocated records last, focus/keyboard return, disabled unlocated focus, shared symbol paths, app fonts and 320px/150%, 375px and desktop layouts. Two first-pass failures exposed an inaccessible sort label and premature focus restoration; both were corrected and the full suite passed. No approved baseline changed. Screenshots remain in ignored `test-results/map-review`; publication receipt is in `docs/continuation/HOSTED_REVIEW.md`.

### October 10 visual and data-point refinement (unapproved)

The full Map is now a cartographic workbench rather than stacked floating panels. Layer and comparison controls are above a dedicated geography viewport, the categorical key and optional density key are below it, and counts/timeline/district remain in a reading dock. Mobile retains at least 360px of map height without laying the legend over observations; desktop uses a larger atlas. Luna moves into the header. No approved shell or archive is changed.

The basemap uses restrained neutral land, real rivers, lighter boundaries, priority county labels and collision checks against observations. Markers have contrasting edges, distinct circles/squares/diamonds, a white center for qualifying water/facility records, and a slash for unavailable comparison. Water circle area scales with supplied population (minimum legible size and a capped maximum); unknown population does not receive an invented value. A leader separates the approximate home badge from its neighboring utility marker without changing either source coordinate. Air labels display actual sample AQI; compound values appear at readable desktop/zoom scales. Scale and north indicators no longer compete with the central evidence.

The heat ramp is softer, transparent at very low density and fixed across panning. A bounded-support accumulator visits only each record's kernel footprint instead of testing every record at every pixel; unit tests compare it with the original kernel. The 35km support, equal weights and two-kernel ceiling remain display parameters. Source records, not an inferred pollution surface, remain authoritative. Sparse sample records cannot establish contamination between locations. Locations mode removes density shading. County radon zones and station-only air remain different evidence types.

Location lists now expose the selected compound value or index and sample date, station AQI and observation date, or facility inspection date. The water detail leads with the chosen comparison and highlights its row while retaining all compounds, supplied limits, dates, hazard context and missing entries. Zero is shown as zero; unavailable results remain unavailable. Original sample categories and backend evidence meanings are preserved. No new integration, spatial model, risk score, exposure conclusion, source measurements or backend field is invented.

Design research: [Mapbox's official heatmap example](https://docs.mapbox.com/mapbox-gl-js/example/heatmap-layer/) informs separation of soft density and crisp points. [Esri's high-density visualization guidance](https://doc.arcgis.com/en/arcgis-online/reference/best-practices-high-density-data.htm) informs restrained transparency, scale-aware labels and keeping actual points readable; its warning about sparse heatmaps is important here. This wireframe retains an explicitly labeled optional density view, not a scientific concentration map. No vendor tiles, provider calls or new dependencies are used.

Local contracts were rechecked in `app/api/map/route.js`, `app/api/district/route.js`, `lib/mapBuild.js` and `lib/mapLayers.js`, with M01-M05 master/build/acceptance requirements. This is a visual refinement of sample wireframes, not proof of live Mapbox, authenticated route binding, offline identity-safe storage or new comparison support. Existing backend ownership and approval gates remain in place.

Verification completed: 103 broad static browser checks, then 63 final Map/Explore-action/hosted checks after the short-desktop height adjustment; 133 frontend logic checks; main TypeScript, scoped ESLint and isolated static build. The renderer return check passed five serial repeats after resetting retained paint state. Light/dark, 320px at 150%, short mobile/desktop, zero/missing readings and explicit source dates/times passed. All 204 onboarding and 146 immutable foundation files are unchanged. Publication receipt is in `docs/continuation/HOSTED_REVIEW.md` (version 27). Physical Safari and live authenticated integration are still unverified.

October 1 refinement remains unapproved: Patterns/Locations presentation, a persistent compact legend, a viewport-driven area brief, and an expanded desktop atlas. The design takes the map-first, explain-the-result direction from the earlier Relink review, not its data model or unsupported claims.

The basemap now includes a locally packaged subset of Natural Earth rivers and place labels, created by `scripts/build-map-preview-context.mjs`. Source URLs and retrieval date are recorded in `public/data/map-preview-context.json`. [Natural Earth data](https://www.naturalearthdata.com/about/terms-of-use/) is public domain. This generalized context is not street-level cartography or environmental evidence. Its optional loading failure leaves the Census atlas and observations usable. Both sources are credited in the map.

Water/facility heat is explicitly **record density**, not contamination, service coverage, an interpolated measurement, or exposure. Each qualifying record has equal weight; a compact quadratic kernel has a35km support radius and a fixed two-kernel color ceiling. These are frontend display parameters, not scientific parameters. Source dots remain selectable. Water qualification uses supplied comparison ratios (or supplied hazard flag), facilities use reported compliance status. Missing measurements are never included as clean readings. Air remains station-only, and radon retains source county zones. No new API fields or backend work are introduced. The area brief separates the map-window counts from statewide coverage and the existing county rank.

Run `npm run typecheck`, scoped ESLint, and `npx playwright test test/ui/map-preview.spec.ts`. Browser tests block external and API requests. Run `npm run preservation:verify` to confirm earlier archives remain untouched. The hosted review exports the same Map component and fixtures but does not include production API/auth code.
