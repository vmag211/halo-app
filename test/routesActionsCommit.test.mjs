/**
 * POST /api/frontend/actions/commands, registry `actions.commit` (B06 plan,
 * Task 4): the request, the refusals, the replays, the retry loop and the
 * unresolved list, on the in-memory fake ledger, whose statements are in the
 * query log and which a test can seed in any shape.
 *
 * The two 0023 functions are the REAL ones, on PGlite (test/helpers/
 * actionsWorld.mjs): the planner's writes are applied, and its snapshot read,
 * by migration 0023 itself, not by a stand-in. Before each commit the fake's
 * ledger row is copied into PGlite, because the function locks and settles its
 * own row there (Rulings H8, H29). Ruling H8's own test, where the ledger has
 * to be the real table with 0023's settled-row guard, and the client
 * conformance scenarios are in routesActionsCommitDb.test.mjs.
 *
 * Every succeeded body is checked with the client's adapter receipt check
 * (adapters.ts:7) and `actionReceiptCoversCommand` (action-service.ts:102-115),
 * transcribed in test/helpers/frontendB06.mjs.
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * fake and a local PGlite database, and a fetch that throws on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { createWorld, body } from './helpers/actionsWorld.mjs';
import { actionReceiptCoversCommand, clientRuntime, createActionAdapter, messages, myWeek, sameValue, validActionSnapshot } from './helpers/frontendB06.mjs';

const { requestHash } = await import('../lib/operations.js');
const { featureDisabledReason } = await import('../lib/features.js');
const { ACTION_REFUSAL_MESSAGES } = await import('../lib/actionRules.js');

const EM_DASH = String.fromCharCode(0x2014);
const NOTE = 'PRIVATE-NOTE-MARKER the inhaler is in the blue bag';
const TITLE = 'PRIVATE-TITLE-MARKER Test the kitchen tap';
const HISTORY = 'PRIVATE-HISTORY-MARKER Added from the week plan';
const PLACE = 'PRIVATE-PLACE-MARKER Hidden Creek';
const MARKERS = ['PRIVATE-NOTE-MARKER', 'PRIVATE-TITLE-MARKER', 'PRIVATE-HISTORY-MARKER', 'PRIVATE-PLACE-MARKER'];

const meta = (over = {}) => ({ note: '', paused: false, archived: false, completedOn: '', time: '', duration: 60, zone: 'America/New_York', recurrence: 'none', reminder: false, history: [], ...over });
const seed = (key, title = 'A task', extra = {}) => ({ key, title, reason: 'Due this week', origin: 'Personal', ...extra });
const ago = (ms) => new Date(Date.now() - ms).toISOString();

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const world = (options = {}) => createWorld(db, { ledger: 'fake', ...options });

/** POST `command` (with a fresh operation id), assert 200, and return the body. */
async function ok(w, command, options) {
  const response = await w.commit(command, options);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  assert.ok(!text.includes(EM_DASH), 'no em dash');
  const parsed = JSON.parse(text);
  assert.ok(!('data' in parsed), 'no top-level data key (runtime.ts:149-153)');
  return parsed;
}

/** The client's own receipt check (adapters.ts:7), through the transcribed adapter. */
function adapterAccepts(receipt, operationId) {
  const adapter = createActionAdapter({ request: async () => receipt });
  return adapter.reconcile(operationId).then(() => true, () => false);
}

/** A succeeded body the client takes as proof: adapter, validity and coverage. */
async function assertCovers(receipt, command, previous) {
  assert.equal(receipt.status, 'succeeded', JSON.stringify(receipt));
  assert.ok(await adapterAccepts(receipt, command.operationId), 'the adapter accepts it');
  assert.ok(validActionSnapshot(receipt.snapshot), 'validActionSnapshot');
  assert.ok(actionReceiptCoversCommand(command, previous, receipt), 'actionReceiptCoversCommand');
  assert.ok(Array.isArray(receipt.snapshot.unresolvedOperations), 'T1');
  assert.ok(!receipt.snapshot.unresolvedOperations.includes(command.operationId), 'T2: never its own id');
}

/** Adds tasks through the route and returns the snapshot. */
async function seedTasks(w, seeds, date = '2026-10-20', options = {}, as = 'alice') {
  const command = body({ kind: 'add', seeds, date, ...options });
  const receipt = await ok(w, command, { as });
  assert.equal(receipt.status, 'succeeded', JSON.stringify(receipt));
  return receipt.snapshot;
}

const commitCalls = (w) => w.h.db.rpcCalls.filter((call) => call.name === 'commit_household_actions').length;
const ledgerRows = (w) => w.h.db.rows('operations');

async function assertNoContentInLedger(w) {
  const text = await w.ledgerText();
  for (const marker of MARKERS) assert.ok(!text.includes(marker), `H3: ${marker} is not in operations.result`);
}

/** A ledger row as runOperation would have claimed it for `command`. */
const claimed = (w, command, overrides = {}) => {
  const input = { ...command };
  delete input.operationId;
  return {
    operation_id: command.operationId, profile_id: w.alice, domain: 'actions', kind: 'actions.commit',
    status: 'pending', request_hash: requestHash(input), result: null, created_at: ago(1_000), ...overrides,
  };
};

