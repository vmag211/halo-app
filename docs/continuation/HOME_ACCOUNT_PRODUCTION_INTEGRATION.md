# Homeguard, private files, summaries and account integration

October 13, 2026. This is an implementation companion to `docs/product/HALO_COMPLETE_BACKEND_HANDOFF.md`, not a replacement for its full-app feature specification. It documents the production frontend contracts now consumed by the reviewed screens. No backend routes, databases, provider accounts, emails or real notifications were created by this frontend work.

## Separation and ownership

`HomeWorkspaceProvider` receives an explicit `HomeWorkspaceService` in the production app. Without it, the isolated review uses its existing examples. Production never seeds those examples on empty, partial, failed or malformed responses. Identity plus home context and context revision form an immutable service scope. Changing that scope remounts private collections and drafts before displaying the new context.

The runtime in `lib/frontend/production/runtime.ts` supplies credentials, current context, cancellation, origin restrictions and idempotency headers. Server authorization must independently establish the owner, household and every referenced resource. Client labels, collection names, IDs, timestamps and context headers are inputs, not authority. Current-source information must be invalidated on a home change; historical tests, sites, observations, source snapshots and exports keep their original contexts.

Canonical row revisions are positive integers assigned by the backend. The frontend does not optimistically increment them or announce completion before accepting a receipt. Drafts remain in scoped memory until confirmed save. A draft is not an offline write queue and is not an operation ledger.

## Owned collections

Type sources: `production/home-service.ts`, `production/home-records.ts`, the original domain modules and the complete handoff's type appendix.

The provider preloads all 16 collections:

| Collection | Required behavior and relationships |
| --- | --- |
| `tests` | Planned/arranged/collected/awaiting/recorded/follow-up state; original medium, context and context snapshot; provider, dates, methods and sample label; result rows with original strings, qualifiers, limits, units, basis and report reference; transcription review; immutable correction history; archive/restore; private attachment references. Numeric zero and non-detect are distinct. No automatic score modification. |
| `assets` | Equipment identity, instructions and linked test; manufacturer/user/reviewed schedule basis; calendar/completion recurrence, interval/unit, anchor/end/next dates, snooze and last completion; active/paused/replaced state and occurrence history. Backend validates/recomputes canonical schedule changes and future reminder intents. |
| `observations` | Original observation instant and timezone, room, kind, optional measurement/unit/source and note; independent asset/test references; processed private photo reference. Recording dampness is not detecting mold or diagnosing a person. |
| `gardens` | Site setup, original home/county, irrigation and soil context, household-source confirmation, linked tests, concerns/questions and revisioned context history. |
| `usage` | Meter or measured interval, dates, site/account label, original quantity/unit/source/basis, reset flag, private note and correction history. Preserve incompatible units/sources and missing intervals; do not invent savings. |
| `pantryItems` | Food/guide identity, storage and origin, guide revision, question, created/updated instants and home context. A food name is not an item-specific contaminant measurement. |
| `foodQuestions` | Source evidence ID, question, private context and optional owned test/report reference. Saving does not contact the source. |
| `fishNotes` | Catch or consumption entry, date/zone, species and waterbody, original quantity/unit, note and the exact advisory/version referenced at entry. Historical corrections remain available. No inferred dose or remaining meal allowance. |
| `foodFollows` | Source kind/ID/revision and independent saved/following flags. Delivery is a separate backend service. |
| `growerInquiries` | Exact resource and optional site/test references, questions/checklist, contact/follow-up dates, user-reported contact state, reference and response. External link opening alone is not a submission. |
| `homeTransitions` | Historical old/new context facts and explicitly portable task links. Actual home changes use the account transaction below, not arbitrary client row edits. |
| `exploreNotes` | Observation/question/idea/conversation, instant/zone/place, private description/reference, source evidence snapshots, status, pin/archive and reviewed handoff history. Processed private photo references only in production. |
| `exploreOutcomes` | Goal, result, reference, next step, status and dated history, independently linked to its originating case. |
| `exploreProjects` | Project state/outcome/review date and stable-step notes; immutable `guideId`, `guideVersion`, full validated generated guide and history. Never substitute a static example guide for a generated project. |
| `exploreEngagements` | Organizer/opportunity source and preparation, place/date, official URL, user-reported participation status/hours/outcome/reference, follow-up and history. A saved intention is not registration or verified attendance. |
| `weekJournal` | Dated household band, symptoms or explicitly feeling fine, severity, illness/recall context and private note. No symptom-based streak incentives. |

`GET /api/frontend/workspace?collection=...` returns `HomeCollectionSnapshot`: `records`, collection `revision`, availability, `complete`, optional cursor/message, and **`pendingOperations` even when empty**. Although the compatibility type marks this field optional, production rejects a response without the array. Rows must pass the collection's nested structural schema. Required arrays cannot be omitted or set to null. Return legitimate empty arrays, not invented default record content.

