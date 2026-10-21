/**
 * GET /api/frontend/actions, registry `actions.load` (B06 plan, Task 3).
 *
 * Rulings H1, H2, H9, H16, H17 and H24 of
 * docs/backend/plans/b06-home-actions-week.md: the household's tasks as one
 * snapshot from the read function of migration 0023, plus its unsettled
 * `actions` operations, behind the `tasks` capability flag, which is off by
 * default and stays off until a retention period for tasks is approved.
 *
 * THE CLIENT'S OWN CONSUMPTION LOGIC IS RUN, not only a shape check. A
 * validator-only test missed the Luna empty-state bug, because the body was
 * right and the client still did the wrong thing with it. So the last part of
 * this file drives the real handler through a transcription of what My Week
 * does with the answer, and asserts the client's resulting STATE:
 *
 *   - `runtime.request` (lib/frontend/production/runtime.ts:29 for the
 *     registry entry, :105-158 for the request and the response handling,
 *     including the status mapping at :144 and the envelope unwrap at
 *     :147-153), and its copy table (:91-97);
 *   - the production adapter's `load` (lib/frontend/production/adapters.ts:9),
 *     which refuses a snapshot without the `unresolvedOperations` array;
 *   - `validActionSnapshot` (lib/frontend/production/action-service.ts:86-99)
 *     with `actionMetadataError` (:27-36), `object`, `text`, `validZone` and
 *     `validActionPreferences` (:38-53), `validActionDate` and
 *     `actionDraftError` (lib/frontend/expanded-preview.ts:30-40),
 *     `emptyWeekMeta` and `eventInstant` (lib/frontend/week-preview.ts:4, :11-16);
 *   - the screen: `ExpandedPreviewProvider`'s `commitSnapshot`
 *     (components/expanded/ExpandedPreviewState.tsx:60-68), the load effect
 *     (:69-80), and the first guard of `mutate` (:82), which decides whether
 *     the person can add a task at all.
 *
 * All of it is transcribed from `origin/codex/october15-review-refinement`
 * (5ac06f6) with `git show`, types stripped and nothing improved. React state
 * becomes plain fields. A transcription that always agreed would prove
 * nothing, so `the transcription rejects what the client rejects` shows it
 * refusing.
 *
 * Two databases. Most cases use the in-memory fake with a stand-in for
 * read_household_actions that builds the same `{version, actions, metas,
 * preferences}` from the fake's tables, scoped to the id it is given. The last
 * cases call the REAL function of migration 0023 on PGlite
 * (test/db/pgliteHarness.mjs), as homeContextRoutesDb.test.mjs does: there
 * the other household's rows really are in the same table, and the
 * function's own scoping is what keeps them out.
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * database, and a fetch that throws on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';

const ROUTE = '/api/frontend/actions';
const ON = { HALO_FEATURE_TASKS: 'on' };

// The route harness's ids for alice and bob.
const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';

const OP = '5e5e5e5e-0000-4000-8000-000000000001';
const OP2 = '5e5e5e5e-0000-4000-8000-000000000002';
const BOB_OP = '5e5e5e5e-0000-4000-8000-0000000000b0';
const FOREIGN_HOME = '11111111-1111-4111-8111-111111111111';
/** The plan's empty shape (Task 3 acceptance), built by emittedSnapshot like every B06 snapshot. */
const EMPTY_BODY = '{"actions":[],"metas":{},"preferences":{},"unresolvedOperations":[]}';

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const opId = (n) => `5e5e5e5e-1111-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * U+2014, built from its code point so this file carries no em dash of its
 * own (AGENTS.md).
 */
const EM_DASH = String.fromCharCode(0x2014);

const TABLES = haloTables('profiles', 'operations', 'household_actions', 'household_action_preferences', 'household_action_state');

const NOTE = 'PRIVATE-NOTE-MARKER the inhaler is in the blue bag';
/** A meta whose key order is not the client's, with an extra key (`estimateSet`): passed on exactly. */
const META = {
  time: '', zone: 'America/New_York', paused: false, history: ['Added from the week plan'],
  archived: false, duration: 30, reminder: false, recurrence: 'none', completedOn: '', estimateSet: true, note: NOTE,
};

/** Stored task rows, as the 0023 columns hold them. */
const aliceTasks = () => [
  { id: '7a7a7a7a-0000-4000-8000-000000000001', profile_id: ALICE, action_key: 'home:water', title: 'Test the kitchen tap', reason: 'Due this week', origin: 'home', due_date: '2026-10-20', state: 'saved', revision: 2, meta: META, created_at: '2026-10-01T10:00:00.000Z' },
  { id: '7a7a7a7a-0000-4000-8000-000000000002', profile_id: ALICE, action_key: 'outdoor:walk', title: 'Walk by the creek', reason: '', origin: 'outdoors', due_date: null, state: 'waiting', revision: 1, meta: null, created_at: '2026-10-02T10:00:00.000Z' },
];
const bobTasks = () => [
  { id: '7a7a7a7a-0000-4000-8000-0000000000b1', profile_id: BOB, action_key: 'home:radon', title: 'BOB-PRIVATE-TITLE', reason: 'BOB-PRIVATE-REASON', origin: 'home', due_date: '2026-11-01', state: 'completed', revision: 4, meta: { ...META, note: 'BOB-PRIVATE-NOTE' }, created_at: '2026-09-01T10:00:00.000Z' },
];
const alicePrefs = () => [
  { profile_id: ALICE, pref_key: 'week:focus', value: 'Water first this week' },
  { profile_id: ALICE, pref_key: 'food-interests', value: ['fish', 'water'] },
];
const bobPrefs = () => [{ profile_id: BOB, pref_key: 'week:focus', value: 'BOB-PRIVATE-FOCUS' }];

/** What alice's snapshot must be, built by hand from the rows above (H9's object shape). */
const ALICE_SNAPSHOT = {
  actions: [
    { id: '7a7a7a7a-0000-4000-8000-000000000001', key: 'home:water', title: 'Test the kitchen tap', reason: 'Due this week', origin: 'home', date: '2026-10-20', state: 'saved', revision: 2 },
    { id: '7a7a7a7a-0000-4000-8000-000000000002', key: 'outdoor:walk', title: 'Walk by the creek', reason: '', origin: 'outdoors', date: '', state: 'waiting', revision: 1 },
  ],
  metas: { 'home:water': META },
  preferences: { 'week:focus': 'Water first this week', 'food-interests': ['fish', 'water'] },
};

/**
 * The fake's stand-in for public.read_household_actions (0023 section 2):
 * the same object, built from the fake's tables for the one id it is given.
 * `readAt` records how many table statements the route had made when it
 * called, so the order of the two reads can be checked.
 */
function registerReadActions(h) {
  const readAt = [];
  h.db.registerRpc('read_household_actions', (args, db) => {
    readAt.push(db.queryLog.length);
    const owner = args.p_profile_id;
    const rows = db.rows('household_actions')
      .filter((row) => row.profile_id === owner)
      .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : (a.created_at < b.created_at ? -1 : 1)));
    const state = db.rows('household_action_state').find((row) => row.profile_id === owner);
    return {
      version: state?.version ?? 0,
      actions: rows.map((row) => ({
        id: row.id, key: row.action_key, title: row.title, reason: row.reason, origin: row.origin,
        date: row.due_date ?? '', state: row.state, revision: row.revision,
      })),
      metas: Object.fromEntries(rows.filter((row) => row.meta !== null && row.meta !== undefined).map((row) => [row.action_key, row.meta])),
      preferences: Object.fromEntries(db.rows('household_action_preferences').filter((row) => row.profile_id === owner).map((row) => [row.pref_key, row.value])),
    };
  }, { args: ['p_profile_id'] });
  return readAt;
}

/**
 * A harness with the flag on (unless `env` says otherwise) and the read
 * function registered (unless `withFunction` is false, which is 0023 missing).
 */
function harness({ operations = [], tasks = [], prefs = [], state = [], tables = TABLES, env = ON, withFunction = true } = {}) {
  const has = (name) => name in tables;
  const h = createRouteHarness({
    tables,
    env,
    seed: ({ alice, bob }) => {
      assert.deepEqual([alice.id, bob.id], [ALICE, BOB]);
      return {
        profiles: [{ id: ALICE }, { id: BOB }],
        ...(has('operations') ? { operations: operations.map((row) => ({ ...row, profile_id: row.profile_id === 'bob' ? BOB : ALICE })) } : {}),
        ...(has('household_actions') ? { household_actions: tasks, household_action_preferences: prefs, household_action_state: state } : {}),
      };
    },
  });
  h.readAt = withFunction ? registerReadActions(h) : [];
  return h;
}

const load = (h, who = 'alice', { url = ROUTE, headers = {}, env } = {}) => h.call(ROUTE, 'GET', { as: who, url, headers, env });

/** An `actions` ledger row for alice. */
const actionsRow = (overrides = {}) => ({
  operation_id: OP,
  profile_id: 'alice',
  domain: 'actions',
  kind: 'actions.commit',
  status: 'pending',
  request_hash: 'hash',
  result: null,
  created_at: ago(1_000),
  ...overrides,
});

const tablesTouched = (h) => [...new Set(h.db.queryLog.map((entry) => entry.table))].sort();

/** Every ledger statement is scoped to the caller on the query itself (the reaper and the list). */
function assertLedgerScoped(h, callerId, label) {
  for (const entry of h.db.queryLog.filter((item) => item.table === 'operations')) {
    assert.ok(
      entry.filters.some((f) => f.type === 'cmp' && f.op === 'eq' && f.column === 'profile_id' && f.value === callerId),
      `${label}: ${entry.operation} on operations is not scoped to the caller`,
    );
  }
}

const withoutRequestId = (body) => Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'request_id'));

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

test('a new household gets exactly the plan\'s empty body, 200, with nothing but the ledger and the function touched (T1, T7)', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  const response = await load(h);
  assert.equal(response.status, 200, 'never a 404 for a household with nothing (T7)');
  assert.equal(await response.text(), EMPTY_BODY);
  assert.equal(logged.mock.calls.length, 0, 'a valid snapshot logs nothing');
  assert.deepEqual(tablesTouched(h), ['operations'], 'no task table is selected directly: tasks come only from the read function (H9)');
  assert.deepEqual(h.db.rpcCalls, [{ name: 'read_household_actions', args: { p_profile_id: ALICE } }]);
  assert.deepEqual(h.blockedFetches, [], 'no outbound call');
  assertLedgerScoped(h, ALICE, 'GET');
});

test('a household with tasks gets its snapshot exactly as stored, with no version and no data key (H9, T4)', async () => {
  const h = harness({ tasks: [...aliceTasks(), ...bobTasks()], prefs: [...alicePrefs(), ...bobPrefs()], state: [{ profile_id: ALICE, version: 5 }, { profile_id: BOB, version: 9 }] });
  const response = await load(h);
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.deepEqual(body, { ...ALICE_SNAPSHOT, unresolvedOperations: [] });
  assert.deepEqual(Object.keys(body), ['actions', 'metas', 'preferences', 'unresolvedOperations']);
  assert.deepEqual(Object.keys(body.metas['home:water']), Object.keys(META), 'the stored meta, key order included, is passed on untouched');
  assert.ok(!('version' in body) && !('data' in body));
  for (const marker of ['BOB-PRIVATE', '"version"']) assert.ok(!text.includes(marker), `${marker} is not in alice's answer`);
});

