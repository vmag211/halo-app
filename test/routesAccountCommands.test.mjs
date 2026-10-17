/**
 * POST /api/account/commands, the four recovery-method actions (B02 plan, Task 4).
 *
 * The frontend sends `{ feature, action, payload, expectedRevision, operationId }`
 * and validates the answer with `validAccountReceipt(value, id, feature)`
 * (lib/frontend/production/account-service.ts on
 * origin/codex/october15-review-refinement). A succeeded receipt must therefore
 * carry the SAME snapshot `GET /api/account` returns, rebuilt after the change;
 * `assertAccountReceipt` below transcribes that validator so every test checks
 * the whole contract rather than the one field it happens to care about.
 *
 * What this file is really about:
 *
 * 1. The identity is never replaced. Linking an address keeps `auth.users.id`,
 *    `profiles.id` and every owned row exactly as they were (BE-050), and an
 *    address that already belongs to someone else is an explicit failure, never
 *    a merge (BE-334). Both are asserted on real rows, not on a provider call.
 * 2. One effect per operation id. The ledger from Task 2 is the only
 *    idempotency mechanism here: a replay returns the first outcome and does
 *    not act twice.
 * 3. Unknown is not zero. Before migrations 0017 and 0018 the route answers a
 *    non-retryable 503 and writes nothing, rather than reporting a success it
 *    has no way to support.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const ROUTE = '/api/account/commands';

/** A sample of the household's own tables, so "nothing else changed" is not vacuous. */
const OWNED = ['profiles', 'daily_scores', 'household_bands', 'symptom_logs', 'alerts', 'home_contexts'];
const TABLES = haloTables('operations', 'recovery_challenges', ...OWNED);

/** The flag that turns the capability on, off unless a test sets it. */
const ON = { HALO_FEATURE_RECOVERY: 'on' };

/** carol already holds this address, so asking for it is the collision case. */
const TAKEN = 'taken@example.test';
const FRESH = 'new@example.test';
const VERIFIED_AT = '2026-10-01T10:00:00Z';

const op = (n) => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
const CHALLENGE = '77777777-7777-4777-8777-777777777771';
const OTHER_CHALLENGE = '77777777-7777-4777-8777-777777777772';

/** Computed here rather than imported, so the route's own hashing is not what proves it. */
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hex = (fill) => fill.repeat(64).slice(0, 64);
const future = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * alice is a signed-in anonymous household, bob is another one, and carol holds
 * TAKEN. `identities` replaces all three; `challenges` and `operations` default
 * to empty so each test seeds only what it is about, with `owner` naming the
 * household (alice unless given).
 */
