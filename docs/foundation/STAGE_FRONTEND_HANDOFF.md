# Approved-stage frontend handoff

Status: production frontend integration for Vibhav to merge and validate against the configured backend. This is not a claim that the entire HALO app is complete or that a live deployment has passed acceptance. No backend routes, scoring algorithms, database schema, migrations, or backend environment configuration were changed for this stage. Development and browser verification use local fixtures, not live user or provider data.

The user approved Today, Homeguard, the seven factor detail pages, Today household guidance, the seven Homeguard household categories, Luna, and the shared navigation before this implementation. This approval supersedes the earlier proposal-only status for those surfaces. Onboarding retains its separately approved rounded design, logo, and handwriting.

## Immutable visual reference

- Branch: `codex/approved-stage-frontend`.
- Repository baseline: `72a2c5150ecfe354fa6b534781e8b6b090d0bda1` (`72a2c51`).
- Approved Site version 8 source: `d703965f8348757b599fb04ef3b27b2a9d89916a`.
- Archive: [`approved/2026-10-01/`](approved/2026-10-01/README.md). Its SHA-256 seal covers 146 files, including 132 screenshots: 33 cases at 320px and 375px in both appearances.
- The archive preserves repository source, exact Site source, the built export and fonts, copy/control inventories, checksums, capture scripts, and the successful byte-identical replay report. It does not depend on rebuilding the current implementation.

Run `node docs/foundation/approved/2026-10-01/verify.cjs` to check the seal. Follow its README to capture a candidate and compare it. Do not reseal or update the approved images to accept a regression. A new design approval belongs in a separate archive.

The unchanged fixture/preview contract is the visual-preservation comparison target. Production routes intentionally replace fixture scores, dates, locations, household selections, suggestions, and replies with actual response values or explicit missing/error states. Conditional evidence panels, authenticated gates, and live pending/error states are not falsely asserted to be byte-identical to a fixture screenshot. Production geometry/data checks are separate from approval-image checks. Preview routes are unavailable in production unless `HALO_ENABLE_FRONTEND_PREVIEW=1` is deliberately enabled for local review; leave that opt-in unset for deployment.

## Routes and scope

| Route | Delivered surface |
| --- | --- |
| `/today` | Current daily score, four current environmental factors, available risk-input contribution geometry, and household entry |
| `/home` | Homeguard score and evidence coverage, water/radon/lead cards, selected household categories, and server-returned action plan |
| `/factors/{factor}` | Dedicated details for `air`, `uv`, `pollen`, `mold`, `pfas`, `radon`, and `lead`, including reading/history where available, explanation, protection, and sources |
| `/family` | Today guidance for the saved household, current readings, and returned Learn content |
| `/household/{member}` | Homeguard guidance for `toddler`, `child`, `teen`, `adult`, `senior`, `pregnant`, or `respiratory` |
| `/settings` | Essential household, home year/water source, confirmed change-address flow, and device accessibility preferences |
| `?sheet=assistant` / `?sheet=alerts` on a stage route | History-aware Luna/alerts panels; Back closes the panel before leaving the page |
| `/onboarding` | Existing approved onboarding, incomplete-profile entry, and `/onboarding?change=1` address change |

Invalid factor/member routes do not select a fixture fallback. `safeStageReturn` allowlists supported internal routes and section hashes, strips unrelated query data, and prevents open redirects. Legacy Today `?learn=` and Homeguard `?learn=`/`?risk=water` links map into the corresponding dedicated factor detail page. Factor section links use the existing reading/protection/source anchors.

Today and Homeguard navigation work. Map, Journal, and Act remain visible in the approved bottom navigation but explicitly announce that they are later-stage features. They have no approved design or completed production route in this handoff. Full account management, notification preferences, and language settings are also deferred. The existing alert inbox's read/dismiss actions are not a replacement for notification preferences. No new Map, Journal, Act, purchase, authentication-provider UI, or account-deletion implementation is implied.

## Integration boundaries

`app/(halo)/layout.tsx` mounts `components/stage/StageApp.tsx`. `StageSession.tsx` owns profile gating, identity-safe requests, environmental/history state, Learn state, and alerts. `components/foundation/StageRuntime.tsx` supplies normalized live values to the existing foundation components. Without that provider, the approved preview contract stays fixture-driven. Production code must not select fixture data when a response is absent.

`lib/frontend/stage-api.ts` exposes `createLiveStageApi(options?)` and `LiveStageApi extends OnboardingApi`. It shares the existing identity-checked protected transport in `lib/frontend/api.ts`; there is no second authentication path. Every request accepts cancellation, uses safe error codes, checks identity around the response, and validates relevant payload shape before caching or display. The factory itself does not create a session. The current normal request deadline is 8 seconds, onboarding/daily/home is 15 seconds, and Luna POST is 60 seconds (`assistantTimeoutMs` is injectable for tests/integration). The latter is an explicit implementation difference from older 25-second planning text, not fake streaming.

