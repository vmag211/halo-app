import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { internalError, requestIdFor } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import { conversationPayload, isLunaUnavailable, lunaUnavailable } from '@/lib/luna';

/**
 * GET /api/luna/conversations?current=true
 *
 * The caller's Luna conversation, in the one shape the client validates:
 * `LunaConversationData` from `lib/frontend/production/luna-service.ts`, which
 * `validLunaConversation` checks and DISCARDS WHOLE if anything is off. Nothing
 * partial is rendered, so this route's only job is to answer with that shape or
 * with an error, never with something almost right.
 *
 * It is a single conversation, not a list. A household holds exactly one
 * (migration 0020, inherited ruling), which is all the client surface has words
 * for: the request takes no id, no cursor and no page, and `current` is the only
 * parameter it sends. `current` is therefore read as the only thing it can mean
 * here and is not required: with one conversation per household, "the current
 * one" and "the conversation" are the same row. No parameter of any kind can
 * name another household; identity comes from the verified session token alone,
 * and the query below is scoped to it.
 *
 * RULING L10: THIS READ WRITES NOTHING. A household that has never asked
 * anything is answered `{ conversation: null }`, and no row is created.
 *
 * There is no valid empty conversation to answer with: `validLunaConversation`
 * needs a non-empty `id` and a `revision` above 0 (luna-service.ts:21-27), so
 * any "empty" object would have to be a real stored conversation. Starting one
 * here would mean a GET with a side effect, and worse, both
 * ProductionLunaConversation and SettingsPanels call this route, so merely
 * opening Settings would manufacture a conversation record for somebody who has
 * never used Luna. Retention for a conversation turn is undecided and is the
 * most sensitive of the open retention questions, which makes inventing those
 * records the wrong default.
 *
 * The absent state is already the one the client handles: the component sends
 * `conversationId: conversation?.id ?? null` and `null` means "start one", so
 * whether it never validated this body or validated and discarded it, it ends
 * up asking POST /api/luna/messages to start the conversation. Starting belongs
 * there, with the first thing anyone actually said.
 *
 * This is also the reload path, and that is why it carries more than a
 * transcript. Luna's drafts are plain React state, so a page reload loses the
 * conversation, the question in flight and the parked operations; the client
 * restores all three from here. `pendingRequest` is the question a run is still
 * working on, and a run past its staleness window is deliberately not pending:
 * a dead generation must not come back as work in progress.
 * `unresolvedOperations` is always empty in this package, because Ruling L7
 * ships no proposals, but the key is present because a reload reads it.
 *
 * Luna reads no household data here (Ruling L2). This route touches the three
 * Luna tables and nothing else.
 *
 * Off unless the capability flag is on (BE-351), and off means off: the handler
 * reads no table and writes none, so a deployed interface cannot talk its way
 * past it. Until migration 0020 is applied it answers a non-retryable 503
 * `feature_unavailable`. That distinction matters here more than anywhere:
 * "this household has no conversation" and "the table does not exist" are
 * different answers, and collapsing the second into the first would hand
 * somebody an empty transcript as though it were the truth about their account.
 */

/**
 * Proves the tables this answer depends on are really there, scoped to the
 * caller like every other statement here. A count with `head: true` returns no
 * rows, so this discloses nothing and changes nothing.
 *
 * Only ever called when this household has no conversation, and it is what
 * keeps must-pass 10's distinction intact: without it, a half-applied 0020
 * would be reported as "this household has no conversation", which is a
 * different answer and not the true one. Reading an existing conversation
 * touches all three tables on the way to answering, so the hot path pays
 * nothing for this.
 */
async function requireLunaTables(supabase, profileId, tables) {
  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId);
    if (error) throw error;
  }
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    // Off by default, and off before anything is read: a capability nobody
    // turned on must not disclose whether this household has used Luna.
    if (!featureEnabled('luna')) return lunaUnavailable(requestId);

    // The whole conversation if there is one. This read proves all three of
    // 0020's tables are present before it answers, so a partial schema is
    // reported as unavailable rather than as an empty transcript.
    const existing = await conversationPayload(supabaseAdmin, { profileId: userId });
    if (existing) return NextResponse.json(existing, { headers });

    // Nothing asked yet. The other two tables are still proved, because this
    // answer is a claim about the household and not about the schema: a
    // half-applied 0020 must say so (503) rather than borrow this sentence.
    await requireLunaTables(supabaseAdmin, userId, ['luna_turns', 'luna_runs']);
    return NextResponse.json({ conversation: null }, { headers });
  } catch (err) {
    if (isLunaUnavailable(err)) return lunaUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: a database message is not for the person.
    console.error(`luna conversation read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
