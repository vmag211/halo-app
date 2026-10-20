/**
 * GET /api/operator/sources, GET /api/operator/sources/history and
 * POST /api/operator/sources/commands (B13, docs/backend/plans/b13-source-operations.md).
 *
 * The role is the server's own (operator_roles, 0027): no session is a 401, a
 * household account and every anonymous account get the denied answer, and
 * only an operator sees sources. Every source's freshness comes from what is
 * stored, and every decision is refused through the ledger and the audit,
 * because none has a real effect yet.
 *
 * The answers are judged by the client's own validators
 * (lib/frontend/production/source-operations-service.ts, loaded as the shipped
 * TypeScript), not by a copy. test/contractsB13.test.mjs drives the screen.
 *
 * Everything runs on the isolated harness: synthetic identities, an in-memory
 * database and a fetch that throws on any host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const service = await loadFrontend('production/source-operations-service');
const { requestHash } = await import('@/lib/operations');

const READ = '/api/operator/sources';
const HISTORY = '/api/operator/sources/history';
const COMMAND = '/api/operator/sources/commands';
const OPERATIONS = '/api/operations';

const EM_DASH = String.fromCharCode(0x2014);
const HOUR = 3_600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const op = (n) => `5c5c5c5c-0000-4000-8000-${String(n).padStart(12, '0')}`;

const IDENTITIES = {
  alice: {},
  bob: {},
  viewer: {},
  reviewer: {},
  publisher: {},
  // An anonymous-auth account somebody gave a role to: still denied.
  ghost: { isAnonymous: true },
};

const ALL_TABLES = haloTables('profiles', 'operations', 'operator_roles', 'source_ops_audit', 'daily_scores', 'ucmr5_utilities', 'daily_maxima_recorder');
const without = (...names) => Object.fromEntries(Object.entries(ALL_TABLES).filter(([name]) => !names.includes(name)));

function harness({ tables = ALL_TABLES, audit = [], operations = [], scores = null, recorder = true, ucmr = true } = {}) {
  return createRouteHarness({
    identities: IDENTITIES,
    tables,
    seed: (ids) => {
      const seed = {
        profiles: Object.values(ids).map((who) => ({ id: who.id })),
        daily_scores: scores ?? [
          { profile_id: ids.alice.id, aqi_source: 'airnow', uv_index: 3, mold_risk: 'low', pollen_level: '{"tree":2,"grass":null,"weed":null}', created_at: ago(2 * HOUR) },
          { profile_id: ids.bob.id, aqi_source: 'open-meteo', uv_index: null, mold_risk: null, pollen_level: '{"tree":null,"grass":null,"weed":null}', created_at: ago(5 * 24 * HOUR) },
        ],
      };
      if ('operator_roles' in tables) {
        seed.operator_roles = [
          { profile_id: ids.viewer.id, role: 'viewer', granted_by: 'test' },
          { profile_id: ids.reviewer.id, role: 'reviewer', granted_by: 'test' },
          { profile_id: ids.publisher.id, role: 'publisher', granted_by: 'test' },
          { profile_id: ids.ghost.id, role: 'publisher', granted_by: 'test' },
        ];
      }
      if ('source_ops_audit' in tables) seed.source_ops_audit = audit.map((row) => ({ ...row, actor_profile_id: ids.publisher.id }));
      if ('operations' in tables) seed.operations = operations.map((row) => ({ ...row, profile_id: ids[row.profile_id].id }));
      if (ucmr && 'ucmr5_utilities' in tables) seed.ucmr5_utilities = [{ pwsid: 'NC0000001', pws_name: 'Synthetic A', created_at: ago(30 * 24 * HOUR) }, { pwsid: 'NC0000002', pws_name: 'Synthetic B', created_at: ago(31 * 24 * HOUR) }];
      if (recorder && 'daily_maxima_recorder' in tables) seed.daily_maxima_recorder = [{ singleton: true, recording_from: '2026-10-01', last_run_at: ago(3 * HOUR), last_run: { contexts: 4, refused: 1, skipped: 0, note: 'ignored text' } }];
      return seed;
    },
  });
}

const read = (h, who, url = READ) => h.call(READ, 'GET', { as: who, url });
const history = (h, who, query) => h.call(HISTORY, 'GET', { as: who, url: `${HISTORY}?${new URLSearchParams(query)}` });

/** A command exactly as ProductionSourceOperations.tsx:27 builds one, sent as runtime.ts:97-98 sends it. */
const commandBody = (overrides = {}) => ({
  sourceId: 'census-places',
  sourceRevision: 1,
  target: 'census-places@2026-10-19',
  decision: 'approve',
  reason: 'Checked against the Census release notes.',
  recordedAt: new Date().toISOString(),
  operationId: op(1),
  snapshotRevision: 1,
  ...overrides,
});
const send = (h, who, body = commandBody(), { key = body.operationId, ifMatch = String(body.sourceRevision), headers = {} } = {}) =>
  h.call(COMMAND, 'POST', {
    as: who,
    body,
    headers: { ...(key === null ? {} : { 'idempotency-key': key }), ...(ifMatch === null ? {} : { 'if-match': ifMatch }), ...headers },
  });

