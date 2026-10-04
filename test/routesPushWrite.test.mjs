import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { AUTH, BYPASS_ENDPOINTS, FOREIGN_HOST_ENDPOINTS, GENUINE_ENDPOINTS, P256DH, keysFor } from './helpers/pushKeys.mjs';

const { PUSH_HOSTS } = await import('../lib/pushInput.js');
const chr = (code) => String.fromCharCode(code);
const FCM = 'https://fcm.googleapis.com/fcm/send/alice-new-phone-token';
const ALICE_DEVICE = 'https://fcm.googleapis.com/fcm/send/alice-device-token';
const BOB_DEVICE = 'https://updates.push.services.mozilla.com/wpush/v2/bob-device-token';
const LEGACY_DEVICE = 'https://legacy.example.test/send/alice-old-device'; // stored before the allowlist existed
const keys = { p256dh: P256DH, auth: AUTH };
const subscription = (endpoint = FCM, extra = {}) => ({ endpoint, expirationTime: null, keys, ...extra });

function harness({ rateLimit, broken = false } = {}) {
  if (broken) return createRouteHarness({ tables: {} }); // push_subscriptions missing: PGRST205
  return createRouteHarness({
    tables: haloTables('push_subscriptions'),
    rateLimit,
    seed: ({ alice, bob }) => ({
      push_subscriptions: [
        { profile_id: alice.id, endpoint: ALICE_DEVICE, p256dh: 'ALICE-P256DH-MARKER', auth: 'ALICE-AUTH-MARKER' },
        { profile_id: alice.id, endpoint: LEGACY_DEVICE, p256dh: 'ALICE-OLD-P256DH', auth: 'ALICE-OLD-AUTH' },
        { profile_id: bob.id, endpoint: BOB_DEVICE, p256dh: 'BOB-P256DH-MARKER', auth: 'BOB-AUTH-MARKER' },
      ],
    }),
  });
}
const subscribe = (h, body, options = {}) => h.call('/api/push/subscribe', 'POST', { as: 'alice', body, ...options });
const subscribeRaw = (h, rawBody, options = {}) => h.call('/api/push/subscribe', 'POST', { as: 'alice', rawBody, ...options });
const remove = (h, body, options = {}) => h.call('/api/push/subscribe', 'DELETE', { as: 'alice', body, ...options });
const removeRaw = (h, rawBody, options = {}) => h.call('/api/push/subscribe', 'DELETE', { as: 'alice', rawBody, ...options });
const rows = (h) => h.db.rows('push_subscriptions');
const snapshot = (h) => JSON.stringify(rows(h));
const writes = (h) => h.db.queryLog.filter((q) => q.operation !== 'select');

/** A rejected request changes no row and runs no write statement. */
async function assertRejected(h, res, before, { status, code, expected }) {
  const body = await expectEnvelope(res, { status, code, retryable: status === 429 });
  if (expected) assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(snapshot(h), before, 'a rejected request changes no row');
  assert.deepEqual(writes(h), [], 'and no write statement was run');
  return body;
}
const bad = async (send, body, expected) => {
  const h = harness();
  const before = snapshot(h);
  const res = await send(h, body);
  const envelope = await assertRejected(h, res, before, { status: 400, code: 'validation_failed', expected });
  assert.equal(envelope.error, envelope.field_errors[0].message);
};

// ----------------------------------------------------- legacy POST

