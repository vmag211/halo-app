import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const ALICE_1 = 'a11ce000-1111-4000-8000-000000000001';
const ALICE_2 = 'a11ce000-1111-4000-8000-000000000002';
const ALICE_READ = 'a11ce000-1111-4000-8000-000000000003';
const BOB_1 = 'b0b00000-1111-4000-8000-000000000001';
const MISSING = '99999999-9999-4999-8999-999999999999';
const TYPES = ['air_quality_change', 'weather_advisory', 'new_water_results', 'radon_season', 'season_summary'];
const alert = (profile_id, id, extra = {}) => ({ id, profile_id, type: 'air_quality_change', title: `Alert ${id.slice(-1)}`, message: 'm', dedupe_key: `k-${id}`, read: false, dismissed: false, ...extra });

function harness({ broken = false } = {}) {
  if (broken) return createRouteHarness({ tables: {} }); // alerts and notification_prefs missing: PGRST205
  return createRouteHarness({
    tables: haloTables('alerts', 'notification_prefs'),
    seed: ({ alice, bob }) => ({
      alerts: [alert(alice.id, ALICE_1), alert(alice.id, ALICE_2), alert(alice.id, ALICE_READ, { read: true }), alert(bob.id, BOB_1)],
      notification_prefs: [{ profile_id: alice.id, weather_advisory: false }, { profile_id: bob.id, radon_season: false }],
    }),
  });
}
const send = (route, method) => (h, body, options = {}) => h.call(`/api/${route}`, method, { as: 'alice', body, ...options });
const sendRaw = (route, method) => (h, rawBody, options = {}) => h.call(`/api/${route}`, method, { as: 'alice', rawBody, ...options });
const post = send('alerts', 'POST');
const postRaw = sendRaw('alerts', 'POST');
const put = send('notifications', 'PUT');
const putRaw = sendRaw('notifications', 'PUT');
const snapshot = (h) => JSON.stringify({ alerts: h.db.rows('alerts'), prefs: h.db.rows('notification_prefs') });
const writes = (h) => h.db.queryLog.filter((q) => q.operation !== 'select');
const aliceRow = (h, id) => h.db.rows('alerts').find((row) => row.id === id);

/** A rejected request changes no row and runs no write statement. */
async function assertRejected(h, res, before, { status, code, expected, message }) {
  const body = await expectEnvelope(res, { status, code, retryable: false });
  if (expected) assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
  if (message) assert.equal(body.error, message);
  assert.equal(snapshot(h), before, 'a rejected request changes no row');
  assert.deepEqual(writes(h), [], 'and no write statement was run');
  return body;
}
const bad = (sender) => async (body, expected, message) => {
  const h = harness();
  await assertRejected(h, await sender(h, body), snapshot(h), { status: 400, code: 'validation_failed', expected, message });
};
const badAlert = bad(post);
const badPrefs = bad(put);
const badBody = async (route, h, rawBody) => assertRejected(h, await sendRaw(route, route === 'alerts' ? 'POST' : 'PUT')(h, rawBody), snapshot(h), { status: 400, code: 'bad_request' });

// -------------------------------------------------- alerts POST legacy

test('alerts legacy: { id } marks one alert read and answers { ok, updated } with a request id header', async () => {
  const h = harness();
  const res = await post(h, { id: ALICE_1 });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(await res.json(), { ok: true, updated: 1 });
  assert.equal(aliceRow(h, ALICE_1).read, true);
  assert.equal(aliceRow(h, ALICE_2).read, false);
});

test('alerts legacy: { all: true } marks every unread alert of the caller read; { id, dismissed } dismisses and restores', async () => {
  const h = harness();
  assert.deepEqual(await (await post(h, { all: true })).json(), { ok: true, updated: 2 });
  assert.equal(aliceRow(h, BOB_1).read, false, 'the other household is untouched');
  assert.deepEqual(await (await post(h, { id: ALICE_1, dismissed: true })).json(), { ok: true, updated: 1 });
  assert.equal(aliceRow(h, ALICE_1).dismissed, true);
  assert.deepEqual(await (await post(h, { id: ALICE_1, dismissed: false })).json(), { ok: true, updated: 1 });
  assert.equal(aliceRow(h, ALICE_1).dismissed, false);
});

test('alerts legacy: the old precedence holds (dismiss, then all, then read), null counts as not sent, an upper case id works', async () => {
  const h = harness();
  await post(h, { id: ALICE_1, dismissed: true, all: true });
  assert.deepEqual([aliceRow(h, ALICE_1).dismissed, aliceRow(h, ALICE_2).read], [true, false], 'id with dismissed wins over all');
  assert.deepEqual(await (await post(h, { all: true, id: ALICE_2 })).json(), { ok: true, updated: 2 }, 'all wins over a bare id and does not use it');
  const fresh = harness();
  assert.equal((await (await post(fresh, { id: ALICE_1, dismissed: null, all: null })).json()).updated, 1);
  assert.equal(aliceRow(fresh, ALICE_1).read, true);
  assert.equal((await (await post(fresh, { id: ALICE_2.toUpperCase(), all: false })).json()).updated, 1);
  assert.equal(aliceRow(fresh, ALICE_2).read, true);
});

