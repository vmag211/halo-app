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

/** The derivation key, which this route needs and `/request` does not. */
const TOKEN_KEY = 'halo-recovery-token-key';
const ON = { HALO_FEATURE_RECOVERY: 'on', HALO_RECOVERY_TOKEN_KEY: TOKEN_KEY };

const LINKED = 'linked@example.test';
const CLIENT_IP = '203.0.113.7';

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

test('a live pending challenge reports pending with its expiry, echoing the status call\'s OWN operation id', async () => {
  const expires = future();
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending', expires_at: expires }],
  });
  const response = await ask(h, poll(1));

  assert.equal(response.status, 200);
  const body = await response.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.operationId, op(101), 'the status call\'s own id (Ruling 7)');
  assert.notEqual(body.operationId, op(1), 'and never requestOperationId, which is a different id here');
  assert.equal(body.status, 'pending');
  assert.equal(body.challengeId, challengeId(1));
  assert.equal(body.expiresAt, expires);
  assert.equal(body.restoreToken, undefined, 'nothing is handed out before anyone has proved anything');
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

test('a link-intent row is invisible to this route, even for the same nonce digest', async () => {
  const h = harness({
    challenges: [{ id: challengeId(1), intent: 'link', nonce_hash: sha256(clientNonce(1)), status: 'pending' }],
  });
  const response = await ask(h, poll(1));
  const body = await response.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'failed', 'a link challenge is not this flow\'s');
  assert.equal(body.challengeId, null, 'and its id is never handed out');
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
    env: { ...ON, HALO_RECOVERY_TOKEN_KEY: 'a-different-key' },
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

test('an expired challenge reports expired: the clock decides, not the stored word', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'pending',
      expires_at: ago(1000),
    }],
  });
  const body = await (await ask(h, poll(1))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'expired', 'the stored word still says pending');
  assert.equal(h.db.rows('recovery_challenges')[0].status, 'pending', 'and the row is not rewritten to say so');
});

test('a verified challenge past its window is expired too, so the derived token has a bounded life', async () => {
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
  assert.equal(body.status, 'expired');
  assert.equal(body.restoreToken, undefined, 'an expired challenge hands out no credential');
});

test('collision and failed are distinct terminal states, and neither is the other', async () => {
  const answers = {};
  for (const [index, status] of ['collision', 'failed'].entries()) {
    const h = harness({
      challenges: [{ id: challengeId(index + 1), nonce_hash: sha256(clientNonce(index + 1)), status }],
    });
    const body = await (await ask(h, poll(index + 1))).json();
    assertRecoveryStatus(body, op(101 + index));
    answers[status] = body.status;
  }
  assert.equal(answers.collision, 'collision', 'a collision keeps its own word, which the UI explains differently');
  assert.equal(answers.failed, 'failed');
  assert.notEqual(answers.collision, answers.failed);
});

