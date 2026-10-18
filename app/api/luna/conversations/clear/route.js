import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseBoundedInt, parseUuid } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { clearConversation, isLunaUnavailable, lunaUnavailable } from '@/lib/luna';

/**
 * POST /api/luna/conversations/clear
 *
 *   { id, revision }  ->  the cleared `LunaConversationData`
 *
 * Deletes the caller's Luna transcript. The turns are deleted, not marked: a
 * turn is free text a person typed, and "clear" has to mean the text is gone.
 *
 * THE RECEIPT THE CLIENT WILL ACCEPT, which is the whole difficulty of this
 * route. `ProductionLunaClear.ts:19` checks the answer like this:
 *
 *   if(!validLunaConversation(result)||result.messages.length
 *      ||result.id===attempt.conversationId&&result.revision<=attempt.revision)
 *     throw new Error('invalid conversation receipt')
 *
 * So the answer must be a valid conversation, with no messages, and with EITHER
 * a new id OR a strictly greater revision than the one the caller held. A
 * cleared conversation returning the same id and the same revision is thrown
 * away whole, and clearing would appear to a person to do nothing at all. This
 * route keeps the id and raises the revision, which is the half of that choice
 * a live session survives: the client ignores a server conversation whose id
 * differs from the one it holds (`ProductionLunaConversation.tsx:39`), so
 * rotating the id would strand whichever panel was not looking.
 *
 * The body is exactly the two fields the client sends, and both are validated
 * here because the client is never authority. Anything else in the body is a
 * client that is confused about this endpoint, so it is refused rather than
 * ignored, and that is also what stops a field smuggling in another household:
 * identity comes only from the verified session token, and every statement is
 * scoped to it.
 *
 * IDEMPOTENCY IS THE OPERATION LEDGER AND NOTHING ELSE (migration 0017). The
 * `operationId` is the `Idempotency-Key` header, which is the only place it
 * can come from: the client's body here is exactly `{id, revision}` with no
 * operation field (`test/ui/luna-live.spec.ts:76` asserts that body verbatim).
 * The header is therefore required: a mutation with no ledger entry could not
 * answer "did my clear apply" after a lost response, and the client stores the
 * key in a draft and reuses it, so the same key means the same attempt. The row
 * is claimed before the delete, a replay answers with the first attempt's
 * receipt without clearing again, and the same key arriving with different
 * input is a 409 rather than a wrong replay.
 *
 * THE PRECONDITION IS CHECKED INSIDE THE OPERATION, after the id is claimed,
 * for the same reason POST /api/account/commands does it there: the first
 * clear raises the revision, so a replay necessarily carries what is now a
 * stale number, and checking first would answer a conflict where the contract
 * requires the first outcome.
 *
 * Three refusals, each a 409 the client reads as a conflict and re-reads after:
 *
 *   stale_revision  the conversation moved on, so this clear was decided
 *                   against a transcript that is no longer what is there. The
 *                   current revision is included, which is what to reload from.
 *   unknown_conversation  not this household's conversation. Identical for an
 *                   id belonging to somebody else and an id that never existed,
 *                   so the answer cannot be used to find out whose it is.
 *   run_open        a run is still working. Deleting the turn it is answering
 *                   would strand it, and the client's own preflight already
 *                   refuses to clear while a request is in flight, so this is
 *                   the stale-view race rather than ordinary use.
 *
 * A refusal is an HTTP status and not a receipt body, because the only body
 * shape this operation has is a conversation: a `{status:'failed', message}`
 * receipt would fail the client's validator and be discarded, telling the
 * person nothing.
 *
 * The capability is off unless its flag is on (BE-351), decided before the body
 * is even read, so an off capability cannot be probed. Until migrations 0017
 * and 0020 are applied the route answers a non-retryable 503
 * `feature_unavailable`, decided before the operation id is claimed and before
 * anything is deleted, so "nothing was changed" is true when it says so.
 *
 * Luna reads no household data (Ruling L2), and clearing writes to nothing but
 * this household's own Luna rows.
 */

/** The body is two fields: a uuid and a small integer. */
const MAX_BYTES = 1024;

/** The only keys the body may carry. */
const BODY_KEYS = Object.freeze(['id', 'revision']);

/** The three Luna tables, all proved before anything is deleted. */
const LUNA_TABLES = Object.freeze(['luna_conversations', 'luna_turns', 'luna_runs']);

/** What a person is told when their view of the conversation is out of date. */
const CONFLICT_MESSAGE = 'This conversation changed. Please review it again.';

/** What a person is told when the id they sent is not a conversation of theirs. */
const UNKNOWN_MESSAGE = 'That conversation was not found.';

/** What a person is told when Luna is still answering. */
const RUN_OPEN_MESSAGE = 'Luna is still answering. Wait for that to finish, then clear the conversation.';

/** 409 for an operation id reused with different input: a client bug or an attack, never a replay. */
const MISMATCH_MESSAGE = 'That request was already made with different details. Please try again.';

/** A 400 naming the field that failed, using the validator's own code and message. */
const badField = (field, result, requestId) =>
  validationError([{ field, code: result.code, message: result.message }], requestId);

