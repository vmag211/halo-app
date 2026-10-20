/**
 * B13 adversarial pass: operator source operations, tried against the plan
 * (docs/backend/plans/b13-source-operations.md) and the client's own validators.
 *
 * The happy paths are in routesOperatorSources, contractsB13 and
 * operatorSourcesDb. This file pins the edges: odd role values, a role revoked
 * mid-claim, hostile bodies, headers and cursors, leakage out of household
 * tables, missing migrations, freshness boundaries, a snapshot the client would
 * reject, and the payloads the route writes against the real 0027 checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { createDb, listMigrations } from './db/pgliteHarness.mjs';

const service = await loadFrontend('production/source-operations-service');
const sourceOps = await import('@/lib/sourceOps');
const waterGeo = await import('@/lib/waterGeo');

const READ = '/api/operator/sources';
const HISTORY = '/api/operator/sources/history';
const COMMAND = '/api/operator/sources/commands';
const OPERATIONS = '/api/operations';

const EM_DASH = String.fromCharCode(0x2014);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const op = (n) => `b13b13b1-0000-4000-8000-${String(n).padStart(12, '0')}`;

const IDENTITIES = { alice: {}, viewer: {}, reviewer: {}, publisher: {}, other: {} };
const ALL_TABLES = haloTables('profiles', 'operations', 'operator_roles', 'source_ops_audit', 'daily_scores', 'ucmr5_utilities', 'daily_maxima_recorder');
const without = (...names) => Object.fromEntries(Object.entries(ALL_TABLES).filter(([name]) => !names.includes(name)));

function harness({ tables = ALL_TABLES, roles = null, audit = [], scores = null, recorder = null } = {}) {
  return createRouteHarness({
    identities: IDENTITIES,
    tables,
    seed: (ids) => {
      const seed = {
        profiles: Object.values(ids).map((who) => ({ id: who.id })),
      };
      // Seeding a table that is not declared would create it, so a "missing table" case seeds nothing for it.
      if ('daily_scores' in tables) {
        seed.daily_scores = scores ?? [
          { profile_id: ids.alice.id, aqi_source: 'airnow', uv_index: 3, mold_risk: 'low', pollen_level: '{"tree":2,"grass":null,"weed":null}', created_at: ago(2 * HOUR) },
        ];
      }
      if ('operator_roles' in tables) {
        seed.operator_roles = roles
          ? roles(ids)
          : [
              { profile_id: ids.viewer.id, role: 'viewer', granted_by: 'test' },
              { profile_id: ids.reviewer.id, role: 'reviewer', granted_by: 'test' },
              { profile_id: ids.publisher.id, role: 'publisher', granted_by: 'test' },
            ];
      }
      if ('source_ops_audit' in tables) seed.source_ops_audit = audit.map((row) => ({ ...row, actor_profile_id: ids.publisher.id }));
      if ('daily_maxima_recorder' in tables && recorder) seed.daily_maxima_recorder = [recorder];
      return seed;
    },
  });
}

const read = (h, who, url = READ) => h.call(READ, 'GET', { as: who, url });
const history = (h, who, query) => h.call(HISTORY, 'GET', { as: who, url: `${HISTORY}?${typeof query === 'string' ? query : new URLSearchParams(query)}` });
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
const send = (h, who, body = commandBody(), { key = body.operationId, ifMatch = String(body.sourceRevision), headers = {}, rawBody } = {}) =>
  h.call(COMMAND, 'POST', {
    as: who,
    ...(rawBody === undefined ? { body } : { rawBody }),
    headers: { ...(key === null ? {} : { 'idempotency-key': key }), ...(ifMatch === null ? {} : { 'if-match': ifMatch }), ...headers },
  });

const applied = (n, sourceId = 'census-places', firstId = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: firstId + i, operation_id: op(1000 + firstId + i), role: 'publisher', source_id: sourceId, source_revision: i + 1, target: `${sourceId}@2026-10-19`,
    decision: 'approve', reason: `Reviewed entry number ${firstId + i}.`, outcome: 'applied', refusal: null, recorded_at: ago((500 - i) * 60_000),
  }));

// ------------------------------------------------------------------- roles

test('a role row holding anything but viewer, reviewer or publisher is denied on all three routes, and records nothing', async () => {
  for (const value of ['admin', 'Publisher', 'viewer ', '', 'PUBLISHER', 'publisher\n', 'owner']) {
    const h = harness({ roles: (ids) => [{ profile_id: ids.reviewer.id, role: value, granted_by: 'test' }] });
    const snapshot = await (await read(h, 'reviewer')).json();
    assert.deepEqual(snapshot, { role: 'denied', revision: 1, sources: [], unresolvedOperations: [], nextCursor: null }, JSON.stringify(value));
    assert.equal((await history(h, 'reviewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a1', sourceRevision: '1' })).status, 403, JSON.stringify(value));
    assert.equal((await send(h, 'reviewer')).status, 403, JSON.stringify(value));
    assert.equal(h.db.rows('operations').length, 0);
    assert.equal(h.db.rows('source_ops_audit').length, 0);
  }
});

test('a role revoked or downgraded between the pre-check and the ledger claim is refused as forbidden, and audited with the role found then', async () => {
  const cases = [
    { who: 'reviewer', now: null, body: {}, role: 'denied' },
    { who: 'reviewer', now: 'viewer', body: {}, role: 'viewer' },
    { who: 'publisher', now: 'reviewer', body: { decision: 'publish' }, role: 'reviewer' },
    { who: 'publisher', now: null, body: { decision: 'publish' }, role: 'denied' },
  ];
  for (const c of cases) {
    const h = harness();
    // The claim insert is the first write; the role changes right after it, before the route's own execute step.
    h.db.registerTrigger('operations', {
      after: (_previous, _rows, tables) => {
        const roles = tables('operator_roles');
        const id = h.identities[c.who].id;
        roles.rows = roles.rows.flatMap((row) => (row.profile_id !== id ? [row] : c.now ? [{ ...row, role: c.now }] : []));
      },
    });
    const res = await send(h, c.who, commandBody(c.body));
    assert.equal(res.status, 200, JSON.stringify(c));
    const receipt = await res.json();
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.reason, 'forbidden', JSON.stringify(c));
    const [audit] = h.db.rows('source_ops_audit');
    assert.equal(audit.role, c.role, 'the role found at decision time, not the one at the door');
    assert.equal(audit.refusal, 'forbidden');
    assert.equal(h.db.rows('operations')[0].status, 'failed');
    // The replay now meets the revoked role at the door, and nothing more is written.
    const replay = await send(h, c.who, commandBody(c.body));
    assert.equal(replay.status, c.now === 'reviewer' || c.now === 'viewer' ? (c.now === 'reviewer' ? 200 : 403) : 403);
    assert.equal(h.db.rows('source_ops_audit').length, 1);
  }
});

test('an operator\'s operation id is neither readable nor replayable by a household account, a viewer or another operator', async () => {
  const h = harness();
  await send(h, 'reviewer');
  for (const who of ['alice', 'viewer', 'publisher', 'other']) {
    const res = await h.call(OPERATIONS, 'GET', { as: who, url: `${OPERATIONS}?operationId=${op(1)}&domain=source-operations` });
    assert.equal(res.status, 404, `${who} reads it as if it never existed`);
  }
  // Another operator reusing the id, with the same or other input, gets the terminal mismatch and writes nothing.
  const same = await send(h, 'publisher', commandBody());
  await expectEnvelope(same, { status: 409, code: 'conflict', extraKeys: ['reason'] });
  const other = await send(h, 'publisher', commandBody({ reason: 'A completely different reason.' }));
  await expectEnvelope(other, { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(h.db.rows('source_ops_audit').length, 1);
  assert.equal(h.db.rows('operations').length, 1);
});

test('two requests for one id at the same moment record one audit row; the loser is a retryable 503 or the same refusal', async () => {
  const h = harness();
  const [a, b] = await Promise.all([send(h, 'reviewer'), send(h, 'reviewer')]);
  const statuses = [a.status, b.status].sort();
  assert.ok(statuses.every((status) => status === 200 || status === 503), `statuses ${statuses}`);
  assert.ok(statuses.includes(200));
  assert.equal(h.db.rows('source_ops_audit').length, 1);
});

// ------------------------------------------------------------------- the snapshot

test('no household id, reading value or operator identity leaves the answer', async () => {
  const h = harness({
    scores: [
      { profile_id: '99999999-aaaa-4aaa-8aaa-999999999999', aqi: 987654, aqi_source: 'airnow', uv_index: 8.8765, mold_risk: 'moldy-marker', pollen_level: '{"tree":4242,"grass":null,"weed":null,"note":"pollen-marker"}', created_at: ago(HOUR) },
    ],
    recorder: { singleton: true, recording_from: '2026-10-01', last_run_at: ago(HOUR), last_run: { contexts: 3, refused: 0, '99999999-aaaa': 5, nested: { a: 1 }, big: 1.5, neg: -2, ['x'.repeat(41)]: 7, home: 'home-marker' } },
  });
  for (const who of ['viewer', 'reviewer', 'publisher']) {
    const text = JSON.stringify(await (await read(h, who)).json());
    for (const marker of ['99999999', '987654', '8.8765', 'moldy-marker', '4242', 'pollen-marker', 'home-marker', 'granted_by', 'test"', h.identities[who].id]) {
      assert.equal(text.includes(marker), false, `${who}: ${marker}`);
    }
    assert.match(text, /contexts 3, refused 0\./, 'only the plain integer counts are echoed');
  }
});

test('a read as an operator after an audit entry exists never carries the actor\'s id or the granting text', async () => {
  const h = harness({ audit: applied(2) });
  const text = JSON.stringify(await (await read(h, 'viewer')).json());
  assert.equal(text.includes(h.identities.publisher.id), false);
  assert.equal(text.includes('actor_profile_id'), false);
});

test('missing tables: no daily_scores, no UCMR and no recorder leave only the bundled files, and the snapshot is valid', async () => {
  const h = harness({ tables: without('daily_scores', 'ucmr5_utilities', 'daily_maxima_recorder') });
  const body = await (await read(h, 'viewer')).json();
  assert.deepEqual(body.sources.map((s) => s.id), ['census-places', 'census-counties', 'census-nc08', 'ncdeq-lead-inventory']);
  assert.equal(service.validSourceOpsSnapshot(body), true);
});

test('0027\'s audit table missing: an operator is a 503, a household account still gets the denied answer, and nothing is guessed', async (t) => {
  muteConsoleError(t);
  const h = harness({ tables: without('source_ops_audit') });
  await expectEnvelope(await read(h, 'viewer'), { status: 503, code: 'feature_unavailable' });
  assert.equal((await (await read(h, 'alice')).json()).role, 'denied');
  await expectEnvelope(await send(h, 'reviewer'), { status: 503, code: 'feature_unavailable' });
  assert.equal(h.db.rows('operations').length > 0 ? h.db.rows('operations')[0].status : 'failed', 'failed', 'a claim, if made, is settled failed, never pending');
});

test('the whole registry, the ArcGIS cache included, is accepted by the client\'s validator and carries no em dash', async () => {
  const stamp = Date.now() - 5 * HOUR;
  const geo = await waterGeo.getWaterGeo(['NC0100001'], { store: null, now: stamp, force: true, fetchImpl: async () => ({ ok: true, json: async () => ({ features: [] }) }) });
  assert.equal(geo.failedBatches, 0, 'the stub primed the cache');
  const h = harness({ recorder: { singleton: true, recording_from: '2026-10-01', last_run_at: ago(HOUR), last_run: { contexts: 1, refused: 0 } } });
  const body = await (await read(h, 'publisher')).json();
  assert.ok(body.sources.some((s) => s.id === 'arcgis-water-boundaries'), 'the cache record is listed');
  assert.equal(service.validSourceOpsSnapshot(body), true);
  assert.equal(JSON.stringify(body).includes(EM_DASH), false);
  assert.deepEqual(body.sources.map((s) => s.id).sort(), [...sourceOps.SOURCE_IDS].sort().filter((id) => body.sources.some((s) => s.id === id)));
  for (const source of body.sources) {
    assert.ok(source.versions.length <= 1 && (source.publishedId === null) === (source.versions.length === 0), source.id);
    assert.equal(source.run.attempts, 1);
    assert.ok(service.validSource(source), source.id);
  }
});

test('freshness boundaries: a feed is current at exactly 36 hours and stale a millisecond later; a reference file at 365 days likewise', async () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');
  const make = (feedAt) =>
    harness({ scores: [{ profile_id: '00000000-0000-4000-8000-0000000000aa', aqi_source: 'airnow', created_at: new Date(feedAt).toISOString() }] }).db;
  const feedEdge = await sourceOps.sourceOpsSnapshot(make(now - 36 * HOUR), { role: 'viewer', profileId: '00000000-0000-4000-8000-0000000000bb', now });
  assert.equal(feedEdge.sources.find((s) => s.id === 'airnow-current').freshness, 'current');
  const feedOver = await sourceOps.sourceOpsSnapshot(make(now - 36 * HOUR - 1), { role: 'viewer', profileId: '00000000-0000-4000-8000-0000000000bb', now });
  assert.equal(feedOver.sources.find((s) => s.id === 'airnow-current').freshness, 'stale');
  assert.equal(service.validSourceOpsSnapshot(feedOver), true, 'stale is a valid state the screen shows');
  // The bundled files were retrieved 2026-10-19 (nextReview 2027-10-19): current a year on, stale after.
  const retrieved = Date.parse(feedEdge.sources.find((s) => s.id === 'census-places').versions[0].retrieved);
  const edge = await sourceOps.sourceOpsSnapshot(make(now), { role: 'viewer', profileId: '00000000-0000-4000-8000-0000000000bb', now: retrieved + 365 * DAY });
  const over = await sourceOps.sourceOpsSnapshot(make(now), { role: 'viewer', profileId: '00000000-0000-4000-8000-0000000000bb', now: retrieved + 365 * DAY + 1 });
  assert.equal(edge.sources.find((s) => s.id === 'census-places').freshness, 'current');
  assert.equal(over.sources.find((s) => s.id === 'census-places').freshness, 'stale');
});

test('pollen: only a stored number counts, an unparseable or null row is skipped, and the last 50 rows are the horizon', async () => {
  const row = (pollen, at) => ({ profile_id: '00000000-0000-4000-8000-0000000000aa', pollen_level: pollen, created_at: new Date(at).toISOString() });
  const sources = async (scores) => (await (await read(harness({ scores }), 'viewer')).json()).sources.map((s) => s.id);
  assert.equal((await sources([row('not json', Date.now() - HOUR), row('null', Date.now() - 2 * HOUR), row('"str"', Date.now() - 3 * HOUR), row('{"tree":null}', Date.now() - 4 * HOUR)])).includes('google-pollen'), false);
  const body = await (await read(harness({ scores: [row('{broken', Date.now() - HOUR), row('{"weed":0}', Date.now() - 7 * HOUR)] }), 'viewer')).json();
  const pollen = body.sources.find((s) => s.id === 'google-pollen');
  assert.ok(pollen, 'zero is a number');
  assert.equal(pollen.freshness, 'current');
  const many = Array.from({ length: 50 }, (_, i) => row('{"tree":null}', Date.now() - (i + 1) * 60_000));
  assert.equal((await sources([...many, row('{"tree":3}', Date.now() - 2 * DAY)])).includes('google-pollen'), false, 'the 51st stored row is outside the horizon (documented)');
});

test('a stored timestamp with no zone is read as UTC, and an unreadable one leaves the source out rather than inventing a time', async () => {
  const stamp = new Date(Date.now() - 2 * HOUR).toISOString().slice(0, 19).replace('T', ' ');
  const good = await (await read(harness({ scores: [{ profile_id: '00000000-0000-4000-8000-0000000000aa', aqi_source: 'airnow', created_at: stamp }] }), 'viewer')).json();
  const airnow = good.sources.find((s) => s.id === 'airnow-current');
  assert.equal(airnow.freshness, 'current');
  assert.match(airnow.lastSuccess, /Z$/);
  const bad = await (await read(harness({ scores: [{ profile_id: '00000000-0000-4000-8000-0000000000aa', aqi_source: 'airnow', created_at: 'garbage' }] }), 'viewer')).json();
  assert.equal(bad.sources.some((s) => s.id === 'airnow-current'), false);
});

test('bundled headers with an em dash are scrubbed wherever a header string is echoed', async () => {
  const counties = (await import('@/lib/data/ncCounties.json', { with: { type: 'json' } })).default;
  const lead = (await import('@/lib/data/leadInventoryNC.json', { with: { type: 'json' } })).default;
  const savedCounties = counties.source;
  const savedLead = lead.source;
  counties.source = `Census ${EM_DASH} counties ${EM_DASH}2020`;
  lead.source = `NC DEQ ${EM_DASH} inventory`;
  try {
    const body = await (await read(harness(), 'viewer')).json();
    assert.equal(JSON.stringify(body).includes(EM_DASH), false, 'no em dash anywhere in the snapshot');
    assert.equal(service.validSourceOpsSnapshot(body), true);
  } finally {
    counties.source = savedCounties;
    lead.source = savedLead;
  }
});

// ------------------------------------------------------------------- bodies and headers

test('bodies that are not an object are a 400, never a 500, and nothing is recorded', async () => {
  const h = harness();
  for (const rawBody of ['null', '[]', '[1,2]', '123', '"text"', 'true', '{', '{"a":', 'not json', '\u0000']) {
    const res = await send(h, 'reviewer', undefined, { rawBody, key: op(1), ifMatch: '1' });
    assert.equal(res.status, 400, JSON.stringify(rawBody));
  }
  // An empty body is `{}`: every field is required.
  assert.equal((await send(h, 'reviewer', undefined, { rawBody: '', key: op(1), ifMatch: '1' })).status, 400);
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rows('source_ops_audit').length, 0);
});

test('an oversize body is a 413 before the ledger, by declared length and by actual bytes', async () => {
  const h = harness();
  const huge = JSON.stringify(commandBody({ reason: 'x'.repeat(5000) }));
  const res = await send(h, 'reviewer', undefined, { rawBody: huge, key: op(1), ifMatch: '1' });
  await expectEnvelope(res, { status: 413, code: 'payload_too_large' });
  const lying = await send(h, 'reviewer', undefined, { rawBody: huge, key: op(1), ifMatch: '1', headers: { 'content-length': '10' } });
  assert.equal(lying.status, 413);
  assert.equal(h.db.rows('operations').length, 0);
});

test('numbers sent as strings, floats and out-of-range revisions are 400', async () => {
  const h = harness();
  const cases = [
    { sourceRevision: '1' }, { snapshotRevision: '1' }, { sourceRevision: 1.5 }, { snapshotRevision: 2.5 }, { sourceRevision: 2 ** 53 },
    { sourceRevision: null }, { snapshotRevision: null }, { target: 5 }, { target: null }, { reason: 12345678 }, { decision: ['approve'] },
    { sourceId: ['census-places'] }, { recordedAt: 0 }, { recordedAt: 'x'.repeat(41) }, { locale: null }, { operationId: 5 }, { operationId: null },
  ];
  for (const overrides of cases) {
    const body = commandBody(overrides);
    const res = await send(h, 'reviewer', body, { key: op(1), ifMatch: String(body.sourceRevision) });
    assert.equal(res.status, 400, JSON.stringify(overrides));
  }
  assert.equal(h.db.rows('operations').length, 0);
});

test('prototype-polluting and duplicate-looking keys are unknown fields, not accepted', async () => {
  const h = harness();
  const base = JSON.stringify(commandBody());
  for (const extra of ['"__proto__":{"role":"publisher"}', '"constructor":1', '"role":"publisher"', '"profileId":"x"', '"operationID":"x"']) {
    const res = await send(h, 'reviewer', undefined, { rawBody: base.replace(/\}$/, `,${extra}}`), key: op(1), ifMatch: '1' });
    assert.equal(res.status, 400, extra);
  }
  assert.equal(h.db.rows('operations').length, 0);
});

test('Idempotency-Key and operationId: case and surrounding space are tolerated, a different id is not, and the receipt is the lower-case id', async () => {
  const h = harness();
  const upper = op(1).toUpperCase();
  const res = await send(h, 'reviewer', commandBody({ operationId: upper }), { key: `  ${upper}  `, ifMatch: ' 1 ' });
  assert.equal(res.status, 200);
  const receipt = await res.json();
  assert.equal(receipt.operationId, op(1));
  assert.equal(service.validSourceOpsReceipt(receipt, op(1)), true, 'the client\'s lower-case id still matches');
  // Mixed case across body and header is the same id.
  assert.equal((await send(h, 'reviewer', commandBody({ operationId: op(1) }), { key: upper })).status, 200);
  assert.equal(h.db.rows('source_ops_audit').length, 1);
  // A different header id is refused.
  assert.equal((await send(h, 'reviewer', commandBody({ operationId: op(2) }), { key: op(3) })).status, 400);
});

test('If-Match must be the bare decimal revision: quoted, weak, padded with zeros, a list and a wildcard are 400', async () => {
  const h = harness();
  for (const ifMatch of ['"1"', 'W/"1"', '01', '1, 1', '*', '1.0', '+1', '', 'one']) {
    assert.equal((await send(h, 'reviewer', commandBody(), { ifMatch })).status, 400, JSON.stringify(ifMatch));
  }
  assert.equal(h.db.rows('operations').length, 0);
});

test('reason bounds: 8 characters after trimming, 500 at most, no control, no em dash, no lone surrogate; the edges are accepted', async () => {
  const h = harness();
  const nbsp = String.fromCharCode(0xa0);
  const rejected = [
    'abcdefg', ' abcdefg', 'abcdefg ', 'abc' + nbsp.repeat(10), ' '.repeat(20), 'x'.repeat(501), 'tab\there ok', 'line\u0085x'.padEnd(8, 'y') + '\u0000',
    `plain ${EM_DASH} text`, 'broken \ud800 surrogate', 'broken \udc00 surrogate', '\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
  ];
  for (const [index, reason] of rejected.entries()) {
    const body = commandBody({ operationId: op(100 + index), reason });
    assert.equal((await send(h, 'reviewer', body)).status, 400, JSON.stringify(reason));
  }
  const accepted = ['abcdefgh', 'x'.repeat(500), '\u{1F33F}'.repeat(250), 'café au lait, checked'];
  for (const [index, reason] of accepted.entries()) {
    const res = await send(h, 'reviewer', commandBody({ operationId: op(200 + index), reason }));
    assert.equal(res.status, 200, JSON.stringify(reason).slice(0, 40));
  }
  assert.equal(h.db.rows('source_ops_audit').length, accepted.length);
});

test('target is text of at most 200 characters with no control and no lone surrogate (Postgres cannot store one)', async () => {
  const h = harness();
  const bad = ['t'.repeat(201), 'a\u0000b', 'a\nb', 'broken \ud800', '\udc00 broken', 'x\ud83dy'];
  for (const [index, target] of bad.entries()) {
    const res = await send(h, 'reviewer', commandBody({ operationId: op(300 + index), target }));
    assert.equal(res.status, 400, JSON.stringify(target));
  }
  for (const [index, target] of ['', 't'.repeat(200), '\u{1F33F}census'].entries()) {
    assert.equal((await send(h, 'reviewer', commandBody({ operationId: op(400 + index), target }))).status, 200, JSON.stringify(target));
  }
});

// ------------------------------------------------------------------- history cursors and revisions

test('hostile history cursors, ids and revisions are a 400 or 409, never a 500, and never read another source', async (t) => {
  const log = muteConsoleError(t);
  const h = harness({ audit: [...applied(3, 'census-places', 1), ...applied(3, 'census-counties', 10)] });
  const cursors = [
    'a', 'a0', 'a-1', 'a+1', 'a1.5', 'a1e3', 'a01', 'A1', ' a1', 'a1 ', 'a1,2', 'a1;drop', 'a%00', 'a١', 'a１', 'b1', '1', 'a' + '9'.repeat(16), 'a' + '9'.repeat(17), 'a' + '9'.repeat(5000),
    'a9007199254740992', '\u{1F33F}', 'a1&cursor=a2', "a1' or '1'='1",
  ];
  for (const cursor of cursors) {
    const res = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor, sourceRevision: '4' });
    assert.ok([400, 409].includes(res.status), `${JSON.stringify(cursor).slice(0, 30)} gave ${res.status}`);
  }
  // The largest cursor that is a safe integer is a real, empty page: bound to the revision, and it names nothing of another source.
  const edge = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a9007199254740991', sourceRevision: '4' });
  assert.equal(edge.status, 200);
  assert.deepEqual((await edge.json()).audit.map((row) => row.requestId), [op(1003), op(1002), op(1001)]);
  const foreign = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a12', sourceRevision: '4' });
  assert.deepEqual((await foreign.json()).audit.map((row) => row.requestId), [op(1003), op(1002), op(1001)], 'counties\' ids 10 to 12 are not census-places');
  const counties = await history(h, 'viewer', { sourceId: 'census-counties', kind: 'audit', cursor: 'a11', sourceRevision: '4' });
  assert.deepEqual((await counties.json()).audit.map((row) => row.requestId), [op(1010)]);
  const revisions = ['0', '-1', '1.5', '1e3', '0x4', ' 4', '4 ', '04', '4294967296000000', '99999999999', 'abc', '', '٤'];
  for (const sourceRevision of revisions) {
    const res = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a3', sourceRevision });
    assert.ok([400, 409].includes(res.status), `revision ${JSON.stringify(sourceRevision)} gave ${res.status}`);
  }
  assert.equal(log.mock.calls.length, 0, 'nothing was logged as an internal error');
});

test('history is exhaustive and stable across pages, and a decision landing mid-walk is a 409 with the new revision', async () => {
  const h = harness({ audit: applied(45) });
  const snapshot = await (await read(h, 'viewer')).json();
  const source = snapshot.sources.find((s) => s.id === 'census-places');
  assert.equal(source.revision, 46);
  const seen = source.audit.map((row) => row.requestId);
  let cursor = source.auditCursor;
  let pages = 0;
  while (cursor) {
    const res = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor, sourceRevision: String(source.revision) });
    assert.equal(res.status, 200);
    const page = await res.json();
    assert.equal(service.validSourceOpsHistory(page), true);
    seen.push(...page.audit.map((row) => row.requestId));
    cursor = page.nextCursor;
    pages += 1;
  }
  assert.equal(pages, 2);
  assert.equal(seen.length, 45);
  assert.equal(new Set(seen).size, 45, 'no entry twice, none missing');
  // An applied entry arrives: the held revision is now stale.
  const { error } = await h.db.from('source_ops_audit').insert({ ...applied(1, 'census-places', 46)[0], actor_profile_id: h.identities.publisher.id });
  assert.equal(error, null);
  const stale = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a26', sourceRevision: '46' });
  const body = await expectEnvelope(stale, { status: 409, code: 'conflict', extraKeys: ['revision'] });
  assert.equal(body.revision, 47);
});

test('history for a source with no stored record is still answerable, and an unknown source is a 400', async () => {
  const h = harness({ tables: without('daily_scores') });
  const ok = await history(h, 'viewer', { sourceId: 'airnow-current', kind: 'audit', cursor: 'a5', sourceRevision: '1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { sourceId: 'airnow-current', sourceRevision: 1, kind: 'audit', versions: [], audit: [], nextCursor: null });
  assert.equal((await history(h, 'viewer', { sourceId: 'Airnow-Current', kind: 'audit', cursor: 'a5', sourceRevision: '1' })).status, 400);
  assert.equal((await history(h, 'viewer', { sourceId: 'airnow-current%00', kind: 'audit', cursor: 'a5', sourceRevision: '1' })).status, 400);
});

test('only applied entries are paged and counted: a refusal never moves a revision or appears in history', async () => {
  const refused = (id) => ({ id, operation_id: op(2000 + id), role: 'reviewer', source_id: 'census-places', source_revision: 1, target: 'x', decision: 'approve', reason: 'A refused attempt.', outcome: 'refused', refusal: 'unsupported', recorded_at: ago(1000) });
  const h = harness({ audit: [...Array.from({ length: 30 }, (_, i) => refused(i + 1)), ...applied(1, 'census-places', 31)] });
  const snapshot = await (await read(h, 'viewer')).json();
  assert.equal(snapshot.revision, 2);
  const source = snapshot.sources.find((s) => s.id === 'census-places');
  assert.equal(source.audit.length, 1);
  assert.equal(source.auditCursor, null);
  const page = await history(h, 'viewer', { sourceId: 'census-places', kind: 'audit', cursor: 'a31', sourceRevision: '2' });
  assert.deepEqual((await page.json()).audit, []);
});

// ------------------------------------------------------------------- a refusal is never success

test('every decision, from every operator role, answers failed: never succeeded, never covering the command, always valid for the client', async () => {
  const h = harness();
  let n = 500;
  for (const who of ['reviewer', 'publisher']) {
    for (const decision of service.sourceDecisions) {
      n += 1;
      const body = commandBody({ operationId: op(n), decision, ...(decision === 'publish-translation' || decision === 'translation' ? { locale: 'es' } : {}) });
      const res = await send(h, who, body);
      assert.equal(res.status, 200);
      const receipt = await res.json();
      assert.equal(receipt.status, 'failed', `${who} ${decision}`);
      assert.ok(receipt.message && !receipt.message.includes(EM_DASH));
      assert.equal(receipt.snapshot, undefined, 'a refusal carries no snapshot to be mistaken for the new state');
      assert.equal(service.validSourceOpsReceipt(receipt, body.operationId), true);
      assert.equal(service.sourceReceiptCoversCommand(receipt, body), false);
      // The reconcile path says the same.
      const again = await h.call(OPERATIONS, 'GET', { as: who, url: `${OPERATIONS}?operationId=${body.operationId}&domain=source-operations` });
      const reconciled = await again.json();
      assert.equal(reconciled.status, 'failed');
      assert.equal(service.sourceReceiptCoversCommand(reconciled, body), false);
    }
  }
  const snapshot = await (await read(h, 'publisher')).json();
  assert.equal(snapshot.revision, 1, 'sixteen refusals moved nothing');
  assert.ok(snapshot.sources.every((s) => s.revision === 1 && s.audit.length === 0 && s.allowedDecisions.length === 0));
  assert.deepEqual(h.db.rows('source_ops_audit').map((row) => row.outcome), Array(16).fill('refused'));
});

test('an audit row that cannot be written leaves no receipt of success, and the unresolved list does not strand the screen', async (t) => {
  muteConsoleError(t);
  const h = harness();
  h.db.registerTrigger('source_ops_audit', { before: () => { throw Object.assign(new Error('audit down'), { code: '08006' }); } });
  const res = await send(h, 'reviewer');
  assert.equal(res.status, 500);
  const snapshot = await (await read(h, 'reviewer')).json();
  assert.deepEqual(snapshot.unresolvedOperations, [], 'a failed claim is settled, so the screen is not locked forever');
  const reconciled = await (await h.call(OPERATIONS, 'GET', { as: 'reviewer', url: `${OPERATIONS}?operationId=${op(1)}&domain=source-operations` })).json();
  assert.equal(reconciled.status, 'failed');
});

// ------------------------------------------------------------------- the real 0027 checks

test('every audit payload the route can write satisfies the real 0027 constraints (PGlite)', async () => {
  const db = await createDb();
  try {
    await db.applyMigration(listMigrations().find((m) => m.number === 27));
    // A stand-in for the real database's id and time defaults is the table's own; the route's columns are what is inserted.
    const h = harness();
    h.db.registerTrigger('operations', {
      after: (_previous, _rows, tables) => {
        const roles = tables('operator_roles');
        if (h.revoke) roles.rows = roles.rows.filter((row) => row.profile_id !== h.identities[h.revoke].id);
      },
    });
    const bodies = [
      [ 'reviewer', commandBody({ operationId: op(601) }) ],
      [ 'reviewer', commandBody({ operationId: op(602), decision: 'publish' }) ],
      [ 'publisher', commandBody({ operationId: op(603), sourceRevision: 9 }) ],
      [ 'publisher', commandBody({ operationId: op(604), decision: 'publish-translation', locale: 'es', target: 't'.repeat(200), reason: 'x'.repeat(500) }) ],
      [ 'publisher', commandBody({ operationId: op(605), target: '', reason: '\u{1F33F}'.repeat(250) }) ],
    ];
    for (const [who, body] of bodies) await send(h, who, body);
    h.revoke = 'reviewer';
    await send(h, 'reviewer', commandBody({ operationId: op(606) }));
    const inserts = h.db.queryLog.filter((q) => q.table === 'source_ops_audit' && q.operation === 'insert');
    assert.equal(inserts.length, 6);
    assert.deepEqual(inserts.map((q) => q.rows[0].refusal), ['unsupported', 'forbidden', 'changed', 'unsupported', 'unsupported', 'forbidden']);
    for (const q of inserts) {
      const row = q.rows[0];
      const columns = Object.keys(row);
      await db.asService((tx) => tx.query(`insert into public.source_ops_audit (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row)), { commit: true });
    }
    assert.equal((await db.query('select count(*)::int as n from public.source_ops_audit')).rows[0].n, 6);
    // The same operation id twice is the table's own refusal, which the ledger makes unreachable.
    const dup = inserts[0].rows[0];
    const columns = Object.keys(dup);
    await assert.rejects(db.asService((tx) => tx.query(`insert into public.source_ops_audit (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(dup))), /unique|duplicate/i);
    assert.ok(listMigrations().some((m) => m.number === 27));
  } finally {
    await db.close();
  }
});
