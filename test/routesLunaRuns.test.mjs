/**
 * GET /api/luna/runs/status and POST /api/luna/runs/cancel (B03 plan, Task 2c).
 *
 * These two routes operate the run model from lib/luna.js. `POST /api/luna/
 * messages` must answer inside the client's hard 20 second timeout and must not
 * hold the connection open, so it returns a run and the answer is collected
 * here: the component polls `luna.run` up to 120 times, exactly a second
 * apart, and learns the run finished only by its `status` becoming
 * `completed`, `failed` or `cancelled` (ProductionLunaConversation.tsx:51-59).
 *
 * The three inherited decisions these tests keep true:
 *
 * 1. AN ID WITH NO RUN ANSWERS A FAILED RUN, NEVER A 404. The component only
 *    stops polling on a terminal status, and a 404 maps to 'unavailable'
 *    (runtime.ts:144), which would park the person's attempt for ever with
 *    nothing they can do. This is not a corner case: a question refused before
 *    a run existed still leaves the client polling with its own message id.
 * 2. `LunaRun.id` IS ALWAYS THE CANONICAL RUN ID. The client adopts whatever
 *    comes back and polls with it (`:54`, `:58`), so the id must be stable
 *    across polls; it may arrive as either the run id or the original
 *    `clientMessageId` and must come back as the run's own id.
 * 3. A RUN PAST ITS WINDOW READS AS FAILED. `LunaRun.status` has no 'unknown',
 *    so a generation the platform killed must not keep looking like work in
 *    progress.
 *
 * Cancelling is a mutation, so it goes through the operation ledger
 * (lib/operations.js, domain `luna`) and is idempotent on replay. The client
 * sends `Idempotency-Key: cancel:<clientMessageId>` (`:64`), which is not a
 * UUID and so cannot be the ledger's `operation_id uuid primary key` as it
 * stands: the route derives a stable UUID from it, which is what makes the
 * replay return the first outcome.
 *
 * `assertLunaRun` and `assertLunaConversation` below transcribe
 * `validLunaRun` and `validLunaConversation` (lib/frontend/production/
 * luna-service.ts:21-28) on `origin/codex/october15-review-refinement`. The
 * client discards the whole payload if it does not match, so every test
 * asserts the whole contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const luna = await import('../lib/luna.js');

const STATUS = '/api/luna/runs/status';
const CANCEL = '/api/luna/runs/cancel';
const TABLES = haloTables('profiles', 'operations', 'luna_conversations', 'luna_turns', 'luna_runs');

/** The flag that turns Luna on. Off unless a test sets it (BE-351, Ruling L5). */
const ON = { HALO_FEATURE_LUNA: 'on' };

const EM_DASH = String.fromCodePoint(0x2014);
const CLIENT_ID = '33333333-3333-4333-8333-333333333331';
const OTHER_CLIENT_ID = '33333333-3333-4333-8333-333333333332';
const MISSING_RUN = '44444444-4444-4444-8444-444444444444';
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** Makes a run look that old. h.db.rows() hands back copies, so this has to be a real statement. */
async function age(h, runId, ms) {
  const { error } = await h.db.from('luna_runs').update({ created_at: ago(ms) }).eq('id', runId);
  if (error) throw error;
}

function harness() {
  return createRouteHarness({
    tables: TABLES,
    seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id }, { id: bob.id }] }),
  });
}

/**
 * A conversation, a question and a queued run for one household, built through
 * lib/luna.js so the rows are exactly the ones the real message route writes.
 */
async function started(h, who, { text = 'What is radon?', clientMessageId = CLIENT_ID } = {}) {
  const profileId = h.identities[who].id;
  const conversation = await luna.startConversation(h.db, { profileId });
  const turn = await luna.appendTurn(h.db, { profileId, conversationId: conversation.id, role: 'user', text });
  const { run } = await luna.createRun(h.db, {
    profileId,
    conversationId: conversation.id,
    turnId: turn.id,
    clientMessageId,
  });
  return { profileId, conversation, turn, run };
}

