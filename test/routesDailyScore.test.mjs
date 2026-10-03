import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, quiet } from './helpers/isolationKit.mjs';
import { PROFILE } from './helpers/isolationSeed.mjs';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const { lat, lng } = PROFILE.alice;
const score = (ctx, query = '', headers) => ctx.call('alice', '/api/daily-score', 'GET', { url: `/api/daily-score${query}`, headers });

/** Alice with no stored location, so only lat and lng can tell the route where she is. */
const noHome = { readingToday: false, adjust: (rows, { alice }) => Object.assign(rows.profiles.find((p) => p.id === alice.id), { lat: null, lng: null }) };

test('legacy request: the stored home is served from the cache with every old field, and a request id header', async () => {
  const ctx = setup();
  const res = await score(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['air', 'cached', 'mold', 'pollen', 'retrieved_at', 'score', 'uv']);
  assert.equal(body.cached, true);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('legacy lat and lng (what lib/api.js sends) for the stored home still hit the cache; other numeric spellings parse', async () => {
  const ctx = setup();
  assert.equal((await (await score(ctx, `?lat=${lat}&lng=${lng}`)).json()).cached, true);
  assert.equal((await (await score(ctx, `?lat=%20${lat}%20&lng=${lng}`)).json()).cached, true, 'surrounding spaces are fine');
});

test('lat and lng for another point are served live, and give a household with no stored home a location', async (t) => {
  quiet(t);
  const ctx = setup({ seed: noHome });
  const res = await score(ctx, '?lat=35.1&lng=-80.1');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cached, false);
  assert.ok(ctx.outbound.length > 0 && ctx.outbound.every((request) => request.url.includes('35.1')), 'the providers were asked about the point given');
});

const REJECTED = [
  ['only lat', '?lat=35.4', [['lng', 'coordinate_pair_required']]],
  ['only lng', '?lng=-80.5', [['lat', 'coordinate_pair_required']]],
  ['only lat, and it is empty', '?lat=', [['lng', 'coordinate_pair_required']]],
  ['a latitude that is not a number', '?lat=abc&lng=-80', [['lat', 'invalid_coordinate']]],
  ['a latitude above 90', '?lat=91&lng=0', [['lat', 'coordinate_out_of_range']]],
  ['a longitude below -180', '?lat=0&lng=-181', [['lng', 'coordinate_out_of_range']]],
  ['empty lat and lng', '?lat=&lng=', [['lat', 'invalid_coordinate'], ['lng', 'invalid_coordinate']]],
  ['scientific notation', '?lat=1e1&lng=5', [['lat', 'invalid_coordinate']]],
  ['NaN and Infinity', '?lat=NaN&lng=Infinity', [['lat', 'invalid_coordinate'], ['lng', 'invalid_coordinate']]],
  ['text after the number', '?lat=35.4abc&lng=-80', [['lat', 'invalid_coordinate']]],
  ['the word undefined (what String(undefined) sends)', '?lat=undefined&lng=undefined', [['lat', 'invalid_coordinate'], ['lng', 'invalid_coordinate']]],
];

for (const [label, query, expected] of REJECTED) {
  test(`${label} is a 400 with field errors, reads nothing and asks no provider`, async () => {
    const ctx = setup();
    const before = ctx.h.db.queryLog.length;
    const body = await expectEnvelope(await score(ctx, query), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(ctx.h.db.queryLog.length, before);
    assert.equal(ctx.outbound.length, 0);
  });
}

test('neither lat nor lng and no stored home keeps the old 400 sentence, now in the envelope', async () => {
  const ctx = setup({ seed: noHome });
  const body = await expectEnvelope(await score(ctx), { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.error, 'No location yet. Finish onboarding, or pass lat and lng.');
  assert.deepEqual(body.field_errors.map((e) => e.field), ['location']);
});

test('fresh is literally "1": any other value is served from the cache', async (t) => {
  quiet(t);
  const ctx = setup();
  for (const value of ['true', 'yes', '0', '', '2', 'TRUE']) {
    assert.equal((await (await score(ctx, `?fresh=${value}`)).json()).cached, true, `fresh=${value}`);
  }
  assert.equal(ctx.outbound.length, 0);
  assert.equal((await (await score(ctx, '?fresh=1')).json()).cached, false);
  assert.ok(ctx.outbound.length > 0, 'fresh=1 went to the providers');
});

test('another household\'s profile_id stays a 403 in the envelope, before anything is read; an own or absent one is fine', async () => {
  const ctx = setup();
  const before = ctx.h.db.queryLog.length;
  for (const claimed of [ctx.id('bob'), 'not-a-uuid']) {
    const body = await expectEnvelope(await score(ctx, `?profile_id=${claimed}`), { status: 403, code: 'forbidden' });
    assert.equal(body.error, 'That profile does not belong to this session.');
  }
  assert.equal(ctx.h.db.queryLog.length, before);
  assert.equal((await score(ctx, `?profile_id=${ctx.id('alice')}`)).status, 200);
});

test('a client request id is echoed in header and body; a missing session is a 401 envelope', async () => {
  const ctx = setup();
  const res = await score(ctx, '?lat=1', { 'x-request-id': 'client-trace-0001' });
  assert.equal((await expectEnvelope(res, { status: 400, code: 'validation_failed' })).request_id, 'client-trace-0001');

  const none = await expectEnvelope(await ctx.h.call('/api/daily-score', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
});

test('a refresh that is rate limited is a 429 envelope that keeps retry_after_seconds and adds Retry-After', async () => {
  const keys = [];
  const ctx = setup({ rateLimit: (key) => { keys.push(key); return false; } });
  const res = await score(ctx, '?fresh=1');
  const body = await expectEnvelope(res, { status: 429, code: 'rate_limited', retryable: true, extraKeys: ['retry_after_seconds'] });
  assert.equal(body.error, 'Readings were just refreshed. Try again in a few minutes.');
  assert.equal(body.retry_after_seconds, 300);
  assert.equal(res.headers.get('retry-after'), '300');
  assert.deepEqual(keys, [`daily-score:${ctx.id('alice')}`], 'the limit is per household');
  assert.equal(ctx.outbound.length, 0);
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const broken = createRouteHarness({ tables: haloTables('daily_scores') }); // profiles missing: PGRST205
  const res = await broken.call('/api/daily-score', 'GET', { as: 'alice' });
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /schema cache|profiles|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});
