/**
 * GET /api/luna/conversations and POST /api/luna/conversations/clear (B03 Task 2b).
 *
 * The client validates both answers and DISCARDS the whole payload when they do
 * not match, so the authority here is `lib/frontend/production/luna-service.ts`
 * and `lib/frontend/production/ProductionLunaClear.ts` on
 * `origin/codex/october15-review-refinement`, quoted in the B03 contract digest.
 * `assertLunaConversation` below is that validator transcribed, and every test
 * runs the whole of it rather than the one field it happens to be about.
 *
 * The detail that decides whether clearing works at all is `ProductionLunaClear.ts:19`:
 *
 *   if(!validLunaConversation(result)||result.messages.length
 *      ||result.id===attempt.conversationId&&result.revision<=attempt.revision)
 *     throw new Error('invalid conversation receipt')
 *
 * A cleared conversation returning the same id AND the same revision is thrown
 * away as an invalid receipt, so clearing would appear to a person to do
 * nothing at all. `assertClearReceipt` asserts exactly that expression.
 *
 * Four other things this file is about:
 *
 * 1. Clearing is a mutation, so it goes through the operation ledger
 *    (migration 0017) and nothing else: a replayed `Idempotency-Key` returns
 *    the first outcome and does not clear a second time.
 * 2. Clearing deletes this household's Luna turns and nothing else. Asserted on
 *    real rows, including another household's conversation and this
 *    household's non-Luna data.
 * 3. The capability is off until somebody turns it on (BE-351). While it is
 *    off neither route reads a table or writes one.
 * 4. "This household has no conversation" and "migration 0020 is not applied"
 *    are different answers. The first is an empty conversation; the second is a
 *    non-retryable 503, never a false empty conversation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const { requestHash } = await import('@/lib/operations');

const ROUTE = '/api/luna/conversations';
const CLEAR = '/api/luna/conversations/clear';

/** Everything either route touches, plus two non-Luna owned tables clearing must not reach. */
const TABLES = haloTables(
  'profiles',
  'operations',
  'luna_conversations',
  'luna_turns',
  'luna_runs',
  'symptom_logs',
  'daily_scores',
);

/** The flag that turns the capability on. Off unless a test asks for it. */
const ON = { HALO_FEATURE_LUNA: 'on' };

const ALICE_CONV = '44444444-4444-4444-8444-444444444441';
const BOB_CONV = '44444444-4444-4444-8444-444444444442';
const MISSING_CONV = '44444444-4444-4444-8444-444444444449';
const OP = '55555555-5555-4555-8555-555555555551';
const OTHER_OP = '55555555-5555-4555-8555-555555555552';
const RUN = '77777777-7777-4777-8777-777777777771';
const CLIENT_MSG = '88888888-8888-4888-8888-888888888881';
const turnId = (n) => `66666666-6666-4666-8666-6666666666${String(n).padStart(2, '0')}`;

const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** The source shape the client will accept: https, no credentials, a title. */
const SOURCE = { title: 'EPA radon basics', url: 'https://www.epa.gov/radon/basics' };

/**
 * alice's seeded transcript: her question, Luna's cited answer, her follow-up.
 * Array order is the contract, and `seq` is what carries it.
 */
const ALICE_TURNS = [
  { id: turnId(1), seq: 101, role: 'user', body: 'What is radon?' },
  {
    id: turnId(2),
    seq: 102,
    role: 'assistant',
    body: 'Radon is a radioactive gas that comes from the ground.',
    sources: [SOURCE],
    evidence: [{ kind: 'fact', text: 'Radon is a radioactive gas from the decay of uranium in soil.', sourceIndexes: [0] }],
  },
  { id: turnId(3), seq: 103, role: 'user', body: 'ALICE-FOLLOW-UP-MARKER how do I test for it?' },
];

/** bob's transcript, with markers that must never appear in alice's answer. */
const BOB_TURNS = [
  { id: turnId(8), seq: 201, role: 'user', body: 'BOB-QUESTION-MARKER is my water safe?' },
  { id: turnId(9), seq: 202, role: 'assistant', body: 'BOB-ANSWER-MARKER here is what the agencies say.' },
];

/**
 * @param {object} [options]
 * @param {object} [options.tables] table declarations; drop one to model a schema before 0020
 * @param {boolean} [options.aliceConversation] false for a household that has never asked anything
 * @param {Array} [options.aliceTurns] alice's transcript
 * @param {Array} [options.runs] luna_runs rows (profile_id 'alice' or 'bob')
 * @param {Array} [options.operations] ledger rows (profile_id 'alice' or 'bob')
 */
