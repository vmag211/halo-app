import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, ERROR_CODES } from '@/lib/apiErrors';
import { parseUuid } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { isSummaryUnavailable, readSummary, summaryUnavailable } from '@/lib/summaryStore';

/**
 * GET /api/summaries/detail?id=<uuid>   (registry `summary.read`, runtime.ts:76)
 *
 *   200 SummarySnapshot   {id, revision, title, createdAt, homeContextId, report, selection, manifest, omissions}
 *
 * One saved summary exactly as it was saved (B15 Ruling S15-1): read from
 * its row, never composed again from current records, so later edits to a
 * test or a move never rewrite it. The screen requires `validSummarySnapshot`
 * and the requested `id` echoed (useProductionSummary.ts:25).
 *
 * A malformed id is a 400; an id this household does not own is the same 404
 * as one that does not exist, which this client shows as "unavailable"
 * (runtime.ts:144). Flag `summaries` (or `workspace`) off, 0029 missing: the
 * non-retryable 503. `Cache-Control: no-store`, because the body is the
 * household's private report. No top-level `data` key.
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    if (!featureEnabled('summaries') || !featureEnabled('workspace')) return summaryUnavailable(requestId);

    const id = parseUuid((new URL(request.url).searchParams.get('id') ?? '').trim().toLowerCase());
    if (!id.ok) {
      return apiError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: id.message,
        fieldErrors: [{ field: 'id', code: id.code, message: id.message }],
        retryable: false,
        requestId,
      });
    }

    const snapshot = await readSummary(supabaseAdmin, userId, id.value);
    if (!snapshot) {
      return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'That summary was not found.', retryable: false, requestId });
    }
    return NextResponse.json(snapshot, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (isSummaryUnavailable(err)) return summaryUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`summary read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
