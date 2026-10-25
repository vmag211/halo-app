import { NextResponse, after } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseText, parseUuid } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { assistantGlobalLimiter, assistantLimiter, checkLimit, lunaConversationLimiter } from '@/lib/ratelimit';
import { chatModel, embedModel } from '@/lib/assistantRag';
import {
  OPERATION_INPUT_MISMATCH,
  isOperationsUnavailable,
  runOperation,
} from '@/lib/operations';
import {
  LUNA_FEATURE,
  LUNA_QUESTION_MAX,
  LUNA_RUN_DEADLINE_MS,
  answerFromCorpus,
  appendTurn,
  claimRun,
  createRun,
  currentConversation,
  deadlineFetch,
  diagnosticRefusal,
  findRun,
  historyLimit,
  historyPrompt,
  isLunaUnavailable,
  lunaUnavailable,
  readTurns,
  recordAnswer,
  retrievalQuery,
  runBody,
  settleRun,
  startConversation,
  unknownRunBody,
} from '@/lib/luna';
import {
  answerPick,
  findPick,
  isProposalsMissing,
  looksLikeTaskRequest,
  lunaActionsEnabled,
  lunaActionsReady,
  prepareFromMessage,
} from '@/lib/lunaActions';
import { reviewedConversation } from '@/lib/lunaActionsRoute';

/**
 * POST /api/luna/messages
 *
 *   { clientMessageId, conversationId, text, page, noteContext, guide }  ->  LunaRun
 *
 * THIS ROUTE DOES NOT ANSWER, and that is the whole design (B03 Ruling L8).
 *
 * The client aborts every request at 20 seconds (runtime.ts:116) and turns an
 * aborted mutation into 'unknown_outcome', while a free-tier model takes
 * anywhere from a few seconds to tens of seconds for one answer. So holding the
 * connection open until the answer is ready would fail the client's own
 * timeout, reliably, for exactly the answers worth waiting for. Instead:
 *
 *   validate -> store the person's turn -> create a run -> schedule the
 *   generation in `after()` -> return the run
 *
 * and the answer is collected later by `GET /api/luna/runs/status`, which the
 * component polls once a second for up to two minutes. Nothing here waits for
 * a model, and `test/routesLunaMessages.test.mjs` asserts that as a fact about
 * the route (no provider call has happened when the response is produced)
 * rather than as a measurement that would flake.
 *
 * `after()` SHARES THE ROUTE'S INVOCATION DURATION (see
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md),
 * so the platform can kill the generation in the middle of an answer. Three
 * mechanisms from lib/luna.js, not reimplemented here, make that safe:
 * `deadlineFetch` gives the whole answer one budget so it runs out of time
 * before the invocation does; every settle is a compare and set, so an answer
 * arriving after a cancellation cannot move the run; and a run left unsettled
 * past LUNA_RUN_STALE_AFTER_MS READS as 'failed', so a process that died
 * without settling anything cannot leave work that looks live. A deployment
 * must still allow an invocation at least as long as LUNA_RUN_DEADLINE_MS.
 *
 * THE RESPONSE CARRIES THE PERSON'S OWN TURN (Ruling L12). The production
 * component never appends the user's message to the transcript it shows: it
 * replaces the whole conversation with whatever came back
 * (ProductionLunaConversation.tsx:55), and discards the payload WHOLE if
 * `validLunaRun` or `validLunaConversation` fails. So every answer here carries
 * the canonical conversation, not only the `completed` ones the contract
 * requires it for.
 *
 * That is not a nicety, and it is load-bearing across two routes.
 * `GET /api/luna/runs/status` deliberately omits the conversation while a run
 * is 'queued' or 'generating', so a 500-message transcript is not re-sent on
 * every one-second poll. Both halves are contract-valid, because
 * `validLunaRun` requires the conversation only for 'completed'. But if THIS
 * route also returned a bare run, the person's own question would be invisible
 * to them for the whole wait: they would type, press send, and watch an empty
 * panel until the answer landed. Sending it once, here, is the cheap half of
 * that pair, and `conversationPayload` is the one shared builder for it.
 *
 * WHAT IS DELIBERATELY NOT USED. `noteContext` and `guide` are validated and
 * then ignored. Ruling L2: Luna answers from the public corpus only in this
 * package, and whether household readings, journal notes and symptom names may
 * reach a free-tier model is an unresolved decision of Vibhav's. A note is
 * household data, so reading one here would be that decision made by accident.
 * They are accepted rather than refused because the client always sends them
 * and a 400 would make Luna unusable from any screen with a note selected.
 *
 * REFUSAL IS STRUCTURAL AND RUNS FIRST, like /api/assistant: `diagnosticRefusal`
 * decides before anything is composed, so a diagnosis or treatment request is
 * declined reliably rather than merely likely, and no instruction a person
 * types can argue with a function. A refused question needs no model, so it is
 * answered synchronously as a `completed` run and the client stops polling at
 * once.
 *
 * SPEND IS BOUNDED THREE TIMES (Ruling L15), and each bound answers a
 * different question:
 *
 *   per household, hourly    20 questions, on /api/assistant's own key, because
 *                            both surfaces spend from one provider quota and a
 *                            second window over the same money is not a bound.
 *                            Fails OPEN: a limiter hiccup must not block the
 *                            critical path.
 *   per conversation, daily  60 questions. The hourly bound above lets one
 *                            household spend 480 in a day, more than the
 *                            app-wide ceiling holds, and a conversation costs
 *                            more per answer than a single question did because
 *                            it re-sends its history every turn. This is what
 *                            stops one enthusiastic thread taking a visible
 *                            share of everybody's day. Fails CLOSED.
 *   app-wide, daily          the existing ceiling. Fails CLOSED: the
 *                            per-household bound has no upper limit, because
 *                            anonymous ids are cheap to mint.
 *
 * The first two bound what a household and a thread may DO, so a refused
 * question is charged to both: it asks no model, but it still appends two turns
 * to that conversation. The app-wide ceiling bounds only what reaches a
 * provider, so a refusal must never spend it.
 *
 * The cost of sharing /api/assistant's keys is real and deliberate: a household
 * that has used the legacy assistant panel twenty times this hour cannot ask
 * Luna until the window moves.
 *
 * IDEMPOTENCY IS THE OPERATION LEDGER and nothing else (lib/operations.js,
 * domain 'luna'). The client sends `Idempotency-Key: <clientMessageId>` and
 * never re-POSTs a message, so a replay here is a proxy or a network retry, and
 * it must not spend a second model call or store the question twice. The
 * receipt holds the run id and NOTHING else: 0017 says `result` is a receipt,
 * not record content, and a question somebody typed is exactly the content that
 * must stay out of it. The run itself is read fresh on every call, so a replay
 * reports what is true now rather than the status that was true when the first
 * call returned.
 *
 * Requires migration 0020 and the capability flag HALO_FEATURE_LUNA (BE-351,
 * Ruling L5). Off by default and enforced here: while it is off this route
 * reads nothing, writes nothing and discloses nothing.
 */

