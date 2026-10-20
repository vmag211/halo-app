import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, requestIdFor, internalError, validationError, loggableError, ERROR_CODES } from '@/lib/apiErrors';
import { PRIVATE_CACHE_CONTROL } from '@/lib/publicAccess';
import {
  SOURCE_IDS,
  auditPage,
  isSourceOpsUnavailable,
  operatorForbidden,
  operatorRole,
  parseAuditCursor,
  sourceOpsUnavailable,
} from '@/lib/sourceOps';

/**
 * GET /api/operator/sources/history?sourceId=&kind=&cursor=&sourceRevision=
 * (registry `sourceOps.history`, runtime.ts:20)
 *
 *   200 { sourceId, sourceRevision, kind, versions, audit, nextCursor }
 *
 * The next page of one source's immutable history, bound to the revision the
 * screen holds (ProductionSourceOperations.tsx:30, validSourceOpsHistory).
 *
 *   - viewer, reviewer or publisher only; anyone else (a role revoked since the
 *     snapshot included) is a 403, which clears the screen;
 *   - `sourceRevision` must be the source's current revision, or a 409: a page
 *     from a different revision must not be combined with the one on screen;
 *   - `kind=audit` pages applied decisions newest first, 20 at a time, with the
 *     keyset cursor the snapshot or the previous page gave (`a<id>`). Refused
 *     commands are audited too but are not decisions, so they are never listed;
 *   - `kind=versions` is never paged: every retained version is already in the
 *     snapshot and its `versionsCursor` is always null, so any versions cursor
 *     is one this backend never issued, a 400 like any unknown cursor.
 *
 * Before 0027: 503 feature_unavailable.
 */

const field = (name, code, message) => ({ field: name, code, message });

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': PRIVATE_CACHE_CONTROL };
  try {
    const { userId, isAnonymous } = await requireUser(request);
    const role = await operatorRole(supabaseAdmin, { userId, isAnonymous });
    if (role === 'denied') return operatorForbidden(requestId);

    const query = new URL(request.url).searchParams;
    const sourceId = query.get('sourceId');
    const kind = query.get('kind');
    const rawRevision = query.get('sourceRevision');
    const sourceRevision = /^[1-9]\d{0,9}$/.test(rawRevision ?? '') ? Number(rawRevision) : null;
    const cursor = query.get('cursor');
    const beforeId = kind === 'audit' ? parseAuditCursor(cursor) : null;
    const errors = [
      SOURCE_IDS.includes(sourceId) ? null : field('sourceId', 'unknown_source', 'That source is not available.'),
      ['versions', 'audit'].includes(kind) ? null : field('kind', 'invalid_enum', 'Choose versions or audit.'),
      sourceRevision !== null && Number.isSafeInteger(sourceRevision) ? null : field('sourceRevision', 'invalid_revision', 'That source revision is not valid.'),
      beforeId !== null ? null : field('cursor', 'invalid_cursor', 'That page is not available. Refresh the source.'),
    ].filter(Boolean);
    if (errors.length > 0) return validationError(errors, requestId);

    // The page and the applied count the revision comes from, read together.
    const page = await auditPage(supabaseAdmin, sourceId, { beforeId });
    const currentRevision = 1 + page.count;
    if (currentRevision !== sourceRevision) {
      return apiError({
        status: 409,
        code: ERROR_CODES.CONFLICT,
        message: 'This source changed. Refresh it before loading more history.',
        retryable: false,
        requestId,
        extra: { revision: currentRevision },
      });
    }
    return NextResponse.json(
      { sourceId, sourceRevision, kind, versions: [], audit: page.entries, nextCursor: page.nextCursor },
      { headers },
    );
  } catch (err) {
    if (isSourceOpsUnavailable(err)) return sourceOpsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`operator sources history failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