function harness({
  tables = TABLES,
  aliceConversation = true,
  aliceTurns = ALICE_TURNS,
  aliceRevision = 4,
  runs = [],
  operations = [],
} = {}) {
  return createRouteHarness({
    tables,
    seed: ({ alice, bob }) => {
      const owner = (who) => (who === 'bob' ? bob.id : alice.id);
      return {
        profiles: [{ id: alice.id }, { id: bob.id }],
        // Non-Luna data clearing must leave exactly as it is.
        symptom_logs: [
          { id: turnId(20), profile_id: alice.id, entry_date: '2026-10-01', notes: 'ALICE-JOURNAL-MARKER' },
          { id: turnId(21), profile_id: bob.id, entry_date: '2026-10-01', notes: 'BOB-JOURNAL-MARKER' },
        ],
        daily_scores: [
          { id: turnId(22), profile_id: alice.id, date: '2026-10-01', aqi: 41 },
          { id: turnId(23), profile_id: bob.id, date: '2026-10-01', aqi: 42 },
        ],
        luna_conversations: [
          ...(aliceConversation ? [{ id: ALICE_CONV, profile_id: alice.id, revision: aliceRevision }] : []),
          { id: BOB_CONV, profile_id: bob.id, revision: 3 },
        ],
        luna_turns: [
          ...(aliceConversation
            ? aliceTurns.map((turn) => ({ ...turn, conversation_id: ALICE_CONV, profile_id: alice.id }))
            : []),
          ...BOB_TURNS.map((turn) => ({ ...turn, conversation_id: BOB_CONV, profile_id: bob.id })),
        ],
        luna_runs: runs.map((run) => ({
          ...run,
          profile_id: owner(run.profile_id),
          conversation_id: run.conversation_id ?? (run.profile_id === 'bob' ? BOB_CONV : ALICE_CONV),
        })),
        operations: operations.map((row) => ({ ...row, profile_id: owner(row.profile_id) })),
      };
    },
  });
}

/** The read the client makes: `useProductionResource('luna.conversations',{current:true})`. */
const read = (h, who, { env = ON, url = `${ROUTE}?current=true` } = {}) =>
  h.call(ROUTE, 'GET', { as: who, url, env });

/**
 * The clear the client makes, headers included (`ProductionLunaClear.ts:16,19`):
 * body `{id, revision}`, `Idempotency-Key: <uuid>`, `If-Match: <revision>`.
 */
const clearAs = (
  h,
  who,
  { id = ALICE_CONV, revision = 4, operationId = OP, env = ON, headers = {}, body, as = who } = {},
) =>
  h.call(CLEAR, 'POST', {
    as,
    body: body ?? { id, revision },
    env,
    headers: { 'idempotency-key': operationId, 'if-match': String(revision), ...headers },
  });

// ---------------------------------------------------------------------------
// The client's validators, transcribed (B03 digest section 2)
// ---------------------------------------------------------------------------

/** `object()` (luna-service.ts:12), verbatim. */
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** `text()` (luna-service.ts:13), verbatim. Tab, LF and CR are permitted. */
const text = (value, max = 16000) =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

/** `sourceInstant()` (luna-service.ts:14): a full instant with an explicit zone. */
const sourceInstant = (value) =>
  text(value, 100) &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** `safeSourceUrl()` (explore-service.ts:11), verbatim. */
