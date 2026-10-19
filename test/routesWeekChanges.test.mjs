/**
 * GET /api/week/changes and POST /api/week/changes/acknowledge (B06 Task 5).
 *
 * Rulings H4, H19 and H20 of docs/backend/plans/b06-home-actions-week.md: no
 * source of a week change exists, so the read is always the honest empty list
 * plus the household's unsettled `week-updates` operations, and an
 * acknowledgement is validated exactly as the client sends it and then refused
 * through the operation ledger, so a lost response can still be reconciled.
 *
 * THE CLIENT'S OWN CONSUMPTION LOGIC IS RUN, not only a shape check. A
 * validator-only test missed the Luna empty-state bug, because the body was
 * right and the client still did the wrong thing with it. So the second half
 * of this file drives the real handlers through a transcription of what the
 * client does with each answer, and asserts the client's resulting STATE:
 *
 *   - `runtime.request` (lib/frontend/production/runtime.ts:28-32 for the
 *     registry entries, :111-153 for the request and the response handling,
 *     including the status mapping at :144 and the envelope unwrap at
 *     :147-153), and its copy table (:89-95, `serviceMessage` :96);
 *   - `useProductionResource`'s settle (components/production/ProductionContext.tsx:14);
 *   - `useWeekChanges` and `WeekUpdateList` (components/expanded/WeekUpdates.tsx:16-30):
 *     the restore of an unresolved id (:17), the `liveChanges` filter (:18),
 *     the production `changes` (:21, :25), the acknowledgement receipt check
 *     (:23), which is this surface's adapter (there is no week adapter in
 *     adapters.ts), and the render decision (:30);
 *   - `changeEvidenceKey` and `usableWeekChanges` (lib/frontend/week-planning.ts:29-30)
 *     with `validActionDate` (lib/frontend/expanded-preview.ts:30-35).
 *
 * All of it is transcribed from `origin/codex/october15-review-refinement`
 * (5ac06f6) with `git show`, types stripped and nothing improved. React state
 * becomes plain fields. A transcription that always agreed would prove nothing,
 * so `the transcription rejects what the client rejects` shows it refusing.
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * database, and a fetch that throws on any host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const { requestHash } = await import('@/lib/operations');

const CHANGES = '/api/week/changes';
const ACK = '/api/week/changes/acknowledge';
const OPERATIONS = '/api/operations';

const OP = '5e5e5e5e-0000-4000-8000-000000000001';
const OP2 = '5e5e5e5e-0000-4000-8000-000000000002';
const BOB_OP = '5e5e5e5e-0000-4000-8000-0000000000b0';
const ACTION = '7a7a7a7a-0000-4000-8000-000000000001';
const BOB_ACTION = '7a7a7a7a-0000-4000-8000-0000000000b1';
const NEVER_ACTION = '7a7a7a7a-0000-4000-8000-0000000000ff';

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const opId = (n) => `5e5e5e5e-1111-4000-8000-${String(n).padStart(12, '0')}`;

/** The only tables either route may touch is the ledger; profiles is seed context. */
const TABLES = haloTables('profiles', 'operations');

/** A valid acknowledgement body, exactly as WeekUpdates.tsx:23 builds it. */
const ackBody = (overrides = {}) => ({
  operationId: OP,
  id: 'owned:task-1:record-1',
  version: '3',
  actionId: ACTION,
  ...overrides,
});

/** `operations` rows given as alice's or bob's by name. */
function harness({ operations = [], tables = TABLES } = {}) {
  return createRouteHarness({
    tables,
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id }, { id: bob.id }],
      // Seeding a table declares it, so the ledger is seeded only when it exists.
      ...('operations' in tables
        ? { operations: operations.map((row) => ({ ...row, profile_id: row.profile_id === 'bob' ? bob.id : alice.id })) }
        : {}),
    }),
  });
}

const read = (h, who = 'alice', { url = CHANGES, headers = {} } = {}) => h.call(CHANGES, 'GET', { as: who, url, headers });

/**
 * The POST the client makes: body, `Idempotency-Key` from the same id, JSON
 * content type. `key: null` sends no Idempotency-Key at all.
 */
const acknowledgeAs = (h, who = 'alice', { body = ackBody(), key = body.operationId, headers = {} } = {}) =>
  h.call(ACK, 'POST', {
    as: who,
    body,
    headers: { ...(key === null ? {} : { 'idempotency-key': key }), ...headers },
  });

/** A week-updates ledger row for alice. */
const weekRow = (overrides = {}) => ({
  operation_id: OP,
  profile_id: 'alice',
  domain: 'week-updates',
  kind: 'week.acknowledge',
  status: 'pending',
  request_hash: requestHash({ id: ackBody().id, version: ackBody().version, actionId: ACTION }),
  result: null,
  created_at: ago(1_000),
  ...overrides,
});

/**
 * U+2014, built from its code point so this file carries no em dash of its
 * own (AGENTS.md). Where the client's regular expression matches every
 * U+2014 (its unicode escape, global flag), the transcription below uses
 * `EM_DASH_ALL`, which matches the same thing.
 */
const EM_DASH = String.fromCharCode(0x2014);
const EM_DASH_ALL = new RegExp(EM_DASH, 'g');