const noEmDash = (value, label) => assert.ok(!JSON.stringify(value).includes(EM_DASH), `${label}: no em dash`);

// ------------------------------------------------------------------- who

test('no session is a 401 on all three routes, and nothing is read', async () => {
  const h = harness();
  for (const res of [await read(h, null), await history(h, null, { sourceId: 'census-places', kind: 'audit', cursor: 'a1', sourceRevision: '1' }), await send(h, null)]) {
    assert.equal(res.status, 401);
  }
  assert.equal(h.db.queryLog.length, 0);
});

test('a household account gets the contract\'s denied answer and nothing but its own role is read', async () => {
  const h = harness({ operations: [{ operation_id: op(9), profile_id: 'alice', domain: 'source-operations', kind: 'sourceOps.command', status: 'pending', created_at: ago(1000) }] });
  const res = await read(h, 'alice');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json();
  assert.deepEqual(body, { role: 'denied', revision: 1, sources: [], unresolvedOperations: [], nextCursor: null });
  assert.equal(service.validSourceOpsSnapshot(body), true);
  assert.deepEqual(h.db.queryLog.map((q) => q.table), ['operator_roles']);
  assert.equal(h.db.queryLog[0].filters.some((f) => JSON.stringify(f).includes(h.identities.alice.id)), true, 'the lookup is the caller\'s own id');
});

test('an anonymous account is denied even when a role row names it, without a lookup', async () => {
  const h = harness();
  const body = await (await read(h, 'ghost')).json();
  assert.equal(body.role, 'denied');
  assert.equal(h.db.queryLog.length, 0);
  assert.equal((await send(h, 'ghost')).status, 403);
  assert.equal((await history(h, 'ghost', { sourceId: 'census-places', kind: 'audit', cursor: 'a1', sourceRevision: '1' })).status, 403);
});

test('no query parameter or header can name a role or another identity', async () => {
  const h = harness();
  const res = await h.call(READ, 'GET', { as: 'alice', url: `${READ}?role=publisher&profile_id=${h.identities.publisher.id}`, headers: { 'x-halo-role': 'publisher', 'x-halo-home-context': h.identities.publisher.id } });
  assert.equal((await res.json()).role, 'denied');
});

// ------------------------------------------------------------------- the snapshot

test('an operator sees every source with a stored record, accepted whole by the client\'s validator', async () => {
  const h = harness();
  for (const role of ['viewer', 'reviewer', 'publisher']) {
    const res = await read(h, role);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.role, role);
    assert.equal(service.validSourceOpsSnapshot(body), true, `${role}: validSourceOpsSnapshot`);
    noEmDash(body, role);
    assert.equal(body.revision, 1);
    assert.equal(body.nextCursor, null);
    assert.deepEqual(
      body.sources.map((s) => s.id),
      ['airnow-current', 'open-meteo-air', 'uv-index', 'nws-hourly', 'google-pollen', 'daily-maxima', 'epa-ucmr5', 'census-places', 'census-counties', 'census-nc08', 'ncdeq-lead-inventory'],
      'the ArcGIS cache has no record here (no Redis, no lookup), so it is not listed',
    );
    for (const source of body.sources) {
      assert.deepEqual(source.allowedDecisions, [], `${source.id}: no decision is offered`);
      assert.equal(source.revision, 1);
      assert.equal(source.candidateId, null);
      assert.deepEqual(source.publishedTranslations, []);
      assert.ok(new URL(source.url).protocol === 'https:' && !/key=|token=/i.test(source.url), `${source.id}: a public https url with no key`);
    }
  }
});

