import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import {
  ABANDONED_REASON,
  OPERATION_INPUT_MISMATCH,
  isOperationsUnavailable,
  operationsUnavailable,
  runOperation,
} from '@/lib/operations';

/**
 * POST /api/week/changes/acknowledge  (registry `week.acknowledge`, runtime.ts:32)
 *
 *   { operationId, id, version, actionId }
 *     ->  200 { operationId, status: 'failed', reason: 'unknown_change', message }
 *
 * "Reviewed" on a change in the My Week strip. B06 rulings H4 and H19: this
 * route VALIDATES, then REFUSES, every time. GET /api/week/changes has never
 * issued a change (no source exists, H4), so every `(id, version)` a caller can
 * name is unknown, and acknowledging something that was never shown cannot be
 * true. It never answers `succeeded`, so the receipt the client would need to
 * carry `acknowledged` (WeekUpdates.tsx:23, trap T11) can never be missing it.
 *
 * WHY A 200 RECEIPT AND NOT A 4xx. The client checks the receipt inline
 * (WeekUpdates.tsx:23): `operationId` matching and `status` in failed or
 * cancelled clears its lock and shows its own "The update was not applied. You
 * can try again." That is exactly true here. A 5xx would instead lock the strip
 * as `unknown_outcome`, and a 4xx would show a generic error message.
 *
 * WHY THE LEDGER, for a request that changes nothing. A refusal recorded in
 * domain `week-updates` is what lets a timed-out acknowledgement reconcile:
 * the client's next "Reviewed" becomes `operations.read` for the same id
 * (WeekUpdates.tsx:17,23), which then answers `failed` instead of a 404 the
 * client would keep as a lock (digest 4.6 item 5). The stored receipt is
 * `{status: 'failed', reason: 'unknown_change'}` and the operation id: nothing
 * from the request goes in (H3), and `message` is derived from the reason when
 * answering, never stored.
 *
 * THE BODY is exactly what the client sends,
 * `{operationId, id: change.id, version: change.version, actionId: change.actionId}`
 * (WeekUpdates.tsx:23), checked against the client's own bounds before
 * anything is recorded (H11): `id` a string of 1 to 240 and `version` 1 to 100
 * (UTF-16 length, as `usableWeekChanges` measures it, week-planning.ts:30), and
 * `actionId` a UUID, because a task id is a UUID (0023) and nothing else can
 * name one. Any other key is refused. No task table is read, so a real task id
 * and another household's answer identically: the route is no existence
 * oracle, and it works with migration 0023 absent.
 *
 * TRANSPORT (H21). `Idempotency-Key` is required, must be a UUID, and must be
 * the body's `operationId` (trimmed and lowercased); the operation id arrives
 * in both (runtime.ts:134, WeekUpdates.tsx:23). `If-Match` is refused: there
 * is no revision to match and the client never sends one.
 * `X-Halo-Home-Context` is ignored (H2). Not behind the `tasks` flag (H17).
 * Every refusal above is a 400 decided before the ledger claim, so nothing is
 * recorded. A body over 2,048 bytes is a 413.
 *
 * REPLAYS (H11), answered from the ledger without acting again:
 *   - this route's own refusal: the same 200 receipt;
 *   - a row settled `failed` that this route did not refuse, in either shape:
 *     reaped (`{status: 'failed', reason: 'abandoned'}`) is a terminal 409
 *     `abandoned`; no receipt at all (an in-process throw) or a reason this
 *     route never writes is a terminal 409 `not_applied`. Terminal, because
 *     that attempt is over and will never settle into anything else;
 *   - a row still `pending` (or `unknown`, past its window and not reaped): the
 *     retryable 503 "still being processed";
 *   - the same id with different input: 409 `operation_mismatch`.
 *
 * Until migration 0017 is applied the claim fails and the route is a
 * non-retryable 503 `feature_unavailable`, before anything is recorded.
 */

// The house ceiling for ledger routes, strictly under the staleness window
// (DEFAULT_STALE_AFTER_MS, 120 s), so a live claim is never reaped and then
// overwritten by a late settle. test/operationsMaxDuration.test.mjs enforces it.
export const maxDuration = 60;

/** Four short fields (H21). */
const MAX_BYTES = 2048;

/** The only keys the body may carry, in the order the client sends them. */
const BODY_KEYS = Object.freeze(['operationId', 'id', 'version', 'actionId']);

/** The client's own bounds on what it could have shown (week-planning.ts:30). */
const MAX_ID_LENGTH = 240;
const MAX_VERSION_LENGTH = 100;

