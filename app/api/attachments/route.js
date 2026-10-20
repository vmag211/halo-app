import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { parseUuid } from '@/lib/validate';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { attachmentUploadLimiter, checkLimit } from '@/lib/ratelimit';
import { IMAGE_LIMITS, IMAGE_REFUSALS, processImage } from '@/lib/attachmentImage';
import {
  ATTACHMENT_COLLECTIONS,
  ATTACHMENT_KINDS,
  ATTACHMENT_LIMITS,
  ATTACHMENT_REFUSALS,
  ATTACHMENTS_DOMAIN,
  attachmentUsage,
  attachmentsEnabled,
  commitAttachment,
  descriptorOf,
  isAttachmentsUnavailable,
  overLimit,
  putObject,
  readAttachment,
  refusalForAttachmentError,
  reserveAttachmentObject,
  discardObject,
  storedAttachmentRefusal,
  uploadUnavailable,
} from '@/lib/attachmentStore';

/**
 * POST /api/attachments  (registry `attachments.upload`, runtime.ts:24)
 *
 *   multipart: file (its file name is the reviewed name), collection, recordId,
 *              metadataRemoved, reviewed, operationId; header Idempotency-Key
 *     ->  200 { id, revision, name, mime, bytes, status: 'ready', metadataRemoved: true }
 *
 * Stores one private photo for a Homeguard or Explore record (B14 plan,
 * Rulings A1 to A11). The answer is the client's HomeAttachment
 * (home-service.ts:31-35), which the adapter refuses unless it passes
 * `attachment()` (adapters.ts:15). No top-level `data` key.
 *
 * ORDER. Session; `Idempotency-Key`; the `attachments` and `workspace` flags
 * (off: 403, Ruling A6, before the body is read); the body, at most 10 MiB
 * and 64 KiB of form fields, read with a hard cap; the fields; the
 * household's upload budget (30 an hour, fail-open, Ruling A3); 0028's usage
 * read, which proves it is applied (else 403); then the image itself
 * (`processImage`): its own signature, sharp's decoder, the size and pixel
 * limits, and a re-encode that leaves every byte of metadata behind (Rulings
 * A2, A4). A file that fails is a 422 and nothing is recorded or stored.
 * Only then the ledger claim (domain `attachments`).
 *
 * THE COMMIT (Ruling A9). Inside the claim: an early limit answer, then
 * reserve_attachment_object queues the path `<owner>/<server uuid>` for
 * deletion BEFORE the bytes are written with the service role, then
 * commit_household_attachment records the file, clears that queue entry,
 * links a report to its test (the test's revision goes up by one, Ruling A7)
 * and settles this operation `succeeded` in one transaction. A refusal there
 * (the test is not this household's, a limit) deletes the object and is
 * stored, so a replay answers the same 422.
 *
 * THE ANSWERS: 200 the descriptor (a replay reads it again; a file removed
 * since is a 409); 422 for a stored refusal; 409 for a reused id with other
 * input or an abandoned replay; the retryable 503 for a replay still pending;
 * 500 for a lost database or storage answer, which this client reconciles
 * through GET /api/operations?domain=attachments. Log lines carry codes only,
 * never a file name, a path or a byte.
 */

export const maxDuration = 60;

/** The form: the image and five short fields. */
const MAX_BODY_BYTES = IMAGE_LIMITS.inputBytes + 64 * 1024;

const FIELDS = Object.freeze(['file', 'collection', 'recordId', 'metadataRemoved', 'reviewed', 'operationId']);

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const validText = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && !CONTROL.test(value) && !LONE_SURROGATE.test(value);

const MESSAGES = Object.freeze({
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  multipart: 'Send the file as multipart form data.',
  unreadable: 'The file could not be read.',
  tooLarge: 'This file is too large. Choose one up to 10 MiB.',
  unknownField: `Only ${FIELDS.join(', ')} can be sent.`,
  file: 'Choose one file.',
  collection: 'Choose tests, observations or exploreNotes.',
  recordId: 'That record id is not valid.',
  name: 'Give the file a name of up to 200 characters.',
  flag: 'metadataRemoved must be true or false.',
  reviewed: 'Review the file before storing it.',
  metadata: 'Remove the photo\'s metadata before storing it.',
  limited: 'Too many files were stored recently. Please try again later.',
  removed: 'This file was removed after it was stored. Refresh before trying again.',
  incomplete: 'That earlier upload did not finish, so nothing was stored. Try again.',
  mismatch: 'That request was already made with different details. Please try again.',
  inFlight: 'That upload is still being processed. Please check its status before trying again.',
  unrecognized: 'That earlier upload cannot be confirmed here. Refresh to see your files.',
});

