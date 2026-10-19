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
 *    The link itself is the caller's own email change and not the service
 *    role's (Ruling 10), which the request it sends is what proves: the fake
 *    models the provider's two steps, staging an address nobody has proved yet
 *    and promoting it once they have, so a collision can be tested at either
 *    point.
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
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';

const ROUTE = '/api/account/commands';

/** A sample of the household's own tables, so "nothing else changed" is not vacuous. */
const OWNED = ['profiles', 'daily_scores', 'household_bands', 'symptom_logs', 'alerts', 'home_contexts'];
const TABLES = haloTables('operations', 'recovery_challenges', ...OWNED);

/**
 * The flag that turns the capability on (off unless a test sets it), and the
 * provider the link call is sent to. Both Supabase variables are scrubbed by the
 * sandbox, so a test that wants the link to work has to say so.
 */
const PROVIDER_URL = 'https://provider.example.invalid';
const ANON_KEY = 'test-anon-key';
const ON = {
  HALO_FEATURE_RECOVERY: 'on',
  NEXT_PUBLIC_SUPABASE_URL: PROVIDER_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
};

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
 * The provider's `PUT /auth/v1/user`, which is the request
 * `auth.updateUser({ email })` sends. It is modelled through the injected fetch
 * rather than on the fake client on purpose: this is the one call the route
 * makes as the CALLER rather than as the service role, and the request itself
 * (whose bearer token it carries, and that the key is the anon key) is what
 * proves it. A call made with the service role would carry no caller token and
 * is refused here, the way the provider would refuse it.
 *
 * The staged state lives in the fake's identity table, so the provider's two
 * steps, staging and promotion, are modelled in one place (see
 * `stageEmailChange` and `confirmEmailChange` in helpers/fakeSupabase.mjs).
 */
function providerFetch(get, calls) {
  const answer = (body, status) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  return async (target, options = {}) => {
    const headers = new Headers(options.headers ?? {});
    const bearer = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(target), method: options.method, bearer, apikey: headers.get('apikey'), body });

    if (String(target) !== `${PROVIDER_URL}/auth/v1/user` || options.method !== 'PUT') {
      return answer({ code: 404, error_code: 'not_found', msg: 'no such endpoint' }, 404);
    }
    const h = get();
    const name = bearer.startsWith('test-token:') ? bearer.slice('test-token:'.length) : null;
    const identity = name ? h.identities[name] : null;
    if (!identity) return answer({ code: 401, error_code: 'bad_jwt', msg: 'invalid claim: missing sub' }, 401);

    const staged = h.db.stageEmailChange(identity.id, body.email);
    if (staged.error) {
      return answer({ code: 422, error_code: staged.error, msg: 'A user with this email address has already been registered' }, 422);
    }
    return answer(staged.user, 200);
  };
}

/**
 * alice is a signed-in anonymous household, bob is another one, and carol holds
 * TAKEN. `identities` replaces all three; `challenges` and `operations` default
 * to empty so each test seeds only what it is about, with `owner` naming the
 * household (alice unless given).
 */
