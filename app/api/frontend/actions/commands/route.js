import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { featureDisabledReason, featureEnabled } from '@/lib/features';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, requestHash, runOperation } from '@/lib/operations';
import { ACTION_REFUSAL_MESSAGES, ACTION_REFUSAL_REASONS, parseActionCommand, planActionCommand } from '@/lib/actionRules';
import {
  ACTIONS_DOMAIN,
  ACTIONS_REFUSALS,
  actionCheckCode,
  actionCheckMessage,
  actionsRefusal,
  actionsUnavailable,
  commitActions,
  isActionsUnavailable,
  liveActionsSnapshot,
  readActionsState,
  unresolvedActionOperations,
} from '@/lib/actionsStore';

/**
 * POST /api/frontend/actions/commands  (registry `actions.commit`, runtime.ts:30)
 *
 *   { operationId, kind: 'add' | 'revise' | 'delete', ... }
 *     ->  200 { operationId, status: 'succeeded', snapshot: { actions, metas, preferences, unresolvedOperations } }
 *     ->  200 { operationId, status: 'failed', reason, message, revisions? }
 *
 * Saves a change to My Week: a new task, an edit, a completion, a move, a
 * delete, the weekly review, or a preference written with `changes: []` (B06
 * plan, Task 4). The client accepts a succeeded receipt only when its snapshot
 * passes `validActionSnapshot` AND carries the `unresolvedOperations` array
 * (adapters.ts:7), and then only when the snapshot shows the command took
 * effect (`actionReceiptCoversCommand`, action-service.ts:103-115). Otherwise
 * it marks the save unconfirmed and locks My Week (ExpandedPreviewState.tsx:94,
 * :103).
 *
 * ORDER. Session; the body (at most 4,000,000 bytes, a 413 above, Ruling H21:
 * the weekly planner sends every meta and a signature for every task); the
 * operation id; the `tasks` flag; `If-Match`; the whole command
 * (`parseActionCommand`, lib/actionRules.js); a read of the household's
 * snapshot, which also proves migration 0023 (and so 0017, which 0023 needs)
 * is applied; then the ledger claim. Everything before the claim records
 * nothing, so every 400 and the unavailable 503 leave no ledger row (Ruling
 * H11).
 *
 * THE OPERATION ID (Rulings H21, H27). It arrives twice: in the body (adapters.ts:10)
 * and as `Idempotency-Key` (runtime.ts:134). The body's is a UUID taken exactly
 * as sent and lowercased, never trimmed (the house rule, parseUuid); the header
 * is required, trimmed and lowercased, and must be the same id. `If-Match` is a
 * 400 `precondition_unsupported`: there is no snapshot revision to match, and
 * the client never sends one.
 *
 * FLAG OFF (Rulings H1, H17). After the operation id, and before anything is
 * read or claimed: 200 `{operationId, status: 'failed', message}` with the
 * capability's disabled reason. A 200 receipt, not a 5xx: a 5xx on a mutation
 * is `unknown_outcome` to this client (runtime.ts:144) and would lock My Week.
 *
 * THE COMMIT (Rulings H6, H8, H10). Inside the claimed operation: plan the
 * command against the snapshot with the client's own rules
 * (`planActionCommand`), which validates the WHOLE resulting snapshot before
 * anything is written (trap T5, Ruling H25), then call
 * commit_household_actions with the version that snapshot was read at. That
 * one call advances the household version, applies every write and settles
 * this operation's own ledger row as `succeeded`, in one transaction, so a
 * task write exists if and only if its operation is `succeeded` (H8). If
 * another save moved the version first (HALO_STALE_BASE), the snapshot is read
 * again and the command planned again from scratch, so the client's own
 * preconditions are re-checked every time; after the third lost race the
 * answer is `failed` `busy`. A command that changes nothing (an add of a key
 * already saved, `changes: []` with nothing else, a delete of an id this
 * household has no row for) writes nothing and answers `succeeded`.
 *
 * `execute` returns only ids, revisions and a reason code (Ruling H3), never a
 * title, a note or a preference, and never the unresolved list (Ruling S14: a
 * stored receipt carries `unresolvedOperations: []`; it is a historical record,
 * not a lock). The snapshot the commit function returned is kept in this
 * request, and the live list is read only after runOperation has returned, when
 * this operation's row is settled, and this operation's own id is filtered out
 * as well (trap T2, Ruling H16; the account bug, digest C1, was listing inside
 * `execute`).
 *
 * THE ANSWERS (Ruling H11):
 *   - succeeded: the snapshot the commit returned (read in its transaction), or
 *     for a replay the current one (Ruling H18), with the live list;
 *   - refused against stored state: 200 `{operationId, status: 'failed', reason,
 *     message}`, `reason` one of metadata_changed, stale_revision (with the
 *     current `revisions`), unknown_action, invalid_result (with the client's
 *     own sentence for the failing task), busy. The client shows `message`
 *     verbatim (ExpandedPreviewState.tsx:93). The ledger stores the reason, the
 *     revisions and, for invalid_result, the code of the sentence
 *     (`actionCheckCode`), so a replay answers the same body again;
 *   - a replay that meets a row settled `failed` this route did not refuse, in
 *     either shape: reaped (`reason: 'abandoned'`) is a terminal 409
 *     `abandoned`, no receipt at all (an in-process throw) a terminal 409
 *     `not_applied`; any other stored receipt a terminal 409
 *     `unrecognized_receipt`, logged without content;
 *   - a replay that meets a row still `pending` (or `unknown`): the retryable
 *     503 "still being processed";
 *   - the same id with different input: 409 `operation_mismatch`.
 *
 * A failure inside the commit (a database error, a lost response) is a 500,
 * which this client reads as "not confirmed" and reconciles through
 * GET /api/operations; H8 makes that answer true. The log line carries only the
 * error's code and message, never its `details` or `hint`, which for a CHECK or
 * unique violation hold the failing row, and so a task's own text.
 *
 * Identity comes only from the verified token. `X-Halo-Home-Context` is
 * ignored: tasks belong to the household, not a home (Ruling H2). No top-level
 * `data` key in any body (runtime.ts:149-153 would unwrap it). Until migration
 * 0023 or 0017 is applied the answer is a non-retryable 503
 * `feature_unavailable`, decided before the claim.
 */