function safeSourceUrl(value) {
  if (!text(value, 3000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** The six tabs `validLunaNavigation` allows (luna-service.ts:19). */
const TABS = ['today', 'home', 'act', 'plan', 'settings', 'map'];

/** `validLunaEvidence` (luna-service.ts:16-18), clause by clause. */
function assertLunaEvidence(value, sourceCount, label) {
  assert.ok(Array.isArray(value), `${label}: evidence is an array`);
  assert.ok(value.length > 0 && value.length <= 20, `${label}: evidence is 1 to 20 blocks, got ${value.length}`);
  for (const block of value) {
    assert.ok(object(block), `${label}: an evidence block is a plain object`);
    assert.ok(['fact', 'interpretation', 'next-step'].includes(String(block.kind)), `${label}: block kind ${block.kind}`);
    assert.ok(text(block.text, 3000), `${label}: block text is at most 3000 control-free characters`);
    assert.ok(block.text.trim(), `${label}: a block's text is not blank`);
    assert.ok(Array.isArray(block.sourceIndexes) && block.sourceIndexes.length <= 30, `${label}: sourceIndexes`);
    assert.equal(
      new Set(block.sourceIndexes).size,
      block.sourceIndexes.length,
      `${label}: sourceIndexes carries no duplicate`,
    );
    for (const index of block.sourceIndexes) {
      assert.ok(
        Number.isInteger(index) && index >= 0 && index < sourceCount,
        `${label}: source index ${index} must point at one of this message's own ${sourceCount} sources`,
      );
    }
    if (block.kind === 'fact') assert.ok(block.sourceIndexes.length > 0, `${label}: a fact block cites a source`);
    if (block.scope !== undefined) assert.ok(text(block.scope, 500), `${label}: scope`);
    if (block.observedAt !== undefined) assert.ok(sourceInstant(block.observedAt), `${label}: observedAt`);
  }
}

/** `validLunaNavigation` (luna-service.ts:19), clause by clause. */
function assertLunaNavigation(link, label) {
  assert.ok(object(link), `${label}: a link is a plain object`);
  assert.ok(text(link.label, 160), `${label}: link label is at most 160 characters`);
  assert.ok(TABS.includes(String(link.tab)), `${label}: link tab ${link.tab}`);
  if (link.record !== undefined) {
    assert.ok(text(link.record, 200) && /^[A-Za-z0-9:_-]+$/.test(link.record), `${label}: link record`);
  }
  if (link.view !== undefined) assert.ok(['list', 'detail', 'new', 'edit'].includes(String(link.view)), `${label}: view`);
}

/**
 * `validLunaConversation` (luna-service.ts:21-27), clause by clause, so a test
 * that cares about one field still fails when another breaks the contract.
 */
function assertLunaConversation(body, label = 'conversation') {
  assert.ok(object(body), `${label}: the payload is a plain object, not an array or a scalar`);
  assert.ok(text(body.id, 200) && body.id, `${label}: a non-empty id of at most 200 characters`);
  assert.ok(
    Number.isInteger(body.revision) && Number(body.revision) > 0,
    `${label}: revision is an integer strictly greater than 0, got ${body.revision}`,
  );
  assert.ok(Array.isArray(body.messages), `${label}: messages is an array`);
  assert.ok(body.messages.length <= 500, `${label}: at most 500 messages, got ${body.messages.length}`);
  assert.equal(
    new Set(body.messages.map((message) => (object(message) ? message.id : null))).size,
    body.messages.length,
    `${label}: every message id is distinct`,
  );

  for (const message of body.messages) {
    assert.ok(object(message), `${label}: a message is a plain object`);
    assert.ok(text(message.id, 200) && message.id, `${label}: a non-empty message id of at most 200 characters`);
    assert.ok(['user', 'assistant'].includes(String(message.role)), `${label}: message role ${message.role}`);
    assert.ok(text(message.text), `${label}: message text is at most 16000 control-free characters`);
    if (message.sources !== undefined) {
      assert.ok(Array.isArray(message.sources), `${label}: sources is an array when present`);
      assert.ok(message.sources.length <= 30, `${label}: at most 30 sources`);
      for (const source of message.sources) {
        assert.ok(object(source) && text(source.title, 500), `${label}: a source title of at most 500 characters`);
        assert.ok(safeSourceUrl(source.url), `${label}: ${source.url} must be https with no credentials`);
      }
    }
    if (message.evidence !== undefined) {
      assert.equal(message.role, 'assistant', `${label}: only an assistant message may carry evidence`);
      assertLunaEvidence(message.evidence, Array.isArray(message.sources) ? message.sources.length : 0, label);
    }
    if (message.links !== undefined) {
      assert.ok(Array.isArray(message.links) && message.links.length <= 20, `${label}: at most 20 links`);
      for (const link of message.links) assertLunaNavigation(link, label);
    }
    if (message.choices !== undefined) {
      assert.ok(Array.isArray(message.choices) && message.choices.length <= 20, `${label}: at most 20 choices`);
      for (const choice of message.choices) assert.ok(text(choice, 1000), `${label}: a choice`);
    }
    // Ruling L7: this package answers and never proposes, so a proposal here
    // would be an action surface nobody built.
    assert.equal(message.proposal, undefined, `${label}: this package emits no proposal`);
  }

  if (body.pendingRequest !== undefined && body.pendingRequest !== null) {
    const pending = body.pendingRequest;
    assert.ok(object(pending), `${label}: pendingRequest is a plain object when present`);
    assert.ok(text(pending.id, 200) && pending.id, `${label}: pendingRequest.id is non-empty, at most 200`);
    assert.ok(text(pending.text, 1000), `${label}: pendingRequest.text is at most 1000 characters`);
    if (pending.runId !== undefined) assert.ok(text(pending.runId, 200), `${label}: pendingRequest.runId`);
  }
  if (body.unresolvedOperations !== undefined) {
    assert.ok(object(body.unresolvedOperations), `${label}: unresolvedOperations is a plain object`);
    const entries = Object.entries(body.unresolvedOperations);
    assert.ok(entries.length <= 100, `${label}: at most 100 unresolved operations`);
    for (const [key, id] of entries) {
      assert.ok(key && key.length <= 200, `${label}: an unresolvedOperations key`);
      assert.ok(text(id, 200) && id, `${label}: an unresolvedOperations value`);
    }
  }
}

/**
 * `ProductionLunaClear.ts:19`, the check that decides whether clearing appears
 * to work: the receipt must validate, carry no messages, and come back with
 * either a NEW id or a STRICTLY GREATER revision than the one the client held.
 */
function assertClearReceipt(body, held) {
  assertLunaConversation(body, 'clear receipt');
  assert.equal(body.messages.length, 0, 'a cleared conversation comes back with no messages');
  assert.ok(
    body.id !== held.id || body.revision > held.revision,
    `clear receipt: a new id or a strictly greater revision is required, got id ${body.id} (held ${held.id}) `
      + `and revision ${body.revision} (held ${held.revision}); the client discards anything else as an invalid receipt`,
  );
}

/** No app-facing em dash anywhere in a response a person can read. */
const assertNoEmDash = (value, label) =>
  assert.ok(!JSON.stringify(value).includes('—'), `${label}: app-facing copy uses no em dash`);

/** Only the Luna tables: the ledger settles by its own primary key (see routesAccountCommands). */
const lunaQueries = (h) => h.db.queryLog.filter((entry) => entry.table.startsWith('luna_'));

// ---------------------------------------------------------------------------
// GET /api/luna/conversations
// ---------------------------------------------------------------------------

test('a household that has never asked anything gets an empty conversation, not an error', async () => {
  const h = harness({ aliceConversation: false });
  const response = await read(h, 'alice');
  assert.equal(response.status, 200);
  const body = await response.json();
  assertLunaConversation(body);
  assert.deepEqual(body.messages, [], 'nothing has been said yet');
  assert.equal(body.pendingRequest, null, 'and nothing is in flight');
  assert.deepEqual(body.unresolvedOperations, {}, 'there are no proposals in this package, but the key is read on reload');
  assert.ok(body.revision >= 1, 'the client rejects a revision of 0');
  assertNoEmDash(body, 'the empty conversation');
  // The cold path writes, so it is audited too: the conversation that was
  // started belongs to the caller, and every statement on the way there was
  // narrowed to them.
  auditOwnerScope(lunaQueries(h), h.identities.alice.id, 'GET /api/luna/conversations (first time)');
  assert.deepEqual(
    h.db.rows('luna_conversations').filter((row) => row.profile_id === h.identities.alice.id).map((row) => row.id),
    [body.id],
    'exactly one conversation was started, and it is the caller\'s own',
  );
});

test('an existing conversation comes back in the contract shape with its turns in order', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  assertLunaConversation(body);
  assert.equal(body.id, ALICE_CONV);
  assert.equal(body.revision, 4);
  assert.deepEqual(
    body.messages.map((message) => [message.id, message.role, message.text]),
    ALICE_TURNS.map((turn) => [turn.id, turn.role, turn.body]),
    'array order is the contract: the client renders messages as they arrive, oldest first',
  );
  const answer = body.messages[1];
  assert.deepEqual(answer.sources, [SOURCE], 'the answer carries the sources it rests on');
  assert.equal(answer.evidence.length, 1);
  assert.equal(body.messages[0].sources, undefined, 'a question carries no sources');
  assert.equal(body.messages[0].evidence, undefined, 'and no evidence, which would sink the whole payload');
  assertNoEmDash(body, 'the conversation');
});

test('a run still working comes back as pendingRequest, so a reload can park it again', async () => {
  const h = harness({
    runs: [
      {
        id: RUN,
        profile_id: 'alice',
        turn_id: turnId(3),
        client_message_id: CLIENT_MSG,
        status: 'generating',
        created_at: ago(2_000),
      },
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assertLunaConversation(body);
  assert.deepEqual(body.pendingRequest, {
    id: CLIENT_MSG,
    text: 'ALICE-FOLLOW-UP-MARKER how do I test for it?',
    runId: RUN,
  });
});

test('a run nothing finished is not pending: a dead request must not look like work in progress', async () => {
  const h = harness({
    runs: [
      {
        id: RUN,
        profile_id: 'alice',
        turn_id: turnId(3),
        client_message_id: CLIENT_MSG,
        status: 'generating',
        created_at: ago(10 * 60 * 1000),
      },
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assert.equal(body.pendingRequest, null);
});

test("another household's conversation is never readable, and every statement is scoped to the caller", async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  const serialized = JSON.stringify(body);
  for (const marker of ['BOB-QUESTION-MARKER', 'BOB-ANSWER-MARKER', BOB_CONV, turnId(8), turnId(9)]) {
    assert.ok(!serialized.includes(marker), `alice's conversation must not carry ${marker}`);
  }
  auditOwnerScope(lunaQueries(h), h.identities.alice.id, 'GET /api/luna/conversations');

  const bobs = await (await read(h, 'bob')).json();
  assertLunaConversation(bobs, "bob's conversation");
  assert.equal(bobs.id, BOB_CONV, 'bob still reads his own');
  assert.deepEqual(bobs.messages.map((message) => message.text), BOB_TURNS.map((turn) => turn.body));
});

test('identity comes only from the token: no query parameter can name another household', async () => {
  const h = harness();
  const bob = h.identities.bob.id;
  const smuggled = await read(h, 'alice', {
    url: `${ROUTE}?current=true&profileId=${bob}&profile_id=${bob}&id=${BOB_CONV}&conversationId=${BOB_CONV}`,
  });
  assert.equal(smuggled.status, 200);
  const body = await smuggled.json();
  assert.equal(body.id, ALICE_CONV, "a query naming bob answers with alice's own conversation");
  assert.ok(!JSON.stringify(body).includes('BOB-QUESTION-MARKER'));
});

test('a read with no session is refused before anything is looked at', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', { url: `${ROUTE}?current=true`, env: ON });
  await expectEnvelope(response, { status: 401, code: 'auth_required' });
  assert.equal(lunaQueries(h).length, 0, 'an unauthenticated read touches no Luna table');
});

test('while the capability is off the read is refused and no table is touched', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', { as: 'alice', url: `${ROUTE}?current=true` });
  const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!('messages' in body), 'a disabled capability must not answer with a conversation');
  assertNoEmDash(body, 'the refusal');
  assert.equal(lunaQueries(h).length, 0, 'nothing is read while the capability is off');
  assert.equal(h.db.rows('luna_conversations').length, 2, 'and nothing is written');
});

test('without migration 0020 the read reports the feature unavailable, never a false empty conversation', async (t) => {
  muteConsoleError(t);
  for (const missing of ['luna_conversations', 'luna_turns', 'luna_runs']) {
    const tables = Object.fromEntries(Object.entries(TABLES).filter(([name]) => name !== missing));
    const h = createRouteHarness({ tables, seed: ({ alice }) => ({ profiles: [{ id: alice.id }] }) });
    const response = await read(h, 'alice');
    const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
    assert.ok(!('messages' in body), `with ${missing} absent the route must not answer with a conversation`);
    assert.ok(!('id' in body), 'and must not hand out a conversation id it cannot support');
    if (missing !== 'luna_conversations') {
      assert.equal(h.db.rows('luna_conversations').length, 0, `a partial schema (${missing} absent) starts no conversation`);
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/luna/conversations/clear: the receipt the client will accept
// ---------------------------------------------------------------------------

test('clearing returns no messages and a strictly greater revision, which is what the client requires', async () => {
  const h = harness();
  const held = { id: ALICE_CONV, revision: 4 };
  const response = await clearAs(h, 'alice', held);
  assert.equal(response.status, 200);
  const body = await response.json();
  assertClearReceipt(body, held);
  assert.equal(body.id, ALICE_CONV, 'the id is kept: the client ignores a conversation whose id changed under it');
  assert.equal(body.revision, 5);
  assert.equal(body.pendingRequest, null);
  assert.deepEqual(body.unresolvedOperations, {});
  assertNoEmDash(body, 'the clear receipt');

  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, 0,
    'the text somebody typed is gone, not hidden');
  const stored = h.db.rows('luna_conversations').find((row) => row.id === ALICE_CONV);
  assert.equal(stored.revision, 5, 'the stored revision moved too, so a later clear cannot replay a stale precondition');
});

test('a cleared conversation reads back empty, with the raised revision', async () => {
  const h = harness();
  await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 });
  const body = await (await read(h, 'alice')).json();
  assertLunaConversation(body);
  assert.deepEqual(body.messages, []);
  assert.equal(body.revision, 5);
  assert.equal(body.id, ALICE_CONV);
});

test('clearing leaves every unrelated record exactly as it was', async () => {
  const h = harness({
    runs: [
      {
        id: RUN,
        profile_id: 'bob',
        turn_id: turnId(8),
        client_message_id: CLIENT_MSG,
        status: 'generating',
        created_at: ago(2_000),
      },
    ],
  });
  const before = {
    bobConversation: h.db.rows('luna_conversations').find((row) => row.id === BOB_CONV),
    bobTurns: h.db.rows('luna_turns').filter((row) => row.conversation_id === BOB_CONV),
    bobRuns: h.db.rows('luna_runs').filter((row) => row.conversation_id === BOB_CONV),
    journal: h.db.rows('symptom_logs'),
    scores: h.db.rows('daily_scores'),
    profiles: h.db.rows('profiles'),
  };
  const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 });
  assert.equal(response.status, 200);

  assert.deepEqual(h.db.rows('luna_conversations').find((row) => row.id === BOB_CONV), before.bobConversation,
    "bob's conversation is untouched, revision included");
  assert.deepEqual(h.db.rows('luna_turns').filter((row) => row.conversation_id === BOB_CONV), before.bobTurns);
  assert.deepEqual(h.db.rows('luna_runs').filter((row) => row.conversation_id === BOB_CONV), before.bobRuns);
  assert.deepEqual(h.db.rows('symptom_logs'), before.journal, "this household's journal is not Luna's to delete");
  assert.deepEqual(h.db.rows('daily_scores'), before.scores);
  assert.deepEqual(h.db.rows('profiles'), before.profiles);
  auditOwnerScope(lunaQueries(h), h.identities.alice.id, 'POST /api/luna/conversations/clear');
});

test("clearing also removes this conversation's own runs, so nothing points at a question that is gone", async () => {
  const h = harness({
    runs: [
      {
        id: RUN,
        profile_id: 'alice',
        turn_id: turnId(3),
        client_message_id: CLIENT_MSG,
        status: 'completed',
        created_at: ago(60_000),
        settled_at: ago(50_000),
      },
    ],
  });
  const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 });
  assert.equal(response.status, 200);
  assert.equal(h.db.rows('luna_runs').length, 0);
});

// ---------------------------------------------------------------------------
// Idempotency: the operation ledger and nothing else
// ---------------------------------------------------------------------------

test('a replayed Idempotency-Key returns the first outcome and does not clear twice', async () => {
  const h = harness();
  const held = { id: ALICE_CONV, revision: 4 };
  const first = await (await clearAs(h, 'alice', held)).json();
  assertClearReceipt(first, held);

  const response = await clearAs(h, 'alice', held);
  assert.equal(response.status, 200);
  const replay = await response.json();
  assert.deepEqual(replay, first, 'a replay answers with the receipt the first attempt recorded');
  assertClearReceipt(replay, held);

  const stored = h.db.rows('luna_conversations').find((row) => row.id === ALICE_CONV);
  assert.equal(stored.revision, 5, 'the revision moved once, not twice');
  assert.equal(h.db.rows('operations').filter((row) => row.operation_id === OP).length, 1, 'one ledger row for one id');
  const ledger = h.db.rows('operations').find((row) => row.operation_id === OP);
  assert.deepEqual([ledger.domain, ledger.kind, ledger.status], ['luna', 'luna.clear', 'succeeded']);
  assert.equal(JSON.stringify(ledger.result).includes('ALICE-FOLLOW-UP-MARKER'), false,
    'the receipt is a receipt: no conversation text is copied into the ledger');
});

test('a second clear with a new id is a fresh operation, and raises the revision again', async () => {
  const h = harness();
  const first = await (await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 })).json();
  const held = { id: first.id, revision: first.revision };
  const second = await (await clearAs(h, 'alice', { ...held, operationId: OTHER_OP })).json();
  assertClearReceipt(second, held);
  assert.equal(second.revision, 6, 'clearing an already empty conversation still advances the revision');
});