test('the read is never a 404 and never a 500 for any household state (T7)', async () => {
  const states = [
    ['tasks only', { tasks: aliceTasks() }],
    ['preferences only', { prefs: alicePrefs() }],
    ['a version with no tasks left', { state: [{ profile_id: ALICE, version: 3 }] }],
    ['only another household has tasks', { tasks: bobTasks(), prefs: bobPrefs() }],
    ['a pending operation and nothing else', { operations: [actionsRow()] }],
  ];
  for (const [label, seed] of states) {
    const response = await load(harness(seed));
    assert.equal(response.status, 200, label);
    const body = await response.json();
    assert.ok(Array.isArray(body.unresolvedOperations), `${label}: the list is always there (T1)`);
  }
});

test('a pending actions row is listed; a settled one, a week-updates one and another household\'s are not (H16)', async () => {
  const h = harness({
    operations: [
      actionsRow({ operation_id: OP }),
      actionsRow({ operation_id: OP2, status: 'succeeded', result: { status: 'succeeded', affected: [], removed: [] } }),
      actionsRow({ operation_id: opId(1), status: 'failed', result: { status: 'failed', reason: 'stale_revision' } }),
      actionsRow({ operation_id: opId(2), domain: 'week-updates', kind: 'week.acknowledge' }),
      actionsRow({ operation_id: opId(3), domain: 'account', kind: 'account.command' }),
      actionsRow({ operation_id: BOB_OP, profile_id: 'bob' }),
    ],
  });
  const body = await (await load(h)).json();
  assert.deepEqual(body.unresolvedOperations, [OP]);
  assertLedgerScoped(h, ALICE, 'GET with rows');
  const bobs = await (await load(h, 'bob')).json();
  assert.deepEqual(bobs.unresolvedOperations, [BOB_OP], 'bob still sees his own');
});

