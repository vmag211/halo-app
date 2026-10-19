/**
 * GET /api/operations (migration 0017): what actually happened to a mutation
 * whose response the caller lost.
 *
 * The ledger primitive itself is covered in operationsLedger.test.mjs. This
 * file is about the route: who may read an outcome, what a stranger's id looks
 * like, and the difference between "never recorded", "failed" and "unknown",
 * which the frontend treats as three different things.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const ROUTE = '/api/operations';
const OP = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const DEAD = '55555555-5555-4555-8555-555555555555';
const RECOVERY = '66666666-6666-4666-8666-666666666666';
const RECORDED = '77777777-7777-4777-8777-777777777777';

const ago = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * alice has a settled save, a failed one and a crashed one; bob has his own
 * settled save. `extra` rows are alice's.
 */
function harness({ extra = [] } = {}) {
  return createRouteHarness({
    tables: haloTables('profiles', 'operations'),
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id }, { id: bob.id }],
      operations: [
        {
          operation_id: OP,
          profile_id: alice.id,
          domain: 'settings',
          kind: 'settings.save',
          status: 'succeeded',
          request_hash: 'hash-a',
          result: { operationId: OP, status: 'succeeded', snapshot: { revision: 4 } },
          created_at: ago(1000),
        },
        {
          operation_id: OTHER,
          profile_id: bob.id,
          domain: 'settings',
          kind: 'settings.save',
          status: 'succeeded',
          request_hash: 'hash-b',
          result: { operationId: OTHER, status: 'succeeded', snapshot: { revision: 9 } },
          created_at: ago(1000),
        },
        {
          operation_id: DEAD,
          profile_id: alice.id,
          domain: 'alerts',
          kind: 'alerts.update',
          status: 'pending',
          request_hash: 'hash-c',
          result: null,
          created_at: ago(10 * 60 * 1000), // long past the staleness window
        },
        {
          operation_id: RECOVERY,
          profile_id: null,
          domain: 'recovery',
          kind: 'recovery.request',
          status: 'succeeded',
          request_hash: 'hash-d',
          result: { operationId: RECOVERY, status: 'succeeded' },
          created_at: ago(1000),
        },
        ...extra.map((row) => ({ ...row, profile_id: alice.id })),
      ],
    }),
  });
}

const read = (h, who, query) => h.call(ROUTE, 'GET', { as: who, url: `${ROUTE}?${query}` });

// ---------------------------------------------------------------------------
// Replaying an outcome
// ---------------------------------------------------------------------------

test('a settled operation replays the original receipt, so the client can finish what it started', async () => {
  const h = harness();
  const response = await read(h, 'alice', `operationId=${OP}&domain=settings`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.operationId, OP);
  assert.equal(body.status, 'succeeded');
  assert.equal(body.domain, 'settings');
  assert.equal(body.kind, 'settings.save');
  assert.deepEqual(body.snapshot, { revision: 4 }, 'the domain payload comes through for its own validator');
});

test('a crashed operation is reaped by the reconcile itself and reads as failed, with a receipt the client accepts', async () => {
  // No inventory read happens first. A reconcile is often the only request a
  // client makes about a parked id, so it settles the stale claim itself
  // rather than answering 'unknown' for ever.
  const h = harness();
  const { ABANDONED_REASON } = await import('../lib/operations.js');
  const body = await (await read(h, 'alice', `operationId=${DEAD}&domain=alerts`)).json();
  assert.equal(body.status, 'failed', 'settled, so the client clears it instead of parking it again');
  assert.equal(body.operationId, DEAD, 'with its own id, which every receipt validator requires');
  assert.equal(body.reason, ABANDONED_REASON);
  assert.ok(['succeeded', 'pending', 'unknown', 'failed'].includes(body.status), 'a status validSummaryReceipt accepts');
  assert.ok(!('items' in body) && !('snapshot' in body), 'and no domain payload is invented for it');
  assert.equal(h.db.rows('operations').find((row) => row.operation_id === DEAD).status, 'failed', 'settled in the ledger');
});