test('the same operation id with different input is a conflict, never a wrong replay', async () => {
  const h = harness();
  await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 });
  const response = await clearAs(h, 'alice', { id: MISSING_CONV, revision: 4 });
  const body = await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(body.reason, 'operation_mismatch');
  assertNoEmDash(body, 'the mismatch refusal');
  assert.equal(h.db.rows('luna_conversations').find((row) => row.id === ALICE_CONV).revision, 5, 'nothing happened twice');
});

test('an attempt that never settled is reported as unconfirmed, and is not cleared a second time to find out', async () => {
  const hash = requestHash({ id: ALICE_CONV, revision: 4 });
  // A concurrent attempt still running, and one from a process that died
  // before it settled (past the ledger's staleness window, so a reader calls
  // it 'unknown'). Neither has a receipt, and neither may be guessed at.
  for (const createdAt of [ago(1_000), ago(10 * 60 * 1000)]) {
    const h = harness({
      operations: [
        {
          operation_id: OP,
          profile_id: 'alice',
          domain: 'luna',
          kind: 'luna.clear',
          status: 'pending',
          request_hash: hash,
          created_at: createdAt,
        },
      ],
    });
    const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 });
    const body = await expectEnvelope(response, { status: 503, code: 'upstream_unavailable' });
    assert.ok(!('messages' in body), 'an unconfirmed outcome must not be answered with a conversation');
    assertNoEmDash(body, 'the unconfirmed answer');
    assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length,
      'the transcript is untouched: the earlier attempt owns this operation');
    assert.equal(h.db.rows('luna_conversations').find((row) => row.id === ALICE_CONV).revision, 4);
  }
});