function harness({ challenges = [], operations = [], household = false, identities, tables = TABLES } = {}) {
  const calls = [];
  let h;
  h = createRouteHarness({
    fetch: providerFetch(() => h, calls),
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
  // Every request the route sent to the provider, in order.
  h.provider = calls;
  return h;
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
function command(h, who, body, { env = ON, headers = {}, url, fetch } = {}) {
  const full = { feature: 'recovery', ...body };
  const sent = { ...headers };
  if (full.operationId !== undefined && !('Idempotency-Key' in sent)) {
    sent['Idempotency-Key'] = String(full.operationId);
  }
  if (full.expectedRevision !== undefined && !('If-Match' in sent)) {
    sent['If-Match'] = String(full.expectedRevision);
  }
  return h.call(ROUTE, 'POST', { as: who, body: full, env, headers: sent, url, fetch });
}

/**
 * Ages this household's recorded request so the next one is outside the resend
 * window. The window is read from the ledger, so this is the honest way to move
 * past it without sleeping.
 */
async function pastTheWindow(h, operationId) {
  const { error } = await h.db
    .from('operations')
    .update({ created_at: ago(5 * 60 * 1000) })
    .eq('operation_id', operationId);
  assert.equal(error, null);
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

  // The link is one request, made as the caller and not as the service role.
  assert.equal(h.provider.length, 1, 'exactly one provider call');
  assert.deepEqual(
    [h.provider[0].method, h.provider[0].url, h.provider[0].bearer, h.provider[0].apikey, h.provider[0].body],
    ['PUT', `${PROVIDER_URL}/auth/v1/user`, 'test-token:alice', ANON_KEY, { email: FRESH }],
    "the caller's own token and the anon key, never the service role",
  );

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

test('the address is staged as a pending change, so the unique slot is not taken before proof', async () => {
  // Ruling 10. The admin path wrote `auth.users.email` straight away, which let
  // any signed-in identity occupy any unregistered address and deny it to its
  // real owner. The caller's own email change stages it instead.
  const h = harness();
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.newEmail, FRESH, 'the address is pending on the same identity');
  assert.equal(user.email ?? null, null, 'and the unique address column is still empty');
  assert.equal(user.emailConfirmedAt ?? null, null, 'an unproved address must not count as verified');
  assert.ok(user.emailChangeSentAt, 'the provider recorded that it sent the confirmation');
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
  assert.equal(h.provider.length, 1, 'one email change on the identity we already had');
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
  assert.equal(h.provider[0].body.email, FRESH, 'the provider is sent the normalized address');
  assert.equal(h.db.identities.get(h.identities.alice.id).newEmail, FRESH);
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
  const alice = h.db.identities.get(h.identities.alice.id);
  assert.equal(alice.email ?? null, null, 'alice gains nothing');
  assert.equal(alice.newEmail ?? null, null, 'not even a pending change');
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
  assert.equal(h.provider.length, 0, 'and the provider is not asked to send anything');
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
  assert.equal(h.provider.length, 0, 'and no confirmation is sent anywhere');
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
  assert.equal(h.provider.length, 1, 'and the provider was asked to send only the first one');
});

test('a refused request does not consume the send window, because nothing was sent', async () => {
  // The collision path. Nothing was requested of the provider and no message
  // went anywhere, so telling the person to wait a minute before correcting
  // their typo would be false.
  const h = harness();
  const collided = await (await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: TAKEN },
    expectedRevision: 0,
    operationId: op(1),
  })).json();
  assert.equal(collided.status, 'failed');

  const corrected = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(2),
  });
  assert.ok(corrected.snapshot.recovery.challenge, 'the corrected address is accepted straight away');
  assert.equal(h.db.rows('recovery_challenges').length, 1);
});

test('a conflict does not consume the send window either, so the re-read and retry works', async () => {
  // What the contract tells the client to do after a 409: re-read, then retry
  // with a fresh revision and a new operation id. A first ever attempt must not
  // come back refused as a re-send.
  const h = harness();
  const stale = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 7,
    operationId: op(1),
  });
  assert.equal(stale.status, 409);
  const retried = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(2),
  });
  assert.ok(retried.snapshot.recovery.challenge, 'the retry is a first request, not a re-send');
  assert.equal(h.provider.length, 1);
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

test('a new request supersedes the household\'s earlier challenge, so a settled link leaves no phantom', async () => {
  // The typo scenario. A challenge nobody can settle any more must not outlive
  // the request that replaced it: the provider holds one pending address, so
  // there is one verification to report, and the newest row is only the right
  // answer if the older ones are gone.
  const h = harness();
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: 'typo@example.test' },
    expectedRevision: 0,
    operationId: op(1),
  });
  const first = h.db.rows('recovery_challenges')[0];
  await pastTheWindow(h, op(1));

  const corrected = await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(2),
  });
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1, 'the superseded challenge is closed, not kept');
  assert.notEqual(rows[0].id, first.id);
  assert.equal(rows[0].email_hash, sha256(FRESH), 'and the one that is left is for the address asked for');
  assert.equal(corrected.snapshot.recovery.challenge.id, rows[0].id);

  // Confirming the corrected address closes its challenge, and because the
  // earlier one is gone the account is not left showing an open verification
  // for an address that is already verified, masked as the wrong address.
  assert.equal(h.db.confirmEmailChange(h.identities.alice.id).error, undefined);
  const settled = await succeed(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: rows[0].id },
    expectedRevision: 2,
    operationId: op(3),
  });
  assert.ok(settled.snapshot.recovery.method, 'the address is verified');
  assert.equal(settled.snapshot.recovery.challenge, null, 'and nothing is still being verified');
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('a plain resend of the same address does not accumulate challenges either', async () => {
  const h = harness();
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  await pastTheWindow(h, op(1));
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(2),
  });
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'one address in flight is one challenge');
  assert.equal(h.provider.length, 2, 'the confirmation was sent again');
});