// Ruling L14. The REQUIREMENT IS THE ORDERING, not this number:
//
//     LUNA_RUN_DEADLINE_MS (45s)  <  maxDuration (60s)  <  LUNA_RUN_STALE_AFTER_MS (75s)
//
// `after()` shares this invocation, so the generation must run out of time
// before the platform does: at or above the ceiling, the work is killed before
// `deadlineFetch` can abort it and `settleRun` can record an honest failure,
// and every slow answer would then depend on a reader deriving staleness
// instead of on anything this route wrote. The ceiling in turn sits under the
// staleness window, so a run the platform really did kill is reported failed
// shortly afterwards, while a slow but living generation inside the ceiling is
// never slandered as dead. The gap between the deadline and the ceiling is the
// room the settle after the deadline needs.
//
// 60 is the house value: cron/daily, district, map and onboard all declare it
// and all run in production, so it is a ceiling this deployment permits.
export const maxDuration = 60;

const DOMAIN = 'luna';
const KIND = 'luna.message';

/** The fields the production component sends (ProductionLunaConversation.tsx:50). */
const BODY_KEYS = ['clientMessageId', 'conversationId', 'text', 'page', 'noteContext', 'guide'];

/** The keys a `guide` carries, all of them optional strings. */
const GUIDE_KEYS = ['id', 'guideId', 'version', 'stepId'];

/**
 * The body cap, as arithmetic rather than a copied number. Legacy's 8192
 * (app/api/assistant/route.js:37) is too small: 20 notes alone can exceed it.
 *
 *   text          1,000 characters, up to 4 KB as UTF-8
 *   page            200 characters, up to 0.8 KB
 *   noteContext      20 notes x (a 200-character id + five field names), ~20 KB
 *   guide          four 200-character strings
 *   the two ids    36 characters each, plus JSON punctuation
 *
 * 32 KB is comfortably above the largest legitimate body and still a bound.
 */