test('an Idempotency-Key is required, because a mutation with no ledger entry cannot be replayed safely', async () => {
  const h = harness();
  for (const headers of [{ 'idempotency-key': '' }, { 'idempotency-key': 'not-a-uuid' }]) {
    const response = await h.call(CLEAR, 'POST', {
      as: 'alice',
      body: { id: ALICE_CONV, revision: 4 },
      env: ON,
      headers: { 'if-match': '4', ...headers },
    });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
    assert.deepEqual(body.field_errors.map((entry) => entry.field), ['Idempotency-Key']);
    assertNoEmDash(body, 'the missing key refusal');
  }
  assert.ok(h.db.rows('luna_turns').some((row) => row.conversation_id === ALICE_CONV), 'nothing was deleted');
  assert.equal(h.db.rows('operations').length, 0, 'and no ledger row was claimed');
});

// ---------------------------------------------------------------------------
// The If-Match precondition
// ---------------------------------------------------------------------------

test('a stale revision is a conflict and the conversation is not cleared', async () => {
  const h = harness();
  const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 3 });
  const body = await expectEnvelope(response, {
    status: 409,
    code: 'conflict',
    retryable: false,
    extraKeys: ['reason', 'revision'],
  });
  assert.deepEqual([body.reason, body.revision], ['stale_revision', 4], 'the caller is told the revision to reload from');
  assertNoEmDash(body, 'the stale revision refusal');
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length);
  assert.equal(h.db.rows('luna_conversations').find((row) => row.id === ALICE_CONV).revision, 4);
});

