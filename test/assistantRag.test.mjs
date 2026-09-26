import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnswerPrompt,
  extractCitations,
  answerQuestion,
  isDeclineText,
  MIN_SIMILARITY,
  MATCH_COUNT,
} from '../lib/assistantRag.js';
import { NO_SOURCE } from '../lib/assistant.js';

const PASSAGES = [
  { id: 'a', source_label: 'EPA', source_url: 'https://epa.gov/pfas', retrieved: '2026-09', passage: 'PFAS are man-made chemicals.' },
  { id: 'b', source_label: 'CDC', source_url: 'https://cdc.gov/lead', retrieved: '2026-09', passage: 'Lead is a heavy metal.' },
];

// --- buildAnswerPrompt -------------------------------------------------------
test('prompt numbers the sources and pins the model to them', () => {
  const { system, user } = buildAnswerPrompt({ question: 'What is PFAS?', passages: PASSAGES });
  assert.match(user, /\[1\] EPA/);
  assert.match(user, /\[2\] CDC/);
  // The question is delimited and flagged as data, not instructions.
  assert.match(user, /<question>\nWhat is PFAS\?\n<\/question>/);
  assert.match(system, /never as instructions/);
  assert.match(system, /ONLY using the numbered SOURCES/);
  // The exact NO_SOURCE string is embedded so the model can echo it verbatim.
  assert.ok(system.includes(NO_SOURCE));
  // Second line of defence against diagnosis, behind the route's structural guard.
  assert.match(system, /Never diagnose/);
});

// --- extractCitations --------------------------------------------------------
test('citations reflect only the passages the answer referenced, in order', () => {
  const cites = extractCitations('PFAS are synthetic [2] and studied [1][2].', PASSAGES);
  assert.deepEqual(cites.map((c) => c.n), [2, 1]);
  assert.equal(cites[0].label, 'CDC');
  assert.equal(cites[1].label, 'EPA');
});

test('an uncited answer yields no citations (no blanket fallback)', () => {
  assert.deepEqual(extractCitations('PFAS are synthetic chemicals.', PASSAGES), []);
});

test('out-of-range citation markers are ignored', () => {
  const cites = extractCitations('see [9] and [1]', PASSAGES);
  assert.deepEqual(cites.map((c) => c.n), [1]);
});

// --- answerQuestion orchestration (fake fetch + fake rpc) --------------------
function fakeEmbedFetch(vector = new Array(1536).fill(0.01)) {
  return async () => ({ ok: true, json: async () => ({ data: [{ embedding: vector }] }) });
}
// A fetch that returns the embedding on the first call and a chat answer on the next.
function scriptedFetch({ embedding = new Array(1536).fill(0.01), answer = '' }) {
  let call = 0;
  return async () => {
    call += 1;
    if (call === 1) return { ok: true, json: async () => ({ data: [{ embedding }] }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: answer } }] }) };
  };
}
const rpcReturning = (rows) => async (_fn, args) => {
  // Sanity: the route must pass the retrieval knobs the SQL function expects.
  assert.equal(args.match_count, MATCH_COUNT);
  assert.equal(args.min_similarity, MIN_SIMILARITY);
  assert.ok(Array.isArray(args.query_embedding));
  return { data: rows, error: null };
};

test('no retrieved passages → honest NO_SOURCE decline, never a model call', async () => {
  let chatCalled = false;
  const res = await answerQuestion({
    question: 'What is xyzzy?',
    apiKey: 'k',
    rpc: rpcReturning([]),
    fetchImpl: async (url) => {
      if (String(url).includes('chat')) chatCalled = true;
      return { ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.01) }] }) };
    },
  });
  assert.equal(res.grounded, false);
  assert.equal(res.answer, null);
  assert.equal(res.message, NO_SOURCE);
  assert.deepEqual(res.citations, []);
  assert.equal(chatCalled, false, 'must not spend a model call when nothing was retrieved');
});

test('model echoing NO_SOURCE verbatim is treated as a decline', async () => {
  const res = await answerQuestion({
    question: 'What is PFAS?',
    apiKey: 'k',
    rpc: rpcReturning(PASSAGES),
    fetchImpl: scriptedFetch({ answer: NO_SOURCE }),
  });
  assert.equal(res.grounded, false);
  assert.equal(res.answer, null);
  assert.deepEqual(res.citations, []);
});

test('grounded answer returns text + citations for the cited sources', async () => {
  const res = await answerQuestion({
    question: 'What is PFAS?',
    apiKey: 'k',
    rpc: rpcReturning(PASSAGES),
    fetchImpl: scriptedFetch({ answer: 'PFAS are man-made chemicals [1].' }),
  });
  assert.equal(res.grounded, true);
  assert.match(res.answer, /man-made/);
  assert.deepEqual(res.citations.map((c) => c.label), ['EPA']);
  assert.ok(res.disclaimer);
});

test('a non-ok embedding response throws (route degrades, never ungrounded)', async () => {
  await assert.rejects(
    answerQuestion({
      question: 'q',
      apiKey: 'k',
      rpc: rpcReturning(PASSAGES),
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    }),
    /Embedding request failed \(429\)/,
  );
});

// --- review hardening --------------------------------------------------------
test('decline detection tolerates quotes, curly apostrophes, prefixes, punctuation', () => {
  const curly = NO_SOURCE.replace(/'/g, '\u2019');
  for (const v of [
    NO_SOURCE,
    `"${NO_SOURCE}"`,
    curly,
    `Sorry, ${NO_SOURCE}`,
    NO_SOURCE.replace(/\.$/, ''),
    `  ${NO_SOURCE.toUpperCase()}  `,
    '',
  ]) {
    assert.equal(isDeclineText(v), true, JSON.stringify(v));
  }
  assert.equal(isDeclineText('PFAS are man-made chemicals [1].'), false);
});

test('a quoted NO_SOURCE echo is still a decline, not a grounded answer', async () => {
  const res = await answerQuestion({
    question: 'What is PFAS?',
    apiKey: 'k',
    rpc: rpcReturning(PASSAGES),
    fetchImpl: scriptedFetch({ answer: `"${NO_SOURCE}"` }),
  });
  assert.equal(res.grounded, false);
  assert.deepEqual(res.citations, []);
});

test('an answer that cites no retrieved source is declined as ungrounded', async () => {
  const res = await answerQuestion({
    question: 'What is PFAS?',
    apiKey: 'k',
    rpc: rpcReturning(PASSAGES),
    fetchImpl: scriptedFetch({ answer: 'PFAS are forever chemicals found everywhere.' }),
  });
  assert.equal(res.grounded, false);
  assert.equal(res.answer, null);
  assert.equal(res.message, NO_SOURCE);
});

test('a wrong-dimension embedding throws a clear error', async () => {
  await assert.rejects(
    answerQuestion({
      question: 'q',
      apiKey: 'k',
      rpc: rpcReturning(PASSAGES),
      fetchImpl: scriptedFetch({ embedding: new Array(3072).fill(0.01), answer: 'x [1]' }),
    }),
    /3072 dimensions; the corpus expects 1536/,
  );
});