test('freshness is what is stored: a recent reading is current, a five-day-old one stale, and a reference file is due a year after retrieval', async () => {
  const h = harness();
  const body = await (await read(h, 'viewer')).json();
  const by = Object.fromEntries(body.sources.map((s) => [s.id, s]));
  assert.equal(by['airnow-current'].freshness, 'current');
  assert.equal(by['open-meteo-air'].freshness, 'stale');
  assert.equal(by['google-pollen'].freshness, 'current', 'alice\'s row holds a tree value');
  assert.equal(by['airnow-current'].nextReview, 'Not scheduled');
  assert.equal(by['daily-maxima'].run.rejected, 1, 'the recorder\'s refused count');
  assert.match(by['daily-maxima'].run.diagnostic, /contexts 4, refused 1, skipped 0\./);
  assert.doesNotMatch(by['daily-maxima'].run.diagnostic, /ignored text/, 'only integer counts are echoed');
  assert.equal(by['epa-ucmr5'].versions[0].count, 2);
  assert.equal(by['epa-ucmr5'].versions[0].evidence, 'partial');
  assert.equal(by['census-places'].publishedId, 'census-places@2026-10-19');
  assert.equal(by['census-places'].nextReview, '2027-10-19');
  assert.equal(by['census-places'].versions[0].status, 'published');
  assert.equal(by['census-places'].versions[0].reviewer, 'No recorded review');
});

test('household tables are read for timestamps only: no household id or value is selected', async () => {
  const h = harness();
  await read(h, 'viewer');
  const scoreReads = h.db.queryLog.filter((q) => q.table === 'daily_scores');
  assert.ok(scoreReads.length >= 5);
  const body = JSON.stringify(await (await read(h, 'viewer')).json());
  for (const who of ['alice', 'bob']) assert.equal(body.includes(h.identities[who].id), false, `${who}'s id is not in the answer`);
});

test('a source with no stored record is left out, never given a status', async () => {
  const h = harness({ scores: [], recorder: false, ucmr: false });
  const body = await (await read(h, 'viewer')).json();
  assert.deepEqual(body.sources.map((s) => s.id), ['census-places', 'census-counties', 'census-nc08', 'ncdeq-lead-inventory']);
  const missing = harness({ tables: without('daily_maxima_recorder', 'ucmr5_utilities') });
  const ids = (await (await read(missing, 'viewer')).json()).sources.map((s) => s.id);
  assert.equal(ids.includes('daily-maxima'), false, 'before 0025 the recorder is not listed');
  assert.equal(ids.includes('epa-ucmr5'), false);
});

test('an operator\'s unresolved list is their own pending source-operations entries only', async () => {
  const h = harness({
    operations: [
      { operation_id: op(11), profile_id: 'viewer', domain: 'source-operations', kind: 'sourceOps.command', status: 'pending', created_at: ago(1000) },
      { operation_id: op(12), profile_id: 'publisher', domain: 'source-operations', kind: 'sourceOps.command', status: 'pending', created_at: ago(1000) },
      { operation_id: op(13), profile_id: 'viewer', domain: 'settings', kind: 'settings.save', status: 'pending', created_at: ago(1000) },
      { operation_id: op(14), profile_id: 'viewer', domain: 'source-operations', kind: 'sourceOps.command', status: 'failed', created_at: ago(1000) },
    ],
  });
  assert.deepEqual((await (await read(h, 'viewer')).json()).unresolvedOperations, [op(11)]);
});

test('a cursor this backend never issued is a 400', async () => {
  const h = harness();
  const res = await read(h, 'viewer', `${READ}?cursor=abc`);
  assert.equal(res.status, 400);
  await expectEnvelope(res, { status: 400, code: 'validation_failed' });
});

