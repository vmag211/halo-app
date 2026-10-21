import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { parseText } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { libraryProject } from '@/lib/projectSelection';
import { PROJECT_COPY, projectsUnavailable } from '@/lib/projectsStore';
import { isWorkspaceUnavailable, readWorkspaceCollections } from '@/lib/workspaceStore';

/**
 * GET /api/projects/guides/detail?id=<guide or owned project id>[&version=]
 *   (registry `projects.guide`, runtime.ts:42)
 *     ->  200 ProductionProjectGuide (explore-service.ts:17-28)
 *     ->  404 not_found
 *
 * "Returns a validated, versioned ProductionProjectGuide for a generated guide
 * or owned project reference" (contract :672). The client asks with the id in
 * the address when it has no guide for it in memory (ExploreProjects.tsx:48):
 *
 *   - a library guide id: its current version. With `version`, only that
 *     version, and the library keeps one, so another is the 404;
 *   - an owned project's record id (with the `workspace` flag on and 0026
 *     applied): the immutable guide snapshot that project was started with,
 *     never the library's newer one (contract :679).
 *
 * Another household's project id is the same 404 as an id that does not
 * exist: the record read is scoped to the caller. The guide is answered at the
 * top level (no `data` key, which the runtime would unwrap).
 *
 * Flag `projects` off: the non-retryable 503.
 */

export const maxDuration = 60;

const notFound = (requestId) => apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: PROJECT_COPY.guideMissing, retryable: false, requestId });

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const params = new URL(request.url).searchParams;
    const id = parseText(params.get('id') ?? '', { maxLength: 200, required: true, rejectControl: true });
    if (!id.ok) return validationError([{ field: 'id', code: id.code, message: id.message }], requestId);
    const version = params.has('version') ? parseText(params.get('version'), { maxLength: 100, required: true, rejectControl: true }) : null;
    if (version && !version.ok) return validationError([{ field: 'version', code: version.code, message: version.message }], requestId);

    if (!featureEnabled('projects')) return projectsUnavailable(requestId);

    const project = libraryProject(id.value);
    if (project) {
      if (version && version.value !== project.guide.version) return notFound(requestId);
      return NextResponse.json(project.guide, { headers });
    }

    if (featureEnabled('workspace')) {
      let rows = [];
      try {
        rows = (await readWorkspaceCollections(supabaseAdmin, userId, ['exploreProjects'])).exploreProjects;
      } catch (error) {
        if (!isWorkspaceUnavailable(error)) throw error;
      }
      const owned = rows.find((row) => row.id === id.value);
      if (owned?.guide && (!version || owned.guide.version === version.value)) return NextResponse.json(owned.guide, { headers });
    }
    return notFound(requestId);
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`project guide read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