// The house ceiling for ledger routes, strictly under the staleness window
// (DEFAULT_STALE_AFTER_MS, 120 s), so a live commit is never reaped and then
// written by a late settle. test/operationsMaxDuration.test.mjs enforces it.
export const maxDuration = 60;

/** Sized for the weekly planner's whole map under the platform's 4.5 MB request limit (Ruling H21). */
const MAX_BYTES = 4_000_000;

/** Lost races with another save before answering `busy` (Ruling H10). */
const MAX_ATTEMPTS = 3;

/** The refusals this route records and replays as a 200 `failed` receipt (Ruling H11). */
const REFUSAL_REASONS = new Set(Object.values(ACTION_REFUSAL_REASONS));

/**
 * Every server-authored string (Ruling H22), none with an em dash. The
 * refusal sentences are lib/actionRules.js's ACTION_REFUSAL_MESSAGES, shared
 * with the planner; these are the route's own.
 */
const MESSAGES = Object.freeze({
  incomplete: 'That earlier save did not finish, so nothing was saved. Reload My Week before trying again.',
  unrecognized: 'That earlier save cannot be confirmed here. Nothing new was saved. Reload My Week to see your tasks.',
  mismatch: 'That request was already made with different details. Please try again.',
  inFlight: 'That save is still being processed. Please check its status before trying again.',
  ifMatch: 'This request does not take an If-Match header.',
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  tooDeep: 'This value is nested too deeply to save.',
});

/** 503 for an attempt on this id that has not settled: the outcome is not known yet. Retryable. */
const inFlight = (requestId) =>
  apiError({
    status: 503,
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: MESSAGES.inFlight,
    retryable: true,
    requestId,
  });

/** A terminal 409, carrying why for a log and a contract test. */
const conflict = (message, requestId, reason) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });

/**
 * The ledger's copy of a refusal: the reason, the current revisions for
 * `stale_revision`, the sentence's code for `invalid_result`, and the empty
 * unresolved list every stored receipt carries (Ruling S14). Codes and ids
 * only (Ruling H3).
 */
function storedRefusal(plan) {
  const receipt = { status: 'failed', reason: plan.reason };
  if (plan.reason === ACTION_REFUSAL_REASONS.STALE_REVISION) receipt.revisions = plan.revisions;
  if (plan.reason === ACTION_REFUSAL_REASONS.INVALID_RESULT) {
    const check = actionCheckCode(plan.message);
    if (check) receipt.check = check;
  }
  receipt.unresolvedOperations = [];
  return receipt;
}