test('asking again for an address whose change is still pending re-sends it and opens a new challenge', async () => {
  const h = harness({
    identities: {
      alice: { email: null, newEmail: FRESH, isAnonymous: true, emailChangeSentAt: ago(60 * 60 * 1000) },
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
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1, 'the expired one is closed rather than left behind');
  assert.notEqual(rows[0].id, CHALLENGE, 'and the live challenge is the new one');
  assert.equal(receipt.snapshot.recovery.challenge.id, rows[0].id);
  assert.equal(receipt.snapshot.recovery.challenge.status, 'pending');
  assert.equal(h.provider.length, 1, 'the confirmation is sent again, which is what the throttle guards');
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.newEmail, FRESH, 'the pending address does not change');
  assert.equal(user.email ?? null, null, 'and asking again still does not occupy the address');
  assert.equal(user.emailConfirmedAt ?? null, null, 'nor confirm it');
});

test('an address already on the identity is refused, not turned into a challenge nothing can settle', async () => {
  // The provider only stages a change when the address differs from the one the
  // identity already carries, so asking for that same address sends nothing. The
  // state is reachable straight after remove-recovery, which leaves the address
  // in place with its confirmation cleared.
  const h = harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: null },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
  });
  const id = op(1);
  const receipt = await (await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: id,
  })).json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'a request that cannot send anything is not a success');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'and opens no challenge to wait on');
  assert.ok(!JSON.stringify(receipt).includes(FRESH), 'the address is not echoed back');
});

// ---------------------------------------------------------------------------
// check-recovery
// ---------------------------------------------------------------------------

/**
 * alice has asked for FRESH and has a pending challenge for it. `confirmed` is
 * the state after the person opened the provider's link: the pending change has
 * been promoted to the address itself. Unconfirmed is the staged state, where
 * the address is only `new_email`.
 */
function pendingLink({ confirmed = false, emailHash, operations } = {}) {
  return harness({
    operations,
    identities: {
      alice: confirmed
        ? { email: FRESH, emailConfirmedAt: VERIFIED_AT }
        : { email: null, newEmail: FRESH, isAnonymous: true, emailChangeSentAt: ago(1000) },
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

test('check-recovery while the change is still pending changes nothing and keeps the challenge open', async () => {
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
  // Without the digest comparison the check would be "is anything confirmed",
  // which would let an address verified for something else close a challenge
  // raised for a different one and report it as proved.
  const h = pendingLink({ confirmed: true, emailHash: sha256('someone.else@example.test') });
  const id = op(1);
  const receipt = await (await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: id,
  })).json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'the other address proves nothing about this challenge');
  assert.notEqual(receipt.message, undefined);
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'and a challenge nothing can settle is closed');
  // The address that IS verified stays verified: closing the challenge says
  // nothing about it either way.
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.email, FRESH);
  assert.equal(user.emailConfirmedAt, VERIFIED_AT);
});

test('a pending change the provider could not complete is a terminal failure, and discloses nothing', async () => {
  // The second place a collision can arrive. The address is free when the
  // change is staged and taken by the time the person opens the link, so the
  // provider refuses the promotion and drops the pending change. All we can see
  // afterwards is that nothing is pending and nothing is confirmed, so the
  // receipt says the address could not be added and says nothing about why or
  // about whose it is.
  const h = pendingLink();
  const bob = h.identities.bob.id;
  h.db.identities.set(bob, { ...h.db.identities.get(bob), email: FRESH, emailConfirmedAt: VERIFIED_AT });
  const promotion = h.db.confirmEmailChange(h.identities.alice.id);
  assert.equal(promotion.error, 'email_exists', 'the provider cannot promote an address someone else now holds');

  const id = op(1);
  const receipt = await (await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: id,
  })).json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'terminal: there is nothing left to wait for');
  const serialized = JSON.stringify(receipt);
  assert.ok(!serialized.includes(bob), 'nothing identifies the household that holds it');
  assert.ok(!serialized.includes(FRESH), 'and the address is not echoed back');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'the challenge is closed, not left pending forever');

  const alice = h.db.identities.get(h.identities.alice.id);
  assert.equal(alice.email ?? null, null, 'alice gained nothing');
  assert.equal(alice.id, h.identities.alice.id, 'and is still the same identity');
  const taker = h.db.identities.get(bob);
  assert.equal(taker.email, FRESH, 'the other household keeps its address');
  assert.equal(taker.emailConfirmedAt, VERIFIED_AT, 'nothing was merged into it');
});

