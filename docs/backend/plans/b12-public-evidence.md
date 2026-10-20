# B12 public evidence reads: plan

Base `origin/vmag211/backend` at `f2b49e3`. No migration: every answer is built from reviewed static files in `lib/data/`, so nothing is stored and nothing needs 0028.

## The frontend contract (binding)

- Registry: `'food.search': {path:'/api/food/evidence'}`, `'fish.read': {path:'/api/fish/advisories'}`, `'water.read': {path:'/api/water/notices'}`, `'growers.search': {path:'/api/growers'}` (`lib/frontend/production/runtime.ts:77-80`). None is `public:true`, so the runtime always sends `Authorization: Bearer` and `X-Halo-Home-Context`; the wiring table says Public "No" (`docs/product/HALO_BACKEND_WIRING_CURRENT.md:312-315`).
- Adapter: `readResource(resource,query)` maps `fish-catalogue`, `food-evidence`, `published-food-evidence`, `grower-resources`, `water-stewardship` and sends `{resource,...query}` as the query string (`lib/frontend/production/adapters.ts:17,30`). `food-evidence` and `published-food-evidence` share `food.search`; the `resource` value is the discriminator (W:557).
- Runtime: a body with an own `data` key is unwrapped (`runtime.ts:149-152`); our bodies are bare (B05 ruling D10), so arrays stay arrays. 401 session, 400 validation, 429 rate_limited, 503 unavailable (`runtime.ts:144`).
- Validators (`lib/frontend/production/home-resources.ts:22-37`): `validFishCatalogue`, `validFoodNotices`, `validGrowerResources`, `validWaterStewardship`, `validPublishedFoodEvidence`. One bad row and the screen shows "This information could not be verified. Try again." (`components/homeguard/HomeResource.tsx:22`).
- Screens: `FoodFish.tsx:20-23` (matching is `rule.species === species` and, for `waterbody === 'statewide'`, `waterbodyIds.includes(waterbody)`), `FoodEvidence.tsx:16`, `PublishedFoodEvidence.tsx:13` (query `foodId`, `guideId`), `FoodGrower.tsx:16-19`, `FoodWater.tsx:45-49` (releases filtered by `countyId`).

## What is built

`lib/publicEvidence.js` (projections and query parsing), `lib/publicEvidenceRoute.js` (session, limiter, cache headers, envelopes), four `GET` routes, `scripts/build-public-evidence.mjs` (reads files downloaded by hand, records URL, retrieval date and sha256 in each output header; never fetches), four data files.

| Resource | Status | Source (all retrieved 2026-10-20) |
|---|---|---|
| `fish-catalogue` | **Live** | NC DHHS fish advisory feature service `FA_Lakes_Rivers_Points2/FeatureServer/32` (34 site advisories, service edited 2026-04-01) behind `epi.dph.ncdhhs.gov/oee/fish/arcg.html`; statewide mercury list from `epi.dph.ncdhhs.gov/oee/mercury/safefish.html` |
| `water-stewardship` | **Live (dated copy)** | U.S. Drought Monitor county statistics web service (categorical percent area, NC, 4 weekly maps to 2026-10-13); NC DEQ DWR "Water System Conservation Status" table (277 systems) |
| `grower-resources` | **Live (3 of 4)** | NC State Extension county centers, NCDA&CS soil testing, NC DEQ drinking-water laboratories (each page fetched and hashed) |
| `published-food-evidence` | **Live** | The four reviewed FDA findings already in `lib/frontend/food-evidence.ts`, copied with a drift test; the three FDA PDFs hashed |
| `food-evidence` | **Studies live, notices blocked** | The same four FDA studies as `kind: 'Study'`; no `Notice` rows |

## Rules the data follows

