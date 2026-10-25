import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable } from '@/lib/operations';
import { isLunaUnavailable } from '@/lib/luna';
import { cancelProposal, isProposalsMissing, lunaActionsEnabled, lunaActionsOffMessage } from '@/lib/lunaActions';
import { operationAnswer, operationIdOf, parseReviewReference } from '@/lib/lunaActionsRoute';

/**
 * POST /api/luna/proposals/cancel  (registry `luna.proposal.cancel`, B20)
 *
 *   { id, proposalId, revision }, Idempotency-Key: <operationId>
 *     ->  200 { id: operationId, status: 'cancelled', conversation }
 *     ->  200 { id: operationId, status: 'failed', message, conversation }
 *
 * The person cancels a review Luna prepared. Nothing in My Week changes,
 * whatever the answer. Cancelling a cancelled review answers `cancelled`
 * again. A review that was already confirmed, one whose confirm is still being
 * checked, or one at another revision is a `failed` answer whose conversation
 * shows it as it is. Through the `luna` ledger, so a lost answer replays.
 * Off is a 200 `failed` with nothing read or claimed.
 */

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

    const outcome = await cancelProposal(supabaseAdmin, {
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
      status: outcome.status === 'cancelled' ? 'cancelled' : 'failed',
      reason: outcome.reason,
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
    if (operationId && (isProposalsMissing(err) || isLunaUnavailable(err) || isOperationsUnavailable(err))) {
      return NextResponse.json({ id: operationId, status: 'failed', message: lunaActionsOffMessage() }, { headers });
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`luna proposal cancel failed (request ${requestId}): ${err?.code ?? err?.name ?? 'Error'}`);
    return internalError(requestId);
  }
}
