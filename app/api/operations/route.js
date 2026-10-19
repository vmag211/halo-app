import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError, apiError, ERROR_CODES } from '@/lib/apiErrors';
import { parseUuid, parseEnum } from '@/lib/validate';
import {
  readOperation,
  isOperationsUnavailable,
  operationsUnavailable,
  OPERATION_DOMAINS,
  UNAUTHENTICATED_DOMAIN,
} from '@/lib/operations';
import { featureEnabled } from '@/lib/features';
import { ACTIONS_DOMAIN, actionsUnavailable, isActionsUnavailable, liveActionsSnapshot } from '@/lib/actionsStore';

/**
 * GET /api/operations?operationId=<uuid>&domain=<domain>
 *
 * What actually happened to a mutation whose response the caller lost.
 *
 *   200 { operationId, domain, kind, status, result, created_at }
 *
 * `status` is one of succeeded, failed, cancelled, pending, unknown. The first
 * three are settled and carry `result`, the canonical receipt the original
 * route returned, replayed verbatim so the client can finish what it started.
 * `pending` means the work is genuinely still running. `unknown` means the
 * attempt was recorded but never settled and has outstripped its window: the
 * honest answer when a process died, and specifically NOT a failure, because
 * the effect may well have applied. In practice this route reaps such a row as
 * it reads it, so it answers `failed` with reason `abandoned`
 * (lib/operations.js, reapIfAbandoned); `unknown` remains only when that reap
 * could not run.
 *
 * A 404 means this household has no such operation in this domain. That is
 * different from `failed`, and the difference matters: the client must not read
 * "never recorded" as "did not happen". Another household's operation id is a
 * 404 too, with nothing said about whose it is.
 *
 * The owner comes only from the verified session token. The one domain that
 * accepts no session is `recovery`, which runs before the caller has an
 * identity; those rows are keyed by the operation id alone and carry no owner,
 * so they are read through the recovery routes rather than here.
 *
 * Until migration 0017 is applied the table does not exist: a non-retryable
 * 503 `feature_unavailable`, never an invented status.
 */
/** A 400 naming the field that failed, using the validator's own code and message. */
function badField(field, result, requestId) {
  return apiError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: result.message,
    fieldErrors: [{ field, code: result.code, message: result.message }],
    retryable: false,
    requestId,
  });
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const url = new URL(request.url);

    const operationId = parseUuid(url.searchParams.get('operationId'));
    if (!operationId.ok) return badField('operationId', operationId, requestId);

    // Recovery operations have no owner, so they are deliberately not readable
    // here: letting a signed-in caller name the recovery domain would turn this
    // into a lookup for rows that belong to nobody.
    const readable = OPERATION_DOMAINS.filter((name) => name !== UNAUTHENTICATED_DOMAIN);
    const domain = parseEnum(url.searchParams.get('domain'), readable);
    if (!domain.ok) return badField('domain', domain, requestId);

    const operation = await readOperation(supabaseAdmin, {
      operationId: operationId.value,
      profileId: userId,
      domain: domain.value,
    });
    if (!operation) {
      return apiError({
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: 'That request was not found.',
        retryable: false,
        requestId,
      });
    }

    // B06 Ruling H18 with S16: a succeeded `actions` operation is answered with
    // the household's CURRENT snapshot and the live unresolved list minus the
    // operation itself, at `snapshot.unresolvedOperations` where the actions
    // adapter reads it (adapters.ts:7,11), and at the top level over the
    // stored `[]` so the body does not contradict itself. The stored receipt
    // holds ids and revisions only (Ruling H3). Behind the `tasks` flag like
    // the rest of My Week (Ruling H17). Every other domain, and every other
    // `actions` status, is replayed as stored.
    let hydrated = null;
    if (operation.domain === ACTIONS_DOMAIN && operation.status === 'succeeded') {
      if (!featureEnabled('tasks')) return actionsUnavailable(requestId);
      try {
        const snapshot = await liveActionsSnapshot(supabaseAdmin, userId, operation.operationId);
        hydrated = { unresolvedOperations: snapshot.unresolvedOperations, snapshot };
      } catch (err) {
        if (isActionsUnavailable(err)) return actionsUnavailable(requestId);
        throw err;
      }
    }

    return NextResponse.json(
      {
        // The stored receipt first, so the client sees exactly the body the
        // original route returned and its domain validators still pass. The
        // canonical fields are written after it: a receipt frozen at write time
        // must never override the status computed now, which is the only place
        // a stale 'pending' becomes 'unknown'.
        ...(operation.result && typeof operation.result === 'object' ? operation.result : {}),
        ...hydrated,
        operationId: operation.operationId,
        domain: operation.domain,
        kind: operation.kind,
        status: operation.status,
        created_at: operation.createdAt,
      },
      { headers },
    );
  } catch (err) {
    if (isOperationsUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`operations read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