function harness({ challenges = [], operations = [], household = false, identities, tables = TABLES } = {}) {
  return createRouteHarness({
    tables,
    identities: identities ?? {
      alice: { email: null, isAnonymous: true },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
    // Only declared tables are seeded: seeding an undeclared one would declare
    // it, and the migration tests below need it to answer PGRST205.
    seed: (who) => {
      const rows = {
        profiles: Object.values(who).map((identity) => ({ id: identity.id, county: 'Durham', zip: '27701' })),
      };
      if (household) Object.assign(rows, householdSeed(who.alice.id));
      if (tables.recovery_challenges) {
        rows.recovery_challenges = challenges.map(({ owner = 'alice', ...row }) => ({
          email_hash: sha256(FRESH),
          nonce_hash: hex('b2'),
          expires_at: future(),
          ...row,
          profile_id: who[owner].id,
        }));
      }
      if (tables.operations) {
        rows.operations = operations.map(({ owner = 'alice', ...row }) => ({
          domain: 'account',
          kind: 'account.request-recovery',
          created_at: ago(1000),
          ...row,
          profile_id: who[owner].id,
        }));
      }
      return rows;
    },
  });
}

/** Household rows that must survive a link untouched, for the identity-preservation proof. */
const householdSeed = (id) => ({
  daily_scores: [{ profile_id: id, date: '2026-10-01', aqi: 42 }],
  household_bands: [{ profile_id: id, has_toddler: true }],
  symptom_logs: [{ profile_id: id, entry_date: '2026-10-01', notes: 'ALICE-NOTE-MARKER' }],
  alerts: [{ profile_id: id, title: 'ALICE-ALERT', dedupe_key: 'alice-1' }],
  home_contexts: [{ profile_id: id, sequence: 1, county: 'Durham' }],
});

/**
 * One command, sent the way the real client sends it: the operation id also in
 * `Idempotency-Key` and the expected revision also in `If-Match`.
 */
function command(h, who, body, { env = ON, headers = {}, url } = {}) {
  const full = { feature: 'recovery', ...body };
  const sent = { ...headers };
  if (full.operationId !== undefined && !('Idempotency-Key' in sent)) {
    sent['Idempotency-Key'] = String(full.operationId);
  }
  if (full.expectedRevision !== undefined && !('If-Match' in sent)) {
    sent['If-Match'] = String(full.expectedRevision);
  }
  return h.call(ROUTE, 'POST', { as: who, body: full, env, headers: sent, url });
}

/** The receipt of a successful command, with the contract checked. */
async function succeed(h, who, body, options) {
  const response = await command(h, who, body, options);
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assertAccountReceipt(receipt, body.operationId);
  assert.equal(receipt.status, 'succeeded', receipt.message);
  return receipt;
}

// ---------------------------------------------------------------------------
// The contract: validAccountReceipt and validAccountSnapshot, transcribed
// ---------------------------------------------------------------------------

const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.length <= 4000;
const revision = (value) => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value) => text(value) && Number.isFinite(Date.parse(value));

/** The recovery branch of `validAccountSnapshot`. */
function assertRecoverySnapshot(body) {
  assert.ok(object(body), 'the snapshot is an object');
  assert.equal(body.feature, 'recovery');
  assert.ok(revision(body.revision), 'revision is a non-negative safe integer');
  assert.ok(Array.isArray(body.unresolvedOperations) && body.unresolvedOperations.every(text));
  assert.equal(typeof body.enabled, 'boolean');
  if (body.reason !== undefined) assert.ok(text(body.reason));
  const recovery = body.recovery;
  assert.ok(object(recovery), 'the recovery object is present');
  assert.ok(Array.isArray(recovery.devices), 'devices is a list');
  if (recovery.method !== null) {
    assert.ok(text(recovery.method.id) && text(recovery.method.maskedAddress));
    assert.ok(date(recovery.method.verifiedAt), 'verifiedAt parses as a date');
  }
  if (recovery.challenge !== null) {
    assert.ok(text(recovery.challenge.id) && text(recovery.challenge.maskedAddress));
    assert.ok(date(recovery.challenge.expiresAt), 'expiresAt parses as a date');
    assert.ok(
      ['pending', 'expired', 'verified'].includes(recovery.challenge.status),
      `the contract allows only pending, expired and verified here, got ${recovery.challenge.status}`,
    );
  }
}

/** `validAccountReceipt(value, id, 'recovery')`, plus this repo's no-em-dash rule. */
function assertAccountReceipt(body, id) {
  assert.ok(object(body), 'the receipt is an object');
  assert.equal(body.operationId, id, 'the receipt carries the id the client sent');
  assert.ok(
    ['succeeded', 'pending', 'unknown', 'failed'].includes(body.status),
    `status must be one the client knows, got ${body.status}`,
  );
  if (body.status === 'succeeded') assertRecoverySnapshot(body.snapshot);
  if (body.message !== undefined) {
    assert.ok(text(body.message), 'the message is text the client can show');
    assert.ok(!body.message.includes('—'), 'app-facing copy uses no em dash');
  }
}

