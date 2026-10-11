# Explore evergreen workspace and integration delta

October 10, 2026. Yogi requested a replacement of the October 9 event-led Explore design, deeper notes/outreach and a more coherent professional layout. This is a frontend review proposal, not visual approval or a completed backend integration. Vibhav remains the backend owner. No backend routes, migrations, OAuth connections or email sends were changed by this work.

## Product boundary

Explore is an evergreen community hub, not a live event calendar or news feed. Its map, volunteering finder, community guide, organization directory, reviewed project paths, private notes and outreach entry points do not depend on a featured current event. Actual events can be discovered on official organizer sites. No event import, ongoing calendar ingestion or cancellation-monitoring service is required for this initial version. Earlier A03 catalogue/participation requirements remain a possible later capability, not an enabled service in this revised design.

Official resource guides and learning/project content can be bundled, versioned and reviewed periodically. Evergreen does not mean permanent factual accuracy: links, contact roles, instructions and service coverage still need review. Live map evidence keeps its own dated source/update rules; this request does not make measurements static. Organization records use the existing directory foundation after its coverage and error semantics are verified.

## Current implementation versus backend needs

| Surface | Review implementation | Production dependency |
| --- | --- | --- |
| Community hub | Stable navigation, three retained local photos, regular rectangular crops, optional coarse area label | No homepage event service. An actual user area can be selected independently of household setup. |
| Get involved | Five real source-scoped programme guides, reviewed NC name matching, preparation/requirements/addresses, official finder fallback and editable private commitments | Reviewed directory/content versions, typed address purpose, actual service geography and source freshness. Owned commitment/shared-action persistence. No automatic event/calendar service. |
| Community learning | Water/air/radon/facility evidence explanations, matching map links, explicit question-to-note continuation | Reviewed content versions/translations. Real map adapters retain source scope/dates and unknown/error states. No locally inferred risk score. |
| Organizations | Combined under Get involved, with real official sources instead of fictional directory cards; office/mailing/site scope is explicit | Existing `/api/volunteer` and `volunteer_orgs` need stable IDs, reviewed source/contact/content fields, service geography and archive/review state. Database failure must not be a successful no-match result. |
| Projects | Five versioned practical guides with instructions, materials, safety, sources, active workspace and shared My Week steps | Reviewed content can be bundled. Persisted template-version/step identity, revisions, parent/child actions and outcomes need shared action storage and an explicit version/migration policy. No unmeasured benefit estimate. |
| My notes | Observation/question/idea/conversation types, search, pin/filter, retained drafts, edit/delete, export field preview, reported external reference | Owned records/RLS, revisions, idempotent creates, private retention/export/deletion. Observation date required; date optional for non-observation notes. Photos/EXIF are not implemented. |
| Selected-note Luna | Exact field selection plus deterministic project matching/current-step guidance and a second-confirmed atomic memory deletion of selected notes | Capability response, authenticated IDs/revisions and owned snapshots, processing/retention disclosure, cancellable generation and immutable expiring tool proposals. Confirmed atomic deletion needs server ownership/revision/idempotency checks. No background ingestion. |
| Contact finder | Official lookup alternatives, independent recipient drafts, topic/area, clearly fictional candidate and manual recipient review | Reviewed public-contact registry and resolver. No guessed emails, scraping private contacts or claim that a county identifies a provider/representative. |
| In-app email | Simulated connection, exact sender/recipient/subject/body confirmation, duplicate/unknown safeguards and simulated attempt reconciliation | New per-user Gmail OAuth/send service, verification, encrypted credentials, operation ledger and abuse controls. Nothing is connected or sent in the Site preview. |

## Suggested contact-resolution contract

Use an issue category, recipient class, explicit user area choice and optional confirmed provider/organization/district ID. Return a small candidate set with stable ID/revision, official organization/office, public role/name only if published, responsibility, service jurisdiction, supported topics, public email or official form URL, source URL, checked date and human verification state. A working URL is not human verification.

Distinguish candidate matches, ambiguous jurisdiction, additional location information needed, no public email, no reviewed coverage, stale contact and failed lookup. Explain why each candidate fits. Prioritize the responsible office/role, not an invented personal contact. Do not claim every office publishes an email address. Offer an official-form/copy-message fallback.

