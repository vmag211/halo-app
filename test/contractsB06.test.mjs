/**
 * B06 My Week: the executable contract, and conformance of the REAL handlers
 * to it and to the frontend's own consumption logic.
 *
 * The per-route suites prove each route right on its own terms. What none of
 * them proves is that the operations agree:
 *
 *   - with the frontend. The client refuses a whole snapshot on one wrong
 *     field (validActionSnapshot, the adapter's receipt check), locks My Week
 *     on the first unresolved id, and decides from a receipt's status alone
 *     whether a save was applied, refused or unknown. So every answer here,
 *     real or fixture, is run through the client's own code and the test
 *     asserts what the client then DOES (ready or not, locked or not, which
 *     sentence it shows), not only whether the body has the right shape;
 *   - with EACH OTHER. The load, a commit's receipt and the reconcile of that
 *     commit each hand the screen a snapshot it commits as the truth
 *     (ExpandedPreviewState.tsx:60-68), so the three must be the same
 *     snapshot for the same state, and the empty household must be the same
 *     bytes on all three;
 *   - with the document, `docs/backend/contracts/b06.openapi.json`, which is
 *     what a reader will believe. Every fixture under
 *     `docs/backend/contracts/fixtures/b06/` is the normalised body a real
 *     handler produced in this file, and the last tests fail if one drifts.
 *
 * The client code is IMPORTED from the real TypeScript modules, once, by
 * test/helpers/frontendB06.mjs (shared with routesActionsCommit,
 * routesActionsCommitDb, routesOperations and routesWeekChanges; the real
 * runtime's own `request` runs over the route harness, and only the `.tsx`
 * screen logic stays transcribed there). A validator that always said yes
 * would pass every body, so `the transcriptions reject what the client
 * rejects` (its name is kept from when they were copies) shows it saying no,
 * and a drift test pins lib/actionRules.js (the server's own copy, Ruling H15)
 * against the real frontend on a shared corpus.
 *
 * Structure, in order: the schemas against the fixtures, the contract's own
 * coverage, the schemas refusing drift, the transcriptions' self-checks and
 * the drift pin, the fixtures through the client, the real handlers against
 * both, the client end to end, cross-route agreement, the fixtures against
 * the handlers, the hygiene scan, and the two directions of header
 * documentation (last, because they report on what ran before them).
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * fake, migration 0023's real functions on PGlite (test/helpers/actionsWorld.mjs),
 * and a fetch that throws on any host. No real Supabase project, no production
 * URL. Run `node test/contractsB06.test.mjs --write-b06-fixtures` to rewrite
 * the fixtures from the handlers after a deliberate contract change.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { createWorld, ON } from './helpers/actionsWorld.mjs';
import * as fe from './helpers/frontendB06.mjs';

const { requestHash } = await import('../lib/operations.js');
const rules = await import('../lib/actionRules.js');
const { featureDisabledReason } = await import('../lib/features.js');
const { ACTION_CHECKS } = await import('../lib/actionsStore.js');

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b06.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b06', components: contract.components });
const operations = new Map(
  Object.entries(contract.paths).flatMap(([route, verbs]) =>
    Object.entries(verbs).map(([method, op]) => [op.operationId, { ...op, path: route, method: method.toUpperCase() }])),
);
const validators = new Map();
function compiled(ref) {
  if (!validators.has(ref)) validators.set(ref, ajv.compile({ $ref: `urn:halo:b06${ref}` }));
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
}
/** The documented REQUEST body, applied to one a test is about to send. */
function validateRequest(operationId, body) {
  const ref = operations.get(operationId).requestBody?.content['application/json'].schema.$ref;
  assert.ok(ref, `${operationId} documents no request body`);
  const check = compiled(ref);
  assert.equal(check(body), true, `${operationId} request: ${ajv.errorsText(check.errors)}`);
}

const FIXTURE_DIR = new URL('../docs/backend/contracts/fixtures/b06/', import.meta.url);
const WRITE_FIXTURES = process.argv.includes('--write-b06-fixtures');
const fixtures = existsSync(FIXTURE_DIR)
  ? await Promise.all(
    (await readdir(FIXTURE_DIR))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8')) })),
  )
  : [];

const EM_DASH = String.fromCharCode(0x2014);
/** On every B06 body: no top-level data key (runtime.ts:149-153 would unwrap it), no U+2014 literal or escaped. */
function assertBare(body, label) {
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), `${label}: an object body`);
  assert.equal(Object.hasOwn(body, 'data'), false, `${label}: no top-level data key (runtime.ts:149-153)`);
  const text = JSON.stringify(body);
  assert.equal(text.includes(EM_DASH), false, `${label}: no U+2014`);
  assert.equal(text.toLowerCase().includes('\\u2014'), false, `${label}: no escaped U+2014`);
}

const RECOVERED = 'Saved. The existing task result was recovered.';
const ANOTHER = 'Another earlier save needs checking.';
const NOT_APPLIED = 'No save was applied. Your draft is kept for review.';
const STILL_UNCONFIRMED = 'The outcome is still unconfirmed. No new save was sent.';
const COULD_NOT_CHECK = 'Could not check this save. No new save was sent.';
const COULD_NOT_LOAD = 'Your tasks could not load. Reconnect and try again.';
const EARLIER = 'An earlier save needs checking before changing tasks.';
const ACK_NOT_APPLIED = 'The update was not applied. You can try again.';
const ACK_NOT_CONFIRMED = 'The update is not confirmed. Select Reviewed again to check its status.';
const GAP = 'Choose a valid dated time outside clock-change gaps or ambiguous times.';
const REFUSALS = ['metadata_changed', 'stale_revision', 'unknown_action', 'invalid_result', 'busy'];
const CONFLICT_REASONS = ['operation_mismatch', 'abandoned', 'not_applied', 'unrecognized_receipt'];
const EMPTY = '{"actions":[],"metas":{},"preferences":{},"unresolvedOperations":[]}';

for (const fixture of fixtures) {
  test(`B06 fixture: ${fixture.name}`, () => {
    validate(fixture.operationId, fixture.status, fixture.body);
    assertBare(fixture.body, fixture.name);
  });
}

// ---------------------------------------------------------------------------
// The contract's own coverage
// ---------------------------------------------------------------------------

test('B06 contract covers the four built operations and the B06 half of operations.read, and every documented status has a fixture', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, 'b06-1');
  assert.deepEqual([...operations.keys()].sort(), ['actionsCommit', 'actionsLoad', 'operationsRead', 'weekAcknowledge', 'weekChanges']);
  assert.deepEqual(Object.fromEntries([...operations].map(([id, op]) => [id, `${op.method} ${op.path} ${op['x-halo-operation']}`])), {
    actionsLoad: 'GET /api/frontend/actions actions.load',
    actionsCommit: 'POST /api/frontend/actions/commands actions.commit',
    weekChanges: 'GET /api/week/changes week.changes',
    weekAcknowledge: 'POST /api/week/changes/acknowledge week.acknowledge',
    operationsRead: 'GET /api/operations operations.read',
  }, 'each names its path, method and frontend registry operation (runtime.ts:28-32)');
  for (const [id, op] of operations) {
    for (const status of Object.keys(op.responses)) {
      assert.ok(fixtures.some((item) => item.operationId === id && String(item.status) === status), `${id} is missing a ${status} fixture`);
    }
    assert.ok(op.responses['401'] && op.responses['503'], `${id}: a session is required, so 401 and the auth outage are documented`);
    for (const code of ['auth_unavailable', 'feature_unavailable']) {
      assert.ok(fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === code), `${id} is missing the ${code} fixture`);
    }
  }
  // The flag-off 503 and the empty household.
  assert.ok(fixtures.some((item) => item.name === 'actionsLoad-feature-unavailable.json'));
  assert.equal(JSON.stringify(fixtures.find((item) => item.name === 'actionsLoad-empty.json').body), EMPTY);
  // Every 409 reason, on both mutations, enumerated, described and fixtured.
  assert.deepEqual([...contract.components.schemas.ConflictEnvelope.properties.reason.enum].sort(), [...CONFLICT_REASONS].sort());
  for (const id of ['actionsCommit', 'weekAcknowledge']) {
    for (const reason of CONFLICT_REASONS) {
      assert.ok(fixtures.some((item) => item.operationId === id && item.status === 409 && item.body.reason === reason), `${id}: a ${reason} fixture`);
      assert.ok(contract.components.schemas.ConflictEnvelope.description.includes(reason), `ConflictEnvelope describes ${reason}`);
    }
    assert.ok(fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'upstream_unavailable' && item.body.retryable === true), `${id}: the in-flight 503`);
  }
  // Every 200 refusal reason, the disabled receipt, and H33's check.
  assert.deepEqual([...contract.components.schemas.ActionsReceiptRefused.properties.reason.enum].sort(), [...REFUSALS].sort());
  for (const reason of REFUSALS) {
    assert.ok(fixtures.some((item) => item.operationId === 'actionsCommit' && item.status === 200 && item.body.reason === reason), `actionsCommit: a ${reason} fixture`);
  }
  assert.ok(fixtures.some((item) => item.operationId === 'actionsCommit' && item.status === 200 && item.body.message === featureDisabledReason('tasks') && !('reason' in item.body)));
  assert.ok(fixtures.some((item) => item.operationId === 'operationsRead' && item.body.reason === 'invalid_result' && item.body.check === 'time'), 'a stored refusal with its check code');
  // S14 and S16 shapes.
  const reconciled = fixtures.find((item) => item.name === 'operationsRead-actions-succeeded.json').body;
  assert.ok(reconciled.unresolvedOperations.length > 0, 'the live list is shown non-empty');
  assert.deepEqual(reconciled.unresolvedOperations, reconciled.snapshot.unresolvedOperations, 'the live list at both places');
  assert.ok(!reconciled.unresolvedOperations.includes(reconciled.operationId), 'minus the operation itself');
  assert.deepEqual(fixtures.find((item) => item.name === 'operationsRead-actions-refused-stale-revision.json').body.unresolvedOperations, [], 'a stored receipt carries []');
  // Request headers, with the rule each carries.
  for (const id of ['actionsCommit', 'weekAcknowledge']) {
    const headers = Object.fromEntries(operations.get(id).parameters.filter((p) => p.in === 'header').map((p) => [p.name, p]));
    assert.equal(headers['Idempotency-Key']?.required, true);
    assert.equal(headers['Idempotency-Key'].schema.format, 'uuid');
    assert.equal(headers['If-Match']?.required, false);
    assert.match(headers['If-Match'].description, /precondition_unsupported/);
    assert.match(headers['X-Halo-Home-Context'].description, /IGNORED/);
  }
  for (const [name, item] of Object.entries(contract.components.schemas)) {
    assert.equal(Object.hasOwn(item.properties ?? {}, 'data'), false, `${name} declares no data property`);
  }
  assert.equal(JSON.stringify(contract).includes(EM_DASH), false, 'no U+2014 anywhere in the document');
});

