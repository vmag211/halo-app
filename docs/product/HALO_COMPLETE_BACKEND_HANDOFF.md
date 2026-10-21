# HALO complete backend and frontend integration handoff

**October 16 current-packet pointer:** use [HALO_BACKEND_WIRING_CURRENT.md](HALO_BACKEND_WIRING_CURRENT.md) on `codex/october15-review-refinement`. It includes this entire historical packet plus current production adapters, later review deltas, complete baseline requirements and a fresh interface audit. The snapshot, hashes and statuses below remain historical; they are not rewritten to imply current live acceptance.

Prepared for Vibhav. Audit date: October 13, 2026. Status: implementation specification and repository audit, not a claim that the backend is deployed or that the production frontend is connected. This file is the single handoff document. It incorporates the completed full-app wireframes and the later user decisions, rather than only the original Today/Homeguard application.

## 1. How to use this handoff

Build the complete consumer experience represented here, including secondary actions and failure recovery. Start with the baseline and shared contracts, then implement connected journeys. Check off a requirement only when its route, database policy, adapter contract and relevant tests work together. An existing route, passing mocked test, published preview or successful HTTP response alone does not establish a working feature.

This document distinguishes **existing code**, **required repair**, **new backend work**, **frontend integration work**, and **external verification/decision**. Proposed routes and fields are a concrete contract target, not claims that those routes already exist. Vibhav may refine internal table names and service organization, but must publish the agreed schema and preserve every listed behavior. Required consumer capabilities must not disappear behind a permanent unavailable state merely because the wireframe demonstrates that state.

The latest user request activates preparation of this final backend packet. Earlier notes saying the packet is deferred refer to the period before this audit. No message has been sent to Vibhav, no backend branch merged, no database migrated, and no production provider action authorized by preparing this document.

### Reading order and contents

1. [Baseline and coverage](#2-audit-baseline-and-scope), [shared contracts](#3-shared-integration-contract-mandatory-across-domains), [data and files](#4-whole-app-data-and-service-design).
2. [Entry and identity](#5-g01-x01-entry-identity-home-transitions-and-learning), [My Week and Journal](#6-p01-p06-complete-my-week-and-connected-work), [Settings and notifications](#7-x03-x06-settings-notifications-privacy-and-platform-behavior).
3. [Operations](#8-backend-operations-deployment-and-reliability), [build sequence and acceptance](#9-integration-acceptance-and-delivery-sequence).
4. [Existing backend and defects](#10-verified-existing-backend-and-repair-register): exact route, migration, provider and test inventory.
5. [Today, Homeguard, Food and Garden](#11-today-homeguard-food-and-garden-contracts): fields, actions, evidence and acceptance.
6. [Explore, Map, Luna and source operations](#12-explore-map-luna-and-source-operations-contracts): generation, discovery, outreach, notes and tools.
7. [Decisions and audit verification](#13-decisions-verification-and-completion-criteria): unresolved choices, priorities, evidence and release gates.
8. [Appendix A: controls](#appendix-a-executable-interface-control-ledger), [Appendix B: frontend types](#appendix-b-existing-frontend-transport-and-domain-type-register), [Appendix C: source fingerprints](#appendix-c-audited-frontend-source-fingerprints).

Do not implement old requirements from an embedded historical document without checking the current decisions in this handoff. Earlier plans contain superseded navigation, appearance, motion and assistant assumptions. The executable control/type appendices include review machinery so it can be excluded deliberately; they are not instructions to ship a scenario selector or fixture loader.

## 2. Audit baseline and scope

Frontend checkpoint: `f445588a34c6b8e886e17ccf649d472cf3dd24ec`, branch `codex/frontend-continuation-2026-10-08`. Hosted wireframe: Version 50. The frontend checkpoint's API/backend files are behind the separately maintained backend branch. Fresh remote references were fetched read-only for this audit; exact main/backend hashes appear in the backend audit section.

Existing user changes in `docs/continuation/HOSTED_REVIEW.md`, `docs/foundation/VISUAL_LIBRARY_ASSETS.md` and `lib/frontend/week-ambience.ts` were preserved. Their presence does not establish backend deployment. Approved onboarding and foundation archives remain immutable. No secret values, private household records or live credentials belong in this handoff.

Scope includes all 45 feature groups, all current production and review entry points, executable frontend handlers, domain models, server routes, migrations, source adapters, scheduled work, failure states, privacy and operational dependencies. It covers behavior that requires no network request as well as behavior that does. A single repeated control represents all authorized data-driven instances; acceptance must include empty, single, many and deleted records.

The audit is code- and requirement-based, with offline backend tests and current official documentation checks. It does not inspect a deployed Supabase schema, production secret configuration, provider billing account, real delivered push/email, physical device or Vibhav's unpushed work. Those require the release evidence listed below. Historical browser evidence for Version 50 remains valid only for the isolated wireframe, not live integration.

### Current product decisions to preserve

- Main navigation and default delivered homepage: My Week (`plan`), Today, Homeguard (`home`), Explore (`act`). Stable legacy/deep links remain supported. Full Map is a specialist surface; Journal is a My Week workflow.
- Keep the 430px mobile shell, HALO blue/teal sans typography, System/Light/Dark, text sizes 100/115/130/150, contrast, device-authoritative reduced motion and independent ambient preference. Five original My Week scenes rotate after 30 seconds of eligible visible time. Wallpapers, hover effects, section reveals, chart animation and Luna's logo animation require no runtime image-generation backend.
- Homeguard's one compact workspace precedes the house. Tests, Home care, Food and Garden and Summary remain whole-row entrances with Add and Quick access. All underlying routes remain available.
- Luna is a shared conversational assistant across the app, with authorized data access and confirmed actions. The deterministic wireframe grammar and curated single-question backend are foundations, not the target capability ceiling.
- Explore has three primary deliverables: relevant practical projects, local community involvement, and the live-data map. Generate 10-15 supported project ideas for a normal batch; direct interests may request a smaller shortlist. Refresh must offer meaningful novelty. Nearby opportunities must be future or rolling, with source-backed details and official next steps.
- Source truth stays explicit. No fixture becomes live fallback, no missing value becomes zero or safety, and no recorded task completion becomes environmental improvement. Food photographs remain unnecessary; existing editorial photos and generated environmental artwork are decorative assets, not measurements or verified locations.
- Do not put em dashes in app-facing generated/server copy, validation, notifications, exports or accessibility strings. Preserve original scientific values and documents; render reviewed normalized copy without changing meaning.

### Feature coverage register

| ID | Required feature | Detailed contract family |
| --- | --- | --- |
| G01 | Entry, anonymous identity, onboarding, public browsing, home changes, recovery entry | Identity/home contracts and backend baseline |
| T01 | Today overview, changes, coverage and score | Today evidence |
| T02 | Air readings, source, guidance and history | Today evidence and source registry |
| T03 | UV readings, periods and guidance | Today evidence and forecast |
| T04 | Pollen species/categories and guidance | Today evidence, licensing and forecast |
| T05 | Outdoor mold weather proxy and indoor observation distinction | Today evidence and home care |
| T06 | Daily household-category guidance | Reviewed guidance and household context |
| H01 | Homeguard overview and workspace | Home evidence and canonical summaries |
| H02 | Drinking water/PFAS, utility/private-water branches | Water evidence and tests |
| H03 | County radon context and owned home tests | Radon evidence and tests |
| H04 | Lead/plumbing, unknown and unscored states | Lead evidence and tests |
| H05 | Household guidance categories | Reviewed guidance/context |
| H06 | Tests, results, corrections, attachments, comparisons, history | Home tests and attachment service |
| H07 | Assets, maintenance, recurrence and moisture | Home care and shared actions |
| H08 | Private household summary/PDF | Summary snapshot and scoped export |
| F01 | Food and Garden hub, kitchen inventory and food questions | Kitchen and food evidence |
| F02 | Fish advisory matching and private fish notes | Fish sources and records |
| F03 | Growing sites, irrigation, soil/test links | Garden records |
| F04 | Food evidence, studies, notices and scope | Food source acquisition/matching |
| F05 | Grower resources, sampling preparation and inquiry | Resources and follow-through |
| F06 | Drought, utility notices and private water usage | Stewardship sources and comparisons |
| A01 | Explore, selected area, community understanding and continuations | Discovery/context |
| A02 | Organizations and programs | Public directory and official sources |
| A03 | Upcoming/rolling opportunities and participation | Opportunity discovery/commitments |
| A04 | Tailored generation and guided projects | Generation and versioned project work |
| A05 | Need/location-based contacts, drafts, email and replies | Contact resolution/outreach |
| A06 | Private notes, photos, cases, export and reporting history | Notes/attachments/handoff |
| M01 | Map navigation, search, layers, list and public access | Map platform |
| M02 | Water compounds, sample quarters and details | Map water |
| M03 | Radon, facilities, air and qualified Patterns | Map layers and optional field products |
| M04 | Compatible two-record comparison | Map comparison |
| M05 | District/county/state evidence and public brief | Regional summaries/public export |
| P01 | My Week calendar, agenda and connected dates | Week contracts |
| P02 | Canonical actions, lifecycle, schedules and follow-up | Shared action service |
| P03 | Outdoor plan, forecast comparison and watch | Forecast/outdoor service |
| P04 | Journal, recall, edit/delete/Undo and first use | Journal |
| P05 | Patterns, dated history, methods and export | Versioned analysis |
| P06 | Seasonal review, actual follow-through and export | Seasonal joins |
| X01 | Learn, glossary, search and source detail | Reviewed content |
| X02 | Luna conversations, context, tools and reconciliation | Assistant service |
| X03 | Inbox, watches, preferences and device delivery | Notifications |
| X04 | Settings, display, home, language and connections | Settings/capabilities |
| X05 | Inspection, scoped export, deletion, recovery and devices | Privacy/identity |
| X06 | Accessibility, offline, browser lifecycle and network recovery | Shared frontend/backend contracts |
| X07 | Source ingestion, review, quarantine, publish and audit | Operator platform |

## 3. Shared integration contract, mandatory across domains

### 3.1 Authority, ownership and context

Derive `profile_id` from verified authentication, never the body, query, generated text or an opaque-looking record ID. Enforce ownership on every read, write, join, export, job status, attachment, subscription and AI tool. Private child-parent links must share owner at the database level. Do not expose resource existence through cross-account errors. Operators use separate explicit roles; client-selected review roles grant nothing.

Keep identity, current home context, historical home context, exploration area, garden/irrigation context and outdoor-plan location separate. Persist `home_context_id` and applicable source/context revisions on records and relevant jobs. An exploration ZIP or planning place cannot move a home. On a home change, revoke stale in-flight/current evidence, rankings, forecasts and generation reasons; retain dated historical records. Captured writes must recheck current context at commit. Late old-home observations cannot be written into new-home daily history or caches.

Each private read is identity-aware and must not be publicly cached. Public evidence may be cached by permitted geography, period, source revision and locale. Include context and ownership in private cache keys, invalidation and request-generation checks. Never fall back to a different anonymous identity on a transient auth/database/provider error. Recovery and intentional start-over are distinct, explicit flows.

### 3.2 Capabilities and API versioning

Add a proposed authenticated `GET /api/capabilities` plus a public capabilities view. Return schema/API version, current identity/profile/home status, supported features, geographic/source coverage, supported locales, accepted limits, writable/read-only/unavailable reasons, provider connection scopes, push registration capability, and relevant policy versions. Capability comes from configuration plus valid backend state, not a frontend flag or successful click. Recheck it at mutation execution.

Extend current routes additively where possible. Publish machine-readable schemas and generate frontend types/fixtures during implementation. Version semantic changes such as Journal analysis; do not quietly retype old fields. List old-client compatibility, deprecation and migration behavior. Internal `plan`/`act` tokens must work in navigation, notifications, assistant context and return-path allowlists together.

### 3.3 Proposed response envelopes

New public/private resource APIs should use one consistent envelope; adapters may normalize existing route envelopes without breaking older clients.

```ts
type Availability = 'ready' | 'empty' | 'partial' | 'no_coverage' | 'unavailable' | 'stale';
type Meta = {
  schema_version: string; request_id: string; as_of: string;
  availability: Availability; reason_code?: string;
  home_context_id?: string; context_revision?: number;
  source_revision_ids?: string[]; requested_locale?: string; served_locale?: string;
  next_cursor?: string | null; truncated?: boolean; total_count?: number | null;
};
type Result<T> = { data: T; meta: Meta };
type ApiError = { error: {
  code: string; message: string;
  field_errors?: {field: string; code: string; message: string}[];
  retryable: boolean; request_id: string; operation_id?: string;
  retry_after_seconds?: number; current_revision?: number;
} };
type MutationReceipt<T> = {
  operation_id: string; status: 'succeeded' | 'pending' | 'failed' | 'cancelled' | 'unknown';
  resource?: T; revision?: number; effect_ids?: string[];
  invalidations?: {domain:string; ids?:string[]; home_context_id?:string}[];
};
```

Use semantic status codes: validation 400/422, unauthenticated 401, forbidden 403 where disclosure is safe, inaccessible/missing 404, stale revision/idempotency mismatch 409/412, rate limit 429, unsupported/capability error with stable code, service failure 502/503/504. Preserve `Retry-After` and request IDs. Do not return `200 []` for a failed database query. Partial success must state successful, failed and unchanged items explicitly.

Existing B01 `lib/apiErrors.js` returns a flat `error: string`, `field_errors: [{field, code, message}]`, and `request_id`, with `Retry-After` where applicable. The nested example above is a proposed new-version envelope, not permission to break existing clients or discard per-field machine codes. Implement an explicit version/adapter transition. A legacy successful HTTP response carrying an explicit `unavailable` result (as B01 volunteer discovery does) can be adapted honestly; it must not become an ordinary successful empty list.

### 3.4 Mutations, exact reviews and unknown results

- Creates and externally consequential operations accept a stable idempotency key bound to owner, operation and canonical request hash. Same key/same payload returns the existing result; changed payload conflicts. Retention must cover the maximum client retry/reconciliation window.
- Updates/deletes require expected revision (`If-Match` or explicit field). Database compare-and-swap enforces it, including linked metadata. A rebase preserves edited fields and refreshes untouched fields only after presenting an actual conflict.
- Batch week plans, home transitions, account clearing, project-step/action creation and action-plus-metadata updates are atomic or explicitly modeled resumable operations. Never partially apply an allegedly all-or-nothing review.
- Prepared mutations capture exact IDs, revisions, context, permissions, intended changes, expiry and single-use confirmation. Reject tampered/stale confirmation; recapture the review. The backend performs validation after confirmation as well as before it.
- Proposed `GET /api/operations/:id` returns owner-scoped authoritative status. Cancelling a fetch or closing a sheet does not prove the server cancelled. Reconcile after timeout/navigation/reload before issuing a new effect. Unknown email/provider outcomes may remain genuinely unknown; never resend automatically to make the UI appear successful.
- Commit resource write, immutable change event and outbox intent in the same transaction where possible. Workers use leases, bounded retries and deduplication; consumers are idempotent. Audit events store reason, actor, affected IDs, revisions and timestamps without copying unnecessary sensitive free text.
- Deleting a task keeps its independent origin record. Deleting a source record preserves independent tasks with an unavailable-origin state. Archiving, pausing, skipping, completing, cancelling and deleting are different operations. Their delivery/recurrence consequences must be explicit.

### 3.5 Evidence, values, dates and strings

Every environmental or guidance response identifies source, original record, evidence kind, measured/modelled/forecast/user-entered basis, spatial scope/precision, units, qualifiers, observed/collected period, published/issued time, retrieved time, expiry or refresh class, source/parser/method revision, attribution, applicability and coverage limitations. Source URL alone is insufficient provenance.

Represent measured zero, non-detect, less-than, missing, unsupported, stale, censored and excluded/unscoreable independently. Retain original text/value/unit/limits and validated normalized companions. Nulls must not acquire favorable severity. Valid severities remain `good`, `moderate`, `elevated`, `high`, `severe`, `no_data`; legacy `status` is not a substitute severity field. Today excludes PFAS; lead remains unscored. Do not invent individual factor /100 scores or derive them from artwork.

Calendar dates use `YYYY-MM-DD` without timezone conversion. Instants use ISO timestamps with offset/UTC; schedules retain their IANA zone and intended wall time. Validate real dates, leap years, bounds, DST gaps/folds and cross-midnight intervals. Historical completion dates with unknown time remain date-only and marked as such. Never backfill a missing completion date from due date or `updated_at`. Quantities and fractional rates retain documented scales, precision and denominator.

API errors expose stable codes and safe localizable messages. Version content and translations with requested/served locale; retain official source identity and original-language access. Search inputs, names, exported text, model output and source excerpts require length limits, control-character handling and safe rendering. Preserve meaningful scientific symbols. Generated URLs and citations must be validated against intended schemes/domains; no `javascript:` links, open redirects, header injection or unescaped HTML/CSV/calendar fields.

### 3.6 Persistence, pagination and cross-feature refresh

Never rely on arrays in `HomeWorkspaceState`, URL review flags, deterministic fixtures, `useHomeDraft`, browser fingerprints or client-generated `Date.now()` revisions as production authority. Use server IDs/revisions and documented request IDs; migrate adapter models deliberately. Support pagination/range limits, stable sorting, counts with completeness flags and exact-ID reads. Aggregates must not silently count only the first page. Preserve inaccessible/missing origins without disclosing other users.

Confirmed updates invalidate all relevant views: action -> origin, agenda, project step, preparation, reminder; report correction -> test, home evidence, summary manifest, saved reason; Journal -> day/recent/Patterns/season; opportunity revision -> participation/task/attention; household -> guidance/house figures; home -> all current evidence/matches; identity/delete -> all private state, pending work, worker messages and cached URLs. Query invalidation is not a server job queue. Reconnecting clients need versioned refresh/delta reconciliation.

## 4. Whole-app data and service design

Use the existing Next.js server, Supabase/Postgres and existing public-source adapters where suitable. Extend them rather than build an unrelated application. The backend audit below identifies what is actually present. Separate request-serving, source ingestion, AI generation, durable scheduling and provider delivery so a slow source or model cannot block the whole homepage.

### Required record families and common fields

Private mutable records require `id`, server-derived owner, `revision`, created/updated timestamps, applicable `home_context_id`, status and explicit deletion/archive policy. Add source/parent references with owner constraints. Immutable events/snapshots have content/version hashes and recorded time. Avoid a single arbitrary JSON bucket with no validation for all domains.

| Record family | Required relationships and lifecycle |
| --- | --- |
| Profile, household categories, home contexts | One verified owner; versioned current/home-history relationships; seven category flags; optional tenure/year/water; distinct location references; no names/birthdates required |
| Settings and consent | Group revisions, saved preference values, effective permission/capability state, policy/version/time; separate account defaults from browser registrations |
| Public sources/evidence/guidance | Source registry, ingestions, normalized records, revisions, published pointer, review/withdrawal, localization, rights/retention and approved geographical scope |
| Actions and occurrences | Canonical origin and parent, schedule, status, completion events, estimates, private preparation, series and reminders; stable deduplication keys |
| Tests/results/documents | Home/site, milestones, analytes/sample points, original units/qualifiers, immutable correction history, reviewed attachments and transcription status |
| Assets/routines/observations | Installation and replacement chain, cadence basis, completion/skip/snooze history, moisture readings/photos, independent follow-up tasks |
| Kitchen/sites/fish/usage/inquiries | Independent owned records, dates/units/context, public source references, open questions and exact shared tasks |
| Project generation and saved projects | Request/input revisions, generation status, references, template/version/steps, preserved accepted project, step-action links and follow-up |
| Organizations/opportunities/participation | Source-verified public revisions; future/rolling sessions; separate user-reported commitments, attendance dates/hours, preparation and follow-up |
| Contacts/outreach/cases | Public jurisdiction/topic evidence; per-recipient reviewed draft, exact send snapshot, provider operation ledger, user-reported replies and tasks |
| Notes/attachments/prepared copies | Private note revision, optional sanitized file, independently frozen scoped handoff snapshots, export/opened/self-reported submission events and archive |
| Outdoor plans/forecast watches | Own planning place/zone, chosen periods and evidence snapshots, preparation signature, action relationship and versioned watch policy |
| Journal/history/analysis | Explicit fine/symptom logging, recalled/illness/category semantics; dated same-home source basis; versioned derived analyses and seasonal scopes |
| Conversations/messages/tool reviews | Owner and allowed context, ordered messages, source references, structured proposals, exact confirmations and independent operation reconciliation |
| Alerts/subscriptions/delivery | Typed source/action targets, revisions, read/dismiss status, deduplication, channel/device preferences and separate delivery attempts |
| Exports/deletions/recovery/connections | Scoped job manifests, expiring authorized access, durable cleanup receipts, challenges/session revocation and encrypted provider credentials |

### Common attachment service

Proposed sequence: request owned upload slot -> bounded private upload -> server signature/size/decode/scan validation -> metadata sanitization or document quarantine -> user preview -> commit attachment to exact owned parent. Return stage/status and explicit errors; a successful upload is not automatic attachment consent. Bind uploads to owner and intended parent/context, with single-use/restricted signed URLs and expiry. Recheck at finalization; reject a deleted or changed parent. Do not accept a client-supplied arbitrary storage URL.

Field-note and moisture photo UI currently accepts JPEG/PNG/WebP up to 5 MiB (5,242,880 bytes), at most 32,000,000 decoded pixels, and produces a PNG whose longest edge is at most 1600px with metadata removed. Exact byte/pixel boundaries are inclusive. Match those constraints at the server or publish a coordinated change; do not trust browser re-encoding as a security boundary. Original name/EXIF/GPS must not survive as exposed metadata. Visible people/addresses are not removed automatically. Lab original review accepts PNG/JPEG/PDF up to 10 MiB (10,485,760 bytes) in `TestsWorkspace.tsx`; align its current MB/smaller-than copy with the actual inclusive validator during frontend integration. Private documents must not execute embedded content, and any OCR is an unverified draft until the user checks original units/qualifiers and confirms.

All files stay private. Downloads require owner authorization and short expiry; generic exports exclude bytes/location. Selected attachment export or sending requires its own exact scope. Quarantine/processing/failed/ready/deleted are distinct. Clean abandoned uploads, replaced derivatives, orphaned files and expired exports with bounded jobs. Parent/account deletion invalidates signed access as far as infrastructure supports and schedules storage erasure; document the actual revocation window and backups. Protect MIME sniffing, decompression bombs, oversized dimensions, malicious PDFs, cross-owner links and quota bypass.

## 5. G01, X01: entry, identity, home transitions and learning

### G01 action-to-backend contract

| User action | Required backend behavior / result | Verification |
| --- | --- | --- |
| Get started / resume | Reuse verified anonymous/permanent session; distinguish no session from unavailable verification; return onboarding/profile state | Retrying outage never creates a replacement household |
| Enter location / retry lookup | Validate input, resolve current supported geography, return candidates, precision, zone and utility-match status; discard raw address under policy | No-match, ambiguity, timeout, unsupported area and partial source paths |
| Choose water/year/categories / submit | Explicit server field schema, seven full-replacement flags, same logical request key, atomic profile/home write and retriable backfill operation | Existing profile revision conflict; lost response; partial provider results |
| Skip supported optional setup | Store explicit unknown/not-provided fields; do not fabricate household flags, dates or supply match | Guidance works with no categories, unknown year and private water |
| Browse public Learn / Map | Public allowlisted evidence and published guidance without requiring private home; no home marker/ranking/private assistant context | Fresh browser, no session, no profile and supported public errors |
| Change home: find/review/cancel/confirm | Prepare candidate tied to current profile/home revision, selected portable task IDs, consequence manifest; confirm atomic transition and return old/new context | Cancel leaves old data; context changes during lookup/review/write reject stale commit |
| View previous homes / selected tasks | Authorized historical profile facts and exact surviving task IDs; historical readings retain old context | Missing/deleted tasks show unavailable, no resurrection |
| Restore access | Generic challenge response; verify challenge ownership/expiry before returning existing profile and devices | Wrong/expired/replayed challenge, collision, lost anonymous browser |

Onboarding must preserve the stable request ID across network retry; treat repeat with changed body as conflict. Return loading/partial/backfill-pending rather than invent history. Home changes must explicitly handle old subscriptions, garden/site associations, location-bound reminders, forecast plans and generated reasons. A portable personal task may be linked by deliberate choice; public event locations, old test samples and completed histories must not be relabelled. A failed new-utility lookup never retains the old utility under new coordinates. Exactly one current home is enforced transactionally.

Recovery design must link/restore the original identity, not create an account that only looks similar. Enrolment, challenge requested, verified method, removal and per-device revocation are separate. Mask addresses in normal reads; normalize case only where provider rules allow. Rate-limit challenge sending and verification, use expiring single-use codes/links with replay protection, validate redirects, prevent email enumeration, and document collision resolution with explicit no-silent-merge default. Signing in to an existing identity while an anonymous identity has records needs a reviewed choice and transaction, not reassignment by client ID.

Supabase anonymous users use the authenticated role and are distinct from the public anonymous API key; clearing their browser session can lose access unless an identity is linked. Public browsing must therefore be a deliberately implemented access mode. See [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), checked October 13. This documentation is a platform constraint, not evidence that HALO recovery is configured.

### X01 Learn and copy contract

Retain seven factor topics and the glossary. Provide published topic list/detail, bounded query/filter/cursor, requested/served locale, content version, supporting source identities/dates, review/withdrawal status, contextual guidance and safe links. Search covers reviewed content and synonyms, not an unrestricted model response. Empty catalogue, no match, missing topic, temporary failure and withdrawn content differ. Public reads cannot include household-specific labels or links that reveal records. Opening a definition, changing filters or returning from a guide is local presentation; it must preserve the caller's draft and not create an action automatically.

Store and review translations of server-owned guidance, errors and notification templates. Static button labels, fonts, artwork, animation, route transitions and calendar rendering remain frontend work; the backend supplies values, stable state/error codes and dynamic content. Never require a network lookup for every letter or animation frame. Source methods/credits/help can be versioned bundled content unless dynamic publication is necessary. Feedback currently supports preparing/copying text, not sending a support ticket; either retain that truthful behavior or add an explicit separately specified feedback endpoint with receipt, consent, abuse controls and retention.

## 6. P01-P06: complete My Week and connected work

Existing code references: `components/expanded/MyWeekWorkspace.tsx`, `HomepageHub.tsx`, `WeekPlanningRail.tsx`, `WeekReviewPlanner.tsx`, `WeekTimeline.tsx`, `WeekActivityDetails.tsx`, `WeekProgress.tsx`, `WeekUpdates.tsx`, `WeekJournal.tsx`, `WeekEvidence.tsx`, `WeekOutdoors.tsx`; `lib/frontend/expanded-preview.ts`, `week-*`, `homepage-preview.ts`, `luna-week-plan.ts`. Their memory writes, string keys and fixture periods need authoritative adapters.

### 6.1 Proposed action and plan APIs

| Contract ID | Proposed method / path | Input and output obligations |
| --- | --- | --- |
| WK01 | `GET /api/plan` | Inclusive calendar/range query, display zone, filters, cursor; canonical scheduled actions, unscheduled section, linked source dates, complete/partial counts, origin links and versions |
| WK02 | `GET/POST /api/actions`; `GET/PATCH/DELETE /api/actions/:id` | Owner, validated title <=160, optional date/schedule, typed origin/category/parent/context, reason/source snapshot, state/metadata, revision and idempotency; exact deletion receipt |
| WK03 | `POST /api/actions/reviews`; `POST /api/actions/reviews/:id/confirm` | Prepare exact batch diffs with revisions and metadata signatures; atomically apply moves/pauses/save-for-later/focus/availability or apply none |
| WK04 | `GET/PATCH /api/actions/:id/preparation` | Chosen checklist/notes bound to action, schedule, origin instructions and evidence versions; invalidation reason after change |
| WK05 | `GET/POST/PATCH /api/plan/series` and occurrence operations | Calendar-anchored vs after-completion, interval, end, explicit edit scope, pause/skip/cancel and consent; deduplicated next occurrence |
| WK06 | `GET/PATCH /api/plan/preferences` | Display zone, source visibility, optional streak, focus and week-specific supplied capacity; scoped revisions |
| WK07 | `GET/PATCH /api/plan/weekly-review` | Enabled, weekday, preferred prompt time, zone, confirmed creation of one review action per calendar week, pause preserving existing action |
| WK08 | `GET /api/homepage`; `GET /api/changes`; acknowledgement operation | Independently available score glances, attention, upcoming, preparation, actual-date recap and version-bound acknowledgement; no fabricated zero sections |
| WK09 | `GET/POST/PATCH/DELETE /api/reminders` | Own target/occurrence, requested channel/time/zone, consent, active/pending/cancelled/failed state and delivery references; capability not implied by request |
| WK10 | Calendar event export, local or authorized download | Saved title and schedule only by default, RFC5545 all-day/timed/escaping semantics; clear distinction from provider sync |

Recommended action schema additions to current `PreviewAction` and `WeekMeta`: `origin {feature,record_type,record_id,record_revision,step_id,template_id,template_version}`, explicit category (do not regex-parse display labels), `home_context_id`, `state saved|waiting|completed`, `paused`, `archived`, `schedule null|all_day|timed`, `estimate_minutes|null` plus basis, `completed_at|null`, `completed_on|null`, completion zone/precision, optional private note, history events, parent/series IDs, reminder IDs, evidence references and combined revision. Keep title/reason/source text separate. `estimateSet=false` means the wireframe's default 60-minute field is not an estimate.

All-day schema stores date; timed schema stores start/end instants, IANA zone, original local date/time and validated duration. Current UI allows 15-1440 minutes for task duration and only all-day weekly or seven-days-after-completion recurrence. Support those fully. Do not expose unsupported timed recurrence or series edit scopes; if added, define and test them before capability activation. Full/future series edits must retain completed history and exception dates.

Weekly capacity is nullable integer minutes from 0 through 10,080; zero is a deliberate value and is not unset. Current weeks start Monday. Weekly review `weekday` uses JavaScript numbering (0 Sunday through 6 Saturday); current logical key is `week-review:<Monday ISO date>`. Give this a stable owner and review-calendar-zone identity. A display-zone change must not rewrite saved calendar dates/instants or manufacture a second weekly review. A deliberate review-zone change needs an explicit future-occurrence policy while preserving existing canonical review tasks.

### 6.2 Every calendar and task action

| UI behavior | Backend requirement and meaning |
| --- | --- |
| Week/Month/Agenda, previous/next, Today, day select, swipe | Local navigation; fetch appropriate bounded range with stale-response protection, 42-cell month and cross-month data as needed |
| Search, category, finished items, archived/earlier/waiting, All upcoming | Query or filter complete authorized results; disclose pagination/limits; search must find matching items beyond selected day and period |
| Open exact task / origin / connected work | Authorize exact ID, return current record and available transitions; a missing origin keeps the task; invalid ID never creates a replacement |
| Add, save, edit title/status/date/note | Atomic action and metadata persistence; unknown save reconciles; no private note loss on partial patch |
| Save for later | Remove schedule/time and incompatible recurrence deliberately; retain same ID and origin; cancel/suspend obsolete reminders |
| Complete / reopen / waiting | Immutable status event with actual recorded completion date; reopening clears current completion status while keeping event history; evidence unchanged |
| Pause / resume / archive / restore | Preserve task and history; stop/reconcile relevant reminders and occurrence generation; completed work remains available for historical recap |
| Trash / Yes delete / No keep | Exact revision-bound task-only deletion; independent origin and other tasks retained; same key cannot silently resurrect from lazy fixture initialization |
| Focus | Persist a valid owned task reference; removed/archived/completed target reconciles cleanly; no copied task |
| Drag to date / Schedule / Move / confirm / cancel | Drag prepares a review; commit same task ID only after valid time/zone/revision check; cancel preserves schedule |
| Duration/estimate and effort drilldown | Known estimates or valid timed intervals only; unknown count retained; overnight split by display-zone boundaries; overlap remains additive effort, not free/busy availability or measured work |
| Prepare next occurrence / automatic repeat preference | Stable series/occurrence key and transactional creation, no duplicate on repeated click/worker retry; fixed cadence independent of late completion |
| Request reminder / manage / snooze | Persist consented intent and expose actual job/channel state; no delivery success from a boolean; snooze cannot rewrite an external event |
| Download calendar file | Use saved authoritative schedule, escaped text, exclusive all-day end, UTC timed instants and stable UID; exclude notes and evidence by default |
| Weekly review decisions / Apply / reload choices | Capture all IDs/revisions before review, validate entire batch, atomically persist metadata/focus/capacity; reloading preserves unsaved nonconflicting choices |
| Weekly review prompt Save / Pause | At most one deliberately created action per owner/calendar week; saved user edits preserved; pause preference does not delete action |
| Optional action rhythm / streak | Off by default; actual known action-completion dates only; no Journal rewards or health/environmental impact claims |

ICS generation may remain client-side from confirmed records. [RFC5545](https://www.rfc-editor.org/info/rfc5545/) defines the calendar format; a file download does not establish external calendar sync. A future provider write requires separate least-privilege authorization, explicit selected event, stable provider UID/mapping and unknown-result handling. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) distinguish event capabilities; no connection flag grants free/busy or unrelated calendar reads. Scope selection and account verification must match the shipped feature.

### 6.3 Homepage, connected dates and preparation

The homepage should load a bounded aggregate without fetching all private notes/documents/history. Return per-section availability and updated time so a failed source does not blank the calendar. Score glances use the same authoritative overview contracts as Today/Homeguard, including zero/null/partial and original dates. Task completion never changes a score.

Connected dates include chosen test plans, independently expected results without recorded results, active routine/snoozed dates bounded by end date, unpaused project review dates, chosen opportunity activity/follow-up dates and open case/question follow-ups. Do not create tasks from sample/report/observation/purchase/creation timestamps. Deduplicate same-origin/same-date canonical actions against linked markers. Calendar task counts and linked-record counts remain distinct. The existing `week-records.ts` rules are the compatibility baseline, with typed server relationships replacing colon-delimited string inference.

Attention combines earlier chosen tasks, waiting work, expected tests, newly recorded unreviewed results and actual source revisions. An expected result is not a guaranteed lab delivery or emergency deadline. Acknowledge change by exact evidence version; acknowledgement is not reading an alert, completing a task or accepting a new schedule. Cancellations retain plans and prompt explicit review. Missing source records stay recognizable.

Preparation covers chosen plans in the next 14 days with exact instructions, meeting-place label, source URL and checklist. Store a signature of relevant action schedule, origin instructions and evidence revisions. Changing any invalidates the old ready state without losing historical checks. Do not confuse organizer office/mailing address with a meeting place. Opening Maps shares only the selected place label with that provider, not the home location automatically. Checklists do not register, attend, complete or certify safety.

Recap joins actual completion events and explicit participation date (`participated_on`), not due/status-update dates. User-reported hours remain optional, validated nonnegative and separate from unknown. Project-step counts are a subset of unique action totals. Retain completed archived history; repeated completion/reopen events must have defined current vs historical counting so totals cannot double. Expose previous-week drilldown and exact records. No pollution reduction, saved energy/water or health benefit is inferred.

### 6.4 P03 forecast and outdoor plans

Proposed `GET /api/forecast` takes a selected place reference/consented bounded coordinates, date interval, timezone, requested factors and optional authorized category. Return actual supported geographies, per-factor valid periods, issue/retrieval/expiry times, native units/categories, uncertainty, source/method revisions, period resolution and maximum horizon. Do not convert the wireframe's three UTC example windows or two-day horizon into real provider guarantees. A duration exceeding a period requires coverage of the full interval or an explicit partial-coverage state.

Outdoor plan CRUD stores activity <=160, optional coarse place <=100, current/future date, duration 15-480 minutes, selected period, IANA zone, optional category, preparation checks, chosen forecast revision(s), one canonical action and optional recheck date/watch. Planning elsewhere does not move home or prove physical presence. Keep first-save and exact before/after update separate. Expired evidence cannot authorize a forecast-based selection until refreshed; changed evidence requires renewed review. No-coverage/far-future plans can still save honestly with a separately chosen forecast-check action.

Compare at least two genuinely comparable periods; preserve daily pollen as daily and show missing factors independently. Do not create an arbitrary safe-time score. Public warning links and live alert ingestion are separate. A watch evaluates material changes under a versioned policy for the saved area/interval/factors, then creates a review notification; it never silently reschedules. Location/time/source changes invalidate captured proposals. Cancel/retry/timeout retain the user draft and cannot create duplicate plans or watches.

### 6.5 P04 Journal

Reuse existing Journal routes with explicit versioned improvements. Required entry fields: date, home context where known, household-category code, explicit `felt_fine`/logging status, allowed symptoms, required severity for symptoms, possible illness, private note <=500, recalled/same-day basis, server timestamps and revision. Never infer Felt fine from no entry, an empty symptoms array with unknown status, or a legacy row. Keep current backend vocabulary with a reviewed UI-to-API mapping; labels such as Shortness of breath versus machine codes must not drift.

Normal date range remains past 90 days inclusive, no future dates; current UI retrospective selection is at most 62 dates, 12-week Patterns grid and latest seven entries. Add authoritative all-time `has_any_entries` and counts so a user with older records is not treated as first use. Loading an entry must finish before replacing it; a whole-record upsert cannot erase fields that failed to load. Category removal preserves past records and allows authorized historical inspection.

The 90-day regular-entry window is not a data-retention or historical-read limit. Older saved entries remain accessible through authorized history/export according to the chosen retention policy. Preserve original logging basis and first-recorded timestamp when an entry is edited later; do not retrospectively relabel a genuinely same-day entry as recalled simply because its correction happened on a later date. Store correction time separately.

Retrospective batch reports saved/kept/failed per date, preserves richer existing entries, retries only failed keys and does not turn unselected dates into fine days. Validate all dates and payload bounds server-side. Editing/replacing fine versus symptoms removes contradictory fields deliberately. Delete one with exact revision; Undo restores the exact snapshot only if no newer row exists, with bounded explicit authorization. Clear Journal is a separate operation that invalidates derived analyses but retains environmental history and tasks.

### 6.6 P05 Patterns and P06 seasonal review

Replace the existing backend analysis that uses all history days as a symptom-free denominator. New analysis must join explicitly logged same-day entries with compatible same-home evidence by local calendar date. Return logged days, environmental days, eligible comparable days, symptom/fine cohorts, recalled/illness/missing/incompatible exclusions, source versions and method version. Categories are household groups, not named individuals. Backfilled daily maxima and app-time observations cannot be pooled silently. Preserve original factor units and pollen categories; no numeric average of arbitrary category codes.

The wireframe's three symptom plus three fine days is a display heuristic, not a validated clinical method. Have the supported method reviewed and versioned before release. Return `insufficient`, `no_clear_difference`, `descriptive_result`, `pending` and `unavailable` distinctly. Source corrections, Journal changes, home changes and method updates invalidate dependent results. Never describe association as cause, diagnosis, dose, exposure or a proven effect. Chart and accessible table use the same dated rows and missing gaps.

Proposed history/analysis requests include from/to, category, factor and context, with bounded range/pagination. Do not discard `truncated`, comparability, measurement basis, source details, backfill status or context fields in frontend adapters. A filter changes the actual denominator and rows. Export selected range/category/factor without private notes unless a separate private export scope is selected.

Seasonal requests define season/year and exact start/end, including winter crossing years and partial current season. Use actual available history rather than claiming a full season from 84 days. Join actual completed tasks, current/historical-context tests by true report dates and participation by explicitly recorded attendance date. Unknown dates/hours remain exclusions. Tests/reports are not deadlines. Return source rows and exact task/record destinations. Dismiss prompt per owner/season/version; one deliberately saved next-review action uses a stable deduplication key. Seasonal export omits private notes, detailed report values, preparation and descriptions by default.

## 7. X03-X06: Settings, notifications, privacy and platform behavior

### 7.1 Six Settings sections and every saved preference

Proposed `GET /api/settings` returns current authoritative groups, group revisions, supported values and effective capabilities. `PATCH /api/settings/:group` validates an explicit allowlist and expected group revision. Saving one panel cannot save another retained draft. A conflict returns current allowed values; the frontend rebase adopts unedited server fields and preserves edited fields. Cancel and restore-defaults remain drafts until Save. Prefer one settings transaction over unrelated profile writes that can partially succeed.

| Group | Stored behavior | Backend obligations |
| --- | --- | --- |
| Home & household | Seven selected category flags; optional building year; utility/well/spring/other water; owner/renter/other tenure; home change/history | Preserve full flag replacement and valid unknowns; reconcile frontend minimum year 1000 with B01 minimum 1700 before connecting; profile/home revision; recompute matching/guidance only from actual changed facts; no history erasure |
| Alerts & reminders | Five existing categories, quiet enabled/from/to/zone, typed follows, reminder/device entrance | Existing categories affect both new inbox and push until explicitly migrated; schedules and device state are independent; validate overnight quiet interval and DST; resolve follows to source IDs rather than trusting a free-text label |
| Display & accessibility | Appearance system/light/dark, text 100/115/130/150, contrast, motion system/reduce, ambient boolean, requested language, calendar zone, linked dates, optional action streak | Persist account preferences if offered, with explicit device overrides and schema versions; system means follow device, not resolved current color; effective reduced motion is always authoritative on device |
| Luna & connections | Allowed task/home/project context, deliberate selected notes, conversation clear, email/calendar authorization/disconnect | Server-enforced context policy at retrieval and execution, transcript lifecycle and operation-ledger protection; no implicit Journal notes or attachments; exact provider scopes/status |
| Privacy & data | Inspection, scoped export, clear Journal, typed all-data deletion, recovery and devices | Authoritative inventory, confirmed manifests, full files/jobs/cache cleanup, secure status/recovery and no false success |
| About & help | Learn, methods/sources, credits, app/build/API versions, feedback preparation | Published metadata and reviewed content; copied feedback is not submitted feedback; no sensitive profile in diagnostic reports |

Current review defaults (including Luna tasks/projects enabled and home disabled) are examples, not implicit consent for a new external processor. Define the production disclosure and effective authorization before first model use. Preserve explicit choices across device/account changes with safe unknown defaults when settings cannot load. Do not make a missing preference equivalent to granted permission.

When quiet hours are enabled, equal start/end is invalid in the current UI, not shorthand for a 24-hour mute. Disabled quiet hours do not delay delivery. Preserve the saved overnight interval in its IANA zone; define and test DST repeated/missing-hour evaluation without duplicating or indefinitely deferring an alert.

### 7.2 Inbox, subscriptions and device delivery

Extend existing alerts/notifications/push APIs. Alert record needs stable ID/revision, kind/category, localized title/body key or reviewed text, event/issued time, source revision and URL, typed exact destination (feature/record/season/period), read/dismiss timestamps and owner. Badge/All/Unread share the same authoritative state and counts. Opening the inbox, expanding source detail or navigating to a destination does not mark it read. Read one, read all, dismiss and Undo remain distinct. Mark-all must specify a captured cutoff or selected IDs so concurrently arriving alerts are not silently consumed. Undo preserves original read status and fails safely after a conflicting newer edit.

Keep existing five categories: `air_quality_change`, `weather_advisory`, `new_water_results`, `radon_season`, `season_summary`. Introduce new task/event/watch categories additively. Do not silently split old combined inbox/push controls; publish migration/default semantics if separate channels are added. Source-sensitive air eligibility stays server-owned and versioned. Existing flood/heat source coverage does not establish boil-water or every emergency alert coverage.

Subscription schema: owner, supported entity kind/ID, verified geography/source coverage, subscribed events, channel intentions, quiet hours/zone, expiry, state, revision and last evaluation. Follow/unfollow from Map/Settings/source detail must resolve to the same subscription. Unfollow stops future notices but retains history and tasks. No arbitrary client URL polling. Unsupported/unknown coverage cannot be labeled active monitoring.

Device sequence: explicit user enable -> browser permission -> service-worker push subscription -> authenticated server registration -> confirmed delivery capability. Maintain unsupported/default/granted/denied/expired/error states; granted permission alone is not registration. Bind endpoint keys to verified owner/device, allow renewal/revocation/unsubscribe, remove invalid 404/410 provider endpoints, rotate VAPID deliberately, and avoid reassigning another identity's subscription silently. Notification content must use minimal lock-screen detail with safe authorized deep links.

Delivery jobs need unique event/subscription/channel keys, source/action revision, scheduled instant, attempts, lease, expiry, cancellation and provider receipt. Honor quiet hours and actual source validity; do not replay expired official warnings after an outage. Task pause/complete/archive/delete and opt-out invalidate jobs immediately, checked again before sending. A provider accepted push is not proof the user saw it. Keep inbox generation, dispatch and device delivery state separate. Cron runs must checkpoint, resume and avoid duplicate event production.

### 7.3 Privacy inspection, export, clearing and deletion

Proposed `GET /api/privacy/inventory` returns owner-scoped domain counts/completeness, retention and field classes. Include unloaded/paginated domains, files, home history, notes/prepared copies, tasks/series/preparation, Journal/analyses, participation/hours, outreach/provider operations, conversations, preferences, devices and subscriptions. Never use only currently mounted frontend collections to determine export/delete scope.

Export sequence: choose domains/context/range -> server prepares manifest of exact record revisions/fields and omissions -> inspect -> confirm -> create/download private artifact -> expiration. Use a stable job/manifest ID and snapshot policy; changing selected contents either invalidates review or returns the explicitly reviewed immutable snapshot. Defaults exclude private text, Journal details, conversations, exact coordinates/addresses and files. Current generic export excludes locations/files even with private text selected; separate attachment/location-specific workflows need independent consent and preview. Conversation export only when explicitly selected. Allowlisted schemas replace regex redaction as production privacy enforcement.

Keep household PDF, public map brief, Patterns JSON, seasonal JSON, event ICS, note prepared copy, sanitized photo download and account export separate, with their exact scopes. Include source dates, origin and omissions. No bearer tokens or long-lived public links. Device share/clipboard/print/download reports what the browser confirmed, not receipt by a person or agency. Downloaded copies cannot be revoked.

Clear Journal uses an authoritative captured record scope/revision and removes related private derived findings; retain home records, environmental history and tasks. Delete-all requires explicit review and typed confirmation, fresh identity, and durable operation status. Cancel new jobs/uploads/model requests first; reject racing mutations or reconcile them. Remove all current/historical owned rows, objects/derivatives, exports, preferences, subscriptions, sessions/recovery relationships, conversations and provider credentials, plus derived caches. Revoke tokens where supported. Return partial/unknown honestly and provide retry/reconciliation without recreating deleted data. No fixture reseeding after deletion.

An unresolved tool/send outcome must not be lost by clearing its only conversation record. Keep a minimal independent operation ledger and resolve or safely cancel it before final erasure under a documented retention rule. Do not make a permanently lost provider receipt an indefinite opaque denial of deletion: provide an operator-assisted/explicit unresolved-operation policy with minimal retained identifiers and disclosed limits. Audit retention and backups must have concrete durations, purge jobs and restore rules before release; do not promise immediate deletion of already sent email, organizer submissions, external downloads or backup copies.

### 7.4 Connections, OAuth and browser lifecycle

Provider authorization must use state validation, PKCE where applicable, exact redirect allowlists, server-held encrypted refresh/access tokens, least scopes, expiry/refresh, account binding, capability checks, revocation and audit. Cancelled authorization does not connect; a local `connected=true` is not authority. Disconnect stops future actions and revokes accessible tokens; it does not recall emails or erase independent calendar events. Email send and calendar event permissions do not imply inbox reading or free/busy access. Handle provider-account collision and changing sessions during OAuth without binding credentials to the wrong household.

Consumer session transport also needs an explicit security contract. Preserve verified bearer-only semantics, or deliberately migrate to Secure/HttpOnly/SameSite cookie sessions with mutation CSRF and Origin checks. Use exact CORS/origin allowlists, never credentialed wildcard access. Test cross-origin mutations and token/session expiry in either design. This is a release requirement, not a finding that existing bearer routes have a demonstrated CSRF exploit. Use TLS, CSP and safe external-link/referrer rules; OAuth-specific protections do not replace consumer-session protections.

Service-worker/manifest implementation remains frontend/platform integration but requires backend compatibility: private/authenticated API responses, files, transcripts and exports excluded from general cache; versioned public shell caches only; safe update while forms are dirty; notification-click routing after authentication; multi-tab/identity invalidation; old-client/new-server compatibility. PWA installation never implies working push/offline CRUD. Preserve generic public metadata with no household data.

Offline environmental cache may show dated source data under permitted retention. New private writes are online-only until an explicit identity-bound outbox contract exists. Retained draft is not server save. Never silently queue external send, deletion or old confirmed actions for much later. Requests cancelled or overtaken by factor/date/location/identity changes must not overwrite current UI. Browser storage restrictions, session expiry and page reload must have honest recovery. No network is required for decorative motion; stop it hidden/offscreen and respect device reductions.

## 8. Backend operations, deployment and reliability

### 8.1 Required job families

Use durable job records and idempotent effects, not one long cron that fetches every provider and processes every household. Separate jobs for source acquisition/parsing/validation/publication, home lookup/backfill, source-change detection, organization/opportunity freshness, contact revalidation, project generation, optional transcription, recurrence materialization, reminder dispatch, forecast watch, Journal/season recomputation, exports, account deletion, file cleanup and provider-token/subscription maintenance.

Each job has kind, deduplication key, owner/context or public source scope, input/revision hash, state, attempts, next run, lease/heartbeat, timeout, cancellation, progress phase, output references and sanitized error. Bound concurrent work, request sizes, time ranges and fan-out; exponential backoff with jitter/Retry-After, terminal failure/dead-letter and deliberate operator replay. Do not expose invented percentage progress where only phases are known. Locking/lease expiry must tolerate duplicate workers and deployment interruption.

### 8.2 Configuration and migration requirements

Use separate local/test/staging/production projects and provider keys. Publish variable NAMES, purpose, required/optional behavior, server/public classification, rotation and health check; never values. Required categories include Supabase URL/public key/service-role, Redis/rate limits, cron authentication, geocoding/map providers, environmental providers, model/retrieval provider, web discovery source, Gmail/calendar OAuth, VAPID, private storage, job runner, SMTP/recovery, source registry and feature capability flags. Exact current names are inventoried in the backend audit.

Apply ordered migrations on disposable/staging first; verify tables, columns, indexes, RLS grants/policies, constraints, security-definer search paths, RPC grants and transaction rollback. Track applied checksums and forward/rollback plans. Do not infer migration deployment from committed SQL. Backfill historic context with unknown confidence where it cannot be proven; never guess previous homes. Adopt expand/backfill/validate/switch/retire rollout so old frontend clients remain safe. New features stay unavailable with a reason until schema, sources and providers are ready.

Use database RLS and explicit grants for every exposed table; service-role routes still require owner checks and least scope. Views/RPC/storage policies need their own tests. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), checked October 13. Reject cross-owner references even when a service key bypasses RLS; keep credentials outside browser bundles and logs.

### 8.3 Monitoring, budgets and recovery

Record request/operation/job correlation IDs, route latency/error rates, auth rejection, source age/coverage/parser rejects, queue age/attempts, generated content validation/refusal, model/search spend, duplicate suppression, unknown outcomes, signed-URL failures and file cleanup lag. Redact prompts, health notes, exact addresses, emails, photos and tokens by default. Diagnostic metrics are not authorization to add behavioral analytics or session replay.

Define source-specific freshness, licensed cache retention and stale last-valid behavior. An unexpectedly empty import is quarantined before replacing good data. Invalid units/coordinates/dates, major row-count drops and changed schema need review. Source correction updates current pointers and downstream review flags while retaining historical evidence versions.

Set measured service budgets before release: fast cached reads, bounded database list queries, separate asynchronous generation/export, timeouts and per-user/project quotas. Existing frontend targets are first useful content <1.5s, local cache <200ms, loaded tab transition <100ms and map initial render <2s on a declared representative profile, not universal guarantees. Record network/device/cache conditions and backend percentile/error budgets rather than claiming desktop tests prove them. Expensive services need per-request/token/page/time ceilings and graceful quota errors.

Backup/restore covers Postgres, private object storage, source/version registry and encrypted provider configuration as appropriate. Run a staging restore drill and compare row/object/ownership counts. Honor deletion tombstones so restoring a backup does not resurrect erased accounts. Document RPO/RTO, retention, deletion aging, operator access, key rotation, incident response and known external retention. Kill switches should disable an unsafe producer/interpretation/provider without destroying user records or hiding historical sources.

## 9. Integration acceptance and delivery sequence

### 9.1 Required build order

1. Reconcile and integrate the existing B01 backend work with the current frontend baseline; fix audited defects and migration/test portability issues. Establish identity, context, response schemas, capabilities, RLS and operations ledger.
2. Publish source/evidence/content registry and normalized provenance; repair current Today/Homeguard/map/Journal truth and freshness issues before adding more consumers.
3. Implement canonical actions, typed origins, schedules, recurrence, reminders, settings and connected-date/homepage aggregates.
4. Implement owned home/food/garden/test/attachment records and full export/deletion coverage, then wire complete record-to-week journeys.
5. Implement opportunity/contact/source discovery, projects/generation, notes/cases and reviewed email. Add AI conversations and tools on top of the same domain services, never parallel mutation logic.
6. Complete forecasts/history/analysis/season, operator publication and all provider delivery/recovery workflows. Verify every existing and new UI route/state against contracts.
7. Run staged real-service integration, complete physical-device/accessibility/content/source review, and return the exact handoff evidence below. This sequence can overlap by stable contract boundaries, but downstream clients must not guess undeclared response fields.

### 9.2 Cross-app acceptance journeys

| Test ID | Journey and required assertions |
| --- | --- |
| INT01 | New anonymous -> optional household setup -> partial evidence -> My Week; no fixture, duplicate identity or fabricated score; resume on reload |
| INT02 | Public Learn/Map -> setup -> owned view; private rows/pins/assistant stay inaccessible before verified identity and home |
| INT03 | Utility result -> factor source -> test plan -> report upload/transcription/correction -> follow-up task -> summary; same IDs and original units/provenance throughout |
| INT04 | Private well/spring/unknown utility -> garden irrigation choice -> soil/water tests; no utility data leakage or copied drinking-water assumption |
| INT05 | Asset cadence -> complete late/skip/snooze/pause/replace -> same My Week occurrence -> reminders; no duplicate occurrences or old-asset delivery |
| INT06 | Kitchen food -> study/no-own-result -> food question -> independent task; no contamination inference from commodity/name/photo |
| INT07 | Fish source/species/audience/segment -> private catch/consumption note -> export/optional participation; official combined limits preserved, no inferred dose |
| INT08 | Selected area -> future or rolling opportunity -> essentials/official link -> commitment -> chosen date -> cancellation review -> actual user-reported attendance/hours; no registration/attendance fabrication |
| INT09 | Profile/preferences/selected notes -> 10-15 project generation -> refresh/shortlist -> save -> step tasks -> guidance/version change -> pause/resume/follow-up; generation does not mutate without confirmation |
| INT10 | Need/location -> publicly verified contact -> per-recipient draft -> exact review -> confirmed send -> lost response -> reconciliation; no blind resend or unjustified delivered/read claim |
| INT11 | Private note -> metadata-free photo -> prepared-copy scope -> edit note -> original snapshot unchanged -> official form opened -> user-reported submission -> archive/restore -> delete; no public exposure |
| INT12 | Map filters/timeline -> two-record comparison -> incompatible units/methods -> public brief; completeness and no-private-fields invariants; renderer failure list equivalent |
| INT13 | Task from every origin -> agenda/detail -> schedule/move/wait/complete/reopen/archive/delete -> original record preserved; complete batch conflict produces no partial mutation |
| INT14 | Outdoor place/date -> partial periods -> expired/changed forecast -> deliberate new review -> watch -> notification -> retained schedule; all-day/zone/DST/overnight correct |
| INT15 | Journal first use/older entries -> fine/symptoms -> recalled batch partial failure -> edit/delete/Undo -> Patterns -> season; denominators correct, notes excluded, analysis invalidates |
| INT16 | Luna question/navigation -> ambiguous task -> exact proposal -> user edit/confirmation -> revision/permission change -> reject or reconcile; conversation clear cannot erase unresolved operation |
| INT17 | Settings group drafts -> save one/cancel another -> concurrent device conflict/rebase -> language fallback/light mode -> reload; unknown settings do not grant context or drop unedited fields |
| INT18 | Alert received -> expand/open without read -> explicit read/dismiss/Undo -> exact missing target; concurrent mark-all cutoff; push denied leaves inbox usable |
| INT19 | Home change while requests/editor/generation pending -> exact review -> commit -> current evidence invalidated, historical context preserved, selected personal tasks linked; old-home response cannot contaminate new home |
| INT20 | Recovery enrol/link -> new device restore -> collision/revocation -> original records retained; expired links/provider outages cannot grant access |
| INT21 | Scoped export across unloaded/paginated domains -> exact manifest -> download; all-data deletion with concurrent job/upload -> reconciliation -> fresh session cannot rehydrate old data |
| INT22 | Source fetch failure/empty anomaly/unit change -> quarantine -> reviewer publish/withdraw -> downstream changes -> old evidence retained; unauthorized user cannot operate source controls |
| INT23 | Offline/session expiry/rate limit/timeout/malformed payload across every write -> retained draft, no false save, stable retry key and correct status recovery |
| INT24 | Cross-household malicious IDs in every route/tool/file/export/job -> no read/write/existence leakage; revoked sessions and source prompt injection cannot bypass confirmation |
| INT25 | Old frontend/new backend, refresh/back/deep link/service-worker update, light/dark/320px/150%/screen reader/physical Safari/Android -> no lost draft, inaccessible action or private-cache leak |

For every domain also test no records, valid zero, partial/stale/no coverage, large/paginated histories, Unicode/long copy, unsupported region, missing permission, expired provider token, deleted parent, duplicate click, out-of-order response, retry after unknown result and changed revision. Test clock/DST deterministically. Use disposable identities/environments for destructive/integration checks, never shared production households.

### 9.3 What Vibhav must return before connection is called complete

- Backend source commit/branch and applied migration checksums for staging; schema/RLS/storage policy test results and rollback instructions.
- Agreed API schemas, endpoint/method/auth/error/rate-limit catalogue, TypeScript adapter types and representative valid/empty/partial/error fixtures.
- Capability response with real enabled/disabled reasons, source coverage and policy versions; no secret values.
- Provider/environment setup instructions, selected contracts/scopes/rights, refresh schedules, queue configuration and verified sender/device/registration limits.
- Actual-source and owner-isolation staging evidence for every contract family, complete connected journeys, and remaining failures with accountable decisions.
- Export/deletion/recovery/backup-restore proof, durable operation reconciliation, source correction/withdrawal behavior and operational runbooks.
- Frontend integration change list: production routes/adapters/shared state that still need connecting, exact branch compatibility and any coordinated field/copy changes.

Yogi finishes the production frontend against this same specification while Vibhav implements services. Update this file and schema versions when either side discovers a required change. Save code/assets/tests/setup in the existing HALO GitHub repository on a review branch, not a replacement project. Final release follows actual connected-app verification; a published static Site or green unit suite is not that verification.

## 10. Verified existing backend and repair register

Audited October 13, 2026 against the exact branches below. Existing code and verified local tests are distinguished from deployed services. No backend implementation or deployment was performed.

### Exact inspected baselines

| Baseline | Exact commit | Meaning |
| --- | --- | --- |
| Current frontend HEAD | `f445588a34c6b8e886e17ccf649d472cf3dd24ec` | Completed Version 50 interactive frontend review. Backend files under `app/api`, top-level `lib/*.js`, and `supabase` match origin/main. |
| `origin/main` | `9f1ef88fe2d99aa82e96285ce7aa152e99a5acb0` | Older backend baseline, without B01 hardening and home-context APIs/migrations. |
| Freshly fetched `origin/vmag211/backend` | `fb4cadf7606577c928f010490c2857cac1d93419` | Most advanced inspected backend. Contains B01 validations, isolation, transaction/home-context work, six-operation OpenAPI and tests. Not merged into current frontend or main. |

Git diff confirmed the backend equivalence of HEAD and origin/main. The backend branch adds or modifies every route and migrations 0015/0016. Do not replace the frontend with that backend branch: it does not contain the expanded frontend. Integrate the backend changes deliberately while retaining current frontend source and approved archives.

All code claims below refer to the backend branch above unless explicitly marked otherwise. `docs/backend/checkpoint.md` and `requirements-tracker.md` are valuable but were checked against actual route/helper/schema source, not treated as implementation proof by themselves. The branch received only an old partial specification, cut off at BE-032; its tracker explicitly records B02-B12 as not started. The new consolidated handoff must supersede that incomplete input and retain B01 work.

### Independent verification during this audit

The branch was extracted using `git archive` to `C:/Users/ympat/AppData/Local/Temp/halo-backend-audit-20261013`. Dependencies were installed using `npm ci --ignore-scripts --no-audit --no-fund`. No local configuration files were copied, no secrets were printed, and no live HALO service was exercised. Route tests use an environment-scrubbing, network-blocked fake harness; database tests use local in-memory PGlite/Postgres 18 with real pgvector.

- `npm test`: **1,829 tests, 1,826 passed, 3 failed, zero skipped**, approximately 21.7 seconds. This is the fresh audit result, distinct from the branch checkpoint's historical 1,829-pass result.
- `npm run typecheck`: passed.
- No live build, browser journey, auth provider, deployed database, paid source, email, push, cron execution, or restore was tested.
- Two pure offline reproductions confirmed semantic gaps: five symptom entries plus fourteen environmental dates yielded a `ready:true` air finding of 71% versus 0% although none of the seven comparison days was logged; NWS humidity50 with precipitation `null` yielded `risk:"low"` and `precip_pct:0`. The first must be corrected to explicit logged/comparable denominators. The second needs a documented provider-specific justification or a missing-input result.
- Failures are test portability problems on Windows, not observed handler/data-isolation failures, but they must be fixed before calling the backend suite green: `test/dbConstraints.test.mjs:209` parses commented validation SQL with an end-of-line regex that misses CRLF; `test/routeHarness.test.mjs:378` uses an LF-specific source regex for auth-stub equality; `test/routeIsolation.test.mjs:518` creates `/api\\...` path names with Windows separators while expected endpoints use `/api/...`. The audit did not modify those tests.
- Test outputs: isolated extraction `audit-test-output.log` and `audit-typecheck-output.log`.

The existing checkpoint says migrations 0015/0016 were **not applied anywhere by that work**, and deployed schema/configuration remain unverified. No subsequent deployment evidence was found or obtained in this audit. Treat their live status as unknown, not applied. Do not run the reconstructed baseline on Supabase.

### Complete existing HTTP surface: 24 route files, 34 methods

Every consumer method below calls `requireUser`, which verifies the bearer token using Supabase Auth. An anonymous Supabase user is still an authenticated private identity. There is no truly unauthenticated public Learn/Map HTTP contract yet. The two cron methods instead require the shared cron secret. The route files in this table are the exact source paths; append `/route.js` to `app` plus the URL path, with `[id]` for a path parameter.

| Existing route and methods | Input / current behavior | Missing or integration-critical behavior |
| --- | --- | --- |
| `POST /api/onboard` | Body up to 4,096 bytes: address 3-200 characters, optional UUID request_id, water_source and home_year. Verified owner; legacy supplied profile_id must agree. Mapbox geocode, ArcGIS utility match, three-decimal stored point; context transaction when 0016 exists; 28-day backfill after response. Returns profile/location, utility match outcome, request marker, context and moved. | No separate persisted lookup/review/commit contract. Request replay is tied only to current context, does not bind payload hash, and replays still call external geocoding. Old closed-context request IDs can be treated as new moves. Some top-level replay fields echo request instead of saved state. Need durable review token, exact selected carry-over tasks, context revision, payload-bound idempotency and operation lookup. Validate geocoder coordinate ranges before SQL. |
| `GET /api/profile` | Own location, county/state/ZIP/PWSID, home_year, water_source, renter_mode, locale, onboarding marker, normalized household bands, onboarded/completed flags. Household read failure explicitly marked. | Add approved settings/capabilities/context revision; do not let defaults after failure become saved truths. Legacy profile columns/precise data must be audited. |
| `PATCH /api/profile` | Body up to 2,048 bytes, water_source/home_year (null clears). Current-home transaction uses a server-read revision, otherwise legacy fallback. | Client has no expected revision for profile PATCH. Transitional located-without-context path can move a household back after a concurrent move. Partial migration fallback can split context and profile. Prefer exact context PATCH and enforce complete rollout. |
| `GET /api/household` | Seven presence flags, household_set, renter_mode, locale; degraded reads flagged. | No revision, household version history or broader preference groups. No names/DOB are needed for current design. |
| `PUT /api/household` | Full seven-band replacement; omitted/null bands false. Optional renter_mode/locale (`en`,`es`), 2,048-byte body. `save_household` atomically writes both with 0015, otherwise two statements and `transactional:false`. | Revision-bound saves, conflict handling, account-wide context/cache invalidation, explicit supported locale/translation version. Omitted bands cannot be treated as patch semantics. |
| `GET /api/home-contexts` | Newest-first owned contexts, current_id/count/truncated; limit 100. Missing schema is nonretryable feature-unavailable. | Cursor pagination if more; lifecycle/export coverage for new domain records; support explicit source invalidation notices. |
| `GET /api/home-contexts/[id]` | UUID validation, exact owner-scoped detail, missing/foreign identical 404; closed homes readable. | Include allowed operations and references consistently across new domains. |
| `PATCH /api/home-contexts/[id]` | expected_revision plus water_source/home_year, 2,048-byte body, unknown keys rejected. RPC returns authoritative revised context; stale/closed 409. | Existing narrow contract is useful to reuse. Broader move workflow must bind all proposed changes and task carry-over. |
| `GET /api/daily-score` | Optional coordinate pair; `fresh=1`; verified owner. Own-point cache <1 hour, one provider refresh per owner per five minutes; parallel AirNow/Open-Meteo UV/Google Pollen/NWS; own-point cache writes. | Observation/issue/valid/source versions missing. Cache lookup remains household-wide, not exact home; own-point tolerance is 0.01 degree. Source time and model daily aggregate comparability needed. GET performs writes/provider calls; HTTP/cache/retry semantics must reflect this. |
| `GET /api/history` | days 1-365 or validated from/to up to 366 days; context current/all/owned UUID. Latest per date (and home in all mode); raw values/severity, comparability flag; at most 5,000 rows. | Truncation before home filtering can hide desired context. Need source/method/native-time details and stable pagination/aggregation. Legacy unlinked data assumed current; cannot prove historic home. |
| `GET /api/home-guard` | Defaults from profile plus validated county/state/PWSID/water/home-year overrides. UCMR water, static NC radon zone, lead-era estimate, score, household wording, deterministic action plan, private-water test guidance. | No owned tests/results, assets, gardens, food, summary state, or saved actions. Null PWSID does not inspect home context's lookup_failed status and can falsely imply no matched utility. Private-water wording/scoring content needs review; source and interpretation versions required. |
| `GET /api/journal` | Own date-range entries, up to 366 days and 2,000 rows, count/truncated. | No revisions/cursor/all-time first-use metadata; date/category schema does not carry home linkage. |
| `POST /api/journal` | Full entry upsert on profile_id + entry_date + band. Date, symptoms (20 max, each 80 chars), severity mild/moderate/bad, 500-char note, retrospective/illness; 8,192-byte body. | Revision conflicts, protected retrospective batch, immutable operation receipt, durable deletion Undo. Existing full replacement is not partial update. |
| `DELETE /api/journal` | Exact owned UUID or `all=true`; returns actual deleted count. | Mass-delete review scope/version and reauthentication policy; retained recovery/Undo contract if promised. Must not clear pending uncertain Luna writes first. |
| `GET /api/journal/findings` | Fixed 90 days, household-wide analysis, minimum gates, illness exclusions, truncated and excluded_earlier_home. | Current algorithm counts unlogged environmental days in denominator; must use explicitly logged comparable dates, category filtering, reviewed method versions and inclusion/exclusion counts. |
| `POST /api/journal/retrospective` | Up to 65,536-byte date list, rejects malformed/out-of-window entries, comparison only; **does not save entries**. | Implement separate protected batch-save and first-use lifecycle, all-time status, per-date outcomes and source comparability. |
| `GET /api/journal/summary` | Meteorological season/year (2000-2100), date range, household journal/environment statement, truncation. | Current summary averages/categories and picks a standout factor; no completed projects/tests/volunteering, scoped exports or exact drilldowns. Need consistent logged/comparable denominators. |
| `GET /api/learn` | One of seven topics + locale, source content from DB or English code fallback; per-band note, caller-supplied why-yours inputs. | Search/list/glossary/review-version contracts absent. Public mode must exclude personalized context. Server must derive verified why-yours from owned evidence rather than treating arbitrary query text as measured truth. Spanish reviewed completeness unknown. |
| `GET /api/sources` | Source disclosure from latest 60 household readings, newest utility import, cache time, static lead/Learn source metadata. | Not full evidence registry; dates mostly load/fetch not native observation. Household-wide after move. No permitted-use/expiry/version/detail/source-ops lifecycle. |
| `GET /api/map` | Authenticated public-reference layers water/radon/facilities/air; water quarter YYYYQ1-4; prebuilt or live rebuild, source outage 503. | No direct record detail/search/pagination/compare/follows/public brief contracts, general geographies, true AQ contours or tiles. Snapshot dataset capped 2,000 utilities. Old layer older than 36 hours ignored even if last-good could be served. |
| `GET /api/district` | Authenticated cached NC-08 aggregate and own county match. | General district/state/county selection and geography versions missing. Public mode must omit household_county. Partial boundary overlap/denominators must remain explicit. |
| `GET /api/volunteer` | Public organizations filtered/ranked by causes and county (profile fallback). Directory failure explicitly unavailable. | Organization directory is not local upcoming-event discovery. No opportunity dates, geocoded meeting location, rolling-program state, distance, eligibility/access, participation, freshness or changed-event review. |
| `GET /api/assistant` | Page-specific starter questions/disclaimer. | Effective privacy/tool/model capabilities absent. Recognized legacy page set omits My Week/plan. |
| `POST /api/assistant` | One question ≤1,000 chars in ≤8,192-byte body; optional legacy page; diagnostic decline; per-user/global rate limits; embed/retrieve/short cited reply, degraded statuses. | No streaming/conversation history, task/note tools, authorized selection, proposals/confirmation/reconciliation, web project research, provider actions or durable jobs. Default household-context environment behavior conflicts with granular opt-in settings. Citation-marker presence is not proof claims are grounded. |
| `GET /api/alerts` | Newest 100 nondismissed own alerts, exact unread count and truncated; legacy dismiss-column fallback. | Cursor pagination, read=false, revisioned mutations, exact target/source metadata, richer categories/entity subscriptions needed. |
| `POST /api/alerts` | Mark one/all read, dismiss or Undo dismiss; actual update count; 2,048-byte body. | Cannot mark unread; no expected revision or receipt; define action precedence and concurrent Undo. Historical targets must survive archived/deleted entity gracefully. |
| `GET /api/notifications` | Five category toggles, normalized defaults. | Not device status, scheduled reminders, quiet hours, channel selection or entity watches. |
| `PUT /api/notifications` | Partial boolean toggle update, 2,048-byte body, returns saved preferences. | Group-scoped expected revision, retained conflict/rebase, effective channels and consent timestamp. |
| `POST /api/push/subscribe` | ≤4,096 bytes, validated HTTPS allowed push host, P-256/auth key shapes; rate limited. Update owned endpoint; otherwise ignore conflict on globally unique endpoint. | `ok:true` can mean no registration if endpoint belongs to another account, intentionally nonrevealing. Return a safe truthful owned-registration result; device list/revoke/test lifecycle; integrate browser service worker/native support. |
| `DELETE /api/push/subscribe` | Remove caller's endpoint only; body limits/rate limiting, supports older host entries for removal. | Idempotent status/receipt and other-device management; reconcile client unsubscribe with server revoke. |
| `DELETE /api/account` | Body ≤2,048 with exact `confirm:"DELETE"`; deletes verified Supabase Auth user and relies on cascades. | No recent-auth/recovery policy, export, asynchronous deletion job/receipt, files/provider cleanup/revocation, backup replay or future tables. Generic 500 after uncertain Auth deletion requires reconciliation. |
| `GET /api/health` | Any valid user triggers parallel provider/Redis/DB probes at a fixed NC point; five-second probe timeout. | Move detailed paid-provider diagnostics behind operator authorization and cache/rate limits. It is not a lightweight public health check or per-source capabilities response. |
| `GET, POST /api/cron/daily` | Secret-verified daily job, maxDuration 60s; daily readings, maps/geography, water changes, five alert types and push. | Durable bounded jobs/checkpoints/leases, per-source cadence, per-user local time, recurrence/reminders/watch delivery, send reconciliation; current caps and failure order can lose notifications. |

### Existing data and migration inventory

`auth.users` plus **15 public tables** are present in the reconstructed-plus-migrated schema. Public-owned relationship tests are valuable, but reconstruction is not a deployed schema capture.

| Data | Existing schema / behavior | Required extension or verification |
| --- | --- | --- |
| `profiles` | Auth user primary key, approximate point/county/state/PWSID/home-year/water, renter/locale/request marker; legacy address, ZIP, build_year. | Context/read revision, account/recovery policy, no silent identity replacement, safe legacy cleanup; account-wide preferences elsewhere with explicit version. |
| `daily_scores` | Owned date/readings/score/aqi_source/details/created_at; nullable home_context_id added in 0016. | Evidence IDs, observation and valid times, source/method version, native resolution, retention policy, one authoritative current reading with immutable revisions; no ambiguous duplicates. |
| `home_risks` | Legacy owned table; only ID/profile/time reconstructed; unused by present code. | Audit deployed columns; document retire/retain/migrate before claiming total export/deletion. |
| `household_bands` | Seven booleans keyed by profile; no names/DOB. | Revision and consent/context change effects; keep minimal data. |
| `symptom_logs` | UUID, owner/date/band, text[] symptoms, severity/note, retrospective/illness, timestamps; unique owner/date/band. | Revisioned writes, explicitly fine vs absent, batching and Undo, analysis inclusion metadata. |
| `alerts` | UUID/owner/type/severity/title/message/fired/read/dismissed/dedupe_key; unique owner/dedupe where nonnull. | Stable source event/ref/revision/target, canonical read state, delivery events/outbox/subscriptions. |
| `notification_prefs` | Five booleans keyed owner, updated_at. | Settings revision/groups, channels/quiet hours/timezone/digest, new event types. |
| `push_subscriptions` | UUID/owner, globally unique endpoint/p256dh/auth/created_at. | Device identity and registration state, rotation/revoke, encrypted-at-rest credential handling and retention. |
| `home_contexts` | Owner sequence/revision/origin, rounded point and home attributes, effective interval, match/status, request marker, backfill state/range/time; one current per owner. | Carry linked new domain records; fix replay/move concurrency; keep past environments distinct from current evidence. |
| `ucmr5_utilities` | Public utility PWSID/name/status/contaminants JSON/import time. | Full release staging, native units and qualifiers/nondetects, facility/sample/method/point and source identifiers, revision provenance, completeness and rights. |
| `volunteer_orgs` | Name unique, description/counties/causes/URL/last_verified, later phone/email/address-like metadata. | Organizations, programmes and occurrences as distinct records; verification expiry, usable location/source-backed official next step. |
| `learn_content` | Topic/locale primary key, what_it_is/protect/household/sources JSON, updated_at. | Source/review/effective/translation versions, glossary/search, approval/withdrawal and rollback. |
| `assistant_corpus` | UUID public passage/source URL/label/retrieved/embedding; 2048 dimensions after 0013. | Versioned corpus runs/model fingerprints, atomic publication, ACL-safe private retrieval separate, grounding evals, source expiry and deletion. |
| `water_snapshots` | Public PWSID/fingerprint/time; service only. | Revision event/outbox transaction before acknowledging source change; avoid consumed changes with failed fanout. |
| `map_layers` | Layer key/payload JSON/assembled_at, service only. | Geographic/version/source/freshness/coverage keys, scoped tile/detail indexes, last-good cache rules and source errors. |

| Migration | What it actually supplies |
| --- | --- |
| 0001 | Auth profile trigger, owner RLS, owner/account cascades. 30-day cleanup is a commented example only, not scheduled retention. |
| 0002 | renter_mode/locale and seven household booleans/RLS. |
| 0003 | Symptom logs, owner policies and owner/date/group uniqueness. |
| 0004 | Public starter volunteer organizations, intentionally unverified dates. |
| 0005 | Bilingual Learn table/public read. English code fallback; no full Spanish translation catalogue supplied. |
| 0006 | Alert inbox, dedupe unique index, owner read. |
| 0007 | pgvector corpus/table/public read; dimension-dependent HNSW creation. |
| 0008 | Service-only corpus match RPC. |
| 0009 | Daily details JSON and profile state. |
| 0010 | Dismiss, preferences, push subscriptions, water fingerprints. |
| 0011 | Public-source map layer snapshots. |
| 0012 | Expanded NC-08 organization metadata/seed rows; not event ingestion. |
| 0013 | Corpus 2048-d vectors, removal of incompatible old embeddings, dropped HNSW, revised RPC; requires matching ingestion/model configuration. |
| 0014 | Profile onboarding request UUID. |
| 0015 | Service-only `save_household` transaction, symptom checks (new ones NOT VALID until historical rows reviewed), revoke direct browser insert/update/delete on four sensitive tables. Local only/unverified deployed. |
| 0016 | Home history table/RLS, current-home uniqueness, same-owner composite daily FK, move/attribute RPCs, legacy backfill. Local only/unverified deployed. |

Before applying 0015/0016: use the read-only catalog audit in `docs/backend/baseline-audit.sql`; review actual deployed original tables, RLS/grants and migration ledger; test production-equivalent schema in disposable Supabase; verify transaction/backout/reapply and PostgREST schema refresh. 0016 holds ACCESS EXCLUSIVE on daily_scores and SHARE ROW EXCLUSIVE on profiles until commit; schedule with measured data volume and backup/restore evidence. A successful SQL statement does not prove all privilege revokes worked. Broader TRUNCATE/REFERENCES/TRIGGER grants on older owned tables and multidimensional symptom arrays remain explicit hardening work. Neither this audit nor the frontend authorizes live migration application.

### Existing source adapters, providers and jobs

| Source / service | Actual code path and current limits | Build requirement |
| --- | --- | --- |
| Supabase Auth/Postgres | Anonymous bootstrap; bearer verification; service role at server, RLS owner reads; direct writes revoked for four tables in 0015. | Recoverable identity without losing valuable data; full operation authorization, recent-auth gates, storage/jobs policies, deployed audit. |
| Mapbox geocoding | `/api/onboard`, first feature of v5 response, transient address/precise point before rounding. No independent query timeout. | Verify contractual retention/storage rights; country/scope, ambiguity/review, coordinate ranges, geo-match accuracy, timeout/cancellation/cost limits. Same-geography search is separate from changing owned home. |
| ArcGIS water boundaries | Point-in-polygon onboarding; utility PWSID to centroid/population through `waterGeo.js`. Batch 100, parallel; memory 24h, Redis up to 7d. Partial failed batches not cached. | Version/license/coverage/multi-match ambiguity, service area vs centroid, no guaranteed tap utility; timeout and concurrency ceiling. Failed refresh must preserve permitted last-good geography. |
| AirNow | Own-point current AQI max pollutant within 25 miles; map monitors in fixed NC-08 bbox over last three hours. | Preserve actual observation timestamp/site/distance/quality, stale versus fresh, no fake continuous field. Geographic support, quotas and measured/model semantics. |
| Open-Meteo | AQI model fallback, current/hourly UV, 28-day modeled history; historical AQI daily peak and UV max. | Confirm supported fields/horizon and rights; retain source resolution/time/basis. Compare like periods, never current spot AQI with daily peak as equivalent. |
| Google Pollen | One daily pollen tree/grass/weed index, no history acquisition. | Time/source metadata, source-specific licensing/storage/attribution expiry, distinct forecast periods, per-account/region coverage. Historical missing stays missing. |
| OpenUV | Optional UV fallback; 45/day global limit, fails closed if limiter unavailable. | Actual account key/quota/model and observed time; do not promise additional forecast coverage from this fallback. |
| NWS | /points then forecastHourly first period for outdoor mold proxy; daily job active advisories per rounded cache point. | Null precipitation is currently assumed zero when humidity exists; validate or fix. Proxy is not a mold measurement. Native forecast issue/valid periods and advisory event expiry/source IDs; bounded fetches. |
| EPA UCMR5 | `uploadData.js` reads an operator's `Downloads/.../ucmr5_nc_only.txt`, groups by PWSID, **keeps only `AnalyticalResultsSign === '='`**, blindly multiplies values by 1000, inserts grouped rows. | Replace operator-only lossy import with typed complete release pipeline, retained nondetects/limits/native units/method/sample identity/dictionary, staging/reconciliation/review/atomic publication/rollback. Never equate empty contaminants with clean water. |
| EPA ECHO | Fixed NC-08 county queries for active majors + >4/12 noncompliance quarters; district containment; fetch timeout 20sec, sequential many pages. | Versioned selection, source status/coverage, missing vs zero for penalties/violations, budgets/pagination limits/background jobs. Facility presence is not exposure/pollution transport. |
| Radon / lead / district | Static NC county-zone map, building-era lead heuristic, bundled NC utility inventory and NC-08/county geometry. | Version/effective date/source review; missing geography distinct from low risk; no personalized indoor measurement without own tests. Revalidate interpretation/regulatory status. |
| Learn/corpus | English code/seeding and curated passage embedding, configurable compatible model endpoints. Corpus replacement deletes old rows then inserts (not atomic). | Reviewed guidance/translation/versioned corpus publication, tool-safe retrieval, ingestion failure rollback; no unreviewed generated health or regulatory claims. |
| Upstash Redis | Shared source cache and rate limits. Mapbox global 500/day; onboarding 10/day/user; assistant 20/hour/user and 450/day global default; daily 1/5min/user; push 20/hour/user. Most user/source limiters fail open, global assistant/OpenUV fail closed. | Product-specific quotas/cost alarms, validated startup configuration, distributed job locks/idempotency where needed, no private context in shared cache. |
| Browser Web Push | VAPID/web-push, endpoint parser allowlist before storage and sending; expired404/410 removed, others counted failures. TTL24h. | Service worker click/receipt integration, exact new routes, device registration truth, quiet hours/retries/outbox; service acceptance is not user delivery/read. Native Capacitor push is not implemented merely by capacitor config. |
| Cron | `vercel.json` `0 11 * * *` UTC daily; current job limits 5,000 profiles/2,000 utilities with no paging and 60sec budget. | Durable paged workers with leases/checkpoints, independent source cadences, one scheduled occurrence/one recipient event under concurrency, partial-failure recovery. A once-daily job cannot fulfill chosen reminder times or live-map freshness. |

No inspected adapter implements opportunity crawling, event APIs, place radius/distance, contact/person resolution, provider email send/read, calendar OAuth/sync, project web research/generation, file storage/scanning/OCR, water conservation/drought, food recall/study/fish-rule ingestion, operator publication workflows, export jobs or account recovery. Existing planning documents proposing them are not implementations.

### Cross-cutting defects and requirements to close before connected release

1. **Branch reconciliation and deployed audit.** Bring B01 changes into the integration branch without overwriting frontend; resolve dependencies and the three Windows test failures; capture live schema/config separately. A fixture and PGlite test cannot certify GoTrue/PostgREST/storage/scheduler deployment.
2. **Recoverable identity.** B01 stops replay of rejected POST/PUT/PATCH/DELETE after 401, which is valuable. GET/HEAD still recover by replacing the anonymous identity. Because daily/map GETs can write or invoke providers, distinguish refresh from identity replacement and preserve drafts. Build explicit recovery/link/device-revoke lifecycle, collision/expired/unknown outcomes, no duplicate accounts or implicit transfer of old records. `recoverSession()` is replacement, not recovery of original data.
3. **Capabilities and settings.** Add server-owned effective capabilities per account/source/geography/device/provider/action. The client's selected review scenario never grants permission. Add complete group-scoped revisioned settings, consent, language fallback and calendar preferences. No capabilities endpoint exists now.
4. **Mutation protocol.** Owner + operation type + stable idempotency key + canonical payload hash + expected revisions + context/evidence versions; atomic commit/result receipt; same key/same payload replays result, changed payload conflicts; operation status for unknown outcomes. Do not authorize by client owner ID, hidden UI, mutable label, model suggestion, or stale review.
5. **Home transition correctness.** Current frontend preserves historical records; backend 0016 currently deletes closing-home *today's* readings on move. Preserve historical evidence and invalidate old current-cache separately. Same rounded point may identify nearby different homes as one; define confirmed location identity and move semantics. Scope current Today cache/assistant/sources and all new projects/forecasts/maps/alerts to exact current context. Backfilled pre-move new-location weather is area history, not proof of the user's exposure before moving. Older unlinked readings need explicit legacy qualification and exclusion where comparability is unknown.
6. **Tasks as one canonical store.** No action/task table or endpoint exists. Every Save to My Week, completion, reopening, wait, unschedule, reschedule/batch move, project step, maintenance occurrence, participation and report follow-up must share stable canonical IDs, revisions and references. Historical observation/report dates remain distinct from planned dates; completed task does not alter environmental score.
7. **Evidence registry.** Typed immutable observation/forecast/advisory/guidance/private-report revisions with native values/units/qualifiers/limits, source record and content locator, publication/retrieval/observation/valid times, geometry/match method, coverage/freshness/rights and interpretation version. Null/zero/nondetect/estimated/unavailable incomparable states must survive every chart/export/Luna response.
8. **Analysis semantics.** `journalAnalysis.js` presently puts all environmental dates in denominator, so unlogged dates behave as no-symptom dates. Require explicit logged/fine eligible dates, group-specific scope, illness exclusions, same-date/home/method/source comparability and returned denominators. `journalRetro.js` averages severity ordinals; replace or scientifically justify before presenting quantitative means. Season summaries must count actual distinct dates and preserve partial season, missing series, linked actual completion/participation/test history.
9. **AI scope and security.** Existing assistant is single-question RAG with at most six retrieved passages and no actions. Build conversation/message storage policy, stream/cancel/error events, precise user-authorized private context, server tool registry, read-only retrieval vs reviewed mutation tools, revocation and audit, input/tool limits, prompt-injection handling and citation/claim evaluation. Household context defaults on unless environment exactly false; replace this coarse flag with consent+capability checks. Never infer authorization from retrieved/source text. The model must use the same task/record services and receipts as UI. Pending unknown action receipts must survive transcript deletion requests.
10. **AI/model consistency.** Migration0013 expects vector2048 while runtime/ingestion default to1536 unless configured. Validate provider/model/embedding dimension/corpus version at startup; do not silently compare embeddings from different models. Corpus/source publication must be atomic, versioned and reversible. Raw provider errors and private prompts must not leak into logs.
11. **Durable jobs and notifications.** Cron currently updates water fingerprints before alert creation; if fanout later fails, source change can be lost. It inserts alerts before push; later runs dedupe them, so failed sends are not retried. Concurrent cron inserts can collide at unique dedupe and fail a batch. Use transaction/outbox plus idempotent delivery workers. Remove hardcoded `hasRadonTest:false` once test records exist. Add exact event/entity revisions and notification destination schemas.
12. **Date/time behavior.** Backend `localDate.js`, backfill requests and move SQL assume America/New_York. Frontend supports display/device zones, timed/all-day tasks, event zones and recurrence. Store calendar date versus instant distinctly, explicit IANA zones, DST fold/gap policy and recurrence exceptions; changing display zone must not move all-day dates or recreate completed occurrences.
13. **Provider networking.** Many current onboarding/daily/backfill/water-geography/model requests lack explicit timeout/cancel and response-size limits. Add bounded attempts, backoff+jitter, circuit breakers, schema validation, page caps, cache-key/version rules and cost ceilings. Protect URL fetchers from SSRF (scheme/host/redirect/DNS/size/content-type rules), especially new web research/contact links. Do not interpret malformed200 or outage as a safe/empty source result.
14. **Public and private modes.** Current routes all require an Auth user; implement intended public browsing as explicit public reference contracts or documented capability with absolutely no own-home pin/ranking, household records, private Luna or private cache. Separate public source cache keys from owner-specific state. Foreign/missing resource errors must not leak existence.
15. **Storage/lifecycle.** Add private upload intents, size/type/signature limits, quarantine/scanning, metadata-free photo derivatives, exact attachment ownership, signed expiring read, separate consent for image inclusion/export, abandoned-upload cleanup and original/derivative deletion. No current storage implementation exists. Add full scoped export and reliable selective/account deletion across all new tables, blobs, conversations, jobs, devices, provider grants, caches and backups, with reconciliation and deletion tombstones for restores.
16. **Operations, source publication and security.** Source-ops screen is simulated. Add real operator roles, least privilege, immutable audit, source acquisition quarantine/review/approve/publish/withdraw/retry and translation versions. Health provider probing currently allowed to any authenticated anonymous user: restrict/cache/rate-limit operator diagnostics. Cron permits query-string secrets; migrate callers to headers and redact secrets from logs. Configure TLS, allowed origins/redirects, CSP and token/session strategy for the actual hosting/native setup. No server service-role key in browser bundles.
17. **Truthful source/staleness handling.** Map `readLayer` discards >36h stored snapshots then rebuilds; failure returns503 although old permitted data remains stored. Define explicit last-valid stale rendering with retrieval/observation dates. Water geo partial failures should not replace a complete useful map with missing points without declared partial status. Return coverage counts/filters/pagination, not misleading totals from row caps.
18. **Consumer text.** Backend-generated copy and AI/source content shown directly must follow no-em-dash app rule, localization, date/unit formatting and concise product wording. Legacy routes still contain user-visible implementation notes and misleading absolute claims such as nobody tests private water. Replace with source-reviewed user-meaningful text without suppressing safety, uncertainty, measured-vs-estimated or actual service limits.

### Backend configuration inventory (names only)

Existing consumed variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `AIRNOW_API_KEY`, `GOOGLE_POLLEN_API_KEY`, `MAPBOX_TOKEN`, `OPENUV_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `ASSISTANT_MODEL_KEY`, `OPENAI_API_KEY`, `ASSISTANT_CHAT_URL`, `ASSISTANT_CHAT_MODEL`, `ASSISTANT_CHAT_FALLBACK_MODELS`, `ASSISTANT_EMBED_URL`, `ASSISTANT_EMBED_MODEL`, `ASSISTANT_EMBED_DIM`, `ASSISTANT_MIN_SIMILARITY`, `ASSISTANT_GLOBAL_DAILY_LIMIT`, `ASSISTANT_SEND_HOUSEHOLD_CONTEXT`. `BASE_URL` is used by the legacy smoke script. Public VAPID variable is a browser integration requirement/template entry, not evidence of completed browser registration.

Define and document future configuration for selected private object storage/scanning, durable queue/scheduler, mail/calendar OAuth/provider, web research/AI, source ingestion credentials, sender/domain verification, redirect URLs, budgets, retention, encryption key rotation, monitoring and allowed geography. Do not choose arbitrary provider secrets or commit credentials. Runtime should fail safely with feature-specific unavailable reasons when required configuration is missing.

### Minimum backend acceptance suite supplement

For every new domain implement server validator, schema/RLS/foreign-link isolation, owned read/create/edit/delete/export where applicable, revision/idempotency/status fixtures, and actual connected persistence proof. Existing B01 OpenAPI `b01-1` covers only six operations: onboarding, household PUT, context list/detail/PATCH and history. It is not the full API contract. Generate or validate frontend types from a complete versioned contract and test response/error/header conformance, including new capability enums.

Required targeted checks in addition to feature-specific handoff tests:

- Two anonymous and two recoverable accounts, public viewer and operator; every route/action/nested ID/query/storage key cannot expose or mutate another owner. Test same resource ID+foreign owner, database direct access, service-role code paths and export aggregation.
- Concurrent home move/profile PATCH/daily refresh/backfill/Luna confirmation; old-context response arriving late cannot become current; same idempotency key after move remains linked to its original receipt; ambiguous coordinate equality is reviewed.
- Same mutation key twice, same key with changed body, stale revision, concurrent delete/edit, timeout after server commit, expired session during confirmation, device offline/reconnect, revoked provider grant while job queued. Prove at-most-once logical effect and status reconciliation.
- Historic mixed sources and home contexts: current observation versus modeled daily maximum, missing native time, nondetect vs zero, outdated regulation/source, incomplete geography, unlogged vs explicit-fine Journal day, retrospective entries, illness and group filters, empty/truncated histories.
- Full migration apply/reapply/backout in production-equivalent disposable Supabase, privilege catalog/RLS assertions, all-owned-table+blob deletion/export, restore with deletion replay, source parser/corpus rollback and partial failures.
- Provider timeout429/401/403/malformed200/schema change/partial pages/unexpected empty, failover provenance, expiry/rights revocation, quota exhaustion; configured startup dimension/model mismatch.
- Notification source update acknowledged only after durable fanout record; worker crash before/after alert insert/send, duplicate delivery attempt, quiet hours/DST, changed/removal event, expired endpoint, provider accepted but receipt unknown.
- Malicious documents/pages/contact records/notes cannot alter system/tool instructions; model output cannot manufacture recipients, tool authority, measurements, safety guarantees, sources or successful delivery. Tool confirmation checks exact resource revision and reviewed payload after response delay.
- Final production route+backend connected journeys include reload and second-device state; mocked frontend or shape tests alone do not meet release acceptance.

## 11. Today, Homeguard, Food and Garden contracts

Audited October 13, 2026. These requirements include complete private workflows and source-evidence semantics, not just the visible overview screens.

### Evidence and interpretation

Reviewed frontend HEAD: `f445588a34c6b8e886e17ccf649d472cf3dd24ec`. Reviewed freshly fetched backend branch `origin/vmag211/backend`: `fb4cadf7606577c928f010490c2857cac1d93419`. An endpoint described as existing below means code exists at that backend revision. It does not establish deployed migration state, provider credentials, production RLS correctness, successful delivery, provider entitlement, or a passing deployed end-to-end test. No production/private rows, live write requests, provider credentials, or private documents were used for this audit.

Sources read and reconciled: `AGENTS.md`; `docs/foundation/WIREFRAME_COMPLETION_MATRIX.md`; `docs/continuation/WIREFRAME_COMPLETION_RECEIPT.md`; relevant complete requirements in `docs/product/HALO_MASTER_PLAN.md`, `HALO_FRONTEND_BUILD_PLAN.md`, `HALO_BACKEND_AND_DATA_PLAN.md`, `HALO_FEATURE_ACCEPTANCE.md`, `HALO_TODAY_HOMEGUARD_BACKEND_SUPPLEMENT.md`, `HALO_FOOD_EVIDENCE_EXTENSION.md`, and `HALO_SOURCE_ACQUISITION_GUIDE.md`; executable foundation and home-workspace components, state, types, validators, exports, and live stage adapters. The older supplement is useful evidence but is not proof that its description of an older backend remains true.

Current architecture is materially split:

- Live Today/Homeguard use `lib/frontend/stage-api.ts` and `stage-data.ts` with core daily, home, history, Learn and household contracts. These are not interchangeable with visual fixtures.
- `components/homeguard/HomeWorkspaceState.tsx` is an in-memory provider. Its synthetic starting records, simulated delay, draft retention, revision/conflict scenarios and local exports demonstrate the intended interaction; they do not save tests, maintenance, food records or reports to an authenticated backend.
- The reviewed backend contains core `/api/daily-score`, `/api/home-guard`, `/api/history`, `/api/learn`, `/api/household`, profile/home-context routes and other central families. It does not contain the expanded tests, home assets, moisture, kitchen inventory, food/fish evidence, garden, grower inquiry, water-use, household-summary snapshot, or source-follow service families described below.
- Public sources, an owned measurement, a user's transcription, model-generated explanation, planned task, completed action and reported environmental benefit are different things. None substitutes for another. Completing a task or saving a test must never silently change an environmental score.

All route names marked **proposed** below are implementable contract proposals, not claims that those URLs exist. Vibhav may choose a consistent equivalent, but the final typed contract and frontend adapter must cover the same operation, failure, ownership and state semantics.

### Shared contract for this entire domain

#### Owned rows, relationships and commands

Every private entity requires a stable opaque `id`, authenticated `owner_id`, immutable creation time, updated time, monotonic revision/ETag, originating `home_context_id` where applicable, and explicit archive/deletion state. The server derives ownership from the verified session, never a body field. Household categories are presence flags, not named people or people counts. Enforce same-owner/scope foreign keys and RLS for nested reads, downloads, exports and command execution, not just list screens.

Use revision-bound commands: `{expected_revision, idempotency_key, ...validated_fields}`. Return the canonical changed entity/revision and affected related IDs/projections. A conflict returns current revision and field-safe conflict information, not an overwritten record. An uncertain response is reconciled through the same operation key before retry. Read-before-write in the browser is not a transaction. Reject mutation against deleted, replaced, archived or foreign parents as appropriate. Validate source versions, attachment ownership and linked-record compatibility on the server.

Keep origin-specific tasks canonical. An explicit Save to My Week should return or create the same owned action for `{owner, home_context, origin_domain, origin_id, purpose, occurrence_if_any}` according to its purpose policy. The preview's `home:${originId}` key is too broad for production and lacks domain/context/purpose. Editing an origin updates the source projection without duplicating a saved action; deleting an independent action does not delete its source. A scheduled action is separate from the source record's historical collection/observation date. My Week, alerts, Luna and source pages must all reference the same entities and revisions.

Dates have types, not one generic string: calendar dates stay ISO `YYYY-MM-DD` without UTC conversion; timed events retain local wall time, IANA timezone and resolved instant; source publication/collection/observed/retrieved/valid/expiry dates remain distinct. Resolve DST gaps/folds explicitly. Historical records keep their original context and timezone. Current-home replacement invalidates current evidence projections and pending stale requests but never relabels an old sample or moves a past observation to a new household.

All fields use server-side length/range/list/count limits matching the UI. Add agreed aggregate record, result-row, attachment, query-window, export and pagination limits: the preview does not define a safe unbounded production limit. Reject malformed numbers, NaN/infinity, impossible dates and arbitrary foreign keys. Preserve original reported text/units/qualifiers alongside parsed numeric values. Zero, absent, non-detect, below-limit, unknown and failed acquisition are different values.

#### Evidence envelope

Environmental, advisory, study, forecast and source-backed guidance responses need an evidence envelope, for example:

```ts
type EvidenceEnvelope = {
  id: string;
  revision: string;
  source_id: string;
  source_revision: string | null;
  source_url: string;
  source_locator?: string;
  issuer: string;
  observed_at?: string | null;
  collection_start?: string | null;
  collection_end?: string | null;
  published_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  retrieved_at: string;
  expires_at?: string | null;
  scope: { kind: string; public_id?: string; geometry_id?: string; resolution?: string };
  method_id: string;
  method_version: string;
  status: 'available' | 'partial' | 'not_reported' | 'not_covered' |
    'unmatched' | 'stale' | 'withdrawn' | 'unavailable';
  quality_flags: string[];
  limitations: string[];
  attribution: { text: string; url?: string }[];
  permitted_uses?: string[];
};
```

Distinguish acquisition success with zero matches from provider failure, unsupported geography and expired material. `retrieved_at` is never substituted for the sample date. Keep raw immutable source revision/hash/locator plus normalized records and normalization version. Corrections append source versions and invalidate derived matches/caches with a visible change reason; do not rewrite old exports silently. Public datasets must not contain owner IDs, home pins, private labels, kitchen contents, questions or laboratory attachments. Public queries use the minimum necessary geography and never send private notes to providers.

#### Shared read/write presentation states

Every list/detail/form must support loading, genuinely empty, partial success, unavailable source, stale cached data, offline, invalid input, permission/session loss, record no longer available, retryable network error, rate limiting and revision conflict. Separate authorization failure from a legitimate empty list. Bounded pagination needs stable ordering and explicit truncation. Retain unsaved input across recoverable failures; do not claim a write was saved while queued or after a timeout. The current wireframe does not implement an offline write queue. Server response copy must also obey the app's no-em-dash decision.

#### Files and exports

The local original-review controls are not production uploads. Private uploads require a preflight ownership/capability check, allowed extension and detected MIME, byte/pixel/page limits, malware/content validation, quarantine before use, explicit user review, encrypted/private storage, short-lived scoped downloads, revocation, deletion of originals/derivatives/jobs, quota enforcement and a published retention/recovery policy. Photo metadata is removed by actual decoding/re-encoding, followed by server verification. Visible identifying text or landmarks are not removed by stripping EXIF; the user still reviews them. Never expose private objects through a public bucket or URL in analytics.

PDF laboratory originals may intentionally contain identifying report text and need explicit private-document handling. Do not call all PDFs metadata-free merely because image EXIF processing exists. OCR, if added, produces an unconfirmed extraction draft and never overwrites originals or confirms safety. Food inventory is illustration-only and does not require a food-photo recognition system.

Local JSON/PDF generation is a valid frontend implementation when it uses an authorized, consistent, versioned server snapshot. A download/copy/native share does not mean a recipient received it. Public reference exports exclude private fields by an allowlist. Household summaries and full account exports have different scopes and defaults. Export, account deletion and restoration tests must include every new row, history, attachment, watch, snapshot and queued job below.

### Today: T01 to T06

#### T01. Current conditions, score, changes and history

**Executable surfaces:** `components/foundation/PersonalHero.tsx`, `FactorTrend.tsx`, live stage adapters and the shared score selectors. The user opens the score/factor explanation, selects trend points or a tabular alternative, refreshes/retries, checks sources/changes, enters household guidance, and returns without losing context. Ambient animation pause and decorative motion are client-only. Today contains air, UV, pollen and outdoor mold-condition context in a stable order.

**Existing backend:** `/api/daily-score`, `/api/history`; `lib/dailyReadings.js`, `dailyPayload.js`, `scoring.js`, `dailyCache`/route logic and `journalHistory.js` on the backend branch. Preserve the existing native values, composite, missing-input and source distinctions. A displayed individual factor `/100` value requires an explicitly agreed method and version; do not invent client scoring because a design has a ring. Higher HALO score and higher hazard/native-index value have opposite meanings and need unambiguous labels.

**Required work:** deliver a coherent snapshot ID, home context ID/revision, generated/valid dates and timezone, per-factor evidence/methods, included/excluded/missing inputs and coverage with any score. A proposed `GET /api/changes?home_context_id=...&since_snapshot_id=...` can describe meaningful changes only between comparable evidence, with changed source/method/coverage distinguished from an environmental change. Do not present each animation tick, refresh time, or corrected source row as a new hazard. Retain unavailable factors as unavailable, never zero-risk.

**Verified adapter/backend gaps:**

1. The fresh backend history route now exposes home-context/comparability metadata, including legacy-assumed/earlier-context handling. `stage-api.ts` `parseHistory` discards top-level `context` and `truncated` and row `home_context_id`/`comparability`; extend it and the chart model instead of falsely connecting incomparable histories.
2. The backend history selection omits saved AQI source/details, so historical measured/modelled method identity and other source timestamps are not reliably transported. Add provenance/methods and aggregation semantics, not a boolean guessed by the chart.
3. Current own-location cache eligibility uses identity/date/age and location tolerance, not a binding to the specific current home-context revision. Recheck the context after slow acquisition and before persistence/response publication. An old in-flight request must not populate the new home's current score or a same-day cache slot.
4. Backend daily day selection uses `America/New_York`; the final contract must define profile/display/source timezone behavior for other users and daylight boundaries. A single global date key is not sufficient.
5. Current factor/provider retrieval is parallel but lacks a complete bounded abort/timeout/retry budget. Apply per-provider deadlines, aggregate response bounds, quota budgets and circuit/backoff rules; preserve dated previous valid evidence on provider failure.
6. A `fresh=1` owner cooldown exists, but provider budgets and safe, source-rights-aware regional request deduplication are still needed. Avoid precise private locations in shared cache keys/log output. Do not treat a limiter failure as unlimited paid-provider access.
7. Stage `asOf` often reflects retrieval rather than actual source observation. The UI needs both without laundering stale data as fresh.

**Acceptance:** zero versus null; complete/partial/no score; one provider unavailable without destroying other factors; force-refresh cooldown; unchanged and corrected source; switch home during a slow fetch; two homes on the same calendar date; identity replacement; historical legacy-context data visibly qualified; pagination/truncation; provider provenance retained through cache/history/export; midnight and DST; no chart interpolation across missing dates; no task completion altering scores.

#### T02. Air quality

**Interactions/data:** current native AQI, category and dominant pollutant when supplied; source/method details; trend/date selection; explanatory and household-tailored practical guidance; official source links. Detailed claims require pollutant, station/reporting-area or model-grid identity, observation/valid instant, geography/resolution and qualification. A regional AQI is not an indoor/personal measurement.

**Existing:** AirNow reporting-area observations, with Open-Meteo/CAMS-derived US AQI fallback. Existing code takes the maximum returned AQI; retain and document the aggregation, pollutant coverage and timestamp alignment. Keep measured observation versus modelled estimate explicit in current, historical, map and export views.

**Required fixes:** reject negative missing-data sentinels and invalid AQI before scoring rather than clamping them to good air. Preserve AirNow `DateObserved`, hour/timezone, reporting area and pollutant metadata now discarded during normalization. Do not combine unrelated observation hours without disclosed rules. Expose fallback reason and method version. Provider response success with unusable rows is not an all-clear. Per-pollutant concentration units, if exposed, remain separate from AQI index points.

**Acceptance:** negative sentinel, zero AQI, mixed pollutant availability, maximum-selection explanation, late observations, fallback/model discontinuity in a trend, missing dominant pollutant, out-of-coverage locations, upstream error and explicit provenance in household advice. Never infer measured air concentrations from nearby map-marker density.

#### T03. UV and usable outdoor timing

**Interactions/data:** current UV, forecast/native index where supported, peak-window explanation, point/history details, household guidance and outdoor-planning link. Users must distinguish now from a forecast and a general protection note from personalized clinical advice.

**Existing:** Open-Meteo current/hourly UV acquisition and fallback path, with a simple peak-window derived from hourly values. `dailyReadings.js` stores provider details that `dailyPayload.js`/stage do not fully expose, notably UV source.

**Required:** transport provider, issue/valid/observation times, timezone, forecast horizon, hourly values, method and coverage. A peak-window response needs `status` such as `available`, `all_below_threshold`, `partial`, `unavailable`, threshold/method version and actual intervals. The current first-through-last-above-threshold approach can bridge lower-UV gaps and wrap an ending midnight without a date; do not imply uninterrupted risk. Return intervals with instants/local labels. A null window must not ambiguously mean both low UV and missing data. Forecast data for planned outdoor dates needs a separate range/availability contract, not cloning today's UV into the future. Check actual provider subscription entitlement; a quota comment in source code is not a license.

**Acceptance:** all values below threshold versus no data; split peak intervals; midnight/date rollover, timezone/DST; partial hourly series; forecast outside supported horizon; stale issue time; provider fallback; peak timing identical on Today, household and outdoor planning; no invented indoor measurement or personalized burn time.

#### T04. Pollen

**Interactions/data:** tree/grass/weed values and categories, actual available date, selected category/overall context, source attribution, history, household guidance. Geography support, index definition, in-season and plant-specific facts must come from the provider rather than decorative tree/grass icons.

**Existing:** Google Pollen daily acquisition currently selects the first returned daily record and category values; limited metadata is carried forward. Stage historical pollen currently computes the maximum category per day. That is not a consistent selected-category series and must be labelled as a maximum with its changing category, or replaced by actual per-category history for category selection.

**Required:** validate index range and semantic definition; retain provider date, region, category and season information, coverage, issue/retrieval times and rights expiry. Store each native category independently. Do not compare pollen numerical indices to AQI/UV as equal units. Build provider attribution, caching/retention and map-display gates into the implementation, including derived HALO indexes if they include these data. Excluded or expired provider data must not silently survive in indefinite public archives.

**Acceptance:** mixed missing categories; all-zero but valid versus missing; not-in-season versus no coverage; chronological provider date selection; category-specific trend continuity; attribution in current/history/export where permitted; expiry; unavailable region; no implicit medical diagnosis or medication recommendation.

#### T05. Outdoor mold-condition proxy and private indoor moisture

**Interactions/data:** outdoor-condition explanation, contributing weather basis, source and limitation details, household guidance, and an entry into H07 to record actual indoor observations. Outdoor proxy, a user's indoor RH reading, visible dampness and laboratory identification remain separate evidence classes.

**Existing:** an NWS forecast-period humidity/precipitation-derived proxy. It is not measured mold or an indoor sensor. Current `dailyReadings.js` treats a null precipitation probability as zero; the reviewed NWS documentation does not support a universal null-equals-zero interpretation.

**Required:** preserve weather period's start/end, location/grid, source update, actual humidity and probability values, missing flags, algorithm/version and result status. Missing contributors should make the estimate partial/unavailable according to a reviewed rule, not favorable by default. Bind the proxy to the correct valid interval rather than calling any first forecast period a current measurement. NWS point/grid mappings must be refreshable and requests have identifiable User-Agent metadata. Indoor photos never establish mold species, health diagnosis or automatic remediation success.

**Acceptance:** absent humidity/PoP; genuinely zero probability; stale forecast, future first period, source coverage change, unsupported location, indoor RH zero versus absent, observation retained independently of outdoor proxy, no pixel-based mold diagnosis and no home score change from observation logging.

#### T06. Daily household guidance

**Executable surfaces:** `components/foundation/FamilyGuidance.tsx`, household figures and `lib/frontend/home-household.ts`. Users select one of the seven configured categories, filter All/Outdoors/At home where offered, inspect factor/why/source details, change household selections through Settings, and return to the correct context. Generic Save-this-step guidance buttons were removed by later decisions; do not recreate unwanted automatic tasks. Explicit record follow-ups elsewhere remain.

**Existing:** household flags, `/api/learn` and static reviewed guidance. General category education is possible when measured context is absent but must not claim current personalized evidence. A selected category is not a named person, diagnosis, pregnancy status verification or headcount.

**Required:** a consistent guidance projection, either enrich Learn or proposed `GET /api/guidance/household?scope=today&home_context_id=...&category=...`. Return category, current evidence IDs/revisions, source-backed guidance content revision, applicability/limits, missing-context state, actual response locale and fallback locale. `stage-api.ts` preserves the returned `locale` and null `why_yours`/`household_note` (covered by current tests), but does not carry explicit Learn unavailability/reason, requested-versus-delivered locale fallback metadata or content revision. Extend those fields rather than claiming the existing locale is lost. A household read failure is not proof that all household flags are false. Never send private notes/medical documents to generation merely to personalize category education.

**Acceptance:** all seven categories, none selected, category removed while detail is open, unavailable household fetch, missing environmental inputs, locale fallback, requested unsupported category, stale evidence, sources rendered accessibly, no private person-specific risk prediction and no change to raw conditions when category flags change.

### Homeguard: H01 to H08

#### H01. Home overview, workspace and evidence coverage

**Interactions:** authoritative score and PFAS/radon/lead entry points; household category guidance; four workspace rows Tests, Home care, Food and Garden and Summary; Add disclosure with existing creation routes; Quick access current records/milestones/food branches/My Week; retry/source/coverage details. The workspace remains one compact primary feature above the house. Row counts/statuses must be genuine scoped projections, not initial fixture counts.

**Existing:** `/api/home-guard` and household/home-context APIs. Proposed `GET /api/home-workspace?home_context_id=...` may cheaply return exact record IDs, versioned truthful counts, current continuation targets and unavailable/empty states; equivalent parallel typed domain reads are acceptable. Do not derive exact record links from titles, labels or latest array positions.

**Critical unresolved product-contract conflict:** at current backend `app/api/home-guard/route.js:471-492`, private-well/spring explicitly returns `score: null`, `display_score: null`, `is_partial: true`, `included_inputs: []`, `missing_inputs: ['water']`, and radon in `unused_inputs` if present. But `docs/product/HALO_TODAY_HOMEGUARD_BACKEND_SUPPLEMENT.md:336` says: “the existing backend can legitimately return a radon-only Homeguard score with limited coverage” and says not to change the backend to reproduce a null-score fixture. This historical written requirement and current implementation disagree. Neither a fixture nor newer code alone resolves product/scientific policy. Record an owner decision on whether private-water has no composite or a qualified radon-only composite. **Compatibility baseline until resolution: preserve the current backend's null composite and its separate radon context; do not add client scoring.** Once agreed, make Homeguard, My Week glance, Summary, exports, Luna, tests and accepted contract documentation use the same authoritative response. Personal test entry alone does not authorize a new scoring algorithm.

The current private-water route's wording “Nobody has tested this water” / “Nothing ... has ever been measured” is unsupported: HALO lacks knowledge of every outside test. Use a knowledge-scoped unavailable-measurement explanation. Do not imply an unintegrated user-held report has become an accepted score input. Lead remains excluded from the composite unless an explicit separately reviewed decision changes that established policy.

**Acceptance:** public supply, private well, spring, unknown source, unmatched PWS, failed lookup, no detections, excluded-only, partial and unavailable source; direct link to deleted record; home change clears current projections but preserves history; every score glance agrees including zero/null/partial; all entry routes survive empty data; independent milestones never imply completed stages; private-water contract-resolution test is a release gate.

#### H02. Drinking water, PFAS and testing pathways

**Interactions/data:** public-water details, contaminant rows, source/collection dates and comparison points, utility/provider correction, benchmark explanation, official resources/filter information, well/spring test plan and create/resume test, compatible history where supplied. The response must distinguish what was measured, where/when it was sampled, detection limits, matrix, analyte, original and normalized units, and the user's water-source association.

**Existing:** UCMR-derived public-system aggregates, water statuses and a private-source testing pathway in `/api/home-guard`; `waterPresentation.js`, `wellTestData.js`, `scoring.js`, `actionPlan.js`. Status values include `private_well`, `no_data_yet`, `lookup_failed`, `no_pwsid_available`, `detected_unregulated`, `normal`; coverage includes `complete`, `no_detections`, `excluded_only`, `partial`, `unscoreable`. Private source-type well/spring is explicit. Lookup failure is retryable and not a normal reading.

**Required:** immutable individual public sample identities and a versioned aggregation projection. Current aggregates/native-unit normalization do not by themselves give the UI a lossless original sample-history contract. The stage trend chooses a per-date maximum, which can hide different sample points/analytes; preserve all originals and declare any displayed aggregation. Data with unknown or unsupported unit conversion remains visible but uninterpreted. `ppt` for water cannot silently become a mass-basis food/soil unit.

PWS/county query overrides are public browsing parameters, not authority to modify an owned utility relationship. Service-area match, user's confirmation and explicit utility choice must be recorded separately; nearby utility coordinates do not prove that it supplies the household. Changing water source invalidates current appropriate projections without rewriting past results. Private-well water never borrows a nearby utility's results.

Benchmarks need `{analyte, value, unit, benchmark_type, jurisdiction, rule_id, rule_version, published/effective/compliance_dates, status, applicability, source}`. Current hard-coded PFAS limits and proposal flags in `scoring.js` are not a complete legal lifecycle contract. Distinguish enforceable rule, pending proposal, health benchmark and HALO screening method. A historical single UCMR sample over a threshold is not automatically a current legal violation; preserve applicable averaging/sampling-point requirements. No unsupported total-PFAS calculation or medical consequence.

Filter/cost/renter guidance must be dated, sourced and model/scope-specific where certification is asserted. A generic certification name does not establish a product's reduction claim. The user remains responsible for an official provider/testing handoff; HALO does not order a kit because a link opened. There is no automatic pollutant-removal score after checking a filter task.

**Acceptance:** ND/less-than/zero, non-regulated detections, lithium/excluded parameters, unsupported units, mixed sample locations, out-of-date UCMR, current source corrections, benchmark changed/proposed/rescinded, private source without measurement, failed versus unmatched utility, unrelated-PWS spoofing, retained test provenance across utility changes, official links and one canonical explicit follow-up.

#### H03. Radon

**Interactions/data:** county zone estimate and explanation, original source and scope, practical testing instructions/resource, prepare/continue a private radon test, recorded dates, later report and follow-up. County zone is a potential estimate, never this home's measured radon or a recommendation based on a nonexistent home result.

**Existing:** county-zone dataset and normalized risk in the home route. Required additions are the H06 owned test service, original radon unit and sampling duration/method/location, source update/version, county resolution limitations, and reviewed result-guidance policy. User-entered result interpretation requires sufficient method/duration data and a reviewed protocol. Do not convert one short test into an automatically verified mitigation requirement, completion or measured improvement.

**Acceptance:** unknown/non-NC/unmapped county as applicable, zone versus measured result clearly separated, valid collection start/end/duration, unsupported units, missing method, repeated/corrected reports, follow-up versus original sample date, no score change from planned or completed testing, safe resource routing without commercial certification assumptions.

#### H04. Lead and plumbing

**Interactions/data:** construction-year estimate where used, utility inventory/source details, no-data explanation, plumbing/service-line evidence versus water sample, lab/test link and source-backed next steps. Unknown build year or inventory status is not lead-free.

**Existing:** `leadRisk.js`, `leadInventory.js`, current home response. Lead is unscored; current inventory logic is geographically scoped and must retain that scope. Utility inventory totals do not identify a particular home's service line or indoor plumbing.

**Required:** preserve estimate method/version, input build-year category, inventory date, material classification definitions, service geography, unknown count and scope. A property-specific service-line claim needs an actual authorized address/property lookup source and match confidence, not a county/PWS aggregate. Keep user-held plumbing evidence and test report metadata typed separately. Build-year updates invalidate only relevant projections and future guidance, not old source snapshots.

**Acceptance:** unknown year, pre/post category boundaries, unsupported state/utility, inventory missing/unknown/mixed materials, private-well appropriate test route, no conversion of aggregate to household material, source correction, no lead contribution in any composite/export and no “safe” claim from absent evidence.

#### H05. Home household guidance

**Executable:** `HomeHousehold.tsx`, `home-household.ts`, family figure entry routes. All seven selected categories remain reachable despite removal of the separate large people-context box. The user switches categories, reads home-factor guidance, opens relevant evidence/official resources and returns to the same house/workspace context. Unselected direct links use a truthful general-information/edit-context state rather than claiming a selected household member.

**Required:** same category/evidence/guidance revision contract as T06, with `scope=home`, explicit missing-context states and source applicability. Category changes must not erase historic tests, observations, Journal entries or prior exported reports. Suppress category-sensitive claim personalization when the household fetch is unavailable, not merely treat every missing flag as false. General toddler/adult/pregnancy/respiratory education is not person-specific medical profiling. Decorative household artwork has no backend evidence semantics.

**Acceptance:** all selected/unselected category routes, home/PWS changes, failed household read, no named-person or count inference, omitted/raw-source context, role/ownership protections and source dates/limitations carried into selected exports.

#### H06. Tests and records

**Executable:** `components/homeguard/TestsWorkspace.tsx`, `HomeWorkspaceState.tsx`, `HomeWorkspaceUI.tsx`; `lib/frontend/home-test-preview.ts`. This entire mutable domain is a wireframe implementation pending real services.

**Full interaction inventory:** search; type/status/context/archive filters and reset; plan a test; import/enter a report; open exact record; edit details; cancel or discard dirty draft; mark or unmark independently recorded arrangement; record/edit collection start/end, location and method; mark awaiting/expected date; add/remove analytical result rows; inspect a local original; explicitly confirm transcription; save ambiguous/uninterpreted rows; correct previous result with reason; inspect correction history; compare compatible records; private attachment add/review/remove; export selected record JSON with optional context; save/resume one follow-up; include in Summary; archive/restore; confirmed destructive delete. The timeline is navigable by actual recorded milestone, not a forced wizard that invents earlier stages.

**Canonical schema:**

```ts
type HomeTest = OwnedRevisioned & {
  kind: 'water' | 'radon' | 'lead' | 'soil';
  title: string; purpose: string;
  sample_context_id: string;
  context_snapshot: { label: string; revision: string; irrigation?: string };
  medium: string; provider: string | null;
  planned_date: string | null;
  collection_start_date: string | null; collection_end_date: string | null;
  sample_location_label: string | null; method: string | null;
  expected_result_date: string | null;
  arranged_by_user: boolean; awaiting_recorded: boolean;
  status: 'draft' | 'arranged' | 'sampled' | 'awaiting' | 'recorded' | 'followup';
  review: 'not_received' | 'unreviewed' | 'needs_clarification' | 'user_confirmed';
  review_reason: string | null; rows: TestResultRow[];
  attachment_ids: string[]; archived: boolean;
};
type TestResultRow = {
  id: string; analyte: string; original_value: string; original_unit: string;
  qualifier: 'measured' | 'less_than' | 'non_detect' | 'zero' | 'absent' | 'unknown';
  parsed_value: number | null;
  limit: string | null; limit_unit: string | null; limit_type?: string | null;
  basis: string | null; report_date: string | null; report_reference: string | null;
};
```

Persist append-only correction versions with prior rows/review, author/time and reason. Define test milestone facts independently of a convenience status projection. Unmarking arranged must not erase an actual later collection/result. A user may enter an existing result without claiming HALO arranged or observed collection. Keep laboratory/provider text distinct from a verified lab-directory ID. `user_confirmed` confirms transcription, not independent laboratory verification, certification or safe results.

**Proposed operations:** `GET/POST /api/tests`; `GET/PATCH/DELETE /api/tests/:id`; typed milestone update; `POST /api/tests/:id/results` for first/corrected result with expected revision and reason; `GET .../history`; authorized comparison endpoint or typed comparison over authorized snapshots; archive/restore command; common private-attachment endpoints; explicit common action save. List supports bounded search/type/status/context/archive filters and stable pagination. Parent+rows+correction write is transactional.

**Validation:** required title/purpose/context/medium on preparation; actual valid calendar dates, collection end not before start; radon requires end for collection recording; expected date not before collection when known. Collection requires location label. Missing method/units/basis/date can remain as clearly uninterpreted result, not force invented values. Enforce row/analyte bounds and distinguish explicit `0`, `<x`, `ND`, missing and arbitrary original text. Duplicate analytes warn, not silently deduplicate. Preserve reported limits with their units/type and sample basis. Existing UI field maxima: 160 for title/provider/sample location/method/report reference; 600 for purpose/correction reason; 120 for analyte/original text; 40 unit; 80 limit/basis. Agree finite row, history and attachment quotas.

**Comparison:** current validator permits only compatible, user-confirmed numeric records with matching sample context/snapshot including irrigation, test kind, medium, location, method, analyte sets, units and basis, and no unresolved issues. No automatic unit conversion exists in the preview. A server conversion must be explicitly supported and versioned, never water-volume to tissue/soil-mass. Unavailable comparison needs a reason checklist. Original values remain visible beside any valid derived difference.

**Attachments:** current local review accepts PNG/JPEG/PDF up to 10 MiB (10,485,760 bytes, inclusive), creates a local object URL and has an explicit inspection checkbox; it does not upload or perform OCR. Align the current MB/smaller-than copy with the actual validator during frontend integration. PDF opening may fall back to an external local-original view. Production bytes need the private-file pipeline and versioned link records. A filename is not proof of original storage, review or extraction.

**Calendar/link semantics:** planned and expected dates are eligible connected dates; historical collection/report dates are historical unless the user deliberately schedules a follow-up. Correction never creates a duplicate task. A garden-linked test preserves original site/irrigation snapshot even after site changes/deletion. Exact test IDs, not latest similar title, drive continuation.

**Food capability gap:** the test form's medium can be tissue, but kinds currently are only water/radon/lead/soil; kitchen has no typed owned-sample matching UI. Before supporting item-specific PFAS/lead results, agree a food/tissue-capable test schema and exact item/lot/sample link and coordinate frontend entry/linking. Do not misuse a generic kind or a question's report reference as proof of a matching assay.

**Acceptance:** each list filter/empty reset; prepare/import; only real milestones; clearing arrangement with a later result; original file corrupt/wrong MIME/oversize/foreign; result qualifier and method limits; confirm/correct twice with immutable prior versions; compatible/incompatible compare; concurrent edit; archive/restore without data loss; export current/history exact; deletion with orphan-file cleanup and retained independent actions; retry after uncertain save produces one record; home switch during form retains original authorized context or explicitly requires correction.

#### H07. Maintenance, recurrence and moisture observations

**Executable:** maintenance workspace components and `lib/frontend/home-maintenance-preview.ts`. Actions include list/detail/history; add/edit a home asset/routine; configure cadence; complete, skip, snooze, pause, resume or replace/retire with actual dates/notes; inspect a history event; link an owned test; add/edit/delete standalone observations and optional photo; export; explicit action follow-up; confirmed delete. Draft changes and history actions are not automatically scheduled tasks.

**Asset schema:** owned ID/revision/context, title/model, install/service dates, relevant factor, source instructions, basis `user|manufacturer|reviewed`, cadence policy `calendar|completion`, integer interval 1..365, unit days/months, next due date, calendar anchor, optional end date, last completed date, snoozed-until date, status `active|paused|replaced`, optional test ID. Append history `{id, kind, recorded_at, effective_date, original_due_date, note, previous/new cadence where relevant}` for completed/skipped/snoozed/paused/resumed/replaced/cadence-changed. A user-selectable “reviewed” basis is not an editorial verification credential; provenance of real reviewed instructions must be separate.

**Recurrence semantics:** calendar-anchored versus completion-relative recurrence are different. Preserve original month-end anchor (Jan 31 to Feb month end to Mar 31), do not drift permanently after a short month. A skip is not completion; snooze is an occurrence override, not necessarily a rewritten series; pause halts future generation/reminders, resume follows explicit policy. Replacement links a new asset without rewriting the old history. Stop at end date. Completing late must not spawn a pile of duplicate past tasks. Materialize occurrence IDs deterministically and reconcile the same occurrence across task, alert and source row. Concurrency/cron retries must not create two next occurrences. Completion event validates future/installation/last-completion constraints; paused/replaced transitions obey their valid set.

**Moisture schema:** owned ID/revision/context, title; kind dampness/leak/condensation/humidity/other; observed local date/time, IANA timezone and resolved instant; room/site label; optional original reading/unit; observation source; private note; optional attachment ID; optional owned asset/test IDs; correction history where needed. Numerical RH validates 0..100 only for explicit relative humidity; nonnegative numeric input in another measure does not automatically become RH. A visual leak note requires no measurement. Indoor evidence never gets merged into outdoor mold proxy or diagnosed from a photo.

**Photo state:** preview JPEG/PNG/WebP up to 5 MiB (5,242,880 bytes), at most 32,000,000 pixels, and a processed longest edge at most 1600px, all inclusive, with client metadata-free raster processing, cancellation and a visible-identifiers review. Production must enforce server-side equivalents and private storage rather than persist browser data URLs. Keep original review status bound to exact processed attachment revision. Preparation cancellation and remove-before-save must dispose unused uploads; upload failure must not wipe a saved observation.

**Proposed operations:** `/api/home-assets` list/create; `/:id` read/update/delete; `/:id/events` command; history/occurrence projection; `/api/moisture-observations` list/create and `/:id` read/update/delete; common attachment and action contracts. Label/model/source/room limits 160; instructions/history note/moisture note 2,000; unit 40. Exact limit alignment must include unbounded free-text fields and event counts before rollout.

**Acceptance:** calendar/completion policies, Jan31/leap year/DST dates, skipped versus completed, overdue completion, pause/resume, snooze/end bound, replace without losing history, double cron/event retry, stale edit conflict, missing/foreign test or asset, independent observation survives routine deletion, observation zero/absent RH, photo processing/cancellation/security, calendar sees only genuine due dates, complete/export/delete reflects the same canonical state.

#### H08. Household summary, privacy review and PDF

**Executable:** `SummaryWorkspace.tsx`, `SummaryReport.tsx`. User selects purpose, date range, source/home context, sections and individual records; opens exclusions/details; opts into categories/location/private notes/attachment references/appendix; reviews; generates actual local PDF; sees deterministic progress; cancels/retries; opens/downloads/native shares; changes selection and regenerates; uses retained image/print alternatives. A Luna-looking progress animation does not mean an AI model assembled or received private records.

**Data contract:** typed source-consistent snapshot, for example proposed `POST /api/household-summary/snapshots` with `{purpose, home_context_id, date_range, section_selection, selected/excluded_ids, privacy_flags, expected_source_revisions}` returning immutable short-lived authorized snapshot ID, selected entity revisions, evidence and methodology versions, section status, source dates, omissions and created time. Equivalent authenticated reads captured consistently are acceptable. Do not require a server PDF renderer solely because the frontend already makes a PDF.

Defaults: environmental score/factors only. Tests, actions, maintenance, moisture and gardens are individually opt-in; categories, location, notes, attachment references and appendix are off by default. Selecting an attachment reference does not insert original bytes or identifying content without another explicit selected scope. Whole-account export is a different Settings operation.

Replace current summary fixtures (`factorReadings`, preview scores, dates/county and water selector) with authoritative authorized data. Water-source selection cannot pretend the actual household changed. Resolve H01's private-water score conflict once and apply the same score/coverage here; do not recompute in PDF. All sources retain original evidence dates even when older than the private-record date range.

Define date inclusion per domain, not the current permissive “first date-like field” fallback. Tests have explicit collection/report/planned precedence or selected date kind; tasks use scheduled date or labelled undated; maintenance uses selected occurrences; observations use observed time; garden/site without event date stays undated. Record and label excluded/undated cases. Sections use distinct available/empty/unavailable/omitted/truncated states. Record deleted or changed during assembly requires reauthorization/revision reconciliation, not a silently mixed snapshot. Source signatures/access must not leak private details through public share URLs.

**Acceptance:** mixed evidence dates, null/zero/partial score, every opt-in off/default, exact selected/excluded records, no original private files by default, unknown date, pagination/truncation, section fetch failure, home changed during generation, record deleted/conflicted, generation cancel, revised selection invalidates old output, font/glyph failure fallback preserves exact values, user cancels native share without error, no model call or third-party upload, authorized download expiry/deletion if server snapshots are stored.

### Food and Garden: F01 to F06

#### F01. Hub, kitchen inventory and item-linked evidence

**Executable:** `FoodGardenWorkspace.tsx`, `FoodPantry.tsx`, `PublishedFoodEvidence.tsx`, `FoodShared.tsx`; `food-catalogue.ts`, `food-pfas-guide.ts`, `food-evidence.ts`, `home-food-preview.ts`. Hub links/resume to kitchen, fish, gardens, evidence, growers and water; optional interests reorder the hub. These local preferences can share the global preferences service if account persistence is intended. Catalogue and illustrations are public/static content, not reasons to invent a new paid API.

**Kitchen inventory actions:** catalogue name/alias search; clear search; show more; custom food; add to Fridge/Pantry/Freezer; inspect exact saved item; edit label/storage/origin/question; move storage; remove; inspect distinct PFAS and lead evidence; read original study/source details; prepare optional question or canonical follow-up. Food additions/moves/deletes must not change scores or infer ingestion. Duplicates of a food name can be legitimate separate items.

**Schema:** owned item ID/revision/home context; catalogue food ID and catalogue revision or explicit custom identity; guide/evidence taxonomy version; user label (80); origin `store|homegrown|caught|unknown`; storage `fridge|pantry|freezer`; optional question (500); created/updated time; separately consented typed sample links. A standalone food question/note is a distinct record kind with required question; do not overload inventory identity or require a question to add food. A label edit cannot silently retag its canonical identity, species or study match.

**Proposed operations:** `GET /api/foods?q=...` and detail (a static shipped catalogue can supply this equivalently); `/api/kitchen/items` CRUD; per-item evidence projection; optional `/api/foods/:id/evidence`; typed owned sample-link operations only after H06 food sample contract exists. Public catalogue identity and private inventory identity are different IDs. Search calls must not expose saved private item labels/question text to public source providers.

**Per-item result:** return item identity/revision, independent PFAS/lead coverage/status/reason, separate study and notice matches with evidence revisions, matching rule/version, match level, missing identity fields, sample/collection/publication dates and limitations. Default item concentration remains unknown. Historical species/food-category study ranges cannot be copied into a user's item's concentration. An authorized exact food sample or genuinely exact reviewed product/lot measurement is required for any item-specific value. A question with a linked laboratory report is not such matching authorization.

The four currently bundled numerical food findings are historical FDA study data, not a live comprehensive contamination database: tuna PFOS, farmed Atlantic salmon PFDoA from 2021-22 seafood work; whole-milk and raw-spinach lead from 2018-20 Total Diet Study. Keep their named compounds, detection limits, sample counts and actual source periods. No model may generate missing concentrations for other catalogue foods. Food at home deliberately uses illustrations only, not meal-photo recognition.

**Acceptance:** known/custom name and alias, duplicate items, storage edits, label changes without evidence retag, foreign inventory, unknown item concentrations beside study evidence, PFOS versus total PFAS, non-detect not zero, species/form/raw/cooked/farmed/wild/composite mismatches, missing/withdrawn study, exact-lot mismatch, mismatched/foreign food report, canonical follow-up and removed-origin behavior, deletion/export coverage and no ingestion/score inference.

#### F02. Fish and waterway advisories

**Executable:** `FoodFish.tsx`, `FoodExtent.tsx`, `FoodShared.tsx`. Actions: search/disambiguate waterbody/county; select species and advisory audience; inspect statewide plus local scopes, rule details, source/version and original extent; clear search/selection; bookmark/follow; copy/download public reference; open official source; explicit follow-up; create/edit/delete/export private catch/consumption notes; inspect correction history. Search filtering must not leave a hidden selected waterbody masquerading as the active query.

**Current truth:** sample Willow-waterbody advisory and audience/rule displays are review data, not verified local advice. There is no complete new production fish-rule matching service in the reviewed backend. Do not deploy fictional rule text as a live advisory.

**Public schema/operations:** proposed `/api/fish/waterbodies`, `/species`, `/audiences`, `/advisories` matched query and detail/history. Source record needs issuer, official URL and revision/hash, published/effective/withdrawn dates, geometry/extent and boundary description, statewide/segment relation, exact species/grouping, contaminants, audience definition, serving/meal/time definitions, exceptions, coexistence/conflict rules and reviewer/method version. Return original rule plus qualified interpretation and match evidence. Same-name waterbodies in different counties require disambiguation. Unknown audience/species/boundary remains unknown rather than selecting a permissive rule. Review local and statewide overlaps before a simplified recommendation. Current seven household flags cannot automatically select a clinical advisory audience.

**Private note schema:** owned ID/revision/context/title; kind `catch|consumption`; calendar date and IANA timezone; optional waterbody ID/original label; species ID/label; original positive quantity and unit; private note; advisory ID/revision/context snapshot; prior values and correction reason/time. Preserve multiple legitimate records on the same date. Do not invent consumption from a saved advisory or catch note. Proposed `/api/fish-notes` CRUD/history/export; original advisory version stays attached after a source update.

**Acceptance:** ambiguous waterbody, geometry edges, statewide/local conflict, unknown species/audience, missing and withdrawn source, advisory unavailable not safe, altered query clears old selection, source follow separate from bookmark, date/positive quantity validation, note correction history and exact export, no allowance-remaining/dose calculation without a separately validated serving/time model, no private note in public share/source query.

#### F03. Home garden contexts and tests

**Executable:** `FoodGarden.tsx`. Actions: create/open/edit/delete site; select setup/irrigation and optional county; explicitly confirm reuse of household water source; record soil history, concerns/questions; link/unlink eligible owned reports; inspect original context; prepare a new test from the site; open grower resources; export a selected site brief; save a separate follow-up. Labels may duplicate and are not identity.

**Schema:** owned site ID/revision/home context, title, setup `container|raised_bed|in_ground|other|unknown` (normalize exact UI values), coarse location/county optional, irrigation `unknown|household|separate_utility|well|rain|surface|other`, explicit household-source-reuse confirmation, separate source ID/details where known, soil history/context, concerns, questions, test relationship records and context history. Capture an immutable context snapshot/revision at sample collection. History of soil/irrigation changes must never relabel older test matrices or current report meaning.

**Proposed operations:** `/api/garden-sites` CRUD; `/:id/test-links` authorized revisioned link/unlink; history/brief snapshot as needed; common test-creation/action operations. A test created for a site has a primary historical association that cannot be removed as though it never occurred. A secondary link can be unlinked without deleting the report. Test IDs must have same owner and relevant context; linking a water test does not transform it into a soil or edible-tissue assay.

Garden deletion removes selected site-private data but retains independent tests with minimum immutable collection context and independent actions/inquiries. Do not reassign an old garden to a new current home. A site brief includes only selected context/questions/test references, not all account data or original private files by accident. Fertility testing and contaminant testing are different services; county data, facilities, rainfall or irrigation assumptions cannot establish crop safety.

**Acceptance:** separate versus household irrigation, unchecked reuse, soil/irrigation edit after test collection, primary versus secondary link removal, foreign/missing report, ambiguous report context, draft test creation with no invented result, duplicate site labels, deletion with retained historical tests, exact selected brief export, unknown source and no unsupported crop-safety/uptake model.

#### F04. Public food studies/notices and private questions

**Executable:** `FoodEvidence.tsx`, `PublishedFoodEvidence.tsx`, `food-evidence.ts`. Actions: place/category/type filters; Notice/Study selection; detail/source/sample-scope/lifecycle/revision view; bookmark/follow; share reference; prepare/save/edit/delete a private question; optional owned report reference and private note; explicit follow-up. Saving a question does not send it to an issuer or certify an attached assay matches the food.

**Public study schema:** issuer, source identity/URL/file hash/table-row locator/revision, publication and collection periods separately, review status, original food description and justified normalization, species/form/preparation/origin/region, sample IDs/design/composite versus individual, matrix/basis/method; analytical rows with named compound/lead, original value/unit, parsed numeric when valid, qualifier and detection/reporting limits/type; aggregate included sample IDs, total/detected/ND counts, statistic method/version and censoring handling. No average under an unstated ND-as-zero rule. A study category is not every brand/lot/user's saved food.

**Notice schema:** issuer, source/recall/event number, lifecycle/classification, exact product and lot/code, reason, distribution scope versus issuer address, relevant dates, withdrawal/termination, current version and official action. openFDA/agency query successful empty versus failure is explicit. Keyword search is not exhaustive geographic matching. An issuer's state is not the product's distribution geography; a terminated recall does not demonstrate the food is safe.

**Proposed operations:** `/api/food-evidence` filtered bounded list, `/:id` and revisions; `/api/food-questions` CRUD/history/export; common bookmarks and source follows. Private question fields: ID/owner/context/revision/title, evidence ID **and revision**, question, optional private note, optional authorized report ID. Existing preview type only holding an evidence ID must be extended for durable revision binding. A report's transcription/review state stays visible. Delete question leaves the public source/report/bookmark/independent action intact.

**Acquisition:** use official FDA downloadable sources and vetted source manifests, not LLM-only search summaries or scraped anonymous citations. Validate checksum, tables, units and parse coverage before publishing a changed release; quarantine malformed source formats. Current historical findings are a starting reviewed library, not real-time enrichment for every food. Water-mass concentration, wet/dry food-mass concentration, raw/cooked forms and sampling designs are not interchangeable.

**Acceptance:** malformed source file, duplicate/corrected release, source revision change invalidates match not old export, date and sample denominators, named PFAS versus summed measure, censored values, mass/volume mismatch, food/form/species mismatch, unavailable versus no matches, withdrawn/terminated notice, exact lot/distribution match, private question edit/delete with stale version, report same-owner gate, safe public export and no fabricated current item measurement.

#### F05. Grower sampling and conservation support

**Executable:** `FoodGrower.tsx`. Actions: filter concern/region; inspect resource; compare up to two resource scopes; review preparation checklist; choose optional garden/report; prepare/edit inquiry; record contacted/submitted/response/paused/closed status; date/reference/response/follow-up; resume; export/delete; open official website; explicit My Week follow-up; prepare a test from selected site.

**Public resource schema:** stable ID/version, official organization/name/URL, service geography, relevant concerns, service/sample types, eligibility, submission/contact methods, required preparation checklist IDs/revision, cost with date or explicit unknown, access/language information when known, validity/last link check and separate human verification. Current reviewed resources include Extension, NC soil fertility service, certified drinking-water laboratory lists and NRCS activity information. These links are not submission APIs, confirmed appointments, partner certifications, paid bookings or eligibility approvals. Fertility testing is not a universal contaminant screen.

**Private inquiry schema:** owned ID/revision/context/title; resource ID/version and checklist snapshot, optional site/test IDs; selected checklist IDs, questions; state `preparing|contacted_awaiting|submitted_by_user|response_received|paused|closed`; contact date; optional follow-up date/reference/response; revision history. Distinguish response text entered by the user from verified provider delivery/webhooks. Current UI restricts report selection to user-confirmed transcription; preserve that requirement without calling the report independently lab-verified.

**Proposed operations:** `/api/grower-resources` list/detail (editorially maintained public content acceptable); `/api/grower-inquiries` CRUD/state history; common action service. The current preview effectively keeps one inquiry per resource. Decide explicitly whether production permits multiple episodes; if yes, each has its own inquiry ID and follow-up origin. Never deduplicate all future inquiries by public resource ID. Date validation requires a real contact date where the state calls for one and follow-up not before contact. Opening the official website transmits no private answers/files and changes no inquiry status.

**Acceptance:** unknown costs/eligibility/access stay unknown, withdrawn resource, changed checklist while editing, foreign or unconfirmed report, removed site retains meaningful original context, two legitimate inquiry episodes, user-reported submission not agency receipt, official-link cancellation, follow-up/history date validation, export selected content and deletion without harming test/site/public source.

#### F06. Water stewardship, drought, utility notices and use records

**Executable:** `FoodWater.tsx`, `home-food-preview.ts`, `FoodShared.tsx`. Actions: select county/release, inspect drought category/distribution/extent and comparable previous release where actually available; inspect independently sourced utility notice and official restrictions; bookmark/follow/share; enter meter or interval use; edit with correction reason; inspect history; compare two compatible readings/periods; export/delete; save bill/leak-check follow-up; open maintenance. Actual drought/utility live data are not integrated by the current unavailable fixtures.

**Public schema:** drought issuer/source/release ID, issue/valid date, county geometry/version, category and denominator semantics, percentage/count/coverage, method and prior comparable release. County area distribution is not a single household reading or county maximum as a home class. Point classification requires the correct dated source geometry. Utility notice has its own issuer, matched PWS/service geography, status, publication/effective/expiry dates, voluntary/mandatory distinction, actual rule text/exemptions, update/withdrawal and official detail. Unmatched utility, no active notice, unavailable acquisition and stale notice are different states. Drought never automatically proves a utility watering restriction.

**Private usage schema:** owned ID/revision/context/title; kind `interval|meter`; site and optional meter identity; start/end date; original quantity/unit; basis `measured|estimated|user_reported`; source; reset/rollover flag; note; append correction history with original start/end/quantity/unit/source and required reason. Units supported in the wireframe: US gallons, litres, cubic metres, cubic feet and CCF. Preserve actual unit; zero is a valid reading. Interval start is inclusive and end exclusive. Meter reading semantics need an actual reading date/instant and ordered pair. Do not pretend a meter's cumulative absolute reading is interval use.

**Comparison:** current preview requires same kind/site/meter/source/unit, measured basis, no reset/rollover. Interval pairs need equal positive duration without overlap; gaps are disclosed. Meter pairs need distinct ordered dates and nondecreasing readings; decreasing values require reset/rollover handling, not negative use. Any future unit conversion needs an explicit method and original values. A difference is a recorded-use difference, not savings attributable to HALO, irrigation demand, cost or environmental benefit.

**Proposed operations:** `/api/water-stewardship` source query/detail/history, `/api/water-usage` CRUD/history, comparison over authorized versioned inputs, common public bookmark/subscription and action services. Edits require correction reason and concurrency control. Follow a source only when there is a supported genuine source/version baseline; do not promise notifications for unavailable demo data.

**Acceptance:** county boundary/version, overlapping drought categories and denominator explanation, stale/absent/unmatched utility notice, restrictions not inferred, leap/unequal/overlapping intervals, zero versus missing, unit mismatch, meter reset/decrease/source change, corrected/exported originals, legitimate duplicates, no automatic task from a historical measurement date, source follow lifecycle and no claimed savings/benefit.

### Bookmarks, watches, actions and removal across these features

`FoodShared.tsx` demonstrates separate `saved` and `following` flags for fish, food, water and resource references. Implement them as independently owned bookmark/subscription relations with stable public source ID and baseline revision. Removing a bookmark must not silently cancel a follow, and unfollowing must not delete a saved source or private record. Watch availability is an actual capability: source missing, unsupported updates, provider retention expiry and notification opt-out must be explicit. Source changes yield idempotent affected-source events with version and change type; repeated ingestion cannot spam the user. Notification delivery/retries/unsubscribe and My Week reminder transport belong to the shared services, not a private per-component timer.

Public copy/download share payload must be the same canonical source/version/scope reference, with title, dates, official link and limitations. Do not include private record IDs, home coordinates, kitchen content, notes, tokens or preview-only URLs. A source reference can retain an official public advisory geometry if licensed; that is different from a household location.

Deletion matrix to implement transactionally and test with the global deletion/export service:

| Removed object | Remove/cancel | Preserve independently owned work |
| --- | --- | --- |
| Test | Selected private test rows/corrections/exclusive attachments and test-owned jobs | Independent action, garden, routine and inquiry with a minimal removed-origin state; no sensitive deleted-result copy in tombstone |
| Routine | Selected private routine history, future recurrence/occurrences/reminders owned by it | Separate test, standalone moisture observation and explicit independent action |
| Moisture observation | Private note/photo/orphan derivatives/history according to policy | Linked routine/test and separate action; never mark repair complete |
| Kitchen item/note | Private item/question fields and only item-owned watches | Public catalogue/evidence and independent action; general source follows retained unless selected |
| Garden | Selected private site fields/history and site-owned jobs | Tests' minimum original collection context, independent inquiries/actions; no reassignment to new home |
| Fish note | Selected private note and corrections | Public advisory/bookmark/follow and independent action |
| Evidence question | Private question and owned derivatives | Public evidence, linked report, bookmark and independent action |
| Grower inquiry | Private inquiry/history and only inquiry-owned reminders/jobs | Public resource, garden, test and independent action |
| Water-use record | Private reading/corrections and its derived comparison cache | Other readings, public notices and separate actions |
| Bookmark | Bookmark relation | Follow subscription unless explicitly selected |
| Account | Every owned row/history/object/derivative/export/subscription/job and applicable indexes | No private sensitive tombstone beyond published retention; public datasets remain public |

Use an explicit deletion response describing affected IDs, detached links and pending object cleanup. A client `filter` removing an array element is not production deletion. Hard-delete retention, immutable scientific source records and minimal collection provenance need a published data policy; do not keep deleted sensitive content indefinitely under the label “history.”

### Narrow official external-source verification performed October 13, 2026

These are documentation checks, not proof that HALO's credentials can call the APIs, not fresh live datasets and not a revalidation of every numeric historical FDA table row.

1. **EPA PFAS regulatory lifecycle:** [EPA PFAS drinking-water page](https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas), checked October 13, describes 2026 proposals involving PFOA/PFOS compliance timing and rescission of other PFAS provisions. Proposed changes must not be treated as a final effective rule. Version the applicable rule, dates and jurisdiction; obtain qualified review before changing thresholds or legal copy. Preserve the distinction between a source sample/aggregate and regulatory compliance calculations. Current hard-coded numeric limits alone are insufficient.
2. **NWS weather basis:** [NWS API documentation](https://www.weather.gov/documentation/services-web-api), checked October 13, requires identifiable requests and documents changing grid mappings, bounded forecast products and missing-data behavior. It does not authorize a blanket rule that null precipitation probability means zero. Store source periods and unknown values, refresh point mappings and use bounded request/retry policies. Weather forecast support is not an air/pollen forecast contract.
3. **Google Pollen use and retention:** [Pollen policies](https://developers.google.com/maps/documentation/pollen/policies) (page updated October 8, 2026) and [Google Maps Platform service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), checked October 13, require appropriate attribution and constrain map display/caching. New integration attribution must follow the current Google Maps requirements. Environmental risk-index use is permitted within the applicable terms, not blanket permission for any archive or export. The reviewed terms distinguish today-forecast values (up to 365 days) from other forecast/heatmap data (24 hours). Tag category/expiry at acquisition, enforce deletion and obtain rights review for historical charts, derived scores, public exports and any non-Google basemap before shipping. Do not merge Google map-overlay rights with independent provider data rights.
4. **FDA study acquisition:** [FDA PFAS food testing](https://www.fda.gov/food/process-contaminants-food/testing-food-pfas-and-assessing-dietary-exposure) and [FDA Total Diet Study results](https://www.fda.gov/food/fda-total-diet-study-tds/fda-total-diet-study-tds-results), checked October 13, provide limited historical study outputs and official download/dashboard resources. Use those published files with food keys, sampling design, preparation, units and detection limits. Dashboard availability does not establish an undocumented API contract. Material described as still under review must not be filled in by generation. There is no basis for promising a current laboratory concentration for each household food.
5. **Food notices:** [openFDA food enforcement API](https://open.fda.gov/apis/food/enforcement/) is the relevant official structured source family; provider terms, published limits, release cadence, source-field meaning and completeness must be captured in acquisition tests before activation. A discovered documentation page or successful example query is not a verified complete notice service.
6. **Radon reference:** [EPA action-level explanation](https://www.epa.gov/radon/what-epas-action-level-radon-and-what-does-it-mean), checked October 13, supports keeping official action guidance source-linked. Test method/duration, repeat-testing and interpretation policy require a reviewed workflow; do not turn a county estimate or unreviewed transcription into a personalized mitigation conclusion.

Existing source guide entries for AirNow/Open-Meteo, NC fish advisories, Extension/soil labs, drinking-water labs, NRCS, drought and utility notices still need actual owner-operated credential/access/license and representative response checks at implementation. No text in this audit claims those accounts or providers are enabled. Where structured coverage is unavailable, ship truthful unsupported/official-handoff states rather than fake values or unverified web extraction.

### Integration acceptance and evidence package for Vibhav

**Validation actually run in this audit:** `node --test test/frontend-home-tests.test.mjs test/frontend-home-maintenance.test.mjs test/frontend-home-food.test.mjs test/frontend-food-pfas.test.mjs test/frontend-food-evidence.test.mjs test/frontend-household-pdf.test.mjs test/frontend-stage-api.test.mjs test/frontend-stage-data.test.mjs` completed October 13 with **66 passed, 0 failed, 0 skipped**. These tests exercise current local validators, original-value semantics, strict comparisons, recurrence, source separation, PDF creation/pagination/cancel, safe source URLs and live-adapter fixtures. They do not exercise a deployed expanded backend, production RLS, provider credentials, durable storage or delivery. Relevant existing browser suites include `test/ui/home-tests.spec.ts`, `home-test-timeline.spec.ts`, `home-maintenance-summary.spec.ts`, `home-summary-pdf.spec.ts`, `home-food.spec.ts`, `home-food-evidence.spec.ts`, `home-pantry.spec.ts`, `home-list-delete.spec.ts`, `home-workspace.spec.ts`, `home-household.spec.ts`, `stage-data.spec.ts` and `stage-evidence.spec.ts`; their presence is an executable acceptance starting point, not a claim that they were rerun by this sub-audit.

1. Add typed server schema/OpenAPI or equivalent contracts for every operation above, including enum values, nullability, max lengths, errors, pagination, versions, source rights and date semantics. Generate or validate frontend adapters against those contracts. Keep fixture adapters behind an explicit review mode, never as runtime fallback for missing authenticated data.
2. Add additive migrations, constraints, RLS policies, private buckets, storage cleanup and index/query plans. Run positive and hostile cross-owner tests on parent/child reads, mutations, linked source IDs, history, exports and signed files. Do not trust client-provided `owner_id` or a visible home-context URL.
3. Establish source acquisition jobs/manifests with licensed cache TTLs, raw immutable source revisions, normalization QA, stale/withdrawn handling, approved interpretation rules and alerts on parse/coverage regressions. Validate provider payloads instead of accepting HTTP 200 with malformed/empty content.
4. Replace memory-only write functions with injected production service adapters. Keep the existing retained draft, explicit confirm, conflict and unknown-outcome UI semantics. Test error recovery on every form; do not lose input or mislabel pending as saved.
5. Wire all eligible planned/expected/due/review/follow-up dates to canonical My Week projections. Historical report/collection/observation/usage dates remain historical unless deliberately scheduled. Prove an origin edit/delete/reminder cancel is consistent across source page, My Week, Settings export and Luna tool view.
6. Version-bound Luna tools may use these same domain commands with exact target/scope and explicit required approval. Do not implement a privileged AI-only mutation path, blindly execute source text, expose private documents by default, or label deterministic PDF work as model processing. Read-only explanations cite the exact dated evidence and disclose missing facts.
7. Run deterministic contract/integration tests for every T/H/F acceptance set above; service-failure, concurrent revision, timeout/unknown outcome, offline, context change, stale provider, unsupported geography, DST, all-null/zero and large paginated data cases. Validate end-to-end in an isolated test environment with real RLS and fake/injected providers, then separately perform authorized provider smoke checks with no private content.
8. Produce an acceptance receipt listing migration IDs, test commands/results, provider configuration names (never secret values), redacted representative payloads, source-revision manifests, score-policy decision, remaining unsupported capabilities and deployment rollback/restore checks. An attractive preview, passing typecheck or source route inventory is not evidence that every workflow is integrated.

### Most consequential release blockers from this audit

- Expanded private services and public evidence source contracts are largely absent from the verified backend branch, despite working local UI flows.
- Resolve the private-water composite contract conflict explicitly; until then preserve backend null behavior and correct unsupported “nobody tested” copy.
- Retain home-context and provenance through acquisition, caching, history parsing, scores, exports and cross-app projections. In-flight old-home results must never become current new-home data.
- Publish complete source freshness/method/rights envelopes; do not turn missing weather into benign weather, history into comparable points, proposals into final regulations, density into air pollution or studies into household measurements.
- Build the H06 food/tissue sample-and-link contract before exposing exact inventory-item concentration. Four reviewed historical findings are not a general live food chemistry feed.
- Implement canonical tasks/occurrences/source watches once, with idempotency, revision conflicts, accurate date semantics and full deletion/export/file lifecycle coverage. None of these is delivered by memory-provider sample actions.

## 12. Explore, Map, Luna and source operations contracts

Audited October 13, 2026. Existing partial services, required repairs and new capabilities are separated below. No provider action or production integration is implied.

### Evidence and interpretation of status

Primary requirements inspected: `AGENTS.md`, `docs/foundation/WIREFRAME_COMPLETION_MATRIX.md`, `docs/continuation/WIREFRAME_COMPLETION_RECEIPT.md`, relevant complete A01-A06/M01-M05/X02/X07 sections of `HALO_MASTER_PLAN.md`, matching screen/forms/data lifecycle sections of `HALO_FRONTEND_BUILD_PLAN.md`, matching acceptance rows in `HALO_FEATURE_ACCEPTANCE.md`, and common evidence/schema/transaction/jobs/privacy requirements in `HALO_BACKEND_AND_DATA_PLAN.md`. Latest scope is in `components/expanded/EXPLORE_REVIEW.md`, `EXPLORE_BACKEND_DELTA.md`, `docs/foundation/LUNA_COMPLETION_REVIEW.md`, `MAP_COMPLETION_REVIEW.md`, `SOURCE_OPERATIONS_REVIEW.md`, and `docs/map/README.md`. Later user decisions supersede old statements excluding current events, email, broad Luna, and personalized projects.

Source inspection includes `components/expanded/ExploreWorkspace.tsx`, `ExploreDiscovery.tsx`, `ExploreOpportunities.tsx`, `ExploreVolunteer.tsx`, `ExploreProjects.tsx`, `ExploreOutreach.tsx`, `ExploreNotes.tsx`, `ExploreOutcome.tsx`, `ExploreShared.tsx`, `NoteHandoff.tsx`, `MapRecordToExplore.tsx`, `LunaConversation.tsx`; `components/map-preview/*`; `SourceOperationsReview.tsx`; matching `lib/frontend/explore-*`, `luna-*`, `note-*`, `map-*`, `source-operations-preview.ts`; `lib/frontend/stage-api.ts`; current and backend-branch `app/api/{assistant,volunteer,map,district}/route.js`; `lib/assistant{,Rag,Context,ContextData}.js`, `map{Build,Data,Layers}.js`, `districtView.js`, `volunteerMatch.js`, and source migrations. Existing frontend and backend unit/browser test assertions were inspected as regression requirements. Test files are evidence of simulated behavior, not evidence that a live provider succeeds.

Status vocabulary: **Existing** means production source exists in the inspected branch; **Partial** means useful source exists but does not fulfill the final feature; **New** means only frontend demonstration/requirements exist. None means independently verified deployed service.

| Domain | Existing backend source | Final capability status and mandatory delta |
| --- | --- | --- |
| A01 Explore hub | Household assessment, organization directory, map/district reads | Partial. No authenticated joined continuation/preferences/project-generation/participation service. Public browsing must stay separate from owned context. |
| A02 organizations | `/api/volunteer`, `volunteer_orgs`, `matchOrgs` county/cause matching | Partial. Extend stable identity, contacts, service geometry, verification, archive, pagination and reported-outdated review. Fixes already on backend branch must be adopted, not rebuilt. |
| A03 upcoming and rolling opportunities | Organization directory only | New. No real opportunity feed, venue geocoding, schedule/capacity revisions, participation storage or event-change matching. |
| A04 personalized practical projects | Older `lib/actionPlan.js` home-protection advice | New. Nineteen frontend guides and deterministic 12-idea selection are not retrieval, generation, versioned public templates or durable project instances. |
| A05 contact discovery and email | Existing public household/map/district evidence | New. No authoritative public-contact resolver, independent durable drafts, provider OAuth/send service or operation reconciliation. |
| A06 notebook/field observations | Frontend memory collections and raster processing | New. No private note/case/attachment/handoff/history database/storage API. |
| M01-M03 layers | `/api/map`, cached `map_layers`, UCMR5/radon/ECHO/AirNow parsers/geography | Partial. Authenticated regional layer transport exists. Final public capability, normalization, retained stale responses, data completeness, parser fixes and renderer integration are missing. |
| M04 comparison | Existing layer values/dates/IDs | New normalized comparison contract; source-method-period/qualifier/release metadata in frontend comparison is authored review metadata, never production default. |
| M05 district evidence | `/api/district`, `districtView.js`, NC-08 boundary and aggregates | Partial. Fix completeness and denominator interpretation, verify boundary applicability, separate public aggregate from private county context, add reviewed public brief manifest. |
| X02 Luna | `/api/assistant` single question/page, diagnostic guard, curated pgvector retrieval, provider composition | Partial. No conversations, selected-context capability, streaming, action proposals/tool execution, durable operation ledger, or live project/web workflows. |
| X07 source operations | Scripts/caches/cron and service-role source writes | New protected operator workflow, roles, immutable releases, quarantine, review/publish/withdraw/translation and audited job control. |

### Verified backend branch differences and defects to resolve first

1. **Already addressed on backend branch:** `app/api/volunteer/route.js` validates county and causes and returns `unavailable: true, reason: 'directory_unavailable'` on failed directory read. It deliberately retains HTTP 200 for legacy shape compatibility. Frontend must honor the unavailable flag instead of treating `orgs: []` as a successful no-match. Profile-read failure is now an error rather than an all-county fallback. HEAD still has the older silent-empty behavior. Preserve backend branch hardening on integration.
2. **Already addressed on backend branch:** assistant request/body/control-character validation, request IDs and safe error envelopes; map layer/quarter validation and standardized unavailable response. These are useful base fixes, not the new services.
3. **Assistant privacy gap, both versions:** `ASSISTANT_SEND_HOUSEHOLD_CONTEXT !== 'false'` enables private context by default, despite a comment describing a safer default. `gatherHouseholdContext` loads Today, Homeguard and Journal aggregates regardless of selected fields. GET suggestions does not return the `sends_household_context` field the stage parser can accept. A post-response `uses_household_data: false` does not show whether private context was sent. Add authoritative effective capabilities before the request and explicit consent/context restrictions enforced before provider processing. Settings context revocation must take effect immediately on server-side reads and confirmations.
4. **Assistant evidence gap:** `assistantContext.js` says "no regulated contaminant above its limit" when a utility exists without a worst row, conflating missing or unscoreable records with a reassuring result. Water facts omit actual sample dates while claiming "most recently measured". Replace string assembly with typed evidence and source-specific no-data states; do not recompute stale/partial context independently of canonical Today/Homeguard adapters. Wording that no agency tests private water needs qualified content review; no source result must not assert that nobody has ever tested it.
5. **Assistant provider/retrieval gap:** `answerQuestion` treats a citation marker as grounding; markers do not prove that a claim follows from a source. Add evidence binding, claim-support evaluations and output schema validation. Existing prompt instructions are not a tool authorization boundary. `assistantRag.js` defaults embeddings to 1536 but has a comment referring to a 2048 migration: verify effective provider model, vector column and RPC dimensions at startup/deployment, and rebuild corpus if changing models. Embedding values must all be finite. Provider calls need explicit deadlines/abort support, bounded output/context, retry/cost controls, safe diagnostics, source withdrawal filtering and corpus-version tracking.
6. **Map completeness gap:** `mapBuild.loadUtilities` has `.limit(2000)` without a continuation/completeness marker. Page through the full intended source or explicitly label partial output and suppress aggregate/rank claims requiring completeness. No hard cap can silently become statewide coverage. Same principle applies to source jobs and every paginated provider.
7. **Map stale fallback gap:** `readLayer` discards cache older than 36 hours; after failed cold rebuild `/api/map` returns unavailable and cannot return dated last-valid data. Introduce per-source freshness/read results with `fresh|stale|unavailable`, retain dated stale data with reason and next retry, and use single-flight background rebuilds. A single 36-hour threshold is unsuitable for hourly air and historical water. A malformed cached date must not accidentally be accepted as fresh.
8. **Map parser gap:** `parseEchoFacility` drops rows lacking coordinates and converts absent quarters/penalties to zero. Preserve unlocated records in accessible result data and preserve missing numeric fields as null. `fetchFacilities` silently continues missing query IDs and missing Facilities arrays, which can publish a partial/empty layer as success. Validate every page, expected counts and completion before publishing. Array/payload errors cannot become a zero-problem map.
9. **Air parser gap:** reject nonfinite AQI and malformed/out-of-range coordinates and dates; explicitly distinguish missing pollutant/time. Existing per-site worst-pollutant/latest-hour collapse must carry which pollutant and hour were selected, available pollutants and completeness. A monitor is not a model cell or a home reading.
10. **Hazard index gap:** `hazardIndex` combines each compound's latest value without enforcing common sample/site/method/date. Do not present this as a measured mixture or compliance statistic. Bind the reviewed method to compatible measurements and actual components or return unavailable/incompatible. Regulatory flags and limits require authoritative current review; hard-coded `proposed_for_rescission: true` is not current legal authority.
11. **District ranking gap:** population-weighted county ranking includes mapped populations regardless of complete eligible measurement coverage, and uses centroid assignment. Reconcile supported tested/located/population denominators, overlapping service populations and unknown population before exposing a rank. Keep unranked distinct from best and avoid implying people served are exposed people. District vs statewide samples must share method/version and explicitly differ in geography only.
12. **Preview shortcuts not production schema:** project instances are keyed by guide ID and step index, opportunities embed source facts in preparation prose, histories sometimes lack instants, notes can accept a browser-normalized invalid civil date, and outreach uses a local JSON message signature as a send ledger. Replace each with stable IDs/typed relations/strict server validation and durable histories rather than copying these review shortcuts into production.

Read-only local diagnostic evidence: pure imports of `parseEchoFacility`, `parseAirNowStations` and `hazardIndex` (no database/provider requests or writes) confirmed missing facility numbers become zero, unlocated facilities become null, a station with latitude999/nonfinite AQI/invalid UTC survives parsing, and compound values six years apart combine into an above-limit hazard index. Nonfinite AQI serializes to JSON null, which can further conceal invalid source data. These checks support the parser defects above; they are not an end-to-end provider validation or a test-suite pass.

### A01-A03: Explore location, organizations, opportunities and participation

#### Complete interaction mapping

| Visible action/workflow | Required backend support and effect |
| --- | --- |
| Open Explore/Get involved/Projects/map preview, return to saved work | Independent capability/read responses; owned continuation query for active projects, commitments and open cases; exact origin/action IDs. Empty states never seed demo records. UI tabs/disclosures and navigation need no write. |
| Choose/change/clear area, cancel area edit | Typed place lookup (city/county/ZIP; optional device location) with candidate choice, geography ID, country/state and source. Save only on explicit apply; clear removes exploration preference but not account home or saved history. Public browse area and private current home are distinct scopes. |
| Search/filter organizations and events; broaden/reset filters | Bounded query, cause, timing, area/service geography, optional supported radius/date range, cursor, source coverage and count basis. Client filtering is sufficient only over an explicitly complete bounded response. No home risk requirement for general browsing. |
| Refresh listings | Actual source revalidation or cache refresh job receipt with last successful check, partial/unavailable/rate-limited/unchanged results. Current 850ms frontend timer must be removed as data authority. |
| View opportunity/program/organization | Source-derived essentials, requirements, official next step, source date and status. Organization office address is not an event meeting point. Preparation/safety/access facts retain unknowns and provenance. |
| Open official website/registration/map directions | Public safe URL with no private data appended. Optional owned opened event records intent only. External navigation never marks registration, attendance, acceptance or an agency receipt. |
| Keep an opportunity I found / plan participation | Create owned commitment from source revision or manual entry, protect existing draft from silent replacement, retain original verified facts separately from user edits, nullable schedule for rolling opportunity. |
| Preparation checklist and private access questions | Owned draft/record with explicit persistence policy; no implicit message to organizer or disclosure of disability/household data. |
| Save contact, preparation, step or follow-up in My Week | Idempotent shared action with stable typed origin. Repeated click returns canonical action and retains edited title/date/state. No duplicate calendar copy. |
| Update commitment, record contacted/confirmed by me/participated/follow-up/closed, reopen | Revision-bound participation transition and immutable event history. Record actual self-reported date, optional hours and outcome; user confirmation is not organizer confirmation. |
| Upcoming event cancelled/full/postponed/time changed/expired | Versioned source event; flag existing commitment and linked action for review. Do not silently move schedules, delete history, claim registration cancelled, or notify without authorized watch/channel. |
| Filter active/closed/all; edit/delete commitment | Owner-scoped list/patch/delete; preserve independent My Week actions with missing-origin label, cancel only source-specific watches when relevant. Deletion does not cancel registration with the organizer. |
| Export participation record | Exact owned allowlist snapshot with self-reported status/date/hours/result; no preparation/access/private place unless explicitly selected. Local file/share controls can remain client-side. |
| Report outdated listing / keep private review note | These are different operations. Current button only keeps a private note; support that truthfully. Master-plan "report outdated" requires a private authenticated moderation intake, source ID/revision, bounded reason, dedupe, receipt, abuse controls, staff triage; never a public accusation or organizer email. |
| Understand your community factor choice; keep question; record result; follow up | Reviewed topic content/version and sources, public factor/layer routes, typed owned topic case/outcome/history and canonical follow-up task. Reading is not progress/result. |

#### Public domain records

Use ownerless published reference data separate from private account rows. All entities carry stable ID, revision, created/updated timestamps and status; source metadata follows the common evidence contract.

- `places`: provider namespace/place ID, formatted label, country/state/county/municipality/ZIP codes, coarse centroid/bounds or service geometry, timezone, geographic precision, association method, coverage/ambiguity, provider rights/retention. A location query does not prove residence or eligibility. Return multiple candidates for ambiguous names; never use a Charlotte alias table for national lookup.
- `organizations` (extend `volunteer_orgs`): mission/work summary, official name/URLs, cause tags, actual served geometry/jurisdictions, program IDs, typed contacts, address purpose (`office|mailing|meeting|service-area|unknown`), accessibility details and source, `link_checked_at` separate from `human_verified_at/by`, verification evidence, archived/closed status and replacement link if known. Current unique name constraint should not serve as identity; multi-branch organizations may share names.
- `programs`: organizer ID, rolling/recurring nature, eligibility, geography, work, join steps, prerequisites/waivers/supervision, equipment, cost/unknown, accessibility/unknown, safety, official URL, source release/version and review expiry. Program participation is not an event booking.
- `opportunities` and immutable `opportunity_revisions`: organizer/program, title, summary, actual tasks, cause, `scheduled|rolling|recurring`, starts/ends instants, IANA venue timezone, timezone basis (`source|inferred`), all-day/date-only where appropriate, rolling window, recurrence exceptions, venue name/address/geography/address purpose, optional coordinates/distance basis, duration, fee amount/currency/free/unknown, age requirements, supervision/waiver, accessibility/adapted-task availability/unknown, equipment/preparation/safety, official detail/registration URLs, capacity/full status only when reported, registration deadline, cancellation/postponement/date-change state, source first/last seen/checked times, data expiry, archival reason and version.
- `opportunity_source_runs`: source registry ID, fetch/publication/observed times, release/content hash, parser revision, pages expected/read, accepted/rejected counts, last complete checkpoint, safe failure class and coverage. Store scraped/structured records only within permitted reuse; raw HTML is untrusted.

#### Private participation and learning records

- `participations`: owner, optional home context for the match snapshot, `opportunity_id/revision` or manual source, user title/organizer/URL/cause/private place, original schedule snapshot, user chosen date/time/zone, status, status-date, participated date, optional decimal hours plus `user_reported` basis, preparation/access questions, result, reference, check-back date, revision, linked canonical preparation/follow-up action IDs, archive/deleted state.
- `participation_events`: immutable event ID/actor/instant, reported occurrence date, prior/new state, result/reference, source revision, idempotency identity. Model `saved`, `registration_opened`, `user_reports_registered`, `user_reports_attended`, `user_reports_not_attended`, `contacted`, `follow_up`, `closed` separately; frontend labels may group them. Official confirmation requires a typed verified provider receipt.
- `community_cases`: owner, subject kind (`community-topic|organization|outreach|note|project-review`), source/owned origin, desired answer/goal <=500, state (`open|working|waiting|result_recorded|closed_without_result`), actual update date, result <=2000, reference <=160, next step <=1000, check-back date, history and canonical task. Case deletion follows origin policy; unrelated shared tasks remain.
- `listing_review_reports`: owner, organization/opportunity ID and captured revision, selected issue, reason <=500, private submitted/triaged/resolved state. A distinct `private_listing_note` requires no staff intake or submitted claim.

Validation preserves zero hours and unknown cost/access. Current commitment limits: title/organizer/place/reference160, URL1000, preparation/result2000, hours0..1000. Production needs explicit decimal precision and bounds reviewed for longer-running programs, not silent coercion. Reported activity/result dates cannot be future instants in the declared zone; planned dates can be future. `confirmed by me` remains a dated user assertion. Canonical action schedule updates are reviewed separately from factual attendance updates.

#### Proposed service operations

Paths are proposed contracts, not a demand to replace compatible existing routing. Owner is always derived from session; all writes follow shared revision/idempotency/error rules.

- `GET /api/places?q=&kind=&country=` returns `{candidates, coverage, provider, request_id}`; location selection and preference PATCH stores chosen public place ID and precision, not arbitrary trust of client geocoding.
- Extend `GET /api/volunteer` or introduce `GET /api/organizations?place_id=&causes=&q=&cursor=` plus detail, related programs and outdated-report POST.
- `GET /api/opportunities?place_id=&causes=&timing=&from=&to=&radius=&cursor=`; detail includes authoritative current revision; `POST /api/opportunity-refreshes` with request key and GET status if asynchronous. Radius unsupported must be explicit, never guessed travel time.
- `GET/POST /api/participations`; `GET/PATCH/DELETE /api/participations/:id`; `POST .../:id/events`; `POST .../:id/prepare-action` and `.../followup-action` can use central action service with typed origin.
- `GET/POST/PATCH/DELETE /api/community-cases`; append updates as immutable events; scoped local export manifest/read.
- Shared preferences, subscriptions and joined My Week feed carry canonical IDs; match/event publication creates change intent with source revision and dedupe key.

#### Acceptance cases for A01-A03

Actual new account without a home can browse public information without private fixture leakage. Unsupported/non-US area returns honest coverage with usable official finder, not local Charlotte suggestions. Ambiguous town requires selection. Changing area invalidates old nearby query; saved prior commitments remain. Database failure differs from no matching organizations. Scheduled events disappear from primary discovery at start, rolling remains eligible only within real active/review window. Missing/timezone-inferred dates are labelled and cannot silently schedule a wrong instant. Full/cancelled/postponed events cannot be presented as joinable; existing commitments retain their history. One failed source/page does not mean full successful search. Save + duplicate/retry yields one action; concurrent source change produces review. Opening registration does not confirm registration. Hours0 preserved, future attendance rejected, required participation result enforced, deletion leaves independent task. Private export excludes access questions/place by default. One household cannot access another's participation/case/report by UUID.

### A04: source-backed tailored project generation and ongoing projects

#### Control-to-contract inventory

- Projects entrance/lead/alternatives/full list/"See all": read the same active generation batch across Explore and Luna. Do not generate a new paid batch merely because the component remounts.
- Search/focus within current set: local full-set filtering or explicitly paginated query; preserve active batch and started projects. "Show all" deliberately broadens filters, not unnoticed profile edits.
- "Make these fit me": draft preferences for space (`any|indoors|balcony|yard|community`), solo/group, time (`any|quick|half-day|ongoing`), budget (`any|reuse|low`), count (`3|5|10..15`). Save/apply explicit preferences, cancel retains prior batch. Hard form constraints override incompatible phrasing in older requests.
- Direct interest input / generate / refine in Luna: produce source-supported ideas about current interest with minimum authorized environmental/personal context and requested count. Default full batch12; support10..15 and3/5 shortlists. A few static templates do not satisfy this requirement.
- Refresh: use seen/declined IDs or semantic families to favor novelty without violating hard constraints, safety or source support. Keep current results while preparing; fewer good fits is preferable to fabricated fill. Explicitly distinguish no relevant source, no safe eligible ideas and provider unavailable.
- Actual processing state/loading/cancel/retry: immutable request/context/preferences versions, cancellable handle, truthful queued/retrieving/validating/preparing/completed/failed/cancelled phases, latest-request acceptance, retained input/results. Cancel stops further work where possible, rejects stale delivery and records any already-incurred provider work.
- Why this idea / generation details / provenance: eligibility reason, evidence ID/revision/date/scope and source IDs; disclose general interest vs personal evidence fit, stale/missing facts and assumptions. Weather art or map density is never personalized evidence.
- Open guide/current step/full guide/materials/build plan/sources/related resources: immutable versioned guide with actionable instructions. Full instructions cannot depend on a live model response each time a saved project is reopened.
- Start project: owner-scoped instance snapshots guide revision, suitability confirmation if required, chosen goal, initial status. Multiple projects based on same guide must be possible with distinct instance IDs; task keys cannot be guide ID plus array index in production.
- Save project as one reminder vs selected individual steps: separate explicit behaviors, canonical action links, stable step IDs, one transactional reviewed bundle. Existing selected step actions retain user title/schedule/status. No automatic completion.
- Previous/next/work-on-step controls only change view/cursor; optional persistence of last viewed step is not progress. Mark complete/reopen/wait/resume updates the canonical action and recalculates project consistency.
- Save step note: private owner field <=1000, version check, never silently shared with Luna. Pause/resume preserves notes/action history; policy explains whether linked reminders pause and lets user review existing scheduled tasks.
- Whole-project completion: require relevant required steps completed and factual outcome <=2000, keep optional-step and cancelled-step semantics explicit. If a completed step is reopened/deleted, mark completion needing review; do not erase earlier completion history or fabricate benefit.
- Record outcome/follow-up/history: typed private case linked to project instance, source-versioned care guidance and canonical check-back task. Completion metrics are action counts or self-reported outputs only.

#### Project service entities and generated response

- `project_preferences`: owner, revision, explicit constraints, interests, consented context categories, geographic precision, requested count and optional disinterest dispositions. Do not infer child age, disability, private homeownership permission or tools from absence.
- `project_templates` / `project_template_revisions`: stable blueprint ID/version, publication state, cause, purpose, description, region/season applicability, suitability, prerequisites/permissions, materials with quantities/units, tools, cost/effort ranges and basis or unknown, ordered stable steps, instructions/checkpoints, hazards/supervision/maintenance/disposal, completion criteria, follow-up, claim-level source links, reviewed authors/review time, withdrawal/replacement, locale, semantic visual family and reviewed asset ID. Measured build plans bind exact source diagrams/dimensions; decorative sketches cannot serve as engineering instructions.
- `generation_requests`: owner, request ID/idempotency key, context ID/revision, preference revision, authorized selected record IDs/revisions and fields, free-text interest, requested count, prior batch/seen IDs, model/tool/retrieval/policy versions, phase, deadlines, cancellation, cost budget, failure code and completion time. Avoid logging private prompt contents.
- `project_batches` / `project_ideas`: immutable batch ID, generation version, bounded items each with stable idea ID, template/version or generated validated guide revision, title, distinct outcome, fit category, relevance explanation, evidence references, public sources with claim bindings, assumptions/missing fields, source review state, constraints/checks, semantic visual, and novelty key. Include `requested_count`, `returned_count`, fewer-results reason and actual retrieval times. The response is schema-validated before render or persistence.
- `project_instances`: owner, instance ID, chosen immutable guide revision, home/site context if relevant, personalized snapshot, goal, active/paused/completed/archived state, selected/current step IDs, factual result, review date, completion events and revision. Archived old home project survives a move without stale recommendation text becoming new-home evidence.
- `project_step_links`: unique(owner, project instance, stable step, occurrence); canonical action ID and source revision; independent notes/events. If a repeated project is deliberate, it gets a distinct instance/occurrence. A guide revision adding/reordering steps cannot repoint existing actions by array position.
- `project_source_dependencies`: specific source revision/claim/step relation, review expiry, source changes/withdrawals, affected saved instances. A withdrawal can block new suggestions and flag existing instructions for review while preserving work history.

#### Generation pipeline and safety/content requirements

1. Server derives owner/home context and loads only allowed dated evidence from canonical Today/Homeguard and selected owned records. Preserve missing vs zero, current vs historical home/site, lab vs regional vs model/proxy. Journal text and unrelated notebook contents are excluded; selected notes require fields-and-purpose consent. Search queries omit exact home address, health text and private notes unless expressly necessary/authorized.
2. Apply explicit hard suitability filters first: region/species/season, space/permission, solo/group, tools/skill, time/budget, supervision/access and safety. Renter status is not permission to change property. Context may justify a testing/contact project rather than imply a project reduces a pollutant.
3. Retrieve from permitted authoritative public sources with bounded fetches, allowlisted schemes, SSRF/private-IP/redirect protection, robots/terms/rights policy, source freshness, content hashes and attribution. Retrieved instructions are evidence, not tool commands. No direct source HTML or model-provided executable URLs reach UI unchecked.
4. Ground guide claims/steps in sources. Return practical differentiated instructions, quantities/checkpoints and ongoing care. Numeric instructions/calculations use validated deterministic functions where appropriate. Specialist or unsafe novel physical instructions require editorial gate; curate templates first and personalize vetted material rather than unrestricted dangerous builds. Regional plant recommendations need locality and site conditions, not an arbitrary NC list nationwide.
5. Validate output against schema/constraints/citations before publishing. Unsupported claims, invented references, hidden contradictions or unsafe outputs yield a useful failure/refinement state. Track source and policy revisions. User-visible progress reflects real work, never a fixed fake percentage.
6. Return stable, reusable project guides and visual IDs. Reuse 12 bundled reviewed photos from `public/explore/photo-sources.json` and `lib/frontend/explore-photos.ts` by semantic activity; no image-generation/search dependency is required for these assets. New external images need creator/license/source/modification/provenance review and a neutral failure fallback.
7. Regeneration never edits existing projects, notes, task IDs, completion or source snapshots. Home/context/preference changes invalidate active suggestion reasons and pending requests. A user can deliberately browse saved older work without relabelling it as new recommendation.

#### Proposed endpoints/jobs

`GET/PATCH /api/project-preferences`; `POST /api/project-generations` ->202 request ID; `GET /api/project-generations/:id` (or authenticated resumable event stream); `POST .../:id/cancel`; `GET /api/project-batches/:id`; `GET /api/project-guides/:id?version=`; `GET/POST /api/projects`; `GET/PATCH /api/projects/:id`; `POST /api/projects/:id/steps/review` then shared immutable proposal confirmation; `PATCH /api/projects/:id/steps/:stepId/note`; `POST /api/projects/:id/status`; project outcome/follow-up reuses case/action service. Generation, source review, source-change fanout and cleanup are bounded jobs, not additions to one long daily cron. GET never triggers unlimited paid search or new project creation. Request owner, cancellation, cross-context and per-user/global spend checks occur at every provider stage and final commit.

#### Acceptance cases

Default12 unique meaningful ideas; requested3/5/10..15 works; space/budget/solo hard constraints survive interest parsing; more than two images/families chosen semantically; novel refresh where eligible, explicit exhaustion otherwise. No-source vs unsupported interests vs provider failure distinguishable. Source-injected "delete notes" cannot execute. Missing private collections do not load fixtures. Changed home excludes old tests/gardens and public fixtures from recommendation reasons. Two concurrent generations accept only selected latest context while prior batch stays usable. Cancel, rate-limit, invalid JSON, cited unsupported claim, model timeout and page reload retain recoverable state. Started guide remains immutable after public revision. Duplicate bundle confirmation yields one canonical step per selected step; old edited task titles/status/dates persist. Partial project-start/task-save outcome is explicit and reconcilable. Completed/reopened/deleted step changes project review state without pollution/health score alteration. Whole-project completion needs factual result and real required-step status. Cross-owner instance or note access fails.

### A05: authoritative contact discovery, separate drafts and confirmed email

This is required final scope from later user requests. Older master statements excluding send do not remove the newer requirement. Sending is an explicitly confirmed, provider-connected capability; no broad administrative or inbox access is implied.

#### Every outreach control

- Topic selector, recipient class (`Utility|Landlord|Representative|Local office`), water-context branch, selected area: read needed official directory; invalidate old contact match when topic/location/water/home revision changes. Utility templates unavailable for private well/spring unless a real relevant provider is deliberately chosen.
- Find a contact: resolve minimal authorized location+need to real public staff/office jurisdiction. Return candidate name/role/organization, service area/jurisdiction, public email or form/phone/site, exact source URL, publication/check date, authority and match reason/confidence. Multiple/ambiguous/unverified/no-email/stale/unsupported/failure states require choice or official fallback. Never guess email formats, assume Gmail, or look up private landlord contact details from unrelated personal sources. Landlord remains user-entered or publicly listed property manager contact.
- Name/email manual entry and "I checked" checkbox: validate email/header safety server-side and store user-reviewed provenance separately from independently verified contact. Checkbox does not create authoritative verification. Confirmation binds current context version.
- Purpose/template/reset-current: preserve independent body/subject/contact/selections per recipient. Changing purpose does not replace writing; deliberate reset affects only that draft. Missing measurement uses information-request wording. Do not allege a legal violation from benchmark/sample comparison.
- Selected note/public evidence inclusion: snapshot only selected fields/versions; date/place/photo/other records opt-in separately. A changed/deleted note or updated source invalidates old review and requires new selection. No general account dump or silent home address/signature.
- Review outgoing message: exact sender account, recipient(s), subject, body, cited evidence, attachments, location fields and provider boundary. Editing any outgoing field invalidates approval. Current hard-coded Sept30 water paragraph must be replaced by actual evidence snapshot or omitted.
- Copy/Share/Download/Print: device operation on exact selected body/artifact, distinct from sending. Record attempted/opened/handed-off only when useful, never delivered status. Permissions/unsupported/cancel fallback preserve editable content.
- Connect/change/disconnect Gmail: real account OAuth status/scope, linked sender identity, expiry/revocation and permissions; no local boolean claiming connection.
- Review send/Confirm send/cancel: create immutable expiring send proposal then execute once with server-owned idempotency and transport ledger. Confirming from another tab after draft/context/contact/source change must reject stale proposal.
- Check attempt status: reconcile exact existing operation. Never resend automatically because request timed out or page was closed. Distinguish not submitted, submitting, provider accepted, failed before submission, unknown after possible submission; provider accepted is not recipient delivery/read/reply.
- Follow-up / record reply/result: owner records actual reply/reference/date and next step. Send-only Gmail does not import replies. Independent per-recipient case/history/task remains useful without a provider connection.

#### Data and APIs

`contact_sources`, versioned `public_contacts`, `contact_resolution_requests/results` bind topic, place/geography, utility/public office ID, applicable boundary edition, source records, candidate score reasons and expiry. Representatives require current jurisdiction boundaries and authority level, not a county guess for split districts. Utility supplier match derives verified service relation, not nearest plant/centroid. Source retrieval is private-data-minimal and SSRF protected; allow only actual published emails/forms. Avoid retaining exact lookup address after the coarse/jurisdiction result unless purpose/consent requires it.

`outreach_drafts`: owner/revision, recipient class, purpose/topic, template version, subject<=200, body<=5000, optional greeting/signature/contact fields and retention consent, area/home context version, contact ID/revision or user-entered provenance, selected immutable evidence/note field snapshots, prepared outgoing hash, timestamps and status. Draft persistence must be explicitly disclosed because text may contain private identifiers. Separate draft per contact/recipient instance, not only a global class key if several officials exist.

`provider_connections`: owner, provider account subject/verified sender, granted scopes, encrypted token references, issue/expiry/revoked state, last successful refresh, consent version. Never tokens/secrets in browser, exports, logs or URLs. OAuth return state bound to current signed-in owner, one-time CSRF state, exact registered redirect, incremental authorization, connection swap protection and reauthentication as appropriate. Request send-only scope where possible.

`outbound_messages`/`send_operations`: owner, proposal ID/version/expiry, exact sender/recipient/body/subject/attachment hashes, confirmedAt, request hash, operation ID, idempotency key, provider submission phase, attempt timestamps, provider response ID when received, safe error, unresolved reason, reconciliation metadata and final state. Server queue/outbox records intent before possible external send and marks accepted after provider response. Duplicate messages are not globally forbidden forever: an intentional later repeat requires a distinct reviewed operation, while retries of one operation reuse its identity. No background delayed resend after token restoration without valid authorization policy.

Proposed routes: `POST /api/contacts/resolve`; `GET /api/contact-lookups/:id`; `GET/POST /api/outreach/drafts`; `GET/PATCH/DELETE .../:id`; `POST .../:id/preview`; `POST /api/email-connections/start`, OAuth callback, `GET/DELETE /api/email-connections/:id`; `POST /api/outreach/send-proposals`; `POST /api/outreach/send-proposals/:id/confirm`; `GET /api/outreach/send-operations/:id`; optional cancel only before provider submission; follow-up outcomes use common case service. Attachments remain out of send scope unless explicitly implemented and selected through private file capability; current UI only text+selected note descriptions.

#### Important Gmail feasibility boundary

Google's [Gmail scope documentation](https://developers.google.com/workspace/gmail/api/auth/scopes) lists `gmail.send` as a sensitive send scope; public OAuth verification and consent setup are required. [Web-server OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server) describes server-side code/token exchange, exact redirects, refresh handling and revocation. Design HALO's own secure storage/lifecycle accordingly. These references were checked October13,2026; production setup must recheck provider policy.

[users.messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get) does not accept send-only scope. Therefore send-only access cannot silently inspect sent mail/inbox to resolve every timeout. HALO must persist provider response IDs when available, expose unresolved status honestly when a response may have been lost, and keep a manual check option. Do not promise exactly-once external delivery, automatic proof of non-delivery, or automatic reconciliation by inventing provider idempotency. Expanding scopes to inspect messages is a separate privacy/product decision, not a hidden requirement of connecting send-only Gmail. User-reported sending/replies remain independently labelled.

#### Acceptance cases

Local contact candidate actually serves selected jurisdiction/topic; unsupported area never guesses address; split district resolved with correct current boundary; no public email falls back to official form; private landlord not mined; stale contact/changed home invalidates approval. Note edits/deletion/source revisions preserve old draft text but block stale send review. Every recipient retains independent writing. Invalid/header-injected address/subject blocked. OAuth cancel/denied/expired/revoked/mismatched-account/partial-scope has truthful capability. Two confirms/concurrent retries send at most one HALO-authorized operation; unknown-after-submission never resends automatically. Late provider response reconciles matching operation only. Accepted message is not shown as delivered/read. Disconnect cancels unsent jobs and prevents new use; cannot unsend accepted message. Copy/export does not mark sent. Reply and desired-outcome tracking remains manual and private. Owner A cannot inspect sender tokens/drafts/receipts of B.

### A06: private notebook, observations, photos, cases and official handoff

#### Every note action

List/search/type/pinned/archive filters; new/edit/back-and-keep-draft; create Observation/Question/Idea/Conversation; factual observation kind; optional or required observed date/time/timezone; coarse place label; body; photo select/decode/process/review/consent/remove/Undo; save; exact detail; pin/unpin; public evidence return link; choose Luna fields/purpose/preview; start/continue case; set result/reference/next step/check-back; canonical follow-up action; prepare immutable handoff; optional place/public evidence selection; copy/download/share/print; track device action; open official site; user-report submission/reference; view earlier prepared copies; archive/restore; delete-confirm/cancel/Undo where offered. Only explicit save/pin/archive/case/handoff/history mutations require backend writes. Filters/disclosures and rendering remain frontend unless preference persistence is specified.

#### Required storage contract

- `notes`: owner, ID/revision, title<=160, body<=3000, type, observation category (`Appearance|Odor|Litter|Habitat|Other`), observed civil datetime and IANA zone plus resolved instant or explicit unknown, coarse place<=160, chosen precision, optional separately consented coordinates, pinned, archived, current status, source bindings, sanitized photo binding, timestamps. Question/Idea/Conversation do not require a fake observed date. Strict Gregorian date/time validation and DST disambiguation must not rely on browser normalization. Recommended production validation: a factual Observation cannot occur in the future; future plans belong in an Idea or canonical scheduled task. Make this server rule explicit and test the timezone boundary rather than silently accepting future factual evidence.
- `note_evidence_links`: selected public source ID/layer/evidence revision/title/date/scope/exact URL; no private home-pin transfer. Record original reference and current superseded/withdrawn status. Source loss leaves legible unavailable origin, not deletion of user's note.
- `note_drafts`: owner/device policy and expiry if durable, original revision for edits, selected photo state; distinguish unsaved local from saved server records. Do not silently restore another account's browser draft after sign-out/recovery.
- `attachments`: owner, domain binding/note ID, verified MIME/signature, byte/pixel limits, checksum, sanitized derivative key, dimensions, processing state, consent revision, created/expiry/deletedAt; original filename/EXIF/coordinates stripped from stored/shared note derivative. Do not store base64 blobs inside general JSON account state.
- `note_handoff_snapshots`: immutable ID, note ID/source revision, preparedAt, body, exact selected fields `{place,evidence,photo:false}` for current text path, source revisions, content hash, official destination ID/revision, export events, officialOpenedAt, separately userReportedSubmittedAt/reference. Later note edit cannot rewrite prepared/sent copy. General exports exclude image bytes/precise coordinates; an explicit separately reviewed image export can deliver only sanitized PNG.
- `note_handoff_events`: export copied/download-requested/share-sheet-completed/print-opened with actual timestamp, destination opened, user-reported submission. These record observed frontend actions only. Downloads or share-sheet completion do not prove transmission; opened page does not prove load/form submit. Agency acknowledgement requires genuine verified receipt with provider provenance.
- `reporting_destinations`: official agency/topic/jurisdiction scope, safe HTTPS contact/form URL, source/check date/review expiry, required fields, public-disclosure notice if known, emergency disclaimer/action links, language/access and integration capability. Current generic EPA contact link is a fallback, not a national automatic routing service or submission API.
- `community_cases`: referenced note ID and source revision, goal/state/date/result/reference/next step/check-back/history, canonical action links. Deleting note removes owned cases/drafts/attachments/handoff snapshots according to disclosed scope, preserves independent tasks and deliberately copied outreach records; exported external copies cannot be revoked. Archive preserves all contents and history.

#### Photo processing, upload and sharing

Current frontend accepts JPEG/PNG/WebP at most5MiB (5*1024*1024bytes) and at most32,000,000pixels, verifies magic bytes, decodes, scales long edge to1600px and re-encodes PNG to remove metadata. Exactly32,000,000pixels is accepted by the implementation; the current "below32megapixels" error copy should be aligned with that inclusive boundary during frontend integration. Preserve these frontend behaviors but repeat validation on the server: client claims such as `metadataRemoved:true` are not trusted. Reject SVG/HTML/malformed/polyglot/oversized decompression payloads. Validate derivative MIME/size and pixels, strip metadata server-side, scan with bounded resources, store private object keys under same owner, require upload-complete authorization before linking, and expire abandoned temporary uploads. Record a sanitized artifact checksum in review. Visible faces/signs/landmarks remain and require user review; removing EXIF is not anonymity. No automatic image interpretation, AI upload, agency send or public map point.

Use authenticated signed upload initiation/completion and short-lived signed download or authenticated streaming. Resolve exact ownership at each stage; user cannot supply arbitrary object path or another user's upload ID. Remove all derivatives/temporary files on deletion, rotate/expire prior URLs, include storage lifecycle in account deletion/recovery and retained-backup policies. Undo reattaches only within declared recovery retention and must not recreate an already hard-deleted record.

#### Proposed endpoints

`GET/POST /api/notes`; `GET/PATCH/DELETE /api/notes/:id` with pinned/archive operations as revision-bound PATCH; `POST /api/attachments/initiate`, completion/status/delete; `GET /api/notes/:id/export-manifest`; `POST /api/notes/:id/handoffs` -> immutable prepared snapshot; `GET /api/notes/:id/handoffs`; `POST /api/note-handoffs/:id/events`; `GET /api/reporting-destinations?place_id=&topic=`. All selected-record export and Luna-request preparation binds exact revisions and field scope; no invented backend send is needed for local clipboard/print/share. Prepared Luna request should route through the real shared conversation/context contract, not stop at today's preview string forever.

#### Acceptance cases

Empty notebook creates no demo observation; title/body/date/type validation, DST gap/ambiguity, future factual status policy. Edit/cancel/navigation retains correct draft; save-error/offline/conflict retains text and photo; server success with lost response reconciles one note. Pin/filter/archive/restore stable across reload/account recovery. Photo false MIME/corrupt/truncated/oversized/pixel bomb rejected; exact5MiB and32,000,000pixel boundaries tested; orientation and metadata removal verified; malicious SVG never executed; processed image private; original filenames excluded. Remove/Undo does not leak another photo. Dedicated note handoff starts with place/public evidence unchecked and always excludes photos; opting into its place/public evidence includes only those reviewed fields. General Settings export uses a different contract: `selectedPrivateExport` always strips place/location/attachment/photo keys, even when private text is selected. Its private-text opt-in must not imply location or image opt-in. Separate image export requires fresh consent; failed history write reports device action may have happened. Old snapshot immutable after note edit; submission only after explicit checkbox; official page opening does not acknowledge report. Note-derived task/case relation preserved or deliberately detached after delete. Selected Luna context cannot grow to include omitted fields; stale/deleted note blocks update and is never resurrected. Other accounts/public map/export cannot access note or file.

### M01-M05: full map, comparison, timeline and civic summaries

#### Interaction and backend dependency inventory

| Interaction | Required data/service behavior |
| --- | --- |
| Compact Explore map layer select + open full map | Same public layer ID/selection; preview can be static/decorative over real returned public source data. No private home pin in shared preview. Open canonical production `/map` preserving safe public params. |
| Four layers, independent retry/loading/offline | Layer-specific response version, completeness/freshness/source/error; changing one layer cannot clear another's usable cache. Known offline cached evidence is dated and identity-safe. |
| Pan/pinch/keyboard zoom/fit/previous view/labels/legend/pattern pause | Frontend transformations over returned data, no backend mutation or location acquisition. Large datasets may require bounded tile/bbox reads with stable complete viewport semantics and explicit total-count scope. |
| Locate / approximate household pin / own utility ring | Owned current-home capability and selected supplier association. No nearest utility inference. Public mode lacks these fields and restores no private viewport. Device geolocation is separately authorized only if implemented. |
| Search/list/all-record or current-window scope/name or distance sort | Search full acknowledged record set or paginated server query; unlocated records retained in all-record list, unknown distances last. Distance is disclosed straight-line method from permitted approximate location, not travel time, service match or exposure. |
| Water Overall/PFOA/PFOS/PFHxS/PFNA/GenX/hazard selector | Original numeric values/units/qualifiers, severity/threshold source, period; no severity-only fake values. Unknown/unregulated/excluded observations retained. |
| Latest versus sampling quarters/slider | Enumerate actual returned quarters; Latest each system's latest observation, not synchronized date. Quarter is samples within that period, not cumulative contamination. Retain old data during load; cancellation/failed request restores prior selection; stale responses cannot overwrite later selection. |
| Select water/air/facility/county / grouped facility expand / close/back/source detail | Stable public IDs and complete evidence detail plus exact source URLs, dates, geometry basis, selected dataset rules. Missing/withdrawn record has valid unavailable/history path. Canvas and list expose same IDs. |
| Record-density Patterns / Locations toggle | Equal-weight qualifying record coverage with transparent display kernel, no concentration or risk interpretation. Decorative texture moves only its display envelope; source coordinates/readings stay fixed. Actual live air contours are separate evidence product below. |
| Follow/unfollow system; open factual question or Learn | Owner-scoped subscription to stable source/system ID, idempotent reverse operation and independent delivery capability. Public source-only note handoff, no home-pin transfer; native Learn uses same normalized evidence. |
| Compare two records, search/replace/cancel/remove/clear, chosen compound | Server or shared validated normalization returns snapshots and compatibility result/reasons. Distinct IDs, same analyte/pollutant, units, period, method, scope/evidence kind/denominator/source version; show uncertainty and dates before result. |
| District/state/county view, supported filter, source/denominator details | Complete versioned aggregate query with geography/boundary release, numeric-result denominator, partial-county status, unlocated counts, known/minimum population and completeness; no unsupported district guesses. |
| Public brief review/copy/download/share/outreach | Strict public allowlist immutable snapshot, source/boundary/version/time/limitations. No profile/home pin/rank/private viewport/notes in public cache, payload, URL or metadata. Share failures retain readable text. |

#### Layer response schema requirements

Common envelope: `layer`, `release_id`, `revision`, `source_ids/versions`, `observed_range`, `published_at`, `retrieved_at`, `assembled_at`, `freshness` with reason/expiry, `coverage_geometry_id/version`, `record_count` and count basis, `returned_count`, `complete`, `cursor`, `rejected/unlocated counts`, `features`, `legend/interpretation_policy_version`, `attribution/rights`, source diagnostics safe for consumer. Public and owned response schemas should be separate; do not cache personalized data under one public key.

Water record: stable PWSID/name/status, coordinates nullable, geometry kind/service boundary vs centroid/association source+version, population served nullable/date/basis, all available sample IDs/sites/matrices, per-compound original analyte spelling and canonical code, numeric value nullable, original units, qualifier/detection limit, exact sample date/time, sample period/method/lab/source release, comparison value and enforceable/guidance status/effective dates, supplied severity/rule version, regulatory change status verified at release, unregulated/excluded reasons, coverage by analyte, latest basis, hazard index compatible components/method or unavailable reason. Store all samples, not just latest max; same-date ties need sample/site identity and disclosed selection rule.

Air record: stable station/source ID, coordinates nullable/validated, observed instant/timezone, pollutant, AQI and index standard, concentration only if actually provided with units, agency, measured vs modeled vs forecast, sampling/averaging interval, available pollutants, chosen worst-pollutant method, coverage and source release. No unknown time borrowed from assembly timestamp. Radon: countyFIPS/boundaryVersion, zone/classification source date/method, no home-concentration field invented. Facilities: stable ECHO registry ID, name, coordinates nullable, jurisdiction, selected-dataset reason, program names/counts, facility compliance category, program-specific reporting periods/status, quarters-in-noncompliance nullable, penalties nullable/currency/period, last inspection nullable, exact official source URL and source timestamp. A program count is not distinct violation count; no known report is not proof of no contamination.

#### Comparison and district contract

`GET /api/map/compare?first=&second=&layer=&analyte=&period=` (or batch evidence endpoint) must authorize public record access and return immutable first/second evidence snapshots, current/withdrawn state, normalized original-value rows, `comparable:boolean`, enumerated incompatibility reasons and explicit warnings. Valid conversions only through a reviewed transform with original values kept; do not assume equivalent units mean equivalent matrix/method. A nondetect is not numeric zero. Hazard index separate from concentration and bound to same component/method identity. Different within-quarter dates remain visible. Different source releases may be compatible only if a reviewed version-compatibility rule says so, never arbitrary fallback to `review-water-v1` metadata.

District response must carry region ID/edition/effective dates, boundary URLs, inclusion method (centroid is approximation), total mapped/in-scope systems, systems with numeric eligible results (not automatically complete tested population), per-compound eligible/tested/nondetect counts, over-comparison count with applicable threshold version, known population served by included systems, unknown-population systems and overlap handling, statewide unlocated count separately from district total, county membership whole/partial, aggregation method/version and source releases. Geography failure suppresses aggregates requiring that geography; cannot show zero exceedances or publish a brief from failed geometry. Public district endpoint omits `household_county`; separate owned context may return it with correct denominator/unranked state. Current NC-08/119thCongress/2023 geography is not a nationwide selector or automatically current election map.

#### Genuine weather-style air field requirement

The user's requested shifting weather-like air visualization can remain illustrative record density only if labelled accordingly. A real pollutant contour/forecast product requires its own provider contract: pollutant/index and units, observed/interpolated/model/forecast basis, grid/projection/resolution/bounds, no-data mask, uncertainty/support, observation/issue/valid-frame timestamps, source/method/release, licensing/attribution/cache terms, frame list and quality flags. Animate actual time frames with source times; never drift current values to imitate weather. Station AQI and contour values may differ and need separate legends/source explanations. Optional precipitation/wind visual is not sourced air data. AirNow explicitly describes distinct mapping products in [its map overview](https://www.airnow.gov/custom-airnow-maps/map-overview/); provider suitability and access must be verified before integration. Sparse monitor kernels cannot substitute for that data product.

#### Map APIs and operational dependencies

Retain `/api/map` and `/api/district` compatibility where possible; add explicit public map/district capability (separate allowlisted route or adapter), record details, comparison, source metadata and shared system subscriptions. Server returns matching precise dataset state across tiles/list/counters; public cache keyed by source release/layer/quarter/geography, owned cache keyed additionally by owner/home context. Renderer tiles/token restrictions/referrer restrictions/attribution and SDK license belong to production setup; Canvas preview and local Census/Natural Earth assets do not prove Mapbox production deployment. Geography/air/ECHO polling use bounded jobs with last-valid retention and single-flight locks. No unbounded provider rebuild triggered per pan or unauthenticated cold request. Use per-source conditional requests, quota limits and coverage capabilities outside supported NC regions.

#### Map acceptance cases

Public entry plus pasted `system=home`/assistant routes leaks no home/private state. Home change clears own pin/utility/rank/distance/current-context cache but keeps public atlas and historical records. Layer error leaves other layers; stale cache remains dated with source-outage message; malformed empty provider page quarantines. All four layers usable through accessible list without renderer; unlocated entities preserved. Quarter requests cancellable, old response ignored, zero/nondetect/missing/unscoreable distinct; limits/flags retain regulatory version. Comparison rejects same ID, missing value, unlike units/matrix/pollutant/period/method/denominator/version/withdrawn source; valid zero remains0; incompatible is explanatory not errorless ranking. Hazard mixtures from incompatible samples rejected. District totals tested against complete fixture including unlocated/partial-counties/unknown population/zero/completeness failure and private-injected keys stripped from export. No unsourced rank or false exposure population. System follow twice yields one subscription; unsubscribe prevents later delivery; saved tasks unaffected. Real contour animation uses dated frames and no-data mask; reduced motion static affects rendering only.

### X02: real conversational Luna and authorized app actions

#### Final behavior and capability model

The final assistant must understand multi-turn user questions, answer from reviewed evidence, search permitted public sources where available, navigate HALO and prepare/execute supported authorized actions. The preview's regular-expression grammar and fixture replies are demonstration scaffolding and must not be the production assistant. At the same time, free-form model language cannot itself authorize database writes or external actions.

Before provider processing, `GET /api/assistant/capabilities` returns effective provider configured/available state, permitted page/context tokens including `plan`, supported tools with schemas/versions, whether live public retrieval is available, eligible context fields, effective user consent, provider-use disclosure, transcript retention/export/deletion policy, attachment capability and limits, rate/budget/retry state. No UI infers authorization from a visible button or `uses_household_data` in a later answer. Anonymous/public mode cannot access private tools or conversation automatically; manual features stay usable when Luna is disabled/unavailable.

Conversation/message lifecycle: new/open/list/continue as product exposes; bounded turns/context; send with client-message ID; queued/generating/streaming/completed/refused/no-source/failed/cancelled; user stop/retry with same intent identity where applicable; navigation retains current conversation but cancels inappropriate in-flight UI work; reloading can reconcile pending message/operation. New conversation or clear requires truthful scope and confirmation for unsent text/unapplied reviews. Independent saved records remain. Unresolved write operation ledger cannot be discarded by deleting transcript; privacy deletion should block new operations, reconcile or safely quarantine existing work, then complete cleanup with minimal required retention disclosed.

Typed messages contain role, stable ID, conversation ID, timestamps, actual provider/model and source policy versions, answer blocks, citation IDs tied to individual claims and exact source revisions, used-context manifest, refusal/unavailable codes, proposal refs and operation refs. Streaming events need message/request ID and sequence; disconnect must not fabricate a final response. Sources may include observed readings, regional context, forecasts/proxies, user-entered records and official guidance but must keep those meanings distinct.

#### Required tool registry and behavior

| Tool family / demonstrated user action | Exact production contract |
| --- | --- |
| Explain reading/why suggestion/qualified term | Read authorized canonical evidence/source revisions; preserve units, dates, missing/stale state; source-backed answer and unsupported limits. |
| Navigate Today/Homeguard/Explore/My Week/Map/Settings/Journal/Patterns/outdoors/tests/notes/project | Allowlisted route with safe public or authorized opaque record IDs; no private text/coordinates in URL; navigation is not saving. |
| Find task/note/project | Owner-scoped bounded query with minimal fields. Exact-first, duplicate/partial ambiguity asks user to choose; never pick first of multiple matches or broaden blank target to all. Pronouns reference explicit prior exact target only. |
| Generate/refresh/refine projects; ideas from selected notes | Shared project generation contract/context/preferences/batch and source grounding; no separate fake idea list in chat. Notes selected by ID/revision/fields and purpose, no whole notebook ingestion. |
| Guide current project step / start project / prepare first steps | Read immutable guide and minimal current step/action state; do not copy private step notes/outcomes/history without selected consent. Starting instance plus chosen actions commits atomically or uses explicit resumable ledger; partial saved instance reported if actions fail. |
| Create task / reschedule / rename | Proposal exact fields, canonical target ID/revision, concrete date/time/zone and before/after. Natural dates anchored to disclosed current local date; ambiguous next/weekend/time needs clarification. Existing timed schedule preserved, DST invalid/ambiguous move rejected or re-reviewed. |
| Complete/reopen/mark waiting | Explicit confirmation; record actual completion instant/local day, not scheduled date. Reopen retains historical completion event; source readings/registration/test milestones stay unchanged. |
| Save task for later | Review removal of date/time/reminder/recurrence only; preserve estimate/private preparation/source relation. Cancel linked future scheduler intent atomically; no unintended repeated tasks. |
| Delete task | Exact task title/ID/origin/state/schedule/revision and scope. Task plus planning metadata/reminders removed or tombstoned; original project/test/participation/note and other tasks preserved. Existing completed project consistency needs review if required step removed. |
| Plan week / reviewed batch move | Minimal task schedules/supplied effort, no Journal/private preparation, immutable selected IDs/revisions/metadata version, bounded editable proposal. No assumed free/busy and no silently moved dated commitments. Confirm atomic all-or-none changes and canonical results. |
| Save/edit/delete note | Create proposal text; edit only reviewed title/body fields merged into latest authorized row; deletion exact selected IDs/revisions and final confirmation. Place/photo/evidence/history not overwritten by stale snapshot, deleted note never resurrected. Independent tasks and previously copied outreach text retained per policy. |
| Prepare outreach/question/forecast comparison | Reuse dedicated contact/outreach/forecast service response or navigate to that workflow when unavailable. No invented recipient/date/forecast. External email requires its own exact outgoing proposal and confirmation; chat request does not bypass send scope. |
| Save available item/follow a source or adjust an allowed preference | Use the same domain action/subscription/settings validation and proposal mechanism when included in the published capability registry. Do not claim broad app control for unsupported tools; return exact manual route. Tests/results/profile/account/provider permissions and source publication cannot be silently changed by model. |

#### Proposal, confirmation and operation ledger

`assistant_conversations`, `assistant_messages`, `assistant_context_grants`, `assistant_proposals`, `assistant_operations`, `assistant_feedback` only if exposed/required. Each row owner-scoped with revision and retention. Proposal includes `id, revision, conversation_id, tool_name, tool_version, args_allowlist, target_ids/revisions, source_versions, home_context_id/revision, permission/consent_version, before/after, scope, warning/assumption codes, createdAt/expiresAt, status, outgoing_hash`. Server derives fields from owned records, not trusted frontend snapshots. Confirmation supplies proposal ID/revision and idempotency key, not a replacement unrestricted args blob. User editing proposal regenerates its reviewed version.

Before execution: reauthorize owner and selected fields, current account/home/device capability, existence/revision/source validity, exact tool/args schema and proposal expiry, explicit confirmation, operation hash and idempotency. Do this again in the transaction alongside update and consumed-proposal/receipt writes. Return canonical IDs/revisions and effects. Database failures distinguish no write from unknown; when uncertain keep immutable operation ID, prevent retry duplication, query authoritative status and only allow deliberate retry if known not applied. Known applied returns original receipt even after reload. If one tool spans nontransactional external action, use domain outbox/ledger and preserve uncertainty instead of claiming atomicity.

Note/classifier/model output may request a tool, but trusted server executor is sole authority. Content inside notes/uploads/web pages/citations/model output is untrusted data; cannot grant permissions or override system/tool restrictions. "Save a note: delete task X" must save the sentence only. Negated/broad/ambiguous edits trigger clarification, not bulk destruction. Separate read tools from write tools and external consequential tools. Limit iterations/tool count, recursion, token/cost/output size; do not expose secrets or arbitrary HTTP/SQL/file execution tools to model.

#### Provider and evidence pipeline

Keep current structural diagnostic guard and curated-source decline behavior, but replace broad context gathering with purpose-scoped typed server adapters. Exclude free-text Journal and unrelated health details under current policy; do not silently transmit symptom history merely because old backend gathers it. Any desired sensitive aggregate context requires explicit product policy and specific user control. Do not conflate model response delay with action processing animation. On assistant answer failure, user work remains unchanged.

Source retrieval must filter published/nonwithdrawn/current-applicable guidance and exact owner-authorized evidence, validate URLs, cite claims, handle contradictory/stale sources and unsupported geography, avoid confident medical/legal/causal interpretation, and use deterministic calculations for supported quantities. Provider can be existing compatible endpoint or chosen replacement, but capability/retention/security/streaming must reflect actual selected provider. No model training-data answer presented as live web retrieval. Token/embedding/model changes require corpus version migration and evaluation before rollout. Transcripts/attachments/selected context subject to account export/deletion and provider retention disclosure, and never sent through telemetry.

#### Proposed APIs

`GET /api/assistant/capabilities`; `GET/POST /api/assistant/conversations`; `GET/DELETE .../:id`; `POST .../:id/messages` with idempotent client message ID, permitted page/context refs and consent version; `GET .../:id/messages?cursor=`; authenticated bounded stream or request status; `POST /api/assistant/requests/:id/cancel`; `POST /api/assistant/proposals/:id/confirm`; `POST .../:id/cancel`; `GET /api/assistant/operations/:id`; optional edit-proposal operation that increments revision and returns fresh preview. Existing GET/POST assistant endpoint can remain compatibility adapter but no longer silently invokes unauthorized broader context. Typed domain services execute tools and also power manual UI to avoid divergent semantics.

#### Luna acceptance suite

All manual domain isolation/revision/idempotency rules plus multi-turn pronoun ambiguity, arbitrary conversational phrasings, mixed/negated requests, duplicate task titles, unsupported tool manual fallback, no-source/rate/unconfigured/unavailable/cancel/retry/stream disconnect, context toggle changed after proposal, home/account changed during answer/action, stale note edit after delete, source withdrawal during generation, malicious web/note/PDF instructions, Unicode control/prompt injection, citation-support and inaccurate/source-conflicting claims, harmful unsupported project or medical inference refusal, private fields excluded by default, message duplicate retry, uncertain-before/after-write status/reload/conversation-clearing protection, task unchanged after cancelled proposal, actual completion day across midnight/DST, no private preparation in week planner, partial project creation recovery, provider token/secret redaction and limited billing. Existing preview tests are behavior fixtures to port into authenticated integration tests; regex parser tests alone do not evaluate real conversational model quality.

### X07: source acquisition, human review, publication and operations

#### Actions and access

Consumer has no operator navigation or authority. Viewer reads safe source health, reviewer inspects diff/quarantines/approves a validated candidate/reviews translation/retries scoped failed run, publisher separately publishes/withdraws. Server identity/role controls authorization, never frontend-selected role or hidden route. Recheck role at confirmation and transaction time. Record reason for changes and expected source/candidate revision; source selection, comparison/disclosure and cancelled draft need no mutation.

Source list/detail includes issuing organization, accountable owner, source URL/terms/access/license, geographic/parameter coverage, method, cadence/freshness expectation, observed/published/retrieved dates, parser/content release, current/pending versions, last successful run, next review, broken-link status, rejected rows/safe diagnostic and reviewer. Raw private payload/headers/keys are never shown. Compare missing vs measured0 vs nondetect/qualifier vs partial vs invalid, original units/date/geography/required-field changes. Imported facts do not become advice by successful HTTP status or one checkbox.

Operations: approve only validated incoming revision; quarantine anomalous or invalid unpublished revision; publish only separately approved exact revision; withdraw published revision without deleting private referenced records; rollback current public pointer through a reviewed versioned operation; translation review binds exact approved base content/locale/source version and is separately published; retry only selected failed run with bounded attempts and original job identity; unknown action freezes conflicting decisions until authoritative reconciliation; audit/history immutable and paginated. Stale/deleted authority/revision yields conflict/forbidden preserving draft reason. A failed/unexpectedly empty feed keeps last valid source dated/stale, never publishes empty clean replacement.

#### Entities and jobs

- `source_registry`: stable source ID, owner/steward, issuing organization, source endpoint/link (safe consumer URL separate from secret-config reference), access/license/attribution/reuse/retention, coverage/parameter/method/projection, expected cadence/expiry, provider quotas/cost, authentication secret reference, acquisition policy/parser version, current release pointer, review ownership/schedule and operational status.
- `ingestion_runs`: job ID, source/release/request key, parser version, cursor/checkpoint, expected/read/rejected counts, content hash, validation report, observed/published/retrieved/started/finished times, lease/attempt/dead-letter state, safe error class, raw import storage retention reference. A partial acquisition never replaces a complete current release.
- `source_releases`/`evidence_revisions`: immutable content/method/version/hash, record counts, geography/unit/date checks, quality/anomaly flags, incoming/quarantined/approved/published/superseded/withdrawn states, reviewer/reason/review expiry, published pointer. Retain distinctions when source corrects/withdraws evidence; old saved record identifies original version.
- `content_revisions`/`translations`: parent reviewed version, locale/requested-delivered locale, claim citations, human/specialist review, translation revision/diff/status, publication separately bound to base content. English publication must not imply Spanish reviewed content exists. Source flags and safety instructions preserve meaning across translation.
- `source_decisions`/`audit_log`: server actor/role, source and exact target, expected/pre/post revision, decision/reason, immutable server instant, request/idempotency key, affected scopes, operation status and receipt; append-only role-protected access, no sensitive prompt/source headers.
- `source_change_events`/outbox and dependency graph: old/new published release, semantic event kind (new reading, correction, withdrawn advice, coverage change, event cancellation), affected guidance/projects/subscriptions/actions, dedupe keys, delivery intent and progress. Do not notify on JSON ordering or refreshed fetch time alone.

Worker lifecycle: acquire bounded batch with lease -> retrieve allowed source with timeouts/conditional request/redirect policy -> parse/schema/date/unit/geography/count validation -> quarantine or candidate -> review/publish transaction -> atomic pointer + durable change outbox -> resumable derived maps/search/corpus rebuild -> bounded owned matching/fanout -> delivery only with consent. Retry transport/429/5xx with bounded jitter, stop schema/auth/legal/source-rights failures for operator review. Never let user-provided URL become unrestricted server fetch. Quotas, request/cost budgets, malicious content extraction boundaries, shared public cache and private/owned queues separated. Scope kill switch can disable producer/interpretation without deleting household data. Restore/replay runbook must preserve idempotency and not re-send notifications/emails.

#### Proposed operator APIs

`GET /api/ops/capabilities`; `GET /api/ops/sources?status=&cursor=`; `GET /api/ops/sources/:id`; `GET /api/ops/sources/:id/revisions`; `GET /api/ops/runs/:id`; `POST /api/ops/reviews` creates exact decision preview; `POST /api/ops/reviews/:id/confirm`; `GET /api/ops/operations/:id`; `POST /api/ops/runs/:id/retry`; `GET /api/ops/audit?scope=&cursor=`. These services can back a protected equivalent internal workflow rather than a new public consumer page. Never expose service-role key to browser. Ordinary public read excludes candidate/unreviewed/withdrawn instructions unless showing scoped historical withdrawal detail.

#### Acceptance cases

Denied/unknown role cannot read private operator data; viewer cannot mutate; reviewer cannot publish/withdraw; revoked role cannot confirm old proposal; publisher cannot bypass malformed candidate validation. Count collapse, missing pages/query ID, changed units, invalid geometry/date, absent required fields quarantine even onHTTP200. Existing publication remains dated stale on failed retry. Approve/publish/withdraw updates pointer/audit/outbox atomically once; repeated request returns canonical outcome and altered-payload same key conflicts. Source correction triggers affected-items review without rewriting old task history. Translation for previous base version cannot publish against changed source. Unknown action does not allow blind retry; cancellation only guarantees no write before actual commit. Backup restore/resume never republishes unapproved release or delivers duplicate user alert. Safe diagnostics omit credentials/private data. Source terms/review expiry and launch coverage are recorded for every enabled production source.

### Integration and test evidence pointers

Manual and Luna paths must use the same canonical services and record IDs. All new private rows/files/conversations/proposals/operations/generation requests/provider grants/cases/subscriptions must join account export/deletion/recovery, same-owner foreign keys, RLS and cache isolation. Public source revisions and organization records are not household-owned. A home move changes recommendation/location scope, cancels obsolete matches/watch intentions and invalidates current evidence while preserving historical project/participation/note work.

Behavior regression files to reuse and extend with real auth/database/provider doubles:

- Explore: `test/frontend-explore-{local-resources,opportunities,personalization,project-guides,workspace,photos}.test.mjs`; `test/ui/explore-{action-workspaces,community,local-resources,project-guides,rebuild,three-pillars,preview}.spec.ts`.
- Notes: `test/frontend-note-{photo,handoff}.test.mjs`; `test/ui/note-{photo,handoff}-completion.spec.ts`.
- Map: `test/{mapBuild,mapData,mapLayers,districtView}.test.mjs`; `test/frontend-map-{comparison,visuals,contours}.test.mjs`; `test/ui/map-{preview,comparison,motion}.spec.ts`.
- Luna: `test/{assistant,assistantContext,assistantRag}.test.mjs`; `test/frontend-luna-{completion,tools-preview,week-plan}.test.mjs`; `test/ui/luna-{completion,conversation,live,assistant,pages,motion}.spec.ts`. Live suite presence is not proof it ran with approved real provider/configuration.
- Operator: `test/frontend-source-operations.test.mjs`, `test/ui/source-operations.spec.ts`.

Existing frontend tests intentionally block API/external network and exercise memory fixtures; wireframe success does not verify production RLS, provider state, real source coverage, actual AI quality or durable queue correctness. Backend implementation acceptance must add database-backed two-owner tests, realistic provider contract tests with known/unknown external outcomes, migration/rollback tests, stale-source/quarantine tests, external service launch checks, and connected end-to-end user journeys. Missing feature status must remain visible in the integration manifest until these pass.

## 13. Decisions, verification and completion criteria

### 13.1 Decisions that must be recorded before the affected capability ships

This is not a request to hide missing features permanently. It is the explicit decision queue required to turn the complete target into a safe, buildable implementation. Resolve each item in this file with an owner, date, accepted rule/provider, contract version and test IDs. Vibhav owns implementation; Yogi approves product/consent behavior, with appropriately qualified source/method review where needed. No unspecified decision below is claimed to be settled by a wireframe.

| Decision | Evidence or open choice | Required resolution and interim behavior |
| --- | --- | --- |
| D01 Private-water score | Written radon-only requirement conflicts with current null composite | Agree reviewed method and coverage contract. Until then preserve backend null composite and separate radon context, with no client recomputation. Apply agreed behavior everywhere, not only Homeguard. |
| D02 Building-year range | Settings accepts 1000-current year; B01 validators start at 1700 | Choose one supported range and unknown representation; align onboarding, Settings, backend schema/validators and tests. Do not silently clamp an accepted year or change lead interpretation. |
| D03 Location/geographic coverage | Current NC-specific utility/district/lead/volunteer sources do not establish national coverage | Publish per-feature geography/capability, geocoding provider, coordinate precision/retention and utility matching method. Manual/general features remain usable outside coverage; no nearest-utility shortcut. Distinguish home, selected Explore area and outdoor place. |
| D04 Real air field | Current irregular patterns are record-density artwork, not pollutant interpolation or transport | Select and validate a licensed gridded observation/model/forecast product for actual contours, or retain truthful density with a separate capability. Do not animate fabricated evidence. |
| D05 Source rights and longevity | Providers differ in history, map, attribution, export and derived-data permission | Record actual account terms and per-data-class expiry. Licensed expiry overrides a wish for indefinite raw-value archives. Retain permitted identity/date/withdrawal metadata with an unavailable reason if values must be removed; do not invent replacement values. Reconcile immutable references with lawful/contractual content deletion. |
| D06 PFAS, advice and analysis methods | Hard-coded thresholds, private-water conflict, Journal denominators and hazard mixture assumptions need versioned review | Maintain effective/proposed/withdrawn rules separately, formalize sample/method compatibility and nonclinical descriptive analysis. Qualified review before new score, regulatory interpretation, causal or health claim. |
| D07 Project generation and discovery | Real web-backed projects and future/rolling opportunities require services, not fixture randomization | Select search/content/model providers and source policy, cost limits, freshness and supported regions; define generation evaluation set. Return validated 10-15 ideas or explicit smaller partial result, never fabricate fillers. Preserve already saved guides. |
| D08 Contact resolution and email | Need/location resolution, sender authorization and reliable status are new | Select verified public-contact sources, provider and exact sender scopes. Gmail recipients are allowed but not required. Decide send-only versus separately consented mailbox reading. `gmail.send` cannot inspect sent messages through `messages.get`; uncertain sends may require user/provider reconciliation, never blind retry. |
| D09 Recovery/device/account policy | Anonymous identity exists; recovery, multi-device grants and collisions need production authority | Choose supported link methods and challenge transport, collision/no-silent-merge rule, device/session revocation, account-age/consent policy and deletion behavior. Household age-group flags alone do not prove the user is a child. |
| D10 Privacy, retention and consent | Wireframe scopes exist but do not constitute a deployed data policy | Publish domain-specific retention, provider disclosure/retention, user export/erasure, backup aging, unresolved operation retention and optional telemetry policy. Default unknown context permission is denied. Do not require health notes or private documents for ordinary functionality. |
| D11 Food sample linkage | Current generic test kinds and kitchen links do not establish exact item/lot assays | Add reviewed food/tissue test kind, matrix/basis, original analyte/qualifier and item/lot/sample relation plus matching UI. Until then show study/notice context and unknown item concentrations. |
| D12 Growth/inquiry identity | Preview often keys projects by guide+index and inquiries by resource | Use independent saved instance/episode IDs and stable template-step IDs. Allow legitimate repeated projects/inquiries without merging their history. Capture a compatibility migration for any persisted pilot data. |
| D13 Notification and calendar services | Inbox, push, reminders, ICS, provider calendar writes and weekly review are different | Specify enabled channels, server scheduler, quiet/DST policy, recurrence/edit scope, external calendar scopes and supported devices. Existing combined category controls need explicit migration if split. No delivery or free/busy from a local flag. |
| D14 Deployment and reliability | SQL/source presence does not prove migrations/configuration exist in staging/production | Verify actual migration ledger, RLS/grants/storage, provider configuration, secret management, job runner, monitoring, costs, rollback and backup restore. Fix Windows test portability. Do not deploy the reconstructed baseline SQL to an existing Supabase project. |
| D15 Language and publication | Requested locale may lack reviewed source-specific content | State launch languages and fallback per content type; source/translation revisions stay bound. Never use unreviewed generated medical/safety translations as approved guidance. |

Suggested engineering starting values, not existing capabilities or final privacy promises: private signed-download lifetime at most 5 minutes; unattached upload cleanup after 24 hours; generated account-export expiry after 24 hours; bounded list default 50/max200; exact mutation-review expiry around 15 minutes with re-review on relevant changes; ordinary idempotency receipt retention at least 7 days, with longer domain-specific external-operation retention when needed. Choose and publish actual values in capability/schema/configuration, test boundaries and override these defaults where source terms, privacy policy, external reconciliation or measured scale require it. Do not auto-delete user records based on these temporary-object defaults. AI/file/import limits also need explicit byte/token/row/time/cost budgets and quota errors before production enablement.

### 13.2 Repair priorities and implementation ownership

| Priority | Required before | Concrete work |
| --- | --- | --- |
| P0 Evidence/identity truth | Any connected rollout | Adopt B01 without replacing frontend; fix home-context cache/write races and same-day history loss; preserve provenance/comparability/truncation; stop missing-values-as-safe/zero; repair Journal logged-day denominator and retrospectively claimed saves; resolve D01/D02; limit diagnostic/paid endpoints. |
| P0 Authority/privacy | Any private durable mutation or AI tool | Owner/RLS constraints, revision and idempotency enforcement, exact reviews/operations, consent before private model context, cross-account/file/export isolation, complete deletion and token lifecycle. |
| P0 Source integrity | Live maps, guidance, local matching and public briefs | Complete paginated acquisitions, correct qualifiers/units/geometry/denominators, retain dated last-valid sources, validate before publication, rights/freshness/corrected/withdrawn semantics. |
| P1 Complete app services | Replacing review adapters | All canonical tasks, settings, home/food records, notes, projects, participation, contact/outreach, conversations/tools, forecast/history and source-publication contracts in this document. None is satisfied merely by a disabled button or empty fixture response. |
| P1 Delivery and recovery | Promising reminders, sending, sync or restored access | Durable outbox/queue retries, provider scope/receipts, unknown-outcome paths, source-change fanout, push registration, account recovery/device authority and backup restore. |
| P2 Coordinated frontend integration | Production app release | Typed adapters/shared state, safe production default routes, loading/error/empty/conflict states, authentication/deep links/cache lifecycle, all retained draft and animation/accessibility behavior, every cross-feature acceptance journey. |

Priority is implementation order, not permission to omit a final required feature. Backend delivery can proceed by contract family, but each remains marked incomplete until actual acceptance evidence exists. Decorative images, handwriting, motion, field formatting and native browser UI are frontend tasks; they do not need invented network APIs. The backend supplies meaningful dynamic copy, values, identity, provenance and persistent actions.

### 13.3 Audit method and evidence actually obtained

Three independent domain passes inspected (1) existing backend/routes/schema/providers, (2) Today/Homeguard/Food evidence and private workflows, and (3) Explore/Map/Luna/source operations. The primary pass covered onboarding/identity, My Week/Journal/forecasts, Settings/alerts/privacy, shared state/adapters and cross-domain integration. A separate reconciliation pass checked contradictions, small calendar/settings semantics and historical plan coverage. Findings were corrected against code rather than accepted from a checkpoint alone.

Requirements inspected include root instructions, workflow/continuation/completion records, the master/frontend/backend/acceptance plans, Today/Homeguard supplement, food evidence/source acquisition plans, My Week/homepage, Settings/alerts, Explore/Luna/Map, account/Learn/source operations and visual/motion reviews. Later product decisions govern superseded content. These source documents establish intent, not deployed implementation. All essential new backend requirements are included here; references locate evidence, not an instruction to ask Vibhav to discover omitted requirements in a second handoff.

| Check | Actual result | Limit of that evidence |
| --- | --- | --- |
| Exact repository/branch inspection | Frontend f445588a, main 9f1ef88f, backend fb4cadf7; fresh remote fetch | Unpushed Vibhav changes and deployed resources are not visible |
| Existing backend inventory | 24 HTTP route files / 34 methods, 15 public tables plus Auth, 16 migration files | Code presence, not deployment or working provider entitlement |
| Backend test execution in isolated archive | 1,829 tests: 1,826 pass, 3 Windows-portability failures, 0 skipped; typecheck passed | Mocked route/network harness and local PGlite; not staging RLS/provider delivery or a full browser journey |
| Targeted current frontend/domain tests | 66 pass, 0 failed, 0 skipped | Validators/adapters/PDF/evidence tests, not new backend services |
| Offline diagnostic examples | Reproduced Journal denominator issue, null precipitation becoming0, missing facility values becoming0, invalid air rows, incompatible-date hazard mixture | Specific deterministic reproductions, not an exhaustive external dataset validation |
| Static executable UI inventory | 134 JSX files, 1,531 interaction/control declarations in Appendix A | Counts source declarations, including wrappers, repeated templates and review controls; not 1,531 distinct user features or exercised browser actions |
| Existing frontend type inventory | 173 exported type/interface declarations in Appendix B | Includes review types; inline/local types and JS helper behavior still require their domain contracts/adapters |
| Final document/source checks | Passed: all 45 feature rows, 25 integration journeys, unique control IDs, exact embedded control/type/hash registers, balanced fences, no assembly placeholders; script syntax passed | Structural traceability and a bounded credential-pattern check, not a guarantee of semantic completeness or a production security assessment |
| Official documentation checks | Supabase identity/RLS, Gmail/Calendar scopes, RFC5545, EPA/NWS/Google/FDA and map references cited inline | No provider credentials, account billing, licensed source dataset reimport or delivery validated |
| Version50 historical frontend evidence | Prior completion receipt reports 302 domain tests and 754 unique browser cases across runs/reruns | Historical isolated wireframe evidence; not rerun in full for this documentation audit and not one all-green connected-app run |
| Working-tree boundary | Pre-existing user edits, generated test artifacts and immutable archives preserved | No backend merge, migration, UI redesign, production deployment, email or handoff message performed |

Independent backend reproduction used an isolated archive and `npm ci --ignore-scripts --no-audit --no-fund`, then `npm test` and `npm run typecheck`. See section10 for exact failing test locations and semantic defects. Current targeted domain command is recorded at the end of section11. Do not collapse these separate scopes into a claim that the complete final app has passed integration.

### 13.4 Repeatable source inventory and handoff checks

Run `node scripts/audit-backend-handoff.mjs` from the repository root to regenerate the interaction/type evidence under `tmp/backend-handoff-audit`. Run `node scripts/audit-backend-handoff.mjs --verify` to compare the embedded handoff with the current source declarations and check feature IDs, document assembly, type inventory and source fingerprints. The source pins above identify the audit snapshot; after intentional frontend changes, update the handoff and re-audit changed domains rather than treating stale line numbers as current evidence.

Appendix A includes native controls and JSX elements with event handlers, href, form action or download bindings; source line, owner function, expression and domain family connect the small actions back to their contracts. It deliberately includes review controls so they can be excluded explicitly. Its automatic review-control flag is a heuristic, not the sole production capability decision. Long inline handler text is shortened in the table; the source line/function is authoritative. Dynamic data instances, keyboard/global effects, hooks and derived changes are covered by the shared and domain requirements, not invented as static controls. Appendix B preserves exported frontend field vocabularies while the normative sections repair fixture-only shortcuts. Appendix C records content hashes for all 134 scanned JSX files and 58 scanned frontend TypeScript files.

Before connection, create a machine-readable integration manifest from the contract families: feature/operation ID, current control/source, frontend adapter, server schema/method, ownership, source/provider, migration/job, state/error/permission behavior, test IDs and evidence. For each Appendix A row classify it as local presentation, navigation, authorized read, persistent mutation, external operation or review-only; dynamic instances use the same tested operation. Do not force local date-picker, hover/pause or disclosure controls into backend writes. This ledger is traceability, not a substitute for real authenticated execution.

### 13.5 What this handoff does and does not certify

The requested comprehensive backend audit and single-file implementation handoff are complete for the inspected product/source snapshot. All 45 named feature groups, their deeper interaction families, current source interfaces and cross-feature contracts are represented. No missing major family was found in the independent reconciliation pass. This is not a guarantee that implementation can never reveal another defect, nor that any future feature was anticipated.

The final functioning app is **not** certified complete. Completion requires Vibhav's implemented/schema-tested services, coordinated production frontend adapters, actual provider/source checks, the acceptance journeys above and a connected-app regression pass. Remaining decisions and external verification are visible release gates, not silently assumed successes. Keep this one file versioned with the app; record newly discovered requirements here and in tests before changing either side. Do not send private data or secrets with it.

## Appendix A. Executable interface control ledger

Generated from tracked current components and route JSX using the TypeScript parser. Every statically declared native control and every JSX element with an event callback, navigation target, form action or download is listed. Repeated data-driven rows are represented by their source control; runtime records are covered by the corresponding domain contract. This is a traceability index, not proof that callbacks already call production services. Labels and handlers are source expressions, not replacement product copy. Review-only controls and local presentation actions are intentionally visible here so they cannot accidentally become production service requirements. Consult the named owner function for complex inline closures.

Scanned 134 JSX source files; found 1531 control declarations. Native browser interactions and global effects are covered by shared contracts and the source-file register.

### app/OnboardingScreen.tsx

Contract family: G01 / X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0001 :232 | button / nav | {copy.common.back} | onClick={back} |
| UI0002 :236 | form / OnboardingScreen | {[copy.welcome.title,copy.address.title,copy.household.title,copy.home.title,copy.reveal.title][step]} | onSubmit={event =&gt; {event.preventDefault(); void submit();}} |
| UI0003 :239 | input / OnboardingScreen | "halo-address" | onChange={event=&gt;{gpsRequest.current++;setLocating(false);setCoordinates(null);setAddress(event.target.value);if(!validateAddress(event.target.value))setErrors(previous=&gt;({...previous,address:''}));}}; onBlur={()=&gt;setErrors(previous=&gt;({...previous,address:coordinates?'':validateAddress(address)}))} |
| UI0004 :239 | Button / OnboardingScreen | {copy.address.useLocation} | onClick={locate} |
| UI0005 :240 | button / OnboardingScreen | (child/component label) | onClick={()=&gt;setHousehold(previous=&gt;({...previous,[key]:!previous[key]}))} |
| UI0006 :240 | Button / OnboardingScreen | {copy.household.skip} | onClick={()=&gt;move(3)} |
| UI0007 :241 | input / OnboardingScreen | "halo-year" | onChange={event=&gt;{const next=event.target.value.replace(/\D/g,'').slice(0,4);setYear(next);if(!validateHomeYear(next))setErrors(previous=&gt;({...previous,year:''}));}}; onBlur={()=&gt;setErrors(previous=&gt;({...previous,year:validateHomeYear(year)}))} |
| UI0008 :241 | select / OnboardingScreen | "halo-water" | onChange={event=&gt;{setWater(event.target.value);if(event.target.value)setErrors(previous=&gt;({...previous,water:''}));}}; onBlur={()=&gt;setErrors(previous=&gt;({...previous,water:water?'':copy.home.waterRequired}))} |
| UI0009 :242 | ResultsReveal / OnboardingScreen | (child/component label) | onComplete={finish}; onInvalidLocation={recoverLocation} |

### components/expanded/AccountWorkflows.tsx

Contract family: G01 / X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0010 :17 (review control) | select / CompletionReviewControls | {capabilityStates.map(s=&gt;&lt;option key={s}&gt;{s}&lt;/option&gt;)} | onChange={e=&gt;workspace.setDraft('review:capability:${key}',()=&gt;e.target.value)} |
| UI0011 :17 (review control) | select / CompletionReviewControls | {['ready','loading','error','empty'].map(s=&gt;&lt;option key={s}&gt;{s}&lt;/option&gt;)} | onChange={e=&gt;workspace.setDraft('review:learn',()=&gt;e.target.value)} |
| UI0012 :42 | button / Feedback | {c.cancel} | onClick={service.cancel} |
| UI0013 :59 | summary / HomeTransitionFlow | {c.location} | (native form/control behavior) |
| UI0014 :61 | input / HomeTransitionFlow | {c.newArea} | onChange={e=&gt;{setArea(e.target.value);service.setMessage('');}} |
| UI0015 :61 | button / HomeTransitionFlow | {c.findArea} | onClick={()=&gt;{if(!validArea(area)){service.setMessage(c.invalidArea);return;}service.run(()=&gt;setStage('candidate'));}} |
| UI0016 :61 | button / HomeTransitionFlow | {c.review} | onClick={()=&gt;{setSnapshot(signature());setStage('review');setSelected([]);}} |
| UI0017 :61 | button / HomeTransitionFlow | {c.back} | onClick={()=&gt;setStage('entry')} |
| UI0018 :61 | input / HomeTransitionFlow | {a.title} | onChange={e=&gt;setSelected(e.target.checked?[...selected,a.id]:selected.filter(id=&gt;id!==a.id))} |
| UI0019 :61 | button / HomeTransitionFlow | {c.confirmHome} | onClick={confirm} |
| UI0020 :61 | button / HomeTransitionFlow | {c.cancel} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0021 :62 | summary / HomeTransitionFlow | {c.pastHomes} | (native form/control behavior) |
| UI0022 :62 | Link / HomeTransitionFlow | {task.title} | href={'/foundation/preview/expanded/?tab=plan&weekTask=${encodeURIComponent(id)}'} |
| UI0023 :62 | summary / HomeTransitionFlow | Previous home details | (native form/control behavior) |
| UI0024 :74 | summary / RecoveryFlow | {c.recovery} | (native form/control behavior) |
| UI0025 :75 | button / RecoveryFlow | {c.removeRecovery} | onClick={()=&gt;setConfirmation({kind:'remove',revision:record.revision})} |
| UI0026 :75 | button / RecoveryFlow | {c.revoke} | onClick={()=&gt;setConfirmation({kind:'revoke',revision:record.revision})} |
| UI0027 :75 | input / RecoveryFlow | {c.email} | onChange={e=&gt;setEmail(e.target.value)} |
| UI0028 :75 | button / RecoveryFlow | {c.sendLink} | onClick={()=&gt;{if(!validRecoveryEmail(email.trim())){service.setMessage(c.invalidEmail);return;}service.run(()=&gt;{setReviewedEmail(email.trim());reviewedRevision.current=currentRecord.current.revision;setStage('pending');service.setMessage(c.verifyPending);});}} |
| UI0029 :75 | button / RecoveryFlow | {c.verify} | onClick={()=&gt;service.run(()=&gt;{if(currentRecord.current.revision!==reviewedRevision.current){service.setMessage(c.changed);return;}setRecord({email:reviewedEmail,verified:true,revision:record.revision+1,otherDevice:true});setEmail('');setStage('entry');service.setMessage(c.verified);},true)} |
| UI0030 :75 | button / RecoveryFlow | {c.cancel} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0031 :76 | button / RecoveryFlow | {c.remove} | onClick={()=&gt;service.run(()=&gt;{if(currentRecord.current.revision!==confirmation.revision){service.setMessage(c.changed);return;}setRecord(confirmation.kind==='remove'?{email:'',verified:false,otherDevice:false,revision:record.revision+1}:{...record,otherDevice:false,revision:record.revision+1});service.setMessage(confirmation.kind==='remove'?c.recoveryRemoved:c.revoked);setConfirmation(null);})} |
| UI0032 :76 | button / RecoveryFlow | {c.keep} | onClick={()=&gt;{service.cancel();setConfirmation(null);}} |
| UI0033 :84 | button / DeviceSetupFlow | {c.unsubscribe} | onClick={()=&gt;setStage('remove')} |
| UI0034 :84 | button / DeviceSetupFlow | {c.requestPermission} | onClick={()=&gt;service.run(()=&gt;setStage('permission'))} |
| UI0035 :84 | button / DeviceSetupFlow | {c.register} | onClick={()=&gt;service.run(()=&gt;setStage('confirm'),true)} |
| UI0036 :84 | button / DeviceSetupFlow | {c.cancel} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0037 :85 | button / DeviceSetupFlow | {c.confirm} | onClick={()=&gt;service.run(()=&gt;{setStatus('on');setStage('entry');service.setMessage(c.subscribed);},true)} |
| UI0038 :85 | button / DeviceSetupFlow | {c.cancel} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0039 :86 | button / DeviceSetupFlow | {c.unsubscribe} | onClick={()=&gt;service.run(()=&gt;{setStatus('off');setStage('entry');service.setMessage(c.unsubscribed);})} |
| UI0040 :86 | button / DeviceSetupFlow | {c.keep} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0041 :92 | button / ConnectionFlow | {connected?c.disconnect:c.connect} | onClick={()=&gt;{service.setMessage('');setStage(connected?'remove':'review');}} |
| UI0042 :92 | button / ConnectionFlow | {c.authorize} | onClick={()=&gt;service.run(()=&gt;setStage('pending'))} |
| UI0043 :92 | button / ConnectionFlow | {c.cancel} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0044 :92 | button / ConnectionFlow | {c.checkConnection} | onClick={()=&gt;service.run(()=&gt;{setConnected(true);setStage('entry');service.setMessage(c.connected);},true)} |
| UI0045 :92 | button / ConnectionFlow | {c.cancel} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0046 :92 | button / ConnectionFlow | {c.disconnect} | onClick={()=&gt;service.run(()=&gt;{setConnected(false);setStage('entry');service.setMessage(c.disconnected);})} |
| UI0047 :92 | button / ConnectionFlow | {c.keep} | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0048 :95 | summary / ConnectionsFlow | {c.connections} | (native form/control behavior) |
| UI0049 :100 | summary / RestoreAccessFlow | Restore access | (native form/control behavior) |
| UI0050 :100 | input / RestoreAccessFlow | {c.email} | onChange={e=&gt;setEmail(e.target.value)} |
| UI0051 :100 | button / RestoreAccessFlow | Request recovery link | onClick={()=&gt;{if(!validRecoveryEmail(email.trim())){service.setMessage(c.invalidEmail);return;}service.run(()=&gt;{setStage('pending');service.setMessage('If this address has recovery set up, check its inbox.');});}} |
| UI0052 :100 | button / RestoreAccessFlow | Check recovery status | onClick={()=&gt;service.run(()=&gt;{setStage('verified');setEmail('');service.setMessage('Access verified. Your existing records are kept.');},true)} |
| UI0053 :100 | button / RestoreAccessFlow | Cancel recovery | onClick={()=&gt;{service.cancel();setStage('entry');}} |
| UI0054 :100 | Link / RestoreAccessFlow | Continue to My Week | href="/foundation/preview/expanded/?tab=plan" |

### components/expanded/AlertCenter.tsx

Contract family: X03.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0055 :37 | button / AlertCenter | {c.all} | onClick={()=&gt;setUnreadOnly(false)} |
| UI0056 :37 | button / AlertCenter | {c.unread} | onClick={()=&gt;setUnreadOnly(true)} |
| UI0057 :37 | button / AlertCenter | {c.markAll} | onClick={inbox.all} |
| UI0058 :38 | select / AlertCenter | {c.filterOptions.map(s=&gt;&lt;option key={s}&gt;{s}&lt;/option&gt;)} | onChange={e=&gt;setFilter(e.target.value)} |
| UI0059 :39 | button / AlertCenter | {item.title} | onClick={()=&gt;setExpanded(expanded===item.id?null:item.id)} |
| UI0060 :39 | a / AlertCenter | {item.source.title} | href={item.source.url} |
| UI0061 :39 | button / AlertCenter | {c.openRelated} | onClick={()=&gt;onOpen(item)} |
| UI0062 :39 | button / AlertCenter | {'${c.markRead}: ${item.title}'} | onClick={()=&gt;inbox.read(item)} |
| UI0063 :39 | button / AlertCenter | {'${c.dismiss}: ${item.title}'} | onClick={()=&gt;inbox.dismiss(item)} |
| UI0064 :41 | button / AlertCenter | {c.undo} | onClick={inbox.restore} |
| UI0065 :42 | button / AlertCenter | (child/component label) | onClick={onSettings} |

### components/expanded/ExpandedConnections.tsx

Contract family: G01 / X01-X06 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0066 :27 | Link / ExpandedConnections | (child/component label) | href={'${href(owner, connection.destination)}&fromFactor=${factor}'} |
| UI0067 :28 | Link / ExpandedConnections | (child/component label) | href={mapHref(connection.layer)} |
| UI0068 :29 | Link / ExpandedConnections | (child/component label) | href={href('plan', 'journal')} |
| UI0069 :30 | HomeFactorRecords / ExpandedConnections | (child/component label) | href={href} |
| UI0070 :32 | Link / ExpandedConnections | Open My Week | href={href('plan')} |
| UI0071 :32 | Link / ExpandedConnections | Review home tests and records | href={href('home', 'tests')} |
| UI0072 :35 | summary / ExpandedConnections | Understand changes in your readings | (native form/control behavior) |
| UI0073 :35 | Link / ExpandedConnections | (child/component label) | href={href('plan')} |
| UI0074 :35 | Link / ExpandedConnections | (child/component label) | href={href('plan', 'journal')} |
| UI0075 :45 | summary / HomeFactorRecords | Your records ( {matches.length} ) | (native form/control behavior) |
| UI0076 :45 | Link / HomeFactorRecords | {record.title} | href={'${href('home', 'tests')}&homeView=detail&record=${encodeURIComponent(record.id)}&fromFactor=${factor}'} |
| UI0077 :45 | Link / HomeFactorRecords | Prepare a {kind} test record | href={'${href('home', 'tests')}&homeView=new&fromFactor=${factor}'} |
| UI0078 :49 | MyWeekWorkspace / ExpandedDestinationPage | (child/component label) | href={href} |
| UI0079 :50 | ExploreWorkspace / ExpandedDestinationPage | (child/component label) | href={href} |
| UI0080 :51 | HomeguardWorkspace / ExpandedDestinationPage | (child/component label) | href={href} |
| UI0081 :52 | Link / ExpandedDestinationPage | Return to Today | href={href('today')} |
| UI0082 :54 | Link / ExpandedDestinationPage | Back to {page.tab === 'home' ? 'Homeguard' : page.tab === 'act' ? 'Explore' : 'My Week'} | href={href(page.tab)} |
| UI0083 :58 | ExploreWorkspace / ExpandedAct | (child/component label) | href={href} |
| UI0084 :62 | MyWeekWorkspace / ExpandedPlan | (child/component label) | href={href} |

### components/expanded/ExpandedLunaPreview.tsx

Contract family: X02.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0085 :13 | LunaConversation / ExpandedLunaPreview | (child/component label) | onClose={onClose} |

### components/expanded/ExpandedPreviewState.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0086 :105 (review control) | input / ExpandedReviewControls | Simulate failed action save | onChange={e =&gt; state.setFail(e.target.checked)} |
| UI0087 :105 (review control) | button / ExpandedReviewControls | Reset sample actions | onClick={state.reset} |
| UI0088 :134 | BottomSheet / ExpandedActionDialog | "expanded-action" | onClose={() =&gt; { if (timer.current) clearTimeout(timer.current); setPending(false); setError(''); state.close(); }} |
| UI0089 :135 | form / ExpandedActionDialog | {exists && &lt;Callout tone="info"&gt;&lt;p&gt;This step is already in My Week. Update the same action here.&lt;/p&gt;&lt;/Callout&gt;} {offline && &lt;Callout tone="notice"&gt;&lt;p&gt;Offline. Your draft | onSubmit={e =&gt; { e.preventDefault(); submit(); }} |
| UI0090 :138 | input / ExpandedActionDialog | Action title | onChange={e =&gt; state.setDraft({ ...draft, title: e.target.value })} |
| UI0091 :140 | DateInput / ExpandedActionDialog | All-day date (optional) | onChange={e =&gt; state.setDraft({ ...draft, date: e.target.value })} |
| UI0092 :145 | Button / ExpandedActionDialog | Close and keep draft | onClick={() =&gt; { setError(''); state.close(); }} |

### components/expanded/ExploreContinuations.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0093 :27 | button / ExploreContinuations | (child/component label) | onClick={() =&gt; project ? go('projects', 'detail', project.id) : engagement ? go('opportunities', 'detail', engagement.id) : openOutcome(outcome!)} |

### components/expanded/ExploreDiscovery.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0094 :47 | button / ExploreAreaChooser | (child/component label) | onClick={() =&gt; { setDraft(area); setEditing(true); }} |
| UI0095 :47 | BottomSheet / ExploreAreaChooser | {'explore-area-${uid}'} | onClose={close} |
| UI0096 :47 | form / ExploreAreaChooser | (child/component label) | onSubmit={event =&gt; { event.preventDefault(); setArea({ place: draft.place.trim(), state: draft.state.trim() }); setLocalAutoScope(); close(); }} |
| UI0097 :47 | input / ExploreAreaChooser | "For example, Charlotte or 28208" | onChange={event =&gt; setDraft({ ...draft, place: event.target.value })} |
| UI0098 :47 | input / ExploreAreaChooser | "For example, North Carolina" | onChange={event =&gt; setDraft({ ...draft, state: event.target.value })} |
| UI0099 :47 | button / ExploreAreaChooser | Use this area | (native form/control behavior) |
| UI0100 :47 | button / ExploreAreaChooser | Clear area | onClick={() =&gt; { setArea(blankArea); setDraft(blankArea); setLocalAutoScope(); close(); }} |
| UI0101 :47 | button / ExploreAreaChooser | Cancel | onClick={close} |
| UI0102 :58 | button / VolunteeringFinder | {'See how to help: ${item.title}'} | onClick={() =&gt; setSelected(item.id)} |
| UI0103 :61 | input / VolunteeringFinder | "Cleanup, trees, gardening..." | onChange={event =&gt; setFilters({ ...filters, search: event.target.value })} |
| UI0104 :61 | select / VolunteeringFinder | {['All interests', 'Cleanup', 'Trees & habitat', 'Gardening', 'Community learning'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setFilters({ ...filters, interest: event.target.value })} |
| UI0105 :61 | select / VolunteeringFinder | (child/component label) | onChange={event =&gt; setFilters({ ...filters, scope: event.target.value })} |
| UI0106 :62 | summary / VolunteeringFinder | (child/component label) | (native form/control behavior) |
| UI0107 :63 | button / VolunteeringFinder | {'See how to help: ${item.title}'} | onClick={() =&gt; setSelected(item.id)} |
| UI0108 :64 | button / VolunteeringFinder | Clear interest and search filters | onClick={() =&gt; setFilters({ ...filters, interest: 'All interests', search: '' })} |
| UI0109 :65 | summary / VolunteeringFinder | Looking outside these reviewed areas? | (native form/control behavior) |
| UI0110 :71 | a / OfficialDiscoveryRoutes | Find a North Carolina Extension center | href="https://www.ces.ncsu.edu/local-county-center/" |
| UI0111 :71 | a / OfficialDiscoveryRoutes | Open official opportunities | href={item.url} |
| UI0112 :71 | button / OfficialDiscoveryRoutes | Keep an opportunity I found | onClick={() =&gt; go('opportunities', 'new')} |
| UI0113 :88 | button / LocalParticipationDetail | All programs and organizations | onClick={back} |
| UI0114 :92 | a / LocalParticipationDetail | Open official participation guide | href={resource.url} |
| UI0115 :93 | summary / LocalParticipationDetail | Joining and preparation instructions | (native form/control behavior) |
| UI0116 :93 | a / LocalParticipationDetail | Open official participation guide | href={resource.url} |
| UI0117 :94 | a / LocalParticipationDetail | View this public address | href={'https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(resource.address)}'} |
| UI0118 :95 | summary / LocalParticipationDetail | My preparation and questions | (native form/control behavior) |
| UI0119 :95 | input / LocalParticipationDetail | {label} | onChange={event =&gt; setPreparation({ ...preparation, [key]: event.target.checked })} |
| UI0120 :95 | textarea / LocalParticipationDetail | "For example, is there a role that does not involve lifting?" | onChange={event =&gt; setPreparation({ ...preparation, questions: event.target.value })} |
| UI0121 :95 | button / LocalParticipationDetail | Plan my participation | onClick={start} |
| UI0122 :95 | button / LocalParticipationDetail | Open my existing draft | onClick={() =&gt; go('opportunities', 'new')} |
| UI0123 :95 | button / LocalParticipationDetail | Replace unfinished draft with this route | onClick={begin} |
| UI0124 :95 | button / LocalParticipationDetail | Cancel | onClick={() =&gt; setReplacing(false)} |
| UI0125 :95 | button / LocalParticipationDetail | Prepare a question for this organizer | onClick={() =&gt; go('outreach')} |
| UI0126 :96 | summary / LocalParticipationDetail | After you help | (native form/control behavior) |
| UI0127 :97 | summary / LocalParticipationDetail | Organization, sources and listing review | (native form/control behavior) |
| UI0128 :97 | a / LocalParticipationDetail | {resource.sourceTitle} | href={resource.url} |
| UI0129 :97 | a / LocalParticipationDetail | {source.title} | href={source.url} |
| UI0130 :97 | textarea / LocalParticipationDetail | Information I would flag for review | onChange={event =&gt; setReviewReason(event.target.value)} |
| UI0131 :97 | button / LocalParticipationDetail | Keep a private listing-review note | onClick={() =&gt; { setFlag(reviewReason.trim()); setReviewReason(''); }} |
| UI0132 :119 | button / CommunityGuide | (child/component label) | onClick={() =&gt; setTopic(item.id)} |
| UI0133 :127 | Link / CommunityGuide | Explore this map layer | href={mapHref(current.id)} |
| UI0134 :127 | button / CommunityGuide | Keep this question in My notes | onClick={() =&gt; { setPrompt(current.question); go('observations', 'new'); }} |
| UI0135 :129 | button / CommunityGuide | Explore practical ways to help | onClick={() =&gt; go('projects')} |
| UI0136 :129 | button / CommunityGuide | Find the right contact | onClick={() =&gt; go('outreach')} |
| UI0137 :130 | Link / CommunityGuide | {topic === 'air' ? 'Continue into Today guidance' : topic === 'water' \|\| topic === 'radon' ? 'Continue into tests and home records' : 'Review my household context'} | href={href(topic === 'air' ? 'today' : 'home', topic === 'water' \|\| topic === 'radon' ? 'tests' : undefined)} |

### components/expanded/ExploreMapPreview.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0138 :23 | select / ExploreMapPreview | {(['water', 'air', 'radon', 'facilities'] as MapLayer[]).map(value =&gt; &lt;option key={value} value={value}&gt;{value[0].toUpperCase() + value.slice(1)}&lt;/option&gt;)} | onChange={event =&gt; setLayer(event.target.value as MapLayer)} |
| UI0139 :24 | Link / ExploreMapPreview | {'Explore the map: open the full ${layer} map'} | href={mapHref(layer)} |
| UI0140 :25 | MapCanvas / ExploreMapPreview | (child/component label) | onViewChange={noInteraction}; onSelect={noInteraction}; onReady={setReady}; onUnavailable={() =&gt; setFailed(true)} |
| UI0141 :28 | summary / ExploreMapPreview | Map sources | (native form/control behavior) |
| UI0142 :28 | a / ExploreMapPreview | Census | href="https://www.census.gov/geographies/mapping-files.html" |
| UI0143 :28 | a / ExploreMapPreview | Natural Earth | href="https://www.naturalearthdata.com/" |

### components/expanded/ExploreNotes.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0144 :28 | button / ExploreNotes | All notes | onClick={() =&gt; go('observations')} |
| UI0145 :33 | button / ExploreNotes | Add a note | onClick={() =&gt; go('observations', 'new')} |
| UI0146 :34 | input / ExploreNotes | "Search your notebook" | onChange={event =&gt; setFilters({ ...filters, search: event.target.value })} |
| UI0147 :34 | select / ExploreNotes | {['All notes', ...types].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setFilters({ ...filters, type: event.target.value })} |
| UI0148 :34 | input / ExploreNotes | Only pinned notes | onChange={event =&gt; setFilters({ ...filters, pinned: event.target.checked })} |
| UI0149 :34 | select / ExploreNotes | {['Active', 'Archived', 'All'].map(value=&gt;&lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setFilters({ ...filters, archive: event.target.value })} |
| UI0150 :35 | button / ExploreNotes | (child/component label) | onClick={() =&gt; go('observations', 'detail', note.id)} |
| UI0151 :36 | button / ExploreNotes | Reset note filters | onClick={() =&gt; setFilters({ search: '', type: 'All notes', pinned: false, archive: 'All' })} |
| UI0152 :43 | button / NoteDetail | All notes | onClick={() =&gt; go('observations')} |
| UI0153 :43 | button / NoteDetail | Edit note | onClick={() =&gt; go('observations', 'edit', record.id)} |
| UI0154 :43 | button / NoteDetail | {record.pinned ? 'Unpin note' : 'Pin note'} | onClick={() =&gt; save({ ...record, pinned: !record.pinned })} |
| UI0155 :43 | a / NoteDetail | Return to this public map record | href={mapHref(item.layer)+'&system='+encodeURIComponent(item.recordId)} |
| UI0156 :43 | summary / NoteDetail | Organize this note | (native form/control behavior) |
| UI0157 :43 | button / NoteDetail | {record.archived ? 'Restore note' : 'Archive note'} | onClick={()=&gt;save({...record,archived:!record.archived})} |
| UI0158 :43 | button / NoteDetail | Choose this note in an outreach draft | onClick={() =&gt; go('outreach')} |
| UI0159 :53 | summary / NoteLuna | Prepare with Luna | (native form/control behavior) |
| UI0160 :53 | select / NoteLuna | {['Clarify my question', 'Find a follow-up', 'Organize my observation'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; { setPurpose(event.target.value); setPreview(''); setConsent(false); }} |
| UI0161 :53 | input / NoteLuna | {label} | onChange={event =&gt; { setSelection({ ...selection, [key]: event.target.checked }); setConsent(false); setPreview(''); }} |
| UI0162 :53 | input / NoteLuna | I choose only these fields for this request | onChange={event =&gt; { setConsent(event.target.checked); setPreview(''); }} |
| UI0163 :53 | button / NoteLuna | Review Luna request | onClick={() =&gt; { setPreview('${purpose}. Do not infer a cause or treat this note as a verified measurement.\n\n${Object.entries(fields).filter(([key]) =&gt; selection[key as keyof typeof selection]).map(([key, value]) =&gt; '${key}: ${value}').join('\n')}'); setPreparedRevision(record.revision); }} |
| UI0164 :66 | button / NoteForm | All notes | onClick={() =&gt; go('observations')} |
| UI0165 :67 | form / NoteForm | {!record && starter && draft.description !== starter && &lt;aside className="ex-notice"&gt;&lt;p&gt;You already have an unfinished draft. Keep your writing, or append the community q | onSubmit={async event =&gt; { event.preventDefault(); if(photoPending){setError('Review or discard the selected photo before saving.');return;} const invalid = fieldNoteError(draft); setError(invalid ?? ''); if (invalid) return; pendingId.current ??= record?.id ?? crypto.randomUUID(); const next = { ...draft, id: pendingId.current }; if (await save(next) && alive.current) { clearDraft(); clearStarter(); clearEvidence(); go('observations', 'detail', next.id); } }} |
| UI0166 :67 | button / NoteForm | Add this question to my draft | onClick={() =&gt; { const description = '${draft.description}\n\n${starter}'.trim(); if (description.length &gt; 3000) { setError('This question will not fit in the current note. Save your writing first, then create a separate question note.'); return; } setDraft({ ...draft, description, evidence: evidenceStarter.recordId ? [...(draft.evidence ?? []).filter(item =&gt; !(item.recordId === evidenceStarter.recordId && item.layer === evidenceStarter.layer)), evidenceStarter] : draft.evidence }); cle |
| UI0167 :67 | button / NoteForm | Keep my draft as it is | onClick={() =&gt; { clearStarter(); clearEvidence(); }} |
| UI0168 :67 | select / NoteForm | {types.map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setDraft({ ...draft, noteType: event.target.value as FieldNote['noteType'] })} |
| UI0169 :67 | input / NoteForm | Title (required) | onChange={event =&gt; setDraft({ ...draft, title: event.target.value })} |
| UI0170 :67 | select / NoteForm | {['Appearance', 'Odor', 'Litter', 'Habitat', 'Other'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setDraft({ ...draft, kind: event.target.value })} |
| UI0171 :67 | input / NoteForm | {observed ? 'Observed date and time (required)' : 'Date and time (optional)'} | onChange={event =&gt; setDraft({ ...draft, observedAt: event.target.value })} |
| UI0172 :67 | input / NoteForm | Timezone | onChange={event =&gt; setDraft({ ...draft, timezone: event.target.value })} |
| UI0173 :67 | input / NoteForm | Coarse place label (optional) | onChange={event =&gt; setDraft({ ...draft, place: event.target.value })} |
| UI0174 :67 | textarea / NoteForm | {observed ? 'Factual description (required)' : 'Your note (required)'} | onChange={event =&gt; setDraft({ ...draft, description: event.target.value })} |
| UI0175 :67 | NotePhotoEditor / NoteForm | {observed && &lt;label&gt;What you noticed&lt;select value={draft.kind} onChange={event =&gt; setDraft({ ...draft, kind: event.target.value })}&gt;{['Appearance', 'Odor', 'Litter', 'Hab | onChange={photo=&gt;setDraft({...draft,photo})}; onPendingChange={setPhotoPending} |
| UI0176 :67 | input / NoteForm | Pin this note | onChange={event =&gt; setDraft({ ...draft, pinned: event.target.checked })} |
| UI0177 :67 | button / NoteForm | Save note | (native form/control behavior) |
| UI0178 :67 | button / NoteForm | Back and keep draft | onClick={() =&gt; go('observations')} |

### components/expanded/ExploreOpportunities.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0179 :27 | button / GetInvolvedPreview | Find opportunities | onClick={() =&gt; go('opportunities')} |
| UI0180 :28 | button / GetInvolvedPreview | "Get involved: find local volunteering and organizations" | onClick={() =&gt; go('opportunities')} |
| UI0181 :49 | input / ExploreOpportunities | "Trees, cleanups, gardening..." | onChange={event =&gt; setFilters({ ...filters, search: event.target.value })} |
| UI0182 :50 | select / ExploreOpportunities | {['All interests', 'Cleanup', 'Trees & habitat', 'Gardening', 'Community learning'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setFilters({ ...filters, interest: event.target.value })} |
| UI0183 :50 | select / ExploreOpportunities | (child/component label) | onChange={event =&gt; setTiming(event.target.value)} |
| UI0184 :51 | button / ExploreOpportunities | {refreshing ? 'Checking...' : 'Refresh listings'} | onClick={() =&gt; { setRefreshing(true); setNotice(''); timer.current = setTimeout(() =&gt; { timer.current = null; setRefreshing(false); setNotice('Listings refreshed. Confirm availability with the organizer.'); }, 850); }} |
| UI0185 :52 | summary / ExploreOpportunities | Location and source coverage | (native form/control behavior) |
| UI0186 :52 | select / ExploreOpportunities | (child/component label) | onChange={event =&gt; setFilters({ ...filters, scope: event.target.value })} |
| UI0187 :54 | button / ExploreOpportunities | (child/component label) | onClick={() =&gt; setSelected(item.id)} |
| UI0188 :56 | button / ExploreOpportunities | Clear interest and date filters | onClick={() =&gt; { setTiming('all'); setFilters({ ...filters, interest: 'All interests', search: '' }); }} |
| UI0189 :57 | summary / ExploreOpportunities | Organizations and other ways to help | (native form/control behavior) |
| UI0190 :74 | button / OpportunityDetail | All opportunities | onClick={back} |
| UI0191 :84 | a / OpportunityDetail | {available ? 'Check details & registration' : 'Open official organizer page'} | href={item.url} |
| UI0192 :86 | summary / OpportunityDetail | Preparation and access details | (native form/control behavior) |
| UI0193 :87 | button / OpportunityDetail | Plan my participation | onClick={() =&gt; draft.title \|\| draft.preparation ? setReplace(true) : prepare()} |
| UI0194 :88 | button / OpportunityDetail | Open my existing draft | onClick={() =&gt; go('opportunities', 'new')} |
| UI0195 :88 | button / OpportunityDetail | Replace unfinished draft with this opportunity | onClick={prepare} |
| UI0196 :88 | button / OpportunityDetail | Cancel | onClick={() =&gt; setReplace(false)} |
| UI0197 :89 | summary / OpportunityDetail | Source and availability | (native form/control behavior) |
| UI0198 :89 | a / OpportunityDetail | Original source | href={item.url} |

### components/expanded/ExploreOutcome.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0199 :25 | button / ExploreOutcome | {record ? 'Record an update' : 'Set my goal and next step'} | onClick={() =&gt; { setDraft(record ?? draft); setEditing(true); setError(''); }} |
| UI0200 :25 | form / ExploreOutcome | {error && &lt;p role="alert"&gt;{error}&lt;/p&gt;} | onSubmit={async event =&gt; { event.preventDefault(); const invalid = outcomeError(draft); setError(invalid ?? ''); if (invalid) return; const history = [...(record?.history ?? []), { status: draft.status, date: draft.date, result: draft.result }]; if (await collection.save({ ...draft, history })) { clear(); setEditing(false); } }} |
| UI0201 :29 | textarea / ExploreOutcome | Answer or result I want | onChange={event =&gt; setDraft({ ...draft, goal: event.target.value })} |
| UI0202 :29 | select / ExploreOutcome | {['Open', 'Working on it', 'Waiting for a response', 'Result recorded', 'Closed without a result'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setDraft({ ...draft, status: event.target.value as OutcomeRecord['status'] })} |
| UI0203 :29 | DateInput / ExploreOutcome | Update date | onChange={event =&gt; setDraft({ ...draft, date: event.target.value })} |
| UI0204 :29 | textarea / ExploreOutcome | "For example, I received the dated water report and reviewed its coverage." | onChange={event =&gt; setDraft({ ...draft, result: event.target.value })} |
| UI0205 :29 | input / ExploreOutcome | Reference or reply identifier (optional) | onChange={event =&gt; setDraft({ ...draft, reference: event.target.value })} |
| UI0206 :29 | textarea / ExploreOutcome | My next step | onChange={event =&gt; setDraft({ ...draft, nextStep: event.target.value })} |
| UI0207 :29 | DateInput / ExploreOutcome | Check-back date (optional) | onChange={event =&gt; setDraft({ ...draft, followupDate: event.target.value })} |
| UI0208 :29 | button / ExploreOutcome | Save my update | (native form/control behavior) |
| UI0209 :29 | button / ExploreOutcome | Keep draft for later | onClick={() =&gt; setEditing(false)} |
| UI0210 :30 | summary / ExploreOutcome | My update history | (native form/control behavior) |
| UI0211 :30 | button / ExploreOutcome | {exporting ? 'Close record export' : 'Review my record for export'} | onClick={() =&gt; setExporting(!exporting)} |

### components/expanded/ExploreOutreach.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0212 :60 | select / ExploreOutreach | {['Drinking water', 'Air & outdoor conditions', 'A home concern', 'Parks & public spaces', 'Volunteering', 'Another community question'].map(value =&gt; &lt;option key={value}&gt; | onChange={event =&gt; { setTopic(event.target.value); setCandidate(false); invalidate(); }} |
| UI0213 :60 | button / ExploreOutreach | {item} | onClick={() =&gt; { setRecipient(item); setCandidate(false); invalidate(); }} |
| UI0214 :60 | a / ExploreOutreach | {route.label} | href={route.url} |
| UI0215 :61 | summary / ExploreOutreach | Find a contact for my area | (native form/control behavior) |
| UI0216 :61 | button / ExploreOutreach | Find a contact | onClick={() =&gt; setCandidate(true)} |
| UI0217 :62 | summary / ExploreOutreach | Recipient details | (native form/control behavior) |
| UI0218 :62 | input / ExploreOutreach | Office or contact name (optional) | onChange={event =&gt; updateContact({ name: event.target.value, reviewed: false })} |
| UI0219 :62 | input / ExploreOutreach | "Use a publicly listed address" | onChange={event =&gt; updateContact({ email: event.target.value, reviewed: false })} |
| UI0220 :62 | input / ExploreOutreach | I checked the recipient and their service area | onChange={event =&gt; updateContact({ reviewed: event.target.checked })} |
| UI0221 :64 | summary / ExploreOutreach | Template and water context | (native form/control behavior) |
| UI0222 :64 | select / ExploreOutreach | {['Utility', 'Private well', 'Private spring'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; { setWater(event.target.value); invalidate(); }} |
| UI0223 :64 | select / ExploreOutreach | "Purpose" | onChange={event =&gt; setPurpose(event.target.value)} |
| UI0224 :64 | button / ExploreOutreach | Reset this draft | onClick={() =&gt; setReset(true)} |
| UI0225 :64 | input / ExploreOutreach | Subject | onChange={event =&gt; { setSubjects({ ...subjects, [active]: event.target.value }); invalidate(); }} |
| UI0226 :64 | textarea / ExploreOutreach | Draft for {active} | onChange={event =&gt; { setDrafts({ ...drafts, [active]: event.target.value }); invalidate(); }} |
| UI0227 :65 | summary / ExploreOutreach | Add context you choose | (native form/control behavior) |
| UI0228 :65 | input / ExploreOutreach | {note.title} | onChange={event =&gt; selectNote(note, event.target.checked)} |
| UI0229 :65 | input / ExploreOutreach | Include the public water context | onChange={event =&gt; { setEvidence(event.target.checked); invalidate(); }} |
| UI0230 :65 | button / ExploreOutreach | Clear selected notes | onClick={() =&gt; { setIncluded({ ...included, [active]: [] }); invalidate(); }} |
| UI0231 :67 | button / ExploreOutreach | Review what you will share | onClick={review} |
| UI0232 :67 | summary / ExploreOutreach | Send with Gmail | (native form/control behavior) |
| UI0233 :67 | button / ExploreOutreach | Connect Gmail | onClick={() =&gt; setConnect(true)} |
| UI0234 :67 | button / ExploreOutreach | Change email setup | onClick={() =&gt; { setConnection(false); setDelivery(''); }} |
| UI0235 :67 | button / ExploreOutreach | Review send | onClick={() =&gt; setConfirm(true)} |
| UI0236 :67 | button / ExploreOutreach | Check attempt status | onClick={() =&gt; { if (reconcileScenario === 'not-submitted') { const next = { ...sentSnapshots }; delete next[signature]; setSentSnapshots(next); setDelivery('not-submitted'); } else { setSentSnapshots({ ...sentSnapshots, [signature]: reconcileScenario }); setDelivery(reconcileScenario); } }} |
| UI0237 :69 | Confirm / ExploreOutreach | "Reset this recipient's draft?" | onCancel={() =&gt; setReset(false)}; onConfirm={() =&gt; { setDrafts({ ...drafts, [active]: outreachTemplate(active, purpose) }); setReset(false); invalidate(); }} |
| UI0238 :70 | Confirm / ExploreOutreach | "Connect Gmail" | onCancel={() =&gt; setConnect(false)}; onConfirm={() =&gt; { setConnection(true); setConnect(false); }} |
| UI0239 :71 | Confirm / ExploreOutreach | "Review this send" | onCancel={() =&gt; setConfirm(false)}; onConfirm={() =&gt; { setConfirm(false); if (!emailReady \|\| !connection \|\| duplicate \|\| uncertain \|\| workspace.scenario === 'offline') { setDelivery('failed'); return; } const outcome = ['save-error', 'conflict'].includes(workspace.scenario) ? 'failed' : sendScenario; setDelivery(outcome); if (outcome === 'submitted' \|\| outcome === 'unknown') setSentSnapshots({ ...sentSnapshots, [signature]: outcome }); }} |

### components/expanded/ExploreProjects.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0240 :47 | button / ExploreProjects | Make these fit me | onClick={() =&gt; generation.setFitOpen(true)} |
| UI0241 :49 | summary / ExploreProjects | My projects ( {collection.records.length} ) | (native form/control behavior) |
| UI0242 :49 | button / ExploreProjects | {item.title} · {item.status} | onClick={() =&gt; go('projects', 'detail', item.id)} |
| UI0243 :50 | input / ExploreProjects | "Find an idea in this set" | onChange={event =&gt; setQuery(event.target.value)} |
| UI0244 :50 | select / ExploreProjects | {projectGuideCauses.map(item =&gt; &lt;option key={item}&gt;{item}&lt;/option&gt;)} | onChange={event =&gt; setCause(event.target.value)} |
| UI0245 :50 | button / ExploreProjects | Refresh ideas | onClick={() =&gt; generation.regenerate()} |
| UI0246 :53 | button / ExploreProjects | Show all projects | onClick={() =&gt; { setQuery(''); setCause('All projects'); generation.regenerate(defaultProjectConstraints, ''); }} |
| UI0247 :58 | button / ExploreProjects | All projects | onClick={() =&gt; go('projects')} |
| UI0248 :83 | button / ExploreProjects | All projects | onClick={() =&gt; go('projects')} |
| UI0249 :87 | summary / ExploreProjects | Purpose and fit | (native form/control behavior) |
| UI0250 :88 | button / ExploreProjects | Start my project workspace | onClick={() =&gt; collection.save({ id: project.id, title: project.title, revision: 0, status: 'Active', goal: project.purpose, stepNotes: {}, outcome: '', reviewDate: '', history: [{ status: 'Active', note: 'I chose to start guide ${project.version}.' }] })} |
| UI0251 :88 | button / ExploreProjects | {paused ? &lt;Play size={16} aria-hidden="true" /&gt; : &lt;Pause size={16} aria-hidden="true" /&gt;} {paused ? 'Resume project' : 'Pause project'} | onClick={() =&gt; collection.save({ ...record, status: paused ? 'Active' : 'Paused', history: [...record.history, { status: paused ? 'Active' : 'Paused', note: paused ? 'I resumed my project.' : 'I paused my project.' }] })} |
| UI0252 :90 | summary / ExploreProjects | Materials, permissions and safety | (native form/control behavior) |
| UI0253 :92 | summary / ExploreProjects | {project.buildPlan.title} | (native form/control behavior) |
| UI0254 :92 | a / ExploreProjects | Open the measured source diagrams | href={project.sources.find(item =&gt; item.id === project.buildPlan?.sourceId)?.url} |
| UI0255 :99 | a / ExploreProjects | {item.publisher} : {item.title} | href={item.url} |
| UI0256 :100 | button / ExploreProjects | "Previous project step" | onClick={() =&gt; openStep(current - 1)} |
| UI0257 :100 | button / ExploreProjects | "Next project step" | onClick={() =&gt; openStep(current + 1)} |
| UI0258 :102 | button / ExploreProjects | {action.state === 'completed' ? 'Reopen this step' : 'Mark this step completed'} | onClick={() =&gt; state?.changeState(action.id, action.state === 'completed' ? 'saved' : 'completed')} |
| UI0259 :102 | button / ExploreProjects | {action.state === 'waiting' ? 'Resume saved step' : 'Mark this step waiting'} | onClick={() =&gt; state?.changeState(action.id, action.state === 'waiting' ? 'saved' : 'waiting')} |
| UI0260 :103 | summary / ExploreProjects | Add a step note | (native form/control behavior) |
| UI0261 :103 | textarea / ExploreProjects | What I did or learned at this step | onChange={event =&gt; setNotes({ ...notes, [current]: event.target.value })} |
| UI0262 :103 | button / ExploreProjects | Save this step note | onClick={() =&gt; collection.save({ ...record, stepNotes: { ...record.stepNotes, [current]: notes[String(current)] ?? record.stepNotes[String(current)] ?? '' } })} |
| UI0263 :106 | summary / ExploreProjects | Read the whole guide | (native form/control behavior) |
| UI0264 :106 | button / ExploreProjects | Work on step {index + 1} | onClick={() =&gt; { openStep(index); document.querySelector('.ex-guide-current-step')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }} |
| UI0265 :107 | summary / ExploreProjects | Choose steps for My Week | (native form/control behavior) |
| UI0266 :107 | input / ExploreProjects | (child/component label) | onChange={event =&gt; setSelected(event.target.checked ? [...validSelected, index].sort((a, b) =&gt; a - b) : validSelected.filter(item =&gt; item !== index))} |
| UI0267 :107 | DateInput / ExploreProjects | Initial check-back date (optional) | onChange={event =&gt; setSchedule(event.target.value)} |
| UI0268 :107 | button / ExploreProjects | Review selected steps for My Week | onClick={() =&gt; { if (schedule && !validDay(schedule)) { setError('Choose a valid check-back date.'); return; } setError(''); setConfirmBundle(true); }} |
| UI0269 :109 | summary / ExploreProjects | Record the result and follow-up | (native form/control behavior) |
| UI0270 :109 | textarea / ExploreProjects | My project result | onChange={event =&gt; { setOutcome(event.target.value); setResultError(null); }} |
| UI0271 :109 | button / ExploreProjects | Record project completion | onClick={recordCompletion} |
| UI0272 :110 | summary / ExploreProjects | My project history | (native form/control behavior) |
| UI0273 :112 | summary / ExploreProjects | Related actions | (native form/control behavior) |
| UI0274 :112 | Link / ExploreProjects | {project.cause === 'Air' ? 'Open air and outdoor readings' : project.cause === 'Water' ? 'Continue into tests and home records' : 'Open Food and Garden in Homeguard'} | href={project.cause === 'Air' ? href('today') : href('home', project.cause === 'Water' ? 'tests' : 'food')} |
| UI0275 :112 | button / ExploreProjects | Prepare a question for a qualified resource | onClick={() =&gt; go('outreach')} |
| UI0276 :112 | button / ExploreProjects | Keep a project observation | onClick={() =&gt; go('observations', 'new')} |
| UI0277 :112 | button / ExploreProjects | Find an organizer | onClick={() =&gt; go('opportunities')} |
| UI0278 :113 | Confirm / ExploreProjects | "Add these steps to My Week?" | onCancel={() =&gt; setConfirmBundle(false)}; onConfirm={() =&gt; { if (disabled \|\| paused \|\| ['save-error', 'conflict'].includes(workspace.scenario) \|\| !state?.addActions(seeds, schedule)) { setError('Could not save the plan. Your choices are kept.'); setConfirmBundle(false); return; } setConfirmBundle(false); setError('Selected steps are in My Week. Existing actions were kept unchanged.'); }} |
| UI0279 :118 | summary / GuideSources | Sources and guide limits | (native form/control behavior) |
| UI0280 :118 | a / GuideSources | {item.publisher} : {item.title} | href={item.url} |
| UI0281 :172 | button / PersonalizedProjectsPreview | See all {generation.batch.items.length} | onClick={() =&gt; go('projects')} |
| UI0282 :173 | button / PersonalizedProjectsPreview | (child/component label) | onClick={() =&gt; go('projects', 'detail', lead.id)} |
| UI0283 :173 | button / PersonalizedProjectsPreview | Adjust my project choices | onClick={() =&gt; go('projects')} |
| UI0284 :174 | button / PersonalizedProjectsPreview | "Refresh project ideas" | onClick={() =&gt; generation.regenerate()} |
| UI0285 :174 | button / PersonalizedProjectsPreview | "Add interests or preferences" | onClick={() =&gt; go('projects')} |
| UI0286 :182 | button / SuggestedProject | (child/component label) | onClick={() =&gt; go('projects', 'detail', item.id)} |
| UI0287 :183 | summary / SuggestedProject | Why this idea? | (native form/control behavior) |
| UI0288 :189 | form / ProjectInterestInput | (child/component label) | onSubmit={event =&gt; { event.preventDefault(); if (request.trim()) generation.regenerate({ ...generation.batch.constraints, count: 3 }, request.trim().replace(/\u2014/g, ','), true); }} |
| UI0289 :190 | textarea / ProjectInterestInput | "A solar experiment, native plants, or something to try with friends..." | onChange={event =&gt; setRequest(event.target.value)} |
| UI0290 :191 | button / ProjectInterestInput | Generate a few ideas | (native form/control behavior) |
| UI0291 :198 | button / ProjectGenerationStatus | Cancel generation | onClick={generation.cancel} |
| UI0292 :200 | button / ProjectGenerationStatus | Retry generation | onClick={generation.retry} |
| UI0293 :206 | summary / GenerationDetails | Generation details and sources | (native form/control behavior) |
| UI0294 :212 | BottomSheet / ProjectFitSheet | "project-fit" | onClose={() =&gt; generation.setFitOpen(false)} |
| UI0295 :212 | form / ProjectFitSheet | (child/component label) | onSubmit={event =&gt; { event.preventDefault(); generation.regenerate(draft.constraints, draft.request, false, clearDraft); generation.setFitOpen(false); }} |
| UI0296 :213 | select / ProjectFitSheet | (child/component label) | onChange={event =&gt; change('space', event.target.value as ProjectConstraints['space'])} |
| UI0297 :214 | select / ProjectFitSheet | (child/component label) | onChange={event =&gt; change('mode', event.target.value as ProjectConstraints['mode'])} |
| UI0298 :215 | select / ProjectFitSheet | (child/component label) | onChange={event =&gt; change('time', event.target.value as ProjectConstraints['time'])} |
| UI0299 :216 | select / ProjectFitSheet | (child/component label) | onChange={event =&gt; change('budget', event.target.value as ProjectConstraints['budget'])} |
| UI0300 :217 | select / ProjectFitSheet | {[3, 5, 10, 11, 12, 13, 14, 15].map(count =&gt; &lt;option key={count} value={count}&gt;{count} ideas&lt;/option&gt;)} | onChange={event =&gt; change('count', Number(event.target.value) as ProjectConstraints['count'])} |
| UI0301 :218 | textarea / ProjectFitSheet | "For example, a small solar experiment or something I can do with friends" | onChange={event =&gt; setDraft(previous =&gt; ({ ...previous, request: event.target.value }))} |
| UI0302 :218 | button / ProjectFitSheet | Generate my project ideas | (native form/control behavior) |
| UI0303 :218 | button / ProjectFitSheet | Keep current ideas | onClick={() =&gt; generation.setFitOpen(false)} |

### components/expanded/ExploreShared.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0304 :11 | button / SaveExplore | {saved ? 'Open saved action' : 'Save to My Week'} | onClick={() =&gt; state?.open(saved ?? { key, title, reason, origin: 'Explore', date })} |
| UI0305 :20 | button / ShareTools | Copy | onClick={copy} |
| UI0306 :20 | button / ShareTools | Share | onClick={share} |
| UI0307 :20 | button / ShareTools | Download text | onClick={download} |
| UI0308 :20 | button / ShareTools | Print | onClick={print} |

### components/expanded/ExploreVisuals.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0309 :13 | Image / ExplorePhoto | (child/component label) | onError={() =&gt; setFailedScene(scene)} |
| UI0310 :19 | summary / ExplorePhotoCredits | About the photos | (native form/control behavior) |
| UI0311 :19 | a / ExplorePhotoCredits | {photo.title} | href={photo.source} |
| UI0312 :19 | a / ExplorePhotoCredits | {photo.license} | href={photo.licenseUrl} |

### components/expanded/ExploreVolunteer.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0313 :20 | button / VolunteerCommitments | Back to Volunteer | onClick={() =&gt; go('opportunities')} |
| UI0314 :24 | button / VolunteerCommitments | Add my own opportunity | onClick={() =&gt; go('opportunities', 'new')} |
| UI0315 :24 | select / VolunteerCommitments | {['Active', 'Closed', 'All'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setFilter(event.target.value)} |
| UI0316 :24 | button / VolunteerCommitments | {item.date && &lt;small&gt;&lt;CalendarDays size={14} aria-hidden="true" /&gt; {item.date}, reported by you&lt;/small&gt;} | onClick={() =&gt; go('opportunities', 'detail', item.id)} |
| UI0317 :30 | button / CommitmentDetail | All volunteering routes | onClick={() =&gt; go('opportunities')} |
| UI0318 :30 | a / CommitmentDetail | Review organizer information | href={url} |
| UI0319 :30 | button / CommitmentDetail | Update my commitment | onClick={() =&gt; go('opportunities', 'edit', record.id)} |
| UI0320 :30 | button / CommitmentDetail | Keep what I learned in My notes | onClick={() =&gt; go('observations', 'new')} |
| UI0321 :30 | summary / CommitmentDetail | My commitment history | (native form/control behavior) |
| UI0322 :30 | button / CommitmentDetail | {exporting ? 'Close participation export' : 'Review my participation for export'} | onClick={() =&gt; setExporting(!exporting)} |
| UI0323 :39 | form / CommitmentForm | {error && &lt;p role="alert"&gt;{error}&lt;/p&gt;} | onSubmit={async event =&gt; { event.preventDefault(); const invalid = engagementError(draft); setError(invalid ?? ''); if (invalid) return; identity.current \|\|= crypto.randomUUID(); const history = [...(record?.history ?? []), { status: draft.status, date: draft.statusDate, note: draft.outcome }]; if (await save({ ...draft, id: identity.current, history }) && alive.current) { clear(); go('opportunities', 'detail', identity.current); } }} |
| UI0324 :39 | input / CommitmentForm | Opportunity name (required) | onChange={event =&gt; setDraft({ ...draft, title: event.target.value })} |
| UI0325 :39 | input / CommitmentForm | Organizer (required) | onChange={event =&gt; setDraft({ ...draft, organizer: event.target.value })} |
| UI0326 :39 | select / CommitmentForm | {['Water', 'Habitats', 'Public spaces', 'Community learning', 'Other'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setDraft({ ...draft, cause: event.target.value })} |
| UI0327 :39 | input / CommitmentForm | Official organizer link (optional) | onChange={event =&gt; setDraft({ ...draft, url: event.target.value })} |
| UI0328 :39 | input / CommitmentForm | Place label (optional, private) | onChange={event =&gt; setDraft({ ...draft, place: event.target.value })} |
| UI0329 :39 | DateInput / CommitmentForm | Activity date (optional) | onChange={event =&gt; setDraft({ ...draft, date: event.target.value })} |
| UI0330 :39 | textarea / CommitmentForm | My preparation and access questions | onChange={event =&gt; setDraft({ ...draft, preparation: event.target.value })} |
| UI0331 :39 | select / CommitmentForm | {['Considering', 'Contacted', 'Confirmed by me', 'Participated', 'Follow-up', 'Closed'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setDraft({ ...draft, status: event.target.value as Engagement['status'] })} |
| UI0332 :39 | DateInput / CommitmentForm | Date I participated (optional) | onChange={event =&gt; setDraft({ ...draft, participatedOn: event.target.value })} |
| UI0333 :39 | DateInput / CommitmentForm | Date of this update | onChange={event =&gt; setDraft({ ...draft, statusDate: event.target.value })} |
| UI0334 :39 | textarea / CommitmentForm | What I actually did or learned | onChange={event =&gt; setDraft({ ...draft, outcome: event.target.value })} |
| UI0335 :39 | input / CommitmentForm | Hours (optional, self-reported) | onChange={event =&gt; setDraft({ ...draft, hours: event.target.value })} |
| UI0336 :39 | input / CommitmentForm | Organizer reference (optional, reported by me) | onChange={event =&gt; setDraft({ ...draft, reference: event.target.value })} |
| UI0337 :39 | DateInput / CommitmentForm | Follow-up date (optional) | onChange={event =&gt; setDraft({ ...draft, followupDate: event.target.value })} |
| UI0338 :39 | button / CommitmentForm | Save my commitment | (native form/control behavior) |
| UI0339 :39 | button / CommitmentForm | Back and keep commitment draft | onClick={() =&gt; go('opportunities')} |

### components/expanded/ExploreWorkspace.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0340 :36 | button / ExploreWorkspace | "Back to Explore" | onClick={() =&gt; go()} |
| UI0341 :38 | button / ExploreWorkspace | "Open my notes" | onClick={() =&gt; go('observations')} |
| UI0342 :38 | ExploreResources / ExploreWorkspace | {section !== 'observations' && &lt;button className="ex-notebook-entry" onClick={() =&gt; go('observations')} aria-label="Open my notes"&gt;&lt;NotebookPen size={20} aria-hidden="tru | href={href} |
| UI0343 :44 | button / ExploreWorkspace | Try again | onClick={() =&gt; workspace.setScenario('ready')} |
| UI0344 :45 | summary / ExploreWorkspace | My volunteering | (native form/control behavior) |
| UI0345 :46 | ExploreProjects / ExploreWorkspace | {id} | href={href} |
| UI0346 :47 | CommunityGuide / ExploreWorkspace | (child/component label) | href={href} |
| UI0347 :62 | button / ExploreOverview | "Understand your community: water, air and public records" | onClick={() =&gt; go('community')} |
| UI0348 :77 | details / ExploreResources | (child/component label) | onToggle={event =&gt; setOpen(event.currentTarget.open)} |
| UI0349 :77 | summary / ExploreResources | "Explore resources" | (native form/control behavior) |
| UI0350 :77 | button / ExploreResources | Ask a question | onClick={() =&gt; { close(); go('outreach'); }} |
| UI0351 :77 | Link / ExploreResources | My saved next steps {saved.length &gt; 0 && &lt;span&gt;{saved.length}&lt;/span&gt;} | href={href('plan')}; onClick={close} |
| UI0352 :77 | Link / ExploreResources | Household summary | href={href('home', 'summary')}; onClick={close} |
| UI0353 :88 (review control) | select / ExploreReviewControls | {['ready','no-source','unavailable','unconfigured','rate-limit','slow'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setLunaState(event.target.value)} |
| UI0354 :90 (review control) | input / ExploreReviewControls | Simulate project preparation save failure | onChange={event =&gt; setFailPreparation(event.target.checked)} |
| UI0355 :91 (review control) | select / ExploreReviewControls | {['ready','failed','slow'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; setGenerationState(event.target.value)} |
| UI0356 :92 (review control) | select / ExploreReviewControls | {['ready', 'empty', 'loading', 'error', 'offline', 'stale', 'conflict', 'save-error'].map(value =&gt; &lt;option key={value} value={value}&gt;{value.replace('-', ' ')}&lt;/option&gt;)} | onChange={event =&gt; workspace.setScenario(event.target.value as typeof workspace.scenario)} |
| UI0357 :93 (review control) | select / ExploreReviewControls | (child/component label) | onChange={event =&gt; setSendScenario(event.target.value)} |
| UI0358 :94 (review control) | select / ExploreReviewControls | (child/component label) | onChange={event =&gt; setReconcile(event.target.value)} |

### components/expanded/HomeOverviewWorkspace.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0359 :23 | Link / TestContinuation | "Continue test" | href={href} |
| UI0360 :23 | summary / TestContinuation | "Stages recorded" | (native form/control behavior) |
| UI0361 :55 | details / HomeOverviewWorkspace | (child/component label) | onToggle={event =&gt; setAddOpen(event.currentTarget.open)} |
| UI0362 :55 | summary / HomeOverviewWorkspace | "Add a home record" | (native form/control behavior) |
| UI0363 :55 | Link / HomeOverviewWorkspace | Plan a test | href={link('tests','new')}; onClick={closeAdd} |
| UI0364 :55 | Link / HomeOverviewWorkspace | Add a report | href={link('tests','report')}; onClick={closeAdd} |
| UI0365 :55 | Link / HomeOverviewWorkspace | Add routine | href={link('maintenance','create')}; onClick={closeAdd} |
| UI0366 :55 | Link / HomeOverviewWorkspace | Record moisture | href={link('maintenance','observation')}; onClick={closeAdd} |
| UI0367 :56 | button / HomeOverviewWorkspace | Try again | onClick={() =&gt; workspace.setScenario('ready')} |
| UI0368 :62 | Link / HomeOverviewWorkspace | "Open test records" | href={link('tests')} |
| UI0369 :63 | Link / HomeOverviewWorkspace | "Open home care" | href={link('maintenance')} |
| UI0370 :64 | Link / HomeOverviewWorkspace | "Open Food and Garden" | href={link('food')} |
| UI0371 :65 | Link / HomeOverviewWorkspace | {lastSummary ? 'Create a new summary' : 'Create summary'} | href={link('summary', 'selection')} |
| UI0372 :67 | summary / HomeOverviewWorkspace | Quick access | (native form/control behavior) |
| UI0373 :70 | TestContinuation / HomeOverviewWorkspace | (child/component label) | href={link('tests','detail',currentTest.id)} |
| UI0374 :74 | Link / HomeOverviewWorkspace | (child/component label) | href={link('maintenance', 'detail', nextRoutine.id)} |
| UI0375 :74 | Link / HomeOverviewWorkspace | (child/component label) | href={link('maintenance', 'observation-detail', recentObservation.id)} |
| UI0376 :78 | Link / HomeOverviewWorkspace | {label} | href={link('food', view)} |
| UI0377 :79 | Link / HomeOverviewWorkspace | {'Continue with ${gardens[0].title}'} | href={link('food', 'garden-detail', gardens[0].id)} |
| UI0378 :81 | Link / HomeOverviewWorkspace | "View saved home tasks in My Week" | href={href('plan')} |

### components/expanded/HomepageHub.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0379 :50 | button / HomepageHub | (child/component label) | onClick={()=&gt;show('attention')} |
| UI0380 :51 | button / HomepageHub | (child/component label) | onClick={()=&gt;show('prepare')} |
| UI0381 :52 | button / HomepageHub | "Your week in motion" | onClick={()=&gt;show('recap')} |
| UI0382 :54 | Link / HomepageHub | Explore | href={href('act')} |
| UI0383 :54 | button / HomepageHub | Repeating plans | onClick={()=&gt;show('repeat')} |
| UI0384 :54 | button / HomepageHub | Reminders | onClick={()=&gt;show('reminders')} |
| UI0385 :55 | BottomSheet / HomepageHub | "homepage-hub" | onClose={close} |
| UI0386 :57 | WeekUpdateList / HomepageHub | (child/component label) | onOpen={openTask} |
| UI0387 :57 | button / HomepageHub | {item.title} | onClick={()=&gt;openTask(actions.find(a=&gt;a.id===item.actionId)!)} |
| UI0388 :57 | Link / HomepageHub | {item.title} | href={item.record?weekRecordHref(item.record,href):routeLink(item.route!)} |
| UI0389 :57 | Link / HomepageHub | Find something to work on | href={href('act','projects')} |
| UI0390 :58 | button / HomepageHub | Previous week | onClick={()=&gt;setRecapDay(dayAdd(recapDay,-7))} |
| UI0391 :58 | button / HomepageHub | Next week | onClick={()=&gt;setRecapDay(dayAdd(recapDay,7))} |
| UI0392 :58 | Link / HomepageHub | Review volunteering | href={href('act','opportunities')} |
| UI0393 :58 | button / HomepageHub | (child/component label) | onClick={()=&gt;openTask(a)} |
| UI0394 :58 | Link / HomepageHub | Open seasonal review | href={href('plan','recap')} |
| UI0395 :59 | select / HomepageHub | "Prepare for" | onChange={e=&gt;selectPlan(plans.find(p=&gt;p.id===e.target.value)!)} |
| UI0396 :59 | a / HomepageHub | Find this place in Google Maps | href={meetingMapLink(selected.place)!} |
| UI0397 :59 | a / HomepageHub | Review original instructions | href={selected.url} |
| UI0398 :59 | summary / HomepageHub | Instructions & preparation | (native form/control behavior) |
| UI0399 :59 | button / HomepageHub | Review updated preparation | onClick={()=&gt;selectPlan(selected)} |
| UI0400 :59 | input / HomepageHub | {check} | onChange={e=&gt;setPreparation(old=&gt;old?{...old,checks:e.target.checked?[...new Set([...old.checks,check])]:old.checks.filter(c=&gt;c!==check)}:old)} |
| UI0401 :59 | button / HomepageHub | Save preparation checks | onClick={savePreparation} |
| UI0402 :59 | button / HomepageHub | Review schedule & reminder | onClick={()=&gt;openTask(selected.action!)} |
| UI0403 :59 | Link / HomepageHub | Open original plan | href={routeLink(selected.route)} |
| UI0404 :59 | Link / HomepageHub | Check available conditions | href={href('plan','outdoors')} |
| UI0405 :59 | Link / HomepageHub | Find a community opportunity | href={href('act','opportunities')} |
| UI0406 :59 | Link / HomepageHub | Plan some time outdoors | href={href('plan','outdoors')} |
| UI0407 :60 | input / HomepageHub | Request automatic next occurrences | onChange={e=&gt;setRepeatDraft({...repeatDraft,[a.key.replace(/:occurrence:.*$/,'')]:e.target.checked})} |
| UI0408 :60 | button / HomepageHub | Review this repeating task | onClick={()=&gt;openTask(a)} |
| UI0409 :60 | button / HomepageHub | Save repeat preferences | onClick={saveRepeats} |
| UI0410 :60 | Link / HomepageHub | Review home-care routines | href={href('home','maintenance')} |
| UI0411 :61 | button / HomepageHub | (child/component label) | onClick={()=&gt;openTask(a)} |
| UI0412 :61 | Link / HomepageHub | Open notification settings | href={href('settings')} |
| UI0413 :62 | button / HomepageHub | Done | onClick={close} |

### components/expanded/LearnLibrary.tsx

Contract family: X01.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0414 :21 | input / LearnLibrary | {c.search} | onChange={e=&gt;setQuery(e.target.value)} |
| UI0415 :22 | select / LearnLibrary | {factorKeys.map(key=&gt;&lt;option key={key} value={key}&gt;{LEARN_CONTENT[key].title}&lt;/option&gt;)} | onChange={e=&gt;setFilter(e.target.value)} |
| UI0416 :23 | button / LearnLibrary | {c.clear} | onClick={()=&gt;setQuery('')} |
| UI0417 :24 | button / LearnLibrary | {c.catalogRetry} | onClick={()=&gt;setScenario('ready')} |
| UI0418 :26 | details / LearnLibrary | {factorHref&&&lt;Link className="hp-link-row" href={factorHref(key)}&gt;&lt;span&gt;{c.openGuide}&lt;/span&gt;&lt;ArrowUpRight size={16}/&gt;&lt;/Link&gt;} {LEARN_CONTENT[key].sources.map((source:{url | onToggle={e=&gt;{if(e.currentTarget.open)setSelected(key);else if(selected===key)setSelected(null);}} |
| UI0419 :26 | summary / LearnLibrary | {LEARN_CONTENT[key].title} | (native form/control behavior) |
| UI0420 :26 | Link / LearnLibrary | (child/component label) | href={factorHref(key)} |
| UI0421 :26 | a / LearnLibrary | {clean(source.label)} | href={source.url} |
| UI0422 :27 | summary / LearnLibrary | {term.title} | (native form/control behavior) |
| UI0423 :27 | Link / LearnLibrary | {c.openGuide} | href={factorHref(term.related)} |

### components/expanded/LunaActionReviewControls.tsx

Contract family: X02.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0424 :10 (review control) | select / LunaActionReviewControls | (child/component label) | onChange={event =&gt; setOutcome(event.target.value)} |
| UI0425 :11 (review control) | select / LunaActionReviewControls | (child/component label) | onChange={event =&gt; setCheck(event.target.value)} |

### components/expanded/LunaConversation.tsx

Contract family: X02.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0426 :359 | button / review | Check status | onClick={() =&gt; { if (actionCheck !== 'resolved') changeProposal(message.id, current =&gt; ({ ...current, error: lunaCopy.unknownRetained })); else changeProposal(message.id, current =&gt; ({ ...current, outcomeUnknown: false, status: current.writeApplied ? 'applied' : 'review', error: current.writeApplied ? undefined : lunaCopy.noWrite })); }} |
| UI0427 :367 | button / review | {operation === 'delete' ? 'Open My Week' : 'Open task'} | onClick={() =&gt; go('plan', undefined, undefined, operation === 'delete' ? undefined : task.id)} |
| UI0428 :373 | input / review | Task title | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'task-change' ? { ...current, change: { ...current.change, title: event.target.value }, error: undefined } : current)} |
| UI0429 :374 | DateInput / review | All-day date | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'task-change' ? { ...current, change: { ...current.change, date: event.target.value }, dateExplanation: 'Date you selected.', error: undefined } : current)} |
| UI0430 :381 | button / review | {busy ? 'Saving...' : confirms[operation]} | onClick={() =&gt; { void execute(message.id, proposal); }} |
| UI0431 :381 | button / review | {operation === 'delete' ? 'No, keep it' : 'Cancel review'} | onClick={() =&gt; changeProposal(message.id, current =&gt; ({ ...current, status: 'cancelled' }))} |
| UI0432 :386 | button / review | Open My Week | onClick={()=&gt;go('plan')} |
| UI0433 :389 | button / review | Open | onClick={() =&gt; proposal.kind === 'start-project' ? go('act', 'projects', 'detail', proposal.guide.id) : go(proposal.kind === 'save-note' ? 'act' : 'plan', proposal.kind === 'save-note' ? 'observations' : undefined, proposal.kind === 'save-note' ? 'detail' : undefined, recordId)} |
| UI0434 :394 | DateInput / review | {'Date for ${item.title}'} | onChange={e=&gt;changeProposal(message.id,p=&gt;p.kind==='week-plan'?{...p,plan:{...p.plan,items:p.plan.items.map(i=&gt;i.id===item.id?{...i,date:e.target.value}:i)},error:undefined}:p)} |
| UI0435 :395 | input / review | Task title | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'create-task' \|\| current.kind === 'move-task' ? { ...current, title: event.target.value, error: undefined } : current)} |
| UI0436 :395 | DateInput / review | All-day date {!proposal.requiresDate && ' (optional)'} | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'create-task' \|\| current.kind === 'move-task' ? { ...current, date: event.target.value, dateExplanation: 'Date you selected.', error: undefined } : current)} |
| UI0437 :396 | input / review | Note title | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'save-note' ? { ...current, record: { ...current.record, title: event.target.value }, error: undefined } : current)} |
| UI0438 :396 | textarea / review | Note text | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'save-note' ? { ...current, record: { ...current.record, description: event.target.value }, error: undefined } : current)} |
| UI0439 :398 | summary / review | Materials and safety checks | (native form/control behavior) |
| UI0440 :398 | input / review | Save preparation to My Week | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'start-project' ? { ...current, savePreparation: event.target.checked } : current)} |
| UI0441 :398 | DateInput / review | Preparation all-day date {!proposal.requiresDate && ' (optional)'} | onChange={event =&gt; changeProposal(message.id, current =&gt; current.kind === 'start-project' ? { ...current, date: event.target.value, error: undefined, dateExplanation: 'Date you selected.' } : current)} |
| UI0442 :400 | button / review | {busy ? 'Saving...' : proposal.kind==='week-plan'?'Apply reviewed plan':proposal.kind === 'delete-note' ? 'Yes, delete' : proposal.kind === 'save-note' ? 'Save note' : pr | onClick={() =&gt; { void execute(message.id, proposal); }} |
| UI0443 :400 | button / review | {proposal.kind === 'delete-note' ? 'No, keep it' : 'Cancel review'} | onClick={() =&gt; changeProposal(message.id, current =&gt; ({ ...current, status: 'cancelled' }))} |
| UI0444 :406 | BottomSheet / LunaConversation | {'luna-conversation-${uid}'} | onClose={() =&gt; { if (!busy && !workspace.pending) { if (pendingRequest) cancelPending(); onClose(); } }} |
| UI0445 :407 | button / LunaConversation | Context &amp; privacy | onClick={() =&gt; setInfo(value =&gt; !value)} |
| UI0446 :408 | summary / LunaConversation | What Luna can do | (native form/control behavior) |
| UI0447 :408 | button / LunaConversation | Manage context in Settings | onClick={() =&gt; go('settings')} |
| UI0448 :410 | button / LunaConversation | {prompt} | onClick={() =&gt; send(prompt)} |
| UI0449 :413 | button / LunaConversation | (child/component label) | onClick={() =&gt; go('act', 'projects', 'detail', project.id)} |
| UI0450 :414 | a / LunaConversation | Official programme information | href={resource.url} |
| UI0451 :414 | button / LunaConversation | Plan how to take part | onClick={() =&gt; go('act', 'opportunities', 'list', resource.id)} |
| UI0452 :415 | a / LunaConversation | Source instructions | href={message.guide.source} |
| UI0453 :416 | summary / LunaConversation | Sources and scope | (native form/control behavior) |
| UI0454 :416 | a / LunaConversation | {source.title} | href={source.url} |
| UI0455 :417 | button / LunaConversation | {link.label} | onClick={() =&gt; go(link.tab, link.destination, link.view, link.record)} |
| UI0456 :418 | button / LunaConversation | (child/component label) | onClick={() =&gt; { const choices = message.taskChoices!; prepareTaskChange(task, choices.operation, choices.request, choices.title); }} |
| UI0457 :419 | button / LunaConversation | Retry request | onClick={() =&gt; send(message.retry!, true)} |
| UI0458 :422 | button / LunaConversation | Cancel request | onClick={cancelPending} |
| UI0459 :426 | button / LunaConversation | {lunaCopy.clearConfirm} | onClick={() =&gt; { setConversation(initialConversation); setClearConversation(false); setNotice(lunaCopy.newConversation); }} |
| UI0460 :426 | button / LunaConversation | {lunaCopy.clearCancel} | onClick={() =&gt; setClearConversation(false)} |
| UI0461 :427 | form / LunaConversation | (child/component label) | onSubmit={event =&gt; { event.preventDefault(); send(); }} |
| UI0462 :427 | textarea / LunaConversation | {'luna-input-${uid}'} | onChange={event =&gt; setConversation(previous =&gt; ({ ...previous, draft: event.target.value }))}; onKeyDown={event =&gt; { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} |
| UI0463 :427 | button / LunaConversation | "Send message" | (native form/control behavior) |
| UI0464 :428 | button / LunaConversation | {hasUnknownAction ? 'Check the pending change before clearing this conversation.' : undefined} | onClick={() =&gt; { if (pendingRequest \|\| hasUnknownAction) return; if (conversation.messages.length \|\| conversation.draft) setClearConversation(true); else setNotice(lunaCopy.newConversation); }} |

### components/expanded/MapRecordToExplore.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0465 :12 | Link / MapRecordToExplore | Keep a question about this record | href={href}; onClick={() =&gt; { setQuestion('I want to understand the public ${evidence.layer} record for ${evidence.title}. Which source and date should I review, and what would be an appropriate follow-up?'); setEvidence(evidence); }} |

### components/expanded/MyWeekWorkspace.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0466 :108 | article / row | (child/component label) | onDragStart={e=&gt;e.dataTransfer.setData('application/x-halo-action',a.id)} |
| UI0467 :108 | button / row | {activity.subtitle&&activity.subtitle!==a.title&&&lt;small className="mw-task-context"&gt;{activity.subtitle}&lt;/small&gt;} | onClick={()=&gt;open(a)} |
| UI0468 :108 | button / row | {'Schedule ${a.title}'} | onClick={()=&gt;openMove(a,date)} |
| UI0469 :108 | button / row | {'${a.state==='completed'?'Reopen':'Complete'} ${a.title}'} | onClick={()=&gt;finishTask(a)} |
| UI0470 :109 | WeekJournal / MyWeekWorkspace | (child/component label) | href={href} |
| UI0471 :110 | WeekOutdoors / MyWeekWorkspace | (child/component label) | href={href} |
| UI0472 :114 | button / MyWeekWorkspace | Try again | onClick={()=&gt;workspace.setScenario('ready')} |
| UI0473 :116 | section / MyWeekWorkspace | "Calendar" | onTouchStart={e=&gt;{touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}}; onTouchEnd={e=&gt;{const t=touch.current;touch.current=null;if(!t\|\|view!=='Week')return;const x=e.changedTouches[0].clientX-t.x,y=e.changedTouches[0].clientY-t.y;if(Math.abs(x)&gt;70&&Math.abs(x)&gt;Math.abs(y)*2)setDate(dayAdd(date,x&lt;0?7:-7));}} |
| UI0474 :116 | button / MyWeekWorkspace | Add task | onClick={()=&gt;open()} |
| UI0475 :117 | button / MyWeekWorkspace | {v} | onClick={()=&gt;setView(v)} |
| UI0476 :117 | button / MyWeekWorkspace | Today | onClick={()=&gt;setDate(today)} |
| UI0477 :117 | button / MyWeekWorkspace | "Previous period" | onClick={()=&gt;setDate(view==='Month'?'${dayAdd('${date.slice(0,7)}-01',-1).slice(0,7)}-01':dayAdd(date,-7))} |
| UI0478 :117 | button / MyWeekWorkspace | "Next period" | onClick={()=&gt;setDate(view==='Month'?dayAdd('${date.slice(0,7)}-28',4).slice(0,7)+'-01':dayAdd(date,7))} |
| UI0479 :119 | button / MyWeekWorkspace | {'${dayLabel(day)}${count?', ${count} items':''}'} | onClick={()=&gt;setDate(day)}; onDragOver={e=&gt;{if(e.dataTransfer.types.includes('application/x-halo-action'))e.preventDefault();}}; onDrop={e=&gt;{e.preventDefault();const a=active.find(a=&gt;a.id===e.dataTransfer.getData('application/x-halo-action'));if(a)openMove(a,day);}} |
| UI0480 :119 | DateInput / MyWeekWorkspace | Choose a day | onChange={e=&gt;e.target.value&&setDate(e.target.value)} |
| UI0481 :120 | summary / MyWeekWorkspace | Week details | (native form/control behavior) |
| UI0482 :120 | WeekDashboardSummary / MyWeekWorkspace | (child/component label) | onFilter={setFilter}; onDay={setDate} |
| UI0483 :122 | input / MyWeekWorkspace | "Search your week" | onChange={e=&gt;setSearch(e.target.value)} |
| UI0484 :122 | select / MyWeekWorkspace | "Show" | onChange={e=&gt;setFilter(e.target.value)} |
| UI0485 :124 | WeekTimeline / MyWeekWorkspace | (child/component label) | onMove={openMove} |
| UI0486 :125 | Link / MyWeekWorkspace | (child/component label) | href={weekRecordHref(record,href)} |
| UI0487 :127 | HomepageHub / MyWeekWorkspace | {!search.trim()&&weekProgressEntries(workspace.collections,active,metas).length&gt;0&&&lt;WeekProgress href={href} actions={active} metas={metas}/&gt;} {focus&&active.find(a=&gt;a.ke | href={href}; onOpen={open} |
| UI0488 :128 | WeekDashboardOverview / MyWeekWorkspace | {!search.trim()&&weekProgressEntries(workspace.collections,active,metas).length&gt;0&&&lt;WeekProgress href={href} actions={active} metas={metas}/&gt;} {focus&&active.find(a=&gt;a.ke | href={href}; onStreak={setStreak} |
| UI0489 :129 | Link / MyWeekWorkspace | "Check in & look back, Journal & Patterns" | href={href('plan','journal')} |
| UI0490 :129 | Link / MyWeekWorkspace | "Make time outdoors, Plan & prepare" | href={href('plan','outdoors')} |
| UI0491 :130 | WeekProgress / MyWeekWorkspace | (child/component label) | href={href} |
| UI0492 :139 | WeekPlanningRail / MyWeekWorkspace | (child/component label) | onOpen={open}; onDay={setDate}; href={href} |
| UI0493 :139 | summary / MyWeekWorkspace | Calendar options | (native form/control behavior) |
| UI0494 :139 | summary / MyWeekWorkspace | Calendar timezone | (native form/control behavior) |
| UI0495 :139 | select / MyWeekWorkspace | "Display timezone" | onChange={e=&gt;setZone(e.target.value)} |
| UI0496 :139 | summary / MyWeekWorkspace | Calendar sources | (native form/control behavior) |
| UI0497 :139 | input / MyWeekWorkspace | Include dates from my records | onChange={e=&gt;setIncludeRecords(e.target.checked)} |
| UI0498 :139 | summary / MyWeekWorkspace | Connected work | (native form/control behavior) |
| UI0499 :139 | Link / MyWeekWorkspace | (child/component label) | href={collection==='tests'?'${href('home','tests')}&homeView=detail&record=${encodeURIComponent(record.id)}':'${href('act',collection==='exploreProjects'?'projects':'opportunities')}&exploreView=detail&exploreRecord=${encodeURIComponent(record.id)}'} |
| UI0500 :139 | Link / MyWeekWorkspace | Review home routines | href={href('home','maintenance')} |
| UI0501 :139 | summary / MyWeekWorkspace | Follow-through | (native form/control behavior) |
| UI0502 :139 | input / MyWeekWorkspace | Include completed items | onChange={e=&gt;setShowFinished(e.target.checked)} |
| UI0503 :139 | summary / MyWeekWorkspace | Your rhythm | (native form/control behavior) |
| UI0504 :139 | input / MyWeekWorkspace | Show my action streak | onChange={e=&gt;setStreak(e.target.checked)} |
| UI0505 :141 | BottomSheet / MyWeekWorkspace | "week-task-detail" | onClose={closeSheet} |
| UI0506 :141 | form / MyWeekWorkspace | {deleting?&lt;&gt;&lt;p&gt;Remove “{edit.title}” from My Week. Its original project, test or home record stays. &lt;/p&gt;&lt;button type="button" className="mw-danger" onClick={()=&gt;save(true | onSubmit={e=&gt;{e.preventDefault();save();}} |
| UI0507 :142 | button / MyWeekWorkspace | Yes, delete | onClick={()=&gt;save(true)} |
| UI0508 :142 | button / MyWeekWorkspace | No, keep it | onClick={()=&gt;setDeleting(false)} |
| UI0509 :143 | WeekActivityDetails / MyWeekWorkspace | (child/component label) | action={edit.action}; href={href} |
| UI0510 :144 | input / MyWeekWorkspace | Task title | onChange={e=&gt;setEdit({...edit,title:e.target.value})} |
| UI0511 :144 | DateInput / MyWeekWorkspace | Date (optional) | onChange={e=&gt;setEdit({...edit,date:e.target.value})} |
| UI0512 :144 | button / MyWeekWorkspace | Save for later instead | onClick={()=&gt;setEdit({...edit,date:'',meta:{...edit.meta,time:'',recurrence:'none'}})} |
| UI0513 :145 | select / MyWeekWorkspace | "Status" | onChange={e=&gt;setEdit({...edit,state:e.target.value as PreviewAction['state']})} |
| UI0514 :146 | summary / MyWeekWorkspace | Time, repeat & preparation | (native form/control behavior) |
| UI0515 :146 | input / MyWeekWorkspace | Time (optional) | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,time:e.target.value}})} |
| UI0516 :146 | select / MyWeekWorkspace | {['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','Pacific/Honolulu','UTC'].map(z=&gt;&lt;option key={z}&gt;{z}&lt;/option&gt;)} | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,zone:e.target.value}})} |
| UI0517 :146 | input / MyWeekWorkspace | Duration in minutes | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,duration:Number(e.target.value),estimateSet:true}})} |
| UI0518 :146 | input / MyWeekWorkspace | Use this as my effort estimate | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,estimateSet:e.target.checked}})} |
| UI0519 :146 | select / MyWeekWorkspace | "Repeat" | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,recurrence:e.target.value as WeekMeta['recurrence']}})} |
| UI0520 :146 | textarea / MyWeekWorkspace | My preparation note | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,note:e.target.value}})} |
| UI0521 :146 | input / MyWeekWorkspace | Request a reminder | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,reminder:e.target.checked}})} |
| UI0522 :147 | summary / MyWeekWorkspace | Why this is here | (native form/control behavior) |
| UI0523 :147 | Link / MyWeekWorkspace | Open related workspace | href={originHref(edit.action)} |
| UI0524 :147 | input / MyWeekWorkspace | Pause this task | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,paused:e.target.checked}})} |
| UI0525 :147 | input / MyWeekWorkspace | Archive this task | onChange={e=&gt;setEdit({...edit,meta:{...edit.meta,archived:e.target.checked}})} |
| UI0526 :147 | button / MyWeekWorkspace | Make this my focus | onClick={()=&gt;{setFocus(edit.key);setNotice('Focus chosen.');}} |
| UI0527 :147 | summary / MyWeekWorkspace | Task history | (native form/control behavior) |
| UI0528 :148 | button / MyWeekWorkspace | Prepare next occurrence | onClick={repeatNext} |
| UI0529 :149 | button / MyWeekWorkspace | Export to calendar | onClick={()=&gt;setExporting(!exporting)} |
| UI0530 :149 | button / MyWeekWorkspace | Download saved event | onClick={()=&gt;{const body=calendarExport(edit.action!,meta(edit.action!));if(!body){setError('Save a valid schedule before exporting.');return;}downloadWeekFile('halo-task.ics',body,'text/calendar');setNotice('Calendar file downloaded. Import it in your calendar.');}} |
| UI0531 :150 | button / MyWeekWorkspace | Delete task | onClick={()=&gt;setDeleting(true)} |
| UI0532 :151 | button / MyWeekWorkspace | Save task | (native form/control behavior) |
| UI0533 :151 | button / MyWeekWorkspace | Cancel | onClick={closeSheet} |
| UI0534 :153 | BottomSheet / MyWeekWorkspace | "week-reschedule" | onClose={closeMove} |
| UI0535 :153 | form / MyWeekWorkspace | {moveError&&&lt;p role="alert"&gt;{moveError}&lt;/p&gt;} | onSubmit={e=&gt;{e.preventDefault();saveMove();}} |
| UI0536 :153 | DateInput / MyWeekWorkspace | New date | onChange={e=&gt;setMoving({...moving,date:e.target.value})} |
| UI0537 :153 | input / MyWeekWorkspace | Start time (optional) | onChange={e=&gt;setMoving({...moving,time:e.target.value})} |
| UI0538 :153 | input / MyWeekWorkspace | Minutes | onChange={e=&gt;setMoving({...moving,duration:Number(e.target.value)})} |
| UI0539 :153 | button / MyWeekWorkspace | Save new schedule | (native form/control behavior) |
| UI0540 :153 | button / MyWeekWorkspace | Keep current schedule | onClick={closeMove} |
| UI0541 :157 (review control) | button / WeekReviewControls | Load a sample week | onClick={()=&gt;{if(!state)return;const anchor=lunaCalendarAnchor();const start=weekStart(anchor);['Prepare my garden materials','Review filter instructions','Follow up on my test','Plan a community cleanup','Check the outdoor forecast'].forEach((title,i)=&gt;state.addActions([{key:'week-example:${i}',title,origin:['Project','Home care','Test','Community','Outdoors'][i],reason:'Explicitly loaded sample planning task. Not a real commitment or environmental measurement.'}],i===0?anchor:i===4?'':da |

### components/expanded/NoteHandoff.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0542 :20 | summary / NoteHandoff | {copy.title} | (native form/control behavior) |
| UI0543 :21 | input / NoteHandoff | Include my place label | onChange={e=&gt;{setScope({...scope,place:e.target.checked});setConsent(false);}} |
| UI0544 :21 | input / NoteHandoff | Include selected public context | onChange={e=&gt;{setScope({...scope,evidence:e.target.checked});setConsent(false);}} |
| UI0545 :22 | summary / NoteHandoff | Review current note text | (native form/control behavior) |
| UI0546 :22 | input / NoteHandoff | I reviewed the selected details and want to prepare this copy. | onChange={e=&gt;setConsent(e.target.checked)} |
| UI0547 :22 | button / NoteHandoff | {snapshot?'Prepare a new copy':'Prepare this copy'} | onClick={()=&gt;void prepare()} |
| UI0548 :23 | ShareTools / NoteHandoff | {handoffChanged(record,snapshot)&&&lt;p className="ex-notice" role="status"&gt;{copy.changed}&lt;/p&gt;} {snapshot.officialOpenedAt&&&lt;p className="ex-meta"&gt;{copy.opened}&lt;/p&gt;} {!snaps | onResult={kind=&gt;void track(snapshot.id,kind)} |
| UI0549 :23 | a / NoteHandoff | Find official environmental contacts (US EPA) | href="https://www.epa.gov/aboutepa/forms/contact-epa"; onClick={()=&gt;{if(!blocked)void opened();}} |
| UI0550 :23 | input / NoteHandoff | Reference (optional, reported by you) | onChange={e=&gt;setReference(e.target.value)} |
| UI0551 :23 | input / NoteHandoff | {copy.submission} | onChange={e=&gt;setSubmitted(e.target.checked)} |
| UI0552 :23 | button / NoteHandoff | Record my submission | onClick={()=&gt;void report()} |
| UI0553 :24 | summary / NoteHandoff | Earlier prepared copies ( {record.handoffHistory?.length} ) | (native form/control behavior) |
| UI0554 :24 | summary / NoteHandoff | View saved text | (native form/control behavior) |

### components/expanded/NotePhoto.tsx

Contract family: A01-A06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0555 :12 | input / NotePhotoEditor | {copy.label} | onChange={e=&gt;void select(e.target.files?.[0])} |
| UI0556 :12 | button / NotePhotoEditor | Cancel photo preparation | onClick={()=&gt;{controller.current?.abort();setBusy(false);if(input.current)input.current.value='';}} |
| UI0557 :12 | input / NotePhotoEditor | {copy.consent} | onChange={e=&gt;setConsent(e.target.checked)} |
| UI0558 :12 | button / NotePhotoEditor | {photo?'Replace attached photo':'Keep this photo'} | onClick={()=&gt;{onChange(candidate);setCandidate(null);setConsent(false);setRemoved(undefined);if(input.current)input.current.value='';}} |
| UI0559 :12 | button / NotePhotoEditor | Discard selection | onClick={()=&gt;{setCandidate(null);setConsent(false);if(input.current)input.current.value='';}} |
| UI0560 :12 | button / NotePhotoEditor | Remove attached photo | onClick={()=&gt;{setRemoved(photo);onChange(undefined);}} |
| UI0561 :12 | button / NotePhotoEditor | Undo photo removal | onClick={()=&gt;{onChange(removed);setRemoved(undefined);}} |
| UI0562 :16 | button / NotePhotoDetail | {review?'Close photo export':'Review photo export'} | onClick={()=&gt;{setReview(!review);setConsent(false);setMessage('');}} |
| UI0563 :16 | input / NotePhotoDetail | {copy.exportConsent} | onChange={e=&gt;setConsent(e.target.checked)} |
| UI0564 :16 | button / NotePhotoDetail | Download processed photo | onClick={()=&gt;{const link=document.createElement('a');link.href=photo.data;link.download=photo.name;link.click();setMessage('Download requested. No official report was submitted. Downloaded copies cannot be removed by HALO.');}} |

### components/expanded/PublicBrowse.tsx

Contract family: G01 / X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0565 :11 | Link / PublicBrowse | {c.browseMap} | href={mapHref} |
| UI0566 :11 | Link / PublicBrowse | {c.setup} | href="/onboarding/preview/?design=mobile" |

### components/expanded/SettingsPanels.tsx

Contract family: X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0567 :21 | input / SettingToggle | {title} | onChange={e=&gt;onChange(e.target.checked)} |
| UI0568 :25 | input / SettingsHome | (child/component label) | onChange={e=&gt;preview.setHouseholdDraft({...picked,[memberCatalog[key].band]:e.target.checked})} |
| UI0569 :25 | input / SettingsHome | {c.year} | onChange={e=&gt;change({...draft,home:{...draft.home,year:e.target.value}})} |
| UI0570 :25 | select / SettingsHome | {(['utility','well','spring','other']as const).map((v,i)=&gt;&lt;option key={v} value={v}&gt;{c.waterOptions[i]}&lt;/option&gt;)} | onChange={e=&gt;change({...draft,home:{...draft.home,water:e.target.value as SettingsValues['home']['water']}})} |
| UI0571 :25 | select / SettingsHome | {(['owner','renter','other']as const).map((v,i)=&gt;&lt;option key={v} value={v}&gt;{c.tenureOptions[i]}&lt;/option&gt;)} | onChange={e=&gt;change({...draft,home:{...draft.home,tenure:e.target.value as SettingsValues['home']['tenure']}})} |
| UI0572 :38 | button / SettingsNotifications | {c.deviceSetup} | onClick={()=&gt;setSetup(!setup)} |
| UI0573 :38 | button / SettingsNotifications | (child/component label) | onClick={onAlerts} |
| UI0574 :38 | SettingToggle / SettingsNotifications | {c.notificationLabels[kind][0]} | onChange={v=&gt;change({...draft,notifications:{...draft.notifications,[kind]:v}})} |
| UI0575 :38 | summary / SettingsNotifications | {c.quiet} | (native form/control behavior) |
| UI0576 :38 | SettingToggle / SettingsNotifications | {c.quietEnable} | onChange={v=&gt;change({...draft,quiet:{...draft.quiet,enabled:v}})} |
| UI0577 :38 | input / SettingsNotifications | {c.quietFrom} | onChange={e=&gt;change({...draft,quiet:{...draft.quiet,from:e.target.value}})} |
| UI0578 :38 | input / SettingsNotifications | {c.quietTo} | onChange={e=&gt;change({...draft,quiet:{...draft.quiet,to:e.target.value}})} |
| UI0579 :38 | select / SettingsNotifications | {displayZones.map(z=&gt;&lt;option key={z}&gt;{z}&lt;/option&gt;)} | onChange={e=&gt;change({...draft,quiet:{...draft.quiet,zone:e.target.value}})} |
| UI0580 :38 | summary / SettingsNotifications | {c.watchlist} | (native form/control behavior) |
| UI0581 :38 | button / SettingsNotifications | {'${c.watchStop} ${w.label}'} | onClick={()=&gt;{if(cannotSave()){setFeedback(c.failed);return;}setWatches(watches.filter(item=&gt;item.id!==w.id));setFeedback(c.watchKept);}} |
| UI0582 :38 | select / SettingsNotifications | {c.watchTypes.map((v,i)=&gt;&lt;option key={v} value={i}&gt;{v}&lt;/option&gt;)} | onChange={e=&gt;setKind(Number(e.target.value))} |
| UI0583 :38 | input / SettingsNotifications | {c.watchLabel} | onChange={e=&gt;setLabel(e.target.value)} |
| UI0584 :38 | button / SettingsNotifications | {c.watchAdd} | onClick={()=&gt;{if(cannotSave()){setFeedback(c.failed);return;}if(!label.trim()){setFeedback(c.watchError);return;}if(!watches.some(w=&gt;w.kind===kind&&w.label.toLowerCase()===label.trim().toLowerCase()))setWatches([...watches,{id:crypto.randomUUID(),kind,label:label.trim()}]);setLabel('');setFeedback(c.saved);}} |
| UI0585 :38 | Link / SettingsNotifications | (child/component label) | href={href('plan')} |
| UI0586 :45 | input / SettingsDisplay | "halo-setting-appearance" | onChange={()=&gt;onAppearance(value)} |
| UI0587 :46 | input / SettingsDisplay | "halo-setting-text-scale" | onChange={()=&gt;onDisplay({...display,scale:s})} |
| UI0588 :46 | SettingToggle / SettingsDisplay | {c.contrast} | onChange={v=&gt;onDisplay({...display,contrast:v})} |
| UI0589 :46 | select / SettingsDisplay | (child/component label) | onChange={e=&gt;onDisplay({...display,motion:e.target.value as 'system'\|'reduce'})} |
| UI0590 :46 | SettingToggle / SettingsDisplay | {c.ambient} | onChange={onAmbient} |
| UI0591 :47 | select / SettingsDisplay | (child/component label) | onChange={e=&gt;change({...draft,language:e.target.value as 'en'\|'es'})} |
| UI0592 :48 | summary / SettingsDisplay | {c.calendar} | (native form/control behavior) |
| UI0593 :48 | select / SettingsDisplay | {[...new Set([...displayZones,zone])].map(z=&gt;&lt;option key={z}&gt;{z}&lt;/option&gt;)} | onChange={e=&gt;setZone(e.target.value)} |
| UI0594 :48 | button / SettingsDisplay | {c.deviceZone} | onClick={()=&gt;setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)} |
| UI0595 :48 | SettingToggle / SettingsDisplay | {c.sourcesCalendar} | onChange={setLinked} |
| UI0596 :48 | SettingToggle / SettingsDisplay | {c.streak} | onChange={setStreak} |
| UI0597 :49 | button / SettingsDisplay | {c.restoreDisplay} | onClick={()=&gt;{onDisplay({scale:'100',motion:'system',contrast:false});onAppearance('system');onAmbient(true);}} |
| UI0598 :59 | SettingToggle / SettingsLuna | {[c.lunaTasks,c.lunaHome,c.lunaProjects][i]} | onChange={v=&gt;change({...draft,luna:{...draft.luna,[key]:v}})} |
| UI0599 :61 | summary / SettingsLuna | {c.conversation} | (native form/control behavior) |
| UI0600 :61 | button / SettingsLuna | {c.clearConversation} | onClick={startClear} |
| UI0601 :61 | button / SettingsLuna | {c.confirmClear} | onClick={confirmClear} |
| UI0602 :61 | button / SettingsLuna | {c.keep} | onClick={()=&gt;setClearing(null)} |
| UI0603 :62 | summary / SettingsLuna | {c.permissions} | (native form/control behavior) |
| UI0604 :68 | Link / SettingsAbout | (child/component label) | href={factorHref(key)} |
| UI0605 :68 | summary / SettingsAbout | {c.method} | (native form/control behavior) |
| UI0606 :68 | summary / SettingsAbout | {c.feedback} | (native form/control behavior) |
| UI0607 :68 | select / SettingsAbout | {c.feedbackTopicOptions.map((t,i)=&gt;&lt;option key={t} value={i}&gt;{t}&lt;/option&gt;)} | onChange={e=&gt;setTopic(Number(e.target.value))} |
| UI0608 :68 | textarea / SettingsAbout | {c.feedbackMessage} | onChange={e=&gt;setMessage(e.target.value)} |
| UI0609 :68 | button / SettingsAbout | {c.feedbackCopy} | onClick={async()=&gt;{if(!message.trim()){setStatus(c.feedbackError);return;}try{await navigator.clipboard.writeText('${c.feedbackTopicOptions[topic]}\n\n${message.trim()}');setStatus(c.feedbackCopied);}catch{setStatus(c.feedbackFailed);}}} |

### components/expanded/SettingsPrivacy.tsx

Contract family: X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0610 :42 | summary / SettingsPrivacy | {c.inspect} | (native form/control behavior) |
| UI0611 :42 | select / SettingsPrivacy | {exportGroups.map(g=&gt;&lt;option key={g} value={g}&gt;{c.recordGroups[g]}&lt;/option&gt;)} | onChange={e=&gt;setInspect(e.target.value as ExportGroup)} |
| UI0612 :42 | input / SettingsPrivacy | {c.privateFields} | onChange={e=&gt;setShowPrivate(e.target.checked)} |
| UI0613 :42 | summary / SettingsPrivacy | {String(record.title??record.date??c.recordGroups[inspect])} | (native form/control behavior) |
| UI0614 :42 | summary / SettingsPrivacy | {c.structuredData} | (native form/control behavior) |
| UI0615 :43 | summary / SettingsPrivacy | {c.export} | (native form/control behavior) |
| UI0616 :43 | input / SettingsPrivacy | {c.recordGroups[g]} | onChange={e=&gt;{setReview(null);setGroups(e.target.checked?[...groups,g]:groups.filter(item=&gt;item!==g));}} |
| UI0617 :43 | input / SettingsPrivacy | {c.includePrivate} | onChange={e=&gt;{setReview(null);setPrivateText(e.target.checked);}} |
| UI0618 :43 | button / SettingsPrivacy | {c.exportPreview} | onClick={()=&gt;{if(!groups.length){setMessage(c.exportEmpty);return;}const data=current();setReview({data,signature:JSON.stringify(data)});setMessage('');}} |
| UI0619 :43 | button / SettingsPrivacy | {c.download} | onClick={()=&gt;{if(JSON.stringify(current())!==review.signature){setMessage(c.exportChanged);return;}downloadWeekFile('halo-private-export.json',JSON.stringify(review.data,null,2),'application/json');setMessage(c.exportDownloaded);}} |
| UI0620 :45 | button / SettingsPrivacy | (child/component label) | onClick={()=&gt;prepare('journal')} |
| UI0621 :45 | button / SettingsPrivacy | (child/component label) | onClick={()=&gt;prepare('all')} |
| UI0622 :46 | input / SettingsPrivacy | {c.deleteWord} | onChange={e=&gt;setWord(e.target.value)} |
| UI0623 :46 | button / SettingsPrivacy | {deleting.scope==='all'?c.deleteAll:c.confirmClear} | onClick={()=&gt;void erase()} |
| UI0624 :46 | button / SettingsPrivacy | {c.keep} | onClick={()=&gt;{setDeleting(null);setMessage('');}} |

### components/expanded/SettingsWorkspace.tsx

Contract family: X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0625 :77 | input / SettingsWorkspace | {c.searchHint} | onChange={e=&gt;setQuery(e.target.value)} |
| UI0626 :77 | button / SettingsWorkspace | {c.clearSearch} | onClick={()=&gt;setQuery('')} |
| UI0627 :77 | button / SettingsWorkspace | {drafts[key]?&lt;span className="hp-dirty-dot" aria-hidden="true"/&gt;:&lt;ChevronRight size={17} aria-hidden="true"/&gt;} | onClick={()=&gt;enter(key)} |
| UI0628 :78 | button / SettingsWorkspace | {c.back} | onClick={leave} |
| UI0629 :79 | button / SettingsWorkspace | {c.retry} | onClick={()=&gt;workspace.setScenario('ready')} |
| UI0630 :81 | SettingsNotifications / SettingsWorkspace | (child/component label) | href={props.href}; onAlerts={props.onAlerts} |
| UI0631 :82 | SettingsDisplay / SettingsWorkspace | (child/component label) | onDisplay={display=&gt;updateEdit({display})}; onCalendar={calendar=&gt;updateEdit({calendar})}; onAppearance={appearance=&gt;updateEdit({appearance})}; onAmbient={ambient=&gt;updateEdit({ambient})} |
| UI0632 :84 | SettingsPrivacy / SettingsWorkspace | (child/component label) | href={props.href} |
| UI0633 :86 | button / SettingsWorkspace | {c.reload} | onClick={rebase} |
| UI0634 :86 | button / SettingsWorkspace | {c.save} | onClick={()=&gt;void save()} |
| UI0635 :86 | button / SettingsWorkspace | {c.cancel} | onClick={()=&gt;{clearDraft();if(panel==='home')preview.setHouseholdDraft(null);setBaseline(snapshot());setMessage('');}} |

### components/expanded/SourceOperationsReview.tsx

Contract family: X07.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0636 :80 | summary / SourceOperationsReview | Source operations review | (native form/control behavior) |
| UI0637 :83 | select / SourceOperationsReview | (child/component label) | onChange={event =&gt; setRole(event.target.value as OperatorRole)} |
| UI0638 :84 | select / SourceOperationsReview | (child/component label) | onChange={event =&gt; setOutcome(event.target.value)} |
| UI0639 :85 | select / SourceOperationsReview | (child/component label) | onChange={event =&gt; setStatusResult(event.target.value)} |
| UI0640 :89 | select / SourceOperationsReview | {sources.map(item =&gt; &lt;option key={item.id} value={item.id}&gt;{item.name} · {item.freshness} · {item.run.rejected} rejected&lt;/option&gt;)} | onChange={event =&gt; { setSelected(event.target.value); setReason(''); setNotice(''); }} |
| UI0641 :94 | summary / SourceOperationsReview | Source record and safe run diagnostics | (native form/control behavior) |
| UI0642 :98 | summary / SourceOperationsReview | Compare revisions | (native form/control behavior) |
| UI0643 :105 | summary / SourceOperationsReview | Translation and supported coverage | (native form/control behavior) |
| UI0644 :106 | textarea / SourceOperationsReview | "What was checked, and why is this decision appropriate?" | onChange={event =&gt; setReason(event.target.value.replace(/\u2014/g, ','))} |
| UI0645 :108 | button / SourceOperationsReview | {decisions[decision]} | onClick={() =&gt; prepare(decision)} |
| UI0646 :110 | button / SourceOperationsReview | Simulate a newer source revision | onClick={simulateRevision} |
| UI0647 :116 | button / SourceOperationsReview | Check operation status | onClick={inspectStatus} |
| UI0648 :116 | button / SourceOperationsReview | {pending ? copy.pending : 'Confirm decision'} | onClick={confirm} |
| UI0649 :116 | button / SourceOperationsReview | {pending ? 'Cancel pending decision' : 'Cancel decision'} | onClick={cancel} |
| UI0650 :118 | summary / SourceOperationsReview | Retained versions and audit history | (native form/control behavior) |

### components/expanded/WeekActivityDetails.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0651 :22 | summary / WeekActivityDetails | How to do this step | (native form/control behavior) |
| UI0652 :23 | summary / WeekActivityDetails | {activity.kind === 'volunteering' ? 'My preparation' : activity.kind === 'routine' ? 'Care instructions' : activity.kind === 'project' ? 'Before you begin' : 'Record deta | (native form/control behavior) |
| UI0653 :24 | Link / WeekActivityDetails | Open {activity.kind === 'project' ? 'project' : activity.kind === 'volunteering' ? 'participation' : 'record'} | href={target}; onClick={() =&gt; { if (activity.guide && activity.stepIndex !== undefined) workspace.setDraft('explore:project-step:${activity.guide.id}', () =&gt; activity.stepIndex); }} |
| UI0654 :24 | a / WeekActivityDetails | {source.title} | href={source.url} |

### components/expanded/WeekAmbience.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0655 :99 | img / LandscapeLayer | {/* Decorative art is kept separate from the assistant, data and task models. */} {/* eslint-disable-next-line @next/next/no-img-element */} {!failed && &lt;WaterSurface ima | onLoad={event =&gt; { setImage(event.currentTarget); onReady(scene.id); }}; onError={() =&gt; { setFailed(true); onError(scene.id); }} |
| UI0656 :203 | LandscapeLayer / WeekAmbience | (child/component label) | onReady={ready}; onError={failed} |
| UI0657 :208 | button / WeekAmbience | {paused ? copy.resume : copy.pause} | onClick={() =&gt; setPaused(value =&gt; !value)} |
| UI0658 :209 | button / WeekAmbience | {copy.next} | onClick={() =&gt; advance(true)} |

### components/expanded/WeekConnectedExamples.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0659 :59 (review control) | button / WeekConnectedExamples | {busy ? 'Loading connected examples...' : 'Load connected activity examples'} | onClick={load} |

### components/expanded/WeekDashboardOverview.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0660 :23 | Link / WeekDashboardOverview | {'Open ${tab==='home'?'Homeguard':'Today'}, ${value.score===null?'score unavailable':'${value.score} out of 100'}${value.partial?', partial score':''}'} | href={href(tab)} |
| UI0661 :30 | button / WeekDashboardOverview | {streak?'Hide streak':'Show streak'} | onClick={()=&gt;onStreak(!streak)} |

### components/expanded/WeekDashboardSummary.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0662 :17 | button / WeekDashboardSummary | {'${kind}, ${dashboard.kinds[kind]??0} items this week'} | onClick={()=&gt;onFilter(filter===kind?'Everything':kind)} |
| UI0663 :18 | button / WeekDashboardSummary | (child/component label) | onClick={()=&gt;setOpen(true)} |
| UI0664 :19 | BottomSheet / WeekDashboardSummary | "week-effort" | onClose={close} |
| UI0665 :22 | button / WeekDashboardSummary | {'Open ${dayLabel(day.date)}, ${day.plans} ${day.plans===1?"plan":"plans"}, ${day.records} linked ${day.records===1?"date":"dates"}, ${effortLabel(day.minutes)} supplied effort${day.unknown?', ${day.unknown} without estimates':""}'} | onClick={()=&gt;{onDay(day.date);close();}} |
| UI0666 :32 | button / WeekDashboardSummary | Done | onClick={close} |

### components/expanded/WeekEvidence.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0667 :19 (review control) | select / WeekEvidenceReviewControls | {['unavailable','populated','sparse','no-pattern','changed','loading','error'].map(v=&gt;&lt;option key={v}&gt;{v}&lt;/option&gt;)} | onChange={e=&gt;setReview({...review,history:e.target.value as EvidenceScenario})} |
| UI0668 :19 (review control) | select / WeekEvidenceReviewControls | {['unavailable','current','partial','changed','expired','loading','error'].map(v=&gt;&lt;option key={v}&gt;{v}&lt;/option&gt;)} | onChange={e=&gt;setReview({...review,forecast:e.target.value as ForecastScenario})} |
| UI0669 :19 (review control) | button / WeekEvidenceReviewControls | Load illustrative check-ins and history | onClick={async()=&gt;{let added=0,kept=0,failed=0;for(const entry of fixtureCheckins(lunaCalendarAnchor())){if(entries.records.some(e=&gt;e.id===entry.id)){kept++;continue;}if(await entries.save(entry))added++;else failed++;}setReview({...review,history:'populated'});setMessage('${added} illustrative check-ins loaded, ${kept} existing entries kept, ${failed} not saved. No provider data or account writes.');}} |
| UI0670 :21 | select / GroupSelect | {['household',...homeMemberKeys].map(g=&gt;&lt;option value={g} key={g}&gt;{g==='household'?'Household':memberCatalog[g as typeof homeMemberKeys[number]].label}&lt;/option&gt;)} | onChange={e=&gt;onChange(e.target.value)} |
| UI0671 :22 | summary / SourceDetails | Sources and method | (native form/control behavior) |
| UI0672 :25 | button / Trend | {v} | onClick={()=&gt;setView(v)} |
| UI0673 :25 | button / Trend | {dayLabel(r.date)} | onClick={()=&gt;onDay(r.date)} |
| UI0674 :31 | GroupSelect / WeekPatterns | (child/component label) | onChange={setGroup} |
| UI0675 :31 | select / WeekPatterns | {['Air','UV','Pollen','Outdoor mold'].map(f=&gt;&lt;option key={f}&gt;{f}&lt;/option&gt;)} | onChange={e=&gt;setFactor(e.target.value as HistoryFactor)} |
| UI0676 :31 | button / WeekPatterns | {v} | onClick={()=&gt;setGridView(v)} |
| UI0677 :32 | button / WeekPatterns | {'${dayLabel(date)}, ${e?e.fine?'Felt fine':'Symptoms logged':'Not logged'}, ${readingLabel(r)}${e?.recalled?', recalled':''}${e?.illness?', possible illness':''}'} | onClick={()=&gt;setSelected(date)} |
| UI0678 :33 | button / WeekPatterns | {entry?'Edit this day':'Log this day'} | onClick={()=&gt;onEdit(selected,group)} |
| UI0679 :34 | select / WeekPatterns | (child/component label) | onChange={e=&gt;setRange(Number(e.target.value))} |
| UI0680 :35 | button / WeekPatterns | {review.history==='loading'?'Cancel loading':'Retry history'} | onClick={()=&gt;setReview({...review,history:review.history==='loading'?'unavailable':'populated'})} |
| UI0681 :35 | Trend / WeekPatterns | (child/component label) | onDay={setSelected} |
| UI0682 :36 | summary / WeekPatterns | Coverage and exclusions | (native form/control behavior) |
| UI0683 :37 | button / WeekPatterns | Export this range, without private notes | onClick={()=&gt;downloadWeekFile('halo-patterns.json',JSON.stringify({from,to:today,group,factor,source:readings.length?copy.fixtureSource:'Unavailable',method:copy.method,entries:entries.filter(e=&gt;e.band===group&&e.date&gt;=from&&e.date&lt;=today).map(e=&gt;Object.fromEntries(Object.entries(e).filter(([key])=&gt;key!=='note'))),readings:report.rows,counts:{logged:report.logged,history:report.history,comparable:report.comparable,recalled:report.recalled,illness:report.illness,missing:report.m |
| UI0684 :42 | select / WeekSeason | {['Spring','Summer','Fall','Winter'].map(s=&gt;&lt;option key={s}&gt;{s}&lt;/option&gt;)} | onChange={e=&gt;setSeason(e.target.value)} |
| UI0685 :42 | select / WeekSeason | {Array.from({length:6},(_,i)=&gt;String(Number(today.slice(0,4))+1-i)).map(y=&gt;&lt;option key={y}&gt;{y}&lt;/option&gt;)} | onChange={e=&gt;setYear(e.target.value)} |
| UI0686 :42 | GroupSelect / WeekSeason | (child/component label) | onChange={setGroup} |
| UI0687 :42 | select / WeekSeason | {['Air','UV','Pollen','Outdoor mold'].map(f=&gt;&lt;option key={f}&gt;{f}&lt;/option&gt;)} | onChange={e=&gt;setFactor(e.target.value as HistoryFactor)} |
| UI0688 :43 | summary / WeekSeason | {actions.length} completed actions | (native form/control behavior) |
| UI0689 :43 | Link / WeekSeason | {a.title} | href={'${href('plan')}&weekTask=${encodeURIComponent(a.id)}'} |
| UI0690 :43 | summary / WeekSeason | {pending.length} planned or waiting actions | (native form/control behavior) |
| UI0691 :43 | Link / WeekSeason | {a.title} | href={'${href('plan')}&weekTask=${encodeURIComponent(a.id)}'} |
| UI0692 :43 | summary / WeekSeason | {recordedTests.length} tests with recorded reports | (native form/control behavior) |
| UI0693 :43 | Link / WeekSeason | {t.title} | href={'${href('home','tests')}&homeView=detail&record=${encodeURIComponent(t.id)}'} |
| UI0694 :43 | summary / WeekSeason | {participation.length} recorded community activities | (native form/control behavior) |
| UI0695 :43 | Link / WeekSeason | {e.title} | href={'${href('act','opportunities')}&exploreView=detail&exploreRecord=${encodeURIComponent(e.id)}'} |
| UI0696 :44 | summary / WeekSeason | Coverage and exclusions | (native form/control behavior) |
| UI0697 :44 | Link / WeekSeason | Review My Week | href={href('plan')} |
| UI0698 :44 | button / WeekSeason | Plan next review | onClick={()=&gt;{if(!state\|\|workspace.pending\|\|['offline','error','loading','save-error','conflict'].includes(workspace.scenario)\|\|!navigator.onLine){setMessage('Could not save. Your review choice is kept.');return;}const date=dayAdd(today,7);if(state.addActions([{key:'season-review:${seasonKey}',title:'Review my ${season.toLowerCase()} follow-through',origin:'Season review',reason:'Review ${bounds.start} to ${bounds.end}. Recorded activity is separate from measured outcomes.'}],date))setM |
| UI0699 :44 | button / WeekSeason | Dismiss for this season | onClick={()=&gt;setDismissed([...dismissed,seasonKey])} |
| UI0700 :44 | button / WeekSeason | Export season overview | onClick={()=&gt;downloadWeekFile('halo-season.json',JSON.stringify({season,year,...bounds,through,group,factor,method:copy.method,source:readings.length?copy.fixtureSource:'Unavailable',coverage:{elapsedDays:periodDays,logged:report.logged,history:report.history,comparable:report.comparable,recalled:report.recalled,illness:report.illness},readings:report.rows,completed:actions.map(a=&gt;({title:a.title,completedOn:metas[a.key]?.completedOn})),pending:pending.map(a=&gt;({title:a.title,date:a.date |

### components/expanded/WeekJournal.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0701 :33 | Link / WeekJournal | Back to My Week | href={href('plan')} |
| UI0702 :34 | button / WeekJournal | {t} | onClick={()=&gt;setTab(t)} |
| UI0703 :35 | button / WeekJournal | Try again | onClick={()=&gt;workspace.setScenario('ready')} |
| UI0704 :37 | summary / WeekJournal | New here? Remember earlier days | (native form/control behavior) |
| UI0705 :37 | DateInput / WeekJournal | "Add a remembered date" | onChange={e=&gt;{const value=e.target.value;if(value&&validActionDate(value)&&value&gt;=dayAdd(today,-61)&&value&lt;=today)setBatch(old=&gt;old.includes(value)?old:old.length&lt;62?[...old,value]:old);}} |
| UI0706 :37 | button / WeekJournal | {dayLabel(d)} × | onClick={()=&gt;setBatch(old=&gt;old.filter(x=&gt;x!==d))} |
| UI0707 :37 | button / WeekJournal | Save remembered days | onClick={recall} |
| UI0708 :37 | button / WeekJournal | Log today instead | onClick={()=&gt;choose(today)} |
| UI0709 :38 | form / WeekJournal | {!draft.fine&&&lt;label&gt;Severity&lt;select value={draft.severity} onChange={e=&gt;setDraft({...draft,severity:e.target.value})}&gt;&lt;option value=""&gt;Choose severity&lt;/option&gt;&lt;option va | onSubmit={e=&gt;{e.preventDefault();void save();}} |
| UI0710 :38 | DateInput / WeekJournal | Date | onChange={e=&gt;e.target.value&&choose(e.target.value)} |
| UI0711 :38 | select / WeekJournal | {groups.map(g=&gt;&lt;option key={g} value={g}&gt;{g==='household'?'Household':memberCatalog[g as typeof homeMemberKeys[number]].label}&lt;/option&gt;)} | onChange={e=&gt;choose(draft.date,e.target.value)} |
| UI0712 :38 | button / WeekJournal | Felt fine | onClick={()=&gt;setDraft({...draft,fine:!draft.fine,symptoms:[],severity:'',illness:false})} |
| UI0713 :38 | button / WeekJournal | {s} | onClick={()=&gt;setDraft({...draft,fine:false,symptoms:draft.symptoms.includes(s)?draft.symptoms.filter(x=&gt;x!==s):[...draft.symptoms,s]})} |
| UI0714 :38 | select / WeekJournal | (child/component label) | onChange={e=&gt;setDraft({...draft,severity:e.target.value})} |
| UI0715 :38 | input / WeekJournal | Possibly an illness | onChange={e=&gt;setDraft({...draft,illness:e.target.checked})} |
| UI0716 :38 | textarea / WeekJournal | Private note (optional) | onChange={e=&gt;setDraft({...draft,note:e.target.value})} |
| UI0717 :38 | button / WeekJournal | {draft.revision?'Update check-in':'Save check-in'} | (native form/control behavior) |
| UI0718 :38 | button / WeekJournal | Cancel changes | onClick={()=&gt;{clear();setError('');}} |
| UI0719 :39 | button / WeekJournal | (child/component label) | onClick={()=&gt;choose(e.date,e.band)} |
| UI0720 :39 | button / WeekJournal | {'Delete check-in ${e.date} ${e.band}'} | onClick={()=&gt;setRemove(e)} |
| UI0721 :40 | button / WeekJournal | Undo delete | onClick={async()=&gt;{if(collection.records.some(e=&gt;e.id===deleted.id)){setError('A newer entry exists. Undo did not overwrite it.');return;}if(await collection.save({...deleted,revision:0}))setDeleted(null);}} |
| UI0722 :41 | WeekPatterns / WeekJournal | (child/component label) | onEdit={(date,group)=&gt;{choose(date,group);setTab('Journal');}} |
| UI0723 :41 | WeekSeason / WeekJournal | (child/component label) | href={href} |
| UI0724 :43 | Confirm / WeekJournal | "Delete this check-in?" | onCancel={()=&gt;setRemove(null)}; onConfirm={async()=&gt;{if(await collection.remove(remove.id)){setDeleted(remove);setRemove(null);}}} |

### components/expanded/WeekOutdoors.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0725 :34 | Link / WeekOutdoors | Back to My Week | href={href('plan')} |
| UI0726 :34 | form / WeekOutdoors | {error&&&lt;p role={error.startsWith('Saved')?'status':'alert'}&gt;{error}&lt;/p&gt;} | onSubmit={e=&gt;{e.preventDefault();commit();}} |
| UI0727 :35 | input / WeekOutdoors | "A walk, garden care, a cleanup..." | onChange={e=&gt;setDraft({...draft,activity:e.target.value})} |
| UI0728 :35 | input / WeekOutdoors | "A park or neighborhood" | onChange={e=&gt;setDraft({...draft,place:e.target.value})} |
| UI0729 :35 | DateInput / WeekOutdoors | Date | onChange={e=&gt;setDraft({...draft,date:e.target.value})} |
| UI0730 :35 | input / WeekOutdoors | Minutes | onChange={e=&gt;setDraft({...draft,duration:Number(e.target.value)})} |
| UI0731 :36 | select / WeekOutdoors | {homeMemberKeys.map(g=&gt;&lt;option key={g} value={g}&gt;{memberCatalog[g].label}&lt;/option&gt;)} | onChange={e=&gt;setDraft({...draft,group:e.target.value})} |
| UI0732 :37 | button / WeekOutdoors | Refresh forecast | onClick={()=&gt;{setReview({...review,forecast:'current'});setAcknowledged('');}} |
| UI0733 :37 | a / WeekOutdoors | Check official warnings | href="https://www.weather.gov/" |
| UI0734 :37 | button / WeekOutdoors | {needsReview?'I reviewed these changes':'Changes reviewed'} | onClick={()=&gt;setAcknowledged(selectionSignature)} |
| UI0735 :38 | input / WeekOutdoors | (child/component label) | onChange={e=&gt;setCompared(old=&gt;e.target.checked?[...old,p.name]:old.filter(x=&gt;x!==p.name))} |
| UI0736 :38 | button / WeekOutdoors | {draft.period===p.name?'Selected':'Choose'} {p.name.toLowerCase()} | onClick={()=&gt;setDraft({...draft,period:p.name})} |
| UI0737 :38 | button / WeekOutdoors | (child/component label) | onClick={()=&gt;setDraft({...draft,period:name})} |
| UI0738 :38 | button / WeekOutdoors | Cancel forecast loading | onClick={()=&gt;setReview({...review,forecast:'unavailable'})} |
| UI0739 :38 | button / WeekOutdoors | Retry forecast | onClick={()=&gt;setReview({...review,forecast:'current'})} |
| UI0740 :38 | DateInput / WeekOutdoors | Check again on | onChange={e=&gt;setDraft({...draft,checkDate:e.target.value})} |
| UI0741 :39 | summary / WeekOutdoors | Forecast coverage | (native form/control behavior) |
| UI0742 :39 | a / WeekOutdoors | Check official weather | href="https://www.weather.gov/" |
| UI0743 :39 | a / WeekOutdoors | Check AirNow | href="https://www.airnow.gov/" |
| UI0744 :40 | summary / WeekOutdoors | Preparation | (native form/control behavior) |
| UI0745 :40 | input / WeekOutdoors | {item} | onChange={e=&gt;setDraft({...draft,preparation:e.target.checked?[...(draft.preparation??[]),item]:(draft.preparation??[]).filter(i=&gt;i!==item)})} |
| UI0746 :40 | input / WeekOutdoors | Request a material-change watch when connected | onChange={e=&gt;setDraft({...draft,watch:e.target.checked})} |
| UI0747 :40 | button / WeekOutdoors | {existing?'Review plan changes':'Save outdoor plan'} | (native form/control behavior) |
| UI0748 :41 | Link / WeekOutdoors | Open saved plan | href={'${href('plan')}&weekTask=${encodeURIComponent(existing.id)}'} |
| UI0749 :41 | button / WeekOutdoors | Save forecast check | onClick={()=&gt;{const date=draft.checkDate\|\|dayAdd(draft.date,-2);if(blocked\|\|!navigator.onLine\|\|!date\|\|!validActionDate(date)\|\|date&lt;today\|\|date&gt;draft.date){setError('Choose a valid check date and reconnect before saving.');return;}if(state?.addActions([{key:'${draft.key}:check-forecast',title:'Check conditions for ${draft.activity}',origin:'Outdoors',reason:'Recheck official conditions before ${draft.date}. No forecast or automatic alert is promised.'}],date))setError('Foreca |
| UI0750 :41 | Confirm / WeekOutdoors | "Update this outdoor plan?" | onCancel={()=&gt;{setChange(null);setError('');}}; onConfirm={()=&gt;commit(true)} |

### components/expanded/WeekPlanningRail.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0751 :34 | button / WeekPlanningRail | {'View ${dayLabel(item.date)}'} | onClick={()=&gt;onDay(item.date)} |
| UI0752 :34 | button / WeekPlanningRail | {item.title} | onClick={()=&gt;onOpen(item.action!)} |
| UI0753 :34 | Link / WeekPlanningRail | {item.title} | href={weekRecordHref(item.record!,href)} |
| UI0754 :35 | summary / WeekPlanningRail | All upcoming ( {upcoming.length} ) | (native form/control behavior) |
| UI0755 :35 | button / WeekPlanningRail | {item.title} | onClick={()=&gt;onOpen(item.action!)} |
| UI0756 :35 | Link / WeekPlanningRail | {item.title} | href={weekRecordHref(item.record!,href)} |
| UI0757 :37 | button / WeekPlanningRail | "Plan my weekly review" | onClick={()=&gt;{setDraft(preferences);setFeedback('');setSheet(true);}} |
| UI0758 :38 | summary / WeekPlanningRail | Reminder requests | (native form/control behavior) |
| UI0759 :38 | button / WeekPlanningRail | {a.title} | onClick={()=&gt;onOpen(a)} |
| UI0760 :39 | summary / WeekPlanningRail | Earlier record dates | (native form/control behavior) |
| UI0761 :39 | Link / WeekPlanningRail | (child/component label) | href={weekRecordHref(r,href)} |
| UI0762 :41 | BottomSheet / WeekPlanningRail | "week-review-planning" | onClose={closeSheet} |
| UI0763 :41 | summary / WeekPlanningRail | Choose a regular review moment | (native form/control behavior) |
| UI0764 :41 | select / WeekPlanningRail | "Review day" | onChange={e=&gt;setDraft({...draft,weekday:Number(e.target.value)})} |
| UI0765 :41 | input / WeekPlanningRail | Preferred prompt time | onChange={e=&gt;setDraft({...draft,time:e.target.value})} |
| UI0766 :41 | select / WeekPlanningRail | "Review timezone" | onChange={e=&gt;setDraft({...draft,zone:e.target.value})} |
| UI0767 :41 | button / WeekPlanningRail | Save weekly review plan | onClick={saveReviewTask} |
| UI0768 :41 | button / WeekPlanningRail | Pause weekly prompt preference | onClick={()=&gt;{if(blocked\|\|!navigator.onLine){setFeedback('Could not save preferences. Your choices are kept.');return;}setPreferences({...preferences,enabled:false});setFeedback('Weekly prompt preference paused. Your already saved review task is unchanged.');}} |
| UI0769 :41 | button / WeekPlanningRail | Done | onClick={closeSheet} |

### components/expanded/WeekProgress.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0770 :37 | Link / row | {entry.image ? &lt;ExplorePhoto scene={entry.image} className="mw-progress-photo" /&gt; : &lt;span className="mw-progress-symbol"&gt;&lt;Icon size={24} aria-hidden="true" /&gt;&lt;/span&gt;} | href={target}; onClick={() =&gt; continueWork(entry)} |
| UI0771 :38 | button / row | {'Complete current step of ${entry.title}'} | onClick={() =&gt; finishStep(entry)} |
| UI0772 :42 | summary / WeekProgress | All in progress | (native form/control behavior) |
| UI0773 :42 | Link / WeekProgress | Find a project | href={href('act', 'projects')} |

### components/expanded/WeekReviewPlanner.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0774 :20 | summary / WeekReviewPlanner | {completions.length} recorded completions | (native form/control behavior) |
| UI0775 :21 | input / WeekReviewPlanner | "Not set" | onChange={e=&gt;{setMinutes(e.target.value);setConfirm(false);}} |
| UI0776 :22 | select / WeekReviewPlanner | "Weekly focus" | onChange={e=&gt;{setChosenFocus(e.target.value);setConfirm(false);}} |
| UI0777 :23 | summary / WeekReviewPlanner | Make room for unfinished work | (native form/control behavior) |
| UI0778 :23 | input / WeekReviewPlanner | (child/component label) | onChange={e=&gt;{setDecisions(old=&gt;old.map(item=&gt;item.id===d.id?{...item,selected:e.target.checked}:item));setConfirm(false);}} |
| UI0779 :23 | select / WeekReviewPlanner | {'Choice for ${a.title}'} | onChange={e=&gt;{setDecisions(old=&gt;old.map(item=&gt;item.id===d.id?{...item,choice:e.target.value as ReviewChoice}:item));setConfirm(false);}} |
| UI0780 :23 | DateInput / WeekReviewPlanner | {'New date for ${a.title}'} | onChange={e=&gt;{setDecisions(old=&gt;old.map(item=&gt;item.id===d.id?{...item,date:e.target.value}:item));setConfirm(false);}} |
| UI0781 :24 | button / WeekReviewPlanner | Apply week plan | onClick={apply} |
| UI0782 :24 | button / WeekReviewPlanner | Keep editing | onClick={()=&gt;setConfirm(false)} |
| UI0783 :24 | button / WeekReviewPlanner | Review my changes | onClick={()=&gt;{if(prepared.error\|\|capacityInvalid){setFeedback(prepared.error\|\|'Enter available minutes between 0 and 10080.');return;}setFeedback('');setConfirm(true);}} |
| UI0784 :25 | button / WeekReviewPlanner | Reload task choices | onClick={()=&gt;{setDecisions(captureReview(state.actions,metas));setConfirm(false);setFeedback('Latest tasks loaded. Your focus and availability choices remain.');}} |

### components/expanded/WeekTimeline.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0785 :9 | button / WeekTimeline | {'Reschedule ${item.action.title}'} | onClick={()=&gt;onMove(item.action)} |

### components/expanded/WeekUpdates.tsx

Contract family: P01-P06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0786 :34 | summary / WeekUpdateList | Forecast scope | (native form/control behavior) |
| UI0787 :35 | button / WeekUpdateList | Review task | onClick={()=&gt;onOpen(action)} |
| UI0788 :36 | Link / WeekUpdateList | Open record | href={source} |
| UI0789 :36 | a / WeekUpdateList | Official source | href={change.sourceUrl} |
| UI0790 :37 | button / WeekUpdateList | {'Acknowledge ${change.title}'} | onClick={()=&gt;acknowledge(change)} |
| UI0791 :42 | summary / WeekUpdateList | {changes.length-3} more changes | (native form/control behavior) |
| UI0792 :42 | button / WeekUpdateList | Review task | onClick={()=&gt;onOpen(actions.find(a=&gt;a.id===change.actionId)!)} |
| UI0793 :42 | button / WeekUpdateList | Reviewed | onClick={()=&gt;acknowledge(change)} |
| UI0794 :48 | WeekUpdateList / WeekUpdates | (child/component label) | onOpen={props.onOpen} |
| UI0795 :62 (review control) | select / WeekPlanningReviewControls | "Activity change scenario" | onChange={e=&gt;setScenario(e.target.value)} |
| UI0796 :62 (review control) | button / WeekPlanningReviewControls | Load a sample activity update | onClick={load} |
| UI0797 :62 (review control) | button / WeekPlanningReviewControls | Clear sample activity updates | onClick={()=&gt;{setSamples([]);setNotice('Sample activity updates cleared. Tasks were kept.');}} |

### components/expanded/WorkspaceFeedback.tsx

Contract family: G01 / X01-X06 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0798 :23 | button / WorkspaceFeedback | "Dismiss workspace message" | onClick={clearMessage} |
| UI0799 :25 | button / WorkspaceFeedback | "Dismiss workspace message" | onClick={clearMessage} |

### components/foundation/EditorialScene.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0800 :63 | img / EditorialScene | {/* Local, generated artwork needs no remote optimizer and reserves its space before loading. */} {/* eslint-disable-next-line @next/next/no-img-element */} | onLoad={() =&gt; { setLoaded(scene); setFailed(current =&gt; current === scene ? '' : current); }}; onError={() =&gt; setFailed(scene)} |

### components/foundation/FactorReadingGuide.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0801 :18 | summary / FactorReadingGuide | (child/component label) | (native form/control behavior) |
| UI0802 :18 | a / FactorReadingGuide | {guide.source} | href={guide.url} |

### components/foundation/FactorScoreCard.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0803 :7 | Link / FactorScoreCard | {'${title}. ${score === null ? severity === 'no_data' ? 'No data' : 'Not scored' : 'Score ${score} of 100'}. ${reading}. Open details.'} | href={href} |

### components/foundation/FactorSteps.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0804 :14 | button / FactorSteps | {'Previous step, step ${previous + 1}'} | onClick={() =&gt; setActive(previous)} |
| UI0805 :22 | button / FactorSteps | {'Next step, step ${next + 1}'} | onClick={() =&gt; setActive(next)} |
| UI0806 :24 | summary / FactorSteps | Read all steps together | (native form/control behavior) |

### components/foundation/FactorTrend.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0807 :32 | input / FactorTrend | {'Explore ${title.toLowerCase()}'} | onChange={event =&gt; setSelected(Number(event.target.value))} |
| UI0808 :33 | summary / FactorTrend | View readings as a table | (native form/control behavior) |

### components/foundation/FamilyGuidance.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0809 :55 | summary / FamilyGuidance | How household context is used | (native form/control behavior) |
| UI0810 :57 | Link / FamilyGuidance | Explore the UV forecast | href={factorHref('uv')} |
| UI0811 :58 | button / FamilyGuidance | {label} | onClick={() =&gt; setArea(key)} |
| UI0812 :65 | summary / FamilyGuidance | Why this belongs here | (native form/control behavior) |
| UI0813 :65 | a / FamilyGuidance | {item.source} | href={item.url} |
| UI0814 :65 | Link / FamilyGuidance | Explore {factor.shortTitle.toLowerCase()} | href={factorHref(item.key)} |
| UI0815 :68 | input / FamilyGuidance | (child/component label) | onChange={event =&gt; setChecked(current =&gt; event.target.checked ? [...current, step.key] : current.filter(key =&gt; key !== step.key))} |
| UI0816 :70 | Link / FamilyGuidance | Back to Today | href={parentHref} |

### components/foundation/FoundationPreview.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0817 :80 | summary / FoundationPreview | {expanded ? 'Expanded app review · Not approved' : c.review} | (native form/control behavior) |
| UI0818 :83 | select / FoundationPreview | {c.scenario} | onChange={e =&gt; changeScenario(e.target.value as FoundationScenario)} |
| UI0819 :84 | select / FoundationPreview | {c.appearance} | onChange={e =&gt; setMode(e.target.value)} |
| UI0820 :84 | select / FoundationPreview | {c.scale} | onChange={e =&gt; setScale(e.target.value)} |
| UI0821 :85 | select / FoundationPreview | "Animation" | onChange={e =&gt; setMotion(e.target.value as MotionMode)} |
| UI0822 :85 | select / FoundationPreview | "Scene lighting" | onChange={e =&gt; setTime(e.target.value as SceneTime)} |
| UI0823 :86 | input / FoundationPreview | {c.contrast} | onChange={e =&gt; setContrast(e.target.checked)} |
| UI0824 :86 | input / FoundationPreview | {c.motion} | onChange={e =&gt; setMotion(e.target.checked ? 'reduce' : 'system')} |
| UI0825 :90 | Product / FoundationPreview | (child/component label) | onDisplay={next=&gt;{setScale(next.scale);setMotion(next.motion);setContrast(next.contrast);if(next.appearance)setMode(next.appearance);}} |
| UI0826 :239 | button / toastElement | {c.undo} | onClick={() =&gt; { toast.action?.(); setToast(null); }} |
| UI0827 :240 | Readings / readingView | (child/component label) | onLearn={() =&gt; openSheet({ type: 'learn', height: 'standard', topic: 'air' })}; onSelect={expandFactor} |
| UI0828 :240 | HomeOverviewWorkspace / readingView | (child/component label) | href={expandedHref} |
| UI0829 :243 | Button / Product | {c.retry} | onClick={() =&gt; mockRequest(() =&gt; setResolved(true))} |
| UI0830 :244 | EmptyState / Product | (child/component label) | action={current === 'empty' ? &lt;Button onClick={() =&gt; navigate('journal')}&gt;{c.continue}&lt;/Button&gt; : undefined} |
| UI0831 :244 | Button / Product | {c.continue} | onClick={() =&gt; navigate('journal')} |
| UI0832 :245 | EmptyState / Product | (child/component label) | action={expanded?&lt;div className="hc-flow"&gt;&lt;Link className="hp-primary" href="/onboarding/preview/?design=mobile"&gt;{c.setup}&lt;/Link&gt;&lt;Link href="/foundation/preview/expanded/?access=public"&gt;Browse without a home&lt;/Link&gt;&lt;/div&gt;:&lt;Button onClick={() =&gt; mockRequest(() =&gt; setResolved(true))} busy={busy}&gt;{c.setup}&lt;/Button&gt;} |
| UI0833 :245 | Link / Product | {c.setup} | href="/onboarding/preview/?design=mobile" |
| UI0834 :245 | Link / Product | Browse without a home | href="/foundation/preview/expanded/?access=public" |
| UI0835 :245 | Button / Product | {c.setup} | onClick={() =&gt; mockRequest(() =&gt; setResolved(true))} |
| UI0836 :246 | EmptyState / Product | (child/component label) | action={&lt;Button onClick={() =&gt; setResolved(true)}&gt;{c.goToday}&lt;/Button&gt;} |
| UI0837 :246 | Button / Product | {c.goToday} | onClick={() =&gt; setResolved(true)} |
| UI0838 :249 | Bars / Product | (child/component label) | onLearn={() =&gt; openSheet({ type: 'learn', height: 'standard', topic: 'pfas', generic: true })} |
| UI0839 :250 | Button / Product | {c.save} | onClick={() =&gt; mockRequest(() =&gt; showToast(c.saved))} |
| UI0840 :250 | Button / Product | {c.continue} | onClick={() =&gt; showToast(c.saved)} |
| UI0841 :250 | Button / Product | {c.cancel} | onClick={() =&gt; showToast(c.saved)} |
| UI0842 :250 | Button / Product | {c.destructive} | onClick={removeEntry} |
| UI0843 :250 | button / Product | {c.labels.settingsExample} | onClick={() =&gt; navigate('settings')} |
| UI0844 :253 | SwipeRow / Product | (child/component label) | onAction={removeEntry} |
| UI0845 :253 | Button / Product | {c.replaceToast} | onClick={() =&gt; showToast(c.saved)} |
| UI0846 :254 | Button / Product | {c.standard} | onClick={() =&gt; openSheet({ type: 'learn', height: 'standard', topic: 'air' })} |
| UI0847 :254 | Button / Product | {c.tall} | onClick={() =&gt; openSheet({ type: 'assistant', height: 'tall' })} |
| UI0848 :254 | Button / Product | {c.compact} | onClick={() =&gt; openSheet({ type: 'map', height: 'content' })} |
| UI0849 :256 | Card / Product | {c.labels.tappableCard} | onClick={() =&gt; openSheet({ type: 'learn', height: 'standard', topic: 'air' })} |
| UI0850 :257 | Button / Product | {c.compact} | onClick={() =&gt; openSheet({ type: 'map', height: 'content' })} |
| UI0851 :262 | ExpandedSettings / Product | (child/component label) | href={expandedHref}; onAlerts={()=&gt;openSheet({type:'alerts',height:'tall'})}; onDisplay={onDisplay} |
| UI0852 :264 | ExpandedDestinationPage / Product | (child/component label) | href={expandedHref} |
| UI0853 :264 | ExpandedAct / Product | (child/component label) | href={expandedHref} |
| UI0854 :264 | ExpandedPlan / Product | (child/component label) | href={expandedHref} |
| UI0855 :266 | ExpandedConnections / Product | (child/component label) | href={expandedHref} |
| UI0856 :274 | button / Product | {c.unread(unread)} | onClick={()=&gt;openSheet({type:"alerts",height:"standard"})} |
| UI0857 :274 | Link / Product | {'Back to ${routeTitles[backTab]}'} | href={previewHref(backTab)} |
| UI0858 :274 | button / Product | {c.labels.back} | onClick={backFromSettings} |
| UI0859 :274 | button / Product | {c.labels.assistant} | onClick={()=&gt;openSheet({type:"assistant",height:"tall"})} |
| UI0860 :274 | button / Product | {c.unread(unread)} | onClick={() =&gt; openSheet({ type: 'alerts', height: 'standard' })} |
| UI0861 :274 | button / Product | {c.labels.settings} | onClick={() =&gt; navigate('settings')} |
| UI0862 :276 | button / Product | {c.retry} | onClick={() =&gt; mockRequest(() =&gt; setResolved(true))} |
| UI0863 :277 | AppNavigation / Product | (child/component label) | href={previewHref}; onNavigate={navigate} |
| UI0864 :277 | a / Product | (child/component label) | href={previewHref(tab)}; onClick={e =&gt; { e.preventDefault(); if (route !== tab \|\| inDetail) navigate(tab); }} |
| UI0865 :277 | button / Product | {c.labels.assistant} | onClick={() =&gt; openSheet({ type: 'assistant', height: 'tall' })} |
| UI0866 :280 | ExpandedLunaPreview / Product | (child/component label) | onClose={closeSheet} |
| UI0867 :288 | LunaAssistant / Product | (child/component label) | onClose={closeSheet} |
| UI0868 :289 | BottomSheet / Product | "foundation-sheet" | onClose={closeSheet} |
| UI0869 :292 | AlertCenter / Product | (child/component label) | onSettings={()=&gt;navigate('settings',true)}; onOpen={item=&gt;{const url=new URL(location.href);url.searchParams.delete('sheet');history.replaceState({...history.state,_foundationSheet:false},'',url);sheetEntry.current=false;setSheet(null);router.push(expandedHref(item.target.tab,item.target.destination));}} |
| UI0870 :292 | Button / Product | {c.retry} | onClick={() =&gt; mockRequest(() =&gt; setSheet({ ...sheet, state: undefined }))} |
| UI0871 :293 | SwipeRow / Product | (child/component label) | onAction={() =&gt; { const previous = unread; setUnread(Math.max(0, unread - 1)); showToast(c.dismissConfirm, () =&gt; setUnread(previous)); }} |
| UI0872 :293 | button / Product | {c.markRead} | onClick={() =&gt; setUnread(Math.max(0, unread - 1))} |
| UI0873 :293 | Button / Product | {c.markAll} | onClick={() =&gt; setUnread(0)} |
| UI0874 :293 | Button / Product | {c.replaceSheet} | onClick={() =&gt; openSheet({ type: 'learn', height: 'standard', topic: 'pfas', generic: true })} |
| UI0875 :293 | Button / Product | {c.goToday} | onClick={() =&gt; navigate('today', true)} |
| UI0876 :312 | ContributionBar / Readings | (child/component label) | onSelect={onSelect} |
| UI0877 :313 | ExpandableCard / Readings | {factor.key} | onOpenChange={open =&gt; setExpanded(open ? factor.key : null)} |
| UI0878 :314 | button / Readings | {c.learn} | onClick={onLearn} |
| UI0879 :331 | SegmentedControl / Controls | {c.labels.journalMode} | onChange={setMode} |
| UI0880 :331 | SegmentedControl / Controls | {c.labels.tenure} | onChange={setRenting} |
| UI0881 :331 | SegmentedControl / Controls | {c.labels.filter} | onChange={value =&gt; setMode(value === 'All' ? 'Log' : 'Trends')} |
| UI0882 :333 | AccordionRow / Controls | "household-options" | onToggle={() =&gt; setOpen(open === 'household' ? null : 'household')} |
| UI0883 :333 | ToggleChip / Controls | {group} | onToggle={() =&gt; toggle(group)} |
| UI0884 :333 | ToggleChip / Controls | {c.unavailable} | onToggle={() =&gt; {}} |
| UI0885 :334 | AccordionRow / Controls | "accessibility-options" | onToggle={() =&gt; setOpen(open === 'accessibility' ? null : 'accessibility')} |
| UI0886 :334 | Switch / Controls | {c.switchLabel} | onChange={setReduce} |
| UI0887 :334 | Switch / Controls | {c.disabledSwitch} | onChange={() =&gt; {}} |
| UI0888 :335 | Switch / Controls | {c.switchLabel} | onChange={setReduce} |
| UI0889 :335 | Switch / Controls | {c.labels.enabledSwitch} | onChange={value =&gt; setReduce(!value)} |
| UI0890 :335 | Switch / Controls | {c.disabledSwitch} | onChange={() =&gt; {}} |
| UI0891 :356 | form / Form | (child/component label) | onSubmit={e =&gt; { e.preventDefault(); const next = { address: validation('address', address), year: validation('year', year), water: validation('water', water) }; setErrors(next); if (Object.values(next).some(Boolean)) return; setBusy(true); timer.current = setTimeout(() =&gt; { setBusy(false); setSaveError(scenario === 'form-error'); if (scenario !== 'form-error') showToast(c.saved); }, 650); }} |
| UI0892 :357 | input / Form | {c.address} {errors.address && &lt;span id="address-error" className="halo-error"&gt;&lt;Info size={16} aria-hidden="true" /&gt;{errors.address}&lt;/span&gt;} | onChange={e =&gt; { setAddress(e.target.value); clearValid('address', e.target.value); }}; onBlur={() =&gt; validate('address', address)} |
| UI0893 :358 | input / Form | {c.year} {errors.year && &lt;span id="year-error" className="halo-error"&gt;&lt;Info size={16} aria-hidden="true" /&gt;{errors.year}&lt;/span&gt;} | onChange={e =&gt; { const value = e.target.value.replace(/\D/g, ''); setYear(value); clearValid('year', value); }}; onBlur={() =&gt; validate('year', year)} |
| UI0894 :359 | select / Form | {c.waterOptions.map((value, i) =&gt; &lt;option key={value} value={i ? value : ''}&gt;{value}&lt;/option&gt;)} | onChange={e =&gt; { setWater(e.target.value); clearValid('water', e.target.value); }}; onBlur={() =&gt; validate('water', water)} |
| UI0895 :360 | textarea / Form | {c.note} {note.length &gt; 400 && &lt;span className="halo-f-meta" role="status"&gt;{note.length}/500&lt;/span&gt;} | onChange={e =&gt; setNote(e.target.value)} |
| UI0896 :361 | input / Form | {c.checkbox} | onChange={e =&gt; setIllness(e.target.checked)} |
| UI0897 :362 | input / Form | {c.slider} : {size} % | onChange={e =&gt; setSize(Number(e.target.value))} |
| UI0898 :364 | ExpandableCard / Form | "long" | onOpenChange={setLongOpen} |
| UI0899 :369 | button / Bars | {'${row.name}, ${row.value}, ${row.ratio} times the limit. ${row.ratio &gt; 2 ? 'Continues past the chart. ' : ''}${c.pfas}'} | onClick={onLearn} |

### components/foundation/HomeHousehold.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0900 :33 | Link / HomeHousehold | {'Home guidance for ${memberCatalog[member].label.toLowerCase()}'} | href={memberHref(member)} |
| UI0901 :33 | Link / HomeHousehold | Update your household in Settings. | href="/settings" |
| UI0902 :71 | summary / HomeMemberGuidance | What this can and cannot tell you | (native form/control behavior) |
| UI0903 :71 | a / HomeMemberGuidance | {action.sourceLabel} | href={action.sourceUrl} |
| UI0904 :72 | Link / HomeMemberGuidance | Explore {factor.shortTitle.toLowerCase()} | href={factorHref(action.factor)} |
| UI0905 :76 | Link / HomeMemberGuidance | (child/component label) | href={memberHref(key)} |
| UI0906 :77 | Link / HomeMemberGuidance | Back to your Homeguard household | href={parentHref} |

### components/foundation/LunaAssistant.tsx

Contract family: X02.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0907 :54 | a / citedAnswer | {'Source ${number}: ${source.label}'} | href={'#${target}'}; onClick={event =&gt; { event.preventDefault(); const element = document.getElementById(target); element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest' }); }} |
| UI0908 :237 | button / promptButtons | (child/component label) | onClick={() =&gt; send(prompt.label, prompt)} |
| UI0909 :239 | dialog / LunaAssistant | {options && &lt;div id="luna-options" className="halo-luna-options"&gt;&lt;button onClick={startOver}&gt;&lt;RotateCcw size={17} aria-hidden="true" /&gt;Start a new conversation&lt;/button&gt;&lt;b | onCancel={event =&gt; { event.preventDefault(); closePanel(); }}; onClick={event =&gt; { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX &lt; bounds.left \|\| event.clientX &gt; bounds.right \|\| event.clientY &lt; bounds.top \|\| event.clientY &gt; bounds.bottom) closePanel(); }} |
| UI0910 :244 | button / LunaAssistant | "Luna options" | onClick={() =&gt; setOptions(value =&gt; !value)} |
| UI0911 :244 | button / LunaAssistant | "Close Luna" | onClick={closePanel} |
| UI0912 :245 | button / LunaAssistant | Start a new conversation | onClick={startOver} |
| UI0913 :245 | button / LunaAssistant | About Luna | onClick={() =&gt; { setAbout(value =&gt; !value); setOptions(false); }} |
| UI0914 :246 | button / LunaAssistant | {live ? 'Close Luna information' : 'Close Luna information'} | onClick={() =&gt; setAbout(false)} |
| UI0915 :247 | div / LunaAssistant | {!messages.length && promptButtons} {live && !messages.length && !sessionChanged && suggestionStatus === 'loading' && &lt;p className="halo-luna-service-note" role="status"&gt; | onScroll={() =&gt; { const node = log.current; if (node) setBelow(node.scrollHeight - node.clientHeight - node.scrollTop &gt; 100); }} |
| UI0916 :249 | button / LunaAssistant | How this works | onClick={() =&gt; setAbout(true)} |
| UI0917 :253 | button / LunaAssistant | Retry suggestions | onClick={() =&gt; setSuggestionAttempt(value =&gt; value + 1)} |
| UI0918 :255 | a / LunaAssistant | View {factorReadings[message.factor].title.toLowerCase()} and references | href={factorHref(message.factor)}; onClick={event =&gt; { if (!onNavigate \|\| event.button !== 0 \|\| event.metaKey \|\| event.ctrlKey \|\| event.shiftKey \|\| event.altKey) return; event.preventDefault(); onNavigate(factorHref(message.factor!)); }} |
| UI0919 :259 | a / LunaAssistant | (child/component label) | href={citation.url} |
| UI0920 :262 | button / LunaAssistant | Retry question | onClick={() =&gt; { void sendLive(message.retryQuestion!, message.id); }} |
| UI0921 :265 | button / LunaAssistant | Cancel request | onClick={() =&gt; cancelRequest()} |
| UI0922 :269 | button / LunaAssistant | "Scroll to latest message" | onClick={scrollToLatest} |
| UI0923 :272 | form / LunaAssistant | (child/component label) | onSubmit={event =&gt; { event.preventDefault(); send(draft); }} |
| UI0924 :273 | textarea / LunaAssistant | "luna-message" | onChange={event =&gt; setDraft(event.target.value)}; onKeyDown={event =&gt; { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} |
| UI0925 :274 | button / LunaAssistant | "Suggested questions" | onClick={() =&gt; setSuggestions(value =&gt; !value)} |
| UI0926 :274 | button / LunaAssistant | "Send message" | (native form/control behavior) |

### components/foundation/PersonalHero.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0927 :66 | FactorScoreCard / PersonalHero | {factor.title} | href={factorHref(key)} |
| UI0928 :78 | button / MotionButton | {paused ? 'Play ambient animation' : 'Pause ambient animation'} | onClick={togglePaused} |
| UI0929 :85 | Link / HouseholdContext | (child/component label) | href={familyHref} |
| UI0930 :131 | summary / FactorDetail | (child/component label) | (native form/control behavior) |
| UI0931 :131 | a / FactorDetail | Explore the sources | href="#reading-sources" |
| UI0932 :138 | button / FactorDetail | Retry explanation | onClick={runtime.retryLearn} |
| UI0933 :147 | a / FactorDetail | EPA guidance on PFAS filters | href="https://www.epa.gov/water-research/identifying-drinking-water-filters-certified-reduce-pfas" |
| UI0934 :150 | a / FactorDetail | (child/component label) | href={source.url} |
| UI0935 :151 | Link / FactorDetail | (child/component label) | href={factorHref(key)} |
| UI0936 :151 | Link / FactorDetail | Back to your overview | href={parentHref} |
| UI0937 :187 | a / FactorFocus | Plan your protection | href="#protection" |
| UI0938 :202 | a / FactorFocus | Care for damp spaces | href="#protection" |
| UI0939 :220 | a / FactorFocus | Understand filter options | href="#protection" |
| UI0940 :226 | a / FactorFocus | Read about home testing | href="#protection" |
| UI0941 :236 | a / FactorFocus | See practical steps | href="#protection" |

### components/foundation/PreviewHousehold.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0942 :27 | input / PreviewHouseholdPicker | {memberCatalog[key].label} | onChange={event =&gt; setBand(key, event.target.checked)} |

### components/foundation/PreviewSectionLink.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0943 :22 | a / PreviewSectionLink | {label} | href={'#${target}'}; onClick={jump} |

### components/foundation/SegmentedScore.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0944 :34 | Link / CompactContributionBar | {'${s.label}, ${s.share === null ? 'No data' : '${Number(s.percent.toFixed(1))}% of risk'}. Open factor page.'} | href={s.href} |

### components/homeguard/FoodEvidence.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0945 :18 | Empty / FoodEvidence | "This reference is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('evidence')}&gt;Return to food information&lt;/button&gt;} |
| UI0946 :18 | button / FoodEvidence | Return to food information | onClick={() =&gt; props.navigate('evidence')} |
| UI0947 :22 | FoodSourceLink / FoodEvidence | {evidence.kind === 'Notice' ? 'FDA enforcement source documentation' : 'FDA PFAS food monitoring publications'} | href={evidence.url} |
| UI0948 :24 | WorkspaceLink / FoodEvidence | "Return to food information" | onClick={() =&gt; props.navigate('evidence')} |
| UI0949 :28 | select / FoodEvidence | (child/component label) | onChange={event =&gt; setFilters({ ...filters, region: event.target.value })} |
| UI0950 :28 | select / FoodEvidence | (child/component label) | onChange={event =&gt; setFilters({ ...filters, category: event.target.value })} |
| UI0951 :28 | select / FoodEvidence | (child/component label) | onChange={event =&gt; setFilters({ ...filters, kind: event.target.value })} |
| UI0952 :29 | FoodSourceLink / FoodEvidence | Explore FDA monitoring and its limits | href={foodSources.food} |
| UI0953 :29 | FoodSourceLink / FoodEvidence | Prepare a question for an Extension contact | href={foodSources.extension} |
| UI0954 :29 | button / FoodEvidence | Clear filters | onClick={() =&gt; setFilters({ region: 'All', category: 'All', kind: 'All' })} |
| UI0955 :29 | WorkspaceLink / FoodEvidence | {item.title.replace(/^Example /, '').replace('example ', '')} | onClick={() =&gt; props.navigate('evidence-detail', item.id)} |
| UI0956 :37 | RecordForm / EvidenceQuestionForm | (child/component label) | onSubmit={async event =&gt; { event.preventDefault(); if (!draft.question.trim()) { setStatus('Write the question you want to ask.'); return; } if (await questions.save({ ...draft, id: existing?.id ?? foodId('food-question'), revision: existing?.revision ?? 0 })) { clearDraft(); setStatus('Question saved.'); } }} |
| UI0957 :37 | textarea / EvidenceQuestionForm | "Does this notice include the lot I have?" | onChange={event =&gt; setDraft({ ...draft, question: event.target.value })} |
| UI0958 :37 | select / EvidenceQuestionForm | {tests.map(test =&gt; &lt;option key={test.id} value={test.id}&gt;{test.title} · {test.medium} · {test.review}&lt;/option&gt;)} | onChange={event =&gt; setDraft({ ...draft, reportId: event.target.value })} |
| UI0959 :37 | textarea / EvidenceQuestionForm | (child/component label) | onChange={event =&gt; setDraft({ ...draft, note: event.target.value })} |
| UI0960 :37 | DeleteButton / EvidenceQuestionForm | "Delete private question" | onClick={() =&gt; setDeleting(true)} |
| UI0961 :37 | Confirm / EvidenceQuestionForm | "Delete this question?" | onCancel={() =&gt; setDeleting(false)}; onConfirm={async () =&gt; { if (await questions.remove(existing.id)) { clearDraft(); setDeleting(false); setStatus('Private question deleted. The source record and report remain.'); } }} |

### components/homeguard/FoodExtent.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0962 :18 | button / FoodExtent | (child/component label) | onClick={() =&gt; setOpen(!open)} |
| UI0963 :22 | Link / FoodExtent | Open the environmental map | href={'/foundation/preview/map?${params}'} |

### components/homeguard/FoodFish.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI0964 :22 | Empty / FoodFish | "This note is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('fish-notes')}&gt;Return to notes&lt;/button&gt;} |
| UI0965 :22 | button / FoodFish | Return to notes | onClick={() =&gt; props.navigate('fish-notes')} |
| UI0966 :23 | button / FoodFish | Correct note | onClick={() =&gt; props.navigate('fish-note-edit', selectedNote.id)} |
| UI0967 :23 | button / FoodFish | Export this note | onClick={() =&gt; downloadFoodRecord('${selectedNote.id}.json', selectedNote)} |
| UI0968 :23 | DeleteButton / FoodFish | "Delete note" | onClick={() =&gt; setDeleting(true)} |
| UI0969 :23 | Confirm / FoodFish | "Delete this private note?" | onCancel={() =&gt; setDeleting(false)}; onConfirm={async () =&gt; { if (await notes.remove(selectedNote.id)) props.navigate('fish-notes'); }} |
| UI0970 :23 | WorkspaceLink / FoodFish | "All fish notes" | onClick={() =&gt; props.navigate('fish-notes')} |
| UI0971 :25 | button / FoodFish | Add a note | onClick={() =&gt; props.navigate('fish-note-new')} |
| UI0972 :25 | button / FoodFish | Export all fish notes | onClick={() =&gt; downloadFoodRecord('fish-notes.json', notes.records)} |
| UI0973 :25 | WorkspaceLink / FoodFish | {note.title} | onClick={() =&gt; props.navigate('fish-note-detail', note.id)} |
| UI0974 :25 | WorkspaceLink / FoodFish | "Back to fish advisories" | onClick={() =&gt; props.navigate('fish')} |
| UI0975 :28 | Empty / FoodFish | "Advisory reference unavailable" | action={&lt;button onClick={() =&gt; props.navigate('fish')}&gt;Choose a waterbody&lt;/button&gt;} |
| UI0976 :28 | button / FoodFish | Choose a waterbody | onClick={() =&gt; props.navigate('fish')} |
| UI0977 :31 | FoodSourceLink / FoodFish | Open official fish advisories | href={foodSources.fish} |
| UI0978 :34 | WorkspaceLink / FoodFish | {item.title} | onClick={() =&gt; props.navigate('fish-detail', item.id)} |
| UI0979 :35 | FoodSourceLink / FoodFish | NC official fish advisory resources | href={foodSources.fish} |
| UI0980 :37 | WorkspaceLink / FoodFish | "Optional catch or consumption notes" | onClick={() =&gt; props.navigate('fish-notes')} |
| UI0981 :37 | WorkspaceLink / FoodFish | "Change your selection" | onClick={() =&gt; props.navigate('fish')} |
| UI0982 :45 | input / FoodFish | "Try Willow" | onChange={event =&gt; { const query = event.target.value; const keepsSelection = !waterbody \|\| '${waterbody.title} ${waterbody.jurisdiction}'.toLowerCase().includes(query.toLowerCase()); patch({ query, ...(!keepsSelection ? { waterbody: '' } : {}) }); }} |
| UI0983 :45 | select / FoodFish | {choices.map(item =&gt; &lt;option key={item.id} value={item.id}&gt;{item.title} · {item.id === 'demo-uncovered' ? 'Other County, NC' : 'Example County, NC'}&lt;/option&gt;)} | onChange={event =&gt; patch({ waterbody: event.target.value })} |
| UI0984 :45 | select / FoodFish | (child/component label) | onChange={event =&gt; patch({ species: event.target.value })} |
| UI0985 :45 | input / FoodFish | "fish-advisory-audience" | onChange={() =&gt; patch({ audience: item.id })} |
| UI0986 :46 | WorkspaceLink / FoodFish | {item.title} | onClick={() =&gt; props.navigate('fish-detail', item.id)} |
| UI0987 :46 | FoodSourceLink / FoodFish | Open official fish advisory resources | href={foodSources.fish} |
| UI0988 :47 | WorkspaceLink / FoodFish | "Catch & consumption notes" | onClick={() =&gt; props.navigate('fish-notes')} |
| UI0989 :56 | Empty / FishNoteEditor | "The note to edit is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('fish-notes')}&gt;Return to notes&lt;/button&gt;} |
| UI0990 :56 | button / FishNoteEditor | Return to notes | onClick={() =&gt; props.navigate('fish-notes')} |
| UI0991 :57 | RecordForm / FishNoteEditor | {error && &lt;p role="alert"&gt;{error}&lt;/p&gt;} | onCancel={() =&gt; props.navigate('fish-notes')}; onSubmit={async event =&gt; { event.preventDefault(); if (!draft.title.trim() \|\| !validFoodDate(draft.date) \|\| !draft.species.trim() \|\| !draft.quantity.trim() \|\| !Number.isFinite(Number(draft.quantity)) \|\| Number(draft.quantity) &lt;= 0 \|\| !draft.unit.trim()) { setError('Add a label, valid date, species, positive quantity and original unit.'); return; } try { Intl.DateTimeFormat('en', { timeZone: draft.timezone }); } catch { setError( |
| UI0992 :63 | input / FishNoteEditor | "An afternoon catch" | onChange={event =&gt; patch({ title: event.target.value })} |
| UI0993 :63 | select / FishNoteEditor | (child/component label) | onChange={event =&gt; patch({ kind: event.target.value as FishNote['kind'] })} |
| UI0994 :63 | DateInput / FishNoteEditor | (child/component label) | onChange={event =&gt; patch({ date: event.target.value })} |
| UI0995 :63 | input / FishNoteEditor | (child/component label) | onChange={event =&gt; patch({ timezone: event.target.value })} |
| UI0996 :63 | input / FishNoteEditor | (child/component label) | onChange={event =&gt; patch({ species: event.target.value })} |
| UI0997 :63 | input / FishNoteEditor | (child/component label) | onChange={event =&gt; patch({ waterbody: event.target.value })} |
| UI0998 :63 | input / FishNoteEditor | (child/component label) | onChange={event =&gt; patch({ quantity: event.target.value })} |
| UI0999 :63 | input / FishNoteEditor | "fish, oz, g or your original unit" | onChange={event =&gt; patch({ unit: event.target.value })} |
| UI1000 :63 | select / FishNoteEditor | {fishRules.map(rule =&gt; &lt;option key={rule.id} value={rule.id}&gt;{rule.title}, v{rule.revision}&lt;/option&gt;)} | onChange={event =&gt; { const rule = fishRules.find(item =&gt; item.id === event.target.value); patch({ advisoryId: rule?.id ?? '', advisoryRevision: rule?.revision ?? 0 }); }} |
| UI1001 :63 | textarea / FishNoteEditor | (child/component label) | onChange={event =&gt; patch({ note: event.target.value })} |

### components/homeguard/FoodGarden.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1002 :19 | Empty / FoodGarden | "This garden is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('gardens')}&gt;Return to gardens&lt;/button&gt;} |
| UI1003 :19 | button / FoodGarden | Return to gardens | onClick={() =&gt; props.navigate('gardens')} |
| UI1004 :23 | button / FoodGarden | Edit site | onClick={() =&gt; props.navigate('garden-edit', site.id)} |
| UI1005 :23 | button / FoodGarden | Export site brief | onClick={() =&gt; downloadFoodRecord('${site.id}-brief.json', { site, linkedTests: linkedTests.map(test =&gt; ({ id: test.id, title: test.title, status: test.status, medium: test.medium, collected: test.collectionStart, review: test.review })), limits: 'Private synthetic site brief. No crop-safety interpretation or unselected report documents.' })} |
| UI1006 :24 | summary / FoodGarden | Manage site | (native form/control behavior) |
| UI1007 :24 | DeleteButton / FoodGarden | "Delete site" | onClick={() =&gt; setDeleting(true)} |
| UI1008 :27 | WorkspaceLink / FoodGarden | {test.title} | onClick={() =&gt; props.go('tests', 'detail', test.id)} |
| UI1009 :29 | button / FoodGarden | "Plan or record a test" | onClick={() =&gt; props.go('tests', 'new', site.id)} |
| UI1010 :30 | button / FoodGarden | "Link an existing test" | onClick={() =&gt; props.navigate('garden-links', site.id)} |
| UI1011 :33 | FoodSourceLink / FoodGarden | NC routine soil testing reference | href={foodSources.soil} |
| UI1012 :33 | FoodSourceLink / FoodGarden | Find a county Extension contact | href={foodSources.extension} |
| UI1013 :33 | WorkspaceLink / FoodGarden | "Prepare a grower inquiry" | onClick={() =&gt; props.navigate('growers')} |
| UI1014 :35 | Confirm / FoodGarden | "Delete this growing site?" | onCancel={() =&gt; setDeleting(false)}; onConfirm={async () =&gt; { if (await sites.remove(site.id)) props.navigate('gardens'); }} |
| UI1015 :35 | WorkspaceLink / FoodGarden | "All growing sites" | onClick={() =&gt; props.navigate('gardens')} |
| UI1016 :38 | button / FoodGarden | Add a growing site | onClick={() =&gt; props.navigate('garden-new')} |
| UI1017 :38 | WorkspaceLink / FoodGarden | {item.title} | onClick={() =&gt; props.navigate('garden-detail', item.id)} |
| UI1018 :38 | WorkspaceLink / FoodGarden | "Ask a garden or testing question" | onClick={() =&gt; props.navigate('growers')} |
| UI1019 :44 | Empty / GardenTestLinks | "This garden is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('gardens')}&gt;Return to gardens&lt;/button&gt;} |
| UI1020 :44 | button / GardenTestLinks | Return to gardens | onClick={() =&gt; props.navigate('gardens')} |
| UI1021 :45 | RecordForm / GardenTestLinks | (child/component label) | onCancel={() =&gt; props.navigate('garden-detail', site.id)}; onSubmit={async event =&gt; { event.preventDefault(); if (await sites.save({ ...site, revision: draft.revision, testIds: draft.testIds })) { clearSelected(); props.navigate('garden-detail', site.id); } }} |
| UI1022 :48 | input / GardenTestLinks | (child/component label) | onChange={event =&gt; setDraft({ ...draft, testIds: event.target.checked ? [...draft.testIds, test.id] : draft.testIds.filter(id =&gt; id !== test.id) })} |
| UI1023 :56 | Empty / GardenEditor | "The site to edit is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('gardens')}&gt;Return to sites&lt;/button&gt;} |
| UI1024 :56 | button / GardenEditor | Return to sites | onClick={() =&gt; props.navigate('gardens')} |
| UI1025 :57 | RecordForm / GardenEditor | {draft.irrigation === 'Household water source' && &lt;label className="hg-check"&gt;&lt;input type="checkbox" checked={draft.householdSourceConfirmed} onChange={event =&gt; patch({ h | onCancel={() =&gt; props.navigate(existing ? 'garden-detail' : 'gardens', existing?.id)}; onSubmit={async event =&gt; { event.preventDefault(); if (!draft.title.trim()) { setError('Give the site a short label.'); return; } if (draft.irrigation === 'Household water source' && !draft.householdSourceConfirmed) { setError('Confirm that this garden actually uses your household water source, or choose another source.'); return; } const changedContext = existing && (existing.irrigation !== draft.irriga |
| UI1026 :64 | input / GardenEditor | "Back garden" | onChange={event =&gt; patch({ title: event.target.value })} |
| UI1027 :64 | select / GardenEditor | {['Container', 'Raised bed', 'In-ground', 'Other', 'Unknown'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; patch({ setup: event.target.value })} |
| UI1028 :64 | input / GardenEditor | (child/component label) | onChange={event =&gt; patch({ county: event.target.value })} |
| UI1029 :64 | select / GardenEditor | {['Unknown', 'Household water source', 'Separate utility connection', 'Well', 'Rain collection', 'Surface water', 'Other'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/optio | onChange={event =&gt; patch({ irrigation: event.target.value, householdSourceConfirmed: false })} |
| UI1030 :64 | input / GardenEditor | I confirm this site uses the same water source as my household. | onChange={event =&gt; patch({ householdSourceConfirmed: event.target.checked })} |
| UI1031 :64 | textarea / GardenEditor | (child/component label) | onChange={event =&gt; patch({ soil: event.target.value })} |
| UI1032 :64 | input / GardenEditor | (child/component label) | onChange={event =&gt; patch({ concern: event.target.value })} |
| UI1033 :64 | textarea / GardenEditor | (child/component label) | onChange={event =&gt; patch({ questions: event.target.value })} |
| UI1034 :65 | input / GardenEditor | {test.title} · {test.medium} · {test.contextId} | onChange={event =&gt; patch({ testIds: event.target.checked ? [...draft.testIds, test.id] : draft.testIds.filter(id =&gt; id !== test.id) })} |

### components/homeguard/FoodGardenWorkspace.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1035 :40 | WorkspaceLink / FoodOverview | "Food at home" | onClick={() =&gt; navigate('pantry')} |
| UI1036 :41 | WorkspaceLink / FoodOverview | {item.title} | onClick={() =&gt; navigate(item.view)} |
| UI1037 :42 | WorkspaceLink / FoodOverview | {site.title} | onClick={() =&gt; navigate('garden-detail', site.id)} |
| UI1038 :42 | WorkspaceLink / FoodOverview | {item.title} | onClick={() =&gt; navigate(item.kind === 'fish' ? 'fish-detail' : item.kind === 'food' ? 'evidence-detail' : item.kind === 'resource' ? 'grower-detail' : 'water', item.targetId)} |
| UI1039 :43 | button / FoodOverview | {title} | onClick={() =&gt; setInterests(interests.includes(view) ? interests.filter(value =&gt; value !== view) : [...interests, view])} |

### components/homeguard/FoodGrower.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1040 :17 | Empty / FoodGrower | "This resource is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('growers')}&gt;Return to resources&lt;/button&gt;} |
| UI1041 :17 | button / FoodGrower | Return to resources | onClick={() =&gt; props.navigate('growers')} |
| UI1042 :18 | WorkspaceLink / FoodGrower | "Compare other service scopes" | onClick={() =&gt; props.navigate('growers')} |
| UI1043 :21 | select / FoodGrower | {growerResources.map(item =&gt; &lt;option key={item.id}&gt;{item.concern}&lt;/option&gt;)} | onChange={event =&gt; setFilters({ ...filters, concern: event.target.value })} |
| UI1044 :21 | select / FoodGrower | (child/component label) | onChange={event =&gt; setFilters({ ...filters, region: event.target.value })} |
| UI1045 :21 | WorkspaceLink / FoodGrower | {item.title} | onClick={() =&gt; props.navigate('grower-detail', item.id)} |
| UI1046 :21 | input / FoodGrower | Compare service scope | onChange={event =&gt; setFilters({ ...filters, compare: event.target.checked ? [...filters.compare, item.id] : filters.compare.filter(id =&gt; id !== item.id) })} |
| UI1047 :21 | button / FoodGrower | Clear filters | onClick={() =&gt; setFilters({ ...filters, region: 'All', concern: 'All' })} |
| UI1048 :21 | button / FoodGrower | Prepare an inquiry | onClick={() =&gt; props.navigate('grower-detail', item.id)} |
| UI1049 :21 | button / FoodGrower | Clear comparison | onClick={() =&gt; setFilters({ ...filters, compare: [] })} |
| UI1050 :33 | RecordForm / GrowerPreparation | (child/component label) | onSubmit={async event =&gt; { event.preventDefault(); if (draft.followUpDate && draft.contactDate && draft.followUpDate &lt; draft.contactDate) { setStatus('Follow-up cannot be before the contact date.'); return; } if (await inquiries.save({ ...draft, id: existing?.id ?? foodId('inquiry'), revision: existing?.revision ?? 0 })) { clearDraft(); setStatus('Private preparation saved. No agency submission was made.'); } }} |
| UI1051 :37 | select / GrowerPreparation | {sites.records.map(item =&gt; &lt;option key={item.id} value={item.id}&gt;{item.title}&lt;/option&gt;)} | onChange={event =&gt; patch({ siteId: event.target.value })} |
| UI1052 :37 | select / GrowerPreparation | {confirmed.map(item =&gt; &lt;option key={item.id} value={item.id}&gt;{item.title} · {item.medium}&lt;/option&gt;)} | onChange={event =&gt; patch({ testId: event.target.value })} |
| UI1053 :37 | input / GrowerPreparation | {item} | onChange={event =&gt; patch({ checklist: event.target.checked ? [...draft.checklist, item] : draft.checklist.filter(value =&gt; value !== item) })} |
| UI1054 :37 | textarea / GrowerPreparation | (child/component label) | onChange={event =&gt; patch({ questions: event.target.value })} |
| UI1055 :37 | select / GrowerPreparation | {['Preparing', 'Contacted, awaiting response', 'Application submitted by me', 'Response received', 'Paused', 'Closed'].map(value =&gt; &lt;option key={value}&gt;{value}&lt;/option&gt;)} | onChange={event =&gt; patch({ state: event.target.value })} |
| UI1056 :37 | DateInput / GrowerPreparation | (child/component label) | onChange={event =&gt; patch({ contactDate: event.target.value })} |
| UI1057 :37 | input / GrowerPreparation | (child/component label) | onChange={event =&gt; patch({ reference: event.target.value })} |
| UI1058 :37 | textarea / GrowerPreparation | (child/component label) | onChange={event =&gt; patch({ response: event.target.value })} |
| UI1059 :37 | DateInput / GrowerPreparation | (child/component label) | onChange={event =&gt; patch({ followUpDate: event.target.value })} |
| UI1060 :38 | button / GrowerPreparation | Export saved inquiry | onClick={() =&gt; downloadFoodRecord('${existing.id}.json', existing)} |
| UI1061 :38 | DeleteButton / GrowerPreparation | "Delete inquiry record" | onClick={() =&gt; setDeleting(true)} |
| UI1062 :39 | button / GrowerPreparation | {handoff ? 'Hide contact details' : 'Open contact options'} | onClick={() =&gt; setHandoff(!handoff)} |
| UI1063 :39 | FoodSourceLink / GrowerPreparation | Visit official contact page | href={resource.url} |
| UI1064 :39 | button / GrowerPreparation | Plan a test record | onClick={() =&gt; props.go('tests', 'new', draft.siteId \|\| undefined)} |
| UI1065 :39 | Confirm / GrowerPreparation | "Delete this inquiry record?" | onCancel={() =&gt; setDeleting(false)}; onConfirm={async () =&gt; { if (await inquiries.remove(existing.id)) { clearDraft(); setDeleting(false); setStatus('Inquiry deleted. Linked sites, tests and My Week actions remain.'); } }} |

### components/homeguard/FoodPantry.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1066 :20 | FoodSourceLink / GuideSource | {foodGuideSources[source].title} | href={foodGuideSources[source].url} |
| UI1067 :23 | button / BackToFoods | Food at home | onClick={() =&gt; navigate('pantry')} |
| UI1068 :30 | Empty / FoodPantry | "This food is unavailable" | action={&lt;BackToFoods navigate={props.navigate} /&gt;} |
| UI1069 :34 | Empty / FoodPantry | "This food guide is unavailable" | action={&lt;BackToFoods navigate={props.navigate} /&gt;} |
| UI1070 :48 | button / FoodPantryOverview | Find a food | onClick={() =&gt; navigate('pantry')} |
| UI1071 :48 | button / FoodPantryOverview | Your kitchen {notes.records.length &gt; 0 ? ' (${notes.records.length})' : ''} | onClick={() =&gt; navigate('pantry-saved')} |
| UI1072 :53 | input / FoodPantryOverview | "Try salmon, milk or spinach" | onChange={event =&gt; { setSearch(event.target.value); setShown(12); }} |
| UI1073 :54 | button / FoodPantryOverview | Add a food of your own | onClick={() =&gt; navigate('pantry-custom')} |
| UI1074 :55 | button / FoodPantryOverview | (child/component label) | onClick={() =&gt; navigate('pantry-add', food.id)} |
| UI1075 :56 | button / FoodPantryOverview | Show more foods | onClick={() =&gt; setShown(shown + 24)} |
| UI1076 :57 | button / FoodPantryOverview | Clear food search | onClick={() =&gt; { setSearch(''); setShown(12); }} |
| UI1077 :58 | WorkspaceLink / FoodPantryOverview | {guide.title} | onClick={() =&gt; navigate('pantry-detail', guide.id)} |
| UI1078 :61 | button / FoodPantryOverview | Add a food | onClick={() =&gt; navigate('pantry')} |
| UI1079 :61 | WorkspaceLink / FoodPantryOverview | {item.title} | onClick={() =&gt; navigate('pantry-note', item.id)} |
| UI1080 :62 | WorkspaceLink / FoodPantryOverview | "Food & Garden" | onClick={() =&gt; navigate('list')} |
| UI1081 :75 | button / KitchenShelf | (child/component label) | onClick={() =&gt; setStorage(key as FoodStorage)} |
| UI1082 :77 | button / KitchenShelf | (child/component label) | onClick={() =&gt; navigate('pantry-note', item.id)} |
| UI1083 :91 | RecordForm / AddKitchenFood | {!food && &lt;&gt;&lt;Field label="Food name"&gt;&lt;input required maxLength={80} autoComplete="off" placeholder="For example, garden peas" value={draft.title} onChange={event =&gt; setDr | onCancel={() =&gt; props.navigate('pantry')}; onSubmit={async () =&gt; { const values = { title: cleanFoodNote(draft.title), question: cleanFoodNote(draft.question), origin: draft.origin, guideId: guide.id, storage: draft.storage }; const validation = validatePantryItem(values); if (validation \|\| !validFoodStorage(draft.storage)) { setError(validation \|\| 'Choose a storage section.'); return; } const now = new Date().toISOString(); const item: PantryItem = { ...values, id: 'food-item-${crypto |
| UI1084 :98 | input / AddKitchenFood | "For example, garden peas" | onChange={event =&gt; setDraft({ ...draft, title: event.target.value })} |
| UI1085 :98 | select / AddKitchenFood | {foodGuides.map(group =&gt; &lt;option key={group.id} value={group.id}&gt;{group.title}&lt;/option&gt;)} | onChange={event =&gt; setDraft({ ...draft, guideId: event.target.value, origin: 'unknown' })} |
| UI1086 :99 | select / AddKitchenFood | "Keep in" | onChange={event =&gt; setDraft({ ...draft, storage: event.target.value as FoodStorage })} |
| UI1087 :101 | input / AddKitchenFood | (child/component label) | onInvalid={event =&gt; { const field = event.currentTarget; const details = field.closest('details'); if (details) details.open = true; setError('Give this food a name.'); field.focus(); }}; onChange={event =&gt; { setError(''); setDraft({ ...draft, title: event.target.value }); }} |
| UI1088 :102 | select / AddKitchenFood | "Food origin" | onChange={event =&gt; setDraft({ ...draft, origin: event.target.value as FoodOrigin })} |
| UI1089 :103 | textarea / AddKitchenFood | {guide.question} | onChange={event =&gt; setDraft({ ...draft, question: event.target.value })} |
| UI1090 :120 | button / FoodGuideDetail | {foodOriginLabels[value]} | onClick={() =&gt; setOrigin(value)} |
| UI1091 :122 | WorkspaceLink / FoodGuideDetail | {context.nextTitle} | onClick={() =&gt; props.navigate(context.nextView)} |
| UI1092 :123 | FoodSourceLink / FoodGuideDetail | Find official state advisory sources | href="https://www.epa.gov/choose-fish-and-shellfish-wisely/state-territorial-tribal-and-epa-fish-program-contacts" |
| UI1093 :123 | FoodSourceLink / FoodGuideDetail | Open FDA recalls and safety alerts | href="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" |
| UI1094 :125 | FoodNoteForm / FoodGuideDetail | (child/component label) | onSaved={id =&gt; props.navigate('pantry-note', id)} |
| UI1095 :135 | RecordForm / FoodNoteForm | {existing?.storage && &lt;Field label="Keep in"&gt;&lt;select aria-label="Keep in" value={draft.storage} onChange={event =&gt; setDraft({ ...draft, storage: event.target.value as Foo | onCancel={onCancel}; onSubmit={async () =&gt; { const values = { title: cleanFoodNote(draft.title), question: cleanFoodNote(draft.question), origin: draft.origin, guideId: guide.id, ...(existing?.storage ? { storage: draft.storage } : {}) }; const validation = validatePantryItem(values); if (validation) { setError(validation); return; } const now = new Date().toISOString(); const record: PantryItem = { ...values, id: existing?.id ?? 'food-note-${crypto.randomUUID()}', revision: existing?.revisio |
| UI1096 :142 | input / FoodNoteForm | {'Example ${guide.id === 'produce' ? 'garden tomatoes' : guide.id === 'seafood' ? 'weekend catch' : 'grocery item'}'} | onChange={event =&gt; setDraft({ ...draft, title: event.target.value })} |
| UI1097 :143 | select / FoodNoteForm | "Keep in" | onChange={event =&gt; setDraft({ ...draft, storage: event.target.value as FoodStorage })} |
| UI1098 :144 | select / FoodNoteForm | "Food origin" | onChange={event =&gt; setDraft({ ...draft, origin: event.target.value as FoodOrigin })} |
| UI1099 :145 | textarea / FoodNoteForm | {existing?.storage ? guide.question : undefined} | onChange={event =&gt; setDraft({ ...draft, question: event.target.value })} |
| UI1100 :155 | Empty / SavedFoodNote | "This food note is unavailable" | action={&lt;button type="button" onClick={() =&gt; props.navigate('pantry-saved')}&gt;Return to your notes&lt;/button&gt;} |
| UI1101 :155 | button / SavedFoodNote | Return to your notes | onClick={() =&gt; props.navigate('pantry-saved')} |
| UI1102 :156 | FoodNoteForm / SavedFoodNote | (child/component label) | onSaved={id =&gt; props.navigate('pantry-note', id)}; onCancel={() =&gt; props.navigate('pantry-note', note.id)} |
| UI1103 :159 | button / SavedFoodNote | {note.storage ? 'Edit food' : 'Edit note'} | onClick={() =&gt; props.navigate('pantry-edit', note.id)} |
| UI1104 :159 | DeleteButton / SavedFoodNote | {note.storage ? 'Remove food' : 'Delete note'} | onClick={() =&gt; setDeleting(true)} |
| UI1105 :162 | WorkspaceLink / SavedFoodNote | {context.nextTitle} | onClick={() =&gt; props.navigate(context.nextView)} |
| UI1106 :163 | WorkspaceLink / SavedFoodNote | {'Read the ${guide.title.toLowerCase()} guide'} | onClick={() =&gt; props.navigate('pantry-detail', guide.id)} |
| UI1107 :164 | button / SavedFoodNote | {note.storage ? 'Back to my kitchen' : 'All food notes'} | onClick={() =&gt; props.navigate('pantry-saved')} |
| UI1108 :165 | Confirm / SavedFoodNote | {note.storage ? 'Remove this food?' : 'Delete this food note?'} | onCancel={() =&gt; setDeleting(false)}; onConfirm={async () =&gt; { if (await notes.remove(note.id)) { setDeleting(false); props.navigate('pantry-saved'); } }} |

### components/homeguard/FoodShared.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1109 :13 | summary / FoodDetails | {title} | (native form/control behavior) |
| UI1110 :16 | a / FoodSourceLink | {children} | href={href} |
| UI1111 :33 | button / FoodSaveFollow | {existing?.saved ? &lt;Check size={16} aria-hidden="true" /&gt; : &lt;Bookmark size={16} aria-hidden="true" /&gt;} {existing?.saved ? 'Saved' : 'Save reference'} | onClick={() =&gt; void update('saved')} |
| UI1112 :34 | button / FoodSaveFollow | {existing?.following ? 'Following' : 'Follow updates'} | onClick={() =&gt; void update('following')} |
| UI1113 :35 | button / FoodSaveFollow | Share reference | onClick={() =&gt; setShare(!share)} |
| UI1114 :38 | button / FoodSaveFollow | Copy reference | onClick={async () =&gt; { try { await navigator.clipboard.writeText(shareText); setMessage('Reference copied.'); } catch { setMessage('Clipboard unavailable. Use Download reference.'); } }} |
| UI1115 :38 | button / FoodSaveFollow | Download reference | onClick={() =&gt; downloadPreview('${id}.json', shareText)} |

### components/homeguard/FoodWater.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1116 :35 | select / FoodWater | (child/component label) | onChange={event =&gt; setSelection({ ...selection, county: event.target.value })} |
| UI1117 :35 | select / FoodWater | {droughtReleases.map(item =&gt; &lt;option key={item.date} value={item.date}&gt;{item.date}&lt;/option&gt;)} | onChange={event =&gt; setSelection({ ...selection, release: event.target.value })} |
| UI1118 :35 | FoodSourceLink / FoodWater | Open the US Drought Monitor | href={foodSources.drought} |
| UI1119 :36 | select / FoodWater | (child/component label) | onChange={event =&gt; setSelection({ ...selection, utility: event.target.value })} |
| UI1120 :36 | FoodSourceLink / FoodWater | Open official conservation notices | href={foodSources.utility} |
| UI1121 :37 | WorkspaceLink / FoodWater | "Water-use records" | onClick={() =&gt; props.navigate('usage')} |
| UI1122 :37 | WorkspaceLink / FoodWater | "Maintenance & moisture records" | onClick={() =&gt; props.go('maintenance')} |
| UI1123 :46 | button / UsageList | Add a usage record | onClick={() =&gt; props.navigate('usage-new')} |
| UI1124 :46 | button / UsageList | Export saved records | onClick={() =&gt; downloadFoodRecord('water-use-records.json', usage.records)} |
| UI1125 :46 | WorkspaceLink / UsageList | {item.title} | onClick={() =&gt; props.navigate('usage-detail', item.id)} |
| UI1126 :47 | select / UsageList | {usage.records.map(item =&gt; &lt;option key={item.id} value={item.id}&gt;{item.title}&lt;/option&gt;)} | onChange={event =&gt; setSelection({ ...selection, first: event.target.value })} |
| UI1127 :47 | select / UsageList | {usage.records.map(item =&gt; &lt;option key={item.id} value={item.id}&gt;{item.title}&lt;/option&gt;)} | onChange={event =&gt; setSelection({ ...selection, second: event.target.value })} |
| UI1128 :47 | WorkspaceLink / UsageList | "Return to water stewardship" | onClick={() =&gt; props.navigate('water')} |
| UI1129 :53 | Empty / UsageDetail | "This usage record is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('usage')}&gt;Return to records&lt;/button&gt;} |
| UI1130 :53 | button / UsageDetail | Return to records | onClick={() =&gt; props.navigate('usage')} |
| UI1131 :54 | button / UsageDetail | Correct record | onClick={() =&gt; props.navigate('usage-edit', record.id)} |
| UI1132 :54 | button / UsageDetail | Export this record | onClick={() =&gt; downloadFoodRecord('${record.id}.json', record)} |
| UI1133 :54 | DeleteButton / UsageDetail | "Delete record" | onClick={() =&gt; setDeleting(true)} |
| UI1134 :54 | Confirm / UsageDetail | "Delete this usage record?" | onCancel={() =&gt; setDeleting(false)}; onConfirm={async () =&gt; { if (await usage.remove(record.id)) props.navigate('usage'); }} |
| UI1135 :54 | WorkspaceLink / UsageDetail | "Compare or browse records" | onClick={() =&gt; props.navigate('usage')} |
| UI1136 :61 | Empty / UsageEditor | "The record to edit is unavailable." | action={&lt;button onClick={() =&gt; props.navigate('usage')}&gt;Return to records&lt;/button&gt;} |
| UI1137 :61 | button / UsageEditor | Return to records | onClick={() =&gt; props.navigate('usage')} |
| UI1138 :62 | RecordForm / UsageEditor | {draft.kind === 'interval' && &lt;Field label="Period start (inclusive)"&gt;&lt;DateInput required value={draft.start} onChange={event =&gt; patch({ start: event.target.value })} /&gt;&lt; | onCancel={() =&gt; props.navigate(existing ? 'usage-detail' : 'usage', existing?.id)}; onSubmit={async event =&gt; { event.preventDefault(); const issue = validateUsage(draft); if (issue) { setError(issue); return; } if (existing && !draft.correction.trim()) { setError('Add a short correction reason so the earlier value remains understandable.'); return; } const { correction, ...fields } = draft; const original = existing ? { ...existing, history: undefined } : undefined; const record: UsageReco |
| UI1139 :68 | input / UsageEditor | "September bill" | onChange={event =&gt; patch({ title: event.target.value })} |
| UI1140 :68 | select / UsageEditor | (child/component label) | onChange={event =&gt; patch({ kind: event.target.value as UsageRecord['kind'] })} |
| UI1141 :68 | input / UsageEditor | "Home or garden" | onChange={event =&gt; patch({ site: event.target.value })} |
| UI1142 :68 | input / UsageEditor | "Garden meter" | onChange={event =&gt; patch({ meter: event.target.value })} |
| UI1143 :68 | DateInput / UsageEditor | (child/component label) | onChange={event =&gt; patch({ start: event.target.value })} |
| UI1144 :68 | DateInput / UsageEditor | (child/component label) | onChange={event =&gt; patch({ end: event.target.value })} |
| UI1145 :68 | input / UsageEditor | (child/component label) | onChange={event =&gt; patch({ quantity: event.target.value })} |
| UI1146 :68 | select / UsageEditor | (child/component label) | onChange={event =&gt; patch({ unit: event.target.value })} |
| UI1147 :68 | select / UsageEditor | (child/component label) | onChange={event =&gt; patch({ basis: event.target.value as UsageRecord['basis'] })} |
| UI1148 :68 | input / UsageEditor | "Utility bill, manual meter reading" | onChange={event =&gt; patch({ source: event.target.value })} |
| UI1149 :68 | input / UsageEditor | A meter reset, rollover or replacement affects this record. | onChange={event =&gt; patch({ reset: event.target.checked })} |
| UI1150 :68 | textarea / UsageEditor | (child/component label) | onChange={event =&gt; patch({ note: event.target.value })} |
| UI1151 :68 | textarea / UsageEditor | (child/component label) | onChange={event =&gt; patch({ correction: event.target.value })} |

### components/homeguard/HomeWorkspaceState.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1152 :162 (review control) | select / HomeWorkspaceReviewControls | {(['ready', 'empty', 'loading', 'error', 'offline', 'stale', 'conflict', 'save-error'] as const).map(value =&gt; &lt;option key={value} value={value}&gt;{value.replace('-', ' ')}&lt; | onChange={e =&gt; state.setScenario(e.target.value as HomeScenario)} |
| UI1153 :162 (review control) | select / HomeWorkspaceReviewControls | {Object.entries({ tests: 'Test reports', actions: 'Saved actions', maintenance: 'Maintenance records', observations: 'Moisture observations', gardens: 'Garden records' }) | onChange={e =&gt; setSummaryFailure(e.target.value)} |
| UI1154 :162 (review control) | button / HomeWorkspaceReviewControls | Reset Homeguard sample records | onClick={state.reset} |

### components/homeguard/HomeWorkspaceUI.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1155 :18 | button / link | {artwork ? &lt;WorkspaceArtwork kind={artwork} compact /&gt; : icon && &lt;span className="hg-link-icon" aria-hidden="true"&gt;{icon}&lt;/span&gt;} | onClick={onClick} |
| UI1156 :25 | DeleteButton / DeletableRecord | {'Delete ${title}'} | onClick={() =&gt; setConfirming(true)} |
| UI1157 :25 | Confirm / DeletableRecord | "Are you sure?" | onCancel={() =&gt; setConfirming(false)}; onConfirm={async () =&gt; { // The row and its opener disappear together. Let modal cleanup focus the // surviving heading, rather than racing cleanup with an animation frame. deletionFocus.current = row.current?.closest('.hg-workspace, .halo-explore')?.querySelector&lt;HTMLElement&gt;('[data-home-heading], h2[tabindex]') ?? null; if (await deletion.remove()) { setConfirming(false); } }} |
| UI1158 :47 | form / RecordForm | {scenario === 'offline' && &lt;p className="hg-meta"&gt;Offline. Your draft is kept here, but changes are not queued.&lt;/p&gt;} | onChangeCapture={() =&gt; setDirty(true)}; onSubmit={async event =&gt; { event.preventDefault(); if (disabled) return; setSaving(true); try { await onSubmit(event); } finally { setSaving(false); } }} |
| UI1159 :47 | button / RecordForm | {disabled ? 'Saving...' : submitLabel} | (native form/control behavior) |
| UI1160 :47 | button / RecordForm | Cancel | onClick={() =&gt; dirty ? setCancel(true) : onCancel()} |
| UI1161 :47 | Confirm / RecordForm | "Leave this form?" | onCancel={() =&gt; setCancel(false)}; onConfirm={() =&gt; { setCancel(false); onCancel?.(); }} |
| UI1162 :51 | button / DeleteButton | {label} | onClick={onClick} |
| UI1163 :57 | BottomSheet / Confirm | {'home-confirm-${id}'} | onClose={() =&gt; { if (!busy) onCancel(); }} |
| UI1164 :57 | button / Confirm | {busy ? 'Working...' : confirmLabel ?? (danger ? 'Yes, delete' : 'Confirm')} | onClick={async () =&gt; { if (busy) return; setBusy(true); setAttempted(true); setError(''); workspace.clearMessage(); try { await onConfirm(); } catch { setError('This change could not be completed. Your record is still here. Please try again.'); } finally { setBusy(false); } }} |
| UI1165 :57 | button / Confirm | {cancelLabel ?? (danger ? 'No, keep it' : 'Keep editing')} | onClick={onCancel} |
| UI1166 :63 | button / ActionButton | {exists ? &lt;Check size={17} aria-hidden="true" /&gt; : &lt;CalendarPlus size={17} aria-hidden="true" /&gt;} {exists ? buttonLabel ? 'Open ${buttonLabel.toLowerCase()}' : 'Open save | onClick={() =&gt; state?.open({ key, title, reason, origin: factor, date })} |

### components/homeguard/HomeguardWorkspace.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1167 :59 | Link / HomeguardWorkspace | Back to Homeguard | href={href('home')} |
| UI1168 :60 | select / HomeguardWorkspace | {(Object.keys(sections) as HomeSection[]).map(key =&gt; &lt;option value={key} key={key}&gt;{sections[key].name}&lt;/option&gt;)} | onChange={event =&gt; go(event.target.value as HomeSection)} |
| UI1169 :61 | button / HomeguardWorkspace | Workspace overview | onClick={() =&gt; go(section)} |
| UI1170 :65 | button / HomeguardWorkspace | Try again | onClick={() =&gt; state.setScenario('ready')} |
| UI1171 :65 | button / HomeguardWorkspace | Try again | onClick={() =&gt; state.setScenario('ready')} |

### components/homeguard/MaintenanceWorkspace.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1172 :26 | Empty / MaintenanceWorkspace | "Observation unavailable" | action={&lt;button onClick={() =&gt; props.navigate('list')}&gt;Back to maintenance&lt;/button&gt;} |
| UI1173 :26 | button / MaintenanceWorkspace | Back to maintenance | onClick={() =&gt; props.navigate('list')} |
| UI1174 :30 | Empty / MaintenanceWorkspace | "Routine unavailable" | action={&lt;button onClick={() =&gt; props.navigate('list')}&gt;Back to maintenance&lt;/button&gt;} |
| UI1175 :30 | button / MaintenanceWorkspace | Back to maintenance | onClick={() =&gt; props.navigate('list')} |
| UI1176 :35 | WorkspaceLink / MaintenanceWorkspace | "Add a routine" | onClick={() =&gt; props.navigate('create')} |
| UI1177 :35 | WorkspaceLink / MaintenanceWorkspace | "Record moisture" | onClick={() =&gt; props.navigate('observation')} |
| UI1178 :37 | WorkspaceLink / MaintenanceWorkspace | {asset.title} | onClick={() =&gt; props.navigate('detail', asset.id)} |
| UI1179 :40 | WorkspaceLink / MaintenanceWorkspace | {record.title} | onClick={() =&gt; props.navigate('observation-detail', record.id)} |
| UI1180 :50 | Empty / AssetForm | "Routine unavailable" | action={&lt;button onClick={() =&gt; props.navigate('list')}&gt;Back to maintenance&lt;/button&gt;} |
| UI1181 :50 | button / AssetForm | Back to maintenance | onClick={() =&gt; props.navigate('list')} |
| UI1182 :60 | RecordForm / AssetForm | {error && &lt;p role="alert"&gt;{error}&lt;/p&gt;} | onSubmit={submit}; onCancel={() =&gt; props.navigate(record ? 'detail' : 'list', record?.id)} |
| UI1183 :61 | input / AssetForm | "For example, kitchen filter upkeep" | onChange={e =&gt; update({ title: e.target.value })} |
| UI1184 :62 | summary / AssetForm | Equipment details · Optional | (native form/control behavior) |
| UI1185 :62 | input / AssetForm | (child/component label) | onChange={e =&gt; update({ model: e.target.value })} |
| UI1186 :63 | DateInput / AssetForm | (child/component label) | onChange={e =&gt; update({ installed: e.target.value })} |
| UI1187 :63 | DateInput / AssetForm | (child/component label) | onChange={e =&gt; update({ serviced: e.target.value })} |
| UI1188 :64 | select / AssetForm | {factorKeys.map(key =&gt; &lt;option key={key} value={key}&gt;{factorReadings[key].title}&lt;/option&gt;)} | onChange={e =&gt; update({ factor: e.target.value as HomeAsset['factor'] })} |
| UI1189 :65 | textarea / AssetForm | (child/component label) | onChange={e =&gt; update({ instructions: e.target.value })} |
| UI1190 :66 | select / AssetForm | (child/component label) | onChange={e =&gt; update({ basis: e.target.value as HomeAsset['basis'] })} |
| UI1191 :67 | select / AssetForm | (child/component label) | onChange={e =&gt; update({ policy: e.target.value as HomeAsset['policy'] })} |
| UI1192 :67 | input / AssetForm | (child/component label) | onChange={e =&gt; update({ interval: Number(e.target.value) })} |
| UI1193 :67 | select / AssetForm | (child/component label) | onChange={e =&gt; update({ unit: e.target.value as HomeAsset['unit'] })} |
| UI1194 :67 | DateInput / AssetForm | (child/component label) | onChange={e =&gt; update({ nextDue: e.target.value })} |
| UI1195 :67 | DateInput / AssetForm | (child/component label) | onChange={e =&gt; update({ endDate: e.target.value })} |
| UI1196 :68 | select / AssetForm | {draft.testId && !tests.some(test =&gt; test.id === draft.testId) && &lt;option value={draft.testId}&gt;Previously linked test (removed)&lt;/option&gt;} {tests.map(test =&gt; &lt;option key={ | onChange={e =&gt; update({ testId: e.target.value })} |
| UI1197 :71 | button / AssetForm | Discard this draft | onClick={() =&gt; setDiscard(true)} |
| UI1198 :71 | Confirm / AssetForm | "Discard routine draft?" | onCancel={() =&gt; setDiscard(false)}; onConfirm={() =&gt; { clearDraft(); props.navigate(record ? 'detail' : 'list', record?.id); }} |
| UI1199 :89 | button / AssetDetail | {kind === 'completed' ? 'Record completion' : kind === 'skipped' ? 'Skip occurrence' : 'Snooze occurrence'} | onClick={() =&gt; { setOperation(kind); setError(''); }} |
| UI1200 :90 | summary / AssetDetail | Manage routine | (native form/control behavior) |
| UI1201 :90 | button / AssetDetail | Edit schedule & details | onClick={() =&gt; props.navigate('edit', record.id)} |
| UI1202 :90 | button / AssetDetail | {record.status === 'paused' ? 'Resume routine' : 'Pause routine'} | onClick={() =&gt; { setError(''); setOperation(record.status === 'paused' ? 'resumed' : 'paused'); }} |
| UI1203 :90 | button / AssetDetail | Replace or retire equipment | onClick={() =&gt; { setError(''); setOperation('replaced'); }} |
| UI1204 :91 | button / AssetDetail | Add the replacement asset | onClick={() =&gt; props.navigate('create')} |
| UI1205 :93 | Confirm / AssetDetail | {operation === 'completed' ? 'Record what you completed' : operation === 'skipped' ? 'Skip this occurrence?' : operation === 'snoozed' ? 'Snooze this occurrence' : operation === 'paused' ? 'Pause future reminders?' : operation === 'resumed' ? 'Resume this routine?' : 'Replace or retire this asset?'} | onCancel={() =&gt; { if (!busy) setOperation(null); }}; onConfirm={act} |
| UI1206 :94 | DateInput / AssetDetail | (child/component label) | onChange={e =&gt; setDate(e.target.value)} |
| UI1207 :94 | DateInput / AssetDetail | (child/component label) | onChange={e =&gt; setSnooze(e.target.value)} |
| UI1208 :94 | textarea / AssetDetail | (child/component label) | onChange={e =&gt; setNote(e.target.value)} |
| UI1209 :97 | summary / AssetDetail | Equipment & instructions | (native form/control behavior) |
| UI1210 :98 | WorkspaceLink / AssetDetail | "Open linked test" | onClick={() =&gt; props.go('tests', 'detail', record.testId)} |
| UI1211 :98 | WorkspaceLink / AssetDetail | "Review tests and records" | onClick={() =&gt; props.go('tests')} |
| UI1212 :99 | button / AssetDetail | {'View ${event.kind} occurrence on ${event.date}'} | onClick={() =&gt; setEventId(event.id)} |
| UI1213 :100 | DeleteButton / AssetDetail | "Delete routine" | onClick={() =&gt; setDeleting(true)} |
| UI1214 :101 | Confirm / AssetDetail | "Delete this routine?" | onCancel={() =&gt; { if (!busy) setDeleting(false); }}; onConfirm={async () =&gt; { if (busy) return; setBusy(true); try { if (await remove(record.id)) props.navigate('list'); } finally { setBusy(false); } }} |
| UI1215 :102 | BottomSheet / AssetDetail | {'maintenance-occurrence-${record.id}'} | onClose={() =&gt; setEventId(null)} |
| UI1216 :102 | button / AssetDetail | Back to occurrence history | onClick={() =&gt; setEventId(null)} |
| UI1217 :112 | Empty / ObservationForm | "Observation unavailable" | action={&lt;button onClick={() =&gt; props.navigate('list')}&gt;Back to maintenance&lt;/button&gt;} |
| UI1218 :112 | button / ObservationForm | Back to maintenance | onClick={() =&gt; props.navigate('list')} |
| UI1219 :122 | RecordForm / ObservationForm | {photoBusy && &lt;div role="status"&gt;Preparing a private image copy...&lt;button type="button" onClick={()=&gt;{photoRequest.current?.abort();setPhotoBusy(false);}}&gt;Cancel photo pr | onSubmit={submit}; onCancel={() =&gt; props.navigate(record ? 'observation-detail' : 'list', record?.id)} |
| UI1220 :123 | input / ObservationForm | (child/component label) | onChange={e =&gt; update({ title: e.target.value })} |
| UI1221 :123 | select / ObservationForm | (child/component label) | onChange={e =&gt; update({ kind: e.target.value as MoistureObservation['kind'] })} |
| UI1222 :124 | input / ObservationForm | (child/component label) | onChange={e =&gt; update({ observedAt: e.target.value })} |
| UI1223 :124 | input / ObservationForm | (child/component label) | onChange={e =&gt; update({ timezone: e.target.value })} |
| UI1224 :124 | input / ObservationForm | (child/component label) | onChange={e =&gt; update({ room: e.target.value })} |
| UI1225 :125 | input / ObservationForm | (child/component label) | onChange={e =&gt; update({ reading: e.target.value })} |
| UI1226 :125 | input / ObservationForm | (child/component label) | onChange={e =&gt; update({ unit: e.target.value })} |
| UI1227 :125 | input / ObservationForm | (child/component label) | onChange={e =&gt; update({ source: e.target.value })} |
| UI1228 :126 | textarea / ObservationForm | (child/component label) | onChange={e =&gt; update({ note: e.target.value })} |
| UI1229 :126 | input / ObservationForm | (child/component label) | onChange={e =&gt; selectPhoto(e.target.files?.[0])} |
| UI1230 :126 | button / ObservationForm | Cancel photo preparation | onClick={()=&gt;{photoRequest.current?.abort();setPhotoBusy(false);}} |
| UI1231 :126 | button / ObservationForm | Remove photo | onClick={() =&gt; update({ photoName: '', photoData: '' })} |
| UI1232 :127 | select / ObservationForm | {draft.assetId && !assets.some(asset =&gt; asset.id === draft.assetId) && &lt;option value={draft.assetId}&gt;Previously linked routine (removed)&lt;/option&gt;} {assets.map(asset =&gt; &lt;o | onChange={e =&gt; update({ assetId: e.target.value })} |
| UI1233 :127 | select / ObservationForm | {draft.testId && !tests.some(test =&gt; test.id === draft.testId) && &lt;option value={draft.testId}&gt;Previously linked test (removed)&lt;/option&gt;} {tests.map(test =&gt; &lt;option key={ | onChange={e =&gt; update({ testId: e.target.value })} |
| UI1234 :128 | button / ObservationForm | Discard observation draft | onClick={() =&gt; setDiscard(true)} |
| UI1235 :128 | Confirm / ObservationForm | "Discard observation draft?" | onCancel={() =&gt; setDiscard(false)}; onConfirm={() =&gt; { clearDraft(); props.navigate(record ? 'observation-detail' : 'list', record?.id); }} |
| UI1236 :140 | summary / ObservationDetail | Local photo: {record.photoName} | (native form/control behavior) |
| UI1237 :141 | button / ObservationDetail | Edit observation | onClick={() =&gt; props.navigate('observation-edit', record.id)} |
| UI1238 :141 | DeleteButton / ObservationDetail | "Delete observation" | onClick={() =&gt; setDeleting(true)} |
| UI1239 :144 | WorkspaceLink / ObservationDetail | "Open linked routine" | onClick={() =&gt; props.navigate('detail', record.assetId)} |
| UI1240 :145 | WorkspaceLink / ObservationDetail | "Open linked test" | onClick={() =&gt; props.go('tests', 'detail', record.testId)} |
| UI1241 :149 | Confirm / ObservationDetail | "Delete this observation?" | onCancel={() =&gt; { if (!busy) setDeleting(false); }}; onConfirm={async () =&gt; { if (busy) return; setBusy(true); try { if (await remove(record.id)) props.navigate('list'); } finally { setBusy(false); } }} |

### components/homeguard/PublishedFoodEvidence.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1242 :19 | button / PublishedFoodEvidence | (child/component label) | onClick={() =&gt; setFactor(indicator.contaminant)} |
| UI1243 :25 | FoodSourceLink / PublishedFoodEvidence | {study.source.title} | href={study.source.url} |
| UI1244 :25 | FoodSourceLink / PublishedFoodEvidence | How the testing was done | href={study.source.methodologyUrl} |
| UI1245 :26 | FoodSourceLink / PublishedFoodEvidence | {source.title} | href={source.url} |

### components/homeguard/SummaryReport.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1246 :14 | ReportAttempt / SummaryReport | (child/component label) | onReady={onReady}; onRetry={() =&gt; setAttempt(value =&gt; value + 1)} |
| UI1247 :52 | button / ReportAttempt | Cancel PDF creation | onClick={() =&gt; { controller.current?.abort(); setCancelled(true); }} |
| UI1248 :54 | button / ReportAttempt | Try creating PDF again | onClick={onRetry} |
| UI1249 :55 | a / ReportAttempt | Download PDF | href={ready.url}; download="halo-household-summary.pdf" |
| UI1250 :55 | a / ReportAttempt | Open PDF | href={ready.url} |
| UI1251 :55 | button / ReportAttempt | Share PDF | onClick={share} |

### components/homeguard/SummaryWorkspace.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1252 :147 | SummaryReport / SummaryWorkspace | (child/component label) | onReady={pages =&gt; setDraft('summary-last-created', () =&gt; ({ at: new Date().toISOString(), pages }))} |
| UI1253 :148 | button / SummaryWorkspace | Edit included information | onClick={() =&gt; { setStatus(''); props.navigate('selection'); }} |
| UI1254 :149 | summary / SummaryWorkspace | Other formats & printing | (native form/control behavior) |
| UI1255 :149 | button / SummaryWorkspace | Download accessible text | onClick={() =&gt; exportSummary('file')} |
| UI1256 :149 | button / SummaryWorkspace | Save image | onClick={() =&gt; exportSummary('image')} |
| UI1257 :149 | button / SummaryWorkspace | Print | onClick={() =&gt; exportSummary('print')} |
| UI1258 :149 | button / SummaryWorkspace | Share text | onClick={() =&gt; exportSummary('share')} |
| UI1259 :151 | summary / SummaryWorkspace | Review the included information | (native form/control behavior) |
| UI1260 :157 | select / SummaryWorkspace | (child/component label) | onChange={e =&gt; update({ purpose: e.target.value })} |
| UI1261 :158 | select / SummaryWorkspace | (child/component label) | onChange={e =&gt; setWaterContext(e.target.value as typeof waterContext)} |
| UI1262 :162 | input / SummaryWorkspace | {sectionLabels[key]} | onChange={e =&gt; update({ sections: { ...selection.sections, [key]: e.target.checked } })} |
| UI1263 :163 | summary / SummaryWorkspace | Add private records {recordSections.some(key =&gt; selection.sections[key]) ? ' · ${recordSections.filter(key =&gt; selection.sections[key]).length} selected' : ' · Optional'} | (native form/control behavior) |
| UI1264 :166 | input / SummaryWorkspace | {sectionLabels[key]} | onChange={e =&gt; update({ sections: { ...selection.sections, [key]: e.target.checked } })} |
| UI1265 :167 | input / SummaryWorkspace | (child/component label) | onChange={e =&gt; update({ excluded: e.target.checked ? selection.excluded.filter(id =&gt; id !== '${key}:${record.id}') : [...selection.excluded, '${key}:${record.id}'] })} |
| UI1266 :169 | DateInput / SummaryWorkspace | (child/component label) | onChange={e =&gt; update({ start: e.target.value })} |
| UI1267 :169 | DateInput / SummaryWorkspace | (child/component label) | onChange={e =&gt; update({ end: e.target.value })} |
| UI1268 :172 | WorkspaceLink / SummaryWorkspace | "Open home tests & reports" | onClick={() =&gt; props.go('tests')} |
| UI1269 :174 | summary / SummaryWorkspace | Privacy & extra detail | (native form/control behavior) |
| UI1270 :176 | input / SummaryWorkspace | {item.label} | onChange={e =&gt; update({ [item.key]: e.target.checked })} |
| UI1271 :177 | input / SummaryWorkspace | (child/component label) | onChange={e =&gt; update({ appendix: e.target.checked })} |
| UI1272 :181 | button / SummaryWorkspace | Create household PDF | onClick={preview} |

### components/homeguard/TestProgress.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1273 :97 | button / TestProgress | {step.editLabel} | onClick={step.onEdit} |
| UI1274 :101 | button / TestProgress | "Meet Luna" | onMouseEnter={() =&gt; setTooltip(true)}; onMouseLeave={() =&gt; setTooltip(false)}; onFocus={() =&gt; setTooltip(true)}; onBlur={() =&gt; setTooltip(false)}; onClick={() =&gt; setTooltip(true)}; onKeyDown={event =&gt; { if (event.key === 'Escape') { event.stopPropagation(); setTooltip(false); } }} |

### components/homeguard/TestsWorkspace.tsx

Contract family: H01-H08 / F01-F06.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1275 :45 | Empty / TestsWorkspace | "This test record is unavailable" | action={&lt;Button onClick={() =&gt; props.navigate('list')}&gt;Back to tests&lt;/Button&gt;} |
| UI1276 :45 | Button / TestsWorkspace | Back to tests | onClick={() =&gt; props.navigate('list')} |
| UI1277 :52 | WorkspaceLink / TestsWorkspace | "Enter or correct result rows" | onClick={() =&gt; props.navigate('results', record.id)} |
| UI1278 :58 | button / BackToTest | Back to test | onClick={() =&gt; navigate('detail', record.id)} |
| UI1279 :74 | WorkspaceLink / TestsList | "Plan a test" | onClick={() =&gt; navigate('new')} |
| UI1280 :75 | WorkspaceLink / TestsList | "Add a report" | onClick={() =&gt; navigate('report')} |
| UI1281 :79 | input / TestsList | "Test name, lab or substance" | onChange={event =&gt; setSearch(event.target.value)} |
| UI1282 :80 | summary / TestsList | Filter records {kind !== 'all' \|\| status !== 'all' \|\| context !== 'all' \|\| archived ? ' · Active' : ''} | (native form/control behavior) |
| UI1283 :81 | select / TestsList | {testKinds.map(value =&gt; &lt;option key={value} value={value}&gt;{kindLabels[value]}&lt;/option&gt;)} | onChange={event =&gt; setKind(event.target.value)} |
| UI1284 :82 | select / TestsList | {testStatuses.map(value =&gt; &lt;option key={value} value={value}&gt;{testStatusLabels[value]}&lt;/option&gt;)} | onChange={event =&gt; setStatus(event.target.value)} |
| UI1285 :83 | select / TestsList | {contexts.map(value =&gt; &lt;option key={value.id} value={value.id}&gt;{value.label}&lt;/option&gt;)} | onChange={event =&gt; setContext(event.target.value)} |
| UI1286 :84 | input / TestsList | (child/component label) | onChange={event =&gt; setArchived(event.target.checked)} |
| UI1287 :87 | button / TestsList | Reset filters | onClick={() =&gt; setFilters({ search: '', kind: 'all', status: 'all', context: 'all', archived: false })} |
| UI1288 :88 | WorkspaceLink / TestsList | {record.title} | onClick={() =&gt; navigate('detail', record.id)} |
| UI1289 :88 | Empty / TestsList | {records.length ? 'No records match these filters' : 'Start your home record'} | action={&lt;Button onClick={() =&gt; records.length ? (setSearch(''), setKind('all'), setStatus('all'), setContext('all'), setArchived(false)) : navigate('new')}&gt;{records.length ? 'Reset filters' : 'Add a test'}&lt;/Button&gt;} |
| UI1290 :88 | Button / TestsList | {records.length ? 'Reset filters' : 'Add a test'} | onClick={() =&gt; records.length ? (setSearch(''), setKind('all'), setStatus('all'), setContext('all'), setArchived(false)) : navigate('new')} |
| UI1291 :112 | RecordForm / TestEditor | {!addingReport && &lt;&gt;&lt;div className="hg-grid"&gt;&lt;Field label="Proposed test date (optional)"&gt;&lt;DateInput value={draft.plannedDate} onChange={event =&gt; set('plannedDate', event | onSubmit={submit}; onCancel={leave} |
| UI1292 :114 | input / TestEditor | "For example, kitchen tap test" | onChange={event =&gt; set('title', event.target.value)} |
| UI1293 :115 | select / TestEditor | {testKinds.map(kind =&gt; &lt;option key={kind} value={kind}&gt;{kindLabels[kind]}&lt;/option&gt;)} | onChange={event =&gt; set('kind', event.target.value as TestRecord['kind'])} |
| UI1294 :115 | select / TestEditor | (child/component label) | onChange={event =&gt; set('medium', event.target.value)} |
| UI1295 :116 | select / TestEditor | {draft.contextId && !contexts.some(context =&gt; context.id === draft.contextId) && &lt;option value={draft.contextId}&gt;Retained historical context&lt;/option&gt;} {contexts.map(conte | onChange={event =&gt; setDraft({ ...draft, contextId: event.target.value, contextSnapshot: snapshotContext(contexts.find(context =&gt; context.id === event.target.value)) })} |
| UI1296 :117 | textarea / TestEditor | "What would you like this test to document?" | onChange={event =&gt; set('purpose', event.target.value)} |
| UI1297 :118 | input / TestEditor | (child/component label) | onChange={event =&gt; set('provider', event.target.value)} |
| UI1298 :119 | DateInput / TestEditor | (child/component label) | onChange={event =&gt; set('plannedDate', event.target.value)} |
| UI1299 :119 | select / TestEditor | (child/component label) | onChange={event =&gt; set('status', event.target.value as TestRecord['status'])} |
| UI1300 :121 | Button / TestEditor | Discard draft | onClick={() =&gt; setDiscard(true)} |
| UI1301 :122 | Confirm / TestEditor | "Discard test edits?" | onConfirm={() =&gt; { clearDraft(); setDiscard(false); leave(); }}; onCancel={() =&gt; setDiscard(false)} |
| UI1302 :135 | RecordForm / ArrangementEditor | (child/component label) | onSubmit={submit}; onCancel={() =&gt; navigate('detail', record.id)} |
| UI1303 :135 | input / ArrangementEditor | (child/component label) | onChange={event =&gt; setArranged(event.target.checked)} |
| UI1304 :155 | RecordForm / CollectionEditor | {view === 'awaiting' && &lt;Field label="Expected result date (optional)" hint="Leave blank if the provider did not give you a date."&gt;&lt;DateInput value={draft.expectedDate} o | onSubmit={submit}; onCancel={() =&gt; navigate('detail', record.id)} |
| UI1305 :155 | DateInput / CollectionEditor | (child/component label) | onChange={event =&gt; set('collectionStart', event.target.value)} |
| UI1306 :155 | DateInput / CollectionEditor | (child/component label) | onChange={event =&gt; set('collectionEnd', event.target.value)} |
| UI1307 :155 | input / CollectionEditor | (child/component label) | onChange={event =&gt; set('sampleLabel', event.target.value)} |
| UI1308 :155 | input / CollectionEditor | (child/component label) | onChange={event =&gt; set('method', event.target.value)} |
| UI1309 :155 | DateInput / CollectionEditor | (child/component label) | onChange={event =&gt; set('expectedDate', event.target.value)} |
| UI1310 :155 | Button / CollectionEditor | Discard draft | onClick={() =&gt; setDiscard(true)} |
| UI1311 :155 | Confirm / CollectionEditor | "Discard collection edits?" | onConfirm={() =&gt; { clearDraft(); navigate('detail', record.id); }}; onCancel={() =&gt; setDiscard(false)} |
| UI1312 :183 | button / TestDetail | All tests | onClick={() =&gt; navigate('list')} |
| UI1313 :184 | Button / TestDetail | I arranged this test | onClick={() =&gt; change({ ...record, status: 'arranged', arrangedByUser: true })} |
| UI1314 :184 | Button / TestDetail | Record collection | onClick={() =&gt; navigate('collect', record.id)} |
| UI1315 :184 | Button / TestDetail | Awaiting result | onClick={() =&gt; navigate('awaiting', record.id)} |
| UI1316 :184 | summary / TestDetail | Fill in an earlier step | (native form/control behavior) |
| UI1317 :184 | button / TestDetail | Record earlier test arrangement | onClick={() =&gt; navigate('arranged', record.id)} |
| UI1318 :184 | button / TestDetail | Record an earlier waiting stage | onClick={() =&gt; navigate('awaiting', record.id)} |
| UI1319 :185 | summary / TestDetail | What this record means | (native form/control behavior) |
| UI1320 :185 | Button / TestDetail | Enter results | onClick={() =&gt; navigate('results', record.id)} |
| UI1321 :185 | Button / TestDetail | Review a local report | onClick={() =&gt; navigate('attachments', record.id)} |
| UI1322 :187 | WorkspaceLink / TestDetail | "Compare records" | onClick={() =&gt; navigate('compare', record.id)} |
| UI1323 :187 | WorkspaceLink / TestDetail | "Correction history" | onClick={() =&gt; navigate('history', record.id)} |
| UI1324 :187 | WorkspaceLink / TestDetail | "Export this record" | onClick={() =&gt; navigate('export', record.id)} |
| UI1325 :187 | WorkspaceLink / TestDetail | "Household summary" | onClick={() =&gt; go('summary')} |
| UI1326 :187 | Button / TestDetail | {record.archived ? 'Restore from archive' : 'Archive record'} | onClick={() =&gt; setConfirmation('archive')} |
| UI1327 :187 | DeleteButton / TestDetail | "Delete record" | onClick={() =&gt; setConfirmation('delete')} |
| UI1328 :188 | Confirm / TestDetail | {confirmation === 'delete' ? 'Delete this test record?' : record.archived ? 'Restore this record?' : 'Archive this record?'} | onConfirm={confirm}; onCancel={() =&gt; { if (!busy) setConfirmation(null); }} |
| UI1329 :213 | RecordForm / ResultEditor | {draft.rows.map((row, index) =&gt; &lt;fieldset key={row.id} className="hg-card hg-stack"&gt;&lt;legend&gt;Result {index + 1}&lt;/legend&gt; &lt;Field label="Analyte or parameter" hint="The subs | onSubmit={submit}; onCancel={() =&gt; navigate('detail', record.id)} |
| UI1330 :215 | input / ResultEditor | "For example, PFOS" | onChange={event =&gt; rowChange(row.id, 'analyte', event.target.value)} |
| UI1331 :216 | input / ResultEditor | "For example, &lt; 0.5 or ND" | onChange={event =&gt; rowChange(row.id, 'originalValue', event.target.value)} |
| UI1332 :216 | input / ResultEditor | "Copy the unit from the report" | onChange={event =&gt; rowChange(row.id, 'originalUnit', event.target.value)} |
| UI1333 :217 | select / ResultEditor | "Reporting qualifier" | onChange={event =&gt; rowChange(row.id, 'qualifier', event.target.value)} |
| UI1334 :218 | DateInput / ResultEditor | (child/component label) | onChange={event =&gt; rowChange(row.id, 'reportDate', event.target.value)} |
| UI1335 :219 | summary / ResultEditor | More details from the report | (native form/control behavior) |
| UI1336 :220 | input / ResultEditor | (child/component label) | onChange={event =&gt; rowChange(row.id, 'limit', event.target.value)} |
| UI1337 :220 | input / ResultEditor | (child/component label) | onChange={event =&gt; rowChange(row.id, 'limitUnit', event.target.value)} |
| UI1338 :221 | input / ResultEditor | (child/component label) | onChange={event =&gt; rowChange(row.id, 'basis', event.target.value)} |
| UI1339 :222 | input / ResultEditor | (child/component label) | onChange={event =&gt; rowChange(row.id, 'reportReference', event.target.value)} |
| UI1340 :224 | Button / ResultEditor | Remove row {index + 1} | onClick={() =&gt; setDraft({ ...draft, confirmed: false, rows: draft.rows.filter(item =&gt; item.id !== row.id) })} |
| UI1341 :226 | Button / ResultEditor | Add result row | onClick={() =&gt; setDraft({ ...draft, confirmed: false, rows: [...draft.rows, emptyResult('row-${crypto.randomUUID()}')] })} |
| UI1342 :228 | summary / ResultEditor | {issues.length} {issues.length === 1 ? 'detail' : 'details'} to check | (native form/control behavior) |
| UI1343 :229 | textarea / ResultEditor | (child/component label) | onChange={event =&gt; setDraft({ ...draft, reason: event.target.value })} |
| UI1344 :230 | input / ResultEditor | (child/component label) | onChange={event =&gt; setDraft({ ...draft, confirmed: event.target.checked })} |
| UI1345 :230 | Button / ResultEditor | Discard draft | onClick={() =&gt; setDiscard(true)} |
| UI1346 :230 | summary / ResultEditor | Review a local report | (native form/control behavior) |
| UI1347 :231 | Confirm / ResultEditor | "Discard unsaved result edits?" | onConfirm={() =&gt; { clearDraft(); navigate('detail', record.id); }}; onCancel={() =&gt; setDiscard(false)} |
| UI1348 :253 | input / LocalAttachmentReview | (child/component label) | onChange={event =&gt; select(event.target.files?.[0])} |
| UI1349 :255 | input / LocalAttachmentReview | I reviewed this local original. | onChange={event =&gt; setReviewed(event.target.checked)} |
| UI1350 :255 | Button / LocalAttachmentReview | Remove local selection | onClick={() =&gt; { setFile(null); setUrl(''); setReviewed(false); if (input.current) input.current.value = ''; }} |
| UI1351 :268 | select / CompareTests | {records.filter(item =&gt; item.id !== record.id).map(item =&gt; &lt;option key={item.id} value={item.id}&gt;{item.title}{item.archived ? ' (archived)' : ''}&lt;/option&gt;)} | onChange={event =&gt; setSelected(event.target.value)} |
| UI1352 :268 | Button / CompareTests | Inspect selected record | onClick={() =&gt; navigate('detail', second.id)} |
| UI1353 :284 | input / TestExport | Include home or site context and sample location | onChange={event =&gt; setIncludeContext(event.target.checked)} |
| UI1354 :284 | summary / TestExport | Exact export preview | (native form/control behavior) |
| UI1355 :284 | Button / TestExport | Download JSON | onClick={download} |

### components/map-preview/DistrictPanel.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1356 :54 | button / DistrictPanel | Try district again | onClick={onRetry} |
| UI1357 :102 | summary / DistrictPanel | (child/component label) | (native form/control behavior) |
| UI1358 :119 | button / DistrictPanel | {'Explore ${county.county} on the map'} | onClick={() =&gt; onCountySelect(county.county)} |
| UI1359 :133 | summary / DistrictPanel | (child/component label) | (native form/control behavior) |
| UI1360 :150 | summary / DistrictPanel | See unmapped systems | (native form/control behavior) |

### components/map-preview/MapCanvas.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1361 :400 | canvas / MapCanvas | "Map of North Carolina. Use arrow keys to pan, plus and minus to zoom, and Enter to select at the center. The results list offers the same observations." | onKeyDown={keyboard}; onPointerDown={pointerDown}; onPointerMove={pointerMove}; onPointerUp={pointerUp}; onPointerCancel={event =&gt; { pointers.current.delete(event.pointerId); gesture.current = null; }}; onPointerLeave={() =&gt; setHover(null)}; onDoubleClick={() =&gt; {onNavigationStart?.();onViewChange(bound({ ...view, zoom: view.zoom + 1 }));}} |
| UI1362 :404 | button / MapCanvas | Try the map again | onClick={() =&gt; { setError(false); setAttempt(value =&gt; value + 1); }} |
| UI1363 :405 | a / MapCanvas | Census | href="https://www.census.gov/geographies/mapping-files.html" |
| UI1364 :405 | a / MapCanvas | Natural Earth | href="https://www.naturalearthdata.com/" |

### components/map-preview/MapComparison.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1365 :43 | button / MapComparison | {c.back} | onClick={onBack} |
| UI1366 :43 | button / MapComparison | {c.clear} | onClick={onClear} |
| UI1367 :47 | button / MapComparison | {c.retry} | onClick={onRetry} |
| UI1368 :50 | summary / MapComparison | {c.change} | (native form/control behavior) |
| UI1369 :51 | button / MapComparison | {'${c.replace} ${c.first.toLowerCase()}'} | onClick={() =&gt; { setReplacing('first'); setQuery(''); }} |
| UI1370 :52 | button / MapComparison | {'${c.replace} ${c.second.toLowerCase()}'} | onClick={() =&gt; { setReplacing('second'); setQuery(''); }} |
| UI1371 :52 | button / MapComparison | {'${c.remove} ${c.second.toLowerCase()}'} | onClick={() =&gt; { onSelect(firstId); setReplacing(null); setQuery(''); }} |
| UI1372 :56 | input / MapComparison | {c.search} | onChange={event =&gt; setQuery(event.target.value)} |
| UI1373 :57 | button / MapComparison | {c.cancel} | onClick={() =&gt; { setReplacing(null); setQuery(''); setAnnouncement(c.cancelled); }} |
| UI1374 :58 | button / MapComparison | (child/component label) | onClick={() =&gt; choose(record.id)} |
| UI1375 :58 | button / MapComparison | {c.resetSearch} | onClick={() =&gt; setQuery('')} |
| UI1376 :61 | select / MapComparison | {compounds.map(([key, label]) =&gt; &lt;option value={key} key={key}&gt;{label}&lt;/option&gt;)} | onChange={event =&gt; onCompound(event.target.value as Compound)} |
| UI1377 :73 | summary / MapComparison | {c.source} | (native form/control behavior) |
| UI1378 :77 | a / MapComparison | {record.sourceUrl ? record.sourceName : c.background} | href={record.sourceUrl ?? record.backgroundUrl} |

### components/map-preview/MapInsights.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1379 :23 | button / MapInsightCard | "Open area brief" | onClick={onOpen} |
| UI1380 :33 | button / MapKey | "Legend" | onClick={onOpen} |
| UI1381 :54 | button / AreaBrief | Review your system | onClick={() =&gt; onSelect(own.pwsid)} |

### components/map-preview/MapPreview.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1382 :75 | summary / MapPreview | Map design review · Not approved | (native form/control behavior) |
| UI1383 :77 | select / MapPreview | "Review state" | onChange={e=&gt;changeScenario(e.target.value as MapScenario)} |
| UI1384 :78 | select / MapPreview | {comparisonCases.map(([key,label])=&gt;&lt;option key={key} value={key}&gt;{label}&lt;/option&gt;)} | onChange={e=&gt;setComparisonCase(e.target.value as ComparisonCase)} |
| UI1385 :79 | select / MapPreview | (child/component label) | onChange={e=&gt;setAppearance(e.target.value)} |
| UI1386 :79 | select / MapPreview | {['100','115','130','150'].map(n=&gt;&lt;option key={n} value={n}&gt;{n}%&lt;/option&gt;)} | onChange={e=&gt;setScale(e.target.value)} |
| UI1387 :80 | input / MapPreview | Reduce motion | onChange={e=&gt;setMotion(e.target.checked)} |
| UI1388 :80 | input / MapPreview | Higher contrast | onChange={e=&gt;setContrast(e.target.checked)} |
| UI1389 :221 | Link / MapExperience | {publicMode?comparisonCopy.publicBack:'Back to Explore'} | href={foundationHref(publicMode?'plan':'act')} |
| UI1390 :221 | button / MapExperience | "Open Luna" | onClick={()=&gt;openSheet({kind:'assistant'})} |
| UI1391 :221 | button / MapExperience | "About this map" | onClick={()=&gt;openSheet({kind:'about'})} |
| UI1392 :221 | Link / MapExperience | "Settings" | href={foundationHref('settings')} |
| UI1393 :222 | button / MapExperience | Try again | onClick={retry} |
| UI1394 :224 | Button / MapExperience | {comparisonCopy.browse} | onClick={()=&gt;openSheet({kind:'results'})} |
| UI1395 :224 | DistrictPanel / MapExperience | (child/component label) | onRetry={retry} |
| UI1396 :224 | Button / MapExperience | Try the map again | onClick={retry} |
| UI1397 :227 | button / MapExperience | (child/component label) | onClick={()=&gt;setMapLayer(key)}; onKeyDown={e=&gt;{const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(direction){e.preventDefault();const n=(index+direction+4)%4;setMapLayer(mapLayers[n]);e.currentTarget.parentElement?.querySelectorAll&lt;HTMLButtonElement&gt;('button')[n].focus();}}} |
| UI1398 :228 | select / MapExperience | "Water comparison" | onChange={e=&gt;setMapCompound(e.target.value as Compound)} |
| UI1399 :228 | button / MapExperience | "Standard change information" | onClick={()=&gt;openSheet({kind:'legend'})} |
| UI1400 :231 | button / MapExperience | (child/component label) | onClick={()=&gt;openSheet({kind:'results'})} |
| UI1401 :232 | button / MapExperience | (child/component label) | onClick={fitLayer} |
| UI1402 :233 | button / MapExperience | "Previous view" | onClick={()=&gt;{if(previousView){changeView(previousView);setPreviousView(null);setFocusedId(null);setNotice('Returned to the previous map view.');}}} |
| UI1403 :234 | button / MapExperience | "Show map labels" | onClick={()=&gt;setLabels(value=&gt;!value)} |
| UI1404 :237 | button / MapExperience | "Locate your home" | onClick={()=&gt;{navigateView({lng:sampleHome.lng,lat:sampleHome.lat,zoom:8});setNotice('Centered on your approximate home.');}} |
| UI1405 :237 | button / MapExperience | "Zoom in" | onClick={()=&gt;navigateView({...view,zoom:view.zoom+1})} |
| UI1406 :237 | button / MapExperience | "Zoom out" | onClick={()=&gt;navigateView({...view,zoom:view.zoom-1})} |
| UI1407 :238 | button / MapExperience | {value?'Patterns':'Locations'} | onClick={()=&gt;{setPatterns(value);const url=new URL(location.href);url.searchParams.set('presentation',value?'patterns':'locations');history.replaceState(history.state,'',url);}} |
| UI1408 :238 | button / MapExperience | List | onClick={()=&gt;openSheet({kind:'results'})} |
| UI1409 :239 | MapCanvas / MapExperience | (child/component label) | onNavigationStart={rememberView}; onViewChange={changeView}; onSelect={id=&gt;openSheet({kind:'feature',id})}; onReady={setReady}; onUnavailable={()=&gt;setRendererFailed(true)}; onVisibleCountChange={setVisibleCount}; onVisibleIdsChange={setVisibleIds} |
| UI1410 :240 | button / MapExperience | Try again | onClick={retry} |
| UI1411 :241 | Button / MapExperience | Try again | onClick={retry} |
| UI1412 :242 | button / MapExperience | {quarterEmpty?'Return to Latest':'Zoom out'} | onClick={()=&gt;{if(quarterEmpty)loadQuarter('latest');else{setResolved(true);changeView({...defaultView,zoom:6});}}} |
| UI1413 :244 | MapKey / MapExperience | (child/component label) | onOpen={()=&gt;openSheet({kind:'legend'})} |
| UI1414 :245 | button / MapExperience | {!experience.motion?'Paused by your motion settings':undefined} | onClick={()=&gt;setPatternMotion(value=&gt;!value)} |
| UI1415 :247 | button / MapExperience | Try again | onClick={retry} |
| UI1416 :248 | MapInsightCard / MapExperience | (child/component label) | onOpen={()=&gt;openSheet({kind:'brief'})} |
| UI1417 :249 | button / MapExperience | "Return to latest samples" | onClick={()=&gt;loadQuarter('latest')} |
| UI1418 :249 | input / MapExperience | "Water sample quarter" | onPointerDown={()=&gt;{draggingQuarter.current=true;}}; onChange={e=&gt;{const q=quarters[Number(e.target.value)]??'latest';setDraftQuarter(q);if(keyTimer.current)clearTimeout(keyTimer.current);if(!draggingQuarter.current)keyTimer.current=setTimeout(()=&gt;loadQuarter(q),250);}}; onPointerUp={e=&gt;{draggingQuarter.current=false;loadQuarter(quarters[Number(e.currentTarget.value)]??'latest');}}; onPointerCancel={()=&gt;{draggingQuarter.current=false;setDraftQuarter(quarter);}} |
| UI1419 :250 | button / MapExperience | (child/component label) | onClick={()=&gt;openSheet({kind:'district'})}; onTouchStart={e=&gt;{e.currentTarget.dataset.start=String(e.touches[0].clientY);}}; onTouchEnd={e=&gt;{if(Number(e.currentTarget.dataset.start)-e.changedTouches[0].clientY&gt;30)openSheet({kind:'district'});}} |
| UI1420 :254 | AppNavigation / MapExperience | {offline&&&lt;div className="halo-map-offline" role="status"&gt;&lt;WifiOff size={16}/&gt;&lt;span&gt;{noSaved?'This layer is not saved on this device.':'Showing saved map data from Oct 1, | href={foundationHref} |
| UI1421 :255 | ExpandedLunaPreview / MapExperience | (child/component label) | onClose={closeSheet} |
| UI1422 :260 | BottomSheet / MapExperience | "halo-map-sheet" | onClose={closeSheet} |
| UI1423 :261 | AreaBrief / MapExperience | (child/component label) | onSelect={id=&gt;openSheet({kind:'feature',id})} |
| UI1424 :262 | DistrictPanel / MapExperience | (child/component label) | onRetry={offline?undefined:retry}; onCountySelect={name=&gt;{const point=radonPoints.find(p=&gt;p.id===name);if(!point)return;setLayer('radon');setCompound('overall');setQuarter('latest');changeView({lat:point.lat,lng:point.lng,zoom:8});const url=urlForFilters('radon','overall','latest');url.searchParams.delete('panel');url.searchParams.set('system',name);history.replaceState(history.state,'',url);setSheet({kind:'feature',id:name});}} |
| UI1425 :264 | a / MapExperience | U.S. Census boundary source | href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" |
| UI1426 :264 | button / MapExperience | Browse locations as a list | onClick={()=&gt;openSheet({kind:'results'})} |
| UI1427 :265 | MapResults / MapExperience | (child/component label) | onQuery={setFilter}; onSelect={id=&gt;openSheet({kind:'feature',id})} |
| UI1428 :266 | MapComparison / MapExperience | (child/component label) | onSelect={(id,second)=&gt;openSheet({kind:'compare',id,second})}; onCompound={setMapCompound}; onBack={()=&gt;openSheet({kind:'feature',id:sheet.id})}; onClear={closeSheet}; onRetry={()=&gt;{resetComparisonCase();retry();}} |
| UI1429 :268 | Button / MapExperience | Try again | onClick={retry} |
| UI1430 :268 | FeatureDetails / MapExperience | {sheet.id} | onLearn={topic=&gt;openSheet({kind:'learn',topic,id:sheet.id})} |
| UI1431 :269 | button / MapExperience | {comparisonCopy.entry} | onClick={()=&gt;openSheet({kind:'compare',id:sheet.id})} |
| UI1432 :270 | button / MapExperience | Focus on map | onClick={()=&gt;focusRecord(sheet.id)} |
| UI1433 :271 | MapRecordToExplore / MapExperience | (child/component label) | href={foundationHref('act')+'&destination=observations&exploreView=new'} |
| UI1434 :272 | MapLearn / MapExperience | (child/component label) | onBack={()=&gt;openSheet({kind:'feature',id:sheet.id})}; href={publicMode?undefined:factorHref(sheet.topic)} |
| UI1435 :289 | Link / FeatureDetails | Go to Today | href={todayHref} |
| UI1436 :293 | button / FeatureDetails | Understand these water results | onClick={()=&gt;onLearn('pfas')} |
| UI1437 :294 | button / FeatureDetails | Understand this radon zone | onClick={()=&gt;onLearn('radon')} |
| UI1438 :295 | a / FeatureDetails | About EPA ECHO data | href="https://echo.epa.gov/" |
| UI1439 :296 | a / FeatureDetails | About AirNow observations | href="https://www.airnow.gov/" |
| UI1440 :302 | button / MapLearn | Back to location | onClick={onBack} |
| UI1441 :302 | summary / MapLearn | What this information cannot tell you | (native form/control behavior) |
| UI1442 :302 | Link / MapLearn | Explore the {topic==='pfas'?'water':'radon'} guide | href={href} |
| UI1443 :302 | a / MapLearn | EPA background information | href={topic==='pfas'?'https://www.epa.gov/pfas':'https://www.epa.gov/radon'} |

### components/map-preview/MapPublicBrief.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1444 :14 | summary / MapPublicBrief | {c.publicBrief} | (native form/control behavior) |
| UI1445 :14 | textarea / MapPublicBrief | {c.briefPreview} | (native form/control behavior) |
| UI1446 :14 | button / MapPublicBrief | {c.copyBrief} | onClick={copy} |
| UI1447 :14 | button / MapPublicBrief | {c.downloadBrief} | onClick={download} |
| UI1448 :14 | button / MapPublicBrief | {pending?c.busy:c.shareBrief} | onClick={share} |

### components/map-preview/MapResults.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1449 :18 | input / MapResults | {layer==='radon'?'County name':'Name or system ID'} | onChange={e=&gt;onQuery(e.target.value)} |
| UI1450 :20 | button / MapResults | {label} | onClick={()=&gt;setScope(key)} |
| UI1451 :21 | select / MapResults | "Sort results" | onChange={e=&gt;setSort(e.target.value)} |
| UI1452 :27 | button / MapResults | (child/component label) | onClick={()=&gt;onSelect(p.id)} |
| UI1453 :30 | button / MapResults | Show all records | onClick={()=&gt;{onQuery('');setScope('all');}} |

### components/map-preview/MapSystemFollow.tsx

Contract family: M01-M05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1454 :18 | button / MapSystemFollow | {followed?&lt;Check size={17}/&gt;:&lt;Bell size={17}/&gt;} {followed?c.stopFollow:c.follow} | onClick={toggle} |

### components/onboarding/Preview.tsx

Contract family: G01 / X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1455 :18 | select / Preview | {mockScenarios.map(value=&gt;&lt;option key={value} value={value}&gt;{value}&lt;/option&gt;)} | onChange={event=&gt;{setScenario(event.target.value as MockScenario);restart();}} |
| UI1456 :19 | select / Preview | (child/component label) | onChange={event=&gt;setDesign(event.target.value as 'approved'\|'mobile')} |
| UI1457 :20 | Link / Preview | Continue to My Week | href="/foundation/preview/expanded/?tab=plan" |
| UI1458 :20 | Button / Preview | {copy.preview.restart} | onClick={restart} |
| UI1459 :20 | OnboardingScreen / Preview | (child/component label) | onComplete={complete} |
| UI1460 :20 | Link / Preview | Browse without a home | href="/foundation/preview/expanded/?access=public" |

### components/onboarding/ResultsReveal.tsx

Contract family: G01 / X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1461 :63 | Button / ResultsReveal | {copy.home.results} | onClick={onComplete} |

### components/stage/HomeEvidence.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1462 :31 | button / HomeEvidence | Retry water lookup | onClick={() =&gt; void refresh()} |
| UI1463 :32 | Link / HomeEvidence | Confirm your water source | href="/settings?open=home" |
| UI1464 :34 | summary / HomeEvidence | Detected without an enforceable comparison | (native form/control behavior) |
| UI1465 :35 | summary / HomeEvidence | Shown, not scored | (native form/control behavior) |
| UI1466 :36 | a / HomeEvidence | Water data source | href={source} |
| UI1467 :37 | Link / HomeEvidence | Review home details | href="/settings?open=home" |
| UI1468 :44 | Link / HomeEvidence | Add the year your home was built in Settings | href="/settings?open=home" |
| UI1469 :45 | Link / HomeEvidence | View the private-water testing plan | href="/factors/pfas#reading-detail" |
| UI1470 :46 | a / HomeEvidence | {safeText(source.name, 'Service-line inventory source')} {isoDate(source.retrieved) ? ', retrieved ${dateLabel(source.retrieved)}' : ''} | href={url} |
| UI1471 :58 | summary / TestingPlan | {finite(test.rank) ?? index + 1} . {safeText(test.name, 'Water test')} | (native form/control behavior) |
| UI1472 :71 | Link / HomeActionPlan | Open your water testing plan | href="/factors/pfas#reading-detail" |
| UI1473 :71 | summary / HomeActionPlan | {finite(item.rank) ?? index + 1} . {safeText(item.title, 'Recommended action')} | (native form/control behavior) |

### components/stage/StageApp.tsx

Contract family: T01-T06 / H01-H05 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1474 :150 | select / Frame | {[100, 115, 130, 150].map(scale =&gt; &lt;option key={scale} value={scale}&gt;{scale}%&lt;/option&gt;)} | onChange={e =&gt; updatePreferences({ ...preferences, scale: Number(e.target.value) })} |
| UI1475 :150 | input / Frame | Reduce animation | onChange={e =&gt; updatePreferences({ ...preferences, reduced: e.target.checked })} |
| UI1476 :150 | input / Frame | Higher contrast | onChange={e =&gt; updatePreferences({ ...preferences, contrast: e.target.checked })} |
| UI1477 :158 | a / Frame | Skip to content | href="#halo-main" |
| UI1478 :160 | Link / Frame | {'Back to ${home ? 'Homeguard' : 'Today'}'} | href={back} |
| UI1479 :160 | button / Frame | {session.alerts ? 'Alerts, ${session.alerts.unread} unread' : 'Alerts'} | onClick={() =&gt; openSheet('alerts')} |
| UI1480 :160 | Link / Frame | "Settings" | href="/settings" |
| UI1481 :164 | Button / Frame | Try again | onClick={() =&gt; void session.restart()} |
| UI1482 :164 | Link / Frame | Set your location | href="/onboarding?change=1" |
| UI1483 :165 | button / Frame | Reconnect profile | onClick={() =&gt; void session.restart()} |
| UI1484 :166 | button / Frame | {reading.loading ? 'Updating readings' : seconds &gt; 0 ? 'Try again in ${seconds}s' : 'Refresh readings'} | onClick={() =&gt; void session.refresh(true)} |
| UI1485 :173 | AppNavigation / Frame | (child/component label) | onUnavailable={label =&gt; setToast('${label} is not part of this release yet.')} |
| UI1486 :173 | button / Frame | "Open Luna" | onClick={() =&gt; openSheet('assistant')} |
| UI1487 :175 | LunaAssistant / Frame | (child/component label) | onClose={closeSheet}; onNavigate={routeFromSheet} |
| UI1488 :176 | BottomSheet / Frame | "halo-alerts" | onClose={closeSheet} |
| UI1489 :176 | AlertsContent / Frame | (child/component label) | onNavigate={routeFromSheet} |
| UI1490 :191 | button / AlertsContent | Retry alerts | onClick={() =&gt; void session.refreshAlerts()} |
| UI1491 :193 | Button / AlertsContent | Mark all as read | onClick={() =&gt; void mutate({ all: true })} |
| UI1492 :194 | button / AlertsContent | Mark as read | onClick={() =&gt; void mutate({ id: alert.id })} |
| UI1493 :194 | button / AlertsContent | Dismiss | onClick={() =&gt; void mutate({ id: alert.id, dismissed: true })} |
| UI1494 :194 | button / AlertsContent | View readings | onClick={() =&gt; onNavigate(alert.type === 'new_water_results' ? '/factors/pfas' : alert.type === 'radon_season' ? '/factors/radon' : '/today')} |

### components/stage/StageSettings.tsx

Contract family: X04-X05.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1495 :149 | Button / StageSettings | "Reload profile" | onClick={reloadProfile} |
| UI1496 :153 | AccordionRow / StageSettings | "stage-household-options" | onToggle={() =&gt; setOpen(open === 'household' ? null : 'household')} |
| UI1497 :155 | ToggleChip / StageSettings | {labels[key]} | onToggle={() =&gt; changeHousehold(key)} |
| UI1498 :156 | Button / StageSettings | "Save household" | onClick={() =&gt; { void save('household'); }} |
| UI1499 :158 | AccordionRow / StageSettings | "stage-home-options" | onToggle={() =&gt; setOpen(open === 'home' ? null : 'home')} |
| UI1500 :159 | form / StageSettings | (child/component label) | onSubmit={event =&gt; { event.preventDefault(); void save('home'); }} |
| UI1501 :160 | input / StageSettings | Year your home was built {errors.year && &lt;span id="stage-year-error" className="halo-error"&gt;{errors.year}&lt;/span&gt;} | onBlur={() =&gt; setErrors(current =&gt; ({ ...current, year: validateHomeYear(draft.year) }))}; onChange={event =&gt; changeHome('year', event.target.value.replace(/\D/g, ''))} |
| UI1502 :161 | select / StageSettings | (child/component label) | onChange={event =&gt; changeHome('water', event.target.value)} |
| UI1503 :166 | Button / StageSettings | Change address | onClick={changeAddress} |

### components/ui/AppNavigation.tsx

Contract family: G01 / X01-X06 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1504 :19 | button / AppNavigation | {'${tab.label}, coming in a later stage'} | onClick={() =&gt; onUnavailable?.(tab.label)} |
| UI1505 :20 | Link / AppNavigation | {label} | href={href?.(tab.key) ?? tab.href}; onClick={onNavigate ? e =&gt; { e.preventDefault(); onNavigate(tab.key); } : undefined} |

### components/ui/Button.tsx

Contract family: G01 / X01-X06 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1506 :5 | button / Button | {busy && &lt;span className="halo-spinner halo-button-spinner" aria-hidden="true" /&gt;} | (native form/control behavior) |

### components/ui/DateInput.tsx

Contract family: G01 / X01-X06 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1507 :146 | div / calendar | {popupId} | onClick={event =&gt; event.stopPropagation()}; onKeyDown={event =&gt; { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } if (event.key === 'Tab') { const controls = [...(popup.current?.querySelectorAll&lt;HTMLElement&gt;('button:not(:disabled):not([tabindex="-1"]), select:not(:disabled)') ?? [])]; const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (! |
| UI1508 :157 | button / calendar | "Close calendar" | onClick={() =&gt; close()} |
| UI1509 :160 | button / calendar | "Previous month" | onClick={() =&gt; browseMonth(-1)} |
| UI1510 :162 | select / calendar | "Calendar month" | onChange={event =&gt; { const next = '${String(shownYear).padStart(4, '0')}-${String(Number(event.target.value) + 1).padStart(2, '0')}-01'; moveFocus(next); }} |
| UI1511 :165 | select / calendar | "Calendar year" | onChange={event =&gt; moveFocus(shiftCalendarMonth(focusedDay, (Number(event.target.value) - shownYear) * 12))} |
| UI1512 :169 | button / calendar | "Next month" | onClick={() =&gt; browseMonth(1)} |
| UI1513 :173 | button / calendar | {'${calendarDateLabel(day)}${day === today ? ', today' : ''}'} | onClick={() =&gt; choose(day)}; onKeyDown={event =&gt; dayKey(event, day)} |
| UI1514 :175 | button / calendar | Today | onClick={() =&gt; choose(today)} |
| UI1515 :175 | button / calendar | Clear date | onClick={() =&gt; choose('')} |
| UI1516 :180 | input / DateInput | {calendar} | onChange={change}; onKeyDown={event =&gt; { onKeyDown?.(event); if (!event.defaultPrevented && event.altKey && event.key === 'ArrowDown') { event.preventDefault(); showCalendar(); } }} |
| UI1517 :181 | button / DateInput | {'Choose ${calendarLabel}'} | onClick={event =&gt; { event.preventDefault(); if (open) close(); else showCalendar(); }} |

### components/ui/ErrorCallout.tsx

Contract family: G01 / X01-X06 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1518 :4 | button / ErrorCallout | {copy.common.retry} | onClick={retry} |

### components/ui/Foundation.tsx

Contract family: G01 / X01-X06 / shared.

| ID / line | Control / owner | Label or role expression | Callback or navigation binding |
| --- | --- | --- | --- |
| UI1519 :11 | button / Card | {children} | onClick={onClick} |
| UI1520 :16 | button / ExpandableCard | (child/component label) | onClick={() =&gt; onOpenChange(!open)} |
| UI1521 :43 | span / ContributionBar | {(s.share ?? 0) &gt;= 10 && &lt;span&gt;{s.shortLabel ?? s.label}&lt;/span&gt;} | onClick={() =&gt; onSelect(s.key)} |
| UI1522 :44 | button / ContributionBar | {c.factorLabel(s.label, s.severity, s.share)} | onClick={() =&gt; onSelect(s.key)} |
| UI1523 :69 | button / SegmentedControl | {option} | onClick={() =&gt; onChange(option)}; onKeyDown={e =&gt; keyDown(e, i)} |
| UI1524 :72 | button / ToggleChip | {children} | onClick={onToggle} |
| UI1525 :75 | button / Switch | (child/component label) | onClick={() =&gt; onChange(!checked)} |
| UI1526 :78 | button / AccordionRow | (child/component label) | onClick={onToggle} |
| UI1527 :83 | div / SwipeRow | (child/component label) | onTouchStart={e =&gt; { start.current = e.touches[0].clientX; }}; onTouchEnd={e =&gt; { if (start.current !== null) setRevealed(start.current - e.changedTouches[0].clientX &gt; 50); start.current = null; }} |
| UI1528 :83 | button / SwipeRow | {actionLabel} | onClick={onAction} |
| UI1529 :118 | dialog / BottomSheet | {id} | onCancel={e =&gt; { e.preventDefault(); onClose(); }}; onClick={e =&gt; { if (e.target !== e.currentTarget) return; const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX &lt; rect.left \|\| e.clientX &gt; rect.right \|\| e.clientY &lt; rect.top \|\| e.clientY &gt; rect.bottom) onClose(); }} |
| UI1530 :123 | div / BottomSheet | {c.drag} | onPointerDown={e =&gt; { dragStart.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}; onPointerUp={e =&gt; { if (dragStart.current !== null && e.clientY - dragStart.current &gt; 60) onClose(); dragStart.current = null; }} |
| UI1531 :124 | button / BottomSheet | {c.close} | onClick={onClose} |

## Appendix B. Existing frontend transport and domain type register

These are extracted existing frontend types, including review models. They are evidence of required fields and adapter work, not automatic approval of a production database schema or fixture defaults. Server contracts in the main document govern authority, privacy, state semantics and proposed additions. Imports/references use their original repository names. Cosmetic component types do not require network storage.

### lib/frontend/account-review.ts

```ts
// Source line 3
export type CapabilityState=typeof capabilityStates[number];

// Source line 4
export type HomeTransition={id:string;title:string;revision:number;previousId:string;area:string;portableIds:string[];confirmedAt:string;readings:'unavailable';previousProfile?:{year:string;water:string;tenure:string}};
```

### lib/frontend/api.ts

```ts
// Source line 22
export interface LiveApiOptions {
  /** Injection seam for offline unit tests, not an alternative production auth path. */
  loadAuth?: () => Promise<AuthModule>;
  normalTimeoutMs?: number;
  slowTimeoutMs?: number;
  onIdentityChange?: () => void;
  /** Stage-specific shape checks run before an environmental response is cached. */
  validateReading?: (kind: "daily" | "home", payload: unknown) => void;
}

// Source line 33
export interface ProtectedOnboardingApi extends OnboardingApi {
  request<T>(endpoint: string, init?: RequestInit, signal?: AbortSignal, cache?: "daily" | "home", timeoutMs?: number): Promise<T>;
}
```

### lib/frontend/expanded-preview.ts

```ts
// Source line 2
export type PreviewAction = { id: string; key: string; title: string; reason: string; origin: string; date: string; state: 'saved' | 'completed' | 'waiting'; revision?: number };

// Source line 3
export type ActionSeed = Pick<PreviewAction, 'key' | 'title' | 'reason' | 'origin'> & { date?: string };

// Source line 28
export type ExpandedDestination = keyof typeof destinations;

// Source line 42
export type ActionRevision = { id:string; revision:number; patch:Pick<PreviewAction,'title'|'date'|'state'> };
```

### lib/frontend/explore-local-resources.ts

```ts
// Source line 2
export type LocalResourceScope = 'examples' | 'charlotte' | 'union' | 'basin' | 'elsewhere';

// Source line 3
export type LocalResourceInterest = 'Cleanup' | 'Trees & habitat' | 'Gardening' | 'Community learning';

// Source line 4
export type LocalParticipationResource = {
  id: string; title: string; organizer: string; interest: LocalResourceInterest;
  scopes: LocalResourceScope[]; area: string; mission: string; work: string;
  url: string; sourceTitle: string; extraSources?: { title: string; url: string }[];
  address?: string; addressRole?: string; contact?: string;
  effort: string; age: string; cost: string; access: string;
  steps: { title: string; text: string }[]; bring: string; followup: string;
};
```

### lib/frontend/explore-opportunities.ts

```ts
// Source line 6
export type CommunityOpportunity = {
  id: string; organizer: string; title: string; interest: string; artwork: 'tree' | 'cleanup' | 'garden';
  scopes: LocalResourceScope[]; area: string; venue: string; address?: string;
  kind: 'scheduled' | 'rolling'; startsAt?: string; endsAt?: string; timeLabel: string;
  checkedAt: string; status: 'listed' | 'cancelled' | 'full' | 'postponed'; url: string;
  summary: string; work: string[]; duration: string; cost: string; age: string; access: string;
  bring: string; join: string; safety: string;
};
```

### lib/frontend/explore-personalization.ts

```ts
// Source line 5
export type ProjectConstraints = {
  space: 'any' | 'indoors' | 'balcony' | 'yard' | 'community';
  mode: 'any' | 'solo' | 'group';
  time: 'any' | 'quick' | 'half-day' | 'ongoing';
  budget: 'any' | 'reuse' | 'low';
  count: 3 | 5 | 10 | 11 | 12 | 13 | 14 | 15;
};

// Source line 13
export type ProjectEvidence = {
  id: string; topic: 'air' | 'uv' | 'pollen' | 'weather' | 'water' | 'radon' | 'lead' | 'garden' | 'moisture' | 'filter' | 'test';
  label: string; value: string; scope: string; asOf: string; provenance: string; stale: boolean; status: 'available' | 'unknown';
  numericValue?: number; unit?: string; pollutant?: string;
};

// Source line 18
export type ProjectEnvironmentContext = {
  key: string; isSample: true; state: string; county: string; renter: boolean | null; evidence: ProjectEvidence[];
  hasGarden: boolean; gardenWaterKnown: boolean; hasMoistureObservation: boolean; filterModelKnown: boolean;
  sourceStatus: 'reviewed-drafts' | 'unavailable';
  /** Rotate equally relevant general options only; never modify environmental evidence. */
  variation?: number;
  previousIdeaIds?: string[];
  interestOnly?: boolean;
  /** Explicit form choices win over constraints embedded in an older request. */
  requestConstraints?: 'interpret' | 'explicit';
};

// Source line 29
export type ProjectSuggestion = {
  id: string; title: string; reason: string; tags: string[]; evidenceIds: string[]; sourceIds: string[];
  fit: 'context' | 'interest' | 'general'; needsCheck: string[];
};

// Source line 33
export type ProjectGenerationState = {
  request: string; constraints: ProjectConstraints; items: ProjectSuggestion[]; contextKey: string; generation: number;
};
```

### lib/frontend/explore-photos.ts

```ts
// Source line 3
export type ExplorePhotoScene = 'river' | 'trail' | 'garden' | 'bee' | 'tree' | 'soil' | 'water' | 'compost' | 'food' | 'moisture' | 'solar' | 'cleanup';
```

### lib/frontend/explore-preview.ts

```ts
// Source line 7
export type ExploreSection = keyof typeof exploreSections;

// Source line 9
export type Recipient = typeof recipients[number];

// Source line 11
export type FieldNote = { id: string; title: string; revision: number; kind: string; observedAt: string; timezone: string; place: string; description: string; status: 'draft' | 'prepared' | 'form-opened' | 'reported'; reference: string; noteType?: 'Observation' | 'Question' | 'Idea' | 'Conversation'; pinned?: boolean; evidence?: EvidenceReference[]; photo?: NotePhoto; archived?: boolean; handoff?: NoteHandoffSnapshot; handoffHistory?: NoteHandoffSnapshot[] };
```

### lib/frontend/explore-project-guides.ts

```ts
// Source line 5
export type ProjectGuideSource = { id: string; title: string; publisher: string; url: string; checked: string; published?: string };

// Source line 6
export type ProjectGuideStep = { title: string; instructions: string[]; checkpoint: string; sourceIds: string[] };

// Source line 7
export type ProjectGuide = {
  id: string; version: string; title: string; cause: 'Water' | 'Habitats' | 'Community' | 'Energy' | 'Air';
  scene: import('./explore-photos').ExplorePhotoScene; icon: 'plant' | 'bee' | 'cleanup' | 'sun' | 'water' | 'air';
  description: string; purpose: string; effort: string; cost: string; scope: string;
  suitability: string; materials: string[]; constraints: string[]; steps: ProjectGuideStep[];
  completion: string; followup: string; sources: ProjectGuideSource[];
  buildPlan?: { title: string; note: string; parts: { name: string; quantity: number; size: string }[]; assembly: string[]; sourceId: string };
};
```

### lib/frontend/explore-workspace.ts

```ts
// Source line 2
export type EvidenceReference = { recordId: string; title: string; layer: string; observedAt: string | null; scope: string };

// Source line 3
export type Engagement = {
  id: string; revision: number; title: string; organizer: string; cause: string;
  url: string; place: string; date: string; status: 'Considering' | 'Contacted' | 'Confirmed by me' | 'Participated' | 'Follow-up' | 'Closed';
  statusDate: string; participatedOn?: string; hours: string; preparation: string; outcome: string; reference: string; followupDate: string;
  history: { status: string; date: string; note: string }[];
};

// Source line 11
export type OutcomeRecord = {
  id: string; revision: number; title: string; goal: string;
  status: 'Open' | 'Working on it' | 'Waiting for a response' | 'Result recorded' | 'Closed without a result';
  date: string; result: string; reference: string; nextStep: string; followupDate: string;
  history: { status: string; date: string; result: string }[];
};

// Source line 19
export type ProjectRecord = { id: string; revision: number; title: string; status: 'Active' | 'Paused' | 'Completed'; goal: string; stepNotes: Record<string, string>; outcome: string; reviewDate: string; history: { status: string; note: string }[] };
```

### lib/frontend/factor-preview.ts

```ts
// Source line 3
export type FactorKey = typeof factorKeys[number];

// Source line 4
export type TrendPoint = { date: string; label: string; value: number | null };

// Source line 5
export type FactorDetails = {
  air?: { aqi: number; pollutant: string; pollutantName: string; explanation: string };
  uv?: { peak_window: { start: string; end: string; max: number } | null };
  pollen?: { categories: { name: string; value: number | null; severity: string }[] };
  mold?: { humidity_pct: number | null; precip_pct: number | null };
  water?: {
    sampleDate: string;
    rows: { name: string; value_ppt: number; limit_ppt: number | null; severity: string; exceeds_limit: boolean; is_enforceable?: boolean; basis?: string; source?: string; date_iso?: string | null; proposed_for_rescission?: boolean }[];
    lithium_ug_l: number | null;
    coverage?: string; status?: string; is_measured?: boolean; includes_guidance?: boolean; confidence?: string;
    detected_unregulated?: { name: string; value_ppt: number | null; date_iso: string | null }[];
  };
  radon?: { zone: number; county: string };
  lead?: { home_year: number | null };
};

// Source line 20
export type FactorReading = {
  key: FactorKey;
  title: string;
  shortTitle: string;
  score: number | null;
  severity: string;
  reading: string;
  unit: string;
  provenance: 'measured' | 'modeled' | 'estimate' | null;
  source: string;
  asOf: string;
  sentence: string;
  detail: string;
  why: string | null;
  householdNote: string | null;
  trend: TrendPoint[];
  trendTitle: string;
  trendCaption: string;
  context: Record<string, string | number>;
  details: FactorDetails;
  /** Live provenance and coverage notices, absent in frozen design fixtures. */
  disclosures?: string[];
};

// Source line 44
export type PreviewPreferences = { appearance?: string; scale?: string; motion?: MotionMode; time?: SceneTime; contrast?: boolean; expanded?: boolean };
```

### lib/frontend/food-catalogue.ts

```ts
// Source line 4
export type CatalogueFood = { id: string; name: string; guideId: string; aliases: string[] };
```

### lib/frontend/food-evidence.ts

```ts
// Source line 6
export type FoodContaminant = 'PFAS' | 'Lead';

// Source line 7
export type FoodEvidenceMetric = Readonly<{ label: string; value: string; unit: string; qualifier: 'count' | 'detected-range' | 'maximum' | 'not-detected' | 'reporting-limit' }>;

// Source line 8
export type FoodEvidenceRecord = Readonly<{
  id: string; title: string; contaminant: FoodContaminant; analyte: string;
  foodIds: readonly string[]; scope: 'food-study'; finding: string;
  metrics: readonly FoodEvidenceMetric[];
  source: Readonly<{ title: string; url: string; locator: string; publishedAt: string; sampledAt: string; reviewedAt: string; methodologyUrl: string }>;
  scopeDetail: string; limitation: string; nextStep: string;
  sample: Readonly<{ count: number; detects: number; nonDetects: number; description: string; region: string; method: string; basis: string; limit: number; limitKind: 'MDL' | 'reporting-limit'; unit: string }>;
}>;

// Source line 72
export type FoodEvidenceQuery = { foodId?: string; name?: string; guideId?: string };

// Source line 73
export type FoodEvidenceBundle = Readonly<{
  foodId?: string; studies: readonly FoodEvidenceRecord[];
  indicators: readonly Readonly<{ contaminant: FoodContaminant; label: 'Study available' | 'Guidance available'; itemLevel: 'Unknown'; evidenceCount: number }>[];
  boundary: string; reviewedAt: string; revision: string;
}>;
```

### lib/frontend/food-pfas-guide.ts

```ts
// Source line 11
export type FoodSourceKey = keyof typeof foodGuideSources;

// Source line 12
export type FoodOrigin = 'store' | 'homegrown' | 'caught' | 'unknown';

// Source line 14
export type FoodGuide = {
  id: string; title: string; examples: string; aliases: string[];
  icon: 'fish' | 'produce' | 'dairy' | 'meat' | 'pantry';
  finding: string; findingSource: FoodSourceKey; limit: string;
  origins: FoodOrigin[]; question: string;
};

// Source line 89
export type FoodStorage = 'fridge' | 'pantry' | 'freezer';

// Source line 91
export type PantryItem = { id: string; title: string; revision: number; guideId: string; origin: FoodOrigin; question: string; createdAt: string; updatedAt: string; guideRevision: string; foodId?: string; storage?: FoodStorage };
```

### lib/frontend/foundation-preview.ts

```ts
// Source line 57
export type FoundationScenario = typeof foundationScenarios[number][0];

// Source line 62
export type PreviewTab = typeof previewTabs[number];

// Source line 63
export type PreviewRoute = PreviewTab | 'settings' | 'plan';

// Source line 64
export type PreviewSheet = 'learn' | 'alerts' | 'assistant' | 'map';
```

### lib/frontend/home-food-preview.ts

```ts
// Source line 2
export type FoodRecord = { id: string; title: string; revision: number };

// Source line 3
export type GardenSite = FoodRecord & {
  setup: string; county: string; irrigation: string; householdSourceConfirmed: boolean;
  soil: string; concern: string; questions: string; testIds: string[];
  history: { date: string; irrigation: string; soil: string; revision: number }[];
};

// Source line 8
export type FishNote = FoodRecord & {
  kind: 'catch' | 'consumption'; date: string; timezone: string; waterbody: string; species: string;
  quantity: string; unit: string; note: string; advisoryId: string; advisoryRevision: number;
  history?: { date: string; revision: number; original: Omit<FishNote, 'history'> }[];
};

// Source line 13
export type FoodFollow = FoodRecord & { kind: 'fish' | 'food' | 'water' | 'resource'; targetId: string; sourceRevision: number; following: boolean; saved: boolean };

// Source line 14
export type EvidenceQuestion = FoodRecord & { evidenceId: string; question: string; reportId: string; note: string };

// Source line 15
export type GrowerInquiry = FoodRecord & {
  resourceId: string; siteId: string; testId: string; checklist: string[]; questions: string;
  state: string; contactDate: string; followUpDate: string; reference: string; response: string;
};

// Source line 19
export type UsageRecord = FoodRecord & {
  kind: 'interval' | 'meter'; site: string; meter: string; start: string; end: string;
  quantity: string; unit: string; basis: 'measured' | 'estimated' | 'user-reported'; source: string;
  reset: boolean; note: string; history: { date: string; quantity: string; unit: string; start: string; end: string; reason: string; original?: Omit<UsageRecord, 'history'> }[];
};

// Source line 89
export type UsageComparison = { compatible: false; reason: string } | { compatible: true; kind: 'interval' | 'meter'; difference: number; unit: string; days: number; gapDays: number; description: string };
```

### lib/frontend/home-household.ts

```ts
// Source line 10
export type HomeMemberKey = typeof homeMemberKeys[number];

// Source line 11
export type HouseholdBands = Record<`has_${HomeMemberKey}`, boolean>;

// Source line 13
export type HomeMemberAction = {
  factor: 'pfas' | 'lead' | 'radon' | 'mold';
  title: string;
  body: string;
  sourceLabel: string;
  sourceUrl: string;
};
```

### lib/frontend/home-maintenance-preview.ts

```ts
// Source line 4
export type MaintenanceEvent = { id: string; kind: 'completed' | 'skipped' | 'snoozed' | 'paused' | 'resumed' | 'replaced' | 'cadence changed'; date: string; due: string; note: string };

// Source line 5
export type HomeAsset = {
  id: string; title: string; revision: number; model: string; installed: string; serviced: string; factor: FactorKey;
  instructions: string; basis: 'user' | 'manufacturer' | 'reviewed'; policy: 'calendar' | 'completion'; interval: number;
  unit: 'days' | 'months'; nextDue: string; calendarAnchor: string; endDate: string; lastCompleted: string; snoozedUntil: string;
  status: 'active' | 'paused' | 'replaced'; history: MaintenanceEvent[]; testId: string;
};

// Source line 11
export type MoistureObservation = {
  id: string; title: string; revision: number; kind: 'dampness' | 'leak' | 'condensation' | 'humidity' | 'other';
  observedAt: string; timezone: string; room: string; reading: string; unit: string; source: string; note: string;
  photoName: string; photoData: string; photoMetadataRemoved?:boolean; assetId: string; testId: string;
};

// Source line 96
export type SummarySection = 'scores' | 'factors' | 'tests' | 'actions' | 'maintenance' | 'observations' | 'gardens';

// Source line 97
export type SummarySelection = {
  purpose: string; start: string; end: string; sections: Record<SummarySection, boolean>; categories: boolean; location: boolean; notes: boolean; attachments: boolean; appendix: boolean; excluded: string[];
};
```

### lib/frontend/home-test-preview.ts

```ts
// Source line 3
export type TestKind = typeof testKinds[number];

// Source line 5
export type TestStatus = typeof testStatuses[number];

// Source line 13
export type TestResultRow = {
  id: string; analyte: string; originalValue: string; originalUnit: string;
  qualifier: keyof typeof resultQualifiers; limit: string; limitUnit: string;
  basis: string; reportDate: string; reportReference: string;
};

// Source line 18
export type TestRevision = { revision: number; date: string; reason: string; rows: TestResultRow[]; review: TestRecord['review'] };

// Source line 19
export type TestRecord = {
  id: string; title: string; revision: number; kind: TestKind; purpose: string;
  contextId: string; contextSnapshot?: { label: string; revision?: number; irrigation?: string }; medium: string; provider: string; plannedDate: string;
  collectionStart: string; collectionEnd: string; sampleLabel: string; method: string;
  expectedDate: string; status: TestStatus; arrangedByUser?: boolean; awaitingRecorded?: boolean; rows: TestResultRow[];
  review: 'not_received' | 'unreviewed' | 'needs_clarification' | 'user_confirmed';
  reviewReason: string; history: TestRevision[]; archived: boolean;
};
```

### lib/frontend/homepage-preview.ts

```ts
// Source line 13
export type AttentionItem={id:string;title:string;label:string;date:string;actionId?:string;record?:WeekRecord;route?:WeekActivityRoute};

// Source line 40
export type PreparationPlan={id:string;signature:string;title:string;date:string;action?:PreviewAction;route?:WeekActivityRoute;label:string;place:string;url:string|null;instructions:string[];checks:string[];status:string};
```

### lib/frontend/household-pdf.ts

```ts
// Source line 4
export type HouseholdReport = { title: string; generated: string; introduction: string[]; sections: { title: string; lines: string[] }[] };

// Source line 5
export type ReportProgress = { value: number; label: string };
```

### lib/frontend/luna-task-actions.ts

```ts
// Source line 5
export type LunaTaskOperation = 'move' | 'rename' | 'delete' | 'complete' | 'reopen' | 'waiting' | 'unschedule';

// Source line 6
export type LunaTaskSnapshot = Pick<PreviewAction, 'id' | 'key' | 'title' | 'origin' | 'date' | 'state'> & { revision: number; metadataSignature: string };

// Source line 7
export type LunaTaskChange = { operation: LunaTaskOperation; task: LunaTaskSnapshot; title: string; date: string };
```

### lib/frontend/luna-tools-preview.ts

```ts
// Source line 5
export type LunaIntent =
  | { kind: 'projects'; request: string }
  | { kind: 'local'; request: string }
  | { kind: 'guide' }
  | { kind: 'answer'; theme: 'water' | 'home' | 'today' | 'reason' }
  | { kind: 'start-project'; name: string }
  | { kind: 'open-project'; name: string }
  | { kind: 'navigate'; tab: string; destination?: string }
  | { kind: 'create-task'; title: string; date: string; requiresDate: boolean }
  | { kind: 'move-task'; name: string; date: string; requiresDate: boolean }
  | { kind: 'change-task'; operation: Exclude<LunaTaskOperation, 'move'>; name: string; title?: string }
  | { kind: 'find-task'; name: string }
  | { kind: 'save-note'; title: string; description: string }
  | { kind: 'edit-note'; name: string; description: string }
  | { kind: 'delete-note'; name: string }
  | { kind: 'clarify'; message: string };
```

### lib/frontend/luna-week-plan.ts

```ts
// Source line 3
export type LunaWeekPlan={date:string;budget:number|null;items:{id:string;revision:number;key:string;title:string;previousDate:string;date:string;minutes:number}[];unknown:number;commitments:number;metadataSignature:string;explanation:string};
```

### lib/frontend/map-comparison-preview.ts

```ts
// Source line 5
export type ComparisonValue = {
  analyte: string; value: number | null; unit: string; observedAt: string | null;
  period: string | null; periodLabel: string; method: string | null;
  qualifier: 'reported' | 'estimated' | 'non-detect' | 'unknown';
};

// Source line 10
export type PublicComparisonRecord = {
  id: string; name: string; kind: string; scope: string; denominator: string | null;
  sourceVersion: string | null; sourceName: string; sourceUrl: string | null;
  backgroundUrl: string; status: 'available' | 'withdrawn' | 'unavailable';
  coverage: 'partial' | 'complete' | 'unknown'; coverageLabel: string;
  values: ComparisonValue[];
};

// Source line 23
export type ComparisonCase = typeof comparisonCases[number][0];
```

### lib/frontend/map-district-preview.ts

```ts
// Source line 2
export type DistrictPreviewVariant =
  | "full"
  | "population-missing"
  | "population-partial"
  | "zero"
  | "error"
  | "geography-error"
  | "comparison-missing";

// Source line 11
export type DistrictWaterSeverity = "good" | "moderate" | "elevated" | "high" | "severe" | "no_data";

// Source line 12
export type DistrictCompound = "PFOA" | "PFOS" | "PFHxS" | "PFNA" | "HFPO-DA";

// Source line 14
export type DistrictCounty = {
  county: string;
  in_district: "whole" | "partial";
  systems: number;
  systems_over_limit: number;
  worst_water_severity: DistrictWaterSeverity;
  radon_zone: number | null;
};

// Source line 23
export type DistrictPreviewData = {
  scope: "NC-08";
  total_systems: number;
  systems_tested_any: number;
  systems_over_limit: number;
  affected_population: number | null;
  affected_population_complete: boolean;
  over_limit_population_unknown: number;
  by_contaminant: Record<DistrictCompound, {
    tested: number;
    over: number;
    limit: number;
    // Display context from the existing water response, not a new /api/district field.
    proposed_for_rescission: boolean;
    population_over: number | null;
    over_population_unknown: number;
  }>;
  counties: DistrictCounty[];
  state_comparison: { district_share_over: number | null; state_share_over: number | null };
  unlocated_systems: number;
  assembled_at: string;
};
```

### lib/frontend/map-preview.ts

```ts
// Source line 2
export type MapLayer = 'water' | 'radon' | 'facilities' | 'air';

// Source line 3
export type MapSeverity = 'good' | 'moderate' | 'elevated' | 'high' | 'severe' | 'no_data';

// Source line 6
export type Compound = typeof compounds[number][0];

// Source line 19
export type MapScenario = typeof mapScenarios[number][0];

// Source line 20
export type Reading = { value_ppt?: number; limit_ppt: number; ratio?: number; severity: MapSeverity; date_iso?: string; proposed_for_rescission: boolean };

// Source line 21
export type WaterFeature = { pwsid: string; name: string; lat: number | null; lng: number | null; population: number | null; overall_severity: MapSeverity; coverage: string; latest_sample_iso: string | null; contaminants: Record<string, Reading>; hazard_index: null | { value: number; severity: MapSeverity; exceeds: boolean; proposed_for_rescission: boolean; components: string[] }; detected_unregulated: string[] };
```

### lib/frontend/map-tools.ts

```ts
// Source line 21
export type MapResult = { id: string; name: string; severity: string; reading: string; sub: string; lat: number | null; lng: number | null };
```

### lib/frontend/mock.ts

```ts
// Source line 11
export type MockScenario = (typeof mockScenarios)[number];

// Source line 13
export interface MockApiOptions { delayMs?: number; failOnce?: boolean }
```

### lib/frontend/navigation.ts

```ts
// Source line 8
export type AppTab = typeof appTabs[number]['key'];
```

### lib/frontend/note-handoff-preview.ts

```ts
// Source line 3
export type HandoffExportKind = 'copied' | 'download-requested' | 'share-completed' | 'print-opened';

// Source line 4
export type NoteHandoffSnapshot = {
  id: string; sourceRevision: number; preparedAt: string; body: string;
  scope: { place: boolean; evidence: boolean; photo: false };
  exports?: { kind: HandoffExportKind; at: string }[];
  officialOpenedAt?: string; reportedAt?: string; reference?: string;
};
```

### lib/frontend/note-photo-preview.ts

```ts
// Source line 2
export type NotePhoto={data:string;name:'halo-observation.png';width:number;height:number;bytes:number;metadataRemoved:true;format:'image/png'};
```

### lib/frontend/scene-clock.ts

```ts
// Source line 1
export type SceneTime = 'live' | 'dawn' | 'day' | 'dusk' | 'night';

// Source line 2
export type MotionMode = 'system' | 'full' | 'reduce';

// Source line 3
export type SceneClock = { phase: Exclude<SceneTime, 'live'>; daylight: number; warmth: number; progress: number; label: string };
```

### lib/frontend/settings-preview.ts

```ts
// Source line 3
export type NotificationKind = typeof notificationKinds[number];

// Source line 4
export type AppearancePreference = 'system'|'light'|'dark';

// Source line 7
export type SettingsValues = {
  home: { year:string; water:'utility'|'well'|'spring'|'other'; tenure:'owner'|'renter'|'other' };
  notifications: Record<NotificationKind,boolean>;
  quiet: { enabled:boolean; from:string; to:string; zone:string };
  luna: { tasks:boolean; home:boolean; projects:boolean };
  language:'en'|'es';
};

// Source line 26
export type PrivateRecord = {id:string;revision:number;[key:string]:unknown};

// Source line 27
export type PrivateCollections=Record<string,{id:string;revision:number}[]>;

// Source line 35
export type ExportGroup=typeof exportGroups[number];

// Source line 60
export type AlertItem={id:string;revision:number;title:string;body:string;category:'Home'|'Your week'|'Conditions';date:string;read:boolean;dismissed:boolean;target:{tab:'home'|'plan'|'today';destination?:string;learn?:string};source?:{title:string;url:string};kind:NotificationKind|'app'};
```

### lib/frontend/source-operations-preview.ts

```ts
// Source line 3
export type OperatorRole = 'denied' | 'viewer' | 'reviewer' | 'publisher';

// Source line 4
export type SourceDecision = 'approve' | 'quarantine' | 'publish' | 'withdraw' | 'translation' | 'retry';

// Source line 5
export type SourceEvidenceState = 'measured' | 'zero' | 'non-detect' | 'missing' | 'partial' | 'invalid';

// Source line 6
export type SourceRevision = {
  id: string; count: number; geography: string; units: string; observed: string; published: string;
  retrieved: string; parser: string; content: string; requiredFields: string; evidence: SourceEvidenceState;
  failures: string[]; status: 'incoming' | 'approved' | 'quarantined' | 'published' | 'superseded' | 'withdrawn';
  reviewer: string; translation: 'not-requested' | 'pending' | 'approved';
};

// Source line 12
export type SourceRun = { id: string; state: 'complete' | 'failed'; parser: string; rejected: number; diagnostic: string; requestKey: string; attempts: number };

// Source line 13
export type SourceAudit = { requestId: string; decision: SourceDecision; target: string; reason: string; role: OperatorRole; revision: number; recordedAt: string };

// Source line 14
export type OperatorSource = {
  id: string; name: string; owner: string; organization: string; url: string; terms: string; method: string;
  cadence: string; lastSuccess: string; nextReview: string; freshness: 'current' | 'stale'; link: 'available' | 'broken';
  coverage: string; revision: number; publishedId: string | null; candidateId: string | null;
  versions: SourceRevision[]; run: SourceRun; audit: SourceAudit[];
};

// Source line 20
export type SourceOperation = { sourceId: string; sourceRevision: number; target: string; decision: SourceDecision; requestId: string; reason: string; recordedAt: string };
```

### lib/frontend/stage-api.ts

```ts
// Source line 6
export interface HistoryEntry {
  date: string; score: number | null; air: string; uv: string; pollen: string; mold: string;
  values: { aqi: number | null; uv_index: number | null; pollen: { tree: number | null; grass: number | null; weed: number | null }; mold_risk: string | null };
}

// Source line 10
export interface HistoryResponse { from: string; to: string; count: number; history: HistoryEntry[] }

// Source line 11
export interface SourceLink { label: string; url: string; retrieved: string | null }

// Source line 12
export interface LearnContent {
  topic: FactorKey; locale: string; title: string; what_it_is: string;
  why_yours: string | null; household_note: string | null; protect: string[]; sources: SourceLink[];
}

// Source line 16
export type LearnResponse = LearnContent;

// Source line 17
export interface AssistantSuggestions { suggestions: string[]; disclaimer: string; sends_household_context?: boolean }

// Source line 18
export interface AssistantResponse {
  answer: string | null; message: string | null; declined: boolean; configured: boolean | null;
  reason: 'no_source' | 'unavailable' | null; grounded: boolean; uses_household_data: boolean;
  citations: (SourceLink & { n: number })[]; disclaimer: string;
}

// Source line 23
export interface StageAlert { id: string; type: string; severity: string; title: string; message: string; fired_at: string | null; read: boolean; dismissed: boolean }

// Source line 24
export interface AlertsResponse { count: number; unread: number; alerts: StageAlert[] }

// Source line 25
export type AlertMutation = { id: string; dismissed?: boolean } | { all: true };

// Source line 26
export interface LiveStageApi extends OnboardingApi {
  loadProfile(signal?: AbortSignal): Promise<ProfileResponse>;
  getHistory(days?: number, signal?: AbortSignal): Promise<HistoryResponse>;
  getLearn(topic: FactorKey, context?: Record<string, string | number>, signal?: AbortSignal): Promise<LearnContent>;
  getAssistantSuggestions(page?: string, signal?: AbortSignal): Promise<AssistantSuggestions>;
  getAssistant(page?: string, signal?: AbortSignal): Promise<AssistantSuggestions>;
  askAssistant(question: string, page?: string, signal?: AbortSignal): Promise<AssistantResponse>;
  getAlerts(signal?: AbortSignal): Promise<AlertsResponse>;
  markAlerts(change: AlertMutation, signal?: AbortSignal): Promise<{ ok: true; updated: number }>;
}

// Source line 36
export interface StageApiOptions extends LiveApiOptions { assistantTimeoutMs?: number }
```

### lib/frontend/stage-data.ts

```ts
// Source line 6
export interface StageOverview {
  score: number | null; severity: string; partial: boolean; missingInputs: string[];
  includedInputs: string[]; asOf: string; contributions: Partial<Record<FactorKey, number | null>>;
  contributionNote: string; notice?: string;
}

// Source line 11
export interface StageData { readings: Record<FactorKey, FactorReading>; today: StageOverview; home: StageOverview }
```

### lib/frontend/storage.ts

```ts
// Source line 43
export type ReadingKind = "daily" | "home";

// Source line 44
export interface CachedReading<T> { data: T; receivedAt: string; retrievedAt: string | null }
```

### lib/frontend/types.ts

```ts
// Source line 3
export type HouseholdKey = (typeof householdKeys)[number];

// Source line 4
export type Household = Record<HouseholdKey, boolean>;

// Source line 5
export type WaterSource = "utility" | "well" | "spring" | "other";

// Source line 6
export type Severity = "good" | "moderate" | "elevated" | "high" | "severe" | "no_data";

// Source line 7
export type ErrorCode = "generic" | "timeout" | "offline" | "rate_limited" | "address_required" | "address_not_found" | "captcha_failed" | "signin_failed" | "session_changed" | "no_location" | "no_county" | "aborted" | "invalid_response" | "configuration";

// Source line 8
export interface LocationProfile {
  county?: string | null; state?: string | null; pwsid?: string | null;
  lat?: number | null; lng?: number | null;
  water_source?: string | null; home_year?: number | null;
  renter_mode?: boolean; locale?: string | null;
  onboard_request_id?: string | null;
}

// Source line 15
export interface ProfileResponse {
  onboarded?: boolean; onboarding_complete?: boolean;
  profile?: LocationProfile | null;
  household?: Partial<Household> | null; household_set?: boolean;
}

// Source line 20
export interface OnboardResponse extends LocationProfile {
  service_area_status?: "measured" | "outside_known_area" | "lookup_failed" | null;
  /** True when the stored request ID matches, or a legacy first location was confirmed. */
  recovered_after_timeout?: boolean;
}

// Source line 25
export interface ScoredContaminant {
  contaminant?: string | null; exceeds_limit?: boolean; is_enforceable?: boolean;
  risk?: number | null; value_ppt?: number | null; limit_ppt?: number | null;
}

// Source line 29
export interface HomeResponse {
  success?: boolean;
  water?: {
    status?: string | null; source_type?: string | null; pws_name?: string | null;
    is_measured?: boolean; coverage?: string | null;
    scored_contaminants?: (ScoredContaminant | null)[] | null;
    detected_unregulated?: string[] | null;
    test_plan?: unknown; [key: string]: unknown;
  } | null;
  radon?: { zone?: number | null; county?: string | null; severity?: string | null; error?: string | null; out_of_state?: boolean; [key: string]: unknown } | null;
  score?: { display_score?: number | null; severity?: string | null; [key: string]: unknown } | null;
  lead?: unknown; action_plan?: unknown[]; breakdown?: unknown[];
  retrieved_at?: string | null; assembled_at?: string | null;
}

// Source line 43
export interface DailyResponse {
  air?: { aqi?: number | null; severity?: string | null; sentence?: string | null; source?: string | null; is_measured?: boolean | null; [key: string]: unknown } | null;
  uv?: unknown; pollen?: unknown; mold?: unknown; score?: unknown;
  retrieved_at?: string | null; cached?: boolean;
}

// Source line 48
export interface OnboardingApi {
  ensureSession(): Promise<void>;
  getProfile(signal?: AbortSignal): Promise<ProfileResponse>;
  submitAddress(address: string, signal?: AbortSignal): Promise<OnboardResponse>;
  saveHousehold(household: Household, signal?: AbortSignal): Promise<unknown>;
  saveHome(home: { water_source: string; home_year: number | null }, signal?: AbortSignal): Promise<ProfileResponse>;
  /** Initial onboarding is parameterless; a replaced address bypasses the old server cache. */
  getDaily(signal?: AbortSignal, options?: { fresh?: boolean }): Promise<DailyResponse>;
  getHome(signal?: AbortSignal): Promise<HomeResponse>;
  /** Browser-local cache namespace only. It is never sent to a data route. */
  getIdentity?(): Promise<string | null>;
}

// Source line 60
export type DataResult<T> =
  | { status: "loading"; data?: T | null; error?: ErrorCode | null }
  | { status: "success"; data: T; error?: null }
  | { status: "error"; data?: T | null; error: ErrorCode }
  | { status: "empty"; data?: null; error?: null };

// Source line 65
export interface RevealRow {
  key: "utility" | "water" | "radon" | "air";
  label: string; result: string; pending: boolean; missing: boolean;
  severity?: Severity;
}
```

### lib/frontend/useHaloData.ts

```ts
// Source line 9
export type HaloDataStatus = "loading" | "error" | "empty" | "success";

// Source line 10
export interface HaloDataState<T> {
  data: T | null; status: HaloDataStatus; error: ErrorCode | null;
  retrievedAt: string | null; fromCache: boolean; refreshing: boolean;
}

// Source line 14
export interface HaloDataOptions<T> {
  loader: (signal?: AbortSignal) => Promise<T>;
  enabled?: boolean;
  /** Omit for previews. Live adapters persist only environmental readings. */
  cache?: ReadingKind;
  isEmpty?: (data: T) => boolean;
}
```

### lib/frontend/week-activity.ts

```ts
// Source line 9
export type WeekActivityCollections = Record<string, readonly unknown[]>;

// Source line 10
export type WeekActivityRoute = { tab: string; destination: string; view: string; id: string };

// Source line 11
export type WeekActivity = {
  kind: 'project' | 'volunteering' | 'routine' | 'test' | 'note' | 'outreach' | 'generic';
  label: string; subtitle: string; image?: ExplorePhotoScene; recordHref?: WeekActivityRoute;
  fields: { label: string; value: string }[]; preparation?: string; instructions?: string[];
  sourceLinks?: { title: string; url: string }[]; milestones?: { label: string; done: boolean }[];
  guide?: ProjectGuide; project?: ProjectRecord; stepIndex?: number; completed?: number;
  currentAction?: PreviewAction; missingRecord?: boolean;
};

// Source line 19
export type WeekProgressEntry = WeekActivity & { id: string; title: string; status: string };
```

### lib/frontend/week-ambience.ts

```ts
// Source line 4
export type WeekLandscape = {
  id: 'lake' | 'coast' | 'forest' | 'meadow' | 'cove';
  name: string;
  src: string;
  water: readonly (readonly [number, number])[];
  waterline: number;
};
```

### lib/frontend/week-dashboard.ts

```ts
// Source line 8
export type DashboardKind = typeof dashboardKinds[number];

// Source line 9
export type DashboardDay = {date:string; plans:number; records:number; minutes:number; unknown:number; completed:number; kinds:Partial<Record<DashboardKind,number>>};

// Source line 10
export type WeekDashboard = {days:DashboardDay[]; plans:number; records:number; minutes:number; unknown:number; completed:number; kinds:Partial<Record<DashboardKind,number>>};
```

### lib/frontend/week-evidence-preview.ts

```ts
// Source line 4
export type EvidenceScenario = 'unavailable' | 'populated' | 'sparse' | 'no-pattern' | 'changed' | 'loading' | 'error';

// Source line 5
export type ForecastScenario = 'unavailable' | 'current' | 'partial' | 'changed' | 'expired' | 'loading' | 'error';

// Source line 6
export type HistoryFactor = 'Air' | 'UV' | 'Pollen' | 'Outdoor mold';

// Source line 7
export type HistoryReading = { date:string; factor:HistoryFactor; value:number|null; unit:string; source:string; issued:string; basis:'daily maximum'|'app-time observation'; context:string; version:string; missing?:string };

// Source line 8
export type AnalysisEntry = { date:string; band:string; fine:boolean; recalled:boolean; illness:boolean; symptoms:string[] };

// Source line 53
export type ForecastPeriod={name:'Morning'|'Afternoon'|'Evening';start:string;end:string;air:number|null;uv:number|null;pollen:string|null;weather:string;tradeoff:string;version:string};
```

### lib/frontend/week-planning.ts

```ts
// Source line 4
export type ReviewChoice = 'keep' | 'move' | 'pause' | 'later';

// Source line 5
export type ReviewDecision = { id:string; key:string; revision:number; choice:ReviewChoice; date:string; selected:boolean; metaVersion:string };

// Source line 6
export type ReviewChange = { id:string; revision:number; patch:Pick<PreviewAction,'title'|'date'|'state'> };

// Source line 21
export type WeekSourceSnapshot={actionId:string;actionKey:string;collection:'tests'|'assets';recordId:string;revision:number;date:string;status:string;hasResult:boolean;title:string};

// Source line 22
export type WeekChangeEvidence={id:string;actionId:string;actionKey:string;version:string;kind:'date-changed'|'cancelled'|'report'|'routine'|'conditions'|'missing-origin';title:string;summary:string;sourceLabel:string;sourceVersion:string;sourceUrl?:string;recordCollection?:'tests'|'assets';recordId?:string;date?:string;issuedAt?:string;validUntil?:string;sample:boolean;};
```

### lib/frontend/week-preview.ts

```ts
// Source line 3
export type WeekMeta = { note: string; paused: boolean; archived: boolean; completedOn: string; time: string; duration: number; estimateSet?: boolean; zone: string; recurrence: 'none' | 'weekly' | 'after-completion'; reminder: boolean; history: string[] };
```

### lib/frontend/week-records.ts

```ts
// Source line 4
export type WeekRecord = {
  id: string; title: string; date: string; kind: 'test-plan'|'test-result'|'routine'|'project'|'activity'|'followup';
  category: 'Home'|'Projects'|'Community'; annotation: string;
  destination: 'tests'|'maintenance'|'projects'|'opportunities'|'community'|'outreach'|'observations';
  recordId: string; view: string;
};

// Source line 36
export type WeeklyReviewPreferences={enabled:boolean;weekday:number;time:string;zone:string};
```

### lib/frontend/week-timeline.ts

```ts
// Source line 8
export type TimelineItem={action:PreviewAction;start:string;end:string;overlap:boolean;gapBefore:number;continues:boolean};
```

## Appendix C. Audited frontend source fingerprints

SHA-256 of the checked-out bytes at audit time. The pinned Git commits locate backend, requirements, tests and other source. Line-ending changes can alter a byte hash without a semantic change; review that difference explicitly. These hashes do not certify deployed code or include secrets.

| Source | SHA-256 |
| --- | --- |
| app/(halo)/factors/[factor]/page.tsx | 8d109d5ae6a592c8202f754a8c0d9b3351a3fa9b3a0a1abe3a61eb551cfd3f85 |
| app/(halo)/family/page.tsx | 76ef0663bd6e92e003fc3d2c11bd24c578901bbb6b5a16e038d29814694f7c7f |
| app/(halo)/home/page.tsx | 2e96e78956f6e47bfb172c38c5c6fcd2db8490b4d2007405871439807766d9d5 |
| app/(halo)/household/[member]/page.tsx | 8c63f3aa9afcc2e2f336b9ef71d6a7cded48a84d303097aa575e7dc2d0635b98 |
| app/(halo)/layout.tsx | 46470022bdf8b5218b1f18d5c93db80c406e49caf8af95d324d932f644c80de8 |
| app/(halo)/settings/page.tsx | 1d09d398a05e1af51fb544456b17294e0e62f69cde16dc425f4904cc62a61b66 |
| app/(halo)/today/page.tsx | 1e366263a75f0f6c60c2ce81f5e2de85c8a6ba5070422af788b0a0b9fb1471a4 |
| app/OnboardingScreen.tsx | 314121d6977c30c7c2d60ea0b166dbe01bd6962f27f1974f7b14e9d6c1fa8a71 |
| app/foundation/preview/expanded/page.tsx | 40d46c69797264d3075e9eb0d1b3599386497d63a5bd568599655faf8a8b73a9 |
| app/foundation/preview/factor/[factor]/page.tsx | 7c894d71172c73c79df1be7c2880986375c47a46afb5144ed396ea3634d85696 |
| app/foundation/preview/family/page.tsx | 2d10074f402e05a3eaa3165294ee139443d9930c8a870a2847ff3f5706e13965 |
| app/foundation/preview/household/[member]/page.tsx | 72ea2e73914fd6b1ab098f279c21b1282adcc82d0b470db5dcf6af9b99141247 |
| app/foundation/preview/layout.tsx | b0de2102e65358df4b37e395b348dae60207a9a677d4542490209d07dc2b3d4a |
| app/foundation/preview/map/page.tsx | cd5174e1f111ba90b86399d271a6ff14c10259d76ced7023ec59d721f68799c5 |
| app/foundation/preview/page.tsx | 3c655cf4607503823e06b30a8bde3a2220550df60d7f4357cf4f8ec03ccc1120 |
| app/layout.tsx | dc17d36b38614a85f780e1d4a29d17deae8a054f1555c75c327a59f5a5ca7de8 |
| app/onboarding/page.tsx | 7e8850fbfa2901c92a33672eeb0719c4666fe4e00a82cdbd81d974cc8672e67e |
| app/onboarding/preview/page.tsx | a8df6c732061e43003789d1070cbc07fe543f9fb13b934075e358552b78ede96 |
| app/page.tsx | 8edfd0e294c567ab7bc9175cc42984af99c0606784eabf4bc7b708d6bf373b91 |
| components/AuthInitializer.jsx | 8fad5c3428dcd08b49fbb4707cd39d6eccdecfe533668bbe8a8cc4c6f4ccb3c3 |
| components/expanded/AccountWorkflows.tsx | 0a81ed1fcacb36d559f777807e540f8a8dd390559457a421b4b7eb73cc155db8 |
| components/expanded/AlertCenter.tsx | ac061599a760e925552cab5ae43b0f2db0f45a55d4d26c761d2998920d994134 |
| components/expanded/ExpandedConnections.tsx | c57791045faff1deb2acb75477e73dbc79fb2e08203557f7faf18303015a09dc |
| components/expanded/ExpandedLunaPreview.tsx | 5772a1a81e591697faabe593e5bbe018b74c04153dd26803423a69f70d354663 |
| components/expanded/ExpandedPreviewState.tsx | 8560308152a9cec652b7b2b0697f26a3eaf4f994975ac0a2a80f923e07f80a9f |
| components/expanded/ExploreContinuations.tsx | c7ffadb57d1fc2790d05d77e70296c8c814d2ae65754788302291b502f911f03 |
| components/expanded/ExploreDiscovery.tsx | 702e7678de50c755a698504331e9fe5d81eddb7029619f9e4a292cbe57577c2a |
| components/expanded/ExploreMapPreview.tsx | 572bb3c3056a2167128e8d4b32303093b2ca8ca4f72aa00eefa543acb79d2640 |
| components/expanded/ExploreNotes.tsx | 7f2195a8d07b3a096e0a65aba0100273440ea3d1ff40f1fb07e5372b0b4cd455 |
| components/expanded/ExploreOpportunities.tsx | c6ee146b19e3905852c1f0e68feb21f14045cb5f77c7e4ae5fc0dbf3e7f8da20 |
| components/expanded/ExploreOutcome.tsx | 413cae5206a099457a6c5f39dc77aefea146469eb120a72f98efeb7353ec09c3 |
| components/expanded/ExploreOutreach.tsx | 97645ed1c0ee869e025788904a03abbaba9b05feb00bde62f6491ce0747a6227 |
| components/expanded/ExploreProjects.tsx | 8063c6d94ed4854f45f67dbbaa77b6cedf4a99a2437f1970ca47f3b8da45a726 |
| components/expanded/ExploreShared.tsx | c01bc8a7e87d81b4c8301c7eb4cd44286444e03eb0448ab4f8f6238c4380a7cf |
| components/expanded/ExploreVisuals.tsx | fac6f18affe2f1c0619c1c9bdc50b70c7867b49bf08a482a896f1b43a59d6156 |
| components/expanded/ExploreVolunteer.tsx | 72269f08401319efd531cc05f4b9244c290ba25340d908ba3f55fecf91dd205c |
| components/expanded/ExploreWorkspace.tsx | d5301b9a08f4119dc05d3201f4d2cffabc3e8cd651d31a6e48bed7d698fb8465 |
| components/expanded/HomeOverviewWorkspace.tsx | 7b74ce76b9870a02e6c3858a5552bbe385a048425db5da23a86f4bd56b714b00 |
| components/expanded/HomepageHub.tsx | 99e1aaafcc3d2f75c13b7f14ff439db37c6deab8c69e490e59972f0f7e185267 |
| components/expanded/InterfaceMotion.tsx | 6c37fd8bb8e405cd38fbef84d6bd4965500abc10eecd20c4e23fef93d837da2c |
| components/expanded/LearnLibrary.tsx | eb0e013208a426ddd3a184a84f6a5fc65d9f93ddc76eaa641c16e5cffa3613ad |
| components/expanded/LunaActionReviewControls.tsx | 306a489b6998e1ba21423139c10e1c01b81ab823467154e5d9e15fa67fcaa04b |
| components/expanded/LunaConversation.tsx | 5ea469354d253fb1903b32a054e07a3a3ef0cee9d93bbf779fd7fa099b208ba9 |
| components/expanded/LunaLoading.tsx | aa5dd12a51987eb7aa94c0c4442969a01718be1d5fe16231860abcc285116639 |
| components/expanded/MapRecordToExplore.tsx | 946f423fb6c7090a85e3281b9d8cf5a13e6999576b8bab4d365ab0fd1dd69c34 |
| components/expanded/MyWeekWorkspace.tsx | bb3bee1621285e60e70d8c2f737f8d4b2dcbfe160f974cfeb01ebaa31455aff9 |
| components/expanded/NoteHandoff.tsx | 7b98e993daede387b4ccfd791f163fc1948fca1e5a89da862e92b2f5cf149284 |
| components/expanded/NotePhoto.tsx | 6e44e23edd32a3f0f12dfefe3eda5e988ce688962242cb5df02521fe1e8cb478 |
| components/expanded/ProjectIllustration.tsx | f7b03f408281f95f98737071dbc333588a151737500511bce37eacf6805c3834 |
| components/expanded/PublicBrowse.tsx | 414b812c5d96ad9ba2ce44440f6439fca8119254994542bd0813d99bcf0062b5 |
| components/expanded/RecoveryFlowBoundary.tsx | bfb5cff0acc48a9033f21155a944cbd697fb35b5c81259c3a5f5a2c13b315c11 |
| components/expanded/SettingsPanels.tsx | 159b51ba6d6d9b8465a5febd2cf5d10d50776def2e96673fc12b6da961d90cf8 |
| components/expanded/SettingsPrivacy.tsx | 220cf080ff3ffd9f0670348609fe242ac525fd6f940ffa8625cd0faf2ea67669 |
| components/expanded/SettingsWorkspace.tsx | df4117634bd7f824c03127b86f2d9ffe411c552ff2397576bb57743eaac7b79f |
| components/expanded/SourceOperationsReview.tsx | 2d41915a906a027acd45d13cbb22498e6f8b0ef1996c4ac26a7d6165a14f19c8 |
| components/expanded/WeekActivityDetails.tsx | 1cca4cdf19ab27de388113860ab16f52a89e3180ee3c7c63291e452dabc3d053 |
| components/expanded/WeekAmbience.tsx | 08cf8bcb72408edc6b215c0a2e8ff38d7fe568bc8e4a9f1f865b20d36ef2a76f |
| components/expanded/WeekConnectedExamples.tsx | 035bd701f64585772c49b7b08ca7332dbf1848851d0cbd322cdd5b65601bc1b0 |
| components/expanded/WeekDashboardOverview.tsx | 484141602d71c9a154f9ed8d8ea9df5bd8840233ee648131b74db701fd50a0eb |
| components/expanded/WeekDashboardSummary.tsx | 22c09c2c770f55327541f7bcd6707a37e4b3bdee36b04aa0658124394e25d9be |
| components/expanded/WeekEvidence.tsx | 2f13dcf8ed28fbcf6c3dad3eeee4b05fb8f239a85acc72ddae422d5b6614165f |
| components/expanded/WeekJournal.tsx | ac4c97ef8ecb8fcd2357648d5c878f05b44a02ad6ff095a30d1dc90d5e4a466d |
| components/expanded/WeekOutdoors.tsx | c2341f144c692237719b330ea961bd2e1bed41f2a75e12c6453301371c42139f |
| components/expanded/WeekPlanningRail.tsx | fa25598a42f98ab5f3b30ac7e554053fef2fbb0e4ae9fb441ef3787cd005de1c |
| components/expanded/WeekProgress.tsx | 0c7664ba35a2673be60371960735f8c3087e1e69189d568c2288aa32d7c3c948 |
| components/expanded/WeekReviewPlanner.tsx | 1a68fccfb560fde1733e948f5254b214b8782c5be6a5d6f26a22b3c51041e416 |
| components/expanded/WeekScene.tsx | 1bd70d38a1a066da34cb0314d47710fb2431c8f62404e580174854c9d986ba8b |
| components/expanded/WeekTimeline.tsx | 23e7b318cda9fbbf898779747166194cd3bcee667cefe2c4c97844a61af72f23 |
| components/expanded/WeekUpdates.tsx | 91e237619f77a2c2f8cb52e800076700492dd9a2517fa22d082d35103bd91994 |
| components/expanded/WorkspaceFeedback.tsx | ca9886c73d080aaa3f2165b7eb10014f43b5206dff8245a67203d439bc874ad2 |
| components/foundation/EditorialScene.tsx | 2ed6f7226a3178517be94bdf558841477367e86f8109b560c3ea4e1a3db749ae |
| components/foundation/EnvironmentalScene.tsx | b07654a20723299d5c9c17fc8c9c6ba3806791df23429dc5a3771940a33357fa |
| components/foundation/FactorReadingGuide.tsx | cbf4319e3c021a719ad7f84b125f225ced06146688a22e2ef9731a61c66d4f65 |
| components/foundation/FactorScoreCard.tsx | cfb64e146db86bc54d8bfe7d77232076b9484cccd192521660e56c155932468d |
| components/foundation/FactorSteps.tsx | a586a238f0c0a5fde9560c1f4be895ec92e7a3ec21f68780d869cdc03de2f3e2 |
| components/foundation/FactorTrend.tsx | 134b1946ee0d2ef4671e0d56908a47912800ba953ac8ac6c534c44459af4c18e |
| components/foundation/FamilyGuidance.tsx | 4eeab0c1102d475f99ef3f4f5b9e79d9827f75121c8b25a03ea4611ed961890f |
| components/foundation/FoundationPreview.tsx | 291d6c94903be840b4ae10e8f5055549a59d3924f9d2bdfdc597f59d8b188851 |
| components/foundation/HomeHousehold.tsx | f2501167bc5c1ff869fd5916f52c8f3a63582adac0486cc592fd5f909ac099bc |
| components/foundation/LunaAssistant.tsx | e1e2c185d79cb2f640ce11ba01fc1e6087caa1c1f25af9fb3aa45e48e6e4b46d |
| components/foundation/LunaMark.tsx | 6315e469419d46c2307663a6eb621a2692e2b809c1cbee26860cbdfd62dac6fe |
| components/foundation/PersonalHero.tsx | 0f6f903b1648c8fba6efa655188fc51b47e542c7bbeb59ef6b77a51f3ea622c7 |
| components/foundation/PreviewHousehold.tsx | 6e39cd9e30e6aad19a3815531a845aac7e1bdac4ef7a54b9571615fef8d36d39 |
| components/foundation/PreviewSectionLink.tsx | eb16b8e648a118e617f719132a9f6af0c3670b0117e751fe2c5df07036b5d74d |
| components/foundation/RisingSun.tsx | 6ade2478584f0c224a3e0f481da355e7007e14cd7d08b0be12d1247a92d1bf32 |
| components/foundation/SceneExperience.tsx | c1e8214fe0be68b6bca77202e991e705d4a3b185a4ae3b16cccb0999578e0059 |
| components/foundation/SegmentedScore.tsx | 409399b953d7c2d85e0aa80482df3e5d7602b32bfca369722f6df83e37affcad |
| components/foundation/StageRuntime.tsx | dfd12311f983c49bdb75b92927ffd8e29f0dfb8267d0b12f1afa7fca73002d98 |
| components/homeguard/FoodEvidence.tsx | 4e21367227730aca7a35e4504032387e4ac7c0989f1a5a7f39df1b0ad1cb509b |
| components/homeguard/FoodExtent.tsx | b3e8b293312f30e11429dd461b9b69764b9e2b80e88f7a21c267973cafdd199c |
| components/homeguard/FoodFish.tsx | 5f8e70250886c4e1a44b18ab2bfd49cadb7f97efc347d38ee514cbae45f134a5 |
| components/homeguard/FoodGarden.tsx | 63984c2442ef192fadea9743657bd84dbc18a0d83dc7252bf3fd4fcdd0fa5582 |
| components/homeguard/FoodGardenWorkspace.tsx | 684c7889f749d5ffac0767b7ffe55d5b7990e5eb664f679f4bd77ff13b55c125 |
| components/homeguard/FoodGrower.tsx | f231d1d34e6e4e7be919b6435fb4db1fc971515de7420a406f3d589727306924 |
| components/homeguard/FoodPantry.tsx | 4fe5ad95d3b8cf76280f7f4b4e8929c994db1200a4dfcf097bc09e2fd6a0b128 |
| components/homeguard/FoodShared.tsx | ee898bedf3c2b9c4c6fa3f54a02da512e556c7d4bc557355379e4dcffc4e8d5c |
| components/homeguard/FoodVisuals.tsx | a1b63f636c74b16aa85a0508c0b7a8a089bab3ad6319543675965ce191387f1c |
| components/homeguard/FoodWater.tsx | 774f67334010645642e10bfad74aa46a76359db43b175a003db3de19eec69770 |
| components/homeguard/HomeWorkspaceScene.tsx | 207ed620974765de37d9293c95d3b2bd444c4325419ef0f47695a809093d4e58 |
| components/homeguard/HomeWorkspaceState.tsx | d13b54611a5a6492ce70d66734e45f9f8ea6f4c8421af81ed531e44b570af2bc |
| components/homeguard/HomeWorkspaceUI.tsx | 25fd414a6bb377de3e9b40aa48ba2e0025df38c3ee144a175683d0a6d118596c |
| components/homeguard/HomeguardWorkspace.tsx | 495b912c9ba1f7c7293b58a66247c97bea7f246a424c04a2e101dc2171e2617b |
| components/homeguard/MaintenanceWorkspace.tsx | d9b5a5476df7beb145b2fa7bdbcc5f9707635fb98676ab82611c052ec97b2a49 |
| components/homeguard/PublishedFoodEvidence.tsx | 59023d15a12858bbf4b169e3449cb86d80fe45514f409c64672061a8a61cd7a9 |
| components/homeguard/SummaryReport.tsx | 78b2f9efc7eaab0e04144447d225545748133a0b8106a44c7e180fa16b128ba2 |
| components/homeguard/SummaryWorkspace.tsx | 77c136c1e3a7a54aec976d852937b016a6dad90d7609cbd80f2d9df0069b74d3 |
| components/homeguard/TestProgress.tsx | 3dc7fe76be8f0f589f13b4d597d1e4122a503bb71f3d91afc12d34df5a586e1c |
| components/homeguard/TestsWorkspace.tsx | 274f341a07b65ad60232dc2120856134b124e4faf436a8fb4989af5d4da460a2 |
| components/homeguard/WorkspaceArtwork.tsx | 31899503cff5419a337f730fb40477a12291659646bd1b2a5e8457e8813da974 |
| components/map-preview/DistrictPanel.tsx | d6cee836dc31a228a61c3de5a700de84fe4562b9b9fafecd184cf313a7cd6c18 |
| components/map-preview/MapCanvas.tsx | 918c62ba5af8c541b3421603c4334d9b1a258ea2e397df52fc4c2421bf99006f |
| components/map-preview/MapComparison.tsx | d516fdede41795557ea5ac3bb916546c063954119f746b727e604dd8381d32f8 |
| components/map-preview/MapInsights.tsx | a1f2556c4d8573c3811a2a411e0ec560b4d4ff56a381320a489beba3c93973b0 |
| components/map-preview/MapPreview.tsx | 143bab0a8303f1bf05c7392ddda2d3f763cbd7e772dc898eb80d9caf01a18237 |
| components/map-preview/MapPublicBrief.tsx | 626742285f27de9f58122f286ed9677f68cf19d31b87d89958310b457a2d9a2f |
| components/map-preview/MapResults.tsx | dadcb95d55e6185eb342509562b831a58a188fb3872ad50d3de961b9dcd0c500 |
| components/map-preview/MapSymbol.tsx | 3676f4e26ceb9ee996413bf10f14a1f370b0ae48b8d842cffe141d1ec7700907 |
| components/map-preview/MapSystemFollow.tsx | b6b1946a9fef41ebec795aa005d36c95a0a326920b9de7aa9faa4c3f5bcffbfd |
| components/onboarding/Preview.tsx | f92293aa4b4347447d6ae146ad4b1aafe04eb45452edfe877606c87fb96a60b8 |
| components/onboarding/ProfileRecheck.tsx | 635bb90c235b2e5624312e75610111bebc9349c6967cea64016faf4cbe9281b2 |
| components/onboarding/ResultsReveal.tsx | 6cc3cc3c410a458f8106f11387c64899ce9b51eb40b19fd0fdfa04b45f730985 |
| components/onboarding/WelcomeTitle.tsx | 5b782ade3ecc8ad047929ee403320be8627f4ec6ed00238619ef3779f44fa35b |
| components/stage/HomeEvidence.tsx | 5eb8000d279ffd9e7379253b3bd1ac4d88aff9c75f9c71b59f6f0ba39d12135c |
| components/stage/StageApp.tsx | 500fe1f6d515fe40f5e54b321afb3b25fb096b97f97da2a0bae938bb41495559 |
| components/stage/StageSession.tsx | a636d2a450c8d378084c5a8b744cdf272f8d0bbcdf7619b8f9f244cf8826acea |
| components/stage/StageSettings.tsx | 02632da5cbcba3f9d4e6cf011fb857e73ce148f56ce4d91e19bad456a2941e66 |
| components/ui/AppNavigation.tsx | aadede3c4fcc32a5b2cb2b2beec50e6b86dce2d73d54696abf57e395a92fc18b |
| components/ui/Button.tsx | ad5c5c7ff9e0a0216b33d26a1a9eb167d3190d46bef59b949c329f59a85674a3 |
| components/ui/DataState.tsx | 1ec93464ea90855213e3908f5bd3c12c5b685c1e7bc06df38d0c0100dedf7850 |
| components/ui/DateInput.tsx | 51dfb40fdcda591aeeb67cbfc4524edbfbb81c7694e635e0ab392af1f7b98506 |
| components/ui/ErrorCallout.tsx | 49cff0d73a9aa85ae5932078c3282d157dfbee4942c42506b82d69667d085af0 |
| components/ui/FieldError.tsx | b641d917f612d90aced65d58881cbac245dd4706171ce0c985094e6e16e9635f |
| components/ui/Foundation.tsx | 5bf4771cccf7680eae210923ce877aab3305a8760a00df872f7c78b7bfd2121d |
| components/ui/SeverityPill.tsx | 4cb27bd3385c8fd25ffe7647c882f16bfc5503970c05acf19139598912d7601c |
| lib/frontend/account-review.ts | 3c11ec22b44dffd40fa62d42e41a1fba0491c4fb3f312b0d9cc7a86863debd2c |
| lib/frontend/api.ts | 3b6e4163e929593ace9118053a9f0ede59a7c5ba431df1dd3b18e1a6392fb2a0 |
| lib/frontend/copy.ts | 4ee2dbdaf5ee8325ee12c1afdf290b87b2d1af90daa8b8ac174e019ed3bbf502 |
| lib/frontend/date-input.ts | 3989d5dcc81b43ec5885e5c69db770b3a5c7b75a2a329aad3f068c6ebf2340f0 |
| lib/frontend/expanded-preview.ts | cdb4e0d9ebaf08f31f775670dabcd5284dd9a84f725bdb4430516e0b3b1911d1 |
| lib/frontend/explore-local-resources.ts | 49fcdebbf18c3c7e1581ef5bb4da38ed81dc9552e3d1b7ab5a03e416317e58bd |
| lib/frontend/explore-opportunities.ts | 964353f3cc992be1f0c0655bfefca19a991e23783bf2b48bf430492bcb1b490f |
| lib/frontend/explore-personalization.ts | 8e29f1a0b1e10e456d1c87ce7274bb1a942c51e7a33bb111f81a593072d8d7da |
| lib/frontend/explore-photos.ts | 2034aca0052ceec9db566d2cf8da1797227d64c8e714c2add77f1bb6413fe9b9 |
| lib/frontend/explore-preview.ts | cc1519fdf103d1fc2e2b654d3b25824f5a3eba1f10bc41e5c039ff424a89c7dd |
| lib/frontend/explore-project-guides.ts | 43eebe3522186c2e5477674bceb215375ccb014305926362b1a433bd72ecaafc |
| lib/frontend/explore-workspace.ts | ce3cbbfafbb9d94122d504107e5ae0b3cea767c4429b1ce69d3bfe6f2ec54469 |
| lib/frontend/factor-preview.ts | 1d7d7c0120d325a824e6fc89d5177af0ca8fe0fb0b61d528e146881489c1b391 |
| lib/frontend/food-catalogue.ts | e27c91dc4ed2eb8022d5c1e9947ba20f7a9565337199e07bf3f905e29b202134 |
| lib/frontend/food-evidence.ts | 7c0b26146bade84dc020ee7ce07c9fb57222dd4c6fce59823601c849ff7f3415 |
| lib/frontend/food-pfas-guide.ts | b920d0d5b34b97e9e30de0e23b5e0d913a22545ed7fdfe758c6dea0da4de9b71 |
| lib/frontend/foundation-preview.ts | 1950b65fc2866db154be24bd89468b53e59925dec06d6c0ed390644c6a1e0ace |
| lib/frontend/home-food-preview.ts | 63a12dc7ce264001e30a249ab05f8f2cd4ede58c6ab6e46e6cdfe55154542050 |
| lib/frontend/home-household.ts | 3ebd45fa95e23f047d9725f189929d047353971447dd7fc447f19fdfc92fc230 |
| lib/frontend/home-maintenance-preview.ts | c005daf9476c52f5741d8dd426dda7e3aa24d7d8437450953efaebb7af47e59a |
| lib/frontend/home-test-preview.ts | 6f11b3cd7aedfbafcf254cc6b60b35ad492610870a3aafffe4d86c00484131e5 |
| lib/frontend/homepage-preview.ts | 17f20d6ea94fb9f3d455710c3fac101dc8735d13d8c9383eab6b3937329758cb |
| lib/frontend/household-pdf.ts | 3cd81eed58b271942fd4f1305e571c9c36ea3a2f50a88d0ce49239ac6907e937 |
| lib/frontend/luna-task-actions.ts | 5b848693bd0f8cf6bbc996e10308f04520b0669ceb296c7b48caa1c2714c4865 |
| lib/frontend/luna-tools-preview.ts | 06e337db3607af1649139702fc5b809835b9d5deb55cb2d0c883a99b62258a9b |
| lib/frontend/luna-week-plan.ts | 716186cf4f39c9f98d1e8cef810d7108a6277e759d16f0ee6375fcd53d07341a |
| lib/frontend/map-comparison-preview.ts | c15bfddd5aaac4f8a140ecd01588959a1cc067e69f2d44e4b7c71a04cb030789 |
| lib/frontend/map-district-preview.ts | cbd5554b24760becf6589771c4cfb735691963618252d77b0f8285e81f9f2386 |
| lib/frontend/map-preview.ts | 4f69279494ab48e54436d09f79a04f7752f8be5f5ba97e7a919d825ebdd0b29e |
| lib/frontend/map-public-brief.ts | 4967c9796cac2d6771ff40e8e21e4f1c3d3c5b710a4bb4132fe8466c799b92b7 |
| lib/frontend/map-radon-fixture.ts | a1615aa0d01bb0693c2002807cf23870992e20600a46871a71b334985886f6cf |
| lib/frontend/map-symbols.ts | 70f86fe816c301e5122e5af8735e93d02f21bb3579a18550b62bb7763f984f7e |
| lib/frontend/map-tools.ts | ab4f4acb079dbd5bed3e74de5233a1579d731ec67fd101c15708422fa448a918 |
| lib/frontend/map-visuals.ts | 7670f883d76f71cb1855a20c59dd4cde430c2be6a905934eb912437ddc3fb7d4 |
| lib/frontend/mock.ts | e6b10a7711ce109307e99a61997ed0cb7f69d003e1cc88d069607ffdeb3d5ae2 |
| lib/frontend/navigation.ts | 0f960d6958eb8ee419e0b7800cbeeacd72af4f32105579104716c4704af1898a |
| lib/frontend/note-handoff-preview.ts | 9fd59c3a3b381c5c49371088333f52ecfb67fb94ec442929956422fe7bc3f195 |
| lib/frontend/note-photo-preview.ts | 2794a7dc02436e00584484a5f5c64e72824955ec29229e30f98d1d977316aed6 |
| lib/frontend/onboarding.ts | 2c9537c6d10e2bec7bb34318a687857370abb682c461928d7457c69d1cd11864 |
| lib/frontend/overview-preview.ts | 58b11f663dcc452cefec5d41539500130daa9e5a76d942e81b7ba862dde737e1 |
| lib/frontend/scene-clock.ts | 86dfeae3fa8ec226baf82795ba82ac71d55b9376a2bf45b8dd07470ca192a297 |
| lib/frontend/settings-preview.ts | e6b0c09f3d00409f6e0635d0105f4fdba57a2bc571fbf8145ab8b8b16daed854 |
| lib/frontend/source-operations-preview.ts | 02dde46495d799191e11148a438b705bc147fa6e7dd4c663c25c73272e8dac3b |
| lib/frontend/stage-api.ts | ee076b531391d47b3de9e5f99e605ce3d5312205268a9bab1fda1fe1c467a288 |
| lib/frontend/stage-data.ts | 4cfa8c66e9266e6b2eae5bade572b9996c3c7a391c3e77bcb559d9b293f4ac6c |
| lib/frontend/stage-routing.ts | 06fd0e3de818f4c4687ae1522368212bfad149d5bb5d93def0841222974bb03a |
| lib/frontend/stage-values.ts | 404c8964a82bc1c996ff9614d832cf34d7694ac13a8c6047de4097284032a84c |
| lib/frontend/storage.ts | 5f382a683471f5f039d55939827ae769deb6d4344e4f4a6a08d152f4ac6ea6c9 |
| lib/frontend/types.ts | 428c6ee64232a3dbabbe072e64f15a097102d6260ad53478ea5eff45dfa1ff71 |
| lib/frontend/useHaloData.ts | 9a9f1790f2027a3c73fb7b52c0ddde9641e620179dd89b71b06afad4d9bf8723 |
| lib/frontend/week-activity.ts | c0719949bab99f86477f79927dd8ec8431a85ffbf67da76cb7a29a135899de48 |
| lib/frontend/week-ambience.ts | f518d29a881ba4aaf5dc04eff476e7324b17d5945ee17d50b9f0321ec705f768 |
| lib/frontend/week-dashboard.ts | 3ba3092546c89905e6780b5a57cfd51667e2d42523fddd28f4a22ef1543821a1 |
| lib/frontend/week-evidence-preview.ts | aa063a66bff93ef9e83dd85e8a494eee97f3c162d020b0ba4b42f5a177c12511 |
| lib/frontend/week-planning.ts | 237fffe4cfd04cd6cc9c29e826f216be910440d9ba06b1d31759b520f18489e9 |
| lib/frontend/week-preview.ts | 39d5134a64ce9cc9db5574ec2bd6c8fe38b96eae2bdc69b6db5b76be89fb102a |
| lib/frontend/week-records.ts | 821288c0eacc8e0cbbc796aed95150cdbf68370fe2941ccfbdb09730b849b513 |
| lib/frontend/week-timeline.ts | 4206787c5ef73cbae896587263bf065bff70c205c8ec89c92b89f9c0e2d8d7b6 |