// ---------------------------------------------------------------------------
// request-recovery: the happy path and the identity it must not disturb
// ---------------------------------------------------------------------------

test('request-recovery links the address, creates exactly one challenge and reports it masked', async () => {
  const h = harness();
  const id = op(1);
  const receipt = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: id,
  });

  const snapshot = receipt.snapshot;
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.revision, 1, 'one account operation in the ledger, so revision one');
  assert.equal(snapshot.recovery.method, null, 'an address nobody has confirmed is not a recovery method');
  assert.ok(snapshot.recovery.challenge, 'the snapshot shows the pending challenge');
  assert.equal(snapshot.recovery.challenge.status, 'pending');
  assert.equal(snapshot.recovery.challenge.maskedAddress, 'n***@example.test', 'masked, never the address');
  assert.ok(Date.parse(snapshot.recovery.challenge.expiresAt) > Date.now(), 'the challenge is still live');

  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1, 'exactly one challenge');
  assert.equal(rows[0].profile_id, h.identities.alice.id, 'owned by the caller');
  assert.equal(rows[0].id, snapshot.recovery.challenge.id);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].restore_token_hash ?? null, null, 'a link challenge can never mint a session');
  assert.ok(Date.parse(rows[0].expires_at) > Date.now());
  assert.equal(rows[0].email_hash, sha256(FRESH), 'the address is stored only as its digest');
  assert.match(rows[0].nonce_hash, /^[0-9a-f]{64}$/, '0018 accepts only 64 lowercase hex characters');
  assert.notEqual(rows[0].nonce_hash, rows[0].email_hash, 'the nonce is not derived from the address');
  assert.ok(!JSON.stringify(rows).includes(FRESH), 'no plaintext address reaches the database');
  assert.ok(!JSON.stringify(receipt).includes(FRESH), 'and none reaches the response');
});

test('the address is linked to the account but left unconfirmed, because nobody has proved it yet', async () => {
  const h = harness();
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.email, FRESH, 'the address is attached to the same identity');
  assert.equal(user.emailConfirmedAt ?? null, null, 'an unproved address must not count as verified');
});

test('linking preserves the identity: the user id, the profile row and every owned row are unchanged', async () => {
  const h = harness({ household: true });
  const before = Object.fromEntries(OWNED.map((table) => [table, h.db.rows(table)]));
  const id = h.identities.alice.id;

  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });

  assert.equal(h.db.identities.get(id).id, id, 'auth.users.id is the same identity, not a replacement');
  assert.equal(h.db.identities.size, 3, 'no second identity was created');
  for (const table of OWNED) {
    assert.deepEqual(h.db.rows(table), before[table], `${table} is untouched by linking`);
  }
  for (const table of OWNED) assert.ok(before[table].length > 0, `${table} was seeded, so the check is not vacuous`);
});

test('a mixed case address is normalized once, so the stored digest and the provider agree', async () => {
  const h = harness();
  const receipt = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: ' New@Example.Test ' },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(h.db.identities.get(h.identities.alice.id).email, FRESH);
  assert.equal(h.db.rows('recovery_challenges')[0].email_hash, sha256(FRESH));
  assert.equal(receipt.snapshot.recovery.challenge.maskedAddress, 'n***@example.test');
});

// ---------------------------------------------------------------------------
// The collision: an explicit failure, never a merge (BE-334)
// ---------------------------------------------------------------------------