const BODY_MAX_BYTES = 32_768;

/** `noteContext` holds at most 20 notes (ProductionLunaConversation.tsx:89). */
const MAX_NOTES = 20;
/** A note id and a guide string are bounded like every other contract id: 200 characters. */
const ID_MAX = 200;
/** The display label for the screen Luna was opened from. Longer than any label the client sends. */
const PAGE_MAX = 200;

/**
 * The note fields the two pickers offer (ProductionLunaConversation.tsx:89 and
 * ProductionNoteLuna.tsx:7,11,13, and doc:724). An allowlist even though
 * nothing reads them, because a field name is a request for data and an
 * unrecognised one is a client this server does not understand.
 */
const NOTE_FIELDS = new Set(['title', 'description', 'time', 'place', 'evidence']);

/**
 * The page labels that may reach the model, and why this is an allowlist.
 *
 * `page` is untrusted free text (the digest's section 1: a route title, a
 * project title, a member label, or `${Layer} map`), and
 * `buildAnswerPrompt` writes it into the SYSTEM message. Passing it through
 * would hand anyone a line inside Luna's own instructions, which is weaker than
 * /api/assistant, where `page` is an eight-member enum (route.js:10) and
 * anything unknown becomes null. Luna keeps that mechanism with its own
 * vocabulary: the route titles the client actually sends
 * (lib/frontend/foundation-preview.ts:65) plus the one fixed label.
 *
 * The cost is named rather than hidden: on a project, a factor or a map layer
 * Luna is not told which screen the person is on, which is a slightly less
 * contextual answer. An injected instruction inside its system prompt is worse.
 */
const PROMPT_PAGES = new Set([
  'Today',
  'Homeguard',
  'Map',
  'Journal',
  'Explore',
  'Settings',
  'My Week',
  'Household guidance',
]);

/** The calm sentence /api/assistant already uses when a budget runs out. Never an error. */
const LIMIT_MESSAGE = "You've reached the question limit for now. Please try again in a little while.";

/** Said for a conversation that is not this household's, and for one that does not exist. */
const NO_CONVERSATION = 'That conversation is not available.';

const badField = (field, result, requestId) =>
  validationError([{ field, code: result.code, message: result.message }], requestId);

/** 409 for an id reused with different input: a client bug or an attack, never a replay. */
const operationMismatch = (requestId) =>
  apiError({
    status: 409,
    code: ERROR_CODES.CONFLICT,
    message: 'That request id was already used for a different message.',
    retryable: false,
    requestId,
    extra: { reason: 'operation_mismatch' },
  });

/** 429, with the limit said plainly. The client substitutes its own calm sentence. */
const overBudget = (requestId) =>
  apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: LIMIT_MESSAGE, requestId });

/**
 * The model key this deployment answers with, or null.
 *
 * Read per call rather than at import, so the sandbox the route tests run in
 * sees the same value the handler does.
 */
const modelKey = () => process.env.ASSISTANT_MODEL_KEY || process.env.OPENAI_API_KEY || null;

/**
 * True when this deployment could actually answer: a model key, and both model
 * ids named. An unset model id throws rather than selecting a paid OpenAI
 * default (Ruling L1), so without one every run would be created only to fail.
 * Reporting the capability unavailable is the honest answer and writes nothing.
 */
function configured() {
  if (!modelKey()) return false;
  try {
    embedModel();
    chatModel();
    return true;
  } catch {
    return false;
  }
}

/** The question, validated against the server's own bound. Newlines stay; a pasted question has them. */
function parseQuestion(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'text_required', message: 'Ask a question to get started.' };
  }
  const parsed = parseText(raw, { maxLength: LUNA_QUESTION_MAX, rejectControl: true, allowNewlines: true });
  if (!parsed.ok) return parsed;
  if (parsed.value === '') return { ok: false, code: 'text_required', message: 'Ask a question to get started.' };
  return parsed;
}

/**
 * The note selection, validated and then deliberately unused (see the header).
 * An absent `noteContext` is an empty one: nothing was selected.
 */