test('a revision from the future is the same conflict as one from the past', async () => {
  const h = harness();
  const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 99 });
  const body = await expectEnvelope(response, {
    status: 409,
    code: 'conflict',
    retryable: false,
    extraKeys: ['reason', 'revision'],
  });
  assert.equal(body.reason, 'stale_revision');
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length);
});

test('the If-Match header and the body revision must be the same number', async () => {
  const h = harness();
  const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4, headers: { 'if-match': '3' } });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
  assert.deepEqual(body.field_errors.map((entry) => entry.field), ['revision']);
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length);
  assert.equal(h.db.rows('operations').length, 0, 'the id is not claimed for a request that was refused on its shape');
});

test('a run still working blocks the clear rather than stranding it, and nothing is deleted', async () => {
  const h = harness({
    runs: [
      {
        id: RUN,
        profile_id: 'alice',
        turn_id: turnId(3),
        client_message_id: CLIENT_MSG,
        status: 'generating',
        created_at: ago(2_000),
      },
    ],
  });
  const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 });
  const body = await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(body.reason, 'run_open');
  assertNoEmDash(body, 'the open run refusal');
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length);
  assert.equal(h.db.rows('luna_runs').length, 1);
});

// ---------------------------------------------------------------------------
// Identity, and another household's conversation
// ---------------------------------------------------------------------------

