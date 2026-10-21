/**
 * GET /api/privacy/status (B07 Task 3; Rulings P10, P11, P14 of
 * docs/backend/plans/b07-privacy.md) and the daily purge's own-household half.
 *
 * The panel enables nothing until this read is `verified`
 * (components/production/ProductionPrivacy.tsx:18), and it locks on the
 * first entry (:19). A body of bare ids, `{data: null}` or any entry without a
 * known scope leaves the whole panel reading "Privacy requests are
 * unavailable." (digest trap P-1). So the second half of this file does not
 * stop at the body's shape: it runs the CLIENT'S OWN CONSUMPTION LOGIC and
 * asserts what the panel then shows:
 *
 *   - the runtime's request, status mapping and envelope unwrap
 *     (lib/frontend/production/runtime.ts:111-153), as transcribed once in
 *     test/helpers/frontendB06.mjs, with this tree's `privacy.status`
 *     registry entry (runtime.ts:86) added;
 *   - `useProductionResource`'s settle (components/production/ProductionContext.tsx:14);
 *   - `verified` and the first-entry lock (ProductionPrivacy.tsx:18-19), run
 *     from the source text itself: the two lines are copied verbatim (no
 *     types to strip) and executed with `new Function`, and a drift test
 *     fails the moment either line changes in the component;
 *   - the unavailable banner and the Clear all button's disabled condition
 *     (ProductionPrivacy.tsx:26), transcribed from the JSX and drift-checked
 *     the same way.
 *
 * Two databases. Most cases run on the in-memory fake with the two 0024
 * functions this route calls registered as recorders. The purge's effect
 * ("a settled privacy receipt older than 24 hours is gone after the read")
 * and the ledger reads run against the REAL migration 0024 and 0017 on
 * PGlite at the end, so the claim is not a simulation of the SQL.
 *
 * Everything is local: synthetic identities, no network (any fetch throws),
 * no real Supabase project.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { clientRuntime, productionOperations, serviceMessage } from './helpers/frontendB06.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { pgliteLedger } from './db/pgliteLedger.mjs';

const STATUS = '/api/privacy/status';
const KEY = 'k'.repeat(32);
const ON = { HALO_PRIVACY_REVIEW_KEY: KEY };

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const HOUR = 60 * 60 * 1000;
const opId = (n) => `9a9a9a9a-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OP_ALL = opId(1);
const OP_EXPORT = opId(2);
const OP_JOURNAL = opId(3);
const BOB_OP = opId(0xb0b);

const TABLES = haloTables('profiles', 'operations');

/** A privacy ledger row for alice, pending and fresh unless overridden. */
const privacyRow = (overrides = {}) => ({
  operation_id: OP_ALL,
  profile_id: 'alice',
  domain: 'privacy',
  kind: 'privacy.clear.all',
  status: 'pending',
  request_hash: 'h'.repeat(64),
  result: null,
  created_at: ago(1_000),
  updated_at: ago(1_000),
  ...overrides,
});

/**
 * A harness with the two 0024 functions the route calls registered, unless
 * `schema: false` (0024 not applied: PostgREST answers PGRST202, which is
 * what an unregistered fake RPC answers). `purge` replaces the purge's
 * handler; the default records the call and deletes nothing.
 */
function harness({ operations = [], tables = TABLES, env = ON, schema = true, purge, version = 1 } = {}) {
  const h = createRouteHarness({
    tables,
    env,
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id }, { id: bob.id }],
      ...('operations' in tables
        ? { operations: operations.map((row) => ({ ...row, profile_id: row.profile_id === 'bob' ? bob.id : alice.id })) }
        : {}),
    }),
  });
  if (schema) {
    h.db.registerRpc('privacy_schema_version', () => version, { args: [] });
    h.db.registerRpc('purge_privacy_receipts', purge ?? (() => 0), { args: ['p_profile_id'] });
  }
  return h;
}

const read = (h, who = 'alice', { url = STATUS, headers = {} } = {}) => h.call(STATUS, 'GET', { as: who, url, headers });

