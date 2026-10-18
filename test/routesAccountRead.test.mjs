/**
 * GET /api/account?feature=recovery (B02 plan, Task 3).
 *
 * The frontend's `useAccountService` calls `account.read` with a feature and
 * then runs `validAccountSnapshot(value, feature)` on the result, discarding
 * anything that does not match. So the shape here is not a suggestion: the
 * authority is `lib/frontend/production/account-service.ts` on
 * `origin/codex/october15-review-refinement`, and `assertRecoverySnapshot`
 * below mirrors that validator's recovery branch. Task 10 adds the formal
 * conformance check against the published contract; this file is the route's
 * own behaviour.
 *
 * Three things this file is really about:
 *
 * 1. The capability is off until someone turns it on (BE-351). Default off,
 *    server side, and while it is off the route reads neither the database nor
 *    the auth provider, so a disabled capability cannot disclose anything.
 * 2. Masking, never the address (BE-201). The response says which address is
 *    linked only to the person it belongs to, and only as a mask.
 * 3. Unknown is not zero. Before migration 0018 the route cannot know whether
 *    a challenge exists, so it reports the feature as unavailable rather than
 *    answering `challenge: null`, which would be a claim it cannot support.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const ROUTE = '/api/account';
const TABLES = haloTables('profiles', 'operations', 'recovery_challenges');

/** The flag that turns the capability on, off unless a test sets it. */
const ON = { HALO_FEATURE_RECOVERY: 'on' };

const hex = (fill) => fill.repeat(64).slice(0, 64);
const ALICE_EMAIL_HASH = hex('a1');
const NONCE_HASH = hex('b2');
const TOKEN_HASH = hex('c3');

const CHALLENGE = '77777777-7777-4777-8777-777777777771';
const OTHER_CHALLENGE = '77777777-7777-4777-8777-777777777772';
const PENDING_OP = '88888888-8888-4888-8888-888888888881';
const SETTLED_OP = '88888888-8888-4888-8888-888888888882';
const OTHER_OP = '88888888-8888-4888-8888-888888888883';
const OTHER_DOMAIN_OP = '88888888-8888-4888-8888-888888888884';

const future = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * `challenges` and `operations` default to empty, so each test seeds only what
 * it is about. alice has a confirmed email; bob is still anonymous.
 */
function harness({ challenges = [], operations = [], identities } = {}) {
  return createRouteHarness({
    tables: TABLES,
    identities: identities ?? {
      alice: { email: 'alice@example.test', emailConfirmedAt: '2026-10-01T10:00:00Z' },
      bob: { email: null, isAnonymous: true },
    },
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id }, { id: bob.id }],
      recovery_challenges: challenges.map((row) => ({
        email_hash: ALICE_EMAIL_HASH,
        nonce_hash: NONCE_HASH,
        ...row,
        profile_id: row.profile_id === 'bob' ? bob.id : alice.id,
      })),
      operations: operations.map((row) => ({ ...row, profile_id: row.profile_id === 'bob' ? bob.id : alice.id })),
    }),
  });
}

const read = (h, who, { feature = 'recovery', env = ON } = {}) =>
  h.call(ROUTE, 'GET', { as: who, url: `${ROUTE}?feature=${feature}`, env });

/** A settled account command in the ledger, which is what the revision counts. */
const accountOp = (id, overrides = {}) => ({
  operation_id: id,
  domain: 'account',
  kind: 'account.request-recovery',
  status: 'succeeded',
  result: { operationId: id, status: 'succeeded' },
  created_at: ago(1000),
  ...overrides,
});

/**
 * The recovery branch of `validAccountSnapshot`, transcribed. Kept as one
 * function so every test asserts the whole contract rather than the one field
 * it happens to care about.
 */
