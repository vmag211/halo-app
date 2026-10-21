/**
 * Capability proof for the provider calls B02 depends on: the recovery session
 * ruling (Task 1) and, added by Task 4, the link intent's two admin calls.
 *
 * `POST /api/recovery/complete` (Task 8) must return a real
 * `{ identityId, accessToken, refreshToken }` triple bound to the recovered
 * identity, because the frontend verifies it with `supabase.auth.getUser`
 * before `setSession` (components/production/ProductionRestoreAccessFlow.tsx).
 * The B02 plan rules that this is done server side with the Supabase Admin API
 * in two steps: `auth.admin.generateLink({ type: 'magiclink', email })` yields a
 * `hashed_token`, and `auth.verifyOtp({ token_hash, type })` exchanges it for a
 * session.
 *
 * This file proves that path exists on the SDK actually installed here, by
 * looking at the client object rather than at documentation, so Task 8 is not
 * built on a hypothetical. It runs offline: `createClient` performs no request,
 * and the URL and key below are obvious fakes. No `.env` file is read.
 *
 * What this file deliberately does NOT prove: that a real exchange against a
 * real Supabase project returns a usable session. That needs provider access,
 * which the B01/B02 local-only boundary excludes (docs/backend/WORKFLOW.md
 * step 5). Until someone runs it against a disposable project, the end-to-end
 * exchange is unverified, and the plan's stated fallback still applies: if the
 * exchange fails there, `recovery.complete` returns only a `restoreToken` and
 * the client finishes through a provider-native verification instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/**
 * The version the ruling was checked against. A different installed version has
 * not been checked, so this fails rather than letting an upgrade pass silently.
 */
const RULED_VERSION = '2.110.7';

/**
 * The provider calls this package depends on, as paths from the client object.
 * The first two are Task 8's session minting. The rest are Task 4's: the
 * caller's own `updateUser` is the link (Ruling 10), `getUserById` asks whether
 * the provider has confirmed the address, and `admin.updateUserById` is how
 * `remove-recovery` marks a confirmed address unconfirmed. All of them are
 * checked for the same reason: a route that cannot be exercised against a real
 * project must at least not be built on a method the installed client does not
 * have.
 */
const REQUIRED = [
  'auth.admin.generateLink',
  'auth.verifyOtp',
  'auth.updateUser',
  'auth.admin.updateUserById',
  'auth.admin.getUserById',
];

/** A fake project: createClient does not contact it, and no real key is read. */
const client = () => createClient('https://example.invalid', 'not-a-real-key');

/** Walks a dotted path, following the prototype chain the way a call would. */
function resolve(root, path) {
  return path.split('.').reduce((object, key) => (object == null ? object : object[key]), root);
}

test('the installed @supabase/supabase-js is the version the session-minting ruling was made against', () => {
  const installed = JSON.parse(
    readFileSync(new URL('../node_modules/@supabase/supabase-js/package.json', import.meta.url), 'utf8'),
  ).version;
  assert.equal(
    installed,
    RULED_VERSION,
    `@supabase/supabase-js is ${installed}, but the recovery session ruling was checked against ${RULED_VERSION}. Re-check that auth.admin.generateLink and auth.verifyOtp still behave as Task 8 needs, then update RULED_VERSION.`,
  );
});

test('every provider call this package depends on is present on the installed client', () => {
  const supabase = client();
  for (const path of REQUIRED) {
    assert.equal(typeof resolve(supabase, path), 'function', `the installed client exposes ${path}`);
  }
});

test('the probe discriminates: a method the client does not have is reported missing', () => {
  // Without this, the check above would also pass against a client that had
  // been replaced by something permissive, so the proof would be vacuous.
  const supabase = client();
  assert.equal(resolve(supabase, 'auth.admin.mintSessionDirectly'), undefined);
  assert.equal(resolve(supabase, 'auth.admin.generateLink.nested.missing'), undefined);
});

test('generateLink and verifyOtp each take the single options object the two-step path passes', () => {
  const supabase = client();
  // Arity is what is checkable offline. It is not proof that the provider
  // accepts these arguments: that is the unverified end-to-end exchange above.
  assert.equal(supabase.auth.admin.generateLink.length, 1, 'generateLink takes one options argument');
  assert.equal(supabase.auth.verifyOtp.length, 1, 'verifyOtp takes one options argument');
});

