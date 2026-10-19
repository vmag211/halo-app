# HALO frontend integration guide

Vibhav, use branch `codex/frontend-integration-ready-2026-10-13` to connect the current HALO frontend. It preserves the reviewed mobile screens, artwork, typography and navigation while replacing production examples and local-only writes with authenticated service adapters. My Week, Today, Homeguard and Explore are the four primary routes. The hosted wireframe is a separate review and has not been redeployed by this implementation.

Read this alongside [the complete backend handoff](../product/HALO_COMPLETE_BACKEND_HANDOFF.md). That packet remains the product and backend requirement baseline. The contracts here describe the actual frontend implementation added afterward. Do not overwrite its historical audit hashes to make the older snapshot appear current.

## Integration order

1. Keep the frontend branch intact and integrate backend work on a separate integration branch. Install with `npm ci` using the checked-in lockfile.
2. Configure public Supabase URL and anonymous key, the server-only provider configuration, and the approved authentication and OAuth origins. Never add service-role, model, Gmail or source-provider secrets to client variables.
3. Connect profile, onboarding, daily readings, Homeguard and contextual Learn through `lib/frontend/api.ts` and `lib/frontend/stage-api.ts`.
4. Implement or map the operations in `lib/frontend/production/runtime.ts`. This is the authoritative new endpoint registry. The frontend accepts either direct JSON or one `{data, meta}` envelope; an empty current project generation is explicitly `{data:null}`.
5. Connect owned collections and canonical tasks before enabling assistant tools, project starts, reminders, exports or cross-feature actions. Supply canonical revisions and durable operation status first.
6. Connect source-backed discovery, generation, food evidence, map and forecast services. Then enable account recovery, provider authorizations, notification delivery and operator roles according to actual capabilities.
7. Run the automated suites and the real-service release checks below. Mock-service acceptance is not proof that a provider, email, scheduler or authentication configuration works in deployment.

If backend route names differ, adapt the registry and domain adapter, not the visual components. Do not connect a legacy response to a new operation merely because the URL is similar. In particular, the new Settings, actions and alerts interfaces require canonical snapshots and receipts, not a generic `{ok:true}`.

The registry currently contains 72 operations. The literal-call audit found no missing registrations, including the dynamically selected food-resource and recovery operations. `capabilities.read`, `opportunities.detail`, `community.read` and `map.brief` are reserved contracts, not automatic requests or proof of connected services. Current domain capabilities come from their own canonical snapshots; public briefs can be prepared from the reviewed public records already loaded.

## Source and route ownership

| Area | Production entry and implementation |
| --- | --- |
| Setup and recovery | `/onboarding`, `app/OnboardingScreen.tsx`, existing onboarding API, production recovery flow |
| Main app | `/plan`, `/today`, `/home`, `/act`, `/settings`; `components/production/ProductionApp.tsx` mounts the shared reviewed components |
| Factor and household detail | `/factors/{factor}`, `/family`, `/household/{member}`; actual StageRuntime readings, household categories and Learn |
| Public information | `/learn` and `/map`, with no anonymous account creation or owned collection calls |
| Owned map | `/map?access=owned`, explicitly authenticated and home scoped |
| Operator tools | `/operations`, separate from consumer navigation, existing authenticated session and server role required |
| Isolated design review | `/foundation/preview/...` and `/onboarding/preview/...`, examples remain isolated from production adapters |
| Shared owned records | `components/homeguard/HomeWorkspaceState.tsx`, `lib/frontend/production/home-service.ts`, `home-records.ts` and `adapters.ts` |
| Shared tasks | `components/expanded/ExpandedPreviewState.tsx`, `lib/frontend/production/action-service.ts` and `adapters.ts` |

Existing internal `plan` and `act` keys remain stable. Known factor links and Settings `open=home` or `open=household` links retain their destinations. Unsupported routes show the not-found boundary without loading a private profile. Streaming Next.js can return an HTTP 200 not-found shell; the noindex metadata and absent private requests remain required.

## Feature coverage and backend connections

The [45-feature acceptance matrix](../foundation/WIREFRAME_COMPLETION_MATRIX.md) remains the interaction inventory, including secondary workflows and failure states. Production boundaries now cover those surfaces as follows.

