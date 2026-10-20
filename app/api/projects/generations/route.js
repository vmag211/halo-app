import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid, hasControlCharacters } from '@/lib/validate';
import { featureEnabled, featureDisabledReason } from '@/lib/features';
import { localDate } from '@/lib/localDate';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { gatherProjectEvidence } from '@/lib/projectEvidence';
import { selectProjects, validProjectConstraints } from '@/lib/projectSelection';
import {
  PROJECTS_DOMAIN,
  PROJECT_COPY,
  completedResult,
  contextKeyMatches,
  currentHome,
  isProjectsUnavailable,
  readCurrentGeneration,
  readGeneration,
  recordGeneration,
  terminalResult,
} from '@/lib/projectsStore';

/**
 * POST /api/projects/generations  (registry `projects.generate`, runtime.ts:40)
 *
 *   { contextKey, constraints, request, interpret, previousIdeaIds }
 *   Idempotency-Key: <uuid>, the request id, which is also the job id
 *     ->  200 ProjectGenerationResult (explore-service.ts:30-44)
 *
 * Project ideas WITHOUT a model or a paid service (B16 Ruling J1): a
 * deterministic selection from the curated library, ranked by the household's
 * dated evidence and the stated choices (lib/projectSelection.js,
 * lib/projectEvidence.js). The selection is fast, so the request completes in
 * this call and the answer is `completed`; the contract's asynchronous shape
 * (status, cancel) still holds: a cancellation that arrives first wins
 * (Ruling J6), and a check never starts another generation.
 *
 * THE CLIENT (components/expanded/ProductionProjectGeneration.tsx:38-50). It
 * rejects an answer whose contextKey is not its own BEFORE it reads the
 * status, so every answer here echoes the key it sent. Any 5xx on this
 * mutation reads as "not confirmed" and parks the attempt, so every outcome
 * known before the claim (flag off, 0030 missing, home changed) is a 200
 * `failed` result that changes nothing (Ruling J3).
 *
 * ORDER. Session; body (16 KiB); Idempotency-Key a UUID; the body's fields;
 * the `projects` flag; the context key (identity, then current home and
 * revision, Ruling J10); 0030 proved by reading this id (a row already there,
 * a repeat or a cancellation that came first, is answered as stored); the
 * ledger claim (domain `projects`); evidence, selection and the insert, which
 * keeps an existing row for this id. The ledger receipt holds the status
 * only, never the ideas, the evidence or the typed interest.
 *
 * No top-level `data` key: the runtime would unwrap it (runtime.ts:149).
 */

export const maxDuration = 60;

const BODY_KEYS = ['contextKey', 'constraints', 'request', 'interpret', 'previousIdeaIds'];
const MAX_REQUEST = 500;
const MAX_PREVIOUS = 15;

const bad = (field, code, message) => ({ field, code, message });

// A lone surrogate survives JSON.parse but cannot be stored in jsonb or text: the insert would fail as a 500,
// which the client reads as "not confirmed". It is a malformed request, so it is refused before any claim.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const unstorable = (text, options) => hasControlCharacters(text, options) || LONE_SURROGATE.test(text);