/** The 200 refusal answered from a stored one, live or replayed alike. */
function refusalBody(operationId, stored) {
  const message = stored.reason === ACTION_REFUSAL_REASONS.INVALID_RESULT
    ? actionCheckMessage(stored.check) ?? ACTION_REFUSAL_MESSAGES.invalid_result
    : ACTION_REFUSAL_MESSAGES[stored.reason];
  return {
    operationId,
    status: 'failed',
    reason: stored.reason,
    message,
    ...(stored.reason === ACTION_REFUSAL_REASONS.STALE_REVISION && Array.isArray(stored.revisions) ? { revisions: stored.revisions } : {}),
  };
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    // The receipt has to carry the caller's own operation id, so it is read
    // before anything that answers with one (the account precedent).
    const operationId = parseUuid(body.value.operationId);
    if (!operationId.ok) {
      return validationError([{ field: 'operationId', code: operationId.code, message: operationId.message }], requestId);
    }
    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!key.ok) {
      return validationError([{ field: 'Idempotency-Key', code: key.code, message: MESSAGES.idempotencyKey }], requestId);
    }
    if (key.value !== operationId.value) {
      return validationError(
        [{ field: 'operationId', code: 'idempotency_key_mismatch', message: MESSAGES.idempotencyMismatch }],
        requestId,
      );
    }

    // Off by default, and off means off: nothing read, nothing claimed.
    if (!featureEnabled('tasks')) {
      return NextResponse.json(
        { operationId: operationId.value, status: 'failed', message: featureDisabledReason('tasks') },
        { headers },
      );
    }

    if (request.headers.get('if-match') !== null) {
      return validationError([{ field: 'If-Match', code: 'precondition_unsupported', message: MESSAGES.ifMatch }], requestId);
    }

    const parsed = parseActionCommand(body.value);
    if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
    const { command } = parsed;

    // The ledger fingerprints the body without its operation id. requestHash
    // recurses, and a field the planner ignores (a seed's extra keys) can still
    // be nested deeply enough to overflow it, so it is tried here first, where
    // the answer is a 400 and nothing is recorded (Ruling H26).
    const input = { ...body.value };
    delete input.operationId;
    try {
      requestHash(input);
    } catch {
      return validationError([{ field: 'body', code: 'unstorable_depth', message: MESSAGES.tooDeep }], requestId);
    }

    // Proves 0023 (and with it 0017) before the claim, and is the first
    // attempt's base. A version that moves before the commit is caught there.
    let state = await readActionsState(supabaseAdmin, userId);
    let committedSnapshot = null;

    const outcome = await runOperation(
      supabaseAdmin,
      { operationId: operationId.value, profileId: userId, domain: ACTIONS_DOMAIN, kind: 'actions.commit', input },
      async () => {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
          if (!state) state = await readActionsState(supabaseAdmin, userId);
          const plan = planActionCommand(state.snapshot, command);
          if (!plan.ok) return storedRefusal(plan);
          if (plan.noop) {
            committedSnapshot = state.snapshot;
            return { status: 'succeeded', affected: [], removed: [], unresolvedOperations: [] };
          }
          try {
            const committed = await commitActions(supabaseAdmin, {
              profileId: userId,
              operationId: operationId.value,
              baseVersion: state.version,
              writes: plan.writes,
            });
            committedSnapshot = committed.snapshot;
            return { ...committed.receipt, unresolvedOperations: [] };
          } catch (error) {
            if (actionsRefusal(error) !== ACTIONS_REFUSALS.STALE_BASE) throw error;
            state = null;
          }
        }
        return storedRefusal({ reason: ACTION_REFUSAL_REASONS.BUSY });
      },
    );

    const result = outcome.result;
    if (!result) {
      // Settled with no receipt: an earlier attempt threw. Over, never to settle again.
      if (outcome.status === 'failed') return conflict(MESSAGES.incomplete, requestId, 'not_applied');
      return inFlight(requestId);
    }
    if (result.status === 'succeeded') {
      // Listed only now, with this operation's row settled, and its own id
      // left out whatever the row says (trap T2).
      const snapshot = outcome.replayed
        ? await liveActionsSnapshot(supabaseAdmin, userId, operationId.value)
        : {
          ...committedSnapshot,
          unresolvedOperations: await unresolvedActionOperations(supabaseAdmin, userId, { exclude: [operationId.value] }),
        };
      return NextResponse.json({ operationId: operationId.value, status: 'succeeded', snapshot }, { headers });
    }
    if (result.status === 'failed' && REFUSAL_REASONS.has(result.reason)) {
      return NextResponse.json(refusalBody(operationId.value, result), { headers });
    }
    // Reaped: the claim never settled within the ledger's window.
    if (result.status === 'failed' && result.reason === ABANDONED_REASON) {
      return conflict(MESSAGES.incomplete, requestId, 'abandoned');
    }
    // A receipt this route never writes. Not replayed, and not called
    // not_applied either, because what it did is not known here. The request
    // id and the ledger status only: a receipt this route did not write could
    // hold anything.
    console.error(`actions commit: unrecognized stored receipt (request ${requestId}, ledger status ${outcome.status})`);
    return conflict(MESSAGES.unrecognized, requestId, 'unrecognized_receipt');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isActionsUnavailable(err)) return actionsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // Code and message only: a Postgres error's details and hint can hold the
    // failing row, and so a task's own text.
    console.error(`actions commit failed (request ${requestId}):`, err?.code ?? '', err?.message ?? String(err));
    return internalError(requestId);
  }
}
