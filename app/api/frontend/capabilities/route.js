import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { internalError, loggableError, requestIdFor } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';

/**
 * GET /api/frontend/capabilities  (registry `features.read`)
 *
 *   200 { capabilities: { tasks: boolean, workspace: boolean, ... } }
 *
 * Which person-facing capabilities this deployment has switched on, so the
 * app can skip reads it already knows the server will refuse (a signed-in
 * load of every screen otherwise asks for each workspace collection and gets
 * a 503 `feature_unavailable` back for each one).
 *
 * Booleans only: no variable names, reasons or other configuration. The raw
 * flag per capability, not a combined answer; the client applies the
 * documented dependencies (attachments and summaries also need workspace).
 * This is a hint, not authority: every handler still checks its own flag, so
 * a stale or forged answer can only make the client ask and be refused.
 * `publicImport` is an operator job, not a screen, and is left out.
 */

export const maxDuration = 60;

const REPORTED = ['tasks', 'workspace', 'attachments', 'summaries', 'projects', 'outreach', 'participation', 'luna', 'recovery'];

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    const capabilities = Object.fromEntries(REPORTED.map((name) => [name, featureEnabled(name)]));
    return NextResponse.json({ capabilities }, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`capabilities read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
