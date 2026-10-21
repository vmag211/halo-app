import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError } from '@/lib/apiErrors';
import { featureEnabled, featureDisabledReason } from '@/lib/features';
import { LUNA_FEATURE, isLunaUnavailable, lunaUnavailable } from '@/lib/luna';
import { chatModel, embedModel } from '@/lib/assistantRag';

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
 * Luna does not act. The registry at runtime.ts:58-67 holds TEN operations:
 * six are built and four are not, and the four are the tool half
 * (`luna.proposal.edit`, `luna.proposal.cancel`, `luna.confirm` and
 * `luna.operation`). The `proposal` payload that drives every one of their
 * controls is a FIELD this release never emits rather than an operation it did
 * not build, which is why the action surface disappears rather than breaking.
 * This route says all of that in the contract's own vocabulary.
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
 * WHEN THE CAPABILITY IS OFF, THIS ROUTE STILL ANSWERS (Ruling L11). The
 * endpoint whose job is to REPORT availability reports it; the endpoints that
 * ACT refuse. So the flag being off is a 200 carrying `available: false` and
 * the reason, while `runs/status` and `runs/cancel` keep the non-retryable
 * 503. This is not the trap above: Ruling L7's prohibition on
 * `available: false` was about the case where Luna DOES answer and only the
 * tool half is absent, where `blocked` would wrongly disable answering. When
 * the whole capability is off, disabling answering is accurate. It is also
 * what `GET /api/account` already does with the same flag mechanism
 * (`recoverySnapshot({ enabled: false, reason: featureDisabledReason(...) })`),
 * and it is the one case `featureDisabledReason('luna')` exists for.
 *
 * THREE FACTS CAN MAKE LUNA UNUSABLE, AND THEY DO NOT ANSWER ALIKE. In the
 * order the handler evaluates them:
 *
 *   1. the capability flag is off     -> 200, `available: false`, the reason
 *   2. migration 0020 is not applied  -> 503 `feature_unavailable`
 *   3. the flag is on, but no key     -> 200, `available: false`, the reason
 *
 * 1 is evaluated before 2 deliberately, and the order is not interchangeable:
 * a capability that is off must read nothing at all, and discovering fact 2
 * requires a read. Among the facts that can coexist with the flag ON, 2
 * outranks 3, because a 200 must never paper over a deployment fault.
 *
 * RULING L13, fact 3. Without a provider key Luna cannot answer anything, and
 * cannot even degrade to cited passages the way Ruling L4 promises:
 * `answerFromCorpus` calls `embedQuestion` with the key BEFORE retrieval
 * happens, so retrieval never runs and there are no passages to fall back to.
 * Claiming `available: true` would hand the person a Send button and fail
 * every question they typed into it. The key is read exactly as the legacy
 * assistant reads it (`app/api/assistant/route.js:32`), so the two surfaces
 * cannot disagree about what "configured" means, and it is a PRESENCE check
 * only: no network call, and the key itself never leaves `providerConfigured`,
 * which returns a boolean.
 *
 * A MISSING MIGRATION IS NOT THE SAME FACT, and stays a non-retryable 503
 * (lib/luna.js `lunaUnavailable`). "The capability is switched off" is
 * something the product chose and can report; "0020 is not applied" is a
 * deployment fault, and answering `available: true` over it would be a lie
 * the person pays for, because every question they typed would fail after
 * they sent it. Neither answer ever implies a working service.
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
 * What the answer says while the capability is off (Ruling L11).
 *
 * `providerLabel` and `retentionSummary` are the only two slots a person
 * actually reads, and the client renders them as one sentence pair with the
 * period between them (`:90`), so this pair composes exactly
 * `featureDisabledReason('luna')`. The `reason` field carries that same
 * sentence whole, for a reader that wants it in one piece, the way
 * `GET /api/account` reports a disabled capability. A test pins the pair
 * against the helper, so the halves cannot drift from it.
 *
 * Everything else keeps its off-state value from `CAPABILITIES`: no tool, no
 * context and no retrieval is claimed for a capability that is not running.
 */
const OFF = Object.freeze({
  available: false,
  providerLabel: 'Luna is not available yet',
  retentionSummary: 'You can still use HALO directly.',
});

/**
 * The answer for either fact that means "Luna cannot answer": the flag is off
 * (Ruling L11) or no provider is configured (Ruling L13).
 *
 * ONE body for both, deliberately. The person reading it is not the operator,
 * and "somebody has not switched this on" and "somebody has not finished
 * configuring it" are the same fact from their side: Luna is not available and
 * there is nothing they can do about either. Telling them which would be
 * configuration detail dressed up as an explanation.
 */
const notAvailable = (headers) =>
  NextResponse.json({ ...CAPABILITIES, ...OFF, reason: featureDisabledReason(LUNA_FEATURE) }, { headers });

/**
 * Whether a provider key is configured at all (Ruling L13).
 *
 * The same expression the legacy assistant uses
 * (`app/api/assistant/route.js:32`), read per request rather than at import,
 * so a deployment that adds the key does not need a cold start to become
 * honest. Presence only: no network call is made to find out whether the key
 * WORKS, because reporting what a deployment can do must not spend a provider
 * request and must not start failing because the provider is briefly down.
 *
 * It returns a boolean and nothing else, so no part of the key can reach a
 * response, a log line or an error envelope through this function.
 */
function providerConfigured() {
  const key = process.env.ASSISTANT_MODEL_KEY || process.env.OPENAI_API_KEY || '';
  if (key.trim().length === 0) return false;
  // Both model ids too, exactly as POST /api/luna/messages decides (its
  // `configured`): an unset id has no default (Ruling L1), so the message
  // route answers 503 to every question. Reporting `available: true` here
  // would hand the person a Send button that fails every time they press it.
  try {
    embedModel();
    chatModel();
    return true;
  } catch {
    return false;
  }
}

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

    // The three facts, in the order the block comment above sets out. Fact 1
    // first, because off means off: nothing read, nothing written and nothing
    // disclosed. What it is NOT is silent, because reporting availability is
    // this route's whole job (Ruling L11).
    if (!featureEnabled(LUNA_FEATURE)) return notAvailable(headers);

    // Fact 2. A deployment fault outranks fact 3: it is reported as a fault,
    // never softened into an answer.
    await requireLunaSchema(supabaseAdmin, userId);

    // Fact 3. Switched on, but with nothing to answer with (Ruling L13).
    if (!providerConfigured()) return notAvailable(headers);

    return NextResponse.json(CAPABILITIES, { headers });
  } catch (err) {
    if (isLunaUnavailable(err)) return lunaUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`luna capabilities read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