/** Writes the answer and settles the run, the way the generation step does. */
async function answered(h, who, state, { answer = 'Radon comes up from the soil.' } = {}) {
  const { profileId, conversation, run } = state;
  await luna.appendTurn(h.db, {
    profileId,
    conversationId: conversation.id,
    role: 'assistant',
    text: answer,
    sources: [{ title: 'Agency page', url: 'https://agency.example.test/radon' }],
    evidence: [{ kind: 'fact', text: answer, sourceIndexes: [0] }],
  });
  return luna.settleRun(h.db, { profileId, runId: run.id, status: 'completed' });
}

const status = (h, who, id, { env = ON } = {}) =>
  h.call(STATUS, 'GET', { as: who, url: `${STATUS}?id=${encodeURIComponent(id)}`, env });

const cancel = (h, who, id, { env = ON, key = `cancel:${CLIENT_ID}`, body } = {}) =>
  h.call(CANCEL, 'POST', {
    as: who,
    body: body ?? { id },
    headers: key === null ? {} : { 'idempotency-key': key },
    env,
  });

// --- the client's validators, transcribed ----------------------------------

const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
/** `text` from luna-service.ts:13: within `max`, and free of the control characters it names. */
const controlFree = (value) =>
  !Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
  });
const text = (value, max = 16000) => typeof value === 'string' && value.length <= max && controlFree(value);
const safeSourceUrl = (value) => {
  if (!text(value, 3000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** `validLunaConversation`, transcribed. */
function assertLunaConversation(conversation) {
  assert.ok(object(conversation), 'a conversation is a plain object');
  assert.ok(text(conversation.id, 200) && conversation.id, 'the conversation id is non-empty text');
  assert.ok(
    Number.isInteger(conversation.revision) && conversation.revision > 0,
    'the revision is an integer strictly greater than 0',
  );
  assert.ok(Array.isArray(conversation.messages) && conversation.messages.length <= 500, 'at most 500 messages');
  const ids = conversation.messages.map((message) => message.id);
  assert.equal(new Set(ids).size, ids.length, 'message ids are unique within the conversation');
  for (const message of conversation.messages) {
    assert.ok(object(message));
    assert.ok(text(message.id, 200) && message.id, 'every message has a non-empty id');
    assert.ok(['user', 'assistant'].includes(message.role), `role ${message.role} is one of user, assistant`);
    assert.ok(text(message.text), 'the message text is within 16000 control-character-free characters');
    if (message.sources !== undefined) {
      assert.ok(Array.isArray(message.sources) && message.sources.length <= 30);
      for (const source of message.sources) {
        assert.ok(object(source) && text(source.title, 500), 'a source title is text of at most 500');
        assert.ok(safeSourceUrl(source.url), `a source url must be https with no credentials: ${source.url}`);
      }
    }
    if (message.evidence !== undefined) {
      // Evidence may ride only on an assistant message, and every index must
      // point into that message's own sources.
      assert.equal(message.role, 'assistant', 'only an answer carries evidence');
      const count = Array.isArray(message.sources) ? message.sources.length : 0;
      assert.ok(Array.isArray(message.evidence) && message.evidence.length > 0 && message.evidence.length <= 20);
      for (const block of message.evidence) {
        assert.ok(['fact', 'interpretation', 'next-step'].includes(block.kind));
        assert.ok(text(block.text, 3000) && block.text.trim(), 'an evidence block has text');
        assert.ok(Array.isArray(block.sourceIndexes) && block.sourceIndexes.length <= 30);
        assert.equal(new Set(block.sourceIndexes).size, block.sourceIndexes.length, 'no duplicate indexes');
        for (const index of block.sourceIndexes) {
          assert.ok(Number.isInteger(index) && index >= 0 && index < count, `index ${index} is inside the sources`);
        }
        if (block.kind === 'fact') assert.ok(block.sourceIndexes.length > 0, 'a fact must cite a source');
      }
    }
  }
  if (conversation.pendingRequest !== undefined && conversation.pendingRequest !== null) {
    const pending = conversation.pendingRequest;
    assert.ok(object(pending));
    assert.ok(text(pending.id, 200) && pending.id, 'a pending request carries the client id');
    assert.ok(text(pending.text, 1000), 'and the question, capped at the send limit');
    if (pending.runId !== undefined) assert.ok(text(pending.runId, 200));
  }
  if (conversation.unresolvedOperations !== undefined) {
    const unresolved = conversation.unresolvedOperations;
    assert.ok(object(unresolved) && Object.keys(unresolved).length <= 100);
    for (const [key, id] of Object.entries(unresolved)) {
      assert.ok(key && key.length <= 200 && text(id, 200) && id);
    }
  }
}

/**
 * `validLunaRun`, transcribed. The required-by-status rule stated plainly:
 * `completed` MUST carry a valid conversation, or the client throws the whole
 * payload away and the person loses both the answer and their own question.
 */
function assertLunaRun(body) {
  assert.ok(object(body), 'a run is a plain object');
  assert.ok(text(body.id, 200) && body.id, 'the run id is non-empty text');
  assert.ok(
    ['queued', 'generating', 'completed', 'failed', 'cancelled'].includes(body.status),
    `status ${body.status} is one the client accepts`,
  );
  if (body.message !== undefined) {
    assert.ok(text(body.message, 1000), 'a run message is text of at most 1000 characters');
    assert.equal(body.message.includes(EM_DASH), false, 'app-facing copy uses no em dash');
  }
  if (body.conversation === undefined) {
    assert.notEqual(body.status, 'completed', 'a completed run must carry its conversation');
  } else {
    assertLunaConversation(body.conversation);
  }
}

// ---------------------------------------------------------------------------
// runs/status: reporting a run
// ---------------------------------------------------------------------------

test('a queued run reports queued, under the canonical run id', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const body = await (await status(h, 'alice', state.run.id)).json();
  assertLunaRun(body);
  assert.equal(body.id, state.run.id);
  assert.equal(body.status, 'queued');
});

test('a generating run reports generating, which the client treats as still working', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  await luna.claimRun(h.db, { profileId: state.profileId, runId: state.run.id });
  const body = await (await status(h, 'alice', state.run.id)).json();
  assertLunaRun(body);
  assert.equal(body.status, 'generating');
});

test('the client may ask by its own message id, and the answer is still the canonical run id', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const body = await (await status(h, 'alice', CLIENT_ID)).json();
  assertLunaRun(body);
  // The client adopts `response.id` and polls with it (`:54`, `:58`), so an id
  // that changed between polls would make it chase a moving target.
  assert.equal(body.id, state.run.id, 'LunaRun.id is always the run id, never the id that was asked with');
  assert.notEqual(body.id, CLIENT_ID);
});