function parseNoteContext(raw) {
  const fail = (message) => ({ ok: false, code: 'invalid_note_context', message });
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('Send the selected notes as a list.');
  if (raw.length > MAX_NOTES) return fail(`Select ${MAX_NOTES} notes or fewer.`);
  for (const note of raw) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) return fail('Each selected note must be an object.');
    const unknown = Object.keys(note).filter((key) => !['id', 'revision', 'fields'].includes(key));
    if (unknown.length) return fail('A selected note carries something this server does not understand.');
    const id = parseText(note.id, { maxLength: ID_MAX, required: true, rejectControl: true });
    if (!id.ok) return fail('Each selected note needs an id.');
    if (!Number.isInteger(note.revision) || note.revision < 0) return fail('Each selected note needs its revision.');
    if (!Array.isArray(note.fields) || note.fields.length > NOTE_FIELDS.size) return fail('Send the note fields as a list.');
    if (note.fields.some((field) => !NOTE_FIELDS.has(field))) {
      return fail(`A note field can only be one of ${[...NOTE_FIELDS].join(', ')}.`);
    }
  }
  return { ok: true, value: raw };
}

/**
 * The open guide, validated and then deliberately unused. Omitted entirely when
 * no guide is open (`:undefined`, dropped by JSON.stringify), so absent is
 * normal and null is not sent.
 */