test("an address that belongs to another identity fails, merges nothing and says nothing about whose it is", async () => {
  const h = harness();
  const id = op(1);
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: TAKEN },
    expectedRevision: 0,
    operationId: id,
  });
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'a collision is terminal, not a retry and not a merge');
  assert.ok(receipt.message && receipt.message.length > 0, 'the person is told something they can act on');

  const serialized = JSON.stringify(receipt);
  assert.ok(!serialized.includes(h.identities.carol.id), "nothing identifies the other household");
  assert.ok(!serialized.includes('carol'), 'not even a hint of who holds it');
  assert.ok(!serialized.includes(TAKEN), 'the address is not echoed back');

  assert.equal(h.db.rows('recovery_challenges').length, 0, 'no challenge is created for an address we cannot link');
  assert.equal(h.db.identities.get(h.identities.alice.id).email ?? null, null, 'alice gains nothing');
  const carol = h.db.identities.get(h.identities.carol.id);
  assert.equal(carol.email, TAKEN, 'carol keeps her address');
  assert.equal(carol.emailConfirmedAt, VERIFIED_AT, 'and her verification');
});

test('a collision is still recorded in the ledger, so a lost response can be reconciled', async () => {
  const h = harness();
  const id = op(1);
  await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: TAKEN },
    expectedRevision: 0,
    operationId: id,
  });
  const rows = h.db.rows('operations');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].result.status, 'failed', 'the receipt is replayable verbatim');
});

// ---------------------------------------------------------------------------
// The no-op: an address already verified for this identity
// ---------------------------------------------------------------------------

test('an address already verified for this account is a no-op that creates no second challenge', async () => {
  const h = harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: VERIFIED_AT },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
  });
  const receipt = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'nothing to prove, so nothing is created');
  assert.ok(receipt.snapshot.recovery.method, 'the method stays linked');
  assert.equal(receipt.snapshot.recovery.method.maskedAddress, 'n***@example.test');
  assert.equal(receipt.snapshot.recovery.challenge, null);
});

test('a different address is refused while one is verified, rather than silently replacing it', async () => {
  // Replacing it would take away the only way back into the household before
  // the new address had been proved. The interface offers Remove, then Add.
  const h = linked();
  const id = op(1);
  const receipt = await (await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: 'different@example.test' },
    expectedRevision: 0,
    operationId: id,
  })).json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'nothing is opened');
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.email, FRESH, 'the verified address is still the one on the account');
  assert.equal(user.emailConfirmedAt, VERIFIED_AT, 'and it is still verified');
});

// ---------------------------------------------------------------------------
// Re-send throttling
// ---------------------------------------------------------------------------

test('a second request a moment later is throttled, and does not send or store anything new', async () => {
  const h = harness();
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  const id = op(2);
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: id,
  });
  const receipt = await response.json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'a re-send inside the window is refused');
  assert.match(receipt.message, /wait/i, 'and says so in words a person can act on');
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'still exactly one challenge');
});

test('the throttle is read from the ledger, so a request outside the window is allowed again', async () => {
  const h = harness({
    operations: [
      {
        operation_id: op(9),
        kind: 'account.request-recovery',
        status: 'succeeded',
        result: { operationId: op(9), status: 'succeeded' },
        created_at: ago(10 * 60 * 1000),
      },
    ],
  });
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(1),
  });
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'an old attempt does not block a new one');
});

test('asking again for an address already linked but unconfirmed opens a new challenge', async () => {
  const h = harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: null },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
    challenges: [{ id: CHALLENGE, status: 'pending', expires_at: past() }],
  });
  const receipt = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(h.db.rows('recovery_challenges').length, 2, 'the expired one is not reused');
  assert.notEqual(receipt.snapshot.recovery.challenge.id, CHALLENGE, 'the newest challenge is the live one');
  assert.equal(receipt.snapshot.recovery.challenge.status, 'pending');
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.email, FRESH, 'the address it is already linked to does not change');
  assert.equal(user.emailConfirmedAt ?? null, null, 'and asking again does not confirm it');
});

// ---------------------------------------------------------------------------
// check-recovery
// ---------------------------------------------------------------------------

/** alice has linked FRESH and has a pending challenge for it; `confirmed` proves the address. */
function pendingLink({ confirmed = false, emailHash } = {}) {
  return harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: confirmed ? VERIFIED_AT : null },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
    challenges: [{ id: CHALLENGE, status: 'pending', ...(emailHash ? { email_hash: emailHash } : {}) }],
  });
}

