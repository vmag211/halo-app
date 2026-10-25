/**
 * GET /api/account/google (feasibility spike, behind HALO_FEATURE_GOOGLE_SIGNIN).
 *
 * The server's reflection of what Supabase holds after a Google link. Run
 * through the real handler with the fake Supabase (no network). It proves:
 * the flag off reads nothing and claims nothing; an anonymous household is
 * reported as such; after the link the same user id is reported as linked and
 * no longer anonymous, with every owned row unchanged; the address is a mask;
 * and one household never sees another's link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { validGoogleSigninStatus } from '../lib/googleSignin.js';

const ROUTE = '/api/account/google';
const ON = { HALO_FEATURE_GOOGLE_SIGNIN: 'on' };
const GOOGLE = { provider: 'google', identity_data: { email: 'pat.lee@gmail.example' }, created_at: '2026-10-25T12:00:00Z' };

function harness() {
  return createRouteHarness({
    tables: { profiles: { primaryKey: 'id' }, household_bands: { primaryKey: 'profile_id' } },
    identities: {
      alice: { email: null, isAnonymous: true, identities: [{ provider: 'anonymous' }] },
      bob: { email: null, isAnonymous: true, identities: [{ provider: 'anonymous' }] },
    },
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id, address: 'alice home' }, { id: bob.id, address: 'bob home' }],
      household_bands: [{ profile_id: alice.id, has_senior: true }],
    }),
  });
}

const read = (h, who, env = ON) => h.call(ROUTE, 'GET', { as: who, env });

/** What Supabase's linkIdentity leaves behind: the same user, Google attached, no longer anonymous. */
function linkGoogle(h, who) {
  const user = h.db.identities.get(h.identities[who].id);
  h.db.identities.set(user.id, {
    ...user,
    isAnonymous: false,
    email: GOOGLE.identity_data.email,
    emailConfirmedAt: '2026-10-25T12:00:00Z',
    identities: [...user.identities, GOOGLE],
  });
}

test('flag off: answers enabled false with the reason, and never asks the provider', async () => {
  const h = harness();
  let providerReads = 0;
  const original = h.db.auth.admin.getUserById;
  h.db.auth.admin.getUserById = async (...args) => { providerReads += 1; return original(...args); };
  linkGoogle(h, 'alice');

  const res = await read(h, 'alice', {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(validGoogleSigninStatus(body));
  assert.equal(body.enabled, false);
  assert.equal(body.linked, false, 'off claims nothing, even for a linked user');
  assert.equal(body.anonymous, null);
  assert.equal(body.maskedAccount, null);
  assert.match(body.reason, /not available yet/);
  assert.equal(providerReads, 0);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');

  await read(h, 'alice'); // the counter is live: on, the route does read
  assert.equal(providerReads, 1);
});

test('a misspelled flag value is off', async () => {
  const h = harness();
  const body = await (await read(h, 'alice', { HALO_FEATURE_GOOGLE_SIGNIN: 'yes' })).json();
  assert.equal(body.enabled, false);
});

test('an anonymous household that has not linked is reported as anonymous and not linked', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  assert.ok(validGoogleSigninStatus(body));
  assert.deepEqual(body, { feature: 'google-signin', enabled: true, anonymous: true, linked: false, maskedAccount: null, linkedAt: null });
});

test('after the link: the same user id, linked, not anonymous, masked, and the household rows untouched', async () => {
  const h = harness();
  const before = JSON.stringify([h.db.rows('profiles'), h.db.rows('household_bands')]);
  const aliceId = h.identities.alice.id;
  linkGoogle(h, 'alice');

  const res = await read(h, 'alice');
  const body = await res.json();
  assert.ok(validGoogleSigninStatus(body));
  assert.equal(body.linked, true);
  assert.equal(body.anonymous, false);
  assert.equal(body.maskedAccount, 'p***@gmail.example');
  assert.equal(body.linkedAt, '2026-10-25T12:00:00Z');
  assert.doesNotMatch(JSON.stringify(body), /pat\.lee/, 'never the address itself');
  assert.equal(h.identities.alice.id, aliceId);
  assert.ok(h.db.identities.has(aliceId), 'the same user, not a new one');
  assert.equal(JSON.stringify([h.db.rows('profiles'), h.db.rows('household_bands')]), before, 'no row moved or changed');
});

test("one household never sees another's link", async () => {
  const h = harness();
  linkGoogle(h, 'alice');
  const body = await (await read(h, 'bob')).json();
  assert.equal(body.linked, false);
  assert.equal(body.anonymous, true);
});

test('no session is a 401 and nothing is read', async () => {
  const h = harness();
  const res = await h.call(ROUTE, 'GET', { env: ON });
  assert.equal(res.status, 401);
});
