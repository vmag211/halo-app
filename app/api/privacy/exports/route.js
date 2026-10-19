import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { checkLimit, privacyLimiter } from '@/lib/ratelimit';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, readOperation, requestHash, runOperation } from '@/lib/operations';
import { fingerprintTables } from '@/lib/privacyInventory';
import { privacyReviewKey, readReviewSelection, verifyReviewToken } from '@/lib/privacyToken';
import {
  PRIVACY_DOMAIN,
  isPrivacyUnavailable,
  privacyFingerprint,
  privacyUnavailable,
  probePrivacySchema,
} from '@/lib/privacyStore';
import {
  EXPORT_MAX_RESPONSE_BYTES,
  PRIVACY_EXPORT_KIND,
  buildExportDocument,
  privacyLimitKey,
  rebuildExportFile,
  responseBytes,
  withExportFile,
} from '@/lib/privacyExport';

/**
 * POST /api/privacy/exports (`privacy.export`, B07 plan, Task 5)
 *
 *   { reviewToken, scope: 'export', operationId }
 *     ->  200 { operationId, status: 'succeeded', file: { name, mime, text } }
 *     ->  200 { operationId, status: 'failed', reason? }
 *
 * Builds the export a review showed (inspect, Task 4) and hands it back
 * inline: the client saves `file` with downloadWeekFile and checks it first
 * (ProductionPrivacy.tsx:23): mime exactly application/json, text a string of
 * at most 10,485,760 characters, a name matching /^halo[-\w]*\.(json|csv)$/.
 * The name is `halo-export-YYYY-MM-DD.json` and names no household (UI-146).
 *
 * THE FILE IS STORED NOWHERE (P8, trap P-8). runOperation stores whatever
 * `execute` returns in operations.result, so `execute` returns only the
 * minimal receipt {status: 'succeeded', scope: 'export', selection: {groups,
 * privateText}}, two group names and a boolean, and the file it built stays in
 * this request's closure. A lost answer is rebuilt from that selection and the
 * current rows, inside ten minutes of the export (P9): here on a replay of the
 * same request, and in GET /api/operations on a reconcile. After the window
 * the answer is `succeeded` without `file`, which the client shows as "The
 * export is not ready to download. Check its status." until a reload.
 *
 * SIZE (P8). Every answer that carries a file is measured whole, as sent, and
 * must be at most 4,000,000 bytes. An export that outgrew the cap since its
 * review is refused after the claim as 200 {status: 'failed', reason:
 * 'too_large'}, which is true: an export changes nothing, so "The request was
 * not applied. Your data is unchanged." is what the client says. A rebuild
 * that no longer fits is answered without its file.
 *
 * THE BODY is exactly the three keys the client sends (ProductionPrivacy.tsx:24,
 * Ruling P7); the selection lives in the signed token (trap P-4). The
 * household is the verified session's (P1); X-Halo-Home-Context is never read.
 *
 * Refusals (P15), in the order they are decided:
 *
 *   400  a body that is not exactly {reviewToken, scope, operationId}, a scope
 *        other than export, an operationId that is not a UUID, an
 *        Idempotency-Key missing, not a UUID or not the operationId (after
 *        trim and lowercase, P17), any If-Match header, a token this server
 *        could not have minted, or a token minted for a clear. Nothing is read
 *        or recorded.
 *   413  a body over 4,096 bytes.
 *   503  feature_unavailable, not retryable: no usable HALO_PRIVACY_REVIEW_KEY,
 *        or 0024 (which asserts 0017 at apply time) not applied (P11).
 *   429  the household's privacy budget, shared with inspect (30 an hour,
 *        fail-open, P17), is spent. Nothing is recorded.
 *   409  review_changed: the token was minted for another household, has
 *        expired, or the records it reviewed changed since (only the tables a
 *        person's own actions write are bound, P6: a daily score written by
 *        the app since the review does not refuse). Nothing is recorded; the
 *        client keeps the review open.
 *   409  operation_mismatch: this id was already used for a different request.
 *   200  failed too_large (above).
 *   500  anything else; the client reconciles.
 *
 * REPLAYS (P15, Task 6's rule). A token that does not verify NEVER reaches
 * runOperation: this household's privacy row under this id is read, compared
 * by request_hash first, and answered as recorded, or the request is the 409
 * review_changed with nothing written. A recorded succeeded export is answered
 * under P9 (a rebuilt file within ten minutes, without one after); either
 * failed shape (too_large, a reap, an in-process throw) is 200 failed; a
 * pending or unknown row is the retryable 503 in-flight. A token that still
 * verifies (an export changes nothing, so it does within its ten minutes)
 * goes through runOperation, whose replay compares the request first; the
 * recorded outcome is then answered the same way. Either way a replay never
 * runs a second export, only P9's rebuild.
 *
 * No `data` key and no unresolvedOperations in any body (P17). Logs carry the
 * request id and an error's code and message only, never a token, a
 * fingerprint, a row or a file (P10).
 */