| Features | Canonical services and behavior |
| --- | --- |
| G01, account and home context | Existing onboarding plus account/recovery adapters, real profile preflight, explicit home review, portable task selection, historical home links and identity invalidation |
| T01 through T06 | Dated real daily factors and history, zero/missing/partial distinctions, household categories, contextual source explanations, refresh, cached/offline and error handling |
| H01 through H05 | Real Homeguard factors and score, private-water testing plan, utility-wide evidence, ranked assessment actions, household guidance and current-home qualification |
| H06 and H07 | Canonical tests, results, original qualifiers, corrections/history/archive, maintenance routines, observations, attachments and deliberate My Week links |
| H08 | Server-prepared immutable selected summary snapshot and archive; existing PDF generation, print, download and browser-share fallback |
| F01 through F06 | Pantry records, sourced food findings, official fish advice, gardens/tests, grower preparation/follow-up, water notices and recorded usage |
| A01 through A03 | Persisted chosen discovery area, real upcoming/rolling opportunities, organizations, concise source-backed details, separate external registration and user-kept participation |
| A04 | Server generation with preferences, direct interests, refresh, cancel/status, dated evidence, versioned practical guides and owned projects with stable step IDs |
| A05 and A06 | Public contact resolution, exact reviewed outgoing email, provider status; private notes/photos, source references, handoff history, cases and follow-up |
| M01 through M05 | Actual layer data, filters/search/list, honest unlocated records, timeline, comparison, district data, source detail and public brief; no fixture records on service failure |
| P01 and P02 | Canonical tasks and metadata, dates from owned records, edit/delete/status/archive, batch scheduling, reminders/recurrence preferences, focus, week review and ICS export |
| P03 through P06 | Source-backed forecast periods, private Journal, compatible dated history and descriptive Patterns, actual-date seasonal follow-through and scoped exports |
| X01 and X02 | Contextual Learn and public topic library; real conversational Luna service, typed exact-revision action reviews and operation reconciliation |
| X03 through X05 | Canonical alerts, explicit read/dismiss/Undo, saved settings, home/account/provider/device reviews, recovery, server-scoped privacy inspection/export/clearing |
| X06 | Existing responsive shell, light/dark/system appearance, text size/contrast, keyboard controls, reduced-motion authority, offscreen pauses, retained drafts and nonvisual alternatives |
| X07 | Authenticated source-operations frontend with role-denied states, exact source/version reviews, publication/retry intent, audit records and unknown-outcome checks |

Detailed implementation contracts are in [Explore, My Week and Luna integration](EXPANDED_PRODUCTION_INTEGRATION.md) and [Homeguard, account and operator integration](HOME_ACCOUNT_PRODUCTION_INTEGRATION.md). The TypeScript validators are executable contracts and take precedence over abbreviated examples.

## Transport and mutation guarantees

All new operation paths are explicitly registered and same origin. Private requests obtain the current access token and verify that its identity still matches the mounted scope. Headers include `Authorization`, current `X-Halo-Home-Context`, `Idempotency-Key` for mutations and `If-Match` where a captured revision exists. The backend must enforce ownership and permissions independently; client fields are never authority.

Reads are cancellable and bounded. Superseded reads cannot publish into a different filter, home or identity. Private state remounts on an actual identity/home-context change. A same-home profile refresh preserves drafts, disables writes until the profile is verified, and does not create a replacement anonymous account after a 401. The operator entry does not create an anonymous identity.

A mutation has five meaningful outcomes: confirmed success, known failure, pending, unknown, or cancellation where the domain supports it. Network loss after dispatch, malformed success and uncertain cancellation are not confirmed failure. The frontend does not silently replay a write. The backend must keep an idempotent operation ledger and return canonical status after reload or from another device.

Initial reads include unresolved operation inventories. Examples are `ActionSnapshot.unresolvedOperations`, `HomeCollectionSnapshot.pendingOperations`, Settings/alerts/account/summary inventories, Luna pending requests and tool operations, project generation/start state, area pending writes, outreach attempts and privacy status. Success responses must remove resolved IDs and include any other unresolved IDs. Return complete replacements for collections identified as complete; never return a page of data as an entire collection.

Do not return raw database, provider or secret-bearing errors. The frontend maps HTTP errors to safe messages and retains drafts. Server validation must still reject stale revisions, mismatched context, changed reviews, expired consent, invalid files and unauthorized effects.

## Settings alerts and privacy contracts

`preferences-service.ts` defines the full `SettingsSnapshot`: positive revision, home/notification/quiet-time/Luna/language values, display preferences, calendar preferences and `unresolvedOperations`. `settings.save` accepts a selected group and its captured revision. A successful `SettingsReceipt` returns the exact operation ID plus the canonical snapshot. Unrelated settings drafts survive refresh, conflict and group-scoped saves. Quiet times and calendar times require IANA zones.

`alerts-service.ts` defines `AlertSnapshot` and `AlertReceipt`. `alerts.read` returns `{items, unresolvedOperations}`. Each item has a stable ID, revision, valid date, kind, category, read/dismissed booleans and an allowlisted destination. `alerts.update` accepts exact `{id,revision}` selection and a read/dismissed patch. Success must contain every selected row with an advancing revision and the requested patch. Opening an alert or its destination does not mark it read. Undo is another revision-bound operation, not a local reversal of server state. During transition, the older StageSession read also accepts the legacy alert envelope; it does not control the expanded inbox.

