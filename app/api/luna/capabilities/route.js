import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import { LUNA_FEATURE, isLunaUnavailable, lunaUnavailable } from '@/lib/luna';

/**
 * GET /api/luna/capabilities  ->  LunaCapabilities
 *
 *   { available, providerLabel, retentionSummary, publicRetrieval,
 *     context: { tasks, home, projects }, tools }
 *
 * All seven members are mandatory (`validLunaCapabilities`,
 * lib/frontend/production/luna-service.ts:29). None is optional, and a payload
 * that misses one is discarded whole.
 *
 * THIS IS THE ROUTE THAT MAKES THE PACKAGE HONEST. Luna answers and cites;
 * Luna does not act. Five of the ten Luna operations are the tool half
 * (`luna.confirm`, `luna.proposal.edit`, `luna.proposal.cancel`,
 * `luna.operation`, and the proposals that drive them) and are deliberately
 * not built. This route says so in the contract's own vocabulary.
 *
 * HOW, and why not the obvious way (Ruling L7). `available: true` with
 * `tools: []`:
 *
 *   - `tools` is the contract's declared allowlist of permitted tools. An
 *     empty array is explicitly valid, and no component reads the field, so it
 *     produces no visible change at all.
 *   - The proposal, confirm and cancel controls render only inside a
 *     `message.proposal` block (ProductionLunaConversation.tsx:93), so never
 *     attaching a proposal erases the action surface entirely: no empty state,
 *     no disabled button, no "tools unavailable" placeholder.
 *
 * `available: false` is NOT the way to report that, and the mistake is easy to
 * make. `available` is a single boolean for the whole assistant and it feeds
 * `blocked` (`:36`), which disables the Send button, every starter prompt and
 * every `choices` button, and makes `send()` and `act()` return immediately.
 * Reporting the unbuilt half that way would disable the half we are shipping
 * and turn a deliberate scope decision into a dead screen.
 *
 * So the scope is stated in prose instead, through `providerLabel` and
 * `retentionSummary`: the only two free-text slots in the whole surface, and
 * the client renders them verbatim as one sentence pair (`:90`). It also
 * appends the period after `providerLabel`, so that string must not end with
 * one.
 *
 * `publicRetrieval: false` buys the client's own sentence "Live public-source
 * lookup is not available." (`:90`). True: Luna answers from the indexed
 * public corpus, not from a live fetch at question time.
 *
 * `context: { tasks: false, home: false, projects: false }` renders as "Tasks
 * off, home records off, projects off." True, and not negotiable in this
 * package: Luna reads no household data at all (Ruling L2), so there is
 * nothing to report `true` and no setting that could make it so. It is
 * deliberately NOT read from the saved `values.luna` settings group: a person
 * who had switched those on would otherwise be told Luna uses records it
 * cannot see.
 *
 * Nothing here is household data, so every household gets the identical
 * answer. The session is still required (no Luna operation is registered
 * `public`), the owner still comes only from the verified token, and the one
 * statement this route makes is scoped to that owner.
 *
 * Degrading: the capability flag is off by default and off means off (BE-351),
 * and until migration 0020 is applied the schema is not there. Both are the
 * same non-retryable 503 `feature_unavailable` every Luna route answers with
 * (lib/luna.js `lunaUnavailable`), never a capabilities answer: `available:
 * true` over a missing schema would be a lie the person pays for, because
 * every question they typed would fail after they sent it.
 */

/**
 * `providerLabel`, rendered verbatim and followed by a period the client adds.
 *
 * It describes what answers, not who hosts it: the provider and model are
 * deployment configuration, and naming them in a response would put provider
 * detail on a screen for no one's benefit.
 */
const PROVIDER_LABEL = 'Luna answers questions from published health and environmental sources';

/**
 * `retentionSummary`, rendered verbatim after `providerLabel`.
 *
 * Three claims, each of which has to be true:
 *
 *   1. Luna cites what it answers from, and cannot act. This is the prose half
 *      of `tools: []`, and it also offsets the static UI line "Review every
 *      proposed change", which shows even when no proposal can exist.
 *   2. No household record is in the conversation (Ruling L2). This offsets
 *      the static line "Notes are included only when you choose them", which
 *      also shows although note context cannot reach an answer in this
 *      package.
 *   3. What happens to the text. NO RETENTION PERIOD IS STATED, because none
 *      is approved: the period for a conversation turn is undecided
 *      (docs/backend/privacy-and-retention.md, B03 blocker 2). What is true,
 *      and is said, is that the person can end it themselves, and
 *      `POST /api/luna/conversations/clear` really does delete the turns.
 */
const RETENTION_SUMMARY =
  'Luna quotes and cites those sources, and cannot change anything in HALO or act for you. '
  + 'Your home readings, notes, journal and tasks are not part of this conversation. '
  + 'Your questions and the answers are kept in your account until you clear this conversation or delete your account.';

/** What this deployment can do. Configuration, not household data. */
const CAPABILITIES = Object.freeze({
  available: true,
  providerLabel: PROVIDER_LABEL,
  retentionSummary: RETENTION_SUMMARY,
  publicRetrieval: false,
  context: Object.freeze({ tasks: false, home: false, projects: false }),
  // The contract's own way to say "no permitted tools". See the note above.
  tools: Object.freeze([]),
});

/**
 * Proves migration 0020 is applied before the route claims Luna can answer,
 * scoped to the caller like every other statement here. A head count returns
 * no rows, so this reads nobody's conversation: it only asks whether the table
 * is there. Mirrors `requireChallengeTable` in app/api/account/commands.
 */
async function requireLunaSchema(supabase, profileId) {
  const { error } = await supabase
    .from('luna_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId);
  if (error) throw error;
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    // Off by default, and off means off: nothing read, nothing written,
    // nothing disclosed, and no claim that the service works.
    if (!featureEnabled(LUNA_FEATURE)) return lunaUnavailable(requestId);

    await requireLunaSchema(supabaseAdmin, userId);

    return NextResponse.json(CAPABILITIES, { headers });
  } catch (err) {
    if (isLunaUnavailable(err)) return lunaUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`luna capabilities read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
