/**
 * lib/actionsStore.js and the `tasks` capability flag (B06 plan, Task 3;
 * Rulings H1, H9, H16, H17 and H24).
 *
 *   1. `tasks` is a registered capability, off unless HALO_FEATURE_TASKS is
 *      explicitly on, scrubbed from every route test, and its reason has no
 *      em dash.
 *   2. readActionsState calls the one read function with the owner's id only,
 *      keeps `version` for the commit route and never emits it, passes every
 *      stored value on unchanged, always emits `preferences` ({} when none is
 *      saved), and refuses a result that is not the function's shape rather
 *      than passing it on. snapshotProblems and snapshotProblemLine (H24) say
 *      what fails the client's load check by task id and code only.
 *   3. isActionsUnavailable and actionsUnavailable: the four "not applied yet"
 *      codes, and the non-retryable 503.
 *   4. unresolvedActionOperations: pending `actions` rows of this owner only,
 *      oldest first, the excluded ids left out before the cap of 100.
 *
 * The routes' behaviour is in routesActionsLoad.test.mjs; this file is the
 * library on its own, against the in-memory fake client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './helpers/routeLoader.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { SCRUBBED_ENV } from './helpers/sandbox.mjs';

const store = await import('../lib/actionsStore.js');
const { FEATURE_FLAGS, featureEnabled, featureDisabledReason } = await import('../lib/features.js');

const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const EM_DASH = String.fromCharCode(0x2014);
const opId = (n) => `5e5e5e5e-2222-4000-8000-${String(n).padStart(12, '0')}`;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

async function withEnv(env, work) {
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await work();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. The flag
// ---------------------------------------------------------------------------

test('tasks is a registered capability, off unless its variable is explicitly on (H1, H17)', async () => {
  assert.equal(FEATURE_FLAGS.tasks, 'HALO_FEATURE_TASKS');
  for (const value of [undefined, '', 'off', 'false', '0', '1', 'yes', 'enabled']) {
    await withEnv({ HALO_FEATURE_TASKS: value }, () => assert.equal(featureEnabled('tasks'), false, JSON.stringify(value)));
  }
  for (const value of ['on', 'true', 'On', 'TRUE', ' on ']) {
    await withEnv({ HALO_FEATURE_TASKS: value }, () => assert.equal(featureEnabled('tasks'), true, JSON.stringify(value)));
  }
  assert.ok(SCRUBBED_ENV.includes('HALO_FEATURE_TASKS'), 'a route test never inherits the capability from the shell');
  assert.equal(featureDisabledReason('tasks'), 'Saving tasks in My Week is not available yet. Nothing was saved.');
  assert.ok(!featureDisabledReason('tasks').includes(EM_DASH), 'no em dash in app-facing copy');
});

// ---------------------------------------------------------------------------
// 2. The snapshot read
// ---------------------------------------------------------------------------

const META = {
  // jsonb's own key order, deliberately not the client's: passed on as it is.
  archived: false, completedOn: '', duration: 30, estimateSet: true, history: ['Added'], note: 'Bring the kit',
  paused: false, recurrence: 'none', reminder: false, time: '', zone: 'America/New_York',
};
const ACTION = { id: '7a7a7a7a-0000-4000-8000-000000000001', key: 'home:water', title: 'Test the tap', reason: 'Due', origin: 'home', date: '', state: 'saved', revision: 3 };

/** A fake client whose read function answers `result` and records its arguments. */
function clientAnswering(result) {
  const db = createFakeSupabase({});
  db.registerRpc('read_household_actions', () => result, { args: ['p_profile_id'] });
  return db;
}

test('readActionsState calls the read function for the owner only and keeps the version internal (H9, H10)', async () => {
  const stored = { version: 7, actions: [ACTION], metas: { [ACTION.key]: META }, preferences: { 'week:focus': 'Water first' } };
  const db = clientAnswering(stored);
  const state = await store.readActionsState(db, ALICE);
  assert.deepEqual(db.rpcCalls, [{ name: 'read_household_actions', args: { p_profile_id: ALICE } }]);
  assert.equal(state.version, 7);
  assert.deepEqual(state.snapshot, { actions: [ACTION], metas: { [ACTION.key]: META }, preferences: { 'week:focus': 'Water first' } });
  assert.deepEqual(Object.keys(state.snapshot), ['actions', 'metas', 'preferences'], 'no version in what is emitted');
  assert.deepEqual(Object.keys(state.snapshot.metas[ACTION.key]), Object.keys(META), 'stored key order is passed on, nothing re-ordered or defaulted');

  const snapshot = await store.readActionsSnapshot(clientAnswering(stored), ALICE);
  assert.deepEqual(snapshot, state.snapshot);
  assert.ok(!('version' in snapshot));
});

