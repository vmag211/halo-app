import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError, apiError, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseText } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import {
  OPERATION_INPUT_MISMATCH,
  isOperationsUnavailable,
  operationsUnavailable,
  runOperation,
} from '@/lib/operations';
import {
  LUNA_FEATURE,
  cancelRun,
  conversationPayload,
  effectiveRunStatus,
  findRun,
  isLunaUnavailable,
  lunaUnavailable,
  runBody,
  unknownRunBody,
} from '@/lib/luna';

/**
 * POST /api/luna/runs/cancel
 *
 *   { id }  ->  LunaRun
 *
 * "Stop waiting for this answer." The client aborts its in-flight poll first,
 * then posts this (ProductionLunaConversation.tsx:64), and accepts the outcome
 * only when `status` is `cancelled`, `completed` or `failed`. Anything else,
 * `queued` and `generating` included, it reports as unconfirmed and leaves the
 * person's attempt parked, so this route must answer with what actually
 * happened to the run and never with work still in progress.
 *
 * `completed` is a legitimate answer: the generation may have finished during
 * the race, and the honest report of that is the finished answer, not a
 * cancellation that did not happen. The client's accepted set allows it, and
 * its generation counter stops a late answer from being rendered after the
 * person stopped waiting (`:48`, `:52`).
 *
 * BODY AND HEADER. The body is exactly `{ id }`: the run id, or the original
 * `clientMessageId` when no run id is known yet, the same either-key lookup
 * `runs/status` does. Validated here on the server; the client is never
 * authority, and nothing in the body may name an owner.
 *
 * IDEMPOTENCY, and the one mismatch this route has to bridge. Cancelling is a
 * mutation, so it goes through the operation ledger (lib/operations.js, domain
 * `luna`) and never through a second mechanism. But the client sends
 * `Idempotency-Key: cancel:<clientMessageId>` (`:64`), a prefixed string, and
 * the ledger's `operations.operation_id` is `uuid primary key`
 * (0017_operations_ledger.sql:45), so the header cannot be stored as it
 * arrives. `operationIdFor` derives a stable name-based UUID from it: the same
 * header always yields the same id, which is what makes a replay return the
 * first outcome, and the namespace prefix keeps it clear of the UUID the
 * message route claims for the same `clientMessageId`.
 *
 * WHAT GOES IN THE RECEIPT, and what does not. The ledger's `result` is a
 * receipt, not record content (0017:41-42, BE-313), and a `LunaRun` can carry
 * a whole conversation, which is the most sensitive free text in this package.
 * So the stored receipt holds the outcome only (which run, what it settled
 * as), and the conversation is composed at read time from the store on both
 * the first call and the replay. The run status in the receipt is terminal, so
 * recomposing cannot drift from the first outcome.
 *
 * AN ID WITH NO RUN IS A FAILED RUN, NEVER A 404, for the same reason as
 * `runs/status`: the client only stops waiting on a terminal status, and a 404
 * would park the attempt for ever. Another household's run id gets that
 * identical answer and nothing of theirs is touched, so it cannot be used to
 * find out whether somebody else's run exists.
 *
 * Degrading: the capability flag is off by default and off means off
 * (BE-351); until migration 0020 is applied the schema is not there, and
 * until 0017 the ledger is not. All three are a non-retryable 503
 * `feature_unavailable`, and the schema is proved BEFORE the operation id is
 * claimed, so an unavailable feature leaves no ledger row behind to replay a
 * stale failure from once the migration is applied.
 */

/** The only field the contract sends. */
const BODY_KEYS = ['id'];

/** Terminal: settled, and the outcome will not change. */
const TERMINAL = ['completed', 'failed', 'cancelled'];

/**
 * Keeps the derived ids of this route in their own space, so one
 * `clientMessageId` cannot produce the same operation id for a cancel and for
 * the message it cancels.
 */
const CANCEL_NAMESPACE = 'halo:luna:runs/cancel:';

/**
 * A stable UUID for one `Idempotency-Key`, so the ledger's uuid column can
 * hold the client's prefixed key. Name based (RFC 4122 version 5 shape, with a
 * SHA-256 digest): the same key always derives the same id, and no key can be
 * guessed back out of one.
 */
