# Onboarding integration handoff

The frontend is implemented against the repository's current route contracts. Automated verification uses fixtures and intercepted requests, not real household writes or provider calls. This document separates ready frontend bindings from the live verification still needed by Vibhav.

## Binding map

| Stage | API | Request | Successful transition |
| --- | --- | --- | --- |
| Session bootstrap | `ensureAnonSession()` from `lib/auth.js` | No identity input | Enable Get started |
| First-visit routing | `GET /api/profile` | No parameters | Route using `onboarding_complete`, never `onboarded` alone |
| Address | `POST /api/onboard` | `{ address, request_id }`, including device GPS as `"lng,lat"` | Household |
| Household Continue | `PUT /api/household` | All seven real boolean keys, every time | Home details |
| Household Skip | None | No save | Home details |
| Home details | `PATCH /api/profile` | `{ water_source, home_year }` | Reveal only after a complete profile is returned |
| Reveal, in parallel | `GET /api/daily-score`, `GET /api/home-guard` | No parameters | All rows resolve independently; failures do not block final navigation |

`lib/frontend/types.ts` defines the typed seam. `createLiveOnboardingApi()` in `lib/frontend/api.ts` uses dynamic imports of the existing authentication client, so unconfigured or preview environments do not instantiate Supabase during rendering. The mock adapter never calls authentication, fetch or storage. Mock results must remain visibly marked as preview data and cannot be enabled silently in a production path.

`water_source` uses `utility`, `well`, `spring`, or `other`. The distinct Other and Not sure UI options both send `other`. Blank home year sends `null`, not zero or an omitted field. No request contains a client-selected `profile_id`.

## Error and cancellation rules

- The normal client deadline is 8 seconds. Address submission, HomeGuard and daily readings use 15 seconds, including auth/transport/response parsing. The session bootstrap uses 15 seconds to allow the existing CAPTCHA flow.
- `FrontendError.code` is the frontend contract. Raw server `error` strings are never displayed. Status 404 on address maps to the address-specific copy; 429 maps to rate-limit copy; 503 maps to a retryable generic failure and never resets identity.
- Existing `authedFetch` owns definitive 401 recovery. The frontend compares the current identity before and after every request. A changed identity invalidates cached data and rejects the old response with `session_changed` instead of displaying another session's data.
- A browser-wide auth observer clears frontend cache and emits `halo:identity-changed` when identity changes. It does not reset authentication or create a session.
- Abort signals flow through every data request. Aborted/stale requests do not publish results or populate caches.

## Timeout ambiguity requiring backend confirmation

After an address request times out, the adapter rechecks `/api/profile` before showing the error. Each submission now sends a fresh UUID as `request_id`. When `profiles.onboard_request_id` equals that UUID, the frontend can confirm that particular write and proceed, including during Change address. A different ID cannot confirm the write. On a deployment without migration `0014_onboard_request_id.sql`, the adapter can only recover a first address when a profile known to have no coordinates gains them; timed-out replacements still ask for a retry.

## Fresh readings on address replacement

The initial onboarding reveal is parameterless, as specified. After replacing an existing location (including resubmitting Address after Back), the frontend clears old local readings and calls `/api/daily-score?fresh=1`, as specified for Change address. HomeGuard remains parameterless. The adapter gives the refresh the same 15-second deadline and error handling as the initial reading. A failed or rate-limited refresh stays unavailable and never falls back to the old home's cache.

The current checkout also contains backend changes that clear today's old-location reading and reset the daily-score limiter when coordinates change. Vibhav must apply migration `0014`, verify the cache invalidation and refresh rate limits against the deployed service, and exercise concurrent address writes before Change address is live-accepted.

## Honest result binding

