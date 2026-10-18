/**
 * Luna: the conversation store, the run model, and the answer pipeline.
 *
 * This file is the foundation the three Luna route tasks build on, so the
 * shapes here are the contract between them. What it does NOT contain is as
 * important: no HTTP, no quotas, no idempotency wiring (that is the operation
 * ledger in lib/operations.js), and no path to household data at all.
 *
 * THE CLIENT HOLDS NOTHING. The production component sends one new sentence
 * per turn, carries no history, and never appends the person's own message to
 * the transcript it shows: it replaces the whole conversation with whatever
 * the server returned. Two consequences run through this file:
 *
 *   - the conversation payload must include the person's own turn, or their
 *     question disappears off their screen;
 *   - a payload that fails the client's validator is discarded WHOLE, not
 *     partially rendered, so every bound here is the client's own bound
 *     (lib/frontend/production/luna-service.ts, quoted in the B03 digest).
 *
 * THE RUN MODEL, which is the heart of it. `POST /api/luna/messages` must
 * return a run inside the client's hard 20 second timeout and must not hold
 * the connection open, so the generation happens afterwards in Next's
 * `after()`, which SHARES the route's invocation budget. The platform can
 * therefore kill the work in the middle of an answer. Three mechanisms, in
 * order of who they protect:
 *
 *   1 The generation gives itself less time than the invocation has
 *     (LUNA_RUN_DEADLINE_MS) and settles the run itself.
 *   2 Every settle is a compare and set from a non-terminal status, so an
 *     answer that arrives after a cancellation cannot move the run, and a run
 *     cannot settle twice.
 *   3 A run that is still unsettled past LUNA_RUN_STALE_AFTER_MS READS as
 *     'failed', whatever the row says. Nothing has to write it, which is the
 *     point: a process that died without settling anything cannot leave work
 *     that looks like it is still in progress. This is the same mechanism
 *     lib/operations.js uses for a stale pending receipt, with the one
 *     difference the contract forces: `LunaRun.status` has no 'unknown', so
 *     the honest derived answer is 'failed' and it carries a sentence saying
 *     the question is kept.
 *
 * NO HOUSEHOLD DATA (Ruling L2). Luna answers from the public corpus
 * (`assistant_corpus`) only in this package. Whether household readings and
 * symptom names may reach a free-tier model is an unresolved decision, so
 * there is deliberately no parameter, no column and no query here that could
 * carry them; test/luna.test.mjs fails if one appears. The table names below
 * are written as literals at each call for the same reason: the repository's
 * guardrail scans read `.from('...')` out of the source, and a constant would
 * hide these tables from them.
 *
 * Requires migration 0020. Until it is applied every call reports the feature
 * as unavailable (503, not retryable), the same way the operation routes do
 * before 0017.
 */
import { apiError, ERROR_CODES } from '@/lib/apiErrors';
import { isDiagnosticRequest, NO_SOURCE } from './assistant.js';
import {
  composeAnswer,
  embedQuestion,
  extractCitations,
  isDeclineText,
  normalizeCitations,
  retrievePassages,
} from './assistantRag.js';

/** The capability name in lib/features.js. Off by default (BE-351, Ruling L5). */
export const LUNA_FEATURE = 'luna';

// ---------------------------------------------------------------------------
// Copy. Every sentence here can reach a screen, so: no em dashes (the client
// rewrites them to commas and the repository forbids them), nothing over the
// client's limits, and no provider or database detail.
// ---------------------------------------------------------------------------

/**
 * The refusal for a diagnosis, symptom-interpretation or treatment question.
 *
 * The legacy assistant's DIAGNOSTIC_REFUSAL says the same thing but contains
 * an em dash, and it offers to explain "your environmental readings", which
 * Luna cannot do in this package (Ruling L2). Same standard of refusal, Luna's
 * own words, and no promise it cannot keep.
 */
export const LUNA_DIAGNOSTIC_REFUSAL =
  'I cannot diagnose a condition, interpret symptoms as an illness, or recommend treatment. I am not a medical tool. For anything about your health, please talk to a clinician. I can explain what the health and environmental agencies say about the things in your environment.';

