/**
 * lib/luna.js: the foundation the three Luna route tasks build on (B03 Task 1).
 *
 * The four things that have to be true, and that only a test can keep true:
 *
 * 1. A run never looks like work in progress when nothing is working on it.
 *    `POST /api/luna/messages` answers inside the client's 20 second timeout
 *    and the generation runs afterwards in `after()`, which shares the route's
 *    invocation budget, so the platform can kill it mid-answer. The operation
 *    ledger already solved this for receipts (a pending row past its window
 *    reads as 'unknown'); a run has no 'unknown' in its contract, so past its
 *    window it reads as 'failed'. Nothing writes that: it is derived, so it is
 *    true even for a process that died without settling anything.
 *
 * 2. The conversation that comes back carries the person's own turn. The
 *    production component never appends it locally, so a payload without it
 *    loses their question off their screen.
 *
 * 3. The history bound is real and cannot be switched off. A conversation
 *    re-sends its context every turn, and a free model's per-minute token
 *    budget bites long before its daily request cap.
 *
 * 4. Luna reads no household data. Not "does not today": there is no path to
 *    it, and the last test in this file fails if one is added.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './helpers/routeLoader.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';

const luna = await import('../lib/luna.js');
const { FEATURE_FLAGS, featureEnabled, featureDisabledReason } = await import('../lib/features.js');

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

/** A client with the Luna tables and the profiles they belong to. */
function db() {
  return createFakeSupabase({
    tables: haloTables('profiles', 'luna_conversations', 'luna_turns', 'luna_runs'),
    seed: { profiles: [{ id: ALICE }, { id: BOB }] },
  });
}

/** Sets env for one call and puts it back, whatever happens. */
async function withEnv(values, work) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await work();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const turns = (...texts) => texts.map((text, index) => ({ id: `t${index}`, role: index % 2 ? 'assistant' : 'user', text }));

/** A passage as the retrieval RPC returns it. */
const passage = (n, overrides = {}) => ({
  id: `p${n}`,
  source_label: `Agency ${n}`,
  source_url: `https://agency${n}.example.test/page`,
  retrieved: '2026-01-01',
  passage: `Passage ${n} about the thing.`,
  similarity: 0.9,
  ...overrides,
});

/** An embedding call then a chat call, each answered from the script. */
function scriptedFetch({ answer = 'An answer [1].', chatStatus = 200, embedStatus = 200 } = {}) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/embeddings')) {
      if (embedStatus !== 200) return { ok: false, status: embedStatus, json: async () => ({}) };
      return { ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.01) }] }) };
    }
    if (chatStatus !== 200) return { ok: false, status: chatStatus, json: async () => ({}) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: answer } }] }) };
  };
  return { fetchImpl, sent };
}

const rpcReturning = (rows) => async () => ({ data: rows, error: null });

const MODELS = { ASSISTANT_EMBED_MODEL: 'test-embed-model', ASSISTANT_CHAT_MODEL: 'test-chat-model' };

// ---------------------------------------------------------------------------
// The capability flag and degrading before migration 0020
// ---------------------------------------------------------------------------

test('Luna is a registered capability, off unless its variable is explicitly on', async () => {
  assert.equal(FEATURE_FLAGS.luna, 'HALO_FEATURE_LUNA');
  for (const value of [undefined, '', 'off', 'false', '1', 'yes', 'ON ', 'True']) {
    await withEnv({ HALO_FEATURE_LUNA: value }, () => {
      assert.equal(featureEnabled('luna'), value === 'ON ' || value === 'True', JSON.stringify(value));
    });
  }
  for (const value of ['on', 'true', 'On', 'TRUE']) {
    await withEnv({ HALO_FEATURE_LUNA: value }, () => assert.equal(featureEnabled('luna'), true, value));
  }
  const reason = featureDisabledReason('luna');
  assert.ok(reason && reason.length > 0, 'the capability says why it is off');
  assert.equal(reason.includes('\u2014'), false, 'no em dash in app-facing copy');
});

