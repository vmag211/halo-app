# Luna wireframe completion review

October 2026 completion pass. This document records frontend coverage, not a live conversational provider, production approval or backend delivery.

## Added interaction coverage

| User intent | Implemented frontend outcome | Boundaries |
| --- | --- | --- |
| Find an existing task | Exact-first title lookup; duplicate or partial matches remain distinct; exact task links | Reads only task context when enabled. No private preparation or Journal text enters the response. |
| Rename or move a named task | Editable title or date review, exact task ID/revision and disclosed timezone | Existing timed schedules are retained; DST gaps/ambiguities reject the move. A task created earlier in chat is not required. |
| Complete, reopen or mark waiting | Separate explicit confirmation and canonical status update | Completion records the actual current day in the chosen display zone, not the scheduled day. No change to scores, lab results, organizer registration or source records. Reopen retains history and clears the recorded completion date. |
| Save for later | Explicit date/time/reminder/repeat-clearing review | Only the selected task changes. Estimated effort and private preparation remain. |
| Delete a task | Exact title, origin, state, date, revision and deletion scope; Yes, delete / No, keep it | Deletes only the selected canonical task and its planning metadata. The original project/test/participation/note and other tasks remain. Archived/paused task deletion is still explicit; other mutations route through the current My Week details. |
| Ambiguous task | Choice of matching owned records before a mutation review | Blank/broad requests never select every task; a title collision cannot silently select the first record. |
| Edit a note | Exact note selection, editable replacement title/text and confirmation | Captures only selected ID/revision/title/text, not location, photo, evidence or case history. At confirmation merges only the reviewed text fields into the current record. A deleted note is never recreated from a stale proposal. |
| Start/continue a project | Existing guide review and canonical preparation task, with retained partial-failure recovery | Private step notes/outcomes/history are not copied into the conversation. The confirmed transition preserves those fields in the source workspace. No physical step completes automatically. |
| Uncertain action result | Pending operation reference, retained review, Check status and known-applied/not-applied outcomes | No blind resubmission, duplicate operation or conversation clearing while unresolved. A known-not-applied result reopens the review, not an automatic retry. Settings conversation clearing and all-data deletion also guard unresolved operations at preflight and confirmation; all-data commit rechecks the latest state. |
| New conversation | Explicit review of losing transcript, unsent text and unapplied reviews | Cancel preserves all text. Confirm keeps independent saved tasks, projects and notes. It does not claim deletion from an external provider. |
| Device goes offline | Pending generation stops and returns the unsent question; saves disabled | No implicit queue or automatic resume. A later user retry remains deliberate. |
| Context disabled after proposal | Confirmation-time capability check rejects affected actions | The original review stays intact; manual app access remains available. |

## Retained X02 coverage

The approved Luna name/mark and shared panel remain. Existing guided project steps, project shortlist refinement, area-scoped participation resources, dated source explanations, diagnostic refusal, source links, note creation/deletion, all-day scheduling, bounded weekly planning, homepage attention/recap, cross-page conversation continuity and retry/cancel behavior remain available.

The external review tools exercise service ready, no-source, unavailable, unconfigured, rate-limit and slow states. They now also exercise action success, unknown-without-write, unknown-after-write and unresolved/resolved operation checks. These controls are outside the product UI. The deterministic preview does not imply natural-language understanding beyond its tested vocabulary.

Task snapshots include only public-in-the-user-workspace task fields and scheduling/status metadata. They exclude preparation text, note photos, unrelated notes and Journal content. Retrieved guide/source/note text is rendered as data, never parsed as tool instructions. A user's explicit `Save a note: delete task ...` stores that sentence rather than executing it. Negated, unsupported and broad mutations make no change.

## Validation

- `test/frontend-luna-completion.test.mjs`: vocabulary, exact and ambiguous matching, private-context exclusions, revision/schedule preflight, DST, status timestamps and unschedule scope.
- `test/frontend-luna-tools-preview.test.mjs` and `test/frontend-luna-week-plan.test.mjs`: retained parser, dates, named projects, source availability, effort and privacy tests. All 20 focused logic checks passed during development.
- `test/ui/luna-completion.spec.ts`: all 15 scenarios passed against the rebuilt stable static export: named task lifecycle, ambiguity, cancellation, stale revision, retry, revoked context, guarded conversation clearing, stale note resurrection prevention, actual offline cancellation, browser-Back request retention, exact canonical task opening, both uncertain-write paths, Settings unresolved-ledger protection and 320px/150% light/dark layouts.
- `test/ui/luna-conversation.spec.ts`: retained cross-feature conversation, project, note, source, failure and layout regressions.
- The 17 existing conversation tests passed against the earlier stable snapshot; the root full-app rerun covers them again in the final source set. Final stable-export browser results are recorded in the root completion receipt. A preliminary dev-server run was stopped when concurrent Fast Refresh changed visit-local state and is not counted as validation.

## Backend contract, not implemented here

Luna still needs Vibhav's authenticated capabilities/context endpoint, conversation and retention policy, reviewed provider integration, owner-derived minimal context, approved typed tool registry, immutable proposal snapshots, per-tool field allowlists, source/record revisions, idempotency and a durable operation ledger. Reauthorize ownership and permissions at execution, including after account/home/device changes. Unknown writes must be reconciled from authoritative operation status before another submission. Store action plus planning metadata atomically; the in-memory transaction in this review is not a proof of production atomicity.

The ledger must distinguish no submission, submitting, committed, failed and unresolved, retain the exact confirmed operation identity across retry/reload, and return canonical changed IDs/revisions. Task deletion must cover owned planning metadata/reminder jobs while retaining independent source records; source-linked project step consequences must stay consistent across consumers. Provider-visible attachments/location need separate explicit selection and consent. Journal text remains excluded. Account export/deletion/recovery must include conversation/proposal/operation records and disclose any provider retention that HALO cannot revoke.

The frontend deliberately does not claim arbitrary web search, live personalized generation, automatic registration, external email sending, clinical inference, hidden profile edits, unseen source updates, fully durable history or background scheduling. Forecast and outreach questions can navigate to their dedicated reviewed workflows instead of inventing a conversational result. Production must use typed service responses rather than this bounded intent grammar.
