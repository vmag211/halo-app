import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { internalError, loggableError, requestIdFor } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import { sendingUnsupported, writeUnavailable } from '@/lib/outreach';

/**
 * POST /api/outreach/connect  (registry `outreach.connect`, runtime.ts:54)
 *
 *   403 { code: 'feature_unavailable', reason: 'email_sending_unsupported', ... }
 *
 * Refused (B17 Ruling O2). HALO has no email provider, so there is no OAuth
 * client, no authorization URL, no state and nothing to store. The body is
 * never read and no ledger row is claimed. A 403 is a definite answer to the
 * client (runtime.ts:142): the screen shows its permission sentence and the
 * person keeps their draft and can copy it. Flag off: the same 403 with the
 * not-available sentence.
 */

export const maxDuration = 60;

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    if (!featureEnabled('outreach')) return writeUnavailable(requestId);
    return sendingUnsupported(requestId);
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach connect failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