The current UI reads a complete bounded collection in one request. If the backend internally paginates, aggregate the authorized collection for this adapter or extend the frontend with an explicit paginated browser. Returning `complete:false` displays a partial-data notice and prevents treating the result as a full summary/deletion inventory. Do not silently claim completeness.

`POST /api/frontend/workspace/commands` receives:

- `write`: collection, complete proposed record, expected record revision or `null` for creation, collection revision and operation ID.
- `remove`: exact collection/record ID and reviewed expected revision, collection revision and operation ID.
- `remove-notes`: exact selected note IDs/revisions, one operation ID, one atomic owned transaction. Its case/history is removed; separately saved tasks or outreach snapshots remain unless explicitly included in another review.
- Legacy `clear-private` exists at the provider boundary; production privacy screens instead use the account-wide reviewed privacy service. Never execute a client callback as cross-store deletion authority.

Success returns a matching operation ID, `status:'succeeded'`, complete canonical replacements for every changed collection and optional collection revisions. Create/update must contain the requested record with an advancing revision; delete must contain the changed collection without that exact record. Resolve linked record changes atomically. The server must reject stale revisions, unauthorized references, invalid relationships and reused idempotency keys with different payloads.

Pending/unknown results do not update saved collections. They block further owned writes and expose status checks, including inside destructive confirmation dialogs. `GET /api/operations?domain=workspace&operationId=...` reconciles the original operation. Initial collection reads must restore unresolved operations after refresh or another device's write. Terminal operations cannot reappear because of stale reads. Definite failure retains the draft; uncertain transport outcomes must never be classified as definite failure merely to allow another mutation.

## Private files and processed photos

`HomeAttachmentService` defines multipart upload, metadata inspection, private Blob download, exact-revision removal and upload reconciliation. Runtime operation names and URL routes are in the operation registry.

Uploads include collection, stable record ID, file bytes, reviewed name, metadata-removal assertion, review consent and idempotent operation ID. Original laboratory reports may be PNG/JPEG/PDF up to the UI's 10 MiB limit; they can retain document metadata after explicit private-storage review. Observation and Explore-note photos are locally decoded/re-encoded as PNG, visually reviewed and require `metadataRemoved:true`. Inline originals/data URLs must not be persisted into production record reads. Server code must independently inspect MIME signatures, dimensions/size, malware/quarantine outcome, owner, collection and metadata policy. Never rely only on filename or the client assertion.

The upload result is an attachment ID/revision with `quarantined`, `ready` or `rejected` status. Only a ready processed photo reference can be attached to a saved observation/note. A quarantined upload is re-inspected, not reuploaded. A lost upload response is reconciled with its original operation ID. Global pending state prevents abandoning an unknown upload and blindly creating another one.

New note/observation photos may upload before the first record save. The backend must support an owner-scoped staging slot for that stable client record ID, finalize ownership/linkage only with the acknowledged record write, and expire unlinked abandoned staging objects. An upload alone must not publish or fabricate a record. The complete handoff's private-file retention/deletion policies still apply.

Private downloads require owner authorization and exact attachment revision; browser object URLs are short-lived and revoked. Photos have a separate export review warning that visible faces/places may remain after metadata removal. Original files are not silently included in summaries, emails, AI context or source queries. Removal has its own captured file revision and durable operation ID and is reconciled in the `attachments` domain. Removing a report preserves its separately entered test results.

For reload recovery, attachment operations in the workspace `pendingOperations` array must resolve through the same operation ledger. Upload status may include `attachment`; when the generic workspace reconciliation endpoint handles the same operation, include canonical `changes` (possibly empty for an unlinked staged upload). After completion, refreshed collections expose all finalized references. Do not return a successful attachment removal without canonical changes.

## Food, fish, growers and water evidence

`readResource(resource,query)` resolves only registered server operations. The `resource` discriminator distinguishes a food notice list from the published-food-evidence bundle even if they share `/api/food/search`.

| Resource | Required content |
| --- | --- |
| `fish-catalogue` | Waterbody/species/audience catalogue and applicable advisory records with jurisdiction, version/date, source URL, conditions, wording and limits. Scope and overlapping statewide/local advice remain explicit. |
| `food-evidence` | Dated notices/studies with named product/place/sample scope, source identity, evidence status, lifecycle and applicability limits. |
| `published-food-evidence` | Source-backed study bundle, sample context, documented results with original units and limits, and explicit uncertainty. Never populate an individual household food concentration from a research average. |
| `grower-resources` | Official laboratory/extension/grower resources, geographic coverage, eligibility, services, cost/process information, source version/date and HTTPS contact link. |
| `water-stewardship` | Dated regional drought releases and utility notices with jurisdiction, exact source links and qualified applicability. Regional classification is not an individual home measurement. |