test('every Luna route degrades the same way until 0020 is applied', () => {
  for (const code of ['PGRST205', '42P01', 'PGRST204', '42703']) {
    assert.equal(luna.isLunaUnavailable({ code }), true, code);
  }
  for (const error of [null, undefined, {}, { code: '23505' }, { code: 'PGRST116' }, new Error('nope')]) {
    assert.equal(luna.isLunaUnavailable(error), false, JSON.stringify(error));
  }
  const response = luna.lunaUnavailable('11111111-2222-4333-8444-555555555555');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), null, 'retrying cannot help, so nothing invites it');
});

test('the unavailable body names the feature and carries no provider detail', async () => {
  const body = await luna.lunaUnavailable('11111111-2222-4333-8444-555555555555').json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal(body.retryable, false);
  assert.equal(body.error.includes('\u2014'), false);
  assert.equal(/supabase|postgres|PGRST|relation/i.test(JSON.stringify(body)), false, 'nothing about the database leaves');
});

// ---------------------------------------------------------------------------
// Ruling L3: the history bound is a pure function and cannot be switched off
// ---------------------------------------------------------------------------

test('the bound keeps the newest turns, oldest first', () => {
  const all = turns('one', 'two', 'three', 'four', 'five');
  const kept = luna.boundedHistory(all, { maxTurns: 3 });
  assert.deepEqual(kept.map((turn) => turn.text), ['three', 'four', 'five']);
  assert.deepEqual(luna.boundedHistory([], { maxTurns: 3 }), []);
  assert.deepEqual(luna.boundedHistory(all, { maxTurns: 99 }).length, 5, 'fewer turns than the bound is all of them');
});