test('once the inventory read has reaped a crashed operation, reconciling it reads the same failed receipt', async () => {
  const h = harness();
  const { listUnresolvedOperations, ABANDONED_REASON } = await import('../lib/operations.js');
  // What any surface's initial read does before it lists unresolved work.
  assert.deepEqual(await listUnresolvedOperations(h.db, { profileId: h.identities.alice.id, domains: ['alerts'] }), []);
  const body = await (await read(h, 'alice', `operationId=${DEAD}&domain=alerts`)).json();
  assert.equal(body.status, 'failed');
  assert.equal(body.operationId, DEAD);
  assert.equal(body.reason, ABANDONED_REASON);
});

test('a stored receipt cannot override the status computed now', async () => {
  // A row whose stored receipt disagrees with the row itself. Recovery stores
  // exactly this shape (the row settles 'succeeded' while the receipt it
  // recorded says 'pending', because the message is still on its way), and any
  // receipt frozen at write time can go stale the same way. The canonical
  // fields come from the row as it stands now, and the receipt only supplies
  // the domain payload. The stored receipt here also names another domain,
  // kind and time, so every canonical field is proved, not only the status.
  const h = harness({
    extra: [
      {
        operation_id: RECORDED,
        domain: 'settings',
        kind: 'settings.save',
        status: 'succeeded',
        request_hash: 'hash-e',
        result: {
          operationId: RECORDED,
          status: 'pending',
          domain: 'alerts',
          kind: 'alerts.update',
          created_at: '2000-01-01T00:00:00.000Z',
          snapshot: { revision: 7 },
        },
        created_at: ago(2000),
      },
    ],
  });
  const stored = h.db.rows('operations').find((row) => row.operation_id === RECORDED);
  const response = await read(h, 'alice', `operationId=${RECORDED}&domain=settings`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'succeeded', 'the status is the one the row has now, not the stale word in its receipt');
  assert.equal(body.domain, 'settings');
  assert.equal(body.kind, 'settings.save');
  assert.equal(body.created_at, stored.created_at);
  assert.equal(body.operationId, RECORDED);
  assert.deepEqual(body.snapshot, { revision: 7 }, 'while the domain payload still comes through');
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

test('another household\'s operation id is the identical 404, with nothing said about whose it is', async () => {
  const h = harness();
  const foreign = await read(h, 'alice', `operationId=${OTHER}&domain=settings`);
  const absent = await read(h, 'alice', `operationId=99999999-9999-4999-8999-999999999999&domain=settings`);
  assert.equal(foreign.status, 404);
  assert.equal(absent.status, 404);
  assert.deepEqual(
    { ...(await foreign.json()), request_id: null },
    { ...(await absent.json()), request_id: null },
    'a stranger\'s id and a nonexistent id are indistinguishable',
  );
});

test('the owner comes from the token, so bob reading his own id works and alice\'s does not', async () => {
  const h = harness();
  assert.equal((await read(h, 'bob', `operationId=${OTHER}&domain=settings`)).status, 200);
  assert.equal((await read(h, 'bob', `operationId=${OP}&domain=settings`)).status, 404);
});

test('an operation is scoped to its domain, so naming the wrong one is a 404', async () => {
  const h = harness();
  assert.equal((await read(h, 'alice', `operationId=${OP}&domain=alerts`)).status, 404);
  assert.equal((await read(h, 'alice', `operationId=${OP}&domain=settings`)).status, 200);
});

test('the unauthenticated recovery domain is not readable here, even by a signed-in caller', async () => {
  const h = harness();
  const response = await read(h, 'alice', `operationId=${RECOVERY}&domain=recovery`);
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['domain', 'invalid_option']]);
});

test('a request with no session is rejected before any lookup', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', { url: `${ROUTE}?operationId=${OP}&domain=settings` });
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

test('a missing or malformed operation id is a 400 naming the field, not a 404', async () => {
  const h = harness();
  for (const query of ['domain=settings', 'operationId=&domain=settings', 'operationId=not-a-uuid&domain=settings']) {
    const body = await expectEnvelope(await read(h, 'alice', query), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['operationId', 'invalid_uuid']], query);
  }
});

