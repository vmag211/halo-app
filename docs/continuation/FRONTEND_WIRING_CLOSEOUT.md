# HALO frontend wiring closeout

Current as of October 16, 2026. Frontend branch: `codex/october15-review-refinement`. This is an integration handoff, not a declaration that the backend, providers or production deployment are complete.

October 17 presentation update: shared loading visuals now cover startup, core reading/resource loads, Homeguard, projects, opportunities, Luna, settings, alerts, Journal/history/forecasts and the map. The short arrival animation does not delay ready content. Homeguard preserves independent collection-loading feedback instead of presenting pending test records as an empty result when an auxiliary collection arrives first. These changes use the existing pending/availability, cancellation, error and receipt contracts; no new backend endpoints or fields are required. See the appended loading verification in `FRONTEND_WIRING_VERIFICATION.md`.

## Start here, Vibhav

Use **`docs/product/HALO_BACKEND_WIRING_CURRENT.md` from this frontend branch**. Download the complete file from GitHub; do not rely on a pasted excerpt. It contains the current contracts, the complete original 45-feature handoff, the complete 1,630 named baseline requirements, and a fresh source/control/type audit. Its last line is `HALO-WIRING-PACKET-END`. The generated manifest records the included files, sizes and hashes. The original packet remains intact as historical evidence.

Your latest pushed `docs/backend/HANDOFF.md` says the supplied specification stopped at BE-032 and B02 through B12 are blocked on the remainder. The complete working specification is already in this repository at `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md`; it is reproduced in the current packet. Confirm the final marker and source manifest before implementing from a downloaded copy. This closes a delivery/traceability gap, not a service implementation gap.

Priority when older documents disagree: this closeout and current runtime/domain contracts; October 15/16 review deltas; the complete feature handoff; the historical baseline. Current source is the executable interface. Old “unsent”, “not started”, 430px desktop-only and older branch references are historical, not current instructions. No missing-data or privacy qualification is superseded by visual changes.

## What is actually in GitHub

| Reference audited | Commit | Finding |
| --- | --- | --- |
| `origin/main` | `9f1ef88fe2d99aa82e96285ce7aa152e99a5acb0` | 22 API route files; legacy core services, not the complete new application |
| `origin/vmag211/backend` | `88b01b005ad783c7a719fd87a02c317c613b4b71` | 24 API route files; B01 identity/home-context baseline and documentation |
| Earlier backend audit | `fb4cadf7606577c928f010490c2857cac1d93419` | Latest backend differs only by `docs/backend/HANDOFF.md`; no new executable services since that audit |
| Frontend base before this closeout | `857160e6ca878c04a004133e7e48292af3099a68` | Responsive visual refinement, themes, larger artwork and revised Learn/calendar/household layouts |

Existing backend includes onboarding/profile/household, daily and home readings/scores, history, Journal and findings/summary/retrospective, Learn/sources, map/district, a volunteer directory, legacy assistant Q&A, alerts/notification preferences, push subscription and cron. Inspect the pinned code and original route-by-route audit before reuse. Presence does not establish correctness, source coverage, authentication policy, response compatibility or deployment.

Only three of the **72 new frontend operation registry entries** have an exact method/path counterpart on the backend branch: alerts reading, map layer and district. Even these require response and authority validation. Legacy daily/profile/Learn/assistant requests also exist outside this registry and are covered by `api.ts`, `stage-api.ts` and the baseline audit. The registry count is not a count of all HTTP routes or finished services.

Backend migrations 0015 and 0016 are reported written but not applied in the backend handoff. Do not infer deployed schema or migration safety. Its reported backend test result was not rerun against a live database in this frontend closeout. Preserve the earlier audit's Windows test failures as historical observations, not a current success claim.

## What changed in this final visual pass

Today and Homeguard use a gradient inner score arc that fills from zero to the supplied score once it enters view. A separate thin outer ring shows the normalized factor shares already used by the labeled contribution legend. These shares are **risk-input composition, not score points, formula weights or personal health probabilities**. Partial, missing, zero and full scores remain distinct; source dates and details are retained. Device reduced motion and forced colors show the final static value; hidden pages cancel decorative animation. No scoring formula, provider or backend field changed.

The existing new visual controls need only the optional `SettingsSnapshot.display.palette` (`ocean`, `forest`, `iris`) already documented in the review delta. Missing palette uses Ocean. Appearance and palette remain independent. Spanish remains Coming soon, not a completed localization. Homeguard's score now precedes its compact workspace, as explicitly requested after the earlier review.

