/**
 * GET and PATCH /api/explore/area (B05 Task 4, Rulings D5 to D10) on the
 * isolated harness: synthetic identities, the in-memory database and a fetch
 * that rejects any host.
 *
 * The authority is the frontend on `origin/codex/october15-review-refinement`:
 *
 *   validDiscoveryArea   lib/frontend/production/explore-service.ts:8-9,67-69,
 *                        transcribed verbatim with its helpers (shared, in
 *                        test/helpers/frontendB05.mjs) and self-checked
 *                        below against what the client rejects.
 *   the client's runtime lib/frontend/production/runtime.ts:12-13,46-48,91-97,
 *                        107-159 (request, headers, status to failure code,
 *                        envelope unwrap), transcribed with the types removed;
 *                        the blob branch (runtime.ts:139), scopeKey and the
 *                        operations this file does not use are elided, as
 *                        they are unreachable for these operations.
 *   the area chooser     components/expanded/ExploreDiscovery.tsx:33-36,45,60-61
 *                        (read, save, park and replay), transcribed with the
 *                        React state replaced by plain fields.
 *
 * The last section drives the transcribed chooser over the real handlers, so
 * what is tested is what the client does with each answer, not only whether
 * the answer passes a validator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, muteConsoleError, tokenFor } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { expectEnvelope, UUID } from './helpers/envelope.mjs';
// F: explore-service.ts:8-9,66-69, transcribed once for every B05 suite (see the helper's header).
import { validPlaces, validDiscoveryArea } from './helpers/frontendB05.mjs';

const { requestHash } = await import('@/lib/operations');

const ROUTE = '/api/explore/area';
const EM_DASH = String.fromCharCode(0x2014);
const INT_MAX = 2147483647;

const TABLES = haloTables('profiles', 'operations', 'explore_areas', 'symptom_logs');

const WAKE = { id: 'us-county:37183', place: 'Wake County', state: 'NC', label: 'Wake County, NC', timezone: 'America/New_York' };
const MECK = { id: 'us-county:37119', place: 'Mecklenburg County', state: 'NC', label: 'Mecklenburg County, NC', timezone: 'America/New_York' };
const GASTON = { id: 'us-county:37071', place: 'Gaston County', state: 'NC', label: 'Gaston County, NC', timezone: 'America/New_York' };

const OP = '55555555-5555-4555-8555-555555555551';
const OP2 = '55555555-5555-4555-8555-555555555552';
const BOB_OP = '55555555-5555-4555-8555-555555555559';
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** A stored row for a place, in the table's column names. */
const rowOf = (place, revision) => ({
  place_id: place?.id ?? null,
  place: place?.place ?? null,
  state: place?.state ?? null,
  label: place?.label ?? null,
  timezone: place?.timezone ?? null,
  revision,
  updated_at: '2026-10-01T12:00:00.000Z',
});

/**
 * @param {object} [options]
 * @param {object} [options.tables] drop one to model a schema before 0022 or 0017
 * @param {object|null} [options.alice] alice's stored row, or null for never saved
 * @param {Array} [options.operations] ledger rows (profile_id 'alice' or 'bob')
 */
function harness({ tables = TABLES, alice = null, operations = [] } = {}) {
  return createRouteHarness({
    tables,
    seed: ({ alice: a, bob: b }) => {
      const owner = (who) => (who === 'bob' ? b.id : a.id);
      return {
        profiles: [{ id: a.id, county: 'Cabarrus County' }, { id: b.id, county: 'Union County' }],
        symptom_logs: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', profile_id: a.id, entry_date: '2026-10-01', notes: 'ALICE-NOTE' }],
        ...(tables.explore_areas ? {
          explore_areas: [
            ...(alice ? [{ profile_id: a.id, ...alice }] : []),
            { profile_id: b.id, ...rowOf(GASTON, 7) },
          ],
        } : {}),
        ...(tables.operations ? { operations: operations.map((row) => ({ ...row, profile_id: owner(row.profile_id) })) } : {}),
      };
    },
  });
}

const read = (h, who = 'alice', { headers } = {}) => h.call(ROUTE, 'GET', { as: who, headers });

/** The save the client sends (runtime.ts:133-136): body `{place, revision}`, If-Match and Idempotency-Key. */
const save = (h, who, { place = WAKE, revision = 1, key = OP, ifMatch = String(revision), headers = {}, body, rawBody } = {}) =>
  h.call(ROUTE, 'PATCH', {
    as: who,
    body: rawBody === undefined ? (body ?? { place, revision }) : undefined,
    rawBody,
    headers: {
      ...(key === null ? {} : { 'idempotency-key': key }),
      ...(ifMatch === null ? {} : { 'if-match': ifMatch }),
      ...headers,
    },
  });

const areaRow = (h, who = 'alice') => h.db.rows('explore_areas').find((row) => row.profile_id === h.identities[who].id) ?? null;
const areaWrites = (h) => h.db.queryLog.filter((q) => q.table === 'explore_areas' && q.operation !== 'select');
const snapshot = (h) => JSON.stringify({ areas: h.db.rows('explore_areas'), ops: h.db.rows('operations') });
const assertNoEmDash = (value, label) =>
  assert.equal(JSON.stringify(value).includes(EM_DASH), false, `${label}: no em dash`);

/** A success the client accepts: exactly `{place, revision}`, valid, bare, and never parked. */
async function expectArea(res, expected, label) {
  assert.equal(res.status, 200, label);
  assert.match(res.headers.get('x-request-id'), UUID, `${label}: request id`);
  const body = await res.json();
  assert.deepEqual(body, expected, label);
  assert.deepEqual(Object.keys(body).sort(), ['place', 'revision'], `${label}: no pendingOperation, no operationId, no data key`);
  assert.equal(validDiscoveryArea(body), true, `${label}: the client's validator accepts it`);
  assertNoEmDash(body, label);
  return body;
}