Source failures show load/retry states without example fallback. A production fish rule marked `statewide` must supply explicit `waterbodyIds` from the current catalogue; a species label and the word statewide are not sufficient to apply advice across jurisdiction boundaries. The catalogue may include its own verified `sourceUrl` for unresolved/no-match guidance. The frontend never substitutes the North Carolina review link for another user's missing source. Unverified illustrative extent diagrams are not used as production geospatial authority. Public resources never receive private free text or file contents by default. Food topic ordering uses the canonical action preference namespace `food-interests`, with explicit Save/Cancel and server rehydration.

## Immutable household summary

`production/summary-service.ts` defines the archive, frozen report, selection and exact source manifest. `summary.list` returns archives, completeness and unresolved operation IDs. `summary.prepare` accepts the explicitly selected sections/privacy options/date range plus selected owned IDs/revisions, collection revisions and current home ID. Server code revalidates ownership and versions, assembles the allowed source context and atomically saves an immutable snapshot. A changed source cannot be silently substituted after review.

Success includes the saved snapshot: title, created instant, context, report sections, selections, omitted fields and source manifest (`kind`, `id`, `revision`, `asOf`). `summary.read` returns that exact saved snapshot. Later edits to tests or current environmental data do not rewrite an old report. Unknown preparation reconciles in the `summary` operation domain rather than producing duplicate archives.

PDF layout, accessible text, image and print/share files are built on the device from the acknowledged frozen snapshot. A local PDF rendering failure can be retried without another archive creation. Browser download/share success is distinct from backend archive creation and is not evidence that another person received the report. No public share URL is created. Original attachment bytes, hidden metadata, health categories, exact place labels or private text stay out unless the reviewed export contract explicitly permits them; current household summary includes attachment references only.

## Account/location/device/provider workflows

`production/account-service.ts` and `useAccountService` provide feature-scoped canonical snapshots. `GET /api/account?feature=home|recovery|device|email|calendar` returns exact feature identity, revision, enabled/reason, **unresolvedOperations** and its typed feature state. `POST /api/account/commands` receives feature/action/payload, reviewed revision and operation ID with `If-Match`. Every success returns the matching complete feature snapshot. Unknown status is checked through the `account` operation domain. Browser timers do not verify anything.

- **Home:** resolve a typed city/ZIP into real candidates; prepare exact candidate plus selected portable task IDs/revisions; return expiring owner/context-bound review token and consequences; confirm the token atomically. Candidates, utility match, timezone and precision are server facts. Historical records are not relabeled. Successful direct or reconciled home changes refresh the profile and remount the new context.
- **Recovery enrollment:** request a verification message, check its challenge, cancel, remove a verified method with review, list real devices and revoke a selected noncurrent device with captured revision. A request receipt can be pending, never automatically verified. Provider delivery and expiry are backend facts. Use enumeration-resistant messages and rate limits.
- **Device notifications:** explicit user click requests browser permission, installs `public/halo-notifications-sw.js`, obtains PushManager subscription using the server VAPID public key, then submits it for backend registration. Permission alone is not subscription/delivery. The UI displays registered only after canonical active registration. Disable requests server revocation before local unsubscribe. Account/device binding, endpoint encryption/rotation, unsubscribe cleanup, delivery policy, quiet hours and expiry handling remain backend responsibilities. The worker shows generic HALO text and allows only same-origin app destinations, not private alert content.
- **Gmail/calendar connections:** request an authorization handoff, open an explicit HTTPS Google OAuth link, check the server-controlled connection result, cancel authorization or disconnect with reviewed revision. The frontend allowlists the Google authorization host/path; server code must still enforce OAuth state/PKCE, exact redirect URI, owner binding, least privileges, expiry, token encryption/rotation and revocation. Merely opening the provider page is not connection success. Settings does not send mail or create an event. Every later email/calendar action needs its own reviewed operation contract.

## Public restore-access challenge

`ProductionRestoreAccessFlow` is reachable from public Learn without fetching private records or creating an anonymous session on mount. It imports the existing auth client only after an explicit recovery action.

