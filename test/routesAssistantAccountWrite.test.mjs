import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, quiet } from './helpers/isolationKit.mjs';
import { OWNED_TABLES } from './helpers/tables.mjs';
import { muteConsoleError } from './helpers/routeHarness.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const { DISCLAIMER, DIAGNOSTIC_REFUSAL, NO_SOURCE } = await import('../lib/assistant.js');
const chr = (code) => String.fromCharCode(code);
const OWNED = Object.keys(OWNED_TABLES);
// Household context is opt-in: the route sends it only when
// ASSISTANT_SEND_HOUSEHOLD_CONTEXT is exactly 'true'. These tests exercise the
// full pipeline, so they turn it on explicitly. The default (unset) is covered
// by the household-context gate tests at the end of this file.
// The model ids are named explicitly because an unset one now fails loudly
// rather than quietly selecting a paid OpenAI default (B03 Ruling L1), which
// is what a deployment has to do too.
const MODELS = { ASSISTANT_EMBED_MODEL: 'test-embed-model', ASSISTANT_CHAT_MODEL: 'test-chat-model' };
const KEY = { ASSISTANT_MODEL_KEY: 'test-model-key', ASSISTANT_SEND_HOUSEHOLD_CONTEXT: 'true', ...MODELS };
const ASK_FIRST = 'Ask a question to get started.';

const model = ({ url }) => {
  if (url.includes('/embeddings')) return Response.json({ data: [{ embedding: new Array(2048).fill(0.01) }] });
  if (url.includes('/chat/completions')) return Response.json({ choices: [{ message: { content: 'Your reading is on the moderate side [H].' } }] });
  return null;
};
function assistant(options = {}) {
  const ctx = setup({ env: KEY, provider: model, ...options });
  ctx.h.db.registerRpc('match_assistant_corpus', () => []);
  return ctx;
}
const snapshot = (ctx) => JSON.stringify(Object.fromEntries(OWNED.map((table) => [table, ctx.h.db.rows(table)])));
const ask = (ctx, body, options = {}) => ctx.call('alice', '/api/assistant', 'POST', { body, ...options });
const askRaw = (ctx, rawBody, options = {}) => ctx.call('alice', '/api/assistant', 'POST', { rawBody, ...options });
const prompt = (ctx) => ctx.outbound.find((request) => request.url.includes('/chat/completions'))?.body ?? '';