test('the contract\'s H33 check codes and invalid_result sentences are exactly lib/actionsStore.js ACTION_CHECKS, and each refusal message is the library\'s', () => {
  const schemas = contract.components.schemas;
  assert.equal(ACTION_CHECKS.length, 9);
  assert.deepEqual(schemas.ActionsOperationFailed.properties.check.enum, ACTION_CHECKS.map(([code]) => code), 'the stored check codes');
  const messageFor = (reason) => schemas.ActionsReceiptRefused.allOf.find((rule) => rule.if?.properties?.reason?.const === reason && rule.then?.properties?.message)?.then.properties.message;
  assert.deepEqual(messageFor('invalid_result').enum, [...ACTION_CHECKS.map(([, sentence]) => sentence), rules.ACTION_REFUSAL_MESSAGES.invalid_result], 'the nine sentences and the fallback');
  for (const reason of REFUSALS.filter((item) => item !== 'invalid_result')) {
    assert.equal(messageFor(reason).const, rules.ACTION_REFUSAL_MESSAGES[reason], `${reason}: the library's message`);
  }
  assert.deepEqual(Object.keys(rules.ACTION_REFUSAL_MESSAGES).sort(), [...REFUSALS].sort());
});

test('every registry path resolves to a route file with the documented method and maxDuration 60', () => {
  for (const [, op] of operations) {
    const file = path.join(REPO_ROOT, 'app', ...op.path.split('/').filter(Boolean), 'route.js');
    assert.ok(existsSync(file), `${op.path} has a route file`);
    const source = readFileSync(file, 'utf8');
    assert.match(source, new RegExp(`^export async function ${op.method}\\(`, 'm'), `${op.path} exports ${op.method}`);
    if (op.path !== '/api/operations') assert.match(source, /^export const maxDuration = 60;$/m, `${op.path}: maxDuration 60 (Ruling H21)`);
    assert.equal(source.includes(EM_DASH), false, `${op.path}: no U+2014 in server copy (Ruling H22)`);
  }
  // The real registry holds every operation the app has; these are the five this surface uses.
  for (const operation of ['operations.read', 'actions.load', 'actions.commit', 'week.changes', 'week.acknowledge']) {
    const { path: route, method = 'GET' } = fe.productionOperations[operation];
    const op = [...operations.values()].find((item) => item['x-halo-operation'] === operation);
    assert.ok(op, `${operation} is documented`);
    assert.deepEqual([op.path, op.method], [route, method], `${operation}: the client's path and method`);
  }
});

// ---------------------------------------------------------------------------
// The schemas refuse the drift that would cost somebody their week
// ---------------------------------------------------------------------------

const TASK_ID = '0b060000-0000-4000-8000-000000000101';
const meta = (over = {}) => ({ note: '', paused: false, archived: false, completedOn: '', time: '', duration: 60, zone: 'America/New_York', recurrence: 'none', reminder: false, history: [], ...over });
const seed = (key, title = 'Test the kitchen tap', extra = {}) => ({ key, title, reason: 'Due this week', origin: 'Personal', ...extra });
const action = (over = {}) => ({ id: TASK_ID, key: 'personal:1', title: 'Test the kitchen tap', reason: '', origin: '', date: '2026-10-20', state: 'saved', revision: 1, ...over });

test('B06 schemas reject the drift the client would refuse, or that would tell somebody something false', () => {
  const snapshot = schema('ActionSnapshot');
  const full = { actions: [action()], metas: { 'personal:1': meta({ estimateSet: true, extra: 1 }) }, preferences: { 'week:focus': 'Water' }, unresolvedOperations: [] };
  assert.equal(snapshot(JSON.parse(EMPTY)), true);
  assert.equal(snapshot(full), true, 'a meta is echoed with unknown keys (H13)');
  const { unresolvedOperations, ...noList } = full;
  assert.deepEqual(unresolvedOperations, []);
  assert.equal(snapshot(noList), false, 'the list is always present (T1, adapters.ts:7,9)');
  assert.equal(snapshot({ ...full, reminderStates: {} }), false, 'no reminderStates (C7)');
  assert.equal(snapshot({ data: full }), false, 'never wrapped');
  assert.equal(snapshot({ ...full, version: 3 }), false, 'the internal version never leaves (H10)');
  assert.equal(snapshot({ ...full, actions: [action({ completedAt: '' })] }), false, 'exactly eight keys (H9)');
  assert.equal(snapshot({ ...full, actions: [action({ state: 'cancelled' })] }), false, 'three states (C5, T15)');
  assert.equal(snapshot({ ...full, actions: [action({ revision: 0 })] }), false);
  assert.equal(snapshot({ ...full, unresolvedOperations: Array.from({ length: 101 }, (_, i) => `0b060000-0000-4000-8000-${String(i).padStart(12, '0')}`) }), false, '100 at most (T8)');
  assert.equal(snapshot({ ...full, preferences: { 'week:focus': null } }), false, 'no JSON null preference');

  const refused = schema('ActionsReceiptRefused');
  const stale = { operationId: TASK_ID, status: 'failed', reason: 'stale_revision', message: rules.ACTION_REFUSAL_MESSAGES.stale_revision, revisions: [{ id: TASK_ID, revision: 2 }] };
  assert.equal(refused(stale), true);
  const { revisions, ...noRevisions } = stale;
  assert.equal(revisions.length, 1);
  assert.equal(refused(noRevisions), false, 'stale_revision carries the current revisions');
  assert.equal(refused({ ...stale, reason: 'busy', message: rules.ACTION_REFUSAL_MESSAGES.busy }), false, 'only stale_revision carries revisions');
  assert.equal(refused({ ...noRevisions, reason: 'busy', message: rules.ACTION_REFUSAL_MESSAGES.stale_revision }), false, 'the message is the reason\'s own');
  assert.equal(refused({ ...noRevisions, reason: 'invalid_result', message: GAP }), true, 'invalid_result carries the client\'s own sentence (H33)');
  assert.equal(refused({ ...noRevisions, reason: 'invalid_result', message: 'Something went wrong.' }), false);
  assert.equal(refused({ ...noRevisions, reason: 'clear_unsupported' }), false);

  const receipt = schema('ActionsReceipt');
  assert.equal(receipt({ operationId: TASK_ID, status: 'failed', message: featureDisabledReason('tasks') }), true, 'the flag-off receipt (H17)');
  assert.equal(receipt({ operationId: TASK_ID, status: 'failed', reason: 'disabled', message: featureDisabledReason('tasks') }), false);
  assert.equal(receipt({ operationId: TASK_ID, status: 'succeeded', snapshot: noList }), false, 'a succeeded receipt carries the list (adapters.ts:7)');
  assert.equal(receipt({ operationId: TASK_ID, status: 'succeeded', snapshot: full, acknowledged: [] }), false);

  const stored = schema('ActionsOperationFailed');
  const base = { status: 'failed', operationId: TASK_ID, domain: 'actions', kind: 'actions.commit', created_at: '2026-10-19T12:00:00.000Z' };
  assert.equal(stored(base), true, 'settled with no receipt');
  assert.equal(stored({ ...base, reason: 'abandoned' }), true, 'reaped');
  assert.equal(stored({ ...base, reason: 'invalid_result', check: 'time', unresolvedOperations: [] }), true, 'H33');
  assert.equal(stored({ ...base, reason: 'busy', check: 'time', unresolvedOperations: [] }), false, 'check only with invalid_result');
  assert.equal(stored({ ...base, reason: 'invalid_result', check: 'Choose a valid timezone.', unresolvedOperations: [] }), false, 'a code, never a sentence');
  assert.equal(stored({ ...base, reason: 'busy' }), false, 'a stored refusal carries [] (S14)');
  assert.equal(stored({ ...base, reason: 'busy', unresolvedOperations: [TASK_ID] }), false, 'and only []');
  assert.equal(stored({ ...base, reason: 'busy', unresolvedOperations: [], title: 'Test the kitchen tap' }), false, 'no record content (H3)');

  const reconciled = schema('ActionsOperationSucceeded');
  const ok = { status: 'succeeded', affected: [], removed: [], unresolvedOperations: [], snapshot: JSON.parse(EMPTY), operationId: TASK_ID, domain: 'actions', kind: 'actions.commit', created_at: base.created_at };
  assert.equal(reconciled(ok), true);
  const { snapshot: dropped, ...unhydrated } = ok;
  assert.ok(dropped);
  assert.equal(reconciled(unhydrated), false, 'a succeeded actions reconcile carries a snapshot (H18)');

  const changes = schema('WeekChanges');
  assert.equal(changes({ changes: [], unresolvedOperations: [] }), true);
  assert.equal(changes({ changes: [{ id: 'x' }], unresolvedOperations: [] }), false, 'no change source exists (H4)');
  const ack = schema('WeekAcknowledgeRefused');
  assert.equal(ack({ operationId: TASK_ID, status: 'succeeded', reason: 'unknown_change', message: 'That update is not available to review, so nothing was changed.' }), false, 'never succeeded (H19, T11)');
});