test('a household with no saved preference gets preferences: {}, the plan\'s empty shape (Task 3 acceptance)', async () => {
  const snapshot = await store.readActionsSnapshot(clientAnswering({ version: 0, actions: [], metas: {}, preferences: {} }), ALICE);
  assert.equal(JSON.stringify(snapshot), '{"actions":[],"metas":{},"preferences":{}}');
  assert.deepEqual(Object.keys(store.emittedSnapshot({ version: 3, actions: [], metas: {}, preferences: {}, extra: 1 })), ['actions', 'metas', 'preferences'],
    'always exactly these three keys, in this order, whatever else the read carried');
});

// ---------------------------------------------------------------------------
// 2b. H24: what is wrong with a snapshot, without its content
// ---------------------------------------------------------------------------

const TITLE_MARKER = 'PRIVATE-TITLE-MARKER';
const NOTE_MARKER = 'PRIVATE-NOTE-MARKER';
const KEY_MARKER = 'PRIVATE-KEY-MARKER';
const goodAction = (n, extra = {}) => ({ id: `7a7a7a7a-0000-4000-8000-00000000000${n}`, key: `${KEY_MARKER}:${n}`, title: `${TITLE_MARKER} ${n}`, reason: '', origin: '', date: '2026-10-20', state: 'saved', revision: 1, ...extra });
const goodMeta = { ...META, note: NOTE_MARKER };

test('snapshotProblems is empty for a snapshot the client loads', () => {
  const snapshot = { actions: [goodAction(1)], metas: { [goodAction(1).key]: goodMeta }, preferences: { 'week:focus': 'x' }, unresolvedOperations: [] };
  assert.deepEqual(store.snapshotProblems(snapshot), []);
  assert.equal(store.snapshotProblemLine(snapshot, 'req-1'), null);
});

test('snapshotProblems names each failing row by id and a code, and never its content (H24)', () => {
  const dst = goodAction(1, { date: '2026-03-08' });
  const badTitle = goodAction(2, { title: ' ' });
  const fine = goodAction(3);
  const snapshot = {
    actions: [dst, badTitle, fine, { ...fine }],
    metas: { [dst.key]: { ...goodMeta, time: '02:30' }, [`${KEY_MARKER}:orphan`]: goodMeta },
    preferences: { 'week:focus': 'ok', 'week:review-preferences': { enabled: true, weekday: 1, time: '09:00', zone: 'Mars/Olympus_Mons' } },
    unresolvedOperations: Array.from({ length: 101 }, (_, i) => opId(i)),
  };
  assert.deepEqual(store.snapshotProblems(snapshot), [
    { code: 'invalid_meta', id: dst.id, check: 'time' },
    { code: 'invalid_action', id: badTitle.id, check: 'title' },
    { code: 'duplicate_action', id: fine.id },
    { code: 'orphan_meta' },
    { code: 'invalid_preference', preferences: ['week:review-preferences'] },
    { code: 'invalid_unresolved' },
  ]);
  const line = store.snapshotProblemLine(snapshot, 'req-2');
  assert.match(line, /request req-2, 6 finding\(s\)/);
  assert.match(line, new RegExp(`invalid_meta ${dst.id} time; invalid_action ${badTitle.id} title; duplicate_action ${fine.id}; orphan_meta; invalid_preference week:review-preferences; invalid_unresolved$`));
  for (const marker of [TITLE_MARKER, NOTE_MARKER, KEY_MARKER, 'Mars', '02:30', '2026-03-08']) {
    assert.ok(!line.includes(marker), `${marker} is not logged`);
  }
  assert.ok(!line.includes(EM_DASH));
});

test('snapshotProblems never reports a preference name that is not one of the six, and caps the line at 20 findings', () => {
  const odd = store.snapshotProblems({ actions: [], metas: {}, preferences: { [`${KEY_MARKER} typed`]: 1 } });
  assert.deepEqual(odd, [{ code: 'invalid_preference', preferences: [] }]);
  assert.ok(!store.snapshotProblemLine({ actions: [], metas: {}, preferences: { [`${KEY_MARKER} typed`]: 1 } }, 'r').includes(KEY_MARKER));
  const many = Array.from({ length: 25 }, (_, i) => ({ ...goodAction(1), id: `7a7a7a7a-0000-4000-8000-${String(100 + i).padStart(12, '0')}`, key: `k${i}`, state: 'cancelled' }));
  const line = store.snapshotProblemLine({ actions: many, metas: {} }, 'r');
  assert.match(line, /25 finding\(s\)/);
  assert.equal(line.split('; ').length, 20);
  assert.deepEqual(store.snapshotProblems(null), [{ code: 'invalid_snapshot' }]);
});