test('an address the provider wrote straight to the identity is still only pending until confirmed', async () => {
  // The provider may not stage the change for an anonymous identity: it may set
  // the address directly and leave it unconfirmed, which is what the admin path
  // used to do. That must read as "waiting", not as a failure, so this path is
  // no worse than before Ruling 10.
  const h = harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: null },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
    challenges: [{ id: CHALLENGE, status: 'pending' }],
  });
  const receipt = await succeed(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: op(1),
  });
  assert.equal(receipt.snapshot.recovery.method, null, 'unconfirmed is not a method');
  assert.equal(receipt.snapshot.recovery.challenge.id, CHALLENGE, 'and the challenge is still open');
  assert.equal(h.db.rows('recovery_challenges').length, 1);
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
  // The copy has to admit the one thing the server cannot do: a confirmation
  // message that is already out cannot be recalled, and opening its link still
  // adds the address.
  assert.match(receipt.message, /cannot recall/i, 'cancelling does not promise a final state');
  assert.match(receipt.message, /will still be added/i);
  assert.equal(receipt.snapshot.recovery.challenge, null);
  assert.equal(receipt.snapshot.recovery.method, null);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  // The point of Ruling 10: there was never a confirmed address to disturb, and
  // the address the person changed their mind about was never occupied either.
  assert.equal(h.db.identities.get(h.identities.alice.id).email ?? null, null);
});

test('cancelling leaves a confirmed address alone', async () => {
  const h = linked();
  const id = op(1);
  const receipt = await (await command(h, 'alice', {
    action: 'cancel-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: id,
  })).json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'there is no challenge to cancel');
  assert.equal(receipt.snapshot, undefined);
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.email, FRESH, 'and the verified address is untouched');
  assert.equal(user.emailConfirmedAt, VERIFIED_AT);
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
  // Honesty: the address is not erased from the account, so the copy says so
  // rather than implying it was.
  assert.match(receipt.message, /stays on your account/i);
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
  assert.equal(h.provider.at(-1).bearer, 'test-token:alice', "the link carries the caller's own token");
  assert.equal(h.db.identities.get(h.identities.bob.id).newEmail ?? null, null, 'bob is untouched');
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

