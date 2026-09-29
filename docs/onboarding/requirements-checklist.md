# Onboarding acceptance checklist

Checked items are implemented and reviewed against the source contracts, with automated evidence summarized in verification.md. They do not claim live-provider or physical-device acceptance. Open items and deployment gates remain explicit below.

## Sources and precedence

- User-approved interactive onboarding wireframe, including its latest Welcome and logo refinements.
- Current user instructions and `AGENTS.md` override older visual and punctuation rules.
- `HALO_Frontend_Specification (2).pdf`: A1-A8, B1 (pages 18-20), D0-D3 (pages 44-45), E1-E2 (page 48).
- `HALO_Codex_Context (1).md`: context sections 5.1, 7.2, 8.1-8.2, 9.7, 10, 12-14. Its September 27 backend snapshot can be stale; inspect the current source for implemented endpoints.
- Current source confirms parameterless daily-score/home-guard, profile `onboarding_complete`, PATCH profile, rounded coordinates, and the seven-group household contract. Deployed migrations and provider configuration remain Vibhav's verification responsibility.

## Approved visual overrides

- [x] Preserve the approved monochrome shield/house/leaf mark. White on the Welcome band, contrasting foreground on light surfaces. Do not restore the blue tile.
- [x] Center the teal, bold, simple-cursive `Welcome` heading. Draw along actual pen centerlines, including loops and cross-strokes, never through a horizontal wipe.
- [x] After handwriting finishes, fade in a smaller, lighter, centered `To Halo` in the approved complementary font.
- [x] Under reduced motion, show both headings immediately; animation must never gate Get started.
- [x] Preserve the approved description, separate No account needed line, logo band, layouts, field order, spacing, colors, controls, and reveal design.
- [x] No U+2014 em dashes in app-facing strings, metadata, accessibility labels, or displayed backend text. Use approved natural punctuation without changing meaning.
- [x] The wireframe reviewer controls, sample-state selector, and prototype status are not production UI.

## Flow and navigation

- [x] `/onboarding` provides Welcome, Address, Household, Your home, and results reveal with no global header, tab bar, or Assistant button.
- [x] Four-part progress indicator appears on form steps, not Welcome. Back starts at Address.
- [x] Each step creates a browser-history entry; browser Back and the visible Back control preserve current in-memory values.
- [x] Address and GPS coordinates never enter localStorage, sessionStorage, query strings, analytics, or logs. The request uses an authenticated POST body.
- [x] Reload after an incomplete profile restarts at Address because the raw address was not retained. Do not confuse `onboarded` with `onboarding_complete`.
- [x] Successful complete profile routes to Today. Failed profile check with `halo.onboarded` routes to Today and retries in the background. Failure without that flag enters onboarding.
- [x] Successful incomplete profile clears the completion flag and cached readings so a newly minted anonymous session cannot inherit another session's results.
- [x] The completion flag is set only after home details save successfully.
- [x] Final See my results goes to `/today`; the handoff must explicitly identify whether Today is fully implemented or an integration boundary.
- [x] Changing an already stored address invalidates old client readings and requests daily-score with `fresh=1`; a same-location cached reading must not masquerade as the new home's result.

## Welcome and anonymous session

- [x] Reuse `ensureAnonSession()` and `authedFetch`; requests use bearer identity, never `profile_id` from body/query.
- [x] Get started is disabled only while session establishment is pending or failed, not while the handwriting is running.
- [x] CAPTCHA failure and sign-in failure have their distinct specified, user-readable copy and a usable recovery path.
- [x] A genuine 401 silently resets once; 503 never resets identity. Avoid concurrent reset calls minting competing sessions.
- [x] Expiring access tokens are refreshed without orphaning the existing household.

## Address

