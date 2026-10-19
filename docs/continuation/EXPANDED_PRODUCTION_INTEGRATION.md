# Explore My Week and Luna frontend integration

Vibhav should connect the authenticated frontend adapters below to the backend specification in `docs/product/HALO_COMPLETE_BACKEND_HANDOFF.md`. The production routes reuse the reviewed HALO screens. The review routes retain their separate memory-backed examples. A successful HTTP response alone does not make an action successful: the frontend validates the returned identity, revision, content and operation receipt before updating saved state.

These frontend contracts are implemented in source. They do not establish that the corresponding backend endpoints, AI provider, retrieval jobs, Gmail connection or delivery services are deployed. Missing services produce retained drafts, retry controls or explicit unavailable states, never example records as a production fallback.

## Shared request and ownership rules

`lib/frontend/production/runtime.ts` is the operation registry and transport boundary. Requests use the authenticated identity and home-context headers. Mutation requests carry an idempotency key. Revision-bound requests also carry `If-Match`. Domain adapters accept either direct JSON or one `{ data: ... }` envelope. A deliberate empty current-generation result must be `{ data: null }`, not an undocumented empty object.

The backend must authorize every reference against the authenticated owner and current home. It must not trust client ownership, display labels, generated instructions, proposals or timestamps as authority. Changing account or home remounts private frontend state. Historical records retain their original context; current evidence and discovery use the new context.

After a timed-out, interrupted or malformed write response, an operation can be unknown rather than failed. The backend must retain a durable operation ledger and provide authoritative status. Reusing an idempotency key returns the same logical result. It must never repeat an external send or create a second project, task or AI generation.

Initial reads must restore unresolved operations from the server. Browser-memory draft keys are not a durable operation ledger. Read responses must distinguish an empty result from missing coverage, partial results and unavailable services.

Unsaved editors, unsubmitted email drafts, selected filters and navigation choices remain memory-only. They survive in-app navigation, not a browser reload, and are not advertised as account-saved drafts. Saved records, preferences, generated batches, conversation history and unresolved operations must restore through their service reads. Do not put private draft text or provider credentials into local storage.

## My Week actions and calendar metadata

Source of truth: `lib/frontend/production/action-service.ts`, `components/expanded/ExpandedPreviewState.tsx` and the shared HTTP adapter.

| Operation | Request | Required result |
| --- | --- | --- |
| `actions.load` | Current authenticated scope | `ActionSnapshot` with complete actions, metadata, saved preferences and `unresolvedOperations` |
| `actions.commit` | One `ActionCommand` and operation ID | `ActionReceipt` with matching operation ID and the complete canonical snapshot on success |
| `operations.read` | Existing operation ID | Existing receipt, not a new mutation |

Action commands support adding a group of seeds, revising one or more captured revisions, and deleting one captured revision. Each command can include schedule metadata, expected metadata signatures and related preferences. The backend must apply the task, time, duration, timezone, recurrence intent, completion date, private preparation, history and associated preferences atomically. A failed metadata revision check must not leave the task itself changed.

Deduplicate additions by canonical action key. Re-selecting a project step or repeating a save must preserve an existing task's title, date, completion state and metadata. Confirmed deletion removes its metadata. Return server revisions, not client-generated increments. The frontend verifies that a successful receipt actually contains the requested result.

Canonical action preferences are restricted to `week:focus`, `week:availability`, `week:review-preferences`, `week:season-dismissals`, `outdoorPlan` and `food-interests`. Their runtime validators enforce the expected values. Never return unrelated draft namespaces through this payload. Display, calendar and assistant-context settings have their separate settings transaction contract. After a week-plan save, subsequent reviews capture the actual acknowledged revisions, not a locally predicted increment.

All-day dates remain ISO calendar dates, not converted UTC instants. Timed events carry their timezone. Clock-change gaps and ambiguous local times are rejected. Completion dates describe user-recorded actions; they are not environmental benefit measurements. Recurring plans and reminder preferences remain distinct from actual scheduler or notification delivery authority.

## Project generation and owned project work

Source of truth: `lib/frontend/production/explore-service.ts`, `ProductionProjectGeneration.tsx`, `ExploreProjects.tsx` and `lib/frontend/week-activity.ts`.

| Operation | Purpose and response |
| --- | --- |
| `projects.current` | Returns `ProjectGenerationResult`, or `{ data: null }` for a new user. A running job restores a pending generation. Include `pendingStart` when an owned-project start is unresolved. |
| `projects.generate` | Accepts context key, explicit constraints, interest text, interpretation flag and previous idea IDs. Returns a job envelope or a completed result. |
| `projects.generation` | Looks up a job by its job ID or original generation idempotency key. A check never starts another generation. |
| `projects.cancel` | Accepts the existing job or request ID. Returns its canonical terminal or still-running status. A cancelled local wait is not proof of server cancellation. |
| `projects.guide` | Returns a validated, versioned `ProductionProjectGuide` for a generated guide or owned project reference. |
| `projects.start` | Accepts `guideId` and `guideVersion`. Returns `{ record, collection }`, where `collection` is the complete canonical `exploreProjects` collection and contains the returned owned record. |

