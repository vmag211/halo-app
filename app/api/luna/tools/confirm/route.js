import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable } from '@/lib/operations';
import { isActionsUnavailable } from '@/lib/actionsStore';
import { isLunaUnavailable } from '@/lib/luna';
import { confirmProposal, isProposalsMissing, lunaActionsEnabled, lunaActionsOffMessage } from '@/lib/lunaActions';
import { operationAnswer, operationIdOf, parseReviewReference } from '@/lib/lunaActionsRoute';

/**
 * POST /api/luna/tools/confirm  (registry `luna.confirm`, B20)
 *
 *   { id, proposalId, revision }, Idempotency-Key: <operationId>, X-Halo-If-Match: <revision>
 *     ->  200 { id: operationId, status: 'succeeded', conversation }
 *     ->  200 { id: operationId, status: 'failed', message, conversation }
 *     ->  200 { id: operationId, status: 'pending' }
 *
 * The person confirms a review Luna prepared. THIS IS THE ONLY STEP THAT
 * CHANGES MY WEEK, and it changes it through the one task write path: the
 * review becomes an ordinary `actions.commit` command (lib/lunaActions.js
 * proposalCommandBody), parsed by the same rules, planned and committed by
 * lib/actionsCommit.js inside an `actions` ledger claim under the client's own
 * operation id. So the revision checks, the ledger row, My Week's own lock on
 * an unsettled save and GET /api/operations' reconcile are the ones a save in
 * My Week has. The review is bound to its exact revision: a stale one, an
 * expired one or a cancelled one is a 200 `failed` with nothing written, and
 * the conversation it carries shows the review as it is now.
 *
 * DUPLICATES. The same operation id again replays its first outcome (the
 * ledger). Another id for a review already confirmed answers `succeeded` and
 * writes nothing more; a new task is saved under a key derived from the
 * review, so confirming one twice can never add it twice.
 *
 * A 5xx after the claim means "not known": the client keeps the review's
 * operation id and asks GET /api/luna/operations, which answers from the
 * ledger. Off (HALO_FEATURE_LUNA_ACTIONS, `luna` or `tasks` off) is a 200
 * `failed` with nothing read or claimed: a 5xx on a mutation would lock the
 * review as unknown.
 */

// Under the ledger's 120-second staleness window (test/operationsMaxDuration.test.mjs).
export const maxDuration = 60;

const BODY_MAX_BYTES = 4096;

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  let operationId = null;
  try {
    const { userId } = await requireUser(request);

    const key = operationIdOf(request);
    if (!key.ok) {
      return validationError([{ field: 'Idempotency-Key', code: key.code, message: 'Send an Idempotency-Key header carrying this request\'s own id.' }], requestId);
    }
    operationId = key.value;

    if (!lunaActionsEnabled()) {
      return NextResponse.json({ id: operationId, status: 'failed', message: lunaActionsOffMessage() }, { headers });
    }

    const body = await readJsonBody(request, { maxBytes: BODY_MAX_BYTES });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const reference = parseReviewReference(request, body.value, { requestId });
    if (!reference.ok) return reference.response;

    const outcome = await confirmProposal(supabaseAdmin, {
      profileId: userId,
      operationId,
      proposalId: reference.proposalId,
      revision: reference.revision,
    });
    if (outcome.status === 'pending' || outcome.status === 'unknown') {
      return NextResponse.json({ id: operationId, status: 'pending' }, { headers });
    }
    return await operationAnswer(supabaseAdmin, {
      profileId: userId,
      operationId,
      status: outcome.status === 'succeeded' ? 'succeeded' : 'failed',
      reason: outcome.reason,
      receipt: outcome.receipt,
      headers,
    });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return apiError({
        status: 409,
        code: ERROR_CODES.CONFLICT,
        message: 'That request id was already used for a different change.',
        retryable: false,
        requestId,
        extra: { reason: 'operation_mismatch' },
      });
    }
    // A table that is not there: nothing could have been committed.
    if (operationId && (isProposalsMissing(err) || isLunaUnavailable(err) || isOperationsUnavailable(err) || isActionsUnavailable(err))) {
      return NextResponse.json({ id: operationId, status: 'failed', message: lunaActionsOffMessage() }, { headers });
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // Code and message only: a Postgres error's details can hold a task's title.
    console.error(`luna confirm failed (request ${requestId}): ${err?.code ?? err?.name ?? 'Error'}`);
    return internalError(requestId);
  }
}