test('the character budget stops at the first turn that does not fit, keeping the newest', () => {
  const all = turns('a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100));
  assert.deepEqual(luna.boundedHistory(all, { maxChars: 250 }).map((turn) => turn.text[0]), ['b', 'c']);
  // One turn larger than the whole budget leaves nothing rather than everything.
  assert.deepEqual(luna.boundedHistory(turns('x'.repeat(5000)), { maxChars: 300 }), []);
});

test('the bound cannot be disabled, by a caller or by configuration', () => {
  const all = turns(...new Array(60).fill('a turn'));
  for (const maxTurns of [Infinity, 0, -1, null, undefined, NaN, '40', 'all', 1e9]) {
    const kept = luna.boundedHistory(all, { maxTurns });
    assert.ok(kept.length > 0, `${String(maxTurns)} still returns context`);
    assert.ok(kept.length <= luna.LUNA_HISTORY_TURN_CEILING, `${String(maxTurns)} is still bounded`);
  }
  for (const maxChars of [Infinity, 0, -1, null, 'none', 1e9]) {
    const kept = luna.boundedHistory(turns(...new Array(60).fill('a'.repeat(1000))), { maxChars });
    const spent = kept.reduce((total, turn) => total + turn.text.length, 0);
    assert.ok(spent <= luna.LUNA_HISTORY_MAX_CHARS * 1, `${String(maxChars)} is still bounded: ${spent}`);
  }
});

test('the configured bound is read from the environment, clamped, and junk falls back to the default', async () => {
  await withEnv({ LUNA_HISTORY_TURNS: '2' }, () => assert.equal(luna.historyLimit(), 2));
  await withEnv({ LUNA_HISTORY_TURNS: String(luna.LUNA_HISTORY_TURN_CEILING + 50) }, () =>
    assert.equal(luna.historyLimit(), luna.LUNA_HISTORY_TURN_CEILING));
  for (const value of [undefined, '', '0', '-3', 'off', 'none', '2.5', 'NaN']) {
    await withEnv({ LUNA_HISTORY_TURNS: value }, () =>
      assert.equal(luna.historyLimit(), luna.LUNA_HISTORY_MAX_TURNS, JSON.stringify(value)));
  }
});

test('the prompt history labels each turn and is nothing when there is nothing to say', () => {
  assert.equal(luna.historyPrompt([]), null);
  assert.equal(luna.historyPrompt(undefined), null);
  const text = luna.historyPrompt(turns('What is PFOS?', 'A man made chemical.'));
  assert.match(text, /^Person: What is PFOS\?$/m);
  assert.match(text, /^Luna: A man made chemical\.$/m);
});

// ---------------------------------------------------------------------------
// The run model: settling, staleness, cancellation
// ---------------------------------------------------------------------------

const runRow = (overrides = {}) => ({
  id: 'r1',
  status: 'queued',
  message: null,
  created_at: new Date().toISOString(),
  settled_at: null,
  ...overrides,
});

test('a settled run reports what it settled as', () => {
  for (const status of ['completed', 'failed', 'cancelled']) {
    assert.equal(luna.effectiveRunStatus(runRow({ status, settled_at: new Date().toISOString() })), status);
  }
});

test('a run inside its window is still working, and past it reads as failed, never as queued', () => {
  const age = (ms) => new Date(Date.now() - ms).toISOString();
  for (const status of ['queued', 'generating']) {
    assert.equal(luna.effectiveRunStatus(runRow({ status, created_at: age(1000) })), status, 'fresh');
    assert.equal(
      luna.effectiveRunStatus(runRow({ status, created_at: age(luna.LUNA_RUN_STALE_AFTER_MS - 1000) })),
      status,
      'inside the window',
    );
    assert.equal(
      luna.effectiveRunStatus(runRow({ status, created_at: age(luna.LUNA_RUN_STALE_AFTER_MS + 1000) })),
      'failed',
      'past the window a dead generation is not work in progress',
    );
  }
  // A window a caller chose, and an unreadable start, are both handled.
  assert.equal(luna.effectiveRunStatus(runRow({ created_at: age(5000) }), 1000), 'failed');
  assert.equal(luna.effectiveRunStatus(runRow({ created_at: 'not a time' })), 'failed');
});

test('the staleness window is longer than the work it allows and shorter than the client\'s patience', () => {
  // The generation must settle before a reader would call it dead, and a
  // reader must call it dead before the client gives up at 120 polls a second
  // apart, or the person is left on "Luna is still working" for ever.
  assert.ok(luna.LUNA_RUN_DEADLINE_MS < luna.LUNA_RUN_STALE_AFTER_MS, 'deadline before staleness');
  assert.ok(luna.LUNA_RUN_STALE_AFTER_MS < 120_000, 'staleness before the client stops polling');
});

test('a run body is what the client validates, and a completed one must carry its conversation', () => {
  const conversation = { id: 'c1', revision: 2, messages: [] };
  const completed = luna.runBody({
    row: runRow({ status: 'completed', settled_at: new Date().toISOString() }),
    conversation,
  });
  assert.deepEqual(completed, { id: 'r1', status: 'completed', conversation });
  assert.throws(
    () => luna.runBody({ row: runRow({ status: 'completed', settled_at: new Date().toISOString() }) }),
    /conversation/,
    'the client discards a completed run with no conversation, so this is a bug, not a state',
  );

  const queued = luna.runBody({ row: runRow() });
  assert.deepEqual(queued, { id: 'r1', status: 'queued' }, 'a queued run needs nothing else');

  const stale = luna.runBody({ row: runRow({ created_at: new Date(Date.now() - 600_000).toISOString() }) });
  assert.equal(stale.status, 'failed');
  assert.equal(stale.message, luna.LUNA_RUN_FAILED_MESSAGE, 'and it says so in words the person can read');
  assert.ok(stale.message.length <= 1000 && !stale.message.includes('\u2014'));

  const failed = luna.runBody({
    row: runRow({ status: 'failed', settled_at: new Date().toISOString(), message: 'No source for that.' }),
  });
  assert.equal(failed.message, 'No source for that.', 'a stored message is kept');
});

test('a run is created once per client message and found by either id', async () => {
  const supabase = db();
  const conversation = await luna.startConversation(supabase, { profileId: ALICE });
  const turn = await luna.appendTurn(supabase, {
    profileId: ALICE,
    conversationId: conversation.id,
    role: 'user',
    text: 'What is radon?',
  });
  const first = await luna.createRun(supabase, {
    profileId: ALICE,
    conversationId: conversation.id,
    turnId: turn.id,
    clientMessageId: CLIENT_ID,
  });
  assert.equal(first.created, true);
  const again = await luna.createRun(supabase, {
    profileId: ALICE,
    conversationId: conversation.id,
    turnId: turn.id,
    clientMessageId: CLIENT_ID,
  });
  assert.equal(again.created, false, 'the same client message does not start a second run');
  assert.equal(again.run.id, first.run.id);
  assert.equal(supabase.rows('luna_runs').length, 1);

  assert.equal((await luna.findRun(supabase, { profileId: ALICE, id: first.run.id })).id, first.run.id, 'by run id');
  assert.equal((await luna.findRun(supabase, { profileId: ALICE, id: CLIENT_ID })).id, first.run.id, 'by client message id');
  assert.equal(await luna.findRun(supabase, { profileId: BOB, id: first.run.id }), null, 'another household finds nothing');
  assert.equal(await luna.findRun(supabase, { profileId: ALICE, id: 'no-such-run' }), null);
});

test('a run settles once: a cancelled run cannot be completed afterwards', async () => {
  const supabase = db();
  const { run } = await started(supabase, ALICE);

  assert.equal(await luna.claimRun(supabase, { profileId: ALICE, runId: run.id }), true, 'the work claims the run');
  assert.equal(await luna.claimRun(supabase, { profileId: ALICE, runId: run.id }), false, 'and only once');

  const cancelled = await luna.cancelRun(supabase, { profileId: ALICE, id: run.id });
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.settled_at, 'a cancelled run is settled');

  const late = await luna.settleRun(supabase, { profileId: ALICE, runId: run.id, status: 'completed' });
  assert.equal(late, null, 'the answer that arrived after the cancel does not move the run');
  assert.equal(supabase.rows('luna_runs')[0].status, 'cancelled');

  // Cancelling again is the same answer, not an error: the client may retry it.
  assert.equal((await luna.cancelRun(supabase, { profileId: ALICE, id: run.id })).status, 'cancelled');
  assert.equal(await luna.cancelRun(supabase, { profileId: BOB, id: run.id }), null, 'and not by anyone else');
});

