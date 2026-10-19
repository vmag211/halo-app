/**
 * GET /api/locations/search (B05 Task 2, Rulings D4 and D10) on the isolated
 * harness: synthetic identities, an in-memory database that the route must not
 * touch, and a fetch that rejects any host.
 *
 * `validPlaces` is transcribed verbatim from
 * `lib/frontend/production/explore-service.ts` on
 * `origin/codex/october15-review-refinement` (lines 8-9 and 67); its self-check,
 * that it rejects what the client rejects, is in test/places.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

// ---------------------------------------------------------------- transcribed (F: explore-service.ts:8-9,67)
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 10000) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function validPlaces(value){return object(value)&&Array.isArray(value.candidates)&&value.candidates.length<=20&&value.candidates.every(place=>object(place)&&['id','place','state','label','timezone'].every(key=>text(place[key],300))&&!!place.id);}
// ----------------------------------------------------------------

const EM_DASH = String.fromCharCode(0x2014);
const WAKE = { id: 'us-county:37183', place: 'Wake County', state: 'NC', label: 'Wake County, NC', timezone: 'America/New_York' };

/**
 * A harness whose database refuses to be used: any table or RPC call is recorded
 * and throws, on top of the query log the fake keeps anyway.
 */
function harness() {
  const h = createRouteHarness({
    tables: haloTables('profiles'),
    seed: ({ alice, bob }) => ({ profiles: [{ id: alice.id, county: 'Cabarrus County' }, { id: bob.id, county: 'Union County' }] }),
  });
  h.touched = [];
  h.db.from = (name) => { h.touched.push(`from:${name}`); throw new Error('the database was read'); };
  h.db.rpc = async (name) => { h.touched.push(`rpc:${name}`); throw new Error('the database was called'); };
  return h;
}
const search = (h, query, { as = 'alice', headers } = {}) =>
  h.call('/api/locations/search', 'GET', { as, url: `/api/locations/search${query}`, headers });
const nothingTouched = (h) => {
  assert.deepEqual(h.touched, [], 'no table and no RPC');
  assert.equal(h.db.queryLog.length, 0, 'no statement');
  assert.deepEqual(h.blockedFetches, [], 'zero fetch calls');
};

test('a county query is a 200 with bare { candidates } that the frontend accepts, with a request id and no data key', async () => {
  const h = harness();
  const res = await search(h, '?query=Wake&state=NC');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(body, { candidates: [WAKE] });
  assert.equal(Object.hasOwn(body, 'data'), false);
  assert.equal(validPlaces(body), true);
  nothingTouched(h);
});

test('the request the client sends (query and state trimmed, state possibly empty) is answered', async () => {
  const h = harness();
  // runtime.ts builds the query with URLSearchParams; an empty state arrives as `state=`.
  const params = new URLSearchParams({ query: 'mecklenburg county', state: '' });
  const body = await (await search(h, `?${params}`)).json();
  assert.deepEqual(body.candidates.map((c) => c.id), ['us-county:37119']);
  const prefix = await (await search(h, '?query=Ca&state=North%20Carolina')).json();
  assert.equal(prefix.candidates.length, 6);
  assert.equal(validPlaces(prefix), true);
  assert.equal((await (await search(h, '?query=Wake')).json()).candidates.length, 1, 'no state at all is North Carolina too');
  nothingTouched(h);
});

test('nothing matching is a bare 200 { candidates: [] }, never a 404: a city, a ZIP, another state, an unknown name', async () => {
  const h = harness();
  for (const query of ['?query=Charlotte&state=', '?query=28208&state=NC', '?query=Wake&state=SC', '?query=Atlantis&state=']) {
    const res = await search(h, query);
    assert.equal(res.status, 200, query);
    const body = await res.json();
    assert.deepEqual(body, { candidates: [] }, query);
    assert.equal(validPlaces(body), true);
  }
  nothingTouched(h);
});

const BAD = [
  ['no query', '', [['query', 'text_required']]],
  ['an empty query', '?query=&state=NC', [['query', 'text_required']]],
  ['a blank query', '?query=%20%20%20', [['query', 'text_required']]],
  ['an 81-character query', `?query=${'a'.repeat(81)}`, [['query', 'text_too_long']]],
  ['a 41-character state', `?query=Wake&state=${'b'.repeat(41)}`, [['state', 'text_too_long']]],
  ['a NUL in the query', '?query=Wa%00ke', [['query', 'invalid_characters']]],
  ['a line break in the query', '?query=Wake%0ACounty', [['query', 'invalid_characters']]],
  ['an escape in the state', '?query=Wake&state=N%1BC', [['state', 'invalid_characters']]],
  ['a bad query and a bad state', `?query=&state=${'b'.repeat(41)}`, [['query', 'text_required'], ['state', 'text_too_long']]],
];
for (const [label, query, expected] of BAD) {
  test(`${label} is a 400 with field errors in the house envelope, and touches nothing`, async () => {
    const h = harness();
    const body = await expectEnvelope(await search(h, query), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(JSON.stringify(body).includes(EM_DASH), false);
    nothingTouched(h);
  });
}

test('the limits are inclusive: an 80-character query and a 40-character state are searched', async () => {
  const h = harness();
  const res = await search(h, `?query=${'a'.repeat(80)}&state=${'b'.repeat(40)}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { candidates: [] });
});

test('without a session it is a 401 envelope, before the query is even looked at', async () => {
  const h = harness();
  await expectEnvelope(await search(h, '?query=Wake', { as: null }), { status: 401, code: 'auth_required' });
  await expectEnvelope(await search(h, '?query=', { as: null }), { status: 401, code: 'auth_required' });
  await expectEnvelope(await search(h, '?query=Wake', { as: null, headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  await expectEnvelope(await search(h, '?query=Wake', { as: null, headers: { authorization: 'Bearer not-a-real-token' } }), { status: 401, code: 'auth_required' });
  nothingTouched(h);
});

test('an auth outage is the retryable 503, not a 401', async (t) => {
  muteConsoleError(t);
  const h = harness();
  h.forceAuthOutage('returned');
  await expectEnvelope(await search(h, '?query=Wake'), { status: 503, code: 'auth_unavailable', retryable: true });
});

test('two households get the identical answer: nothing in it is anyone\'s', async () => {
  const h = harness();
  const alice = await (await search(h, '?query=Ca&state=NC', { as: 'alice' })).json();
  const bob = await (await search(h, '?query=Ca&state=NC', { as: 'bob' })).json();
  assert.deepEqual(alice, bob);
  nothingTouched(h);
});

test('an unexpected failure is a 500 envelope with the request id logged and no detail leaked', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  // A verified user whose id cannot be read: a failure inside the handler that is not an AuthError.
  h.db.auth.getUser = async () => ({ data: { user: { get id() { throw new Error('secret auth detail'); } } }, error: null });
  const body = await expectEnvelope(await search(h, '?query=Wake'), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /secret auth detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('secret auth detail'));
});