const assertNoEmDash = (value, label) =>
  assert.ok(!JSON.stringify(value).includes(EM_DASH), `${label}: app-facing copy uses no em dash`);

const tablesTouched = (h) => [...new Set(h.db.queryLog.map((entry) => entry.table))].sort();

/** The receipt keys H19 fixes: no `acknowledged`, no snapshot, no `data`. */
const RECEIPT_KEYS = ['message', 'operationId', 'reason', 'status'];

/**
 * Every ledger statement scoped to the caller, except runOperation's own
 * settle, which updates by primary key the row it has just claimed for this
 * caller (lib/operations.js settle; the same exception routesAccountCommands
 * and routesLunaConversations make).
 */
function assertLedgerScoped(h, callerId, label) {
  for (const entry of h.db.queryLog.filter((item) => item.table === 'operations')) {
    if (entry.operation === 'upsert' || entry.operation === 'insert') {
      for (const row of entry.rows) assert.equal(row.profile_id, callerId, `${label}: a claim is owned by the caller`);
      continue;
    }
    const scoped = entry.filters.some((f) => f.type === 'cmp' && f.op === 'eq' && f.column === 'profile_id' && f.value === callerId);
    const settle = entry.operation === 'update'
      && entry.filters.length === 1 && entry.filters[0].column === 'operation_id';
    assert.ok(scoped || settle, `${label}: ${entry.operation} on operations is not scoped to the caller`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/week/changes
// ---------------------------------------------------------------------------

test('a new household gets exactly the honest empty body, and only the ledger is touched (H4, T9)', async () => {
  const h = harness();
  const response = await read(h);
  assert.equal(response.status, 200, 'never a 404 for a household with nothing (T7)');
  assert.equal(await response.text(), '{"changes":[],"unresolvedOperations":[]}');
  assert.deepEqual(tablesTouched(h), ['operations'], 'no task table, no alert table, nothing but the ledger');
  assert.deepEqual(h.db.rpcCalls, [], 'no function is called');
  assert.deepEqual(h.blockedFetches, [], 'no outbound call');
  assertLedgerScoped(h, h.identities.alice.id, 'GET');
});

test('changes stays empty whatever the ledger holds: no change source is invented from it (H4)', async () => {
  const h = harness({
    operations: [
      weekRow({ status: 'failed', result: { status: 'failed', reason: 'unknown_change' } }),
      { ...weekRow(), operation_id: OP2, domain: 'actions', kind: 'actions.commit' },
    ],
  });
  const body = await (await read(h)).json();
  assert.deepEqual(body.changes, []);
});

test('a pending week-updates row is listed; a settled one, an actions one and another household\'s are not (H20)', async () => {
  const h = harness({
    operations: [
      weekRow({ operation_id: OP }),
      weekRow({ operation_id: OP2, status: 'failed', result: { status: 'failed', reason: 'unknown_change' } }),
      weekRow({ operation_id: opId(1), domain: 'actions', kind: 'actions.commit' }),
      weekRow({ operation_id: BOB_OP, profile_id: 'bob' }),
    ],
  });
  const body = await (await read(h)).json();
  assert.deepEqual(body, { changes: [], unresolvedOperations: [OP] });
  assertLedgerScoped(h, h.identities.alice.id, 'GET with rows');
});

test('the list is the 100 oldest unresolved ids, because 101 would fail the client (T8)', async () => {
  const rows = Array.from({ length: 101 }, (_, i) =>
    weekRow({ operation_id: opId(i + 1), created_at: new Date(Date.now() - 60_000 + i * 100).toISOString() }));
  const h = harness({ operations: [...rows].reverse() });
  const body = await (await read(h)).json();
  assert.equal(body.unresolvedOperations.length, 100);
  assert.deepEqual(body.unresolvedOperations, rows.slice(0, 100).map((row) => row.operation_id), 'oldest first');
});

test('a dead acknowledgement is reaped and not listed, so it cannot hold the strip for ever', async () => {
  const h = harness({ operations: [weekRow({ created_at: ago(10 * 60 * 1000) })] });
  const body = await (await read(h)).json();
  assert.deepEqual(body.unresolvedOperations, []);
  const row = h.db.rows('operations').find((item) => item.operation_id === OP);
  assert.equal(row.status, 'failed');
  assert.deepEqual(row.result, { status: 'failed', reason: 'abandoned' });
});

test('identity is the token: a query or a home-context header naming another household changes nothing (H2)', async () => {
  const h = harness({ operations: [weekRow({ operation_id: BOB_OP, profile_id: 'bob' })] });
  const bob = h.identities.bob.id;
  const plain = await (await read(h)).text();
  const smuggled = await (await read(h, 'alice', {
    url: `${CHANGES}?profileId=${bob}&profile_id=${bob}`,
    headers: { 'x-halo-home-context': '11111111-1111-4111-8111-111111111111' },
  })).text();
  assert.equal(smuggled, plain);
  assert.equal(plain, '{"changes":[],"unresolvedOperations":[]}');
  const bobs = await (await read(h, 'bob')).json();
  assert.deepEqual(bobs.unresolvedOperations, [BOB_OP], 'bob still sees his own');
});

test('the read needs a session', async () => {
  const h = harness();
  const response = await h.call(CHANGES, 'GET', {});
  await expectEnvelope(response, { status: 401, code: 'auth_required' });
  assert.deepEqual(h.db.queryLog, [], 'nothing is read before the session is checked');
});

test('without migration 0017 the read is unavailable, never an invented empty list', async (t) => {
  muteConsoleError(t);
  const h = harness({ tables: haloTables('profiles') });
  const response = await read(h);
  const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!('changes' in body) && !('data' in body));
  assertNoEmDash(body, 'the unavailable answer');
});

// ---------------------------------------------------------------------------
// POST /api/week/changes/acknowledge
// ---------------------------------------------------------------------------

test('a valid acknowledgement is refused as unknown_change and recorded, never succeeded (H19, T10, T11)', async () => {
  const h = harness();
  const response = await acknowledgeAs(h);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), RECEIPT_KEYS);
  assert.deepEqual(
    { operationId: body.operationId, status: body.status, reason: body.reason },
    { operationId: OP, status: 'failed', reason: 'unknown_change' },
  );
  assert.equal(typeof body.message, 'string');
  assert.ok(body.message.length > 0);
  assertNoEmDash(body, 'the refusal');

  const rows = h.db.rows('operations');
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].profile_id, rows[0].domain, rows[0].kind, rows[0].status],
    [h.identities.alice.id, 'week-updates', 'week.acknowledge', 'failed'],
  );
  assert.deepEqual(rows[0].result, { status: 'failed', reason: 'unknown_change', operationId: OP },
    'a reason code and the id only: nothing from the request is stored (H3)');
  assert.deepEqual(tablesTouched(h), ['operations'], 'no task table is read (works with 0023 absent)');
  assert.deepEqual(h.db.rpcCalls, []);
  assert.deepEqual(h.blockedFetches, [], 'no outbound call');
  assertLedgerScoped(h, h.identities.alice.id, 'POST');

  // The receipt is not a succeeded one, and the strip lists nothing afterwards:
  // it never names its own operation as unresolved.
  const after = await (await read(h)).json();
  assert.deepEqual(after.unresolvedOperations, []);
});

