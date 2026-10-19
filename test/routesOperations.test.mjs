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

const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** alice has a settled save, a failed one and a crashed one; bob has his own settled save. */
function harness() {
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
  // The crashed row is stored as 'pending'; the route must answer with the
  // settled outcome computed now, never echo the stored word.
  const h = harness();
  const body = await (await read(h, 'alice', `operationId=${DEAD}&domain=alerts`)).json();
  assert.notEqual(body.status, 'pending');
  assert.equal(body.status, 'failed');
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
