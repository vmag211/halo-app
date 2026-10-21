import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { readWorkspaceCollections } from '@/lib/workspaceStore';
import { readIfMatch } from '@/lib/ifMatch';
import {
  ATTACHMENT_COLLECTIONS,
  ATTACHMENT_KINDS,
  ATTACHMENT_REFUSALS,
  ATTACHMENTS_DOMAIN,
  UNAVAILABLE_MESSAGE,
  attachmentsEnabled,
  commitRemoval,
  isAttachmentsUnavailable,
  readAttachment,
  refusalForAttachmentError,
  storedAttachmentRefusal,
  sweepAttachmentObjects,
} from '@/lib/attachmentStore';

/**
 * POST /api/attachments/remove  (registry `attachments.remove`, runtime.ts:27)
 *
 *   { id, revision, operationId }, Idempotency-Key = operationId, If-Match = revision
 *     ->  200 { operationId, status: 'succeeded', changes: {<collection>: [every row]} }
 *     ->  200 { operationId, status: 'failed', changes: {}, code, reason, message }
 *
 * Removes one of the caller's files at its exact revision (B14 Ruling A8;
 * contract :549, "Removal has its own captured file revision and durable
 * operation ID and is reconciled in the `attachments` domain"). The adapter
 * accepts the answer only through `receipt()` (adapters.ts:16,25): the same
 * operationId, a known status and `changes` that pass `validHomeChanges` for
 * EVERY status. A success always carries the canonical rows of the file's
 * collection (contract :551, "Do not return a successful attachment removal
 * without canonical changes"): the record that held it no longer references
 * it (its revision goes up by one) and its entered results remain.
 *
 * ORDER. Session; the body (4,096 bytes, exactly these three keys); the ids
 * and `Idempotency-Key`; `If-Match`, which must equal the revision when sent;
 * the flags (off: a 200 failed receipt, Ruling A6, nothing read); a read of
 * the file through 0028, which proves it is applied (else the same failed
 * receipt); then the ledger claim. Inside it: not this household's (or gone)
 * is `not_found`, another revision `stale_revision`, both stored and
 * replayed; otherwise remove_household_attachment deletes the row, unlinks
 * the record, queues the object and settles the operation in one
 * transaction. The object is then deleted at once, best effort; whatever is
 * missed stays queued for the daily sweep (Ruling A9).
 *
 * 409 for a reused id with other input or an abandoned replay; the retryable
 * 503 for a replay still pending; 500 for a lost database answer, which this
 * client reconciles. Log lines carry codes only.
 */

export const maxDuration = 60;

const BODY_KEYS = Object.freeze(['id', 'revision', 'operationId']);

const MESSAGES = Object.freeze({
  unknownField: `Only ${BODY_KEYS.join(', ')} can be sent.`,
  revision: 'The file revision is not valid.',
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  ifMatch: 'The If-Match header must carry the file revision.',
  incomplete: 'That earlier removal did not finish, so nothing was removed. Try again.',
  mismatch: 'That request was already made with different details. Please try again.',
  inFlight: 'That removal is still being processed. Please check its status before trying again.',
  unrecognized: 'That earlier removal cannot be confirmed here. Refresh to see your files.',
});

const conflict = (message, requestId, reason) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });

const inFlight = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message: MESSAGES.inFlight, retryable: true, requestId });

const unavailableReceipt = (operationId) => ({ operationId, status: 'failed', changes: {}, code: 'unavailable', message: UNAVAILABLE_MESSAGE });