test('a settled run records when, and a failure keeps its message', async () => {
  const supabase = db();
  const { run } = await started(supabase, ALICE);
  const settled = await luna.settleRun(supabase, {
    profileId: ALICE,
    runId: run.id,
    status: 'failed',
    message: luna.LUNA_RUN_FAILED_MESSAGE,
  });
  assert.equal(settled.status, 'failed');
  assert.ok(settled.settled_at);
  assert.equal(settled.message, luna.LUNA_RUN_FAILED_MESSAGE);
  await assert.rejects(
    () => luna.settleRun(supabase, { profileId: ALICE, runId: run.id, status: 'queued' }),
    /terminal/,
    'settling is for outcomes, not for going back to work',
  );
});

/** A conversation, a question and a queued run for `owner`. */
async function started(supabase, owner, text = 'What is radon?') {
  const conversation = await luna.startConversation(supabase, { profileId: owner });
  const turn = await luna.appendTurn(supabase, { profileId: owner, conversationId: conversation.id, role: 'user', text });
  const { run } = await luna.createRun(supabase, {
    profileId: owner,
    conversationId: conversation.id,
    turnId: turn.id,
    clientMessageId: `${owner.slice(0, 8)}-client-message`,
  });
  return { conversation, turn, run };
}

// ---------------------------------------------------------------------------
// The conversation the client is given back
// ---------------------------------------------------------------------------

test('a household has one conversation, and asking twice does not make a second', async () => {
  const supabase = db();
  const first = await luna.startConversation(supabase, { profileId: ALICE });
  const second = await luna.startConversation(supabase, { profileId: ALICE });
  assert.equal(second.id, first.id);
  assert.equal(supabase.rows('luna_conversations').length, 1);
  assert.equal(first.revision, 1, 'the client requires a revision of at least 1');

  assert.equal(await luna.currentConversation(supabase, { profileId: BOB }), null, 'and bob has none yet');
  const bobs = await luna.startConversation(supabase, { profileId: BOB });
  assert.notEqual(bobs.id, first.id);
});