/** After a rejection nothing was read or written, no model or retrieval call was made. */
function assertUntouched(ctx, before) {
  assert.equal(snapshot(ctx), before);
  assert.equal(ctx.h.db.queryLog.length, 0, 'no statement was run');
  assert.deepEqual(ctx.outbound, [], 'the model was not asked');
  assert.deepEqual(ctx.h.db.rpcCalls, [], 'and nothing was retrieved');
}
const bad = async (body, expected, message) => {
  const ctx = assistant();
  const before = snapshot(ctx);
  const envelope = await expectEnvelope(await ask(ctx, body), { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(envelope.error, envelope.field_errors[0].message);
  if (message) assert.equal(envelope.error, message);
  assertUntouched(ctx, before);
};

// ------------------------------------------------- assistant: legacy

test('assistant legacy request: a question is trimmed and answered, with the old body fields plus a request id header', async (t) => {
  quiet(t);
  const ctx = assistant();
  const res = await ask(ctx, { question: '  How is my air today?  ', page: 'Today', profile_id: ctx.id('bob') });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.equal(body.uses_household_data, true);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
  const sent = JSON.parse(prompt(ctx));
  assert.ok(JSON.stringify(sent).includes('How is my air today?') && !JSON.stringify(sent).includes('  How is my air'), 'the trimmed question is what the model sees');
  assert.ok(JSON.stringify(sent).includes('opened the assistant from the today page'), 'a known page is used, in lower case');
});

test('assistant legacy request: a diagnostic question is declined, and with no model key the answer says so; both keep their bodies', async () => {
  const declined = assistant();
  const res = await ask(declined, { question: 'Do I have asthma?' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { declined: true, message: DIAGNOSTIC_REFUSAL, disclaimer: DISCLAIMER, citations: [] });
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(declined.outbound, []);

  const keyless = setup();
  const none = await keyless.call('alice', '/api/assistant', 'POST', { body: { question: 'What is PFOS?' } });
  assert.equal(none.status, 200);
  assert.match(none.headers.get('x-request-id'), UUID);
  const body = await none.json();
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'citations', 'configured', 'disclaimer', 'message', 'note', 'reason']);
  assert.deepEqual([body.answer, body.configured, body.reason, body.message], [null, false, 'no_source', NO_SOURCE]);
});

test('assistant legacy request: with a key but no model id configured, nothing is sent and the answer says unavailable', async (t) => {
  quiet(t);
  // B03 Ruling L1: an unset ASSISTANT_EMBED_MODEL used to mean
  // text-embedding-3-small, a paid OpenAI model, in any environment nobody had
  // configured. It now fails loudly, which the route turns into its existing
  // soft "unavailable" answer, and crucially spends nothing.
  const ctx = setup({ env: { ASSISTANT_MODEL_KEY: 'test-model-key' }, provider: model });
  ctx.h.db.registerRpc('match_assistant_corpus', () => []);
  const res = await ask(ctx, { question: 'What is PFOS?' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.answer, body.configured, body.reason], [null, true, 'unavailable']);
  assert.deepEqual(ctx.outbound, [], 'no provider was called, so no paid model could be billed');
  assert.deepEqual(ctx.h.db.rpcCalls, [], 'and nothing was retrieved');
});

test('assistant legacy request: a page that is unknown or not text is ignored, not an error', async (t) => {
  quiet(t);
  const ctx = assistant();
  for (const page of ['nowhere', 5, ['today'], null, {}, '']) assert.equal((await ask(ctx, { question: 'How is my air?', page })).status, 200, JSON.stringify(page));
});

test('assistant legacy request: when the model pipeline fails the answer is still the soft 200 "unavailable"', async (t) => {
  quiet(t);
  const ctx = assistant({ provider: () => new Response('down', { status: 503 }) });
  const res = await ask(ctx, { question: 'How is my air?' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual([body.answer, body.configured, body.reason], [null, true, 'unavailable']);
});

// ------------------------------------------------ assistant: question

for (const [label, body, code] of [
  ['missing', {}, 'question_required'], ['null', { question: null }, 'question_required'], ['an empty string', { question: '' }, 'question_required'],
  ['only spaces', { question: '   ' }, 'question_required'], ['a number', { question: 5 }, 'invalid_text'], ['true', { question: true }, 'invalid_text'],
  ['an array', { question: ['How is my air?'] }, 'invalid_text'], ['an object', { question: { text: 'How is my air?' } }, 'invalid_text'],
]) {
  test(`question: ${label} is the old 400 sentence, with a field error, and reads and sends nothing`, async () => {
    await bad(body, [['question', code]], ASK_FIRST);
  });
}

test('question: 1000 characters are accepted (counted as characters, after trimming) and 1001 are the old "too long" 400', async (t) => {
  quiet(t);
  const ctx = assistant();
  for (const question of ['q'.repeat(1000), `  ${'q'.repeat(1000)}  `, '\u{1F4A7}'.repeat(1000)]) assert.equal((await ask(ctx, { question })).status, 200);
  await bad({ question: 'q'.repeat(1001) }, [['question', 'text_too_long']], 'That question is too long.');
  await bad({ question: '\u{1F4A7}'.repeat(1001) }, [['question', 'text_too_long']]);
});

test('question: tabs and line breaks are kept; other control characters, a line separator and a lone surrogate are a 400', async (t) => {
  quiet(t);
  const ctx = assistant();
  const multi = `Is my water safe?${chr(0x0a)}${chr(0x09)}And the air?${chr(0x0d)}${chr(0x0a)}Thanks`;
  assert.equal((await ask(ctx, { question: multi })).status, 200);
  assert.ok(JSON.parse(prompt(ctx)).messages.some((message) => message.content.includes(multi)), 'the line breaks reach the model as written');
  for (const text of [chr(0), chr(0x1b), chr(0x7f), chr(0x85), chr(0x2028), chr(0xd800)]) {
    await bad({ question: `How is my air${text} today?` }, [['question', 'invalid_characters']]);
  }
});

test('question: the rules apply before the diagnostic check, so a bad diagnostic question is a 400, not a refusal', async () => {
  await bad({ question: `Do I have asthma?${chr(0)}` }, [['question', 'invalid_characters']]);
  await bad({ question: `Do I have asthma? ${'x'.repeat(1000)}` }, [['question', 'text_too_long']]);
});

// ---------------------------------------------------- assistant: body

test('assistant body: invalid JSON and a non-object are 400 bad_request (they used to read as {}), an empty body is a missing question', async () => {
  const ctx = assistant();
  const before = snapshot(ctx);
  for (const rawBody of ['{not json', '[]', '"How is my air?"', '5', 'null', '   ']) {
    const body = await expectEnvelope(await askRaw(ctx, rawBody), { status: 400, code: 'bad_request', retryable: false });
    assert.equal(body.field_errors.length, 0, rawBody);
  }
  assertUntouched(ctx, before);
  const empty = await expectEnvelope(await askRaw(assistant(), ''), { status: 400, code: 'validation_failed' });
  assert.equal(empty.error, ASK_FIRST);
});

test('assistant body: the limit is 8192 bytes, exactly that is read, one more byte is a 413 and nothing is sent', async (t) => {
  quiet(t);
  const base = JSON.stringify({ question: 'How is my air?', pad: '' });
  const padded = (size) => JSON.stringify({ question: 'How is my air?', pad: 'p'.repeat(size - base.length) });
  assert.equal(Buffer.byteLength(padded(8192)), 8192);
  assert.equal((await askRaw(assistant(), padded(8192))).status, 200);

  const ctx = assistant();
  const before = snapshot(ctx);
  const body = await expectEnvelope(await askRaw(ctx, padded(8193)), { status: 413, code: 'payload_too_large', retryable: false });
  assert.equal(body.error, 'That request is too large.');
  await expectEnvelope(await askRaw(ctx, '{}', { headers: { 'content-length': '9000' } }), { status: 413, code: 'payload_too_large' });
  assertUntouched(ctx, before);
});

// --------------------------------------- assistant: limits and errors

test('assistant limits: the 429 keeps its old body fields and gains the envelope; it is a 429 per household and for the whole app', async () => {
  for (const rateLimit of [(key) => !key.startsWith('assistant:') || key === 'assistant:global', (key) => key !== 'assistant:global']) {
    const ctx = assistant({ rateLimit });
    const before = snapshot(ctx);
    const res = await ask(ctx, { question: 'How is my air?' });
    const body = await expectEnvelope(res, { status: 429, code: 'rate_limited', retryable: true, extraKeys: ['answer', 'configured', 'rateLimited', 'disclaimer', 'citations'] });
    assert.deepEqual([body.answer, body.configured, body.rateLimited, body.disclaimer, body.citations], [null, true, true, DISCLAIMER, []]);
    assert.equal(body.message, "You've reached the question limit for now. Please try again in a little while.");
    assert.deepEqual(ctx.outbound, []);
    assert.equal(snapshot(ctx), before);
  }
});

test('assistant: auth failures use the envelope and echo a client request id; ids are echoed on success, 400, 413 and 429', async (t) => {
  quiet(t);
  const ctx = assistant();
  const none = await expectEnvelope(await ctx.h.call('/api/assistant', 'POST', { body: { question: 'x y z' } }), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  const headers = { 'x-request-id': 'client-trace-0001' };
  await expectEnvelope(await ctx.h.call('/api/assistant', 'POST', { body: { question: 'x y z' }, headers }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  const id = (res) => res.headers.get('x-request-id');
  assert.equal(id(await ask(ctx, { question: 'How is my air?' }, { headers })), 'client-trace-0001');
  assert.equal(id(await ask(ctx, {}, { headers })), 'client-trace-0001');
  assert.equal(id(await askRaw(ctx, 'x'.repeat(9000), { headers })), 'client-trace-0001');
  assert.equal(id(await ask(assistant({ rateLimit: () => false }), { question: 'How is my air?' }, { headers })), 'client-trace-0001');
  assert.equal(id(await ask(ctx, { question: 'Do I have asthma?' }, { headers })), 'client-trace-0001', 'the refusal too');
});

test('assistant: an unexpected failure is a 500 envelope with no internal text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const ctx = assistant({ rateLimit: () => { throw new Error('secret limiter detail'); } });
  const body = await expectEnvelope(await ask(ctx, { question: 'How is my air?' }), { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /secret limiter detail/);
  assert.ok(loggedText(logged).includes(body.request_id) && loggedText(logged).includes('secret limiter detail'));
});

test('assistant GET: suggestions as before with a request id header, a 401 envelope that echoes a client id, and the page is only a hint', async () => {
  const ctx = setup();
  const res = await ctx.call('alice', '/api/assistant', 'GET', { url: '/api/assistant?page=today' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['disclaimer', 'sends_household_context', 'suggestions']);
  assert.ok(body.suggestions.length > 0);
  // The panel's privacy line reads this; unset means household context is not sent.
  assert.equal(body.sends_household_context, false);
  assert.equal((await ctx.call('alice', '/api/assistant', 'GET', { url: '/api/assistant?page=nowhere' })).status, 200);
  await expectEnvelope(await ctx.h.call('/api/assistant', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
});

// ------------------------------------------------- account DELETE

const erase = (ctx, body, options = {}) => ctx.call('alice', '/api/account', 'DELETE', { body, ...options });
const eraseRaw = (ctx, rawBody, options = {}) => ctx.call('alice', '/api/account', 'DELETE', { rawBody, ...options });
const aliceStillThere = (ctx) => ctx.rowsOf('profiles', 'alice').length === 1 && ctx.h.db.identities.has(ctx.id('alice'));
const CONFIRM = 'To delete your data, confirm by sending the word DELETE.';

test('account legacy request: { confirm: "DELETE" } deletes the caller and the old body comes back, with a request id header', async () => {
  const ctx = setup();
  const bobBefore = JSON.stringify(OWNED.map((table) => ctx.rowsOf(table, 'bob')));
  const res = await erase(ctx, { confirm: 'DELETE', user_id: ctx.id('bob'), id: ctx.id('bob'), profile_id: ctx.id('bob') }, { headers: { 'x-user-id': ctx.id('bob') } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(await res.json(), { deleted: true });
  assert.ok(OWNED.every((table) => ctx.rowsOf(table, 'alice').length === 0), 'alice is gone from every owned table');
  assert.equal(JSON.stringify(OWNED.map((table) => ctx.rowsOf(table, 'bob'))), bobBefore, 'bob is untouched');
  assert.deepEqual([...ctx.h.db.identities.keys()], [ctx.id('bob')]);
});

for (const [label, body] of [
  ['missing', {}], ['null', { confirm: null }], ['empty', { confirm: '' }], ['lower case', { confirm: 'delete' }], ['with a trailing space', { confirm: 'DELETE ' }],
  ['true', { confirm: true }], ['a number', { confirm: 1 }], ['a list', { confirm: ['DELETE'] }], ['an object', { confirm: { word: 'DELETE' } }],
]) {
  test(`account: a confirm that is ${label} is the old 400 sentence and deletes nothing`, async () => {
    const ctx = setup();
    const before = snapshot(ctx);
    const envelope = await expectEnvelope(await erase(ctx, body), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), [['confirm', 'confirmation_required']]);
    assert.equal(envelope.error, CONFIRM);
    assert.equal(snapshot(ctx), before);
    assert.ok(aliceStillThere(ctx), 'the auth user is still there');
  });
}

test('account body: invalid JSON and a non-object are 400 bad_request, an empty body is the old confirmation sentence, and nothing is deleted', async () => {
  const ctx = setup();
  const before = snapshot(ctx);
  for (const rawBody of ['{not json', '[]', '"DELETE"', 'null', '5']) {
    await expectEnvelope(await eraseRaw(ctx, rawBody), { status: 400, code: 'bad_request', retryable: false });
  }
  const empty = await expectEnvelope(await eraseRaw(ctx, ''), { status: 400, code: 'validation_failed' });
  assert.equal(empty.error, CONFIRM);
  assert.equal(snapshot(ctx), before);
  assert.ok(aliceStillThere(ctx));
});

test('account body: the limit is 2048 bytes; exactly that is read, one more byte is a 413 and nothing is deleted', async () => {
  const base = JSON.stringify({ confirm: 'DELETE', pad: '' });
  const padded = (size) => JSON.stringify({ confirm: 'DELETE', pad: 'p'.repeat(size - base.length) });
  const ctx = setup();
  const before = snapshot(ctx);
  await expectEnvelope(await eraseRaw(ctx, padded(2049)), { status: 413, code: 'payload_too_large', retryable: false });
  await expectEnvelope(await eraseRaw(ctx, JSON.stringify({ confirm: 'DELETE' }), { headers: { 'content-length': '3000' } }), { status: 413, code: 'payload_too_large' });
  assert.equal(snapshot(ctx), before);
  assert.ok(aliceStillThere(ctx));
  assert.equal(Buffer.byteLength(padded(2048)), 2048);
  assert.equal((await eraseRaw(ctx, padded(2048))).status, 200);
});

test('account: a failure deleting the auth user is a 500 envelope with no internal text, logged with the request id, and nothing is deleted', async (t) => {
  const logged = muteConsoleError(t);
  for (const failure of [() => ({ data: null, error: { message: 'secret auth detail' } }), () => { throw new Error('secret auth detail'); }]) {
    const ctx = setup();
    const before = snapshot(ctx);
    ctx.h.db.auth.admin.deleteUser = async () => failure();
    const body = await expectEnvelope(await erase(ctx, { confirm: 'DELETE' }), { status: 500, code: 'internal_error', retryable: true });
    assert.equal(body.error, 'Something went wrong on our side. Please try again.');
    assert.doesNotMatch(JSON.stringify(body), /secret auth detail/);
    assert.ok(loggedText(logged).includes(body.request_id));
    assert.equal(snapshot(ctx), before);
  }
  assert.ok(loggedText(logged).includes('secret auth detail'));
});

test('account: auth failures use the envelope and echo a client request id; ids are echoed on success, 400, 413 and 500', async (t) => {
  muteConsoleError(t);
  const headers = { 'x-request-id': 'client-trace-0002' };
  const none = await expectEnvelope(await setup().h.call('/api/account', 'DELETE', { body: { confirm: 'DELETE' } }), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  await expectEnvelope(await setup().h.call('/api/account', 'DELETE', { body: { confirm: 'DELETE' }, headers }), { status: 401, code: 'auth_required', requestId: 'client-trace-0002' });
  const id = (res) => res.headers.get('x-request-id');
  assert.equal(id(await erase(setup(), { confirm: 'DELETE' }, { headers })), 'client-trace-0002');
  assert.equal(id(await erase(setup(), {}, { headers })), 'client-trace-0002');
  assert.equal(id(await eraseRaw(setup(), 'x'.repeat(3000), { headers })), 'client-trace-0002');
  const broken = setup();
  broken.h.db.auth.admin.deleteUser = async () => ({ data: null, error: { message: 'x' } });
  assert.equal(id(await erase(broken, { confirm: 'DELETE' }, { headers })), 'client-trace-0002');
});

// ------------------------------------- assistant: household-context gate
// Free models may log prompts, so household readings and symptom names leave
// this app only when ASSISTANT_SEND_HOUSEHOLD_CONTEXT is exactly 'true'. An
// environment nobody configured must not leak them, so anything else, the
// variable being unset included, sends only the question and public sources.

/** Asks one question with the gate set to `value` ('' means the variable is unset). */
async function gated(value) {
  const env = { ASSISTANT_MODEL_KEY: 'test-model-key', ...MODELS };
  if (value !== '') env.ASSISTANT_SEND_HOUSEHOLD_CONTEXT = value;
  const ctx = setup({ env, provider: model });
  ctx.h.db.registerRpc('match_assistant_corpus', () => []);
  const res = await ctx.call('alice', '/api/assistant', 'POST', { body: { question: 'How is my air today?' } });
  assert.equal(res.status, 200);
  return (await res.json()).uses_household_data;
}

test('household-context gate: only the exact string true sends household data', async () => {
  assert.equal(await gated('true'), true, "'true' sends it");
  for (const value of ['', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
    assert.equal(await gated(value), false, `${JSON.stringify(value)} must not send household data`);
  }
});

/** One retrieved passage, so the pipeline reaches the model instead of declining for want of a source. */
const sourced = (env) => {
  const ctx = setup({
    env,
    provider: ({ url }) => {
      if (url.includes('/embeddings')) return Response.json({ data: [{ embedding: new Array(2048).fill(0.01) }] });
      if (url.includes('/chat/completions')) return Response.json({ choices: [{ message: { content: 'Ozone is higher in the afternoon [1].' } }] });
      return null;
    },
  });
  ctx.h.db.registerRpc('match_assistant_corpus', () => [
    { id: '00000000-0000-4000-8000-000000000001', source_label: 'EPA', source_url: 'https://epa.gov/x', retrieved: '2026-01-01', passage: 'Ozone peaks in the afternoon.', similarity: 0.9 },
  ]);
  return ctx;
};

test('household-context gate: with the gate off the question reaches the model but the household block does not', async () => {
  const ctx = sourced({ ASSISTANT_MODEL_KEY: 'test-model-key', ...MODELS });
  assert.equal((await ctx.call('alice', '/api/assistant', 'POST', { body: { question: 'How is my air today?' } })).status, 200);
  const sent = prompt(ctx);
  assert.ok(sent.includes('How is my air today?'), 'the question still reaches the model');
  assert.ok(sent.includes('EPA'), 'and so does the public source');
  assert.equal(sent.includes('HOUSEHOLD CONTEXT'), false, 'but no household block is built into the prompt');
});

test('household-context gate: with the gate on the household block is built into the prompt', async () => {
  const ctx = sourced({ ASSISTANT_MODEL_KEY: 'test-model-key', ASSISTANT_SEND_HOUSEHOLD_CONTEXT: 'true', ...MODELS });
  assert.equal((await ctx.call('alice', '/api/assistant', 'POST', { body: { question: 'How is my air today?' } })).status, 200);
  assert.ok(prompt(ctx).includes('HOUSEHOLD CONTEXT'), 'the household block is present when explicitly enabled');
});

// ------------------------------------------------- assistant: live-check fixes (2026-10-20)

test('assistant GET reports whether household context is sent, so the panel can say so', async () => {
  for (const [value, expected] of [[undefined, false], ['false', false], ['TRUE', false], ['true', true]]) {
    const ctx = setup({ env: value === undefined ? {} : { ASSISTANT_SEND_HOUSEHOLD_CONTEXT: value } });
    const body = await (await ctx.call('alice', '/api/assistant', 'GET', { url: '/api/assistant?page=today' })).json();
    assert.equal(body.sends_household_context, expected, JSON.stringify(value));
  }
});

test('assistant POST: every provider call shares one deadline, so a hung provider becomes "try again", not a dead request', async () => {
  const { createRouteHarness } = await import('./helpers/routeHarness.mjs');
  const { haloTables } = await import('./helpers/tables.mjs');
  const signals = [];
  const h = createRouteHarness({
    tables: haloTables('profiles'),
    env: { ASSISTANT_MODEL_KEY: 'test-model-key', ...MODELS },
    seed: (who) => ({ profiles: Object.values(who).map((identity) => ({ id: identity.id })) }),
    fetch: async (url, init = {}) => {
      signals.push(init.signal);
      if (String(url).includes('/embeddings')) return Response.json({ data: [{ embedding: new Array(2048).fill(0.01) }] });
      return Response.json({ choices: [{ message: { content: 'Ozone peaks in the afternoon [1].' } }] });
    },
  });
  h.db.registerRpc('match_assistant_corpus', () => [
    { id: '00000000-0000-4000-8000-000000000001', source_label: 'EPA', source_url: 'https://epa.gov/x', retrieved: '2026-01-01', passage: 'Ozone peaks in the afternoon.', similarity: 0.9 },
  ]);
  const body = await (await h.call('/api/assistant', 'POST', { as: 'alice', body: { question: 'When does ozone peak?' } })).json();
  assert.equal(body.grounded, true);
  assert.equal(signals.length, 2, 'the embedding and the answer');
  assert.ok(signals.every((signal) => signal instanceof AbortSignal && !signal.aborted));
  assert.equal(signals[0], signals[1], 'one budget for the whole answer, not one per call');
});

test('assistant POST: a provider that times out, refuses or answers empty is the retryable "unavailable" answer', async (t) => {
  quiet(t);
  for (const chat of [
    () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    () => Response.json({ choices: [{ message: { content: '' } }] }),
    () => new Response('{}', { status: 402 }),
  ]) {
    const ctx = setup({
      env: { ASSISTANT_MODEL_KEY: 'test-model-key', ...MODELS },
      provider: ({ url }) => (url.includes('/embeddings') ? Response.json({ data: [{ embedding: new Array(2048).fill(0.01) }] }) : chat()),
    });
    ctx.h.db.registerRpc('match_assistant_corpus', () => [
      { id: '00000000-0000-4000-8000-000000000001', source_label: 'EPA', source_url: 'https://epa.gov/x', retrieved: '2026-01-01', passage: 'Ozone peaks in the afternoon.', similarity: 0.9 },
    ]);
    const res = await ctx.call('alice', '/api/assistant', 'POST', { body: { question: 'When does ozone peak?' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reason, 'unavailable', 'the only answer the panel offers Retry for');
    assert.equal(body.answer, null);
    assert.notEqual(body.message, NO_SOURCE, 'a failed model is not "no reliable source"');
  }
});