test('check-recovery on a confirmed address sets the recovery method and closes the challenge', async () => {
  const h = pendingLink({ confirmed: true });
  const receipt = await succeed(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  });
  const recovery = receipt.snapshot.recovery;
  assert.ok(recovery.method, 'the provider has confirmed the address, so it is a method now');
  assert.equal(recovery.method.maskedAddress, 'n***@example.test');
  assert.equal(recovery.method.verifiedAt, VERIFIED_AT);
  assert.equal(recovery.challenge, null, 'the challenge has nothing left to ask');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'and is not left behind to be replayed');
  assert.ok(!JSON.stringify(receipt).includes(FRESH), 'the address is never returned in full');
});

test('check-recovery on an unconfirmed address changes nothing and keeps the challenge open', async () => {
  const h = pendingLink();
  const receipt = await succeed(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(receipt.snapshot.recovery.method, null, 'nobody has proved the address yet');
  assert.equal(receipt.snapshot.recovery.challenge.id, CHALLENGE);
  assert.equal(receipt.snapshot.recovery.challenge.status, 'pending');
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'the challenge is still there to be checked again');
});

test('a confirmed address that is not the challenge address does not verify that challenge', async () => {
  // Without this the check would be "is anything confirmed", which would let an
  // older verified address close a challenge raised for a different one.
  const h = pendingLink({ confirmed: true, emailHash: sha256('someone.else@example.test') });
  const receipt = await succeed(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'the challenge is untouched');
  assert.equal(receipt.snapshot.recovery.challenge.id, CHALLENGE, 'and still open');
});

// ---------------------------------------------------------------------------
// cancel-recovery
// ---------------------------------------------------------------------------

test('cancel-recovery leaves no open challenge and no linked method', async () => {
  const h = pendingLink();
  const receipt = await succeed(h, 'alice', {
    action: 'cancel-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(receipt.snapshot.recovery.challenge, null);
  assert.equal(receipt.snapshot.recovery.method, null);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

// ---------------------------------------------------------------------------
// remove-recovery
// ---------------------------------------------------------------------------

/** alice has a verified recovery address. */
function linked() {
  return harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: VERIFIED_AT },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
  });
}

test('remove-recovery unlinks the method, and the revision advances rather than going backwards', async () => {
  const h = linked();
  const receipt = await succeed(h, 'alice', {
    action: 'remove-recovery',
    payload: { id: 'email', revision: 0 },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(receipt.snapshot.recovery.method, null, 'the method is gone');
  assert.equal(receipt.snapshot.revision, 1, 'unlinking advances the revision, as If-Match needs');
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.emailConfirmedAt ?? null, null, 'the address is no longer a confirmed credential');
  assert.equal(user.id, h.identities.alice.id, 'and it is still the same identity');
});

test('removing when nothing is linked, or naming a method that is not the linked one, fails identically', async () => {
  const h = harness();
  const first = op(1);
  const missing = await (await command(h, 'alice', {
    action: 'remove-recovery',
    payload: { id: 'email', revision: 0 },
    expectedRevision: 0,
    operationId: first,
  })).json();
  assertAccountReceipt(missing, first);
  assert.equal(missing.status, 'failed');

  const linkedHarness = linked();
  const second = op(2);
  const wrongId = await (await command(linkedHarness, 'alice', {
    action: 'remove-recovery',
    payload: { id: 'sms', revision: 0 },
    expectedRevision: 0,
    operationId: second,
  })).json();
  assertAccountReceipt(wrongId, second);
  assert.equal(wrongId.status, 'failed');
  assert.equal(wrongId.message, missing.message, 'guessing a method id teaches nothing');
  assert.ok(linkedHarness.db.identities.get(linkedHarness.identities.alice.id).emailConfirmedAt, 'nothing removed');
});

// ---------------------------------------------------------------------------
// Idempotency: the ledger from task 2 is the only mechanism
// ---------------------------------------------------------------------------

test('the same operation id returns the first outcome and does not act twice', async () => {
  const h = harness();
  const body = {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  };
  const first = await (await command(h, 'alice', body)).json();
  const second = await (await command(h, 'alice', body)).json();
  assert.deepEqual(second, first, 'the stored receipt is replayed verbatim');
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'the effect ran once');
  assert.equal(h.db.rows('operations').length, 1, 'and is recorded once');
});

test('a replay is answered even though the revision has moved on since the first call', async () => {
  // The precondition belongs to the first attempt. Re-checking it on a replay
  // would turn a lost response into a conflict the client cannot resolve.
  const h = harness();
  const body = {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  };
  const first = await (await command(h, 'alice', body)).json();
  assert.equal(first.snapshot.revision, 1, 'the revision advanced past the expectedRevision sent');
  const again = await command(h, 'alice', body);
  assert.equal(again.status, 200, 'and the replay is still answered, not refused as stale');
});

test('reusing an operation id with different input is a conflict, not a replay', async () => {
  const h = harness();
  await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: 'other@example.test' },
    expectedRevision: 0,
    operationId: op(1),
  });
  await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
});