test('readActionsState refuses a result that is not the read function\'s shape', async () => {
  const good = { version: 0, actions: [], metas: {}, preferences: {} };
  for (const [label, result] of [
    ['null', null],
    ['an array', []],
    ['no version', { ...good, version: undefined }],
    ['a negative version', { ...good, version: -1 }],
    ['a fractional version', { ...good, version: 1.5 }],
    ['a string version', { ...good, version: '1' }],
    ['actions not an array', { ...good, actions: {} }],
    ['metas an array', { ...good, metas: [] }],
    ['metas null', { ...good, metas: null }],
    ['preferences null', { ...good, preferences: null }],
    ['preferences an array', { ...good, preferences: [] }],
  ]) {
    await assert.rejects(store.readActionsState(clientAnswering(result), ALICE), /unexpected shape/, label);
  }
  await assert.rejects(store.readActionsState(clientAnswering(good), null), /requires an owner/);
});

test('a read function error is passed on as it came, so the route can read its code', async () => {
  const db = createFakeSupabase({});
  await assert.rejects(store.readActionsState(db, ALICE), (error) => error.code === 'PGRST202');
});

// ---------------------------------------------------------------------------
// 3. Unavailable
// ---------------------------------------------------------------------------

test('the four "not applied yet" codes, and nothing else, are unavailable; the answer is a non-retryable 503', async () => {
  for (const code of ['PGRST202', '42883', 'PGRST205', '42P01']) assert.equal(store.isActionsUnavailable({ code }), true, code);
  for (const error of [null, undefined, {}, { code: 'P0001' }, { code: '23505' }, { code: 'PGRST116' }, new Error('nope')]) {
    assert.equal(store.isActionsUnavailable(error), false, JSON.stringify(error));
  }
  const response = store.actionsUnavailable('11111111-2222-4333-8444-555555555555');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal(body.retryable, false);
  assert.ok(!body.message.includes(EM_DASH));
  assert.ok(!('data' in body));
});

// ---------------------------------------------------------------------------
// 4. Unresolved operations
// ---------------------------------------------------------------------------

function ledger(rows) {
  return createFakeSupabase({
    tables: haloTables('profiles', 'operations'),
    seed: {
      profiles: [{ id: ALICE }, { id: BOB }],
      operations: rows.map((row) => ({ domain: 'actions', kind: 'actions.commit', status: 'pending', request_hash: 'h', result: null, created_at: ago(1_000), profile_id: ALICE, ...row })),
    },
  });
}

test('only this household\'s pending actions operations are listed, oldest first (H16)', async () => {
  const db = ledger([
    { operation_id: opId(2), created_at: ago(2_000) },
    { operation_id: opId(1), created_at: ago(3_000) },
    { operation_id: opId(3), status: 'succeeded', result: { status: 'succeeded' } },
    { operation_id: opId(4), domain: 'week-updates', kind: 'week.acknowledge' },
    { operation_id: opId(5), profile_id: BOB },
  ]);
  assert.deepEqual(await store.unresolvedActionOperations(db, ALICE), [opId(1), opId(2)]);
  for (const entry of db.queryLog.filter((item) => item.table === 'operations')) {
    assert.ok(entry.filters.some((f) => f.column === 'profile_id' && f.op === 'eq' && f.value === ALICE), `${entry.operation} is owner scoped`);
  }
});

test('excluded ids are left out before the cap, so the list is still the 100 oldest others (T2, T8)', async () => {
  const rows = Array.from({ length: 102 }, (_, i) => ({ operation_id: opId(i + 1), created_at: new Date(Date.now() - 60_000 + i * 100).toISOString() }));
  const db = ledger([...rows].reverse());
  const all = await store.unresolvedActionOperations(db, ALICE);
  assert.deepEqual(all, rows.slice(0, 100).map((row) => row.operation_id), 'at most 100, oldest first');
  const without = await store.unresolvedActionOperations(db, ALICE, { exclude: [opId(1)] });
  assert.deepEqual(without, rows.slice(1, 101).map((row) => row.operation_id), 'the excluded id never costs another its place');
  assert.deepEqual(await store.unresolvedActionOperations(ledger([{ operation_id: opId(9) }]), ALICE, { exclude: opId(9) }), [], 'one id may be given bare');
  assert.equal(store.MAX_UNRESOLVED, 100);
});

