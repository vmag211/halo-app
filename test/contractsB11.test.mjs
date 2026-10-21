/**
 * B11 Homeguard workspace: the executable contract, and conformance of the
 * REAL handlers to it and to the frontend's own consumption logic.
 *
 * The per-route suites (routesWorkspace, routesWorkspaceDb) prove each route on
 * its own terms. This file proves the three operations agree with the
 * document, with the client and with each other:
 *
 *   - with the CLIENT. The frontend's runtime (`createProductionRuntime`, its
 *     status mapping and unwrap) and home adapter (`createHomeAdapter`) are
 *     the client's own compiled modules, and so are its validators
 *     (`validHomeRecords`, `validHomeChanges`, `homeReceiptCoversCommand`,
 *     `validProductionCollection`, `recordFingerprint`). What the screen does
 *     with an answer is the provider's decisions, transcribed once in
 *     test/helpers/frontendB11.mjs from HomeWorkspaceState.tsx. Every answer,
 *     real or fixture, is run through that code and the test asserts what
 *     Homeguard then HOLDS: the rows, the sentence, and whether it is locked
 *     on an operation. Never only the body's shape;
 *   - with the DATABASE. Below the routes everything is real: migration
 *     0026's functions and the 0017 ledger on PGlite (test/helpers/workspaceWorld.mjs);
 *   - with EACH OTHER. A save's receipt, the next load and the reconcile of
 *     that save must show the same rows;
 *   - with the DOCUMENT, `docs/backend/contracts/b11.openapi.json`, which is
 *     what a reader will believe. Every fixture under
 *     `docs/backend/contracts/fixtures/b11/` is the normalised answer a real
 *     handler produced in this file (with the command that led to it, as
 *     `request`), and the last tests fail if one drifts.
 *
 * A fixture is replayed through the client by a fetcher that answers with the
 * fixture's status and body, with the operation id swapped for the id the
 * client generated (the client rejects a receipt for any other id). The
 * stand-in command used when a fixture has no request (an unparseable or
 * oversized body) is a plain test write.
 *
 * Declared seams: the provider never sends a write for a collection that has
 * not loaded `ready`, so the two refusals for weekJournal and homeTransitions
 * are replayed through the adapter alone (the adapter still has to accept the
 * receipt); `navigator.onLine` is true and no request is aborted.
 *
 * Run `node test/contractsB11.test.mjs --write-b11-fixtures` to rewrite the
 * fixtures from the handlers after a deliberate contract change.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { loggedText } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { createWorld, sampleRecord, LOAD, COMMANDS, OPERATIONS } from './helpers/workspaceWorld.mjs';
import { homeWorkspace, validProductionCollection, homeReceiptCoversCommand, validHomeChanges, recordFingerprint } from './helpers/frontendB11.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { requestHash } = await import('../lib/operations.js');
const store = await import('../lib/workspaceStore.js');
const { featureDisabledReason } = await import('../lib/features.js');
const { REFUSALS, STORED_COLLECTIONS, UNSTORED_COLLECTIONS, WORKSPACE_COLLECTIONS, LIMITS, INCOMPLETE_MESSAGE, IN_FLIGHT_MESSAGE } = store;
const { createProductionRuntime, productionOperations } = await loadFrontend('production/runtime');
const { createHomeAdapter } = await loadFrontend('production/adapters');

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b11.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b11', components: contract.components });
const operations = new Map(
  Object.entries(contract.paths).flatMap(([route, verbs]) =>
    Object.entries(verbs).map(([method, op]) => [op.operationId, { ...op, path: route, method: method.toUpperCase() }])),
);
const validators = new Map();
function compiled(ref) {
  if (!validators.has(ref)) validators.set(ref, ajv.compile({ $ref: `urn:halo:b11${ref}` }));
  return validators.get(ref);
}
const schema = (name) => compiled(`#/components/schemas/${name}`);
/** The documented response for this operation and status, applied to a real or fixture body. */
function validate(operationId, status, body) {
  const op = operations.get(operationId);
  assert.ok(op, `unknown operation ${operationId}`);
  const response = op.responses[String(status)];
  assert.ok(response, `${operationId}: undocumented status ${status}`);
  const check = compiled(response.content['application/json'].schema.$ref);
  assert.equal(check(body), true, `${operationId} ${status}: ${ajv.errorsText(check.errors)}`);
  if (status >= 400) assertEnvelope(operationId, status, body);
}
/**
 * What the shared ErrorEnvelope schema cannot say: which `code` and `retryable`
 * go with which status, that `error` repeats `message`, and that field_errors
 * are present exactly for validation_failed. A swapped code (a 401 saying
 * `conflict`) passes the schema and the client alike (it reads the status), so
 * this is the only place it is caught.
 */
const ENVELOPES = {
  400: [['bad_request', false, false], ['validation_failed', false, true]],
  401: [['auth_required', false, false]],
  404: [['not_found', false, false]],
  409: [['conflict', false, false]],
  413: [['payload_too_large', false, false]],
  500: [['internal_error', true, false]],
  503: [['auth_unavailable', true, false], ['feature_unavailable', false, false], ['upstream_unavailable', true, false]],
};
const UNAVAILABLE_BODY = await store.workspaceUnavailable('contract-0001').json();
function assertEnvelope(operationId, status, body) {
  const allowed = ENVELOPES[status];
  assert.ok(allowed, `${operationId}: ${status} has no known envelope`);
  const shape = [body.code, body.retryable, body.field_errors.length > 0];
  assert.ok(allowed.some((item) => item.every((value, index) => value === shape[index])), `${operationId} ${status}: code/retryable/field_errors ${JSON.stringify(shape)} do not go with this status`);
  assert.equal(body.error, body.message, `${operationId} ${status}: error repeats message`);
  if (body.code === 'feature_unavailable') assert.equal(body.message, UNAVAILABLE_BODY.message, `${operationId}: the unavailable sentence`);
  if (status === 503 && operationId !== 'workspaceExecute') assert.notEqual(body.code, 'upstream_unavailable', `${operationId}: a read is never in flight`);
}
/** The documented REQUEST body, applied to one a test is about to send. */
function validateRequest(command) {
  const check = compiled(operations.get('workspaceExecute').requestBody.content['application/json'].schema.$ref);
  assert.equal(check(command), true, `request: ${ajv.errorsText(check.errors)}`);
}
/** Every row of a named collection against that collection's own schema. */
function validateRows(collection, rows) {
  const check = schema(`Record_${collection}`);
  for (const row of rows) assert.equal(check(row), true, `${collection} row ${row.id}: ${ajv.errorsText(check.errors)}`);
}

const FIXTURE_DIR = new URL('../docs/backend/contracts/fixtures/b11/', import.meta.url);
const WRITE_FIXTURES = process.argv.includes('--write-b11-fixtures');
const fixtures = existsSync(FIXTURE_DIR)
  ? await Promise.all(
    (await readdir(FIXTURE_DIR))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8')) })),
  )
  : [];

const EM_DASH = String.fromCharCode(0x2014);
/** On every B11 body: no top-level data key (runtime.ts:149-153 would unwrap it), no U+2014 literal or escaped. */
function assertBare(body, label) {
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), `${label}: an object body`);
  assert.equal(Object.hasOwn(body, 'data'), false, `${label}: no top-level data key (runtime.ts:149-153)`);
  const text = JSON.stringify(body);
  assert.equal(text.includes(EM_DASH), false, `${label}: no U+2014`);
  assert.equal(text.toLowerCase().includes('\\u2014'), false, `${label}: no escaped U+2014`);
}

const SAVED = 'Saved.';
const MARKER = 'PRIVATE-B11-MARKER the old pipes behind the kitchen wall';
const REQUEST_ID = 'b11-contract-0001';
const CREATED_AT = '2026-10-20T12:00:00.000Z';
const OFF = { HALO_FEATURE_WORKSPACE: 'off' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOME = '0b110000-0000-4000-8000-0000000000aa';

/** The sentences runtime.ts:91-97 gives each failure code (drift-tested against the file below). */
const SENTENCE = {
  session: 'Please reconnect your session to continue.',
  validation: 'Check the highlighted information and try again.',
  conflict: 'This item changed. Review the latest version before saving.',
  unavailable: 'This service is unavailable. Try again later.',
  unknown_outcome: 'The result is not confirmed. Check its status before trying again.',
};
/** runtime.ts:144 for a status, on a read or a mutation. */
const failureSentence = (status, mutation) => (status === 401 ? SENTENCE.session
  : status === 409 || status === 412 ? SENTENCE.conflict
    : status === 400 || status === 422 ? SENTENCE.validation
      : status >= 500 && mutation ? SENTENCE.unknown_outcome : SENTENCE.unavailable);
const STILL_UNAVAILABLE = 'Save status is still unavailable. Your draft remains here. Do not repeat the change.';
const LOCKED_SENTENCE = 'Check the pending save status before making another change. Your draft is kept.';

// ---------------------------------------------------------------------------
// The client, fed an answer
// ---------------------------------------------------------------------------

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...(body?.code === 'auth_unavailable' ? { 'retry-after': '2' } : {}) },
});
const snapshotOf = (records) => ({ records, availability: records.length ? 'ready' : 'empty', complete: true, pendingOperations: [] });
const lockedIds = (ws) => ws.state.unknownOperations.map((item) => item.operationId);

/**
 * Homeguard on the client's own runtime and adapter, over a fetcher that
 * answers from `seed` (the loads) and from the given answers.
 */
function replayWorkspace({ seed = {}, load, execute, reconcile } = {}) {
  const sentLog = [];
  const fetcher = async (target, init) => {
    const url = new URL(target, 'http://halo.test');
    if (url.pathname === LOAD) {
      const collection = url.searchParams.get('collection');
      return load ? load(collection) : jsonResponse(200, snapshotOf(seed[collection] ?? []));
    }
    if (url.pathname === COMMANDS) {
      const sent = JSON.parse(init.body);
      sentLog.push({ body: sent, headers: init.headers, method: init.method });
      return execute(sent);
    }
    if (url.pathname === OPERATIONS) {
      sentLog.push({ reconcile: { operationId: url.searchParams.get('operationId'), domain: url.searchParams.get('domain'), method: init.method ?? 'GET' } });
      return reconcile(url.searchParams.get('operationId'));
    }
    throw new Error(`replay: unexpected request ${target}`);
  };
  const runtime = createProductionRuntime({
    identityId: 'replay', homeContextId: HOME, contextRevision: 1,
    credential: async () => ({ identityId: 'replay', accessToken: 'replay-token' }), fetcher,
  });
  const adapter = createHomeAdapter(runtime, { currentHomeId: HOME, homes: [{ id: HOME, label: 'Current home', state: 'current', revision: 1 }] });
  return { ws: homeWorkspace(adapter), adapter, sentLog };
}

/**
 * The client's own request is the fixture's `request` (operation id aside), on
 * the route the document names, with the headers the document lists: so a
 * client that changed what it sends, or a fixture that was written by hand,
 * cannot pass.
 */
function assertSentAsRecorded(sentLog, request, label) {
  assert.equal(sentLog.length, 1, `${label}: the client sent exactly one command`);
  const [{ body, headers, method }] = sentLog;
  const { operationId, ...rest } = body;
  assert.equal(method, 'POST', label);
  assert.match(operationId, UUID, `${label}: the client's own operation id`);
  // Two fields are not compared: the record's own revision (the server ignores it, Ruling W12; the 400 fixtures
  // are written with an arbitrary one) and a clear's fingerprint (computed by the client from what it holds).
  const comparable = (input) => {
    const command = { ...input };
    delete command.operationId;
    const { expectedFingerprint } = command;
    delete command.expectedFingerprint;
    if (expectedFingerprint !== undefined) assert.equal(typeof expectedFingerprint, 'string', label);
    if (command.record) command.record = { ...command.record, revision: undefined };
    return command;
  };
  assert.deepEqual(comparable({ ...rest }), comparable({ ...request }), `${label}: the client sends exactly the command the fixture records`);
  assert.equal(headers['Idempotency-Key'], operationId, `${label}: Idempotency-Key is the operation id`);
  const expected = request.kind === 'write' || request.kind === 'remove' ? request.expectedRevision : null;
  // The precondition travels as X-Halo-If-Match (lib/ifMatch.js: Vercel's edge 412s a committed 2xx on If-Match).
  assert.equal(headers['X-Halo-If-Match'], expected === null || expected === undefined ? undefined : String(expected), `${label}: X-Halo-If-Match is the expected revision, or absent`);
  assert.equal(headers['If-Match'], undefined, `${label}: never a standard If-Match`);
  assert.equal(headers['Content-Type'], 'application/json', label);
  assert.match(headers.Authorization, /^Bearer /, label);
}
/** A recorded answer, with the operation id the client generated swapped in. */
const answer = (status, body) => (operationId) => jsonResponse(status, body && Object.hasOwn(body, 'operationId') ? { ...body, operationId } : body);

const STAND_IN = () => ({ kind: 'write', collection: 'tests', record: sampleRecord('tests', { id: 'test-stand-in', homeContextId: HOME }), expectedRevision: null });

/** The loads the command's collections need, so the client holds the record it is about to change. */
function seedFor(request) {
  if (request.kind === 'write' && request.expectedRevision !== null && STORED_COLLECTIONS.includes(request.collection)) {
    return { [request.collection]: [sampleRecord(request.collection, { id: request.record.id, homeContextId: HOME, revision: request.expectedRevision })] };
  }
  if (request.kind === 'remove' && STORED_COLLECTIONS.includes(request.collection)) {
    return { [request.collection]: [sampleRecord(request.collection, { id: request.recordId, homeContextId: HOME, revision: request.expectedRevision })] };
  }
  if (request.kind === 'remove-notes') {
    return { exploreNotes: request.selection.map((item) => sampleRecord('exploreNotes', { id: item.id, revision: item.revision })) };
  }
  return {};
}
const collectionsOf = (request) => (request.kind === 'remove-notes' ? ['exploreNotes'] : request.kind === 'clear-private' ? ['tests'] : [request.collection]);

/** Loads what the command touches, then makes the same change through the provider. */
async function perform(ws, request) {
  await ws.loadAll(collectionsOf(request).filter((name) => STORED_COLLECTIONS.includes(name)));
  const before = structuredClone(ws.records);
  const ok = await (() => {
    switch (request.kind) {
      case 'write': return ws.write(request.collection, { ...request.record, revision: request.expectedRevision ?? 0 });
      case 'remove': return ws.remove(request.collection, request.recordId, request.expectedRevision);
      case 'remove-notes': return ws.removeNotes(request.selection);
      default: return ws.clearPrivate(request.scope ?? 'all', recordFingerprint(ws.records, request.scope ?? 'all'), false);
    }
  })();
  return { ok, before };
}

