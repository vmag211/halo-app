import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { readIfMatch } from '@/lib/ifMatch';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable } from '@/lib/operations';
import { isLunaUnavailable } from '@/lib/luna';
import { editProposal, isProposalsMissing, lunaActionsEnabled, lunaActionsOffMessage } from '@/lib/lunaActions';
import { operationIdOf } from '@/lib/lunaActionsRoute';

/**
 * POST /api/luna/proposals/edit  (registry `luna.proposal.edit`, B20)
 *
 *   { proposalId, revision, fields: { name: value } }, X-Halo-If-Match: <revision>
 *     ->  200 LunaProposal (the review at its new revision)
 *     ->  400 a field My Week would refuse, named
 *     ->  404 not this household's review (the same answer as one that never existed)
 *     ->  409 the review moved on, expired, was confirmed or cancelled
 *     ->  403 feature_unavailable while the capability is off
 *
 * The person corrects a review before confirming it: a new task's title,
 * date, time or estimate, or the new date and time of a move. Nothing in My
 * Week changes. The review's revision rises, and the client confirms that new
 * revision (ProductionLunaConversation.tsx `act('edit')` replaces the
 * proposal it holds with this answer). Every value is checked with My Week's
 * own rules, so a review that saves is one My Week will load.
 */

export const maxDuration = 60;

const BODY_MAX_BYTES = 16_384;
const BODY_KEYS = ['proposalId', 'revision', 'fields'];

const refusal = (status, reason, message, requestId) =>
  apiError({ status, code: status === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });

const MESSAGES = Object.freeze({
  review_gone: 'This review is no longer available.',
  review_changed: 'This review changed. Check the latest version before editing it.',
  review_closed: 'This review can no longer be edited. Ask Luna to prepare it again.',
  not_finished: 'That edit did not finish. Ask Luna to prepare the change again.',
});

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    if (!lunaActionsEnabled()) {
      return apiError({ status: 403, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: lunaActionsOffMessage(), retryable: false, requestId });
    }
    const key = operationIdOf(request);
    if (!key.ok) {
      return validationError([{ field: 'Idempotency-Key', code: key.code, message: 'Send an Idempotency-Key header carrying this request\'s own id.' }], requestId);
    }
    const body = await readJsonBody(request, { maxBytes: BODY_MAX_BYTES });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const value = body.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return validationError([{ field: 'body', code: 'invalid_body', message: 'Send the edit as a JSON object.' }], requestId);
    }
    const unknown = Object.keys(value).filter((name) => !BODY_KEYS.includes(name));
    if (unknown.length) return validationError([{ field: unknown[0].slice(0, 40), code: 'unknown_field', message: `Only ${BODY_KEYS.join(', ')} can be sent.` }], requestId);
    const proposalId = parseUuid(value.proposalId);
    if (!proposalId.ok) return validationError([{ field: 'proposalId', code: proposalId.code, message: 'Send the id of the review.' }], requestId);
    if (!Number.isInteger(value.revision) || value.revision < 1) {
      return validationError([{ field: 'revision', code: 'invalid_revision', message: 'revision must be a whole number of 1 or more.' }], requestId);
    }
    const header = readIfMatch(request);
    if (header !== null && header.trim() !== String(value.revision)) {
      return refusal(409, 'review_changed', MESSAGES.review_changed, requestId);
    }
    const fields = value.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0 || Object.keys(fields).length > 20) {
      return validationError([{ field: 'fields', code: 'invalid_fields', message: 'Send the fields you changed.' }], requestId);
    }

    const outcome = await editProposal(supabaseAdmin, {
      profileId: userId,
      operationId: key.value,
      proposalId: proposalId.value,
      revision: value.revision,
      fields,
    });
    if (outcome.proposal) {
      return NextResponse.json(outcome.proposal, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } });
    }
    if (outcome.fieldErrors) return validationError(outcome.fieldErrors, requestId);
    return refusal(outcome.status, outcome.reason, MESSAGES[outcome.reason] ?? MESSAGES.review_changed, requestId);
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return refusal(409, 'operation_mismatch', 'That request id was already used for a different edit.', requestId);
    }
    if (isProposalsMissing(err) || isLunaUnavailable(err) || isOperationsUnavailable(err)) {
      return apiError({ status: 403, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: lunaActionsOffMessage(), retryable: false, requestId });
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`luna proposal edit failed (request ${requestId}): ${err?.code ?? err?.name ?? 'Error'}`);
    return internalError(requestId);
  }
}