// The house ceiling for ledger routes, strictly under the staleness window
// (DEFAULT_STALE_AFTER_MS, 120 s), so a live export is never reaped and then
// settled late. test/operationsMaxDuration.test.mjs enforces it.
export const maxDuration = 60;

/** A token, a scope and a UUID (Ruling P15). */
const MAX_BYTES = 4096;

/** The only keys the body may carry (Ruling P7). */
const BODY_KEYS = Object.freeze(['operationId', 'reviewToken', 'scope']);

const EXPORT_SCOPE = 'export';

/** Why a stored export failed, when it may say: outgrown since review, or reaped. */
const TOO_LARGE_REASON = 'too_large';
const REPLAYED_REASONS = new Set([TOO_LARGE_REASON, 'abandoned']);

/** Every server-authored string, none with an em dash (AGENTS.md, AC-012). */
const MESSAGES = Object.freeze({
  unknownField: `Only ${BODY_KEYS.join(', ')} can be sent.`,
  scope: 'This request is for an export.',
  token: 'Review the export again before downloading it.',
  scopeMismatch: 'This review was for a different request. Review again.',
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  ifMatch: 'This request does not take an If-Match header.',
  limited: 'Too many privacy requests. Please try again later.',
  reviewChanged: 'Your data changed since you reviewed it. Review the export again.',
  mismatch: 'That request was already made with different details. Please try again.',
  inFlight: 'That request is still being processed. Please check its status before trying again.',
});

const badField = (field, code, message, requestId) => validationError([{ field, code, message }], requestId);

/** 409 the client reads as a conflict ("Review the latest version"), carrying why for a log and a test. */
const conflict = (message, requestId, reason) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });

/** 503 for an attempt on this id that has not settled: the outcome is not known yet. Retryable. */
const inFlight = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message: MESSAGES.inFlight, retryable: true, requestId });

/** The answer for a recorded outcome, without its file: `{operationId, status, reason?}`, or null for no answer. */
function receiptBody(operationId, result, status) {
  if (!result) {
    // Settled with no receipt (an in-process throw): over, and an export changes nothing.
    return status === 'failed' ? { operationId, status: 'failed' } : null;
  }
  if (result.status === 'succeeded') return { operationId, status: 'succeeded' };
  if (result.status === 'failed') {
    return { operationId, status: 'failed', ...(REPLAYED_REASONS.has(result.reason) ? { reason: result.reason } : {}) };
  }
  return null;
}

/**
 * The response for a recorded outcome (`readOperation`'s shape): a succeeded
 * export with its file rebuilt under P9, a failed one as 200 failed, the
 * in-flight 503, or a logged 500 for a receipt this route never writes.
 */
async function recordedResponse({ operationId, recorded, profileId, requestId, headers }) {
  const answer = receiptBody(operationId, recorded.result, recorded.status);
  if (answer?.status === 'succeeded') {
    const file = await rebuildExportFile(supabaseAdmin, { profileId, selection: recorded.result.selection, createdAt: recorded.createdAt });
    return NextResponse.json(withExportFile(answer, file), { headers });
  }
  if (answer) return NextResponse.json(answer, { headers });
  if (recorded.status === 'pending' || recorded.status === 'unknown') return inFlight(requestId);
  console.error(`privacy export: unrecognized stored receipt (request ${requestId}, ledger status ${recorded.status})`);
  return internalError(requestId);
}

/**
 * The answer to a request whose token does not verify, with no claim and
 * nothing written (Task 6's rule): 409 review_changed when this household has
 * no privacy row under this id, 409 operation_mismatch when it has one for a
 * different request (compared by request_hash before anything else, so a
 * mismatched replay reaps nothing), and otherwise the row's own outcome
 * through readOperation (which reaps it if it is a stale pending claim). A row
 * that vanishes between the two reads (the 24-hour purge) is review_changed.
 */
