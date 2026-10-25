import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { parseUuid } from '@/lib/validate';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable } from '@/lib/operations';
import { isActionsUnavailable } from '@/lib/actionsStore';
import { isLunaUnavailable } from '@/lib/luna';
import { confirmOutcome, isProposalsMissing, lunaActionsEnabled, lunaActionsOffMessage } from '@/lib/lunaActions';
import { operationAnswer, parseReviewReference } from '@/lib/lunaActionsRoute';

/**
 * GET /api/luna/operations?id=<operationId>&proposalId=<id>&revision=<n>  (registry `luna.operation`, B20)
 *
 *   ->  200 { id, status: 'succeeded' | 'failed', message?, conversation }
 *   ->  200 { id, status: 'pending' | 'unknown' }
 *
 * What a confirm whose answer was lost came to, from the `actions` ledger
 * (the authority; GET /api/operations?domain=actions answers My Week's own
 * check from the same row). A confirm that never reached HALO is recorded
 * here as failed under its id, with the input that confirm would carry, so
 * it can never commit afterwards; the answer is then "nothing was changed".
 * A succeeded confirm marks its review applied if it was not yet. Another
 * household's operation or review is never reported: their review id is the
 * same "no longer available" as one that never existed, and their operation
 * id beside the caller's own review is the 409 any reused id is.
 */

export const maxDuration = 60;

const QUERY_KEYS = ['id', 'proposalId', 'revision'];

const unavailable = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: lunaActionsOffMessage(), retryable: false, requestId });

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    if (!lunaActionsEnabled()) return unavailable(requestId);

    const params = new URL(request.url).searchParams;
    const unknown = [...params.keys()].filter((name) => !QUERY_KEYS.includes(name));
    if (unknown.length) return validationError([{ field: unknown[0].slice(0, 40), code: 'unknown_field', message: `Only ${QUERY_KEYS.join(', ')} can be sent.` }], requestId);
    const operationId = parseUuid(params.get('id') ?? '');
    if (!operationId.ok) return validationError([{ field: 'id', code: operationId.code, message: 'Send the id of the confirmation to check.' }], requestId);
    const reference = parseReviewReference(
      request,
      { proposalId: params.get('proposalId') ?? undefined, revision: params.get('revision') ?? undefined },
      { requestId, idIsOperation: true },
    );
    if (!reference.ok) return reference.response;

    const outcome = await confirmOutcome(supabaseAdmin, {
      profileId: userId,
      operationId: operationId.value,
      proposalId: reference.proposalId,
      revision: reference.revision,
    });
    if (outcome.status === 'pending' || outcome.status === 'unknown') {
      return NextResponse.json({ id: operationId.value, status: outcome.status }, { headers: { ...headers, 'Cache-Control': 'private, no-store' } });
    }
    return await operationAnswer(supabaseAdmin, {
      profileId: userId,
      operationId: operationId.value,
      status: outcome.status,
      reason: outcome.reason,
      receipt: outcome.receipt,
      headers,
    });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message: 'That request is not this review\'s.', retryable: false, requestId, extra: { reason: 'operation_mismatch' } });
    }
    if (isProposalsMissing(err) || isLunaUnavailable(err) || isOperationsUnavailable(err) || isActionsUnavailable(err)) return unavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`luna operation read failed (request ${requestId}): ${err?.code ?? err?.name ?? 'Error'}`);
    return internalError(requestId);
  }
}