test('the conversation that comes back carries the person\'s own turn, in order', async () => {
  const supabase = db();
  const conversation = await luna.startConversation(supabase, { profileId: ALICE });
  await luna.appendTurn(supabase, { profileId: ALICE, conversationId: conversation.id, role: 'user', text: 'What is PFOS?' });
  await luna.appendTurn(supabase, {
    profileId: ALICE,
    conversationId: conversation.id,
    role: 'assistant',
    text: 'It is a man made chemical.',
    sources: [{ title: 'EPA', url: 'https://epa.gov/pfas' }],
    evidence: [{ kind: 'fact', text: 'PFOS is man made.', sourceIndexes: [0] }],
  });
  await luna.appendTurn(supabase, { profileId: ALICE, conversationId: conversation.id, role: 'user', text: 'And in water?' });

  const payload = await luna.conversationPayload(supabase, { profileId: ALICE });
  assert.deepEqual(
    payload.messages.map((message) => [message.role, message.text]),
    [['user', 'What is PFOS?'], ['assistant', 'It is a man made chemical.'], ['user', 'And in water?']],
  );
  assert.equal(new Set(payload.messages.map((message) => message.id)).size, 3, 'ids are unique within the conversation');
  assert.equal(payload.messages[0].sources, undefined, 'a user turn carries no sources');
  assert.deepEqual(payload.messages[1].sources, [{ title: 'EPA', url: 'https://epa.gov/pfas' }]);
  assert.deepEqual(payload.messages[1].evidence, [{ kind: 'fact', text: 'PFOS is man made.', sourceIndexes: [0] }]);
  assert.ok(Number.isInteger(payload.revision) && payload.revision > 1, 'every turn advances the revision');
  assert.deepEqual(payload.unresolvedOperations, {}, 'there are no proposals in this package, so nothing can be parked');
  assert.equal(payload.pendingRequest, null);
});

test('the conversation is capped at the 500 messages the client will accept, keeping the newest', async () => {
  const supabase = db();
  const conversation = await luna.startConversation(supabase, { profileId: ALICE });
  const rows = [];
  for (let n = 1; n <= 510; n += 1) {
    rows.push({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      conversation_id: conversation.id,
      profile_id: ALICE,
      seq: n,
      role: n % 2 ? 'user' : 'assistant',
      body: `turn ${n}`,
    });
  }
  supabase.seed('luna_turns', rows);
  const payload = await luna.conversationPayload(supabase, { profileId: ALICE });
  assert.equal(payload.messages.length, 500, 'a longer transcript would be discarded whole by the client');
  assert.equal(payload.messages.at(-1).text, 'turn 510', 'the newest turns are the ones kept');
  assert.equal(payload.messages[0].text, 'turn 11');
});

test('a run still working is the pending request; a settled or dead one is not', async () => {
  const supabase = db();
  const { run } = await started(supabase, ALICE, 'What is radon?');
  const pending = (await luna.conversationPayload(supabase, { profileId: ALICE })).pendingRequest;
  assert.deepEqual(pending, { id: `${ALICE.slice(0, 8)}-client-message`, text: 'What is radon?', runId: run.id });

  // A run nothing will ever finish is not a pending request either: the same
  // staleness rule the status reports with.
  const age = async (ms) => {
    const { error } = await supabase
      .from('luna_runs')
      .update({ created_at: new Date(Date.now() - ms).toISOString() })
      .eq('profile_id', ALICE)
      .eq('id', run.id);
    assert.equal(error, null);
  };
  await age(luna.LUNA_RUN_STALE_AFTER_MS + 1000);
  assert.equal((await luna.conversationPayload(supabase, { profileId: ALICE })).pendingRequest, null, 'a dead run is not pending');

  await age(0);
  await luna.settleRun(supabase, { profileId: ALICE, runId: run.id, status: 'completed' });
  assert.equal((await luna.conversationPayload(supabase, { profileId: ALICE })).pendingRequest, null, 'a finished run is not pending');
});