test('only the five recovery actions are accepted', async () => {
  const h = harness();
  for (const action of ['resolve-home', 'nonsense', '', null]) {
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

// ---------------------------------------------------------------------------
// revoke-device: recognised, refused (Ruling 27). Neither half of the real
// feature is buildable against the installed client (see
// test/recoveryCapability.test.mjs), so the action is answered with a
// terminal failed receipt rather than the generic "unknown action" a
// mistyped action name gets above. The two must not look the same: one is a
// client bug, the other is an honest gap.
// ---------------------------------------------------------------------------

test('revoke-device is a recognised action, refused with a terminal receipt rather than treated as unknown', async () => {
  const h = harness();
  const id = op(1);
  const response = await command(h, 'alice', {
    action: 'revoke-device',
    payload: { id: 'some-device-id', revision: 0 },
    expectedRevision: 0,
    operationId: id,
  });
  assert.equal(response.status, 200, 'recognised, not a 400 validation error');
  const receipt = await response.json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed');
  // Ruling 29: pinned exactly, not just /not available/i, because that looser
  // match would also have passed the earlier wording this replaced ("is not
  // available YET"). Ruling 27 leaves open that Vibhav declines both named
  // alternatives, which would make this permanent, so the message must not
  // imply a timeline nobody has committed to.
  assert.equal(receipt.message, 'Revoking a specific device is not available. Nothing was changed.');
  assert.doesNotMatch(receipt.message, /\byet\b/i, 'no implied timeline');
  assert.equal(receipt.snapshot, undefined, 'a refusal carries no snapshot');

  const rows = h.db.rows('operations');
  assert.equal(rows.length, 1, 'the attempt is still recorded in the ledger');
  assert.equal(rows[0].kind, 'account.revoke-device');
  assert.equal(rows[0].status, 'failed');
});

test('revoke-device changes nothing: the household record is untouched by the refusal', async () => {
  const h = linked();
  const before = { ...h.db.identities.get(h.identities.alice.id) };
  const response = await command(h, 'alice', {
    action: 'revoke-device',
    payload: { id: 'some-device-id', revision: 0 },
    expectedRevision: 0,
    operationId: op(1),
  });
  const receipt = await response.json();
  assert.equal(receipt.status, 'failed');
  const after = h.db.identities.get(h.identities.alice.id);
  assert.deepEqual(after, before, 'the refusal reads and writes nothing about the identity');
});

test('revoke-device still enforces the payload shape: unknown keys and a missing id or revision are refused', async () => {
  const h = harness();
  const extra = await command(h, 'alice', {
    action: 'revoke-device',
    payload: { id: 'some-device-id', revision: 0, label: 'my phone' },
    expectedRevision: 0,
    operationId: op(1),
  });
  const extraBody = await expectEnvelope(extra, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(extraBody.field_errors[0].field, 'payload.label');

  const missingId = await command(h, 'alice', {
    action: 'revoke-device',
    payload: { revision: 0 },
    expectedRevision: 0,
    operationId: op(2),
  });
  const missingIdBody = await expectEnvelope(missingId, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(missingIdBody.field_errors[0].field, 'payload.id');

  const missingRevision = await command(h, 'alice', {
    action: 'revoke-device',
    payload: { id: 'some-device-id' },
    expectedRevision: 0,
    operationId: op(3),
  });
  const missingRevisionBody = await expectEnvelope(missingRevision, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(missingRevisionBody.field_errors[0].field, 'payload.revision');

  assert.equal(h.db.rows('operations').length, 0, 'a payload that fails shape validation claims no operation id');
});

test('revoke-device is refused the same way whatever id or revision is sent, since there is no registry to check it against', async () => {
  const h = harness();
  const first = await (await command(h, 'alice', {
    action: 'revoke-device',
    payload: { id: 'device-one', revision: 0 },
    expectedRevision: 0,
    operationId: op(1),
  })).json();
  const second = await (await command(h, 'alice', {
    action: 'revoke-device',
    payload: { id: 'a-completely-different-id', revision: 0 },
    expectedRevision: 1,
    operationId: op(2),
  })).json();
  assert.equal(first.status, 'failed');
  assert.equal(second.status, 'failed');
  assert.equal(second.message, first.message, 'no id teaches the caller anything, because none is checked');
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
  assert.equal(h.provider.length, 0, 'and the provider is never contacted');
  assert.equal(h.db.identities.get(h.identities.alice.id).email ?? null, null);
});

// ---------------------------------------------------------------------------
// The two intents share one table (B02 Task 5, Ruling 15)
// ---------------------------------------------------------------------------
//
// POST /api/recovery/request writes rows to recovery_challenges keyed by the
// same profile_id as this route's link rows, and before migration 0019 nothing
// told them apart: a fresh row of either intent carries a nonce hash, a null
// restore_token_hash and a null consumed_at. This route supersedes whatever the
// household had open before it inserts, so an unnarrowed delete would cancel an
// in-flight recovery. Every statement here names `intent = 'link'`.

test('linking writes a link row, so the intent is recorded rather than assumed', async () => {
  const h = harness();
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].intent, 'link', 'the row says which operation wrote it');
});

test('a recovery challenge survives the owner linking an address: the supersede delete is narrowed to the link intent', async () => {
  // Ruling 15. The signed-in owner asking to link an address must not cancel an
  // unauthenticated recovery attempt on the same identity, and the two rows are
  // indistinguishable without the intent.
  const h = harness({
    challenges: [
      { id: CHALLENGE, intent: 'recover', email_hash: sha256('recovering@example.test'), nonce_hash: hex('c3') },
      { id: OTHER_CHALLENGE, intent: 'link', email_hash: sha256('typo@example.test') },
    ],
  });
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });

  const rows = h.db.rows('recovery_challenges');
  const recovering = rows.filter((row) => row.intent === 'recover');
  assert.equal(recovering.length, 1, 'the recovery challenge is still there');
  assert.equal(recovering[0].id, CHALLENGE, 'and it is the same row, not a replacement');
  assert.equal(recovering[0].nonce_hash, hex('c3'), 'with the nonce only that browser knows');
  const linking = rows.filter((row) => row.intent === 'link');
  assert.equal(linking.length, 1, 'the earlier link challenge is superseded as before');
  assert.equal(linking[0].email_hash, sha256(FRESH));
  assert.notEqual(linking[0].id, OTHER_CHALLENGE);

  // Every statement this route ran on the table named the link intent: a read
  // or a delete filters on it, an insert writes it. Nothing it does can reach,
  // count or remove a row of the other intent.
  const statements = h.db.queryLog.filter((item) => item.table === 'recovery_challenges');
  assert.ok(statements.length >= 3, 'the probe, the supersede and the insert all ran');
  for (const entry of statements) {
    const named = `${JSON.stringify(entry.filters ?? [])}${JSON.stringify(entry.rows ?? [])}`.includes('"intent"');
    assert.ok(named, `${entry.operation} on recovery_challenges did not name the intent`);
  }
});

test('a recovery challenge is invisible to this route: its id is the identical failure to one that never existed', async () => {
  const h = harness({
    challenges: [{ id: CHALLENGE, intent: 'recover', nonce_hash: hex('c3') }],
  });
  const seen = [];
  // Every command advances the revision by one, whether it succeeds or not.
  let revision = 0;
  let id = 0;
  const ask = async (action, challengeId) => {
    id += 1;
    const response = await command(h, 'alice', {
      action,
      payload: { challengeId },
      expectedRevision: revision,
      operationId: op(id),
    });
    revision += 1;
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assertAccountReceipt(receipt, op(id));
    return receipt;
  };
  for (const action of ['check-recovery', 'cancel-recovery']) {
    const receipt = await ask(action, CHALLENGE);
    assert.equal(receipt.status, 'failed');
    seen.push(receipt.message);

    const absent = await ask(action, OTHER_CHALLENGE);
    assert.equal(receipt.message, absent.message, `${action}: a recovery challenge answers like a missing one`);
  }
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'and nothing of the recovery attempt is touched');
  assert.ok(seen.every((message) => !message.includes('recover')), 'the refusal says nothing about the other intent');
});

test('before migration 0019 the command is unavailable rather than acting on rows it cannot tell apart', async () => {
  const h = harness();
  const failed = withoutColumn(h.db, 'recovery_challenges', 'intent');
  const response = await command(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 0,
    operationId: op(1),
  });
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.ok(failed.length > 0, 'the missing column is what refused it');
  assert.equal(h.db.identities.get(h.identities.alice.id).newEmail ?? null, null, 'nothing was staged');
  assert.equal(h.provider.length, 0, 'the provider was never asked to send anything');
  assert.equal(h.db.rows('operations').length, 0, 'nothing is recorded as attempted');
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  failed.restore();
});