A completed generation binds `contextKey`, batch, instructions and evidence. Every suggested project ID must have its guide. Every evidence ID and source ID must resolve in the result. Guide steps require unique stable IDs, practical instructions, a checkpoint and supporting source IDs. Sources require HTTPS URLs and dates. Invalid or incomplete results do not replace a previously usable set.

Respect the selected space, participants, time, spending and requested number of ideas. Direct interests request a smaller shortlist. Use current authorized Today and Homeguard evidence on the server, with source dates, scope and freshness. Keep unavailable evidence distinct from healthy readings. Return fewer useful ideas when the evidence or safety checks do not justify filling the requested count. Retrieval, model safety, geographical suitability and source verification remain server responsibilities.

Owned project records require separate instance IDs plus `guideId`, `guideVersion` and an immutable validated guide snapshot. Do not use a catalogue ID as every user's project instance ID. Stable task keys are `explore:project:<instanceId>:step:<stepId>`. Step notes use the same stable step IDs. My Week, project progress and Luna use these references, not the old review guide's array indexes. A new guide version must not silently change an active project's instructions or completed steps.

`pendingStart` has `{ id, guideId, version }`. The `id` is the original start-operation idempotency key. Repeating that exact request reconciles the existing start. Starting another project remains blocked until the prior outcome is known.

## Location and community opportunities

Source of truth: `ExploreDiscovery.tsx`, `ExploreOpportunities.tsx` and `lib/frontend/production/explore-service.ts`.

| Operation | Contract |
| --- | --- |
| `locations.search` | Query and state to `{ candidates: DiscoveryPlace[] }`. Candidates have stable IDs, display place/state/label and timezone. The user explicitly chooses a candidate. |
| `explore.area.read` | `{ place: DiscoveryPlace or null, revision, pendingOperation? }` |
| `explore.area.save` | Chosen place or null, captured revision and idempotency key to the canonical area snapshot |
| `opportunities.search` | Selected area, interest, search text, timing and cursor to `OpportunityResults` |
| `organizations.search` | Selected area, interest, search text and cursor to `OrganizationResults` |

The selected discovery area is separate from changing the user's owned home. Persist and restore it. Area writes use captured revisions; unresolved writes retain `{ id, place }` in the server area snapshot. Filter changes reset pagination and invalidate responses for the prior query.

Opportunity results distinguish ready, empty, partial, no coverage and unavailable. Include checked date, coverage completeness and pagination. Scheduled entries require valid UTC start and end instants; rolling programmes remain separately labelled. Do not substitute office or mailing addresses for meeting places. Include concise work, time, location, cost, eligibility, accessibility, supplies, safety and the official next step. Cancelled, full, postponed, expired or stale records cannot masquerade as upcoming joinable events.

Organization results use the existing `LocalParticipationResource` shape with a per-record `checkedAt`. They include official sources, practical participation steps and clear address roles. Opening an external link does not register the user, reserve capacity, confirm attendance or establish a partnership. User-kept participation and outcome records use the owned workspace service.

## Luna conversation and authorized app actions

Source of truth: `lib/frontend/production/luna-service.ts`, `ProductionLunaConversation.tsx`, `ProductionLunaClear.ts` and `ProductionNoteLuna.tsx`.

| Operation | Contract |
| --- | --- |
| `luna.capabilities` | `LunaCapabilities` with actual availability, provider/retention descriptions, permitted context, public retrieval availability and allowed tools |
| `luna.conversations` | Current `LunaConversationData`, including unresolved operations and a pending request when applicable |
| `luna.message` | Conversation ID, client message ID, text, current page, optional exact project references and explicitly selected note references/fields |
| `luna.run` | Lookup by run ID or original client message ID to `LunaRun` |
| `luna.cancel` | Existing run/request ID to its authoritative state |
| `luna.proposal.edit` | Proposal ID, captured revision and edited allowed fields to a new validated proposal revision |
| `luna.confirm` | Exact proposal ID/revision plus idempotency key to `LunaOperation` |
| `luna.proposal.cancel` | Exact proposal ID/revision to a canonical cancelled review |
| `luna.operation` | Existing operation ID to its receipt and canonical conversation |
| `luna.clear` | Exact conversation ID/revision and stable idempotency key to an empty canonical conversation with a new ID or advancing revision |