// ---------------------------------------------------------------------------
// The transcriptions say no, and the server's copy agrees with them
// ---------------------------------------------------------------------------

/** A runtime whose `fetch` answers every request with one status and body, carrying the id the client sent. */
function canned(status, body) {
  return {
    async call(_route, _method, { url, rawBody }) {
      const sent = rawBody ? JSON.parse(rawBody).operationId : new URL(url, 'http://contract.invalid').searchParams.get('operationId');
      const answer = body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'operationId') && sent ? { ...body, operationId: sent } : body;
      return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
    },
  };
}
const cannedRuntime = (status, body) => fe.clientRuntime(canned(status, body), 'alice');

const STRIP_TASK = { ...action(), key: 'home:record-1' };
const CHANGE = {
  id: 'owned:task-1:record-1', actionId: STRIP_TASK.id, actionKey: STRIP_TASK.key, version: '3', kind: 'report',
  title: 'A result is recorded', summary: 'Open the report.', sourceLabel: 'Your test record', sourceVersion: '3', sample: false,
};

test('the transcriptions reject what the client rejects, so agreement below means something', async () => {
  const good = { actions: [action()], metas: {}, preferences: {}, unresolvedOperations: [] };
  // The adapter's load (adapters.ts:9): the snapshot and the array.
  const adapter = (status, body) => fe.createActionAdapter(cannedRuntime(status, body));
  assert.deepEqual(await adapter(200, good).load(), good);
  const { unresolvedOperations, ...noList } = good;
  assert.deepEqual(unresolvedOperations, []);
  await assert.rejects(adapter(200, noList).load(), /incomplete/, 'no list, no load (T1)');
  await assert.rejects(adapter(200, { ...good, data: null }).load(), /incomplete/, 'a data key replaces the body (runtime.ts:149-153)');
  await assert.rejects(adapter(503, {}).load(), /unavailable/);
  for (const [why, bad] of [
    ['a fourth state', { ...good, actions: [action({ state: 'cancelled' })] }],
    ['a duplicate key', { ...good, actions: [action(), action({ id: `${TASK_ID}x` })] }],
    ['an orphan meta', { ...good, metas: { other: meta() } }],
    ['a time in a clock-change gap', { ...good, actions: [action({ date: '2026-03-08' })], metas: { 'personal:1': meta({ time: '02:30' }) } }],
    ['101 unresolved ids', { ...good, unresolvedOperations: Array.from({ length: 101 }, (_, i) => `id-${i}`) }],
  ]) {
    assert.equal(fe.validActionSnapshot(bad), false, why);
    await assert.rejects(adapter(200, bad).load(), /incomplete/, why);
  }
  // The receipt check (adapters.ts:7) through commit: invalid is unknown, an error status is failed or unknown.
  const commit = (status, body) => adapter(status, body).commit({ kind: 'revise', changes: [] }, { operationId: crypto.randomUUID() });
  assert.equal((await commit(200, { operationId: TASK_ID, status: 'succeeded', snapshot: good })).status, 'succeeded');
  assert.equal((await commit(200, { operationId: TASK_ID, status: 'succeeded', snapshot: noList })).status, 'unknown', 'a succeeded snapshot without the list is unconfirmed');
  assert.equal((await commit(200, { operationId: TASK_ID, status: 'done', snapshot: good })).status, 'unknown');
  assert.equal((await commit(409, {})).status, 'failed');
  assert.equal((await commit(503, {})).status, 'unknown', 'a 5xx on a mutation is unknown_outcome (runtime.ts:144)');
  // Coverage (action-service.ts:103-115): a receipt that does not show the add is refused.
  const add = { kind: 'add', seeds: [seed('personal:1')], date: '2026-10-20' };
  const previous = { actions: [], metas: {} };
  assert.equal(fe.actionReceiptCoversCommand(add, previous, { status: 'succeeded', snapshot: good }), true);
  assert.equal(fe.actionReceiptCoversCommand(add, previous, { status: 'succeeded', snapshot: { ...good, actions: [action({ title: 'Other' })] } }), false);

  // The strip renders a list for a valid bound change, and nothing for broken ones.
  const strip = async (body, actions = [STRIP_TASK]) => { const s = fe.weekStrip(cannedRuntime(200, body), { actions }); await s.load(); return s.render(); };
  assert.deepEqual(await strip({ changes: [CHANGE], unresolvedOperations: [] }), { kind: 'list', count: 1 });
  assert.equal(await strip({ changes: [CHANGE], unresolvedOperations: [] }, []), null, 'an unbound task');
  assert.equal(await strip({ changes: [{ ...CHANGE, sample: true }], unresolvedOperations: [] }), null, 'a sample');
  assert.equal(await strip({ changes: [{ ...CHANGE, id: 'i'.repeat(241) }], unresolvedOperations: [] }), null, 'a 241-character id (week-planning.ts:30)');
  assert.equal(fe.changeEvidenceKey(CHANGE), 'owned:task-1:record-1:3');
  // A succeeded acknowledgement without `acknowledged` locks (T11).
  const locking = fe.weekStrip(cannedRuntime(200, { operationId: TASK_ID, status: 'succeeded' }));
  await locking.acknowledge(CHANGE);
  assert.equal(locking.feedback, ACK_NOT_CONFIRMED);
  assert.equal(typeof locking.unknown, 'string');
});

/** A shared corpus for the drift pin: dates, titles, metas, preferences and snapshots, valid and not. */
function driftCorpus() {
  const dates = ['', '2026-10-20', '2026-02-29', '2028-02-29', '0000-01-01', '0001-01-01', '9999-12-31', '2026-1-01', '2026-13-01', 'x', '2026-03-08'];
  const titles = ['', ' ', 'A task', ' padded ', 'x'.repeat(160), 'x'.repeat(161), `${'x'.repeat(160)} `];
  const zones = ['America/New_York', 'UTC', 'Europe/London', 'Mars/Olympus_Mons', ''];
  const metas = [
    meta(), meta({ time: '02:30' }), meta({ time: '01:30' }), meta({ time: '09:00', zone: 'UTC' }), meta({ recurrence: 'weekly' }),
    meta({ recurrence: 'weekly', time: '09:00' }), meta({ recurrence: 'after-completion' }), meta({ recurrence: 'daily' }),
    meta({ duration: 14 }), meta({ duration: 1441 }), meta({ duration: 60.5 }), meta({ note: 'n'.repeat(3000) }), meta({ note: 'n'.repeat(3001) }),
    meta({ history: ['a', 1] }), meta({ completedOn: '2026-10-19' }), meta({ completedOn: '2026-10-32' }), meta({ estimateSet: 'yes' }),
    meta({ paused: 'no' }), meta({ zone: 'Mars/Olympus_Mons' }), meta({ time: '24:00' }), {}, null,
  ];
  const preferences = [
    {}, { 'week:focus': 'f'.repeat(300) }, { 'week:focus': 'f'.repeat(301) }, { 'food-interests': ['fish', 'water'] }, { 'food-interests': ['fish', 'fish'] },
    { 'food-interests': ['bread'] }, { 'week:availability': { '2026-10-19': 600 } }, { 'week:availability': { '2026-10-19': 10081 } },
    { 'week:season-dismissals': ['spring'] }, { 'week:season-dismissals': [''] },
    { 'week:review-preferences': { enabled: true, weekday: 0, time: '18:00', zone: 'America/New_York' } },
    { 'week:review-preferences': { enabled: true, weekday: 7, time: '18:00', zone: 'America/New_York' } },
    { outdoorPlan: { key: 'k', place: 'Creek', period: 'morning', watchRequested: false, forecastVersion: null, forecastIssuedAt: null, forecastExpiresAt: null } },
    { outdoorPlan: { key: 'k', place: 'Creek', period: 'morning', watchRequested: false } }, { unknown: 1 }, null, [],
  ];
  return { dates, titles, zones, metas, preferences };
}