test('an operation still running is reported as pending, so the client parks it rather than acting', async () => {
  const h = harness({
    operations: [{ operation_id: op(1), kind: 'account.request-recovery', status: 'pending', created_at: ago(1000) }],
  });
  const receipt = await (await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(1),
  })).json();
  assertAccountReceipt(receipt, op(1));
  assert.equal(receipt.status, 'pending');
  assert.equal(receipt.snapshot, undefined, 'there is no outcome to report yet');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'and nothing is done a second time');
});

test('an attempt that was recorded and never settled is unknown, which is not a failure', async () => {
  const h = harness({
    operations: [
      { operation_id: op(1), kind: 'account.request-recovery', status: 'pending', created_at: ago(10 * 60 * 1000) },
    ],
  });
  const receipt = await (await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(1),
  })).json();
  assert.equal(receipt.status, 'unknown');
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

// ---------------------------------------------------------------------------
// The If-Match precondition
// ---------------------------------------------------------------------------

test('an expectedRevision that does not match is a conflict, and the effect does not happen', async () => {
  const h = harness();
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 7,
    operationId: op(1),
  });
  const body = await expectEnvelope(response, {
    status: 409,
    code: 'conflict',
    retryable: false,
    extraKeys: ['reason', 'revision'],
  });
  assert.equal(body.reason, 'stale_revision');
  assert.equal(body.revision, 0, 'the current revision comes back, so the client can reload');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'no challenge');
  assert.equal(h.db.identities.get(h.identities.alice.id).email ?? null, null, 'and no address linked');
  // The attempt itself is recorded, because the ledger is written before the
  // effect is tried: a refused precondition is a settled failure, not a gap.
  const ledger = h.db.rows('operations');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].status, 'failed');
});

test('every successful command advances the revision by exactly one', async () => {
  const h = pendingLink();
  const cancel = await succeed(h, 'alice', {
    action: 'cancel-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(cancel.snapshot.revision, 1);
  const request = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: 'another@example.test' },
    expectedRevision: 1,
    operationId: op(2),
  });
  assert.equal(request.snapshot.revision, 2, 'so the receipt can be used as the next precondition');
});

test('If-Match and the body must agree, because a person only ever saw one of them', async () => {
  const h = harness();
  const response = await command(
    h,
    'alice',
    { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: op(1) },
    { headers: { 'If-Match': '4' } },
  );
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'expectedRevision');
  assert.equal(h.db.rows('operations').length, 0);
});

