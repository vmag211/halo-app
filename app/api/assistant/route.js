import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { isDiagnosticRequest, DIAGNOSTIC_REFUSAL, DISCLAIMER, NO_SOURCE, suggestedQuestions } from '@/lib/assistant';
import { answerQuestion } from '@/lib/assistantRag';
import { gatherHouseholdContext } from '@/lib/assistantContextData';

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

export async function GET(request) {
  try {
    await requireUser(request);
    const page = new URL(request.url).searchParams.get('page') || '';
    return NextResponse.json({ suggestions: suggestedQuestions(page), disclaimer: DISCLAIMER });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return r;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const page = typeof body.page === 'string' && PAGES.has(body.page.toLowerCase()) ? body.page.toLowerCase() : null;

    if (!question) {
      return NextResponse.json({ error: 'Ask a question to get started.' }, { status: 400 });
    }
    if (question.length > 1000) {
      return NextResponse.json({ error: 'That question is too long.' }, { status: 400 });
    }

    // Structural refusal runs before anything else.
    if (isDiagnosticRequest(question)) {
      return NextResponse.json({ declined: true, message: DIAGNOSTIC_REFUSAL, disclaimer: DISCLAIMER, citations: [] });
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
      });
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
      return NextResponse.json(
        {
          answer: null,
          configured: true,
          rateLimited: true,
          message: "You've reached the question limit for now. Please try again in a little while.",
          disclaimer: DISCLAIMER,
          citations: [],
        },
        { status: 429 },
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
      return NextResponse.json({ configured: true, ...result });
    } catch (ragErr) {
      console.error('Assistant pipeline error:', ragErr.message);
      return NextResponse.json({
        answer: null,
        configured: true,
        // The only case the interface offers Retry for.
        reason: 'unavailable',
        uses_household_data: false,
        message: "I couldn't reach my sources just now. Please try again in a moment.",
        disclaimer: DISCLAIMER,
        citations: [],
      });
    }
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return r;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