test('drift pin: lib/actionRules.js (the server\'s copy, Ruling H15) agrees with the independent transcription on a shared corpus', () => {
  const { dates, titles, zones, metas, preferences } = driftCorpus();
  let compared = 0;
  const same = (name, a, b, label) => { compared += 1; assert.deepEqual(a, b, `${name}: ${label}`); };
  for (const date of dates) same('validActionDate', rules.validActionDate(date), fe.validActionDate(date), date);
  for (const title of titles) for (const date of dates) same('actionDraftError', rules.actionDraftError(title, date), fe.actionDraftError(title, date), `${title}|${date}`);
  for (const date of dates) for (const zone of zones) for (const time of ['', '02:30', '01:30', '12:00', '25:00']) {
    same('eventInstant', rules.eventInstant(date, time, zone), fe.eventInstant(date, time, zone), `${date} ${time} ${zone}`);
  }
  for (const item of metas) for (const date of dates) {
    const merged = item === null ? null : { ...rules.emptyWeekMeta, ...item };
    same('actionMetadataError', rules.actionMetadataError(merged, action({ date })), fe.actionMetadataError(merged, action({ date })), `${JSON.stringify(item)} ${date}`);
  }
  for (const item of preferences) same('validActionPreferences', rules.validActionPreferences(item), fe.validActionPreferences(item), JSON.stringify(item));
  for (const item of metas) for (const date of ['', '2026-10-20', '2026-03-08']) for (const state of ['saved', 'completed', 'cancelled']) {
    const snapshot = { actions: [action({ date, state })], metas: item ? { 'personal:1': item } : {}, preferences: {}, unresolvedOperations: [] };
    same('validActionSnapshot', rules.validActionSnapshot(snapshot), fe.validActionSnapshot(snapshot), JSON.stringify(snapshot));
  }
  for (const snapshot of [JSON.parse(EMPTY), { actions: [action(), action()], metas: {} }, { actions: [], metas: { orphan: meta() } }, { actions: [], metas: {}, unresolvedOperations: ['a', 'a'] }, { actions: [action({ revision: 1.5 })], metas: {} }]) {
    same('validActionSnapshot', rules.validActionSnapshot(snapshot), fe.validActionSnapshot(snapshot), JSON.stringify(snapshot));
  }
  for (const [a, b] of [[{ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }], [{ a: 1 }, { a: 1, b: undefined }], [[1], { 0: 1 }], [NaN, NaN], [0, -0], [null, {}]]) {
    same('sameValue', rules.sameValue(a, b), fe.sameValue(a, b), JSON.stringify([a, b]));
  }
  const actions = [action(), action({ id: `${TASK_ID}b`, key: 'personal:2', revision: 3 })];
  for (const changes of [
    [{ id: TASK_ID, revision: 1, patch: { title: ' New ', date: '2026-10-21', state: 'waiting' } }],
    [{ id: TASK_ID, revision: 2, patch: { title: 'New', date: '', state: 'saved' } }],
    [{ id: TASK_ID, revision: 1, patch: { title: 'New', date: '', state: 'cancelled' } }],
    [{ id: TASK_ID, revision: 1, patch: { title: 'A', date: '', state: 'saved' } }, { id: TASK_ID, revision: 1, patch: { title: 'B', date: '', state: 'saved' } }],
    [],
  ]) same('revisedActionBatch', rules.revisedActionBatch(actions, changes), fe.revisedActionBatch(actions, changes), JSON.stringify(changes));
  assert.ok(compared > 800, `the corpus is not trivial: ${compared}`);
  // And both copies say no somewhere, so agreement is not two constant functions.
  assert.equal(rules.validActionSnapshot({ actions: [action({ state: 'cancelled' })], metas: {} }), false);
  assert.equal(rules.actionMetadataError({ ...rules.emptyWeekMeta, time: '02:30' }, action({ date: '2026-03-08' })), GAP);
});

// ---------------------------------------------------------------------------
// What the client does with each answer
// ---------------------------------------------------------------------------

/** runtime.ts:144, the failure code for an error status of a mutation or a read. */
function failureCode(status, mutation) {
  return status === 401 ? 'session' : status === 403 ? 'permission' : status === 409 || status === 412 ? 'conflict' : status === 400 || status === 422 ? 'validation' : status === 429 ? 'rate_limited' : status >= 500 && mutation ? 'unknown_outcome' : 'unavailable';
}

/**
 * The client's own consequence of one answer from operation `id`, and the
 * consequence the contract says it must have. Both are computed through the
 * transcribed client, the first from the answer, the second from the status
 * and the documented meaning of the body.
 */
async function clientConsequence(id, status, body, { domain = 'actions' } = {}) {
  if (id === 'actionsLoad') {
    const week = fe.myWeek(fe.createActionAdapter(cannedRuntime(status, body)));
    await week.load();
    const actual = { readiness: week.readiness, error: week.error, locked: week.unknownOperation };
    const expected = status === 200
      ? { readiness: 'ready', error: body.unresolvedOperations.length ? EARLIER : '', locked: body.unresolvedOperations[0] ?? '' }
      : { readiness: 'error', error: COULD_NOT_LOAD, locked: '' };
    return { actual, expected };
  }
  if (id === 'actionsCommit') {
    const receipt = await fe.createActionAdapter(cannedRuntime(status, body)).commit({ kind: 'revise', changes: [] }, { operationId: crypto.randomUUID() });
    const actual = { status: receipt.status, message: receipt.message };
    const code = failureCode(status, true);
    const expected = status === 200
      ? { status: body.status, message: body.message }
      : { status: code === 'unknown_outcome' ? 'unknown' : 'failed', message: fe.messages[code] };
    return { actual, expected };
  }
  if (id === 'weekChanges') {
    const strip = fe.weekStrip(cannedRuntime(status, body), { actions: [STRIP_TASK] });
    await strip.load();
    const actual = { render: strip.render(), unknown: strip.unknown };
    const first = body.unresolvedOperations?.[0] ?? null;
    const expected = status === 200
      ? { render: first ? { kind: 'status-check', text: 'An update needs a status check.' } : null, unknown: first }
      : { render: { kind: 'unavailable', text: 'Plan updates are unavailable.' }, unknown: null };
    return { actual, expected };
  }
  if (id === 'weekAcknowledge') {
    const strip = fe.weekStrip(cannedRuntime(status, body), { actions: [STRIP_TASK] });
    await strip.acknowledge(CHANGE);
    const actual = { locked: strip.unknown !== null, feedback: strip.feedback };
    const code = failureCode(status, true);
    const expected = status === 200
      ? { locked: false, feedback: ACK_NOT_APPLIED }
      : { locked: code === 'unknown_outcome', feedback: fe.messages[code] };
    return { actual, expected };
  }
  if (id === 'operationsRead' && domain === 'week-updates') {
    const strip = fe.weekStrip(cannedRuntime(status, body), { actions: [STRIP_TASK] });
    strip.unknown = crypto.randomUUID();
    await strip.checkStatus();
    const actual = { locked: strip.unknown !== null, feedback: strip.feedback };
    const expected = status !== 200
      ? { locked: true, feedback: fe.messages[failureCode(status, false)] }
      : ['failed', 'cancelled'].includes(body.status) ? { locked: false, feedback: ACK_NOT_APPLIED } : { locked: true, feedback: ACK_NOT_CONFIRMED };
    return { actual, expected };
  }
  if (id === 'operationsRead') {
    const week = fe.myWeek(fe.createActionAdapter(cannedRuntime(status, body)));
    week.readiness = 'ready';
    const operationId = crypto.randomUUID();
    week.unknownOperation = operationId;
    await week.reconcile();
    const actual = { error: week.error, locked: week.unknownOperation === operationId ? 'self' : week.unknownOperation, reloads: week.reloads };
    let expected;
    if (status !== 200) expected = { error: COULD_NOT_CHECK, locked: 'self', reloads: 0 };
    else if (body.status === 'succeeded') {
      const listed = body.snapshot.unresolvedOperations;
      expected = { error: listed.length ? ANOTHER : RECOVERED, locked: listed[0] ?? '', reloads: 0 };
    } else if (['failed', 'cancelled'].includes(body.status)) expected = { error: NOT_APPLIED, locked: '', reloads: 1 };
    else expected = { error: STILL_UNCONFIRMED, locked: 'self', reloads: 0 };
    return { actual, expected };
  }
  throw new Error(`no client consequence for ${id}`);
}

async function assertClient(id, status, body, options, label) {
  const { actual, expected } = await clientConsequence(id, status, body, options);
  assert.deepEqual(actual, expected, `${label}: what the client does with it`);
}

test('every fixture has the consequence in the client that the contract says it has', async () => {
  for (const fixture of fixtures) {
    const domain = fixture.body.domain ?? (fixture.name.includes('week-updates') ? 'week-updates' : 'actions');
    await assertClient(fixture.operationId, fixture.status, fixture.body, { domain }, fixture.name);
  }
  assert.ok(fixtures.length >= 50, `every fixture was checked, got ${fixtures.length}`);
});