test('no installed admin call can look an address up without sending to it, which is why the recovery request resolves through generateLink', () => {
  // Task 5's POST /api/recovery/request has to answer "does this address
  // resolve to a linked identity" with no session and without creating one.
  // `listUsers` is the only other admin read keyed by anything but an id, and
  // the installed implementation sends page and per_page and nothing else, so
  // it cannot select one address: the alternative would be paging the whole
  // user table per request. `generateLink({ type: 'magiclink' })` therefore
  // does both halves of that step, resolve and send, which is the design
  // decision this evidence supports.
  const source = readFileSync(
    new URL('../node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.js', import.meta.url),
    'utf8',
  );
  const body = /async listUsers\(params\) \{[\s\S]*?\n {4}\}/.exec(source)?.[0];
  assert.ok(body, 'the installed listUsers was found');
  assert.match(body, /\/admin\/users/, 'it reads the admin user list');
  assert.match(body, /per_page/, 'with a page size');
  assert.ok(!/filter|email/.test(body), 'and nothing that could select a single address');
});

test('the admin calls take the id separately, so they can only ever touch the identity named', () => {
  const supabase = client();
  // `remove-recovery` uses updateUserById and every read uses getUserById. The
  // id is a separate argument, which is the point: neither can create another
  // identity or act on one it was not given.
  assert.equal(supabase.auth.admin.updateUserById.length, 2, 'updateUserById takes the id and the attributes');
  assert.equal(supabase.auth.admin.getUserById.length, 1, 'getUserById takes the id');
});

// ---------------------------------------------------------------------------
// Task 4's link intent, after Ruling 10: the user-scoped email change
// ---------------------------------------------------------------------------

/**
 * Ruling 10 requires the link to be the caller's own `auth.updateUser({ email })`
 * rather than the service role's `admin.updateUserById`, so that the address is
 * staged by the provider instead of occupying the unique `auth.users.email`
 * before anyone has proved it.
 *
 * These three tests are why the route sends that method's HTTP request itself
 * instead of calling the method. `updateUser` reads the session from the
 * client's own storage, and a server holding only the caller's bearer access
 * token cannot put one there: `setSession` refuses without a refresh token (which
 * a server must never be sent), and an Authorization header on the client does
 * not stand in for a session. All three facts are checked here, offline and with
 * no network call, so an SDK change that removes the obstacle fails loudly and
 * the route can go back to the method.
 */
test('the user-scoped email change exists on the installed client', () => {
  const supabase = client();
  assert.equal(typeof supabase.auth.updateUser, 'function');
  assert.equal(supabase.auth.updateUser.length, 1, 'updateUser takes one attributes argument');
});

test('updateUser needs a stored session, which a bearer token alone cannot provide', async () => {
  const supabase = client();
  const { data, error } = await supabase.auth.updateUser({ email: 'someone@example.test' });
  assert.equal(data.user, null);
  assert.equal(error?.name, 'AuthSessionMissingError', 'it refuses before it would reach the network');
});

test('neither setSession without a refresh token nor an Authorization header stands in for one', async () => {
  const refused = await client().auth.setSession({ access_token: 'header.payload.signature' });
  assert.equal(refused.error?.name, 'AuthSessionMissingError', 'a server is never sent a refresh token');
  const withHeader = createClient('https://example.invalid', 'not-a-real-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer header.payload.signature' } },
  });
  const stillRefused = await withHeader.auth.updateUser({ email: 'someone@example.test' });
  assert.equal(stillRefused.error?.name, 'AuthSessionMissingError', 'the header is not a session');
});