test('the Idempotency-Key header must be the operation id the body carries', async () => {
  const h = harness();
  const response = await command(
    h,
    'alice',
    { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: op(1) },
    { headers: { 'Idempotency-Key': op(2) } },
  );
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'operationId');
});

// ---------------------------------------------------------------------------
// Identity, and other households
// ---------------------------------------------------------------------------

test("another household's challenge id is not found, and looks exactly like one that never existed", async () => {
  const h = harness({ challenges: [{ id: OTHER_CHALLENGE, owner: 'bob', status: 'pending' }] });
  const foreign = await (await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: OTHER_CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  })).json();
  const missing = await (await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 1,
    operationId: op(2),
  })).json();

  assert.equal(foreign.status, 'failed');
  assert.deepEqual({ ...foreign, operationId: null }, { ...missing, operationId: null }, 'the same answer either way');
  assert.ok(!JSON.stringify(foreign).includes(h.identities.bob.id), 'nothing says whose it is');
  assert.equal(h.db.rows('recovery_challenges').length, 1, "bob's challenge is untouched");
  assert.equal(h.db.rows('recovery_challenges')[0].id, OTHER_CHALLENGE);
});

test("another household's challenge cannot be cancelled either", async () => {
  const h = harness({ challenges: [{ id: OTHER_CHALLENGE, owner: 'bob', status: 'pending' }] });
  const receipt = await (await command(h, 'alice', {
    action: 'cancel-recovery',
    payload: { challengeId: OTHER_CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  })).json();
  assert.equal(receipt.status, 'failed');
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'it is still bob\'s challenge');
});

test('identity comes from the token: a profile_id in the body is refused, and in the query ignored', async () => {
  const h = harness();
  const named = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
    profile_id: h.identities.bob.id,
  });
  const body = await expectEnvelope(named, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'profile_id');
  assert.equal(body.field_errors[0].code, 'unknown_field');

  const receipt = await succeed(
    h,
    'alice',
    { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: op(2) },
    { url: `${ROUTE}?profile_id=${h.identities.bob.id}` },
  );
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].profile_id, h.identities.alice.id, 'the caller owns it, whoever the query named');
  assert.equal(receipt.snapshot.revision, 1);
  assert.equal(h.db.identities.get(h.identities.bob.id).email ?? null, null, 'bob is untouched');
});

test('a payload that names another household is refused rather than quietly ignored', async () => {
  const h = harness();
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH, profileId: h.identities.bob.id },
    expectedRevision: 0,
    operationId: op(1),
  });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'payload.profileId');
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('an unauthenticated command is refused', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'POST', {
    body: { feature: 'recovery', action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: op(1) },
    env: ON,
  });
  assert.equal(response.status, 401);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

// ---------------------------------------------------------------------------
// Input: the server is the authority, never the client
// ---------------------------------------------------------------------------

test('only the four recovery actions are accepted, and revoke-device is not one of them yet', async () => {
  const h = harness();
  for (const action of ['revoke-device', 'resolve-home', 'nonsense', '', null]) {
    const response = await command(h, 'alice', {
      action,
      payload: {},
      expectedRevision: 0,
      operationId: op(1),
    });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'action', `${action} is not a recovery action`);
  }
  assert.equal(h.db.rows('operations').length, 0, 'an action we do not have claims no operation id');
});