/**
 * What Homeguard holds after the client reads this answer. `request` is the
 * fixture's request: a collection for a load, a command for the others.
 */
async function assertClient(operationId, status, body, request, label) {
  if (operationId === 'workspaceLoad') {
    const { collection } = request;
    const { ws } = replayWorkspace({ load: () => jsonResponse(status, body) });
    await ws.loadCollection(collection);
    const state = ws.status(collection);
    if (status === 200 && body.availability !== 'unavailable') {
      assert.equal(state.status, 'ready', `${label}: the collection is ready`);
      assert.equal(state.complete, true, `${label}: complete`);
      assert.deepEqual(ws.records[collection], body.records, `${label}: Homeguard holds the rows`);
      assert.ok(validProductionCollection(collection, ws.records[collection]), `${label}: the client's own row check accepts them`);
    } else if (status === 200) {
      assert.equal(state.status, 'error', `${label}: an unavailable collection is an error state`);
      assert.equal(state.message, body.message, `${label}: it shows the server's sentence`);
      assert.equal(ws.records[collection], undefined, `${label}: and holds nothing`);
    } else {
      assert.equal(state.status, 'error', `${label}: a failed load is an error state`);
      assert.equal(state.message, failureSentence(status, false), `${label}: the client's own sentence`);
      assert.equal(ws.records[collection], undefined);
    }
    const pending = status === 200 ? body.pendingOperations.map((item) => item.operationId) : [];
    assert.deepEqual(lockedIds(ws), pending, `${label}: locked on exactly the listed pending operations`);
    assert.equal(ws.canMutate(), pending.length === 0, `${label}: canMutate`);
    return;
  }

  const command = request ?? STAND_IN();
  const unstored = command.collection !== undefined && UNSTORED_COLLECTIONS[command.collection] !== undefined;
  if (operationId === 'workspaceExecute') {
    if (unstored) {
      // The provider would not send this (a collection that is not ready); the adapter still has to take the answer.
      const { adapter } = replayWorkspace({ execute: (sent) => answer(status, body)(sent.operationId) });
      const receipt = await adapter.execute({ ...command, operationId: crypto.randomUUID() }, new AbortController().signal);
      assert.equal(receipt.status, 'failed', label);
      assert.deepEqual(receipt.changes, {}, label);
      assert.equal(receipt.message, body.message, label);
      return;
    }
    const { ws, sentLog } = replayWorkspace({ seed: seedFor(command), execute: (sent) => answer(status, body)(sent.operationId) });
    const { ok, before } = await perform(ws, command);
    const [sentId] = ws.state.operationIds;
    if (request !== undefined) assertSentAsRecorded(sentLog, request, label);
    if (status === 200 && body.status === 'succeeded') {
      assert.equal(ok, true, `${label}: the save is confirmed`);
      assert.equal(ws.state.message, SAVED);
      assert.deepEqual(lockedIds(ws), [], `${label}: unlocked`);
      for (const [key, rows] of Object.entries(body.changes)) assert.deepEqual(ws.records[key], rows, `${label}: Homeguard holds ${key} as the receipt says`);
    } else if (status === 200) {
      assert.equal(ok, false, `${label}: a refusal is not a save`);
      assert.equal(ws.state.message, body.message, `${label}: the server's sentence`);
      assert.deepEqual(lockedIds(ws), [], `${label}: a refusal does not lock`);
      assert.deepEqual(ws.records, before, `${label}: nothing held changed`);
      assert.equal(ws.canMutate(), true);
    } else if (status >= 500) {
      assert.equal(ok, false, label);
      assert.equal(ws.state.message, SENTENCE.unknown_outcome, label);
      assert.deepEqual(lockedIds(ws), [sentId], `${label}: a 5xx on a mutation locks Homeguard on that operation`);
      assert.equal(ws.canMutate(), false);
      assert.deepEqual(ws.records, before);
    } else {
      assert.equal(ok, false, label);
      assert.equal(ws.state.message, failureSentence(status, true), `${label}: the client's own sentence`);
      assert.deepEqual(lockedIds(ws), [], `${label}: a ${status} does not lock`);
      assert.deepEqual(ws.records, before);
    }
    return;
  }

  // operations.read: the command was sent, its answer lost, and now its status is checked.
  const { ws, sentLog } = replayWorkspace({
    seed: seedFor(command),
    execute: () => jsonResponse(500, { error: 'lost' }),
    reconcile: (id) => answer(status, body)(id),
  });
  const { ok: sentOk, before } = await perform(ws, command);
  assert.equal(sentOk, false, `${label}: the lost answer is not a save`);
  const [id] = ws.state.operationIds;
  assert.deepEqual(lockedIds(ws), [id], `${label}: locked before the check`);
  const reconciled = await ws.reconcile(id);
  assert.deepEqual(sentLog.filter((item) => item.reconcile).map((item) => item.reconcile), [{ operationId: id, domain: 'workspace', method: 'GET' }], `${label}: the check asks about the operation it sent, in the workspace domain`);
  if (status === 200 && body.status === 'succeeded') {
    assert.equal(reconciled, true, `${label}: the check confirms the save`);
    assert.equal(ws.state.message, SAVED);
    assert.deepEqual(lockedIds(ws), []);
    for (const [key, rows] of Object.entries(body.changes)) assert.deepEqual(ws.records[key], rows, `${label}: Homeguard holds ${key}`);
  } else if (status === 200 && body.status === 'failed') {
    assert.equal(reconciled, false);
    assert.equal(ws.state.message, body.message, `${label}: the sentence the server wrote`);
    assert.deepEqual(lockedIds(ws), [], `${label}: a failed save no longer locks`);
    assert.deepEqual(ws.records, before);
  } else if (status === 200) {
    assert.equal(reconciled, false);
    assert.equal(ws.state.message, body.message, label);
    assert.deepEqual(lockedIds(ws), [id], `${label}: still locked, honestly unconfirmed`);
  } else {
    assert.equal(reconciled, false);
    assert.equal(ws.state.message, STILL_UNAVAILABLE, `${label}: the check itself failed`);
    assert.deepEqual(lockedIds(ws), [id], `${label}: the lock stays`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures against the document and the client
// ---------------------------------------------------------------------------

for (const fixture of fixtures) {
  test(`B11 fixture: ${fixture.name}`, () => {
    validate(fixture.operationId, fixture.status, fixture.body);
    assertBare(fixture.body, fixture.name);
    if (fixture.operationId === 'workspaceLoad' && fixture.status === 200 && STORED_COLLECTIONS.includes(fixture.request.collection)) validateRows(fixture.request.collection, fixture.body.records);
    if (fixture.operationId === 'workspaceExecute' && fixture.request && fixture.status !== 400) validateRequest(fixture.request);
  });
}

// ---------------------------------------------------------------------------
// The contract's own coverage
// ---------------------------------------------------------------------------

test('B11 contract covers the three operations, and every documented status has a fixture', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, 'b11-1');
  assert.deepEqual([...operations.keys()].sort(), ['operationsRead', 'workspaceExecute', 'workspaceLoad']);
  assert.deepEqual(Object.fromEntries([...operations].map(([id, op]) => [id, `${op.method} ${op.path} ${op['x-halo-operation']}`])), {
    workspaceLoad: 'GET /api/frontend/workspace workspace.load',
    workspaceExecute: 'POST /api/frontend/workspace/commands workspace.execute',
    operationsRead: 'GET /api/operations operations.read',
  });
  for (const [id, op] of operations) {
    for (const status of Object.keys(op.responses)) {
      assert.ok(fixtures.some((item) => item.operationId === id && String(item.status) === status), `${id} is missing a ${status} fixture`);
    }
    assert.ok(op.responses['401'] && op.responses['503'], `${id}: a session is required, so 401 and the outage are documented`);
    for (const code of ['auth_unavailable', 'feature_unavailable']) {
      assert.ok(fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === code), `${id} is missing the ${code} fixture`);
    }
  }
  // Every 409 reason on the commands route, enumerated, described and fixtured; the in-flight 503.
  assert.deepEqual([...contract.components.schemas.ConflictEnvelope.properties.reason.enum].sort(), ['abandoned', 'not_applied', 'operation_mismatch', 'unrecognized_receipt']);
  for (const reason of contract.components.schemas.ConflictEnvelope.properties.reason.enum) {
    assert.ok(fixtures.some((item) => item.operationId === 'workspaceExecute' && item.status === 409 && item.body.reason === reason), `a ${reason} fixture`);
    assert.ok(contract.components.schemas.ConflictEnvelope.description.includes(reason));
  }
  assert.ok(fixtures.some((item) => item.operationId === 'workspaceExecute' && item.status === 503 && item.body.code === 'upstream_unavailable' && item.body.retryable === true), 'the in-flight 503');
  // Every refusal reason has a 200 fixture, and the disabled receipt has none.
  assert.deepEqual([...contract.components.schemas.WorkspaceReceiptRefused.properties.reason.enum].sort(), Object.keys(REFUSALS).sort());
  for (const reason of Object.keys(REFUSALS)) {
    assert.ok(fixtures.some((item) => item.operationId === 'workspaceExecute' && item.status === 200 && item.body.reason === reason), `a ${reason} receipt fixture`);
  }
  assert.ok(fixtures.some((item) => item.operationId === 'workspaceExecute' && item.status === 200 && !('reason' in item.body) && item.body.status === 'failed'), 'the disabled receipt');
  // The four reconcile shapes.
  for (const status of ['succeeded', 'failed', 'pending']) {
    assert.ok(fixtures.some((item) => item.operationId === 'operationsRead' && item.status === 200 && item.body.status === status), `a reconcile fixture for ${status}`);
  }
  const reconciled = fixtures.find((item) => item.name === 'operationsRead-workspace-succeeded.json').body;
  assert.deepEqual(reconciled.unresolvedOperations, [], 'a stored receipt carries [] (S14)');
  // Request headers, with the rule each carries.
  const headers = Object.fromEntries(operations.get('workspaceExecute').parameters.filter((p) => p.in === 'header').map((p) => [p.name, p]));
  assert.equal(headers['Idempotency-Key']?.required, true);
  assert.equal(headers['Idempotency-Key'].schema.format, 'uuid');
  assert.equal(headers['If-Match']?.required, false);
  assert.match(headers['If-Match'].description, /precondition_mismatch/);
  assert.match(headers['X-Halo-Home-Context'].description, /IGNORED/);
  for (const [name, item] of Object.entries(contract.components.schemas)) {
    assert.equal(Object.hasOwn(item.properties ?? {}, 'data'), false, `${name} declares no data property`);
  }
  assert.equal(JSON.stringify(contract).includes(EM_DASH), false, 'no U+2014 anywhere in the document');
});

test('the contract\'s collections, refusals, sentences and limits are exactly the library\'s', () => {
  const schemas = contract.components.schemas;
  assert.deepEqual(operations.get('workspaceLoad').parameters.find((p) => p.name === 'collection').schema.enum, [...WORKSPACE_COLLECTIONS]);
  assert.deepEqual(Object.keys(schemas.Changes.properties), [...STORED_COLLECTIONS]);
  assert.deepEqual(schemas.Record.anyOf.map((item) => item.$ref.split('Record_')[1]), [...STORED_COLLECTIONS]);
  assert.deepEqual(schemas.WorkspaceWrite.properties.collection.enum, [...WORKSPACE_COLLECTIONS]);
  assert.deepEqual(schemas.WorkspaceOperationSucceeded.properties.collections.items.enum, [...STORED_COLLECTIONS]);
  // Each reason: its code and its sentence are the library's.
  for (const [reason, refusal] of Object.entries(REFUSALS)) {
    const rule = schemas.WorkspaceReceiptRefused.allOf.find((item) => item.if.properties.reason.const === reason);
    assert.ok(rule, `${reason} has a rule`);
    assert.equal(rule.then.properties.code.const, refusal.code, `${reason}: code`);
    assert.equal(rule.then.properties.message.const, refusal.message, `${reason}: message`);
  }
  assert.deepEqual(schemas.WorkspaceOperationRefused.properties.reason.enum, [...store.STORED_REFUSALS, 'changed_elsewhere']);
  const elsewhere = schemas.WorkspaceOperationRefused.allOf.find((item) => item.if.properties.reason.const === 'changed_elsewhere');
  assert.deepEqual([elsewhere.then.properties.code.const, elsewhere.then.properties.message.const], [REFUSALS.changed_elsewhere.code, REFUSALS.changed_elsewhere.message]);
  assert.equal(store.STORED_REFUSALS.includes('changed_elsewhere'), false, 'it is computed on read, never stored');
  // The unavailable collections' load sentences, the disabled sentence, the reconcile sentences.
  const unavailable = schemas.WorkspaceSnapshot.oneOf.find((item) => item.properties.availability.const === 'unavailable');
  assert.deepEqual(unavailable.properties.message.enum, Object.values(UNSTORED_COLLECTIONS).map((item) => item.load));
  assert.equal(schemas.WorkspaceReceiptDisabled.properties.message.const, featureDisabledReason('workspace'));
  assert.equal(schemas.WorkspaceOperationIncomplete.properties.message.const, INCOMPLETE_MESSAGE);
  assert.equal(schemas.WorkspaceOperationOpen.properties.message.const, IN_FLIGHT_MESSAGE);
  // Limits (Ruling W7).
  assert.equal(schemas.Changes.properties.tests.maxItems, LIMITS.collectionRecords);
  assert.equal(schemas.WorkspaceSnapshot.oneOf[0].properties.records.maxItems, LIMITS.collectionRecords);
  assert.equal(schemas.WorkspaceRemoveNotes.properties.selection.maxItems, LIMITS.selection);
  assert.equal(schemas.WorkspaceWrite.properties.record.properties.id.maxLength, LIMITS.idLength);
  assert.match(operations.get('workspaceExecute').responses['413'].description, new RegExp(LIMITS.bodyBytes.toLocaleString('en-US')));
  assert.match(schemas.WorkspaceReceiptRefused.description, new RegExp(LIMITS.recordBytes.toLocaleString('en-US')));
});