/**
 * 503 for an attempt on this id that has not settled, so the outcome is not
 * known. `upstream_unavailable` because that is the one 503 code in this
 * repository that does not claim the capability is absent: it is present, and
 * the thing that has not answered is the earlier attempt. Retryable, unlike the
 * missing-migration 503, because the earlier attempt will settle.
 */
const inFlight = (requestId) =>
  apiError({
    status: 503,
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: 'That request is still being processed. Please check the conversation before trying again.',
    retryable: true,
    requestId,
  });

/** A 409 the client maps to a conflict, carrying why for a log and a contract test. */
const conflict = (message, requestId, extra) =>
  apiError({
    status: 409,
    code: ERROR_CODES.CONFLICT,
    message,
    retryable: false,
    requestId,
    extra,
  });

/**
 * Proves every table this route writes to is really there, scoped to the caller
 * like every other statement here.
 *
 * All three, not only the first one a code path happens to touch: this route
 * deletes from two tables and updates a third, and a half-applied migration
 * discovered between those deletes would make the 503's "nothing was changed"
 * false. Checking here rather than relying on the order lib/luna.js deletes in
 * also means a later change to that order cannot quietly reopen the hole.
 */
async function requireLunaTables(supabase, profileId) {
  for (const table of LUNA_TABLES) {
    const { error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId);
    if (error) throw error;
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    // Off by default, and decided before the body is read: while the capability
    // is off this handler reads nothing, writes nothing, and answers the same
    // way whatever was sent to it.
    if (!featureEnabled('luna')) return lunaUnavailable(requestId);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key)).sort();
    if (unknown.length > 0) {
      return validationError(
        unknown.map((key) => ({
          field: key,
          code: 'unknown_field',
          message: `Only ${BODY_KEYS.join(' and ')} can be sent.`,
        })),
        requestId,
      );
    }

    const id = parseUuid(body.value.id);
    if (!id.ok) return badField('id', id, requestId);
    // The client's own bound: a revision is an integer strictly greater than 0.
    const revision = parseBoundedInt(body.value.revision, { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (!revision.ok) return badField('revision', revision, requestId);

    // `If-Match` carries the same number as the body (runtime.ts:133). A client
    // sending two different preconditions does not know what it is asking for,
    // and must not be able to weaken the one that is enforced.
    const ifMatch = request.headers.get('if-match');
    if (ifMatch !== null && ifMatch.trim() !== String(revision.value)) {
      return validationError(
        [{
          field: 'revision',
          code: 'precondition_mismatch',
          message: 'The If-Match header and revision must be the same revision.',
        }],
        requestId,
      );
    }

    // The ledger is the only idempotency mechanism, and the header is the only
    // place this operation's id exists, so a request without a usable one is
    // refused rather than performed un-replayably.
    const operationId = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!operationId.ok) {
      return validationError(
        [{
          field: 'Idempotency-Key',
          code: operationId.code,
          message: 'Send an Idempotency-Key header carrying this request\'s own id.',
        }],
        requestId,
      );
    }

    // Both migrations are proved here, before the operation id is claimed and
    // before anything is deleted, so an unavailable feature has changed nothing
    // when it says so.
    await requireLunaTables(supabaseAdmin, userId);

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: 'luna',
        kind: 'luna.clear',
        input: { id: id.value, revision: revision.value },
      },
      async () => {
        const cleared = await clearConversation(supabaseAdmin, {
          profileId: userId,
          conversationId: id.value,
          expectedRevision: revision.value,
        });
        if (cleared.ok) return { status: 'succeeded', conversation: cleared.conversation };
        // A terminal refusal, recorded as what happened: the ledger holds the
        // reason so a replay answers the same way, and the route turns it back
        // into the status the client reads as a conflict. Nothing of the
        // transcript goes in: `conversation` is omitted deliberately, and the
        // succeeded receipt above carries an already empty one.
        return {
          status: 'failed',
          reason: cleared.reason,
          ...(cleared.reason === 'conflict' ? { revision: cleared.conversation.revision } : {}),
        };
      },
    );

    // A replay of an operation that is still running, or that died before it
    // settled, has no receipt to replay. The honest answer is that the outcome
    // is not confirmed, and a 5xx on a mutation is exactly how this client says
    // that to a person ("The result is not confirmed. Check its status before
    // trying again.", runtime.ts:144,156). It is not a success and not a
    // failure, and nothing is cleared a second time to find out which.
    if (!outcome.result) return inFlight(requestId);
    if (outcome.result.status === 'failed') {
      const reason = outcome.result.reason;
      if (reason === 'conflict') {
        return conflict(CONFLICT_MESSAGE, requestId, { reason: 'stale_revision', revision: outcome.result.revision });
      }
      if (reason === 'run_open') return conflict(RUN_OPEN_MESSAGE, requestId, { reason: 'run_open' });
      return conflict(UNKNOWN_MESSAGE, requestId, { reason: 'unknown_conversation' });
    }

    // Exactly the conversation, which is the only shape the client accepts here.
    return NextResponse.json(outcome.result.conversation, { headers });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return conflict(MISMATCH_MESSAGE, requestId, { reason: 'operation_mismatch' });
    }
    if (isLunaUnavailable(err) || isOperationsUnavailable(err)) return lunaUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: a database message is not for the person.
    console.error(`luna conversation clear failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