| Frontend seam | Existing backend binding | Handling |
| --- | --- | --- |
| `ensureSession`, `getIdentity`, `getProfile` / `loadProfile` | Existing Supabase anonymous-session/auth helpers; `GET /api/profile` | Profile completion is checked before household-specific content or edits |
| `getDaily(signal, {fresh})` | `GET /api/daily-score`, explicit refresh adds `?fresh=1` | Returned readings, score, included/missing inputs, timestamp and cache marker |
| `getHome(signal)` | `GET /api/home-guard` | Returned water, radon, lead, score, breakdown, testing/action plans and evidence |
| `getHistory(days, signal)` | `GET /api/history?days=7` for the stage | Valid returned dates/values, missing-day gaps preserved |
| `getLearn(topic, context, signal)` | `GET /api/learn` | Allowlists seven topics and supported context keys; sources must be safe HTTP(S) URLs |
| `getAssistant(page, signal)` / `getAssistantSuggestions` | `GET /api/assistant?page=...` | Returned suggestions/disclaimer; optional privacy flag only if actually present |
| `askAssistant(question, page, signal)` | `POST /api/assistant` with only `{question, page}` | Validated response, citations, refusal/unavailable/no-source/rate-limit states |
| `getAlerts`, `markAlerts` | `GET /api/alerts`; `POST /api/alerts` with `{id}`, `{id, dismissed}`, or `{all:true}` | No optimistic false success; list reloads after a confirmed mutation |
| `saveHousehold` | `PUT /api/household` with all seven `has_*` booleans | Fresh profile/identity preflight and explicit Save |
| `saveHome` | `PATCH /api/profile` with `water_source`, `home_year` | Fresh profile/identity preflight, validation, explicit Save |
| Existing address flow | Existing `POST /api/onboard` | Confirmation before leaving Settings; existing onboarding writes/recovery retained |

The shape validators intentionally treat malformed output as `invalid_response`; they do not invent healthy defaults. Generic network/server diagnostics are not copied into app-facing errors. Server/source copy is normalized to remove em dashes, rendered as text rather than HTML, and source URLs are restricted to safe HTTP(S).

## Data truth and intentional differences from the example screens

`lib/frontend/stage-data.ts` is a display adapter, not a scoring engine. `stage-values.ts` handles strict finite numbers, dates, severities, text, and URLs. Real numeric zero is preserved. Null, absent, invalid, or unsupported values remain unknown.

- Overview scores use only a valid server `display_score`. A missing total is not zero, and a missing reading is not an all-clear.
- The current daily contract does not supply separate air/UV/pollen/mold display scores. Those factor cards therefore show **Not scored** when a reading exists and **No data** when it does not. Lead remains an unscored estimate. No `100 - risk` factor score is manufactured.
- Home water/radon factor scores use the corresponding valid server `breakdown` score only when that factor has usable evidence. Private-well/spring water has no inferred water score; the combined Homeguard score is suppressed, while usable radon evidence remains available separately.
- Contribution bars normalize available, server-included risk inputs to fill the bar. Today uses returned `score.inputs`; Homeguard uses returned water/radon risks. These shares describe **visual geometry**, not backend formula weights. The frontend does not multiply, reconstruct, or claim to explain the scoring algorithm. No-input and real-zero-contribution states are distinct.
- Server severity is respected. Missing/unknown severity becomes `no_data`; the UI does not add its own clinical or regulatory thresholds.
- Daily history uses returned AQI, UV index, and pollen values, with missing dates left as gaps. No trend is fabricated for mold. Water history uses valid dated samples; duplicate sample dates use the available maximum rather than invented interpolation.
- Source retrieval/sample dates remain source dates. Client receipt time is not presented as a newly measured or updated reading. Unsupported provider details are described as unavailable.

Water coverage and score inclusion are separate concepts. `lookup_failed`, no utility match, no data, partial coverage, no detections, excluded-only results, and private water have distinct explanations. An enforceable-limit comparison requires the response to explicitly say `is_enforceable: true`; absent enforcement metadata does not become a legal limit. Benchmark-only context is not sent to Learn in a way that would incorrectly label it an enforceable limit. Excluded compounds and unregulated detections remain available, with lithium displayed in its appropriate provided concentration conversion, without making them scored inputs.

`components/stage/HomeEvidence.tsx` adds conditional detail using the existing approved panel styles:

