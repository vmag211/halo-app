import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { localDate } from './helpers/isolationSeed.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const chr = (code) => String.fromCharCode(code);
const TABLES = ['profiles', 'daily_scores'];
const TODAY = localDate();
const REQUEST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THIS_YEAR = new Date().getFullYear();
const ALICE_BEFORE = { lat: 35.5, lng: -80.5, county: 'Old County', state: 'NC', pwsid: 'NC9990001', zip: null, onboard_request_id: null };

const FEATURE = {
  center: [-80.61, 35.41],
  context: [{ id: 'postcode.1', text: '28027' }, { id: 'district.1', text: 'Cabarrus County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }],
};

/** Two households, a Mapbox and ArcGIS answered by `providers`, every outbound call recorded. */
function harness({ mapbox = { features: [FEATURE] }, rateLimit, mapboxStatus = 200 } = {}) {
  const outbound = [];
  const h = createRouteHarness({
    tables: haloTables(...TABLES),
    env: { MAPBOX_TOKEN: 'pk.test-token' },
    rateLimit,
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id, ...ALICE_BEFORE }, { id: bob.id, lat: 35.2, lng: -80.8, county: 'Bob County', state: 'NC', pwsid: 'NC9990002' }],
      daily_scores: [{ profile_id: alice.id, date: TODAY, score: 70, aqi: 40 }, { profile_id: bob.id, date: TODAY, score: 30, aqi: 150 }],
    }),
    fetch: async (url) => {
      outbound.push(String(url));
      if (String(url).startsWith('https://api.mapbox.com/')) return Response.json(mapbox, { status: mapboxStatus });
      if (String(url).startsWith('https://services.arcgis.com/')) return Response.json({ features: [{ attributes: { PWSID: 'NC9990001' } }] });
      return new Response('{}', { status: 503 });
    },
  });
  return Object.assign(h, { outbound });
}
const post = (h, body, options = {}) => h.call('/api/onboard', 'POST', { as: 'alice', body, ...options });
const postRaw = (h, rawBody, options = {}) => h.call('/api/onboard', 'POST', { as: 'alice', rawBody, ...options });
const snapshot = (h) => JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, h.db.rows(table)])));
const mapboxUrl = (h) => h.outbound.find((url) => url.startsWith('https://api.mapbox.com/'));

