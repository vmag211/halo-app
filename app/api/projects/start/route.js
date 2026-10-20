import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseText, parseUuid } from '@/lib/validate';
import { featureDisabledReason, featureEnabled } from '@/lib/features';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { libraryProject } from '@/lib/projectSelection';
import { PROJECT_COPY, START_DOMAIN, START_KIND, pendingStarts, startInput, startedRecord } from '@/lib/projectsStore';
import {
  commitWorkspace,
  isWorkspaceUnavailable,
  parseWorkspaceCommand,
  planWorkspaceCommand,
  readWorkspaceCollections,
  refusalForError,
  workspaceRefusal,
} from '@/lib/workspaceStore';

/**
 * POST /api/projects/start  (registry `projects.start`, runtime.ts:43)
 *
 *   { guideId, guideVersion }   Idempotency-Key: <uuid>
 *     ->  200 { record, collection }
 *
 * Starts one of the household's own projects from a library guide (contract
 * :673, :679). The record is an `exploreProjects` workspace record (B11) with
 * its own instance id, `project-<operation id>`, never the catalogue id, and
 * an immutable snapshot of the guide version that was started. `collection`
 * is the household's complete canonical exploreProjects collection, which
 * contains the record (ExploreProjects.tsx:56 checks both, and the record's
 * guide id and version).
 *
 * THE LEDGER. A start is a workspace write, so it is claimed in domain
 * `workspace` (kind `projects.start`) and committed by 0026's
 * commit_household_workspace, which settles this operation's own ledger row
 * in the same transaction as the record (B11 Ruling W12). A start therefore
 * exists if and only if its operation is succeeded, Homeguard's provider sees
 * an unresolved start as one of its own pending operations, and
 * `GET /api/operations?domain=workspace` reconciles it like any workspace
 * save. The ledger keeps names, ids and revisions only; the guide reference of
 * a start still pending is recovered from the hash of its input (Ruling J12).
 *
 * ONE START AT A TIME (contract :681, Ruling J11). While another start of
 * this household is unresolved, a new one is refused 409 before any claim;
 * repeating the unresolved one with its own key reconciles it.
 *
 * THE CLIENT reads any 5xx on this mutation as "not confirmed" and keeps the
 * attempt, and anything else as settled (ExploreProjects.tsx:57). So what is
 * known before the claim is answered without a 5xx (Ruling J3): flag
 * `projects` or `workspace` off, or 0026 or 0017 missing, is 403
 * feature_unavailable; a guide that is not in the library is 404; another
 * version of it is 409. After the claim: a stored refusal (the collection's
 * limit) is 409; a replay still pending is the retryable 503 (the client
 * checks again with the same key); a lost database answer is a 500, which the
 * client reconciles.
 */

export const maxDuration = 60;

const BODY_KEYS = ['guideId', 'guideVersion'];

