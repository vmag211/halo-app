/**
 * POST /api/recovery/status, the PUBLIC polling step of account recovery
 * (B02 plan, Task 7).
 *
 * The frontend sends
 * `{ challengeId, clientNonce, operationId, requestOperationId, scope }` with
 * `Idempotency-Key: operationId` and validates the answer with
 * `validRecoveryStatus(value, operationId)`
 * (lib/frontend/production/recovery-service.ts on
 * origin/codex/october15-review-refinement). `assertRecoveryStatus` below
 * transcribes that validator rather than trusting a shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createRouteHarness, muteConsoleError, LIMITER_UNAVAILABLE } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';

const ROUTE = '/api/recovery/status';

const OWNED = ['profiles', 'daily_scores', 'household_bands', 'symptom_logs', 'alerts'];
const TABLES = haloTables('operations', 'recovery_challenges', ...OWNED);

/**
 * The derivation key, which this route needs and `/request` does not. At least
 * `MIN_KEY_LENGTH` characters, transcribed from lib/recovery.js: a shorter one
 * leaves the capability shut, which is the point of the floor.
 */
const TOKEN_KEY = 'halo-recovery-token-key-at-least-32-characters-long';
const MIN_KEY_LENGTH = 32;
const ON = { HALO_FEATURE_RECOVERY: 'on', HALO_RECOVERY_TOKEN_KEY: TOKEN_KEY };

const LINKED = 'linked@example.test';
const CLIENT_IP = '203.0.113.7';

/**
 * Enough of Cloudflare's siteverify endpoint for the one test that drives the
 * real POST /api/recovery/request, which is how the two-request existence
 * oracle is reproduced end to end. Nothing here reaches the network, and a
 * fetch to any other host throws.
 */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TOKEN = '0.cf-turnstile-response-ONE.AAAAbbbbCCCCdddd';