test('a completed run carries the whole conversation including the person\'s own turn (Ruling L8)', async () => {
  const h = harness();
  const state = await started(h, 'alice', { text: 'Is radon common here?' });
  await answered(h, 'alice', state);
  const body = await (await status(h, 'alice', state.run.id)).json();
  assertLunaRun(body);
  assert.equal(body.status, 'completed');
  assert.ok(body.conversation, 'a completed run without a conversation is discarded whole by the client');
  // The production component never appends the person's message locally
  // (`:55` only replaces state), so a payload without their turn loses their
  // own words off their screen.
  assert.deepEqual(
    body.conversation.messages.map((message) => message.role),
    ['user', 'assistant'],
  );
  assert.equal(body.conversation.messages[0].text, 'Is radon common here?');
  assert.equal(body.conversation.pendingRequest, null, 'a settled run is not still pending');
  assert.deepEqual(body.conversation.unresolvedOperations, {}, 'no proposals exist, so nothing can be parked');
});

test('an id with no run reports a failed run, never a 404', async () => {
  const h = harness();
  const response = await status(h, 'alice', MISSING_RUN);
  assert.equal(response.status, 200, 'a 404 would park the client\'s attempt for ever');
  const body = await response.json();
  assertLunaRun(body);
  assert.equal(body.id, MISSING_RUN, 'the id the client polls with comes back, so its loop terminates');
  assert.equal(body.status, 'failed');
  assert.equal(body.message, luna.LUNA_RUN_FAILED_MESSAGE);
  assert.match(body.message, /question is kept/, 'and it says the question is not lost');
  assert.ok(!('conversation' in body), 'there is no conversation to report for a run that never existed');
});