async function answerRecorded({ userId, operationId, reviewToken, requestId, headers }) {
  const { data: row, error } = await supabaseAdmin
    .from('operations')
    .select('request_hash')
    .eq('operation_id', operationId)
    .eq('profile_id', userId)
    .eq('domain', PRIVACY_DOMAIN)
    .maybeSingle();
  if (error) throw error;
  if (!row) return conflict(MESSAGES.reviewChanged, requestId, 'review_changed');
  if (row.request_hash && row.request_hash !== requestHash({ reviewToken, scope: EXPORT_SCOPE })) {
    return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
  }
  const recorded = await readOperation(supabaseAdmin, { operationId, profileId: userId, domain: PRIVACY_DOMAIN });
  if (!recorded) return conflict(MESSAGES.reviewChanged, requestId, 'review_changed');
  return recordedResponse({ operationId, recorded, profileId: userId, requestId, headers });
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  // The file is the household's own data: never cached anywhere.
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });

    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key)).sort();
    if (unknown.length > 0) {
      return validationError(unknown.map((key) => ({ field: key, code: 'unknown_field', message: MESSAGES.unknownField })), requestId);
    }

    const operationId = parseUuid(body.value.operationId);
    if (!operationId.ok) return badField('operationId', operationId.code, operationId.message, requestId);
    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!key.ok) return badField('Idempotency-Key', key.code, MESSAGES.idempotencyKey, requestId);
    if (key.value !== operationId.value) {
      return badField('operationId', 'idempotency_key_mismatch', MESSAGES.idempotencyMismatch, requestId);
    }
    if (request.headers.get('if-match') !== null) {
      return badField('If-Match', 'precondition_unsupported', MESSAGES.ifMatch, requestId);
    }

    const { scope, reviewToken } = body.value;
    if (scope !== EXPORT_SCOPE) return badField('scope', 'invalid_enum', MESSAGES.scope, requestId);
    // Shape only: what the token claims is not trusted until it verifies below.
    const claimed = readReviewSelection(reviewToken);
    if (!claimed) return badField('reviewToken', 'invalid_token', MESSAGES.token, requestId);
    if (claimed.scope !== scope) return badField('scope', 'scope_mismatch', MESSAGES.scopeMismatch, requestId);

    // Availability before any claim (P11): the key, then 0024 (which asserts 0017).
    const reviewKey = privacyReviewKey();
    if (!reviewKey) return privacyUnavailable(requestId);
    const probe = await probePrivacySchema(supabaseAdmin);
    if (!probe.available) return privacyUnavailable(requestId);

    // One budget with inspect (P17): each is a full read of the household. Fail-open.
    const allowed = await checkLimit(privacyLimiter, privacyLimitKey(userId), { fallback: true, label: 'privacy limiter' });
    if (!allowed) return apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: MESSAGES.limited, requestId });

    // The fingerprint of the claimed selection's tables now; the MAC decides whether the claim is true.
    const fingerprint = await privacyFingerprint(supabaseAdmin, { profileId: userId, tables: fingerprintTables(scope, claimed.groups) });
    const verified = verifyReviewToken(reviewKey, reviewToken, { profileId: userId, fingerprint });
    if (!verified.ok) {
      if (verified.reason === 'unavailable') return privacyUnavailable(requestId);
      if (verified.reason === 'malformed') return badField('reviewToken', 'invalid_token', MESSAGES.token, requestId);
      // Never a claim on an unverified token (P15): a recorded request is
      // answered from the ledger as it stands, anything else is refused.
      return answerRecorded({ userId, operationId: operationId.value, reviewToken, requestId, headers });
    }

    const selection = { groups: verified.groups, privateText: verified.privateText };
    // The answer this request built, kept here and never returned to the ledger (trap P-8).
    let delivered = null;
    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: PRIVACY_DOMAIN,
        kind: PRIVACY_EXPORT_KIND,
        input: { reviewToken, scope },
      },
      async () => {
        const built = await buildExportDocument(supabaseAdmin, { profileId: userId, ...selection });
        const answer = built.tooLarge ? null : { operationId: operationId.value, status: 'succeeded', file: built.file };
        if (!answer || responseBytes(answer) > EXPORT_MAX_RESPONSE_BYTES) return { status: 'failed', reason: TOO_LARGE_REASON };
        delivered = answer;
        return { status: 'succeeded', scope: EXPORT_SCOPE, selection };
      },
    );

    if (!outcome.replayed) {
      if (delivered && outcome.status === 'succeeded') return NextResponse.json(delivered, { headers });
      const answer = receiptBody(operationId.value, outcome.result, outcome.status);
      if (answer) return NextResponse.json(answer, { headers });
      console.error(`privacy export: unrecognized receipt (request ${requestId}, status ${outcome.status})`);
      return internalError(requestId);
    }

    // A replay: the recorded row, read again for when it was recorded (P9's window).
    const recorded = await readOperation(supabaseAdmin, { operationId: operationId.value, profileId: userId, domain: PRIVACY_DOMAIN })
      ?? { status: outcome.status, result: outcome.result, createdAt: null };
    return recordedResponse({ operationId: operationId.value, recorded, profileId: userId, requestId, headers });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isPrivacyUnavailable(err) || isOperationsUnavailable(err)) return privacyUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`privacy export failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