/** Every statement on the ledger is scoped to the caller on the query itself. */
function assertLedgerScoped(h, callerId, label) {
  for (const entry of h.db.queryLog.filter((item) => item.table === 'operations')) {
    const scoped = entry.filters.some((f) => f.type === 'cmp' && f.op === 'eq' && f.column === 'profile_id' && f.value === callerId);
    assert.ok(scoped, `${label}: ${entry.operation} on operations is not scoped to the caller`);
  }
}

const ledgerWrites = (h) => h.db.queryLog.filter((entry) => entry.table === 'operations' && entry.operation !== 'select');
const purgeCalls = (h) => h.db.rpcCalls.filter((call) => call.name === 'purge_privacy_receipts');

/** U+2014, built from its code point so this file carries no em dash of its own (AGENTS.md). */
const EM_DASH = String.fromCharCode(0x2014);

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

test('a new household gets exactly {"unresolvedOperations":[]} with 200 and no data key (trap P-1, digest 2)', async () => {
  const h = harness();
  const response = await read(h);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text, '{"unresolvedOperations":[]}');
  assert.equal(Object.hasOwn(JSON.parse(text), 'data'), false);
  assert.ok(!text.includes(EM_DASH));
  assert.deepEqual(h.blockedFetches, [], 'zero fetch calls');
});

test('a pending clear all, export and journal clear are listed as {operationId, scope}, oldest first (P14)', async () => {
  const h = harness({
    operations: [
      privacyRow({ operation_id: OP_JOURNAL, kind: 'privacy.clear.journal', created_at: ago(3_000) }),
      privacyRow({ operation_id: OP_ALL, kind: 'privacy.clear.all', created_at: ago(9_000) }),
      privacyRow({ operation_id: OP_EXPORT, kind: 'privacy.export', created_at: ago(6_000) }),
    ],
  });
  const response = await read(h);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    unresolvedOperations: [
      { operationId: OP_ALL, scope: 'all' },
      { operationId: OP_EXPORT, scope: 'export' },
      { operationId: OP_JOURNAL, scope: 'journal' },
    ],
  });
  assertLedgerScoped(h, h.identities.alice.id, 'GET with rows');
  assert.deepEqual(h.blockedFetches, []);
});

test('a settled privacy row, a settings row and another household\'s privacy row are not listed', async () => {
  const h = harness({
    operations: [
      privacyRow({ operation_id: OP_ALL }),
      privacyRow({ operation_id: OP_EXPORT, kind: 'privacy.export', status: 'succeeded', result: { operationId: OP_EXPORT, status: 'succeeded', scope: 'export' } }),
      privacyRow({ operation_id: OP_JOURNAL, kind: 'privacy.clear.journal', status: 'failed', result: { status: 'failed', reason: 'busy' } }),
      privacyRow({ operation_id: opId(4), domain: 'settings', kind: 'settings.save' }),
      privacyRow({ operation_id: BOB_OP, profile_id: 'bob' }),
    ],
  });
  assert.deepEqual(await (await read(h)).json(), { unresolvedOperations: [{ operationId: OP_ALL, scope: 'all' }] });
  const bob = await (await read(h, 'bob')).json();
  assert.deepEqual(bob, { unresolvedOperations: [{ operationId: BOB_OP, scope: 'all' }] }, 'bob sees his own, and only his own');
});

test('a stale pending privacy row is reaped to failed and not listed, so a dead clear cannot lock the panel for ever', async () => {
  const settingsOp = opId(5);
  const h = harness({
    operations: [
      privacyRow({ created_at: ago(10 * 60 * 1000) }),
      privacyRow({ operation_id: settingsOp, domain: 'settings', kind: 'settings.save', created_at: ago(10 * 60 * 1000) }),
    ],
  });
  assert.deepEqual(await (await read(h)).json(), { unresolvedOperations: [] });
  const row = h.db.rows('operations').find((item) => item.operation_id === OP_ALL);
  assert.equal(row.status, 'failed');
  assert.deepEqual(row.result, { status: 'failed', reason: 'abandoned' });
  const other = h.db.rows('operations').find((item) => item.operation_id === settingsOp);
  assert.equal(other.status, 'pending', 'only the privacy domain is reaped here; settings reaps its own');
  assertLedgerScoped(h, h.identities.alice.id, 'reap');
});

