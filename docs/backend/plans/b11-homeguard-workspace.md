# B11 Homeguard workspace (`workspace.load`, `workspace.execute`): plan

Base: `origin/vmag211/backend` at `f2b49e3`. Migration number **0026**. Rulings in this plan use the prefix **W** (W1, W2, ...).

## The frontend contract found

- Registry: `lib/frontend/production/runtime.ts:22-23` (`GET /api/frontend/workspace`, `POST /api/frontend/workspace/commands`), `:28` (`operations.read`). Status mapping `:144`: a 5xx on a mutation is `unknown_outcome`, a 409/412 `conflict`, 400/422 `validation`; a top-level `data` key is unwrapped (`:149-153`).
- Adapter: `lib/frontend/production/adapters.ts:27-28` (`load` refuses the payload unless `validHomeRecords(records)` and `Array.isArray(pendingOperations)`; `execute` sends `Idempotency-Key = operationId` and `If-Match = expectedRevision` for a write or remove that has one) and `:15,29` (`receipt`: matching `operationId`, status in succeeded/failed/pending/unknown, and `validHomeChanges(changes)` for EVERY status, a failed one included).
- Types and coverage checks: `lib/frontend/production/home-service.ts:1-86` (`HomeCollectionSnapshot`, `HomeWorkspaceCommand`, `HomeWorkspaceReceipt`, `homeReceiptCoversCommand`: a write must return its record at a revision above `expectedRevision ?? 0`; a remove must return the collection without the id; `remove-notes` must return `exploreNotes` without any selected id).
- Per-collection row schemas: `lib/frontend/production/home-records.ts:23-46` (`validProductionRecord`), binding: the provider discards a whole collection for one bad row (`components/homeguard/HomeWorkspaceState.tsx:107`).
- Provider: `HomeWorkspaceState.tsx:36` preloads all 16 collections on mount; `:104-117` load (pending operations are recorded before an `unavailable` answer throws); `:132-157` receipts; `:205-214` write (needs a `ready` collection, sets `homeContextId` for the five home-owned collections); `:233-238` remove; `:251-256` remove-notes; `:270-279` clear-private.
- Contract prose: `docs/product/HALO_BACKEND_WIRING_CURRENT.md:518-560`.

## What is built