test("another household's conversation id is not reachable, and the answer says nothing about whose it is", async () => {
  const h = harness();
  const foreign = await clearAs(h, 'alice', { id: BOB_CONV, revision: 3 });
  const foreignBody = await expectEnvelope(foreign, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });

  const h2 = harness();
  const unknown = await clearAs(h2, 'alice', { id: MISSING_CONV, revision: 4 });
  const unknownBody = await expectEnvelope(unknown, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });

  assert.equal(foreign.status, unknown.status, 'the same status for a foreign id and one that never existed');
  assert.deepEqual(
    [foreignBody.code, foreignBody.message, foreignBody.reason],
    [unknownBody.code, unknownBody.message, unknownBody.reason],
    'and the same words, so the answer cannot be used to find out whether a conversation exists',
  );
  assert.ok(!JSON.stringify(foreignBody).includes(BOB_CONV), 'the refusal does not echo the id back');

  assert.deepEqual(
    h.db.rows('luna_turns').filter((row) => row.conversation_id === BOB_CONV).map((row) => row.id),
    BOB_TURNS.map((turn) => turn.id),
    "bob's turns are still there",
  );
  assert.equal(h.db.rows('luna_conversations').find((row) => row.id === BOB_CONV).revision, 3);
});

test('a body naming another profile is refused rather than quietly ignored', async () => {
  const h = harness();
  const response = await clearAs(h, 'alice', {
    body: { id: ALICE_CONV, revision: 4, profileId: h.identities.bob.id },
  });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
  assert.deepEqual(body.field_errors.map((entry) => entry.field), ['profileId']);
  assert.equal(body.field_errors[0].code, 'unknown_field');
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length);
});