test('the list is the 100 oldest unresolved ids, because 101 would fail the client (T8)', async () => {
  const rows = Array.from({ length: 101 }, (_, i) =>
    actionsRow({ operation_id: opId(i + 1), created_at: new Date(Date.now() - 60_000 + i * 100).toISOString() }));
  const h = harness({ operations: [...rows].reverse() });
  const body = await (await load(h)).json();
  assert.equal(body.unresolvedOperations.length, 100);
  assert.deepEqual(body.unresolvedOperations, rows.slice(0, 100).map((row) => row.operation_id), 'oldest first');
});

test('a dead save is reaped and not listed, so it cannot lock My Week for ever (the reaper is merged)', async () => {
  const h = harness({ operations: [actionsRow({ created_at: ago(10 * 60 * 1000) })] });
  const body = await (await load(h)).json();
  assert.deepEqual(body.unresolvedOperations, []);
  const row = h.db.rows('operations').find((item) => item.operation_id === OP);
  assert.equal(row.status, 'failed');
  assert.deepEqual(row.result, { status: 'failed', reason: 'abandoned' });
});

test('the ledger is read before the snapshot, so a save missing from the list is already in the snapshot (H8)', async () => {
  const h = harness({ operations: [actionsRow()], tasks: aliceTasks() });
  await load(h);
  assert.equal(h.readAt.length, 1);
  const before = h.db.queryLog.slice(0, h.readAt[0]);
  assert.ok(before.some((entry) => entry.table === 'operations' && entry.operation === 'select'), 'the list was read first');
  assert.equal(h.db.queryLog.length, h.readAt[0], 'no statement follows the snapshot read');
});

test('identity is the token: a query or a home-context header naming another household changes nothing (H2)', async () => {
  const h = harness({ tasks: [...aliceTasks(), ...bobTasks()], prefs: [...alicePrefs(), ...bobPrefs()], operations: [actionsRow({ operation_id: BOB_OP, profile_id: 'bob' })] });
  const plain = await (await load(h)).text();
  const smuggled = await (await load(h, 'alice', {
    url: `${ROUTE}?profileId=${BOB}&profile_id=${BOB}&p_profile_id=${BOB}`,
    headers: { 'x-halo-home-context': FOREIGN_HOME },
  })).text();
  assert.equal(smuggled, plain);
  assert.deepEqual(JSON.parse(plain), { ...ALICE_SNAPSHOT, unresolvedOperations: [] });
  for (const call of h.db.rpcCalls) assert.deepEqual(call.args, { p_profile_id: ALICE }, 'the function is only ever asked for the caller');
  assertLedgerScoped(h, ALICE, 'smuggled');
});

test('the read needs a session, and nothing is read without one, whether the flag is on or off', async () => {
  for (const env of [ON, {}]) {
    const h = harness({ env });
    const response = await h.call(ROUTE, 'GET', {});
    await expectEnvelope(response, { status: 401, code: 'auth_required' });
    assert.deepEqual(h.db.queryLog, [], 'no statement before the session is checked');
    assert.deepEqual(h.db.rpcCalls, []);
  }
});

// ---------------------------------------------------------------------------
// The flag (H1, H17)
// ---------------------------------------------------------------------------