- Utility identity, real sample counts/date range, safe data-source links, retry for failed lookups, and Settings links for missing/uncertain water source.
- Private well/spring testing plan from returned `test_plan`, including supplied priority, cadence, rationale, testing location, and cost ranges. If the backend supplies no tests or costs, the UI states that absence. It does not order a test or infer water safety.
- Unregulated detections and excluded-from-score evidence, with the backend's reasons.
- Lead building-era context and returned utility-wide service-line inventory, explicitly not an address-level finding and not used to change the lead estimate.
- Returned home action priorities/reasons/cost/certification text. Private water directs the user to testing; missing action data is not replaced with an invented personalized plan.

## Session, storage, and Settings behavior

The production gate uses the existing anonymous Supabase session and authoritative profile. An incomplete profile or missing location/county enters onboarding with a safe return path. A previously verified identity may see its cached environmental evidence during a profile/network failure, but the household stays unknown and its fields stay disabled until the profile reconnects. A local completion marker alone does not provide household data.

Daily/home/history refresh together, with request ownership and abort protection against stale replies. Explicit refresh can request fresh daily data. Focus/visibility refresh is eligible after 15 minutes; reconnection rechecks the profile. An identity change clears in-memory profile, readings, history, explanations, alerts, and open private surfaces before restarting. Settings changes perform a soft profile recheck and readings invalidation, retaining unrelated local Settings edits rather than unmounting the form.

Only the established identity-scoped `halo.frontend.v1.*` environmental cache and `halo.onboarded` completion marker are used for offline continuity. Cache sanitization excludes profile, household, coordinates, address fields, and credentials; source-linked environmental evidence is still cached and should not be described as anonymous data. Supabase continues to own its session storage. This stage does not persist the household profile, Settings drafts, alert list, Learn responses, Luna questions, or Luna transcript. Storage access failure does not prevent the in-memory flow.

Settings holds a local draft and never autosaves. It re-fetches the current profile and rechecks identity before each mutation, merging locally edited fields with fresh untouched fields. Household PUT always contains all seven flags. Water source/year updates preserve the current untouched value; a blank year means null. Fields are disabled while profile state is unknown, offline, or either save is pending. Failed saves retain the draft, display an error, and permit explicit retry; success is announced only after the mutation and identity check complete. Success clears cached readings and dispatches `halo:settings-changed`. Address change requires confirmation, then uses the existing onboarding flow.

Accessibility choices are device-local in `halo.device.accessibility`: text size 100/115/130/150%, reduced animation, and higher contrast. Appearance follows the device. System reduced motion remains respected. These are not synced account preferences or a completed multilingual Settings screen.

## Luna contract and privacy

`LunaAssistant` keeps its default preview behavior. Live mode takes `live?: LunaTransport`, `page?: string`, and optional `onNavigate?: (href: string) => void`, in addition to its existing display props. The transport is structurally compatible with `LiveStageApi`:

```ts
getAssistant(page: string, signal?: AbortSignal): Promise<{
  suggestions: string[]; disclaimer: string; sends_household_context?: boolean;
}>;
askAssistant(question: string, page: string, signal?: AbortSignal): Promise<{
  answer: string | null; message: string | null;
  declined: boolean; configured: boolean | null;
  reason: 'no_source' | 'unavailable' | null;
  grounded: boolean; uses_household_data: boolean; disclaimer: string;
  citations: { n: number; label: string; url: string; retrieved?: string | null }[];
}>;
```

The shell sends current page tokens (`today`, `homeguard`, or `settings` where applicable). It does not send a transcript or claim that the model remembers prior messages. Only the active request's question and page are POSTed. Returned suggestions are used directly. A pending request can be cancelled; close, unmount, new conversation, and identity change cancel/ignore late work. Retry does not duplicate the user's message. Responses arrive as a whole, with no simulated streaming. Refusal has a distinct visual state; configured-false, unavailable, no-source, rate-limited, and failed requests have appropriate distinct copy/actions.

Grounded answers require the server's explicit `grounded: true` plus safe citations or explicit household-data grounding. Numeric `[n]` markers link to matching sources as superscripts. `[H]`, unknown/non-numeric markers, and numeric markers without a source are removed. Links permit only HTTP(S), do not execute model HTML, and use safe external-link attributes. Internal factor navigation closes the panel's history entry so Back does not reopen a stale conversation.

Important backend limitation: the actual current GET response does **not** expose `sends_household_context`. The UI therefore says that it cannot verify this setting; it does not promise public-sources-only processing. The current backend POST enables household context unless `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` is exactly `false`. `uses_household_data` describes an individual returned response, not what may already have been sent to the provider. Closing/deleting the local conversation cannot undo a request already sent. Vibhav must verify deployment configuration and provider data handling before launch. This frontend change did not alter either policy or backend behavior.

## Verification record and integration acceptance

