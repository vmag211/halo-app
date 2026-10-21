import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { internalError, loggableError, requestIdFor, validationError } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import { parseContextQuery, publicContext, readUnavailable, sourcesUsable } from '@/lib/outreach';

/**
 * GET /api/outreach/context?topic=&water=&area=<json>  (registry `outreach.context`, runtime.ts:52)
 *
 *   200 { revision, availability: 'ready' | 'empty', entries: [{id, title, text, scope, asOf, url}], complete }
 *
 * Dated public records the person may choose to include in a message (B17
 * Ruling O4): for a drinking water question, the area's county's latest U.S.
 * Drought Monitor release and, for public water, each listed water system's
 * NC DWR conservation status, from B12's reviewed lib/data/ncWaterStewardship.json.
 * Any other topic, no area or an area outside the gazetteer is `empty`, never
 * an invented record. Public data only: nothing of the household is read.
 * The answer is the client's `OutreachEvidence` (outreach-service.ts:13-14).
 *
 * The runtime sends `area` as JSON in the query (runtime.ts:111-115); only its
 * `id` is read. Flag off or a broken source file: the non-retryable 503.
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    if (!featureEnabled('outreach') || !sourcesUsable()) return readUnavailable(requestId);
    const need = parseContextQuery(new URL(request.url).searchParams);
    if (!need.ok) return validationError(need.fieldErrors, requestId);
    return NextResponse.json(publicContext(need.value), { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach context failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
