# Foundation production build and backend seams

This is the checklist for the build **after wireframe approval**, not a claim these live features already exist. No backend code is changed in this wireframe branch. API names are P3 and Part D; current implementation was read at main `9f1ef88`. The backend being complete does not remove additive contract follow-ups in P9.

## P2/P3 production implementation checklist

- Extract `haloRequest<T>(path, {method, body, signal, timeoutMs})` from the existing private onboarding request without changing behavior. Bearer-token identity only, check identity before/after, safe body parsing, abort/deadline, mapped `FrontendError`. Never render server `error` text. Keep auth's single-flight 401 recovery; 503/502/504 unavailable never resets the household. Add not_found/invalid_request/unsupported, preserve 429 retry_after_seconds.
- `useHaloData<T extends object>`: endpoint nullable, loader/enabled/cache/isEmpty; data/status/error/retrievedAt/fromCache/refreshing/refresh. Stored data stays on screen through refresh failures; one-call `fresh:true` only on explicit pull-to-refresh, no fresh on 15-minute focus refresh. P3's loader signature omits a fresh argument while requiring it later in prose: add a backwards-compatible optional second loader argument, document and test it rather than silently dropping fresh.
- Deadlines: auth/onboard/daily/home 15s, map/district 20s, Assistant POST 25s, everything else 8s. Mock delays in preview are not production timeout values.
- One `useProfile()` result per app session. Reset memory on `halo:identity-changed`; no per-page duplicate profile requests.
- One shared route-group shell with `.halo-app`, safe areas, header, offline banner, main, assistant, tab bar, sheet and toast hosts; move Today stub without breaking `ProfileRecheck` on `?verify=1`. All five tabs and Settings use it. Onboarding stays outside.
- `AppGate`: ensure session + profile; route on `onboarding_complete`, never `onboarded`; identity-scoped completion marker. Incomplete successful response clears marker/readings; unknown profile with valid marker keeps Today + `verify=1`. Preserve interrupted deep link in `next` and restore after completion. Incomplete daily `no_location` / home `no_county` sends to onboarding. Don't introduce a new blocking profile-error page contrary to A1.
- Export exactly `openLearn`, `openAlerts`, `openAssistant`, `closeSheet`, `useSheets`, `useToast` as P3. Standard/tall/content BottomSheet registration, one host, safe-context filtering, pasted Learn/system link handling. Replace nested sheets, close by replace before pushing a route; native Back/focus/scroll behavior verified in mock before live binding.
- Extract new shared UI proposals into the P2 per-component entry files without geometry changes. Controlled and uncontrolled/defaultOpen support where P2 requires it. The wireframe composition currently uses controlled cards/accordions to demonstrate one-open rules. Page branches reuse, not restyle.
- Move foundation tokens to `:root, .halo-app`, keep hosts inside shell too; split shared CSS from onboarding without changing its approved selectors/appearance. Convert shared fonts to text-scaled rem. Approved rounded onboarding layout must also stay identical at 100%.
- `text.ts`: move and re-export displayText/contaminantLabel/normalizeSeverity/isOutsideNC from old module; every displayed server string passes through displayText, U+2014 becomes comma + space. Existing no-em-dash scan extends to new feature files and every browser state.
- `format.ts`: Aqi integer, UV one decimal, ppt one decimal, ratio one decimal ×, display_score integer, population commas/no fake zero and at-least for incomplete, cost ranges, percent (integer rates vs fraction shares), relative timestamp, month/day, lab month/year, strict split local dates, America/New_York today, weekday initial, utility title-case with state/WTP acronym preservation. Never use compatibility M/D/YYYY dates or compute severities in client.
- `copy/<feature>.ts` namespaces today/homeGuard/journal/act/settings/alerts/learn/map/assistant/shell; don't reuse onboarding `copy.home`. Empty type/API/css/preview scaffolds only after production foundation build; current review file is isolated.
- Identity namespace `halo.frontend.v1.<identity>.*`, include history cache kind; clear on address/identity changes. Device namespace `halo.device.*` only text/contrast/motion, survive address change, removed on Delete everything. Strip coordinates from reading storage; Map needs a separate IndexedDB store, not storeReading.
- Settings `saveHousehold` reads current profile first, disables until known, sends all seven booleans (has_toddler/child/teen/adult/senior/pregnant/respiratory) and optional renter_mode/locale, serializes overlapping saves in arrival order. Never use PUT response as full profile. Successful wording changes clear readings and dispatch `halo:settings-changed`; Today/Home/Act refetch. Act sheets fresh on open.
- Bell module owns alerts fetch; app load, focus after 15 minutes, sheet close refresh. Opening doesn't clear unread, row reads do. Optimistic read/dismiss/undo reverts on failure. Full Alerts sheet is later; production slot absent until ready, no dead button.
- Load Plex Mono globally with local font variable once approved. Generate favicon/app icons 32/96/192/512 and 1200x630 sharing preview + manifest from the approved transparent logo, without changing the mark. This wireframe adds font/license only; identity packaging is production implementation, not a new logo design.
- Device accessibility: HTML data-text-scale (100/115/130/150), data-contrast, data-motion + `.halo-app --halo-text-scale`; honor system reduce-motion. Higher contrast palette needs user approval. Appearance follows OS, no product toggle. Production notification switch hidden until service worker built (P10 D8).
- Onboarding P7 before Settings: Change address Back returns to Settings, completion Today; retain prefilled household step by default. Don't change approved visuals while making these flow fixes.
- Production route exposure gate: preview hidden unless development or explicit `HALO_ENABLE_FRONTEND_PREVIEW=1`. Keep all mock state constructors outside live adapter and never automatically fall back to fixtures in production.