test('alerts legacy: the identity is the token; a body profile_id or user_id changes nothing, and another household\'s id looks like a missing one', async () => {
  const h = harness();
  const bobBefore = JSON.stringify(h.db.rows('alerts').filter((row) => row.profile_id === h.identities.bob.id));
  const foreign = await post(h, { id: BOB_1, profile_id: h.identities.bob.id, user_id: h.identities.bob.id, extra: 1 });
  const missing = await post(h, { id: MISSING });
  assert.deepEqual([foreign.status, await foreign.json()], [missing.status, await missing.json()]);
  assert.equal(JSON.stringify(h.db.rows('alerts').filter((row) => row.profile_id === h.identities.bob.id)), bobBefore);
  assert.ok(h.db.queryLog.filter((q) => q.operation === 'update').every((q) => q.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id)));
});

// --------------------------------------------------- alerts POST input

for (const [label, id] of [
  ['text', 'not-a-uuid'], ['an empty string', ''], ['a number (it used to be skipped)', 5], ['a list (it used to be skipped)', [ALICE_1]],
  ['an object', { id: ALICE_1 }], ['true', true], ['a UUID with a space after it', `${ALICE_1} `], ['a UUID with a character added', `${ALICE_1}0`],
  ['a filter expression', `${ALICE_1}' or '1'='1`],
]) {
  test(`alerts id: ${label} is a 400 with the old sentence and changes nothing`, async () => {
    await badAlert({ id }, [['id', 'invalid_uuid']], 'That alert id is not valid.');
    await badAlert({ id, all: true }, [['id', 'invalid_uuid']]); // a bad id is refused even beside all:true
  });
}

for (const field of ['dismissed', 'all']) {
  for (const value of ['true', 'false', 1, 0, '', [], {}]) {
    test(`alerts ${field}: ${JSON.stringify(value)} is a 400 (it used to fall through to another action) and changes nothing`, async () => {
      await badAlert({ id: ALICE_1, [field]: value }, [[field, 'invalid_boolean']]);
    });
  }
}

test('alerts: nothing to do keeps the old sentence; every problem is reported at once, in order', async () => {
  for (const body of [{}, { dismissed: true }, { all: false }, { all: null, id: null }, { something: 'else' }]) {
    await badAlert(body, [['body', 'action_required']], 'Provide an id, all:true, or id with dismissed.');
  }
  await badAlert({ id: 5, dismissed: 'x', all: 'y' }, [['id', 'invalid_uuid'], ['dismissed', 'invalid_boolean'], ['all', 'invalid_boolean']]);
});

// ------------------------------------------------ notifications PUT

test('notifications legacy: one type is changed, the others keep their stored value, and the five come back with a request id header', async () => {
  const h = harness();
  const res = await put(h, { preferences: { season_summary: false }, profile_id: h.identities.bob.id, extra: 1 });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(await res.json(), { preferences: { air_quality_change: true, weather_advisory: false, new_water_results: true, radon_season: true, season_summary: false } });
  assert.equal(h.db.rows('notification_prefs').find((row) => row.profile_id === h.identities.bob.id).season_summary, true, 'bob\'s row is untouched');
  const all = Object.fromEntries(TYPES.map((type) => [type, false]));
  assert.deepEqual((await (await put(h, { preferences: all })).json()).preferences, all);
});

test('notifications legacy: an empty preferences object is a 200 that changes nothing', async () => {
  const h = harness();
  const res = await put(h, { preferences: {} });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).preferences.weather_advisory, false);
});

for (const type of TYPES) {
  for (const value of ['true', 'false', 1, 0, null, '', [], {}]) {
    test(`notifications ${type}: ${JSON.stringify(value)} is the old 400 sentence and changes nothing`, async () => {
      await badPrefs({ preferences: { [type]: value } }, [[`preferences.${type}`, 'invalid_boolean']], `${type} must be true or false.`);
    });
  }
}

test('notifications: an unknown type keeps the old sentence (the echo is cut at 40 characters), and every problem is reported in key order', async () => {
  await badPrefs({ preferences: { weather: true } }, [['preferences.weather', 'unknown_type']], 'Unknown notification type: weather');
  await badPrefs({ preferences: { profile_id: 'x', air_quality_change: true } }, [['preferences.profile_id', 'unknown_type']]);
  await badPrefs({ preferences: { [`${'k'.repeat(60)}`]: true } }, [[`preferences.${'k'.repeat(40)}`, 'unknown_type']]);
  await badPrefs(JSON.parse('{"preferences":{"__proto__":true}}'), [['preferences.__proto__', 'unknown_type']]);
  await badPrefs({ preferences: { radon_season: 1, nope: true, season_summary: false, air_quality_change: 'x' } }, [['preferences.radon_season', 'invalid_boolean'], ['preferences.nope', 'unknown_type'], ['preferences.air_quality_change', 'invalid_boolean']]);
});

