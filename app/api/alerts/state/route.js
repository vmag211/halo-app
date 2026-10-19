import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import {
  OPERATION_INPUT_MISMATCH,
  isOperationsUnavailable,
  listUnresolvedOperations,
  runOperation,
} from '@/lib/operations';
import { isSettingsAlertsUnavailable, settingsAlertsUnavailable } from '@/lib/settingsAlerts';
import { applyAlertPatch, inboxItems, parseAlertStateBody, readAlertRows } from '@/lib/alertsInbox';

/**
 * POST /api/alerts/state  (`alerts.update`, B04 plan Task 2b)
 *
 *   { operationId, selection: [{ id, revision }], patch: { read?, dismissed? } }
 *     ->  { operationId, status, items, unresolvedOperations }
 *
 * The one way the production client changes an alert: "Mark as read", "Mark
 * all as read", dismiss, and Undo, which is an ordinary second change
 * ({dismissed:false} at the revision the dismiss returned), never a local
 * reversal and never a server-side "undo the last thing" (Ruling S6, digest
 * section 5.5). Opening an alert or following its destination changes nothing:
 * an alert is marked read only by an explicit change, which for the production
 * client is this route and nothing else.
 *
 * The answer is `AlertReceipt` (alerts-service.ts:4): `AlertSnapshot` plus the
 * caller's own `operationId` and a `status`. A succeeded receipt carries the
 * WHOLE inbox, the same `items` GET /api/alerts serves plus every selected row
 * whatever its age, because the client replaces its list with it and then
 * checks, with `alertReceiptCovers`, that every selected row came back at a
 * strictly higher revision with the patched fields equal to the patch.
 *
 * Revisions travel inside each selection row; there is no `If-Match` on this
 * operation (digest section 1.5) and none is read. The change is ALL OR
 * NOTHING (lib/alertsInbox.js, applyAlertPatch): one selected row that is
 * stale, or that is not the caller's, refuses the whole selection with a 409,
 * which the client reads as a conflict. Another household's id is the
 * identical 409 to an id that never existed, so the answer cannot be used to
 * find out whether an alert exists.
 *
 * Idempotency is the ledger from migration 0017 and nothing else, domain
 * `alerts`. The row is claimed before anything is read or written, so the same
 * `operationId` replays the first outcome without acting again (including a
 * first outcome of "conflict"), a dead attempt reads as `unknown`, and the same
 * id with a different selection or patch is a 409 rather than a wrong replay.
 * The precondition is checked inside the operation, after the claim, for the
 * reason POST /api/account/commands gives: the first attempt advances every
 * selected revision, so a replay necessarily carries what is now stale, and
 * checking first would answer a conflict where the contract requires the first
 * outcome.
 *
 * A refusal is a status, not a receipt body, for the direct call: the receipt
 * body is an inbox, and a `failed` receipt would only tell the person "The
 * update was not applied" where a conflict tells them the alerts changed. The
 * ledger still records it as `failed`, with the reason, so `GET
 * /api/operations` reports the truth and the client re-reads.
 *
 * Identity comes only from the verified session token, and every statement is
 * scoped to it on the query itself.
 *
 * Until migration 0021 (or 0017) is applied this answers a non-retryable 503
 * `feature_unavailable`, decided before the operation id is claimed and before
 * anything is read or written, so "nothing was changed" is true when it says
 * so (Ruling S10).
 */

/**
 * Bounds how long one attempt can run (route segment config). The ledger reads
 * a pending row as stale after DEFAULT_STALE_AFTER_MS (120 s), and a reaper may
 * then settle it as failed; a function that could still be running past that
 * point could settle the row a second time and overwrite the reaper's answer.
 * 60 s is under the 120 s window with room to spare, and far above what this
 * route needs (a handful of statements).
 */
export const maxDuration = 60;

/** At most 100 rows of `{"id":"<uuid>","revision":<n>}` plus the rest; well under this. */
const MAX_BYTES = 16384;

const MESSAGES = Object.freeze({
  conflict: 'These alerts changed. Reload them before trying again.',
  mismatch: 'That request was already made with different details. Please try again.',
  failed: 'That change did not complete. Reload your alerts to see where they stand.',
  abandoned: 'That change was stopped before it finished. Reload your alerts to see where they stand.',
  cancelled: 'That change was cancelled. Reload your alerts to see where they stand.',
});

/** 409, terminal: the client reads it as a conflict and reloads. */
function conflict(message, reason, requestId) {
  return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });
}

/**
 * The answer for an operation the ledger holds as failed or cancelled, on the
 * first attempt or on a replay, with the reason that is actually recorded:
 *
 *   stale_selection     this route refused the selection (applyAlertPatch).
 *   operation_abandoned the attempt never settled and was settled as failed
 *                       afterwards, `result: {status:'failed', reason:'abandoned'}`.
 *   operation_failed    the attempt threw (the ledger stores `result: null`),
 *                       or a failure reason this route does not know.
 *   operation_cancelled the ledger says cancelled.
 *
 * Always a 409, never a 5xx: the outcome is settled, so a replay must not look
 * like an outage that retrying could fix, and never "not found", because the
 * operation exists.
 */
function settledRefusal(outcome, requestId) {
  if (outcome.status === 'cancelled') return conflict(MESSAGES.cancelled, 'operation_cancelled', requestId);
  const reason = outcome.result?.reason;
  if (reason === 'stale_selection') return conflict(MESSAGES.conflict, 'stale_selection', requestId);
  if (reason === 'abandoned') return conflict(MESSAGES.abandoned, 'operation_abandoned', requestId);
  return conflict(MESSAGES.failed, 'operation_failed', requestId);
}

