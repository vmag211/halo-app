import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { isDiagnosticRequest, DIAGNOSTIC_REFUSAL, DISCLAIMER, NO_SOURCE, suggestedQuestions } from '@/lib/assistant';
import { answerQuestion } from '@/lib/assistantRag';
import { gatherHouseholdContext } from '@/lib/assistantContextData';
import { ERROR_CODES, apiError, internalError, requestIdFor, validationError } from '@/lib/apiErrors';
import { readJsonBody, parseText } from '@/lib/validate';

// Pages the assistant can be opened from; anything else is ignored.
const PAGES = new Set(['today', 'home', 'homeguard', 'map', 'journal', 'act', 'settings', 'learn']);
import { assistantLimiter, assistantGlobalLimiter, checkLimit } from '@/lib/ratelimit';

/**
 * POST /api/assistant  { question, page? }
 * GET  /api/assistant?page=today  → three suggested opening questions
 *
 * The structural diagnostic check runs FIRST, before any answer is composed
 * (§18.4), so a diagnosis request is declined reliably rather than merely likely.
 *
 * The grounded-answer path (embed the question → retrieve the nearest curated
 * passages by cosine distance → compose a cited answer) is BUILT in
 * lib/assistantRag.js but gated on an embedding/model key and an ingested
 * assistant_corpus (migrations 0007 + 0008, scripts/ingest-corpus.mjs). Without a
 * key the route declines honestly; with a key but an empty/irrelevant corpus the
 * pipeline itself declines with NO_SOURCE rather than improvising. Every response
 * carries the not-medical-advice disclaimer.
 *
 * Spend is bounded twice (§37.2): 20 questions per user per hour, and an
 * app-wide daily cap (default 450, ASSISTANT_GLOBAL_DAILY_LIMIT). TODO (gated on a model key): stream the answer.
 */

const MODEL_KEY = process.env.ASSISTANT_MODEL_KEY || process.env.OPENAI_API_KEY || null;

// A question is a sentence or two: the cap bounds the model prompt, and the body cap
// leaves room for it plus the page.
const QUESTION_MAX = 1000;
const POST_MAX_BYTES = 8192;

/**
 * The question to ask, trimmed, or a field error that keeps the sentences this route
 * has always used. Tabs and line breaks stay (a pasted question can have them); other
 * control characters do not, because the text is written into the model prompt.
 */
function parseQuestion(raw) {
  const field = (code, message) => ({ error: { field: 'question', code, message } });
  if (raw === undefined || raw === null) return field('question_required', 'Ask a question to get started.');
  const text = parseText(raw, { maxLength: QUESTION_MAX, rejectControl: true, allowNewlines: true });
  if (!text.ok && text.code === 'invalid_text') return field('invalid_text', 'Ask a question to get started.');
  if (!text.ok && text.code === 'text_too_long') return field('text_too_long', 'That question is too long.');
  if (!text.ok) return field(text.code, text.message);
  if (text.value === '') return field('question_required', 'Ask a question to get started.');
  return { value: text.value };
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    const page = new URL(request.url).searchParams.get('page') || '';
    return NextResponse.json({ suggestions: suggestedQuestions(page), disclaimer: DISCLAIMER }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const r = authErrorResponse(err, requestId);
    if (r) return r;
    console.error(`assistant suggestions failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: POST_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    // An unknown page is ignored, not refused: it only steers which facts are weighted.
    const page = typeof body.value.page === 'string' && PAGES.has(body.value.page.toLowerCase()) ? body.value.page.toLowerCase() : null;

    const asked = parseQuestion(body.value.question);
    if (asked.error) return validationError([asked.error], requestId);
    const question = asked.value;

    // Structural refusal runs before anything else.
    if (isDiagnosticRequest(question)) {
      return NextResponse.json({ declined: true, message: DIAGNOSTIC_REFUSAL, disclaimer: DISCLAIMER, citations: [] }, { headers });
    }

    // Grounded-answer path is gated on a model key + an ingested corpus.
    if (!MODEL_KEY) {
      return NextResponse.json({
        answer: null,
        configured: false,
        reason: 'no_source',
        message: NO_SOURCE,
        disclaimer: DISCLAIMER,
        citations: [],
        note: 'The assistant needs an embedding/model key and an ingested source corpus (migrations 0007 + 0008) to answer.',
      }, { headers });
    }

    // Two bounds on the paid model path (§37.2). The per-user check fails open, so
    // one household isn't blocked by a limiter hiccup. The app-wide ceiling fails
    // CLOSED: during an Upstash outage it pauses the assistant, because the
    // per-user bound alone has no upper limit (anonymous ids are cheap to mint).
    const perUser = await checkLimit(assistantLimiter, `assistant:${userId}`, {
      fallback: true,
      label: 'assistant limiter',
    });
    const global = perUser
      ? await checkLimit(assistantGlobalLimiter, 'assistant:global', {
          fallback: false,
          label: 'assistant global limiter',
        })
      : false;
    if (!perUser || !global) {
      // The envelope, plus the fields the assistant panel already reads from a 429.
      const limited = apiError({
        status: 429,
        code: ERROR_CODES.RATE_LIMITED,
        message: "You've reached the question limit for now. Please try again in a little while.",
        requestId,
      });
      return NextResponse.json(
        { answer: null, configured: true, rateLimited: true, disclaimer: DISCLAIMER, citations: [], ...(await limited.json()) },
        { status: 429, headers: limited.headers },
      );
    }

    // Embed → retrieve → cite. answerQuestion declines with NO_SOURCE (grounded:
    // false) when nothing relevant is retrieved; it only throws on a hard infra
    // failure, which we turn into a transient message rather than an ungrounded
    // answer or a 500.
    try {
      // The household's own readings, home assessment and journal, built from
      // the verified session and weighted by the page (item 15). Best-effort.
      // ASSISTANT_SEND_HOUSEHOLD_CONTEXT=false keeps household data out of the
      // model call entirely (only the question + public agency sources are sent)
      // — the default for free models, which may log prompts.
      const sendContext = process.env.ASSISTANT_SEND_HOUSEHOLD_CONTEXT !== 'false';
      const context = sendContext
        ? await gatherHouseholdContext(supabaseAdmin, userId, page).catch(() => null)
        : null;
      const result = await answerQuestion({
        question,
        apiKey: MODEL_KEY,
        rpc: (fn, params) => supabaseAdmin.rpc(fn, params),
        context,
        page,
      });
      return NextResponse.json({ configured: true, ...result }, { headers });
    } catch (ragErr) {
      console.error(`Assistant pipeline error (request ${requestId}):`, ragErr.message);
      return NextResponse.json({
        answer: null,
        configured: true,
        // The only case the interface offers Retry for.
        reason: 'unavailable',
        uses_household_data: false,
        message: "I couldn't reach my sources just now. Please try again in a moment.",
        disclaimer: DISCLAIMER,
        citations: [],
      }, { headers });
    }
  } catch (err) {
    const r = authErrorResponse(err, requestId);
    if (r) return r;
    console.error(`assistant failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