test('every registry path resolves to a route file with the documented method and maxDuration 60, and the client\'s registry names the same paths', () => {
  for (const [, op] of operations) {
    const file = path.join(REPO_ROOT, 'app', ...op.path.split('/').filter(Boolean), 'route.js');
    assert.ok(existsSync(file), `${op.path} has a route file`);
    const source = readFileSync(file, 'utf8');
    assert.match(source, new RegExp(`^export async function ${op.method}\\(`, 'm'), `${op.path} exports ${op.method}`);
    if (op.path !== '/api/operations') assert.match(source, /^export const maxDuration = 60;$/m, `${op.path}: maxDuration 60`);
    assert.equal(source.includes(EM_DASH), false, `${op.path}: no U+2014 in server copy`);
  }
  for (const [operation, { path: route, method = 'GET' }] of Object.entries(productionOperations)) {
    if (!['workspace.load', 'workspace.execute', 'operations.read'].includes(operation)) continue;
    const op = [...operations.values()].find((item) => item['x-halo-operation'] === operation);
    assert.ok(op, `${operation} is documented`);
    assert.deepEqual([op.path, op.method], [route, method], `${operation}: the client's path and method`);
  }
});

test('drift: the runtime sentences and the provider lines the suite relies on are still in the client\'s files', () => {
  const runtime = readFileSync(path.join(REPO_ROOT, 'lib/frontend/production/runtime.ts'), 'utf8');
  for (const sentence of Object.values(SENTENCE)) assert.ok(runtime.includes(sentence), `runtime.ts: ${sentence}`);
  const provider = readFileSync(path.join(REPO_ROOT, 'components/homeguard/HomeWorkspaceState.tsx'), 'utf8').replace(/\s+/g, ' ');
  for (const line of [
    'Check the pending save status before making another change. Your draft is kept.',
    'Load the current records before saving. Your draft is kept.',
    'Save status is still unavailable. Your draft remains here. Do not repeat the change.',
    'The save result could not be verified. Check its status before trying another change.',
    'The saved response could not be read. Check its status before trying another change.',
    'The connection ended before the result was confirmed. Check save status before retrying.',
    'This record changed. Your draft is kept. Review the latest version before saving.',
    'The selected notes changed. Nothing was removed. Review the selection again.',
    'Use the account privacy review to clear connected records together. Nothing was deleted.',
    'Records changed. Nothing was deleted. Reopen the review.',
    "['workspace', 'attachments'].includes(item.domain)",
    "['assets','observations','gardens','usage','pantryItems']",
  ]) assert.ok(provider.replace(/"/g, "'").includes(line), `HomeWorkspaceState.tsx no longer contains: ${line}`);
});

// ---------------------------------------------------------------------------
// The row schemas against the client's own row check
// ---------------------------------------------------------------------------

test('each Record_<collection> schema and the client\'s own row check agree on a corpus of the valid and the broken', () => {
  for (const key of STORED_COLLECTIONS) {
    const schemaFor = schema(`Record_${key}`);
    const valid = { ...sampleRecord(key, { homeContextId: HOME }), revision: 1 };
    const agree = (row, label, expected) => {
      const client = validProductionCollection(key, [row]);
      const document = schemaFor(row);
      assert.equal(client, expected, `${key} ${label}: the client says ${client}`);
      assert.equal(document, expected, `${key} ${label}: the document says ${document}: ${ajv.errorsText(schemaFor.errors)}`);
    };
    agree(valid, 'valid', true);
    const definition = contract.components.schemas[`Record_${key}`];
    for (const required of definition.required) {
      if (required === 'revision' || required === 'id') continue;
      const broken = { ...valid };
      delete broken[required];
      agree(broken, `without ${required}`, false);
    }
    for (const [name, property] of Object.entries(definition.properties)) {
      if (property.enum && name in valid) agree({ ...valid, [name]: 'not-a-choice' }, `${name} outside its choices`, false);
    }
    agree({ ...valid, revision: 0 }, 'revision 0', false);
    agree({ ...valid, id: '' }, 'empty id', false);
    agree({ ...valid, title: 'x'.repeat(30001) }, 'title over 30000', false);
    agree({ ...valid, futureField: { kept: true } }, 'an unknown future field', true);
  }
});

test('an unknown-status reconcile (a reap that itself failed) is documented, and the client stays locked on it', async () => {
  const body = { operationId: crypto.randomUUID(), domain: 'workspace', kind: 'workspace.write', status: 'unknown', created_at: CREATED_AT, changes: {}, message: IN_FLIGHT_MESSAGE };
  validate('operationsRead', 200, body);
  assert.equal(schema('WorkspaceOperationRead')({ ...body, status: 'succeeded' }), false, 'and it is not a way to claim success');
  await assertClient('operationsRead', 200, body, STAND_IN(), 'unknown status');
});

// ---------------------------------------------------------------------------
// The harness: the real handlers, on PGlite
// ---------------------------------------------------------------------------

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const world = (options) => createWorld(db, options);

// Response headers: both directions, for the pairs exercised below.
const CHECKED_HEADERS = ['x-request-id', 'retry-after'];
const seenHeaders = new Map();
const documentedHeaders = (id, status) =>
  new Set(Object.keys(operations.get(id).responses[String(status)].headers ?? {}).map((name) => name.toLowerCase()));
function recordHeaders(id, res) {
  const key = `${id} ${res.status}`;
  const documented = documentedHeaders(id, res.status);
  if (!seenHeaders.has(key)) seenHeaders.set(key, new Set());
  for (const name of CHECKED_HEADERS) {
    if (res.headers.get(name) === null) continue;
    seenHeaders.get(key).add(name);
    assert.ok(documented.has(name), `${key}: the response sends ${name} but the contract does not document it`);
  }
}
// Request headers: every header a test sends beyond the transport ones must be documented.
const TRANSPORT = new Set(['authorization', 'content-type', 'x-request-id', 'accept']);
const sentHeaders = new Map();
const documentedParams = (id) =>
  new Set((operations.get(id).parameters ?? []).filter((p) => p.in === 'header').map((p) => p.name.toLowerCase()));
function recordRequestHeaders(id, headers) {
  if (!sentHeaders.has(id)) sentHeaders.set(id, new Set());
  for (const name of Object.keys(headers).map((h) => h.toLowerCase())) {
    if (TRANSPORT.has(name)) continue;
    sentHeaders.get(id).add(name);
    assert.ok(documentedParams(id).has(name), `${id}: the request sends ${name} but the contract does not document it`);
  }
}

/** A body with its ids replaced in order of appearance and its timestamps fixed, so a fixture is stable. */
function normalized(value) {
  const ids = new Map();
  const walk = (item, key) => {
    if (typeof item === 'string') {
      if (key === 'created_at') return CREATED_AT;
      if (!UUID.test(item)) return item;
      const id = item.toLowerCase();
      if (!ids.has(id)) ids.set(id, `0b110000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
      return ids.get(id);
    }
    if (Array.isArray(item)) return item.map((entry) => walk(entry));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, entry]) => [name, walk(entry, name)]));
    return item;
  };
  return walk(value);
}

/** Fixture name -> the normalised answer a real handler gave in this file. */
const produced = new Map();

/**
 * One call to a real handler, checked against the document, the request id,
 * the bare-body and em dash rules, and the client's own consequence; recorded
 * as `fixture` when named.
 */
async function call(w, id, { expected = 200, query = '', body, rawBody, as = 'alice', headers = {}, env, fixture, request, client = true } = {}) {
  const op = operations.get(id);
  const sent = { 'x-request-id': REQUEST_ID, ...headers };
  recordRequestHeaders(id, sent);
  const res = await w.h.call(op.path, op.method, { as, url: `${op.path}${query}`, body, rawBody, headers: sent, env });
  const text = await res.text();
  assert.equal(res.status, expected, `${id}${query}: expected ${expected}, got ${res.status}: ${text.slice(0, 300)}`);
  assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${id}: the request id is echoed`);
  recordHeaders(id, res);
  const json = JSON.parse(text);
  validate(id, res.status, json);
  assertBare(json, `${id} ${res.status}`);
  if (res.status === 503) assert.equal(res.headers.get('retry-after'), json.code === 'auth_unavailable' ? '2' : null, `${id}: Retry-After only with the auth outage`);
  if (expected >= 400) {
    assert.equal(json.request_id, REQUEST_ID);
    assert.equal(/supabase|postgres|PGRST|P0001|HALO_[A-Z]|XX000|contractsB11|bearer|PRIVATE-B11/i.test(text), false, `${id} ${expected}: nothing proof-bearing in an error envelope`);
  }
  if (id === 'workspaceLoad' && res.status === 200 && STORED_COLLECTIONS.includes(request.collection)) validateRows(request.collection, json.records);
  if (id === 'operationsRead' && res.status === 200 && json.status === 'succeeded') {
    assert.deepEqual(Object.keys(json.changes).sort(), [...json.collections].sort(), 'a reconcile carries exactly the collections the save touched');
  }
  // `client: false` marks a command the client cannot build (an unknown collection, an empty selection).
  if (client) await assertClient(id, res.status, json, request, `${id} ${res.status}`);
  if (fixture) {
    assert.equal(produced.has(fixture), false, `${fixture} is produced once`);
    const record = normalized({ request, body: json });
    produced.set(fixture, { operationId: id, status: res.status, ...(request === undefined ? {} : { request: record.request }), body: record.body });
  }
  return { body: json, res };
}

const load = (w, collection, { query, ...options } = {}) =>
  call(w, 'workspaceLoad', { query: query ?? `?collection=${encodeURIComponent(collection)}`, request: { collection }, ...options });
const reconcile = (w, command, options = {}) =>
  call(w, 'operationsRead', { query: `?operationId=${options.operationId ?? command.operationId}&domain=workspace`, request: command, ...options });

const command = (over) => ({ operationId: crypto.randomUUID(), ...over });
const write = (collection, record, expectedRevision = null, extra = {}) => command({ kind: 'write', collection, record, expectedRevision, ...extra });
const remove = (collection, recordId, expectedRevision) => command({ kind: 'remove', collection, recordId, expectedRevision });
/** POST /api/frontend/workspace/commands as the client sends it (runtime.ts:130-138, adapters.ts:29). */
function execute(w, cmd, { key = cmd.operationId, headers = {}, raw, valid = true, ifMatch = true, ...options } = {}) {
  if (valid) validateRequest(cmd);
  const match = ifMatch && cmd.kind !== 'remove-notes' && cmd.expectedRevision != null ? { 'if-match': String(cmd.expectedRevision) } : {};
  return call(w, 'workspaceExecute', {
    rawBody: raw ?? JSON.stringify(cmd),
    request: raw === undefined ? cmd : undefined,
    headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'idempotency-key': key }), ...match, ...headers },
    ...options,
  });
}

const test1 = (w, over = {}) => sampleRecord('tests', { id: 'test-kitchen-tap', title: 'Kitchen tap', homeContextId: w.home.alice, ...over });
const note = (id, over = {}) => sampleRecord('exploreNotes', { id, title: `Note ${id}`, ...over });

/** A ledger row as runOperation would have claimed it for `cmd`, owned by alice. */
async function claimed(w, cmd, { status = 'pending', result = null, ageMs = 1000, kind = 'workspace.write', hashOf } = {}) {
  const input = { ...(hashOf ?? cmd) };
  delete input.operationId;
  await w.db.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, result, created_at)
     values ($1, $2, 'workspace', $3, $4, $5, $6::jsonb, now() - ($7 || ' milliseconds')::interval)`,
    [cmd.operationId, w.ids.alice, kind, status, requestHash(input), result === null ? null : JSON.stringify(result), String(ageMs)],
  );
}
const ledgerCount = async (w) => Number((await w.db.query('select count(*)::int as n from public.operations where profile_id = $1', [w.ids.alice])).rows[0].n);
const rowCount = async (w, collection) => (await w.rows('alice', collection)).length;

// ---------------------------------------------------------------------------
// Handler conformance: every state each route can answer with
// ---------------------------------------------------------------------------

test('B11 handler conformance: workspace.load answers empty, saved rows, a pending lock, both unavailable collections and every refusal', async (t) => {
  const logged = muteConsoleError(t);
  const w = await world();
  const { body: empty } = await load(w, 'tests', { fixture: 'workspaceLoad-empty', headers: { 'x-halo-home-context': w.home.alice } });
  assert.deepEqual(empty, { records: [], availability: 'empty', complete: true, pendingOperations: [] });

  const saved = write('tests', test1(w));
  await execute(w, saved);
  const guide = write('exploreProjects', sampleRecord('exploreProjects', { id: 'project-rain-garden', title: 'Rain garden' }));
  guide.record.guide.sources[0].url = 'https://example.test/guide';
  await execute(w, guide);
  const { body: ready } = await load(w, 'tests', { fixture: 'workspaceLoad-records' });
  assert.deepEqual(ready.records.map((row) => [row.id, row.revision]), [['test-kitchen-tap', 1]]);
  assert.equal(ready.availability, 'ready');
  await load(w, 'exploreProjects', { fixture: 'workspaceLoad-records-explore-project' });
  await load(w, 'assets', {});
  assert.deepEqual((await (await w.load('foodFollows')).json()), { records: [], availability: 'empty', complete: true, pendingOperations: [] });

  // A save started on another device and not settled: listed, and the screen locks on it.
  const other = write('tests', test1(w, { id: 'test-other-device' }));
  await claimed(w, other);
  const { body: pending } = await load(w, 'tests', { fixture: 'workspaceLoad-records-pending' });
  assert.deepEqual(pending.pendingOperations, [{ operationId: other.operationId, domain: 'workspace' }]);
  assert.equal(pending.availability, 'ready');

  // The two collections that are never stored answer unavailable, and the pending list still comes with them.
  const { body: journal } = await load(w, 'weekJournal', { fixture: 'workspaceLoad-unavailable-week-journal' });
  assert.deepEqual(journal, { records: [], availability: 'unavailable', complete: false, message: UNSTORED_COLLECTIONS.weekJournal.load, pendingOperations: pending.pendingOperations });
  const { body: transitions } = await load(w, 'homeTransitions', { fixture: 'workspaceLoad-unavailable-home-transitions' });
  assert.equal(transitions.message, UNSTORED_COLLECTIONS.homeTransitions.load);

  // 400: an unknown collection, a wrong case, none at all.
  const { body: unknown } = await load(w, 'nope', { expected: 400, fixture: 'workspaceLoad-bad-collection' });
  assert.equal(unknown.field_errors[0].field, 'collection');
  await load(w, 'TESTS', { expected: 400 });
  await load(w, '', { expected: 400, query: '' });

  await load(w, 'tests', { as: null, expected: 401, fixture: 'workspaceLoad-unauthenticated' });

  // The capability is off by default: nothing is read.
  const calls = w.h.db.rpcCalls.length;
  const { body: off } = await load(w, 'tests', { env: OFF, expected: 503, fixture: 'workspaceLoad-feature-unavailable' });
  assert.deepEqual([off.code, off.retryable], ['feature_unavailable', false]);
  assert.equal(w.h.db.rpcCalls.length, calls, 'flag off reads nothing');

  // Migration 0026 not applied: the same non-retryable answer, never an empty list.
  const missing = await world({ onRead: async () => { throw rpcError('PGRST202', 'Could not find the function public.read_household_workspace'); } });
  const { body: absent } = await load(missing, 'tests', { expected: 503, fixture: 'workspaceLoad-migration-missing' });
  assert.deepEqual([absent.code, absent.retryable], ['feature_unavailable', false]);

  const outage = await world();
  outage.h.forceAuthOutage();
  await load(outage, 'tests', { expected: 503, fixture: 'workspaceLoad-auth-unavailable' });

  const broken = await world({ onRead: async () => { throw rpcError('XX000', 'boom', `Failing row contains (${MARKER})`, MARKER); } });
  await load(broken, 'tests', { expected: 500, fixture: 'workspaceLoad-internal-error' });
  assert.ok(!loggedText(logged).includes('PRIVATE-B11'), 'no record content reaches a log line');
});

test('B11 handler conformance: workspace.execute answers success, every 200 refusal, the disabled receipt and every 4xx and 5xx', async (t) => {
  const logged = muteConsoleError(t);
  const w = await world();
  const created = test1(w);
  const create = write('tests', created);
  const { body: made } = await execute(w, create, { fixture: 'workspaceExecute-write-created', headers: { 'x-halo-home-context': w.home.alice } });
  assert.deepEqual(made.changes.tests.map((row) => [row.id, row.revision]), [['test-kitchen-tap', 1]]);
  assert.ok(homeReceiptCoversCommand(create, made), 'the client\'s own coverage check accepts it');
  assert.ok(validHomeChanges(made.changes));
  // A replay of the same operation answers the same rows, from the current state.
  const { body: replayed } = await execute(w, create, { fixture: 'workspaceExecute-success-replay' });
  assert.deepEqual(replayed, made);
  assert.equal(await rowCount(w, 'tests'), 1, 'a replay saves nothing twice');

  const update = write('tests', { ...made.changes.tests[0], status: 'arranged', provider: 'County lab' }, 1);
  const { body: updated } = await execute(w, update, { fixture: 'workspaceExecute-write-updated' });
  assert.deepEqual(updated.changes.tests.map((row) => [row.revision, row.status]), [[2, 'arranged']]);

  // A stale save: refused with the client's draft kept, nothing written, and the same refusal on replay.
  const stale = write('tests', { ...made.changes.tests[0], provider: 'Stale tab' }, 1);
  const { body: refusedStale } = await execute(w, stale, { fixture: 'workspaceExecute-refused-stale-revision', ifMatch: false });
  assert.deepEqual([refusedStale.code, refusedStale.reason, refusedStale.changes], ['conflict', 'stale_revision', {}]);
  assert.equal((await w.rows('alice', 'tests'))[0].record.provider, 'County lab');
  const { body: again } = await execute(w, stale, { ifMatch: false });
  assert.deepEqual(again, refusedStale, 'a replayed refusal is the same body');
  // A create of an id that already exists is the same refusal.
  const { body: duplicate } = await execute(w, write('tests', created), {});
  assert.equal(duplicate.reason, 'stale_revision');

  // B16 Ruling J13: a started project keeps its guide, but the person's own fields still save.
  const started = write('exploreProjects', sampleRecord('exploreProjects', { id: 'project-rain-garden', title: 'Rain garden' }));
  started.record.guide.sources[0].url = 'https://example.test/guide';
  const { body: startedBody } = await execute(w, started, {});
  const project = startedBody.changes.exploreProjects[0];
  const progress = write('exploreProjects', { ...project, status: 'Paused', outcome: 'Basin dug', reviewDate: '2026-11-01', stepNotes: { 'step-1': 'Marked the spot' } }, 1);
  const { body: progressed } = await execute(w, progress, {});
  assert.deepEqual([progressed.status, progressed.changes.exploreProjects[0].revision, progressed.changes.exploreProjects[0].status], ['succeeded', 2, 'Paused'], 'progress and notes still save');
  assert.ok(homeReceiptCoversCommand(progress, progressed));
  const reordered = { ...progressed.changes.exploreProjects[0], guide: Object.fromEntries(Object.entries(progressed.changes.exploreProjects[0].guide).reverse()) };
  const { body: reorderedBody } = await execute(w, write('exploreProjects', { ...reordered, status: 'Active' }, 2), {});
  assert.equal(reorderedBody.status, 'succeeded', 'the same guide in another key order is not a change');
  const locked = write('exploreProjects', { ...reorderedBody.changes.exploreProjects[0], status: 'Completed', guide: { ...project.guide, steps: [{ ...project.guide.steps[0], title: 'Dig somewhere else' }] } }, 3);
  const { body: lockedBody } = await execute(w, locked, { fixture: 'workspaceExecute-refused-project-guide-locked' });
  assert.deepEqual([lockedBody.code, lockedBody.reason, lockedBody.changes, lockedBody.message], ['validation', 'project_guide_locked', {}, REFUSALS.project_guide_locked.message]);
  const storedProject = (await w.rows('alice', 'exploreProjects'))[0];
  assert.deepEqual([storedProject.revision, storedProject.record.status, storedProject.record.guide.steps[0].title], [3, 'Active', 'Dig'], 'nothing of a refused update was written');
  const { body: lockedAgain } = await execute(w, locked, {});
  assert.deepEqual(lockedAgain, lockedBody, 'a replayed refusal is the same body');
  await reconcile(w, locked, {});
  for (const over of [{ guideVersion: 'v2', guide: { ...project.guide, version: 'v2' } }, { guideId: 'g2', guide: { ...project.guide, id: 'g2' } }, { guide: { ...project.guide, materials: ['Spade'] } }]) {
    const { body: refused } = await execute(w, write('exploreProjects', { ...reorderedBody.changes.exploreProjects[0], ...over }, 3), {});
    assert.equal(refused.reason, 'project_guide_locked', JSON.stringify(Object.keys(over)));
  }
  assert.equal((await w.rows('alice', 'exploreProjects'))[0].revision, 3);

  // A remove.
  const removal = remove('tests', 'test-kitchen-tap', 2);
  const { body: removed } = await execute(w, removal, { fixture: 'workspaceExecute-remove' });
  assert.deepEqual(removed.changes, { tests: [] });
  assert.ok(homeReceiptCoversCommand(removal, removed));
  // A remove at a stale revision, or of a record that is gone.
  const { body: gone } = await execute(w, remove('tests', 'test-kitchen-tap', 2), {});
  assert.equal(gone.reason, 'stale_revision');

  // Notes and their cases: three notes, two with a case.
  for (const id of ['note-1', 'note-2', 'note-3']) await execute(w, write('exploreNotes', note(id)));
  for (const id of ['note-1', 'note-2']) await execute(w, write('exploreOutcomes', sampleRecord('exploreOutcomes', { id: `note-case:${id}`, title: `Case ${id}` })));
  await execute(w, write('exploreOutcomes', sampleRecord('exploreOutcomes', { id: 'outcome-keep', title: 'Keep' })));
  const notes = (await (await w.load('exploreNotes')).json()).records;
  const selection = ['note-1', 'note-2'].map((id) => ({ id, revision: notes.find((row) => row.id === id).revision }));
  const batch = command({ kind: 'remove-notes', selection });
  const { body: batched } = await execute(w, batch, { fixture: 'workspaceExecute-remove-notes' });
  assert.deepEqual(batched.changes.exploreNotes.map((row) => row.id), ['note-3']);
  assert.deepEqual(batched.changes.exploreOutcomes.map((row) => row.id), ['outcome-keep'], 'the notes\' own cases went with them, the other outcome stayed');
  assert.ok(homeReceiptCoversCommand(batch, batched));
  const { body: changedNotes } = await execute(w, command({ kind: 'remove-notes', selection: [{ id: 'note-3', revision: 9 }] }), { fixture: 'workspaceExecute-refused-notes-changed' });
  assert.deepEqual([changedNotes.code, changedNotes.reason], ['conflict', 'notes_changed']);
  assert.equal(await rowCount(w, 'exploreNotes'), 1);

  // A link to a record this household does not own.
  const { body: dangling } = await execute(w, write('foodQuestions', sampleRecord('foodQuestions', { id: 'question-1', reportId: 'test-not-mine' })), { fixture: 'workspaceExecute-refused-invalid-reference' });
  assert.deepEqual([dangling.code, dangling.reason], ['validation', 'invalid_reference']);
  assert.equal(await rowCount(w, 'foodQuestions'), 0);

  // A record the client's own row check would discard a whole collection for.
  const { body: invalid } = await execute(w, write('tests', { ...test1(w, { id: 'test-bad' }), status: 'not-a-status' }), { fixture: 'workspaceExecute-refused-invalid-record', valid: true });
  assert.equal(invalid.reason, 'invalid_record');
  // A record over 262,144 bytes is refused before any claim, with the limit sentence.
  const huge = test1(w, { id: 'test-huge', rows: Array.from({ length: 10 }, (_, index) => ({ id: `r${index}`, analyte: 'a', originalValue: 'x'.repeat(30000), originalUnit: '', limit: '', limitUnit: '', basis: '', reportReference: '', reportDate: '', qualifier: 'measured' })) });
  const before = await ledgerCount(w);
  const { body: tooBig } = await execute(w, write('tests', huge), {});
  assert.equal(tooBig.reason, 'limit');
  assert.equal(await ledgerCount(w), before, 'a pre-claim refusal records nothing');

  // Private files are a later package.
  const attached = test1(w, { id: 'test-with-file', attachments: [{ id: 'file-1', name: 'report.pdf', mime: 'application/pdf', revision: 1, bytes: 1024, status: 'ready', metadataRemoved: true }] });
  const { body: files } = await execute(w, write('tests', attached), { fixture: 'workspaceExecute-refused-attachments-unavailable' });
  assert.deepEqual([files.code, files.reason], ['unavailable', 'attachments_unavailable']);
  assert.equal((await w.rows('alice', 'tests')).length, 0);

  // One clearing path: the privacy review.
  const clear = command({ kind: 'clear-private', scope: 'all', expectedFingerprint: 'review-fingerprint' });
  const { body: cleared } = await execute(w, clear, { fixture: 'workspaceExecute-refused-clear-unsupported' });
  assert.equal(cleared.reason, 'clear_unsupported');
  await execute(w, command({ kind: 'clear-private', scope: 'journal', expectedFingerprint: 'x' }), {});

  // The two collections that are never stored.
  const journal = write('weekJournal', { id: 'journal-1', title: 'Check-in', revision: 0 });
  const { body: weekJournal } = await execute(w, journal, { fixture: 'workspaceExecute-refused-week-journal-unavailable' });
  assert.deepEqual([weekJournal.code, weekJournal.reason], ['unavailable', 'week_journal_unavailable']);
  const { body: transitions } = await execute(w, remove('homeTransitions', 'transition-1', 3), { fixture: 'workspaceExecute-refused-home-transitions-unavailable' });
  assert.equal(transitions.reason, 'home_transitions_unavailable');

  // The capability is off: a 200 disabled receipt, nothing read or claimed.
  const calls = w.h.db.rpcCalls.length;
  const claims = await ledgerCount(w);
  const { body: disabled } = await execute(w, write('tests', test1(w, { id: 'test-off' })), { env: OFF, fixture: 'workspaceExecute-disabled' });
  assert.equal(disabled.message, featureDisabledReason('workspace'));
  assert.equal('reason' in disabled, false);
  assert.equal(w.h.db.rpcCalls.length, calls);
  assert.equal(await ledgerCount(w), claims);

  // The collection is full: a refusal recorded against stored state.
  const full = await world();
  await full.db.query(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record)
     select $1, 'tests', 'bulk-' || g, 1, jsonb_build_object('id', 'bulk-' || g, 'title', 'x') from generate_series(1, 1000) g`, [full.ids.alice]);
  const { body: fullRefusal } = await execute(full, write('tests', test1(full, { id: 'test-one-too-many' })), { fixture: 'workspaceExecute-refused-limit' });
  assert.deepEqual([fullRefusal.code, fullRefusal.reason], ['validation', 'limit']);
  const settled = await full.ledgerRow(fullRefusal.operationId);
  assert.deepEqual([settled.status, settled.result.reason], ['failed', 'limit'], 'a refusal settles the operation failed, with the reason only');

  // 400s, decided before the ledger claim.
  const claimsBefore = await ledgerCount(w);
  await execute(w, command({}), { raw: '{not json', valid: false, key: crypto.randomUUID(), expected: 400, fixture: 'workspaceExecute-bad-request' });
  const { body: badId } = await execute(w, write('tests', test1(w, { id: 'x'.repeat(201) })), { valid: false, expected: 400, fixture: 'workspaceExecute-validation' });
  assert.equal(badId.field_errors[0].field, 'record.id');
  const { body: badKind } = await execute(w, command({ kind: 'nope' }), { valid: false, expected: 400, client: false });
  assert.equal(badKind.field_errors[0].field, 'kind');
  await execute(w, write('tests', test1(w)), { key: null, expected: 400, fixture: 'workspaceExecute-missing-idempotency-key' });
  await execute(w, write('tests', test1(w)), { key: crypto.randomUUID(), expected: 400, fixture: 'workspaceExecute-idempotency-mismatch' });
  const mismatched = write('tests', test1(w), 2);
  await execute(w, mismatched, { headers: { 'if-match': '3' }, expected: 400, fixture: 'workspaceExecute-if-match-mismatch' });
  assert.equal(await ledgerCount(w), claimsBefore, 'nothing recorded for a 400');
  await execute(w, command({ kind: 'write', collection: 'nope', record: { id: 'x', title: 'x' }, expectedRevision: null }), { valid: false, expected: 400, client: false });
  await execute(w, command({ kind: 'remove-notes', selection: [] }), { valid: false, expected: 400, client: false });

  await execute(w, write('tests', test1(w)), { as: null, expected: 401, fixture: 'workspaceExecute-unauthenticated' });

  // 413: a body over 1,000,000 bytes.
  const oversize = command({ kind: 'write', collection: 'tests', record: { id: 'x', title: 'y'.repeat(LIMITS.bodyBytes) }, expectedRevision: null });
  await execute(w, oversize, { valid: false, expected: 413, fixture: 'workspaceExecute-payload-too-large', raw: JSON.stringify(oversize) });

  // 409s: a replay that cannot be answered.
  const first = write('tests', test1(w, { id: 'test-first' }));
  await execute(w, first);
  await execute(w, { ...first, record: { ...first.record, title: 'Different' } }, { expected: 409, fixture: 'workspaceExecute-operation-mismatch', ifMatch: false });
  const reaped = write('tests', test1(w, { id: 'test-reaped' }));
  await claimed(w, reaped, { status: 'failed', result: { status: 'failed', reason: 'abandoned' } });
  const { body: abandoned } = await execute(w, reaped, { expected: 409, fixture: 'workspaceExecute-abandoned' });
  assert.equal(abandoned.reason, 'abandoned');
  const thrown = write('tests', test1(w, { id: 'test-thrown' }));
  await claimed(w, thrown, { status: 'failed', result: null });
  await execute(w, thrown, { expected: 409, fixture: 'workspaceExecute-not-applied' });
  const odd = write('tests', test1(w, { id: 'test-odd' }));
  await claimed(w, odd, { status: 'failed', result: { status: 'failed', reason: 'never-written-by-this-route' } });
  await execute(w, odd, { expected: 409, fixture: 'workspaceExecute-unrecognized-receipt' });
  // 503: a replay of an operation still being processed.
  const running = write('tests', test1(w, { id: 'test-running' }));
  await claimed(w, running);
  const { body: busy } = await execute(w, running, { expected: 503, fixture: 'workspaceExecute-in-flight' });
  assert.deepEqual([busy.code, busy.retryable], ['upstream_unavailable', true]);

  // 503: migration 0026 is not applied; decided before the claim.
  const absent = await world({ onRead: async () => { throw rpcError('PGRST202', 'Could not find the function'); } });
  const { body: unavailable } = await execute(absent, write('tests', test1(absent)), { expected: 503, fixture: 'workspaceExecute-feature-unavailable' });
  assert.deepEqual([unavailable.code, unavailable.retryable], ['feature_unavailable', false]);
  assert.equal(await ledgerCount(absent), 0, 'nothing claimed');
  const outage = await world();
  outage.h.forceAuthOutage();
  await execute(outage, write('tests', test1(outage)), { expected: 503, fixture: 'workspaceExecute-auth-unavailable' });

  // 500: the database failed inside the commit.
  const broken = await world({ onCommit: async () => { throw rpcError('XX000', 'boom', `Failing row contains (${MARKER})`, MARKER); } });
  const lost = write('tests', test1(broken));
  await execute(broken, lost, { expected: 500, fixture: 'workspaceExecute-internal-error' });
  assert.equal((await broken.ledgerRow(lost.operationId)).status, 'failed', 'runOperation settled the claim failed, saved nothing');
  assert.equal(await rowCount(broken, 'tests'), 0);
  assert.ok(!loggedText(logged).includes('PRIVATE-B11'), 'no record content reaches a log line');
});