function parseBody(body) {
  const errors = [];
  for (const key of Object.keys(body)) if (!BODY_KEYS.includes(key)) errors.push(bad(key, 'unknown_field', `Only ${BODY_KEYS.join(', ')} can be sent.`));
  const { contextKey, constraints, request, interpret, previousIdeaIds } = body;
  if (typeof contextKey !== 'string' || !contextKey || contextKey.length > 500 || unstorable(contextKey)) errors.push(bad('contextKey', 'invalid_context', 'The context key is not valid.'));
  if (!validProjectConstraints(constraints)) errors.push(bad('constraints', 'invalid_constraints', 'Choose a space, group, time, budget and number of ideas.'));
  if (typeof request !== 'string' || request.length > MAX_REQUEST || unstorable(request, { allowNewlines: true })) errors.push(bad('request', 'invalid_request', `Describe your interest in ${MAX_REQUEST} characters or fewer.`));
  if (typeof interpret !== 'boolean') errors.push(bad('interpret', 'invalid_boolean', 'interpret must be true or false.'));
  if (!Array.isArray(previousIdeaIds) || previousIdeaIds.length > MAX_PREVIOUS
    || !previousIdeaIds.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 200 && !unstorable(id))) {
    errors.push(bad('previousIdeaIds', 'invalid_ids', `Send at most ${MAX_PREVIOUS} idea ids.`));
  }
  if (errors.length) return { ok: false, errors };
  const constraintsOnly = { space: constraints.space, mode: constraints.mode, time: constraints.time, budget: constraints.budget, count: constraints.count };
  return { ok: true, value: { contextKey, constraints: constraintsOnly, request: request.trim(), interpret, previousIdeaIds: [...new Set(previousIdeaIds)] } };
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: 16384 });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });

    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim());
    if (!key.ok) return validationError([bad('Idempotency-Key', key.code, 'Send an Idempotency-Key header carrying this request\'s own id.')], requestId);
    const id = key.value;

    const parsed = parseBody(body.value);
    if (!parsed.ok) return validationError(parsed.errors, requestId);
    const input = parsed.value;
    // A completed set keeps the key it was made for (the client adopts it only
    // for its own); a settled non-completed row for this id (a cancellation
    // recorded by another call) is answered in this caller's key, because the
    // client compares the key before it reads the status.
    const answer = (result) => NextResponse.json(result.status === 'completed' ? result : { ...result, contextKey: input.contextKey }, { headers });
    const refused = (message) => answer(terminalResult(id, input.contextKey, 'failed', message));

    // Off by default (Ruling J2): nothing read, nothing claimed.
    if (!featureEnabled('projects')) return refused(featureDisabledReason('projects'));

    // Another identity's key is a client bug, not a household's choice.
    if (!input.contextKey.startsWith(`${userId}:`)) return validationError([bad('contextKey', 'invalid_context', 'The context key is not this session\'s.')], requestId);
    const home = await currentHome(supabaseAdmin, userId);
    if (!contextKeyMatches(input.contextKey, userId, home)) return refused(PROJECT_COPY.homeChanged);

    // Proves 0030 before the claim, and answers a row already stored for this id as it is.
    let existing;
    try {
      existing = await readGeneration(supabaseAdmin, userId, id);
    } catch (error) {
      if (isProjectsUnavailable(error)) return refused(PROJECT_COPY.unavailable);
      throw error;
    }
    if (existing) return answer(existing.result);

    let stored = null;
    let outcome;
    try {
      outcome = await runOperation(
        supabaseAdmin,
        { operationId: id, profileId: userId, domain: PROJECTS_DOMAIN, kind: 'projects.generate', input },
        async () => {
          const previous = await readCurrentGeneration(supabaseAdmin, userId);
          const generation = (Number.isSafeInteger(previous?.result?.batch?.generation) ? previous.result.batch.generation : 0) + 1;
          const { evidence, state, renter } = await gatherProjectEvidence(supabaseAdmin, {
            profileId: userId,
            home: home.context,
            today: localDate(),
            workspace: featureEnabled('workspace'),
            log: (part, error) => console.error(`project generation: the ${part} evidence could not be read (request ${requestId}):`, loggableError(error)),
          });
          const selection = selectProjects({
            evidence, constraints: input.constraints, request: input.request, interpret: input.interpret,
            previousIdeaIds: input.previousIdeaIds, generation, state, renter,
          });
          const result = completedResult({ id, contextKey: input.contextKey, request: input.request, generation, selection, evidence });
          const recorded = await recordGeneration(supabaseAdmin, { profileId: userId, generationId: id, result });
          stored = recorded.row;
          return { status: 'succeeded', generation: recorded.row.status, unresolvedOperations: [] };
        },
      );
    } catch (error) {
      // The ledger (0017) is missing: nothing was claimed or stored.
      if (isOperationsUnavailable(error)) return refused(PROJECT_COPY.unavailable);
      throw error;
    }
    if (stored) return answer(stored.result);

    // A replay of this id (two tabs, or a retry after a lost answer): the row
    // if it is there by now, else what the ledger knows.
    const row = await readGeneration(supabaseAdmin, userId, id);
    if (row) return answer(row.result);
    if (outcome.status === 'pending' || outcome.status === 'unknown') return answer(terminalResult(id, input.contextKey, 'queued', undefined));
    return refused(PROJECT_COPY.notFinished);
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message: 'That request id was already used with different details.', retryable: false, requestId });
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`project generation failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}