1. **Migration 0026** (`supabase/migrations/0026_household_workspace.sql`): one table `household_workspace_records` (owner, collection, record id, revision, the record as `jsonb`), RLS on with no policy, client roles revoked; `read_household_workspace(profile, collections[])`; `commit_household_workspace(profile, operation, writes)`, which in one transaction checks references, applies every upsert and delete at its expected revision, settles its own ledger row `succeeded` with ids and revisions only, and returns the receipt and the touched collections read in that transaction; a status-freeze trigger for settled `workspace` ledger rows (the 0023 pattern); `workspace_privacy_counts(profile)`; and a trigger that deletes the household's workspace rows inside a successful privacy clear all (W8).
2. **`lib/workspaceRecords.js`**: `validProductionRecord`/`validProductionCollection`, transcribed from `home-records.ts`, with `validProjectGuide`/`safeSourceUrl` from `explore-service.ts`. A drift test runs the server copy and the client's own compiled module over the same corpus.
3. **`lib/workspaceStore.js`**: the RPC wrappers, the unavailable 503, the unresolved list, and the command planner (parse, validate the resulting record with the client's own rules, compute references and linked deletes).
4. **Routes**: `app/api/frontend/workspace/route.js` (load), `app/api/frontend/workspace/commands/route.js` (execute, through `runOperation` with domain `workspace`), and a `workspace` overlay in `app/api/operations/route.js` (W5).
5. **Privacy**: the table in `lib/privacyInventory.js` (export groups home/explore by collection, clear journal keep, clear all delete), counts merged into `privacyCounts`, the owned-table test lists.
6. **Flag** `workspace` (`HALO_FEATURE_WORKSPACE`), off by default (W1).

Collections wired (stored, loaded, written, deleted): `tests`, `assets`, `observations`, `gardens`, `usage`, `pantryItems`, `foodQuestions`, `fishNotes`, `foodFollows`, `growerInquiries`, `exploreNotes`, `exploreOutcomes`, `exploreProjects`, `exploreEngagements`. Answered unavailable: `weekJournal` (W2), `homeTransitions` (W3).

## Rulings

- **W1, flag (proposed, Vibhav to confirm).** The workspace holds free text a person typed and health-adjacent records (tests, symptoms excluded per W2). Like tasks, it sits behind a server flag, off by default, until Vibhav confirms its retention. Proposed retention: kept until the person deletes the record, clears all, or deletes the account (the 2026-10-19 ruling for tasks). Flag off: load is the non-retryable 503 (what the screen shows today with no route), execute a 200 `failed` receipt with `changes: {}`.
- **W2, `weekJournal` unavailable (proposed, Vibhav to confirm).** Journal retention is still open and the journal already lives in `symptom_logs`. Load answers `{records: [], availability: 'unavailable', complete: false, message, pendingOperations}`; a write is refused (`failed`, code `unavailable`). `UNSTORED_RECORDS.weekJournal` stays true, so Clear Journal's tripwire (AC-282) does not fire.
- **W3, `homeTransitions` unavailable (proposed, Vibhav to confirm).** Production home changes run through the account service (`ProductionHomeTransitionFlow`), "not arbitrary client row edits" (contract :507). Answered as W2; writes refused.
- **W4, attachments (proposed, Vibhav to confirm).** Private files are a later package. A write carrying a test `attachments` entry, an observation `photoAttachmentId` or a note `photoAttachment` is refused (`failed`, code `unavailable`, "Private files are not available yet. Nothing was saved."). Nothing is stored; loads therefore never carry one.
- **W5, reconcile.** `GET /api/operations?domain=workspace`: a succeeded receipt is answered with the CURRENT canonical rows of the collections it touched (the ledger keeps ids and revisions only); every other status carries `changes: {}` (the adapter requires it) and, for a reaped row, the route's own "did not finish" sentence.
- **W6, no collection revision (proposed, Vibhav to confirm).** The snapshot omits the optional `revision`; per-record revisions, checked inside the commit function, are the concurrency control. A sent `collectionRevision` is accepted and ignored (the client only echoes what a load gave it).
- **W7, limits (proposed, Vibhav to confirm).** Request body 1,000,000 bytes; a record 262,144 bytes as JSON; a collection 1,000 records and 1,500,000 bytes, so a load or a two-collection receipt stays under the 4.5 MB platform limit. Over a limit: `failed`, code `validation`, before anything is written.
- **W8, privacy clear all (proposed, Vibhav to confirm).** 0024 resets the profile rather than deleting it, so `on delete cascade` from profiles does not fire on clear all. 0026 adds an `after update` trigger on `public.operations` that, when a `privacy.clear.all` row moves from `pending` to `succeeded` (0024's step 7, inside the clear's transaction), deletes that household's workspace rows. So the delete commits with the clear or not at all, and 0024 is not edited. Counts: `workspace_privacy_counts` is merged into the inspect counts. Not fingerprinted (the fingerprint function's table list is 0024's): a workspace save between review and confirm is not detected, but clear all already refuses while any operation is pending. Clear Journal keeps the table (W2).
- **W9, clear-private refused (YOUR_TODO item 35, C11).** Before any claim: 200 `{status: 'failed', changes: {}, code: 'unavailable', reason: 'clear_unsupported'}` with "Use the privacy review in Settings to clear records. Nothing was deleted." There is one clearing path, `privacy.clear`.
- **W10, references (proposed, Vibhav to confirm).** A reference that a write ADDS or changes must name the caller's own record: `homeContextId` an owned home context; a test's `contextId` an owned home context or garden; `testId`, `testIds`, `reportId` an owned test; `assetId` an owned asset; `siteId` an owned garden. Another household's id is simply not found (`failed`, code `validation`). An unchanged reference is not re-checked, so deleting a test leaves an observation's link dangling, as the preview does.
- **W11, linked deletes.** Removing an `exploreNotes` record, alone or with `remove-notes`, also removes its case `exploreOutcomes/note-case:<id>` in the same commit (the preview's semantics, `HomeWorkspaceState.tsx:240-241,265`); both collections are returned. Other links are left alone.
- **W12, revisions and ids.** The server assigns revisions: 1 on create, stored + 1 on update. A create of an id that exists, or an update or remove at a revision that is not the stored one, is `failed` code `conflict` with the client's "This record changed." sentence; nothing is written. Record ids are 1 to 200 characters with no control characters; they are app-generated (`test-<uuid>`, `food-question-...`) and are the only record data in a ledger receipt.
- **W13, project guides stored as sent (proposed, Vibhav to confirm).** There is no project-generation service yet, so `exploreProjects.guide` is stored as the household's own copy after the client's structural check; provenance is not verified.
- **W14, one save at a time.** A command whose household already has an unsettled `workspace` operation is still accepted (the client locks itself); the commit function's per-record revision checks keep concurrent saves honest.

## Answers

- succeeded: `{operationId, status: 'succeeded', changes: {<collection>: <every row>}}`.
- refused: 200 `{operationId, status: 'failed', changes: {}, code, reason, message}`; replays answer the same body. Codes: `conflict` (stale or existing), `validation` (bad record, reference, limit), `unavailable` (flag, W2, W3, W4, W9).
- 400 for a malformed body, operation id, `Idempotency-Key` or `If-Match` mismatch; 409 for a reused id with different input or an abandoned replay; 503 (retryable) for a replay still pending; 503 `feature_unavailable` until 0026 (or 0017) is applied; 500 for a lost database answer (the client reconciles).

## Dropped or left

- Attachments (`attachments.*` routes and the `attachments` reconcile domain): W4.
- An OpenAPI contract file and a contracts test for B11: not written in this package.
- Server-authored home history for `homeTransitions`: W3.