test('clearing deletes the turns, keeps the id and raises the revision', async () => {
  const supabase = db();
  const { conversation, run } = await started(supabase, ALICE);
  await luna.settleRun(supabase, { profileId: ALICE, runId: run.id, status: 'completed' });
  const before = await luna.conversationPayload(supabase, { profileId: ALICE });

  const cleared = await luna.clearConversation(supabase, {
    profileId: ALICE,
    conversationId: conversation.id,
    expectedRevision: before.revision,
  });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.conversation.messages, [], 'the client requires an empty transcript back');
  assert.equal(cleared.conversation.id, before.id, 'the same id, because the client ignores a conversation whose id changed');
  assert.ok(cleared.conversation.revision > before.revision, 'with a strictly greater revision');
  assert.equal(supabase.rows('luna_turns').length, 0, 'the text somebody typed is gone, not hidden');
  assert.equal(supabase.rows('luna_runs').length, 0, 'and so are the runs that answered it');
});

test('clearing refuses a stale revision and refuses while a run is still working', async () => {
  const supabase = db();
  const { conversation } = await started(supabase, ALICE);
  const current = await luna.conversationPayload(supabase, { profileId: ALICE });

  const running = await luna.clearConversation(supabase, {
    profileId: ALICE,
    conversationId: conversation.id,
    expectedRevision: current.revision,
  });
  assert.deepEqual([running.ok, running.reason], [false, 'run_open'], 'deleting the turn a run is answering would strand it');
  assert.ok(supabase.rows('luna_turns').length > 0, 'nothing was deleted');

  await luna.settleRun(supabase, { profileId: ALICE, runId: supabase.rows('luna_runs')[0].id, status: 'completed' });
  const stale = await luna.clearConversation(supabase, {
    profileId: ALICE,
    conversationId: conversation.id,
    expectedRevision: current.revision - 1,
  });
  assert.deepEqual([stale.ok, stale.reason], [false, 'conflict']);
  assert.equal(stale.conversation.revision, current.revision, 'the caller is told what the current revision is');

  const notTheirs = await luna.clearConversation(supabase, {
    profileId: BOB,
    conversationId: conversation.id,
    expectedRevision: current.revision,
  });
  assert.deepEqual([notTheirs.ok, notTheirs.reason], [false, 'not_found'], 'and another household cannot clear it at all');
  assert.ok(supabase.rows('luna_turns').length > 0);
});

test('every statement this library runs is scoped to the household it was given', async () => {
  const supabase = db();
  await started(supabase, BOB); // another household's rows exist throughout
  const before = supabase.queryLog.length;
  const { conversation, run } = await started(supabase, ALICE);
  await luna.claimRun(supabase, { profileId: ALICE, runId: run.id });
  await luna.appendTurn(supabase, { profileId: ALICE, conversationId: conversation.id, role: 'assistant', text: 'An answer.' });
  await luna.settleRun(supabase, { profileId: ALICE, runId: run.id, status: 'completed' });
  await luna.conversationPayload(supabase, { profileId: ALICE });
  await luna.findRun(supabase, { profileId: ALICE, id: run.id });
  await luna.clearConversation(supabase, { profileId: ALICE, conversationId: conversation.id, expectedRevision: 3 });

  auditOwnerScope(supabase.queryLog.slice(before), ALICE, 'lib/luna.js');
  assert.ok(supabase.rows('luna_turns').some((row) => row.profile_id === BOB), "bob's conversation is untouched");
});

// ---------------------------------------------------------------------------
// Retrieval, citation and the degrade to sources (Ruling L4)
// ---------------------------------------------------------------------------

test('a source the client would reject is dropped rather than sinking the whole answer', () => {
  const kept = luna.usableSources([
    passage(1),
    passage(2, { source_url: 'http://agency2.example.test/page' }),
    passage(3, { source_url: 'https://user:secret@agency3.example.test/page' }),
    passage(4, { source_url: 'not a url' }),
    passage(5, { source_url: `https://agency5.example.test/${'x'.repeat(3100)}` }),
    passage(6, { source_label: '   ' }),
    passage(7, { source_label: 'L'.repeat(700) }),
  ]);
  assert.deepEqual(kept.map((entry) => entry.source.url), [
    'https://agency1.example.test/page',
    'https://agency6.example.test/page',
    'https://agency7.example.test/page',
  ]);
  assert.equal(kept[1].source.title, 'agency6.example.test', 'a passage with no label is titled by its host');
  assert.equal(kept[2].source.title.length, 500, 'a very long label is cut to what the client accepts');
});