test('the client bounds are the server bounds: 240 and 100 characters pass, one more does not', async () => {
  const h = harness();
  const ok = await acknowledgeAs(h, 'alice', { body: ackBody({ id: 'i'.repeat(240), version: 'v'.repeat(100) }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).reason, 'unknown_change');
});

test('every malformed body is a 400 with no ledger row (H11)', async () => {
  const cases = [
    ['an unknown key', ackBody({ actionKey: 'home:abc' }), ['actionKey'], 'unknown_field'],
    ['a smuggled profile', ackBody({ profileId: '00000000-0000-4000-8000-000000000002' }), ['profileId'], 'unknown_field'],
    ['an empty id', ackBody({ id: '' }), ['id'], 'text_required'],
    ['a 241-character id', ackBody({ id: 'i'.repeat(241) }), ['id'], 'text_too_long'],
    ['a numeric id', ackBody({ id: 7 }), ['id'], 'invalid_text'],
    ['an empty version', ackBody({ version: '' }), ['version'], 'text_required'],
    ['a 101-character version', ackBody({ version: 'v'.repeat(101) }), ['version'], 'text_too_long'],
    ['a numeric version', ackBody({ version: 3 }), ['version'], 'invalid_text'],
    ['a non-UUID actionId', ackBody({ actionId: 'task-1' }), ['actionId'], 'invalid_uuid'],
    ['a missing actionId', ackBody({ actionId: undefined }), ['actionId'], 'invalid_uuid'],
    ['a non-UUID operationId', ackBody({ operationId: 'op-1' }), ['operationId'], 'invalid_uuid'],
  ];
  for (const [label, body, fields, code] of cases) {
    const h = harness();
    const key = body.operationId === 'op-1' ? OP : (body.operationId ?? OP);
    const response = await acknowledgeAs(h, 'alice', { body, key });
    const envelope = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(envelope.field_errors.map((entry) => entry.field), fields, label);
    assert.equal(envelope.field_errors[0].code, code, label);
    assertNoEmDash(envelope, label);
    assert.equal(h.db.rows('operations').length, 0, `${label}: no ledger row`);
  }
});

test('the Idempotency-Key is required, must be a UUID, and must be the body\'s operationId (H21, T12)', async () => {
  const cases = [
    ['missing', null, 'Idempotency-Key', 'invalid_uuid'],
    ['empty', '', 'Idempotency-Key', 'invalid_uuid'],
    ['not a UUID', 'not-a-uuid', 'Idempotency-Key', 'invalid_uuid'],
    ['another id', OP2, 'operationId', 'idempotency_key_mismatch'],
  ];
  for (const [label, key, field, code] of cases) {
    const h = harness();
    const response = await acknowledgeAs(h, 'alice', { key });
    const envelope = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
    assert.deepEqual(envelope.field_errors.map((entry) => [entry.field, entry.code]), [[field, code]], label);
    assert.equal(h.db.rows('operations').length, 0, `${label}: no ledger row`);
  }
  // Trimmed and lowercased, as the house check does.
  const h = harness();
  const response = await acknowledgeAs(h, 'alice', { key: `  ${OP.toUpperCase()} ` });
  assert.equal(response.status, 200);
});

test('If-Match is refused: there is no revision to match (H21)', async () => {
  const h = harness();
  const response = await acknowledgeAs(h, 'alice', { headers: { 'if-match': '3' } });
  const envelope = await expectEnvelope(response, { status: 400, code: 'validation_failed' });
  assert.deepEqual(envelope.field_errors.map((entry) => [entry.field, entry.code]), [['If-Match', 'precondition_unsupported']]);
  assert.equal(h.db.rows('operations').length, 0);
});

test('a body over 2,048 bytes is a 413, which the client maps to failed rather than a lock', async () => {
  const h = harness();
  const response = await acknowledgeAs(h, 'alice', { body: ackBody({ id: 'i'.repeat(3000) }) });
  await expectEnvelope(response, { status: 413, code: 'payload_too_large' });
  assert.equal(h.db.rows('operations').length, 0);
});

test('no task table is read, so the caller\'s task, another household\'s and one that never existed answer identically', async () => {
  const bodies = [];
  for (const [n, actionId] of [[1, ACTION], [2, BOB_ACTION], [3, NEVER_ACTION]]) {
    const h = harness();
    const response = await acknowledgeAs(h, 'alice', { body: ackBody({ operationId: opId(n), actionId }) });
    assert.equal(response.status, 200);
    bodies.push((await response.text()).replace(opId(n), '<op>'));
    assert.deepEqual(tablesTouched(h), ['operations']);
  }
  assert.equal(bodies[1], bodies[0], 'another household\'s task id is no existence oracle');
  assert.equal(bodies[2], bodies[0]);
});

test('identity is the token: a home-context header changes nothing, and the row is the caller\'s (H2)', async () => {
  const h = harness();
  const response = await acknowledgeAs(h, 'alice', { headers: { 'x-halo-home-context': '11111111-1111-4111-8111-111111111111' } });
  assert.equal((await response.json()).reason, 'unknown_change');
  assert.equal(h.db.rows('operations')[0].profile_id, h.identities.alice.id);
});

test('another household\'s operation id is a mismatch that says nothing about whose it is', async () => {
  const h = harness({ operations: [weekRow({ operation_id: BOB_OP, profile_id: 'bob', status: 'failed', result: { status: 'failed', reason: 'unknown_change' } })] });
  const response = await acknowledgeAs(h, 'alice', { body: ackBody({ operationId: BOB_OP }) });
  const envelope = await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'operation_mismatch');
  const bobRow = h.db.rows('operations').find((row) => row.operation_id === BOB_OP);
  assert.deepEqual([bobRow.profile_id, bobRow.status], [h.identities.bob.id, 'failed'], 'their row is left as it was');

  // Identical to alice reusing her own id with a different body.
  const own = harness();
  await acknowledgeAs(own);
  const reused = await (await acknowledgeAs(own, 'alice', { body: ackBody({ version: '9' }) })).json();
  const withoutRequestId = (body) => Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'request_id'));
  assert.deepEqual(withoutRequestId(envelope), withoutRequestId(reused));
});

