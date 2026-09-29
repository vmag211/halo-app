# Onboarding frontend verification

Verified on September 28, 2026, on Windows with installed Chrome and Node. All browser flows use the isolated mock adapter, and browser tests block external hosts and live `/api/` routes. No real household, provider quota, database migration, or backend route was changed by these tests.

## Automated checks

- The full repository Node test suite passed: 345 tests, including the frontend API, authentication, validation, cache, and result-binding tests.
- TypeScript checking passed.
- ESLint passed with zero errors. The six remaining unused-variable warnings are in existing backend/scripts/tests outside this frontend change.
- The optimized production build passed on the repository's pinned Next.js 16.2.10.
- All 36 browser tests passed. The suite covers complete flow, keyboard chips, browser Back/forward with retained values, blank/invalid/future years, address errors, session/household/home retries, GPS success/denial/unsupported, typed GPS override, offline recovery, cancellation after Back, and final navigation.
- Seventeen result scenarios cover measured above/below limits, wells, springs, missing utility, boundary failure, unpublished/unregulated/failed water results, unavailable radon, out-of-state coverage, missing/unknown air severity, null fields, and partial/total request failure with Retry.
- The Welcome animation was checked while running: Get started is usable while pen strokes draw; To Halo stays hidden until writing completes. Reduced-motion comparisons show both headings immediately.
- All 20 default-screen visual comparisons passed against the original approved PNGs: five screens at 320 and 375 px, in light and dark mode. The tolerance is 0.5% for rendering differences; no reference screenshot was rewritten. The sample data was chosen to match the archived default states.
- Layout checks also passed at 430 and 1280 px, including enlarged household text, minimum button target sizes, and no horizontal overflow.
- `npm run preservation:verify` verified 204 archived files with no changes. The archive includes 179 reference PNGs and the offline interactive source, exact fonts, approved logo, and original product documents. `.gitattributes` disables newline conversion for this evidence so a later Git checkout preserves its hashes.

Run all browser checks with `npm run test:ui`. They use installed Google Chrome and start/reuse port 3010 on loopback. The report and failure traces go to ignored `playwright-report/` and `test-results/`, not the design baseline. Do not use snapshot update commands to hide visual regressions.

## Verified by code/contract review, with live acceptance outstanding

- First-entry routing distinguishes `onboarding_complete` from a location-only profile. A scoped cached completion marker can enter Today after a profile-check failure; `ProfileRecheck` retries that check in the background.
- Every real request uses the existing bearer-auth helper, never a user-selected profile ID. Repeated 401 recovery is single-flight; 503 does not reset identity. Cancellation and session changes discard obsolete payloads, including changes during JSON decoding.
- Household Continue sends all seven booleans. Skip makes no household request. Home year is optional/null; Other and Not sure both save `other` without losing the distinct active-form selection.
- A replacement address clears cached readings and requests daily readings with `fresh=1`. The initial reveal is parameterless. Failed refreshes never display the previous home's readings.
- No raw address, GPS input, household draft, or credentials are stored by the frontend cache. Backend messages are mapped to safe catalog text. App/source display strings are normalized to remove em dashes.
- The approved logo replaces the starter favicon through a reproducible format-conversion script. The transparent white Welcome mark and the title stroke geometry are unchanged.

## Live backend run (September 28, 2026)

A scripted Chrome run drove the real flow on a local dev server against the configured Supabase (migration 0014 applied), Mapbox, ArcGIS, AirNow and HomeGuard, then deleted its anonymous test user. Verified: an anonymous session is created; ZIP 28025 geocodes to Cabarrus County, NC with a measured utility; onboard stores and echoes the request ID; stored coordinates are rounded to three places; household, home details and `onboarding_complete` save; all four reveal rows resolve with no failure; HomeGuard returns `assembled_at`; finishing opens Today and a returning complete profile skips onboarding. Change address opens on Address, keeps home details, saves a Durham County address with a new request ID, requests `fresh=1` readings that are not rate-limited, and clears the previous home's cached daily reading.

## Not yet release-verified

Vibhav still needs to verify deployed anonymous auth/CAPTCHA (the live run had no Turnstile key configured locally), a real timed-out address write, concurrent address writes, and the deployed production integration. Test on physical phones, particularly Safari, safe-area behavior, on-screen keyboard, actual GPS prompts, assistive technology, and browser text enlargement. Desktop Chrome fixtures do not prove those conditions.

The Today route is an explicitly labeled integration boundary, not the full dashboard. Later screens will expose source dates and full provenance; the approved onboarding reveal was not redesigned to invent those destinations.

Next.js is upgraded to 16.3.6 and `npm audit --omit=dev` reports 0 vulnerabilities; see integration.md. Passing frontend tests is not a claim that the whole application is production-ready.