function assertRecoverySnapshot(body) {
  assert.equal(body.feature, 'recovery');
  assert.ok(Number.isSafeInteger(body.revision) && body.revision >= 0, 'revision is a non-negative safe integer');
  assert.ok(Array.isArray(body.unresolvedOperations) && body.unresolvedOperations.every((id) => typeof id === 'string'));
  assert.equal(typeof body.enabled, 'boolean');
  if (body.reason !== undefined) assert.equal(typeof body.reason, 'string');
  const recovery = body.recovery;
  assert.ok(recovery && typeof recovery === 'object' && !Array.isArray(recovery), 'the recovery object is present');
  assert.ok(Array.isArray(recovery.devices), 'devices is a list');
  for (const device of recovery.devices) {
    assert.equal(typeof device.id, 'string');
    assert.equal(typeof device.label, 'string');
    assert.equal(typeof device.current, 'boolean');
    assert.ok(Number.isFinite(Date.parse(device.lastSeen)), 'lastSeen parses as a date');
    assert.ok(Number.isSafeInteger(device.revision) && device.revision >= 0);
  }
  if (recovery.method !== null) {
    assert.equal(typeof recovery.method.id, 'string');
    assert.equal(typeof recovery.method.maskedAddress, 'string');
    assert.ok(Number.isFinite(Date.parse(recovery.method.verifiedAt)), 'verifiedAt parses as a date');
  }
  if (recovery.challenge !== null) {
    assert.equal(typeof recovery.challenge.id, 'string');
    assert.equal(typeof recovery.challenge.maskedAddress, 'string');
    assert.ok(Number.isFinite(Date.parse(recovery.challenge.expiresAt)), 'expiresAt parses as a date');
    assert.ok(
      ['pending', 'expired', 'verified'].includes(recovery.challenge.status),
      `the contract allows only pending, expired and verified here, got ${recovery.challenge.status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The capability flag (BE-351)
// ---------------------------------------------------------------------------

test('the capability is off by default, with an honest reason and nothing disclosed', async () => {
  const h = harness({ challenges: [{ id: CHALLENGE, status: 'pending', expires_at: future() }] });
  const response = await h.call(ROUTE, 'GET', { as: 'alice', url: `${ROUTE}?feature=recovery` });
  assert.equal(response.status, 200);
  const body = await response.json();
  assertRecoverySnapshot(body);
  assert.equal(body.enabled, false);
  assert.ok(body.reason && body.reason.length > 0, 'a disabled capability explains itself');
  assert.equal(body.recovery.method, null, 'nothing is disclosed while the capability is off');
  assert.equal(body.recovery.challenge, null, 'not even that a challenge exists');
});

test('while the capability is off the route reads neither the database nor the auth provider', async () => {
  const h = harness({ challenges: [{ id: CHALLENGE, status: 'pending', expires_at: future() }] });
  await h.call(ROUTE, 'GET', { as: 'alice', url: `${ROUTE}?feature=recovery` });
  const touched = h.db.queryLog.map((entry) => entry.table);
  assert.ok(!touched.includes('recovery_challenges'), 'the challenge table is not read');
  assert.ok(!touched.includes('operations'), 'the ledger is not read');
});

test('the reason carries no em dash, because it is shown to a person', async () => {
  const h = harness();
  const body = await (await h.call(ROUTE, 'GET', { as: 'alice', url: `${ROUTE}?feature=recovery` })).json();
  assert.ok(!body.reason.includes('—'), 'app-facing copy uses no em dash');
});

// ---------------------------------------------------------------------------
// The linked method
// ---------------------------------------------------------------------------

test('a confirmed email is reported as a masked method, never as the address', async () => {
  const h = harness();
  const body = await (await read(h, 'alice')).json();
  assertRecoverySnapshot(body);
  assert.equal(body.enabled, true);
  assert.ok(body.recovery.method, 'alice has a linked method');
  assert.equal(body.recovery.method.verifiedAt, '2026-10-01T10:00:00Z');
  const mask = body.recovery.method.maskedAddress;
  assert.ok(!mask.includes('alice@example.test'), 'the full address is never returned');
  assert.ok(!mask.startsWith('alice'), 'the local part is not readable');
  assert.ok(mask.includes('example.test'), 'the domain is shown, which is what makes a mask recognisable');
});

test('an anonymous household has no recovery method, which is not an error', async () => {
  const h = harness();
  const body = await (await read(h, 'bob')).json();
  assertRecoverySnapshot(body);
  assert.equal(body.recovery.method, null);
  assert.equal(body.enabled, true, 'the capability is on; this household simply has not linked an address');
});

test('an unconfirmed address is not a recovery method: it was never verified', async () => {
  const h = harness({
    identities: { alice: { email: 'alice@example.test', emailConfirmedAt: null }, bob: {} },
  });
  const body = await (await read(h, 'alice')).json();
  assert.equal(body.recovery.method, null, 'an unverified address cannot recover anything');
});

// ---------------------------------------------------------------------------
// The open challenge
// ---------------------------------------------------------------------------

test('a live pending challenge is reported with its expiry and a mask', async () => {
  const expires = future();
  const h = harness({ challenges: [{ id: CHALLENGE, status: 'pending', expires_at: expires }] });
  const body = await (await read(h, 'alice')).json();
  assertRecoverySnapshot(body);
  assert.equal(body.recovery.challenge.id, CHALLENGE);
  assert.equal(body.recovery.challenge.status, 'pending');
  assert.equal(body.recovery.challenge.expiresAt, expires);
  assert.ok(!body.recovery.challenge.maskedAddress.includes('alice@example.test'));
});

test('a pending challenge past its expiry reads as expired, not pending', async () => {
  const h = harness({ challenges: [{ id: CHALLENGE, status: 'pending', expires_at: past() }] });
  const body = await (await read(h, 'alice')).json();
  assert.equal(body.recovery.challenge.status, 'expired', 'the clock decides, not the stored word');
});

test('a consumed challenge is not an open challenge', async () => {
  const h = harness({
    challenges: [
      {
        id: CHALLENGE,
        status: 'verified',
        restore_token_hash: TOKEN_HASH,
        expires_at: future(),
        consumed_at: ago(1000),
      },
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assert.equal(body.recovery.challenge, null, 'it is finished, so there is nothing open to show');
});

test('a collision is not shown as an open challenge, because the contract has no word for it here', async () => {
  // The table stores 'collision' and 'failed'; the account snapshot's challenge
  // may only say pending, expired or verified. Reporting a collision as
  // 'pending' would tell the person to wait for something that will never come.
  for (const status of ['collision', 'failed']) {
    const h = harness({ challenges: [{ id: CHALLENGE, status, expires_at: future() }] });
    const body = await (await read(h, 'alice')).json();
    assert.equal(body.recovery.challenge, null, `${status} is not an open challenge`);
  }
});

test('the newest challenge is the one reported', async () => {
  const expires = future();
  const h = harness({
    challenges: [
      { id: OTHER_CHALLENGE, status: 'pending', expires_at: past(), created_at: ago(60 * 60 * 1000) },
      { id: CHALLENGE, status: 'pending', expires_at: expires, created_at: ago(1000) },
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assert.equal(body.recovery.challenge.id, CHALLENGE);
});

test("another household's challenge is never reported", async () => {
  const h = harness({
    challenges: [{ id: OTHER_CHALLENGE, profile_id: 'bob', status: 'pending', expires_at: future() }],
  });
  const body = await (await read(h, 'alice')).json();
  assert.equal(body.recovery.challenge, null, "bob's challenge is not alice's");
  const forBob = await (await read(h, 'bob')).json();
  assert.equal(forBob.recovery.challenge.id, OTHER_CHALLENGE, 'bob still sees his own');
});

// ---------------------------------------------------------------------------
// Unresolved operations and revision
// ---------------------------------------------------------------------------

test('unresolved operations list this household unsettled account work, and nobody else', async () => {
  const h = harness({
    operations: [
      { operation_id: PENDING_OP, domain: 'account', kind: 'account.command', status: 'pending', created_at: ago(1000) },
      { operation_id: SETTLED_OP, domain: 'account', kind: 'account.command', status: 'succeeded', created_at: ago(1000) },
      { operation_id: OTHER_OP, profile_id: 'bob', domain: 'account', kind: 'account.command', status: 'pending', created_at: ago(1000) },
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assert.deepEqual(body.unresolvedOperations, [PENDING_OP], 'settled work is resolved; another household is not listed');
});

test('revision advances with every account command, so a later write can detect a conflict', async () => {
  const none = await (await read(harness(), 'alice')).json();
  assert.equal(none.revision, 0, 'no command recorded is revision zero');
  const one = await (await read(harness({ operations: [accountOp(SETTLED_OP)] }), 'alice')).json();
  const two = await (
    await read(harness({ operations: [accountOp(SETTLED_OP), accountOp(OTHER_OP)] }), 'alice')
  ).json();
  assert.ok(one.revision > none.revision, 'the first command advances it');
  assert.ok(two.revision > one.revision, 'and so does the next');
  const anonymous = await (await read(harness(), 'bob')).json();
  assert.equal(anonymous.revision, 0, 'a household that has changed nothing is revision zero');
});

// ---------------------------------------------------------------------------
// Input, identity and degradation
// ---------------------------------------------------------------------------

test("revision counts this household's account commands, and nothing else", async () => {
  // Pinned exactly, because task 4's If-Match precondition rests on it: one per
  // account-domain ledger row. A row is written before every command is
  // attempted and is never deleted or edited afterwards, so the revision cannot
  // go backwards when a method is unlinked or a challenge is dropped, which the
  // challenge count it used to be could.
  const h = harness({
    challenges: [
      { id: CHALLENGE, status: 'pending', expires_at: future(), created_at: ago(1000) },
      { id: OTHER_CHALLENGE, status: 'expired', expires_at: past(), created_at: ago(60 * 60 * 1000) },
    ],
    operations: [
      accountOp(SETTLED_OP, { kind: 'account.remove-recovery' }),
      accountOp(OTHER_OP, { profile_id: 'bob' }),
      accountOp(OTHER_DOMAIN_OP, { domain: 'alerts', kind: 'alerts.update' }),
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assert.equal(
    body.revision,
    1,
    'one account command; the challenges, another household and another domain do not count',
  );
});

test('the feature must be one the contract names', async () => {
  const h = harness();
  const response = await read(h, 'alice', { feature: 'nonsense' });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'feature');
});

test('a feature this package has not built yet says so instead of inventing a snapshot', async () => {
  const h = harness();
  for (const feature of ['home', 'device', 'email', 'calendar']) {
    const response = await read(h, 'alice', { feature });
    await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  }
});

test('a missing feature parameter is a validation error, not a silent default', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', { as: 'alice', url: ROUTE, env: ON });
  assert.equal(response.status, 400);
});

test('an unauthenticated read is refused', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', { url: `${ROUTE}?feature=recovery`, env: ON });
  assert.equal(response.status, 401);
});

test('identity comes from the token: a profile_id in the query changes nothing', async () => {
  const h = harness({
    challenges: [{ id: OTHER_CHALLENGE, profile_id: 'bob', status: 'pending', expires_at: future() }],
  });
  const bob = h.identities.bob.id;
  const body = await (
    await h.call(ROUTE, 'GET', { as: 'alice', url: `${ROUTE}?feature=recovery&profile_id=${bob}`, env: ON })
  ).json();
  assert.equal(body.recovery.challenge, null, "naming bob does not read bob's row");
});

test('before migration 0018 the route reports the feature unavailable rather than claiming no challenge exists', async () => {
  const h = createRouteHarness({ tables: haloTables('profiles', 'operations'), seed: ({ alice }) => ({ profiles: [{ id: alice.id }] }) });
  const response = await read(h, 'alice');
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
});

test('a recovery attempt on this identity is not reported as an open verification (0019, Ruling 15)', async () => {
  // POST /api/recovery/request writes a row for the same profile_id. It is not
  // a verification this person started, and its address is not the one the
  // provider has in flight, so reporting it here would tell someone to wait for
  // a message that was addressed to a different request. The challenge field is
  // the link intent only.
  const h = harness({
    challenges: [
      { id: CHALLENGE, intent: 'recover', status: 'pending', expires_at: future() },
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assertRecoverySnapshot(body);
  assert.equal(body.recovery.challenge, null, 'a recovery attempt is not an open link challenge');
  assert.ok(!JSON.stringify(body).includes(CHALLENGE), 'and its id is nowhere in the response');
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'the read changes nothing');
});

test('the newest link challenge is reported even when a recovery attempt is newer', async () => {
  const h = harness({
    challenges: [
      { id: OTHER_CHALLENGE, intent: 'link', status: 'pending', expires_at: future(), created_at: ago(2000) },
      { id: CHALLENGE, intent: 'recover', status: 'pending', expires_at: future(), created_at: ago(1000) },
    ],
  });
  const body = await (await read(h, 'alice')).json();
  assertRecoverySnapshot(body);
  assert.equal(body.recovery.challenge?.id, OTHER_CHALLENGE, 'the link row is the one with something to report');
});

test('before migration 0019 the route cannot tell the two intents apart, so the feature is unavailable', async () => {
  for (const code of ['PGRST204', '42703']) {
    const h = harness({ challenges: [{ id: CHALLENGE, status: 'pending', expires_at: future() }] });
    const failed = withoutColumn(h.db, 'recovery_challenges', 'intent', code);
    const response = await read(h, 'alice');
    await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
    assert.ok(failed.length > 0, `${code} is what refused it`);
    failed.restore();
  }
});

test('before migration 0017 the unresolved operation inventory cannot be answered either', async () => {
  const h = createRouteHarness({
    tables: haloTables('profiles', 'recovery_challenges'),
    seed: ({ alice }) => ({ profiles: [{ id: alice.id }] }),
  });
  const response = await read(h, 'alice');
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
});