test('101 pending rows give the 100 oldest, oldest first', async () => {
  const rows = Array.from({ length: 101 }, (_, i) =>
    privacyRow({ operation_id: opId(100 + i), kind: 'privacy.export', created_at: new Date(Date.now() - 60_000 + i * 100).toISOString() }));
  const h = harness({ operations: [...rows].reverse() });
  const body = await (await read(h)).json();
  assert.equal(body.unresolvedOperations.length, 100);
  assert.deepEqual(body.unresolvedOperations, rows.slice(0, 100).map((row) => ({ operationId: row.operation_id, scope: 'export' })));
});

test('an unmapped kind is omitted and logged by its kind, without its id or its owner', async (t) => {
  const errors = muteConsoleError(t);
  const odd = opId(77);
  const h = harness({
    operations: [
      privacyRow({ operation_id: odd, kind: 'privacy.inspect', created_at: ago(5_000) }),
      privacyRow({ operation_id: OP_ALL, created_at: ago(2_000) }),
    ],
  });
  assert.deepEqual(await (await read(h)).json(), { unresolvedOperations: [{ operationId: OP_ALL, scope: 'all' }] });
  const logged = loggedText(errors);
  assert.match(logged, /omitted 1 unresolved operation\(s\) of an unmapped kind/);
  assert.match(logged, /privacy\.inspect/);
  assert.ok(!logged.includes(odd), 'no operation id in the log');
  assert.ok(!logged.includes(h.identities.alice.id), 'no owner in the log');
});

test('identity comes only from the token: a query or a home-context header naming bob changes nothing (P1)', async () => {
  const h = harness({ operations: [privacyRow(), privacyRow({ operation_id: BOB_OP, profile_id: 'bob' })] });
  const bobId = h.identities.bob.id;
  const response = await read(h, 'alice', {
    url: `${STATUS}?profile_id=${bobId}&profileId=${bobId}`,
    headers: { 'X-Halo-Home-Context': '0c0c0c0c-0000-4000-8000-000000000001' },
  });
  assert.deepEqual(await response.json(), { unresolvedOperations: [{ operationId: OP_ALL, scope: 'all' }] });
  assertLedgerScoped(h, h.identities.alice.id, 'smuggled identity');
  assert.deepEqual(purgeCalls(h).map((call) => call.args), [{ p_profile_id: h.identities.alice.id }]);
});

// ---------------------------------------------------------------------------
// The purge on read (P10)
// ---------------------------------------------------------------------------

test('every read purges the caller\'s own settled receipts first, by name, with the verified id only', async () => {
  const order = [];
  const h = harness({ purge: () => { order.push('purge'); return 3; } });
  const fakeFrom = h.db.from;
  h.db.from = (name) => { if (name === 'operations') order.push('ledger'); return fakeFrom(name); };
  assert.equal((await read(h)).status, 200);
  assert.deepEqual(purgeCalls(h).map((call) => call.args), [{ p_profile_id: h.identities.alice.id }]);
  assert.equal(order[0], 'purge', 'purged before the inventory is read, so a purged row is never listed');
});

test('a failed purge never fails the read and is logged by its code only', async (t) => {
  const errors = muteConsoleError(t);
  const secret = 'Failing row contains (SECRET-ROW-VALUE)';
  const h = harness({
    operations: [privacyRow()],
    purge: () => { throw rpcError('XX000', secret, 'DETAIL-SECRET', 'HINT-SECRET'); },
  });
  const response = await read(h);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { unresolvedOperations: [{ operationId: OP_ALL, scope: 'all' }] });
  const logged = loggedText(errors);
  assert.match(logged, /receipt purge failed.*XX000/);
  for (const leak of ['SECRET', h.identities.alice.id]) assert.ok(!logged.includes(leak), `the purge log carries no ${leak}`);
});

