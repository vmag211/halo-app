import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, readOperation, requestHash, runOperation } from '@/lib/operations';
import { CLEAR_SCOPES, fingerprintTables } from '@/lib/privacyInventory';
import { readReviewSelection, verifyReviewToken } from '@/lib/privacyToken';
import {
  PRIVACY_DOMAIN,
  PRIVACY_KINDS,
  PRIVACY_REFUSALS,
  clearHouseholdRecords,
  isPrivacyUnavailable,
  openPrivacy,
  privacyFingerprint,
  privacyRefusal,
  privacyUnavailable,
} from '@/lib/privacyStore';

/**
 * POST /api/privacy/clear (`privacy.clear`, B07 plan, Task 6)
 *
 *   { reviewToken, scope: 'journal' | 'all', operationId }
 *     ->  200 { operationId, status: 'succeeded', scope }
 *     ->  200 { operationId, status: 'failed', reason? }
 *
 * Clears the household's journal (symptom logs and season summaries, D-P4)
 * or every household record but the login (D-P1), through one database
 * function, clear_household_records (migration 0024, Ruling P3), that deletes,
 * resets the profile and settles this operation's own ledger row in one
 * transaction. So a deletion exists if and only if its operation is
 * `succeeded`, and every `failed` this route or the reaper can produce means
 * nothing was deleted, which is what the client then says ("The request was
 * not applied. Your data is unchanged.", ProductionPrivacy.tsx:23).
 *
 * THE BODY is exactly the three keys the client sends (ProductionPrivacy.tsx:24,
 * Ruling P7). There is no confirmation word on the wire: the typed DELETE is
 * the client's, and the review token is the server's proof that this
 * household reviewed this clear a few minutes ago (trap P-5). Any other key,
 * a `confirm` included, is a 400.
 *
 * The household is the verified session's (Ruling P1). X-Halo-Home-Context
 * is never read: the token binds the records through the fingerprint, which
 * covers home_contexts, and clear all removes every home anyway.
 *
 * Refusals (Ruling P15), in the order they are decided:
 *
 *   400  a body that is not exactly {reviewToken, scope, operationId}, a
 *        scope other than journal or all, an operationId that is not a UUID,
 *        an Idempotency-Key missing, not a UUID or not the operationId (after
 *        trim and lowercase, P17), any If-Match header, a token this server
 *        could not have minted, or a token minted for another scope. Nothing
 *        is read or recorded.
 *   413  a body over 4,096 bytes.
 *   503  feature_unavailable, not retryable: no usable HALO_PRIVACY_REVIEW_KEY,
 *        or 0024 (and with it 0017, which 0024 asserts at apply time) not
 *        applied. Decided before the claim, so nothing is recorded (P11).
 *   409  review_changed: the token was minted for another household, has
 *        expired, or the records it reviewed have changed since. Decided
 *        before the claim, so nothing is recorded; the client keeps the
 *        review open and the person reviews again.
 *   200  failed: the function refused after the claim, because the records
 *        changed between this route's check and its own (review_changed), or
 *        another request of this household is still pending, or a Luna answer
 *        is still being written (busy). Stored as {status: 'failed', reason}.
 *   500  anything else, including HALO_OPERATION_NOT_PENDING (the row was
 *        reaped before the function ran, P15). The client reconciles and
 *        reads the truth from GET /api/operations.
 *
 * REPLAYS. The token proves a review of the records as they were. After a
 * clear the records have changed, so a replay of the same request would fail
 * verification; that is why a token that does not verify is looked up in the
 * ledger before it is refused, and a request that was already recorded is
 * answered with its stored outcome instead (P15): succeeded as stored, either
 * failed shape (a refusal, a reap, an in-process throw) as 200 failed, a
 * pending or unknown row as the retryable 503 in-flight. The same id with a
 * different token is 409 operation_mismatch. An unverified token never
 * reaches runOperation, so it never claims or writes a ledger row, even when
 * the recorded row disappears between the lookup and the answer.
 *
 * THE RECEIPT carries no record content and no unresolvedOperations (P17):
 * {operationId, status, scope}, exactly what the function stored, and no
 * top-level `data` key, which the client would unwrap (runtime.ts:149).
 *
 * LOGS carry the request id and an error's code and message only, never a
 * token, a fingerprint or a row (P10).
 */

// The house ceiling for ledger routes, strictly under the staleness window
// (DEFAULT_STALE_AFTER_MS, 120 s), so a live clear is never reaped and then
// settled late. test/operationsMaxDuration.test.mjs enforces it.
export const maxDuration = 60;

/** A token, a scope and a UUID (Ruling P15). */
const MAX_BYTES = 4096;

/** The only keys the body may carry (Ruling P7). */
const BODY_KEYS = Object.freeze(['operationId', 'reviewToken', 'scope']);

/** The function's refusals that settle the operation as failed (P15); any other propagates. */
const SETTLES_FAILED = new Set(['HALO_REVIEW_CHANGED', 'HALO_BUSY']);

/** Reasons a stored failed receipt may carry back to the client: the two above and the reaper's. */
const REPLAYED_REASONS = new Set([PRIVACY_REFUSALS.HALO_REVIEW_CHANGED, PRIVACY_REFUSALS.HALO_BUSY, 'abandoned']);