test('a replay of the same key and body answers the same refusal, with one ledger row', async () => {
  const h = harness();
  const first = await (await acknowledgeAs(h)).text();
  const second = await (await acknowledgeAs(h)).text();
  assert.equal(second, first);
  assert.equal(h.db.rows('operations').length, 1);
});

test('the same key with a different body is 409 operation_mismatch, never a wrong replay', async () => {
  const h = harness();
  await acknowledgeAs(h);
  const response = await acknowledgeAs(h, 'alice', { body: ackBody({ version: '4' }) });
  const envelope = await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'operation_mismatch');
  assertNoEmDash(envelope, 'the mismatch');
});

/** A replay that met an attempt which is over and was not this route's refusal: terminal 409. */
async function assertTerminalReplay(h, reason, label) {
  const response = await acknowledgeAs(h);
  const envelope = await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(envelope.reason, reason, label);
  assert.ok(!('status' in envelope) && !('acknowledged' in envelope), `${label}: no receipt the client could trust`);
  assertNoEmDash(envelope, label);
  assert.equal(h.db.rows('operations').find((row) => row.operation_id === OP).status, 'failed');
}

test('both reaped shapes are a terminal 409 with an accurate reason, not a 5xx (H7, H11)', async () => {
  // Reaped by an earlier read: `{status:'failed', reason:'abandoned'}`.
  await assertTerminalReplay(
    harness({ operations: [weekRow({ status: 'failed', result: { status: 'failed', reason: 'abandoned' } })] }),
    'abandoned',
    'already reaped',
  );
  // Reaped by this replay: a pending claim past the window.
  const stale = harness({ operations: [weekRow({ created_at: ago(10 * 60 * 1000) })] });
  await assertTerminalReplay(stale, 'abandoned', 'reaped on replay');
  await assertTerminalReplay(stale, 'abandoned', 'and again after the reap');
  // Settled with no receipt: an in-process throw (lib/operations.js runOperation catch).
  await assertTerminalReplay(harness({ operations: [weekRow({ status: 'failed', result: null })] }), 'not_applied', 'threw');
  // A receipt this route never writes, including a succeeded one: never replayed.
  await assertTerminalReplay(
    harness({ operations: [weekRow({ status: 'failed', result: { status: 'failed', reason: 'something_else' } })] }),
    'not_applied',
    'an unrecognised reason',
  );
  const odd = harness({ operations: [weekRow({ status: 'succeeded', result: { status: 'succeeded' } })] });
  const response = await acknowledgeAs(odd);
  const envelope = await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'not_applied', 'a succeeded receipt without `acknowledged` would lock the strip (T11)');
});

