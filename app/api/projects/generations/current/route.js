import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { internalError, loggableError, requestIdFor } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import { isOperationsUnavailable } from '@/lib/operations';
import { isProjectsUnavailable, pendingStarts, projectsUnavailable, readCurrentGeneration } from '@/lib/projectsStore';

/**
 * GET /api/projects/generations/current  (registry `projects.current`, runtime.ts:41)
 *
 *   200 { data: ProjectGenerationResult }   the household's newest completed set
 *   200 { data: null }                      a household that has none ("a new user")
 *
 * The runtime unwraps `data` (runtime.ts:149-152), and the client adopts the
 * set only when its contextKey is the runtime's scopeKey
 * (ProductionProjectGeneration.tsx:30), so a set made for an earlier home is
 * returned as it was made and the client shows it as not current. Nothing is
 * running between requests (Ruling J1), so this never restores a pending
 * generation.
 *
 * `pendingStart` (contract :681): the oldest unresolved project start, as
 * `{ id, guideId, version }`, when the `workspace` flag is on and its guide is
 * still in the library (Ruling J12). The client then blocks another start
 * until the first is settled. A household with a pending start and no saved
 * set has nothing to attach it to and answers `{ data: null }`; the start
 * route refuses a second start on the server either way (Ruling J11).
 *
 * Flag `projects` off, or 0030 missing: the non-retryable 503.
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    if (!featureEnabled('projects')) return projectsUnavailable(requestId);

    const row = await readCurrentGeneration(supabaseAdmin, userId);
    if (!row) return NextResponse.json({ data: null }, { headers });

    let pendingStart;
    if (featureEnabled('workspace')) {
      try {
        const started = (await pendingStarts(supabaseAdmin, userId)).find((start) => start.guideId);
        if (started) pendingStart = { id: started.id, guideId: started.guideId, version: started.version };
      } catch (error) {
        // Without the ledger there is no start to report; anything else is a real failure.
        if (!isOperationsUnavailable(error)) throw error;
      }
    }
    return NextResponse.json({ data: pendingStart ? { ...row.result, pendingStart } : row.result }, { headers });
  } catch (err) {
    if (isProjectsUnavailable(err)) return projectsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`project generation read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
