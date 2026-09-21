import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { isDiagnosticRequest, DIAGNOSTIC_REFUSAL, DISCLAIMER, NO_SOURCE, suggestedQuestions } from '@/lib/assistant';

/**
 * POST /api/assistant  { question, page? }
 * GET  /api/assistant?page=today  → three suggested opening questions
 *
 * The structural diagnostic check runs FIRST, before any answer is composed
 * (§18.4), so a diagnosis request is declined reliably rather than merely likely.
 *
 * The grounded-answer path (retrieval over the curated corpus + a model call,
 * with citations) needs an embedding/model key and an ingested assistant_corpus
 * (migration 0007). Until those are present the route declines honestly rather
 * than improvising. Every response carries the not-medical-advice disclaimer.
 *
 * TODO (gated on a model key): rate-limit per household (§37.2); embed the
 * question, retrieve top passages by cosine distance, compose a cited answer,
 * and stream it.
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
    await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question.trim() : '';

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
        message: NO_SOURCE,
        disclaimer: DISCLAIMER,
        citations: [],
        note: 'The assistant needs an embedding/model key and an ingested source corpus (migration 0007) to answer.',
      });
    }

    // With a key present, retrieval + a cited answer would be composed here.
    // Left unbuilt deliberately until the key/corpus exist, so nothing runs
    // untested against a paid model.
    return NextResponse.json({
      answer: null,
      configured: true,
      message: NO_SOURCE,
      disclaimer: DISCLAIMER,
      citations: [],
      note: 'Model key present, but the retrieval + answer pipeline is not wired yet.',
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return r;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