test('flag off: a non-retryable 503 with no read, no reap and no function call, for every household (H17)', async () => {
  for (const value of [undefined, '', 'off', 'false', '1', 'yes']) {
    const h = harness({
      env: value === undefined ? {} : { HALO_FEATURE_TASKS: value },
      tasks: [...aliceTasks(), ...bobTasks()],
      prefs: alicePrefs(),
      operations: [actionsRow(), actionsRow({ operation_id: opId(1), created_at: ago(10 * 60 * 1000) })],
    });
    const label = `HALO_FEATURE_TASKS=${JSON.stringify(value)}`;
    const alice = await expectEnvelope(await load(h), { status: 503, code: 'feature_unavailable', retryable: false });
    const bob = await expectEnvelope(await load(h, 'bob'), { status: 503, code: 'feature_unavailable', retryable: false });
    assert.deepEqual(h.db.queryLog, [], `${label}: no table statement at all`);
    assert.deepEqual(h.db.rpcCalls, [], `${label}: the read function is not called`);
    assert.equal(h.db.rows('operations').find((row) => row.operation_id === opId(1)).status, 'pending', `${label}: nothing is reaped`);
    assert.deepEqual(withoutRequestId(alice), withoutRequestId(bob), `${label}: nothing about either household is disclosed`);
    assert.ok(!('actions' in alice) && !('unresolvedOperations' in alice) && !('data' in alice));
    assert.ok(!JSON.stringify(alice).includes(EM_DASH));
  }
});

test('flag off says nothing about whether 0023 is applied: the same answer as the migration missing', async () => {
  const off = await expectEnvelope(await load(harness({ env: {} })), { status: 503, code: 'feature_unavailable' });
  const missing = await expectEnvelope(await load(harness({ withFunction: false })), { status: 503, code: 'feature_unavailable' });
  assert.deepEqual(withoutRequestId(off), withoutRequestId(missing));
});

// ---------------------------------------------------------------------------
// Before the migrations
// ---------------------------------------------------------------------------

test('without migration 0023 the read is unavailable, never an invented empty week and never a 500', async () => {
  const h = harness({ withFunction: false, tables: haloTables('profiles', 'operations') });
  const body = await expectEnvelope(await load(h), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!('actions' in body) && !('data' in body));
  assert.equal(h.db.rpcCalls.length, 1, 'the function was asked for and was not there');
  assert.ok(!JSON.stringify(body).includes(EM_DASH));
  // Postgres's own "no such function" and "no such table" codes say the same.
  for (const code of ['42883', '42P01', 'PGRST205']) {
    const other = harness({ withFunction: false });
    other.db.registerRpc('read_household_actions', () => { throw rpcError(code, 'missing'); }, { args: ['p_profile_id'] });
    await expectEnvelope(await load(other), { status: 503, code: 'feature_unavailable', retryable: false });
  }
});

test('without migration 0017 the read is unavailable before the snapshot is read', async () => {
  const h = harness({ tables: haloTables('profiles', 'household_actions', 'household_action_preferences', 'household_action_state') });
  await expectEnvelope(await load(h), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.deepEqual(h.db.rpcCalls, [], 'no snapshot is read when its lock cannot be');
});

test('any other failure is a 500 whose log line carries the code and message, never the function\'s detail', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  h.db.registerRpc('read_household_actions', () => { throw rpcError('XX000', 'boom', `DETAIL ${NOTE}`, `HINT ${NOTE}`); }, { args: ['p_profile_id'] });
  const body = await expectEnvelope(await load(h), { status: 500, code: 'internal_error' });
  const text = loggedText(logged);
  assert.match(text, /actions load failed/);
  assert.match(text, /XX000 boom/);
  assert.ok(!text.includes('PRIVATE-NOTE-MARKER'), 'no task text reaches the log');
  assert.ok(!JSON.stringify(body).includes('PRIVATE-NOTE-MARKER'));
});

// ---------------------------------------------------------------------------
// H24, transport, copy
// ---------------------------------------------------------------------------