/** 409 for an operation id reused with different input: a client bug or an attack, never a replay. */
function operationMismatch(requestId) {
  return apiError({
    status: 409,
    code: ERROR_CODES.CONFLICT,
    message: MESSAGES.mismatch,
    retryable: false,
    requestId,
    extra: { reason: 'operation_mismatch' },
  });
}

/**
 * Proves 0021's alerts columns are there before the operation id is claimed,
 * scoped to the caller like every other statement here. Naming every column
 * makes a half-applied migration fail here too.
 */
async function requireAlertColumns(supabase, profileId) {
  const { error } = await supabase
    .from('alerts')
    .select('id, revision, category, target_tab, target_destination, target_learn', { count: 'exact', head: true })
    .eq('profile_id', profileId);
  if (error) throw error;
}

/**
 * Everything a succeeded receipt needs except the changed rows, read BEFORE
 * the write: the inbox page (newest first, dismissed included) and the
 * household's unsettled `alerts` operations.
 *
 * Why before. The ledger settles the operation only after `execute` returns
 * (lib/operations.js), and anything that throws in between makes it record
 * `failed` with no receipt. Once the compare-and-set has committed, that would
 * be false for good: the alert IS read, while a replay answers
 * "That change did not complete" and a reconcile tells the person "The update
 * was not applied." So nothing that can fail runs after the write. The write
 * returns the changed rows in full and the receipt is assembled from them and
 * from what is read here, in memory (receiptBody). If the settle itself then
 * fails, the row stays pending and is reaped later, which is the ledger's
 * documented trade-off.
 *
 * What it costs. The page is a few milliseconds older than the write: an
 * alert the daily job inserts in between is missing from this receipt and
 * appears on the next read, and an unselected row another writer changed in
 * between shows its earlier revision, so a change to it is a conflict and a
 * reload. Neither is a false claim about this operation.
 *
 * This operation's own ledger row is still `pending` here, so the inventory
 * necessarily lists it. It is taken out, and only it: the receipt IS this
 * operation's settlement, and the client parks `unresolvedOperations[0]` as
 * unknown and locks the inbox (ProductionAlerts.tsx:17), so leaving it in would
 * make every successful change lock the surface, and a reconcile through
 * GET /api/operations would replay the same receipt and lock it again. Every
 * other unsettled operation stays, exactly as listUnresolvedOperations returns
 * it (Ruling S1).
 *
 * That list is for the direct answer only (Ruling S14). The receipt the ledger
 * keeps carries `unresolvedOperations: []`: it is the record of this change,
 * replayed unchanged by a POST with the same id and by GET /api/operations,
 * and a list frozen into it would name operations long settled. Two
 * overlapping changes would then store receipts naming each other, and every
 * "check status" would park the other one, for ever.
 */
async function readReceiptContext(supabase, { profileId, operationId }) {
  const page = await readAlertRows(supabase, profileId);
  const unresolved = await listUnresolvedOperations(supabase, { profileId, domains: ['alerts'] });
  return { page, unresolvedOperations: unresolved.filter((id) => id !== operationId) };
}

/** The succeeded receipt, assembled in memory: it cannot fail. */
function receiptBody({ page, unresolvedOperations }, changedRows) {
  return { status: 'succeeded', items: inboxItems(page, changedRows), unresolvedOperations };
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

    const parsed = parseAlertStateBody(body.value);
    if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
    const { operationId, selection, patch } = parsed.value;

    // The client sends the same id in both places (runtime.ts:135). Two
    // different ids would make it unclear which attempt this is.
    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey !== null && idempotencyKey.trim().toLowerCase() !== operationId) {
      return validationError(
        [{
          field: 'operationId',
          code: 'idempotency_key_mismatch',
          message: 'The Idempotency-Key header and the operationId must be the same id.',
        }],
        requestId,
      );
    }

    await requireAlertColumns(supabaseAdmin, userId);

    let live = null;
    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId,
        profileId: userId,
        domain: 'alerts',
        kind: 'alerts.update',
        // Order-free: the same rows in another order are the same request.
        input: { selection: [...selection].sort((a, b) => (a.id < b.id ? -1 : 1)), patch },
      },
      async () => {
        const context = await readReceiptContext(supabaseAdmin, { profileId: userId, operationId });
        const result = await applyAlertPatch(supabaseAdmin, { profileId: userId, selection, patch });
        // Terminal, and recorded as what happened, so a replay answers the
        // same way. No inbox goes into a refusal: nothing changed.
        if (!result.ok) return { status: 'failed', reason: result.reason };
        // Nothing fallible from here to the settle (readReceiptContext). The
        // ledger keeps the receipt with [] and the live list waits for the answer.
        live = context.unresolvedOperations;
        return receiptBody({ ...context, unresolvedOperations: [] }, result.rows);
      },
    );

    // A replay of an operation still running, or that died before it settled
    // and has not been settled since, has no receipt to replay. `pending` and `unknown` are receipt statuses
    // the client understands: it parks the id and reconciles later through
    // GET /api/operations, which is neither a success nor a failure.
    // A settled refusal or failure, in either stored shape, is a terminal 409.
    if (outcome.status === 'failed' || outcome.status === 'cancelled') return settledRefusal(outcome, requestId);
    if (!outcome.result) return NextResponse.json({ operationId, status: outcome.status }, { headers });
    // The change this call made answers with the live list; a replay answers
    // with the stored receipt, whose list is [] (Ruling S14).
    if (!outcome.replayed && live) return NextResponse.json({ ...outcome.result, unresolvedOperations: live }, { headers });
    return NextResponse.json(outcome.result, { headers });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return operationMismatch(requestId);
    if (isSettingsAlertsUnavailable(err) || isOperationsUnavailable(err)) return settingsAlertsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: a database message is not for the person.
    console.error(`alerts state update failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