test('before 0027 every route is the non-retryable 503; before 0017 an operator\'s read is too', async (t) => {
  muteConsoleError(t);
  const h = harness({ tables: without('operator_roles', 'source_ops_audit') });
  for (const res of [await read(h, 'alice'), await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a1', sourceRevision: '1' }), await send(h, 'reviewer')]) {
    const body = await expectEnvelope(res, { status: 503, code: 'feature_unavailable' });
    assert.equal(body.retryable, false);
  }
  const noLedger = harness({ tables: without('operations') });
  await expectEnvelope(await read(noLedger, 'viewer'), { status: 503, code: 'feature_unavailable' });
  await expectEnvelope(await send(noLedger, 'reviewer'), { status: 503, code: 'feature_unavailable' });
  assert.equal(noLedger.db.rows('source_ops_audit').length, 0, 'nothing audited when the ledger cannot claim');
});

// ------------------------------------------------------------------- history

/** n applied audit rows for one source, ids 1..n. */
const applied = (n, sourceId = 'census-places') =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1, operation_id: op(100 + i), role: 'publisher', source_id: sourceId, source_revision: i + 1, target: `${sourceId}@2026-10-19`,
    decision: 'approve', reason: `Reviewed entry number ${i + 1}.`, outcome: 'applied', refusal: null, recorded_at: ago((30 - i) * 60_000),
  }));

test('history: household accounts are 403, operators page applied entries bound to the current revision', async () => {
  const refused = { id: 99, operation_id: op(199), role: 'reviewer', source_id: 'census-places', source_revision: 26, target: 'x', decision: 'publish', reason: 'Refused attempt reason.', outcome: 'refused', refusal: 'unsupported', recorded_at: ago(1000) };
  const h = harness({ audit: [...applied(25), refused] });
  const snapshot = await (await read(h, 'viewer')).json();
  assert.equal(service.validSourceOpsSnapshot(snapshot), true);
  assert.equal(snapshot.revision, 26);
  const places = snapshot.sources.find((s) => s.id === 'census-places');
  assert.equal(places.revision, 26);
  assert.equal(places.audit.length, 20);
  assert.equal(places.audit[0].requestId, op(124), 'newest first');
  assert.equal(places.audit.some((row) => row.requestId === op(199)), false, 'a refusal is not a decision');
  assert.equal(places.auditCursor, 'a6');

  assert.equal((await history(h, 'alice', { sourceId: 'census-places', kind: 'audit', cursor: 'a6', sourceRevision: '26' })).status, 403);
  const page = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: places.auditCursor, sourceRevision: String(places.revision) });
  assert.equal(page.status, 200);
  const body = await page.json();
  assert.equal(service.validSourceOpsHistory(body), true);
  assert.deepEqual(body.audit.map((row) => row.requestId), [op(104), op(103), op(102), op(101), op(100)]);
  assert.equal(body.nextCursor, null);
  assert.deepEqual(body.versions, []);

  const stale = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a6', sourceRevision: '25' });
  await expectEnvelope(stale, { status: 409, code: 'conflict', extraKeys: ['revision'] });
});

test('history refuses a versions cursor, an unknown source, a bad kind or revision, and a malformed cursor', async () => {
  const h = harness();
  const bad = [
    { sourceId: 'census-places', kind: 'versions', cursor: 'a1', sourceRevision: '1' },
    { sourceId: 'nope', kind: 'audit', cursor: 'a1', sourceRevision: '1' },
    { sourceId: 'census-places', kind: 'everything', cursor: 'a1', sourceRevision: '1' },
    { sourceId: 'census-places', kind: 'audit', cursor: 'a1', sourceRevision: '0' },
    { sourceId: 'census-places', kind: 'audit', cursor: 'a1', sourceRevision: '1.5' },
    { sourceId: 'census-places', kind: 'audit', cursor: 'a0', sourceRevision: '1' },
    { sourceId: 'census-places', kind: 'audit', cursor: '', sourceRevision: '1' },
    { sourceId: 'census-places', kind: 'audit', sourceRevision: '1' },
  ];
  for (const query of bad) assert.equal((await history(h, 'viewer', query)).status, 400, JSON.stringify(query));
});

// ------------------------------------------------------------------- commands

test('a household account and a viewer are 403 with no ledger row and no audit row', async () => {
  const h = harness();
  for (const who of ['alice', 'viewer']) {
    await expectEnvelope(await send(h, who, commandBody({ operationId: op(who === 'alice' ? 2 : 3) }), { key: op(who === 'alice' ? 2 : 3) }), { status: 403, code: 'forbidden' });
  }
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rows('source_ops_audit').length, 0);
});

