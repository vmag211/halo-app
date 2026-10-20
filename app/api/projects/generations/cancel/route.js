import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseText, parseUuid } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import {
  PROJECTS_DOMAIN,
  PROJECT_COPY,
  cancelOperationId,
  clientContextKey,
  contextKeyFor,
  currentHome,
  isProjectsUnavailable,
  readGeneration,
  recordGeneration,
  terminalResult,
} from '@/lib/projectsStore';

/**
 * POST /api/projects/generations/cancel  (registry `projects.cancel`, runtime.ts:45)
 *
 *   { id }   Idempotency-Key: cancel:<id>
 *     ->  200 ProjectGenerationResult, always terminal
 *
 * "Returns its canonical terminal or still-running status" (contract :671).
 * The client accepts only `completed`, `cancelled` or `failed` and treats
 * anything else, an error included, as "cancellation is unconfirmed"
 * (ProductionProjectGeneration.tsx:55). A generation completes inside its own
 * request (Ruling J1), so nothing is ever still running:
 *
 *   - a row for the id (completed, failed, or an earlier cancellation) is
 *     answered as stored. `completed` is the honest answer when the ideas were
 *     ready first; the client then shows them;
 *   - no row: the id is recorded as `cancelled` (Ruling J6). The primary key
 *     makes this race-free with a generation for the same id still in flight:
 *     whichever is stored first stands, and a generation arriving later is
 *     answered `cancelled` and stores nothing. An id that is not a UUID cannot
 *     be a generation of ours and is answered `cancelled` without a write.
 *
 * Through the ledger (domain `projects`) under a name-based id derived from
 * the household and the `cancel:<id>` header, which the uuid column cannot
 * hold as it arrives (the luna/runs/cancel pattern). The receipt holds the
 * status only. Another household's id is never read: every statement is
 * scoped to the caller, so their generation is not found and the caller only
 * records a cancellation of their own.
 *
 * Flag `projects` off, or 0030 or 0017 missing: nothing could be running, so
 * the answer is `cancelled` and nothing is written (a 5xx here would leave the
 * client unsure, and a 503 is what this client cannot settle).
 */

export const maxDuration = 60;

const BODY_KEYS = ['id'];

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: 2048 });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key));
    if (unknown.length) return validationError(unknown.map((field) => ({ field, code: 'unknown_field', message: 'Only id can be sent.' })), requestId);
    const id = parseText(body.value.id, { maxLength: 200, required: true, rejectControl: true });
    if (!id.ok) return validationError([{ field: 'id', code: id.code, message: id.message }], requestId);
    const header = parseText(request.headers.get('idempotency-key') ?? '', { maxLength: 220, required: true, rejectControl: true });
    if (!header.ok) return validationError([{ field: 'Idempotency-Key', code: header.code, message: 'An Idempotency-Key header is required to stop a request.' }], requestId);

    // The client does not compare a cancellation's context key (only a
    // completed set's), so with nothing to read the household's own identity is enough.
    let contextKey = contextKeyFor(userId, null);
    const cancelled = () => NextResponse.json(terminalResult(id.value, contextKey, 'cancelled', PROJECT_COPY.cancelled), { headers });

    // Off by default (Ruling J2): nothing read, nothing written.
    const uuid = parseUuid(id.value);
    if (!featureEnabled('projects') || !uuid.ok) return cancelled();
    contextKey = clientContextKey(request, userId, await currentHome(supabaseAdmin, userId));

    let row;
    try {
      row = await readGeneration(supabaseAdmin, userId, uuid.value);
    } catch (error) {
      if (isProjectsUnavailable(error)) return cancelled();
      throw error;
    }
    if (row) return NextResponse.json(row.result, { headers });

    let stored = null;
    try {
      await runOperation(
        supabaseAdmin,
        { operationId: cancelOperationId(userId, header.value), profileId: userId, domain: PROJECTS_DOMAIN, kind: 'projects.cancel', input: { id: uuid.value } },
        async () => {
          const recorded = await recordGeneration(supabaseAdmin, {
            profileId: userId,
            generationId: uuid.value,
            result: terminalResult(uuid.value, contextKey, 'cancelled', PROJECT_COPY.cancelled),
          });
          stored = recorded.row;
          return { status: 'succeeded', generation: recorded.row.status, unresolvedOperations: [] };
        },
      );
    } catch (error) {
      if (isOperationsUnavailable(error)) return cancelled();
      throw error;
    }
    // A replay, or the first call: the row as it now stands.
    const settled = stored ?? (await readGeneration(supabaseAdmin, userId, uuid.value));
    return settled ? NextResponse.json(settled.result, { headers }) : cancelled();
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message: 'That request id was already used for something else.', retryable: false, requestId });
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`project generation cancel failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