test('B11 handler conformance: operations.read answers every workspace status, with changes always present', async (t) => {
  const logged = muteConsoleError(t);
  const w = await world();
  const done = write('tests', test1(w));
  await execute(w, done);
  const { body: succeeded } = await reconcile(w, done, { fixture: 'operationsRead-workspace-succeeded' });
  assert.deepEqual(succeeded.changes.tests.map((row) => [row.id, row.revision]), [['test-kitchen-tap', 1]]);
  assert.deepEqual([succeeded.collections, succeeded.affected, succeeded.removed], [['tests'], [{ collection: 'tests', id: 'test-kitchen-tap', revision: 1 }], []]);
  assert.ok(!JSON.stringify(succeeded).includes('PRIVATE-B11'));
  // The reconcile shows the CURRENT rows, which may be newer than the save.
  const later = write('tests', { ...succeeded.changes.tests[0], provider: 'County lab' }, 1);
  await execute(w, later);
  const { body: current } = await reconcile(w, done, {});
  assert.deepEqual(current.changes.tests.map((row) => [row.revision, row.provider]), [[2, 'County lab']]);

  const batch = command({ kind: 'remove-notes', selection: [{ id: 'note-1', revision: 1 }] });
  await execute(w, write('exploreNotes', note('note-1')));
  await execute(w, batch);
  const { body: batched } = await reconcile(w, batch, {});
  assert.deepEqual(Object.keys(batched.changes).sort(), ['exploreNotes', 'exploreOutcomes']);
  assert.deepEqual(batched.removed, [{ collection: 'exploreNotes', id: 'note-1' }, { collection: 'exploreOutcomes', id: 'note-case:note-1' }]);

  const stale = write('tests', { ...succeeded.changes.tests[0], provider: 'Stale' }, 1);
  await execute(w, stale, { ifMatch: false });
  const { body: refused } = await reconcile(w, stale, { fixture: 'operationsRead-workspace-refused-stale-revision' });
  assert.deepEqual([refused.status, refused.reason, refused.code, refused.changes, refused.unresolvedOperations], ['failed', 'stale_revision', 'conflict', {}, []]);
  assert.equal(refused.message, REFUSALS.stale_revision.message);

  const reaped = write('tests', test1(w, { id: 'test-reaped' }));
  await claimed(w, reaped, { status: 'failed', result: { status: 'failed', reason: 'abandoned' } });
  const { body: abandoned } = await reconcile(w, reaped, { fixture: 'operationsRead-workspace-abandoned' });
  assert.deepEqual([abandoned.changes, abandoned.message], [{}, INCOMPLETE_MESSAGE]);
  const thrown = write('tests', test1(w, { id: 'test-thrown' }));
  await claimed(w, thrown, { status: 'failed', result: null });
  const { body: noReceipt } = await reconcile(w, thrown, { fixture: 'operationsRead-workspace-failed-no-receipt' });
  assert.equal(noReceipt.message, INCOMPLETE_MESSAGE);
  const running = write('tests', test1(w, { id: 'test-running' }));
  await claimed(w, running);
  const { body: pending } = await reconcile(w, running, { fixture: 'operationsRead-workspace-pending' });
  assert.deepEqual([pending.status, pending.changes, pending.message], ['pending', {}, IN_FLIGHT_MESSAGE]);
  // A pending row past its two minute window is reaped by its own reconcile, and answered as an operation that did not finish.
  const stuck = write('tests', test1(w, { id: 'test-stuck' }));
  await claimed(w, stuck, { ageMs: 5 * 60_000 });
  const { body: reapedStuck } = await reconcile(w, stuck, { fixture: 'operationsRead-workspace-reaped' });
  assert.deepEqual([reapedStuck.status, reapedStuck.changes, reapedStuck.message], ['failed', {}, INCOMPLETE_MESSAGE]);
  assert.equal((await w.ledgerRow(stuck.operationId)).result.reason, 'abandoned');

  await call(w, 'operationsRead', { query: '?operationId=not-a-uuid&domain=workspace', request: done, expected: 400, fixture: 'operationsRead-bad-request' });
  await call(w, 'operationsRead', { query: `?operationId=${done.operationId}&domain=nope`, request: done, expected: 400 });
  await reconcile(w, done, { operationId: crypto.randomUUID(), expected: 404, fixture: 'operationsRead-not-found' });
  await reconcile(w, done, { as: null, expected: 401, fixture: 'operationsRead-unauthenticated' });
  // Another household's operation id is the identical 404.
  await reconcile(w, done, { as: 'bob', expected: 404 });
  const { body: off } = await reconcile(w, done, { env: OFF, expected: 503, fixture: 'operationsRead-feature-unavailable' });
  assert.equal(off.code, 'feature_unavailable');

  const outage = await world();
  const outageDone = write('tests', test1(outage));
  await execute(outage, outageDone);
  outage.h.forceAuthOutage();
  await reconcile(outage, outageDone, { expected: 503, fixture: 'operationsRead-auth-unavailable' });
  let failRead = false;
  const broken = await world({ onRead: async (_args, run) => { if (failRead) throw rpcError('XX000', 'boom', `Failing row contains (${MARKER})`, MARKER); return run(); } });
  const brokenDone = write('tests', test1(broken));
  await execute(broken, brokenDone);
  failRead = true;
  await reconcile(broken, brokenDone, { expected: 500, fixture: 'operationsRead-internal-error' });
  assert.ok(!loggedText(logged).includes('PRIVATE-B11'));
});

