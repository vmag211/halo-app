# B20 Luna acts in the app, through a review the person confirms

Decision implemented: **Vibhav, 2026-10-25: Luna should act in the app.** This supersedes "Option A, Luna does not act" (2026-10-18, B03). Decision 2 (2026-10-19, no household data to the model provider) and B09 C13 (notes, Journal entries and household members are never sent) still stand, and this package keeps both. Branch `vmag211/luna-actions`. Rulings use the prefix **A20-**.

## What it does

Scope is My Week tasks: add a task (title, optional date and time, optional estimate), move one, mark one complete or not done, save one for later. One task per review. Reminders are out of scope and Luna never offers one.

1. The person writes to Luna. A cheap deterministic check (`looksLikeTaskRequest`) decides whether the message could be a task request. Only then is the model asked for the message's **intent as JSON** (`composeTaskIntent`), given the person's message and nothing else: no history, no date, no task.
2. The server resolves the date words itself (My Week's zone, `America/New_York`) and finds the task itself, against the household's own tasks (`readActionsState`). Several matches become choices; none, a plain sentence.
3. Luna answers with a fixed sentence ("I prepared this change to My Week for you to review. Nothing changes until you confirm it.") and a **review** (`luna_proposals`, migration 0035) shown as the frontend's existing proposal block.
4. The person can edit the review's fields (`luna.proposal.edit`), cancel it (`luna.proposal.cancel`) or confirm it (`luna.confirm`). Only the confirm changes My Week.
5. A confirm whose answer was lost is answered from the ledger (`luna.operation`).

Endpoints, at the paths and methods the frontend registry already declares (`lib/frontend/production/runtime.ts`), answering with the frontend's own validators' shapes (`luna-service.ts`), so no frontend change was needed:

| Operation | Route | Answer |
| --- | --- | --- |
| `luna.proposal.edit` | `POST /api/luna/proposals/edit` | `LunaProposal` at the new revision; 400 named field; 404; 409; 403 off |
| `luna.proposal.cancel` | `POST /api/luna/proposals/cancel` | `LunaOperation` `cancelled` or `failed`, with the conversation |
| `luna.confirm` | `POST /api/luna/tools/confirm` | `LunaOperation` `succeeded`, `failed` or `pending`, with the conversation when settled |
| `luna.operation` | `GET /api/luna/operations` | `LunaOperation` from the `actions` ledger |

## Rulings

- **A20-1, flag.** `HALO_FEATURE_LUNA_ACTIONS` (`lunaActions`), off by default; it also needs `HALO_FEATURE_LUNA` and `HALO_FEATURE_TASKS` on and 0035 applied. Off, or 0035 missing, Luna behaves as before: no intent call, no read of `luna_proposals`, the B03 prompt rule and output guard unchanged, `tools: []`. The four routes refuse with nothing read or claimed (mutations a 200 `failed` receipt, because a 5xx on a mutation is "unknown" to the client; the edit a 403 `feature_unavailable`; the status read a 503).
- **A20-2, one write path.** A confirm turns the review into an ordinary `actions.commit` command (`proposalCommandBody`), checked by `parseActionCommand` and committed by `lib/actionsCommit.js` `commitCommand`, the code the actions route itself now calls (moved there unchanged). It runs inside an `actions` ledger claim under the client's operation id, kind `luna.confirm`, so 0023's commit settles that row in its own transaction (H8), My Week locks on it while it is unsettled, and `GET /api/operations?domain=actions` reconciles it.
- **A20-3, exact revision.** A review has its own revision, raised by every edit; a confirm, cancel or edit names the revision it saw, and a stale one is refused. A review of an existing task also carries the task's revision and its planning-details signature, sent as the command's revision and `expectedMetadata`, so a task changed in My Week after the review is refused (`stale_revision` or `metadata_changed`, said as "This task changed since Luna prepared the review").
- **A20-4, duplicates.** The same operation id replays its first outcome. Another id for a review already applied answers `succeeded` and writes nothing. A new task is saved under `luna:task:<review id>`, so it can never be added twice. A second confirm while the first is unsettled is refused (`confirm_pending`).
- **A20-5, a confirm that never arrived.** `luna.operation` for an id the ledger has never seen claims it as `failed` (`not_received`) with the very input that confirm would carry, so a late confirm on that id replays "nothing changed" and can never commit. A new confirm (a new id) is still possible.
- **A20-6, expiry and retention.** A review can be confirmed or edited for 30 minutes. Its row is deleted one day after it expires: whenever a household's new review is written, and by the daily cron for everyone (`luna_proposals_purged`). Clearing the conversation, clear all and account deletion remove them by cascade.
- **A20-7, what reaches the provider.** The intent call carries the person's message only. Every sentence Luna writes for a review is a fixed constant with no task content. Choices carry task titles (they are buttons), so each starts with `LUNA_CHOICE_PREFIX` ("Use this task: "), a picked choice is answered with no model call, and `lib/luna.js` never sends such a turn as history or uses it for retrieval, even with the flag off. `context` in `luna.capabilities` stays all false: the model is not given tasks. Notes, Journal entries and household members are not read at all.
- **A20-8, Luna never claims a change.** With the flag on, the answer prompt uses `ACTION_RULE_PROPOSALS` and the guard `withoutActionOffers(text, { actions: true })` keeps a sentence that only says Luna prepares a change for review, and still removes any claim of a change, any reminder or notification offer and any direct offer to act. Off, both are exactly the B03 ones.
- **A20-9, honest failures.** An intent call that fails or returns something unreadable is answered "I could not prepare that change just now. Nothing was changed.", with no review stored and no answer call made; only the failure's shape is logged. A move with no clear date is prepared with an empty date field and cannot be confirmed until the person chooses one.

## Gaps (not built here)

- Frontend copy: with tools on, the Luna welcome offers starters for projects, volunteering and tests (`ProductionLunaConversation.tsx`), none of which is a task; a task starter such as "Add a task to My Week" would fit better (a Yogi item).
- The B03 OpenAPI document still describes the answering half only; a B20 contract document for the four operations was not written (the route suite pins the shapes with the real validators).
- Notes, projects and other records: Luna cannot act on them; only My Week tasks.
- Deleting or renaming a task through Luna is not offered (the intent call answers "none").
