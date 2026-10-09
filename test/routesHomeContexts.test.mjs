/**
 * GET /api/home-contexts, GET /api/home-contexts/[id] and PATCH /api/home-contexts/[id]
 * (migration 0016) through the route harness, with the stand-ins for the two
 * home context functions (test/helpers/fakeHomeContext.mjs) registered where
 * the test says "0016 applied". The stand-ins are held to the real functions by
 * test/homeContextFake.test.mjs, so route-to-function wiring is verified here
 * against them, not against PGlite.
 *
 * Alice has three homes (two closed, one current); bob has one. Every response
 * is checked for the envelope and X-Request-Id, and every statement for the
 * owner filter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { contextId, MISSING_ID } from './helpers/isolationSeed.mjs';
import { fullContextRow, homeContextHandlers, registerHomeContextRpcs, UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS } from './helpers/fakeHomeContext.mjs';

const { contextSummary } = await import('../lib/homeContext.js');

const TABLES = ['profiles', 'home_contexts', 'daily_scores'];
const YEAR = new Date().getFullYear();
const ALICE_1 = contextId('alice', 1);
const ALICE_2 = contextId('alice', 2);
const ALICE_3 = contextId('alice', 3);
const BOB_1 = contextId('bob', 1);
const ROUTE = '/api/home-contexts/[id]';
const SUMMARY_KEYS = [
  'backfill', 'closed_reason', 'current', 'effective_from', 'effective_to', 'home_year', 'id', 'location', 'match_method',
  'origin', 'pwsid', 'revision', 'sequence', 'service_area_status', 'water_source',
].sort();
const NOT_FOUND = 'We could not find that home.';
const UNAVAILABLE = 'Home history is not available yet.';

/** Alice's three homes and bob's one, as 0016 would hold them. Seeded out of order on purpose. */
function contextRows({ alice, bob }) {
  const aliceHome = (n, extra) => fullContextRow({
    id: contextId('alice', n), profile_id: alice.id, sequence: n, onboard_request_id: `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...extra,
  });
  return [
    aliceHome(2, {
      revision: 2, origin: 'move', lat: 35.227, lng: -80.843, county: 'Mecklenburg County', state: 'NC', pwsid: 'NC0160010',
      service_area_status: 'measured', water_source: 'well', home_year: 1962, match_method: 'mapbox_geocode_arcgis_point',
      backfill_state: 'partial', backfill_from: '2026-02-01', backfill_to: '2026-03-01', backfill_updated_at: '2026-03-01T05:00:00Z',
      effective_from: '2026-03-01T12:00:00Z', effective_to: '2026-06-01T12:00:00Z', closed_reason: 'moved',
    }),
    aliceHome(3, {
      revision: 4, origin: 'move', lat: 35.409, lng: -80.58, county: 'Cabarrus County', state: 'NC', pwsid: 'NC0125010',
      service_area_status: 'measured', water_source: 'utility', home_year: 1988, match_method: 'mapbox_geocode_arcgis_point',
      backfill_state: 'complete', backfill_from: '2026-05-04', backfill_to: '2026-06-01', backfill_updated_at: '2026-06-01T12:05:00Z',
      effective_from: '2026-06-01T12:00:00Z', effective_to: null, closed_reason: null,
    }),
    aliceHome(1, {
      revision: 1, origin: 'legacy_migration', lat: 35.1, lng: -80.6, county: 'Union County', state: 'NC', pwsid: null,
      water_source: 'utility', home_year: 2001, match_method: 'legacy_profile', backfill_state: 'not_applicable',
      effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-03-01T12:00:00Z', closed_reason: 'moved',
    }),
    fullContextRow({
      id: BOB_1, profile_id: bob.id, sequence: 1, revision: 1, origin: 'onboard', lat: 35.5, lng: -80.9, county: 'Iredell County',
      state: 'NC', pwsid: 'NC0149010', service_area_status: 'measured', water_source: 'utility', home_year: 1970,
      match_method: 'mapbox_geocode_arcgis_point', onboard_request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', backfill_state: 'complete',
      effective_from: '2026-02-01T12:00:00Z', created_at: '2026-02-01T12:00:00Z', updated_at: '2026-02-01T12:00:00Z',
    }),
  ];
}

/**
 * `rpc: true` registers the stand-ins (0016 applied). Without it the functions answer PGRST202,
 * and `tables` without home_contexts makes the table answer PGRST205, as before 0016.
 */
function harness({ rpc = true, tables = TABLES, identities } = {}) {
  const h = createRouteHarness({
    tables: haloTables(...tables),
    identities,
    seed: (ids) => {
      const rows = {
        profiles: [
          { id: ids.alice.id, lat: 35.409, lng: -80.58, county: 'Cabarrus County', state: 'NC', pwsid: 'NC0125010', water_source: 'utility', home_year: 1988 },
          { id: ids.bob.id, lat: 35.5, lng: -80.9, county: 'Iredell County', state: 'NC', pwsid: 'NC0149010', water_source: 'utility', home_year: 1970 },
          ...(ids.carol ? [{ id: ids.carol.id }] : []),
        ],
        home_contexts: contextRows(ids),
      };
      return Object.fromEntries(Object.entries(rows).filter(([table]) => tables.includes(table)));
    },
  });
  if (rpc) registerHomeContextRpcs(h.db);
  return h;
}

const list = (h, options = {}) => h.call('/api/home-contexts', 'GET', { as: 'alice', ...options });
const detail = (h, id, options = {}) => h.call(ROUTE, 'GET', { as: 'alice', url: `/api/home-contexts/${encodeURIComponent(id)}`, params: { id }, ...options });
const patch = (h, id, body, options = {}) =>
  h.call(ROUTE, 'PATCH', { as: 'alice', url: `/api/home-contexts/${encodeURIComponent(id)}`, params: { id }, body, ...options });
const patchRaw = (h, id, rawBody, options = {}) =>
  h.call(ROUTE, 'PATCH', { as: 'alice', url: `/api/home-contexts/${id}`, params: { id }, rawBody, ...options });
const seeded = (h, id) => h.db.rows('home_contexts').find((row) => row.id === id);
const snapshot = (h) => JSON.stringify(Object.fromEntries(['profiles', 'home_contexts'].map((table) => [table, h.db.rows(table)])));

/** Everything about a response a client could tell apart, except its request id. */
async function observable(res) {
  const body = await res.json();
  delete body.request_id;
  const headers = [...res.headers.entries()].filter(([name]) => name !== 'x-request-id');
  return { status: res.status, body, headers };
}

/** Every read of `table` answers with `error`, like a database that refuses the statement. */
function failReads(h, table, error) {
  const from = h.db.from.bind(h.db);
  h.db.from = (name) => {
    if (name !== table) return from(name);
    const chain = new Proxy({}, {
      get: (_target, property) => (property === 'then' ? (resolve) => resolve({ data: null, count: null, error }) : () => chain),
    });
    return chain;
  };
}

// ------------------------------------------------------------- GET /api/home-contexts

test('GET /api/home-contexts lists the household\'s homes newest first, with the current one named', async () => {
  const h = harness();
  const res = await list(h);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['count', 'current_id', 'items', 'truncated']);
  assert.deepEqual(body.items.map((item) => item.sequence), [3, 2, 1]);
  assert.deepEqual([body.current_id, body.count, body.truncated], [ALICE_3, 3, false]);
  assert.deepEqual(body.items, [ALICE_3, ALICE_2, ALICE_1].map((id) => contextSummary(seeded(h, id))));
  for (const item of body.items) assert.deepEqual(Object.keys(item).sort(), SUMMARY_KEYS);
  assert.deepEqual(body.items[0], {
    id: ALICE_3, sequence: 3, revision: 4, origin: 'move', current: true,
    location: { lat: 35.409, lng: -80.58, county: 'Cabarrus County', state: 'NC' },
    pwsid: 'NC0125010', service_area_status: 'measured', water_source: 'utility', home_year: 1988,
    match_method: 'mapbox_geocode_arcgis_point',
    backfill: { state: 'complete', from: '2026-05-04', to: '2026-06-01', updated_at: '2026-06-01T12:05:00Z' },
    effective_from: '2026-06-01T12:00:00Z', effective_to: null, closed_reason: null,
  });
  assert.deepEqual(body.items.map((item) => item.current), [true, false, false]);
  const text = JSON.stringify(body);
  for (const secret of [h.identities.alice.id, 'onboard_request_id', 'profile_id', 'aaaa-4aaa-8aaa', BOB_1, 'Iredell']) {
    assert.equal(text.includes(secret), false, `the list does not carry ${secret}`);
  }
});

test('GET /api/home-contexts reads one bounded, owner-scoped page and writes nothing', async () => {
  const h = harness();
  const before = snapshot(h);
  await list(h);
  assert.equal(h.db.queryLog.length, 1);
  const [query] = h.db.queryLog;
  assert.deepEqual([query.table, query.operation], ['home_contexts', 'select']);
  auditOwnerScope(h.db.queryLog, h.identities.alice.id, 'GET /api/home-contexts');
  assert.equal(snapshot(h), before);
  assert.deepEqual(h.db.rpcCalls, []);
});

test('GET /api/home-contexts for a household that has not onboarded is a true empty answer, not an error', async () => {
  const h = harness({ identities: { alice: {}, bob: {}, carol: {} } });
  const res = await list(h, { as: 'carol' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items: [], current_id: null, count: 0, truncated: false });
});

test('GET /api/home-contexts reads at most 100 homes, newest first, and says when there are more', async () => {
  const h = harness();
  const alice = h.identities.alice.id;
  h.db.seed('home_contexts', Array.from({ length: 97 }, (_, n) => fullContextRow({
    id: `a11ce000-3333-4000-8000-${String(n).padStart(12, '0')}`, profile_id: alice, sequence: 4 + n, revision: 1, origin: 'move',
    lat: 35, lng: -80, effective_from: '2026-07-01T00:00:00Z', effective_to: '2026-07-01T00:00:00Z', closed_reason: 'moved',
  })));
  const exactly = await (await list(h)).json();
  assert.deepEqual([exactly.count, exactly.truncated, exactly.items[0].sequence, exactly.items.at(-1).sequence], [100, false, 100, 1]);
  assert.equal(exactly.current_id, ALICE_3, 'exactly 100 homes: all of them, nothing cut');

  // 101 homes: the oldest is cut. A move always opens the highest sequence, so the current home is on the page.

  const capped = harness();
  capped.db.seed('home_contexts', Array.from({ length: 98 }, (_, n) => fullContextRow({
    id: `a11ce000-3333-4000-8000-${String(n).padStart(12, '0')}`, profile_id: capped.identities.alice.id, sequence: 3 - 100 + n,
    revision: 1, origin: 'move', lat: 35, lng: -80, effective_from: '2025-01-01T00:00:00Z', effective_to: '2025-01-01T00:00:00Z', closed_reason: 'moved',
  })));
  const page = await (await list(capped)).json();
  assert.deepEqual([page.count, page.truncated, page.items[0].id, page.current_id], [100, true, ALICE_3, ALICE_3]);
  assert.equal(capped.db.queryLog[0].filters.length, 1, 'the owner filter is the only filter');
});

test('GET /api/home-contexts before migration 0016 is a 503 saying the feature is not available yet, never an empty list', async () => {
  for (const [label, h] of [
    ['table missing (PGRST205)', harness({ rpc: false, tables: ['profiles', 'daily_scores'] })],
    ['relation missing (42P01)', (() => {
      const broken = harness();
      failReads(broken, 'home_contexts', { code: '42P01', message: 'relation "public.home_contexts" does not exist' });
      return broken;
    })()],
  ]) {
    const body = await expectEnvelope(await list(h), { status: 503, code: 'feature_unavailable', retryable: false });
    assert.equal(body.error, UNAVAILABLE, label);
  }
});

test('GET /api/home-contexts: any other database failure is a 500 with no database text, logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  failReads(h, 'home_contexts', { code: '57014', message: 'canceling statement due to statement timeout' });
  const body = await expectEnvelope(await list(h), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /statement|home_contexts|57014/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('canceling statement'));
});

test('GET /api/home-contexts without a session is a 401 envelope that echoes a client request id, and reads nothing', async () => {
  const h = harness();
  const body = await expectEnvelope(await list(h, { as: null, headers: { 'x-request-id': 'client-trace-0101' } }), {
    status: 401, code: 'auth_required', requestId: 'client-trace-0101',
  });
  assert.equal(body.error, 'Sign-in required.');
  assert.deepEqual(h.db.queryLog, []);
  assert.equal((await list(h, { headers: { 'x-request-id': 'client-trace-0102' } })).headers.get('x-request-id'), 'client-trace-0102');
});

// ------------------------------------------------------- GET /api/home-contexts/[id]

test('GET /api/home-contexts/[id] returns one of the household\'s homes, current or closed', async () => {
  const h = harness();
  for (const id of [ALICE_3, ALICE_1]) {
    const res = await detail(h, id);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('x-request-id'), UUID);
    const body = await res.json();
    assert.deepEqual(body, { context: contextSummary(seeded(h, id)) });
    assert.equal(JSON.stringify(body).includes(h.identities.alice.id), false, 'no owner id');
  }
  assert.equal((await (await detail(h, ALICE_2.toUpperCase())).json()).context.id, ALICE_2, 'an id in capitals is the same id');
});

test('GET /api/home-contexts/[id]: another household\'s home and one that does not exist are the identical 404', async () => {
  const h = harness();
  const foreignRes = await detail(h, BOB_1);
  const missingRes = await detail(h, MISSING_ID);
  const foreignBody = await expectEnvelope(foreignRes.clone(), { status: 404, code: 'not_found', retryable: false });
  assert.equal(foreignBody.error, NOT_FOUND);
  assert.deepEqual(await observable(foreignRes), await observable(missingRes));
  // and bob's own call shows the row was there to be found
  assert.equal((await detail(h, BOB_1, { as: 'bob' })).status, 200);
});

test('GET /api/home-contexts/[id] runs one owner-scoped lookup, the same statement for a foreign id as for a missing one', async () => {
  const h = harness();
  const shape = async (id) => {
    const from = h.db.queryLog.length;
    await detail(h, id);
    const queries = h.db.queryLog.slice(from);
    auditOwnerScope(queries, h.identities.alice.id, `GET ${id}`);
    return queries.map(({ table, operation, filters }) => ({ table, operation, filters: filters.map((f) => (f.column === 'id' ? { ...f, value: 'ID' } : f)) }));
  };
  const foreign = await shape(BOB_1);
  assert.equal(foreign.length, 1);
  assert.deepEqual(foreign[0].filters.map((f) => [f.column, f.op]).sort(), [['id', 'eq'], ['profile_id', 'eq']]);
  assert.deepEqual(await shape(MISSING_ID), foreign);
  assert.deepEqual(await shape(ALICE_3), foreign);
});

test('GET /api/home-contexts/[id] with an id that is not a UUID is a 400 naming the id, and reads nothing', async () => {
  const h = harness();
  for (const id of ['not-a-uuid', '1', `${ALICE_3}0`, ` ${ALICE_3}`, 'a11ce000-2222-4000-8000-00000000000g', "'; drop table home_contexts; --"]) {
    const body = await expectEnvelope(await detail(h, id), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['id', 'invalid_uuid']], id);
  }
  assert.deepEqual(h.db.queryLog, []);
});

test('GET /api/home-contexts/[id]: before 0016 a 503, another failure a 500, no session a 401', async (t) => {
  const logged = muteConsoleError(t);
  const before = harness({ rpc: false, tables: ['profiles', 'daily_scores'] });
  assert.equal((await expectEnvelope(await detail(before, ALICE_3), { status: 503, code: 'feature_unavailable', retryable: false })).error, UNAVAILABLE);

  const broken = harness();
  failReads(broken, 'home_contexts', { code: 'XX000', message: 'secret database detail' });
  const failed = await expectEnvelope(await detail(broken, ALICE_3), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(failed), /secret/);
  assert.ok(loggedText(logged).includes(failed.request_id));

  const anonymous = harness();
  await expectEnvelope(await detail(anonymous, ALICE_3, { as: null }), { status: 401, code: 'auth_required' });
  assert.deepEqual(anonymous.db.queryLog, []);
});

// ----------------------------------------------------- PATCH /api/home-contexts/[id]

test('PATCH /api/home-contexts/[id] changes the answers at the expected revision and returns the home with the revision bumped', async () => {
  const h = harness();
  const res = await patch(h, ALICE_3, { expected_revision: 4, water_source: 'Private well' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['context']);
  assert.deepEqual(Object.keys(body.context).sort(), SUMMARY_KEYS);
  assert.deepEqual([body.context.id, body.context.revision, body.context.water_source, body.context.home_year, body.context.current], [ALICE_3, 5, 'well', 1988, true]);
  assert.deepEqual(body.context, contextSummary(seeded(h, ALICE_3)), 'the answer is the stored row');
  assert.deepEqual(h.db.rpcCalls, [{
    name: 'update_home_context_attributes',
    args: { p_profile_id: h.identities.alice.id, p_context_id: ALICE_3, p_expected_revision: 4, p_attributes: { water_source: 'well' } },
  }]);
  const profile = h.db.rows('profiles').find((row) => row.id === h.identities.alice.id);
  assert.deepEqual([profile.water_source, profile.home_year], ['well', 1988], 'the profile follows the current home');

  const second = await (await patch(h, ALICE_3, { expected_revision: 5, home_year: '1990' })).json();
  assert.deepEqual([second.context.revision, second.context.water_source, second.context.home_year], [6, 'well', 1990]);
  const cleared = await (await patch(h, ALICE_3, { expected_revision: 6, home_year: null, water_source: null })).json();
  assert.deepEqual([cleared.context.revision, cleared.context.water_source, cleared.context.home_year], [7, null, null], 'null clears');
  auditOwnerScope(h.db.queryLog, h.identities.alice.id, 'PATCH');
});

test('PATCH /api/home-contexts/[id] at a stale revision is a 409 conflict carrying the current revision, and changes nothing', async () => {
  const h = harness();
  const before = snapshot(h);
  for (const stale of [3, 5, 1]) {
    const body = await expectEnvelope(await patch(h, ALICE_3, { expected_revision: stale, water_source: 'well' }), {
      status: 409, code: 'conflict', retryable: false, extraKeys: ['reason', 'revision'],
    });
    assert.deepEqual([body.reason, body.revision], ['stale_revision', 4]);
    assert.equal(body.error, 'This home was changed since you last loaded it. Reload it and try again.');
  }
  assert.equal(snapshot(h), before);
  // the revision it reported is the one that works
  assert.equal((await patch(h, ALICE_3, { expected_revision: 4, water_source: 'well' })).status, 200);
});

test('PATCH /api/home-contexts/[id] on a home the household has moved out of is a 409 conflict, even at its revision', async () => {
  const h = harness();
  const before = snapshot(h);
  const body = await expectEnvelope(await patch(h, ALICE_2, { expected_revision: 2, home_year: 1990 }), {
    status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'],
  });
  assert.equal(body.reason, 'context_closed');
  assert.equal(body.error, 'This is no longer your current home, so its details cannot be changed.');
  assert.equal(snapshot(h), before);
});

test('PATCH /api/home-contexts/[id]: another household\'s home, a missing one and a household with no profile all get the detail route\'s 404', async () => {
  const h = harness({ identities: { alice: {}, bob: {}, nobody: {} } }); // nobody has no profile row
  const before = snapshot(h);
  const foreign = await patch(h, BOB_1, { expected_revision: 1, water_source: 'well' });
  const missing = await patch(h, MISSING_ID, { expected_revision: 1, water_source: 'well' });
  const noProfile = await patch(h, BOB_1, { expected_revision: 1, water_source: 'well' }, { as: 'nobody' });
  const readMissing = await detail(h, MISSING_ID);
  await expectEnvelope(foreign.clone(), { status: 404, code: 'not_found', retryable: false });
  const expected = await observable(readMissing);
  for (const res of [foreign, missing, noProfile]) assert.deepEqual(await observable(res), expected);
  assert.equal(snapshot(h), before, 'bob\'s home is untouched');
  assert.deepEqual(h.db.rpcCalls.map((call) => call.args.p_profile_id), [h.identities.alice.id, h.identities.alice.id, h.identities.nobody.id]);
});

test('PATCH /api/home-contexts/[id] body rules: expected_revision is a whole number of 1 or more and at least one answer is sent', async () => {
  const h = harness();
  const bad = async (body, expected) => {
    const before = snapshot(h);
    const envelope = await expectEnvelope(await patch(h, ALICE_3, body), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected, JSON.stringify(body));
    assert.equal(envelope.error, envelope.field_errors[0].message);
    assert.equal(snapshot(h), before);
  };
  await bad({ water_source: 'well' }, [['expected_revision', 'revision_required']]);
  await bad({ expected_revision: null, water_source: 'well' }, [['expected_revision', 'revision_required']]);
  for (const revision of [0, -1, 1.5, '4', true, [4], { n: 4 }, 2147483648, Number.MAX_SAFE_INTEGER]) {
    await bad({ expected_revision: revision, water_source: 'well' }, [['expected_revision', 'invalid_revision']]);
  }
  await bad({ expected_revision: 4 }, [['body', 'nothing_to_change']]);
  await bad({}, [['expected_revision', 'revision_required'], ['body', 'nothing_to_change']]);
  await bad({ expected_revision: 4, home_year: YEAR + 1 }, [['home_year', 'invalid_year']]);
  await bad({ expected_revision: 4, home_year: 1988.5 }, [['home_year', 'invalid_year']]);
  await bad({ expected_revision: 4, water_source: 3 }, [['water_source', 'invalid_text']]);
  await bad({ expected_revision: 4, water_source: 'w'.repeat(41) }, [['water_source', 'text_too_long']]);
  await bad({ expected_revision: 'x', water_source: 5, home_year: 'abc' }, [
    ['expected_revision', 'invalid_revision'], ['water_source', 'invalid_text'], ['home_year', 'invalid_year'],
  ]);
  assert.deepEqual(h.db.rpcCalls, [], 'the function is never called with a body the route refused');
  assert.deepEqual(h.db.queryLog, []);
  const ok = await patch(h, ALICE_3, { expected_revision: 2147483647, home_year: '' });
  assert.equal(ok.status, 409, 'the largest int is a valid revision; it is just not this home\'s');
});

test('PATCH /api/home-contexts/[id] refuses every key it does not change, the owner id included, and names each one', async () => {
  const h = harness();
  const before = snapshot(h);
  const body = await expectEnvelope(await patch(h, ALICE_3, {
    expected_revision: 4, water_source: 'well', profile_id: h.identities.bob.id, pwsid: 'NC0000000', lat: 1, revision: 9,
  }), { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [
    ['lat', 'unknown_field'], ['profile_id', 'unknown_field'], ['pwsid', 'unknown_field'], ['revision', 'unknown_field'],
  ]);
  assert.equal(body.error, 'Only expected_revision, water_source and home_year can be sent.');
  assert.equal(snapshot(h), before);
  assert.deepEqual(h.db.rpcCalls, []);
});

test('PATCH /api/home-contexts/[id]: a malformed id is a 400 before the body is read; bad JSON is a 400 and over 2048 bytes a 413', async () => {
  const h = harness();
  const id = await expectEnvelope(await patch(h, 'nope', { expected_revision: 1, water_source: 'well' }), { status: 400, code: 'validation_failed' });
  assert.deepEqual(id.field_errors.map((e) => [e.field, e.code]), [['id', 'invalid_uuid']]);
  await expectEnvelope(await patchRaw(h, 'nope', '{not json'), { status: 400, code: 'validation_failed' });
  for (const rawBody of ['{not json', '[]', '"well"', 'null']) {
    await expectEnvelope(await patchRaw(h, ALICE_3, rawBody), { status: 400, code: 'bad_request', retryable: false });
  }
  const shell = JSON.stringify({ expected_revision: 4, home_year: 1960, pad: '' });
  const padded = (size) => JSON.stringify({ expected_revision: 4, home_year: 1960, pad: 'p'.repeat(size - shell.length) });
  assert.equal(Buffer.byteLength(padded(2049)), 2049);
  const large = await expectEnvelope(await patchRaw(h, ALICE_3, padded(2049)), { status: 413, code: 'payload_too_large', retryable: false });
  assert.equal(large.error, 'That request is too large.');
  await expectEnvelope(await patchRaw(h, ALICE_3, '{}', { headers: { 'content-length': '5000' } }), { status: 413, code: 'payload_too_large' });
  const fits = await expectEnvelope(await patchRaw(h, ALICE_3, padded(2048)), { status: 400, code: 'validation_failed' });
  assert.deepEqual(fits.field_errors.map((e) => e.field), ['pad'], '2048 bytes is read (and the stray key refused)');
  assert.deepEqual(h.db.rpcCalls, []);
});

test('PATCH /api/home-contexts/[id] before migration 0016 (PGRST202, or 42883) is a 503 saying it is not available yet; nothing is written', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const missing = harness({ rpc: false });
  const before = snapshot(missing);
  const body = await expectEnvelope(await patch(missing, ALICE_3, { expected_revision: 4, water_source: 'well' }), {
    status: 503, code: 'feature_unavailable', retryable: false,
  });
  assert.equal(body.error, UNAVAILABLE);
  assert.equal(snapshot(missing), before);
  assert.deepEqual(missing.db.queryLog, [], 'no fallback write');

  const unknown = harness({ rpc: false });
  unknown.db.registerRpc('update_home_context_attributes', () => {
    throw rpcError('42883', 'function public.update_home_context_attributes(uuid, uuid, integer, jsonb) does not exist');
  });
  await expectEnvelope(await patch(unknown, ALICE_3, { expected_revision: 4, water_source: 'well' }), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(warn.mock.callCount(), 0, 'the answer says it; the log is not flooded');
});

test('PATCH /api/home-contexts/[id]: the function refusing input the route accepted is a 500 (a validation gap), as is any other failure', async (t) => {
  const logged = muteConsoleError(t);
  const failures = [
    ['P0001', 'HALO_INVALID_INPUT', 'p_attributes.home_year must be a whole number or null'],
    ['40001', 'could not serialize access due to concurrent update', null],
    ['57014', 'canceling statement due to statement timeout', null],
    ['P0001', 'SOMETHING_ELSE', null],
    ['PGRST301', 'JWT expired', null],
  ];
  for (const [code, message, details] of failures) {
    const h = harness({ rpc: false });
    h.db.registerRpc('update_home_context_attributes', () => { throw rpcError(code, message, details); }, { args: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS] });
    const body = await expectEnvelope(await patch(h, ALICE_3, { expected_revision: 4, water_source: 'well' }), { status: 500, code: 'internal_error', retryable: true });
    assert.doesNotMatch(JSON.stringify(body), /HALO|serialize|statement|JWT|p_attributes/, code);
    assert.ok(loggedText(logged).includes(body.request_id));
    assert.ok(loggedText(logged).includes(message));
  }
  for (const answer of [null, {}, { context: null }, 'saved', [{}]]) {
    const h = harness({ rpc: false });
    h.db.registerRpc('update_home_context_attributes', () => answer, { args: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS] });
    await expectEnvelope(await patch(h, ALICE_3, { expected_revision: 4, water_source: 'well' }), { status: 500, code: 'internal_error' });
  }
});

test('PATCH /api/home-contexts/[id]: everything the function would refuse as invalid input is refused by the route first', async () => {
  const h = harness({ rpc: false });
  const { update } = homeContextHandlers();
  const reached = [];
  h.db.registerRpc('update_home_context_attributes', (args, db) => { reached.push(args); return update(args, db); }, {
    args: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS],
  });
  for (const body of [
    { expected_revision: 4, home_year: 1988.5 }, { expected_revision: 4, home_year: [1988] }, { expected_revision: 4, home_year: YEAR + 1 },
    { expected_revision: 4, water_source: 3 }, { expected_revision: 4, water_source: true }, { expected_revision: 4, pwsid: 'NC0000000' },
    { expected_revision: 4 }, { expected_revision: 1.5, home_year: 1990 }, { expected_revision: '4', home_year: 1990 },
    { expected_revision: 2147483648, home_year: 1990 },
  ]) {
    assert.equal((await patch(h, ALICE_3, body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(reached, [], 'none of them reached the function');
  // What the route accepts it sends in the form the function takes: a year written as text arrives as a number.
  assert.equal((await patch(h, ALICE_3, { expected_revision: 4, home_year: '1988', water_source: 'City utility' })).status, 200);
  assert.deepEqual(reached.map((args) => args.p_attributes), [{ water_source: 'utility', home_year: 1988 }]);
});

test('PATCH /api/home-contexts/[id] without a session is a 401 envelope and the function is not called', async () => {
  const h = harness();
  await expectEnvelope(await patch(h, ALICE_3, { expected_revision: 4, water_source: 'well' }, { as: null, headers: { 'x-request-id': 'client-trace-0103' } }), {
    status: 401, code: 'auth_required', requestId: 'client-trace-0103',
  });
  assert.deepEqual(h.db.rpcCalls, []);
});

test('PATCH /api/home-contexts/[id] echoes a well formed client request id on success, 400, 404 and 409', async () => {
  const h = harness();
  const headers = { 'x-request-id': 'client-trace-0104' };
  assert.equal((await patch(h, ALICE_3, { expected_revision: 4, home_year: 1999 }, { headers })).headers.get('x-request-id'), 'client-trace-0104');
  await expectEnvelope(await patch(h, ALICE_3, { expected_revision: 0 }, { headers }), { status: 400, code: 'validation_failed', requestId: 'client-trace-0104' });
  await expectEnvelope(await patch(h, BOB_1, { expected_revision: 1, home_year: 1999 }, { headers }), { status: 404, code: 'not_found', requestId: 'client-trace-0104' });
  await expectEnvelope(await patch(h, ALICE_3, { expected_revision: 1, home_year: 1999 }, { headers }), { status: 409, code: 'conflict', requestId: 'client-trace-0104', extraKeys: ['reason', 'revision'] });
});