// ---------------------------------------------------------------------------
// The client end to end: the real runtime, the real handlers, the provider's decisions
// ---------------------------------------------------------------------------

async function loaded(w, who = 'alice', options = {}) {
  const ws = w.workspace(who, options);
  await ws.loadAll(WORKSPACE_COLLECTIONS);
  return ws;
}

test('client: a new household holds fourteen ready collections and two unavailable ones with their sentences, nothing locked', async () => {
  const w = await world();
  const ws = await loaded(w);
  for (const key of STORED_COLLECTIONS) {
    assert.deepEqual(ws.status(key), { status: 'ready', revision: undefined, complete: true, message: undefined }, key);
    assert.deepEqual(ws.records[key], [], key);
  }
  for (const [key, copy] of Object.entries(UNSTORED_COLLECTIONS)) {
    assert.deepEqual(ws.status(key), { status: 'error', complete: false, message: copy.load }, key);
    assert.equal(ws.records[key], undefined, `${key} holds nothing`);
  }
  assert.deepEqual(lockedIds(ws), []);
  assert.equal(ws.canMutate(), true);
  const wire = await (await w.load('tests')).json();
  assert.deepEqual(wire, fixtures.find((item) => item.name === 'workspaceLoad-empty.json').body, 'the empty collection is the documented bytes');
});

test('client: a save is the canonical row; the receipt, the next load and the reconcile are the same rows, and another household sees none of it', async () => {
  const w = await world();
  const ws = await loaded(w);
  const record = test1(w, { title: MARKER });
  assert.equal(await ws.write('tests', record), true);
  assert.equal(ws.state.message, SAVED);
  const [createId] = ws.state.operationIds;
  assert.deepEqual(ws.records.tests.map((row) => [row.id, row.revision, row.title]), [['test-kitchen-tap', 1, MARKER]]);

  assert.equal(await ws.write('tests', { ...ws.records.tests[0], status: 'arranged', provider: 'County lab' }), true);
  assert.deepEqual(ws.records.tests.map((row) => [row.revision, row.status, row.provider]), [[2, 'arranged', 'County lab']]);
  const [, updateId] = ws.state.operationIds;

  const again = await loaded(w);
  assert.deepEqual(again.records.tests, ws.records.tests, 'a reload shows exactly what the receipt did');
  const reconciled = await (await w.reconcile(updateId)).json();
  assert.deepEqual(reconciled.changes.tests, ws.records.tests, 'and so does the reconcile of that save');
  assert.ok(!(await w.ledgerText()).includes('PRIVATE-B11'), 'the ledger holds names, ids and revisions only');
  assert.equal((await w.ledgerRow(createId)).status, 'succeeded');

  const bob = await loaded(w, 'bob');
  assert.deepEqual(bob.records.tests, [], 'another household holds none of it');
  assert.equal((await w.reconcile(updateId, { as: 'bob' })).status, 404);

  assert.equal(await ws.remove('tests', 'test-kitchen-tap', 2), true);
  assert.deepEqual(ws.records.tests, []);
  assert.deepEqual(await w.rows('alice', 'tests'), []);
  assert.deepEqual(lockedIds(ws), []);
});

test('client: every stored collection takes a create, reloads valid, and home-owned records carry the current home', async () => {
  const w = await world();
  const ws = await loaded(w);
  for (const key of STORED_COLLECTIONS) assert.equal(await ws.write(key, sampleRecord(key, key === 'tests' ? { homeContextId: w.home.alice } : {})), true, `${key}: ${ws.state.message}`);
  const again = await loaded(w);
  for (const key of STORED_COLLECTIONS) {
    assert.equal(again.records[key].length, 1, key);
    assert.ok(validProductionCollection(key, again.records[key]), key);
    validateRows(key, again.records[key]);
  }
  for (const key of ['assets', 'observations', 'gardens', 'usage', 'pantryItems']) assert.equal(again.records[key][0].homeContextId, w.home.alice, key);
});

test('client: a second tab\'s stale save is the conflict sentence with no lock, and nothing changes', async () => {
  const w = await world();
  const one = await loaded(w);
  const two = await loaded(w);
  assert.equal(await one.write('tests', test1(w)), true);
  await two.retry('tests');
  assert.equal(await two.write('tests', { ...two.records.tests[0], provider: 'Tab two' }), true);
  const held = structuredClone(one.records);
  assert.equal(await one.write('tests', { ...one.records.tests[0], provider: 'Tab one' }), false);
  assert.equal(one.state.message, REFUSALS.stale_revision.message);
  assert.deepEqual(lockedIds(one), [], 'a conflict does not lock');
  assert.equal(one.canMutate(), true);
  assert.deepEqual(one.records, held, 'the stale tab still holds its own rows');
  assert.deepEqual((await w.rows('alice', 'tests')).map((row) => [row.revision, row.record.provider]), [[2, 'Tab two']]);
  await one.retry('tests');
  assert.deepEqual(one.records.tests, two.records.tests, 'reloading shows the winner');
});

test('client: a lost answer locks Homeguard on the operation; the status check unlocks it with "Saved." and the record', async (t) => {
  const logged = muteConsoleError(t);
  const w = await world();
  let lose = true;
  const ws = await loaded(w, 'alice', { lose: (pathname) => pathname === COMMANDS && lose && !(lose = false) });
  assert.equal(await ws.write('tests', test1(w)), false);
  const [operationId] = ws.state.operationIds;
  assert.deepEqual(lockedIds(ws), [operationId]);
  assert.equal(ws.canMutate(), false);
  assert.equal(await ws.write('tests', test1(w, { id: 'test-second' })), false, 'a second save is not sent while locked');
  assert.equal(ws.state.message, LOCKED_SENTENCE);
  assert.equal((await w.ledgerRow(operationId)).status, 'succeeded', 'the save landed');

  assert.equal(await ws.reconcile(operationId), true);
  assert.equal(ws.state.message, SAVED);
  assert.deepEqual(lockedIds(ws), []);
  assert.deepEqual(ws.records.tests.map((row) => [row.id, row.revision]), [['test-kitchen-tap', 1]]);
  assert.equal(await ws.write('tests', test1(w, { id: 'test-second' })), true, 'saving works again');
  assert.equal(loggedText(logged), '', 'nothing logged');
});