// ---------------------------------------------------------------------------
// Ruling 27 (Task 9, B02 plan): BE-227 asks for device listing and session
// revocation. Both halves were checked against this installed client rather
// than assumed buildable, by enumerating the admin API off the client object
// the way the rest of this file does.
//
//   listing   there is no method on `auth.admin`, or on its `mfa`, `oauth`,
//             `customProviders` or `passkey` namespaces, whose name is
//             session-shaped. Nothing here can enumerate another identity's
//             sessions.
//   revoking  `auth.admin.signOut` exists, but its one required argument is
//             the JWT of the caller being signed out. A server only ever
//             holds that JWT for the CURRENT caller's own request, never for
//             a different device, so there is no id this route could pass to
//             revoke one.
//
// Both are recorded as a gap in docs/backend/requirements-tracker.md (BE-227)
// rather than worked around, and app/api/account/commands/route.js refuses
// `revoke-device` honestly instead of inventing either half. If a future SDK
// upgrade adds a session-listing method, the first test below fails and says
// so: that is the point of writing the proof as a thing that can fail rather
// than a thing that passes today.
// ---------------------------------------------------------------------------

/**
 * Every method name reachable from `object`: own-enumerable function
 * properties plus prototype methods (how the admin class itself attaches
 * `signOut`, `listUsers` and the rest), and one level into any own property
 * that is itself a plain object (how `mfa`, `oauth`, `customProviders` and
 * `passkey` attach theirs), so a namespace nobody named here, or one a future
 * SDK adds beside them, is still walked instead of silently skipped. Only one
 * level: the real admin object has no namespace nested inside another, and
 * going further would start reading unrelated data (the string values of
 * `admin.headers`) rather than API surface.
 */
function adminMethodNames(object) {
  const names = [];
  for (const key of Object.keys(object)) {
    const value = object[key];
    if (typeof value === 'function') {
      names.push(key);
    } else if (value && typeof value === 'object') {
      for (const nestedKey of Object.keys(value)) {
        if (typeof value[nestedKey] === 'function') names.push(`${key}.${nestedKey}`);
      }
    }
  }
  let proto = Object.getPrototypeOf(object);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof object[key] === 'function') names.push(key);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return names;
}

/**
 * The vocabulary a method for listing another identity's sessions or devices
 * would use. Supabase's own naming is session-shaped (every real name found
 * on the installed admin API is checked against this), but BE-227 is about
 * the device capability, not the word "session" specifically, so a future
 * method named the other way, for example `listDevices`, must be caught too.
 */
const SESSION_OR_DEVICE_SHAPED = /session|device/i;

test('Ruling 27: the admin API has no method that could list another identity\'s sessions or devices', () => {
  const supabase = client();
  const names = adminMethodNames(supabase.auth.admin);
  const matches = names.filter((name) => SESSION_OR_DEVICE_SHAPED.test(name));
  assert.deepEqual(
    matches,
    [],
    matches.length
      ? `found a session- or device-shaped method on the installed admin API: ${matches.join(', ')}. BE-227's ` +
        'device listing may now be buildable; see docs/backend/requirements-tracker.md and re-open Task 9.'
      : undefined,
  );
});

test('Ruling 27: admin.signOut takes one JWT, the caller\'s own, not a device or session id to revoke', () => {
  const supabase = client();
  assert.equal(typeof supabase.auth.admin.signOut, 'function');
  assert.equal(
    supabase.auth.admin.signOut.length,
    1,
    'signOut takes one required argument (the JWT); a server holds that JWT only for the current caller',
  );
});

test('the probe discriminates: a session-shaped or device-shaped method is caught when one exists', () => {
  // Without this, the two tests above would also pass against a client that
  // had grown a session- or device-listing method anywhere in its surface,
  // because the walk or the regex could be silently broken rather than
  // genuinely finding nothing. This checks both vocabularies, and both
  // against an object built to have exactly that.
  const fakeAdmin = {
    listUsers() {},
    oauth: { revokeSession() {} },
    mfa: { listDevices() {} },
    passkey: { nested: { listActiveSessions() {} } },
  };
  const names = adminMethodNames(fakeAdmin);
  const matches = names.filter((name) => SESSION_OR_DEVICE_SHAPED.test(name)).sort();
  assert.deepEqual(matches, ['mfa.listDevices', 'oauth.revokeSession'], 'both vocabularies are found one level deep');
  assert.ok(
    !names.includes('passkey.nested.listActiveSessions') && !names.includes('passkey.nested'),
    'sanity: two levels deep is past the bound this probe checks, which matches the real admin object (no namespace nests inside another)',
  );
});