## Full-app connection map

| User-facing area | Required backend outcome and boundaries |
| --- | --- |
| Welcome, setup, session, home | Validated onboarding, identity and ownership, profile/household context, consent, verified geocoding/water-system matching, errors and retry; never create an account while browsing public Learn/map |
| My Week homepage | Canonical tasks and linked dates from tests, maintenance, projects, participation, reports, follow-up and saved work; one source of truth, date-only versus instant semantics, time zones/DST, edits/completion/removal/move/batch review, unknown-outcome recovery |
| Calendar tools | Saved-for-later, selected agenda, search/filter, reminders and exact schedule revisions, progress/streak opt-in, recorded-action recap, estimates rather than invented tracked time; provider calendar support only when actually connected |
| Today and factors | Dated air/UV/pollen/mold inputs, score coverage, provenance, source links, stale/partial/unavailable/offline handling, history comparability and household guidance; no fabricated sensor values |
| Homeguard context | Area water/PFAS/radon/lead evidence, private-well versus utility scope, contextual guidance, household category advice, honest uncertainty; area data never becomes an indoor reading |
| Tests and home care | Owned tests/results with units, detection limits, source reports, corrections/history/archive and attachment access; maintenance, moisture observations, routines and explicit task links |
| Food and garden | Kitchen records and separately sourced food evidence (including documented lead/PFAS findings), non-detects and sample scope, fish advisories, soil/garden records, grower resources, water notices and usage; no invented item contamination levels or health diagnosis |
| Household summary | Exact selected, version-bound server snapshot, immutable archive, scoped source manifest, PDF/download/share and omitted-data disclosure; current records never silently rewrite saved reports |
| Explore projects | 10-15 tailored ideas or a smaller interest-driven shortlist, preferences/refresh/novelty, current user evidence with dates, safe web retrieval and citations, cancel/status, materials/steps/safety/follow-up, stable guide and step versions, owned project progress |
| Get involved | Location-influenced future/rolling opportunities, organizer and venue addresses kept distinct, official source URL, freshness, eligibility/access/cost, geocoding/radius filters and genuine dates; saved commitment is not organizer registration |
| Community and map | Public/owned separation, real feature geography and source dates, scoped layers/filters/legend/selection, comparison/briefs and source metadata; illustrative density patterns are not live pollution forecasts |
| Notes and Journal | Owned note/check-in CRUD, search/pin, selected-context assistant consent, metadata-stripped private photo review/upload/expiry, patterns/season/history with valid source bases and scoped exports |
| Local questions/outreach | Verified need/location-based public recipient resolution, affiliation/freshness, draft review, selected context only, explicit send approval, OAuth scope/account checks, provider delivery status/replies and idempotent unknown-send reconciliation; no guessed personal email |
| Luna | Conversational context, retrieval and citations, provider availability, safe authorized tools, exact revision-bound proposals, deliberate mutation confirmation, cancellation, durable operation status, privacy controls and refusal/error paths; legacy Q&A alone is not this system |
| Alerts and notifications | Canonical unread/read/dismiss/Undo, precise destinations and source details, delivery preferences, quiet hours/zone, capability-aware push, exact reminder revisions; opening an alert is not automatically reading/dismissing it |
| Settings | Explicit group Save/Cancel, canonical revisions/conflict handling, household/home, appearance/palette/motion/text/contrast, calendar zone, privacy/Luna permissions, account/devices, provider connections, scoped exports and guarded deletion |
| Learn and Restore access | Public source-backed learning/search/topics/glossary, no private requests by default, explicit verified recovery challenge and account switch; see exact recovery requirements below |
| Operations | Existing authenticated session and server roles, scoped review/approve/publish decisions, immutable provenance, version checks/audit log and durable operation status; never assign operator authority in the browser |
| Shared small interactions | Button states, forms/validation, retained drafts, keyboard/focus, dialogs, cancel/back/deep links, pagination, copy/download/share fallbacks, responsive themes, loading/empty/unavailable/error/retry are in the generated control ledger and domain acceptance; cosmetic controls do not each need an endpoint |

## Restore access: explicit small-feature contract

The production component is `components/production/ProductionRestoreAccessFlow.tsx`, accessible from public Learn. It dispatches `POST /api/recovery/request`, `/api/recovery/status` and `/api/recovery/complete`. These routes are **not present** in the audited backend branch.