test('client: a save pending on another device locks the load; the check reports it pending until it settles, then a success reloads the rows', async () => {
  const w = await world();
  const operationId = crypto.randomUUID();
  await claimed(w, { operationId }, { kind: 'workspace.write', hashOf: {} });
  const ws = await loaded(w);
  assert.deepEqual(lockedIds(ws), [operationId]);
  assert.equal(await ws.write('tests', test1(w)), false);
  assert.equal(ws.state.message, LOCKED_SENTENCE);
  assert.equal(await rowCount(w, 'tests'), 0, 'nothing was sent');

  assert.equal(await ws.reconcile(operationId), false, 'still pending');
  assert.equal(ws.state.message, IN_FLIGHT_MESSAGE);
  assert.deepEqual(lockedIds(ws), [operationId]);

  // The other device's save lands, and its row settles succeeded.
  await w.db.query(`update public.operations set status = 'succeeded', result = $2::jsonb where operation_id = $1`, [operationId, JSON.stringify({ status: 'succeeded', collections: ['tests'], affected: [], removed: [], unresolvedOperations: [] })]);
  await w.command(write('tests', test1(w)));
  assert.equal(await ws.reconcile(operationId), true);
  assert.deepEqual(lockedIds(ws), []);
  assert.deepEqual(ws.records.tests.map((row) => row.id), ['test-kitchen-tap'], 'the recovered save reloads every collection');
  assert.equal(ws.canMutate(), true);

  // A pending save that fails saved nothing and no longer locks.
  const failed = crypto.randomUUID();
  await claimed(w, { operationId: failed });
  const next = await loaded(w);
  assert.deepEqual(lockedIds(next), [failed]);
  await w.db.query(`update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}' where operation_id = $1`, [failed]);
  assert.equal(await next.reconcile(failed), false);
  assert.equal(next.state.message, INCOMPLETE_MESSAGE);
  assert.deepEqual(lockedIds(next), []);
  assert.equal(next.canMutate(), true);
});

test('client: the journal and home history are unavailable; no save is sent for them and a direct command saves nothing', async () => {
  const w = await world();
  const ws = await loaded(w);
  const claims = await ledgerCount(w);
  assert.equal(await ws.write('weekJournal', { id: 'journal-1', title: 'Check-in', revision: 0 }), false);
  assert.equal(ws.state.message, 'Load the current records before saving. Your draft is kept.');
  assert.equal(await ws.write('homeTransitions', { id: 'transition-1', title: 'Move', revision: 0 }), false);
  assert.equal(await ledgerCount(w), claims, 'the provider sent nothing');
  for (const [key, reason] of [['weekJournal', 'week_journal_unavailable'], ['homeTransitions', 'home_transitions_unavailable']]) {
    const raw = await (await w.command(write(key, { id: 'x', title: 'x', revision: 0 }))).json();
    assert.deepEqual([raw.status, raw.code, raw.reason, raw.changes, raw.message], ['failed', 'unavailable', reason, {}, REFUSALS[reason].message], key);
  }
  assert.equal(await ledgerCount(w), claims, 'a refusal before the claim records nothing');
  assert.deepEqual(lockedIds(ws), []);
});

test('client: a record with a private file is refused with its sentence, the draft kept, nothing locked, stored or recorded', async () => {
  const w = await world();
  const ws = await loaded(w);
  const claims = await ledgerCount(w);
  const file = { id: 'file-1', name: 'report.pdf', mime: 'application/pdf', revision: 1, bytes: 1024, status: 'ready', metadataRemoved: true };
  assert.equal(await ws.write('tests', test1(w, { attachments: [file] })), false);
  assert.equal(ws.state.message, REFUSALS.attachments_unavailable.message);
  assert.equal(await ws.write('observations', { ...sampleRecord('observations', { homeContextId: w.home.alice }), photoAttachmentId: 'file-1', photoAttachmentRevision: 1, photoMetadataRemoved: true }), false);
  assert.equal(ws.state.message, REFUSALS.attachments_unavailable.message);
  assert.equal(await ws.write('exploreNotes', { ...note('note-photo'), photoAttachment: { id: 'file-1', name: 'p.jpg', revision: 1, metadataRemoved: true } }), false);
  assert.deepEqual(lockedIds(ws), []);
  assert.equal(ws.canMutate(), true);
  assert.deepEqual(await w.rows('alice'), []);
  assert.equal(await ledgerCount(w), claims);
  assert.equal(await ws.write('tests', test1(w)), true, 'the same record without the file saves');
});

test('client: clear-private is refused before any claim; the records stay held and stored, the review message shows, nothing is locked', async () => {
  const w = await world();
  const ws = await loaded(w);
  await ws.write('tests', test1(w));
  await ws.write('exploreNotes', note('note-1'));
  const held = structuredClone(ws.records);
  const claims = await ledgerCount(w);
  for (const scope of ['journal', 'all']) {
    assert.equal(await ws.clearPrivate(scope, recordFingerprint(ws.records, scope), false), false, scope);
    assert.equal(ws.state.message, REFUSALS.clear_unsupported.message, scope);
  }
  assert.deepEqual(ws.records, held, 'Homeguard still holds every record');
  assert.equal((await w.rows('alice')).length, 2, 'and the server still stores them');
  assert.equal(await ledgerCount(w), claims, 'nothing was claimed or recorded');
  assert.deepEqual(lockedIds(ws), []);
  assert.equal(ws.canMutate(), true);
  // The client's own guards come first.
  assert.equal(await ws.clearPrivate('all', 'a-stale-fingerprint', false), false);
  assert.equal(ws.state.message, 'Records changed. Nothing was deleted. Reopen the review.');
  assert.equal(await ws.clearPrivate('all', recordFingerprint(ws.records, 'all'), true), false);
  assert.equal(ws.state.message, 'Use the account privacy review to clear connected records together. Nothing was deleted.');
});

test('client: removing notes takes their cases with them; a changed selection is refused and nothing is removed', async () => {
  const w = await world();
  const ws = await loaded(w);
  for (const id of ['note-1', 'note-2']) {
    await ws.write('exploreNotes', note(id));
    await ws.write('exploreOutcomes', sampleRecord('exploreOutcomes', { id: `note-case:${id}`, title: `Case ${id}` }));
  }
  const tab = await loaded(w);
  assert.equal(await ws.write('exploreNotes', { ...ws.records.exploreNotes[0], description: 'Edited' }), true);
  assert.equal(await tab.removeNotes(tab.records.exploreNotes.map((row) => ({ id: row.id, revision: row.revision }))), false);
  assert.equal(tab.state.message, REFUSALS.notes_changed.message);
  assert.equal(await rowCount(w, 'exploreNotes'), 2);
  await tab.retry('exploreNotes');
  assert.equal(await tab.removeNotes(tab.records.exploreNotes.map((row) => ({ id: row.id, revision: row.revision }))), true);
  assert.deepEqual([tab.records.exploreNotes, tab.records.exploreOutcomes], [[], []]);
  assert.equal(await rowCount(w, 'exploreOutcomes'), 0);
  assert.equal(await ws.remove('exploreNotes', 'note-gone', 1), false, 'a record that is not held is not sent');
});

test('client: with the capability off every collection is an error and a save is refused unlocked; before migration 0026 a save locks on an unknown outcome', async (t) => {
  muteConsoleError(t);
  const off = await world({ env: OFF });
  const ws = await loaded(off);
  for (const key of STORED_COLLECTIONS) assert.deepEqual([ws.status(key).status, ws.status(key).message], ['error', SENTENCE.unavailable], key);
  assert.deepEqual(lockedIds(ws), []);
  // The provider never sends a save for a collection that did not load; a direct command is the disabled receipt.
  const receipt = await (await off.command(write('tests', test1(off)))).json();
  assert.deepEqual([receipt.status, receipt.code, receipt.changes, receipt.message], ['failed', 'unavailable', {}, featureDisabledReason('workspace')]);
  assert.equal(await ledgerCount(off), 0);

  // Loaded while the table existed, saved after it vanished: the client's rule for a 5xx on a mutation.
  let gone = false;
  const w = await world({ onRead: async (_args, run) => { if (gone) throw rpcError('PGRST202', 'missing'); return run(); } });
  const loadedWs = await loaded(w);
  gone = true;
  assert.equal(await loadedWs.write('tests', test1(w)), false);
  assert.equal(loadedWs.state.message, SENTENCE.unknown_outcome);
  assert.deepEqual(lockedIds(loadedWs), loadedWs.state.operationIds, 'the 503 before the claim is read as an unknown outcome and locks');
  assert.equal(await loadedWs.reconcile(loadedWs.state.operationIds[0]), false, 'and its status check finds no operation, which the client cannot confirm either');
  assert.equal(loadedWs.state.message, STILL_UNAVAILABLE);
  assert.equal(await ledgerCount(w), 0, 'nothing was ever claimed');
});

// ---------------------------------------------------------------------------
// Edge inputs: what the handlers refuse or keep apart, with the document agreeing
// ---------------------------------------------------------------------------

const requestSchema = () => compiled(operations.get('workspaceExecute').requestBody.content['application/json'].schema.$ref);
const rawRows = async (w, who, collection) => (await w.rows(who, collection)).map((row) => [row.record_id, row.revision]);

test('edge: ids, expected revisions and selections that are not valid are a 400 naming the field, recorded nowhere, and the document says so where it can', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const claims = await ledgerCount(w);
  /** `documented`: the request schema also rejects it (some rules, like control characters, JSON Schema cannot state). */
  const refused = async (cmd, field, code, documented) => {
    if (documented) assert.equal(requestSchema()(cmd), false, `the document rejects ${JSON.stringify(cmd).slice(0, 120)}`);
    const { body } = await execute(w, cmd, { valid: false, expected: 400, client: false });
    assert.deepEqual([body.code, body.field_errors[0].field, body.field_errors[0].code], ['validation_failed', field, code], JSON.stringify(cmd).slice(0, 120));
  };
  const bytes = (n) => 'x'.repeat(n);
  for (const [, id, documented] of [
    ['a line feed', 'a\nb', false], ['U+0000', 'a\u0000b', false], ['DEL', 'a\u007fb', false], ['U+0085', 'a\u0085b', false],
    ['U+2028', 'a b', false], ['a lone surrogate', 'a\ud800b', false], ['empty', '', true], ['201 characters', bytes(201), true], ['a number', 5, true],
  ]) {
    await refused(write('tests', test1(w, { id }), null), 'record.id', 'invalid_id', documented);
    await refused(remove('tests', id, 1), 'recordId', 'invalid_id', documented);
    await refused(command({ kind: 'remove-notes', selection: [{ id, revision: 1 }] }), 'selection', 'invalid_selection', documented);
  }
  // Boundaries that are accepted: 200 characters, an id with spaces and punctuation.
  for (const id of [bytes(200), 'test with spaces & (punctuation) / slashes']) {
    const { body } = await execute(w, write('tests', test1(w, { id })), {});
    assert.equal(body.status, 'succeeded', id.slice(0, 20));
    assert.equal((await execute(w, remove('tests', id, 1), {})).body.status, 'succeeded');
  }
  // Expected revisions: zero, negative, fractional, text, beyond the database's integer, missing.
  for (const revision of [0, -1, 1.5, '1', 2147483647, 1e20]) {
    await refused(write('tests', test1(w), revision), 'expectedRevision', 'invalid_revision', true);
    await refused(remove('tests', 'test-kitchen-tap', revision), 'expectedRevision', 'invalid_revision', true);
    await refused(command({ kind: 'remove-notes', selection: [{ id: 'note-1', revision }] }), 'selection', 'invalid_selection', true);
  }
  const missing = write('tests', test1(w), 1);
  delete missing.expectedRevision;
  await refused(missing, 'expectedRevision', 'invalid_revision', true);
  const missingOnRemove = remove('tests', 'test-kitchen-tap', 1);
  delete missingOnRemove.expectedRevision;
  await refused(missingOnRemove, 'expectedRevision', 'invalid_revision', true);
  // The largest revision the database holds is a stale refusal, not an error.
  const top = (await execute(w, write('tests', test1(w), 2147483646), { client: false })).body;
  assert.deepEqual([top.status, top.reason], ['failed', 'stale_revision']);
  // Selections: none, 101, the same note twice, not a list, an item that is not {id, revision}.
  await refused(command({ kind: 'remove-notes', selection: [] }), 'selection', 'invalid_selection', true);
  await refused(command({ kind: 'remove-notes', selection: Array.from({ length: 101 }, (_, index) => ({ id: `n${index}`, revision: 1 })) }), 'selection', 'invalid_selection', true);
  await refused(command({ kind: 'remove-notes', selection: [{ id: 'n1', revision: 1 }, { id: 'n1', revision: 1 }] }), 'selection', 'invalid_selection', false);
  await refused(command({ kind: 'remove-notes', selection: { id: 'n1', revision: 1 } }), 'selection', 'invalid_selection', true);
  await refused(command({ kind: 'remove-notes', selection: ['n1'] }), 'selection', 'invalid_selection', true);
  await refused(command({ kind: 'remove-notes' }), 'selection', 'invalid_selection', true);
  assert.equal(await ledgerCount(w), claims + 5, 'only the two accepted writes, the two accepted removes and the stale write were claimed: no 400 recorded anything');
});

test('edge: a selection of exactly 100 notes is removed with their 100 cases in one commit; one stale item among 100 removes none', async () => {
  const w = await world();
  const ids = Array.from({ length: 100 }, (_, index) => `n${String(index).padStart(3, '0')}`);
  await w.db.query(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record)
     select $1, 'exploreNotes', n, 1, jsonb_build_object('id', n, 'title', n) from unnest($2::text[]) n`, [w.ids.alice, ids]);
  await w.db.query(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record)
     select $1, 'exploreOutcomes', 'note-case:' || n, 1, jsonb_build_object('id', 'note-case:' || n, 'title', n) from unnest($2::text[]) n`, [w.ids.alice, ids]);
  await w.db.query(`update public.household_workspace_records set revision = 2 where profile_id = $1 and record_id = $2`, [w.ids.alice, ids[57]]);
  const stale = command({ kind: 'remove-notes', selection: ids.map((id) => ({ id, revision: 1 })) });
  const { body: refused } = await execute(w, stale, { client: false });
  assert.deepEqual([refused.code, refused.reason, refused.changes], ['conflict', 'notes_changed', {}]);
  assert.equal(await rowCount(w, 'exploreNotes'), 100, 'one stale note among 100 removed none');
  assert.equal(await rowCount(w, 'exploreOutcomes'), 100);
  const fresh = command({ kind: 'remove-notes', selection: ids.map((id, index) => ({ id, revision: index === 57 ? 2 : 1 })) });
  const { body: done } = await execute(w, fresh, {});
  assert.deepEqual(done.changes, { exploreNotes: [], exploreOutcomes: [] });
  assert.equal(await rowCount(w, 'exploreNotes') + await rowCount(w, 'exploreOutcomes'), 0);
  const { body: operation } = await reconcile(w, fresh, {});
  assert.equal(operation.removed.length, 200, 'the receipt names all 100 notes and all 100 cases');
});