test('a missing or unknown domain is a 400 naming the field', async () => {
  const h = harness();
  for (const query of [`operationId=${OP}`, `operationId=${OP}&domain=`, `operationId=${OP}&domain=nope`]) {
    const body = await expectEnvelope(await read(h, 'alice', query), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['domain', 'invalid_option']], query);
  }
});

test('every response carries a request id header', async () => {
  const h = harness();
  for (const query of [`operationId=${OP}&domain=settings`, `operationId=${OTHER}&domain=settings`, 'domain=settings']) {
    assert.ok((await read(h, 'alice', query)).headers.get('x-request-id'), query);
  }
});

// ---------------------------------------------------------------------------
// Before the migration
// ---------------------------------------------------------------------------

test('without migration 0017 the route reports the feature unavailable, never a status it invented', async (t) => {
  muteConsoleError(t);
  const h = createRouteHarness({ tables: haloTables('profiles') }); // no operations table
  const response = await h.call(ROUTE, 'GET', { as: 'alice', url: `${ROUTE}?operationId=${OP}&domain=settings` });
  const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!('status' in body), 'an absent ledger must not be answered with an operation status');
});

// ---------------------------------------------------------------------------
// B06 Ruling H18: a succeeded `actions` operation is answered with the current
// snapshot. The client's reconcile requires a valid snapshot with the
// unresolved array (adapters.ts:7,11), and the ledger holds ids and revisions
// only (Ruling H3). The real 0023 function, with the PGlite ledger, is in
// routesActionsCommitDb.test.mjs; here it is a stand-in, to show what this
// route adds and that it adds nothing anywhere else.
// ---------------------------------------------------------------------------

const ACTIONS_OK = '88888888-8888-4888-8888-888888888881';
const ACTIONS_FAILED = '88888888-8888-4888-8888-888888888882';
const ACTIONS_PENDING = '88888888-8888-4888-8888-888888888883';
const BOB_ACTIONS = '88888888-8888-4888-8888-888888888884';
const TASK = { id: '7a7a7a7a-0000-4000-8000-000000000001', key: 'home:water', title: 'Test the tap', reason: 'Due', origin: 'home', date: '2026-10-20', state: 'saved', revision: 2 };

/** alice has a succeeded, a refused and a pending save of tasks; bob has a succeeded one. */
function actionsHarness({ env = { HALO_FEATURE_TASKS: 'on' }, withFunction = true } = {}) {
  const h = createRouteHarness({
    tables: haloTables('profiles', 'operations'),
    env,
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id }, { id: bob.id }],
      operations: [
        { operation_id: ACTIONS_OK, profile_id: alice.id, domain: 'actions', kind: 'actions.commit', status: 'succeeded', request_hash: 'h1', result: { status: 'succeeded', affected: [{ id: TASK.id, revision: 2 }], removed: [], unresolvedOperations: [], operationId: ACTIONS_OK }, created_at: ago(5000) },
        { operation_id: ACTIONS_FAILED, profile_id: alice.id, domain: 'actions', kind: 'actions.commit', status: 'failed', request_hash: 'h2', result: { status: 'failed', reason: 'stale_revision', revisions: [{ id: TASK.id, revision: 2 }], unresolvedOperations: [], operationId: ACTIONS_FAILED }, created_at: ago(4000) },
        { operation_id: ACTIONS_PENDING, profile_id: alice.id, domain: 'actions', kind: 'actions.commit', status: 'pending', request_hash: 'h3', result: null, created_at: ago(1000) },
        { operation_id: BOB_ACTIONS, profile_id: bob.id, domain: 'actions', kind: 'actions.commit', status: 'succeeded', request_hash: 'h4', result: { status: 'succeeded', affected: [], removed: [], operationId: BOB_ACTIONS }, created_at: ago(1000) },
      ],
    }),
  });
  if (withFunction) {
    h.db.registerRpc('read_household_actions', (args) => (
      args.p_profile_id === h.identities.alice.id
        ? { version: 4, actions: [TASK], metas: {}, preferences: { 'week:focus': 'Water first' } }
        : { version: 1, actions: [{ ...TASK, id: '7a7a7a7a-0000-4000-8000-0000000000b1', title: 'BOB-PRIVATE-TITLE' }], metas: {}, preferences: {} }
    ), { args: ['p_profile_id'] });
  }
  return h;
}