test('a run past its staleness window does not report as still running', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  // Nothing settled it: the generation runs in `after()`, which shares the
  // route's invocation budget, so the platform can kill it mid-answer.
  await age(h, state.run.id, luna.LUNA_RUN_STALE_AFTER_MS + 5000);
  const body = await (await status(h, 'alice', state.run.id)).json();
  assertLunaRun(body);
  assert.equal(body.status, 'failed', 'a dead generation is not work in progress');
  assert.equal(body.message, luna.LUNA_RUN_FAILED_MESSAGE);
  assert.equal(h.db.rows('luna_runs')[0].status, 'queued', 'and the honest answer is derived, not written');
});

test('a run inside its window is still reported as working', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  await age(h, state.run.id, luna.LUNA_RUN_STALE_AFTER_MS - 5000);
  const body = await (await status(h, 'alice', state.run.id)).json();
  assert.equal(body.status, 'queued', 'a slow but living generation must not be slandered as dead');
});

test('a poll of a run still working carries no conversation, so a transcript is not re-sent every second', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const before = h.db.queryLog.length;
  for (const expected of ['queued', 'generating']) {
    if (expected === 'generating') await luna.claimRun(h.db, { profileId: state.profileId, runId: state.run.id });
    const body = await (await status(h, 'alice', state.run.id)).json();
    assertLunaRun(body);
    assert.equal(body.status, expected);
    // A deliberate decision, not an oversight. The client does nothing with a
    // transcript that has not changed (`:55` only replaces state), and it
    // polls once a second for up to 120 seconds, so attaching up to 500
    // messages every time would cost the person bandwidth and the deployment
    // egress for no effect on screen. The person's own turn reaches the screen
    // from the POST that created the run, which has just written it.
    assert.ok(!('conversation' in body), `a ${expected} run needs nothing but its id and status`);
  }
  const reads = h.db.queryLog.slice(before).filter((entry) => entry.table === 'luna_turns');
  assert.deepEqual(reads, [], 'and no turn is read to answer a poll that is still waiting');
});

test('a cancelled run reports cancelled with the conversation, so the kept question is on screen', async () => {
  const h = harness();
  const state = await started(h, 'alice', { text: 'What about lead?' });
  await luna.cancelRun(h.db, { profileId: state.profileId, id: state.run.id });
  const body = await (await status(h, 'alice', state.run.id)).json();
  assertLunaRun(body);
  assert.equal(body.status, 'cancelled');
  assert.equal(body.message, luna.LUNA_RUN_CANCELLED_MESSAGE);
  assert.equal(body.conversation.messages[0].text, 'What about lead?');
});

test('a missing or unusable id is a 400 naming the field, never an invented run', async () => {
  const h = harness();
  for (const url of [STATUS, `${STATUS}?id=`, `${STATUS}?id=%20`, `${STATUS}?id=${'x'.repeat(201)}`]) {
    const response = await h.call(STATUS, 'GET', { as: 'alice', url, env: ON });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
    assert.equal(body.field_errors[0].field, 'id');
    assert.ok(!('status' in body), 'an unusable id is not answered with a run status');
  }
});

// ---------------------------------------------------------------------------
// runs/status: whose run it is
// ---------------------------------------------------------------------------

test('another household\'s run id is unreachable, and the answer says nothing about whose it is', async () => {
  const h = harness();
  const theirs = await started(h, 'bob', { text: 'Bob asked this' });
  const foreign = await (await status(h, 'alice', theirs.run.id)).json();
  const missing = await (await status(h, 'alice', MISSING_RUN)).json();
  assertLunaRun(foreign);
  assert.equal(foreign.status, 'failed');
  assert.ok(!('conversation' in foreign), 'not a word of the other household\'s conversation');
  // Identical but for the echoed id, so the answer cannot be used to find out
  // whether somebody else's run exists.
  assert.deepEqual({ ...foreign, id: 'x' }, { ...missing, id: 'x' });
  assert.equal(JSON.stringify(foreign).includes('Bob asked this'), false);
});

test('the client\'s own message id is not a cross-household key either', async () => {
  const h = harness();
  await started(h, 'bob');
  const body = await (await status(h, 'alice', CLIENT_ID)).json();
  assert.equal(body.status, 'failed', 'bob\'s client message id finds nothing for alice');
  assert.ok(!('conversation' in body));
});

