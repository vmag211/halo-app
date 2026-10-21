import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { internalError, loggableError, requestIdFor } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import { CONNECTION, readUnavailable } from '@/lib/outreach';

/**
 * GET /api/outreach/connection  (registry `outreach.connection`, runtime.ts:53)
 *
 *   200 { connected: false, sender: null, revision: 1 }
 *
 * Always "not connected" (B17 Ruling O2): HALO has no email provider and
 * stores no account or token, so it never claims a sender. The client's
 * `validOutreachConnection` accepts exactly this (outreach-service.ts:6), and
 * the screen then never offers its send review (ProductionOutreach.tsx:60).
 * Nothing is read. Flag off: the non-retryable 503.
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    if (!featureEnabled('outreach')) return readUnavailable(requestId);
    return NextResponse.json({ ...CONNECTION }, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach connection failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