/**
 * The decline when nothing in the corpus covers the question. Deliberately the
 * same sentence the legacy assistant uses: it carries no em dash, it is the
 * sentence the model is told to echo, and `isDeclineText` recognises it when a
 * model echoes it back with small variations.
 */
export const LUNA_NO_SOURCE = NO_SOURCE;

/** Ruling L4: the chat model failed, so the person gets the sources instead, said plainly. */
export const LUNA_SOURCES_ONLY =
  'I could not write an answer just now. These are the sources I found for your question.';

/** What a run that nothing finished reports. The question stays in the transcript. */
export const LUNA_RUN_FAILED_MESSAGE = 'Luna could not finish that answer. Your question is kept.';

/** What a cancelled run reports. */
export const LUNA_RUN_CANCELLED_MESSAGE = 'Request stopped. Your question is kept.';

// ---------------------------------------------------------------------------
// Bounds, all of them the client's own (luna-service.ts) unless said otherwise
// ---------------------------------------------------------------------------

/** `messages.length <= 500`, or the client discards the conversation whole. */
export const LUNA_MAX_MESSAGES = 500;
/** What the composer can send, and what `pendingRequest.text` is validated against. */
export const LUNA_QUESTION_MAX = 1000;
/** The client's text cap for any message. */
export const LUNA_TEXT_MAX = 16000;
/** `sources.length <= 30`, `title.length <= 500`, url under 3000 and https only. */
export const LUNA_MAX_SOURCES = 30;
const LUNA_MAX_TITLE = 500;
const LUNA_MAX_URL = 3000;
/** `evidence` is 1 to 20 blocks, each `text` at most 3000 characters. */
export const LUNA_MAX_EVIDENCE = 20;
const LUNA_MAX_BLOCK_TEXT = 3000;
/** `LunaRun.message` is at most 1000 characters. */
const LUNA_MAX_RUN_MESSAGE = 1000;

/**
 * How long one generation may take before it gives up on itself.
 *
 * The work runs in `after()`, which shares the route's invocation duration, so
 * the platform may kill it outright; this is the budget it keeps for itself so
 * that it settles the run rather than being killed mid-answer. 45 seconds is
 * well past a free model's normal answer (a few seconds to tens of seconds,
 * including the embedding call and OpenRouter's fallback list) and well inside
 * any platform's default invocation ceiling.
 */
export const LUNA_RUN_DEADLINE_MS = 45_000;

/**
 * How long a run may sit unsettled before a reader reports it as 'failed'.
 *
 * Bounded on both sides, and the test keeps it there. It must be LONGER than
 * the deadline above, so a generation that is slow but alive is never
 * slandered as dead. It must be SHORTER than the client's own patience: the
 * component polls 120 times at one second apart and then gives up with "Luna
 * is still working", which is the one outcome that leaves a person with
 * nothing to do. 75 seconds leaves 30 seconds of slack over the deadline and
 * still answers honestly well before the client stops asking.
 */
export const LUNA_RUN_STALE_AFTER_MS = 75_000;

/**
 * Ruling L3, the history bound, and why it is this size.
 *
 * A conversation re-sends its context on every turn, so cost grows with the
 * square of the conversation, and on a free tier the per-minute TOKEN budget
 * bites long before the daily request cap does. The arithmetic for one answer,
 * in rough characters (four characters is about a token):
 *
 *   system prompt and rules      ~1,200
 *   retrieved corpus passages    ~7,200  (6 passages, the retrieval cap)
 *   the new question             <=1,000
 *   bounded history              <=6,000  (8 turns, this bound)
 *                                -------
 *                                ~15,400 characters, about 3,900 tokens
 *
 * The passages dominate, and the history is the only part that would otherwise
 * grow without limit: twenty exchanges of ordinary length would add about
 * 10,000 more characters to EVERY later turn. Eight turns is four exchanges,
 * which is what a "what about X" follow-up actually needs.
 *
 * Configurable, never unset-able. LUNA_HISTORY_TURNS may lower it or raise it
 * as far as LUNA_HISTORY_TURN_CEILING; anything else, including 0, a negative
 * number, 'off' and a missing variable, falls back to the default. The
 * character budget is a hard ceiling that no variable and no caller can raise,
 * because it is the one that maps to spend.
 */