/** Every server-authored string, none with an em dash (AGENTS.md, AC-012). */
const MESSAGES = Object.freeze({
  unknownField: `Only ${BODY_KEYS.join(', ')} can be sent.`,
  scope: 'Choose journal or all.',
  token: 'Review the data again before clearing it.',
  scopeMismatch: 'This review was for a different request. Review again.',
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  ifMatch: 'This request does not take an If-Match header.',
  reviewChanged: 'Your data changed since you reviewed it. Review again before clearing it.',
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

/** The answer for a recorded outcome, live or replayed alike. */
function receiptBody(operationId, outcome) {
  const result = outcome.result;
  if (!result) {
    // Settled with no receipt (an in-process throw): over, and under P3 nothing was deleted.
    if (outcome.status === 'failed') return { operationId, status: 'failed' };
    return null;
  }
  if (result.status === 'succeeded') return { operationId, status: 'succeeded', scope: result.scope };
  if (result.status === 'failed') {
    return { operationId, status: 'failed', ...(REPLAYED_REASONS.has(result.reason) ? { reason: result.reason } : {}) };
  }
  return null;
}

/** The response for a recorded outcome: its receipt, the in-flight 503, or a logged 500 for a receipt this route never writes. */
function outcomeResponse(operationId, outcome, requestId, headers) {
  const answer = receiptBody(operationId, outcome);
  if (answer) return NextResponse.json(answer, { headers });
  if (outcome.status === 'pending' || outcome.status === 'unknown') return inFlight(requestId);
  console.error(`privacy clear: unrecognized stored receipt (request ${requestId}, ledger status ${outcome.status})`);
  return internalError(requestId);
}

/**
 * The answer to a request whose token does not verify (P15, REPLAYS), with
 * no claim and nothing written: 409 review_changed when this household has
 * no privacy row under this id, 409 operation_mismatch when it has one for
 * a different request (compared by request_hash before anything else, so a
 * mismatched replay reaps nothing, as lib/operations.js replayExisting does),
 * and otherwise the row's own outcome through readOperation (which reaps it
 * if it is a stale pending claim). A row that vanishes between the two reads
 * (a purge, or a clear all deleting a journal receipt) is review_changed.
 */
async function answerRecorded({ userId, operationId, reviewToken, scope, requestId, headers }) {
  const { data: row, error } = await supabaseAdmin
    .from('operations')
    .select('request_hash')
    .eq('operation_id', operationId)
    .eq('profile_id', userId)
    .eq('domain', PRIVACY_DOMAIN)
    .maybeSingle();
  if (error) throw error;
  if (!row) return conflict(MESSAGES.reviewChanged, requestId, 'review_changed');
  if (row.request_hash && row.request_hash !== requestHash({ reviewToken, scope })) {
    return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
  }
  const recorded = await readOperation(supabaseAdmin, { operationId, profileId: userId, domain: PRIVACY_DOMAIN });
  if (!recorded) return conflict(MESSAGES.reviewChanged, requestId, 'review_changed');
  return outcomeResponse(operationId, recorded, requestId, headers);
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
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
    if (!CLEAR_SCOPES.includes(scope)) return badField('scope', 'invalid_enum', MESSAGES.scope, requestId);
    // Shape only: what the token claims is not trusted until it verifies below.
    const claimed = readReviewSelection(reviewToken);
    if (!claimed) return badField('reviewToken', 'invalid_token', MESSAGES.token, requestId);
    if (claimed.scope !== scope) return badField('scope', 'scope_mismatch', MESSAGES.scopeMismatch, requestId);

    // Availability before any claim (P11): the key, then 0024 (which asserts 0017).
    const reviewKey = await openPrivacy(supabaseAdmin);
    if (!reviewKey) return privacyUnavailable(requestId);

    // The fingerprint of the scope's tables now. A clear's tables depend on its
    // scope alone, so the token's groups (empty, trap P-3) play no part.
    const fingerprint = await privacyFingerprint(supabaseAdmin, { profileId: userId, tables: fingerprintTables(scope) });
    const verified = verifyReviewToken(reviewKey, reviewToken, { profileId: userId, fingerprint });
    if (!verified.ok) {
      if (verified.reason === 'unavailable') return privacyUnavailable(requestId);
      if (verified.reason === 'malformed') return badField('reviewToken', 'invalid_token', MESSAGES.token, requestId);
      // Never a claim on an unverified token (P15): a recorded request is
      // answered from the ledger as it stands, anything else is refused.
      return answerRecorded({ userId, operationId: operationId.value, reviewToken, scope, requestId, headers });
    }

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: PRIVACY_DOMAIN,
        kind: PRIVACY_KINDS[scope],
        input: { reviewToken, scope },
      },
      async () => {
        try {
          const { receipt } = await clearHouseholdRecords(supabaseAdmin, {
            profileId: userId,
            operationId: operationId.value,
            scope,
            fingerprint,
          });
          return receipt;
        } catch (error) {
          const refusal = privacyRefusal(error);
          if (refusal && SETTLES_FAILED.has(refusal.code)) return { status: 'failed', reason: refusal.reason };
          throw error;
        }
      },
    );

    return outcomeResponse(operationId.value, outcome, requestId, headers);
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isPrivacyUnavailable(err) || isOperationsUnavailable(err)) return privacyUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`privacy clear failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