test('an attempt still running is the retryable 503, and nothing is decided for it', async () => {
  const h = harness({ operations: [weekRow()] });
  const response = await acknowledgeAs(h);
  await expectEnvelope(response, { status: 503, code: 'upstream_unavailable', retryable: true });
  assert.equal(h.db.rows('operations')[0].status, 'pending');
});

test('GET /api/operations answers failed for a recorded refusal (reconcile)', async () => {
  const h = harness();
  await acknowledgeAs(h);
  const response = await h.call(OPERATIONS, 'GET', { as: 'alice', url: `${OPERATIONS}?operationId=${OP}&domain=week-updates` });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.operationId, OP);
  assert.equal(body.status, 'failed');
  assert.equal(body.reason, 'unknown_change');
  assert.ok(!('data' in body));
});

test('the acknowledgement needs a session, and claims nothing without one', async () => {
  const h = harness();
  const response = await h.call(ACK, 'POST', { body: ackBody(), headers: { 'idempotency-key': OP } });
  await expectEnvelope(response, { status: 401, code: 'auth_required' });
  assert.equal(h.db.rows('operations').length, 0);
});

test('without migration 0017 the acknowledgement is unavailable before anything is recorded', async (t) => {
  muteConsoleError(t);
  const h = harness({ tables: haloTables('profiles') });
  const response = await acknowledgeAs(h);
  const body = await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assertNoEmDash(body, 'unavailable');
});

test('both routes declare maxDuration = 60, under the ledger\'s staleness window', () => {
  for (const file of ['app/api/week/changes/route.js', 'app/api/week/changes/acknowledge/route.js']) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.match(source, /^export const maxDuration = 60;$/m, file);
  }
});

test('no server-authored string in either route has an em dash (H22, T13)', () => {
  for (const file of ['app/api/week/changes/route.js', 'app/api/week/changes/acknowledge/route.js']) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.ok(!source.includes(EM_DASH), file);
  }
});

// ---------------------------------------------------------------------------
// The client, transcribed (origin/codex/october15-review-refinement, 5ac06f6)
// ---------------------------------------------------------------------------

/** runtime.ts:12-14 */
class FrontendServiceError extends Error {
  constructor(code, message, operationId, retryAfter, fields) {
    super(message);
    this.code = code;
    this.operationId = operationId;
    this.retryAfter = retryAfter;
    this.fields = fields;
    this.name = 'FrontendServiceError';
  }
}

/** runtime.ts:28-32, the registry entries this surface uses. */
const productionOperations = {
  'operations.read': { path: '/api/operations' },
  'week.changes': { path: '/api/week/changes' },
  'week.acknowledge': { path: '/api/week/changes/acknowledge', method: 'POST' },
};

/** runtime.ts:89-95 */
const messages = {
  offline: 'You are offline. Your changes are still here.', session: 'Please reconnect your session to continue.',
  permission: 'This action is not available for this account.', conflict: 'This item changed. Review the latest version before saving.',
  validation: 'Check the highlighted information and try again.', rate_limited: 'Please wait before trying again.',
  unavailable: 'This service is unavailable. Try again later.', invalid_response: 'The service returned incomplete information. Please retry.',
  aborted: 'Request cancelled.', unknown_outcome: 'The result is not confirmed. Check its status before trying again.',
};
/** runtime.ts:96 */
function serviceMessage(error) { return error instanceof FrontendServiceError ? error.message : messages.unavailable; }

/**
 * `request` (runtime.ts:105-158) with the harness as `fetch`. Kept: the
 * registry lookup, the method and mutation rule (:111), the operation id
 * (:112), the query building (:125-129), the headers (:130-136), the body
 * (:138) and the whole response handling (:143-157). Left out: credentials,
 * timeouts and aborts, which a route cannot affect. `lose` drops the response
 * after the server has handled it, which is the timeout path of :118.
 */