/** The one reason this route records. */
const UNKNOWN_CHANGE = 'unknown_change';

/**
 * Every server-authored string (H22), none with an em dash. The client shows
 * its own copy for the receipt; `message` is for any other reader.
 */
const MESSAGES = Object.freeze({
  [UNKNOWN_CHANGE]: 'That update is not available to review, so nothing was changed.',
  incomplete: 'That earlier review did not finish, so nothing was changed. Please try again.',
  mismatch: 'That request was already made with different details. Please try again.',
  inFlight: 'That request is still being processed. Please check its status before trying again.',
  ifMatch: 'This request does not take an If-Match header.',
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  unknownField: `Only ${BODY_KEYS.join(', ')} can be sent.`,
  textRequired: 'This field cannot be empty.',
  invalidText: 'Enter some text.',
});

/** A string of 1 to `max` UTF-16 units, measured as the client measures it. */
function boundedString(field, value, max) {
  if (typeof value !== 'string') return { field, code: 'invalid_text', message: MESSAGES.invalidText };
  if (value.length === 0) return { field, code: 'text_required', message: MESSAGES.textRequired };
  if (value.length > max) return { field, code: 'text_too_long', message: `Use ${max} characters or fewer.` };
  return null;
}

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

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key)).sort();
    if (unknown.length > 0) {
      return validationError(
        unknown.map((key) => ({ field: key, code: 'unknown_field', message: MESSAGES.unknownField })),
        requestId,
      );
    }

    const operationId = parseUuid(body.value.operationId);
    const actionId = parseUuid(body.value.actionId);
    const fieldErrors = [
      operationId.ok ? null : { field: 'operationId', code: operationId.code, message: operationId.message },
      boundedString('id', body.value.id, MAX_ID_LENGTH),
      boundedString('version', body.value.version, MAX_VERSION_LENGTH),
      actionId.ok ? null : { field: 'actionId', code: actionId.code, message: actionId.message },
    ].filter(Boolean);
    if (fieldErrors.length > 0) return validationError(fieldErrors, requestId);

    // No precondition exists to match (H21, trap T12), and a client sending one
    // does not know what it is asking for.
    if (request.headers.get('if-match') !== null) {
      return validationError(
        [{ field: 'If-Match', code: 'precondition_unsupported', message: MESSAGES.ifMatch }],
        requestId,
      );
    }

    // Required (H21): the ledger is the only idempotency mechanism, and the
    // header and the body must name the same attempt.
    const idempotencyKey = request.headers.get('idempotency-key');
    const key = parseUuid((idempotencyKey ?? '').trim().toLowerCase());
    if (!key.ok) {
      return validationError(
        [{ field: 'Idempotency-Key', code: key.code, message: MESSAGES.idempotencyKey }],
        requestId,
      );
    }
    if (key.value !== operationId.value) {
      return validationError(
        [{ field: 'operationId', code: 'idempotency_key_mismatch', message: MESSAGES.idempotencyMismatch }],
        requestId,
      );
    }

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: 'week-updates',
        kind: 'week.acknowledge',
        input: { id: body.value.id, version: body.value.version, actionId: actionId.value },
      },
      // No change was ever issued (H4, H19), so there is nothing to look up:
      // no task table and no other household's row is read. The receipt is a
      // reason code only (H3).
      async () => ({ status: 'failed', reason: UNKNOWN_CHANGE }),
    );

    if (!outcome.result) {
      // Settled with no receipt: an earlier attempt threw. Over, never to settle again.
      if (outcome.status === 'failed') return conflict(MESSAGES.incomplete, requestId, 'not_applied');
      return inFlight(requestId);
    }
    if (outcome.result.status === 'failed' && outcome.result.reason === UNKNOWN_CHANGE) {
      return NextResponse.json(
        {
          operationId: operationId.value,
          status: 'failed',
          reason: UNKNOWN_CHANGE,
          message: MESSAGES[UNKNOWN_CHANGE],
        },
        { headers },
      );
    }
    // Reaped: the claim never settled within the ledger's window.
    if (outcome.result.reason === ABANDONED_REASON) return conflict(MESSAGES.incomplete, requestId, 'abandoned');
    // A receipt this route never writes. Not replayed: the client would trust
    // a `succeeded` one, and nothing here can stand behind it.
    return conflict(MESSAGES.incomplete, requestId, 'not_applied');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isOperationsUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`week acknowledge failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