test('H18: a succeeded actions operation is answered with the current snapshot and the live list, its own id left out', async () => {
  const h = actionsHarness();
  const response = await read(h, 'alice', `operationId=${ACTIONS_OK}&domain=actions`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'succeeded');
  assert.equal(body.operationId, ACTIONS_OK);
  assert.deepEqual(body.snapshot, { actions: [TASK], metas: {}, preferences: { 'week:focus': 'Water first' }, unresolvedOperations: [ACTIONS_PENDING] });
  assert.deepEqual(body.unresolvedOperations, [ACTIONS_PENDING], 'S16: the live list overlays the stored [] at the top level too');
  assert.deepEqual(h.db.rows('operations').find((row) => row.operation_id === ACTIONS_OK).result.unresolvedOperations, [], 'the stored copy keeps []');
  assert.ok(!('data' in body));
  assert.deepEqual(h.db.rpcCalls, [{ name: 'read_household_actions', args: { p_profile_id: h.identities.alice.id } }], 'the caller\'s own snapshot only');
  // The client's reconcile takes it (adapters.ts:7,11) and the screen commits it (ExpandedPreviewState.tsx:113).
  const { createActionAdapter, myWeek } = await import('./helpers/frontendB06.mjs');
  const adapter = createActionAdapter({ request: async () => body });
  const week = myWeek(adapter);
  week.unknownOperation = ACTIONS_OK;
  assert.equal(await week.reconcile(), true);
  assert.deepEqual([week.unknownOperation, week.error, week.canMutate()], [ACTIONS_PENDING, 'Another earlier save needs checking.', false],
    'S16: reconciling one operation keeps a different, genuinely pending one locked');
});

test('H18: every other actions status, and every other domain, is replayed as stored with no snapshot read', async () => {
  const h = actionsHarness();
  const failed = await (await read(h, 'alice', `operationId=${ACTIONS_FAILED}&domain=actions`)).json();
  assert.deepEqual([failed.status, failed.reason, failed.revisions], ['failed', 'stale_revision', [{ id: TASK.id, revision: 2 }]]);
  assert.ok(!('snapshot' in failed));
  const pending = await (await read(h, 'alice', `operationId=${ACTIONS_PENDING}&domain=actions`)).json();
  assert.equal(pending.status, 'pending');
  assert.ok(!('snapshot' in pending));
  const settings = await (await read(harness(), 'alice', `operationId=${OP}&domain=settings`)).json();
  assert.deepEqual(settings.snapshot, { revision: 4 }, 'another domain\'s payload is untouched');
  assert.deepEqual(h.db.rpcCalls, []);
});

test('H18: another household\'s actions operation is the identical 404, and nothing of theirs is read', async () => {
  const h = actionsHarness();
  const theirs = await expectEnvelope(await read(h, 'alice', `operationId=${BOB_ACTIONS}&domain=actions`), { status: 404, code: 'not_found' });
  const never = await expectEnvelope(await read(h, 'alice', `operationId=${DEAD.replace(/5/g, '9')}&domain=actions`), { status: 404, code: 'not_found' });
  assert.equal(theirs.message, never.message);
  assert.deepEqual(h.db.rpcCalls, []);
});

test('H17, H18: with tasks off a succeeded actions operation is the non-retryable 503 and nothing is read; before 0023 likewise', async () => {
  const off = actionsHarness({ env: {} });
  await expectEnvelope(await read(off, 'alice', `operationId=${ACTIONS_OK}&domain=actions`), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.deepEqual(off.db.rpcCalls, []);
  const refused = await (await read(off, 'alice', `operationId=${ACTIONS_FAILED}&domain=actions`)).json();
  assert.equal(refused.status, 'failed', 'a refusal still replays: it discloses no task');
  const missing = actionsHarness({ withFunction: false });
  await expectEnvelope(await read(missing, 'alice', `operationId=${ACTIONS_OK}&domain=actions`), { status: 503, code: 'feature_unavailable', retryable: false });
});