test('every stored status maps to the word the client knows, and the clock only moves the two it should', async () => {
  const cases = [
    { status: 'pending', live: 'pending', stale: 'expired' },
    { status: 'verified', live: 'verified', stale: 'expired' },
    { status: 'expired', live: 'expired', stale: 'expired' },
    { status: 'collision', live: 'collision', stale: 'collision' },
    { status: 'failed', live: 'failed', stale: 'failed' },
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

test('a challenge with an unusable expiry is terminal rather than a pending that never arrives', async () => {
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending', expires_at: 'not-a-date' }],
  });
  const body = await (await ask(h, poll(1))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'failed');
  assert.equal(body.expiresAt, null, 'an unparseable expiry is reported as none, which the validator requires');
});

// ---------------------------------------------------------------------------
// Isolation: the nonce is the only thing that resolves a challenge
// ---------------------------------------------------------------------------

test('another household\'s challenge is not reachable, and the refusal says nothing about whose it is', async () => {
  const h = harness({
    challenges: [{ owner: 'bob', id: challengeId(2), nonce_hash: sha256(clientNonce(2)), status: 'verified', restore_token_hash: hex('d4') }],
  });
  const stranger = await ask(h, poll(1));
  const body = await stranger.json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'failed');

  const text = await (await ask(h, poll(1))).text();
  assert.ok(!text.includes(h.identities.bob.id), 'no identity is named');
  assert.ok(!text.includes(challengeId(2)), 'and no challenge id is handed out');

  // Byte-identical to a harness that holds no challenge at all.
  const empty = await ask(harness(), poll(1));
  assert.equal(await (await ask(h, poll(1))).text(), await empty.text(), 'the same answer as nothing existing');
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
    challenges: [{ owner: 'bob', id: challengeId(2), nonce_hash: sha256(clientNonce(2)), status: 'verified', restore_token_hash: hex('d4') }],
  });
  // Naming bob's real challenge id with the wrong nonce must change nothing.
  const guessed = await ask(h, { ...poll(1), challengeId: challengeId(2) });
  const blank = await ask(h, poll(1));
  assert.equal(await guessed.text(), await blank.text(), 'the id the client sends is shape-checked and discarded');
  assert.equal((await (await ask(h, { ...poll(1), challengeId: challengeId(2) })).json()).status, 'failed');
});

test('a consumed challenge is invisible, because consumed_at is the evidence a token was spent', async () => {
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
    }],
  });
  const body = await (await ask(h, poll(1))).json();
  assert.equal(body.status, 'failed', 'a spent challenge is finished, not a state to report');
  assert.equal(body.restoreToken, undefined, 'and single use is not undone by polling');
});

test('with a spent row and a live one for the same digest, the live one is what is reported', async () => {
  // Exactly the shape /request leaves behind: the supersede never touches a
  // consumed row, so one digest can name a spent row and a live one at once.
  const h = harness({
    challenges: [
      {
        id: challengeId(1),
        nonce_hash: sha256(clientNonce(1)),
        status: 'verified',
        restore_token_hash: hex('d4'),
        consumed_at: ago(1000),
        created_at: ago(10_000),
      },
      { id: challengeId(2), nonce_hash: sha256(clientNonce(1)), status: 'pending', created_at: ago(1000) },
    ],
  });
  const body = await (await ask(h, poll(1))).json();
  assert.equal(body.status, 'pending');
  assert.equal(body.challengeId, challengeId(2), 'the unconsumed row, not the spent one');
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
  assert.equal(body.status, 'failed', 'no live challenge, and no reconciliation was asked for');
  assert.deepEqual(
    h.db.queryLog.filter((entry) => entry.table === 'operations'),
    [],
    'the ledger is not even read',
  );
});