test('without the ledger table the list fails as unavailable, never as an empty list', async () => {
  const db = createFakeSupabase({});
  await assert.rejects(store.unresolvedActionOperations(db, ALICE), (error) => store.isActionsUnavailable(error));
});

// ---------------------------------------------------------------------------
// 5. H31: the code of the client's own sentence, in the H24 line
// ---------------------------------------------------------------------------

test('H31: an invalid task or meta is logged with the code of the client\'s own fixed sentence, never a value', () => {
  const rows = [
    ['time', goodAction(1, { date: '2026-03-08' }), { ...goodMeta, time: '02:30' }],
    ['zone', goodAction(2), { ...goodMeta, zone: 'Mars/Olympus_Mons' }],
    ['duration', goodAction(3), { ...goodMeta, duration: 5 }],
    ['schedule', goodAction(4), { ...goodMeta, paused: 'no' }],
    ['details', goodAction(5), { ...goodMeta, history: [1] }],
    ['recurrence', goodAction(6, { date: '' }), { ...goodMeta, recurrence: 'weekly' }],
    ['completion', goodAction(7), { ...goodMeta, completedOn: '2026-02-30' }],
  ];
  const snapshot = { actions: rows.map(([, action]) => action), metas: Object.fromEntries(rows.map(([, action, meta]) => [action.key, meta])) };
  assert.deepEqual(store.snapshotProblems(snapshot), rows.map(([check, action]) => ({ code: 'invalid_meta', id: action.id, check })));
  const actions = [
    ['title', goodAction(1, { title: ' ' })],
    ['date', goodAction(2, { date: '2026-02-30' })],
    ['record', goodAction(3, { state: 'cancelled' })],
    ['record', goodAction(4, { revision: 0 })],
  ];
  assert.deepEqual(store.snapshotProblems({ actions: actions.map(([, action]) => action), metas: {} }),
    actions.map(([check, action]) => ({ code: 'invalid_action', id: action.id, check })));
  const line = store.snapshotProblemLine(snapshot, 'req-h31');
  assert.ok(line.endsWith(rows.map(([check, action]) => `invalid_meta ${action.id} ${check}`).join('; ')), line);
  for (const marker of [TITLE_MARKER, NOTE_MARKER, KEY_MARKER, 'Mars', '02:30', '2026-03-08', 'clock-change', 'timezone']) {
    assert.ok(!line.includes(marker), `${marker} is not logged`);
  }
});