1. `POST recovery.request` receives the entered address, operation ID and a high-entropy `clientNonce` kept only in page memory. Reply generically whether the account exists. Send verification only through the backend.
2. Verification may happen on another device. The backend binds the delivered one-time verification proof to the requested challenge and original nonce without merging accounts or returning credentials to an unrelated browser. The original browser calls **POST** `recovery.status` with challenge, nonce and original request operation ID. The nonce is never placed in URL/query/log storage. Same-browser email-link callback verification must also be server-authorized, not inferred from navigation.
3. A verified challenge returns a short-lived restore proof, not an automatic account switch. The user explicitly confirms switching this browser to the recovered account. Existing account records remain separate. Conflicts/collisions require review, never automatic merge.
4. `POST recovery.complete` consumes the exact challenge/proof/nonce, explicit account-switch flag and idempotent operation ID. Return verified session material only over the authenticated recovery channel. The frontend verifies the returned access token's user via the auth provider before installing the session and opening My Week. It checks that the current browser identity did not change while awaiting the request.
5. A lost completion result is checked with the same operation, never repeated with a fresh identity or proof. Expiry/revocation/rate limiting must be enforced server-side. Losing the page also loses the nonce; restarting requires verification again. Credentials and proof are not saved in notes, drafts, models, URLs or console output. Session persistence is delegated only to the existing auth client.

## Verification and release acceptance

### Protected source operations (X07)

The standalone `/operations` frontend reuses the existing operator comparison/review visual language. It is deliberately absent from consumer navigation and does not request household collections, start anonymous sessions, embed a service-role key or grant a role from browser input. An existing auth session is required; the backend still checks independently whether that identity is an operator on every read and transaction. The initial session check is bounded to eight seconds with explicit Retry; a late response cannot mount a timed-out identity. A successfully checked session remains subscribed to later sign-out or identity changes. A hidden URL is not authorization.

Contracts are in `production/source-operations-service.ts`:

- `sourceOps.read`, `GET /api/operator/sources`: canonical verified role (`denied`, `viewer`, `reviewer`, `publisher`), registry revision, authorized source page, unresolved operation IDs and next cursor. Denied replies contain no source records. Each source includes the existing source/run/version/audit model, backend-allowed decisions, explicitly published translation/version pairs, and history cursors. Current publication/candidate versions must be present in the displayed page. Unknown or malformed access replies display no private operator content.
- `sourceOps.history`, `GET /api/operator/sources/history`: exact source ID/revision, `kind` (`versions` or `audit`) and cursor. Return only immutable authorized entries and next cursor, bound to the same source revision. A version mismatch requires refresh instead of combining inconsistent histories. Diagnostics must be sanitized; never return raw private rows, source credentials, authorization headers or secret fetch URLs.
- `sourceOps.command`, `POST /api/operator/sources/commands`: source ID/revision, exact target, decision, reason, stable operation ID, captured registry revision and optional Spanish locale, with idempotency and `If-Match`. Client event time is not the authoritative audit instant. Server enforces actor/role, source coverage/rights/review expiry, candidate validation, source/translation base versions and atomic audit/publication/outbox transaction. Success returns the canonical snapshot with this exact audit entry and resulting source state; HTTP success or an unrelated snapshot is not accepted.
- `operations.read`, domain `source-operations`: replay the original authoritative receipt without executing another decision. Initial reads restore unresolved operations after reload. Unknown results freeze new decisions and cannot be dismissed into a fresh publish request.

Viewer has read-only safe diagnostics/comparisons/history. Reviewer can approve validated incoming content, quarantine an unpublished candidate, review the exact Spanish translation and retry one failed run using its original job identity. Publisher has separate exact-version publish, withdraw, reviewed historical rollback and reviewed translation-publication controls. A validated approved English version does not automatically publish its Spanish translation. Rollback never rewrites private historical records. Source or role changes during review reject the stale command and preserve the reason. Cancel closes only an unsent local review; the UI never promises cancellation of a dispatched transaction. Retry does not synthesize a successful fetch, change a publication pointer, or turn an empty failed import into clean evidence.

The endpoint shapes above are a frontend facade for the more detailed `/api/ops/*` proposal in the complete handoff. Backend implementations may map the facade to those internal services without changing the UI contract. Add role tests, malicious/empty candidate tests, idempotent double-submit tests, publication/withdrawal/rollback and translation version tests, pagination tests, lost-response/reload reconciliation and role-revocation tests before operator release. The frontend test fixtures are synthetic and never authorize actual publishing or retrieval.

Frontend domain tests cover strict nested records, canonical revisions, unknown outcomes, safe public/provider links, processed private photo references, source qualifiers, recovery proof and immutable summaries. Production browser tests mock auth/API responses and block other network calls; they exercise malformed-record recovery, modal deletion reconciliation, preference persistence, verification-pending/confirmed transitions and frozen summary reads. These tests do not send real verification messages, connect providers, register a real push endpoint or test a deployed backend.

Before release, Vibhav must run the complete handoff acceptance suite against a disposable integrated identity: owner isolation across every ID, device/context changes during in-flight calls, durable operation replay after reload, atomic linked deletion, report quarantine/rejection/download, staged-photo cleanup, actual recurrence/timezones, correctly scoped scientific source coverage, immutable archive reopen/export, home transition, recovery on both same and different devices, provider consent/revocation, push registration/disable and consented delivery. Backend availability and provider behavior remain unverified until those tests run.