- [x] Visible label, street-address autocomplete, 16px-or-larger input, specified placeholder, privacy statement visible before typing.
- [x] Trimmed address requires at least five characters. Validate on blur and on submit; clear an existing error as soon as input becomes valid.
- [x] Invalid input does not disable Continue; successful validation submits `POST /api/onboard { address, request_id }`, with a new UUID for each attempt.
- [x] Geolocation is requested only when Use my location is activated. Display Using your current location, send `longitude,latitude` in that order, and never use a fabricated fallback location.
- [x] Unsupported geolocation and denied/failed geolocation show their distinct specified messages. Typing in the input discards acquired coordinates.
- [x] In-flight submit disables duplicate requests and shows the button's working state plus Finding your local data.
- [x] 404 preserves input and shows address-not-found copy; 429 shows the specified rate-limit copy; 500/network/503 show safe generic copy with retry. Never display a raw server error.
- [x] Use a 15-second client timeout. After onboard timeout, check GET profile before reporting failure because the write may have completed.
- [x] Preserve county, state, pwsid, and service_area_status in memory for reveal. `outside_known_area` is a normal result; `lookup_failed` is not evidence of no utility.
- [x] Non-NC addresses continue normally. Missing state is not positive evidence of an out-of-state address.

## Household

- [x] Seven initially unselected chips in order: Toddler, Child, Teen, Adult, Senior (65+), Someone pregnant, Someone with asthma or a breathing condition.
- [x] Every chip exposes its selected state accessibly, supports keyboard activation, and has a 44px minimum target.
- [x] Continue sends all seven `has_*` keys as actual booleans to PUT household, including false values. No groups are required.
- [x] Skip this and Continue share equal visual weight. Skip issues no household request. A previously saved household is not silently reset by a later Skip.
- [x] Save failure preserves selections and allows another attempt. In-flight saving prevents duplicate writes.

## Your home

- [x] Year built is optional, numeric keypad, digits only, and has the approved lead-solder explanation.
- [x] Blank year sends `null`; valid year sends a number. Accept four digits, 1700 through the current year. Future year has distinct error wording.
- [x] Required water choices are City or town water, Private well, Spring, Other, Not sure. Map them to `utility`, `well`, `spring`, `other`, `other`.
- [x] Keep the user's distinct Not sure choice in the active form even though the stored contract normalizes it to other.
- [x] Submit PATCH profile with only home details, without resending the address. Failures retain both values and allow retry.
- [x] Do not send a well/spring household to utility measurements solely because an address falls in a utility boundary.

## Results reveal and honest data handling

- [x] Fetch GET daily-score and GET home-guard concurrently using stored profile defaults. Do not pass identity, location, or home-detail overrides for first-run reveal.
- [x] Warm the shared readings cache only from successful payloads; never cache mock data as live household readings.
- [x] Four labels/results remain visible even when data is absent. Resolve their indicators from actual request state, not fabricated success timers.
- [x] Reduced motion shows all four rows together. Network loading remains honest. Requests that fail still allow the final button after settlement.
- [x] Air uses only `air.severity`; unknown or absent severity becomes No data, distinct from Good. Every shown severity includes label, icon, and color.
- [x] Water names use `water.pws_name`; no-data-yet/lookup-failed may use the stored PWSID fallback. Private well and spring have the appropriate no-utility result.
- [x] Water branches cover measured, no_data_yet, lookup_failed, no_pwsid_available, private_well, detected_unregulated, null, and missing fields. A missing payload is never below-limits or zero.
- [x] Above-limit wording comes only from server `exceeds_limit: true`, selecting the highest server-provided risk. Never recalculate a threshold or display guidance-only values as enforceable federal-limit findings.
- [x] Empty/missing contaminant arrays do not imply a reassuring measurement when measurement evidence is absent.
- [x] Out-of-state no_data_yet uses the NC-coverage explanation rather than claiming publication is pending.
- [x] Radon checks out_of_state before error because the backend supplies both. Known zones display Zone 1, Zone 2, or Zone 3; missing/unknown/error never defaults to a zone.
- [x] Missing county/home-guard 400 yields Couldn't check right now on affected rows, not a crash or invented county.
- [x] Partial failure preserves successful rows. Complete failure differs from successfully empty results.
- [x] Known out-of-state addresses show the approved coverage note.

## Shared foundation and accessibility