function parseGuide(raw) {
  const fail = () => ({ ok: false, code: 'invalid_guide', message: 'That guide reference is not valid.' });
  if (raw === undefined) return { ok: true, value: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  if (Object.keys(raw).some((key) => !GUIDE_KEYS.includes(key))) return fail();
  for (const key of GUIDE_KEYS) {
    if (raw[key] === undefined) continue;
    const parsed = parseText(raw[key], { maxLength: ID_MAX, rejectControl: true });
    if (!parsed.ok) return fail();
  }
  return { ok: true, value: raw };
}

/** The label Luna may be told about, or null for one it does not recognise. */
const promptPage = (page) => (PROMPT_PAGES.has(page) ? page : null);

/**
 * The scheduled work: answer one question, and settle the run whatever happens.
 *
 * Runs after the response, inside the same invocation, so it owns the two
 * promises the route made: this run reaches a terminal status, and nothing is
 * written for a run that is no longer this process's to finish.
 *
 * `claimRun` is a compare and set from 'queued', so a cancellation that landed
 * first, or another invocation that already claimed it, ends this quietly with
 * nothing written. `recordAnswer` writes the answer and settles as one step and
 * removes the answer again if the settle is refused, which is how a generation
 * learns its answer lost the race with a cancel.
 */
async function generate(supabase, { profileId, conversationId, runId, question, page, seq }) {
  try {
    if (!(await claimRun(supabase, { profileId, runId }))) return;

    // One deadline for the whole answer, not per request: the budget is for the
    // answer. Started here so the clock runs from the first provider call.
    const fetchImpl = deadlineFetch(fetch, LUNA_RUN_DEADLINE_MS);
    // Ruling L3: the earlier turns only, bounded by the server. The turn this
    // run answers is excluded by its position, so the new question is sent once
    // as the question and never also as history.
    const turns = await readTurns(supabase, { profileId, conversationId, limit: historyLimit() + 1 });
    const earlier = turns.filter((turn) => turn.seq < seq);
    const history = historyPrompt(earlier);

    // B20: with HALO_FEATURE_LUNA_ACTIONS on, a message that may ask for a
    // My Week task change is read for its intent (the person's own words and
    // nothing else go to the model), and the server prepares a review for the
    // person to confirm. Off, or 0035 missing, this reads nothing and the
    // answer below is exactly as before.
    const actions = await lunaActionsReady(supabase, profileId);
    if (actions && looksLikeTaskRequest(question)) {
      const prepared = await prepareFromMessage(supabase, {
        profileId,
        conversationId,
        runId,
        question,
        apiKey: modelKey(),
        fetchImpl,
      });
      if (prepared.handled) return;
    }

    const answer = await answerFromCorpus({
      question,
      history,
      // A follow-up is searched for with the question before it, or "what
      // about X?" finds nothing (lib/luna.js `retrievalQuery`).
      retrievalText: retrievalQuery(question, earlier),
      page: promptPage(page),
      apiKey: modelKey(),
      rpc: (name, params) => supabase.rpc(name, params),
      fetchImpl,
      ...(actions ? { actions: true } : {}),
    });

    // Every outcome is an answer the person can read: generated prose with its
    // citations, the retrieved sources with the reason said plainly when the
    // chat model was unusable (Ruling L4), or an honest absence. None of them
    // is a failed run.
    if (answer.failure) {
      // The person still gets the sources (Ruling L4), but an operator has to
      // be able to see that the chat model is failing: the shape only.
      console.error(`luna chat model failed, answered with sources: ${answer.failure}`);
    }
    await recordAnswer(supabase, {
      profileId,
      conversationId,
      runId,
      text: answer.text,
      // An answer with no sources has none, so the column says so. An empty
      // array would read as "sources were considered and there were zero",
      // and the contract has no such state: the client drops an empty list.
      sources: answer.sources.length ? answer.sources : null,
      evidence: answer.evidence,
    });
  } catch (error) {
    // Retrieval or the embedding call failed, or the deadline stopped the
    // answer before anything could be composed. The run settles as failed, so
    // nothing has to notice it died, and the person is told their question is
    // kept. Only the shape of the failure is logged: a database or provider
    // message can quote the question it refused.
    console.error(`luna generation failed (run ${runId}): ${error?.code ?? error?.name ?? 'Error'}`);
    try {
      await settleRun(supabase, { profileId, runId, status: 'failed' });
    } catch (settleError) {
      // Nothing left to do: an unsettled run past its window already reads as
      // failed, which is the same answer this would have written.
      console.error(`luna could not settle run ${runId}: ${settleError?.code ?? settleError?.name ?? 'Error'}`);
    }
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    // Identity first, and only from the verified token. Nothing in the body or
    // the query can name whose conversation this is.
    const { userId } = await requireUser(request);

    // Off by default, and off means off: nothing read, nothing written, nothing
    // said about why beyond the one sentence every Luna route gives. A
    // deployment with no model key or no model id cannot answer either, and
    // says the same thing rather than creating runs that must all fail.
    if (!featureEnabled(LUNA_FEATURE) || !configured()) return lunaUnavailable(requestId);

    const body = await readJsonBody(request, { maxBytes: BODY_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

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

    const clientMessageId = parseUuid(body.value.clientMessageId);
    if (!clientMessageId.ok) return badField('clientMessageId', clientMessageId, requestId);
    // The client sends the same id as the Idempotency-Key (:50), so a header
    // that names a different one is not a replay of anything: refusing it is
    // what stops one key being spent on another message.
    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey !== null && idempotencyKey.trim().toLowerCase() !== clientMessageId.value) {
      return validationError(
        [{
          field: 'clientMessageId',
          code: 'idempotency_key_mismatch',
          message: 'The Idempotency-Key header and the clientMessageId must be the same id.',
        }],
        requestId,
      );
    }

    const question = parseQuestion(body.value.text);
    if (!question.ok) return badField('text', question, requestId);
    const page = parseText(body.value.page ?? '', { maxLength: PAGE_MAX, rejectControl: true });
    if (!page.ok) return badField('page', page, requestId);
    const noteContext = parseNoteContext(body.value.noteContext);
    if (!noteContext.ok) return badField('noteContext', noteContext, requestId);
    const guide = parseGuide(body.value.guide);
    if (!guide.ok) return badField('guide', guide, requestId);
    // `null` means "start one" (:50). Any other value must be an id, and is
    // normalized here so the same conversation written in another case is the
    // same conversation rather than a fingerprint mismatch later.
    let named = body.value.conversationId ?? null;
    if (named !== null) {
      const parsed = parseUuid(named);
      if (!parsed.ok) return badField('conversationId', parsed, requestId);
      named = parsed.value;
    }

    // Proves migration 0020 and resolves the conversation in one read, BEFORE a
    // budget is spent or a ledger id is claimed: no token is spent on a request
    // this deployment could not have served, and a conversation that is not
    // this household's is refused without writing anything.
    const existing = await currentConversation(supabaseAdmin, { profileId: userId });
    if (named !== null && named !== existing?.id?.toLowerCase()) {
      return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: NO_CONVERSATION, requestId });
    }

    // B20: the exact text of a task choice Luna offered is a pick, answered
    // here with no model at all (lib/lunaActions.js findPick). Only with the
    // capability on; off, nothing is read.
    let pick = null;
    if (existing && lunaActionsEnabled()) {
      try {
        pick = await findPick(supabaseAdmin, { profileId: userId, conversationId: existing.id, text: question.value });
      } catch (err) {
        if (!isProposalsMissing(err)) throw err;
      }
    }

    // Structural, and before everything that costs anything, exactly as
    // /api/assistant orders it (route.js:86): a refusal is decided by a
    // function, not asked of a model. A pick asks no model and is not a
    // question, so it is never refused.
    const refusal = pick ? null : diagnosticRefusal(question.value);

    // Per household, failing open: a limiter outage must not block the critical
    // path. Checked for every accepted message, refusals included, because
    // unlike /api/assistant this route writes rows and an unbounded free path
    // would be a way to fill somebody's conversation.
    const perUser = await checkLimit(assistantLimiter, `assistant:${userId}`, {
      fallback: true,
      label: 'luna limiter',
    });
    if (!perUser) return overBudget(requestId);
    // Per thread, failing closed. Only when a thread exists: the first message
    // of a household's one conversation has nothing to charge yet, and the
    // hourly bound above is what covers it. A conversation id is stable for
    // ever after that (clearing keeps it), so every later turn is charged.
    if (existing) {
      const withinThread = await checkLimit(lunaConversationLimiter, `luna:conversation:${existing.id}`, {
        fallback: false,
        label: 'luna conversation limiter',
      });
      if (!withinThread) return overBudget(requestId);
    }
    // App-wide, failing closed, and only on the path that will actually call a
    // model: the ceiling guards provider spend, so a refusal that asks no model
    // must not spend everyone else's budget.
    if (!refusal && !pick) {
      const withinCeiling = await checkLimit(assistantGlobalLimiter, 'assistant:global', {
        fallback: false,
        label: 'luna global limiter',
      });
      if (!withinCeiling) return overBudget(requestId);
    }

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: clientMessageId.value,
        profileId: userId,
        domain: DOMAIN,
        kind: KIND,
        // The fingerprint of what was asked, hashed, so the same id arriving
        // with a different question is caught as a mismatch rather than
        // answered with the first question's run.
        input: {
          text: question.value,
          conversationId: named,
          page: page.value,
          noteContext: noteContext.value,
          guide: guide.value,
        },
      },
      async () => {
        const conversation = existing ?? (await startConversation(supabaseAdmin, { profileId: userId }));
        const turn = await appendTurn(supabaseAdmin, {
          profileId: userId,
          conversationId: conversation.id,
          role: 'user',
          text: question.value,
        });
        const { run } = await createRun(supabaseAdmin, {
          profileId: userId,
          conversationId: conversation.id,
          turnId: turn.id,
          clientMessageId: clientMessageId.value,
        });

        if (refusal) {
          // No model to ask, so there is nothing to wait for: the run settles
          // here and the client stops polling on the first answer it gets.
          await recordAnswer(supabaseAdmin, {
            profileId: userId,
            conversationId: conversation.id,
            runId: run.id,
            text: refusal,
          });
        } else if (pick) {
          // No model: the review for the picked task is prepared now.
          await answerPick(supabaseAdmin, {
            profileId: userId,
            conversationId: conversation.id,
            runId: run.id,
            pick,
            replyTurnId: turn.id,
          });
        } else {
          // Everything slow, after the response. Inside the operation, so a
          // replay cannot schedule a second generation.
          after(() =>
            generate(supabaseAdmin, {
              profileId: userId,
              conversationId: conversation.id,
              runId: run.id,
              question: question.value,
              page: page.value,
              seq: turn.seq,
            }),
          );
        }

        // The receipt is an id and nothing else: 0017 says `result` is a
        // receipt, not record content, and the question is content.
        return { runId: run.id };
      },
    );

    // The run is read fresh, so a replay reports what is true now rather than
    // the status that was true when the first call answered. A ledger row that
    // is pending or past its window has no receipt to replay, so the run is
    // looked up by the client's own id instead.
    const run = await findRun(supabaseAdmin, {
      profileId: userId,
      id: outcome.result?.runId ?? clientMessageId.value,
    });
    // No run for an id this household sent: the attempt died before one
    // existed. 'failed' with the question kept is the honest answer, and a 404
    // would park the client's attempt for ever.
    if (!run) return NextResponse.json(unknownRunBody(clientMessageId.value), { headers });

    const conversation = await reviewedConversation(supabaseAdmin, { profileId: userId });
    return NextResponse.json(runBody({ row: run, conversation }), { headers });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return operationMismatch(requestId);
    if (isLunaUnavailable(err) || isOperationsUnavailable(err)) return lunaUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log, and only its shape: a database message can
    // quote the question it refused.
    console.error(`luna message failed (request ${requestId}): ${err?.code ?? err?.name ?? 'Error'}`);
    return internalError(requestId);
  }
}
