import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError, validationError, loggableError } from '@/lib/apiErrors';
import { isOperationsUnavailable } from '@/lib/operations';
import { PRIVATE_CACHE_CONTROL } from '@/lib/publicAccess';
import {
  deniedSnapshot,
  isSourceOpsUnavailable,
  operatorRole,
  sourceOpsSnapshot,
  sourceOpsUnavailable,
} from '@/lib/sourceOps';

/**
 * GET /api/operator/sources  (registry `sourceOps.read`, runtime.ts:19)
 *
 *   200 { role, revision, sources, unresolvedOperations, nextCursor }
 *
 * The source operations snapshot for the /operations screen (B13 plan,
 * docs/backend/plans/b13-source-operations.md). The role is the server's own,
 * read from public.operator_roles for the verified session's user (0027):
 *
 *   - no session: 401, as every private route;
 *   - a signed-in account with no role, and any anonymous-auth account: the
 *     contract's denied answer, `{role: 'denied', revision: 1, sources: [],
 *     unresolvedOperations: [], nextCursor: null}` (validSourceOpsSnapshot
 *     requires a denied reply to carry no source and no cursor). Nothing else
 *     is read for it, so it says nothing about what an operator would see;
 *   - viewer, reviewer, publisher: every registered source with a stored
 *     record (lib/sourceOps.js), each with `allowedDecisions: []`, and the
 *     caller's own unsettled `source-operations` ledger entries.
 *
 * Every source is on the first page, so `nextCursor` is null and a `cursor`
 * query, which this backend never issued, is a 400. No other query parameter
 * is read, and X-Halo-Home-Context is ignored: operator data is not a
 * household's.
 *
 * Until 0027 is applied the role cannot be read: a non-retryable 503
 * feature_unavailable, never a guessed role. The same for an operator before
 * 0017, whose unsettled operations cannot be listed.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': PRIVATE_CACHE_CONTROL };
  try {
    const { userId, isAnonymous } = await requireUser(request);
    const role = await operatorRole(supabaseAdmin, { userId, isAnonymous });
    if (role === 'denied') return NextResponse.json(deniedSnapshot(), { headers });

    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor !== null) {
      return validationError([{ field: 'cursor', code: 'invalid_cursor', message: 'That page is not available. Refresh the source list.' }], requestId);
    }
    const snapshot = await sourceOpsSnapshot(supabaseAdmin, { role, profileId: userId });
    return NextResponse.json(snapshot, { headers });
  } catch (err) {
    if (isSourceOpsUnavailable(err) || isOperationsUnavailable(err)) return sourceOpsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`operator sources read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
