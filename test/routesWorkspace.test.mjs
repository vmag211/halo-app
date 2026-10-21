/**
 * GET /api/frontend/workspace and POST /api/frontend/workspace/commands on the
 * in-memory harness (B11 plan): the order of checks, the 400s, the flag, the
 * missing-migration answers, the home-context header, and the `workspace`
 * overlay in GET /api/operations. The full end-to-end flows on the real 0026
 * functions, with the client's own runtime and adapter, are in
 * routesWorkspaceDb.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';

const { REFUSALS, UNSTORED_COLLECTIONS, INCOMPLETE_MESSAGE, IN_FLIGHT_MESSAGE } = await import('../lib/workspaceStore.js');

const LOAD = '/api/frontend/workspace';
const COMMANDS = '/api/frontend/workspace/commands';
const OPERATIONS = '/api/operations';
const ON = { HALO_FEATURE_WORKSPACE: 'on' };
const ALICE = '00000000-0000-4000-8000-000000000001';
const FOREIGN_HOME = '11111111-1111-4111-8111-111111111111';
const MARKER = 'PRIVATE-ROUTE-MARKER';
const EM_DASH = String.fromCharCode(0x2014);

/** A harness whose read function answers from `stored` ({collection: rows}), scoped to the id it is given. */
function harness({ env = ON, stored = {}, rpcs = true, ledger = true, operations = [] } = {}) {
  const tables = ledger ? haloTables('profiles', 'operations') : haloTables('profiles');
  const h = createRouteHarness({ tables, env, seed: (ids) => ({ profiles: [{ id: ids.alice.id }, { id: ids.bob.id }], ...(ledger ? { operations } : {}) }) });
  if (rpcs) {
    h.db.registerRpc('read_household_workspace', ({ p_profile_id, p_collections }) => {
      if (p_profile_id !== ALICE) return Object.fromEntries(p_collections.map((name) => [name, []]));
      return Object.fromEntries(p_collections.map((name) => [name, stored[name] ?? []]));
    }, { args: ['p_profile_id', 'p_collections'] });
    h.db.registerRpc('commit_household_workspace', () => { throw rpcError('XX000', 'boom', `Failing row contains (${MARKER})`, MARKER); }, { args: ['p_profile_id', 'p_operation_id', 'p_writes'] });
  }
  const send = (body, { key = body?.operationId, headers = {}, as = 'alice', raw } = {}) => h.call(COMMANDS, 'POST', {
    as, rawBody: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...headers },
  });
  return { h, send };
}
const op = () => crypto.randomUUID();
const write = (over = {}) => ({ operationId: op(), kind: 'write', collection: 'foodQuestions', record: { id: 'q1', title: 'Q', revision: 0, evidenceId: 'e', question: MARKER, reportId: '', note: '' }, expectedRevision: null, ...over });

test('no session is a 401 on every route, before anything is read', async () => {
  const { h } = harness();
  assert.equal((await h.call(LOAD, 'GET', { url: `${LOAD}?collection=tests` })).status, 401);
  assert.equal((await h.call(COMMANDS, 'POST', { body: write() })).status, 401);
  assert.equal(h.db.rpcCalls.length, 0);
});

test('load: a missing or unknown collection is a 400 naming the field', async () => {
  const { h } = harness();
  for (const url of [LOAD, `${LOAD}?collection=nope`, `${LOAD}?collection=TESTS`]) {
    const body = await expectEnvelope(await h.call(LOAD, 'GET', { as: 'alice', url }), { status: 400, code: 'validation_failed' });
    assert.equal(body.field_errors[0].field, 'collection');
  }
});