test('a query naming another household changes nothing: identity is the token', async () => {
  const h = harness();
  const response = await h.call(CLEAR, 'POST', {
    as: 'alice',
    url: `${CLEAR}?profileId=${h.identities.bob.id}&id=${BOB_CONV}`,
    body: { id: ALICE_CONV, revision: 4 },
    env: ON,
    headers: { 'idempotency-key': OP, 'if-match': '4' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assertClearReceipt(body, { id: ALICE_CONV, revision: 4 });
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === BOB_CONV).length, BOB_TURNS.length);
});

test('a clear with no session is refused before anything is read or written', async () => {
  const h = harness();
  const response = await h.call(CLEAR, 'POST', {
    body: { id: ALICE_CONV, revision: 4 },
    env: ON,
    headers: { 'idempotency-key': OP, 'if-match': '4' },
  });
  await expectEnvelope(response, { status: 401, code: 'auth_required' });
  assert.equal(lunaQueries(h).length, 0);
  assert.equal(h.db.rows('operations').length, 0);
});

// ---------------------------------------------------------------------------
// Validation, the flag, and the schema
// ---------------------------------------------------------------------------

test('the body is exactly the two fields the client sends, and each is checked here', async () => {
  // `revision: "4"` is NOT in this table: the shared parser accepts an integer
  // string as well as a number, and that leniency carries no risk here because
  // the number still has to equal the revision actually stored.
  const h = harness();
  const cases = [
    [{ revision: 4 }, 'id'],
    [{ id: 'conversation1', revision: 4 }, 'id'],
    [{ id: ALICE_CONV }, 'revision'],
    [{ id: ALICE_CONV, revision: 0 }, 'revision'],
    [{ id: ALICE_CONV, revision: -1 }, 'revision'],
    [{ id: ALICE_CONV, revision: 1.5 }, 'revision'],
  ];
  for (const [body, field] of cases) {
    const response = await clearAs(h, 'alice', { body, headers: { 'if-match': String(body.revision) } });
    const envelope = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
    assert.deepEqual(envelope.field_errors.map((entry) => entry.field), [field], JSON.stringify(body));
  }
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length);
  assert.equal(h.db.rows('operations').length, 0);
});

test('while the capability is off the clear is refused, and nothing is read or written', async () => {
  const h = harness();
  const response = await h.call(CLEAR, 'POST', {
    as: 'alice',
    body: { id: ALICE_CONV, revision: 4 },
    headers: { 'idempotency-key': OP, 'if-match': '4' },
  });
  const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!('messages' in body), 'a disabled capability must not answer with a conversation');
  assertNoEmDash(body, 'the refusal');
  assert.equal(lunaQueries(h).length, 0, 'no Luna table is read');
  assert.equal(h.db.rows('operations').length, 0, 'and no operation is recorded');
  assert.equal(h.db.rows('luna_turns').filter((row) => row.conversation_id === ALICE_CONV).length, ALICE_TURNS.length);
});

test('without migration 0020 the clear is unavailable, and it says so before anything is changed', async (t) => {
  muteConsoleError(t);
  for (const missing of ['luna_conversations', 'luna_turns', 'luna_runs']) {
    const tables = Object.fromEntries(Object.entries(TABLES).filter(([name]) => name !== missing));
    const h = createRouteHarness({
      tables,
      seed: ({ alice }) => ({
        profiles: [{ id: alice.id }],
        ...(missing === 'luna_conversations'
          ? {}
          : { luna_conversations: [{ id: ALICE_CONV, profile_id: alice.id, revision: 4 }] }),
        ...(missing === 'luna_turns'
          ? {}
          : {
              luna_turns: ALICE_TURNS.map((turn) => ({ ...turn, conversation_id: ALICE_CONV, profile_id: alice.id })),
            }),
      }),
    });
    const response = await clearAs(h, 'alice', { id: ALICE_CONV, revision: 4 });
    const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
    assert.ok(!('messages' in body), `with ${missing} absent the route must not answer with a conversation`);
    assert.equal(h.db.rows('operations').length, 0, `with ${missing} absent no operation id is claimed`);
    if (missing !== 'luna_turns') {
      assert.equal(h.db.rows('luna_turns').length, ALICE_TURNS.length, '"nothing was changed" has to be true');
    }
  }
});