test('H31: every sentence the transcribed client checks can return has a code, and the codes round-trip', () => {
  const source = readFileSync(new URL('../lib/actionRules.js', import.meta.url), 'utf8');
  const body = (name) => {
    const start = source.indexOf(`export function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n}\n', start));
  };
  const sentences = [...`${body('actionDraftError')}${body('actionMetadataError')}`.matchAll(/return '([^']+)'/g)].map((match) => match[1]);
  assert.equal(sentences.length, 9, 'two from actionDraftError, seven from actionMetadataError');
  const codes = sentences.map((sentence) => store.actionCheckCode(sentence));
  assert.ok(codes.every(Boolean), `every sentence is mapped: ${JSON.stringify(sentences.filter((s) => !store.actionCheckCode(s)))}`);
  assert.equal(new Set(codes).size, codes.length, 'one code per sentence');
  for (const [i, code] of codes.entries()) assert.equal(store.actionCheckMessage(code), sentences[i]);
  for (const other of [null, undefined, '', 'record', 'This change would leave My Week unable to load. Nothing was saved.', TITLE_MARKER]) {
    assert.equal(store.actionCheckCode(other), null, String(other));
  }
  assert.equal(store.actionCheckMessage('record'), null);
  assert.equal(store.actionCheckMessage('__proto__'), null);
  for (const sentence of sentences) assert.ok(!sentence.includes(EM_DASH));
});

// ---------------------------------------------------------------------------
// 6. Task 4: the commit function, its refusals, the live snapshot
// ---------------------------------------------------------------------------

const OP_ID = '5e5e5e5e-3333-4000-8000-000000000001';
const WRITES = { inserts: [], updates: [], metas: [], deletes: [], preferences: { 'week:focus': 'x' } };

function committing(result) {
  const db = createFakeSupabase({});
  db.registerRpc('commit_household_actions', () => result, { args: ['p_profile_id', 'p_operation_id', 'p_base_version', 'p_writes'] });
  return db;
}

test('commitActions calls the commit function with the owner, the operation, the base version and the writes, and keeps the version internal', async () => {
  const snapshot = { version: 8, actions: [ACTION], metas: { [ACTION.key]: META }, preferences: { 'week:focus': 'x' } };
  const receipt = { status: 'succeeded', affected: [{ id: ACTION.id, revision: 3 }], removed: [] };
  const db = committing({ receipt, snapshot });
  const committed = await store.commitActions(db, { profileId: ALICE, operationId: OP_ID, baseVersion: 7, writes: WRITES });
  assert.deepEqual(db.rpcCalls, [{ name: 'commit_household_actions', args: { p_profile_id: ALICE, p_operation_id: OP_ID, p_base_version: 7, p_writes: WRITES } }]);
  assert.deepEqual(committed.receipt, receipt);
  assert.deepEqual(committed.snapshot, { actions: [ACTION], metas: { [ACTION.key]: META }, preferences: { 'week:focus': 'x' } });
  assert.ok(!('version' in committed.snapshot));
  await assert.rejects(store.commitActions(db, { profileId: null, operationId: OP_ID, baseVersion: 0, writes: WRITES }), /requires an owner/);
});

test('commitActions refuses a result that is not the function\'s shape, and passes an error on as it came', async () => {
  const snapshot = { version: 1, actions: [], metas: {}, preferences: {} };
  const receipt = { status: 'succeeded', affected: [], removed: [] };
  for (const [label, result] of [
    ['null', null],
    ['no receipt', { snapshot }],
    ['a failed receipt', { receipt: { ...receipt, status: 'failed' }, snapshot }],
    ['affected not a list', { receipt: { ...receipt, affected: {} }, snapshot }],
    ['a revision of 0', { receipt: { ...receipt, affected: [{ id: 'a', revision: 0 }] }, snapshot }],
    ['removed not ids', { receipt: { ...receipt, removed: [1] }, snapshot }],
    ['no snapshot', { receipt }],
    ['metas an array', { receipt, snapshot: { ...snapshot, metas: [] } }],
    ['preferences missing', { receipt, snapshot: { ...snapshot, preferences: undefined } }],
  ]) {
    await assert.rejects(store.commitActions(committing(result), { profileId: ALICE, operationId: OP_ID, baseVersion: 0, writes: WRITES }), /unexpected shape/, label);
  }
  await assert.rejects(store.commitActions(createFakeSupabase({}), { profileId: ALICE, operationId: OP_ID, baseVersion: 0, writes: WRITES }),
    (error) => store.isActionsUnavailable(error));
});

test('actionsRefusal reads a HALO_* code only when it is the whole P0001 message', () => {
  for (const code of Object.values(store.ACTIONS_REFUSALS)) assert.equal(store.actionsRefusal({ code: 'P0001', message: code }), code);
  for (const error of [null, {}, { code: 'P0001' }, { code: 'P0001', message: 'see HALO_STALE_BASE' }, { code: '23514', message: 'HALO_STALE_BASE' }, new Error('HALO_STALE_BASE')]) {
    assert.equal(store.actionsRefusal(error), null, JSON.stringify(error));
  }
});

test('liveActionsSnapshot is the current snapshot with the live list, the answered operation left out, the list read first (H18, T2)', async () => {
  const db = ledger([
    { operation_id: opId(1), created_at: ago(3_000) },
    { operation_id: opId(2), created_at: ago(2_000) },
  ]);
  let statementsBeforeRead = null;
  db.registerRpc('read_household_actions', () => {
    statementsBeforeRead = db.queryLog.length;
    return { version: 2, actions: [ACTION], metas: {}, preferences: {} };
  }, { args: ['p_profile_id'] });
  const live = await store.liveActionsSnapshot(db, ALICE, opId(1));
  assert.deepEqual(live, { actions: [ACTION], metas: {}, preferences: {}, unresolvedOperations: [opId(2)] });
  assert.deepEqual(Object.keys(live), ['actions', 'metas', 'preferences', 'unresolvedOperations']);
  assert.equal(statementsBeforeRead, db.queryLog.length, 'every ledger statement ran before the snapshot was read');
  assert.ok(statementsBeforeRead > 0);
});
