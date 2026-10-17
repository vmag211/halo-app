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
 * The first two are Task 8's session minting; the last two are Task 4's link
 * intent, which attaches an address to the signed-in identity
 * (`updateUserById`) and then asks whether the provider has confirmed it
 * (`getUserById`). Both are checked here for the same reason: a route that
 * cannot be exercised against a real project must at least not be built on a
 * method the installed client does not have.
 */
const REQUIRED = [
  'auth.admin.generateLink',
  'auth.verifyOtp',
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

test('the link intent calls updateUserById the way the route does: an id and an attributes object', () => {
  const supabase = client();
  // The id is a separate argument, which is the whole point: the link intent
  // changes the address on the identity it was given and cannot create another.
  assert.equal(supabase.auth.admin.updateUserById.length, 2, 'updateUserById takes the id and the attributes');
  assert.equal(supabase.auth.admin.getUserById.length, 1, 'getUserById takes the id');
});