- [x] Translation keys contain app-owned strings from day one. No unreviewed Spanish health copy is shipped.
- [x] Shared severity mapping, formatting, request errors, data state wrapper, and data hook are reused instead of per-screen variants.
- [x] Light/dark colors are tokens and dark mode follows system settings. App controls do not expose wireframe theme/fidelity controls.
- [x] Visible focus, logical keyboard order, field error association, alert/status announcements, focus placement after navigation, and 44px targets are verified.
- [x] Phone layout is the actual viewport, not a fake fixed phone frame. Check 320, 375, 430, and desktop widths, long text, text enlargement, safe areas, and no horizontal overflow.
- [ ] Full source/date detail destinations belong to Today and HomeGuard, not the approved minimalist reveal. This deliberate scope boundary is documented in integration.md; no absent provenance is invented.
- [x] Metadata/title punctuation follows the no-em-dash rule. Default Next favicon is replaced and app identity assets are connected.
- [x] No console errors, duplicate submissions, unhandled rejections, inaccessible hidden controls, or stale async results after Back/unmount.

## Required test matrix

| Area | Cases to cover | Evidence/status |
| --- | --- | --- |
| Routing | new profile, complete profile, partial profile, failed request with/without flag, genuine reset | Implemented; see verification.md for automated coverage and remaining live checks |
| Address | empty/short/valid, 404/429/500/503, timeout then stored location, timeout without location, retry, double submit | Implemented; see verification.md for automated coverage and remaining live checks |
| Location | success, denied, unsupported, timeout, typed override, longitude-first request, no implicit prompt | Implemented; see verification.md for automated coverage and remaining live checks |
| Household | none/all/subset, exact seven-key payload, Skip zero writes, retry selection retention | Implemented; see verification.md for automated coverage and remaining live checks |
| Home | blank/1699/1700/current/future/non-digit year, missing water, all five water options, save failure | Implemented; see verification.md for automated coverage and remaining live checks |
| Reveal | above/below limits, guidance-only, unknown payload, utility absent, well/spring, unregulated, no published results, lookup failure | Implemented; see verification.md for automated coverage and remaining live checks |
| Reveal geography | NC Zone 3 fixture, Zone 1/2 fixtures, missing county, absent state, out-of-state matching county name, out-of-state no_data_yet | Implemented; see verification.md for automated coverage and remaining live checks |
| Reveal requests | one failed, both failed, delayed, stale response after navigation, parameterless requests, successful cache warm-up | Implemented; see verification.md for automated coverage and remaining live checks |
| Navigation | every Back/forward transition, preserved values, refresh clears raw address, completed entry, change-address flow | Implemented; see verification.md for automated coverage and remaining live checks |
| Visual | approved screens/states, light/dark, 320/375/430/desktop, text zoom, reduced motion, welcome animation sequencing | Implemented; see verification.md for automated coverage and remaining live checks |
| Privacy/security | no raw address storage/log/URL, no server errors exposed, no em dashes, no identity in body, no live mock contamination | Implemented; see verification.md for automated coverage and remaining live checks |
| Quality | type-check, lint, tests, production build, browser console, keyboard, mock-only E2E | Implemented; see verification.md for automated coverage and remaining live checks |
| Integration | real anonymous auth, migrations, real provider payloads, three district addresses including no utility, physical phone | Vibhav/team verification required |

## Integration questions and known boundaries

1. Local frontend tests must mock requests. This project's local environment can point at the production Supabase database; do not create test households or consume provider quota unintentionally.
2. Migration 0009 and anonymous auth must be verified in the deployed project. Current source alone does not prove deployment readiness.
3. HomeGuard currently has no top-level retrieved_at/assembled_at field. Use water sample ISO dates where appropriate; never label browser receipt time as source freshness. Ask Vibhav for source-date availability needed by later screens.
4. The federal-testing reveal must distinguish enforceable limits from non-enforceable guidance. The PDF's shorthand above-limit example does not authorize calling guidance a legal limit.
5. The all-screen source/date definition of done is broader than the approved minimalist reveal. Preserve the approved composition and document how Today/HomeGuard will expose full provenance instead of silently claiming it exists.
6. Onboard timeout recovery compares the stored `onboard_request_id` with the submitted UUID, including when an older location existed. Applying migration `0014_onboard_request_id.sql` and checking the live behavior remain release gates.
7. Skipping after a previously successful household save cannot mean erase composition because Skip explicitly sends no request. Existing server selections remain until a new Continue saves all seven booleans.
8. Actual backend/provider integration and real-device verification are separate completion gates from a frontend passing mocked tests. Do not mark them complete without evidence.
