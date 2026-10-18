import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError, apiError, ERROR_CODES } from '@/lib/apiErrors';
import { parseText } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import {
  LUNA_FEATURE,
  conversationPayload,
  effectiveRunStatus,
  findRun,
  isLunaUnavailable,
  lunaUnavailable,
  runBody,
  unknownRunBody,
} from '@/lib/luna';

/**
 * GET /api/luna/runs/status?id=<run id or clientMessageId>  ->  LunaRun
 *
 *   { id, status, message?, conversation? }
 *
 * How the answer actually reaches a person. `POST /api/luna/messages` has to
 * return inside the client's hard 20 second timeout (runtime.ts:116) and must
 * not hold the connection open, so it returns a run and the generation happens
 * afterwards. The component then polls this route up to 120 times, exactly a
 * second apart, and learns the run finished only by `status` becoming
 * `completed`, `failed` or `cancelled` (ProductionLunaConversation.tsx:51-59).
 * There is no done flag, no ETag and no stream.
 *
 * THE ID IS ASKED WITH EITHER KEY AND COMES BACK AS ONE. The client polls with
 * `prior.runId ?? prior.id`, so the id may be the run's own or the original
 * `clientMessageId` from before any run id was known (`:50`). It then adopts
 * `response.id` and polls with that (`:54`, `:58`), so the answer always
 * carries the canonical `LunaRun.id`: an id that changed between polls would
 * make the client chase a moving target.
 *
 * AN ID WITH NO RUN IS A FAILED RUN, NEVER A 404, and this is the decision
 * worth reading twice. The component stops polling only on a terminal status,
 * and a 404 maps to 'unavailable' (runtime.ts:144), which leaves the attempt
 * parked with nothing the person can do about it. A question refused before a
 * run existed, by a rate limit or a validation failure the client did not see,
 * still leaves it polling with its own message id. `LunaRun` has no 'unknown',
 * so the honest terminal answer is `failed` with a sentence saying the
 * question is kept (lib/luna.js `unknownRunBody`). The same answer is given
 * for another household's run id, so it cannot be used to find out whether
 * somebody else's run exists.
 *
 * A RUN PAST ITS WINDOW READS AS FAILED, whatever the row says
 * (`effectiveRunStatus`). The generation runs in `after()`, which shares the
 * route's invocation budget, so the platform can kill it mid-answer; nothing
 * would then be left to settle the run, and a person would be told work was in
 * progress for ever.
 *
 * WHEN THE CONVERSATION IS ATTACHED. On a terminal status, always: `completed`
 * must carry it or the client discards the whole payload, and for `failed` and
 * `cancelled` it is what puts the person's kept question back on their screen
 * (`:55` applies `conversation` before it looks at the status). On `queued` and
 * `generating` it is deliberately left off: the client does nothing with a
 * transcript that has not changed, and re-sending up to 500 messages every
 * second for the life of a run would cost the person bandwidth and the
 * deployment egress for no effect. The person's own turn reaches the screen
 * from the POST that created the run, which has just written it.
 *
 * The owner comes only from the verified session token, and the lookup is
 * scoped to that owner in the query itself. A read: nothing here writes.
 *
 * Degrading: the capability flag is off by default and off means off
 * (BE-351); until migration 0020 is applied the schema is not there. Both are
 * the same non-retryable 503 `feature_unavailable` (lib/luna.js
 * `lunaUnavailable`), never a run this route invented.
 */

/** Terminal: settled, and the outcome will not change. */
const TERMINAL = ['completed', 'failed', 'cancelled'];

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

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const url = new URL(request.url);

    // Off by default, and off means off: nothing read, nothing disclosed, and
    // no run reported for a capability that is not running anything.
    if (!featureEnabled(LUNA_FEATURE)) return lunaUnavailable(requestId);

    // The client's own bound on any id it will accept back is 200 characters
    // (luna-service.ts:28). An id outside that could never have been a run of
    // ours, so it is a client bug and is named as one rather than answered
    // with a run that never existed.
    const id = parseText(url.searchParams.get('id'), { maxLength: 200, required: true, rejectControl: true });
    if (!id.ok) return badField('id', id, requestId);

    const row = await findRun(supabaseAdmin, { profileId: userId, id: id.value });
    if (!row) return NextResponse.json(unknownRunBody(id.value), { headers });

    // See "WHEN THE CONVERSATION IS ATTACHED" above. The same rule is applied
    // by POST /api/luna/runs/cancel, whose outcomes are all terminal.
    //
    // B03 task 3 considered hoisting these three lines into lib/luna.js, which
    // owns every piece of them, and decided against it: POST /api/luna/messages
    // is the third route that returns a LunaRun and it deliberately attaches
    // the conversation on EVERY status (Ruling L12), so a shared helper would
    // serve two of the three and would read as the house rule rather than as
    // the choice these two made. What the duplication risks is the two routes
    // drifting apart, and that is pinned behaviourally instead:
    // test/contractsB03.test.mjs asserts this route and runs/cancel answer with
    // the same shape for the same run, terminal and non-terminal.
    const status = effectiveRunStatus(row);
    const conversation = TERMINAL.includes(status) ? await conversationPayload(supabaseAdmin, { profileId: userId }) : null;
    return NextResponse.json(runBody({ row, conversation }), { headers });
  } catch (err) {
    if (isLunaUnavailable(err)) return lunaUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`luna run status failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