test('edge: another household\'s record ids, links, homes and operation ids are never reachable, and never change that household\'s rows', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const bobsHome = w.home.bob;
  const bob = (cmd, options = {}) => w.command(cmd, { as: 'bob', ...options }).then((res) => res.json());
  assert.equal((await bob(write('tests', sampleRecord('tests', { id: 'shared-id', homeContextId: bobsHome, title: 'Bob' })))).status, 'succeeded');
  assert.equal((await bob(write('tests', sampleRecord('tests', { id: 'bob-only', homeContextId: bobsHome })))).status, 'succeeded');
  assert.equal((await bob(write('assets', sampleRecord('assets', { id: 'bob-asset', homeContextId: bobsHome })))).status, 'succeeded');
  assert.equal((await bob(write('gardens', sampleRecord('gardens', { id: 'bob-garden', homeContextId: bobsHome })))).status, 'succeeded');
  const bobsRows = await w.rows('bob');
  const bobsOp = write('tests', sampleRecord('tests', { id: 'bob-op-record', homeContextId: bobsHome }));
  assert.equal((await bob(bobsOp)).status, 'succeeded');
  const bobsRowsAfterOp = await w.rows('bob');
  const ledgerBefore = JSON.stringify(await w.ledgerRow(bobsOp.operationId));

  // The same id in two households is two records, each at revision 1.
  const same = await execute(w, write('tests', test1(w, { id: 'shared-id', title: 'Alice' })), {});
  assert.deepEqual(same.body.changes.tests.map((row) => [row.id, row.revision, row.title]), [['shared-id', 1, 'Alice']]);
  // A remove of an id that only the other household has: stale, and it is still there.
  const remote = (await execute(w, remove('tests', 'bob-only', 1), { client: false })).body;
  assert.deepEqual([remote.status, remote.reason], ['failed', 'stale_revision'], 'indistinguishable from an id that does not exist');
  const nowhere = (await execute(w, remove('tests', 'never-existed', 1), { client: false })).body;
  assert.deepEqual({ ...nowhere, operationId: remote.operationId }, remote, 'the same body as an id that exists nowhere');
  assert.deepEqual((await w.rows('bob')).map((row) => row.record_id), bobsRowsAfterOp.map((row) => row.record_id), 'and bob still has the record');
  // Links: a record, a home, a context, a garden's tests, an observation's asset, each one the other household's.
  const links = [
    ['foodQuestions', sampleRecord('foodQuestions', { id: 'q1', reportId: 'bob-only' })],
    ['assets', sampleRecord('assets', { id: 'a1', homeContextId: bobsHome })],
    ['assets', sampleRecord('assets', { id: 'a2', homeContextId: w.home.alice, testId: 'bob-only' })],
    ['tests', test1(w, { id: 't-ctx', contextId: bobsHome })],
    ['tests', test1(w, { id: 't-garden', contextId: 'bob-garden' })],
    ['tests', { ...test1(w, { id: 't-home' }), homeContextId: bobsHome }],
    ['gardens', sampleRecord('gardens', { id: 'g1', homeContextId: w.home.alice, testIds: ['bob-only'] })],
    ['observations', sampleRecord('observations', { id: 'o1', homeContextId: w.home.alice, assetId: 'bob-asset' })],
    ['growerInquiries', sampleRecord('growerInquiries', { id: 'i1', siteId: 'bob-garden' })],
  ];
  for (const [collection, record] of links) {
    const { body } = await execute(w, write(collection, record), { client: false });
    assert.deepEqual([body.status, body.code, body.reason, body.changes], ['failed', 'validation', 'invalid_reference', {}], `${collection} ${record.id}`);
  }
  assert.deepEqual((await w.rows('alice')).map((row) => row.record_id), ['shared-id'], 'none of them was stored');
  // The X-Halo-Home-Context header names another household's home: ignored, as documented.
  const withHeader = await execute(w, write('tests', test1(w, { id: 'with-header' })), { headers: { 'x-halo-home-context': bobsHome } });
  assert.equal(withHeader.body.status, 'succeeded');
  const loaded = await load(w, 'tests', { headers: { 'x-halo-home-context': bobsHome } });
  assert.deepEqual(loaded.body.records.map((row) => row.id), ['shared-id', 'with-header']);
  // Bob's operation id, sent by alice: the same terminal 409, whatever she sends with it; nothing of bob's changes.
  for (const sent of [bobsOp, { ...bobsOp, record: test1(w, { id: 'zzz' }) }]) {
    const { body } = await execute(w, sent, { expected: 409, client: false, ifMatch: false });
    assert.equal(body.reason, 'operation_mismatch');
  }
  assert.equal((await w.reconcile(bobsOp.operationId)).status, 404, 'and she cannot read it either');
  assert.deepEqual(await w.rows('bob'), bobsRowsAfterOp, 'bob\'s rows are untouched');
  assert.notDeepEqual(bobsRows, bobsRowsAfterOp);
  assert.equal(JSON.stringify(await w.ledgerRow(bobsOp.operationId)), ledgerBefore, 'bob\'s ledger row is untouched');
  assert.deepEqual((await w.rows('alice')).map((row) => row.record_id), ['shared-id', 'with-header']);
  // Bob's pending operation is not alice's lock, and hers is not his.
  await w.db.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'workspace', 'workspace.write', 'pending', 'h')`,
    [crypto.randomUUID(), w.ids.bob]);
  assert.deepEqual((await load(w, 'tests', {})).body.pendingOperations, []);
  assert.equal((await load(w, 'tests', { as: 'bob' })).body.pendingOperations.length, 1);
});

test('edge: a refusal replays as the same refusal after the data changed; a success replays as the current rows, or as changed_elsewhere when its effect was undone, which the client settles', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const existing = test1(w);
  await execute(w, write('tests', existing), {});
  const duplicate = write('tests', existing);
  const { body: refusal } = await execute(w, duplicate, {});
  assert.equal(refusal.reason, 'stale_revision');
  assert.equal((await execute(w, remove('tests', existing.id, 1), {})).body.status, 'succeeded');
  // The create would succeed now, but the operation is settled failed: the same body, nothing created.
  const { body: replayed } = await execute(w, duplicate, {});
  assert.deepEqual(replayed, refusal);
  assert.equal(await rowCount(w, 'tests'), 0);
  const { body: operation } = await reconcile(w, duplicate, {});
  assert.deepEqual([operation.status, operation.reason, operation.changes], ['failed', 'stale_revision', {}]);
  // Refused for a missing link; the link now exists; the replay is still the refusal.
  const question = write('foodQuestions', sampleRecord('foodQuestions', { id: 'q1', reportId: 'later-test' }));
  const { body: dangling } = await execute(w, question, {});
  assert.equal(dangling.reason, 'invalid_reference');
  await execute(w, write('tests', test1(w, { id: 'later-test' })), {});
  assert.deepEqual((await execute(w, question, {})).body, dangling);
  assert.equal(await rowCount(w, 'foodQuestions'), 0);
  // A different operation id for the same command now succeeds.
  assert.equal((await execute(w, write('foodQuestions', question.record), {})).body.status, 'succeeded');

  // A success replays as what is stored NOW (Ruling W5). If its effect has since been undone on another device
  // (the saved record deleted, or the removed one added again) the client cannot settle a succeeded receipt:
  // the ledger holds no record content (Ruling W15). It is answered `failed` / changed_elsewhere instead, which
  // the client resolves, so Homeguard ends unlocked on both the reconcile and a command replay.
  const lost = await world();
  let lose = null;
  const ws = await loaded(lost, 'alice', { lose: (pathname) => pathname === COMMANDS && lose !== null && lose(pathname) });
  const loseOnce = () => { let spent = false; lose = () => !spent && (spent = true); };
  const settled = REFUSALS.changed_elsewhere;

  // A create whose answer was lost, then the record deleted on another device.
  loseOnce();
  assert.equal(await ws.write('tests', test1(lost, { id: 'gone-later' })), false);
  const [operationId] = ws.state.operationIds;
  assert.deepEqual(lockedIds(ws), [operationId]);
  const other = await loaded(lost);
  assert.equal(await other.remove('tests', 'gone-later', 1), true);
  const current = await (await lost.reconcile(operationId)).json();
  assert.deepEqual([current.status, current.reason, current.code, current.changes, current.unresolvedOperations], ['failed', 'changed_elsewhere', 'conflict', {}, []]);
  assert.equal((await lost.ledgerRow(operationId)).status, 'succeeded', 'the ledger still says succeeded');
  assert.equal(await ws.reconcile(operationId), false);
  assert.equal(ws.state.message, settled.message);
  assert.deepEqual(lockedIds(ws), [], 'unlocked');
  assert.equal(ws.canMutate(), true);
  assert.deepEqual(ws.records.tests, [], 'and the collection holds no ghost of the deleted record');
  assert.equal(await ws.write('tests', test1(lost, { id: 'again' })), true, 'and the next save works');
  assert.deepEqual(ws.records.tests.map((row) => row.id), ['again']);
  assert.deepEqual((await loaded(lost)).records.tests.map((row) => row.id), ['again'], 'a reload agrees');

  // An update whose answer was lost, then the record deleted: the row A still shows is stale, and saving it is
  // an ordinary conflict, not a lock.
  loseOnce();
  assert.equal(await ws.write('tests', { ...ws.records.tests[0], provider: 'County lab' }), false);
  const updateId = ws.state.operationIds.at(-1);
  assert.equal(await (await loaded(lost)).remove('tests', 'again', 2), true);
  assert.equal(await ws.reconcile(updateId), false);
  assert.deepEqual([ws.state.message, lockedIds(ws)], [settled.message, []]);
  assert.equal(await ws.write('tests', { ...ws.records.tests[0], provider: 'Again' }), false);
  assert.equal(ws.state.message, REFUSALS.stale_revision.message);
  assert.deepEqual(lockedIds(ws), []);

  // A remove whose answer was lost, then the same id added again on another device.
  assert.equal(await ws.write('tests', test1(lost, { id: 'back' })), true);
  loseOnce();
  assert.equal(await ws.remove('tests', 'back', 1), false);
  const removeId = ws.state.operationIds.at(-1);
  assert.equal(await (await loaded(lost)).write('tests', test1(lost, { id: 'back', title: 'Added again' })), true);
  assert.equal(await ws.reconcile(removeId), false);
  assert.deepEqual([ws.state.message, lockedIds(ws)], [settled.message, []]);

  // Still the current rows while the effect stands (a newer revision of the record is still the saved record).
  loseOnce();
  assert.equal(await ws.write('tests', test1(lost, { id: 'kept' })), false);
  const keptId = ws.state.operationIds.at(-1);
  const editor = await loaded(lost);
  assert.equal(await editor.write('tests', { ...editor.records.tests.find((row) => row.id === 'kept'), title: 'Edited elsewhere' }), true);
  assert.equal(await ws.reconcile(keptId), true);
  assert.deepEqual(ws.records.tests.filter((row) => row.id === 'kept').map((row) => [row.revision, row.title]), [[2, 'Edited elsewhere']]);
  assert.deepEqual(lockedIds(ws), []);

  // The commands route's replay of the same succeeded save answers the same, through the real client.
  const w2 = await world();
  const saved = write('tests', test1(w2, { id: 'replayed' }));
  assert.equal((await execute(w2, saved, {})).body.status, 'succeeded');
  assert.equal(await (await loaded(w2)).remove('tests', 'replayed', 1), true);
  const { body: replay } = await execute(w2, saved, { fixture: 'workspaceExecute-refused-changed-elsewhere' });
  assert.deepEqual([replay.status, replay.code, replay.reason, replay.changes, replay.message], ['failed', 'conflict', 'changed_elsewhere', {}, settled.message]);
  const { body: gone } = await reconcile(w2, saved, { fixture: 'operationsRead-workspace-changed-elsewhere' });
  assert.deepEqual([gone.status, gone.reason, gone.changes, gone.unresolvedOperations], ['failed', 'changed_elsewhere', {}, []]);
  assert.equal(await rowCount(w2, 'tests'), 0, 'the replay recreated nothing');
  // Another household's view of the same id is untouched by all of this.
  assert.equal((await w2.reconcile(saved.operationId, { as: 'bob' })).status, 404);
});

test('edge: a change that lands between the route\'s read and the commit is refused by the commit function itself, with the same stored reasons and sentences', async (t) => {
  muteConsoleError(t);
  let between = null;
  const w = await world({ onRead: async (_args, run) => { const rows = await run(); if (between) { const step = between; between = null; await step(); } return rows; } });
  const sql = (text, ...values) => w.db.query(text, [w.ids.alice, ...values]);
  const seed = async (collection, id, revision = 1) => sql(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record) values ($1, $2, $3, $4, jsonb_build_object('id', $3::text, 'title', 'x'))`, collection, id, revision);
  const refusalOf = async (cmd, step) => { between = step; const { body } = await execute(w, cmd, { client: false }); assert.equal(between, null, 'the change ran between the read and the commit'); return body; };

  // A second tab saves the record after this one read it.
  await execute(w, write('tests', test1(w)), {});
  const raced = await refusalOf(write('tests', { ...test1(w), provider: 'Late' }, 1), () => sql(`update public.household_workspace_records set revision = 2 where profile_id = $1 and record_id = 'test-kitchen-tap'`));
  assert.deepEqual([raced.code, raced.reason, raced.message, raced.changes], ['conflict', 'stale_revision', REFUSALS.stale_revision.message, {}]);
  // The same id is created elsewhere between the read and the commit.
  const created = await refusalOf(write('tests', test1(w, { id: 'test-twice' })), () => seed('tests', 'test-twice'));
  assert.equal(created.reason, 'stale_revision');
  // A remove of a record that is removed elsewhere.
  await seed('tests', 'test-removed-twice');
  const removed = await refusalOf(remove('tests', 'test-removed-twice', 1), () => sql(`delete from public.household_workspace_records where profile_id = $1 and record_id = 'test-removed-twice'`));
  assert.equal(removed.reason, 'stale_revision');
  // A selection whose note changed: the whole selection, the notes sentence.
  await seed('exploreNotes', 'note-a');
  await seed('exploreNotes', 'note-b');
  const notes = await refusalOf(command({ kind: 'remove-notes', selection: [{ id: 'note-a', revision: 1 }, { id: 'note-b', revision: 1 }] }), () => sql(`update public.household_workspace_records set revision = 2 where profile_id = $1 and record_id = 'note-b'`));
  assert.deepEqual([notes.code, notes.reason, notes.message], ['conflict', 'notes_changed', REFUSALS.notes_changed.message]);
  assert.deepEqual(await rawRows(w, 'alice', 'exploreNotes'), [['note-a', 1], ['note-b', 2]], 'nothing was removed');
  // The record a link names is removed elsewhere.
  await seed('tests', 'test-linked');
  const linked = await refusalOf(write('foodQuestions', sampleRecord('foodQuestions', { id: 'q1', reportId: 'test-linked' })), () => sql(`delete from public.household_workspace_records where profile_id = $1 and record_id = 'test-linked'`));
  assert.deepEqual([linked.code, linked.reason], ['validation', 'invalid_reference']);
  // The collection fills up elsewhere.
  const full = await refusalOf(write('usage', sampleRecord('usage', { id: 'u-last', homeContextId: w.home.alice })), () => sql(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record) select $1, 'usage', 'bulk-' || g, 1, jsonb_build_object('id', 'bulk-' || g, 'title', 'x') from generate_series(1, 1000) g`));
  assert.deepEqual([full.code, full.reason], ['validation', 'limit']);
  // Each was settled failed with its reason and replays as the same body.
  for (const body of [raced, created, removed, notes, linked, full]) {
    const row = await w.ledgerRow(body.operationId);
    assert.deepEqual([row.status, row.result.reason], ['failed', body.reason]);
  }
});

test('edge: a collection over 1,500,000 bytes is the limit refusal even under 1,000 records, and a record of 262,144 bytes or less is stored', async () => {
  const w = await world();
  /** A valid test of exactly `bytes` bytes once stored (revision 1), padded with result rows and a title, each text field under the client's 30,000 character rule. */
  const sized = (id, bytes, owner = w) => {
    const row = (index) => ({ id: `r${index}`, analyte: 'a', originalValue: 'x'.repeat(29000), originalUnit: '', limit: '', limitUnit: '', basis: '', reportReference: '', reportDate: '', qualifier: 'measured' });
    const record = test1(owner, { id, rows: [] });
    const measure = () => Buffer.byteLength(JSON.stringify({ ...record, revision: 1 }), 'utf8');
    while (bytes - measure() > 29000 + 1200) record.rows.push(row(record.rows.length));
    const rest = bytes - measure();
    record.title += 'x'.repeat(Math.min(rest, 29000));
    record.purpose += 'x'.repeat(rest - Math.min(rest, 29000));
    assert.equal(measure(), bytes);
    return record;
  };
  // Five stored records of 250,000 bytes each: 1,250,000 bytes, far under the record count.
  for (let index = 1; index <= 5; index += 1) {
    await w.db.query(
      `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record) values ($1, 'tests', $2, 1, $3::jsonb)`,
      [w.ids.alice, `big-${index}`, JSON.stringify({ ...sized(`big-${index}`, 250000), revision: undefined })]);
  }
  const { body: over } = await execute(w, write('tests', sized('test-over', 260000)), { client: false });
  assert.deepEqual([over.code, over.reason, over.message], ['validation', 'limit', REFUSALS.limit.message], 'the stored total would pass 1,500,000 bytes');
  assert.equal(await rowCount(w, 'tests'), 5);
  const { body: fits } = await execute(w, write('tests', sized('test-fits', 100000)), { client: false });
  assert.equal(fits.status, 'succeeded', 'and a smaller record still fits');
  // The record cap itself: 262,144 bytes of JSON is stored, one byte more is refused before any claim.
  const edge = await world();
  const exact = (await execute(edge, write('tests', sized('test-edge', LIMITS.recordBytes, edge)), { client: false })).body;
  assert.deepEqual([exact.status, exact.reason], ['succeeded', undefined], 'exactly 262,144 bytes');
  const before = await ledgerCount(edge);
  const { body: tooBig } = await execute(edge, write('tests', sized('test-edge-2', LIMITS.recordBytes + 1, edge)), { client: false });
  assert.equal(tooBig.reason, 'limit');
  assert.equal(await ledgerCount(edge), before, 'refused before any claim');
});

test('edge: with only one of the two migration functions missing, the answers stay the non-retryable 503; a missing commit function is claimed first', async (t) => {
  muteConsoleError(t);
  // read_household_workspace missing, under either error code a client of PostgREST or Postgres sees.
  for (const code of ['PGRST202', '42883']) {
    const w = await world({ onRead: async () => { throw rpcError(code, 'function public.read_household_workspace does not exist'); } });
    const { body: loadBody } = await load(w, 'tests', { expected: 503 });
    assert.deepEqual([loadBody.code, loadBody.retryable], ['feature_unavailable', false], code);
    const cmd = write('tests', test1(w));
    const { body } = await execute(w, cmd, { expected: 503, client: false });
    assert.deepEqual([body.code, body.retryable], ['feature_unavailable', false], code);
    assert.equal(await ledgerCount(w), 0, `${code}: decided before any claim`);
  }
  // commit_household_workspace missing alone: the read worked, so the claim exists and settles failed.
  const w = await world({ onCommit: async () => { throw rpcError('PGRST202', 'function public.commit_household_workspace does not exist'); } });
  const cmd = write('tests', test1(w));
  const { body } = await execute(w, cmd, { expected: 503, client: false });
  assert.deepEqual([body.code, body.retryable], ['feature_unavailable', false]);
  assert.deepEqual([(await w.ledgerRow(cmd.operationId)).status, (await w.ledgerRow(cmd.operationId)).result], ['failed', null]);
  assert.equal(await rowCount(w, 'tests'), 0);
  const { body: replay } = await execute(w, cmd, { expected: 409, client: false });
  assert.equal(replay.reason, 'not_applied');
  const { body: reconciled } = await reconcile(w, cmd, {});
  assert.deepEqual([reconciled.status, reconciled.changes, reconciled.message], ['failed', {}, INCOMPLETE_MESSAGE]);
  assert.deepEqual((await load(w, 'tests', {})).body.records, []);
  // A succeeded operation whose rows can no longer be read (the read function vanished after the save): 503, not an empty receipt.
  let gone = false;
  const late = await world({ onRead: async (_args, run) => { if (gone) throw rpcError('PGRST202', 'missing'); return run(); } });
  const saved = write('tests', test1(late));
  await execute(late, saved, {});
  gone = true;
  const { body: unavailable } = await reconcile(late, saved, { expected: 503, client: false });
  assert.deepEqual([unavailable.code, unavailable.retryable], ['feature_unavailable', false]);
});

test('edge: a reconcile with the capability off is a 503 for an operation this household has and still a 404 for one it does not; 150 pending saves list as the oldest 100', async () => {
  const w = await world();
  const saved = write('tests', test1(w));
  await execute(w, saved, {});
  const known = await reconcile(w, saved, { env: OFF, expected: 503 });
  assert.equal(known.body.code, 'feature_unavailable');
  const unknown = await reconcile(w, saved, { env: OFF, operationId: crypto.randomUUID(), expected: 404 });
  assert.equal(unknown.body.code, 'not_found');
  const ids = Array.from({ length: 150 }, () => crypto.randomUUID());
  for (const [index, operationId] of ids.entries()) {
    await w.db.query(
      `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, created_at)
       values ($1, $2, 'workspace', 'workspace.write', 'pending', 'h', now() - ($3 || ' milliseconds')::interval)`,
      [operationId, w.ids.alice, String(10_000 + (150 - index) * 10)]);
  }
  const { body } = await load(w, 'tests', {});
  assert.deepEqual(body.pendingOperations.map((item) => item.operationId), ids.slice(0, 100), 'the oldest 100, oldest first');
  validate('workspaceLoad', 200, body);
});

// ---------------------------------------------------------------------------
// The document is not looser than the handlers where the client would be misled
// ---------------------------------------------------------------------------

test('the document rejects a corrupted copy of every recorded 200 answer it applies to', () => {
  const without = (body, key) => { const rest = { ...body }; delete rest[key]; return rest; };
  const rowsOf = (body) => Object.values(body.changes ?? {}).some((rows) => rows.length);
  const isLoad = (item) => item.operationId === 'workspaceLoad';
  const corruptions = [
    ['drops changes', (item) => !isLoad(item), (body) => without(body, 'changes')],
    ['adds a data key', () => true, (body) => ({ ...body, data: {} })],
    ['adds an unknown key', () => true, (body) => ({ ...body, extra: 1 })],
    ['drops the operation id', (item) => !isLoad(item), (body) => without(body, 'operationId')],
    ['changes the status', (item) => !isLoad(item), (body) => ({ ...body, status: 'weird' })],
    ['changes the sentence', (item) => item.body.message !== undefined, (body) => ({ ...body, message: `${body.message}!` })],
    ['swaps the code', (item) => item.body.code !== undefined, (body) => ({ ...body, code: body.code === 'conflict' ? 'validation' : 'conflict' })],
    ['writes rows into a failure or an open operation', (item) => !isLoad(item) && item.body.status !== 'succeeded', (body) => ({ ...body, changes: { tests: [] } })],
    ['empties a success', (item) => item.body.status === 'succeeded', (body) => ({ ...body, changes: {} })],
    ['names a collection that is never stored', (item) => item.body.changes !== undefined, (body) => ({ ...body, changes: { weekJournal: [] } })],
    ['sets a row revision to 0', (item) => rowsOf(item.body), (body) => ({ ...body, changes: Object.fromEntries(Object.entries(body.changes).map(([key, rows]) => [key, rows.map((row) => ({ ...row, revision: 0 }))])) })],
    ['lists an unresolved operation', (item) => item.body.unresolvedOperations !== undefined, (body) => ({ ...body, unresolvedOperations: ['x'] })],
    ['drops the pending list', isLoad, (body) => without(body, 'pendingOperations')],
    ['flips availability', isLoad, (body) => ({ ...body, availability: body.availability === 'ready' ? 'empty' : 'ready' })],
    ['flips complete', isLoad, (body) => ({ ...body, complete: !body.complete })],
  ];
  let rejections = 0;
  for (const fixture of fixtures.filter((item) => item.status === 200)) {
    const check = compiled(operations.get(fixture.operationId).responses['200'].content['application/json'].schema.$ref);
    for (const [name, applies, change] of corruptions) {
      if (!applies(fixture)) continue;
      assert.equal(check(change(fixture.body)), false, `${fixture.name}: the document accepts a body that ${name}`);
      rejections += 1;
    }
  }
  assert.ok(rejections > 100, `a real corpus was checked, got ${rejections}`);
});

// ---------------------------------------------------------------------------
// The fixtures are what the handlers produce
// ---------------------------------------------------------------------------

test('every fixture has the consequence in the client that the contract says it has', async () => {
  for (const fixture of fixtures) await assertClient(fixture.operationId, fixture.status, fixture.body, fixture.request, fixture.name);
  assert.ok(fixtures.length >= 50,`every fixture was checked, got ${fixtures.length}`);
});

test('every fixture is the normalised answer of a real handler in this file, and every answer recorded as one has a fixture', async () => {
  if (WRITE_FIXTURES) {
    for (const [name, value] of produced) {
      await writeFile(new URL(`${name}.json`, FIXTURE_DIR), `${JSON.stringify(value, null, 2)}\n`);
    }
    return;
  }
  const names = new Set(fixtures.map((item) => item.name.replace(/\.json$/, '')));
  assert.deepEqual([...names].sort(), [...produced.keys()].sort(), 'the fixture set is the produced set');
  for (const fixture of fixtures) {
    const { name, ...stored } = fixture;
    assert.deepEqual(stored, produced.get(name.replace(/\.json$/, '')), `${name} is what the handler answers today`);
  }
});

test('no B11 fixture carries a secret, a token, a database detail, a real address or a record the suite typed as private', () => {
  const forbidden = [
    /sk-[A-Za-z0-9]/, /Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/, /api[_-]?key/i, /secret/i, /password/i, /authorization/i,
    /supabase|upstash|openrouter|openai|mapbox|postgres|PGRST|HALO_[A-Z]/i,
    /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/,
    /PRIVATE-B11/,
  ];
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture);
    for (const pattern of forbidden) assert.equal(pattern.test(serialized), false, `${fixture.name} matches ${pattern}`);
    for (const url of serialized.match(/https?:\/\/[^"\\\s]+/g) ?? []) assert.ok(url.startsWith('https://example.test/'), `${fixture.name}: ${url} is a reserved host`);
    assert.ok([REQUEST_ID, undefined].includes(fixture.body.request_id), `${fixture.name}: a synthetic request id`);
    for (const id of serialized.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) {
      assert.ok(id.startsWith('0b110000-0000-4000-8000-'), `${fixture.name}: ${id} is synthetic`);
    }
  }
});

// ---------------------------------------------------------------------------
// Header documentation, both ways. Runs last: tests in one file run in order.
// ---------------------------------------------------------------------------

test('B11 contract headers: every documented response header is really sent, for the pairs these tests exercise', () => {
  assert.ok(seenHeaders.size > 0, 'no conformance responses were recorded');
  for (const [key, seen] of seenHeaders) {
    const [id, status] = key.split(' ');
    for (const name of documentedHeaders(id, status)) {
      if (CHECKED_HEADERS.includes(name)) assert.ok(seen.has(name), `${key}: the contract documents ${name} but no exercised response sent it`);
    }
  }
});

test('B11 contract headers: every documented request header (Idempotency-Key, If-Match, X-Halo-Home-Context) was sent by an exercised request', () => {
  for (const id of operations.keys()) {
    for (const name of documentedParams(id)) {
      assert.ok(sentHeaders.get(id)?.has(name), `${id}: the contract documents the ${name} header but no exercised request sent it`);
    }
  }
  assert.deepEqual([...documentedParams('workspaceLoad')], ['x-halo-home-context']);
  assert.deepEqual([...documentedParams('workspaceExecute')].sort(), ['idempotency-key', 'if-match', 'x-halo-home-context']);
  assert.deepEqual([...documentedParams('operationsRead')], []);
});