const refuse = (status, code, message, requestId, reason) =>
  apiError({ status, code, message, retryable: status === 503, requestId, ...(reason ? { extra: { reason } } : {}) });

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: 2048 });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key));
    if (unknown.length) return validationError(unknown.map((field) => ({ field, code: 'unknown_field', message: `Only ${BODY_KEYS.join(', ')} can be sent.` })), requestId);
    const guideId = parseText(body.value.guideId, { maxLength: 200, required: true, rejectControl: true });
    if (!guideId.ok) return validationError([{ field: 'guideId', code: guideId.code, message: guideId.message }], requestId);
    const guideVersion = parseText(body.value.guideVersion, { maxLength: 100, required: true, rejectControl: true });
    if (!guideVersion.ok) return validationError([{ field: 'guideVersion', code: guideVersion.code, message: guideVersion.message }], requestId);
    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim());
    if (!key.ok) return validationError([{ field: 'Idempotency-Key', code: key.code, message: 'Send an Idempotency-Key header carrying this request\'s own id.' }], requestId);
    const operationId = key.value;

    // Off by default (Rulings J2 and B11 W1): nothing read, nothing claimed.
    if (!featureEnabled('projects')) return refuse(403, ERROR_CODES.FEATURE_UNAVAILABLE, featureDisabledReason('projects'), requestId);
    if (!featureEnabled('workspace')) return refuse(403, ERROR_CODES.FEATURE_UNAVAILABLE, featureDisabledReason('workspace'), requestId);

    const project = libraryProject(guideId.value);
    if (!project) return refuse(404, ERROR_CODES.NOT_FOUND, PROJECT_COPY.guideMissing, requestId);
    if (project.guide.version !== guideVersion.value) return refuse(409, ERROR_CODES.CONFLICT, PROJECT_COPY.guideChanged, requestId, 'guide_version');
    const guide = project.guide;
    const record = startedRecord(operationId, guide);

    // Proves 0026 and 0017 before the claim: a missing one is answered without a 5xx and records nothing.
    let current;
    let pending;
    try {
      current = await readWorkspaceCollections(supabaseAdmin, userId, ['exploreProjects']);
      pending = await pendingStarts(supabaseAdmin, userId);
    } catch (error) {
      if (isWorkspaceUnavailable(error) || isOperationsUnavailable(error)) return refuse(403, ERROR_CODES.FEATURE_UNAVAILABLE, PROJECT_COPY.startUnavailable, requestId);
      throw error;
    }
    if (pending.some((start) => start.id !== operationId)) return refuse(409, ERROR_CODES.CONFLICT, PROJECT_COPY.startBlocked, requestId, 'start_pending');

    // The record passes the client's own row check exactly as the workspace route checks a write.
    const parsed = parseWorkspaceCommand({ kind: 'write', collection: 'exploreProjects', record, expectedRevision: null });
    if (!parsed.ok || parsed.refusal) throw new Error('projects start: the started record fails the workspace row check');

    let committed = null;
    const outcome = await runOperation(
      supabaseAdmin,
      { operationId, profileId: userId, domain: START_DOMAIN, kind: START_KIND, input: startInput(guide.id, guide.version) },
      async () => {
        const plan = planWorkspaceCommand(parsed.command, current);
        if (!plan.ok) return { status: 'failed', reason: plan.reason, unresolvedOperations: [] };
        try {
          committed = await commitWorkspace(supabaseAdmin, { profileId: userId, operationId, writes: plan.writes });
          return committed.receipt;
        } catch (error) {
          const reason = refusalForError(workspaceRefusal(error), parsed.command);
          if (reason) return { status: 'failed', reason, unresolvedOperations: [] };
          throw error;
        }
      },
    );
    current = null;

    const answer = (collection) => {
      const row = collection.find((item) => item.id === record.id);
      if (!row) return refuse(409, ERROR_CODES.CONFLICT, PROJECT_COPY.startGone, requestId, 'changed_elsewhere');
      return NextResponse.json({ record: row, collection }, { headers });
    };
    if (committed) return answer(committed.changes.exploreProjects ?? []);

    const result = outcome.result;
    if (!result) {
      if (outcome.status === 'failed') return refuse(409, ERROR_CODES.CONFLICT, PROJECT_COPY.startIncomplete, requestId, 'not_applied');
      return refuse(503, ERROR_CODES.UPSTREAM_UNAVAILABLE, PROJECT_COPY.startInFlight, requestId);
    }
    if (result.status === 'succeeded') return answer((await readWorkspaceCollections(supabaseAdmin, userId, ['exploreProjects'])).exploreProjects);
    if (result.reason === 'limit') return refuse(409, ERROR_CODES.CONFLICT, PROJECT_COPY.startLimit, requestId, 'limit');
    if (result.reason === ABANDONED_REASON) return refuse(409, ERROR_CODES.CONFLICT, PROJECT_COPY.startIncomplete, requestId, 'abandoned');
    return refuse(409, ERROR_CODES.CONFLICT, PROJECT_COPY.startIncomplete, requestId, result.reason === 'stale_revision' ? 'stale_revision' : 'not_applied');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message: 'That request was already made with different details. Please try again.', retryable: false, requestId, extra: { reason: 'operation_mismatch' } });
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`project start failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
