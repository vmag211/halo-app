/**
 * lib/actionsStore.js and the `tasks` capability flag (B06 plan, Task 3;
 * Rulings H1, H9, H16 and H17).
 *
 *   1. `tasks` is a registered capability, off unless HALO_FEATURE_TASKS is
 *      explicitly on, scrubbed from every route test, and its reason has no
 *      em dash.
 *   2. readActionsState calls the one read function with the owner's id only,
 *      keeps `version` for the commit route and never emits it, passes every
 *      stored value on unchanged, omits an empty `preferences`, and refuses a
 *      result that is not the function's shape rather than passing it on.
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

test('a household with no saved preference has no preferences key, so its body is the client\'s own fixture', async () => {
  const snapshot = await store.readActionsSnapshot(clientAnswering({ version: 0, actions: [], metas: {}, preferences: {} }), ALICE);
  assert.equal(JSON.stringify(snapshot), '{"actions":[],"metas":{}}');
  assert.deepEqual(store.emittedSnapshot({ actions: [], metas: {}, preferences: { outdoorPlan: {} } }).preferences, { outdoorPlan: {} },
    'a saved preference is emitted even when its value is empty');
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