test('a purge that answers an unexpected shape is logged as unexpected and the read goes on', async (t) => {
  const errors = muteConsoleError(t);
  const h = harness({ purge: () => 'not a count' });
  assert.equal((await read(h)).status, 200);
  assert.match(loggedText(errors), /receipt purge failed.*unexpected/);
});

// ---------------------------------------------------------------------------
// Availability (P11)
// ---------------------------------------------------------------------------

/** Non-retryable 503 feature_unavailable, with nothing written to the ledger. */
async function assertUnavailable(h, label) {
  await expectEnvelope(await read(h), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.deepEqual(ledgerWrites(h), [], `${label}: no ledger write`);
  assert.deepEqual(h.blockedFetches, [], `${label}: no fetch`);
}

test('with no review key the answer is a non-retryable 503 and nothing is purged, reaped or read', async () => {
  const h = harness({ env: {}, operations: [privacyRow({ created_at: ago(10 * 60 * 1000) })] });
  await assertUnavailable(h, 'no key');
  assert.deepEqual(h.db.rpcCalls, [], 'no probe and no purge');
  assert.deepEqual(h.db.queryLog.filter((entry) => entry.table === 'operations'), []);
  assert.equal(h.db.rows('operations')[0].status, 'pending', 'the stale row is not reaped');
});

test('a 31-character key and an all-space key are no key at all (503)', async () => {
  for (const value of ['k'.repeat(31), ' '.repeat(40), ` ${'k'.repeat(31)} `]) {
    const h = harness({ env: { HALO_PRIVACY_REVIEW_KEY: value } });
    await assertUnavailable(h, JSON.stringify(value));
    assert.deepEqual(h.db.rpcCalls, []);
  }
});

test('before 0024 (privacy_schema_version is PGRST202) the answer is a non-retryable 503 with nothing purged or reaped', async () => {
  const h = harness({ schema: false, operations: [privacyRow({ created_at: ago(10 * 60 * 1000) })] });
  await assertUnavailable(h, 'no 0024');
  assert.deepEqual(h.db.rpcCalls.map((call) => call.name), ['privacy_schema_version'], 'the probe only');
  assert.deepEqual(h.db.queryLog.filter((entry) => entry.table === 'operations'), []);
  assert.equal(h.db.rows('operations')[0].status, 'pending');
});

test('a different 0024 version is unavailable too, not guessed at', async () => {
  const h = harness({ version: 2 });
  await assertUnavailable(h, 'version 2');
  assert.equal(purgeCalls(h).length, 0);
});

test('before 0017 (no operations table) the answer is a non-retryable 503, never an invented empty list', async (t) => {
  muteConsoleError(t);
  // Where 0024 exists 0017 does too (0024 refuses to apply otherwise), so the
  // purge answers as the real function would without its table.
  const h = harness({
    tables: haloTables('profiles'),
    purge: () => { throw rpcError('42P01', 'relation "public.operations" does not exist'); },
  });
  await expectEnvelope(await read(h), { status: 503, code: 'feature_unavailable', retryable: false });
  // The reaper's conditional update is attempted (the fake logs a statement
  // before it fails on the absent table) and fails; there is no table to
  // write to, and nothing after it runs.
  assert.deepEqual(ledgerWrites(h).map((entry) => [entry.operation, entry.rows.length]), [['update', 0]]);
  assert.equal(h.db.queryLog.filter((entry) => entry.table === 'operations' && entry.operation === 'select').length, 0);
  assert.deepEqual(h.blockedFetches, []);
});

test('without a session the answer is 401 and nothing is read', async () => {
  const h = harness({ operations: [privacyRow()] });
  const response = await h.call(STATUS, 'GET');
  assert.equal(response.status, 401);
  assert.deepEqual(h.db.rpcCalls, []);
  assert.deepEqual(h.db.queryLog.filter((entry) => entry.table === 'operations'), []);
});

test('maxDuration is 60, under the ledger\'s 120 s staleness window (P17)', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'app/api/privacy/status/route.js'), 'utf8');
  assert.match(source, /^export const maxDuration = 60;$/m);
});

test('the route\'s own strings carry no em dash', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'app/api/privacy/status/route.js'), 'utf8');
  assert.ok(!source.includes(EM_DASH));
});