test('a stored row the client would refuse is returned unchanged, never hidden, and logged by id and code only (H24)', async (t) => {
  const logged = muteConsoleError(t);
  const TITLE_MARKER = 'PRIVATE-TITLE-MARKER Retest the tap';
  const PLACE_MARKER = 'PRIVATE-PLACE-MARKER Hidden Creek';
  // 02:30 on 2026-03-08 does not exist in New York (the clock jumps 02:00 to 03:00).
  const drifted = { ...aliceTasks()[0], title: TITLE_MARKER, due_date: '2026-03-08', meta: { ...META, time: '02:30' } };
  // A preference whose zone Node no longer knows: drifted the same way.
  const prefs = [...alicePrefs(), { profile_id: ALICE, pref_key: 'week:review-preferences', value: { enabled: true, weekday: 1, time: '09:00', zone: 'Mars/Olympus_Mons' } }];
  const h = harness({ tasks: [drifted, { ...aliceTasks()[1], reason: PLACE_MARKER }], prefs });
  const response = await load(h, 'alice', { headers: { 'x-request-id': 'h24-request-0001' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.actions.length, 2, 'the row is not left out');
  assert.equal(body.actions[0].title, TITLE_MARKER);
  assert.deepEqual(body.metas['home:water'], { ...META, time: '02:30' }, 'and its meta is exactly as stored');
  assert.deepEqual(body.preferences['week:review-preferences'].zone, 'Mars/Olympus_Mons', 'and so is the preference');

  assert.equal(logged.mock.calls.length, 1, 'one line');
  const line = loggedText(logged);
  assert.equal(line,
    'actions load: the stored snapshot fails the client\'s load check and is returned unchanged '
    + `(request h24-request-0001, 2 finding(s)): invalid_meta ${drifted.id} time; invalid_preference week:review-preferences`);
  for (const marker of ['PRIVATE-NOTE-MARKER', 'PRIVATE-TITLE-MARKER', 'PRIVATE-PLACE-MARKER', 'home:water', 'Mars', '02:30', 'Water first']) {
    assert.ok(!line.includes(marker), `${marker} is not logged`);
  }
  assert.ok(!line.includes(aliceTasks()[1].id), 'a row that passes is not named');
});

test('the route declares maxDuration = 60 and no server-authored string has an em dash (H21, H22)', () => {
  const route = readFileSync(path.join(REPO_ROOT, 'app/api/frontend/actions/route.js'), 'utf8');
  assert.match(route, /^export const maxDuration = 60;$/m);
  for (const file of ['app/api/frontend/actions/route.js', 'lib/actionsStore.js', 'lib/features.js']) {
    assert.ok(!readFileSync(path.join(REPO_ROOT, file), 'utf8').includes(EM_DASH), file);
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

/** runtime.ts:29, the registry entry this surface reads. */
const productionOperations = {
  'actions.load': { path: '/api/frontend/actions' },
};

/** runtime.ts:91-97 */
const messages = {
  offline: 'You are offline. Your changes are still here.', session: 'Please reconnect your session to continue.',
  permission: 'This action is not available for this account.', conflict: 'This item changed. Review the latest version before saving.',
  validation: 'Check the highlighted information and try again.', rate_limited: 'Please wait before trying again.',
  unavailable: 'This service is unavailable. Try again later.', invalid_response: 'The service returned incomplete information. Please retry.',
  aborted: 'Request cancelled.', unknown_outcome: 'The result is not confirmed. Check its status before trying again.',
};

/**
 * `request` (runtime.ts:105-158) with the harness as `fetch`. Kept: the
 * registry lookup, the method and mutation rule (:111), the query building
 * (:125-129), the headers (:130-136), and the whole response handling
 * (:143-157). Left out: credentials, timeouts and aborts, which a route cannot
 * affect.
 */
function clientRuntime(h, who, { homeContextId = null, env } = {}) {
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
        const response = await h.call(endpoint.path, method, { as: who, url: path, headers, env, rawBody: mutation ? JSON.stringify(body ?? {}) : undefined });
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
/** expanded-preview.ts:36-40 */
function actionDraftError(title, date) {
  if (!title.trim() || title.trim().length > 160) return 'Enter a title between 1 and 160 characters.';
  if (!validActionDate(date)) return 'Choose a valid calendar date.';
  return null;
}

/** week-preview.ts:4 */
const emptyWeekMeta = { note: '', paused: false, archived: false, completedOn: '', time: '', duration: 60, zone: 'America/New_York', recurrence: 'none', reminder: false, history: [] };
/** week-preview.ts:11-16 */
function eventInstant(day, time, zone) {
  if (!day || !validActionDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  try {
    const target = `${day}T${time}`; const base = Date.parse(`${target}:00Z`); const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); const matches = [];
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) { const instant = new Date(base + offset * 60000); const p = fmt.formatToParts(instant); const get = (type) => p.find(x => x.type === type)?.value; if (`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}` === target) matches.push(instant.toISOString()); } return matches.length === 1 ? matches[0] : null;
  } catch { return null; }
}

/** action-service.ts:27-36 */
function actionMetadataError(meta, action) {
  if (!meta || typeof meta !== 'object' || typeof meta.time !== 'string' || typeof meta.completedOn !== 'string' || typeof meta.zone !== 'string' || [meta.paused, meta.archived, meta.reminder].some(value => typeof value !== 'boolean') || meta.estimateSet !== undefined && typeof meta.estimateSet !== 'boolean') return 'The task schedule is invalid.';
  if (typeof meta.note !== 'string' || meta.note.length > 3000 || !Array.isArray(meta.history) || meta.history.some(line => typeof line !== 'string')) return 'The task details are invalid.';
  if (!Number.isInteger(meta.duration) || meta.duration < 15 || meta.duration > 1440) return 'Choose a duration between 15 and 1440 minutes.';
  try { new Intl.DateTimeFormat('en', { timeZone: meta.zone }); } catch { return 'Choose a valid timezone.'; }
  if (meta.time && !eventInstant(action.date, meta.time, meta.zone)) return 'Choose a valid dated time outside clock-change gaps or ambiguous times.';
  if (!['none', 'weekly', 'after-completion'].includes(meta.recurrence) || meta.recurrence !== 'none' && (!action.date || meta.time)) return 'Repeating tasks need an all-day date.';
  if (meta.completedOn && actionDraftError('Completion', meta.completedOn)) return 'The completion date is invalid.';
  return null;
}

/** action-service.ts:38-40 */
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 500) => typeof value === 'string' && value.length <= max;
function validZone(value) { if (!text(value, 100) || !value) return false; try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }
/** action-service.ts:42-53 */
function validActionPreferences(value) {
  if (!object(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (key === 'week:focus') return text(item, 300);
    if (key === 'food-interests') return Array.isArray(item) && item.length <= 5 && new Set(item).size === item.length && item.every(entry => ['fish', 'gardens', 'evidence', 'growers', 'water'].includes(entry));
    if (key === 'week:availability') return object(item) && Object.keys(item).length <= 1000 && Object.entries(item).every(([day, minutes]) => !!day && validActionDate(day) && Number.isInteger(minutes) && Number(minutes) >= 0 && Number(minutes) <= 10080);
    if (key === 'week:season-dismissals') return Array.isArray(item) && item.length <= 1000 && new Set(item).size === item.length && item.every(entry => text(entry, 200) && entry.length > 0);
    if (key === 'week:review-preferences') return object(item) && Object.keys(item).every(name => ['enabled', 'weekday', 'time', 'zone'].includes(name)) && typeof item.enabled === 'boolean' && Number.isInteger(item.weekday) && Number(item.weekday) >= 0 && Number(item.weekday) <= 6 && typeof item.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) && validZone(item.zone);
    if (key === 'outdoorPlan') return object(item) && Object.keys(item).every(name => ['key', 'place', 'period', 'watchRequested', 'forecastVersion', 'forecastIssuedAt', 'forecastExpiresAt'].includes(name)) && text(item.key, 300) && text(item.place, 500) && text(item.period, 100) && typeof item.watchRequested === 'boolean' && (item.forecastVersion === null || text(item.forecastVersion, 300)) && [item.forecastIssuedAt, item.forecastExpiresAt].every(date => date === null || typeof date === 'string' && Number.isFinite(Date.parse(date)));
    return false;
  });
}

/**
 * action-service.ts:86-99. `validReminderStates` (week-reminders.ts) is not
 * transcribed: the server never sends `reminderStates` (no scheduler exists,
 * plan "Dropped"), so a body carrying it fails here loudly instead of being
 * judged by a rule this file does not hold.
 */
function validActionSnapshot(value) {
  if (!value || typeof value !== 'object') return false;
  const data = value;
  if (data.preferences !== undefined && !validActionPreferences(data.preferences)) return false;
  if (data.unresolvedOperations !== undefined && (!Array.isArray(data.unresolvedOperations) || data.unresolvedOperations.length > 100 || data.unresolvedOperations.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(data.unresolvedOperations).size !== data.unresolvedOperations.length)) return false;
  if (!Array.isArray(data.actions) || !data.metas || typeof data.metas !== 'object' || Array.isArray(data.metas)) return false;
  const ids = new Set(), keys = new Set();
  for (const action of data.actions) {
    if (!action || typeof action.id !== 'string' || !action.id || typeof action.key !== 'string' || !action.key || ids.has(action.id) || keys.has(action.key) || typeof action.title !== 'string' || typeof action.date !== 'string' || actionDraftError(action.title, action.date) || !['saved', 'waiting', 'completed'].includes(action.state) || !Number.isInteger(action.revision) || (action.revision ?? 0) < 1 || typeof action.reason !== 'string' || typeof action.origin !== 'string') return false;
    ids.add(action.id); keys.add(action.key);
    if (data.metas[action.key] && actionMetadataError({ ...emptyWeekMeta, ...data.metas[action.key] }, action)) return false;
  }
  if (data.reminderStates !== undefined) throw new Error('reminderStates is not transcribed: the server must not send it');
  return Object.keys(data.metas).every(key => keys.has(key));
}

/** adapters.ts:5 */
function invalid() { return new FrontendServiceError('invalid_response', 'The service returned incomplete information. Please retry.'); }

/** adapters.ts:6, :9: the production action adapter's `load`. */
function createActionAdapter(runtime) {
  return {
    async load(signal) { const value = await runtime.request('actions.load', undefined, { signal }); if (!validActionSnapshot(value) || !Array.isArray(value.unresolvedOperations)) throw invalid(); return value; },
  };
}

/**
 * `ExpandedPreviewProvider` with a production `service`
 * (ExpandedPreviewState.tsx:43-80), as plain fields:
 *   - `commitSnapshot` (:60-68): actions, the unresolved lock and its message,
 *     and the canonical drafts (`week:metas` plus every preference);
 *   - the load effect (:69-77): `loading`, then `ready`, or `error` with
 *     "Your tasks could not load. Reconnect and try again.";
 *   - `canMutate`: the first guard of `mutate` (:82), with no command in
 *     flight (`lock` false), which is whether the person can add a task.
 */
function myWeek(service) {
  const week = {
    actions: [], snapshot: { actions: [], metas: {} }, drafts: {},
    readiness: service ? 'loading' : 'ready', error: '', unknownOperation: '',

    commitSnapshot(snapshot) {
      week.snapshot = snapshot;
      week.actions = snapshot.actions;
      if (service) { week.unknownOperation = snapshot.unresolvedOperations?.[0] ?? ''; if (snapshot.unresolvedOperations?.length) week.error = 'An earlier save needs checking before changing tasks.'; }
      week.drafts = { ...week.drafts, 'week:metas': snapshot.metas, ...snapshot.preferences };
    },

    async load() {
      week.readiness = 'loading'; week.error = '';
      await service.load(new AbortController().signal).then(snapshot => {
        if (!validActionSnapshot(snapshot)) throw new Error('invalid');
        week.commitSnapshot(snapshot); week.readiness = 'ready';
      }).catch(() => { week.readiness = 'error'; week.error = 'Your tasks could not load. Reconnect and try again.'; });
    },

    canMutate() { return !(week.unknownOperation || service && week.readiness !== 'ready'); },
  };
  return week;
}

/** My Week loaded through the real handler, as `who`. */
async function loadMyWeek(h, who = 'alice', options = {}) {
  const week = myWeek(createActionAdapter(clientRuntime(h, who, options)));
  await week.load();
  return week;
}

/** A runtime that answers every request with a canned body and status, for the self-checks. */
const cannedRuntime = (status, body) => clientRuntime({
  call: async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
}, 'alice');
const cannedWeek = async (status, body) => {
  const week = myWeek(createActionAdapter(cannedRuntime(status, body)));
  await week.load();
  return week;
};

const LOAD_ERROR = 'Your tasks could not load. Reconnect and try again.';

test('the transcription rejects what the client rejects, so agreement below means something', async () => {
  const ready = await cannedWeek(200, JSON.parse(EMPTY_BODY));
  assert.deepEqual([ready.readiness, ready.error, ready.canMutate()], ['ready', '', true], 'the client\'s own fixture loads');
  const fixture = await cannedWeek(200, { actions: [], metas: {}, unresolvedOperations: [] });
  assert.equal(fixture.readiness, 'ready', 'the frontend\'s own fixture without preferences loads too (digest 5.1)');
  const wrapped = await cannedWeek(200, { data: JSON.parse(EMPTY_BODY) });
  assert.equal(wrapped.readiness, 'ready', 'the unwrap at runtime.ts:149-152 is transcribed');

  const action = ALICE_SNAPSHOT.actions[0];
  for (const [label, status, body] of [
    ['no unresolvedOperations (T1)', 200, { actions: [], metas: {} }],
    ['a top-level data key replacing the body', 200, { data: null, actions: [], metas: {}, unresolvedOperations: [] }],
    ['metas an array', 200, { actions: [], metas: [], unresolvedOperations: [] }],
    ['preferences null', 200, { actions: [], metas: {}, preferences: null, unresolvedOperations: [] }],
    ['an unknown preference', 200, { actions: [], metas: {}, preferences: { 'week:other': 1 }, unresolvedOperations: [] }],
    ['101 unresolved ids (T8)', 200, { actions: [], metas: {}, unresolvedOperations: Array.from({ length: 101 }, (_, i) => opId(i)) }],
    ['a fourth state (T15)', 200, { actions: [{ ...action, state: 'cancelled' }], metas: {}, unresolvedOperations: [] }],
    ['revision 0', 200, { actions: [{ ...action, revision: 0 }], metas: {}, unresolvedOperations: [] }],
    ['a meta with no task', 200, { actions: [], metas: { 'home:water': META }, unresolvedOperations: [] }],
    ['a DST-gap time (T5)', 200, { actions: [{ ...action, date: '2026-03-08' }], metas: { [action.key]: { ...META, time: '02:30' } }, unresolvedOperations: [] }],
    ['a weekly task with no date (T5)', 200, { actions: [{ ...action, date: '' }], metas: { [action.key]: { ...META, recurrence: 'weekly' } }, unresolvedOperations: [] }],
    ['not an object', 200, 'null'],
    ['a 503', 503, { code: 'feature_unavailable' }],
    ['a 404', 404, {}],
  ]) {
    const week = await cannedWeek(status, body);
    assert.deepEqual([week.readiness, week.error, week.canMutate()], ['error', LOAD_ERROR, false], label);
  }

  const locked = await cannedWeek(200, { actions: [], metas: {}, unresolvedOperations: [OP] });
  assert.deepEqual([locked.readiness, locked.unknownOperation, locked.error, locked.canMutate()],
    ['ready', OP, 'An earlier save needs checking before changing tasks.', false], 'an unresolved id is a lock (:63, :82)');
});

// ---------------------------------------------------------------------------
// The real handler through the client
// ---------------------------------------------------------------------------

test('client: a new household\'s My Week is ready, empty and writable (T1)', async () => {
  const h = harness();
  const week = await loadMyWeek(h, 'alice', { homeContextId: FOREIGN_HOME });
  assert.equal(week.readiness, 'ready');
  assert.equal(week.error, '');
  assert.equal(week.unknownOperation, '');
  assert.deepEqual(week.actions, []);
  assert.deepEqual(week.snapshot.preferences, {}, 'the empty preferences object reached the screen');
  assert.deepEqual(week.drafts, { 'week:metas': {} }, 'and spreads no preference into the drafts');
  assert.equal(week.canMutate(), true, 'the person can add a task');
  assert.deepEqual(h.blockedFetches, []);
});

test('client: a household with tasks loads them, their planning details and its preferences', async () => {
  const h = harness({ tasks: [...aliceTasks(), ...bobTasks()], prefs: [...alicePrefs(), ...bobPrefs()] });
  const week = await loadMyWeek(h);
  assert.equal(week.readiness, 'ready');
  assert.equal(week.canMutate(), true);
  assert.deepEqual(week.actions, ALICE_SNAPSHOT.actions);
  assert.deepEqual(week.drafts, { 'week:metas': { 'home:water': META }, 'week:focus': 'Water first this week', 'food-interests': ['fish', 'water'] });
  const bobs = await loadMyWeek(h, 'bob');
  assert.deepEqual(bobs.actions.map((action) => action.title), ['BOB-PRIVATE-TITLE'], 'each household sees its own');
});

test('client: a save in flight on another device locks My Week and asks for its status', async () => {
  const h = harness({ tasks: aliceTasks(), operations: [actionsRow()] });
  const week = await loadMyWeek(h);
  assert.equal(week.readiness, 'ready');
  assert.equal(week.unknownOperation, OP);
  assert.equal(week.error, 'An earlier save needs checking before changing tasks.');
  assert.equal(week.canMutate(), false);
});

test('client: a dead save does not lock My Week, because the read reaps it', async () => {
  const h = harness({ operations: [actionsRow({ created_at: ago(10 * 60 * 1000) })] });
  const week = await loadMyWeek(h);
  assert.deepEqual([week.readiness, week.unknownOperation, week.canMutate()], ['ready', '', true]);
});

test('client: flag off, My Week shows "Your tasks could not load" and adding is disabled, exactly as with no route (H17)', async () => {
  const h = harness({ env: {}, tasks: aliceTasks() });
  const week = await loadMyWeek(h);
  assert.equal(week.readiness, 'error');
  assert.equal(week.error, LOAD_ERROR);
  assert.deepEqual(week.actions, [], 'no task is shown');
  assert.equal(week.canMutate(), false, 'mutate returns false before sending anything');
  assert.deepEqual(h.db.rpcCalls, []);
  // The same state the screen is in today, with no route at all (a 404).
  const today = await cannedWeek(404, {});
  assert.deepEqual([today.readiness, today.error, today.canMutate()], [week.readiness, week.error, week.canMutate()]);
});

test('client: before 0023 My Week is the same load error, never an empty week that may be false', async () => {
  const week = await loadMyWeek(harness({ withFunction: false }));
  assert.deepEqual([week.readiness, week.error, week.canMutate()], ['error', LOAD_ERROR, false]);
});

// ---------------------------------------------------------------------------
// The real read function of 0023 (PGlite)
// ---------------------------------------------------------------------------

let pg;
let pgBefore23;

before(async () => {
  pg = await createDb();
  pgBefore23 = await createDb({ upTo: 22 });
  for (const db of [pg, pgBefore23]) {
    // The auth trigger (0001) makes each household's bare profile row.
    await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true);`);
  }
  for (const row of [...aliceTasks(), ...bobTasks(), { ...aliceTasks()[0], id: '7a7a7a7a-0000-4000-8000-000000000003', action_key: 'home:history', title: 'Look at the first record', due_date: '0001-01-01', meta: null, created_at: '2026-10-03T10:00:00.000Z' }]) {
    await pg.query(
      `insert into public.household_actions (id, profile_id, action_key, title, reason, origin, due_date, state, revision, meta, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10::jsonb, $11)`,
      [row.id, row.profile_id, row.action_key, row.title, row.reason, row.origin, row.due_date, row.state, row.revision, row.meta === null ? null : JSON.stringify(row.meta), row.created_at],
    );
  }
  for (const row of [...alicePrefs(), ...bobPrefs()]) {
    await pg.query('insert into public.household_action_preferences (profile_id, pref_key, value) values ($1, $2, $3::jsonb)', [row.profile_id, row.pref_key, JSON.stringify(row.value)]);
  }
  await pg.query('insert into public.household_action_state (profile_id, version) values ($1, 5), ($2, 9)', [ALICE, BOB]);
});

after(async () => {
  await pg?.close();
  await pgBefore23?.close();
});

/** A harness whose read function is the real one in `db`, called as the service role, as PostgREST would. */
function harnessOnDatabase(db, { operations = [] } = {}) {
  const h = harness({ withFunction: false, operations, tables: haloTables('profiles', 'operations') });
  h.db.registerRpc('read_household_actions', async (args) => {
    try {
      return await db.asService(async (tx) => (await tx.query('select public.read_household_actions($1) as result', [args.p_profile_id])).rows[0].result);
    } catch (error) {
      throw rpcError(error.code, error.message, error.detail ?? null);
    }
  }, { args: ['p_profile_id'] });
  return h;
}

test('db: the real function returns the caller\'s snapshot only, and My Week loads it (H2, H9)', async () => {
  const h = harnessOnDatabase(pg, { operations: [actionsRow({ operation_id: BOB_OP, profile_id: 'bob' })] });
  const response = await load(h, 'alice', { headers: { 'x-halo-home-context': FOREIGN_HOME } });
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.deepEqual(body.actions, [
    ...ALICE_SNAPSHOT.actions,
    { id: '7a7a7a7a-0000-4000-8000-000000000003', key: 'home:history', title: 'Look at the first record', reason: 'Due this week', origin: 'home', date: '0001-01-01', state: 'saved', revision: 2 },
  ], 'oldest first; no date reads as \'\' and year 1 as 0001-01-01');
  assert.deepEqual(body.metas, ALICE_SNAPSHOT.metas, 'the meta is the same value after jsonb, whatever its key order');
  assert.deepEqual(body.preferences, ALICE_SNAPSHOT.preferences);
  assert.deepEqual(body.unresolvedOperations, []);
  assert.deepEqual(Object.keys(body), ['actions', 'metas', 'preferences', 'unresolvedOperations']);
  assert.ok(!text.includes('BOB-PRIVATE') && !text.includes('"version"') && !text.includes(BOB_OP), 'nothing of bob\'s, and no version');

  const week = await loadMyWeek(h);
  assert.deepEqual([week.readiness, week.error, week.unknownOperation, week.canMutate()], ['ready', '', '', true]);
  assert.equal(week.actions.length, 3);
});

test('db: a household the function has never seen gets exactly the empty fixture', async () => {
  const stranger = '00000000-0000-4000-8000-000000000003';
  await pg.exec(`insert into auth.users (id, is_anonymous) values ('${stranger}', true);`);
  const h = createRouteHarness({ tables: haloTables('profiles', 'operations'), env: ON, identities: { alice: {}, bob: {}, carol: {} } });
  assert.equal(h.identities.carol.id, stranger);
  h.db.registerRpc('read_household_actions', (args) =>
    pg.asService(async (tx) => (await tx.query('select public.read_household_actions($1) as result', [args.p_profile_id])).rows[0].result), { args: ['p_profile_id'] });
  const response = await load(h, 'carol');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), EMPTY_BODY);
  const week = await loadMyWeek(h, 'carol');
  assert.deepEqual([week.readiness, week.canMutate()], ['ready', true]);
});

test('db: before 0023 Postgres says the function does not exist, and the answer is the 503, not a 500', async () => {
  const h = harnessOnDatabase(pgBefore23);
  const body = await expectEnvelope(await load(h), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(!('actions' in body));
});