/** After a rejection nothing was read or written, no provider was asked, and nothing waits for `after`. */
async function assertUntouched(h, before) {
  assert.equal(snapshot(h), before, 'a rejected request changes no table');
  assert.equal(h.db.queryLog.length, 0, 'and no statement was run');
  assert.deepEqual(h.outbound, [], 'and no provider was asked');
  await h.runAfter();
  assert.equal(h.db.queryLog.length, 0, 'and no backfill was queued');
}
const bad = async (body, expected, message) => {
  const h = harness();
  const before = snapshot(h);
  const envelope = await expectEnvelope(await post(h, body), { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(envelope.error, envelope.field_errors[0].message);
  if (message) assert.equal(envelope.error, message);
  await assertUntouched(h, before);
};

// ------------------------------------------------------------ legacy

test('legacy request (what lib/frontend/api.ts sends): address and request_id geocode and store, with the old status and body fields', async () => {
  const h = harness();
  const res = await post(h, { address: ' 2 Elm Court ', request_id: REQUEST_ID });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['county', 'home_year', 'lat', 'lng', 'onboard_request_id', 'profile_id', 'pwsid', 'service_area_status', 'state', 'water_source', 'zip']);
  assert.deepEqual(body, {
    profile_id: h.identities.alice.id, lat: 35.41, lng: -80.61, zip: '28027', county: 'Cabarrus County', state: 'NC', pwsid: 'NC9990001',
    service_area_status: 'measured', water_source: null, home_year: null, onboard_request_id: REQUEST_ID,
  });
  const [stored] = h.db.rows('profiles').filter((row) => row.id === h.identities.alice.id);
  assert.deepEqual([stored.lat, stored.lng, stored.county, stored.onboard_request_id], [35.41, -80.61, 'Cabarrus County', REQUEST_ID]);
  assert.match(mapboxUrl(h), /\/mapbox\.places\/2%20Elm%20Court\.json\?/, 'the trimmed address is what is geocoded');
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('legacy request: the bare address of lib/api.js, water_source and home_year are still accepted and normalised', async () => {
  const h = harness();
  const body = await (await post(h, { address: '2 Elm Court', water_source: 'City utility', home_year: 1999, profile_id: h.identities.alice.id })).json();
  assert.deepEqual([body.water_source, body.home_year, body.onboard_request_id], ['utility', 1999, null]);
  for (const [sent, stored] of [['Well', 'well'], ['private spring', 'spring'], ['', null], [null, null]]) {
    assert.equal((await (await post(h, { address: '2 Elm Court', water_source: sent })).json()).water_source, stored, String(sent));
  }
  for (const [sent, stored] of [['', null], [null, null], ['1975', 1975], [1700, 1700], [THIS_YEAR, THIS_YEAR]]) {
    assert.equal((await (await post(h, { address: '2 Elm Court', home_year: sent })).json()).home_year, stored, String(sent));
  }
});

test('legacy request: a GPS "lng,lat" string, a bare ZIP and a 3 or 200 character address all reach the geocoder as before', async () => {
  const h = harness();
  assert.equal((await post(h, { address: '-80.57952,35.40881' })).status, 200);
  assert.match(mapboxUrl(h), /mapbox\.places\/-80\.57952%2C35\.40881\.json/);
  h.outbound.length = 0;
  assert.equal((await post(h, { address: '28025' })).status, 200);
  assert.match(mapboxUrl(h), /&country=us|country=us/, 'a bare ZIP is still pinned to the US');
  for (const address of ['Elm', 'e'.repeat(200)]) {
    h.outbound.length = 0;
    assert.equal((await post(h, { address })).status, 200, `${address.length} characters`);
    assert.ok(mapboxUrl(h));
  }
});

test('legacy request: the identity is the token; a body user_id or id and unknown keys change nothing, a foreign profile_id is the old 403', async () => {
  const h = harness();
  const bobBefore = JSON.stringify(h.db.rows('profiles').filter((row) => row.id === h.identities.bob.id));
  const ok = await post(h, { address: '2 Elm Court', user_id: h.identities.bob.id, id: h.identities.bob.id, owner_id: h.identities.bob.id, extra: 1 });
  assert.equal((await ok.json()).profile_id, h.identities.alice.id);
  assert.equal(JSON.stringify(h.db.rows('profiles').filter((row) => row.id === h.identities.bob.id)), bobBefore);
  assert.ok(h.db.queryLog.filter((q) => q.table === 'profiles' && q.operation === 'upsert').every((q) => q.rows.every((row) => row.id === h.identities.alice.id)));

  const fresh = harness();
  const before = snapshot(fresh);
  const forbidden = await expectEnvelope(await post(fresh, { address: '2 Elm Court', profile_id: fresh.identities.bob.id }), { status: 403, code: 'forbidden' });
  assert.equal(forbidden.error, 'That profile does not belong to this session.');
  await assertUntouched(fresh, before);
  // The session check still comes before the field checks, as before.
  await expectEnvelope(await post(fresh, { address: 'x', profile_id: fresh.identities.bob.id }), { status: 403, code: 'forbidden' });
  await assertUntouched(fresh, before);
});

// ----------------------------------------------------------- address

for (const [label, value, code, message] of [
  ['a missing address', undefined, 'address_required', 'Address is required'],
  ['null', null, 'address_required', 'Address is required'],
  ['an empty string', '', 'address_required', 'Address is required'],
  ['only spaces', '   ', 'address_required', 'Address is required'],
  ['a number', 28025, 'invalid_text'],
  ['zero', 0, 'invalid_text'],
  ['true', true, 'invalid_text'],
  ['an array (it used to be stringified)', ['2 Elm Court'], 'invalid_text'],
  ['an object', { street: '2 Elm Court' }, 'invalid_text'],
  ['two characters', 'ab', 'address_too_short', 'Enter at least 3 characters.'],
  ['two characters padded with spaces', '  ab  ', 'address_too_short'],
  ['201 characters', 'e'.repeat(201), 'text_too_long'],
  ['201 emoji characters', '\u{1F3E0}'.repeat(201), 'text_too_long'],
  ['a NUL', `2 Elm${chr(0)} Court`, 'invalid_characters'],
  ['a line break', `2 Elm${chr(0x0a)}Court`, 'invalid_characters'],
  ['a tab', `2${chr(0x09)}Elm Court`, 'invalid_characters'],
  ['an escape character', `2 Elm${chr(0x1b)} Court`, 'invalid_characters'],
  ['a line separator', `2 Elm${chr(0x2028)}Court`, 'invalid_characters'],
  ['a lone surrogate', `2 Elm${chr(0xd800)} Court`, 'invalid_characters'],
]) {
  test(`address: ${label} is a 400, reads and writes nothing and asks no provider`, async () => {
    await bad(value === undefined ? { request_id: REQUEST_ID } : { address: value }, [['address', code]], message);
  });
}

test('address: 200 emoji characters are accepted (counted as characters), and the address is geocoded trimmed', async () => {
  const h = harness();
  assert.equal((await post(h, { address: '\u{1F3E0}'.repeat(200) })).status, 200);
});

// -------------------------------------- request_id, water and home year

test('request_id: absent or null is fine; a valid UUID is stored lower case', async () => {
  const h = harness();
  assert.equal((await (await post(h, { address: '2 Elm Court' })).json()).onboard_request_id, null);
  assert.equal((await (await post(h, { address: '2 Elm Court', request_id: null })).json()).onboard_request_id, null);
  assert.equal((await (await post(h, { address: '2 Elm Court', request_id: REQUEST_ID.toUpperCase() })).json()).onboard_request_id, REQUEST_ID);
});

for (const [label, value] of [
  ['text that is not a UUID (it used to be silently ignored)', 'not-a-uuid'],
  ['an empty string', ''],
  ['a UUID with a character added', `${REQUEST_ID}0`],
  ['a number', 12345],
  ['true', true],
  ['an array', [REQUEST_ID]],
  ['an object', { id: REQUEST_ID }],
]) {
  test(`request_id: ${label} is a 400 and changes nothing`, async () => {
    await bad({ address: '2 Elm Court', request_id: value }, [['request_id', 'invalid_request_id']]);
  });
}

for (const [label, value] of [['before 1700', 1699], ['in the future', THIS_YEAR + 1], ['text', 'abc'], ['fractional', 1988.5], ['text after the number', '1988abc']]) {
  test(`home_year: ${label} is the old 400 sentence, now with a field error, and changes nothing`, async () => {
    await bad({ address: '2 Elm Court', home_year: value }, [['home_year', 'invalid_year']], `Year built must be a whole year between 1700 and ${THIS_YEAR}, or left blank.`);
  });
}

test('every problem is reported at once, in field order (address, request_id, home_year)', async () => {
  await bad({ address: 'x', request_id: 5, home_year: 'abc' }, [['address', 'address_too_short'], ['request_id', 'invalid_request_id'], ['home_year', 'invalid_year']]);
});

// -------------------------------------------------------------- body

test('invalid JSON and a non-object body are 400 bad_request (invalid JSON was an uncaught 500) and change nothing', async () => {
  const h = harness();
  const before = snapshot(h);
  for (const rawBody of ['{not json', '[]', '"2 Elm Court"', '5', 'null', '   ', '{"address":']) {
    const body = await expectEnvelope(await postRaw(h, rawBody), { status: 400, code: 'bad_request', retryable: false });
    assert.equal(body.field_errors.length, 0, rawBody);
  }
  await assertUntouched(h, before);
});

test('an empty body means {}: it is then a missing address, not a crash', async () => {
  const h = harness();
  const body = await expectEnvelope(await postRaw(h, ''), { status: 400, code: 'validation_failed' });
  assert.deepEqual(body.field_errors.map((e) => e.code), ['address_required']);
});

test('the body limit is 4096 bytes: exactly that is read, one more byte is a 413 and changes nothing', async () => {
  const h = harness();
  const base = JSON.stringify({ address: '2 Elm Court', pad: '' });
  const padded = (size) => JSON.stringify({ address: '2 Elm Court', pad: 'p'.repeat(size - base.length) });
  assert.equal(Buffer.byteLength(padded(4096)), 4096);
  assert.equal((await postRaw(h, padded(4096))).status, 200);

  const fresh = harness();
  const before = snapshot(fresh);
  const body = await expectEnvelope(await postRaw(fresh, padded(4097)), { status: 413, code: 'payload_too_large', retryable: false });
  assert.equal(body.error, 'That request is too large.');
  await expectEnvelope(await postRaw(fresh, '{}', { headers: { 'content-length': '5000' } }), { status: 413, code: 'payload_too_large' });
  await assertUntouched(fresh, before);
});

// ----------------------------------------- geocoding, limits, envelope

test('no coordinates found is the old 404 in the envelope, including a Mapbox feature that cannot be parsed (it used to crash)', async () => {
  for (const mapbox of [{ features: [] }, {}, { features: [{}] }, { features: [null] }, { features: [{ center: 'x' }] }]) {
    const h = harness({ mapbox });
    const before = snapshot(h);
    const body = await expectEnvelope(await post(h, { address: '2 Elm Court' }), { status: 404, code: 'not_found', retryable: false });
    assert.equal(body.error, 'Could not find coordinates for this address', JSON.stringify(mapbox));
    assert.equal(snapshot(h), before, 'nothing was written');
    await h.runAfter();
    assert.equal(h.db.queryLog.filter((q) => q.operation !== 'select').length, 0, 'no backfill either');
  }
});

test('the per-user and the global limits are the old 429 sentences in the envelope, checked after validation and before any provider call', async () => {
  const limited = [
    [(key) => !key.startsWith('onboard:'), 'Too many address lookups from this device today. Please try again tomorrow.'],
    [(key) => key !== 'global_mapbox_calls', 'Daily address search limit reached. Please try again tomorrow.'],
  ];
  for (const [rateLimit, message] of limited) {
    const h = harness({ rateLimit });
    const before = snapshot(h);
    const body = await expectEnvelope(await post(h, { address: '2 Elm Court' }), { status: 429, code: 'rate_limited', retryable: true });
    assert.equal(body.error, message);
    assert.deepEqual(h.outbound, []);
    assert.equal(snapshot(h), before);
  }
  const keys = [];
  const h = harness({ rateLimit: (key) => { keys.push(key); return true; } });
  assert.equal((await post(h, { address: 'x' })).status, 400);
  assert.deepEqual(keys, [], 'a request that fails validation does not spend the household\'s lookups');
});

test('a provider failure is a 500 envelope with no provider text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({ mapboxStatus: 500 });
  const before = snapshot(h);
  const body = await expectEnvelope(await post(h, { address: '2 Elm Court' }), { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /Mapbox|fetch/i);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Failed to fetch data from Mapbox API'));
  assert.equal(snapshot(h), before);
});

test('a database failure on the write is a 500 envelope with no database text', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  const from = h.db.from.bind(h.db);
  h.db.from = (name) => { if (name === 'profiles') throw new Error('secret database detail'); return from(name); };
  const body = await expectEnvelope(await post(h, { address: '2 Elm Court' }), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
});

test('every outcome carries X-Request-Id, and a well formed client id is echoed on success, 400, 403, 404, 413 and 429', async () => {
  const headers = { 'x-request-id': 'client-trace-0001' };
  const ids = async (h, body, options) => (await post(h, body, { headers, ...options })).headers.get('x-request-id');
  assert.equal(await ids(harness(), { address: '2 Elm Court' }), 'client-trace-0001');
  assert.equal(await ids(harness(), {}), 'client-trace-0001');
  assert.equal(await ids(harness(), { address: '2 Elm Court', profile_id: '11111111-1111-4111-8111-111111111111' }), 'client-trace-0001');
  assert.equal(await ids(harness({ mapbox: { features: [] } }), { address: '2 Elm Court' }), 'client-trace-0001');
  assert.equal(await ids(harness({ rateLimit: () => false }), { address: '2 Elm Court' }), 'client-trace-0001');
  assert.equal((await postRaw(harness(), 'x'.repeat(5000), { headers })).headers.get('x-request-id'), 'client-trace-0001');
  const none = await expectEnvelope(await harness().call('/api/onboard', 'POST', { body: { address: '2 Elm Court' }, headers }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal(none.error, 'Sign-in required.');
});