export const LUNA_HISTORY_MAX_TURNS = 8;
export const LUNA_HISTORY_TURN_CEILING = 20;
export const LUNA_HISTORY_MAX_CHARS = 6_000;
const LUNA_HISTORY_MIN_CHARS = 200;

/** Terminal run statuses: settled, and the outcome will not change. */
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
/** The two statuses that mean work may still be happening. */
const OPEN = ['queued', 'generating'];

const RUN_COLUMNS = 'id, profile_id, conversation_id, turn_id, client_message_id, status, message, created_at, updated_at, settled_at';
const TURN_COLUMNS = 'id, seq, role, body, sources, evidence';
const CONVERSATION_COLUMNS = 'id, profile_id, revision, created_at, updated_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The client id for a message: up to 200 printable characters, as 0020 constrains it. */
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

// ---------------------------------------------------------------------------
// Degrading cleanly before migration 0020
// ---------------------------------------------------------------------------

/**
 * "Not there yet": one of 0020's tables is missing (PGRST205 from PostgREST,
 * 42P01 from Postgres) or one of its columns is (PGRST204, 42703). The column
 * codes are here for the same reason lib/account.js has them: a partially
 * applied schema must report the capability as unavailable rather than answer
 * with a guess.
 */
const LUNA_SCHEMA_MISSING = new Set(['PGRST205', '42P01', 'PGRST204', '42703']);

/** True when the error says migration 0020 is not applied. */
export function isLunaUnavailable(error) {
  return !!error && LUNA_SCHEMA_MISSING.has(error.code);
}

/**
 * The one 503 every Luna route answers with while the capability is off or its
 * schema is missing. One helper so all five routes degrade identically rather
 * than each inventing a sentence. Not retryable: retrying cannot help, and the
 * client shows its own words anyway ("This service is unavailable").
 */
export function lunaUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: 'Luna is not available yet. Nothing was changed.',
    retryable: false,
    requestId,
  });
}

// ---------------------------------------------------------------------------
// Refusal
// ---------------------------------------------------------------------------

/**
 * The refusal this question must be answered with, or null to carry on.
 *
 * Structural, and it runs BEFORE anything is composed, like the legacy route:
 * a diagnosis request is declined reliably rather than merely likely. The
 * model is told the same rule as a second line of defence.
 */
export function diagnosticRefusal(question) {
  return isDiagnosticRequest(String(question ?? '')) ? LUNA_DIAGNOSTIC_REFUSAL : null;
}

// ---------------------------------------------------------------------------
// Ruling L3: bounded history, pure
// ---------------------------------------------------------------------------

/** The configured turn bound, clamped into [1, ceiling]. Junk and "off" fall back to the default. */
export function historyLimit() {
  return clampTurns(process.env.LUNA_HISTORY_TURNS);
}

function clampTurns(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isInteger(number) || number < 1) return LUNA_HISTORY_MAX_TURNS;
  return Math.min(number, LUNA_HISTORY_TURN_CEILING);
}

function clampChars(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(number) || number < LUNA_HISTORY_MIN_CHARS) return LUNA_HISTORY_MAX_CHARS;
  return Math.min(Math.floor(number), LUNA_HISTORY_MAX_CHARS);
}

/**
 * The earlier turns that may be sent with the next question: the newest ones
 * that fit both bounds, still oldest first.
 *
 * Pure, so the bound is provable without a model. Both bounds are clamped
 * inside the function, so no caller can widen or disable them: the server owns
 * the bound whatever anything else asks for. The walk stops at the first turn
 * that does not fit rather than skipping it, because a conversation with a
 * hole in it reads as a different conversation.
 */
export function boundedHistory(turns, { maxTurns, maxChars } = {}) {
  const turnCap = clampTurns(maxTurns === undefined ? historyLimit() : maxTurns);
  const charCap = clampChars(maxChars);
  const all = (Array.isArray(turns) ? turns : []).filter(
    (turn) => turn && typeof turn.text === 'string' && turn.text.length > 0,
  );
  const kept = [];
  let spent = 0;
  for (let at = all.length - 1; at >= 0 && kept.length < turnCap; at -= 1) {
    const size = all[at].text.length;
    if (spent + size > charCap) break;
    spent += size;
    kept.unshift(all[at]);
  }
  return kept;
}