test('legacy POST: a browser subscription is stored for the caller; the answer is exactly { ok: true } plus a request id header', async () => {
  const h = harness();
  const res = await subscribe(h, subscription(FCM, { profile_id: h.identities.bob.id, user_id: h.identities.bob.id, extra: 1 }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(await res.json(), { ok: true });
  const stored = rows(h).filter((row) => row.endpoint === FCM);
  assert.deepEqual(stored.map((row) => [row.profile_id, row.p256dh, row.auth]), [[h.identities.alice.id, P256DH, AUTH]]);
});

test('legacy POST: the same device registered again refreshes its keys in place; another household\'s endpoint is not taken over and answers the same', async () => {
  const h = harness();
  const bobBefore = JSON.stringify(rows(h).filter((row) => row.profile_id === h.identities.bob.id));
  const rotated = keysFor('ROTATED');
  const refreshed = await subscribe(h, { endpoint: ALICE_DEVICE, keys: rotated });
  const clash = await subscribe(h, { endpoint: BOB_DEVICE, keys });
  assert.deepEqual([await refreshed.json(), await clash.json()], [{ ok: true }, { ok: true }]);
  const own = rows(h).filter((row) => row.endpoint === ALICE_DEVICE);
  assert.deepEqual(own.map((row) => [row.p256dh, row.auth]), [[rotated.p256dh, rotated.auth]]);
  assert.equal(JSON.stringify(rows(h).filter((row) => row.profile_id === h.identities.bob.id)), bobBefore);
});

test('every Web Push host is accepted, as is any subdomain of one, an explicit :443 and the six forms real browsers send', async () => {
  const h = harness();
  const accepted = [...PUSH_HOSTS.map((host) => `https://${host}/send/token-a`), ...GENUINE_ENDPOINTS];
  assert.deepEqual(PUSH_HOSTS, ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']);
  for (const endpoint of accepted) assert.equal((await subscribe(h, subscription(endpoint))).status, 200, endpoint);
  assert.ok(accepted.every((endpoint) => rows(h).some((row) => row.endpoint === endpoint)));
});

// ------------------------------------------------------- endpoint

const NOT_ALLOWED = 'endpoint_host_not_allowed';
const INVALID = 'invalid_endpoint';
const BAD_ENDPOINTS = [
  ['missing', undefined, INVALID], ['null', null, INVALID], ['an empty string', '', INVALID], ['a number', 5, INVALID],
  ['an array', [FCM], INVALID], ['an object', { href: FCM }, INVALID],
  ['http', 'http://fcm.googleapis.com/fcm/send/x', INVALID], ['ftp', 'ftp://fcm.googleapis.com/x', INVALID], ['javascript:', 'javascript:alert(1)', INVALID],
  ['no scheme', 'fcm.googleapis.com/fcm/send/x', INVALID], ['a protocol relative URL', '//fcm.googleapis.com/fcm/send/x', INVALID],
  ['an unknown host', 'https://push.example.test/send/x', NOT_ALLOWED], ['an internal host', 'https://localhost/x', NOT_ALLOWED],
  ['a host that only ends with the same letters', 'https://evilfcm.googleapis.com/x', NOT_ALLOWED],
  ['an allowed host used as a prefix', 'https://fcm.googleapis.com.evil.example/x', NOT_ALLOWED],
  ['an allowed host in the path', 'https://evil.example/fcm.googleapis.com/x', NOT_ALLOWED],
  ['an allowed host in the query', 'https://evil.example/x?h=fcm.googleapis.com', NOT_ALLOWED],
  ['an allowed host as the user name', 'https://fcm.googleapis.com@evil.example/x', INVALID],
  ['a user and password', 'https://user:secret@fcm.googleapis.com/x', INVALID], ['a password with no user name', 'https://:secret@fcm.googleapis.com/x', INVALID],
  ['a port other than 443', 'https://fcm.googleapis.com:8443/x', INVALID], ['port 80', 'https://fcm.googleapis.com:80/x', INVALID],
  ['an IPv4 address', 'https://127.0.0.1/x', NOT_ALLOWED], ['a cloud metadata address', 'https://169.254.169.254/latest/meta-data', NOT_ALLOWED],
  ['a punycode host that merely looks like an allowed one', 'https://xn--fcm-9na.googleapis.com/x', NOT_ALLOWED],
  ['a backslash that some parsers read as the end of the host', 'https://evil.example\\@fcm.googleapis.com/x', INVALID],
  ['a space', 'https://fcm.googleapis.com/fcm send', INVALID], ['a tab', `https://fcm.googleapis.com/fcm${chr(9)}send`, INVALID],
  ['a line break', `https://fcm.googleapis.com/fcm${chr(10)}send`, INVALID], ['a NUL', `https://fcm.googleapis.com/fcm${chr(0)}send`, INVALID],
  ['a non-ASCII character', `https://fcm.googleapis.com/fcm/s${chr(0xe9)}nd`, INVALID], ['a full width letter in the host', `https://${chr(0xff46)}cm.googleapis.com/x`, INVALID],
  ['over 2048 characters', `https://fcm.googleapis.com/${'a'.repeat(2049 - 'https://fcm.googleapis.com/'.length)}`, 'endpoint_too_long'],
];
// The vectors that read as an allowed host to one URL parser and as another host to the other.
for (const [label, endpoint] of BYPASS_ENDPOINTS) BAD_ENDPOINTS.push([label, endpoint, INVALID]);
for (const [label, endpoint] of FOREIGN_HOST_ENDPOINTS) BAD_ENDPOINTS.push([label, endpoint, NOT_ALLOWED]);
for (const [label, endpoint, code] of BAD_ENDPOINTS) {
  test(`POST endpoint: ${label} is a 400 and changes nothing`, async () => {
    await bad(subscribe, endpoint === undefined ? { keys } : subscription(endpoint), [['endpoint', code]]);
  });
}

test('POST endpoint: exactly 2048 characters are accepted', async () => {
  const h = harness();
  const endpoint = `https://fcm.googleapis.com/${'a'.repeat(2048 - 'https://fcm.googleapis.com/'.length)}`;
  assert.equal(endpoint.length, 2048);
  assert.equal((await subscribe(h, subscription(endpoint))).status, 200);
});

// ----------------------------------------------------------- keys

const BOTH = [['keys.p256dh', 'invalid_key'], ['keys.auth', 'invalid_key']];
const ONLY_P256DH = [['keys.p256dh', 'invalid_key']];
const ONLY_AUTH = [['keys.auth', 'invalid_key']];
const withP256dh = (p256dh) => ({ p256dh, auth: AUTH });
const withAuth = (auth) => ({ p256dh: P256DH, auth });
const BAD_KEYS = [
  ['missing', undefined, BOTH], ['null', null, BOTH], ['a string', 'keys', BOTH], ['a list', [P256DH, AUTH], BOTH], ['empty', {}, BOTH],
  ['only p256dh', { p256dh: P256DH }, ONLY_AUTH], ['only auth', { auth: AUTH }, ONLY_P256DH],
  ['numbers', { p256dh: 5, auth: 6 }, BOTH], ['empty strings', { p256dh: '', auth: '' }, BOTH],
  ['short text for both', { p256dh: 'a'.repeat(16), auth: 'a'.repeat(16) }, BOTH],
  ['a p256dh of 86 characters', withP256dh(P256DH.slice(0, 86)), ONLY_P256DH],
  ['a p256dh of 88 characters with no padding (66 bytes)', withP256dh(`${P256DH}A`), ONLY_P256DH],
  ['a p256dh with two padding characters', withP256dh(`${P256DH}==`), ONLY_P256DH],
  ['a p256dh that is not an uncompressed point (first byte 0x08, not 0x04)', withP256dh(`C${P256DH.slice(1)}`), ONLY_P256DH],
  ['a p256dh in standard base64 (plus and slash)', withP256dh(`${P256DH.slice(0, 85)}+/`), ONLY_P256DH],
  ['a p256dh with a space inside', withP256dh(`${P256DH.slice(0, 40)} ${P256DH.slice(41)}`), ONLY_P256DH],
  ['a p256dh with padding in the middle', withP256dh(`${P256DH.slice(0, 40)}=${P256DH.slice(41)}`), ONLY_P256DH],
  ['a p256dh with a non-ASCII character', withP256dh(`${P256DH.slice(0, 86)}\u00e9`), ONLY_P256DH],
  ['a p256dh with a line break', withP256dh(`${P256DH.slice(0, 86)}${chr(10)}`), ONLY_P256DH],
  ['an auth of 21 characters', withAuth(AUTH.slice(0, 21)), ONLY_AUTH],
  ['an auth of 23 characters', withAuth(`${AUTH}A`), ONLY_AUTH],
  ['an auth with a single padding character', withAuth(`${AUTH}=`), ONLY_AUTH],
  ['an auth with three padding characters', withAuth(`${AUTH}===`), ONLY_AUTH],
  ['an auth in standard base64 (plus and slash)', withAuth(`${AUTH.slice(0, 20)}+/`), ONLY_AUTH],
  ['an auth with a space inside', withAuth(`${AUTH.slice(0, 10)} ${AUTH.slice(11)}`), ONLY_AUTH],
  ['an auth with a line break', withAuth(`${AUTH.slice(0, 21)}${chr(10)}`), ONLY_AUTH],
];
for (const [label, value, expected] of BAD_KEYS) {
  test(`POST keys: ${label} is a 400 and changes nothing`, async () => {
    await bad(subscribe, { endpoint: FCM, ...(value === undefined ? {} : { keys: value }) }, expected);
  });
}

test('POST keys: a browser\'s 87 and 22 characters are accepted, so is the padded form (88 with one =, 24 with ==); they are stored as sent', async () => {
  const h = harness();
  const cases = [[`${FCM}-plain`, P256DH, AUTH], [`${FCM}-pad`, `${P256DH}=`, `${AUTH}==`], [`${FCM}-tag`, keysFor('Abc-_1').p256dh, keysFor('Abc-_1').auth]];
  for (const [endpoint, p256dh, auth] of cases) {
    assert.equal((await subscribe(h, { endpoint, keys: { p256dh, auth } })).status, 200, endpoint);
    assert.deepEqual(rows(h).filter((row) => row.endpoint === endpoint).map((row) => [row.p256dh, row.auth]), [[p256dh, auth]]);
  }
});

test('POST: every problem is reported at once, in order (endpoint, keys.p256dh, keys.auth)', async () => {
  await bad(subscribe, { endpoint: 'http://x', keys: { p256dh: 1, auth: 'short' } }, [['endpoint', INVALID], ['keys.p256dh', 'invalid_key'], ['keys.auth', 'invalid_key']]);
});

// ------------------------------------------------------------ body

test('POST body: invalid JSON and a non-object are 400 bad_request; an empty body is {} and then a missing endpoint and keys', async () => {
  const h = harness();
  const before = snapshot(h);
  for (const rawBody of ['{not json', '[]', '"x"', '5', 'null', '   ']) {
    await assertRejected(h, await subscribeRaw(h, rawBody), before, { status: 400, code: 'bad_request' });
  }
  const empty = await expectEnvelope(await subscribeRaw(h, ''), { status: 400, code: 'validation_failed' });
  assert.deepEqual(empty.field_errors.map((e) => e.field), ['endpoint', 'keys.p256dh', 'keys.auth']);
});

test('the body limit is 4096 bytes for POST and DELETE: exactly that is read, one more byte is a 413, and nothing changes', async () => {
  const sized = (size, extra) => {
    const base = JSON.stringify({ ...extra, pad: '' });
    return JSON.stringify({ ...extra, pad: 'p'.repeat(size - base.length) });
  };
  const h = harness();
  assert.equal(Buffer.byteLength(sized(4096, subscription())), 4096);
  assert.equal((await subscribeRaw(h, sized(4096, subscription()))).status, 200);
  assert.equal((await removeRaw(h, sized(4096, { endpoint: FCM }))).status, 200);
  const fresh = harness();
  const before = snapshot(fresh);
  for (const send of [subscribeRaw, removeRaw]) {
    const body = await assertRejected(fresh, await send(fresh, sized(4097, subscription())), before, { status: 413, code: 'payload_too_large' });
    assert.equal(body.error, 'That request is too large.');
    await assertRejected(fresh, await send(fresh, '{}', { headers: { 'content-length': '5000' } }), before, { status: 413, code: 'payload_too_large' });
  }
});

// ----------------------------------------------------- DELETE

test('legacy DELETE: the caller\'s own device is removed; a missing or another household\'s endpoint looks the same and removes nothing', async () => {
  const h = harness();
  const bobBefore = JSON.stringify(rows(h).filter((row) => row.profile_id === h.identities.bob.id));
  const own = await remove(h, { endpoint: ALICE_DEVICE, profile_id: h.identities.bob.id });
  assert.equal(own.status, 200);
  assert.match(own.headers.get('x-request-id'), UUID);
  assert.deepEqual(await own.json(), { ok: true });
  assert.equal(rows(h).some((row) => row.endpoint === ALICE_DEVICE), false);
  const foreign = await remove(h, { endpoint: BOB_DEVICE });
  const missing = await remove(h, { endpoint: 'https://fcm.googleapis.com/fcm/send/nobody' });
  assert.deepEqual([foreign.status, await foreign.json()], [missing.status, await missing.json()]);
  assert.equal(JSON.stringify(rows(h).filter((row) => row.profile_id === h.identities.bob.id)), bobBefore);
  const deletes = h.db.queryLog.filter((q) => q.operation === 'delete');
  assert.ok(deletes.length === 3 && deletes.every((q) => q.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id)));
});

test('DELETE: a device stored before the allowlist existed can still be removed (the host is only a lookup key)', async () => {
  const h = harness();
  assert.equal((await remove(h, { endpoint: LEGACY_DEVICE })).status, 200);
  assert.equal(rows(h).some((row) => row.endpoint === LEGACY_DEVICE), false);
});

for (const [label, body, code, message] of [
  ['missing', {}, 'endpoint_required', 'Send { endpoint }.'], ['null', { endpoint: null }, 'endpoint_required'], ['a number', { endpoint: 5 }, 'endpoint_required'],
  ['an array', { endpoint: [ALICE_DEVICE] }, 'endpoint_required'], ['an object', { endpoint: {} }, 'endpoint_required'],
  ['an empty string', { endpoint: '' }, 'invalid_endpoint'], ['http', { endpoint: 'http://fcm.googleapis.com/x' }, 'invalid_endpoint'],
  ['not a URL', { endpoint: 'not a url' }, 'invalid_endpoint'], ['carrying a user name', { endpoint: 'https://u@fcm.googleapis.com/x' }, 'invalid_endpoint'],
  ['on another port', { endpoint: 'https://fcm.googleapis.com:8443/x' }, 'invalid_endpoint'], ['with a backslash', { endpoint: 'https://a\\b/x' }, 'invalid_endpoint'],
  ['with a NUL', { endpoint: `https://fcm.googleapis.com/x${chr(0)}` }, 'invalid_endpoint'],
  ['over 2048 characters', { endpoint: `https://fcm.googleapis.com/${'a'.repeat(2049)}` }, 'endpoint_too_long'],
]) {
  test(`DELETE endpoint: ${label} is a 400 and removes nothing`, async () => {
    const h = harness();
    const before = snapshot(h);
    const envelope = await assertRejected(h, await remove(h, body), before, { status: 400, code: 'validation_failed', expected: [['endpoint', code]] });
    if (message) assert.equal(envelope.error, message, 'the old sentence is kept');
  });
}

test('DELETE body: invalid JSON is a 400 bad_request and an empty body is a missing endpoint', async () => {
  const h = harness();
  const before = snapshot(h);
  await assertRejected(h, await removeRaw(h, '{nope'), before, { status: 400, code: 'bad_request' });
  await assertRejected(h, await removeRaw(h, ''), before, { status: 400, code: 'validation_failed', expected: [['endpoint', 'endpoint_required']] });
});

// ------------------------------------------ envelope, limits, errors

test('the household limit is a 429 envelope with the old sentence, before the body is read, for POST and DELETE', async () => {
  const h = harness({ rateLimit: (key) => !key.startsWith('push:') });
  const before = snapshot(h);
  for (const res of [await subscribe(h, subscription()), await subscribeRaw(h, '{broken'), await remove(h, { endpoint: ALICE_DEVICE })]) {
    const body = await assertRejected(h, res, before, { status: 429, code: 'rate_limited' });
    assert.equal(body.retryable, true);
    assert.equal(body.error, 'Too many changes. Try again later.');
  }
});

test('auth failures use the envelope and echo a client request id; nothing is read or written', async () => {
  const h = harness();
  for (const method of ['POST', 'DELETE']) {
    const body = method === 'POST' ? subscription() : { endpoint: ALICE_DEVICE };
    const none = await expectEnvelope(await h.call('/api/push/subscribe', method, { body }), { status: 401, code: 'auth_required' });
    assert.equal(none.error, 'Sign-in required.');
    await expectEnvelope(await h.call('/api/push/subscribe', method, { body, headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  }
  assert.equal(h.db.queryLog.length, 0);
});

test('a well formed client request id is echoed on success, 400, 413 and 429', async () => {
  const headers = { 'x-request-id': 'client-trace-0002' };
  const id = (res) => res.headers.get('x-request-id');
  const h = harness();
  assert.equal(id(await subscribe(h, subscription(), { headers })), 'client-trace-0002');
  assert.equal(id(await subscribe(h, {}, { headers })), 'client-trace-0002');
  assert.equal(id(await remove(h, { endpoint: ALICE_DEVICE }, { headers })), 'client-trace-0002');
  assert.equal(id(await removeRaw(h, '{', { headers })), 'client-trace-0002');
  assert.equal(id(await subscribeRaw(h, 'x'.repeat(5000), { headers })), 'client-trace-0002');
  assert.equal(id(await subscribe(harness({ rateLimit: () => false }), subscription(), { headers })), 'client-trace-0002');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  for (const send of [(h) => subscribe(h, subscription()), (h) => remove(h, { endpoint: ALICE_DEVICE })]) {
    const body = await expectEnvelope(await send(harness({ broken: true })), { status: 500, code: 'internal_error', retryable: true });
    assert.equal(body.error, 'Something went wrong on our side. Please try again.');
    assert.doesNotMatch(JSON.stringify(body), /schema cache|push_subscriptions|PGRST|Could not find/);
    assert.ok(loggedText(logged).includes(body.request_id));
  }
  assert.ok(loggedText(logged).includes('Could not find the table'));
});