/** A 409 with the reason and, for a stale revision, the current one. */
async function expectConflict(res, reason, label, revision) {
  const body = await expectEnvelope(res, {
    status: 409, code: 'conflict', retryable: false, extraKeys: revision === undefined ? ['reason'] : ['reason', 'revision'],
  });
  assert.equal(body.reason, reason, label);
  if (revision !== undefined) assert.equal(body.revision, revision, `${label}: the current revision`);
  assert.ok(!('place' in body), `${label}: a refusal is not an area`);
  assertNoEmDash(body, label);
  return body;
}

test('the transcribed validDiscoveryArea rejects what the client rejects', () => {
  assert.equal(validDiscoveryArea({ place: null, revision: 1 }), true);
  assert.equal(validDiscoveryArea({ place: WAKE, revision: 2 }), true);
  assert.equal(validDiscoveryArea({ place: null, revision: 1, pendingOperation: { id: OP, place: null } }), true);
  for (const [value, why] of [
    [{ place: null, revision: 0 }, 'revision 0'],
    [{ place: null, revision: '2' }, 'a string revision'],
    [{ place: null, revision: 1.5 }, 'a fractional revision'],
    [{ place: null }, 'no revision'],
    [{ place: { ...WAKE, label: undefined }, revision: 2 }, 'a partial place'],
    [{ place: { ...WAKE, id: '' }, revision: 2 }, 'a blank id'],
    [{ place: { ...WAKE, label: 'x'.repeat(301) }, revision: 2 }, 'a 301-character field'],
    [{ place: { ...WAKE, label: 'Wake\u0001' }, revision: 2 }, 'a control character'],
    [{ place: null, revision: 1, pendingOperation: null }, 'a null pendingOperation'],
    [[], 'an array'],
    [null, 'null'],
  ]) assert.equal(validDiscoveryArea(value), false, why);
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('a household that has never saved reads exactly { place: null, revision: 1 }, and the read writes nothing', async () => {
  const h = harness();
  const before = snapshot(h);
  await expectArea(await read(h), { place: null, revision: 1 }, 'never saved');
  assert.equal(snapshot(h), before);
  assert.deepEqual(h.db.queryLog.map((q) => `${q.operation}:${q.table}`), ['select:explore_areas']);
  assert.deepEqual(h.blockedFetches, [], 'zero fetch calls');
});

test('the read never carries pendingOperation, even with an unsettled explore save in the ledger (D7)', async () => {
  const hash = requestHash({ place: WAKE, revision: 1 });
  const h = harness({
    operations: [
      { operation_id: OP, profile_id: 'alice', domain: 'explore', kind: 'explore.area.save', status: 'pending', request_hash: hash, created_at: ago(1_000) },
      { operation_id: OP2, profile_id: 'alice', domain: 'explore', kind: 'explore.area.save', status: 'pending', request_hash: hash, created_at: ago(10 * 60_000) },
    ],
  });
  await expectArea(await read(h), { place: null, revision: 1 }, 'with pending rows');
  assert.equal(h.db.queryLog.some((q) => q.table === 'operations'), false, 'the read does not consult the ledger');
});

test('a saved area reads back in the client shape, from the caller\'s own row', async () => {
  const h = harness({ alice: rowOf(MECK, 4) });
  await expectArea(await read(h), { place: MECK, revision: 4 }, 'alice');
  await expectArea(await read(h, 'bob'), { place: GASTON, revision: 7 }, 'bob');
  auditOwnerScope(h.db.queryLog.slice(0, 1), h.identities.alice.id, 'alice GET');
  auditOwnerScope(h.db.queryLog.slice(1), h.identities.bob.id, 'bob GET');
});

test('without a session both verbs are 401 and nothing is read or written', async () => {
  const h = harness();
  const before = snapshot(h);
  await expectEnvelope(await read(h, null), { status: 401, code: 'auth_required' });
  await expectEnvelope(await save(h, null), { status: 401, code: 'auth_required' });
  assert.equal(snapshot(h), before);
  assert.equal(h.db.queryLog.length, 0);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test('round trip: save at 1 gives 2, clear gives 3 with place null, and each returned revision is the next If-Match', async () => {
  const h = harness();
  const first = await expectArea(await save(h, 'alice', { place: WAKE, revision: 1, key: OP }), { place: WAKE, revision: 2 }, 'first save');
  await expectArea(await read(h), first, 'GET agrees with the save');
  const cleared = await expectArea(
    await save(h, 'alice', { place: null, revision: first.revision, key: OP2 }),
    { place: null, revision: 3 },
    'clear',
  );
  await expectArea(await read(h), cleared, 'GET agrees with the clear');
  const row = areaRow(h);
  assert.deepEqual([row.place_id, row.place, row.state, row.label, row.timezone, row.revision], [null, null, null, null, null, 3],
    'a cleared row is five nulls at the advanced revision');
  await expectArea(
    await save(h, 'alice', { place: MECK, revision: cleared.revision, key: '55555555-5555-4555-8555-555555555553' }),
    { place: MECK, revision: 4 },
    'the cleared revision is accepted next',
  );
  assert.equal(h.db.rows('explore_areas').length, 2, 'one row per household');
  assert.equal(areaRow(h, 'bob').revision, 7, 'bob untouched');
  const ledger = h.db.rows('operations');
  assert.equal(ledger.length, 3);
  for (const row of ledger) {
    assert.equal(row.domain, 'explore');
    assert.equal(row.kind, 'explore.area.save');
    assert.equal(row.status, 'succeeded');
  }
  assert.equal(ledger.find((row) => row.operation_id === OP).request_hash, requestHash({ place: WAKE, revision: 1 }), 'the ledger input is { place, revision } as sent');
  assert.deepEqual(h.blockedFetches, []);
});

test('the server stores and returns the gazetteer\'s place, never the client\'s own fields (D8)', async () => {
  const h = harness();
  const forged = { id: WAKE.id, place: 'Raleigh', state: 'SC', label: 'My house, 12 Elm St', timezone: 'Europe/Paris', extra: 'x' };
  await expectArea(await save(h, 'alice', { place: forged }), { place: WAKE, revision: 2 }, 'canonical, not the client\'s label');
  const row = areaRow(h);
  assert.deepEqual(
    [row.place_id, row.place, row.state, row.label, row.timezone],
    [WAKE.id, WAKE.place, WAKE.state, WAKE.label, WAKE.timezone],
    'the stored columns are the canonical five',
  );
  assert.equal(JSON.stringify(h.db.rows('explore_areas')).includes('Elm'), false);
  // Only the id is needed: a place carrying nothing else is the same save.
  await expectArea(await save(h, 'alice', { place: { id: MECK.id }, revision: 2, key: OP2 }), { place: MECK, revision: 3 }, 'id only');
  // A label 0022 would refuse (control character) cannot reach the table, so it cannot become a 500.
  await expectArea(
    await save(h, 'alice', { place: { ...WAKE, label: 'Wake\u0001'.repeat(100) }, revision: 3, key: '55555555-5555-4555-8555-555555555553' }),
    { place: WAKE, revision: 4 },
    'an unstorable client label is ignored',
  );
});

test('every malformed save is a 400 that touches neither the ledger nor the area', async () => {
  const h = harness({ alice: rowOf(WAKE, 2) });
  const before = snapshot(h);
  const cases = [
    [{ body: { place: WAKE, revision: 2, profile_id: h.identities.bob.id } }, 'profile_id', 'unknown_field'],
    [{ body: { place: WAKE, revision: 2, operationId: OP } }, 'operationId', 'unknown_field'],
    [{ body: { place: WAKE }, ifMatch: null }, 'revision', 'required'],
    [{ body: { revision: 2 } }, 'place', 'required'],
    [{ body: { place: WAKE, revision: 0 } }, 'revision', 'invalid_revision'],
    [{ body: { place: WAKE, revision: -1 } }, 'revision', 'invalid_revision'],
    [{ body: { place: WAKE, revision: 1.5 } }, 'revision', 'invalid_revision'],
    [{ body: { place: WAKE, revision: '2' } }, 'revision', 'invalid_revision'],
    [{ body: { place: WAKE, revision: null } }, 'revision', 'invalid_revision'],
    [{ body: { place: WAKE, revision: INT_MAX + 1 }, ifMatch: String(INT_MAX + 1) }, 'revision', 'invalid_revision'],
    [{ body: { place: WAKE, revision: 1e20 }, ifMatch: null }, 'revision', 'invalid_revision'],
    [{ body: { place: 'Wake County', revision: 2 } }, 'place', 'invalid_place'],
    [{ body: { place: 5, revision: 2 } }, 'place', 'invalid_place'],
    [{ body: { place: true, revision: 2 } }, 'place', 'invalid_place'],
    [{ body: { place: [WAKE], revision: 2 } }, 'place', 'invalid_place'],
    [{ body: { place: {}, revision: 2 } }, 'place', 'invalid_place'],
    [{ body: { place: { ...WAKE, id: 37183 }, revision: 2 } }, 'place', 'invalid_place'],
    [{ body: { place: { ...WAKE, id: 'us-county:99999' }, revision: 2 } }, 'place', 'unknown_place'],
    [{ body: { place: { ...WAKE, id: 'Wake County' }, revision: 2 } }, 'place', 'unknown_place'],
    [{ body: { place: { ...WAKE, id: 'us-county:45079' }, revision: 2 } }, 'place', 'unknown_place'],
    [{ place: WAKE, revision: 2, ifMatch: '3' }, 'revision', 'precondition_mismatch'],
    [{ place: WAKE, revision: 2, ifMatch: '"2"' }, 'revision', 'precondition_mismatch'],
    [{ place: WAKE, revision: 2, key: null }, 'Idempotency-Key', 'invalid_uuid'],
    [{ place: WAKE, revision: 2, key: '' }, 'Idempotency-Key', 'invalid_uuid'],
    [{ place: WAKE, revision: 2, key: 'not-a-uuid' }, 'Idempotency-Key', 'invalid_uuid'],
  ];
  for (const [options, field, code] of cases) {
    const label = JSON.stringify(options);
    const body = await expectEnvelope(await save(h, 'alice', { ifMatch: '2', ...options }), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [[field, code]], label);
    assertNoEmDash(body, label);
  }
  for (const rawBody of ['{', '[]', 'null', '"x"']) {
    const res = await save(h, 'alice', { rawBody, ifMatch: '2' });
    assert.equal(res.status, 400, rawBody);
  }
  assert.equal(snapshot(h), before, 'nothing changed');
  assert.equal(h.db.queryLog.length, 0, 'not a single statement for a refused shape');
});

test('2147483647 is a valid revision and never reaches the database as 2147483648; one more is a 400', async (t) => {
  const quiet = muteConsoleError(t);
  // No row: the area is at 1, so this is the ordinary stale revision, and nothing is written.
  const h = harness();
  await expectConflict(await save(h, 'alice', { revision: INT_MAX }), 'stale_revision', 'at the ceiling, no row', 1);
  assert.deepEqual(areaWrites(h), [], 'no insert or update was attempted');
  // A row at the ceiling cannot take another revision: refused, not a 500.
  const full = harness({ alice: rowOf(WAKE, INT_MAX) });
  const before = JSON.stringify(areaRow(full));
  await expectConflict(await save(full, 'alice', { place: MECK, revision: INT_MAX }), 'revision_exhausted', 'a full counter', INT_MAX);
  assert.deepEqual(areaWrites(full), [], 'no update that would raise 22003');
  assert.equal(JSON.stringify(areaRow(full)), before);
  await expectArea(await read(full), { place: WAKE, revision: INT_MAX }, 'the largest revision reads back');
  // Above the ceiling Postgres raises 22003, so it is refused before anything runs.
  const over = harness();
  const body = await expectEnvelope(await save(over, 'alice', { revision: INT_MAX + 1 }), { status: 400, code: 'validation_failed' });
  assert.deepEqual(body.field_errors.map((e) => e.field), ['revision']);
  assert.equal(over.db.queryLog.length, 0);
  assert.equal(quiet.mock.callCount(), 0, 'nothing failed on the way');
});

test('a stale revision is a 409 stale_revision carrying the current revision, and nothing is written', async () => {
  const h = harness({ alice: rowOf(WAKE, 5) });
  const before = JSON.stringify(areaRow(h));
  await expectConflict(await save(h, 'alice', { place: MECK, revision: 4 }), 'stale_revision', 'past', 5);
  await expectConflict(await save(h, 'alice', { place: MECK, revision: 9, key: OP2 }), 'stale_revision', 'future', 5);
  await expectConflict(await save(h, 'alice', { place: MECK, revision: 1, key: '55555555-5555-4555-8555-555555555553' }), 'stale_revision', 'a first save against an existing row', 5);
  assert.equal(JSON.stringify(areaRow(h)), before);
});

test('two saves at the same revision with different keys: one 200 and one 409', async () => {
  for (const alice of [null, rowOf(WAKE, 2)]) {
    const revision = alice ? 2 : 1;
    const h = harness({ alice });
    const [a, b] = await Promise.all([
      save(h, 'alice', { place: MECK, revision, key: OP }),
      save(h, 'alice', { place: GASTON, revision, key: OP2 }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], `from revision ${revision}`);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    const won = await expectArea(winner, { place: (await winner.clone().json()).place, revision: revision + 1 }, 'the winner');
    await expectConflict(loser, 'stale_revision', 'the loser', revision + 1);
    assert.deepEqual({ place: areaRow(h).place_id, revision: areaRow(h).revision }, { place: won.place.id, revision: revision + 1 });
  }
});

test('a replay with the same key and body answers the first outcome and writes nothing again', async () => {
  const h = harness();
  const first = await expectArea(await save(h, 'alice'), { place: WAKE, revision: 2 }, 'first');
  const writes = areaWrites(h).length;
  const stored = JSON.stringify(areaRow(h));
  await expectArea(await save(h, 'alice'), first, 'replay');
  assert.equal(areaWrites(h).length, writes, 'no second write');
  assert.equal(JSON.stringify(areaRow(h)), stored);
  // Even after the area moved on, the replay is the first outcome, not a conflict against its own write.
  await expectArea(await save(h, 'alice', { place: MECK, revision: 2, key: OP2 }), { place: MECK, revision: 3 }, 'a later save');
  await expectArea(await save(h, 'alice'), first, 'replay after the area moved on');
  assert.equal(h.db.rows('operations').length, 2);
});

test('the same key with a different body is 409 operation_mismatch, and nothing changes', async () => {
  const h = harness();
  await save(h, 'alice');
  const before = snapshot(h);
  for (const options of [{ place: MECK }, { place: null }, { place: { ...WAKE, label: 'Other' } }]) {
    await expectConflict(await save(h, 'alice', options), 'operation_mismatch', JSON.stringify(options));
  }
  await expectConflict(await save(h, 'alice', { revision: 2 }), 'operation_mismatch', 'a different revision');
  assert.equal(snapshot(h), before);
});

test('a replay after a conflict is the same 409', async () => {
  const h = harness({ alice: rowOf(WAKE, 5) });
  await expectConflict(await save(h, 'alice', { place: MECK, revision: 3 }), 'stale_revision', 'first', 5);
  await expectConflict(await save(h, 'alice', { place: MECK, revision: 3 }), 'stale_revision', 'replay', 5);
  assert.equal(h.db.rows('operations')[0].status, 'failed');
  assert.equal(areaRow(h).revision, 5);
});

/** A ledger row for alice's save of Wake at revision 1. */
const aliceSaveRow = (overrides) => ({
  operation_id: OP,
  profile_id: 'alice',
  domain: 'explore',
  kind: 'explore.area.save',
  request_hash: requestHash({ place: WAKE, revision: 1 }),
  ...overrides,
});

/** A replay that met an earlier attempt which is over: a terminal 409, never a 5xx, never stale_revision. */
async function assertIncompleteReplay(h, reason, label) {
  const body = await expectConflict(await save(h, 'alice'), reason, label);
  assert.notEqual(body.reason, 'stale_revision', `${label}: no revision was compared`);
  assert.match(body.message, /did not finish/, `${label}: the copy says what happened`);
  assert.equal(h.db.rows('operations').find((row) => row.operation_id === OP).status, 'failed');
  assert.equal(areaRow(h), null, `${label}: nothing was saved on the replay`);
}

test('a replay that meets a reaped row is 409 abandoned, whether reaped now or earlier (D9)', async () => {
  const h = harness({ operations: [aliceSaveRow({ status: 'pending', created_at: ago(10 * 60_000) })] });
  await assertIncompleteReplay(h, 'abandoned', 'reaped on this replay');
  assert.deepEqual(h.db.rows('operations')[0].result, { status: 'failed', reason: 'abandoned' });
  await assertIncompleteReplay(h, 'abandoned', 'replayed again after the reap');
  const earlier = harness({
    operations: [aliceSaveRow({ status: 'failed', result: { status: 'failed', reason: 'abandoned' }, created_at: ago(10 * 60_000) })],
  });
  await assertIncompleteReplay(earlier, 'abandoned', 'already reaped');
});

test('a replay that meets a failed row with no receipt is 409 attempt_failed, not a 503 for ever (D9)', async () => {
  const h = harness({ operations: [aliceSaveRow({ status: 'failed', result: null, created_at: ago(5_000) })] });
  await assertIncompleteReplay(h, 'attempt_failed', 'threw in process');
  await assertIncompleteReplay(h, 'attempt_failed', 'again');
  const odd = harness({ operations: [aliceSaveRow({ status: 'failed', result: { status: 'failed', reason: 'something_else' }, created_at: ago(5_000) })] });
  await assertIncompleteReplay(odd, 'attempt_failed', 'a reason this route never writes');
});

test('a replay of an attempt still inside its window is the retryable 503 (reaper-dependent: it settles later)', async () => {
  const h = harness({ operations: [aliceSaveRow({ status: 'pending', created_at: ago(1_000) })] });
  const body = await expectEnvelope(await save(h, 'alice'), { status: 503, code: 'upstream_unavailable', retryable: true });
  assertNoEmDash(body, 'in flight');
  assert.equal(areaRow(h), null, 'not saved a second time to find out');
  assert.equal(h.db.rows('operations')[0].status, 'pending');
});

test('an attempt that throws inside the operation is a 500, settles failed, and its replay is 409 attempt_failed', async (t) => {
  const quiet = muteConsoleError(t);
  const h = harness();
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name === 'explore_areas') builder.insert = () => { throw Object.assign(new Error('boom'), { code: 'XX000' }); };
    return builder;
  };
  await expectEnvelope(await save(h, 'alice'), { status: 500, code: 'internal_error' });
  assert.ok(quiet.mock.callCount() >= 1, 'the detail is logged');
  assert.deepEqual([h.db.rows('operations')[0].status, h.db.rows('operations')[0].result], ['failed', null]);
  h.db.from = from;
  await expectConflict(await save(h, 'alice'), 'attempt_failed', 'replay of the throw');
});

// ---------------------------------------------------------------------------
// Ownership and home context
// ---------------------------------------------------------------------------

test('A is invisible to B, B\'s save changes only B, and every statement is scoped to the caller', async () => {
  const h = harness({ alice: rowOf(WAKE, 3) });
  const aliceRow = JSON.stringify(areaRow(h));
  const bobBody = await expectArea(await read(h, 'bob'), { place: GASTON, revision: 7 }, 'bob reads only his own');
  assert.equal(JSON.stringify(bobBody).includes(WAKE.id), false);
  await expectArea(await save(h, 'bob', { place: MECK, revision: 7, key: BOB_OP }), { place: MECK, revision: 8 }, 'bob saves');
  assert.equal(JSON.stringify(areaRow(h)), aliceRow, 'alice untouched');
  await expectArea(await save(h, 'alice', { place: GASTON, revision: 3 }), { place: GASTON, revision: 4 }, 'alice saves');
  assert.equal(areaRow(h, 'bob').place_id, MECK.id, 'bob untouched');
  // Bob's operation id is not a door into his ledger row.
  const bobLedger = JSON.stringify(h.db.rows('operations').find((row) => row.operation_id === BOB_OP));
  await expectConflict(await save(h, 'alice', { place: MECK, revision: 7, key: BOB_OP }), 'operation_mismatch', 'a foreign key');
  assert.equal(JSON.stringify(h.db.rows('operations').find((row) => row.operation_id === BOB_OP)), bobLedger);
  assert.equal(h.db.rows('symptom_logs').length, 1, 'nothing outside the area and the ledger');
  // Each call in its own audit window: every statement on an owned table is filtered by, or writes, the caller.
  const audited = harness({ alice: rowOf(WAKE, 3) });
  for (const [who, call] of [
    ['alice', () => read(audited, 'alice')],
    ['alice', () => save(audited, 'alice', { place: MECK, revision: 3 })],
    ['alice', () => save(audited, 'alice', { place: MECK, revision: 3 })],
    ['alice', () => save(audited, 'alice', { place: GASTON, revision: 2, key: OP2 })],
    ['bob', () => save(audited, 'bob', { place: MECK, revision: 7, key: BOB_OP })],
    ['bob', () => read(audited, 'bob')],
  ]) {
    const start = audited.db.queryLog.length;
    await call();
    const statements = audited.db.queryLog.slice(start);
    const callerId = audited.identities[who].id;
    assert.ok(statements.some((q) => q.table === 'explore_areas'), who);
    auditOwnerScope(statements.filter((q) => q.table === 'explore_areas'), callerId, `${who} on explore_areas`);
    // The ledger: the claim writes the caller as owner, the replay read is owner scoped, and the
    // settle (lib/operations.js, by primary key) names only an id whose row is the caller's.
    for (const q of statements.filter((entry) => entry.table === 'operations')) {
      if (q.operation === 'update') {
        const ids = q.filters.filter((f) => f.type === 'cmp' && f.column === 'operation_id').map((f) => f.value);
        assert.equal(ids.length, 1, `${who}: a settle names one operation`);
        assert.equal(audited.db.rows('operations').find((row) => row.operation_id === ids[0]).profile_id, callerId, `${who}: and it is the caller's`);
      } else {
        auditOwnerScope([q], callerId, `${who} on operations`);
      }
    }
  }
});

test('a foreign X-Halo-Home-Context changes nothing: the area belongs to the household (D5)', async () => {
  const plain = harness();
  const withHeader = harness();
  const foreign = { 'x-halo-home-context': '99999999-9999-4999-8999-999999999999' };
  const bobContext = { 'x-halo-home-context': withHeader.identities.bob.id };
  await expectArea(await read(withHeader, 'alice', { headers: foreign }), await (await read(plain)).json(), 'read');
  await expectArea(await save(withHeader, 'alice', { headers: bobContext }), await (await save(plain, 'alice')).json(), 'save');
  assert.equal(areaRow(withHeader).place_id, WAKE.id);
  assert.equal(areaRow(withHeader, 'bob').place_id, GASTON.id, 'bob untouched');
  assert.deepEqual(
    withHeader.db.queryLog.map((q) => `${q.operation}:${q.table}`),
    plain.db.queryLog.map((q) => `${q.operation}:${q.table}`),
    'the same statements as without the header',
  );
});

// ---------------------------------------------------------------------------
// Unavailable
// ---------------------------------------------------------------------------

const without = (name) => Object.fromEntries(Object.entries(TABLES).filter(([table]) => table !== name));

test('without migration 0022 both verbs are a non-retryable 503 feature_unavailable, and no operation id is claimed', async () => {
  const h = harness({ tables: without('explore_areas') });
  const got = await expectEnvelope(await read(h), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!('place' in got), 'never a false never-saved area');
  await expectEnvelope(await save(h, 'alice'), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(h.db.rows('operations').length, 0, 'no ledger row');
  assert.equal(h.db.queryLog.some((q) => q.table === 'operations'), false, 'the ledger is not touched');
});

test('without migration 0017 a save is the same 503 and the area is untouched; the read still works', async () => {
  const h = harness({ tables: without('operations'), alice: rowOf(WAKE, 2) });
  const before = JSON.stringify(areaRow(h));
  await expectEnvelope(await save(h, 'alice', { place: MECK, revision: 2 }), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(JSON.stringify(areaRow(h)), before);
  assert.deepEqual(areaWrites(h), []);
  await expectArea(await read(h), { place: WAKE, revision: 2 }, 'the read needs no ledger (D7)');
});

test('the route source has no em dash and declares maxDuration under the ledger window', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'app/api/explore/area/route.js'), 'utf8');
  assert.equal(source.includes(EM_DASH), false);
  assert.match(source, /^export const maxDuration = 60;$/m);
});

// ---------------------------------------------------------------------------
// The client's consumption logic over the real handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------- transcribed (F: runtime.ts:11-13,46-48,91-97,107-159), types removed; the blob branch (:139), scopeKey and unused operations elided (unreachable for these operations)
class FrontendServiceError extends Error {
  constructor(code, message, operationId, retryAfter, fields) { super(message); this.code = code; this.operationId = operationId; this.retryAfter = retryAfter; this.fields = fields; this.name = 'FrontendServiceError'; }
}
const productionOperations = {
  'explore.area.save': {path:'/api/explore/area',method:'PATCH'},
  'explore.area.read': {path:'/api/explore/area'},
  'locations.search': {path:'/api/locations/search'},
};
const messages = {
  offline:'You are offline. Your changes are still here.', session:'Please reconnect your session to continue.',
  permission:'This action is not available for this account.', conflict:'This item changed. Review the latest version before saving.',
  validation:'Check the highlighted information and try again.', rate_limited:'Please wait before trying again.',
  unavailable:'This service is unavailable. Try again later.', invalid_response:'The service returned incomplete information. Please retry.',
  aborted:'Request cancelled.', unknown_outcome:'The result is not confirmed. Check its status before trying again.',
};
function serviceMessage(error) { return error instanceof FrontendServiceError ? error.message : messages.unavailable; }
function createProductionRuntime(input) {
  return { identityId:input.identityId, homeContextId:input.homeContextId, capabilities:input.capabilities ?? {},
    async request(operation, body, options = {}) {
      const endpoint = productionOperations[operation];
      if (!endpoint || input.publicAccess && !endpoint.public) throw new FrontendServiceError('permission',messages.permission);
      if (input.capabilities?.[operation]?.enabled === false) throw new FrontendServiceError('unavailable', messages.unavailable);
      const method = endpoint.method ?? 'GET', mutation = method !== 'GET';
      const operationId = mutation ? options.idempotencyKey ?? crypto.randomUUID() : undefined;
      const controller = new AbortController(); let sent = false;
      const abort = () => controller.abort(); options.signal?.addEventListener('abort',abort,{once:true});
      if(options.signal?.aborted) controller.abort();
      const timeout = setTimeout(abort,input.timeoutMs ?? 20_000);
      const bounded = (work) => new Promise((resolve,reject)=>{const stop=()=>reject(new DOMException('Request ended','AbortError'));controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();work.then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',stop));});
      const current = () => { if(input.active?.() === false) throw new FrontendServiceError('session',messages.session,operationId); if(controller.signal.aborted) throw new FrontendServiceError(sent && mutation ? 'unknown_outcome':'aborted',messages[sent && mutation ? 'unknown_outcome':'aborted'],operationId); };
      try {
        current();
        if(mutation&&input.writeAllowed?.()===false)throw new FrontendServiceError('permission','Reconnect your profile before making changes.');
        const credential = input.publicAccess ? null : await bounded(input.credential()); current();
        if(!input.publicAccess && (!credential || credential.identityId !== input.identityId)) throw new FrontendServiceError('session',messages.session,operationId);
        let path = endpoint.path;
        if(!mutation && body && typeof body==='object') {
          const query = new URLSearchParams();
          for(const [key,value] of Object.entries(body)) if(value !== undefined && value !== null) query.set(key,typeof value==='object'?JSON.stringify(value):String(value));
          if(query.size) path += `?${query}`;
        }
        const headers = {Accept:'application/json'};
        if(credential) headers.Authorization = `Bearer ${credential.accessToken}`;
        if(input.homeContextId && !input.publicAccess) headers['X-Halo-Home-Context'] = input.homeContextId;
        if(options.expectedRevision !== undefined) headers['If-Match'] = String(options.expectedRevision);
        if(operationId) headers['Idempotency-Key'] = operationId;
        const multipart=typeof FormData!=='undefined'&&body instanceof FormData;
        if(mutation&&!multipart) headers['Content-Type']='application/json';
        if(mutation&&input.writeAllowed?.()===false)throw new FrontendServiceError('permission','Reconnect your profile before making changes.');
        sent = true;
        const response = await bounded((input.fetcher ?? fetch)(path,{method,headers,body:mutation?(multipart?body:JSON.stringify(body ?? {})):undefined,signal:controller.signal,cache:'no-store',credentials:'same-origin',redirect:'error'}));
        current();
        const json = await bounded(response.json().catch(()=>null)); current();
        if(!response.ok) {
          const code = response.status===401?'session':response.status===403?'permission':response.status===409||response.status===412?'conflict':response.status===400||response.status===422?'validation':response.status===429?'rate_limited':response.status>=500&&mutation?'unknown_outcome':'unavailable';
          const retry=Number(response.headers.get('Retry-After')); throw new FrontendServiceError(code,messages[code],operationId,Number.isFinite(retry)&&retry>0?retry:undefined);
        }
        if(json===null || typeof json!=='object') throw new FrontendServiceError(mutation?'unknown_outcome':'invalid_response',messages[mutation?'unknown_outcome':'invalid_response'],operationId);
        if(Object.hasOwn(json,'data')) {
          const envelope=json;
          return (envelope.data && typeof envelope.data==='object' && !Array.isArray(envelope.data) && envelope.meta ? {...envelope.data,_meta:envelope.meta} : envelope.data);
        }
        return json;
      } catch(error) {
        if(error instanceof FrontendServiceError) throw error;
        const code=sent&&mutation?'unknown_outcome':controller.signal.aborted?'aborted':typeof navigator!=='undefined'&&!navigator.onLine?'offline':'unavailable';
        throw new FrontendServiceError(code,messages[code],operationId);
      } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort',abort); }
    },
  };
}
// ----------------------------------------------------------------

/** F: ExploreShared.tsx:24 */
const blankArea = { place: '', state: '' };

/**
 * One device's area chooser (F: ExploreDiscovery.tsx:31-61). `useHomeDraft`
 * keeps its drafts in in-memory session state (HomeWorkspaceSession, F:
 * components/homeguard/HomeWorkspaceState.tsx:51), so `drafts` survives a
 * remount of the chooser within the session, not a page reload, and is shared
 * by two choosers built over it; the React state of :40-43 is per chooser. The bodies
 * of the read effect (:45), applyPlace (:60, the lines in the try/catch
 * verbatim) and the parked view (:61) are the client's.
 */
function chooser(runtime, drafts = { area: blankArea, areaRevision: 0, areaOperation: null }) {
  const s = { drafts, busy: false, error: '', editing: true, closes: 0, scopeResets: 0, savedArea: { data: undefined, retries: 0 } };
  const setArea = (value) => { drafts.area = value; };
  const setAreaRevision = (value) => { drafts.areaRevision = value; };
  const setAreaOperation = (value) => { drafts.areaOperation = value; };
  const setBusy = (value) => { s.busy = value; };
  const setError = (value) => { s.error = value; };
  const setLocalAutoScope = () => { s.scopeResets += 1; };
  const close = () => { setBusy(false); s.editing = false; s.closes += 1; };
  const areaSetters = { current: { setArea, setAreaRevision, setAreaOperation } };
  const savedArea = s.savedArea;
  savedArea.retry = () => { savedArea.retries += 1; };
  s.load = async () => {
    // useProductionResource('explore.area.read',{},Boolean(runtime)) (:34), then the effect of :45.
    savedArea.data = await runtime.request('explore.area.read', {});
    if(!validDiscoveryArea(savedArea.data))return;areaSetters.current.setArea(savedArea.data.place??blankArea);areaSetters.current.setAreaRevision(savedArea.data.revision);if(savedArea.data.pendingOperation)areaSetters.current.setAreaOperation({...savedArea.data.pendingOperation,revision:savedArea.data.revision});
  };
  s.lookup = async (query, state = 'NC') => {
    const result = await runtime.request('locations.search', { query, state });
    assert.equal(validPlaces(result), true);
    return result.candidates;
  };
  s.applyPlace = async function applyPlace(place){
    const areaRevision = drafts.areaRevision, areaOperation = drafts.areaOperation, busy = s.busy;
    if(!runtime||busy)return;if(!areaRevision){setError('Your saved area could not load. Try again.');savedArea.retry();return;}if(areaOperation&&JSON.stringify(areaOperation.place)!==JSON.stringify(place)){setError('Check the previous area change before choosing another.');return;}const operation=areaOperation??{id:crypto.randomUUID(),place,revision:areaRevision};setAreaOperation(operation);setBusy(true);setError('');try{const result=await runtime.request('explore.area.save',{place:operation.place,revision:operation.revision},{idempotencyKey:operation.id,expectedRevision:operation.revision});if(!validDiscoveryArea(result))throw new Error('invalid saved area');setArea(result.place??blankArea);setAreaRevision(result.revision);setAreaOperation(null);setLocalAutoScope();close();}catch(error){if(error instanceof FrontendServiceError&&error.code!=='unknown_outcome')setAreaOperation(null);setError(serviceMessage(error));}finally{setBusy(false);}
  };
  /** :61, `runtime&&areaOperation&&!editing`: the chooser is locked on "Check saved area". */
  s.parked = () => !!(runtime && drafts.areaOperation && !s.editing);
  /** The "Check saved area" button of :61. */
  s.checkSavedArea = () => s.applyPlace(drafts.areaOperation.place);
  return s;
}

/**
 * The client's runtime over the real handlers. `faults` lets a test lose a
 * response after the server applied it (`after`), or have the request never
 * reach the handler while the server-side attempt is left in the ledger
 * (`before`), both of which the runtime reports as `unknown_outcome`.
 */
function clientRuntime(h, who, { homeContextId = null, faults = [], log = [] } = {}) {
  const fetcher = async (target, init) => {
    log.push({ target, method: init.method, headers: { ...init.headers }, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const fault = init.method === 'PATCH' ? faults.shift() : undefined;
    if (fault?.before) {
      await fault.before(init);
      throw new TypeError('fetch failed');
    }
    const routePath = target.split('?')[0];
    const res = await h.call(routePath, init.method, { url: target, rawBody: init.body, headers: init.headers });
    if (fault?.after) throw new TypeError('network connection lost');
    return res;
  };
  return createProductionRuntime({
    identityId: h.identities[who].id,
    homeContextId,
    credential: async () => ({ identityId: h.identities[who].id, accessToken: tokenFor(who) }),
    fetcher,
  });
}

/** What the server's ledger hashes for a body the client sent: `{ place, revision }` as sent. */
const ledgerRowFor = (h, init, overrides) => {
  const body = JSON.parse(init.body);
  return {
    operation_id: init.headers['Idempotency-Key'],
    profile_id: h.identities.alice.id,
    domain: 'explore',
    kind: 'explore.area.save',
    request_hash: requestHash({ place: body.place, revision: body.revision }),
    ...overrides,
  };
};
const insertLedger = async (h, row) => {
  const { error } = await h.db.from('operations').insert(row);
  assert.equal(error, null);
};

test('client: a never-saved read gives a usable revision, a search result saves, and the returned revision is the next If-Match', async () => {
  const h = harness();
  const log = [];
  const ui = chooser(clientRuntime(h, 'alice', { log, homeContextId: '99999999-9999-4999-8999-999999999999' }));
  await ui.load();
  assert.deepEqual(ui.drafts, { area: blankArea, areaRevision: 1, areaOperation: null }, 'revision 1 is truthy, so a save is allowed');
  const [wake] = await ui.lookup('Wake');
  assert.deepEqual(wake, WAKE);
  await ui.applyPlace(wake);
  assert.equal(ui.error, '', 'saved');
  assert.deepEqual(ui.drafts, { area: WAKE, areaRevision: 2, areaOperation: null });
  assert.equal(ui.closes, 1, 'the sheet closed');
  assert.equal(ui.parked(), false);
  ui.editing = true;
  const [meck] = await ui.lookup('Mecklenburg County');
  await ui.applyPlace(meck);
  assert.deepEqual(ui.drafts, { area: MECK, areaRevision: 3, areaOperation: null });
  ui.editing = true;
  await ui.applyPlace(null);
  assert.deepEqual(ui.drafts, { area: blankArea, areaRevision: 4, areaOperation: null }, 'clear');
  const saves = log.filter((entry) => entry.method === 'PATCH');
  assert.deepEqual(saves.map((entry) => [entry.headers['If-Match'], entry.body.revision]), [['1', 1], ['2', 2], ['3', 3]],
    'each save carried the revision the previous one returned');
  for (const entry of saves) assert.match(entry.headers['Idempotency-Key'], UUID);
  // A reload reads what was saved.
  const reloaded = chooser(clientRuntime(h, 'alice'));
  await reloaded.load();
  assert.deepEqual(reloaded.drafts, { area: blankArea, areaRevision: 4, areaOperation: null });
});

test('client: a lost response parks the operation, and the replay unparks it with the first outcome', async () => {
  const h = harness();
  const drafts = { area: blankArea, areaRevision: 0, areaOperation: null };
  const ui = chooser(clientRuntime(h, 'alice', { faults: [{ after: true }] }), drafts);
  await ui.load();
  await ui.applyPlace(WAKE);
  assert.equal(ui.error, messages.unknown_outcome);
  assert.ok(drafts.areaOperation, 'parked, because the outcome is not known');
  ui.editing = false;
  assert.equal(ui.parked(), true, 'the chooser shows "Check saved area"');
  assert.equal(areaRow(h).revision, 2, 'the server did apply it');
  // A remount of the chooser keeps the session's draft, reads the new revision, and the button replays the same operation.
  const after = chooser(clientRuntime(h, 'alice'), drafts);
  after.editing = false;
  await after.load();
  assert.equal(drafts.areaRevision, 2);
  assert.equal(after.parked(), true);
  await after.checkSavedArea();
  assert.equal(after.error, '');
  assert.deepEqual(drafts, { area: WAKE, areaRevision: 2, areaOperation: null }, 'the replay is the first outcome, not a conflict');
  assert.equal(after.parked(), false);
  assert.equal(h.db.rows('operations').length, 1);
  assert.equal(areaRow(h).revision, 2, 'and nothing was written twice');
});

test('client: a replay that meets a reaped or receipt-less failed row is a conflict that unparks the chooser', async () => {
  for (const [label, overrides, reason] of [
    ['reaped on replay', { status: 'pending', created_at: ago(10 * 60_000) }, 'abandoned'],
    ['already reaped', { status: 'failed', result: { status: 'failed', reason: 'abandoned' }, created_at: ago(10 * 60_000) }, 'abandoned'],
    ['threw with no receipt', { status: 'failed', result: null, created_at: ago(5_000) }, 'attempt_failed'],
  ]) {
    const h = harness();
    const drafts = { area: blankArea, areaRevision: 0, areaOperation: null };
    // The first attempt reached a process that claimed the id and died: its row is all that is left.
    const ui = chooser(clientRuntime(h, 'alice', { faults: [{ before: (init) => insertLedger(h, ledgerRowFor(h, init, overrides)) }] }), drafts);
    await ui.load();
    await ui.applyPlace(WAKE);
    assert.equal(ui.error, messages.unknown_outcome, label);
    ui.editing = false;
    assert.equal(ui.parked(), true, `${label}: parked`);
    const log = [];
    const replay = chooser(clientRuntime(h, 'alice', { log }), drafts);
    replay.editing = false;
    await replay.checkSavedArea();
    assert.equal(replay.error, messages.conflict, `${label}: the client is told to review, not "not confirmed"`);
    assert.equal(drafts.areaOperation, null, `${label}: the parked operation is cleared`);
    assert.equal(replay.parked(), false, `${label}: the chooser is usable again`);
    assert.deepEqual(drafts.area, blankArea, `${label}: nothing is shown as saved`);
    assert.equal(areaRow(h), null, `${label}: nothing was saved`);
    assert.equal(h.db.rows('operations')[0].status, 'failed');
    const res = await save(h, 'alice', { place: WAKE, revision: 1, key: log[0].headers['Idempotency-Key'] });
    await expectConflict(res, reason, label);
    // The person can choose again, and it saves.
    await replay.load();
    replay.editing = true;
    await replay.applyPlace(MECK);
    assert.deepEqual(drafts, { area: MECK, areaRevision: 2, areaOperation: null }, `${label}: a fresh save works`);
  }
});

test('client: a conflict clears the parked operation, and a re-read lets the next save through', async () => {
  const h = harness();
  const phone = chooser(clientRuntime(h, 'alice'));
  const laptop = chooser(clientRuntime(h, 'alice'));
  await phone.load();
  await laptop.load();
  await laptop.applyPlace(WAKE);
  assert.equal(laptop.drafts.areaRevision, 2);
  await phone.applyPlace(MECK);
  assert.equal(phone.error, messages.conflict);
  assert.equal(phone.drafts.areaOperation, null, 'a 409 is not unknown_outcome, so nothing stays parked');
  assert.deepEqual(phone.drafts.area, blankArea, 'and nothing is shown as saved');
  await phone.load();
  assert.deepEqual(phone.drafts.area, WAKE, 'the re-read shows the other device\'s save');
  await phone.applyPlace(MECK);
  assert.equal(phone.error, '');
  assert.deepEqual(phone.drafts, { area: MECK, areaRevision: 3, areaOperation: null });
  assert.deepEqual(h.blockedFetches, []);
});