test('a reviewer\'s decision is refused as unsupported: one failed ledger row, one audit row with the server\'s time, and a receipt the client accepts', async () => {
  const h = harness();
  const body = commandBody({ recordedAt: '2020-01-01T00:00:00Z' });
  const res = await send(h, 'reviewer', body);
  assert.equal(res.status, 200);
  const receipt = await res.json();
  assert.deepEqual(receipt, { operationId: op(1), status: 'failed', reason: 'unsupported', message: 'This decision is not available for this source yet. Nothing was changed.' });
  assert.equal(service.validSourceOpsReceipt(receipt, op(1)), true);
  noEmDash(receipt, 'receipt');

  const [ledger] = h.db.rows('operations');
  assert.equal(ledger.profile_id, h.identities.reviewer.id);
  assert.equal(ledger.domain, 'source-operations');
  assert.equal(ledger.status, 'failed');
  assert.deepEqual(ledger.result, { status: 'failed', reason: 'unsupported', operationId: op(1) });
  const [audit] = h.db.rows('source_ops_audit');
  assert.equal(audit.actor_profile_id, h.identities.reviewer.id);
  assert.equal(audit.role, 'reviewer');
  assert.equal(audit.outcome, 'refused');
  assert.equal(audit.refusal, 'unsupported');
  assert.equal(audit.reason, body.reason);
  assert.ok(Date.parse(audit.recorded_at) > Date.parse('2026-01-01'), 'the audit time is the server\'s, not the client\'s');

  // The refusal is not a decision: the source revision and audit page are unchanged.
  const snapshot = await (await read(h, 'reviewer')).json();
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(snapshot.sources.find((s) => s.id === 'census-places').audit, []);
});

test('a replay answers from the ledger without auditing again; other input under the same id is operation_mismatch', async () => {
  const h = harness();
  await send(h, 'reviewer');
  const again = await send(h, 'reviewer');
  assert.equal(again.status, 200);
  assert.equal((await again.json()).reason, 'unsupported');
  assert.equal(h.db.rows('source_ops_audit').length, 1);
  const changed = await send(h, 'reviewer', commandBody({ reason: 'A different reason entirely.' }));
  const body = await expectEnvelope(changed, { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(body.reason, 'operation_mismatch');
  // Another operator naming the reviewer's id cannot read or reuse it.
  const foreign = await send(h, 'publisher');
  assert.equal((await expectEnvelope(foreign, { status: 409, code: 'conflict', extraKeys: ['reason'] })).reason, 'operation_mismatch');
  assert.equal(h.db.rows('source_ops_audit').length, 1);
});

test('a reviewer\'s publisher decision is forbidden, and a stale revision is changed; both are audited', async () => {
  const h = harness();
  for (const decision of ['publish', 'withdraw', 'rollback', 'publish-translation']) {
    const id = op(20 + ['publish', 'withdraw', 'rollback', 'publish-translation'].indexOf(decision));
    const receipt = await (await send(h, 'reviewer', commandBody({ decision, operationId: id, ...(decision === 'publish-translation' ? { locale: 'es' } : {}) }))).json();
    assert.equal(receipt.reason, 'forbidden', decision);
  }
  assert.equal((await (await send(h, 'publisher', commandBody({ decision: 'publish', operationId: op(30) }))).json()).reason, 'unsupported');
  const stale = commandBody({ operationId: op(31), sourceRevision: 2 });
  assert.equal((await (await send(h, 'publisher', stale)).json()).reason, 'changed');
  assert.equal((await (await send(h, 'publisher', commandBody({ operationId: op(32), snapshotRevision: 3 }))).json()).reason, 'changed');
  assert.deepEqual(h.db.rows('source_ops_audit').map((row) => row.refusal), ['forbidden', 'forbidden', 'forbidden', 'forbidden', 'unsupported', 'changed', 'changed']);
});

test('every malformed command is a 400 decided before anything is recorded', async () => {
  const h = harness();
  const cases = [
    [commandBody({ extra: 1 }), {}],
    [(() => { const b = commandBody(); delete b.reason; return b; })(), {}],
    [commandBody({ operationId: 'not-a-uuid' }), { key: 'not-a-uuid' }],
    [commandBody({ sourceId: 'unknown-source' }), {}],
    [commandBody({ sourceRevision: 0 }), { ifMatch: '0' }],
    [commandBody({ decision: 'delete' }), {}],
    [commandBody({ reason: 'short' }), {}],
    [commandBody({ reason: `Reviewed carefully ${EM_DASH} looks right.` }), {}],
    [commandBody({ reason: 'Reviewed\ncarefully today.' }), {}],
    [commandBody({ reason: 'x'.repeat(501) }), {}],
    [commandBody({ recordedAt: 'yesterday' }), {}],
    [commandBody({ locale: 'fr' }), {}],
    [commandBody({ target: 't'.repeat(201) }), {}],
    [commandBody({ snapshotRevision: -1 }), {}],
    [commandBody(), { key: null }],
    [commandBody(), { key: op(77) }],
    [commandBody(), { ifMatch: null }],
    [commandBody(), { ifMatch: '2' }],
  ];
  for (const [body, options] of cases) {
    const res = await send(h, 'reviewer', body, options);
    assert.equal(res.status, 400, JSON.stringify({ body, options }));
    noEmDash(await res.json(), 'validation');
  }
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rows('source_ops_audit').length, 0);
});

test('a lost answer reconciles through GET /api/operations in the client\'s domain', async () => {
  const h = harness();
  await send(h, 'reviewer');
  const res = await h.call(OPERATIONS, 'GET', { as: 'reviewer', url: `${OPERATIONS}?operationId=${op(1)}&domain=source-operations` });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'failed');
  assert.equal(service.validSourceOpsReceipt(body, op(1)), true);
  // Another operator gets the same 404 as an id that never existed.
  assert.equal((await h.call(OPERATIONS, 'GET', { as: 'publisher', url: `${OPERATIONS}?operationId=${op(1)}&domain=source-operations` })).status, 404);
});