const field = (name, code, message) => ({ field: name, code, message });

const conflict = (message, requestId, reason) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });

const refused = (message, requestId, reason) =>
  apiError({ status: 422, code: ERROR_CODES.VALIDATION_FAILED, message, fieldErrors: [field('file', reason, message)], retryable: false, requestId, extra: { reason } });

const inFlight = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message: MESSAGES.inFlight, retryable: true, requestId });

/** The body as a FormData, read with a hard cap whatever Content-Length claims. */
async function readForm(request) {
  const type = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(type)) return { ok: false, status: 400, code: ERROR_CODES.BAD_REQUEST, message: MESSAGES.multipart };
  const declared = request.headers.get('content-length');
  const tooLarge = { ok: false, status: 413, code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: MESSAGES.tooLarge };
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > MAX_BODY_BYTES) return tooLarge;
  const chunks = [];
  let total = 0;
  try {
    if (request.body) {
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return tooLarge;
        }
        chunks.push(value);
      }
    }
    const form = await new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), { headers: { 'content-type': type } }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, status: 400, code: ERROR_CODES.BAD_REQUEST, message: MESSAGES.unreadable };
  }
}

/** The six fields, exactly; the client's own rules first (adapters.ts:21). */
async function parseFields(form) {
  const errors = [];
  const keys = [...new Set([...form.keys()])];
  const unknown = keys.filter((key) => !FIELDS.includes(key)).sort();
  if (unknown.length) return { ok: false, status: 400, errors: unknown.map((key) => field(key, 'unknown_field', MESSAGES.unknownField)) };
  const one = (key) => { const all = form.getAll(key); return all.length === 1 ? all[0] : undefined; };

  const file = one('file');
  const collection = one('collection');
  const recordId = one('recordId');
  const metadataRemoved = one('metadataRemoved');
  const reviewed = one('reviewed');
  const operationId = parseUuid(typeof one('operationId') === 'string' ? one('operationId') : '');
  if (!operationId.ok) errors.push(field('operationId', operationId.code, operationId.message));
  if (!(file instanceof Blob) || typeof file.name !== 'string') errors.push(field('file', 'invalid_file', MESSAGES.file));
  else if (!validText(file.name, ATTACHMENT_LIMITS.nameLength)) errors.push(field('file', 'invalid_name', MESSAGES.name));
  else if (file.size < 1 || file.size > IMAGE_LIMITS.inputBytes) errors.push(field('file', 'too_large', MESSAGES.tooLarge));
  if (!ATTACHMENT_COLLECTIONS.includes(collection)) errors.push(field('collection', 'invalid_option', MESSAGES.collection));
  if (!validText(recordId, ATTACHMENT_LIMITS.idLength)) errors.push(field('recordId', 'invalid_id', MESSAGES.recordId));
  if (metadataRemoved !== 'true' && metadataRemoved !== 'false') errors.push(field('metadataRemoved', 'invalid_boolean', MESSAGES.flag));
  if (errors.length) return { ok: false, status: 400, errors };
  // The client's review rules (adapters.ts:21): reviewed always; a photo outside tests also metadata-free.
  if (reviewed !== 'true') return { ok: false, status: 422, errors: [field('reviewed', 'review_required', MESSAGES.reviewed)] };
  if (collection !== 'tests' && metadataRemoved !== 'true') {
    return { ok: false, status: 422, errors: [field('metadataRemoved', 'metadata_required', MESSAGES.metadata)] };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    ok: true,
    value: { operationId: operationId.value, collection, recordId, name: file.name, metadataRemoved: metadataRemoved === 'true', bytes },
  };
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' };
  try {
    const { userId } = await requireUser(request);

    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!key.ok) return validationError([field('Idempotency-Key', key.code, MESSAGES.idempotencyKey)], requestId);

    if (!attachmentsEnabled()) return uploadUnavailable(requestId);

    const body = await readForm(request);
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const parsed = await parseFields(body.form);
    if (!parsed.ok) {
      if (parsed.status === 400) return validationError(parsed.errors, requestId);
      return apiError({ status: 422, code: ERROR_CODES.VALIDATION_FAILED, message: parsed.errors[0].message, fieldErrors: parsed.errors, retryable: false, requestId });
    }
    const upload = parsed.value;
    if (upload.operationId !== key.value) {
      return validationError([field('operationId', 'idempotency_key_mismatch', MESSAGES.idempotencyMismatch)], requestId);
    }

    const allowed = await checkLimit(attachmentUploadLimiter, `attachments:${userId}`, { fallback: true, label: 'attachments limiter' });
    if (!allowed) return apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: MESSAGES.limited, requestId });

    // Proves 0028 before anything is claimed or processed.
    const usage = await attachmentUsage(supabaseAdmin, userId, upload.collection, upload.recordId);

    const processed = await processImage(upload.bytes);
    if (!processed.ok) return refused(IMAGE_REFUSALS[processed.reason], requestId, processed.reason);

    const input = {
      collection: upload.collection,
      recordId: upload.recordId,
      name: upload.name,
      metadataRemoved: upload.metadataRemoved,
      digest: createHash('sha256').update(upload.bytes).digest('hex'),
    };
    upload.bytes = null;
    const attachmentId = crypto.randomUUID();
    let committed = null;
    let reserved = null;

    const outcome = await runOperation(
      supabaseAdmin,
      { operationId: upload.operationId, profileId: userId, domain: ATTACHMENTS_DOMAIN, kind: ATTACHMENT_KINDS.upload, input },
      async () => {
        if (overLimit(usage, processed.bytes.length)) return storedAttachmentRefusal('limit');
        reserved = await reserveAttachmentObject(supabaseAdmin, { profileId: userId, operationId: upload.operationId, attachmentId });
        await putObject(supabaseAdmin, reserved, processed.bytes, processed.mime);
        try {
          committed = await commitAttachment(supabaseAdmin, {
            profileId: userId,
            operationId: upload.operationId,
            file: {
              attachmentId,
              collection: upload.collection,
              recordId: upload.recordId,
              name: upload.name,
              mime: processed.mime,
              bytes: processed.bytes.length,
              width: processed.width,
              height: processed.height,
            },
          });
          return committed.receipt;
        } catch (error) {
          const reason = refusalForAttachmentError(error);
          if (reason !== 'invalid_reference' && reason !== 'limit') throw error;
          // The object was written and has no row: it goes now, or with the sweep in an hour.
          await discardObject(supabaseAdmin, reserved);
          return storedAttachmentRefusal(reason);
        }
      },
    );

    const result = outcome.result;
    if (!result) {
      if (outcome.status === 'failed') return conflict(MESSAGES.incomplete, requestId, 'not_applied');
      return inFlight(requestId);
    }
    if (result.status === 'succeeded') {
      if (committed && !outcome.replayed) return NextResponse.json(committed.attachment, { headers });
      const file = typeof result.attachmentId === 'string' ? await readAttachment(supabaseAdmin, userId, result.attachmentId) : null;
      if (!file) return conflict(MESSAGES.removed, requestId, 'removed');
      return NextResponse.json(descriptorOf(file), { headers });
    }
    if (result.status === 'failed' && ATTACHMENT_REFUSALS[result.reason]) {
      return refused(ATTACHMENT_REFUSALS[result.reason].message, requestId, result.reason);
    }
    if (result.status === 'failed' && result.reason === ABANDONED_REASON) return conflict(MESSAGES.incomplete, requestId, 'abandoned');
    console.error(`attachment upload: unrecognized stored receipt (request ${requestId}, ledger status ${outcome.status})`);
    return conflict(MESSAGES.unrecognized, requestId, 'unrecognized_receipt');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isAttachmentsUnavailable(err) || isOperationsUnavailable(err)) return uploadUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`attachment upload failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