- Private wells and springs use their own no-measurement language, even if an old public utility ID exists.
- Failed boundary lookup is not a finding that no utility exists. It stays unavailable if no reliable utility result follows.
- Water `no_data_yet`, `lookup_failed`, `no_pwsid_available` and `detected_unregulated` remain distinct. A missing/null response never becomes a below-limits claim.
- Above-limit federal wording requires both `exceeds_limit: true` and `is_enforceable: true`. Ranking uses the server's already-computed `risk`, never frontend thresholds. A missing enforceability flag produces no affirmative federal-limit assertion. Vibhav should retain these flags on all scored entries.
- `HFPO-DA` displays as `GenX (HFPO-DA)`.
- A below-limits claim requires explicit non-exceedance flags or a server `no_detections` coverage result. Missing flags, unscoreable compounds and non-binding guidance do not imply safe water.
- Air reads the canonical `severity` field, never legacy `status`. Unrecognized words or a missing numeric AQI render No data, not Good. Numeric zero is a real reading.
- Radon checks `out_of_state` before `error` because an out-of-state response contains both. Missing/invalid zones are unavailable. No zone is a measurement of the home.
- A known non-NC state and water `no_data_yet` use NC-coverage language, not an assertion that unpublished results are forthcoming. Missing state is not evidence of being outside NC.
- App-facing copy is centralized in `lib/frontend/copy.ts`. Source-provided display strings replace em dashes before rendering.

## Persistence and routing

`lib/frontend/storage.ts` persists only a versioned, identity-scoped completion marker and the last successful daily/HomeGuard readings. It never persists raw address input, household selections, profile coordinates or credentials. Sensitive nested keys are stripped from cached responses. Input drafts live only in component memory and are lost on reload by design.

The `halo.onboarded` marker is now a JSON record `{ version: 1, identity, complete: true }`, not a bare boolean. A legacy unscoped flag is ignored until the server confirms completion. This prevents the previous session's local flag from granting access to a new session's blank profile. Completion requires the server flag, valid coordinates and a recognized water source. A successful incomplete profile response clears completion and readings. Restricted/private-mode local storage cannot block the flow.

Entry with a complete cached marker and an unavailable profile check goes to `/today?verify=1`. `ProfileRecheck` retries the profile in the background, redirects an incomplete profile to onboarding, and offers Retry if verification is still unavailable. It does not silently loop or reset identity.

Reading-cache `receivedAt` is distinct from backend `retrieved_at`/`assembled_at`. The latter drives displayed freshness; a browser receipt time is never substituted when the backend timestamp is absent. The existing HomeGuard response has no timestamp, so its cached freshness remains unknown until a backend timestamp is added.

## Vibhav's live acceptance checks

1. Configure the public Supabase variables and anonymous auth/CAPTCHA settings. Confirm a new device creates one anonymous identity; 503 retains it, and a genuine invalid-account 401 recovers without mixing profiles.
2. Confirm applied migrations and `/api/profile` returning complete flags, nullable fields and seven household booleans. Exercise new, incomplete and complete profiles.
3. Submit a disposable NC location. Confirm address input is not stored, coordinates are rounded, and the water boundary result is preserved. Repeat with unmatched, failed boundary and outside-NC cases.
4. Verify Household Skip performs no call and Continue performs a full seven-boolean replacement. Confirm blank year and both Other/Not sure normalization.
5. Verify parallel reveal responses against real backend fields for public water, wells, springs, missing data and provider errors. Complete navigation must remain available after a failed reveal lookup.
6. Apply migration `0014_onboard_request_id.sql`, verify an address replacement clears the old daily reading, and retry a timed-out replacement. Confirm the returned profile carries the matching request ID.
7. Test the integrated flow on an actual phone, including keyboard, GPS permission denial, browser back, low connectivity, reduced motion and large text. Offline fixtures and desktop browser checks do not substitute for this step.

The Today destination and later app stages are separate features. Their full visual/product implementation is not implied by completing onboarding.

## Dependency release gate

The existing pinned Next.js 16.2.10 dependency has security advisories. `npm audit --omit=dev` on September 28, 2026 reports 5 affected production packages: 1 critical, 3 high, and 1 moderate. The critical entry is Next.js; the audit recommends 16.3.6. The Windows-hosted-server and image-optimization advisories require review before deployment. This onboarding change does not silently upgrade the shared framework while backend work is in progress. Coordinate the framework/dependency update with Vibhav, then rerun the complete test/build suite. The local preview binds to loopback only.