## API bindings that affect foundation visuals

| Surface | Fields / action | Safe behavior |
| --- | --- | --- |
| Entry gate | GET /api/profile: onboarding_complete, profile, household; hasCompletedOnboarding/markCompleted | Never treat an unknown/failed profile as a successful empty profile, never render id/coordinates/request id. |
| Score/ring | daily/home score.display_score, score.severity, score.is_partial, score.included_inputs/missing_inputs | Unknown/null severity = no_data; no score invented from risk. Partial server assessment, not client classification. |
| Cards and provenance | air.aqi/is_measured, uv.index, pollen.dominant/category values, mold.is_proxy, server sentence fields | Server household wording only. Measured true, modeled false, unknown hidden. UV/pollen provenance absent, mold estimate. |
| Confidence | HomeGuard confidence fields, lead.level/is_estimate, radon.zone | No full-confidence pill. No fake Today confidence. |
| Thresholds | water.scored_contaminants[].value_ppt/limit_ppt/exceeds_limit/is_enforceable/date_iso; optional severity | Ratios only position charts. Exceedance flags/server severity determine words/color, never client thresholds. |
| Freshness/cache | retrieved_at, assembled_at, history.to | Date from response; lab *_iso dates, no legacy-date parsing. Cached failure retains known readings + known timestamp. |
| Badge/read/dismiss | GET /api/alerts.unread and alert rows, existing read/mark-all/dismiss/undo methods from D5 | No opening-as-read. One fetch owner, failure reverts, inline if action required. |
| Learn | GET /api/learn?topic=... with safe topic-specific context | Reading pill only for matching loaded page data; generic Learn has no Your reading or why-yours section. |
| Assistant | GET /api/assistant suggestions/disclaimer; POST question/page | Placeholder not live conversation. Future response privacy flag and grounded/refusal/unavailable states must be implemented in C2 stage. |

Sample fixture shapes are component props, not a counterfeit Part D API response. Every numeric sample is explicitly a review example. No endpoint-shaped mock has been silently substituted for a live adapter.

## P9 additive asks and defaults

| # | Ask | Current source evidence / interim frontend rule |
| --- | --- | --- |
| 1 | Per-scored-contaminant severity | waterPresentation.scoredWithFlags adds date_iso/exceeds_limit, not severity. Use water box severity for exceeding rows; neutral otherwise until field is added. |
| 2 | Assistant sends_household_context boolean and only explicit true enabling | GET currently emits suggestions/disclaimer only; POST still checks env !== 'false'. Do not claim public-only privacy from an absent field. Deployment must set literal false until code fixed; intended product default/public-source wording is false state. Cannot verify deployed env from source. |
| 3 | Assistant maxDuration=30 | Route has no maxDuration export at checked main. Client 25s; no frontend blocker. |
| 4 | History backfilled/is_partial | Current GET select/map omits these. Compare only when B2 allows; never invent yesterday's fully measured score/change. |
| 5 | Remove server em dashes | frontend displayText normalizes every visible server string; source cleaning remains backend work. |
| 6 | Replace raw server database errors | Some routes including history/assistant still return err.message. Never render it; map frontend errors independently. |
| 7 | Map suggestion vocabulary | Test server suggestion for 'not tested' mismatch with 'No detection reported' in Map stage; not a reason to invent a different response shape now. |
| 8 | Capped reason text | HomeGuard source includes capped wording. Display only when score.capped === true; track honest fallback in HomeGuard review. |
| 9 | Empty district/water payload caching | Reject zero-total or mostly-unlocated payload as no data per B7, keep known-good prior data. Geography degraded response and affected_population incomplete are not all-clear zeros. Verify provider/deployment behavior in Map stage, no production requests were made in this review. |

Migration/deployment completion is owned by backend and not inferred from this local source review. No real household mutations, model requests or external provider tests were performed. Record final live compatibility during each page's build, not during foundation design approval.

## Future page visuals and test gates

A10's house diagram, calendar grid, seven-day/quarterly trends and district comparison bars remain on their page checklists. They are not missing shared P2 components. Same palette/units/text equivalent, gaps for missing readings, no interpolation. The fixed threshold marker is studied here so later charts stay comparable.

After approval: frozen per-state screenshots + immutable comparisons, all existing onboarding/mobile tests, data/auth/session/deadline/cache/form unit tests, production route-gate smoke, keyboard/Back/drag/focus/scroll flows, 320/375/430px both themes, 150% text, contrast checks, physical-phone Safari/Chrome and screen reader acceptance. Live API checks only after explicit safe test identity/environment, never destructive tests against the configured production household.
