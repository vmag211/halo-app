/**
 * Assistant grounded-answer pipeline (§18).
 *
 * BUILT, NOT LIVE-TESTED. This path is gated on an embedding/model key and an
 * ingested corpus (migrations 0007 + 0008, scripts/ingest-corpus.mjs). The two
 * network calls live behind an injectable `fetchImpl` and the retrieval behind an
 * injectable `rpc`, so the decision logic — prompt construction, citation
 * numbering, the grounding/decline rules — is unit-tested with fakes and never
 * runs against a paid model in CI.
 *
 * The contract that makes this honest (§18.2): the answer is composed ONLY from
 * retrieved agency passages. If retrieval returns nothing above the similarity
 * floor, or the model reports the passages don't cover the question, the pipeline
 * declines with NO_SOURCE instead of letting the model answer from its own
 * training. The structural diagnostic refusal is enforced upstream in the route,
 * before this pipeline is ever reached.
 *
 * Defaults target an OpenAI-compatible endpoint because the corpus schema commits
 * to a 1536-d embedding (text-embedding-3-small). All of it is override-able by
 * env so a different provider/gateway can be pointed at without code changes.
 */
import { NO_SOURCE, DISCLAIMER } from './assistant.js';

export const EMBED_MODEL = process.env.ASSISTANT_EMBED_MODEL || 'text-embedding-3-small';
export const CHAT_MODEL = process.env.ASSISTANT_CHAT_MODEL || 'gpt-4o-mini';
const EMBED_URL = process.env.ASSISTANT_EMBED_URL || 'https://api.openai.com/v1/embeddings';
const CHAT_URL = process.env.ASSISTANT_CHAT_URL || 'https://api.openai.com/v1/chat/completions';

// Retrieval knobs. MIN_SIMILARITY is the floor below which a passage is treated
// as unrelated; MATCH_COUNT caps how many passages the model sees.
export const MIN_SIMILARITY = 0.3;
export const MATCH_COUNT = 6;

/**
 * The system + user messages for the answer call. Pure and unit-tested: the
 * system message pins the model to the numbered sources and to declining with
 * NO_SOURCE verbatim, and forbids diagnosis/treatment as a second line of defence
 * behind the route's structural refusal.
 */
export function buildAnswerPrompt({ question, passages }) {
  const sources = passages
    .map((p, i) => `[${i + 1}] ${p.source_label} (${p.source_url})\n${p.passage}`)
    .join('\n\n');
  const system = [
    "You are HALO's environmental-health explainer.",
    'Answer ONLY using the numbered SOURCES below. Do not use any outside knowledge.',
    'Cite the sources you use inline as [1], [2], and so on.',
    `If the SOURCES do not contain the answer, reply with exactly this and nothing else: ${JSON.stringify(NO_SOURCE)}`,
    'Never diagnose a condition, interpret symptoms as an illness, or recommend treatment, medication, or dosage.',
    'Keep it plain and calm, two or three short sentences, and use no exclamation marks.',
  ].join(' ');
  const user = `SOURCES:\n${sources}\n\nQUESTION: ${question}`;
  return { system, user };
}

/**
 * The distinct citations for whichever passages the answer actually referenced
 * (`[n]`), in first-referenced order. If the model cited nothing explicitly, fall
 * back to every retrieved passage so a claim is never shown without its sources.
 * Pure and unit-tested.
 */
export function extractCitations(answer, passages) {
  const used = [];
  const seen = new Set();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(answer)) !== null) {
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < passages.length && !seen.has(idx)) {
      seen.add(idx);
      used.push(idx);
    }
  }
  const chosen = used.length ? used : passages.map((_, i) => i);
  return chosen.map((i) => ({
    n: i + 1,
    label: passages[i].source_label,
    url: passages[i].source_url,
    retrieved: passages[i].retrieved ?? null,
  }));
}

/** Embed the question. Throws on a non-ok response or a malformed body. */
export async function embedQuestion({ question, apiKey, fetchImpl = fetch, model = EMBED_MODEL }) {
  const res = await fetchImpl(EMBED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: question }),
  });
  if (!res.ok) throw new Error(`Embedding request failed (${res.status})`);
  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) throw new Error('Embedding response missing vector');
  return vec;
}

/** Retrieve the nearest passages via the pgvector RPC (migration 0008). */
export async function retrievePassages({ embedding, rpc, matchCount = MATCH_COUNT, minSimilarity = MIN_SIMILARITY }) {
  const { data, error } = await rpc('match_assistant_corpus', {
    query_embedding: embedding,
    match_count: matchCount,
    min_similarity: minSimilarity,
  });
  if (error) throw new Error(typeof error === 'string' ? error : error.message || 'retrieval failed');
  return Array.isArray(data) ? data : [];
}

/** Compose the cited answer from the retrieved passages. Throws on a bad response. */
export async function composeAnswer({ question, passages, apiKey, fetchImpl = fetch, model = CHAT_MODEL }) {
  const { system, user } = buildAnswerPrompt({ question, passages });
  const res = await fetchImpl(CHAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Answer request failed (${res.status})`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

/**
 * Orchestrate embed → retrieve → answer and return the payload the route serves.
 * Never throws for "no relevant source" — that is a normal, honest decline. Hard
 * infrastructure failures (network, non-ok status) DO throw, so the route can
 * degrade to a transient-error message rather than emit an ungrounded answer.
 */
export async function answerQuestion({ question, apiKey, rpc, fetchImpl = fetch }) {
  const embedding = await embedQuestion({ question, apiKey, fetchImpl });
  const passages = await retrievePassages({ embedding, rpc });
  if (!passages.length) {
    return { answer: null, grounded: false, message: NO_SOURCE, citations: [], disclaimer: DISCLAIMER };
  }
  const text = await composeAnswer({ question, passages, apiKey, fetchImpl });
  if (!text || text === NO_SOURCE) {
    return { answer: null, grounded: false, message: NO_SOURCE, citations: [], disclaimer: DISCLAIMER };
  }
  return { answer: text, grounded: true, citations: extractCitations(text, passages), disclaimer: DISCLAIMER };
}