test('before migration 0019 every action is unavailable, with the Postgres code as well as the PostgREST one', async () => {
  for (const code of ['PGRST204', '42703']) {
    const h = harness({ challenges: [{ id: CHALLENGE }] });
    const failed = withoutColumn(h.db, 'recovery_challenges', 'intent', code);
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
    assert.ok(failed.length > 0, `${code} is recognised`);
    failed.restore();
  }
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
  assert.equal(h.db.identities.get(h.identities.alice.id).newEmail ?? null, null, 'and nothing was staged');
  assert.equal(h.provider.length, 0, 'the provider was never asked to send anything');
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

test('a provider that is not configured is our failure, and nothing is written or claimed', async (t) => {
  // The two Supabase variables are scrubbed by the sandbox, so this is the
  // shape of a deployment that forgot them. It must not look like a success.
  const logged = muteConsoleError(t);
  const h = harness();
  const response = await command(
    h,
    'alice',
    { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: op(1) },
    { env: { HALO_FEATURE_RECOVERY: 'on' } },
  );
  await expectEnvelope(response, { status: 500, code: 'internal_error', retryable: true });
  assert.ok(logged.mock.callCount() > 0, 'the reason goes to the log');
  assert.equal(h.provider.length, 0, 'with no provider address there is nothing to call');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'and no challenge is opened');
  const ledger = h.db.rows('operations');
  assert.equal(ledger.length, 1, 'the attempt is recorded');
  assert.equal(ledger[0].status, 'failed', 'as a failure, so reconciling it tells the truth');
});

test('a provider we cannot reach is our failure too, and still opens no challenge', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  const response = await command(
    h,
    'alice',
    { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: op(1) },
    { fetch: async () => { throw new Error('getaddrinfo ENOTFOUND provider.example.invalid'); } },
  );
  await expectEnvelope(response, { status: 500, code: 'internal_error', retryable: true });
  assert.ok(logged.mock.callCount() > 0);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  assert.equal(h.db.identities.get(h.identities.alice.id).newEmail ?? null, null);
});