test('load: flag off is the non-retryable 503 with nothing read, reaped or called', async () => {
  const { h } = harness({ env: {} });
  await expectEnvelope(await h.call(LOAD, 'GET', { as: 'alice', url: `${LOAD}?collection=tests` }), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(h.db.rpcCalls.length, 0);
  assert.equal(h.db.queryLog.length, 0);
});

test('load: before 0026 (no function) or 0017 (no ledger) the answer is feature_unavailable, never an empty list', async () => {
  for (const options of [{ rpcs: false }, { ledger: false }]) {
    const { h } = harness(options);
    await expectEnvelope(await h.call(LOAD, 'GET', { as: 'alice', url: `${LOAD}?collection=tests` }), { status: 503, code: 'feature_unavailable', retryable: false });
  }
});

test('load: the shape the adapter takes, the pending list scoped to the caller, the home header ignored', async () => {
  const pending = { operation_id: op(), profile_id: ALICE, domain: 'workspace', kind: 'workspace.write', status: 'pending', request_hash: 'x', created_at: new Date().toISOString() };
  const bobs = { ...pending, operation_id: op(), profile_id: '00000000-0000-4000-8000-000000000002' };
  const other = { ...pending, operation_id: op(), domain: 'actions' };
  const rows = [{ id: 'q1', title: 'Q', revision: 3, evidenceId: 'e', question: 'x', reportId: '', note: '' }];
  const { h } = harness({ stored: { foodQuestions: rows }, operations: [pending, bobs, other] });
  const res = await h.call(LOAD, 'GET', { as: 'alice', url: `${LOAD}?collection=foodQuestions`, headers: { 'x-halo-home-context': FOREIGN_HOME } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { records: rows, availability: 'ready', complete: true, pendingOperations: [{ operationId: pending.operation_id, domain: 'workspace' }] });
  assert.deepEqual(h.db.rpcCalls.map((call) => call.args.p_profile_id), [ALICE]);
});

test('load: the journal and home history are unavailable with their sentence and the pending list', async () => {
  const { h } = harness();
  for (const [collection, copy] of Object.entries(UNSTORED_COLLECTIONS)) {
    const body = await (await h.call(LOAD, 'GET', { as: 'alice', url: `${LOAD}?collection=${collection}` })).json();
    assert.deepEqual(body, { records: [], availability: 'unavailable', complete: false, message: copy.load, pendingOperations: [] });
    assert.ok(!copy.load.includes(EM_DASH) && !copy.write.includes(EM_DASH));
  }
  assert.equal(h.db.rpcCalls.length, 0, 'nothing of 0026 is read for them');
});

test('commands: the operation id, Idempotency-Key and If-Match are checked before anything is read', async () => {
  const { h, send } = harness();
  const cases = [
    [write({ operationId: 'not-a-uuid' }), {}],
    [write(), { key: null }],
    [write(), { key: op() }],
    [write({ expectedRevision: 2, record: { ...write().record, revision: 2 } }), { headers: { 'if-match': '3' } }],
    [write(), { headers: { 'if-match': '1' } }],
    [{ operationId: op(), kind: 'remove-notes', selection: [{ id: 'n', revision: 1 }] }, { headers: { 'if-match': '1' } }],
  ];
  for (const [command, options] of cases) {
    const key = Object.hasOwn(options, 'key') ? options.key : command.operationId;
    await expectEnvelope(await send(command, { ...options, key }), { status: 400, code: 'validation_failed' });
  }
  assert.equal(h.db.rpcCalls.length, 0);
  assert.equal(h.db.rows('operations').length, 0);
});

test('commands: a malformed command is a 400 naming its field, recorded nowhere', async () => {
  const { h, send } = harness();
  const bad = [
    [{ kind: 'rename' }, 'kind'],
    [{ collection: 'nope' }, 'collection'],
    [{ record: 'x' }, 'record'],
    [{ record: { title: 'no id' } }, 'record.id'],
    [{ record: { id: 'x'.repeat(201), title: 't' } }, 'record.id'],
    [{ expectedRevision: 0 }, 'expectedRevision'],
    [{ kind: 'remove', recordId: '', expectedRevision: 1 }, 'recordId'],
    [{ kind: 'remove', recordId: 'q1', expectedRevision: null }, 'expectedRevision'],
    [{ kind: 'remove-notes', selection: [] }, 'selection'],
    [{ kind: 'remove-notes', selection: [{ id: 'n', revision: 1 }, { id: 'n', revision: 1 }] }, 'selection'],
    [{ collectionRevision: {} }, 'collectionRevision'],
  ];
  for (const [over, field] of bad) {
    const body = await expectEnvelope(await send(write(over)), { status: 400, code: 'validation_failed' });
    assert.equal(body.field_errors[0].field, field, JSON.stringify(over));
  }
  await expectEnvelope(await send(null, { raw: '{', key: op() }), { status: 400, code: 'bad_request' });
  const huge = write({ record: { ...write().record, note: 'x'.repeat(1_000_001) } });
  await expectEnvelope(await send(huge), { status: 413, code: 'payload_too_large' });
  assert.equal(h.db.rows('operations').length, 0);
});

test('commands: flag off is a 200 failed receipt with changes, nothing read or claimed', async () => {
  const { h, send } = harness({ env: {} });
  const command = write();
  const body = await (await send(command)).json();
  assert.deepEqual(body, { operationId: command.operationId, status: 'failed', changes: {}, code: 'unavailable', message: 'Saving Homeguard records is not available yet. Nothing was saved.' });
  assert.equal(h.db.rpcCalls.length, 0);
  assert.equal(h.db.queryLog.length, 0);
});

test('commands: clear-private and the unstored collections are refused before any claim, with changes', async () => {
  const { h, send } = harness();
  const clear = { operationId: op(), kind: 'clear-private', scope: 'all', expectedFingerprint: 'x' };
  assert.deepEqual(await (await send(clear)).json(), { operationId: clear.operationId, status: 'failed', changes: {}, code: 'unavailable', reason: 'clear_unsupported', message: REFUSALS.clear_unsupported.message });
  for (const collection of Object.keys(UNSTORED_COLLECTIONS)) {
    const body = await (await send(write({ collection }))).json();
    assert.deepEqual([body.status, body.code, body.changes], ['failed', 'unavailable', {}]);
  }
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rpcCalls.length, 0);
});

test('commands: before 0026 the answer is feature_unavailable with no claim', async () => {
  const { h, send } = harness({ rpcs: false });
  await expectEnvelope(await send(write()), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(h.db.rows('operations').length, 0);
});

test('commands: a commit that fails in the database is a 500 whose log carries no record, detail or hint', async (t) => {
  const logged = muteConsoleError(t);
  const { h, send } = harness();
  const command = write();
  await expectEnvelope(await send(command), { status: 500, code: 'internal_error' });
  const text = loggedText(logged);
  assert.ok(text.includes('workspace commit failed'));
  assert.ok(!text.includes(MARKER), 'no record content, detail or hint in the log');
  // runOperation settled the claim failed, with no receipt: a replay is the terminal 409.
  assert.equal(h.db.rows('operations')[0].status, 'failed');
  const replay = await expectEnvelope(await send(command), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(replay.reason, 'not_applied');
});

test('operations: a workspace reconcile carries changes for every status, and the sentence of a failed one', async () => {
  const base = { profile_id: ALICE, domain: 'workspace', kind: 'workspace.write', request_hash: 'x' };
  const ids = { pending: op(), reaped: op(), refused: op(), succeeded: op() };
  const now = new Date().toISOString();
  const { h } = harness({
    stored: { tests: [{ id: 't1', title: 'T', revision: 2 }] },
    operations: [
      { ...base, operation_id: ids.pending, status: 'pending', result: null, created_at: now },
      { ...base, operation_id: ids.reaped, status: 'failed', result: { status: 'failed', reason: 'abandoned' }, created_at: now },
      { ...base, operation_id: ids.refused, status: 'failed', result: { status: 'failed', reason: 'stale_revision', unresolvedOperations: [] }, created_at: now },
      { ...base, operation_id: ids.succeeded, status: 'succeeded', result: { status: 'succeeded', collections: ['tests'], affected: [{ collection: 'tests', id: 't1', revision: 2 }], removed: [], unresolvedOperations: [] }, created_at: now },
    ],
  });
  const read = async (id, env) => (await h.call(OPERATIONS, 'GET', { as: 'alice', url: `${OPERATIONS}?operationId=${id}&domain=workspace`, env })).json();
  const pending = await read(ids.pending);
  assert.deepEqual([pending.status, pending.changes, pending.message], ['pending', {}, IN_FLIGHT_MESSAGE]);
  const reaped = await read(ids.reaped);
  assert.deepEqual([reaped.status, reaped.changes, reaped.message], ['failed', {}, INCOMPLETE_MESSAGE]);
  const refused = await read(ids.refused);
  assert.deepEqual([refused.status, refused.changes, refused.code, refused.message], ['failed', {}, 'conflict', REFUSALS.stale_revision.message]);
  const succeeded = await read(ids.succeeded);
  assert.deepEqual([succeeded.status, succeeded.changes], ['succeeded', { tests: [{ id: 't1', title: 'T', revision: 2 }] }]);
  // Behind the flag like the rest of the workspace.
  const off = await h.call(OPERATIONS, 'GET', { as: 'alice', url: `${OPERATIONS}?operationId=${ids.succeeded}&domain=workspace`, env: { HALO_FEATURE_WORKSPACE: '' } });
  assert.equal(off.status, 503);
  // Another household's id is the identical 404.
  assert.equal((await h.call(OPERATIONS, 'GET', { as: 'bob', url: `${OPERATIONS}?operationId=${ids.succeeded}&domain=workspace` })).status, 404);
});

test('every server-authored workspace sentence is free of em dashes', () => {
  for (const { message } of Object.values(REFUSALS)) assert.ok(!message.includes(EM_DASH), message);
  for (const message of [INCOMPLETE_MESSAGE, IN_FLIGHT_MESSAGE]) assert.ok(!message.includes(EM_DASH));
});