// ---------------------------------------------------------------------------
// The harness: the real handlers
// ---------------------------------------------------------------------------

const REQUEST_ID = 'b06-contract-0001';
const CREATED_AT = '2026-10-19T12:00:00.000Z';
const OFF = { HALO_FEATURE_TASKS: 'off' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

/** A world on the fake ledger, which a test can seed in any shape (test/helpers/actionsWorld.mjs). */
const world = (options = {}) => createWorld(db, { ledger: 'fake', ...options });

// Response headers: both directions, for the pairs exercised below (as B03, B05).
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

// Request headers: every header a test sends beyond the transport ones must be
// a documented parameter of that operation, and every documented header
// parameter must be sent by some exercised request.
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
function normalized(body) {
  const ids = new Map();
  const walk = (value, key) => {
    if (typeof value === 'string') {
      if (key === 'created_at') return CREATED_AT;
      if (!UUID.test(value)) return value;
      const id = value.toLowerCase();
      if (!ids.has(id)) ids.set(id, `0b060000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
      return ids.get(id);
    }
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, walk(item, name)]));
    return value;
  };
  return walk(body);
}

/** Fixture name -> the normalised answer a real handler gave in this file. */
const produced = new Map();

/**
 * One call to a real handler, checked against the document, the request id,
 * the bare-body and em dash rules, and the client's own consequence; recorded
 * as `fixture` when named.
 */
async function call(h, id, { expected = 200, query = '', body, rawBody, as = 'alice', headers = {}, env, fixture, domain } = {}) {
  const op = operations.get(id);
  const sent = { 'x-request-id': REQUEST_ID, ...headers };
  recordRequestHeaders(id, sent);
  const res = await h.call(op.path, op.method, { as, url: `${op.path}${query}`, body, rawBody, headers: sent, env });
  const text = await res.text();
  assert.equal(res.status, expected, `${id}${query}: expected ${expected}, got ${res.status}: ${text.slice(0, 300)}`);
  assert.equal(res.headers.get('x-request-id'), REQUEST_ID, `${id}: the request id is echoed`);
  recordHeaders(id, res);
  const json = JSON.parse(text);
  validate(id, res.status, json);
  assertBare(json, `${id} ${res.status}`);
  if (expected >= 400) {
    assert.equal(json.request_id, REQUEST_ID);
    assert.equal(/supabase|postgres|PGRST|P0001|HALO_[A-Z]|XX000|contractsB06|bearer/i.test(text), false, `${id} ${expected}: nothing proof-bearing in an error envelope`);
  }
  await assertClient(id, res.status, json, { domain: json.domain ?? domain }, `${id} ${res.status}`);
  if (fixture) {
    assert.equal(produced.has(fixture), false, `${fixture} is produced once`);
    produced.set(fixture, { operationId: id, status: res.status, body: normalized(json) });
  }
  return { body: json, res };
}

/** POST /api/frontend/actions/commands as the client sends it (runtime.ts:130-138, adapters.ts:10). */
function commit(h, command, { key = command.operationId, headers = {}, raw, valid = true, ...options } = {}) {
  if (valid) validateRequest('actionsCommit', command);
  return call(h, 'actionsCommit', {
    rawBody: raw ?? JSON.stringify(command),
    headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'idempotency-key': key }), ...headers },
    ...options,
  });
}
/** POST /api/week/changes/acknowledge as WeekUpdates.tsx:23 sends it. */
function acknowledge(h, ack, { key = ack.operationId, headers = {}, raw, valid = true, ...options } = {}) {
  if (valid) validateRequest('weekAcknowledge', ack);
  return call(h, 'weekAcknowledge', {
    rawBody: raw ?? JSON.stringify(ack),
    headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'idempotency-key': key }), ...headers },
    ...options,
  });
}
const reconcile = (h, operationId, { domain = 'actions', ...options } = {}) =>
  call(h, 'operationsRead', { query: `?operationId=${operationId}&domain=${domain}`, domain, ...options });
const load = (h, options) => call(h, 'actionsLoad', options);

const command = (over) => ({ operationId: crypto.randomUUID(), ...over });
const outage = (h) => { h.forceAuthOutage(); return h; };
async function authOutage(h, id, options) {
  const { res, body } = await call(outage(h), id, { ...options, expected: 503 });
  assert.equal(body.code, 'auth_unavailable');
  assert.equal(res.headers.get('retry-after'), '2');
}
/** A ledger row as runOperation would have claimed it for `cmd`, owned by alice. */
function claimed(w, cmd, { domain = 'actions', kind = 'actions.commit', input, ...overrides } = {}) {
  const hashed = input ?? (() => { const copy = { ...cmd }; delete copy.operationId; return copy; })();
  return {
    operation_id: cmd.operationId, profile_id: w.alice, domain, kind, status: 'pending',
    request_hash: requestHash(hashed), result: null, created_at: ago(1_000), ...overrides,
  };
}
/** A harness whose ledger table throws a database error, for the 500s. */
function brokenLedger(tables = haloTables('profiles', 'operations')) {
  const h = createRouteHarness({ tables, env: ON });
  const from = h.db.from;
  h.db.from = (name) => { if (name === 'operations') throw Object.assign(new Error('contractsB06: boom'), { code: 'XX000' }); return from(name); };
  return h;
}

// ---------------------------------------------------------------------------
// Handler conformance: every state each route can answer with
// ---------------------------------------------------------------------------

test('B06 handler conformance: actions.load answers the empty household, a full week with its lock, and every refusal', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const { body: empty } = await load(w.h, { fixture: 'actionsLoad-empty', headers: { 'x-halo-home-context': '11111111-1111-4111-8111-111111111111' } });
  assert.equal(JSON.stringify(empty), EMPTY, 'exactly the empty household (T1, T7)');

  // Two commits, so the order (created_at, then id) is fixed for the fixture.
  await commit(w.h, command({
    kind: 'add', date: '2026-10-20', seeds: [seed('personal:1', 'Test the kitchen tap')],
    metadata: { 'personal:1': meta({ time: '09:00', note: 'Use the kit in the hall cupboard.', history: ['2026-10-19: Added by you.'] }) },
    preferences: { 'week:focus': 'Water at home', 'food-interests': ['fish', 'water'], 'week:review-preferences': { enabled: true, weekday: 0, time: '18:00', zone: 'America/New_York' } },
  }));
  await commit(w.h, command({ kind: 'add', date: '2026-10-21', seeds: [seed('personal:2', 'Flush the outdoor spigot')] }));
  const pending = command({ kind: 'revise', changes: [] });
  w.h.db.seed('operations', [claimed(w, pending)]);
  const { body: full } = await load(w.h, { fixture: 'actionsLoad-tasks' });
  assert.deepEqual(full.unresolvedOperations, [pending.operationId], 'a genuinely pending save is listed');
  assert.equal(full.actions.length, 2);

  await load(w.h, { as: null, expected: 401, fixture: 'actionsLoad-unauthenticated' });
  const before = w.h.db.rpcCalls.length;
  const { body: off } = await load(w.h, { env: OFF, expected: 503, fixture: 'actionsLoad-feature-unavailable' });
  assert.deepEqual([off.code, off.retryable], ['feature_unavailable', false]);
  assert.equal(w.h.db.rpcCalls.length, before, 'flag off reads nothing (H17)');
  const missing = createRouteHarness({ tables: haloTables('profiles', 'operations'), env: ON });
  const { body: absent } = await load(missing, { expected: 503 });
  assert.deepEqual(absent, off, 'migration 0023 missing answers the same body as the flag off');
  const broken = await world({ onRead: () => { throw rpcError('XX000', 'contractsB06: boom'); } });
  await load(broken.h, { expected: 500, fixture: 'actionsLoad-internal-error' });
  await authOutage((await world()).h, 'actionsLoad');
  produced.set('actionsLoad-auth-unavailable', await recordOutage('actionsLoad'));
});

/** The auth outage body as a fixture: produced by the real handler on a fresh harness. */
async function recordOutage(id, options = {}) {
  const h = outage(createRouteHarness({ tables: haloTables('profiles', 'operations'), env: ON }));
  const op = operations.get(id);
  const res = await h.call(op.path, op.method, { as: 'alice', url: op.path, headers: { 'x-request-id': REQUEST_ID, ...options.headers }, rawBody: options.rawBody });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'auth_unavailable');
  return { operationId: id, status: 503, body: normalized(body) };
}

test('B06 handler conformance: actions.commit answers succeeded, every 200 refusal reason, the disabled receipt and every 4xx and 5xx', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const add = command({
    kind: 'add', date: '2026-10-20', seeds: [seed('personal:1', '  Test the kitchen tap  ')],
    metadata: { 'personal:1': meta({ time: '02:30' }) }, preferences: { 'week:focus': 'Water at home' },
  });
  const { body: saved } = await commit(w.h, add, { fixture: 'actionsCommit-success', headers: { 'x-halo-home-context': '11111111-1111-4111-8111-111111111111' } });
  assert.equal(saved.status, 'succeeded');
  assert.ok(fe.actionReceiptCoversCommand(add, { actions: [], metas: {} }, saved), 'coverage (action-service.ts:103-115)');
  const task = saved.snapshot.actions[0];
  assert.equal(task.title, 'Test the kitchen tap', 'stored trimmed (H13)');

  // H32: a live success carries the list read before its claim, here a save
  // genuinely pending on another device, and never its own id.
  const listing = await world();
  const elsewhere = command({ kind: 'revise', changes: [] });
  listing.h.db.seed('operations', [claimed(listing, elsewhere)]);
  const ownAdd = command({ kind: 'add', date: '', seeds: [seed('personal:1', 'Read the water report')] });
  const { body: locked } = await commit(listing.h, ownAdd, { fixture: 'actionsCommit-success-unresolved' });
  assert.deepEqual(locked.snapshot.unresolvedOperations, [elsewhere.operationId], 'the other save is listed (H32, T2)');

  const { body: moved } = await commit(w.h, command({ kind: 'revise', changes: [{ id: task.id, revision: 1, patch: { title: task.title, date: '2026-10-21', state: 'saved' } }] }));
  assert.equal(moved.snapshot.actions[0].revision, 2);
  const reasons = {};
  reasons.stale_revision = (await commit(w.h, command({ kind: 'revise', changes: [{ id: task.id, revision: 1, patch: { title: task.title, date: '2026-10-22', state: 'saved' } }] }), { fixture: 'actionsCommit-refused-stale-revision' })).body;
  assert.deepEqual(reasons.stale_revision.revisions, [{ id: task.id, revision: 2 }]);
  reasons.metadata_changed = (await commit(w.h, command({
    kind: 'revise', changes: [{ id: task.id, revision: 2, patch: { title: task.title, date: '2026-10-21', state: 'completed' } }],
    expectedMetadata: { 'personal:1': JSON.stringify(meta()) }, metadata: { 'personal:1': meta({ completedOn: '2026-10-19' }) },
  }), { fixture: 'actionsCommit-refused-metadata-changed' })).body;
  reasons.unknown_action = (await commit(w.h, command({ kind: 'revise', changes: [{ id: 'not-a-task', revision: 1, patch: { title: 'X', date: '', state: 'saved' } }] }), { fixture: 'actionsCommit-refused-unknown-action' })).body;
  const gap = command({ kind: 'revise', changes: [{ id: task.id, revision: 2, patch: { title: task.title, date: '2026-03-08', state: 'saved' } }] });
  reasons.invalid_result = (await commit(w.h, gap, { fixture: 'actionsCommit-refused-invalid-result' })).body;
  assert.equal(reasons.invalid_result.message, GAP, 'the client\'s own sentence (T5, H25)');
  const busy = await world({ onCommit: async () => { throw rpcError('P0001', 'HALO_STALE_BASE'); } });
  reasons.busy = (await commit(busy.h, command({ kind: 'add', date: '', seeds: [seed('personal:1')] }), { fixture: 'actionsCommit-refused-busy' })).body;
  for (const reason of REFUSALS) {
    assert.deepEqual([reasons[reason].status, reasons[reason].reason], ['failed', reason], `${reason} is really produced by the handler`);
  }
  // A replayed refusal is the same 200, rebuilt from the stored reason and check (H11, H33).
  assert.deepEqual((await commit(w.h, gap)).body, reasons.invalid_result);
  assert.deepEqual(w.h.db.rows('operations').find((row) => row.operation_id === gap.operationId).result,
    { status: 'failed', reason: 'invalid_result', check: 'time', unresolvedOperations: [], operationId: gap.operationId }, 'the ledger holds a code, never the sentence');

  // Flag off: a 200 with the disabled reason, nothing read or claimed (H17).
  const rows = w.h.db.rows('operations').length;
  const { body: disabled } = await commit(w.h, command({ kind: 'revise', changes: [] }), { env: OFF, fixture: 'actionsCommit-disabled' });
  assert.equal(disabled.message, featureDisabledReason('tasks'));
  assert.equal(w.h.db.rows('operations').length, rows, 'no ledger row');

  // 400s and 413, decided before the claim.
  const fresh = await world();
  await commit(fresh.h, command({ kind: 'revise', changes: [] }), { raw: '{', valid: false, expected: 400, fixture: 'actionsCommit-bad-request' });
  const { body: clear } = await commit(fresh.h, command({ kind: 'clear' }), { valid: false, expected: 400, fixture: 'actionsCommit-validation' });
  assert.deepEqual(clear.field_errors.map((error) => [error.field, error.code]), [['kind', 'unsupported_kind']], 'clear is refused (H14)');
  for (const field of ['profileId', 'profile_id']) {
    const { body: owner } = await commit(fresh.h, command({ kind: 'revise', changes: [], [field]: fresh.bob }), { valid: false, expected: 400 });
    assert.deepEqual(owner.field_errors.map((error) => [error.field, error.code]), [[field, 'unknown_field']], `a body owner (${field}) is refused, never read (BE-199)`);
  }
  await commit(fresh.h, command({ kind: 'revise', changes: [] }), { key: null, expected: 400, fixture: 'actionsCommit-missing-idempotency-key' });
  const { body: ifMatch } = await commit(fresh.h, command({ kind: 'revise', changes: [] }), { headers: { 'if-match': '1' }, expected: 400, fixture: 'actionsCommit-if-match' });
  assert.equal(ifMatch.field_errors[0].code, 'precondition_unsupported');
  const big = command({ kind: 'add', date: '', seeds: [seed('personal:1', 'Task', { padding: 'x'.repeat(4_000_100) })] });
  await commit(fresh.h, big, { valid: false, expected: 413, fixture: 'actionsCommit-payload-too-large' });
  assert.deepEqual(fresh.h.db.rows('operations'), [], 'no refused request claimed an operation id');
  await commit(fresh.h, command({ kind: 'revise', changes: [] }), { as: null, expected: 401, fixture: 'actionsCommit-unauthenticated' });

  // 409s: every reason, really produced.
  const conflicts = {};
  const first = command({ kind: 'revise', changes: [] });
  await commit(fresh.h, first);
  conflicts.operation_mismatch = (await commit(fresh.h, { ...first, preferences: { 'week:focus': 'Other' } }, { expected: 409, fixture: 'actionsCommit-operation-mismatch' })).body;
  const seeded = async (result, fixture, status = 'failed') => {
    const s = await world();
    const cmd = command({ kind: 'add', date: '', seeds: [seed('personal:1')] });
    s.h.db.seed('operations', [claimed(s, cmd, { status, result })]);
    return (await commit(s.h, cmd, { expected: status === 'pending' ? 503 : 409, fixture })).body;
  };
  conflicts.abandoned = await seeded({ status: 'failed', reason: 'abandoned' }, 'actionsCommit-abandoned');
  conflicts.not_applied = await seeded(null, 'actionsCommit-not-applied');
  conflicts.unrecognized_receipt = await seeded({ status: 'failed', reason: 'written_by_nobody' }, 'actionsCommit-unrecognized-receipt');
  for (const reason of CONFLICT_REASONS) assert.deepEqual([conflicts[reason].reason, conflicts[reason].retryable], [reason, false]);
  const inFlight = await seeded(null, 'actionsCommit-in-flight', 'pending');
  assert.deepEqual([inFlight.code, inFlight.retryable], ['upstream_unavailable', true]);

  // 503 without 0023, 500 inside the commit, and the auth outage.
  const missing = createRouteHarness({ tables: haloTables('profiles', 'operations'), env: ON });
  const { body: absent } = await commit(missing, command({ kind: 'revise', changes: [] }), { expected: 503, fixture: 'actionsCommit-feature-unavailable' });
  assert.deepEqual([absent.code, absent.retryable], ['feature_unavailable', false]);
  assert.deepEqual(missing.db.rows('operations'), [], 'decided before the claim');
  const failing = await world({ onCommit: async () => { throw rpcError('XX000', 'contractsB06: boom'); } });
  await commit(failing.h, command({ kind: 'add', date: '', seeds: [seed('personal:1')] }), { expected: 500, fixture: 'actionsCommit-internal-error' });
  const outageCommand = command({ kind: 'revise', changes: [] });
  await authOutage((await world()).h, 'actionsCommit', { rawBody: JSON.stringify(outageCommand), headers: { 'idempotency-key': outageCommand.operationId, 'content-type': 'application/json' } });
  produced.set('actionsCommit-auth-unavailable', await recordOutage('actionsCommit', { rawBody: JSON.stringify(outageCommand), headers: { 'idempotency-key': outageCommand.operationId } }));
  assert.deepEqual(w.h.blockedFetches, [], 'no outbound call');
});

const ACK = (over = {}) => ({ operationId: crypto.randomUUID(), id: 'owned:task-1:record-1', version: '3', actionId: STRIP_TASK.id, ...over });
const ackInput = (ack) => ({ id: ack.id, version: ack.version, actionId: ack.actionId });

test('B06 handler conformance: week.changes is always the empty strip, with the household\'s unsettled acknowledgements', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const { body: empty } = await call(w.h, 'weekChanges', { fixture: 'weekChanges-empty', headers: { 'x-halo-home-context': '11111111-1111-4111-8111-111111111111' } });
  assert.equal(JSON.stringify(empty), '{"changes":[],"unresolvedOperations":[]}', 'H4, T9');
  const pending = ACK();
  w.h.db.seed('operations', [claimed(w, pending, { domain: 'week-updates', kind: 'week.acknowledge', input: ackInput(pending) })]);
  const { body: listed } = await call(w.h, 'weekChanges', { fixture: 'weekChanges-unresolved' });
  assert.deepEqual(listed.unresolvedOperations, [pending.operationId]);
  const { body: off } = await call(w.h, 'weekChanges', { env: OFF });
  assert.deepEqual(off, listed, 'not behind the tasks flag (H17)');
  await call(w.h, 'weekChanges', { as: null, expected: 401, fixture: 'weekChanges-unauthenticated' });
  const { body: absent } = await call(createRouteHarness({ tables: haloTables('profiles') }), 'weekChanges', { expected: 503, fixture: 'weekChanges-feature-unavailable' });
  assert.deepEqual([absent.code, absent.retryable], ['feature_unavailable', false]);
  await call(brokenLedger(), 'weekChanges', { expected: 500, fixture: 'weekChanges-internal-error' });
  await authOutage((await world()).h, 'weekChanges');
  produced.set('weekChanges-auth-unavailable', await recordOutage('weekChanges'));
});

test('B06 handler conformance: week.acknowledge refuses every valid body through the ledger, and answers every 4xx and 5xx', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const ack = ACK();
  const { body: refused } = await acknowledge(w.h, ack, { fixture: 'weekAcknowledge-refused', headers: { 'x-halo-home-context': '11111111-1111-4111-8111-111111111111' } });
  assert.deepEqual(Object.keys(refused).sort(), ['message', 'operationId', 'reason', 'status']);
  assert.deepEqual((await acknowledge(w.h, ack)).body, refused, 'a replay is the same refusal');
  const { body: foreign } = await acknowledge(w.h, ACK({ actionId: '7a7a7a7a-0000-4000-8000-0000000000ff' }));
  assert.deepEqual({ ...foreign, operationId: refused.operationId }, refused, 'no task table is read: any action id answers the same');
  await acknowledge(w.h, { ...ack, version: '4' }, { expected: 409, fixture: 'weekAcknowledge-operation-mismatch' });
  await acknowledge(w.h, ACK({ id: 'i'.repeat(241) }), { valid: false, expected: 400, fixture: 'weekAcknowledge-validation' });
  await acknowledge(w.h, ACK(), { headers: { 'if-match': '1' }, expected: 400 });
  await acknowledge(w.h, ACK(), { key: null, expected: 400 });
  await acknowledge(w.h, ACK({ id: 'x'.repeat(3000) }), { valid: false, expected: 413, fixture: 'weekAcknowledge-payload-too-large' });
  await acknowledge(w.h, ACK(), { as: null, expected: 401, fixture: 'weekAcknowledge-unauthenticated' });
  const seeded = async (result, fixture, status = 'failed') => {
    const s = await world();
    const a = ACK();
    s.h.db.seed('operations', [claimed(s, a, { domain: 'week-updates', kind: 'week.acknowledge', input: ackInput(a), status, result })]);
    return (await acknowledge(s.h, a, { expected: status === 'pending' ? 503 : 409, fixture })).body;
  };
  assert.equal((await seeded({ status: 'failed', reason: 'abandoned' }, 'weekAcknowledge-abandoned')).reason, 'abandoned');
  assert.equal((await seeded(null, 'weekAcknowledge-not-applied')).reason, 'not_applied');
  assert.equal((await seeded({ status: 'succeeded', acknowledged: [] }, 'weekAcknowledge-unrecognized-receipt')).reason, 'unrecognized_receipt');
  assert.equal((await seeded(null, 'weekAcknowledge-in-flight', 'pending')).code, 'upstream_unavailable');
  const missing = createRouteHarness({ tables: haloTables('profiles') });
  await acknowledge(missing, ACK(), { expected: 503, fixture: 'weekAcknowledge-feature-unavailable' });
  await acknowledge(brokenLedger(), ACK(), { expected: 500, fixture: 'weekAcknowledge-internal-error' });
  const outageAck = ACK();
  await authOutage((await world()).h, 'weekAcknowledge', { rawBody: JSON.stringify(outageAck), headers: { 'idempotency-key': outageAck.operationId, 'content-type': 'application/json' } });
  produced.set('weekAcknowledge-auth-unavailable', await recordOutage('weekAcknowledge', { rawBody: JSON.stringify(outageAck), headers: { 'idempotency-key': outageAck.operationId } }));
});

test('B06 handler conformance: operations.read hydrates a succeeded actions save (H18, S16) and replays every other B06 shape as stored (S14)', async (t) => {
  muteConsoleError(t);
  const w = await world();
  const add = command({ kind: 'add', date: '2026-10-20', seeds: [seed('personal:1')], metadata: { 'personal:1': meta({ time: '02:30' }) } });
  const { body: saved } = await commit(w.h, add);
  const other = command({ kind: 'revise', changes: [] });
  w.h.db.seed('operations', [claimed(w, other)]);
  assert.deepEqual(w.h.db.rows('operations').find((row) => row.operation_id === add.operationId).result.unresolvedOperations, [], 'the stored receipt carries [] (S14)');
  const { body: hydrated } = await reconcile(w.h, add.operationId, { fixture: 'operationsRead-actions-succeeded' });
  assert.deepEqual(hydrated.unresolvedOperations, [other.operationId], 'the live list, minus the operation itself (S16)');
  assert.deepEqual(hydrated.snapshot.unresolvedOperations, hydrated.unresolvedOperations, 'at both places');
  assert.deepEqual(hydrated.snapshot.actions, saved.snapshot.actions);

  const task = saved.snapshot.actions[0];
  const stale = command({ kind: 'delete', id: task.id, revision: 5 });
  await commit(w.h, stale);
  const { body: staleRead } = await reconcile(w.h, stale.operationId, { fixture: 'operationsRead-actions-refused-stale-revision' });
  assert.deepEqual([staleRead.reason, staleRead.revisions, staleRead.unresolvedOperations], ['stale_revision', [{ id: task.id, revision: 1 }], []]);
  const gap = command({ kind: 'revise', changes: [{ id: task.id, revision: 1, patch: { title: task.title, date: '2026-03-08', state: 'saved' } }] });
  await commit(w.h, gap);
  const { body: gapRead } = await reconcile(w.h, gap.operationId, { fixture: 'operationsRead-actions-refused-invalid-result' });
  assert.deepEqual([gapRead.reason, gapRead.check], ['invalid_result', 'time'], 'H33: a code, never the sentence');

  const seeded = async (overrides, fixture, { domain = 'actions' } = {}) => {
    const s = await world();
    const cmd = domain === 'actions' ? command({ kind: 'revise', changes: [] }) : ACK();
    s.h.db.seed('operations', [claimed(s, cmd, domain === 'actions' ? overrides : { domain, kind: 'week.acknowledge', input: ackInput(cmd), ...overrides })]);
    return (await reconcile(s.h, cmd.operationId, { domain, fixture })).body;
  };
  assert.equal((await seeded({ status: 'failed', result: { status: 'failed', reason: 'abandoned' } }, 'operationsRead-actions-abandoned')).reason, 'abandoned');
  assert.equal('reason' in (await seeded({ status: 'failed', result: null }, 'operationsRead-actions-not-applied')), false);
  assert.equal((await seeded({}, 'operationsRead-actions-pending')).status, 'pending');
  const reaped = await seeded({ created_at: ago(10 * 60_000) }, undefined);
  assert.deepEqual([reaped.status, reaped.reason], ['failed', 'abandoned'], 'a dead claim is reaped as it is read');
  assert.equal((await seeded({ status: 'failed', result: { status: 'failed', reason: 'unknown_change' } }, 'operationsRead-week-updates-refused', { domain: 'week-updates' })).reason, 'unknown_change');
  assert.equal((await seeded({}, 'operationsRead-week-updates-pending', { domain: 'week-updates' })).status, 'pending');

  await reconcile(w.h, 'not-a-uuid', { expected: 400, fixture: 'operationsRead-validation' });
  await reconcile(w.h, add.operationId, { as: null, expected: 401, fixture: 'operationsRead-unauthenticated' });
  await reconcile(w.h, crypto.randomUUID(), { expected: 404, fixture: 'operationsRead-not-found' });
  await reconcile(w.h, add.operationId, { as: 'bob', expected: 404 });
  const { body: off } = await reconcile(w.h, add.operationId, { env: OFF, expected: 503, fixture: 'operationsRead-feature-unavailable' });
  assert.deepEqual([off.code, off.retryable], ['feature_unavailable', false], 'a succeeded actions read is behind the flag (H17)');
  const { body: staleOff } = await reconcile(w.h, stale.operationId, { env: OFF });
  assert.deepEqual(staleOff, staleRead, 'a failed one is replayed as stored, flag or not');
  await reconcile(brokenLedger(), add.operationId, { expected: 500, fixture: 'operationsRead-internal-error' });
  await authOutage((await world()).h, 'operationsRead', { query: `?operationId=${add.operationId}&domain=actions` });
  produced.set('operationsRead-auth-unavailable', await recordOutage('operationsRead'));
});

// ---------------------------------------------------------------------------
// The client, end to end through the real handlers
// ---------------------------------------------------------------------------

test('client: a new household loads ready, saves each kind of change with no lock, recovers a lost save, and shows a refusal without a lock', async () => {
  let lose = false;
  const w = await createWorld(db);
  const week = fe.myWeek(fe.createActionAdapter(fe.clientRuntime(w.h, 'alice', { lose: () => lose })));
  await week.load();
  assert.deepEqual([week.readiness, week.unknownOperation, week.error], ['ready', '', '']);
  assert.equal(await week.save({ seed: seed('personal:1'), title: ' Test the kitchen tap ', date: '2026-10-20' }), true, 'add');
  assert.equal(await week.save({ seed: seed('personal:1'), title: 'Test the kitchen tap', date: '2026-10-20' }), true, 'add again: a no-op that passes coverage (T4)');
  assert.equal(await week.reviseActions([], { preferences: { 'week:focus': 'Water at home' } }), true, 'a focus write with changes [] (T3)');
  assert.equal(await week.save({ seed: seed('personal:2'), title: 'Read the water report', date: '' }), true, 'an unscheduled save');
  assert.equal(week.actions[1].date, '', 'kept unscheduled');
  const [task] = week.actions;
  assert.equal(await week.changeState(task.id, 'completed'), true, 'complete');
  assert.equal(await week.updateAction(task.id, week.actions[0].revision, { title: task.title, date: '2026-10-22' }), true, 'reschedule');
  assert.equal(week.canMutate(), true);

  lose = true;
  assert.equal(await week.updateAction(task.id, week.actions[0].revision, { title: task.title, date: '2026-10-23' }), false);
  lose = false;
  assert.equal(week.canMutate(), false, 'a lost response locks My Week');
  assert.equal(await week.reconcile(), true);
  assert.deepEqual([week.error, week.unknownOperation, week.actions[0].date], [RECOVERED, '', '2026-10-23'], 'T7: recovered, unlocked and current');

  const other = fe.myWeek(fe.createActionAdapter(fe.clientRuntime(w.h, 'alice')));
  await other.load();
  assert.equal(await other.deleteAction(task.id, other.actions[0].revision), true, 'delete on another device');
  assert.equal(await week.updateAction(task.id, week.actions[0].revision, { title: task.title, date: '2026-10-24' }), false);
  assert.deepEqual([week.error, week.unknownOperation], [rules.ACTION_REFUSAL_MESSAGES.unknown_action, ''], 'the server\'s words, no lock (F4: no reload either)');

  const strip = fe.weekStrip(fe.clientRuntime(w.h, 'alice'), { actions: week.actions });
  await strip.load();
  assert.equal(strip.render(), null, 'the strip renders nothing (T9)');
  await strip.acknowledge(CHANGE);
  assert.deepEqual([strip.feedback, strip.unknown], [ACK_NOT_APPLIED, null], 'H19');
  assert.deepEqual(w.h.blockedFetches, []);
});

// ---------------------------------------------------------------------------
// Cross-route agreement
// ---------------------------------------------------------------------------

test('the empty household is the same bytes on all three surfaces: the load, a receipt and its reconcile', async () => {
  const w = await createWorld(db);
  const { body: loaded } = await load(w.h);
  const noop = command({ kind: 'revise', changes: [] });
  const { body: receipt } = await commit(w.h, noop);
  const { body: reconciled } = await reconcile(w.h, noop.operationId);
  for (const [label, value] of [['load', loaded], ['receipt', receipt.snapshot], ['reconcile', reconciled.snapshot]]) {
    assert.equal(JSON.stringify(value), EMPTY, label);
  }
  assert.deepEqual(reconciled.unresolvedOperations, []);
});

test('a command\'s receipt snapshot is what the next load returns, and its reconcile is the same snapshot with the live list', async () => {
  const w = await createWorld(db);
  let previous = (await load(w.h)).body;
  const steps = [
    { kind: 'add', date: '2026-10-20', seeds: [seed('personal:1'), seed('personal:2', 'Flush the spigot')], metadata: { 'personal:1': meta({ time: '09:00', history: ['Added.'] }) } },
    { kind: 'revise', changes: [], preferences: { 'week:focus': 'Water', 'food-interests': ['fish'] } },
    (snapshot) => ({ kind: 'revise', changes: [{ id: snapshot.actions[0].id, revision: snapshot.actions[0].revision, patch: { title: 'Retest the kitchen tap', date: '2026-10-21', state: 'waiting' } }], expectedMetadata: { 'personal:1': JSON.stringify(snapshot.metas['personal:1']) }, metadata: { 'personal:1': { ...snapshot.metas['personal:1'], note: 'Kit in the hall.' } } }),
    (snapshot) => ({ kind: 'delete', id: snapshot.actions[1].id, revision: snapshot.actions[1].revision }),
  ];
  const sent = [];
  // From the third step on, a save from another device is genuinely pending,
  // so a receipt's list (read before its claim, Ruling H32) and the next
  // load's list are compared non-empty, not only as [].
  const pending = command({ kind: 'revise', changes: [] });
  for (const [index, step] of steps.entries()) {
    if (index === 2) {
      await db.query(
        `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'actions', 'actions.commit', 'pending', $3)`,
        [pending.operationId, w.alice, requestHash({ kind: 'revise', changes: [] })],
      );
    }
    const cmd = command(typeof step === 'function' ? step(previous) : step);
    sent.push(cmd);
    const { body: receipt } = await commit(w.h, cmd);
    assert.equal(receipt.status, 'succeeded', JSON.stringify(receipt));
    assert.ok(fe.actionReceiptCoversCommand(cmd, previous, receipt), `${cmd.kind}: coverage`);
    assert.deepEqual(receipt.snapshot.unresolvedOperations, index >= 2 ? [pending.operationId] : [], `${cmd.kind}: the live list on the receipt`);
    const { body: next } = await load(w.h);
    assert.deepEqual(next, receipt.snapshot, `${cmd.kind}: the receipt's snapshot is the next load, list included`);
    previous = next;
  }
  // With that save still pending, each reconcile is the current snapshot plus
  // the live list, and so is the load.
  const { body: current } = await load(w.h);
  assert.deepEqual(current.unresolvedOperations, [pending.operationId]);
  for (const cmd of sent) {
    const { body: reconciled } = await reconcile(w.h, cmd.operationId);
    assert.deepEqual(reconciled.snapshot, current, `${cmd.kind}: the reconcile is the current snapshot and live list`);
    assert.deepEqual(reconciled.unresolvedOperations, current.unresolvedOperations, 'and the same list at the top level');
  }
  const { body: own } = await reconcile(w.h, pending.operationId);
  assert.deepEqual(Object.keys(own).sort(), ['created_at', 'domain', 'kind', 'operationId', 'status'], 'pending: no receipt, no snapshot');
});

// ---------------------------------------------------------------------------
// The fixtures are what the handlers produce
// ---------------------------------------------------------------------------

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

test('no B06 fixture carries a secret, a token, a database detail or a real address', () => {
  const forbidden = [
    /sk-[A-Za-z0-9]/, /Bearer\s/i, /eyJ[A-Za-z0-9_-]{10,}/, /api[_-]?key/i, /secret/i, /password/i, /authorization/i,
    /supabase|upstash|openrouter|openai|mapbox|postgres|PGRST|HALO_[A-Z]/i,
    /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/,
    /https?:\/\//,
  ];
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture.body);
    for (const pattern of forbidden) assert.equal(pattern.test(serialized), false, `${fixture.name} matches ${pattern}`);
    assert.ok([REQUEST_ID, undefined].includes(fixture.body.request_id), `${fixture.name}: a synthetic request id`);
    for (const id of serialized.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) {
      assert.ok(id.startsWith('0b060000-0000-4000-8000-'), `${fixture.name}: ${id} is synthetic`);
    }
  }
});