// ---------------------------------------------------------------------------
// The client's own consumption logic
// ---------------------------------------------------------------------------

const CLIENT = readFileSync(path.join(REPO_ROOT, 'components/production/ProductionPrivacy.tsx'), 'utf8');
const CONTEXT = readFileSync(path.join(REPO_ROOT, 'components/production/ProductionContext.tsx'), 'utf8');
const RUNTIME = readFileSync(path.join(REPO_ROOT, 'lib/frontend/production/runtime.ts'), 'utf8');

/** ProductionPrivacy.tsx:18, verbatim (it has no type annotations to strip). */
const VERIFIED_LINE = " const verified=Array.isArray(status.data?.unresolvedOperations)&&status.data.unresolvedOperations.every(value=>typeof value.operationId==='string'&&!!value.operationId&&['export','journal','all'].includes(value.scope));";
/** ProductionPrivacy.tsx:19, verbatim. */
const LOCK_LINE = " useEffect(()=>{const pending=status.data?.unresolvedOperations?.[0];if(pending&&['export','journal','all'].includes(pending.scope)&&typeof pending.operationId==='string')queueMicrotask(()=>setUnknown({id:pending.operationId,scope:pending.scope}));},[status.data]);";
/** ProductionPrivacy.tsx:26, the banner and the Clear all button's disabled condition, as they stand in the JSX. */
const BANNER_JSX = "{(!verified||status.loading||status.error)&&<p role=\"status\">{status.loading?'Checking pending requests…':'Privacy requests are unavailable.'}";
const CLEAR_ALL_JSX = "<button className=\"hp-link-row hp-danger\" disabled={busy||blocked||!verified||status.loading||!!status.error||!!unknown||unresolved} onClick={()=>void inspect('all')}>";
/** ProductionContext.tsx:14, the settle of useProductionResource. */
const SETTLE = '.then(data=>{if(active)setState({scope:requestKey,data,loading:false,error:null});},error=>{if(active)setState({scope:requestKey,data:null,loading:false,error:serviceMessage(error)});});';
/** runtime.ts:86 */
const REGISTRY = "'privacy.status': {path:'/api/privacy/status'},";