test('nothing retrieved is an honest decline, and costs no model call', async () => {
  const { fetchImpl, sent } = scriptedFetch();
  const answer = await withEnv(MODELS, () =>
    luna.answerFromCorpus({ question: 'What is xyzzy?', apiKey: 'k', rpc: rpcReturning([]), fetchImpl }));
  assert.equal(answer.outcome, 'no_source');
  assert.equal(answer.text, luna.LUNA_NO_SOURCE);
  assert.deepEqual(answer.sources, []);
  assert.equal(answer.evidence, null);
  assert.equal(sent.filter((call) => call.url.includes('/chat')).length, 0, 'the chat model was never asked');
});

test('a cited answer keeps the prose, drops the markers and binds each source to what it says', async () => {
  const { fetchImpl } = scriptedFetch({ answer: 'Radon is a gas [2]. It collects indoors [2][1].' });
  const answer = await withEnv(MODELS, () =>
    luna.answerFromCorpus({ question: 'What is radon?', apiKey: 'k', rpc: rpcReturning([passage(1), passage(2)]), fetchImpl }));

  assert.equal(answer.outcome, 'answered');
  assert.equal(answer.text, 'Radon is a gas. It collects indoors.', 'the client prints text verbatim, so [n] would show');
  assert.deepEqual(answer.sources.map((source) => source.title), ['Agency 2', 'Agency 1'], 'sources in first cited order');
  assert.equal(answer.evidence.length, 2);
  for (const [index, block] of answer.evidence.entries()) {
    assert.equal(block.kind, 'fact');
    assert.deepEqual(block.sourceIndexes, [index], 'every index points into this message\'s own sources');
    assert.ok(block.text.trim().length > 0 && block.text.length <= 3000);
    assert.equal('observedAt' in block, false, 'the corpus stores a date, and a date cannot be an instant');
  }
  assert.ok(answer.evidence[0].text.includes('Passage 2'), 'a fact block quotes the source, not the model');
});

test('an answer that cites nothing, or echoes the decline, is a decline rather than an unsourced claim', async () => {
  for (const content of ['Radon is a gas.', luna.LUNA_NO_SOURCE, '', '   ']) {
    const { fetchImpl } = scriptedFetch({ answer: content });
    const answer = await withEnv(MODELS, () =>
      luna.answerFromCorpus({ question: 'What is radon?', apiKey: 'k', rpc: rpcReturning([passage(1)]), fetchImpl }));
    assert.equal(answer.outcome, 'no_source', JSON.stringify(content));
    assert.equal(answer.text, luna.LUNA_NO_SOURCE);
    assert.deepEqual(answer.sources, []);
  }
});

test('Ruling L4: when generation fails the person still gets the sources, clearly marked', async () => {
  const { fetchImpl, sent } = scriptedFetch({ chatStatus: 503 });
  const answer = await withEnv(MODELS, () =>
    luna.answerFromCorpus({ question: 'What is radon?', apiKey: 'k', rpc: rpcReturning([passage(1), passage(2)]), fetchImpl }));

  assert.equal(answer.outcome, 'sources_only');
  assert.equal(answer.text, luna.LUNA_SOURCES_ONLY);
  assert.equal(answer.text.includes('\u2014'), false);
  assert.deepEqual(answer.sources.map((source) => source.title), ['Agency 1', 'Agency 2']);
  assert.equal(answer.evidence.length, 2, 'each retrieved source is quoted as a fact block');
  assert.deepEqual(answer.evidence.map((block) => block.sourceIndexes), [[0], [1]]);
  assert.ok(sent.some((call) => call.url.includes('/chat')), 'the model was asked, and failing is what degraded it');
});