Privacy has a separate server inventory. `privacy.status` returns `{unresolvedOperations:[{operationId,scope}]}`, where scope is `export`, `journal` or `all`. `privacy.inspect` accepts the desired scope, selected export groups and explicit private-text choice, returning `{reviewToken,expiresAt,count,preview}`. Bind the token to owner, selection, context and record revisions. `privacy.export` or `privacy.clear` uses that token and a stable operation ID. Clearing all app records requires a separate typed confirmation. It is not account deletion.

An export success returns `{operationId,status:'succeeded',file:{name,mime,text}}`, with a safe `halo-*.json` or `halo-*.csv` filename. Status lookup uses `operations.read` with `domain:'privacy'`. Enforce private-text, exact-location and photo exclusions on the server. The frontend rejects executable MIME types and oversized generic downloads. A successful Journal clear leaves unrelated tasks and environmental history unchanged.

## Environmental history forecasts and updates

`components/production/WeekSources.tsx` contains the current history and forecast response types. History requests use `evidence.read` with `kind:'history'`, `from` and `to`. Return dated factor rows, source/unit/issue/version/context, coverage completeness and a same-context comparison basis. The current descriptive comparison requires daily maxima; app-time observations are not silently pooled. Null values and excluded dates remain visible. No causal or clinical conclusion is generated by the frontend.

Forecast requests use `forecast.read` with the selected date and place. Periods require timezone-bearing start/end instants, source, version, issue/expiry, horizon and per-factor coverage. Missing air, UV or pollen stays unknown. Expired or changed forecasts require review before saving a forecast-derived time. Saved tasks retain the source version and original scope. A watch preference is not proof of a registered or delivered notification.

`week.changes` returns `{changes, unresolvedOperations}` bound to existing action IDs and keys. Changes include version, source revision, dated summary and any official link. `week.acknowledge` accepts the exact change ID/version and action ID and returns `{operationId,status,acknowledged:string[]}`. Acknowledgment never completes, reschedules or registers an activity. Unknown acknowledgments reconcile through `operations.read` with `domain:'week-updates'`.

## What remains local by design

Unsubmitted drafts, filters, disclosure state, selected calendar day, current sheets and temporary export reviews stay in memory. Their presence does not mean they were saved to an account. Canonical task preferences are explicitly allowlisted; arbitrary draft keys must not be accepted as stored preferences. Private Journal text is not sent to Luna. Selected note context requires explicit fields and exact revisions.

The production UI never uses wireframe data as an outage fallback. Real static educational material, bundled decorative artwork and licensed context photographs remain valid frontend assets, not current local events, exact project builds or measured conditions. Density animation means record density, not pollutant transport or live weather.

## Run and verification

```text
npm ci
npm run dev
npm run typecheck
npm run test:frontend
npm run preservation:verify
npm run test:ui
npm run test:production
npm run test:stage
npm run build
```

The production and stage browser configurations build an isolated server with deliberately fake public Supabase credentials and intercept all external/API calls. Do not deploy that test build or point those suites at a live account. The review suite can reuse a stable local build via `HALO_TEST_BASE_URL`; production uses `HALO_PRODUCTION_TEST_URL`. Keep those URLs local and use separate result directories when suites run together. Test traces can contain test input and must not be committed with real user data.

The final [verification receipt](FRONTEND_INTEGRATION_VERIFICATION.md) records actual commands, results, coverage limits and Git preservation. Immutable onboarding and foundation archives remain untouched. Existing unrelated local changes are not silently folded into this implementation.

## Release gates after connecting backend

- Exercise real authentication, recovery, two identities, multiple homes, session expiry, competing devices and revoked permissions. Verify ownership enforcement and no old-home data leakage.
- Repeat every write with a timeout after server commit, reload, status recovery, stale revision and conflicting edit. No duplicate task, upload, email, generation or provider action is acceptable.
- Validate real geocoding, future/rolling event freshness, contact jurisdiction, food/fish/water source scope, project safety, retrieval citations and generation constraints. Missing evidence must stay missing.
- Verify actual model availability, tool permissions, quotas, retention and costs. The frontend cannot establish an unlimited free AI service.
- Configure real OAuth callbacks, encrypted server credentials, revocation, push registration, notification delivery and recurrence jobs. Browser registration, preference saving and provider submission are distinct states.
- Confirm public endpoint privacy, immutable summaries, scoped exports, file scanning/storage access, source-operator roles and audit logs.
- The bundled cartographic atlas and district geometry cover the reviewed North Carolina scope. Out-of-atlas or unlocated records remain accessible in the list; do not label them as plotted local geometry. Expanded geographic maps require an approved geometry/renderer contract.
- English remains the served interface until reviewed translations are supplied. Preserve requested Spanish and disclose English fallback; do not treat machine-generated or merely requested translations as reviewed localized support.
- Complete real Safari/iOS/Android, screen-reader, installation/native-share/push, low-end-device performance and battery checks. Desktop Chromium emulation does not certify physical-device behavior.

These are deployment and real-service acceptance gates, not permission to substitute examples or report success before backend confirmation. Any contract mismatch discovered during integration should be fixed in the shared adapter and covered by a regression test before release.