// The executed code is the component's own text.
const verifiedOf = new Function('status', `${VERIFIED_LINE} return verified;`);
const runLock = new Function('status', 'useEffect', 'queueMicrotask', 'setUnknown', LOCK_LINE);
// The two JSX expressions of line 26, cut out of the drift-checked strings
// above (not retyped), so the banner and the Clear all decision that run are
// the component's own text too.
const [, BANNER_CONDITION, BANNER_TEXT] = BANNER_JSX.match(/^\{(\(.+\))&&<p role="status">\{(.+)\}$/);
const [, CLEAR_ALL_DISABLED] = CLEAR_ALL_JSX.match(/ disabled=\{(.+)\} onClick=/);
const bannerOf = new Function('verified', 'status', `return ${BANNER_CONDITION} ? (${BANNER_TEXT}) : null;`);
const clearAllDisabledOf = new Function('busy', 'blocked', 'verified', 'status', 'unknown', 'unresolved', `return ${CLEAR_ALL_DISABLED};`);

assert.deepEqual(productionOperations['privacy.status'], { path: '/api/privacy/status' }, 'the real runtime registers the status read');

/**
 * The panel after its status read settles: what useProductionResource holds,
 * `verified`, the lock (`unknown`), the banner and whether Clear all is
 * enabled (no review open, nothing busy, no other surface unresolved).
 */
async function panel(h, who = 'alice', options = {}) {
  const runtime = clientRuntime(h, who, options);
  let status;
  try {
    status = { data: await runtime.request('privacy.status', {}), loading: false, error: null };
  } catch (error) {
    status = { data: null, loading: false, error: serviceMessage(error) };
  }
  const verified = verifiedOf(status);
  let unknown = null;
  runLock(status, (effect) => effect(), (task) => task(), (value) => { unknown = value; });
  const banner = bannerOf(verified, status) || null;
  // No review open, nothing busy, the panel not blocked, no other surface unresolved.
  const clearAllEnabled = !clearAllDisabledOf(false, false, verified, status, unknown, false);
  return { status, verified, unknown, banner, clearAllEnabled };
}

test('drift: the transcribed lines are still the client\'s own', () => {
  for (const [name, line, source] of [
    ['verified (ProductionPrivacy.tsx:18)', VERIFIED_LINE, CLIENT],
    ['the first-entry lock (ProductionPrivacy.tsx:19)', LOCK_LINE, CLIENT],
    ['the banner (ProductionPrivacy.tsx:26)', BANNER_JSX, CLIENT],
    ['Clear all disabled (ProductionPrivacy.tsx:26)', CLEAR_ALL_JSX, CLIENT],
    ['useProductionResource settle (ProductionContext.tsx:14)', SETTLE, CONTEXT],
    ['registry (runtime.ts:86)', REGISTRY, RUNTIME],
  ]) assert.ok(source.includes(line), `${name} changed in the client; re-transcribe it`);
});

test('the transcription rejects what the client rejects', () => {
  const ok = (data) => verifiedOf({ data, loading: false, error: null });
  assert.equal(ok({ unresolvedOperations: [] }), true);
  assert.equal(ok({ unresolvedOperations: [{ operationId: OP_ALL, scope: 'all' }] }), true);
  assert.equal(ok({ unresolvedOperations: [OP_ALL] }), false, 'bare ids, what listUnresolvedOperations returns (trap P-1)');
  assert.equal(ok(null), false, '{data: null} unwrapped');
  assert.equal(ok({ unresolvedOperations: [{ operationId: OP_ALL, scope: 'inspect' }] }), false);
  assert.equal(ok({ unresolvedOperations: [{ operationId: '', scope: 'all' }] }), false);
});

test('the client: a new household is verified, unlocked, with no banner and Clear all enabled', async () => {
  const view = await panel(harness());
  assert.deepEqual(view.status.data, { unresolvedOperations: [] });
  assert.equal(view.verified, true);
  assert.equal(view.unknown, null);
  assert.equal(view.banner, null);
  assert.equal(view.clearAllEnabled, true);
});

test('the client: a pending clear all locks the panel on that operation, verified, with Clear all disabled', async () => {
  const h = harness({ operations: [privacyRow({ operation_id: OP_EXPORT, kind: 'privacy.export', created_at: ago(9_000) }), privacyRow({ created_at: ago(2_000) })] });
  const view = await panel(h, 'alice', { homeContextId: '0c0c0c0c-0000-4000-8000-000000000001' });
  assert.equal(view.verified, true);
  assert.equal(view.banner, null, 'not "unavailable": the shape is the one the client accepts');
  assert.deepEqual(view.unknown, { id: OP_EXPORT, scope: 'export' }, 'the oldest is the lock');
  assert.equal(view.clearAllEnabled, false);
});

test('the client: every unavailable state reads "Privacy requests are unavailable." with every control disabled', async (t) => {
  muteConsoleError(t);
  for (const [label, h] of [
    ['no key', harness({ env: {} })],
    ['no 0024', harness({ schema: false })],
    ['no 0017', harness({ tables: haloTables('profiles'), purge: () => { throw rpcError('42P01', 'relation "public.operations" does not exist'); } })],
  ]) {
    const view = await panel(h);
    assert.equal(view.verified, false, label);
    assert.equal(view.banner, 'Privacy requests are unavailable.', label);
    assert.equal(view.status.error, 'This service is unavailable. Try again later.', `${label}: the runtime's unavailable copy`);
    assert.equal(view.clearAllEnabled, false, label);
  }
});

test('the cut-out banner and Clear all expressions decide as the JSX does', () => {
  const settled = { data: { unresolvedOperations: [] }, loading: false, error: null };
  assert.equal(bannerOf(true, settled) || null, null);
  assert.equal(bannerOf(false, settled), 'Privacy requests are unavailable.');
  assert.equal(bannerOf(false, { ...settled, loading: true }), 'Checking pending requests…');
  assert.equal(bannerOf(true, { ...settled, error: 'x' }), 'Privacy requests are unavailable.');
  assert.equal(clearAllDisabledOf(false, false, true, settled, null, false), false);
  for (const args of [
    [true, false, true, settled, null, false],
    [false, true, true, settled, null, false],
    [false, false, false, settled, null, false],
    [false, false, true, { ...settled, loading: true }, null, false],
    [false, false, true, { ...settled, error: 'x' }, null, false],
    [false, false, true, settled, { id: OP_ALL, scope: 'all' }, false],
    [false, false, true, settled, null, true],
  ]) assert.equal(clearAllDisabledOf(...args), true, JSON.stringify(args));
});

// ---------------------------------------------------------------------------
// Real failures are a 500, never the non-retryable "unavailable" (N1)
// ---------------------------------------------------------------------------

const TRANSIENT = (code) => ({ code, message: 'canceling statement due to statement timeout', details: null, hint: null });

/**
 * Makes one terminal call of the ledger's query builder answer `error`, as
 * supabase-js resolves a failed statement: `in` on `operation_id` (the
 * route's kind read only; the reaper and the list use `in` on `domain`), or
 * `order` (listUnresolvedOperations' select; the kind read never orders).
 */
function ledgerCallAnswers(h, method, error, when = () => true) {
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name !== 'operations') return builder;
    const real = builder[method].bind(builder);
    builder[method] = (...args) => (when(...args) ? Promise.resolve({ data: null, error }) : real(...args));
    return builder;
  };
}