- **Fish wording is verbatim.** The service's `Advisry` field is cut at about 254 characters in 28 of 34 rows (HO-126: truncation blocks automatic advice). A row whose text does not end in a full stop is published with `status: 'Review required: source text cut off'` and wording "Recommendation withheld...", never a partial sentence; its `url` is the official advisory graphic (`FAURL`). A row whose text names another listed waterbody and not its own (Falls Reservoir names Lake Norman) is held the same way. Complete rows (Crabtree Creek, Rocky Branch, Little Brier Creek, Walnut Creek, Neuse River, Brunswick River 2) carry the text exactly.
- **Species.** The frontend matches one species string exactly, so each advisory is emitted once per species it lists (split on commas, "and", "or"; sentence case; source label kept in the title). "all"/"all fish", and text naming "all other fish", apply to every species in the catalogue. Generic "catfish" also matches blue, channel and flathead catfish and vice versa. Two source spellings are corrected for matching only ("Blue Gill", "Stripped Bass"); wording is untouched. Cape Fear River 1 has an empty species field, so its species come from its own text.
- **Statewide mercury.** Built only from verbatim phrases of the safefish page, each checked against the downloaded page. Waterbody ids are explicit: every catalogue water, plus `nc-other-waters` (any NC water with no listed site advisory); walleye only for Fontana Lake and Lake Santeetlah. The footnoted regional notes (south and east of I-85 / I-95) are quoted in `condition`, and the status says the NC DHHS sources differ (the current StoryMap chart is an image with other audience wording).
- **Drought** is a county area distribution per weekly map. Only a county's newest map can be "current" (while its validity, which ends on its last UTC day, includes the request date); an older map is always "An earlier weekly map"; once the newest map's validity has ended the note says a newer map has likely been published, which can be early by up to two days because USDM publishes on Thursdays. **Utility status** is the state listing only: `instructions` says the rules are in the system's own notice; "Not Restricted" is shown as the state wrote it, never as an all-clear.
- **Food** never gains a household value: `itemLevel: 'Unknown'`, non-detects stay "not detected", PFOS is not total PFAS (text copied from the frontend's reviewed records).
- Revisions: the build compares each record with the previous output; changed content bumps `revision` and fills `previous`.

## Reads

Signed-in only (the contract's Public "No"), `requireUser` then, for every signed-in request including invalid ones, a per-identity limiter `publicEvidenceLimiter` (120 a minute, fail-open, the B05 reasoning: no provider is called). Queries: `resource` must be the route's own value (food: one of two); `foodId`, `guideId` match `^[a-z0-9-]{1,80}$`; anything else is ignored and never echoed or logged. 200 bodies carry `Cache-Control: private, max-age=600` and `Vary: Authorization`; every error is `private, no-store`. A data file that fails its own shape check answers 503, never an empty list. No table is read, so another household changes nothing.

## Blocked, and what unblocks it

- **Food notices (openFDA recalls).** W:2647 and HO-125 gate activation on recorded provider terms, limits and field meaning; keyword search is not distribution matching. Unblocked by Vibhav approving an openFDA acquisition review.
- **NRCS conservation activities.** The page refused the build host (connection reset twice), and it is national, not NC. Unblocked by a hand link check and an NC office page.
- **Utility rule text** (watering days, exemptions): not in any state dataset. Unblocked by per-utility notice review.
- **Freshness.** Drought and utility status are a dated copy; they need the build re-run weekly (or a cron writing to a table, which would need a migration).

## Proposed, Vibhav to confirm

1. Publish complete NC DHHS service text verbatim as advice wording, and withhold every cut-off row with a link to the official graphic.
2. Use the safefish text page for the statewide mercury rules, applied to every listed water and `nc-other-waters`, with the regional footnotes quoted rather than applied as geometry.
3. Per-species expansion, the catfish family, and "all fish" covering every catalogue species.
4. Signed-in only with a 120 per minute per-identity limit; `private, max-age=600` on success.
5. Food notices stay empty until the openFDA review; NRCS dropped from growers.
6. Weekly manual refresh of drought and utility data until a scheduled ingest exists.

## Acceptance

Route harness: 401 without a session, 400 for a wrong `resource` or malformed id, 429 and fail-open limiter, 503 on a broken data file, bare bodies and headers, no table touched, identical answers for two households. Conformance: the frontend's own `createHomeAdapter` and validators (loaded from TypeScript) over the real handlers, then the screens' matching and filter lines (transcribed with a drift test) asserting what is shown: a withheld cut-off rule, a verbatim complete rule, statewide largemouth bass at a listed and an unlisted water, a county's drought percentages, a utility status, three grower resources, tuna PFOS and an unknown food with no study.