- Request uses an email, high-entropy in-memory client nonce and operation ID. Responses must be enumeration-safe, rate-limited and bound to the challenge/browser. A pending response is not ownership verification.
- Status checks the same request/nonce. Lost request or completion responses reconcile the original operation; never send a second mutation merely because the network failed.
- Verified ownership presents an explicit account-switch checkbox. Completion requires the current restore token, challenge, nonce, operation ID and `confirmAccountSwitch: true`.
- Returned credentials are verified against the authentication provider's identity before `setSession`. The prior account is not automatically merged, deleted or used as authority for the recovered account.
- Support pending, verified, expired, collision, failed and unknown states. Keep proofs/session secrets out of URLs, logs, analytics and persistent draft storage. One-time expiry/consumption, anti-replay, CSRF/origin controls and server identity verification are mandatory.
- Decide recovery identity architecture first: anonymous-only, same-identity email upgrade or separately reviewed device recovery. Existing records and RLS must follow the chosen identity without accidental reassignment. A frontend checkbox cannot implement this authority.

## Decisions and connection work still required

1. **Recovery and sensitive uploads:** backend handoff explicitly leaves identity architecture undecided. Resolve it before enabling sensitive uploads or recovery. Decide retention periods, deletion/audit retention and provider data handling.
2. **Legacy assistant privacy:** review `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` and its current default before deployment. New Luna must use explicit scoped permissions, not silently inherit legacy default household sharing. Model pricing/quotas/hosting must be configured; “free to users” is a product choice, not unlimited free inference.
3. **Visit-local intentions:** preparation checklists, automatic-repeat intent and source-follow drafts remain explicitly visit-local pending the documented services/adapters. Backend storage alone does not connect those UI paths. Implement the adapter and canonical refresh, or leave the honest visit-local state. Do not count a local toggle as a saved schedule/subscription.
4. **Forecast horizon semantics:** agree date-only versus instant bounds and coverage rules for horizon fields, then test the adapter, display zone and DST. Current preview/date-prefix comparisons are not proof of real forecast availability.
5. **Current optional additions:** independent collection availability; opportunity venue-local dates and explicit acceptance into outdoor planning; exact reminder revision/schedule evidence; claim-linked Luna findings; palette fallback. These preserve legacy absence rather than inventing success.
6. **Data and providers:** source acquisition, licensing/coverage, fresh geographic queries, actual future opportunities, scientifically reviewed scoring/interpretation, source-backed generation, verified email delivery, push/scheduler jobs, quotas and operational monitoring all need live acceptance. Do not substitute bundled review fixtures.
7. **Real-device acceptance:** actual Safari/iOS/Android, assistive technology, installed PWA/service workers, background notifications, permission denials, email verification links and OAuth redirects remain release tests. Local Chrome viewport checks are not physical-device certification.

## Safe integration sequence and exit gates

Create a separate integration branch from this frontend branch. Bring backend changes in deliberately, preserving both lanes and approved archives. Implement identity/home scope, migrations/RLS and operation durability first; then canonical collections/settings/tasks; sources and discovery; generation/Luna tools; provider actions and account recovery. Keep capabilities unavailable until each real service passes. Use actual adapter/type contracts, not component fixtures as database schemas.

Every command needs server authorization, strict input/schema validation, captured revision/precondition, idempotency and canonical success/unknown/conflict outcomes. Enforce private ownership server-side, reject forged home/record IDs, invalidate active evidence on home change without rewriting history, redact telemetry, and make cancellation/retries safe. Reconcile unknown outcomes before issuing a new command.

Run unit, review, production-boundary and stage suites plus archive integrity, TypeScript/build and scoped lint. Then rerun connected end-to-end scenarios with real controlled accounts and provider sandboxes: onboarding/recovery, home switching, all CRUD and exports, data-source outages, model/tool failures, organizer changes, reminder delivery, OAuth/send/cancel/unknown reconciliation, deletion and multi-device conflicts. Scientific validity, security/RLS review and accessibility are separate from screenshot approval.

The virtual merge check at the audited backend commit found no textual conflicts. This does not mean API semantics match or future commits cannot conflict. No backend merge, migration or provider action was performed. Unrelated local documentation and ambience edits are preserved outside this closeout commit.

## Verification receipt

Final results are recorded in `docs/continuation/FRONTEND_WIRING_VERIFICATION.md`. The assembled packet's generated current interface/type register supersedes only the older snapshot's inventory, not its product requirements. Audit counts establish traceability, not mathematical proof that no possible bug exists.