function operationIdFor(idempotencyKey) {
  const digest = createHash('sha256').update(`${CANCEL_NAMESPACE}${idempotencyKey}`).digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5: a name based id
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/** A 400 naming the field that failed, using the validator's own code and message. */
function badField(field, result, requestId) {
  return apiError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: result.message,
    fieldErrors: [{ field, code: result.code, message: result.message }],
    retryable: false,
    requestId,
  });
}

/**
 * Proves migration 0020 is applied before the operation id is claimed, scoped
 * to the caller. A head count returns no rows: it asks whether the table is
 * there, not what is in it.
 */
async function requireLunaSchema(supabase, profileId) {
  const { error } = await supabase
    .from('luna_runs')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId);
  if (error) throw error;
}

/**
 * The `LunaRun` for this id as things now stand. The conversation is attached
 * for a terminal run, which every settled cancellation is: `completed`
 * requires it, and for `cancelled` and `failed` it is what puts the person's
 * kept question back on their screen (`:64` applies it before it reads the
 * status). The same rule is applied by GET /api/luna/runs/status.
 */
async function currentRun(supabase, { profileId, id }) {
  const row = await findRun(supabase, { profileId, id });
  if (!row) return unknownRunBody(id);
  const status = effectiveRunStatus(row);
  const conversation = TERMINAL.includes(status) ? await conversationPayload(supabase, { profileId }) : null;
  return runBody({ row, conversation });
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: 2048 });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    // The client's own bound on any id it will accept back is 200 characters
    // (luna-service.ts:28), so an id outside that could never have been a run
    // of ours and is named as a client bug.
    const id = parseText(body.value.id, { maxLength: 200, required: true, rejectControl: true });
    if (!id.ok) return badField('id', id, requestId);

    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key)).sort();
    if (unknown.length > 0) {
      return validationError(
        unknown.map((key) => ({
          field: key,
          code: 'unknown_field',
          message: `Only ${BODY_KEYS.join(', ')} can be sent.`,
        })),
        requestId,
      );
    }

    // The header is this mutation's only idempotency record, so without it
    // there is nothing to replay and the work is refused rather than done
    // outside the ledger.
    const header = parseText(request.headers.get('idempotency-key'), {
      maxLength: 200,
      required: true,
      rejectControl: true,
    });
    if (!header.ok) {
      return validationError(
        [{
          field: 'operationId',
          code: header.code === 'text_required' ? 'idempotency_key_required' : header.code,
          message: 'An Idempotency-Key header is required to stop a request.',
        }],
        requestId,
      );
    }
    const operationId = operationIdFor(header.value);

    // Off by default, and off means off: nothing read, nothing written, and no
    // run reported for a capability that is not running anything.
    if (!featureEnabled(LUNA_FEATURE)) return lunaUnavailable(requestId);

    // Before the claim, so an unavailable feature has changed nothing and
    // claimed no operation id when it says so.
    await requireLunaSchema(supabaseAdmin, userId);

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId,
        profileId: userId,
        domain: 'luna',
        kind: 'luna.cancel',
        input: { id: id.value },
      },
      async () => {
        const settled = await cancelRun(supabaseAdmin, { profileId: userId, id: id.value });
        // Outcome only. The conversation is composed below, so the person's
        // own words never reach the ledger.
        return { status: 'succeeded', runId: settled ? settled.id : null };
      },
    );

    // Composed from the store on both paths, so a replay answers with the
    // first outcome rather than with a frozen copy of it. A replay whose first
    // call died before settling anything reports the run as it really is:
    // still open, which the client reads as unconfirmed, and `failed` once the
    // run outstrips its staleness window.
    const runId = outcome.result?.runId ?? null;
    return NextResponse.json(await currentRun(supabaseAdmin, { profileId: userId, id: runId ?? id.value }), { headers });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return apiError({
        status: 409,
        code: ERROR_CODES.CONFLICT,
        message: 'That request id was already used for something else.',
        retryable: false,
        requestId,
      });
    }
    if (isLunaUnavailable(err)) return lunaUnavailable(requestId);
    if (isOperationsUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`luna run cancel failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
