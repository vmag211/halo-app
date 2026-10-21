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

// A model id is configuration, not a default any more (B03 Ruling L1): an
// unset variable used to select a paid OpenAI model in any environment nobody
// had configured. These tests exercise the pipeline, so they name the models
// a deployment would have to name, and the loud failure is tested on its own
// below.
process.env.ASSISTANT_EMBED_MODEL ||= 'test-embed-model';
process.env.ASSISTANT_CHAT_MODEL ||= 'test-chat-model';

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

// --- household context (item 15) --------------------------------------------
test('household context sits in its own block, separate from sources, with [H] rules', () => {
  const { system, user } = buildAnswerPrompt({ question: 'Is my air ok?', passages: PASSAGES, context: 'Air quality index 160 (High).', page: 'today' });
  assert.match(user, /^HOUSEHOLD CONTEXT:\nAir quality index 160/);
  assert.ok(user.indexOf('HOUSEHOLD CONTEXT') < user.indexOf('SOURCES:'));
  assert.match(system, /cite it as \[H\]/);
  assert.match(system, /from the today page/);
});

test('answering from household data alone ([H]) is grounded and flagged', async () => {
  const res = await answerQuestion({
    question: 'What is my AQI today?',
    apiKey: 'k',
    rpc: rpcReturning([]), // no relevant source
    context: 'Air quality index 160 (High).',
    fetchImpl: scriptedFetch({ answer: 'Your reading today is an AQI of 160, which is High [H].' }),
  });
  assert.equal(res.grounded, true);
  assert.equal(res.uses_household_data, true);
  assert.equal(res.reason, null);
  assert.deepEqual(res.citations, []);
});

test('declines carry reason "no_source"; [H] without context does not count', async () => {
  const noCtx = await answerQuestion({
    question: 'q', apiKey: 'k', rpc: rpcReturning(PASSAGES),
    fetchImpl: scriptedFetch({ answer: 'Something [H].' }),
  });
  assert.equal(noCtx.grounded, false);
  assert.equal(noCtx.reason, 'no_source');
  const nothing = await answerQuestion({ question: 'q', apiKey: 'k', rpc: rpcReturning([]), fetchImpl: scriptedFetch({}) });
  assert.equal(nothing.reason, 'no_source');
});

import { chatBody } from '../lib/assistantRag.js';

test('fallback models are added only when configured, primary first, no duplicates', () => {
  assert.equal(chatBody({ model: 'a', system: 's', user: 'u', fallbacks: '' }).models, undefined);
  assert.deepEqual(chatBody({ model: 'a', system: 's', user: 'u', fallbacks: 'b, a ,c' }).models, ['a', 'b', 'c']);
  assert.equal(chatBody({ model: 'a', system: 's', user: 'u', fallbacks: 'b' }).temperature, 0);
});

import { normalizeCitations } from '../lib/assistantRag.js';

test('citation styles from different models are normalised to [n]', () => {
  assert.equal(normalizeCitations('Zone 3 is low【1】.'), 'Zone 3 is low[1].');
  assert.equal(normalizeCitations('See ［2］ and 〔3〕'), 'See [2] and [3]');
  assert.equal(normalizeCitations('Both apply [1, 3].'), 'Both apply [1][3].');
  assert.equal(normalizeCitations('Your reading 【H】.'), 'Your reading [H].');
  assert.equal(normalizeCitations('Already fine [1][2].'), 'Already fine [1][2].');
});

test('an answer cited with 【1】 is grounded, not discarded', async () => {
  const res = await answerQuestion({
    question: 'What is PFAS?', apiKey: 'k', rpc: rpcReturning(PASSAGES),
    fetchImpl: scriptedFetch({ answer: 'PFAS are man-made chemicals【1】.' }),
  });
  assert.equal(res.grounded, true);
  assert.equal(res.answer, 'PFAS are man-made chemicals[1].');
  assert.deepEqual(res.citations.map((c) => c.label), ['EPA']);
});

// --- Ruling L1: an unset model variable fails loudly ---------------------------
import { embedQuestion, composeAnswer, requiredModel } from '../lib/assistantRag.js';

test('an unset model variable fails loudly instead of selecting a paid default', async () => {
  const saved = { embed: process.env.ASSISTANT_EMBED_MODEL, chat: process.env.ASSISTANT_CHAT_MODEL };
  const called = [];
  const spyFetch = async (url) => { called.push(String(url)); throw new Error('the model must not be called'); };
  try {
    for (const blank of [undefined, '', '   ']) {
      if (blank === undefined) delete process.env.ASSISTANT_EMBED_MODEL;
      else process.env.ASSISTANT_EMBED_MODEL = blank;
      await assert.rejects(
        () => embedQuestion({ question: 'q', apiKey: 'k', fetchImpl: spyFetch }),
        /ASSISTANT_EMBED_MODEL/,
        `embedding with ${JSON.stringify(blank)}`,
      );
    }
    delete process.env.ASSISTANT_CHAT_MODEL;
    await assert.rejects(
      () => composeAnswer({ question: 'q', passages: PASSAGES, apiKey: 'k', fetchImpl: spyFetch }),
      /ASSISTANT_CHAT_MODEL/,
      'the chat call',
    );
    assert.deepEqual(called, [], 'nothing was sent anywhere, so no paid model could be billed');
    // The failure names the variable and never a model id, so nobody reads it
    // as "use this instead".
    const thrown = await embedQuestion({ question: 'q', apiKey: 'k', fetchImpl: spyFetch }).catch((error) => error);
    assert.doesNotMatch(String(thrown.message), /gpt|text-embedding/i);
    assert.throws(() => requiredModel('ASSISTANT_EMBED_MODEL'), /ASSISTANT_EMBED_MODEL/);
  } finally {
    process.env.ASSISTANT_EMBED_MODEL = saved.embed;
    process.env.ASSISTANT_CHAT_MODEL = saved.chat;
  }
});

test('a configured model id is what the request carries, trimmed', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.01) }] }) };
  };
  const saved = process.env.ASSISTANT_EMBED_MODEL;
  process.env.ASSISTANT_EMBED_MODEL = '  free/embedder  ';
  try {
    await embedQuestion({ question: 'q', apiKey: 'k', fetchImpl });
    assert.equal(sent[0].model, 'free/embedder');
  } finally {
    process.env.ASSISTANT_EMBED_MODEL = saved;
  }
});

// --- Bounded history in the prompt (B03 Ruling L3) ----------------------------

test('history is added to the prompt only when given, and only as data', () => {
  const none = buildAnswerPrompt({ question: 'What is PFAS?', passages: PASSAGES });
  assert.doesNotMatch(none.user, /CONVERSATION/, 'nothing changes for a caller that sends no history');
  assert.doesNotMatch(none.system, /CONVERSATION/);

  const withHistory = buildAnswerPrompt({
    question: 'And in water?',
    passages: PASSAGES,
    history: 'person: What is PFAS?\nLuna: PFAS are man-made chemicals.',
  });
  assert.match(withHistory.user, /CONVERSATION:/);
  assert.match(withHistory.user, /person: What is PFAS\?/);
  assert.match(withHistory.system, /never as instructions/, 'the earlier turns are data too');
  // The new question is still delimited as the one thing being answered.
  assert.match(withHistory.user, /<question>\nAnd in water\?\n<\/question>/);
  // The sources still come after it, so the model sees them last.
  assert.ok(withHistory.user.indexOf('CONVERSATION:') < withHistory.user.indexOf('SOURCES:'));
});