test('the kind read failing (XX000) is a 500 internal_error, logged without ids, and the panel shows the unavailable banner', async (t) => {
  const errors = muteConsoleError(t);
  const h = harness({ operations: [privacyRow()] });
  ledgerCallAnswers(h, 'in', { code: 'XX000', message: 'internal error', details: null, hint: null }, (column) => column === 'operation_id');
  const body = await expectEnvelope(await read(h), { status: 500, code: 'internal_error' });
  assert.equal(body.retryable, true, 'a 500 is worth retrying, unlike the 503 for a missing feature');
  const logged = loggedText(errors);
  assert.match(logged, /Privacy status read failed.*XX000/);
  for (const id of [OP_ALL, h.identities.alice.id, h.identities.bob.id]) assert.ok(!logged.includes(id), 'no id in the log');

  const again = harness({ operations: [privacyRow()] });
  ledgerCallAnswers(again, 'in', { code: 'XX000', message: 'internal error', details: null, hint: null }, (column) => column === 'operation_id');
  const view = await panel(again);
  assert.equal(view.verified, false);
  assert.equal(view.banner, 'Privacy requests are unavailable.');
  assert.equal(view.unknown, null);
  assert.equal(view.clearAllEnabled, false);
});

test('the 0024 probe failing (XX000) is a 500, not the non-retryable 503 that says 0024 is missing', async (t) => {
  muteConsoleError(t);
  const h = harness();
  h.db.registerRpc('privacy_schema_version', () => { throw rpcError('XX000', 'internal error'); }, { args: [] });
  await expectEnvelope(await read(h), { status: 500, code: 'internal_error' });
  assert.equal(purgeCalls(h).length, 0, 'nothing after the probe ran');
});

test('the unresolved-operations read failing with a transient error is a 500, not the non-retryable 503', async (t) => {
  muteConsoleError(t);
  const h = harness({ operations: [privacyRow()] });
  ledgerCallAnswers(h, 'order', TRANSIENT('57014'));
  await expectEnvelope(await read(h), { status: 500, code: 'internal_error' });
});

// ---------------------------------------------------------------------------
// On the real 0024 and 0017 (PGlite)
// ---------------------------------------------------------------------------

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

let worlds = 0;
const asRpcError = (error) => rpcError(error?.code ?? '', error?.message ?? String(error), null, null);

/**
 * alice and bob in PGlite, a route harness whose ledger is the real
 * public.operations (pgliteLedger) and whose two 0024 calls run the real
 * functions by argument name, as PostgREST calls them.
 */