for (const [label, preferences] of [['missing', undefined], ['null', null], ['a string', 'all'], ['a number', 1], ['true', true], ['a list (it used to be a silent no-op)', [true]]]) {
  test(`notifications: preferences that is ${label} is the old 400 sentence and changes nothing`, async () => {
    await badPrefs(preferences === undefined ? {} : { preferences }, [['preferences', 'preferences_required']], 'Send { preferences: { type: boolean } }.');
  });
}

// ------------------------------------------------------------ body

for (const [name, route, sender, senderRaw, valid] of [
  ['alerts POST', 'alerts', post, postRaw, { id: ALICE_1 }],
  ['notifications PUT', 'notifications', put, putRaw, { preferences: { season_summary: false } }],
]) {
  test(`${name}: invalid JSON and a non-object are 400 bad_request (they used to read as {}), and an empty body is the old nothing-to-do answer`, async () => {
    const h = harness();
    for (const rawBody of ['{not json', '[]', '"x"', '5', 'null', '   ']) {
      const body = await badBody(route, h, rawBody);
      assert.equal(body.field_errors.length, 0, rawBody);
    }
    const empty = await expectEnvelope(await senderRaw(h, ''), { status: 400, code: 'validation_failed' });
    assert.equal(empty.field_errors.length, 1);
    assert.deepEqual(writes(h), []);
  });

  test(`${name}: the limit is 2048 bytes; exactly that is read, one more byte is a 413 and nothing changes`, async () => {
    const base = JSON.stringify({ ...valid, pad: '' });
    const padded = (size) => JSON.stringify({ ...valid, pad: 'p'.repeat(size - base.length) });
    assert.equal(Buffer.byteLength(padded(2048)), 2048);
    assert.equal((await senderRaw(harness(), padded(2048))).status, 200);
    const h = harness();
    const before = snapshot(h);
    const body = await assertRejected(h, await senderRaw(h, padded(2049)), before, { status: 413, code: 'payload_too_large' });
    assert.equal(body.error, 'That request is too large.');
    await assertRejected(h, await senderRaw(h, '{}', { headers: { 'content-length': '3000' } }), before, { status: 413, code: 'payload_too_large' });
  });

  test(`${name}: auth failures use the envelope and echo a client request id; ids are echoed on success, 400 and 413`, async () => {
    const h = harness();
    const none = await expectEnvelope(await h.call(`/api/${route}`, name.endsWith('PUT') ? 'PUT' : 'POST', { body: valid }), { status: 401, code: 'auth_required' });
    assert.equal(none.error, 'Sign-in required.');
    await expectEnvelope(await h.call(`/api/${route}`, name.endsWith('PUT') ? 'PUT' : 'POST', { body: valid, headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
    const headers = { 'x-request-id': 'client-trace-0002' };
    const id = (res) => res.headers.get('x-request-id');
    assert.equal(id(await sender(h, valid, { headers })), 'client-trace-0002');
    assert.equal(id(await sender(h, {}, { headers })), 'client-trace-0002');
    assert.equal(id(await senderRaw(h, '{', { headers })), 'client-trace-0002');
    assert.equal(id(await senderRaw(h, 'x'.repeat(3000), { headers })), 'client-trace-0002');
  });

  test(`${name}: a database failure is a 500 envelope with no database text; the real error is logged with the request id`, async (t) => {
    const logged = muteConsoleError(t);
    const body = await expectEnvelope(await sender(harness({ broken: true }), valid), { status: 500, code: 'internal_error', retryable: true });
    assert.equal(body.error, 'Something went wrong on our side. Please try again.');
    assert.doesNotMatch(JSON.stringify(body), /schema cache|alerts|notification_prefs|PGRST|Could not find/);
    assert.ok(loggedText(logged).includes(body.request_id) && loggedText(logged).includes('Could not find the table'));
  });
}

test('alerts: dismissing before migration 0010 is the old 501 sentence in the envelope, and nothing changes', async () => {
  const h = harness();
  const from = h.db.from.bind(h.db);
  const failing = { eq: () => failing, select: () => failing, then: (resolve, reject) => Promise.resolve({ data: null, error: { code: '42703', message: 'column alerts.dismissed does not exist' } }).then(resolve, reject) };
  h.db.from = (name) => {
    const real = from(name);
    return name === 'alerts' ? { update: (payload) => ('dismissed' in payload ? failing : real.update(payload)) } : real;
  };
  const before = snapshot(h);
  const body = await expectEnvelope(await post(h, { id: ALICE_1, dismissed: true }), { status: 501, code: 'feature_unavailable', retryable: false });
  assert.equal(body.error, 'Dismissing alerts needs migration 0010.');
  assert.equal(snapshot(h), before);
  assert.equal((await post(h, { id: ALICE_1 })).status, 200, 'marking read still works');
});