test('a refusal we do not recognise is never read as a collision, and never as a success', async (t) => {
  // Calling an unknown refusal a collision would tell the person their address
  // belongs to someone else when it may not, and continuing would open a
  // challenge for an address the provider never accepted. So it is a 500, and
  // nothing from the provider reaches the person.
  const logged = muteConsoleError(t);
  const h = harness();
  const response = await command(
    h,
    'alice',
    { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 0, operationId: op(1) },
    {
      fetch: async () =>
        new Response(
          JSON.stringify({ code: 400, error_code: 'validation_failed', msg: 'Unable to validate email address' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    },
  );
  const body = await expectEnvelope(response, { status: 500, code: 'internal_error', retryable: true });
  assert.ok(!JSON.stringify(body).includes('Unable to validate'), "the provider's words are not shown to anyone");
  assert.ok(logged.mock.callCount() > 0);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('a challenge still in flight when it expires is ended, not left waiting forever', async () => {
  // The provider may leave a pending change in place after refusing to promote
  // it, so that the person can retry. Then the address stays pending for as
  // long as the other household holds it, and "not confirmed yet" would be a
  // wait with no end. The challenge's own expiry is the bound: past it there is
  // nothing this challenge can still settle, so it is ended and the person is
  // sent back to asking for a new one.
  const h = harness({
    identities: {
      alice: { email: null, newEmail: FRESH, isAnonymous: true, emailChangeSentAt: ago(60 * 60 * 1000) },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
    challenges: [{ id: CHALLENGE, status: 'pending', expires_at: past() }],
  });
  const id = op(1);
  const receipt = await (await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: id,
  })).json();
  assertAccountReceipt(receipt, id);
  assert.equal(receipt.status, 'failed', 'an expired request is finished, whatever the provider still holds');
  assert.match(receipt.message, /expired/i, 'and says so, so the person asks for a new one');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'the row is closed rather than left to be re-checked');
  const user = h.db.identities.get(h.identities.alice.id);
  assert.equal(user.email ?? null, null, 'nothing was linked by giving up on it');
});

test('an address written straight to the identity is also only waited on while the challenge is live', async () => {
  const h = harness({
    identities: {
      alice: { email: FRESH, emailConfirmedAt: null },
      bob: { email: null, isAnonymous: true },
      carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
    },
    challenges: [{ id: CHALLENGE, status: 'pending', expires_at: past() }],
  });
  const id = op(1);
  const receipt = await (await command(h, 'alice', {
    action: 'check-recovery',
    payload: { challengeId: CHALLENGE },
    expectedRevision: 0,
    operationId: id,
  })).json();
  assert.equal(receipt.status, 'failed');
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

// ---------------------------------------------------------------------------
// A receipt never lists its own operation as unresolved
// ---------------------------------------------------------------------------
//
// The receipt's snapshot is built inside the ledger's claimed operation, while
// that operation's own row is still 'pending'. The client copies the
// snapshot's unresolvedOperations into the ids it waits on and disables the
// account surface until each is reconciled (useAccountService.ts on
// origin/codex/october15-review-refinement), and reconciling replays this same
// stored receipt, so a receipt that listed itself would lock the surface with
// no way out but a reload. Another request's genuinely pending work must still
// be listed.

/** Another request's account work, recorded and still running. */
const ELSEWHERE = op(90);
const runningElsewhere = () => [
  { operation_id: ELSEWHERE, kind: 'account.check-recovery', status: 'pending', created_at: ago(1000) },
];

const VERIFIED_ALICE = {
  alice: { email: FRESH, emailConfirmedAt: VERIFIED_AT },
  bob: { email: null, isAnonymous: true },
  carol: { email: TAKEN, emailConfirmedAt: VERIFIED_AT },
};

/** Every action that answers with a snapshot, through each path that does. */
const SUCCEEDING = [
  {
    name: 'request-recovery',
    setup: (operations) => harness({ operations }),
    action: 'request-recovery',
    payload: () => ({ email: FRESH }),
  },
  {
    name: 'request-recovery for the address already verified',
    setup: (operations) => harness({ operations, identities: VERIFIED_ALICE }),
    action: 'request-recovery',
    payload: () => ({ email: FRESH }),
  },
  {
    name: 'check-recovery on a confirmed address',
    setup: (operations) => pendingLink({ confirmed: true, operations }),
    action: 'check-recovery',
    payload: () => ({ challengeId: CHALLENGE }),
  },
  {
    name: 'check-recovery while still in flight',
    setup: (operations) => pendingLink({ operations }),
    action: 'check-recovery',
    payload: () => ({ challengeId: CHALLENGE }),
  },
  {
    name: 'cancel-recovery',
    setup: (operations) => pendingLink({ operations }),
    action: 'cancel-recovery',
    payload: () => ({ challengeId: CHALLENGE }),
  },
  {
    name: 'remove-recovery',
    setup: (operations) => harness({ operations, identities: VERIFIED_ALICE }),
    action: 'remove-recovery',
    payload: (revision) => ({ id: 'email', revision }),
  },
];

for (const { name, setup, action, payload } of SUCCEEDING) {
  test(`${name}: the receipt does not list its own operation as unresolved`, async () => {
    const h = setup([]);
    const receipt = await succeed(h, 'alice', { action, payload: payload(0), expectedRevision: 0, operationId: op(1) });
    assert.ok(!receipt.snapshot.unresolvedOperations.includes(op(1)), 'the operation this receipt settles is not unresolved');
    assert.deepEqual(receipt.snapshot.unresolvedOperations, [], 'and nothing else is outstanding');
  });

  test(`${name}: another request's pending work is still listed in the receipt`, async () => {
    const h = setup(runningElsewhere());
    const receipt = await succeed(h, 'alice', { action, payload: payload(1), expectedRevision: 1, operationId: op(1) });
    assert.deepEqual(receipt.snapshot.unresolvedOperations, [ELSEWHERE], 'the other request is genuinely unresolved');
  });
}

test('the stored receipt, its replay and GET /api/operations all leave the settled operation out', async () => {
  const h = harness({ operations: runningElsewhere() });
  const body = { action: 'request-recovery', payload: { email: FRESH }, expectedRevision: 1, operationId: op(1) };
  await succeed(h, 'alice', body);

  const stored = h.db.rows('operations').find((row) => row.operation_id === op(1));
  assert.equal(stored.status, 'succeeded');
  assert.deepEqual(stored.result.snapshot.unresolvedOperations, [ELSEWHERE], 'the receipt the ledger keeps');

  const replay = await succeed(h, 'alice', body);
  assert.deepEqual(replay.snapshot.unresolvedOperations, [ELSEWHERE], 'the replayed receipt');

  const response = await h.call('/api/operations', 'GET', {
    as: 'alice',
    url: `/api/operations?operationId=${op(1)}&domain=account`,
    env: ON,
  });
  assert.equal(response.status, 200);
  const reconciled = await response.json();
  assertAccountReceipt(reconciled, op(1));
  assert.equal(reconciled.status, 'succeeded');
  assert.deepEqual(reconciled.snapshot.unresolvedOperations, [ELSEWHERE], 'the receipt the client reconciles with');
});

test('GET /api/account still lists genuinely pending account work after a command succeeds', async () => {
  const h = harness({ operations: runningElsewhere() });
  await succeed(h, 'alice', {
    action: 'request-recovery',
    payload: { email: FRESH },
    expectedRevision: 1,
    operationId: op(1),
  });
  const response = await h.call('/api/account', 'GET', { as: 'alice', url: '/api/account?feature=recovery', env: ON });
  assert.equal(response.status, 200);
  const read = await response.json();
  assert.deepEqual(read.unresolvedOperations, [ELSEWHERE], 'the other request is listed and the settled one is not');
});