async function realWorld() {
  worlds += 1;
  const prefix = (0xc0000000 + worlds).toString(16);
  const alice = `${prefix}-0000-4000-8000-00000000000a`;
  const bob = `${prefix}-0000-4000-8000-00000000000b`;
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${alice}', true), ('${bob}', true);`);
  const h = createRouteHarness({
    tables: haloTables('profiles'),
    env: ON,
    identities: { alice: { id: alice }, bob: { id: bob } },
    seed: { profiles: [{ id: alice }, { id: bob }] },
  });
  const fakeFrom = h.db.from;
  h.db.from = (name) => (name === 'operations' ? pgliteLedger(db, name, h.db.queryLog) : fakeFrom(name));
  const call = async (sql, params) => {
    try {
      return (await db.asService(async (tx) => (await tx.query(sql, params)).rows[0].data, { commit: true }));
    } catch (error) {
      throw asRpcError(error);
    }
  };
  h.db.registerRpc('privacy_schema_version', () => call('select public.privacy_schema_version() as data', []), { args: [] });
  h.db.registerRpc('purge_privacy_receipts', (args) => call('select public.purge_privacy_receipts(p_profile_id => $1::uuid) as data', [args.p_profile_id]), { args: ['p_profile_id'] });

  const insert = (owner, { id, domain = 'privacy', kind = 'privacy.clear.all', status = 'succeeded', age = 0 }) => db.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, result, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, now() - $8 * interval '1 millisecond', now() - $8 * interval '1 millisecond')`,
    [id, owner, domain, kind, status, 'h'.repeat(64), status === 'pending' ? null : JSON.stringify({ status }), age],
  );
  const exists = async (id) => (await db.query('select 1 from public.operations where operation_id = $1', [id])).rows.length === 1;
  return { h, alice, bob, insert, exists };
}

const realId = (world, n) => `${(0xd0000000 + world).toString(16)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('real 0024: a settled privacy receipt older than 24 hours is gone after the read; newer, pending, other domains and bob\'s stay', async () => {
  const w = await realWorld();
  const id = (n) => realId(worlds, n);
  await w.insert(w.alice, { id: id(1), age: 25 * HOUR });
  await w.insert(w.alice, { id: id(2), kind: 'privacy.export', status: 'failed', age: 25 * HOUR });
  await w.insert(w.alice, { id: id(3), age: 23 * HOUR });
  await w.insert(w.alice, { id: id(4), domain: 'settings', kind: 'settings.save', age: 25 * HOUR });
  await w.insert(w.bob, { id: id(5), age: 25 * HOUR });
  await w.insert(w.alice, { id: id(6), kind: 'privacy.clear.journal', status: 'pending', age: 1_000 });

  const response = await read(w.h);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { unresolvedOperations: [{ operationId: id(6), scope: 'journal' }] });

  assert.equal(await w.exists(id(1)), false, 'succeeded, 25 hours: purged');
  assert.equal(await w.exists(id(2)), false, 'failed, 25 hours: purged');
  assert.equal(await w.exists(id(3)), true, '23 hours: kept');
  assert.equal(await w.exists(id(4)), true, 'another domain: kept');
  assert.equal(await w.exists(id(5)), true, 'bob\'s: kept by alice\'s read');
  assert.equal(await w.exists(id(6)), true, 'pending: kept, and listed');
  assertLedgerScoped(w.h, w.alice, 'real ledger');
  assert.deepEqual(w.h.blockedFetches, []);
});

test('real 0024: the client\'s panel on the real functions, verified and locked on the pending export', async () => {
  const w = await realWorld();
  const id = (n) => realId(worlds, n);
  await w.insert(w.alice, { id: id(1), kind: 'privacy.export', status: 'pending', age: 2_000 });
  await w.insert(w.alice, { id: id(2), status: 'pending', age: 10 * 60 * 1000 });
  const view = await panel(w.h);
  assert.equal(view.verified, true);
  assert.deepEqual(view.unknown, { id: id(1), scope: 'export' }, 'the stale clear was reaped, not listed');
  const reaped = (await db.query('select status, result from public.operations where operation_id = $1', [id(2)])).rows[0];
  assert.equal(reaped.status, 'failed', 'the freeze trigger lets the reaper settle a pending privacy row');
});