test('identity comes only from the verified token, and a profileId in the query changes nothing', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  await expectEnvelope(await h.call(STATUS, 'GET', { as: null, url: `${STATUS}?id=${state.run.id}`, env: ON }), {
    status: 401,
    code: 'auth_required',
  });
  await expectEnvelope(
    await h.call(STATUS, 'GET', {
      headers: { authorization: 'Bearer nope' },
      url: `${STATUS}?id=${state.run.id}`,
      env: ON,
    }),
    { status: 401, code: 'auth_required' },
  );
  const smuggled = await h.call(STATUS, 'GET', {
    as: 'bob',
    url: `${STATUS}?id=${state.run.id}&profileId=${h.identities.alice.id}`,
    env: ON,
  });
  const body = await smuggled.json();
  assert.equal(body.status, 'failed', 'naming the owner in the query does not make the run readable');
});

test('a status read writes nothing', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const before = h.db.queryLog.length;
  await status(h, 'alice', state.run.id);
  const writes = h.db.queryLog.slice(before).filter((entry) => entry.operation !== 'select');
  assert.deepEqual(writes, [], 'polling a run changes nothing');
});

// ---------------------------------------------------------------------------
// runs/cancel
// ---------------------------------------------------------------------------

test('cancelling settles the run and reports a state the client accepts as confirmed', async () => {
  const h = harness();
  const state = await started(h, 'alice', { text: 'Stop this one' });
  const response = await cancel(h, 'alice', state.run.id);
  assert.equal(response.status, 200);
  const body = await response.json();
  assertLunaRun(body);
  // `:64` treats anything outside these three as 'unconfirmed' and leaves the
  // attempt parked.
  assert.ok(['cancelled', 'completed', 'failed'].includes(body.status), `${body.status} is a confirmed stop`);
  assert.equal(body.status, 'cancelled');
  assert.equal(body.id, state.run.id);
  assert.equal(body.message, luna.LUNA_RUN_CANCELLED_MESSAGE);
  assert.match(body.message, /question is kept/);
  assert.equal(body.conversation.messages[0].text, 'Stop this one', 'the question stays on screen');

  const row = h.db.rows('luna_runs')[0];
  assert.equal(row.status, 'cancelled');
  assert.ok(row.settled_at, 'a cancelled run is settled, so nothing later can move it');
});

test('an answer that arrives after the cancel cannot move the run', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  await cancel(h, 'alice', state.run.id);
  const late = await luna.settleRun(h.db, { profileId: state.profileId, runId: state.run.id, status: 'completed' });
  assert.equal(late, null, 'the generation learns its answer is not wanted');
  const body = await (await status(h, 'alice', state.run.id)).json();
  assert.equal(body.status, 'cancelled');
});

test('a replayed cancel returns the first outcome and does not cancel twice', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const first = await (await cancel(h, 'alice', state.run.id)).json();
  const settledAt = h.db.rows('luna_runs')[0].settled_at;

  const before = h.db.queryLog.length;
  const again = await cancel(h, 'alice', state.run.id);
  assert.equal(again.status, 200);
  const second = await again.json();
  assertLunaRun(second);
  assert.deepEqual(second, first, 'the same key is answered with the same outcome');
  assert.equal(h.db.rows('luna_runs')[0].settled_at, settledAt, 'the run was not settled a second time');
  const updates = h.db.queryLog
    .slice(before)
    .filter((entry) => entry.table === 'luna_runs' && entry.operation !== 'select');
  assert.deepEqual(updates, [], 'the replay did not touch the run at all');
  assert.equal(h.db.rows('operations').length, 1, 'one attempt, one ledger row');
});

test('the ledger records the cancel in the luna domain and keeps conversation text out of the receipt', async () => {
  const h = harness();
  const state = await started(h, 'alice', { text: 'A sentence a person typed' });
  await cancel(h, 'alice', state.run.id);
  const [row] = h.db.rows('operations');
  assert.equal(row.domain, 'luna');
  assert.equal(row.profile_id, state.profileId, 'the receipt is owned by the caller');
  assert.equal(row.status, 'succeeded');
  // BE-313 and 0017's own note: `result` is a receipt, not record content. The
  // conversation is composed at read time instead, so the ledger never holds
  // the free text somebody typed.
  assert.equal(JSON.stringify(row.result).includes('A sentence a person typed'), false);
  assert.ok(!('conversation' in row.result), 'no conversation is stored in the ledger');
});