test('replayed ledger states: still running is a retryable 503, reaped or thrown is a terminal 409, a foreign receipt is never replayed', async (t) => {
  const log = muteConsoleError(t);
  const input = { sourceId: 'census-places', sourceRevision: 1, target: 'census-places@2026-10-19', decision: 'approve', reason: 'Checked against the Census release notes.', snapshotRevision: 1, locale: null };
  const row = (status, result, created = ago(1000)) => ({ operation_id: op(1), profile_id: 'reviewer', domain: 'source-operations', kind: 'sourceOps.command', status, result, request_hash: requestHash(input), created_at: created });
  const running = harness({ operations: [row('pending', null)] });
  const busy = await expectEnvelope(await send(running, 'reviewer'), { status: 503, code: 'upstream_unavailable' });
  assert.equal(busy.retryable, true);
  const reaped = harness({ operations: [row('pending', null, ago(10 * 60_000))] });
  assert.equal((await expectEnvelope(await send(reaped, 'reviewer'), { status: 409, code: 'conflict', extraKeys: ['reason'] })).reason, 'abandoned');
  const thrown = harness({ operations: [row('failed', null)] });
  assert.equal((await expectEnvelope(await send(thrown, 'reviewer'), { status: 409, code: 'conflict', extraKeys: ['reason'] })).reason, 'not_applied');
  const foreign = harness({ operations: [row('succeeded', { status: 'succeeded', snapshot: { role: 'publisher' } })] });
  assert.equal((await expectEnvelope(await send(foreign, 'reviewer'), { status: 409, code: 'conflict', extraKeys: ['reason'] })).reason, 'unrecognized_receipt');
  assert.equal(log.mock.calls.some((call) => String(call.arguments[0]).includes('snapshot')), false, 'the foreign receipt is not logged');
  for (const h of [running, reaped, thrown, foreign]) assert.equal(h.db.rows('source_ops_audit').length, 0);
});

test('an audit write that fails settles the claim with no receipt, and the replay is not_applied', async (t) => {
  muteConsoleError(t);
  const h = harness();
  h.db.registerTrigger('source_ops_audit', { before: () => { throw Object.assign(new Error('audit down'), { code: '08006' }); } });
  const res = await send(h, 'reviewer');
  await expectEnvelope(res, { status: 500, code: 'internal_error' });
  assert.equal(h.db.rows('operations')[0].status, 'failed');
  assert.equal(h.db.rows('source_ops_audit').length, 0);
  assert.equal((await expectEnvelope(await send(h, 'reviewer'), { status: 409, code: 'conflict', extraKeys: ['reason'] })).reason, 'not_applied');
});