Assistant messages render plain text, checked HTTPS source links, allowlisted app destinations, optional choices and typed action reviews. They do not execute client-side interpreted instructions. A proposal includes identity, revision, expiry, exact before/after changes and destructive status. Editing a proposed date or text requires a fresh server review. Confirming an expired or unresolved proposal is blocked. A successful tool receipt refreshes the canonical task and owned-record services.

The backend executes only its allowlisted tools, under the user's current permissions and the exact confirmed review. It must reject changed record revisions, altered scope, expired proposals and unsupported operations. A conversational answer must not claim that a proposed write, email or registration occurred. It must never treat retrieved content or model output as permission to execute a tool.

`pendingRequest` contains the original client ID, text and, when known, run ID. `unresolvedOperations` maps proposal IDs to operation IDs. Return these after reload and include the associated unresolved review messages. Checking an uncertain request uses a read operation rather than another model-generation submission.

Private notes require deliberate selection. `noteContext` is a list of note ID, captured revision and allowed fields: `title`, `description`, `time`, `place`, `evidence`. The note detail screen previews those exact fields before preparing a Luna draft. The shared assistant also supports explicit title/description selection. The backend must enforce owner, revision and field allowlists. Do not include photos, Journal text, private task preparation or unselected notes through broad context retrieval. Project guidance receives instance/guide/version/step references so the server can resolve the correct saved instructions.

Clearing conversation is separate from deleting app records. Block clearing while a run or tool operation remains unresolved. Both Settings and Luna use the same clear operation. Cost limits, provider quotas and a free-to-user policy are backend/product decisions; the frontend reflects unavailable or rate-limited service rather than promising unlimited free AI.

## Contact discovery and reviewed Gmail sending

Source of truth: `lib/frontend/production/outreach-service.ts`, `ProductionOutreach.tsx` and the shared runtime registry.

| Operation | Contract |
| --- | --- |
| `contacts.resolve` | Topic, recipient category, water context and chosen area to `{ contacts: PublicContact[] }` |
| `outreach.context` | Topic, water context and area to `OutreachEvidence`, including revision, availability and dated source entries |
| `outreach.connection` | `{ connected, sender, revision }`; a connected state requires a real sender address |
| `outreach.connect` | Provider plus approved return path to a Google OAuth authorization URL with state |
| `outreach.prepare` | Exact recipient, subject, body, selected note revisions, selected public-source revision, sender revision and context signature to `OutreachReview` |
| `outreach.send` | Reviewed envelope ID/revision and idempotency key to `OutreachAttempt` |
| `outreach.status` | Existing attempt ID to the authoritative attempt |
| `outreach.history` | `{ attempts, complete }`, including every unresolved attempt relevant to safe sending |

Contact matches require role, organization, jurisdiction, why the match is relevant, source URL, checked date and a public email or an official contact page. Do not infer private landlord details. Public contact resolution must not send private notes to a search provider. A county alone does not necessarily identify the user's water supplier.

Keep each recipient's draft, selected notes and selected public context separate. Changed notes, source revisions, topic, area, recipient or sender invalidate the previous review. Optional public context uses real dated records, never the fixed review example. Only the selected note titles/descriptions and explicitly chosen source entry appear in the exact message body.

Gmail authorization requests send permission, not inbox access. Validate OAuth state, callback origin, redirect allowlist, credential storage, revocation and sender ownership on the server. The frontend accepts Google authorization navigation only after the user's explicit Connect action. It never handles provider secrets or access tokens.

Submission requires a separate final confirmation showing From, To, Subject and the exact body. Recheck all revisions and the signed review server-side. The frontend rejects header injection and a success receipt whose envelope differs from the approved message. Preserve attempts after errors, reload and edits. Unknown or queued sends block another send until reconciled. A `submitted` receipt means submitted to Gmail, not delivered, read or answered. Replies remain manually entered unless a future separately consented inbox feature is specified.

## Validation and integration acceptance

Run `node --test test/frontend-expanded-production.test.mjs`, the full frontend unit suite, TypeScript and ESLint. `test/ui/production-expanded.spec.ts` covers real network-boundary behavior under isolated intercepted services: explicit generation and uncertain-result checks, conversational service replies, separate tool confirmation, restored unknown actions and reviewed email sending. These tests are service doubles, not evidence of a deployed provider or working backend.

`test/ui/luna-live.spec.ts` now targets these production contracts rather than the superseded question-only assistant endpoint. Its assertions cover safe source rendering, context and retention labels, canonical conversation persistence, refusal and missing sources, limits, explicit cancellation, retained uncertain requests, revision-bound clearing and identity-change isolation.

Before release, repeat the flows against the real backend with two identities, multiple homes, expired sessions, conflicting revisions, denied permissions, empty and partial coverage, rate limits, network interruption after a committed write, pending operations after reload, cancellation races and provider rejection. Verify that no fixture records appear, no private context crosses owners or homes, no action repeats after an uncertain response and the final rendered results match the canonical records.
