import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { parseUuid } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { MESSAGES, isOutreachUnavailable, readDrafts, readUnavailable } from '@/lib/outreach';

/**
 * GET /api/outreach/messages/status?id=<uuid>  (registry `outreach.status`, runtime.ts:57)
 *
 *   200 OutreachDraft (status 'draft')   the id is one of the household's drafts
 *   404 not_found                        any other id: no send attempt exists
 *
 * Honest about what exists (B17 Ruling O7): a prepared draft is a draft, never
 * queued, submitted or delivered, and the client's `validOutreachAttempt`
 * refuses its `status: 'draft'` (outreach-service.ts:9-10), which is right,
 * because it is not an attempt. Every other id is "not found": HALO never
 * sends, so there is no attempt to report. The read is scoped to the verified
 * caller in SQL, so another household's draft id is the same 404.
 *
 * Flag off, 0031 missing: the non-retryable 503.
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    if (!featureEnabled('outreach')) return readUnavailable(requestId);
    const id = parseUuid(new URL(request.url).searchParams.get('id') ?? '');
    if (!id.ok) return validationError([{ field: 'id', code: id.code, message: id.message }], requestId);
    const [draft] = await readDrafts(supabaseAdmin, userId, id.value);
    if (!draft) return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: MESSAGES.notFound, retryable: false, requestId });
    return NextResponse.json(draft, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (isOutreachUnavailable(err)) return readUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach status failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