A water utility requires a confirmed provider or service-area match; ZIP/county alone may be ambiguous. A representative may require reviewed district boundaries and more precise user input. If exact location is necessary, ask separately, explain the destination/use and avoid routine storage. A private landlord is manually supplied by the user, not discovered from their location. Changing topic, area, provider or recipient invalidates the prior suitability confirmation.

Suggested API groups, not existing endpoints: public contact resolution/detail; owned outreach drafts with selected evidence/note revision snapshots; private email connection/revocation; explicit confirmed send attempts and attempt-status reconciliation. Reuse HALO's session/owner/idempotency transport, not a second identity system.

## Notes and Luna contract

Preserve original text and revision history. A general question or idea is not a measured observation. Each selected note is loaded and authorized server-side; client-provided text is untrusted data, never tool instructions. Default context excludes place/date and all unrelated records. The final request shows exactly which text is included, its source/revision and what the provider may retain. Free-text Journal context remains excluded by default; this proposal applies only to deliberately selected Explore notes.

Luna may help clarify a question, organize a factual observation or suggest a follow-up, with uncertainty and citations where needed. It must not diagnose a contaminant from a note, claim an observation is a verified measurement, quietly overwrite a note, email someone or submit an official report. Proposed note edits/actions require a separate preview and confirmation. Do not use the existing assistant endpoint's page/question fields as proof of a secure selected-record workflow.

Contact/outreach inclusion is separate from Luna consent. A chosen note adds only its title and description; its text may itself be sensitive, so always review it. Keep per-recipient snapshots. Changed or deleted notes require deliberate reselection before sending; they never silently rewrite an edited message. Previously exported/copied text cannot be recalled by deleting the source note.

## Email feasibility and safety

