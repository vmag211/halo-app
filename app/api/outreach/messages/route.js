import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { internalError, loggableError, requestIdFor } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import { isOperationsUnavailable, listUnresolvedOperations } from '@/lib/operations';
import { OUTREACH_DOMAIN, isOutreachUnavailable, readDrafts, readUnavailable, sendingUnsupported, writeUnavailable } from '@/lib/outreach';

/**
 * GET  /api/outreach/messages  (registry `outreach.history`, runtime.ts:56)
 *
 *   200 { attempts: [], complete: true, drafts: [OutreachDraft], unresolvedOperations: [id] }
 *
 * `attempts` is empty and complete because HALO has never sent and never
 * sends a message (B17 Rulings O2, O7): no attempt row exists anywhere. The
 * client's `validOutreachHistory` accepts it (outreach-service.ts:11) and the
 * screen's send ledger stays empty (ProductionOutreach.tsx:55). The
 * household's prepared copies are listed separately in `drafts`, newest
 * first, each with `status: 'draft'`, so they can never be mistaken for a
 * send attempt. `unresolvedOperations` is the household's unsettled
 * `outreach` prepares, read before the drafts.
 *
 * POST /api/outreach/messages  (registry `outreach.send`, runtime.ts:51)
 *
 *   403 { code: 'feature_unavailable', reason: 'email_sending_unsupported', ... }
 *
 * Refused before the body is read and before any ledger claim (Ruling O2):
 * nothing is recorded and nothing is transmitted. A 403 clears the client's
 * parked send (ProductionOutreach.tsx:69, `error.code!=='unknown_outcome'`).
 *
 * Flag `outreach` off: GET the non-retryable 503, POST a 403. 0031 or 0017
 * missing: GET the 503.
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    if (!featureEnabled('outreach')) return readUnavailable(requestId);
    const unresolvedOperations = await listUnresolvedOperations(supabaseAdmin, { profileId: userId, domains: [OUTREACH_DOMAIN] });
    const drafts = await readDrafts(supabaseAdmin, userId);
    return NextResponse.json(
      { attempts: [], complete: true, drafts, unresolvedOperations },
      { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    if (isOutreachUnavailable(err) || isOperationsUnavailable(err)) return readUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach history failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    if (!featureEnabled('outreach')) return writeUnavailable(requestId);
    return sendingUnsupported(requestId);
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach send refusal failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