function clientRuntime(h, who, { homeContextId = null } = {}) {
  return {
    async request(operation, body, options = {}) {
      const endpoint = productionOperations[operation];
      const method = endpoint.method ?? 'GET', mutation = method !== 'GET';
      const operationId = mutation ? options.idempotencyKey ?? crypto.randomUUID() : undefined;
      let sent = false;
      try {
        let path = endpoint.path;
        if (!mutation && body && typeof body === 'object') {
          const query = new URLSearchParams();
          for (const [key, value] of Object.entries(body)) if (value !== undefined && value !== null) query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
          if (query.size) path += `?${query}`;
        }
        const headers = { Accept: 'application/json' };
        if (homeContextId) headers['X-Halo-Home-Context'] = homeContextId;
        if (options.expectedRevision !== undefined) headers['If-Match'] = String(options.expectedRevision);
        if (operationId) headers['Idempotency-Key'] = operationId;
        if (mutation) headers['Content-Type'] = 'application/json';
        sent = true;
        const response = await h.call(endpoint.path, method, {
          as: who,
          url: path,
          headers,
          rawBody: mutation ? JSON.stringify(body ?? {}) : undefined,
        });
        if (options.lose) throw new Error('response lost');
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          const code = response.status === 401 ? 'session' : response.status === 403 ? 'permission' : response.status === 409 || response.status === 412 ? 'conflict' : response.status === 400 || response.status === 422 ? 'validation' : response.status === 429 ? 'rate_limited' : response.status >= 500 && mutation ? 'unknown_outcome' : 'unavailable';
          const retry = Number(response.headers.get('Retry-After')); throw new FrontendServiceError(code, messages[code], operationId, Number.isFinite(retry) && retry > 0 ? retry : undefined);
        }
        if (json === null || typeof json !== 'object') throw new FrontendServiceError(mutation ? 'unknown_outcome' : 'invalid_response', messages[mutation ? 'unknown_outcome' : 'invalid_response'], operationId);
        if (Object.hasOwn(json, 'data')) {
          const envelope = json;
          return (envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) && envelope.meta ? { ...envelope.data, _meta: envelope.meta } : envelope.data);
        }
        return json;
      } catch (error) {
        if (error instanceof FrontendServiceError) throw error;
        const code = sent && mutation ? 'unknown_outcome' : 'unavailable';
        throw new FrontendServiceError(code, messages[code], operationId);
      }
    },
  };
}