const turnstile = () => async (input) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url !== SITEVERIFY) throw new Error(`routesRecoveryStatus: unexpected fetch to ${url}`);
  return new Response(JSON.stringify({ success: true, 'error-codes': [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hex = (fill) => fill.repeat(64).slice(0, 64);
const future = (ms = 30 * 60 * 1000) => new Date(Date.now() + ms).toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const op = (n) => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
const challengeId = (n) => `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`;

/** Two concatenated UUIDs, the shape ProductionRestoreAccessFlow.tsx:42 generates. */
const clientNonce = (n) =>
  `${`${n}`.padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa${`${n}`.padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;

/**
 * The restore token, derived here rather than imported, so the route's own
 * derivation is not what proves it.
 */
const restoreToken = (id, nonce) =>
  createHmac('sha256', TOKEN_KEY).update(`halo:restore:${id}:${sha256(nonce)}`).digest('hex');

function harness({ challenges = [], operations = [], tables = TABLES, rateLimit } = {}) {
  return createRouteHarness({
    tables,
    rateLimit,
    identities: {
      alice: { email: LINKED, emailConfirmedAt: '2026-10-01T10:00:00Z' },
      bob: { email: 'bob@example.test', emailConfirmedAt: '2026-10-01T10:00:00Z' },
    },
    seed: (who) => {
      const rows = { profiles: Object.values(who).map((identity) => ({ id: identity.id, county: 'Durham' })) };
      if (tables.recovery_challenges) {
        rows.recovery_challenges = challenges.map(({ owner = 'alice', ...row }) => ({
          intent: 'recover',
          email_hash: sha256(LINKED),
          expires_at: future(),
          ...row,
          profile_id: who[owner].id,
        }));
      }
      if (tables.operations) {
        rows.operations = operations.map(({ owner, ...row }) => ({
          domain: 'recovery',
          kind: 'recovery.request',
          status: 'succeeded',
          created_at: ago(1000),
          ...row,
          profile_id: owner ? who[owner].id : null,
        }));
      }
      return rows;
    },
  });
}

/** One status call, sent the way the real client sends it. */
function ask(h, body, { env = ON, headers = {}, as = null } = {}) {
  const sent = { 'X-Forwarded-For': CLIENT_IP, ...headers };
  if (body.operationId !== undefined && !('Idempotency-Key' in sent)) {
    sent['Idempotency-Key'] = String(body.operationId);
  }
  return h.call(ROUTE, 'POST', { as, body, env, headers: sent });
}

/**
 * A plain poll: the status call's own id is a BRAND NEW one, deliberately
 * different from `requestOperationId` (the original request's id). Ruling 7
 * lives or dies on which of the two comes back.
 */
const poll = (n, { scope = 'challenge', request = 1 } = {}) => ({
  challengeId: null,
  clientNonce: clientNonce(n),
  operationId: op(100 + n),
  requestOperationId: op(request),
  scope,
});

const STATUSES = ['pending', 'verified', 'expired', 'collision', 'failed', 'unknown'];

/** `validRecoveryStatus(value, operationId)`, plus this repo's no-em-dash rule. */
function assertRecoveryStatus(body, operationId) {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body), 'the answer is an object');
  assert.equal(body.operationId, operationId, 'the answer carries the id the client sent');
  assert.ok(STATUSES.includes(String(body.status)), `status must be one the client knows, got ${body.status}`);
  assert.ok(
    body.challengeId === null || (typeof body.challengeId === 'string' && body.challengeId.length > 0 && body.challengeId.length <= 500),
    'challengeId is null or a non-empty string; an absent key fails the validator',
  );
  assert.ok(
    body.expiresAt === null || (typeof body.expiresAt === 'string' && Number.isFinite(Date.parse(body.expiresAt))),
    'expiresAt is null or a parseable date; an absent key fails the validator',
  );
  if (body.restoreToken !== undefined) {
    assert.ok(typeof body.restoreToken === 'string' && body.restoreToken.length > 0 && body.restoreToken.length <= 8192);
  }
  if (body.status === 'verified') {
    assert.ok(typeof body.restoreToken === 'string' || body.session !== undefined, 'a verified answer must carry one of them');
  }
  assert.ok(!JSON.stringify(body).includes('—'), 'app-facing copy uses no em dash');
}

// ---------------------------------------------------------------------------
// Ruling 7: the echoed id is the status call's own, never requestOperationId
// ---------------------------------------------------------------------------

test('a live challenge echoes the status call\'s OWN operation id, never requestOperationId', async () => {
  // Ruling 7. The two ids are deliberately different on a plain poll, and
  // `validRecoveryStatus` compares the echoed one against the id the client
  // just sent, so getting this backwards makes the client discard every
  // response while the server looks healthy. A verified row is used so the
  // answer is the one shape this route reports as itself, which makes the echo
  // observable alongside real content rather than only in the uniform body.
  const expires = future();
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: expires,
    }],
  });
  const response = await ask(h, poll(1));

  assert.equal(response.status, 200);
  const body = await response.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.operationId, op(101), 'the status call\'s own id');
  assert.notEqual(body.operationId, op(1), 'and never requestOperationId, a different id here');
  assert.equal(body.status, 'verified');
  assert.equal(body.expiresAt, expires);

  // And the same holds for the uniform answer, which every other case gives.
  const uniform = await (await ask(h, poll(9))).json();
  assertRecoveryStatus(uniform, op(109));
  assert.equal(uniform.operationId, op(109));
  assert.notEqual(uniform.operationId, op(1));
});

// ---------------------------------------------------------------------------
// Ruling 23: no row found and a wrong nonce are one answer
// ---------------------------------------------------------------------------

test('no row found and a wrong nonce are byte-identical answers', async () => {
  const missing = harness();
  const wrong = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'verified', restore_token_hash: hex('d4') }],
  });
  const first = await ask(missing, poll(9));
  const second = await ask(wrong, poll(9));

  assert.equal(first.status, second.status);
  assert.equal(await first.text(), await second.text(), 'the same answer, to the byte');
  // Not vacuous: the second harness really does hold a challenge the right
  // nonce would have found.
  assert.equal(wrong.db.rows('recovery_challenges').length, 1);
  const found = await ask(wrong, poll(1));
  assert.equal((await found.json()).status, 'verified', 'the right nonce finds it');
});

// ---------------------------------------------------------------------------
// Ruling 15: the link intent's rows are invisible here
// ---------------------------------------------------------------------------

test('a link-intent row is invisible to this route, even when it is verified and shares the nonce digest', async () => {
  // Ruling 15. Seeded VERIFIED on purpose: `verified` is the only status this
  // route reports as itself, so if the intent filter were dropped this test
  // would see a token handed out for a link challenge. Against a `pending`
  // link row the assertion would hold either way and prove nothing.
  const h = harness({
    challenges: [{
      id: challengeId(1),
      intent: 'link',
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: future(),
    }],
  });
  const body = await (await ask(h, poll(1))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'pending', 'a link challenge is not this flow\'s');
  assert.equal(body.restoreToken, undefined, 'and it can never mint a recovery credential');
  assert.equal(body.challengeId, null, 'nor is its id handed out');
  assert.equal(
    JSON.stringify(body),
    JSON.stringify(await (await ask(harness(), poll(1))).json()),
    'byte-identical to no challenge at all',
  );
});

// ---------------------------------------------------------------------------
// Ruling 6: this route is the exception, 200 and never 503
// ---------------------------------------------------------------------------

test('with the capability off the answer is a terminal failed, HTTP 200, not a 503', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
  });
  const response = await ask(h, poll(1), { env: {} });

  assert.equal(response.status, 200, 'a 5xx here is the reconciliation loop Ruling 6 exists to prevent');
  const body = await response.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'failed');
  assert.equal(body.challengeId, null);
  assert.equal(body.expiresAt, null);
  assert.ok(typeof body.reason === 'string' && body.reason.length > 0, 'the reason is carried in the body');
  assert.ok(loggedText(logged).length > 0, 'and the outage is not invisible server-side');
});

// ---------------------------------------------------------------------------
// Ruling 8: a verified answer always carries a restore token, never a session
// ---------------------------------------------------------------------------

test('a verified challenge reports verified AND carries a restore token, with no session', async () => {
  // The row is seeded directly, which is the ONLY way a verified recover row
  // can exist: nothing in this system marks one verified today (see the route
  // header). That is what is being reported on, not something the route did.
  const expires = future();
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: expires,
    }],
  });
  const response = await ask(h, poll(1));
  const body = await response.json();

  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'verified');
  assert.equal(body.restoreToken, restoreToken(challengeId(1), clientNonce(1)), 'derived, not read from the row');
  assert.equal(body.session, undefined, 'a session is /complete\'s to mint, never this route\'s (Ruling 8)');
  assert.equal(body.challengeId, challengeId(1));
  assert.equal(body.expiresAt, expires);
});

test('the derived token is bound to one challenge and one browser, and is not the stored hash', async () => {
  const h = harness({
    challenges: [
      { id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'verified', restore_token_hash: hex('d4') },
      { id: challengeId(2), nonce_hash: sha256(clientNonce(2)), status: 'verified', restore_token_hash: hex('d4') },
    ],
  });
  const first = await (await ask(h, poll(1))).json();
  const second = await (await ask(h, poll(2))).json();

  assert.notEqual(first.restoreToken, second.restoreToken, 'two challenges, two tokens');
  assert.notEqual(first.restoreToken, hex('d4'), 'the stored hash is not handed out as the token');
  assert.notEqual(first.restoreToken, sha256(clientNonce(1)), 'and neither is the nonce digest');
  assert.ok(!first.restoreToken.includes(clientNonce(1)), 'the nonce itself is nowhere in it');
});

test('a different derivation key gives a different token, so the key is really what binds it', async () => {
  const seed = [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'verified', restore_token_hash: hex('d4') }];
  const first = await (await ask(harness({ challenges: seed }), poll(1))).json();
  const other = await (await ask(harness({ challenges: seed }), poll(1), {
    env: { ...ON, HALO_RECOVERY_TOKEN_KEY: `a-different-key${'x'.repeat(MIN_KEY_LENGTH)}` },
  })).json();

  assert.equal(first.status, 'verified');
  assert.equal(other.status, 'verified');
  assert.notEqual(first.restoreToken, other.restoreToken, 'the key is in the derivation');
});

test('with no derivation key the route is unavailable rather than handing out a token it cannot bind', async (t) => {
  // Ruling 28: a missing key shuts recovery, exactly as a missing Turnstile
  // secret does on /request. It must never derive from a default or an empty
  // secret, because a token anyone can recompute is worse than no token.
  const logged = muteConsoleError(t);
  for (const key of [undefined, '', ' ', '\t\n']) {
    const h = harness({
      challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'verified', restore_token_hash: hex('d4') }],
    });
    const env = { HALO_FEATURE_RECOVERY: 'on' };
    if (key !== undefined) env.HALO_RECOVERY_TOKEN_KEY = key;
    const response = await ask(h, poll(1), { env });

    assert.equal(response.status, 200, `${JSON.stringify(key)}: still answerable, never a 503`);
    const body = await response.json();
    assertRecoveryStatus(body, op(101));
    assert.equal(body.status, 'failed', `${JSON.stringify(key)} is not a key`);
    assert.equal(body.restoreToken, undefined, 'and nothing was derived');
    assert.equal(body.challengeId, null, 'the verified row is not described at all');
  }
  assert.ok(loggedText(logged).length > 0, 'the shut capability is logged');
});

test('the capability-off and no-key answers are the same body, so configuration cannot be read off them', async (t) => {
  muteConsoleError(t);
  const seed = [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }];
  const off = await ask(harness({ challenges: seed }), poll(1), { env: {} });
  const keyless = await ask(harness({ challenges: seed }), poll(1), { env: { HALO_FEATURE_RECOVERY: 'on' } });

  assert.equal(off.status, keyless.status);
  assert.equal(await off.text(), await keyless.text(), 'one refusal, whichever piece is missing');
});

// ---------------------------------------------------------------------------
// The clock, and the terminal states that must stay distinct
// ---------------------------------------------------------------------------

test('an expired challenge is the uniform answer, and the row is not rewritten to say so', async () => {
  // Ruling 30 withdrew "expired is a distinct terminal state": only a real
  // account can own a row that expires, so the word itself was the oracle. What
  // survives is that the clock still decides INTERNALLY, which is what stops an
  // expired row minting a token, and that a status read writes nothing.
  const stale = ago(1000);
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'pending',
      expires_at: stale,
    }],
  });
  const body = await (await ask(h, poll(1))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'pending', 'the one answer');
  assert.equal(body.expiresAt, null, 'and it carries no expiry only a real account could have');
  assert.deepEqual(
    [h.db.rows('recovery_challenges')[0].status, h.db.rows('recovery_challenges')[0].expires_at],
    ['pending', stale],
    'the stored word and the stored expiry are both left exactly as they were',
  );
});

test('a verified challenge past its window hands out no token, so the credential has a bounded life', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: ago(1000),
    }],
  });
  const body = await (await ask(h, poll(1))).json();
  assert.equal(body.status, 'pending', 'the uniform answer, not verified');
  assert.equal(body.restoreToken, undefined, 'an expired challenge is not a credential');
  assert.equal(body.challengeId, null);

  // Non-vacuous: the same row one second inside its window does yield a token.
  const live = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: future(1000),
    }],
  });
  assert.equal((await (await ask(live, poll(1))).json()).status, 'verified');
});

test('collision and failed are NOT distinguishable, which is the withdrawal of must-pass 4', async () => {
  // The plan asked for collision, expired and failed as distinct terminal
  // states AND for never leaking whether an address exists. Ruling 30 found
  // those mutually exclusive for an unauthenticated caller: only a real account
  // can produce a row that collides or fails. This test pins the choice that
  // was made, so nobody restores the distinction without reading why.
  const answers = {};
  for (const [index, status] of ['collision', 'failed'].entries()) {
    const h = harness({
      challenges: [{ id: challengeId(index + 1), nonce_hash: sha256(clientNonce(1)), status, expires_at: future() }],
    });
    const response = await ask(h, poll(1));
    assertRecoveryStatus(await response.clone().json(), op(101));
    answers[status] = await response.text();
    assert.equal(h.db.rows('recovery_challenges').length, 1, `${status}: the row really is there`);
  }
  const notFound = await (await ask(harness(), poll(1))).text();
  assert.equal(answers.collision, notFound, 'a collision reads like nothing at all');
  assert.equal(answers.failed, notFound, 'and so does a failure');
});

test('through the route, only a live verified row is reported as itself; every stored status else is the one answer', async () => {
  const cases = [
    { status: 'pending', live: 'pending', stale: 'pending' },
    { status: 'verified', live: 'verified', stale: 'pending' },
    { status: 'expired', live: 'pending', stale: 'pending' },
    { status: 'collision', live: 'pending', stale: 'pending' },
    { status: 'failed', live: 'pending', stale: 'pending' },
  ];
  for (const [index, item] of cases.entries()) {
    for (const [when, expected] of [['live', item.live], ['stale', item.stale]]) {
      const h = harness({
        challenges: [{
          id: challengeId(index + 1),
          nonce_hash: sha256(clientNonce(index + 1)),
          status: item.status,
          restore_token_hash: item.status === 'verified' ? hex('d4') : null,
          expires_at: when === 'live' ? future() : ago(1000),
        }],
      });
      const body = await (await ask(h, poll(index + 1))).json();
      assertRecoveryStatus(body, op(101 + index));
      assert.equal(body.status, expected, `a ${when} ${item.status} row reports ${expected}`);
    }
  }
});

test('a challenge with an unusable expiry is the uniform answer and never a token', async () => {
  for (const status of ['pending', 'verified']) {
    const h = harness({
      challenges: [{
        id: challengeId(1),
        nonce_hash: sha256(clientNonce(1)),
        status,
        restore_token_hash: status === 'verified' ? hex('d4') : null,
        expires_at: 'not-a-date',
      }],
    });
    const body = await (await ask(h, poll(1))).json();
    assertRecoveryStatus(body, op(101));
    assert.equal(body.status, 'pending', `${status} with an unreadable expiry`);
    assert.equal(body.restoreToken, undefined, 'a row with no usable window is not a credential');
    assert.equal(body.expiresAt, null);
  }
});

// ---------------------------------------------------------------------------
// Isolation: the nonce is the only thing that resolves a challenge
// ---------------------------------------------------------------------------

test('another household\'s challenge is not reachable, and says nothing about whose it is', async () => {
  // bob's row is VERIFIED, so this is non-vacuous: if the lookup were not keyed
  // by the nonce digest, alice's poll would walk away with bob's token.
  const h = harness({
    challenges: [{
      owner: 'bob',
      id: challengeId(2),
      nonce_hash: sha256(clientNonce(2)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: future(),
    }],
  });
  const text = await (await ask(h, poll(1))).text();
  const body = JSON.parse(text);
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'pending', 'the one answer');
  assert.equal(body.restoreToken, undefined);
  assert.ok(!text.includes(h.identities.bob.id), 'no identity is named');
  assert.ok(!text.includes(challengeId(2)), 'and no challenge id is handed out');
  assert.equal(text, await (await ask(harness(), poll(1))).text(), 'the same answer as nothing existing');

  // Not vacuous: bob's own nonce does find it.
  assert.equal((await (await ask(h, poll(2))).json()).status, 'verified');
});

test('an Authorization header changes nothing: the nonce is the only thing that resolves a challenge', async () => {
  const h = harness({
    challenges: [{ owner: 'bob', id: challengeId(2), nonce_hash: sha256(clientNonce(2)), status: 'pending' }],
  });
  const asBob = await ask(h, poll(1), { as: 'bob' });
  const anonymous = await ask(h, poll(1));
  assert.equal(await asBob.text(), await anonymous.text(), 'a session is not authority over whose challenge this is');

  // And a signed-in caller holding the right nonce gets the same answer as one who is not.
  const withSession = await ask(h, poll(2), { as: 'alice' });
  const without = await ask(h, poll(2));
  assert.equal(await withSession.text(), await without.text());
});

test('the client-supplied challengeId is never a lookup key (Ruling 16)', async () => {
  const h = harness({
    challenges: [{
      owner: 'bob',
      id: challengeId(2),
      nonce_hash: sha256(clientNonce(2)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: future(),
    }],
  });
  // Naming bob's real, verified challenge id with the wrong nonce changes
  // nothing. If the id were trusted, this would return bob's restore token.
  const guessed = await ask(h, { ...poll(1), challengeId: challengeId(2) });
  const text = await guessed.text();
  assert.equal(text, await (await ask(h, poll(1))).text(), 'the id the client sends is shape-checked and discarded');
  assert.equal(JSON.parse(text).restoreToken, undefined);
});

test('a consumed challenge is invisible, because consumed_at is the evidence a token was spent', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: future(),
    }],
  });
  const body = await (await ask(h, poll(1))).json();
  assert.equal(body.status, 'pending', 'a spent challenge is finished, not a state to report');
  assert.equal(body.restoreToken, undefined, 'and single use is not undone by polling');
});

test('with a spent row and a live one for the same digest, the live one is what is reported', async () => {
  // Exactly the shape /request leaves behind: the supersede never touches a
  // consumed row, so one digest can name a spent row and a live one at once.
  // The live one is verified, so which row was chosen is observable.
  const h = harness({
    challenges: [
      {
        id: challengeId(1),
        nonce_hash: sha256(clientNonce(1)),
        status: 'verified',
        restore_token_hash: hex('d4'),
        consumed_at: ago(1000),
        created_at: ago(10_000),
        expires_at: future(),
      },
      {
        id: challengeId(2),
        nonce_hash: sha256(clientNonce(1)),
        status: 'verified',
        restore_token_hash: hex('d4'),
        created_at: ago(1000),
        expires_at: future(),
      },
    ],
  });
  const body = await (await ask(h, poll(1))).json();
  assert.equal(body.status, 'verified');
  assert.equal(body.challengeId, challengeId(2), 'the unconsumed row, not the spent one');
  assert.equal(body.restoreToken, restoreToken(challengeId(2), clientNonce(1)), 'and the token is bound to it');
});

// ---------------------------------------------------------------------------
// The three scopes
// ---------------------------------------------------------------------------

/** A settled `/request` receipt, as runOperation stores one. */
const receipt = (id, body) => ({
  operation_id: id,
  kind: 'recovery.request',
  status: 'succeeded',
  result: { operationId: id, ...body },
});

test('scope challenge never consults the ledger: a plain poll asks about no earlier operation', async () => {
  const h = harness({
    operations: [receipt(op(1), { status: 'verified', challengeId: challengeId(1), expiresAt: future() })],
  });
  const body = await (await ask(h, poll(1, { scope: 'challenge' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'pending', 'no live challenge, and no reconciliation was asked for');
  assert.deepEqual(
    h.db.queryLog.filter((entry) => entry.table === 'operations'),
    [],
    'the ledger is not even read',
  );
});

test('a reconciled /request receipt is the uniform answer, because pending carries nothing extra', async () => {
  // /request's receipt is `{pending, null, null}` for a linked and an unlinked
  // address alike, so replaying it can only ever be the one answer. Publishing
  // its fields would have been the oracle a second time over.
  const h = harness({
    operations: [receipt(op(1), { status: 'pending', challengeId: null, expiresAt: future() })],
  });
  const response = await ask(h, poll(1, { scope: 'request' }));
  const body = await response.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.operationId, op(101), 'still the status call\'s own id, not the one being reconciled');
  assert.equal(body.status, 'pending');
  assert.equal(body.challengeId, null);
  assert.equal(body.expiresAt, null, 'the receipt\'s expiry is not republished');
});

test('scope complete reconciles a consumed challenge through the ledger, bound to the nonce, with no session', async () => {
  // The case the fallback exists for: a successful /complete consumed the row,
  // so the live lookup finds nothing and the receipt is the only record. It is
  // published ONLY because the caller's nonce digest resolves to the very
  // challenge the receipt names, which only that browser can produce.
  const expires = future();
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: expires,
    }],
    operations: [{
      ...receipt(op(1), {
        status: 'verified',
        challengeId: challengeId(1),
        expiresAt: expires,
        session: { identityId: 'SECRET-IDENTITY', accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH' },
      }),
      kind: 'recovery.complete',
    }],
  });
  const text = await (await ask(h, poll(1, { scope: 'complete' }))).text();
  const body = JSON.parse(text);

  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'verified');
  assert.equal(body.restoreToken, restoreToken(challengeId(1), clientNonce(1)), 'reissued for the owning browser');
  assert.equal(body.session, undefined, 'a session is never replayed by this route (Ruling 8)');
  for (const secret of ['SECRET-IDENTITY', 'SECRET-ACCESS', 'SECRET-REFRESH']) {
    assert.ok(!text.includes(secret), `${secret} does not leave the ledger`);
  }
});

test('every ledger state but a bound verified receipt is the one answer', async () => {
  // An operation id is not a credential: it turns up in crash reports,
  // analytics payloads and screenshots of a network trace. So holding one must
  // buy no information, which means "in flight", "failed", "cancelled", "dead"
  // and "never recorded" all have to read alike, and alike to no challenge.
  const states = {
    'settled as failed': { operation_id: op(1), status: 'failed', result: null },
    'settled as cancelled': { operation_id: op(1), status: 'cancelled', result: null },
    'still running': { operation_id: op(1), status: 'pending', result: null, created_at: ago(0) },
    'dead past its window': { operation_id: op(1), status: 'pending', result: null, created_at: ago(10 * 60 * 1000) },
    'succeeded with a pending receipt': receipt(op(1), { status: 'pending', challengeId: null, expiresAt: null }),
  };
  const answers = {};
  for (const [name, row] of Object.entries(states)) {
    const h = harness({ operations: [row] });
    const response = await ask(h, poll(1, { scope: 'request' }));
    assertRecoveryStatus(await response.clone().json(), op(101));
    answers[name] = await response.text();
    assert.equal(h.db.rows('operations').length, 1, `${name}: the ledger row really is there`);
  }
  const noOperation = await (await ask(harness(), poll(1, { scope: 'request' }))).text();
  for (const [name, text] of Object.entries(answers)) {
    assert.equal(text, noOperation, `${name} is byte-identical to no operation at all`);
  }
  assert.equal(JSON.parse(noOperation).status, 'pending');
});

test("'unknown' is reserved for a verified receipt this route may not publish, and is never written", async () => {
  // Ruling 9. 'unknown' is the word for "cannot truthfully say more", and the
  // one case that now earns it is a receipt that reached `verified` for a
  // challenge the caller cannot prove is theirs. Everything else is the
  // uniform answer, so `unknown` is not a channel either: reaching it requires
  // a verified receipt to exist at the id the caller quoted.
  const h = harness({
    operations: [receipt(op(1), { status: 'verified', challengeId: challengeId(1), expiresAt: future() })],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'unknown', 'the nonce does not resolve to that challenge');
  assert.equal(body.restoreToken, undefined, 'and no token is derived for it');
  assert.equal(body.challengeId, null);
  assert.ok(
    !JSON.stringify(h.db.rows('recovery_challenges')).includes('unknown'),
    'nothing in the table was made to say it',
  );
  assert.ok(!JSON.stringify(h.db.rows('operations')).includes('"unknown"'), 'and nothing in the ledger either');
});

test('an operation that is not in the ledger at all is the same terminal failed as no challenge', async () => {
  const withLedger = await ask(harness(), poll(1, { scope: 'request' }));
  const plain = await ask(harness(), poll(1, { scope: 'challenge' }));
  assert.equal(await withLedger.text(), await plain.text(), 'nothing to reconcile reads as nothing happened');
});

test('a live verified challenge outranks the ledger, because it is the newer record of the same attempt', async () => {
  const expires = future();
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: expires,
    }],
    operations: [receipt(op(1), { status: 'pending', challengeId: null, expiresAt: null })],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assert.equal(body.status, 'verified', 'the live row is the canonical state');
  assert.equal(body.challengeId, challengeId(1));
  assert.equal(body.expiresAt, expires);
  assert.deepEqual(
    h.db.queryLog.filter((entry) => entry.table === 'operations'),
    [],
    'and the ledger is not consulted when a live row answered',
  );
});

test('another household\'s recovery operation is not readable, because the ledger is scoped to the unowned domain', async () => {
  const h = harness({
    operations: [{ ...receipt(op(1), { status: 'verified', challengeId: challengeId(1), expiresAt: future() }), owner: 'bob' }],
  });
  const text = await (await ask(h, poll(1, { scope: 'request' }))).text();
  assert.equal(JSON.parse(text).status, 'pending', 'an owned row is not this route\'s to replay');
  assert.equal(text, await (await ask(harness(), poll(1, { scope: 'request' }))).text());
});

test('a receipt that is verified but names no challenge is unknown, never a verified body the client discards', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: future(),
    }],
    operations: [receipt(op(1), { status: 'verified', challengeId: null, expiresAt: future() })],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'unknown', 'with no challenge id there is nothing to bind the receipt to');
  assert.equal(body.restoreToken, undefined);
});

test('a receipt carrying a status the client does not know is the uniform answer', async () => {
  for (const status of ['something-else', undefined, null, 42, 'VERIFIED']) {
    const h = harness({ operations: [receipt(op(1), { status, challengeId: challengeId(1), expiresAt: future() })] });
    const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
    assertRecoveryStatus(body, op(101));
    assert.equal(body.status, 'pending', `${JSON.stringify(status)} is not verified, so it says nothing`);
    assert.equal(body.restoreToken, undefined);
  }
});

// ---------------------------------------------------------------------------
// A status read creates and mutates nothing
// ---------------------------------------------------------------------------

test('a status read writes nothing, to the challenge table, the ledger or any owned table', async () => {
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'verified', restore_token_hash: hex('d4') }],
    operations: [receipt(op(1), { status: 'pending', challengeId: null, expiresAt: null })],
  });
  const before = {
    recovery_challenges: h.db.rows('recovery_challenges'),
    operations: h.db.rows('operations'),
  };

  for (const scope of ['challenge', 'request', 'complete']) {
    const response = await ask(h, poll(1, { scope }));
    assert.equal(response.status, 200, scope);
  }
  await h.runAfter();

  assert.deepEqual(h.db.rows('recovery_challenges'), before.recovery_challenges, 'no challenge is created or changed');
  assert.deepEqual(h.db.rows('operations'), before.operations, 'and no operation id of this route\'s own is claimed');
  assert.deepEqual(
    h.db.queryLog.filter((entry) => entry.operation !== 'select').map((entry) => `${entry.operation} ${entry.table}`),
    [],
    'every statement this route makes is a read',
  );
  assert.equal(h.db.generatedLinks.length, 0, 'and the provider is never touched');
});

test('polling twice gives the same answer, because nothing moved between the two', async () => {
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending', expires_at: future() }],
  });
  const first = await (await ask(h, poll(1))).text();
  const second = await (await ask(h, { ...poll(1), operationId: op(555) })).text();
  assert.equal(first.replace(op(101), 'ID'), second.replace(op(555), 'ID'), 'the same state, read twice');
});

// ---------------------------------------------------------------------------
// Before the migrations
// ---------------------------------------------------------------------------

test('before migration 0018 the answer is the same terminal failed, never a false pending', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({ tables: haloTables('profiles', 'operations') });
  const response = await ask(h, poll(1));

  assert.equal(response.status, 200, 'still answerable (Ruling 6)');
  const body = await response.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'failed');
  assert.equal(body.reason, 'recovery_unavailable');
  assert.ok(loggedText(logged).length > 0, 'and the missing schema is logged');
});

test('before migration 0019 the answer is the same terminal failed', async (t) => {
  const logged = muteConsoleError(t);
  const { withoutColumn } = await import('./helpers/missingColumn.mjs');
  for (const code of ['PGRST204', '42703']) {
    const h = harness({
      challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
    });
    const failed = withoutColumn(h.db, 'recovery_challenges', 'intent', code);
    const response = await ask(h, poll(1));

    assert.equal(response.status, 200, `${code}: still answerable`);
    const body = await response.json();
    assertRecoveryStatus(body, op(101));
    assert.equal(body.status, 'failed', `${code}`);
    assert.equal(body.reason, 'recovery_unavailable');
    assert.ok(failed.length > 0, `${code} is what refused it`);
    failed.restore();
  }
  assert.ok(loggedText(logged).length > 0);
});

test('before migration 0017 a reconciling scope still answers rather than failing the whole call', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({ tables: haloTables('profiles', 'recovery_challenges') });
  const response = await ask(h, poll(1, { scope: 'request' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'failed');
  assert.ok(loggedText(logged).length > 0);
});

test('a misspelled flag value is off, like every other capability flag', async (t) => {
  muteConsoleError(t);
  for (const value of ['1', 'yes', 'ON ', '']) {
    const h = harness({
      challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
    });
    const body = await (await ask(h, poll(1), { env: { ...ON, HALO_FEATURE_RECOVERY: value } })).json();
    const expected = value.trim().toLowerCase() === 'on' ? 'pending' : 'failed';
    assert.equal(body.status, expected, `${JSON.stringify(value)}`);
  }
});

test('no Turnstile secret is needed here, because this route sends nothing a human check would guard', async () => {
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
  });
  const body = await (await ask(h, poll(1))).json();
  assert.equal(body.status, 'pending', 'the reconciliation path stays open where /request is shut');
});

// ---------------------------------------------------------------------------
// Validation, which must not become an oracle either
// ---------------------------------------------------------------------------

test('a nonce that could not be a secret is refused, and so is a missing one', async () => {
  const h = harness();
  for (const value of [undefined, null, '', 'short', 42, { nonce: 'x' }, 'x'.repeat(300)]) {
    const response = await ask(h, { ...poll(1), clientNonce: value });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'clientNonce', `${JSON.stringify(value)} is refused`);
  }
  assert.deepEqual(h.db.queryLog, [], 'nothing is read for a request that cannot name a browser');
});

test('an operation id must be a uuid, because every answer has to echo it', async () => {
  const h = harness();
  for (const value of [undefined, null, '', 'not-a-uuid', 42]) {
    const response = await ask(h, { ...poll(1), operationId: value }, { headers: { 'Idempotency-Key': op(101) } });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'operationId', `${JSON.stringify(value)} is refused`);
  }
});

test('a scope this route does not know is refused rather than guessed at', async () => {
  const h = harness();
  for (const value of [undefined, null, '', 'status', 'CHALLENGE', 7]) {
    const response = await ask(h, { ...poll(1), scope: value });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'scope', `${JSON.stringify(value)} is refused`);
  }
});

test('a requestOperationId that is not a uuid is refused, but an absent or cleared one is not', async () => {
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
  });
  for (const value of ['not-a-uuid', 42, {}]) {
    const response = await ask(h, { ...poll(1), requestOperationId: value });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'requestOperationId', `${JSON.stringify(value)} is refused`);
  }
  // The component sends '' when its own ref has been cleared; a half-reset
  // client must still get an answer rather than a dead end.
  for (const value of [undefined, null, '']) {
    const response = await ask(h, { ...poll(1), requestOperationId: value });
    assert.equal(response.status, 200, `${JSON.stringify(value)} is treated as absent`);
    assert.equal((await response.json()).status, 'pending');
  }
});

test('a challengeId that could not be one is refused, though its value is never used', async () => {
  const h = harness();
  for (const value of [42, {}, ['x'], 'x'.repeat(501)]) {
    const response = await ask(h, { ...poll(1), challengeId: value });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'challengeId', `${JSON.stringify(value).slice(0, 20)} is refused`);
  }
});

test('a body key this route does not know is refused rather than quietly ignored', async () => {
  const h = harness();
  const response = await ask(h, { ...poll(1), email: 'linked@example.test', restoreToken: 'x' });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(body.field_errors.map((item) => item.field), ['email', 'restoreToken']);
  assert.deepEqual(h.db.queryLog, []);
});

test('an Idempotency-Key that is not the operation id is refused rather than guessed at', async () => {
  const h = harness();
  const response = await ask(h, poll(1), { headers: { 'Idempotency-Key': op(2) } });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'operationId');
  assert.deepEqual(h.db.queryLog, [], 'nothing is read');
});

test('a body that is not an object, and one that is too large, are refused', async () => {
  const h = harness();
  for (const rawBody of ['not json at all', '[]', 'null', '"text"']) {
    const malformed = await h.call(ROUTE, 'POST', {
      rawBody,
      env: ON,
      headers: { 'X-Forwarded-For': CLIENT_IP, 'content-type': 'application/json' },
    });
    await expectEnvelope(malformed, { status: 400, code: 'bad_request', retryable: false });
  }
  const huge = await h.call(ROUTE, 'POST', {
    rawBody: JSON.stringify({ ...poll(1), challengeId: 'p'.repeat(8192) }),
    env: ON,
    headers: { 'X-Forwarded-For': CLIENT_IP },
  });
  await expectEnvelope(huge, { status: 413, code: 'payload_too_large' });
});

test('GET is not a method this route has', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', {});
  assert.equal(response.status, 405);
});

// ---------------------------------------------------------------------------
// Rate limiting: per client, and failing OPEN, unlike /request
// ---------------------------------------------------------------------------

test('a client that polls too often is told to wait, under this route\'s own key', async () => {
  const keys = [];
  const h = harness({
    rateLimit: (key) => {
      keys.push(key);
      return false;
    },
  });
  const response = await ask(h, poll(1));
  const body = await expectEnvelope(response, { status: 429, code: 'rate_limited' });
  assert.ok(!body.message.includes('@'), 'the refusal names no address');
  assert.deepEqual(keys, [`recovery:status:${sha256(CLIENT_IP)}`], 'its own budget, keyed by a digest');
  assert.ok(!keys[0].includes(CLIENT_IP), 'the client address itself is not a limiter key');
  assert.ok(!keys[0].startsWith('recovery:client:'), 'and not the budget /request spends');
  assert.deepEqual(h.db.queryLog, [], 'a shed request reads nothing');
});

test('the client key is the hop nearest the trusted proxy, so a prepended one cannot buy a fresh bucket', async () => {
  const keys = [];
  const h = harness({
    rateLimit: (key) => {
      keys.push(key);
      return true;
    },
  });
  await ask(h, poll(1), { headers: { 'X-Forwarded-For': ` 192.0.2.44 , 198.51.100.4, ${CLIENT_IP} ` } });
  assert.deepEqual(keys, [`recovery:status:${sha256(CLIENT_IP)}`], 'the hop nearest the proxy');
  assert.ok(!keys[0].includes(sha256('192.0.2.44')), 'never the one the caller chose');
});

test('a limiter that cannot answer lets the poll through, which is the opposite of /request', async (t) => {
  // The deciding reason, recorded next to the code: /status writes nothing and
  // sends nothing, so an outage-time flood costs database reads, while failing
  // closed would make the reconciliation path unanswerable for as long as
  // Redis is down. That is the dead end Ruling 6 exists to prevent.
  const logged = muteConsoleError(t);
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
    rateLimit: () => LIMITER_UNAVAILABLE,
  });
  const response = await ask(h, poll(1));
  assert.equal(response.status, 200, 'the reconciliation path stays open during a limiter outage');
  assert.equal((await response.json()).status, 'pending');
  assert.match(loggedText(logged), /allowing the call/, 'this route passes fallback: true, and the outage is logged');
});

// ---------------------------------------------------------------------------
// Nothing about an address, and nothing proof-bearing, leaves the server
// ---------------------------------------------------------------------------

test('no answer this route gives can say whether an address exists', async () => {
  // It never looks at one: no email field is accepted, no address digest is
  // computed and the provider is never asked anything. So the strongest
  // statement available is that no answer carries an address, its digest, or
  // whose account a challenge belongs to.
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
  });
  const texts = [];
  for (const body of [poll(1), poll(9), poll(9, { scope: 'request' })]) {
    texts.push(await (await ask(h, body)).text());
  }
  for (const text of texts) {
    assert.ok(!text.includes(LINKED), 'no address');
    assert.ok(!text.includes(sha256(LINKED)), 'and not its digest either');
    assert.ok(!text.includes(h.identities.alice.id), 'nor whose account it is');
  }
  assert.equal(h.db.generatedLinks.length, 0, 'the provider is never asked to resolve anything');
});

test('the nonce, its digest and the derivation key reach no response and no log line', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'verified', restore_token_hash: hex('d4') }],
  });
  const text = await (await ask(h, poll(1))).text();
  // The answer really did carry the token, or there would be nothing for the
  // rest of this to be absent from.
  assert.ok(text.includes(restoreToken(challengeId(1), clientNonce(1))));
  const secrets = [clientNonce(1), sha256(clientNonce(1)), TOKEN_KEY, hex('d4')];
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `${secret.slice(0, 12)} is not in the response`);
  }
  // The success path writes no line at all, which is a stronger statement than
  // "no secret is in the line" and is the one worth asserting here. Checking
  // the log for secrets on this path could not fail, because there is nothing
  // to search (review minor).
  assert.equal(loggedText(logged), '', 'a successful status read logs nothing whatsoever');

  // So the log half is exercised where a line IS written: the unavailable path,
  // which is the only thing this route logs. That line has to be clean too.
  const shut = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'verified', restore_token_hash: hex('d4') }],
  });
  await ask(shut, poll(1), { env: {} });
  assert.ok(loggedText(logged).length > 0, 'the unavailable path really does log');
  for (const secret of secrets) {
    assert.ok(!loggedText(logged).includes(secret), `${secret.slice(0, 12)} is not in the one line this route writes`);
  }
  assert.ok(!loggedText(logged).includes(challengeId(1)), 'and neither is the challenge id');
});

test('a failure of ours is a 500 with nothing of the caller in the line', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  h.db.from = ((real) => (name) => {
    const builder = real(name);
    if (name !== 'recovery_challenges') return builder;
    builder.then = (resolve) =>
      Promise.resolve({ data: null, count: null, error: { code: '08006', message: 'connection failure' } }).then(resolve);
    return builder;
  })(h.db.from.bind(h.db));

  const response = await ask(h, poll(1));
  await expectEnvelope(response, { status: 500, code: 'internal_error' });
  assert.ok(!loggedText(logged).includes(clientNonce(1)), 'the nonce is not in the log line');
  assert.ok(!loggedText(logged).includes('connection failure'), 'and neither is the database message');
});

// ---------------------------------------------------------------------------
// The refusals' own copy, which assertRecoveryStatus never sees
// ---------------------------------------------------------------------------

test('no refusal this route can give carries an em dash', async (t) => {
  muteConsoleError(t);
  const refusals = [];
  const record = async (label, response) => {
    assert.ok(response.status >= 400, `${label} really is a refusal, got ${response.status}`);
    const body = await response.json();
    assert.ok(typeof body.message === 'string' && body.message.length > 0, `${label} says something`);
    refusals.push([label, body]);
  };

  await record('no usable nonce', await ask(harness(), { ...poll(1), clientNonce: 'too-short' }));
  await record('an id that is not a uuid', await ask(harness(), { ...poll(1), operationId: 'nope' }, { headers: { 'Idempotency-Key': op(1) } }));
  await record('a scope this route does not know', await ask(harness(), { ...poll(1), scope: 'status' }));
  await record('a challenge reference that could not be one', await ask(harness(), { ...poll(1), challengeId: 42 }));
  await record('a key this route does not know', await ask(harness(), { ...poll(1), email: 'x@y.test' }));
  await record('an Idempotency-Key that disagrees', await ask(harness(), poll(1), { headers: { 'Idempotency-Key': op(2) } }));
  await record('too many requests', await ask(harness({ rateLimit: () => false }), poll(1)));
  await record('a body that is not JSON', await harness().call(ROUTE, 'POST', {
    rawBody: 'not json at all',
    env: ON,
    headers: { 'X-Forwarded-For': CLIENT_IP, 'content-type': 'application/json' },
  }));
  await record('a body over the cap', await harness().call(ROUTE, 'POST', {
    rawBody: JSON.stringify({ ...poll(1), challengeId: 'p'.repeat(8192) }),
    env: ON,
    headers: { 'X-Forwarded-For': CLIENT_IP },
  }));

  for (const [label, body] of refusals) {
    assert.ok(!JSON.stringify(body).includes('—'), `${label}: app-facing copy uses no em dash`);
  }
  assert.equal(refusals.length, 9, 'and every refusal shape this route has is in the sweep');
});

// ---------------------------------------------------------------------------
// Ruling 30: every answer but `verified` is ONE answer
// ---------------------------------------------------------------------------

/**
 * The account-existence oracle this route reinstated, driven through BOTH real
 * routes on one harness, because that is the attack and nothing less proves it
 * is closed (review C1).
 *
 * The mechanism: `/request` creates a `recover` row only when the address
 * resolves to a linked confirmed identity, and keys it by the CALLER's nonce.
 * The caller is a stranger typing someone else's address, which is that
 * route's premise. So an attacker who picks the nonce converts "this address
 * is linked" into "a row exists for the digest I chose", and `/status` reads it
 * back. The earlier claim that another household's row is unreachable because
 * its digest differs was false: the attacker chose the digest.
 */
async function probe(email) {
  const h = harness();
  const env = { ...ON, TURNSTILE_SECRET_KEY: 'turnstile-secret-key' };
  const asked = await h.call('/api/recovery/request', 'POST', {
    body: { email, clientNonce: clientNonce(1), operationId: op(1), captchaToken: TURNSTILE_TOKEN },
    env,
    headers: { 'X-Forwarded-For': CLIENT_IP, 'Idempotency-Key': op(1) },
    fetch: turnstile(),
  });
  assert.equal(asked.status, 200, 'the request itself is always accepted');
  await h.runAfter({ env, fetch: turnstile() });
  const polled = await ask(h, poll(1));
  return { h, requested: await asked.text(), status: polled.status, polled: await polled.text() };
}

test('a stranger cannot learn whether an address has an account by choosing the nonce and then polling', async () => {
  const linked = await probe(LINKED);
  const unlinked = await probe('nobody@example.test');

  // The oracle really was available: one of these harnesses holds a challenge
  // for the attacker's own nonce and the other does not, so the comparison
  // below is not two empty databases agreeing.
  assert.equal(linked.h.db.rows('recovery_challenges').length, 1, 'the linked address did open a challenge');
  assert.equal(unlinked.h.db.rows('recovery_challenges').length, 0);

  assert.equal(linked.requested, unlinked.requested, '/request is uniform, as task 5 already proved');
  assert.equal(linked.status, unlinked.status, 'and so is the status code');
  assert.equal(
    linked.polled,
    unlinked.polled,
    'the status answer is byte-identical, so no two-request oracle exists',
  );
});

test('pending, expired, collision, failed and not-found are several cases and one answer', async () => {
  // Ruling 30. Must-pass 4 is withdrawn: only a real account can produce a row
  // that expires, collides or fails, so reporting those words apart IS the
  // existence oracle. Enumeration safety wins, because it is what Ruling 16
  // withheld the challengeId for.
  const seeds = {
    pending: { status: 'pending', expires_at: future() },
    expired: { status: 'pending', expires_at: ago(1000) },
    'stored expired': { status: 'expired', expires_at: future() },
    collision: { status: 'collision', expires_at: future() },
    failed: { status: 'failed', expires_at: future() },
    'unusable expiry': { status: 'pending', expires_at: 'not-a-date' },
    consumed: { status: 'verified', restore_token_hash: hex('d4'), consumed_at: ago(1000) },
    'verified but past its window': { status: 'verified', restore_token_hash: hex('d4'), expires_at: ago(1000) },
  };
  const answers = {};
  for (const [name, row] of Object.entries(seeds)) {
    const h = harness({ challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), ...row }] });
    const response = await ask(h, poll(1));
    assert.equal(response.status, 200, name);
    answers[name] = await response.text();
    assert.equal(h.db.rows('recovery_challenges').length, 1, `${name}: the row really is there`);
  }
  const notFound = await (await ask(harness(), poll(1))).text();

  for (const [name, text] of Object.entries(answers)) {
    assert.equal(text, notFound, `${name} is byte-identical to a challenge that does not exist`);
  }
  const body = JSON.parse(notFound);
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'pending', 'and the one answer is pending, which the client words conditionally');
  assert.equal(body.challengeId, null, 'with nothing in it that only a real account could produce');
  assert.equal(body.expiresAt, null);
  assert.equal(body.reason, undefined);
});

test('the client\'s own pending copy is conditional, which is why one pending answer is honest', async () => {
  // Quoted from the digest, section 3: 'If this address has recovery set up,
  // check its inbox. Open the verification link, then check here.' The frontend
  // was written to treat pending as existence-agnostic, so collapsing to it
  // matches the client rather than working around it.
  const h = harness({ challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending' }] });
  const body = await (await ask(h, poll(1))).json();
  assert.deepEqual(body, { operationId: op(101), status: 'pending', challengeId: null, expiresAt: null });
});

test('only a verified challenge is answered differently, and only for the browser that owns it', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: future(),
    }],
  });
  const owner = await (await ask(h, poll(1))).json();
  assert.equal(owner.status, 'verified', 'reaching verified needs control of the mailbox');
  assert.equal(owner.restoreToken, restoreToken(challengeId(1), clientNonce(1)));

  // Anyone else gets the one answer, so the verified branch is not a channel.
  const other = await (await ask(h, poll(9))).text();
  assert.equal(other, await (await ask(harness(), poll(9))).text());
});

// ---------------------------------------------------------------------------
// The derivation key's floor (review I3)
// ---------------------------------------------------------------------------

test('a derivation key short enough to search for leaves the capability shut', async (t) => {
  // An attacker who legitimately recovers their own account holds a known
  // (challengeId, nonceHash, token) triple, which is an offline oracle for the
  // key: no request to us, nothing to rate limit, nothing to notice. Recover
  // the key and any later database leak lets them mint a token for every
  // verified row, which is the property 0018's header promises survives a leak.
  const logged = muteConsoleError(t);
  const short = ['halo', 'x'.repeat(MIN_KEY_LENGTH - 1), `  ${'y'.repeat(MIN_KEY_LENGTH - 1)}  `];
  for (const key of short) {
    const h = harness({
      challenges: [{
        id: challengeId(1),
        nonce_hash: sha256(clientNonce(1)),
        status: 'verified',
        restore_token_hash: hex('d4'),
        expires_at: future(),
      }],
    });
    const response = await ask(h, poll(1), { env: { ...ON, HALO_RECOVERY_TOKEN_KEY: key } });
    assert.equal(response.status, 200, `${JSON.stringify(key)}: still answerable, never a 503`);
    const body = await response.json();
    assertRecoveryStatus(body, op(101));
    assert.equal(body.status, 'failed', `${JSON.stringify(key)} is too short to be a key`);
    assert.equal(body.reason, 'recovery_unavailable');
    assert.equal(body.restoreToken, undefined, 'and nothing was derived from it');
  }
  assert.ok(loggedText(logged).length > 0, 'the shut capability is logged');
  for (const key of short) {
    assert.ok(!loggedText(logged).includes(key.trim()), 'and the key itself is never logged');
  }
});

test('a key exactly at the floor is accepted, so the floor is a boundary and not a mood', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      expires_at: future(),
    }],
  });
  const key = 'k'.repeat(MIN_KEY_LENGTH);
  const body = await (await ask(h, poll(1), { env: { ...ON, HALO_RECOVERY_TOKEN_KEY: key } })).json();
  assert.equal(body.status, 'verified', `${MIN_KEY_LENGTH} characters is enough`);
  assert.equal(
    body.restoreToken,
    createHmac('sha256', key).update(`halo:restore:${challengeId(1)}:${sha256(clientNonce(1))}`).digest('hex'),
  );
});

// ---------------------------------------------------------------------------
// The reconcile path's clock and its nonce binding (reviews I1 and I2)
// ---------------------------------------------------------------------------

test('a verified receipt past its own expiry yields no token, the same as a row past its own', async () => {
  // Review I1's second half. This path used to derive a token whenever the
  // receipt said `verified`, with no clock at all, while the row path next to
  // it refused exactly that: one file, two answers. Both now run the expiry
  // through the same comparison.
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: ago(1000),
    }],
    operations: [receipt(op(1), { status: 'verified', challengeId: challengeId(1), expiresAt: ago(1000) })],
  });
  const body = await (await ask(h, poll(1, { scope: 'complete' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'pending', 'the uniform answer, not a fresh credential for a dead challenge');
  assert.equal(body.restoreToken, undefined);
});

test('a receipt with an unreadable expiry yields no token either', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: future(),
    }],
    operations: [receipt(op(1), { status: 'verified', challengeId: challengeId(1), expiresAt: 'not-a-date' })],
  });
  const body = await (await ask(h, poll(1, { scope: 'complete' }))).json();
  assert.equal(body.status, 'pending');
  assert.equal(body.restoreToken, undefined);
});

test('an operation id alone cannot reconcile anything: the receipt is bound to the caller\'s nonce', async () => {
  // Review I2. `requestOperationId` travels in crash reports, analytics
  // payloads and screenshots of a network trace, so holding one must prove
  // nothing. Here the receipt names a real, verified challenge and the caller
  // quotes the right operation id but holds the WRONG nonce.
  const expires = future();
  const seed = {
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: expires,
    }],
    operations: [{
      ...receipt(op(1), { status: 'verified', challengeId: challengeId(1), expiresAt: expires }),
      kind: 'recovery.complete',
    }],
  };
  const thief = await (await ask(harness(seed), poll(9, { scope: 'complete' }))).json();
  assert.equal(thief.status, 'unknown', 'nothing is published to a caller who cannot prove the challenge is theirs');
  assert.equal(thief.restoreToken, undefined, 'and above all no credential');
  assert.equal(thief.challengeId, null, 'nor the id the receipt named');
  assert.equal(thief.expiresAt, null);

  // Not vacuous: the browser that owns the nonce does get it.
  const owner = await (await ask(harness(seed), poll(1, { scope: 'complete' }))).json();
  assert.equal(owner.status, 'verified');
  assert.equal(owner.restoreToken, restoreToken(challengeId(1), clientNonce(1)));
});

test('a receipt naming a challenge that is not the caller\'s own is not published either', async () => {
  // The caller holds a real nonce for a real challenge; the receipt names a
  // DIFFERENT one. Binding is identity of the challenge, not merely "this
  // caller has some challenge".
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: future(),
    }],
    operations: [receipt(op(1), { status: 'verified', challengeId: challengeId(2), expiresAt: future() })],
  });
  const body = await (await ask(h, poll(1, { scope: 'complete' }))).json();
  assert.equal(body.status, 'unknown');
  assert.equal(body.restoreToken, undefined);
});

// ---------------------------------------------------------------------------
// lib/recovery.js directly, because task 8 uses it and the route no longer
// exposes the distinctions it has to make
// ---------------------------------------------------------------------------

const lib = await import('../lib/recovery.js');

/** A row as 0018 stores one, with the bits these functions read. */
const row = (overrides = {}) => ({
  id: challengeId(1),
  status: 'verified',
  expires_at: future(),
  consumed_at: null,
  created_at: ago(1000),
  ...overrides,
});

test('challengeStatus: the clock expires a live-looking row and NEVER revives a terminal one', async () => {
  // The route collapses these words, so this rule is only observable here, and
  // it is what stops a row somebody marked dead coming back as a live
  // challenge because its window was later moved forward.
  const now = Date.now();
  assert.equal(lib.challengeStatus(row({ status: 'pending' }), { now }), 'pending');
  assert.equal(lib.challengeStatus(row({ status: 'pending', expires_at: ago(1) }), { now }), 'expired');
  assert.equal(lib.challengeStatus(row({ status: 'verified' }), { now }), 'verified');
  assert.equal(lib.challengeStatus(row({ status: 'verified', expires_at: ago(1) }), { now }), 'expired');
  for (const status of ['expired', 'collision', 'failed']) {
    assert.equal(
      lib.challengeStatus(row({ status, expires_at: future(60 * 60 * 1000) }), { now }),
      status,
      `a future expiry does not revive a ${status} row`,
    );
  }
  assert.equal(lib.challengeStatus(row({ status: 'unknown' }), { now }), 'failed', "'unknown' is not a stored status");
  assert.equal(lib.challengeStatus(row({ expires_at: 'not-a-date' }), { now }), 'failed');
  assert.equal(lib.challengeStatus(null, { now }), 'failed');
});

test('verifyRestoreToken is the whole gate: verified, live, right nonce, configured key, constant-time match', async () => {
  // Review I1. The expiry bound was advertised by this module and enforced by
  // nobody: `findRecoverChallenge` does not filter `expires_at`, so the only
  // thing between an expired verified row and a minted session was the next
  // route remembering to consult `challengeStatus` first. The clock now lives
  // in the same call that compares, so the two cannot be separated.
  const key = 'k'.repeat(MIN_KEY_LENGTH);
  const nonceHash = sha256(clientNonce(1));
  const good = lib.deriveRestoreToken(key, { challengeId: challengeId(1), nonceHash });
  assert.ok(good, 'a token was derived to test with');
  assert.equal(lib.verifyRestoreToken(row(), { given: good, key, nonceHash }), true);

  const refused = {
    'a pending row': [row({ status: 'pending' }), good],
    'an expired row': [row({ expires_at: ago(1) }), good],
    'a collided row': [row({ status: 'collision' }), good],
    'a failed row': [row({ status: 'failed' }), good],
    'a row with no usable expiry': [row({ expires_at: 'not-a-date' }), good],
    'no row at all': [null, good],
    'the wrong token': [row(), `${good.slice(0, -1)}0`],
    'a token of the wrong length': [row(), good.slice(0, -1)],
    'no token': [row(), undefined],
    'an empty token': [row(), ''],
  };
  for (const [name, [candidate, given]] of Object.entries(refused)) {
    assert.equal(lib.verifyRestoreToken(candidate, { given, key, nonceHash }), false, name);
  }
  assert.equal(lib.verifyRestoreToken(row(), { given: good, key: null, nonceHash }), false, 'no key');
  assert.equal(lib.verifyRestoreToken(row(), { given: good, key, nonceHash: null }), false, 'no nonce digest');
  assert.equal(
    lib.verifyRestoreToken(row(), { given: good, key: 'another-key'.repeat(4), nonceHash }),
    false,
    'a token derived under a different key',
  );
  assert.equal(
    lib.verifyRestoreToken(row(), { given: good, key, nonceHash: sha256(clientNonce(2)) }),
    false,
    'another browser\'s nonce',
  );
  // The expiry is enforced by the clock this call is given, not by wall time.
  assert.equal(
    lib.verifyRestoreToken(row({ expires_at: future(1000) }), { given: good, key, nonceHash, now: Date.now() + 5000 }),
    false,
    'the caller\'s clock decides, so a test can be exact about the boundary',
  );
});

test('a derived token is never the stored hash, and restore_token_hash is not part of the scheme', async () => {
  // The module's header forbids comparing against `restore_token_hash`, because
  // nothing in this application writes it and a guessable value there would
  // make a leaked row replayable. This pins the two apart.
  const key = 'k'.repeat(MIN_KEY_LENGTH);
  const nonceHash = sha256(clientNonce(1));
  const token = lib.deriveRestoreToken(key, { challengeId: challengeId(1), nonceHash });
  assert.notEqual(token, hex('d4'));
  assert.notEqual(token, nonceHash);
  assert.equal(lib.verifyRestoreToken(row({ restore_token_hash: hex('d4') }), { given: hex('d4'), key, nonceHash }), false,
    'the stored hash is not accepted as the token');
  assert.equal(lib.verifyRestoreToken(row(), { given: sha256(token), key, nonceHash }), false,
    'and neither is the digest of a real one');
});

test('restoreTokenKey reads the floor from the environment and fails closed below it', async () => {
  const saved = process.env.HALO_RECOVERY_TOKEN_KEY;
  try {
    for (const value of [undefined, '', '   ', 'halo', 'x'.repeat(MIN_KEY_LENGTH - 1)]) {
      if (value === undefined) delete process.env.HALO_RECOVERY_TOKEN_KEY;
      else process.env.HALO_RECOVERY_TOKEN_KEY = value;
      assert.equal(lib.restoreTokenKey(), null, `${JSON.stringify(value)} is not a key`);
    }
    process.env.HALO_RECOVERY_TOKEN_KEY = `  ${'x'.repeat(MIN_KEY_LENGTH)}  `;
    assert.equal(lib.restoreTokenKey(), 'x'.repeat(MIN_KEY_LENGTH), 'trimmed, and the trimmed length is what counts');
  } finally {
    if (saved === undefined) delete process.env.HALO_RECOVERY_TOKEN_KEY;
    else process.env.HALO_RECOVERY_TOKEN_KEY = saved;
  }
});

test('deriveRestoreToken refuses to derive from a missing input rather than from a default', async () => {
  const key = 'k'.repeat(MIN_KEY_LENGTH);
  const nonceHash = sha256(clientNonce(1));
  assert.equal(lib.deriveRestoreToken(null, { challengeId: challengeId(1), nonceHash }), null);
  assert.equal(lib.deriveRestoreToken('', { challengeId: challengeId(1), nonceHash }), null);
  assert.equal(lib.deriveRestoreToken(key, { challengeId: null, nonceHash }), null);
  assert.equal(lib.deriveRestoreToken(key, { challengeId: challengeId(1), nonceHash: null }), null);
  assert.equal(typeof lib.deriveRestoreToken(key, { challengeId: challengeId(1), nonceHash }), 'string');
});

test('uniformStatus is one shape with nothing in it that only a real account could produce', async () => {
  assert.deepEqual(lib.uniformStatus(op(101)), {
    operationId: op(101),
    status: 'pending',
    challengeId: null,
    expiresAt: null,
  });
  // No reason, no token, no session: a reason would separate it from the
  // capability-off answer, and the other two only a real challenge can have.
  assert.deepEqual(Object.keys(lib.uniformStatus(op(101))), ['operationId', 'status', 'challengeId', 'expiresAt']);
});

test('findRecoverChallenge includes consumed rows only when asked, and never by default', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
      expires_at: future(),
    }],
  });
  const nonceHash = sha256(clientNonce(1));
  assert.equal(await lib.findRecoverChallenge(h.db, { nonceHash }), null, 'a spent row is not a live challenge');
  const spent = await lib.findRecoverChallenge(h.db, { nonceHash, includeConsumed: true });
  assert.equal(spent?.id, challengeId(1), 'and is reachable only for proving ownership');
  assert.equal(await lib.findRecoverChallenge(h.db, { nonceHash: sha256(clientNonce(2)), includeConsumed: true }), null);
  assert.equal(await lib.findRecoverChallenge(h.db, {}), null, 'no digest, no row');
});