// ---------------------------------------------------------------------------
// Header documentation, both ways. Runs last: tests in one file run in order.
// ---------------------------------------------------------------------------

test('B06 contract headers: every documented response header is really sent, for the pairs these tests exercise', () => {
  assert.ok(seenHeaders.size > 0, 'no conformance responses were recorded');
  for (const [key, seen] of seenHeaders) {
    const [id, status] = key.split(' ');
    for (const name of documentedHeaders(id, status)) {
      if (CHECKED_HEADERS.includes(name)) assert.ok(seen.has(name), `${key}: the contract documents ${name} but no exercised response sent it`);
    }
  }
});

test('B06 contract headers: every documented request header (Idempotency-Key, If-Match, X-Halo-Home-Context) was sent by an exercised request', () => {
  for (const id of operations.keys()) {
    for (const name of documentedParams(id)) {
      assert.ok(sentHeaders.get(id)?.has(name), `${id}: the contract documents the ${name} header but no exercised request sent it`);
    }
  }
  assert.deepEqual([...documentedParams('actionsCommit')].sort(), ['idempotency-key', 'if-match', 'x-halo-home-context']);
  assert.deepEqual([...documentedParams('weekAcknowledge')].sort(), ['idempotency-key', 'if-match', 'x-halo-home-context']);
});