Sending from the app is feasible using the [Gmail messages.send API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send) and [MIME message workflow](https://developers.google.com/workspace/gmail/api/guides/sending). The recipient can use any email domain. HALO would send from the user's connected account, not from the developer's connected Gmail or a shared application identity.

Request only [`gmail.send`](https://developers.google.com/workspace/gmail/api/auth/scopes), a sensitive scope requiring Google's applicable verification. It does not authorize reading an inbox or replies. Ask at the moment the user chooses email sending, not during onboarding. Use the [web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server), secure state/redirect handling, encrypted token storage, revocation/disconnect and reliable account ownership. Never put tokens in frontend assets, URLs, logs or the static review archive.

Validate exact recipients, subject/header injection, body bounds, allowed attachments and connection identity server-side. Revalidate contact and selected-note revisions at confirmation. Bind confirmation to an immutable message snapshot and a stable operation ID. Serialize submission, prevent double-click/retry duplicates, rate-limit and provide abuse safeguards. Do not queue or retry a message without an explicit user decision.

The [Gmail error guide](https://developers.google.com/workspace/gmail/api/guides/handle-errors) warns that API success is not proof of successful mail delivery. Use separate prepared/submitting/submitted/failed/unknown states, never Delivered or Replied from a send response. For an ambiguous timeout, reconcile the durable attempt before offering another send. Send-only access may not allow the backend to inspect Sent mail; where it cannot conclusively resolve the attempt, retain Unknown and offer a user check in Gmail rather than expanding inbox permissions silently. A sample 'no submission recorded' outcome is a wireframe branch, not proof that every production timeout is safely retryable.

Replies and provider delivery/bounce tracking are separate future contracts. Follow-up reminders do not send follow-up mail automatically. Review [Google Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) before any later Gmail/Luna data processing; connecting sending does not grant general mailbox access.

## Official resources checked for this review

- [National Park Service volunteering](https://www.nps.gov/subjects/volunteer/become.htm): official directions to location/activity searches and park volunteer pages. HALO links this guide because the dynamic Volunteer.gov page did not render fully in the source check.
- [U.S. Fish & Wildlife Service participation](https://www.fws.gov/get-involved): official ways to get involved. Availability belongs to the organizer, not HALO.
- [North Carolina Stream Watch](https://www.deq.nc.gov/about/divisions/water-resources/water-resources-public-information/water-education-programs/water-education-and-outreach/nc-stream-watch): state-specific learning/participation; some shared observations can be public. No submission API is implied.
- [USAGov elected-official directory](https://www.usa.gov/elected-officials): federal/state/local contact routes, not guaranteed personal email discovery.
- [EPA contact routing](https://www.epa.gov/aboutepa/forms/contact-epa) and [water quality report resources](https://www.epa.gov/ccr): official starting points, not automatic local-office matching or emergency handling.

## Review and release gates

Test the exact selected context, per-recipient drafts, contact reconfirmation, stale-note blocking, save/conflict/offline retention, delete scope, official-link handoff without private URL fields, Gmail cancel/failed/unknown/duplicate/reconciliation branches, regular image geometry/failure, keyboard/disclosures and light/dark narrow/enlarged layouts. Approved archives remain immutable. Physical Safari, screen-reader end-to-end behavior, translations, live resolver/record permissions, provider consent and actual sending require later verification before release.

## Later October 10 active-outcome extension

The new frontend goes from discovery to preparation, deliberate action and review. It can now demonstrate private volunteering commitments, ongoing project workspaces, topic/group/note/outreach result records, canonical shared task bundles and public map references attached to notes. These still use the existing isolated memory providers. No new authenticated route, schema, email delivery or selected-note AI service was built.

### Required owned records

- Personal volunteering commitments: chosen opportunity title/organizer, cause, optional reviewed public HTTPS URL, private place label, planned date, preparation/access notes, dated self-reported state, optional nonnegative hours, factual activity/result, user-supplied organizer reference, follow-up date and immutable update history. This is private user-entered content, not a public event catalogue. Store source verification separately from the user's confirmation. A participation report needs an actual date and factual activity; future planned dates cannot become future attendance claims.
- Project workspaces: template ID/version, reviewed suitability/prerequisites/materials, owner, active/paused/completed status, goal, chosen step references, private notes, recorded result and review history. Steps reference the SAME shared action IDs as My Week. The preview's deterministic step keys are not a production template-version contract. Preserve user-edited action titles/schedules/status on repeated selection. A reopened step makes an earlier completion snapshot need review; no auto-completion or benefit estimate.
- Follow-through cases: stable owner-scoped ID tied to a community topic, organization, note or outreach request; desired answer/result; own status/date; factual result; optional genuine user-supplied reference; next step/check-back date; canonical related action ID; original update history. A user's status is not agency verification, laboratory evidence or an organizer receipt. Distinguish closure without a result from an answered question.
- Note/public-evidence references: stable record ID, layer/evidence kind, original observation date, geographic basis/scope, source/revision/rights and snapshot metadata loaded and authorized server-side. The current fixture retains only title, record ID, date and scope. Never include the home pin through the public-map pathway. Add a selected reference only after an explicit user action, preserve existing writing, and preview it independently for Luna or exports.

### Atomicity, ownership and task relationships

Bundle confirmation creates only deliberately selected tasks. Implement an idempotent atomic operation, with unique owner/template-version/step/occurrence keys and canonical parent/child IDs. Return existing duplicate matches rather than resetting them. A failed bundle must create no partial work; an unknown write requires reconciliation. A sample synchronous add is not proof of backend atomicity.

Follow-up tasks remain separate from their source record. Deleting a note removes its OWN case/history and unsaved case drafts in one authorized transaction; independent My Week tasks, other records and already copied outreach text remain. Return linked-record scope before confirmation. Account export/deletion/recovery must cover new commitments, cases, project notes, histories and reminder jobs. No private record can be loaded by an unauthenticated public map or another household.

Project completion uses actual owned step states and a factual recorded result, not a carousel view or a percentage animation. Pause/resume must define its relationship to existing task schedules/reminders without silently deleting them. The current preview pauses editing in the project workspace but retains independent My Week tasks. Production needs reviewed server transition rules and revision-conflict handling across both consumers.

### Separate action outputs from environmental outcomes

Action evidence includes user-reported hours, contacted/participated status and completed steps. Tangible outputs include a received dated report, a chosen qualified test, a reply or an actual reference. Environmental outcomes need compatible dated measurements or official confirmation. Never convert completed tasks, volunteering hours, reports sent or proximity into pollution removed, water-quality improvement, health benefit or causal attribution. The frontend explains how each action can support awareness, qualified decisions or community stewardship without claiming success before evidence exists.

### Source and release status

The local `/api/volunteer` directory exists, including its documented successful-empty database-error fallback. The local tree still has no implemented owned commitments/project/case/bulk-action endpoints. No remote backend deployment was audited in this refinement. Vibhav must implement or verify the required contracts, flags, privacy/retention, source coverage, transport and production permissions before wiring the approved frontend. Existing map geography/fixtures are reused; no live source, scoring formula, provider key, registration, message or agency API was added.

## October 11 connected guidance and assistant tools

### Real programmes and practical guides

The review bundles official-source guides for Keep Charlotte Beautiful, Catawba Riverkeeper, TreesCharlotte, Mecklenburg community gardens and Union County Extension. Exact recognized NC place names select reviewed resource coverage; arbitrary labels do not create nearby results. `/api/volunteer` currently accepts authenticated county/cause queries and returns directory fields, not programme requirements/instructions, typed addresses, events or a geospatial finder. Its HTTP 200 empty-on-database-error fallback must distinguish unavailable coverage from a genuine no-match before live use.

Return stable programme/resource IDs, actual served jurisdictions, official source URLs, source/content versions and review dates, published requirements/access information, explicit unknowns and archive state. Addresses must say public site, office/headquarters, mailing-only or an event-specific meeting point, never imply a headquarters is today's gathering. An actual dated event needs its own source, organizer, availability/cancellation and venue contract. Reuse deliberate coarse user area selection; request geocoding or exact location only when necessary, with purpose/permission and no private fields in outbound URLs. Participation preparation is not registration or organizer acceptance.

Five draft project guides now provide usable how-to content and source links. Production needs qualified content review, translations, geographic/seasonal suitability, reviewed safety, change history and template-version/step persistence. Keep an existing user's original instructions, notes and canonical task relationships when content changes; offer an explicit migration rather than silently interpreting an old step number under a new guide. The preview retains legacy water/habitat IDs for existing local task regressions, but that is not a production versioning scheme. User-confirmed materials/steps and factual results are action outputs, not proof of pollination, pollution removal or improved measurements.

### Selected-note generation and confirmed mutations

The actual `/api/assistant` only accepts question/page context and provides an answer. It has no selected-record authorization, guide-version binding, proposal ledger, conversation/tool lifecycle or note-deletion contract. Its current household-context behavior is not consent to ingest notes, Journal or Homeguard records. Do not implement tools by hiding commands in a question string or allowing a model to call arbitrary endpoints.

Add a capability-gated authenticated workflow. Resolve selected note IDs/revisions server-side with owner/household permissions, exclude unselected records, and bind opt-in date/place fields plus guide ID/version/current step to the exact request. Show provider processing/retention and revocation before transmission. Treat notes, source text and retrieved pages as data, never instructions that grant tool authority. Project suggestions should cite the reviewed catalogue or identify newly generated instructions as unreviewed; do not infer site suitability, health diagnoses or environmental benefit from notes.

Proposed writes need immutable owner-scoped proposal ID, exact operation/record/revision scope, preview, expiry, single-use confirmation, idempotency and cancellation/reconciliation. Selected-note deletion must reauthorize and recheck every revision at commit time, then atomically remove the selected records and only their owned case/history/drafts. Preserve independent My Week tasks and already copied outreach text. Define tombstones/retention, recovery/undo, account export/deletion and stale/missing/partial/unknown behavior. The sample's synchronous memory commit is not a real transaction guarantee. Current-step guidance must not mark steps complete, reschedule reminders, register attendance or send emails without independent deliberate confirmation.

Global/contextual Luna in expanded Explore/Homeguard demonstrates this lifecycle only. Approved Today/factor/production assistant stays unchanged. Real cross-app tools, persisted conversations, permissions and processing disclosure require backend work and review; no external message or production note was deleted during development.

### Air contour source, separate from record density

`/api/map` returns dated AirNow station observations, not a spatial contour field or forecast frames. Air Patterns in this revision counts monitor locations equally; water/facility patterns count qualifying records. Geographic seeds create bounded irregular display lobes, and optional motion changes only texture shape, not source values, coordinates or environmental time. Sparse station density must never be relabeled AQI or wind transport.

For real air contours, use a separate documented source such as an applicable [AirNow mapping product](https://www.airnow.gov/custom-airnow-maps/map-overview/) and its [mapping methodology](https://docs.airnowapi.org/docs/AirNowMappingFactSheet.pdf), subject to source rights and requirements. Return pollutant/index basis (including NowCast where relevant), units/categories, observed versus modeled/interpolated/forecast kind, geographic coverage, issue/observation/frame-valid times, no-data masks, methodology/version, source/rights, freshness/cache policy and available frames. Contours may differ from a nearby station; preserve both with clear semantics. Time animation must use actual dated frames, not browser-generated drift, and missing/stale frames must not imply clean air. Provider selection, ingestion, QA and ownership remain with Vibhav; no such service was created here.