/** expanded-preview.ts:30-35 */
function validActionDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** week-planning.ts:29 */
const changeEvidenceKey = (change) => `${change.id}:${change.version}`;
/** week-planning.ts:30 */
function usableWeekChanges(changes, actions, acknowledged) { return changes.filter((change, index) => Boolean(change.id && change.id.length <= 240 && change.version && change.version.length <= 100 && change.sourceVersion) && ['date-changed', 'cancelled', 'report', 'routine', 'conditions', 'missing-origin'].includes(change.kind) && changes.findIndex(c => changeEvidenceKey(c) === changeEvidenceKey(change)) === index && actions.some(a => a.id === change.actionId && a.key === change.actionKey && a.state !== 'completed') && !acknowledged.includes(changeEvidenceKey(change))).map(change => ({ ...change, title: change.title.replace(EM_DASH_ALL, ',').slice(0, 160), summary: change.summary.replace(EM_DASH_ALL, ',').slice(0, 600), sourceLabel: change.sourceLabel.replace(EM_DASH_ALL, ',').slice(0, 100), date: change.date && validActionDate(change.date) ? change.date : '', sourceUrl: change.sourceUrl && /^https:\/\//i.test(change.sourceUrl) ? change.sourceUrl : undefined })); }

/**
 * `useWeekChanges` in production (WeekUpdates.tsx:14-25) and `WeekUpdateList`'s
 * render decision (:30), as a plain object. `sourceReady` is the workspace
 * scenario check of :19; production starts it `ready` (digest 6.2).
 */
function weekStrip(runtime, { actions = [], metas = {}, sourceReady = true } = {}) {
  const strip = {
    acknowledged: [], unknown: null, feedback: '', pending: false,
    live: { data: null, loading: true, error: null },
    retries: 0,

    /** ProductionContext.tsx:14, the read `useProductionResource('week.changes',{})` makes. */
    async load() {
      await runtime.request('week.changes', JSON.parse(JSON.stringify({}))).then(
        (data) => { strip.live = { data, loading: false, error: null }; },
        (error) => { strip.live = { data: null, loading: false, error: serviceMessage(error) }; },
      );
      // :17, the restore effect.
      const restored = strip.live.data?.unresolvedOperations?.[0];
      if (typeof restored === 'string' && !strip.unknown) strip.unknown = restored;
    },

    /** :18 */
    liveChanges() {
      const live = strip.live;
      return Array.isArray(live.data?.changes) ? live.data.changes.filter(change => change && change.sample === false && typeof change.id === 'string' && typeof change.version === 'string' && typeof change.title === 'string' && typeof change.summary === 'string' && typeof change.sourceLabel === 'string' && typeof change.sourceVersion === 'string' && actions.some(action => action.id === change.actionId && action.key === change.actionKey) && (!change.sourceUrl || /^https:\/\//.test(change.sourceUrl))) : [];
    },

    /** :21 (the `runtime` branch) and :25 */
    changes() {
      const changes = usableWeekChanges(strip.liveChanges(), actions, strip.acknowledged).filter(change => !metas[change.actionKey]?.archived);
      return sourceReady ? changes : [];
    },

    /** :25 `statusMessage` */
    statusMessage() { return strip.live.error; },

    /** :23, the runtime branch, verbatim apart from React state. */
    async acknowledge(change, { lose = false } = {}) {
      if (strip.pending || !change && !strip.unknown) return;
      strip.pending = true; const operationId = strip.unknown ?? crypto.randomUUID();
      try {
        const receipt = await runtime.request(strip.unknown ? 'operations.read' : 'week.acknowledge', strip.unknown ? { operationId, domain: 'week-updates' } : { operationId, id: change.id, version: change.version, actionId: change.actionId }, { idempotencyKey: operationId, lose });
        if (receipt.operationId === operationId && ['failed', 'cancelled'].includes(receipt.status)) { strip.unknown = null; strip.feedback = 'The update was not applied. You can try again.'; return; }
        if (receipt.operationId !== operationId || receipt.status !== 'succeeded' || !Array.isArray(receipt.acknowledged) || !receipt.acknowledged.every(key => typeof key === 'string')) { strip.unknown = operationId; strip.feedback = 'The update is not confirmed. Select Reviewed again to check its status.'; return; }
        strip.acknowledged = receipt.acknowledged; strip.unknown = null; strip.feedback = 'Update reviewed. Your task is unchanged.'; strip.retries += 1;
      } catch (e) { if (e instanceof FrontendServiceError && e.code === 'unknown_outcome') strip.unknown = operationId; strip.feedback = serviceMessage(e); }
      finally { strip.pending = false; }
    },

    /** :25 `checkStatus` */
    checkStatus() { return strip.acknowledge(); },

    /**
     * :30, what `WeekUpdateList` renders: 'nothing' (null), 'status-check'
     * ("An update needs a status check." or the feedback, with "Check update
     * status"), 'unavailable' ("Plan updates are unavailable." with Try
     * again), or 'list' ("A change to review").
     */
    render() {
      const changes = strip.changes();
      if (!changes.length) return strip.unknown ? { kind: 'status-check', text: strip.feedback || 'An update needs a status check.' } : strip.statusMessage() ? { kind: 'unavailable', text: 'Plan updates are unavailable.' } : null;
      return { kind: 'list', count: changes.length };
    },
  };
  return strip;
}

/** A change the client could hold, bound to a loaded task: only used to drive the transcription. */
const TASK = { id: ACTION, key: 'home:record-1', title: 'Retest the kitchen tap', reason: '', origin: '', date: '', state: 'saved', revision: 1 };
const CHANGE = {
  id: 'owned:task-1:record-1', actionId: ACTION, actionKey: TASK.key, version: '3', kind: 'report',
  title: 'A result is recorded', summary: 'Open the report.', sourceLabel: 'Your test record', sourceVersion: '3', sample: false,
};

/** A runtime that answers every request with a canned body and status, for the self-checks. */
const cannedRuntime = (status, body) => clientRuntime({
  call: async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
}, 'alice');

test('the transcription rejects what the client rejects, so agreement below means something', async () => {
  // The strip renders a list for a valid bound change, and nothing for each broken one.
  const listed = weekStrip(cannedRuntime(200, { changes: [CHANGE], unresolvedOperations: [] }), { actions: [TASK] });
  await listed.load();
  assert.deepEqual(listed.render(), { kind: 'list', count: 1 });
  for (const [label, change, actions] of [
    ['a sample', { ...CHANGE, sample: true }, [TASK]],
    ['an unbound task', CHANGE, []],
    ['a completed task', CHANGE, [{ ...TASK, state: 'completed' }]],
    ['a 241-character id', { ...CHANGE, id: 'i'.repeat(241) }, [TASK]],
    ['an unknown kind', { ...CHANGE, kind: 'rumour' }, [TASK]],
    ['an http source', { ...CHANGE, sourceUrl: 'http://example.test' }, [TASK]],
  ]) {
    const strip = weekStrip(cannedRuntime(200, { changes: [change], unresolvedOperations: [] }), { actions });
    await strip.load();
    assert.equal(strip.render(), null, label);
  }
  // An acknowledged key hides the change.
  const hidden = weekStrip(cannedRuntime(200, { changes: [CHANGE], unresolvedOperations: [] }), { actions: [TASK] });
  await hidden.load();
  hidden.acknowledged = [changeEvidenceKey(CHANGE)];
  assert.equal(hidden.render(), null);

  // A read that fails shows "unavailable"; one wrapped in `data` is unwrapped.
  const broken = weekStrip(cannedRuntime(503, { error: 'x' }));
  await broken.load();
  assert.deepEqual(broken.render(), { kind: 'unavailable', text: 'Plan updates are unavailable.' });
  const nonObject = weekStrip(cannedRuntime(200, 'null'));
  await nonObject.load();
  assert.equal(nonObject.live.error, messages.invalid_response);
  const wrapped = weekStrip(cannedRuntime(200, { data: { changes: [CHANGE] } }), { actions: [TASK] });
  await wrapped.load();
  assert.deepEqual(wrapped.render(), { kind: 'list', count: 1 }, 'the unwrap at runtime.ts:149-152 is transcribed');
  const unwrappedToNull = weekStrip(cannedRuntime(200, { data: null, changes: [CHANGE] }), { actions: [TASK] });
  await unwrappedToNull.load();
  assert.equal(unwrappedToNull.render(), null, 'a top-level data key replaces the body');

  // An unresolved id is restored and the strip asks for a status check.
  const restoring = weekStrip(cannedRuntime(200, { changes: [], unresolvedOperations: [OP] }));
  await restoring.load();
  assert.equal(restoring.unknown, OP);
  assert.deepEqual(restoring.render(), { kind: 'status-check', text: 'An update needs a status check.' });

  // A succeeded receipt without `acknowledged` locks; one with it clears (T11).
  const locking = weekStrip(cannedRuntime(200, { operationId: OP, status: 'succeeded' }));
  locking.unknown = OP;
  await locking.checkStatus();
  assert.equal(locking.unknown, OP);
  assert.equal(locking.feedback, 'The update is not confirmed. Select Reviewed again to check its status.');
  const clearing = weekStrip(cannedRuntime(200, { operationId: OP, status: 'succeeded', acknowledged: ['a:1'] }));
  clearing.unknown = OP;
  await clearing.checkStatus();
  assert.deepEqual([clearing.unknown, clearing.acknowledged], [null, ['a:1']]);
  // A 5xx on the acknowledgement locks; a 409 does not.
  const fiveHundred = weekStrip(cannedRuntime(503, {}));
  await fiveHundred.acknowledge(CHANGE);
  assert.equal(typeof fiveHundred.unknown, 'string');
  const conflictStrip = weekStrip(cannedRuntime(409, {}));
  await conflictStrip.acknowledge(CHANGE);
  assert.equal(conflictStrip.unknown, null);
  assert.equal(conflictStrip.feedback, messages.conflict);
});

// ---------------------------------------------------------------------------
// The real handlers through the client
// ---------------------------------------------------------------------------

test('client: a new household\'s strip renders nothing and shows no error (T9)', async () => {
  const h = harness();
  const strip = weekStrip(clientRuntime(h, 'alice', { homeContextId: '11111111-1111-4111-8111-111111111111' }), { actions: [TASK] });
  await strip.load();
  assert.equal(strip.live.error, null, 'the read did not fail');
  assert.equal(strip.unknown, null, 'nothing to check');
  assert.deepEqual(strip.changes(), []);
  assert.equal(strip.render(), null, 'WeekUpdateList returns null: the designed empty state');
  assert.deepEqual(h.blockedFetches, []);
});

test('client: an acknowledgement says it was not applied and leaves no lock (H19)', async () => {
  const h = harness();
  const strip = weekStrip(clientRuntime(h, 'alice'), { actions: [TASK] });
  await strip.load();
  await strip.acknowledge(CHANGE);
  assert.equal(strip.feedback, 'The update was not applied. You can try again.');
  assert.equal(strip.unknown, null);
  assert.deepEqual(strip.acknowledged, [], 'nothing was acknowledged');
  assert.equal(strip.retries, 0, 'no re-read is triggered by a refusal');
  await strip.load();
  assert.equal(strip.render(), null, 'and the strip is still empty, not locked');
});

test('client: a lost acknowledgement response reconciles to "not applied" and clears the lock (digest 4.6 item 5)', async () => {
  const h = harness();
  const strip = weekStrip(clientRuntime(h, 'alice'), { actions: [TASK] });
  await strip.load();
  await strip.acknowledge(CHANGE, { lose: true });
  const operationId = strip.unknown;
  assert.equal(typeof operationId, 'string', 'a lost mutation response is unknown_outcome, a lock');
  assert.equal(strip.feedback, messages.unknown_outcome);
  assert.deepEqual(strip.render(), { kind: 'status-check', text: messages.unknown_outcome });
  await strip.checkStatus();
  assert.equal(strip.unknown, null, 'the recorded refusal answers the reconcile');
  assert.equal(strip.feedback, 'The update was not applied. You can try again.');
  assert.equal(strip.render(), null);
});

test('client: an acknowledgement in flight on another device is restored, and released once it settles', async () => {
  const h = harness({ operations: [weekRow()] });
  const strip = weekStrip(clientRuntime(h, 'alice'), { actions: [TASK] });
  await strip.load();
  assert.equal(strip.unknown, OP, 'the unresolved id is restored (WeekUpdates.tsx:17)');
  assert.deepEqual(strip.render(), { kind: 'status-check', text: 'An update needs a status check.' });
  await strip.checkStatus();
  assert.equal(strip.unknown, OP, 'still pending: honestly not confirmed');
  assert.equal(strip.feedback, 'The update is not confirmed. Select Reviewed again to check its status.');

  // Once the other device's request finishes, the row is settled as this
  // route's refusal, and the next status check releases the strip.
  const settled = harness({
    operations: [weekRow({ status: 'failed', result: { status: 'failed', reason: 'unknown_change', operationId: OP } })],
  });
  const later = weekStrip(clientRuntime(settled, 'alice'), { actions: [TASK] });
  later.unknown = OP;
  await later.load();
  await later.checkStatus();
  assert.equal(later.unknown, null);
  assert.equal(later.feedback, 'The update was not applied. You can try again.');
  assert.equal(later.render(), null);
});

test('client: a dead acknowledgement is reaped by the read, so the strip is not locked by it', async () => {
  const h = harness({ operations: [weekRow({ created_at: ago(10 * 60 * 1000) })] });
  const strip = weekStrip(clientRuntime(h, 'alice'), { actions: [TASK] });
  await strip.load();
  assert.equal(strip.unknown, null);
  assert.equal(strip.render(), null);
});