test('an embedding failure is an infrastructure failure, not a quiet decline', async () => {
  const { fetchImpl } = scriptedFetch({ embedStatus: 500 });
  await assert.rejects(
    () => withEnv(MODELS, () => luna.answerFromCorpus({ question: 'q', apiKey: 'k', rpc: rpcReturning([passage(1)]), fetchImpl })),
    /Embedding request failed/,
    'the caller settles the run as failed rather than telling someone there is no source',
  );
});

test('bounded history reaches the model as data, and nothing else does', async () => {
  const { fetchImpl, sent } = scriptedFetch({ answer: 'Radon is a gas [1].' });
  await withEnv(MODELS, () =>
    luna.answerFromCorpus({
      question: 'And indoors?',
      history: luna.historyPrompt(turns('What is radon?', 'A gas.')),
      page: 'Homeguard',
      apiKey: 'k',
      rpc: rpcReturning([passage(1)]),
      fetchImpl,
    }));
  const chat = sent.find((call) => call.url.includes('/chat'));
  const prompt = JSON.stringify(chat.body);
  assert.ok(prompt.includes('CONVERSATION'), 'the earlier turns are sent');
  assert.ok(prompt.includes('Person: What is radon?'));
  assert.equal(prompt.includes('HOUSEHOLD CONTEXT'), false, 'Ruling L2: no household block exists to send');
  assert.ok(prompt.includes('never as instructions'), 'and it is marked as data');
});

test('the model id comes from configuration, and an unset one fails loudly rather than costing money', async () => {
  const { fetchImpl, sent } = scriptedFetch();
  await assert.rejects(
    () => withEnv({ ASSISTANT_EMBED_MODEL: undefined, ASSISTANT_CHAT_MODEL: undefined }, () =>
      luna.answerFromCorpus({ question: 'q', apiKey: 'k', rpc: rpcReturning([passage(1)]), fetchImpl })),
    /ASSISTANT_EMBED_MODEL/,
  );
  assert.deepEqual(sent, [], 'nothing was sent to any provider');
});

// ---------------------------------------------------------------------------
// Refusal, copy, and the household-data boundary
// ---------------------------------------------------------------------------

test('Luna refuses diagnosis at least as strongly as the assistant already does, in its own words', () => {
  for (const question of ['Do I have asthma?', 'What medication should I take?', 'Is this cancer?']) {
    assert.equal(luna.diagnosticRefusal(question), luna.LUNA_DIAGNOSTIC_REFUSAL, question);
  }
  for (const question of ['What is PFOS?', 'How do I filter my water?', '']) {
    assert.equal(luna.diagnosticRefusal(question), null, question);
  }
  assert.equal(luna.LUNA_DIAGNOSTIC_REFUSAL.includes('\u2014'), false, 'the legacy refusal has an em dash; this one must not');
  assert.ok(/clinician/.test(luna.LUNA_DIAGNOSTIC_REFUSAL), 'and it still points at a person who can help');
});

test('no app-facing sentence this library can emit carries an em dash or a control character', () => {
  const copy = [
    luna.LUNA_DIAGNOSTIC_REFUSAL,
    luna.LUNA_NO_SOURCE,
    luna.LUNA_SOURCES_ONLY,
    luna.LUNA_RUN_FAILED_MESSAGE,
    luna.LUNA_RUN_CANCELLED_MESSAGE,
  ];
  for (const sentence of copy) {
    assert.equal(typeof sentence, 'string');
    assert.ok(sentence.length > 0 && sentence.length <= 1000, sentence);
    assert.equal(sentence.includes('\u2014'), false, sentence);
    assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(sentence), false, sentence);
  }
});

test('Ruling L2: this library has no path to household data at all', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/luna.js', import.meta.url)), 'utf8');
  const queried = [...source.matchAll(/\.from\(\s*'([a-z_0-9]+)'/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(queried)].sort(),
    ['luna_conversations', 'luna_runs', 'luna_turns'],
    'Luna answers from the public corpus only; a household read here would be a new decision, not a new line',
  );
  for (const forbidden of ['daily_scores', 'symptom_logs', 'home_contexts', 'household_bands', 'profiles', 'gatherHouseholdContext']) {
    assert.equal(source.includes(forbidden), false, `lib/luna.js must not reach for ${forbidden}`);
  }
});