test('cancelling a run that finished first reports completed, which the contract allows', async () => {
  const h = harness();
  const state = await started(h, 'alice', { text: 'Finished during the race' });
  await answered(h, 'alice', state);
  const body = await (await cancel(h, 'alice', state.run.id)).json();
  assertLunaRun(body);
  assert.equal(body.status, 'completed', 'the honest answer is what actually happened');
  assert.ok(body.conversation, 'and a completed run must carry its conversation');
  assert.equal(body.conversation.messages.length, 2);
});

test('cancelling an id with no run reports a failed run, never a 404', async () => {
  const h = harness();
  const response = await cancel(h, 'alice', MISSING_RUN);
  assert.equal(response.status, 200);
  const body = await response.json();
  assertLunaRun(body);
  assert.equal(body.id, MISSING_RUN);
  assert.equal(body.status, 'failed', 'a confirmed stop, so the client stops waiting');
  assert.equal(body.message, luna.LUNA_RUN_FAILED_MESSAGE);
});

test('another household\'s run id cancels nothing, and the answer says nothing about whose it is', async () => {
  const h = harness();
  const theirs = await started(h, 'bob', { text: 'Bob asked this' });
  const foreign = await (await cancel(h, 'alice', theirs.run.id)).json();
  const missing = await (await cancel(h, 'alice', MISSING_RUN, { key: `cancel:${OTHER_CLIENT_ID}` })).json();
  assertLunaRun(foreign);
  assert.equal(foreign.status, 'failed');
  assert.deepEqual({ ...foreign, id: 'x' }, { ...missing, id: 'x' }, 'identical but for the echoed id');
  assert.equal(JSON.stringify(foreign).includes('Bob asked this'), false);
  assert.equal(h.db.rows('luna_runs')[0].status, 'queued', 'bob\'s run is untouched');
  assert.equal(h.db.rows('luna_runs')[0].settled_at ?? null, null);
});

test('the client\'s prefixed idempotency key is accepted and is what makes the replay work', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  // `cancel:<clientMessageId>` is not a UUID (`:64`), and the ledger's
  // operation_id is one, so the route derives a stable id from the header.
  const key = `cancel:${CLIENT_ID}`;
  const first = await (await cancel(h, 'alice', state.run.id, { key })).json();
  const second = await (await cancel(h, 'alice', state.run.id, { key })).json();
  assert.deepEqual(second, first);
  assert.equal(h.db.rows('operations').length, 1);
  // A different key is a different attempt, and the honest answer to it is the
  // outcome that already happened.
  const other = await (await cancel(h, 'alice', state.run.id, { key: `cancel:${OTHER_CLIENT_ID}` })).json();
  assert.equal(other.status, 'cancelled');
  assert.equal(h.db.rows('operations').length, 2);
});

test('reusing one key for a different run is a conflict, not the first run\'s outcome', async () => {
  const h = harness();
  const mine = await started(h, 'alice');
  await cancel(h, 'alice', mine.run.id);
  const body = await expectEnvelope(await cancel(h, 'alice', MISSING_RUN), { status: 409, code: 'conflict' });
  assert.ok(!('status' in body), 'a conflict is not answered with a run status');
});

test('the body is validated on the server: the client is never authority', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const cases = [
    { body: {}, field: 'id', note: 'a cancel needs an id' },
    { body: { id: '' }, field: 'id', note: 'and a non-empty one' },
    { body: { id: 7 }, field: 'id', note: 'a number is not an id' },
    { body: { id: 'x'.repeat(201) }, field: 'id', note: 'bounded at the client\'s own 200' },
    { body: { id: state.run.id, profileId: h.identities.bob.id }, field: 'profileId', note: 'no owner in the body' },
    { body: { id: state.run.id, extra: 1 }, field: 'extra', note: 'nothing the contract does not send' },
  ];
  for (const { body, field, note } of cases) {
    const response = await cancel(h, 'alice', null, { body });
    const envelope = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
    assert.equal(envelope.field_errors[0].field, field, note);
  }
  assert.equal(h.db.rows('luna_runs')[0].status, 'queued', 'nothing was cancelled by a refused body');
  assert.deepEqual(h.db.rows('operations'), [], 'and nothing was recorded in the ledger');
});