// ---------------------------------------------------------------------------
// Transport and validation (Rulings H11, H13, H14, H21), all before the claim
// ---------------------------------------------------------------------------

test('without a session the answer is 401 and nothing is read or recorded', async () => {
  const w = await world();
  const command = body({ kind: 'revise', changes: [] });
  const response = await w.commit(command, { as: null });
  await expectEnvelope(response, { status: 401, code: 'auth_required' });
  assert.deepEqual(w.h.db.rpcCalls, []);
  assert.deepEqual(ledgerRows(w), []);
});

test('the Idempotency-Key is required, must be a UUID, and must be the body\'s operationId (H21, T12)', async () => {
  const w = await world();
  const command = body({ kind: 'revise', changes: [] });
  for (const [label, options, field, code] of [
    ['missing', { key: null }, 'Idempotency-Key', 'invalid_uuid'],
    ['not a uuid', { key: 'not-a-uuid' }, 'Idempotency-Key', 'invalid_uuid'],
    ['another id', { key: crypto.randomUUID() }, 'operationId', 'idempotency_key_mismatch'],
  ]) {
    const result = await expectEnvelope(await w.commit(command, options), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(result.field_errors.map((error) => [error.field, error.code]), [[field, code]], label);
  }
  for (const [label, operationId] of [['missing', undefined], ['not a uuid', 'abc'], ['padded', ` ${command.operationId}`]]) {
    const result = await expectEnvelope(await w.commit({ ...command, operationId }, { key: command.operationId }), { status: 400, code: 'validation_failed' });
    assert.deepEqual(result.field_errors.map((error) => error.field), ['operationId'], label);
  }
  assert.deepEqual(ledgerRows(w), [], 'no ledger row for any of them');
  assert.deepEqual(w.h.db.rpcCalls, [], 'and nothing read');
  // The header is trimmed and lowercased; the body id is lowercased, never trimmed (H27).
  const upper = body({ kind: 'revise', changes: [] });
  const receipt = await ok(w, { ...upper, operationId: upper.operationId.toUpperCase() }, { key: `  ${upper.operationId.toUpperCase()} ` });
  assert.equal(receipt.operationId, upper.operationId, 'the receipt carries the lowercased id');
  assert.equal(ledgerRows(w)[0].operation_id, upper.operationId);
});

test('If-Match, an unknown field, clear, duplicate seed keys and an unstorable value are 400s with no ledger row (H11, H13, H14, H21)', async () => {
  const w = await world();
  const cases = [
    ['If-Match', body({ kind: 'revise', changes: [] }), { headers: { 'if-match': '3' } }, 'If-Match', 'precondition_unsupported'],
    ['an unknown top-level key', body({ kind: 'revise', changes: [], snapshot: {} }), {}, 'snapshot', 'unknown_field'],
    ['clear', body({ kind: 'clear', fingerprint: 'x' }), {}, 'kind', 'unsupported_kind'],
    ['duplicate seed keys', body({ kind: 'add', date: '', seeds: [seed('k'), seed('k')] }), {}, 'seeds.1.key', 'duplicate_seed_key'],
    ['U+0000 in a title', body({ kind: 'add', date: '', seeds: [seed('k', 'a\u0000b')] }), {}, 'seeds.0', 'unstorable_text'],
    ['a year-0000 date', body({ kind: 'add', date: '0000-01-01', seeds: [seed('k')] }), {}, 'date', 'unstorable_date'],
  ];
  for (const [label, command, options, field, code] of cases) {
    const result = await expectEnvelope(await w.commit(command, options), { status: 400, code: 'validation_failed', retryable: false });
    assert.ok(result.field_errors.some((error) => error.field === field && error.code === code), `${label}: ${JSON.stringify(result.field_errors)}`);
    assert.ok(!result.message.includes(EM_DASH));
  }
  assert.deepEqual(ledgerRows(w), []);
  assert.deepEqual(w.h.db.rpcCalls, []);
  assert.deepEqual(await w.tasks(), []);
});

test('a body over 4,000,000 bytes is a 413 and records nothing (H21)', async () => {
  const w = await world();
  const command = body({ kind: 'add', date: '', seeds: [seed('k', 'x', { pad: 'y'.repeat(4_000_000) })] });
  const response = await w.commit(command);
  await expectEnvelope(response, { status: 413, code: 'payload_too_large' });
  assert.deepEqual(ledgerRows(w), []);
  assert.deepEqual(w.h.db.rpcCalls, []);
});

test('a deeply nested body is a 400, never a 500, and records nothing (H26; the 0023 review obligation)', async (t) => {
  const logged = muteConsoleError(t);
  const w = await world();
  const nested = (n) => `${'{"a":'.repeat(n)}1${'}'.repeat(n)}`;
  const deep = (n) => JSON.parse(nested(n));
  // A seed's extra keys are ignored by the planner, so only the ledger's
  // fingerprint ever walks them; it recurses, and this depth overflows it.
  // Sent as text, because JSON.stringify would overflow on it too.
  const operationId = crypto.randomUUID();
  const raw = `{"operationId":"${operationId}","kind":"add","date":"","seeds":[{"key":"k","title":"x","reason":"r","origin":"o","extra":${nested(5_000)}}]}`;
  const input = JSON.parse(raw);
  delete input.operationId;
  assert.throws(() => requestHash(input), RangeError, 'the precondition: this body overflows requestHash');
  const result = await expectEnvelope(await w.commit(null, { raw, key: operationId }), { status: 400, code: 'validation_failed' });
  assert.deepEqual(result.field_errors.map((error) => [error.field, error.code]), [['body', 'unstorable_depth']]);
  // A deep stored value is the planner's own 400 (H26).
  const metaDeep = body({ kind: 'revise', changes: [], metadata: { k: { ...meta(), extra: deep(40) } } });
  const second = await expectEnvelope(await w.commit(metaDeep), { status: 400, code: 'validation_failed' });
  assert.ok(second.field_errors.some((error) => error.code === 'unstorable_depth'));
  assert.deepEqual(ledgerRows(w), []);
  assert.deepEqual(w.h.db.rpcCalls, [], 'nothing read either');
  assert.equal(logged.mock.calls.length, 0, 'not a 500');
});

test('flag off: 200 failed with the disabled reason, no ledger row, no read, no statement at all (H17)', async () => {
  const w = await world({ env: {} });
  const command = body({ kind: 'add', date: '', seeds: [seed('k')] });
  const receipt = await ok(w, command);
  assert.deepEqual(receipt, { operationId: command.operationId, status: 'failed', message: featureDisabledReason('tasks') });
  assert.deepEqual(w.h.db.rpcCalls, []);
  assert.deepEqual(w.h.db.queryLog, []);
  assert.deepEqual(ledgerRows(w), []);
  // The adapter takes it as a failed save with that reason, not an unknown one,
  // so nothing would lock (adapters.ts:7,10; ExpandedPreviewState.tsx:93).
  const adapter = createActionAdapter(clientRuntime(w.h, 'alice'));
  const { operationId, ...rest } = body({ kind: 'add', date: '', seeds: [seed('k2')] });
  assert.deepEqual(await adapter.commit(rest, { operationId }), { operationId, status: 'failed', message: featureDisabledReason('tasks') });
  assert.deepEqual(ledgerRows(w), []);
});

test('before 0023 (or 0017) the answer is the non-retryable 503, decided before the claim, and nothing is written', async () => {
  const missingFunction = await world({ onRead: () => { throw rpcError('PGRST202', 'Could not find the function public.read_household_actions'); } });
  const command = body({ kind: 'add', date: '', seeds: [seed('k')] });
  const result = await expectEnvelope(await missingFunction.commit(command), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!result.message.includes(EM_DASH));
  assert.deepEqual(ledgerRows(missingFunction), [], 'no claim');
  assert.equal(commitCalls(missingFunction), 0);

  // 0017 missing: the claim itself fails, before anything is written.
  const noLedger = await world();
  const fakeFrom = noLedger.h.db.from;
  noLedger.h.db.from = (name) => (name === 'operations' ? fakeFrom('operations_missing') : fakeFrom(name));
  await expectEnvelope(await noLedger.commit(body({ kind: 'add', date: '', seeds: [seed('k')] })), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(commitCalls(noLedger), 0);
  assert.deepEqual(await noLedger.tasks(), []);
});

test('the route declares maxDuration = 60, has a ROUTE_COVERAGE line, and no server-authored string has an em dash (H21, H22, T13)', () => {
  const route = readFileSync(path.join(REPO_ROOT, 'app/api/frontend/actions/commands/route.js'), 'utf8');
  assert.match(route, /^export const maxDuration = 60;$/m);
  for (const file of ['app/api/frontend/actions/commands/route.js', 'app/api/operations/route.js', 'lib/actionsStore.js', 'lib/actionRules.js']) {
    assert.ok(!readFileSync(path.join(REPO_ROOT, file), 'utf8').includes(EM_DASH), file);
  }
  for (const message of Object.values(ACTION_REFUSAL_MESSAGES)) assert.ok(!message.includes(EM_DASH));
  assert.match(readFileSync(path.join(REPO_ROOT, 'test/routeIsolation.test.mjs'), 'utf8'), /'POST \/api\/frontend\/actions\/commands':/);
});

// ---------------------------------------------------------------------------
// A save, and what it answers (T1, T2, T3, H16)
// ---------------------------------------------------------------------------

test('an add answers succeeded with the snapshot the commit read, which the client accepts as proof, and writes one ledger row', async () => {
  const w = await world();
  const command = body({ kind: 'add', date: '2026-10-20', seeds: [seed('personal:1', `  ${TITLE}  `)], metadata: { 'personal:1': meta({ note: NOTE, history: [HISTORY] }) }, expectedMetadata: { 'personal:1': 'null' }, initialStates: { 'personal:1': 'waiting' } });
  const receipt = await ok(w, command, { headers: { 'x-halo-home-context': '11111111-1111-4111-8111-111111111111' } });
  await assertCovers(receipt, command, { actions: [], metas: {} });
  assert.deepEqual(Object.keys(receipt), ['operationId', 'status', 'snapshot']);
  assert.deepEqual(Object.keys(receipt.snapshot), ['actions', 'metas', 'preferences', 'unresolvedOperations']);
  const [action] = receipt.snapshot.actions;
  assert.deepEqual({ ...action, id: 'x' }, { id: 'x', key: 'personal:1', title: TITLE, reason: 'Due this week', origin: 'Personal', date: '2026-10-20', state: 'waiting', revision: 1 }, 'title trimmed, exact echo');
  assert.ok(sameValue(receipt.snapshot.metas['personal:1'], command.metadata['personal:1']));
  const rows = ledgerRows(w);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'succeeded');
  assert.deepEqual(rows[0].result, { status: 'succeeded', affected: [{ id: action.id, revision: 1 }], removed: [], unresolvedOperations: [], operationId: command.operationId }, 'ids and revisions only, and the empty list (S14)');
  assert.deepEqual(w.h.blockedFetches, []);
  await assertNoContentInLedger(w);
});

test('T2: the receipt never lists its own operation, even while its row still reads pending; a genuinely pending one is listed', async () => {
  const w = await world();
  const other = body({ kind: 'revise', changes: [] });
  w.h.db.seed('operations', [claimed(w, other)]);
  const command = body({ kind: 'add', date: '', seeds: [seed('personal:1')] });
  // Keep this operation's fake row pending whatever runOperation settles,
  // so the list is read while the own row is still `pending`.
  w.h.db.registerTrigger('operations', {
    before: (_old, rows) => { for (const row of rows) if (row.operation_id === command.operationId && row.status !== 'pending') { row.status = 'pending'; row.result = null; } },
  });
  const receipt = await ok(w, command);
  assert.equal(ledgerRows(w).find((row) => row.operation_id === command.operationId).status, 'pending', 'the precondition: its row still reads pending');
  assert.deepEqual(receipt.snapshot.unresolvedOperations, [other.operationId]);
  await assertCovers(receipt, command, { actions: [], metas: {} });
});

test('T2: two sequential adds both succeed and neither lists itself; a settled operation is not listed (H16)', async () => {
  const w = await world();
  const first = body({ kind: 'add', date: '', seeds: [seed('personal:1')] });
  const second = body({ kind: 'add', date: '', seeds: [seed('personal:2')] });
  const a = await ok(w, first);
  const b = await ok(w, second);
  assert.deepEqual(a.snapshot.unresolvedOperations, []);
  assert.deepEqual(b.snapshot.unresolvedOperations, []);
  await assertCovers(b, second, { actions: a.snapshot.actions, metas: a.snapshot.metas });
  // Another household's pending operation and another domain's are not listed either.
  w.h.db.seed('operations', [
    { ...claimed(w, body({ kind: 'revise', changes: [] })), profile_id: w.bob },
    { ...claimed(w, body({ kind: 'revise', changes: [] })), domain: 'week-updates', kind: 'week.acknowledge' },
  ]);
  const third = await ok(w, body({ kind: 'revise', changes: [] }));
  assert.deepEqual(third.snapshot.unresolvedOperations, []);
});

test('T3: revise with changes [] and only preferences succeeds, and the preferences come back equal by value', async () => {
  const w = await world();
  const writes = [
    { 'week:focus': 'Water first this week' },
    { 'food-interests': ['fish', 'water'] },
    { 'week:season-dismissals': ['spring-2026'] },
    { 'week:availability': { '2026-10-19': 120 } },
    { outdoorPlan: { key: 'walk', place: PLACE, period: 'morning', watchRequested: true, forecastVersion: null, forecastIssuedAt: null, forecastExpiresAt: null } },
  ];
  for (const preferences of writes) {
    const command = body({ kind: 'revise', changes: [], preferences });
    const receipt = await ok(w, command);
    await assertCovers(receipt, command, { actions: [], metas: {} });
  }
  // The review prompt writes its preference through an add (WeekPlanningRail.tsx:31).
  const prompt = body({ kind: 'add', date: '', seeds: [seed('season-review:fall:2026', 'Review the season')], preferences: { 'week:review-preferences': { enabled: true, weekday: 0, time: '18:00', zone: 'America/Chicago' } } });
  await assertCovers(await ok(w, prompt), prompt, { actions: [], metas: {} });
  const stored = await w.preferences();
  for (const preferences of writes) for (const [key, value] of Object.entries(preferences)) assert.ok(sameValue(stored[key], value), key);
  await assertNoContentInLedger(w);
});

test('a delete of an id this household has no row for succeeds with nothing written, identical for a foreign id (H14)', async () => {
  const w = await world();
  const bobs = await seedTasks(w, [seed('home:radon', TITLE)], '2026-11-01', {}, 'bob');
  const versionBefore = await w.version('bob');
  for (const id of [crypto.randomUUID(), bobs.actions[0].id, 'not-even-a-uuid']) {
    const command = body({ kind: 'delete', id, revision: 1 });
    const receipt = await ok(w, command);
    assert.equal(receipt.status, 'succeeded');
    assert.deepEqual(receipt.snapshot, { actions: [], metas: {}, preferences: {}, unresolvedOperations: [] });
    assert.ok(!JSON.stringify(receipt).includes('PRIVATE-TITLE'), 'nothing of bob\'s');
  }
  assert.deepEqual((await w.tasks('bob')).map((row) => row.title), [TITLE], 'bob\'s task is untouched');
  assert.equal(await w.version('bob'), versionBefore);
  assert.equal(await w.version('alice'), 0, 'nothing written for alice either');
});

// ---------------------------------------------------------------------------
// Refusals against stored state (H11, H12, T6)
// ---------------------------------------------------------------------------

test('a stale revise or delete answers failed stale_revision with the current revisions; an unknown id answers unknown_action', async () => {
  const w = await world();
  const snapshot = await seedTasks(w, [seed('personal:1', 'One'), seed('personal:2', 'Two')]);
  const [one, two] = snapshot.actions;
  await ok(w, body({ kind: 'revise', changes: [{ id: one.id, revision: 1, patch: { title: 'One, renamed', date: '2026-10-21', state: 'saved' } }] }));

  const stale = body({ kind: 'revise', changes: [{ id: one.id, revision: 1, patch: { title: 'Again', date: '', state: 'saved' } }, { id: two.id, revision: 1, patch: { title: 'Two', date: '', state: 'completed' } }] });
  assert.deepEqual(await ok(w, stale), {
    operationId: stale.operationId, status: 'failed', reason: 'stale_revision', message: ACTION_REFUSAL_MESSAGES.stale_revision,
    revisions: [{ id: one.id, revision: 2 }, { id: two.id, revision: 1 }],
  });
  const staleDelete = body({ kind: 'delete', id: one.id, revision: 1 });
  assert.deepEqual(await ok(w, staleDelete), {
    operationId: staleDelete.operationId, status: 'failed', reason: 'stale_revision', message: ACTION_REFUSAL_MESSAGES.stale_revision, revisions: [{ id: one.id, revision: 2 }],
  });
  const unknown = body({ kind: 'revise', changes: [{ id: crypto.randomUUID(), revision: 1, patch: { title: 'x', date: '', state: 'saved' } }] });
  assert.deepEqual(await ok(w, unknown), { operationId: unknown.operationId, status: 'failed', reason: 'unknown_action', message: ACTION_REFUSAL_MESSAGES.unknown_action });
  assert.deepEqual((await w.tasks()).map((row) => [row.title, row.revision, row.state]), [['One, renamed', 2, 'saved'], ['Two', 1, 'saved']], 'nothing written by a refusal');
  // Stored as the reason and the revisions only (H3, S14).
  assert.deepEqual(ledgerRows(w).find((row) => row.operation_id === stale.operationId).result,
    { status: 'failed', reason: 'stale_revision', revisions: [{ id: one.id, revision: 2 }, { id: two.id, revision: 1 }], unresolvedOperations: [], operationId: stale.operationId });
});

test('T6: a planner-shaped revise with one stale signature refuses metadata_changed and changes no task, meta or preference', async () => {
  const w = await world();
  const keys = ['personal:1', 'personal:2', 'personal:3'];
  const metas = Object.fromEntries(keys.map((key) => [key, meta({ note: NOTE })]));
  const snapshot = await seedTasks(w, keys.map((key) => seed(key, TITLE)), '2026-10-20', { metadata: metas, preferences: { 'week:focus': 'Before' } });
  const signatures = Object.fromEntries(keys.map((key) => [key, JSON.stringify(snapshot.metas[key])]));
  signatures['personal:2'] = JSON.stringify(meta({ note: 'an older note' }));
  const command = body({
    kind: 'revise',
    changes: [{ id: snapshot.actions[0].id, revision: 1, patch: { title: TITLE, date: '2026-10-22', state: 'saved' } }],
    metadata: Object.fromEntries(keys.map((key) => [key, { ...snapshot.metas[key], history: [HISTORY] }])),
    expectedMetadata: signatures,
    preferences: { 'week:focus': 'After', 'week:availability': { '2026-10-19': 60 } },
  });
  const before = { tasks: await w.tasks(), preferences: await w.preferences(), version: await w.version() };
  assert.deepEqual(await ok(w, command), { operationId: command.operationId, status: 'failed', reason: 'metadata_changed', message: ACTION_REFUSAL_MESSAGES.metadata_changed });
  assert.deepEqual({ tasks: await w.tasks(), preferences: await w.preferences(), version: await w.version() }, before);
  await assertNoContentInLedger(w);
});

test('a refusal is shown to the person verbatim and does not lock My Week (ExpandedPreviewState.tsx:93)', async () => {
  const w = await world();
  const snapshot = await seedTasks(w, [seed('personal:1', 'One')], '2026-10-20', { metadata: { 'personal:1': meta() } });
  const week = w.week();
  await week.load();
  // Another device completes the task first.
  await ok(w, body({ kind: 'revise', changes: [{ id: snapshot.actions[0].id, revision: 1, patch: { title: 'One', date: '2026-10-20', state: 'completed' } }] }));
  assert.equal(await week.changeState(snapshot.actions[0].id, 'waiting'), false);
  assert.deepEqual([week.error, week.unknownOperation, week.canMutate()], [ACTION_REFUSAL_MESSAGES.stale_revision, '', true]);
});

// ---------------------------------------------------------------------------
// Replays (H7, H11)
// ---------------------------------------------------------------------------

test('the same key and body replays the outcome without a second write, with a current snapshot and the live list', async () => {
  const w = await world();
  const command = body({ kind: 'add', date: '', seeds: [seed('personal:1', TITLE)] });
  const first = await ok(w, command);
  const pending = body({ kind: 'revise', changes: [] });
  w.h.db.seed('operations', [claimed(w, pending)]);
  const again = await ok(w, command);
  assert.equal(commitCalls(w), 1, 'the function ran once');
  assert.equal((await w.tasks()).length, 1);
  assert.deepEqual(again.snapshot.actions, first.snapshot.actions);
  assert.deepEqual(again.snapshot.unresolvedOperations, [pending.operationId], 'the live list, never the stored []');
  await assertCovers(again, command, { actions: [], metas: {} });
});

test('the same key with a different body is 409 operation_mismatch, and another household\'s id is the identical 409', async () => {
  const w = await world();
  const command = body({ kind: 'add', date: '', seeds: [seed('personal:1')] });
  await ok(w, command);
  const before = structuredClone(ledgerRows(w));
  const changed = await expectEnvelope(await w.commit({ ...command, date: '2026-10-21' }), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(changed.reason, 'operation_mismatch');
  const foreign = await expectEnvelope(await w.commit(command, { as: 'bob' }), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(foreign.reason, 'operation_mismatch');
  assert.equal(foreign.message, changed.message);
  assert.deepEqual(ledgerRows(w), before, 'nobody\'s row changed');
  assert.equal(commitCalls(w), 1);
});

test('a replayed refusal is the same 200 failed body; an invalid_result refusal keeps the client\'s own sentence (H11, H31)', async () => {
  const w = await world();
  const snapshot = await seedTasks(w, [seed('personal:1', 'Timed')], '2026-03-09', { metadata: { 'personal:1': meta({ time: '02:30' }) } });
  // Moving the 02:30 task onto the spring-forward day leaves it in the gap (T5).
  const command = body({ kind: 'revise', changes: [{ id: snapshot.actions[0].id, revision: 1, patch: { title: 'Timed', date: '2026-03-08', state: 'saved' } }] });
  const first = await ok(w, command);
  assert.deepEqual(first, { operationId: command.operationId, status: 'failed', reason: 'invalid_result', message: 'Choose a valid dated time outside clock-change gaps or ambiguous times.' });
  assert.deepEqual(await ok(w, command), first, 'the replay answers the same body');
  assert.deepEqual(ledgerRows(w).find((row) => row.operation_id === command.operationId).result,
    { status: 'failed', reason: 'invalid_result', check: 'time', unresolvedOperations: [], operationId: command.operationId }, 'a code, never the sentence or a value');
});

test('both reaped shapes answer a terminal 409 with an accurate reason, never a 5xx or stale_revision; a pending row is the 503 (H7, H11)', async () => {
  const w = await world();
  const thrown = body({ kind: 'add', date: '', seeds: [seed('personal:1')] });
  const reaped = body({ kind: 'add', date: '', seeds: [seed('personal:2')] });
  const running = body({ kind: 'add', date: '', seeds: [seed('personal:3')] });
  const stale = body({ kind: 'add', date: '', seeds: [seed('personal:4')] });
  w.h.db.seed('operations', [
    claimed(w, thrown, { status: 'failed', result: null }),
    claimed(w, reaped, { status: 'failed', result: { status: 'failed', reason: 'abandoned' } }),
    claimed(w, running),
    claimed(w, stale, { created_at: ago(10 * 60 * 1000) }),
  ]);
  const notApplied = await expectEnvelope(await w.commit(thrown), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(notApplied.reason, 'not_applied');
  const abandoned = await expectEnvelope(await w.commit(reaped), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(abandoned.reason, 'abandoned');
  const inFlight = await expectEnvelope(await w.commit(running), { status: 503, code: 'upstream_unavailable', retryable: true });
  assert.ok(!inFlight.message.includes(EM_DASH));
  // A pending row past its window is reaped by the replay itself, then answered as reaped.
  const late = await expectEnvelope(await w.commit(stale), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(late.reason, 'abandoned');
  assert.equal(commitCalls(w), 0, 'no replay acts again');
  assert.deepEqual(await w.tasks(), []);
  // The client: a 409 is `conflict` (runtime.ts:144), so the adapter answers
  // `failed`, not `unknown` (adapters.ts:10): a failed save, never a lock.
  const adapter = createActionAdapter(clientRuntime(w.h, 'alice'));
  const { operationId, ...command } = reaped;
  assert.deepEqual(await adapter.commit(command, { operationId }), { operationId, status: 'failed', message: messages.conflict });
  const { operationId: runningId, ...runningCommand } = running;
  assert.equal((await adapter.commit(runningCommand, { operationId: runningId })).status, 'unknown', 'while in flight it stays unconfirmed');
});

test('an unrecognized stored receipt is a terminal 409, logged without content, and never replayed', async (t) => {
  const logged = muteConsoleError(t);
  const w = await world();
  const command = body({ kind: 'add', date: '', seeds: [seed('personal:1')] });
  w.h.db.seed('operations', [claimed(w, command, { status: 'cancelled', result: { status: 'cancelled', note: NOTE } })]);
  const result = await expectEnvelope(await w.commit(command), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(result.reason, 'unrecognized_receipt');
  const line = loggedText(logged);
  assert.match(line, /actions commit: unrecognized stored receipt \(request [^,]+, ledger status cancelled\)/);
  assert.ok(!line.includes('PRIVATE'));
});

// ---------------------------------------------------------------------------
// H10: the household version and the retry
// ---------------------------------------------------------------------------

test('H10: a lost race is retried from a fresh read, and the client\'s preconditions are re-checked each time', async () => {
  // `race`, when set, runs once just before the next commit call reaches the
  // real function: another save lands first, so the function refuses the old
  // base version itself (HALO_STALE_BASE).
  let race = null;
  let commits = 0;
  const w = await world({
    onCommit: async (_args, call) => {
      commits += 1;
      if (race) { const other = race; race = null; await other(); }
      return call();
    },
  });
  const snapshot = await seedTasks(w, [seed('personal:1', 'One'), seed('personal:2', 'Two')], '2026-10-20', { metadata: { 'personal:1': meta(), 'personal:2': meta() } });
  const [one, two] = snapshot.actions;

  // Unrelated to the racing change: retried and saved.
  race = () => ok(w, body({ kind: 'revise', changes: [], metadata: { 'personal:2': meta({ note: 'changed elsewhere' }) } }));
  commits = 0;
  const unrelated = body({ kind: 'revise', changes: [{ id: one.id, revision: 1, patch: { title: 'One', date: '2026-10-21', state: 'saved' } }], expectedMetadata: { 'personal:1': JSON.stringify(meta()) } });
  const saved = await ok(w, unrelated);
  assert.equal(commits, 3, 'the first attempt, the racing save, and the retry');
  await assertCovers(saved, unrelated, snapshot);
  assert.equal(saved.snapshot.metas['personal:2'].note, 'changed elsewhere', 'the retry planned from the fresh read, so the other save is kept');

  // Signed against what the racing change replaced: refused on the retry, never written over it.
  const current = saved.snapshot.metas['personal:2'];
  race = () => ok(w, body({ kind: 'revise', changes: [], metadata: { 'personal:2': meta({ note: 'changed again' }) } }));
  const signed = body({ kind: 'revise', changes: [{ id: two.id, revision: 1, patch: { title: 'Two', date: '2026-10-22', state: 'saved' } }], expectedMetadata: { 'personal:2': JSON.stringify(current) } });
  assert.deepEqual(await ok(w, signed), { operationId: signed.operationId, status: 'failed', reason: 'metadata_changed', message: ACTION_REFUSAL_MESSAGES.metadata_changed });
  const stored = (await w.tasks()).find((row) => row.id === two.id);
  assert.deepEqual([stored.date, stored.meta.note], ['2026-10-20', 'changed again']);
});

test('H10: three lost races answer failed busy, with nothing written', async () => {
  let calls = 0;
  const w = await world({ onCommit: async () => { calls += 1; throw rpcError('P0001', 'HALO_STALE_BASE', 'the household version is no longer the one this change was planned from'); } });
  const command = body({ kind: 'add', date: '', seeds: [seed('personal:1')] });
  assert.deepEqual(await ok(w, command), { operationId: command.operationId, status: 'failed', reason: 'busy', message: ACTION_REFUSAL_MESSAGES.busy });
  assert.equal(calls, 3);
  assert.equal(w.h.db.rpcCalls.filter((call) => call.name === 'read_household_actions').length, 3, 'a fresh read for every attempt');
  assert.deepEqual(await w.tasks(), []);
  assert.deepEqual(ledgerRows(w)[0].result, { status: 'failed', reason: 'busy', unresolvedOperations: [], operationId: command.operationId });
});

// ---------------------------------------------------------------------------
// Failures inside the commit
// ---------------------------------------------------------------------------

test('a database error inside the commit is a 500 that logs only its code and message, never details or hint (0023 review L2)', async (t) => {
  const logged = muteConsoleError(t);
  const w = await world({
    onCommit: async () => {
      throw rpcError('23514', 'new row for relation "household_actions" violates check constraint "household_actions_title_check"',
        `Failing row contains (${TITLE}, ${NOTE}).`, `PRIVATE-HINT-MARKER ${PLACE}`);
    },
  });
  const command = body({ kind: 'add', date: '', seeds: [seed('personal:1', TITLE)] });
  await expectEnvelope(await w.commit(command), { status: 500, code: 'internal_error' });
  const line = loggedText(logged);
  assert.match(line, /actions commit failed \(request [^)]+\): 23514 new row for relation "household_actions" violates check constraint "household_actions_title_check"/);
  for (const marker of [...MARKERS, 'PRIVATE-HINT-MARKER', 'Failing row']) assert.ok(!line.includes(marker), `${marker} is not logged`);
  assert.equal(ledgerRows(w)[0].status, 'failed', 'the in-process throw settles the claim failed');
  assert.equal(ledgerRows(w)[0].result, null);
  // Its replay is the terminal 409 not_applied, and the client is told a save failed.
  const replay = await expectEnvelope(await w.commit(command), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(replay.reason, 'not_applied');
});

test('HALO_OPERATION_NOT_PENDING propagates as the 500 the client treats as unknown (plan, Task 4)', async (t) => {
  muteConsoleError(t);
  const w = await world({ onCommit: async () => { throw rpcError('P0001', 'HALO_OPERATION_NOT_PENDING'); } });
  const week = w.week();
  await week.load();
  assert.equal(await week.addActions([seed('personal:1')], ''), false);
  assert.equal(week.error, 'The save outcome is not confirmed. Check its status before changing tasks again.');
  assert.equal(week.unknownOperation, week.operationIds[0]);
});

// ---------------------------------------------------------------------------
// The transcription refuses what the client refuses, so agreement means something
// ---------------------------------------------------------------------------

test('the transcribed client refuses what the client refuses: the unwrap, the adapter, coverage and the reconcile', async () => {
  const action = { id: '7a7a7a7a-0000-4000-8000-000000000001', key: 'personal:1', title: 'One', reason: '', origin: '', date: '', state: 'saved', revision: 1 };
  const NOT_CONFIRMED = 'The save outcome is not confirmed. Check its status before changing tasks again.';
  /**
   * A loaded, empty My Week whose server answers every save with
   * `answer(operationId)`: `[status, json]`, the receipt for that save.
   */
  const weekAnswering = (answer) => {
    const server = {
      call: async (_path, _method, { headers }) => {
        const [status, json] = answer(headers['Idempotency-Key']);
        return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
      },
    };
    const week = myWeek(createActionAdapter(clientRuntime(server, 'alice')));
    week.commitSnapshot({ actions: [], metas: {}, preferences: {}, unresolvedOperations: [] });
    week.readiness = 'ready';
    return week;
  };
  const add = (week) => week.addActions([{ key: 'personal:1', title: 'One', reason: '', origin: '' }], '');
  const covering = (operationId) => ({ operationId, status: 'succeeded', snapshot: { actions: [action], metas: {}, preferences: {}, unresolvedOperations: [] } });

  const control = weekAnswering((id) => [200, covering(id)]);
  assert.equal(await add(control), true, 'the control: a covering receipt saves');
  assert.deepEqual([control.error, control.unknownOperation], ['', '']);

  // Each broken receipt is "not confirmed" and locks (ExpandedPreviewState.tsx:94, :103).
  for (const [label, broken] of [
    ['no unresolvedOperations (adapters.ts:7)', (receipt) => { delete receipt.snapshot.unresolvedOperations; }],
    ['another operation\'s id (adapters.ts:7)', (receipt) => { receipt.operationId = crypto.randomUUID(); }],
    ['an unrelated valid snapshot (coverage, action-service.ts:103-115)', (receipt) => { receipt.snapshot.actions = []; }],
    ['another title (coverage)', (receipt) => { receipt.snapshot.actions = [{ ...action, title: 'Other' }]; }],
    ['a top-level data key (runtime.ts:149-153)', (receipt) => { receipt.data = null; }],
  ]) {
    const week = weekAnswering((id) => { const receipt = covering(id); broken(receipt); return [200, receipt]; });
    assert.equal(await add(week), false, label);
    assert.equal(week.unknownOperation, week.operationIds[0], `${label}: locked`);
  }
  // A receipt listing its own id saves, and then locks My Week on itself (trap T2, ExpandedPreviewState.tsx:63).
  const selfListed = weekAnswering((id) => { const receipt = covering(id); receipt.snapshot.unresolvedOperations = [id]; return [200, receipt]; });
  assert.equal(await add(selfListed), true);
  assert.deepEqual([selfListed.unknownOperation, selfListed.canMutate()], [selfListed.operationIds[0], false]);
  // The unwrap (runtime.ts:149-152): a receipt inside `data` is the receipt.
  const wrapped = weekAnswering((id) => [200, { data: { operationId: id, status: 'failed', message: 'Unwrapped.' } }]);
  assert.equal(await add(wrapped), false);
  assert.deepEqual([wrapped.error, wrapped.unknownOperation], ['Unwrapped.', '']);
  // The status mapping (runtime.ts:144) and the adapter's catch (adapters.ts:10).
  for (const [status, error, locked] of [[409, messages.conflict, false], [400, messages.validation, false], [500, NOT_CONFIRMED, true], [503, NOT_CONFIRMED, true]]) {
    const week = weekAnswering(() => [status, { code: 'x' }]);
    assert.equal(await add(week), false, String(status));
    assert.deepEqual([week.error, Boolean(week.unknownOperation)], [error, locked], String(status));
  }
  // The reconcile (ExpandedPreviewState.tsx:107-118).
  for (const [label, answer, expected] of [
    ['failed', { status: 'failed', reason: 'abandoned' }, ['No save was applied. Your draft is kept for review.', '', 1]],
    ['succeeded without the list', { status: 'succeeded', snapshot: { actions: [], metas: {} } }, ['Could not check this save. No new save was sent.', 'op', 0]],
    ['pending', { status: 'pending' }, ['The outcome is still unconfirmed. No new save was sent.', 'op', 0]],
  ]) {
    const week = myWeek(createActionAdapter({ request: async (_operation, sent) => ({ operationId: sent.operationId, ...answer }) }));
    week.unknownOperation = 'op';
    await week.reconcile();
    assert.deepEqual([week.error, week.unknownOperation, week.reloads], expected, label);
  }
  assert.equal(validActionSnapshot({ actions: [action], metas: {}, unresolvedOperations: ['a', 'a'] }), false);
  assert.equal(sameValue({ a: 1, b: [1] }, { b: [1], a: 1 }), true);
  assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), false);
});