/**
 * The bounded history as the CONVERSATION block of the prompt, or null when
 * there is nothing to say.
 *
 * The bound is applied here too, so a caller that forgets it still cannot send
 * an unbounded conversation. Each turn becomes exactly one line with its
 * whitespace collapsed: a turn containing its own newlines could otherwise
 * forge a `Luna:` line and put words in Luna's mouth. The prompt tells the
 * model the whole block is data (lib/assistantRag.js), which is the other half
 * of the same defence.
 */
export function historyPrompt(turns, options) {
  const kept = boundedHistory(turns, options);
  if (!kept.length) return null;
  return kept
    .map((turn) => `${turn.role === 'assistant' ? 'Luna' : 'Person'}: ${oneLine(turn.text)}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// The run model
// ---------------------------------------------------------------------------

/**
 * What a reader must report for this run, which is not always what the row
 * says. A run still unsettled past the staleness window reads as 'failed':
 * `LunaRun.status` has no 'unknown', and a dead generation must never be
 * reported as work in progress. Nothing writes this, so it is true even when
 * the process that should have settled the run no longer exists.
 */
export function effectiveRunStatus(row, staleAfterMs = LUNA_RUN_STALE_AFTER_MS) {
  const status = row?.status;
  if (TERMINAL.has(status)) return status;
  if (!OPEN.includes(status)) return 'failed';
  const started = Date.parse(row?.created_at);
  if (!Number.isFinite(started)) return 'failed';
  return Date.now() - started > staleAfterMs ? 'failed' : status;
}

/**
 * The `LunaRun` body for this row, as the client validates it.
 *
 * `status: 'completed'` MUST carry the conversation: the client throws the
 * whole payload away otherwise, and the person loses the answer and their own
 * question with it. That is a bug in the caller, not a state, so it throws
 * here rather than quietly sending something that will be discarded.
 */
export function runBody({ row, conversation = null, staleAfterMs = LUNA_RUN_STALE_AFTER_MS }) {
  const status = effectiveRunStatus(row, staleAfterMs);
  if (status === 'completed' && !conversation) {
    throw new Error('luna: a completed run must carry its conversation, or the client discards the whole payload');
  }
  const body = { id: row.id, status };
  const message = runMessage(row.message) || (status === 'failed' ? LUNA_RUN_FAILED_MESSAGE : '');
  if (message) body.message = message;
  if (conversation) body.conversation = conversation;
  return body;
}

/** One run of this household's, by its own id or by the client's message id. Null when there is none. */
export async function findRun(supabase, { profileId, id }) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return null;
  if (UUID.test(key)) {
    const byRunId = await oneRun(supabase, { profileId, column: 'id', value: key });
    if (byRunId) return byRunId;
  }
  if (!CLIENT_MESSAGE_ID.test(key)) return null;
  return oneRun(supabase, { profileId, column: 'client_message_id', value: key });
}

async function oneRun(supabase, { profileId, column, value }) {
  const { data, error } = await supabase
    .from('luna_runs')
    .select(RUN_COLUMNS)
    .eq('profile_id', profileId)
    .eq(column, value)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * The run this turn is answered by, created once per client message id.
 *
 * A repeat of the same client message id returns the run that already exists
 * rather than failing, so a retried request cannot start a second generation.
 * The operation ledger is still the route's idempotency record; this is the
 * storage-level half of the same promise.
 */
export async function createRun(supabase, { profileId, conversationId, turnId, clientMessageId }) {
  const key = String(clientMessageId ?? '').trim();
  if (!CLIENT_MESSAGE_ID.test(key)) throw new Error('luna: a run needs the client message id it answers');
  const { data, error } = await supabase
    .from('luna_runs')
    .insert({ profile_id: profileId, conversation_id: conversationId, turn_id: turnId, client_message_id: key })
    .select(RUN_COLUMNS)
    .single();
  if (!error) return { run: data, created: true };
  if (error.code === '23505') {
    const existing = await findRun(supabase, { profileId, id: key });
    if (existing) return { run: existing, created: false };
  }
  throw error;
}

/**
 * Claim a queued run for this process: true when it moved to 'generating',
 * false when somebody else already has it or it is settled. Compare and set,
 * so two invocations cannot both generate one answer.
 */
export async function claimRun(supabase, { profileId, runId }) {
  const { data, error } = await supabase
    .from('luna_runs')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('id', runId)
    .eq('status', 'queued')
    .select('id');
  if (error) throw error;
  return !!(data && data.length);
}

/**
 * Settle a run, once. Returns the settled row, or null when the run was
 * already terminal, which is how a generation learns that its answer arrived
 * after the person cancelled: the caller must then not write that answer.
 */
export async function settleRun(supabase, { profileId, runId, status, message = null }) {
  if (!TERMINAL.has(status)) throw new Error(`luna: a run settles as a terminal status, not "${status}"`);
  const stamp = new Date().toISOString();
  const { data, error } = await supabase
    .from('luna_runs')
    .update({ status, message: runMessage(message) || null, settled_at: stamp, updated_at: stamp })
    .eq('profile_id', profileId)
    .eq('id', runId)
    .in('status', OPEN)
    .select(RUN_COLUMNS);
  if (error) throw error;
  return (data && data[0]) || null;
}

/**
 * Cancel a run by its id or by the client's message id. An already settled run
 * is returned as it is rather than being an error: the client may send the
 * same cancel twice, and the answer to both is what actually happened.
 */
export async function cancelRun(supabase, { profileId, id, message = LUNA_RUN_CANCELLED_MESSAGE }) {
  const row = await findRun(supabase, { profileId, id });
  if (!row) return null;
  if (TERMINAL.has(row.status)) return row;
  const settled = await settleRun(supabase, { profileId, runId: row.id, status: 'cancelled', message });
  // Lost the race with the generation settling it: report what it settled as.
  return settled ?? (await findRun(supabase, { profileId, id: row.id }));
}

/**
 * The run this conversation may still be waiting on, or null. A run past the
 * staleness window is not waiting on anything, so it is not returned: the same
 * rule `effectiveRunStatus` reports with, in the one other place that would
 * otherwise show a person a request that will never finish.
 */
export async function openRun(supabase, { profileId, conversationId, staleAfterMs = LUNA_RUN_STALE_AFTER_MS }) {
  const { data, error } = await supabase
    .from('luna_runs')
    .select(RUN_COLUMNS)
    .eq('profile_id', profileId)
    .eq('conversation_id', conversationId)
    .is('settled_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data || [])[0];
  if (!row) return null;
  return TERMINAL.has(effectiveRunStatus(row, staleAfterMs)) ? null : row;
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

/** This household's conversation, or null when it has never asked anything. */
export async function currentConversation(supabase, { profileId }) {
  const { data, error } = await supabase
    .from('luna_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * This household's conversation, created if it has none.
 *
 * A household holds exactly one (migration 0020), so this is an insert that
 * yields to whoever got there first rather than a read followed by a write
 * that would race two first questions into two conversations. The client
 * ignores a conversation whose id differs from the one it holds, so a race
 * that minted a second id would strand a live session.
 */
export async function startConversation(supabase, { profileId }) {
  const existing = await currentConversation(supabase, { profileId });
  if (existing) return existing;
  const { data, error } = await supabase
    .from('luna_conversations')
    .upsert({ profile_id: profileId }, { onConflict: 'profile_id', ignoreDuplicates: true })
    .select(CONVERSATION_COLUMNS);
  if (error) throw error;
  if (data && data.length) return data[0];
  return currentConversation(supabase, { profileId });
}

/**
 * The conversation's turns, oldest first, at most `limit` of them (the newest
 * ones). Each is `{ id, seq, role, text, sources, evidence }`, which is both
 * what the payload needs and what the history bound reads.
 */
export async function readTurns(supabase, { profileId, conversationId, limit = LUNA_MAX_MESSAGES }) {
  const { data, error } = await supabase
    .from('luna_turns')
    .select(TURN_COLUMNS)
    .eq('profile_id', profileId)
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(Math.max(1, Math.min(limit, LUNA_MAX_MESSAGES)));
  if (error) throw error;
  return (data || [])
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id,
      seq: row.seq,
      role: row.role,
      text: row.body,
      sources: row.sources ?? null,
      evidence: row.evidence ?? null,
    }));
}

/**
 * Append a turn and advance the conversation's revision.
 *
 * `seq` is left to the database: migration 0020 fills it from an identity
 * sequence, so two appends cannot claim one position and no reader has to ask
 * for the highest one first. Only an assistant turn may carry sources or
 * evidence; a user turn carrying either makes the client discard the whole
 * conversation, so it is refused here as well as by the table's own check.
 */
export async function appendTurn(supabase, { profileId, conversationId, role, text, sources = null, evidence = null }) {
  if (role !== 'user' && role !== 'assistant') throw new Error(`luna: a turn is from the person or from Luna, not "${role}"`);
  const body = typeof text === 'string' ? text : '';
  if (!body.trim()) throw new Error('luna: a turn needs text');
  const max = role === 'user' ? LUNA_QUESTION_MAX : LUNA_TEXT_MAX;
  if (body.length > max) throw new Error(`luna: a ${role} turn is at most ${max} characters`);
  if (role === 'user' && (sources || evidence)) throw new Error('luna: only an answer carries sources and evidence');

  const { data, error } = await supabase
    .from('luna_turns')
    .insert({
      conversation_id: conversationId,
      profile_id: profileId,
      role,
      body,
      sources: sources ?? null,
      evidence: evidence ?? null,
    })
    .select(TURN_COLUMNS)
    .single();
  if (error) throw error;
  const revision = await bumpRevision(supabase, { profileId, conversationId });
  return { id: data.id, seq: data.seq, role, text: body, revision };
}

/**
 * Raise the conversation's revision by one, as a compare and set so two
 * concurrent appends cannot both write the same number. The client uses the
 * revision as an If-Match precondition when it clears the conversation, so a
 * revision that silently stood still would let a stale clear through.
 */
async function bumpRevision(supabase, { profileId, conversationId }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from('luna_conversations')
      .select('revision')
      .eq('profile_id', profileId)
      .eq('id', conversationId)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) throw new Error('luna: that conversation is not this household\'s');
    const next = current.revision + 1;
    const { data, error } = await supabase
      .from('luna_conversations')
      .update({ revision: next, updated_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .eq('id', conversationId)
      .eq('revision', current.revision)
      .select('revision');
    if (error) throw error;
    if (data && data.length) return next;
  }
  throw new Error('luna: could not advance the conversation revision');
}

/**
 * The `LunaConversationData` the client validates, or null when this household
 * has no conversation yet.
 *
 * Every field the client reads, every time, because this one payload is what
 * `conversations`, `messages` and `runs/status` all answer with and a reload
 * recovers from:
 *
 *   messages              the ordered transcript INCLUDING the person's own
 *                         turns, capped at the 500 the client accepts (the
 *                         newest, since a longer transcript would be thrown
 *                         away whole).
 *   pendingRequest        the question a run is still working on, so a reload
 *                         can park it again. A run past its window is not
 *                         pending; see openRun.
 *   unresolvedOperations  always empty in this package: there are no proposals,
 *                         so there is nothing a person could have parked. The
 *                         key is still present because a reload reads it.
 */
export async function conversationPayload(
  supabase,
  { profileId, conversation = null, staleAfterMs = LUNA_RUN_STALE_AFTER_MS } = {},
) {
  const row = conversation ?? (await currentConversation(supabase, { profileId }));
  if (!row) return null;
  const turns = await readTurns(supabase, { profileId, conversationId: row.id });
  const open = await openRun(supabase, { profileId, conversationId: row.id, staleAfterMs });
  return {
    id: row.id,
    revision: row.revision,
    messages: turns.map(message),
    pendingRequest: open
      ? {
          id: open.client_message_id,
          text: await askedText(supabase, { profileId, turns, turnId: open.turn_id }),
          runId: open.id,
        }
      : null,
    unresolvedOperations: {},
  };
}

/** One turn as a `LunaMessage`: the optional fields are absent, never null. */
function message(turn) {
  const shaped = { id: turn.id, role: turn.role, text: turn.text };
  if (turn.role === 'assistant' && Array.isArray(turn.sources) && turn.sources.length) shaped.sources = turn.sources;
  if (turn.role === 'assistant' && Array.isArray(turn.evidence) && turn.evidence.length) shaped.evidence = turn.evidence;
  return shaped;
}

/** The text of the turn a run is answering, for `pendingRequest.text`. */
async function askedText(supabase, { profileId, turns, turnId }) {
  const loaded = turns.find((turn) => turn.id === turnId);
  if (loaded) return loaded.text.slice(0, LUNA_QUESTION_MAX);
  // Only reachable for a conversation longer than the message cap.
  const { data, error } = await supabase
    .from('luna_turns')
    .select('body')
    .eq('profile_id', profileId)
    .eq('id', turnId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.body ?? '').slice(0, LUNA_QUESTION_MAX);
}

/**
 * Clear the conversation: delete its turns and its runs, keep its id, raise
 * its revision.
 *
 * Keeping the id is deliberate. The client ignores a server conversation whose
 * id differs from the one it holds, so rotating the id would strand a live
 * session; it accepts a strictly greater revision on the same id, which is
 * what this gives it.
 *
 * Deleting rather than marking is also deliberate: a turn is free text a
 * person typed, and "clear" has to mean the text is gone.
 *
 * Returns `{ ok: true, conversation }`, or `{ ok: false, reason }` for
 * 'not_found' (not this household's), 'conflict' (the revision moved on, with
 * the current conversation so the caller can say so) and 'run_open' (a run is
 * still working, and deleting the turn it is answering would strand it).
 */
export async function clearConversation(
  supabase,
  { profileId, conversationId, expectedRevision = null, staleAfterMs = LUNA_RUN_STALE_AFTER_MS },
) {
  const row = await currentConversation(supabase, { profileId });
  if (!row || row.id !== conversationId) return { ok: false, reason: 'not_found' };
  if (expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== row.revision) {
    return { ok: false, reason: 'conflict', conversation: await conversationPayload(supabase, { profileId, conversation: row }) };
  }
  if (await openRun(supabase, { profileId, conversationId: row.id, staleAfterMs })) {
    return { ok: false, reason: 'run_open', conversation: await conversationPayload(supabase, { profileId, conversation: row }) };
  }

  // Runs first: a run points at the turn it answers, and nothing should ever
  // be able to read a run whose question has already gone.
  const { error: runError } = await supabase
    .from('luna_runs')
    .delete()
    .eq('profile_id', profileId)
    .eq('conversation_id', row.id);
  if (runError) throw runError;
  const { error: turnError } = await supabase
    .from('luna_turns')
    .delete()
    .eq('profile_id', profileId)
    .eq('conversation_id', row.id);
  if (turnError) throw turnError;

  const revision = await bumpRevision(supabase, { profileId, conversationId: row.id });
  return {
    ok: true,
    conversation: { id: row.id, revision, messages: [], pendingRequest: null, unresolvedOperations: {} },
  };
}

// ---------------------------------------------------------------------------
// The answer: retrieval, citation, and the degrade to sources (Ruling L4)
// ---------------------------------------------------------------------------

/**
 * The retrieved passages that can actually be cited, each with the source the
 * client will accept.
 *
 * A source the client's `safeSourceUrl` rejects does not spoil one citation:
 * it makes the validator discard the ENTIRE conversation, so the person loses
 * the whole transcript over one corpus row with an http link. Dropping the
 * passage is the only safe behaviour, and dropping it before the prompt is
 * built means the model is never invited to cite something that cannot be
 * shown.
 */
export function usableSources(passages) {
  const kept = [];
  for (const passage of Array.isArray(passages) ? passages : []) {
    const text = clean(passage?.passage);
    const url = typeof passage?.source_url === 'string' ? passage.source_url.trim() : '';
    if (!text || !url || url.length > LUNA_MAX_URL) continue;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
    const title = clean(passage.source_label).slice(0, LUNA_MAX_TITLE) || parsed.hostname;
    kept.push({ passage, source: { title, url } });
    if (kept.length >= LUNA_MAX_SOURCES) break;
  }
  return kept;
}

/**
 * Answer one question from the public corpus.
 *
 * Returns `{ outcome, text, sources, evidence }`, where `outcome` is:
 *
 *   'answered'      the model wrote prose and cited at least one retrieved
 *                   source. The inline [n] markers are REMOVED, because the
 *                   client prints `text` verbatim and would show them, and the
 *                   binding between a claim and its source is carried by the
 *                   evidence blocks instead.
 *   'sources_only'  Ruling L4: the chat model was unavailable or unusable, so
 *                   the person gets the retrieved sources with the reason said
 *                   plainly rather than an error.
 *   'no_source'     nothing relevant was retrieved, the model echoed the
 *                   decline, or it wrote prose citing nothing. "Cite or
 *                   decline" is the legacy assistant's rule and Luna keeps it:
 *                   an uncited answer must never be presented as sourced.
 *
 * Every evidence block quotes the SOURCE, not the model, and that is on
 * purpose. The contract's `fact` label means "from the source", and a model
 * calling its own sentence a fact is not verification; Luna's own prose is
 * already shown as the answer's text.
 *
 * Throws only on infrastructure failure of the embedding or retrieval step, so
 * the caller can settle the run as failed instead of telling somebody there is
 * no source when the truth is that nothing was searched.
 */
export async function answerFromCorpus({ question, history = null, page = null, apiKey, rpc, fetchImpl = fetch }) {
  const embedding = await embedQuestion({ question, apiKey, fetchImpl });
  const retrieved = await retrievePassages({ embedding, rpc });
  const usable = usableSources(retrieved);
  if (!usable.length) return declined();

  const passages = usable.map((entry) => entry.passage);
  let written;
  try {
    written = normalizeCitations(await composeAnswer({ question, passages, page, history, apiKey, fetchImpl }));
  } catch {
    // Nothing from the provider is logged or returned: the person gets the
    // sources, and the route logs its own line.
    return sourcesOnly(usable);
  }
  if (isDeclineText(written)) return declined();

  const cited = extractCitations(written, passages);
  if (!cited.length) return declined();
  const order = cited.map((citation) => citation.n - 1);
  return {
    outcome: 'answered',
    text: stripCitationMarkers(written),
    sources: order.map((at) => usable[at].source),
    evidence: order.slice(0, LUNA_MAX_EVIDENCE).map((at, index) => factBlock(usable[at].passage, index)),
  };
}

const declined = () => ({ outcome: 'no_source', text: LUNA_NO_SOURCE, sources: [], evidence: null });

function sourcesOnly(usable) {
  const used = usable.slice(0, LUNA_MAX_EVIDENCE);
  return {
    outcome: 'sources_only',
    text: LUNA_SOURCES_ONLY,
    sources: used.map((entry) => entry.source),
    evidence: used.map((entry, index) => factBlock(entry.passage, index)),
  };
}

/** One `fact` block: what the source says, bound to that source and nothing else. */
function factBlock(passage, index) {
  return { kind: 'fact', text: excerpt(passage.passage), sourceIndexes: [index] };
}

/**
 * The inline markers removed, with the space they leave behind.
 *
 * The client's renderer does not parse `[1]` or `[H]`: it prints the text as
 * it is, so a marker would appear on screen as literal brackets and digits.
 */
export function stripCitationMarkers(text) {
  return String(text ?? '')
    .replace(/[ \t]*\[(?:\d+|[Hh])\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .trim();
}

/** Text with the control characters the client rejects removed, and its whitespace tidied. */
function clean(value, max = LUNA_TEXT_MAX) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

/** One line: every run of whitespace becomes a single space, so a turn cannot forge another. */
const oneLine = (value) => clean(value).replace(/\s+/g, ' ');

/** A passage, short enough for an evidence block and cut at a word. */
function excerpt(value, max = 600) {
  const text = clean(value, LUNA_MAX_BLOCK_TEXT);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** A run message the client will accept, or '' for none. */
const runMessage = (value) => clean(value, LUNA_MAX_RUN_MESSAGE);