test('a cancel with no idempotency key is refused rather than recorded outside the ledger', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const body = await expectEnvelope(await cancel(h, 'alice', state.run.id, { key: null }), {
    status: 400,
    code: 'validation_failed',
  });
  assert.equal(body.field_errors[0].field, 'operationId');
  assert.equal(h.db.rows('luna_runs')[0].status, 'queued');
});

// ---------------------------------------------------------------------------
// The capability flag, and before migration 0020
// ---------------------------------------------------------------------------

test('with the capability off both routes refuse, read nothing and write nothing', async () => {
  const h = harness();
  const state = await started(h, 'alice');
  const before = h.db.queryLog.length;

  for (const response of [
    await h.call(STATUS, 'GET', { as: 'alice', url: `${STATUS}?id=${state.run.id}` }),
    await h.call(CANCEL, 'POST', {
      as: 'alice',
      body: { id: state.run.id },
      headers: { 'idempotency-key': `cancel:${CLIENT_ID}` },
    }),
  ]) {
    const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
    assert.ok(!('status' in body), 'an off capability must not be answered with a run status');
    assert.equal(body.message.includes(EM_DASH), false, 'app-facing copy uses no em dash');
  }

  assert.deepEqual(h.db.queryLog.slice(before), [], 'off means off: nothing read, nothing written');
  assert.equal(h.db.rows('luna_runs')[0].status, 'queued');
});

test('neither run route needs a provider key, so a key removed mid-run strands nothing', async () => {
  const h = harness();
  const state = await started(h, 'alice', { text: 'Asked while a key was configured' });
  // RULING L13 stops at `capabilities`, deliberately. Reading or stopping a run
  // needs no provider: the run already exists, and refusing a status poll for a
  // missing key would strand a run that was created while one was present, with
  // the client polling an id it can never settle. `ON` here carries the flag and
  // no key, and the sandbox scrubs every provider variable, so this is the
  // unconfigured deployment.
  const polled = await (await status(h, 'alice', state.run.id)).json();
  assertLunaRun(polled);
  assert.equal(polled.status, 'queued', 'the run is still readable');

  const stopped = await (await cancel(h, 'alice', state.run.id)).json();
  assertLunaRun(stopped);
  assert.equal(stopped.status, 'cancelled', 'and still stoppable');
  assert.equal(stopped.conversation.messages[0].text, 'Asked while a key was configured');
  assert.deepEqual(h.blockedFetches, [], 'and neither route called a provider to find out');
});

test('before migration 0020 both routes report the feature unavailable, never a run', async (t) => {
  muteConsoleError(t);
  const h = createRouteHarness({
    tables: haloTables('profiles', 'operations'), // no Luna tables
    seed: ({ alice }) => ({ profiles: [{ id: alice.id }] }),
  });
  for (const response of [
    await h.call(STATUS, 'GET', { as: 'alice', url: `${STATUS}?id=${MISSING_RUN}`, env: ON }),
    await h.call(CANCEL, 'POST', {
      as: 'alice',
      body: { id: MISSING_RUN },
      headers: { 'idempotency-key': `cancel:${CLIENT_ID}` },
      env: ON,
    }),
  ]) {
    const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
    assert.ok(!('status' in body), 'a missing schema must not be answered with a failed run it invented');
    assert.ok(!('id' in body));
  }
  // Nothing was claimed in the ledger, so the same key works once the
  // migration is applied instead of replaying a stale failure for ever.
  assert.deepEqual(h.db.rows('operations'), [], 'an unavailable feature claims no operation id');
});

test('before migration 0017 the cancel reports the feature unavailable and cancels nothing', async (t) => {
  muteConsoleError(t);
  const h = createRouteHarness({
    tables: haloTables('profiles', 'luna_conversations', 'luna_turns', 'luna_runs'), // no operations table
    seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id }, { id: bob.id }] }),
  });
  const state = await started(h, 'alice');
  const body = await expectEnvelope(await cancel(h, 'alice', state.run.id), {
    status: 503,
    code: 'feature_unavailable',
    retryable: false,
  });
  assert.ok(!('status' in body));
  assert.equal(h.db.rows('luna_runs')[0].status, 'queued', 'a mutation with no ledger does not happen');
});