test('scope request reconciles the named operation through the ledger when no live challenge exists', async () => {
  const expires = future();
  const h = harness({
    operations: [receipt(op(1), { status: 'pending', challengeId: null, expiresAt: expires })],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.operationId, op(101), 'still the status call\'s own id, not the one being reconciled');
  assert.equal(body.status, 'pending', 'the receipt the lost response would have carried');
  assert.equal(body.expiresAt, expires);
});

test('scope complete reconciles a consumed challenge through the ledger, and never forwards its session', async () => {
  // The case the fallback mainly exists for: a successful /complete consumed
  // the row, so the live lookup finds nothing and the receipt is the only
  // record. The session stays with /complete (Ruling 8); the person clicks
  // "Restore my account" again and that route replays its own receipt.
  const h = harness({
    challenges: [{
      id: challengeId(1),
      nonce_hash: sha256(clientNonce(1)),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
    }],
    operations: [{
      ...receipt(op(1), {
        status: 'verified',
        challengeId: challengeId(1),
        expiresAt: future(),
        session: { identityId: 'SECRET-IDENTITY', accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH' },
      }),
      kind: 'recovery.complete',
    }],
  });
  const response = await ask(h, poll(1, { scope: 'complete' }));
  const text = await response.text();
  const body = JSON.parse(text);

  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'verified');
  assert.equal(body.restoreToken, restoreToken(challengeId(1), clientNonce(1)), 'reissued, so the person can finish');
  assert.equal(body.session, undefined, 'a session is never replayed by this route');
  for (const secret of ['SECRET-IDENTITY', 'SECRET-ACCESS', 'SECRET-REFRESH']) {
    assert.ok(!text.includes(secret), `${secret} does not leave the ledger`);
  }
});

test('a settled failure is reported as failed, and an operation still in flight as pending', async () => {
  const cases = [
    { name: 'settled as failed', row: { operation_id: op(1), status: 'failed', result: null }, expected: 'failed' },
    { name: 'settled as cancelled', row: { operation_id: op(1), status: 'cancelled', result: null }, expected: 'failed' },
    { name: 'still running', row: { operation_id: op(1), status: 'pending', result: null, created_at: ago(0) }, expected: 'pending' },
  ];
  for (const item of cases) {
    const h = harness({ operations: [item.row] });
    const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
    assertRecoveryStatus(body, op(101));
    assert.equal(body.status, item.expected, item.name);
  }
});

test('a dead operation is unknown, which is the one status the database may never hold', async () => {
  // Ruling 9. A pending row past the ledger's staleness window is a crashed
  // attempt, and 'unknown' is exactly the word for "cannot truthfully say
  // more". The CHECK in 0018 forbids storing it, which is safe here because
  // this route writes nothing at all.
  const h = harness({
    operations: [{ operation_id: op(1), status: 'pending', result: null, created_at: ago(10 * 60 * 1000) }],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'unknown');
  assert.ok(
    !JSON.stringify(h.db.rows('recovery_challenges')).includes('unknown'),
    'and nothing in the table was made to say it',
  );
});

test('an operation that is not in the ledger at all is the same terminal failed as no challenge', async () => {
  const withLedger = await ask(harness(), poll(1, { scope: 'request' }));
  const plain = await ask(harness(), poll(1, { scope: 'challenge' }));
  assert.equal(await withLedger.text(), await plain.text(), 'nothing to reconcile reads as nothing happened');
});

test('a live challenge outranks the ledger, because it is the newer record of the same attempt', async () => {
  const expires = future();
  const h = harness({
    challenges: [{ id: challengeId(1), nonce_hash: sha256(clientNonce(1)), status: 'pending', expires_at: expires }],
    operations: [receipt(op(1), { status: 'failed', challengeId: null, expiresAt: null })],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assert.equal(body.status, 'pending', 'the live row is the canonical state');
  assert.equal(body.challengeId, challengeId(1));
  assert.equal(body.expiresAt, expires);
});

test('another household\'s recovery operation is not readable, because the ledger is scoped to the unowned domain', async () => {
  const h = harness({
    operations: [{ ...receipt(op(1), { status: 'verified', challengeId: challengeId(1), expiresAt: future() }), owner: 'bob' }],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assert.equal(body.status, 'failed', 'an owned row is not this route\'s to replay');
});

test('a receipt that is verified but names no challenge is unknown, never a verified body the client discards', async () => {
  const h = harness({
    operations: [receipt(op(1), { status: 'verified', challengeId: null, expiresAt: future() })],
  });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'unknown', 'no challenge id means no token can be derived for it');
  assert.equal(body.restoreToken, undefined);
});

test('a receipt carrying a status the client does not know is reported as unknown', async () => {
  const h = harness({ operations: [receipt(op(1), { status: 'something-else', challengeId: null, expiresAt: null })] });
  const body = await (await ask(h, poll(1, { scope: 'request' }))).json();
  assertRecoveryStatus(body, op(101));
  assert.equal(body.status, 'unknown');
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
  for (const secret of [clientNonce(1), sha256(clientNonce(1)), TOKEN_KEY, hex('d4')]) {
    assert.ok(!text.includes(secret), `${secret.slice(0, 12)} is not in the response`);
    assert.ok(!loggedText(logged).includes(secret), `${secret.slice(0, 12)} is not logged`);
  }
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