const refusalReceipt = (operationId, reason) => ({
  operationId, status: 'failed', changes: {}, code: ATTACHMENT_REFUSALS[reason].code, reason, message: ATTACHMENT_REFUSALS[reason].message,
});

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: 4096 });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key)).sort();
    if (unknown.length) return validationError(unknown.map((key) => ({ field: key, code: 'unknown_field', message: MESSAGES.unknownField })), requestId);

    const operationId = parseUuid(body.value.operationId);
    if (!operationId.ok) return validationError([{ field: 'operationId', code: operationId.code, message: operationId.message }], requestId);
    const id = parseUuid(typeof body.value.id === 'string' ? body.value.id.toLowerCase() : body.value.id);
    if (!id.ok) return validationError([{ field: 'id', code: id.code, message: id.message }], requestId);
    const revision = body.value.revision;
    if (!Number.isSafeInteger(revision) || revision < 1 || revision >= 2147483647) {
      return validationError([{ field: 'revision', code: 'invalid_revision', message: MESSAGES.revision }], requestId);
    }
    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!key.ok) return validationError([{ field: 'Idempotency-Key', code: key.code, message: MESSAGES.idempotencyKey }], requestId);
    if (key.value !== operationId.value) {
      return validationError([{ field: 'operationId', code: 'idempotency_key_mismatch', message: MESSAGES.idempotencyMismatch }], requestId);
    }
    const ifMatch = readIfMatch(request);
    if (ifMatch !== null && ifMatch.trim() !== String(revision)) {
      return validationError([{ field: 'If-Match', code: 'precondition_mismatch', message: MESSAGES.ifMatch }], requestId);
    }

    if (!attachmentsEnabled()) return NextResponse.json(unavailableReceipt(operationId.value), { headers });

    let existing;
    try {
      existing = await readAttachment(supabaseAdmin, userId, id.value);
    } catch (err) {
      if (isAttachmentsUnavailable(err)) return NextResponse.json(unavailableReceipt(operationId.value), { headers });
      throw err;
    }

    let committed = null;
    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: ATTACHMENTS_DOMAIN,
        kind: ATTACHMENT_KINDS.remove,
        input: { id: id.value, revision },
      },
      async () => {
        if (!existing) return storedAttachmentRefusal('not_found');
        if (existing.revision !== revision) return storedAttachmentRefusal('stale_revision');
        try {
          committed = await commitRemoval(supabaseAdmin, { profileId: userId, operationId: operationId.value, attachmentId: id.value, expectedRevision: revision });
          return committed.receipt;
        } catch (error) {
          const reason = refusalForAttachmentError(error);
          if (reason === 'not_found' || reason === 'stale_revision') return storedAttachmentRefusal(reason);
          throw error;
        }
      },
    );
    existing = null;

    const result = outcome.result;
    if (!result) {
      if (outcome.status === 'failed') return conflict(MESSAGES.incomplete, requestId, 'not_applied');
      return inFlight(requestId);
    }
    if (result.status === 'succeeded') {
      let changes;
      if (committed && !outcome.replayed) {
        changes = committed.changes;
        try {
          await sweepAttachmentObjects(supabaseAdmin, { profileId: userId });
        } catch (err) {
          console.error(`attachment remove: the object sweep failed; it stays queued (request ${requestId}):`, loggableError(err));
        }
      } else {
        const names = (Array.isArray(result.collections) ? result.collections : []).filter((name) => ATTACHMENT_COLLECTIONS.includes(name));
        changes = names.length ? await readWorkspaceCollections(supabaseAdmin, userId, names) : {};
      }
      return NextResponse.json({ operationId: operationId.value, status: 'succeeded', changes }, { headers });
    }
    if (result.status === 'failed' && ATTACHMENT_REFUSALS[result.reason]) {
      return NextResponse.json(refusalReceipt(operationId.value, result.reason), { headers });
    }
    if (result.status === 'failed' && result.reason === ABANDONED_REASON) return conflict(MESSAGES.incomplete, requestId, 'abandoned');
    console.error(`attachment remove: unrecognized stored receipt (request ${requestId}, ledger status ${outcome.status})`);
    return conflict(MESSAGES.unrecognized, requestId, 'unrecognized_receipt');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isAttachmentsUnavailable(err) || isOperationsUnavailable(err)) {
      return apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: UNAVAILABLE_MESSAGE, retryable: false, requestId });
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`attachment remove failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