Verified October 1, 2026 on Windows x64, Chrome 154.0.8037.59, Playwright 1.62.1, and Next.js 16.3.6:

| Check | Final result |
| --- | --- |
| Optimized production build | Passed, including Next's TypeScript and route generation |
| `npm test` | 380 passed, zero failures/skips |
| `npm run typecheck` | Passed |
| `npm run lint` | Zero errors; five pre-existing unused-variable warnings in untouched backend/test/utility files |
| `npm run test:stage` | 33 passed together against the managed, fake-auth production build |
| Existing `npm run test:ui` suites against that final build | 229 passed, including onboarding, motion, routing, factor/household interactions, and preview checks |
| Final independent full approval comparison | All 132 screenshots byte-identical; zero capture failures |
| `npm run preservation:verify` | 204 onboarding files and 146 foundation archive files unchanged |
| Git-staged approval blobs | All 146 SHA-256 digests matched the sealed archive |
| Whitespace check | `git diff --cached --check` passed |

The 262 browser tests exercise mocked existing API contracts, not a production load test. The stage suite includes 108 light/dark, narrow-screen/enlarged-text route visits inside its geometry cases, plus missing data, household selection, private-water evidence, alerts, pending/error/retry handling, identity changes, invalid routes, and a virtual-clock rate-limit recovery check. No live backend or live model acceptance is implied.

The final exact candidate is `test-results/foundation-production-final-replay`, verified with `node docs/foundation/approved/2026-10-01/verify.cjs --candidate test-results/foundation-production-final-replay`. Earlier comparison failures exposed fragmented JSX text-node differences, which were restored without changing live data behavior. One subsequent run had a 13-pixel, one-channel-value anti-aliasing variation at a Luna composer corner. An independent four-variant Luna replay and then an independent complete 132-image run both matched exactly with unchanged source, build, runner, and tolerances. Earlier candidates were retained unchanged; no screenshot substitution or baseline update was used. Generated test reports/candidates are intentionally ignored by Git and can be reproduced with the checked-in suites and sealed runner. Approved images and their manifests are committed.

The final production contribution note explicitly explains that the percentages compare available risk readings, not portions of the final score. True zero input values have a different explanation from unavailable input values. This adds truthful live-data context without changing the approved preview.

The isolated browser helper `test/ui/stage-fixtures.ts` seeds a fake unexpired session for `https://halo-test.supabase.co`, mocks only the expected auth/API shapes, blocks all other external requests, and aborts unmatched API paths. It contains no production test bypass and must never be pointed at a real backend for these fixture suites. Production browser checks exercise distinct non-preview response values, failures, partial/no-data/zero evidence, cached state, identity transitions, request cancellation, alerts, Settings, and Luna. Tests under `test/ui/stage-visual.spec.ts` collect production screenshots/geometry evidence separately from the sealed preview baseline.

Relevant checks include `npm run test:frontend`, `npm run typecheck`, `npm run lint`, `npm run build`, the current preview suites, and `npm run test:stage`. The stage command uses `playwright.stage.config.ts` and `scripts/stage-test-server.mjs` to build and start an isolated fake-config production server on `127.0.0.1:3014`; it includes `stage-data.spec.ts`, `stage-visual.spec.ts`, `stage-settings.spec.ts`, and `luna-live.spec.ts`. When that same isolated production server is already running, set `HALO_STAGE_EXTERNAL_SERVER=1` and run `node node_modules/@playwright/test/cli.js test --config playwright.stage.config.ts`. Do not substitute a real backend or use the generic preview-suite server variable for this stage configuration. Preserve the original approval archive and investigate failures; do not use snapshot-update mode.

Before production launch, Vibhav still needs to complete:

1. Merge and check real environment/auth/key configuration, Supabase anonymous-session/CAPTCHA behavior, deployed API shapes, authorization and identity transitions. No production credentials or actual user data were exercised by this work.
2. Verify the real backend's score/coverage/sample-date/grounding contracts and household-context setting, and confirm error/rate-limit/deadline behavior against the configured services.
3. Run the specified live-LLM acceptance set, including all ten adversarial prompts, source correctness, refusal boundaries, no-source handling, privacy copy, and provider retention/configuration review. Mocked replies do not establish model safety or quality.
4. Perform physical-device Safari testing, including mobile keyboard, viewport/safe area, native Back, focus restoration, reduced motion, enlarged text, assistive technology, and slow/offline reconnection. Desktop Chromium emulation is not physical Safari validation.
5. Review the final production data states and conditional evidence panels with real non-sensitive representative data. Any changed approved design needs explicit approval, not an archive rewrite.

This handoff makes the approved stage's frontend ready for backend integration and merge review. Live-environment validation, full-app scope, and the deferred surfaces remain separate work.