test('the feature must be one the contract names, and one this package has built', async () => {
  const h = harness();
  const bad = await command(h, 'alice', {
    feature: 'nonsense',
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  const body = await expectEnvelope(bad, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'feature');

  for (const feature of ['home', 'device', 'email', 'calendar']) {
    const response = await command(h, 'alice', {
      feature,
      action: 'request-recovery',
      payload: { email: FRESH },
      expectedRevision: 0,
      operationId: op(1),
    });
    await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  }
});

test('the email rule is enforced here, not in the browser', async () => {
  const h = harness();
  const bad = ['', 'not-an-address', 'two words@example.test', 'no-domain@example', `${'a'.repeat(250)}@example.test`, 42, null];
  for (const email of bad) {
    const response = await command(h, 'alice', {
      action: 'request-recovery',
      payload: { email },
      expectedRevision: 0,
      operationId: op(1),
    });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'payload.email', `${email} is not an address`);
  }
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  assert.equal(h.db.identities.get(h.identities.alice.id).email ?? null, null);
});

test('a challenge id must be a uuid, and an operation id must be one too', async () => {
  const h = harness();
  const challenge = await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: 'not-a-uuid' },
    expectedRevision: 0,
    operationId: op(1),
  });
  const first = await expectEnvelope(challenge, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(first.field_errors[0].field, 'payload.challengeId');

  const operation = await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: 'nope',
  });
  const second = await expectEnvelope(operation, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(second.field_errors[0].field, 'operationId');
});

test('expectedRevision is required: a command with no precondition is not accepted', async () => {
  const h = harness();
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    operationId: op(1),
  });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'expectedRevision');
});

test('a payload must be an object, and a missing one is not a silent empty object', async () => {
  const h = harness();
  for (const payload of ['email', 42, [], null]) {
    const response = await command(h, 'alice', {
      action: 'request-recovery',
      payload,
      expectedRevision: 0,
      operationId: op(1),
    });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.ok(body.field_errors[0].field.startsWith('payload'), `${JSON.stringify(payload)} is not a payload`);
  }
});

// ---------------------------------------------------------------------------
// The capability flag (BE-351) and the migrations
// ---------------------------------------------------------------------------

test('with the capability off the command is refused here, and nothing is read or written', async () => {
  const h = harness();
  const id = op(1);
  const response = await command(
    h,
    'alice',
    { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: id },
    { env: {} },
  );
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'a deployed interface cannot talk its way past the flag');
  assert.ok(receipt.message.length > 0, 'and the refusal explains itself');
  assert.equal(receipt.snapshot, undefined, 'nothing about the account is disclosed');
  assert.deepEqual(h.db.queryLog, [], 'no table is read at all');
  assert.equal(h.db.identities.get(h.identities.alice.id).email ?? null, null);
});

test('before migration 0018 the command is unavailable rather than a false success', async () => {
  const h = harness({ tables: haloTables('profiles', 'operations') });
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(h.db.identities.get(h.identities.alice.id).email ?? null, null, 'and the address is not linked');
  assert.equal(h.db.rows('operations').length, 0, 'nothing is recorded as attempted');
});

test('before migration 0017 there is no ledger to be idempotent against, so the command is unavailable', async () => {
  const h = harness({ tables: haloTables('profiles', 'recovery_challenges') });
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('every action is unavailable before 0018, not only the one that writes a challenge', async () => {
  const h = harness({ tables: haloTables('profiles', 'operations') });
  for (const [index, action] of ['check-recovery', 'cancel-recovery', 'remove-recovery'].entries()) {
    const payload = action === 'remove-recovery' ? { id: 'email', revision: 0 } : { challengeId: CHALLENGE };
    const response = await command(h, 'alice', {
      action,
      payload,
      expectedRevision: 0,
      operationId: op(index + 1),
    });
    await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  }
});

// ---------------------------------------------------------------------------
// Failures that are ours
// ---------------------------------------------------------------------------

test('a session that cannot be verified is a 503, and no command runs on a guess', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  h.forceAuthOutage('thrown');
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(response.status, 503, 'we cannot prove who they are, so nothing is attempted');
  assert.ok(logged.mock.callCount() > 0, 'the reason goes to the log, not to the person');
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('an expired challenge is reported as expired, and checking it is still answered', async () => {
  const h = harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: null },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
    challenges: [{ id: CHALLENGE, status: 'pending', expires_at: past() }],
  });
  const receipt = await succeed(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(receipt.snapshot.recovery.challenge.status, 'expired', 'the clock decides, not the stored word');
});
