import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { internalError, loggableError, requestIdFor, validationError } from '@/lib/apiErrors';
import { parseText, parseUuid } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { isOperationsUnavailable, readOperation } from '@/lib/operations';
import {
  PROJECTS_DOMAIN,
  PROJECT_COPY,
  clientContextKey,
  currentHome,
  isProjectsUnavailable,
  projectsUnavailable,
  readGeneration,
  terminalResult,
} from '@/lib/projectsStore';

/**
 * GET /api/projects/generations/status?id=<job id or request id>
 *   (registry `projects.generation`, runtime.ts:44)
 *     ->  200 ProjectGenerationResult
 *
 * "Looks up a job by its job ID or original generation idempotency key. A
 * check never starts another generation" (contract :670). The two ids are the
 * same here (Ruling J6), so this is one read of the household's own row.
 *
 * No row for the id: while the request that carries it is still being
 * handled (its `projects` ledger row is pending), `queued`, so the client
 * keeps checking; otherwise `failed` with "not found", which ends the
 * client's wait without claiming anything ran (ProductionProjectGeneration.tsx:44).
 * Never a 404: the client keeps its attempt parked on any error. Another
 * household's id gets the identical answer and nothing of theirs is read.
 * Every answer carries the context key: the row's own, or for a row that does
 * not exist, the one the calling client holds (clientContextKey: the client
 * compares it before the status).
 *
 * Flag `projects` off, or 0030 missing: the non-retryable 503.
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const raw = parseText(new URL(request.url).searchParams.get('id') ?? '', { maxLength: 200, required: true, rejectControl: true });
    if (!raw.ok) return validationError([{ field: 'id', code: raw.code, message: raw.message }], requestId);

    if (!featureEnabled('projects')) return projectsUnavailable(requestId);

    const uuid = parseUuid(raw.value);
    const row = uuid.ok ? await readGeneration(supabaseAdmin, userId, uuid.value) : null;
    if (row) return NextResponse.json(row.result, { headers });

    const home = await currentHome(supabaseAdmin, userId);
    const contextKey = clientContextKey(request, userId, home);
    const operation = uuid.ok ? await readOperation(supabaseAdmin, { operationId: uuid.value, profileId: userId, domain: PROJECTS_DOMAIN }) : null;
    if (operation && (operation.status === 'pending' || operation.status === 'unknown')) {
      return NextResponse.json(terminalResult(raw.value, contextKey, 'queued', undefined), { headers });
    }
    return NextResponse.json(terminalResult(raw.value, contextKey, 'failed', operation ? PROJECT_COPY.notFinished : PROJECT_COPY.notFound), { headers });
  } catch (err) {
    if (isProjectsUnavailable(err) || isOperationsUnavailable(err)) return projectsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`project generation status failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
