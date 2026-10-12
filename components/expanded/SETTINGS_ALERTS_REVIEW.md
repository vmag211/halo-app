# Dashboard, Settings and alerts finishing review

October 12, 2026. Editable isolated wireframes, not approval or production integration. Vibhav's backend ownership and deferred handoff remain unchanged. The existing HALO palette, typography, approved logo, 430px mobile shell and all specialist workflows remain.

## Presentation and inspiration

The homepage now prioritizes the calendar and daily agenda. Quick views and management follow the day's work, rather than displacing it. The score glance and optional actual-completion rhythm stay, with compact whole-row ongoing work when only one record exists. Original horizon/plant line art draws once; gauges and selection/toggle transitions are finite. Device and app reduced motion suppress the new decorative motion. Content and actions are immediately available, and animation does not imply live data or measured environmental improvement.

[Things' official design presentation](https://culturedcode.com/things/features/) and its [Today/Upcoming model](https://culturedcode.com/things/support/articles/4001304/) informed task-first hierarchy and details available when needed. The [official Mazah winner profile](https://www.congressionalappchallenge.us/25-NC08/) informed the connection between household routines and community action, not an invented description of its dashboard or a promise of judging success. No competitor branding/assets were copied. Existing reviewed local project photography is reused; new dashboard/Settings artwork is code-native.

## Settings inventory

Six searchable entrances replace the household-only scaffold: Home & household, Alerts & reminders, Display & accessibility, Luna & connections, Privacy & data, and About & help. Categories and frequent controls are direct; supporting and destructive operations are separate disclosures.

- Household preserves all seven flags, historical records, explicit Save/Cancel and visit-retained drafts. Building year, water source and owner/renter preference have separate retained fields and validation. New-home lookup demonstrates its review boundary and honest unavailable state, without storing a typed address in a URL or looking up a real person.
- Per-panel drafts and group-scoped saves do not accidentally save another section's draft. Conflict rebase preserves locally edited fields and adopts fresh unedited values. Offline/failed/unknown-profile states cannot confirm a write. Display size supports 100/115/130/150, reduced motion and contrast; calendar zone, linked dates and streak preferences share the existing My Week keys and apply on explicit Save. Appearance still follows the device. Requested Spanish remains an English fallback until the whole advertised scope is reviewed.
- Five existing alert categories retain the combined inbox/push semantics. Quiet hours and follows are requested preferences, not active delivery. Follows deduplicate kind/name, can be removed, and show unverified coverage. Reminder count uses canonical active task preferences. Device setup explains the permission/subscription distinction and never requests permission or registers a browser from the Site.
- Luna task/project context controls guard new bounded reads/proposals in the conversation; Homeguard collections are excluded from project-context generation when home context is off. Confirmation-time checks invalidate affected pending tool reviews if permission changed. Journal text stays excluded; deliberately selected notes are a separate selection. Conversation clearing reviews exact content and keeps independent saved work. No live conversational provider, email or calendar connection is claimed.
- Privacy inspects actual in-memory domains, offers a scoped export field preview, defaults to excluding private text/Journal details/transcripts, always excludes exact location and attachments, and reconciles changed contents before download. Exports carry explicit isolated-review provenance. Clear Journal binds to exact record IDs/revisions and retains tasks/home data. Delete all requires DELETE, compares record/action/conversation revisions, clears records/drafts/preferences/follows/conversation/actions, and prevents lazy fixture reseeding. No live account, server file, job or provider copy is deleted.
- Recovery/device linking remain explicitly unavailable, not a fictitious protective switch. About links to existing full factor/source guides, methods, photography credits and a private feedback composer. Copying feedback is not sending feedback. No unreviewed safety advice or new scoring method is introduced.

## Alerts inventory

One canonical visit-local inbox drives its badge and All/Unread counts. Compact dated rows expand independently, preserve source links and open the intended related screen. Opening the inbox or expanding a notice does not mark it read. Explicit read-one/read-all and dismiss/Undo are distinct, revision-bound operations. Undo preserves the original read status. Failure/offline/conflict retain notices. The three initial messages are harmless illustrative guidance/app snapshots, not fabricated pollution measurements, organizer cancellations, emergency advisories or delivered task reminders. No safety threshold is generated on the client.

Task completion, notice reading and evidence-change acknowledgement remain different actions. Existing homepage source-change reviews and task reminder manager are preserved. Alerts do not claim continuous monitoring or emergency coverage; official local channels remain the route for urgent information.

## Backend handoff delta

Inspected source: `/api/profile`, `/api/household`, `/api/notifications`, `/api/alerts`, `/api/push/subscribe`, `/api/account`, `/api/assistant`, live `StageSettings`, and existing plans. Code availability is not deployed migration/provider/ownership verification.

| Domain | Existing contract and remaining production gate |
| --- | --- |
| Profile/household | Live StageSettings performs identity preflight, full seven-flag replacement and unedited-field preservation. Expanded year/water/tenure need an authoritative owned profile/context revision; tenure storage and real new-home lookup/history/task portability require the home-context transition contract. Settings fixtures never rematch a real utility or rescore a home. |
| Preferences | Existing notification endpoint accepts only five boolean types and gates both new inbox and push. New quiet hours, locale, Luna controls and account/display preferences need capability/version/schema/retention semantics. Preserve unknown/untouched fields and return authoritative confirmed values. |
| Alert lifecycle | Existing read-one/all and dismiss/Undo are owner-filtered; dismiss requires migration0010. Add exact typed target/period/source-revision mappings and safe missing/deleted target behavior, deduplication, pagination and durable mutation receipts. No account selector in a client body grants ownership. |
| Device delivery | Existing subscribe/unsubscribe routes do not prove deployed VAPID/service worker/subscription acknowledgement or delivery. Complete unsupported/default/granted/denied/expired/error states, installation-specific browser behavior, renewal/unsubscribe and identity change reconciliation. Permission granted alone is never enabled delivery. |
| Follows/reminders | Need typed resolvable source IDs, verified coverage, revisions and durable delivery intentions. Quiet hours/eligible snoozes require timezone/DST/expiry semantics and a job ledger. Existing task intent and inbox state are not scheduler or urgent-source coverage proof. |
| Luna | Server-enforced minimal context preferences/capability response, owner-scoped conversation retention/clear/export, typed tools, revision/permission checks at execution, exact confirmation/idempotency/receipt and unknown-outcome reconciliation. Existing assistant is grounded single-question Q&A, not these actions. Home context/privacy policy still needs reconciliation. |
| Export/delete | Need authoritative domain inventory/counts, field-level selection, secure attachments, operation status and complete database/files/jobs/subscription/derived-cache deletion. Existing account route deletes the auth user under DELETE; verify all new cascades, storage, backups and providers separately. Visit-local erasure is not proof of server deletion. |
| Recovery | Secure ownership-verifying optional recovery and device linking/revocation/collision/expiry flows need a selected method and dedicated backend. Anonymous use remains possible, without a recovery promise. |
| Language/accessibility | New finishing copy is in a central English catalogue. Whole-app reviewed Spanish, source locale fallback, formatting/document language and physical Safari/screen-reader/zoom/device tests remain release gates, not completed by emulated mobile QA. |

No API route, migration, shared production account, authentication setup, service worker, scheduler or approved archive is changed. Production Settings and the default live entry keep their existing delivery gates. This document is saved for the eventual handoff, not sent to Vibhav.

## Verification

See the newest hosted receipt for final test counts, source and deployment provenance. Browser tests block API/auth/provider requests. They cover active interactions, both appearances, 320px/150%, focus/Back, saved-work continuity, privacy scope and reduced motion. Immutable onboarding and foundation checks are separate from approval of these new screens.
