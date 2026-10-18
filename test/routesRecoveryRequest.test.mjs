/**
 * POST /api/recovery/request, the first PUBLIC step of account recovery
 * (B02 plan, Task 5).
 *
 * The frontend sends `{ email, clientNonce, operationId }` with
 * `Idempotency-Key: operationId` and validates the answer with
 * `validRecoveryStatus(value, operationId)`
 * (lib/frontend/production/recovery-service.ts on
 * origin/codex/october15-review-refinement). `assertRecoveryStatus` below
 * transcribes that validator, so every test checks the whole contract rather
 * than the one field it happens to care about. In particular the validator
 * rejects a response whose `challengeId` or `expiresAt` key is absent, so every
 * answer this route gives carries both.
 *
 * What this file is really about:
 *
 * 1. Enumeration safety is the whole point. The answer is the same `pending`
 *    body whether or not the address resolves to a linked identity, which is
 *    asserted by comparing the serialized bodies rather than field by field,
 *    and the response carries no challenge id even when a challenge exists, so
 *    `pending` is never evidence that one does.
 * 2. No timing fork. The response is produced before the address is looked at:
 *    the resolve, the challenge insert and the verification send all happen in
 *    `after()`, once the response is finished. The tests assert that, by
 *    comparing the statements and provider calls made before the response for
 *    a linked and an unlinked address, which is a fact about the route rather
 *    than a wall-clock measurement that would flake.
 * 3. Nothing proof-bearing leaves the server (BE-201). The row holds hashes
 *    only, and the provider's one-time link and token appear in no response, no
 *    row and no log line.
 * 4. Nothing in the request names whose account is touched. There is no session
 *    here, so the address lookup is the only thing that resolves an identity,
 *    and an Authorization header that happens to be attached changes nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';

const ROUTE = '/api/recovery/request';

/** A sample of the household's own tables, so "nothing else changed" is not vacuous. */
const OWNED = ['profiles', 'daily_scores', 'household_bands', 'symptom_logs', 'alerts'];
const TABLES = haloTables('operations', 'recovery_challenges', ...OWNED);

/** The flag that turns the capability on. Off unless a test says otherwise. */
const ON = { HALO_FEATURE_RECOVERY: 'on' };

/** alice has proved this address; it is the only one that can recover anything. */
const LINKED = 'linked@example.test';
/** Nobody holds this one. */
const UNLINKED = 'nobody@example.test';
/** bob's address, present on the identity but never confirmed (what remove-recovery leaves). */
const UNCONFIRMED = 'unconfirmed@example.test';
const VERIFIED_AT = '2026-10-01T10:00:00Z';

/** The client this test speaks as, and the key the limiter sees for it. */
const CLIENT_IP = '203.0.113.7';

/** Computed here rather than imported, so the route's own hashing is not what proves it. */
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hex = (fill) => fill.repeat(64).slice(0, 64);
const future = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const op = (n) => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
const CHALLENGE = '77777777-7777-4777-8777-777777777771';

/**
 * A client nonce shaped like the real one: two concatenated UUIDs, 72
 * characters with hyphens (ProductionRestoreAccessFlow.tsx:42), which is not
 * hex and so could not be written to `nonce_hash` even by mistake.
 */
const clientNonce = (n) =>
  `${`${n}`.padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa${`${n}`.padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;

/**
 * How many requests one address may make in an hour before the rest are
 * dropped, transcribed from the route. The window is read from the operation
 * ledger, which is never deleted, so ageing those rows is the honest way to
 * move past it without sleeping.
 */
const ADDRESS_LIMIT = 3;
const PAST_THE_WINDOW = 90 * 60 * 1000;

/**
 * alice holds LINKED, confirmed. bob holds UNCONFIRMED, never confirmed, which
 * is the state `remove-recovery` leaves an address in. `operations` and
 * `challenges` default to empty so each test seeds only what it is about.
 */
function harness({ challenges = [], operations = [], tables = TABLES, rateLimit, household = false } = {}) {
  return createRouteHarness({
    tables,
    rateLimit,
    identities: {
      alice: { email: LINKED, emailConfirmedAt: VERIFIED_AT },
      bob: { email: UNCONFIRMED, emailConfirmedAt: null },
    },
    seed: (who) => {
      const rows = { profiles: Object.values(who).map((identity) => ({ id: identity.id, county: 'Durham' })) };
      if (household) Object.assign(rows, householdSeed(who.alice.id));
      if (tables.recovery_challenges) {
        rows.recovery_challenges = challenges.map(({ owner = 'alice', ...row }) => ({
          intent: 'link',
          email_hash: sha256(LINKED),
          nonce_hash: hex('b2'),
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

/** Household rows that must be untouched by a stranger's recovery request. */
const householdSeed = (id) => ({
  daily_scores: [{ profile_id: id, date: '2026-10-01', aqi: 42 }],
  household_bands: [{ profile_id: id, has_toddler: true }],
  symptom_logs: [{ profile_id: id, entry_date: '2026-10-01', notes: 'ALICE-NOTE-MARKER' }],
  alerts: [{ profile_id: id, title: 'ALICE-ALERT', dedupe_key: 'alice-1' }],
});

/**
 * One request, sent the way the real client sends it: no Authorization header,
 * the operation id also in `Idempotency-Key`, and a forwarded client address
 * because that is what a deployment puts there.
 */
function ask(h, body, { env = ON, headers = {}, as = null, url } = {}) {
  const sent = { 'X-Forwarded-For': CLIENT_IP, ...headers };
  if (body.operationId !== undefined && !('Idempotency-Key' in sent)) {
    sent['Idempotency-Key'] = String(body.operationId);
  }
  return h.call(ROUTE, 'POST', { as, body, env, headers: sent, url });
}

/** The full request body for attempt `n` on `email`. */
const attempt = (n, email) => ({ email, clientNonce: clientNonce(n), operationId: op(n) });

/** Sends one request and runs the work the route scheduled for after the response. */
async function complete(h, body, options) {
  const response = await ask(h, body, options);
  await h.runAfter(options?.after ?? {});
  return response;
}

// ---------------------------------------------------------------------------
// The contract: validRecoveryStatus, transcribed
// ---------------------------------------------------------------------------

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

/** The one body this route ever returns for an accepted request. */
const PENDING = (id) => ({ operationId: id, status: 'pending', challengeId: null, expiresAt: null });

/** The statements a request ran, as a comparable shape with no ids or timestamps in it. */
const statements = (h) =>
  h.db.queryLog.map((entry) => ({
    table: entry.table,
    operation: entry.operation,
    filters: (entry.filters ?? []).map((filter) => `${filter.column ?? filter.type}:${filter.op ?? ''}`),
  }));

// ---------------------------------------------------------------------------
// The two cases that must be indistinguishable
// ---------------------------------------------------------------------------

test('a linked address is accepted as pending and creates exactly one challenge', async () => {
  const h = harness();
  const response = await complete(h, attempt(1, LINKED));

  assert.equal(response.status, 200);
  const body = await response.json();
  assertRecoveryStatus(body, op(1));
  assert.deepEqual(body, PENDING(op(1)), 'pending, and nothing about the account in it');

  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1, 'exactly one challenge');
  assert.equal(rows[0].profile_id, h.identities.alice.id, 'owned by the identity the address resolved to');
  assert.equal(rows[0].intent, 'recover', 'written by the recover intent, not the link one');
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].restore_token_hash ?? null, null, 'no token is minted before anyone has proved anything');
  assert.equal(rows[0].consumed_at ?? null, null);
  assert.ok(Date.parse(rows[0].expires_at) > Date.now(), 'the challenge is live');
  assert.equal(rows[0].email_hash, sha256(LINKED), 'the address is stored only as its digest');
  assert.equal(rows[0].nonce_hash, sha256(clientNonce(1)), 'and the nonce only as its digest');

  // The provider was asked for exactly one verification, for that address.
  assert.deepEqual(
    h.db.generatedLinks.map(({ type, email }) => ({ type, email })),
    [{ type: 'magiclink', email: LINKED }],
    'one verification, for the address asked about',
  );
});

test('an unlinked address gets a byte-identical answer and creates nothing', async () => {
  const h = harness();
  const response = await complete(h, attempt(1, UNLINKED));

  assert.equal(response.status, 200);
  const body = await response.json();
  assertRecoveryStatus(body, op(1));
  assert.equal(JSON.stringify(body), JSON.stringify(PENDING(op(1))), 'the same answer, to the byte');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'a pending answer is not evidence a challenge exists');
});

test('the serialized answers for a linked and an unlinked address are identical apart from the id the client chose', async () => {
  const linked = harness();
  const unlinked = harness();
  const first = await complete(linked, attempt(1, LINKED));
  const second = await complete(unlinked, attempt(2, UNLINKED));

  const [a, b] = [await first.text(), await second.text()];
  assert.equal(first.status, second.status, 'the same HTTP status');
  assert.equal(
    a.replace(op(1), 'OPERATION'),
    b.replace(op(2), 'OPERATION'),
    'the serialized bodies differ in nothing but the operation id the client itself sent',
  );
  assert.deepEqual(
    [...first.headers.keys()].sort(),
    [...second.headers.keys()].sort(),
    'and the same headers, so nothing is disclosed out of band either',
  );
  // One has a challenge and the other does not, so the comparison above is not vacuous.
  assert.equal(linked.db.rows('recovery_challenges').length, 1);
  assert.equal(unlinked.db.rows('recovery_challenges').length, 0);
});

test('no timing fork: everything that depends on the address happens after the response is finished', async () => {
  // The mitigation, and the reason it works: the answer does not depend on the
  // address, so it is produced before the address is looked at. The resolve,
  // the insert and the send are scheduled with `after()`, so the work the
  // caller waits for is the same work in both cases rather than the same
  // duration by luck.
  const linked = harness();
  const unlinked = harness();
  const first = await ask(linked, attempt(1, LINKED));
  const second = await ask(unlinked, attempt(2, UNLINKED));

  for (const [name, h] of [['linked', linked], ['unlinked', unlinked]]) {
    assert.equal(h.db.generatedLinks.length, 0, `${name}: the provider is not touched before the response`);
    assert.equal(h.db.rows('recovery_challenges').length, 0, `${name}: nothing is written before the response`);
  }
  assert.deepEqual(
    statements(linked),
    statements(unlinked),
    'the same statements, in the same order, for an address that resolves and one that does not',
  );
  assert.equal(first.status, second.status);

  // And the difference appears only once the queued work runs.
  await linked.runAfter();
  await unlinked.runAfter();
  assert.equal(linked.db.rows('recovery_challenges').length, 1);
  assert.equal(unlinked.db.rows('recovery_challenges').length, 0);
  assert.notDeepEqual(statements(linked), statements(unlinked), 'the work itself does differ, after the response');
});

test('an address on an identity that never confirmed it cannot recover anything', async () => {
  // What `remove-recovery` leaves behind: the address is still on the identity
  // and is not a credential any more. Resolving to an identity is not enough;
  // it has to resolve to a linked one.
  const h = harness();
  await complete(h, attempt(1, UNCONFIRMED));
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'no challenge for an unproved address');
});

test('a stranger asking about an address touches none of that household\'s records', async () => {
  const h = harness({ household: true });
  const before = Object.fromEntries(OWNED.map((table) => [table, h.db.rows(table)]));
  await complete(h, attempt(1, LINKED));
  for (const table of OWNED) {
    assert.deepEqual(h.db.rows(table), before[table], `${table} is untouched`);
  }
  assert.equal(h.db.identities.get(h.identities.alice.id).email, LINKED, 'and the identity is unchanged');
});

// ---------------------------------------------------------------------------
// Nothing in the request names whose account is touched
// ---------------------------------------------------------------------------

test('an Authorization header changes nothing: the address is the only thing that resolves an identity', async () => {
  // The endpoint is public, and the frontend's runtime does not promise never to
  // attach a credential to a public call. A session that happens to arrive must
  // not become authority over whose account this is.
  const withSession = harness();
  const without = harness();
  const first = await complete(withSession, attempt(1, LINKED), { as: 'bob' });
  const second = await complete(without, attempt(1, LINKED));

  assert.equal(
    (await first.text()).replace(op(1), 'OPERATION'),
    (await second.text()).replace(op(1), 'OPERATION'),
    'the answer is the same with and without a session',
  );
  const rows = withSession.db.rows('recovery_challenges');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].profile_id, withSession.identities.alice.id, "the challenge is alice's, not the caller's");
  assert.equal(withSession.db.rows('operations')[0].profile_id ?? null, null, 'and the ledger row has no owner');
});

test('the ledger row is the unauthenticated kind: no owner, the recovery domain, and not readable through /api/operations', async () => {
  const h = harness();
  await complete(h, attempt(1, LINKED));
  const rows = h.db.rows('operations');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation_id, op(1), 'keyed by the id the client sent');
  assert.equal(rows[0].profile_id ?? null, null, 'recovery is the one domain the ledger allows with no owner');
  assert.equal(rows[0].domain, 'recovery');
  assert.equal(rows[0].kind, 'recovery.request');
  assert.equal(rows[0].status, 'succeeded');
  assert.deepEqual(rows[0].result, PENDING(op(1)), 'the stored receipt is the answer that was given');
  assert.ok(!JSON.stringify(rows).includes(LINKED), 'the address is not in the ledger either');
  assert.ok(!JSON.stringify(rows).includes(clientNonce(1)), 'and neither is the nonce');
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('a replayed operation id returns the first answer and sends no second verification', async () => {
  const h = harness();
  const first = await complete(h, attempt(1, LINKED));
  const again = await complete(h, attempt(1, LINKED));

  assert.equal(again.status, first.status);
  assert.equal(await again.text(), await first.text(), 'the first outcome, replayed verbatim');
  assert.equal(h.db.generatedLinks.length, 1, 'the provider is asked once, however many times the client asks');
  assert.equal(h.db.rows('recovery_challenges').length, 1, 'and there is still one challenge');
  assert.equal(h.db.rows('operations').length, 1);
});

test('a replay with a different nonce is still a replay, and still sends nothing', async () => {
  // The nonce is deliberately not part of the operation's fingerprint: the
  // answer carries no challenge id, so replaying someone's id with another
  // nonce yields nothing, writes nothing and cannot bind a challenge to it.
  const h = harness();
  const first = await complete(h, attempt(1, LINKED));
  const again = await complete(h, { email: LINKED, clientNonce: clientNonce(99), operationId: op(1) });

  assert.equal(await again.text(), await first.text());
  assert.equal(h.db.generatedLinks.length, 1);
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nonce_hash, sha256(clientNonce(1)), 'the first browser keeps the challenge');
});

test('the same operation id with a different address is a conflict, not a wrong replay', async () => {
  const h = harness();
  await complete(h, attempt(1, LINKED));
  const response = await ask(h, { email: UNLINKED, clientNonce: clientNonce(1), operationId: op(1) });
  await expectEnvelope(response, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(h.db.generatedLinks.length, 1, 'and nothing more is sent');
});

test('a conflict says nothing about either address', async () => {
  // The same id reused with a linked address and with an unlinked one must give
  // the same refusal, or the refusal becomes the oracle the pending body is not.
  const first = harness();
  const second = harness();
  await complete(first, attempt(1, LINKED));
  await complete(second, attempt(1, LINKED));
  const toUnlinked = await ask(first, { email: UNLINKED, clientNonce: clientNonce(1), operationId: op(1) });
  const toOtherLinked = await ask(second, { email: UNCONFIRMED, clientNonce: clientNonce(1), operationId: op(1) });
  const bodies = await Promise.all([toUnlinked.json(), toOtherLinked.json()]);
  assert.equal(toUnlinked.status, toOtherLinked.status);
  assert.deepEqual(
    { ...bodies[0], request_id: 'ID' },
    { ...bodies[1], request_id: 'ID' },
    'the same conflict either way',
  );
});

test('an Idempotency-Key that is not the operation id is refused rather than guessed at', async () => {
  const h = harness();
  const response = await ask(h, attempt(1, LINKED), { headers: { 'Idempotency-Key': op(2) } });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'operationId');
  assert.deepEqual(h.db.queryLog, [], 'nothing is read');
  assert.equal(h.db.generatedLinks.length, 0);
});

// ---------------------------------------------------------------------------
// Rate limiting: per address hash, and separately per client
// ---------------------------------------------------------------------------

test('an address may be asked about a few times an hour; after that nothing more is sent, and the answer still does not change', async () => {
  const h = harness();
  for (let n = 1; n <= ADDRESS_LIMIT; n += 1) {
    const response = await complete(h, attempt(n, LINKED));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), PENDING(op(n)), `attempt ${n} is accepted`);
  }
  assert.equal(h.db.generatedLinks.length, ADDRESS_LIMIT, 'each accepted attempt sent one verification');
  assert.equal(h.db.rows('recovery_challenges').length, ADDRESS_LIMIT);

  const refused = await complete(h, attempt(ADDRESS_LIMIT + 1, LINKED));
  assert.equal(refused.status, 200, 'being limited is not something the caller can observe');
  assert.deepEqual(await refused.json(), PENDING(op(ADDRESS_LIMIT + 1)), 'the same pending answer');
  assert.equal(h.db.generatedLinks.length, ADDRESS_LIMIT, 'but the inbox is not sent to again');
  assert.equal(h.db.rows('recovery_challenges').length, ADDRESS_LIMIT, 'and no further challenge is opened');
  assert.equal(h.db.rows('operations').length, ADDRESS_LIMIT + 1, 'while the attempt is still recorded');
});

test('the address limit counts the ledger, which no cancellation or completion can empty', async () => {
  // Ruling 14. Counting challenge rows would under-count, because the link
  // intent deletes them when a person cancels or the address is confirmed. The
  // ledger keeps one row per attempt and is never deleted.
  const h = harness();
  for (let n = 1; n <= ADDRESS_LIMIT; n += 1) await complete(h, attempt(n, LINKED));

  const { error } = await h.db.from('recovery_challenges').delete().eq('intent', 'recover');
  assert.equal(error, null);
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'every challenge row is gone');

  await complete(h, attempt(ADDRESS_LIMIT + 1, LINKED));
  assert.equal(h.db.generatedLinks.length, ADDRESS_LIMIT, 'and the limit still holds');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'nothing was reopened');
});

test('the ledger row the limit counts is keyed by the address and nothing per-attempt', async () => {
  // The fragile part of counting the ledger: the row is matched by the input
  // fingerprint the ledger itself computes, so the input must be the address
  // digest and nothing else. Add a per-attempt field to it and every attempt
  // gets a unique hash, which would turn the limit off silently.
  const h = harness();
  await complete(h, attempt(1, LINKED));
  await complete(h, attempt(2, LINKED));
  await complete(h, attempt(3, UNLINKED));
  const hashes = h.db.rows('operations').map((row) => row.request_hash);
  assert.equal(hashes[0], hashes[1], 'two attempts on one address share a fingerprint');
  assert.notEqual(hashes[0], hashes[2], 'and a different address has a different one');
  assert.equal(hashes.filter(Boolean).length, 3, 'every attempt carries one');
  assert.ok(!hashes.includes(sha256(LINKED)), 'it is a hash of the operation input, not the address digest itself');
});

test('the limit is per address, so one address being asked about does not block another', async () => {
  const h = harness();
  for (let n = 1; n <= ADDRESS_LIMIT + 1; n += 1) await complete(h, attempt(n, UNLINKED));
  assert.equal(h.db.rows('recovery_challenges').length, 0);

  await complete(h, attempt(20, LINKED));
  assert.equal(h.db.generatedLinks.length, 1, 'the linked address is on its own budget');
  assert.equal(h.db.rows('recovery_challenges').length, 1);
});

test('older attempts fall out of the window, so the limit is a pause and not a lockout', async () => {
  const h = harness();
  for (let n = 1; n <= ADDRESS_LIMIT + 1; n += 1) await complete(h, attempt(n, LINKED));
  assert.equal(h.db.generatedLinks.length, ADDRESS_LIMIT, 'the window is full');

  const { error } = await h.db
    .from('operations')
    .update({ created_at: ago(PAST_THE_WINDOW) })
    .eq('domain', 'recovery');
  assert.equal(error, null);

  await complete(h, attempt(ADDRESS_LIMIT + 2, LINKED));
  assert.equal(h.db.generatedLinks.length, ADDRESS_LIMIT + 1, 'an hour later the address can be asked about again');
});

test('a client that asks too often is told to wait, with nothing said about any address', async () => {
  const limitedKeys = [];
  const h = harness({
    rateLimit: (key) => {
      limitedKeys.push(key);
      return false;
    },
  });
  const response = await ask(h, attempt(1, LINKED));
  const body = await expectEnvelope(response, { status: 429, code: 'rate_limited' });
  assert.ok(!body.message.includes('@'), 'the refusal names no address');
  assert.equal(limitedKeys.length, 1, 'one limiter, checked once');
  assert.ok(limitedKeys[0].includes(sha256(CLIENT_IP)), 'keyed by a digest of the client address, never the address itself');
  assert.ok(!limitedKeys[0].includes(CLIENT_IP), 'the client address itself is not a limiter key');
  assert.deepEqual(h.db.queryLog, [], 'a shed request reads nothing');
  assert.equal(h.db.rows('operations').length, 0, 'and records nothing');
  assert.equal(h.db.generatedLinks.length, 0);
});

test('being rate limited does not reveal whether the address exists', async () => {
  const linked = harness({ rateLimit: () => false });
  const unlinked = harness({ rateLimit: () => false });
  const first = await ask(linked, attempt(1, LINKED));
  const second = await ask(unlinked, attempt(1, UNLINKED));
  const bodies = await Promise.all([first.json(), second.json()]);
  assert.equal(first.status, second.status);
  assert.deepEqual(
    { ...bodies[0], request_id: 'ID' },
    { ...bodies[1], request_id: 'ID' },
    'the same refusal for an address that exists and one that does not',
  );
});

test('every client shares one bucket when the deployment forwards no address, rather than none at all', async () => {
  const keys = [];
  const h = harness({
    rateLimit: (key) => {
      keys.push(key);
      return true;
    },
  });
  await complete(h, attempt(1, LINKED), { headers: { 'X-Forwarded-For': '' } });
  assert.equal(keys.length, 1);
  assert.ok(keys[0].length > 0, 'a missing client address still produces a key');
  assert.ok(!keys[0].includes(sha256(CLIENT_IP)));
});

test('the client key is the first forwarded hop, not whatever a proxy chain appended', async () => {
  const keys = [];
  const h = harness({ rateLimit: (key) => { keys.push(key); return true; } });
  await complete(h, attempt(1, LINKED), {
    headers: { 'X-Forwarded-For': ` ${CLIENT_IP} , 198.51.100.4, 192.0.2.9` },
  });
  assert.ok(keys[0].includes(sha256(CLIENT_IP)), 'the caller the deployment saw');
});

// ---------------------------------------------------------------------------
// Validation, which must not become an oracle either
// ---------------------------------------------------------------------------

test('an address that is not an address is refused before anything is looked up', async () => {
  const h = harness();
  for (const email of ['not-an-address', 'two@@example.test', 'spaces in@example.test', 'no-dot@example', '', 'a@b.c '.repeat(60)]) {
    const response = await ask(h, { email, clientNonce: clientNonce(1), operationId: op(1) });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'email', `${JSON.stringify(email)} is refused`);
  }
  assert.deepEqual(h.db.queryLog, [], 'nothing is read for an address that cannot be one');
  assert.equal(h.db.rows('operations').length, 0, 'and nothing is recorded');
  assert.equal(h.db.generatedLinks.length, 0);
});

test('an address over 254 characters is refused, like the client\'s own rule', async () => {
  const h = harness();
  const long = `${'a'.repeat(250)}@example.test`;
  const response = await ask(h, { email: long, clientNonce: clientNonce(1), operationId: op(1) });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'email');
});

test('a refusal for a malformed address says no more than a refusal for a well formed one', async () => {
  // The validation error must not become the oracle the pending body is not: an
  // address that cannot exist and one that simply does not exist are both just
  // refused or accepted on their shape.
  const h = harness();
  const malformed = await ask(h, { email: 'nobody@example', clientNonce: clientNonce(1), operationId: op(1) });
  const other = await ask(h, { email: 'someone@example', clientNonce: clientNonce(2), operationId: op(2) });
  const bodies = await Promise.all([malformed.json(), other.json()]);
  assert.deepEqual({ ...bodies[0], request_id: 'ID' }, { ...bodies[1], request_id: 'ID' });
});

test('the address is normalized the way it is hashed, so case cannot open a second challenge', async () => {
  const h = harness();
  await complete(h, attempt(1, ` ${LINKED.toUpperCase()} `));
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1, 'the same address, however it was typed');
  assert.equal(rows[0].email_hash, sha256(LINKED));
  assert.equal(rows[0].profile_id, h.identities.alice.id);
});

test('a nonce that could not be a secret is refused, and so is a missing one', async () => {
  const h = harness();
  for (const clientNonceValue of [undefined, null, '', 'short', 42, { nonce: 'x' }, 'x'.repeat(300)]) {
    const response = await ask(h, { email: LINKED, clientNonce: clientNonceValue, operationId: op(1) });
    const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.field_errors[0].field, 'clientNonce', `${JSON.stringify(clientNonceValue)} is refused`);
  }
  assert.equal(h.db.generatedLinks.length, 0);
});

test('an operation id must be a uuid, because the ledger is keyed by it', async () => {
  const h = harness();
  const response = await ask(h, { email: LINKED, clientNonce: clientNonce(1), operationId: 'not-a-uuid' });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.equal(body.field_errors[0].field, 'operationId');
});

test('a body key this route does not know is refused rather than quietly ignored', async () => {
  const h = harness();
  const response = await ask(h, { ...attempt(1, LINKED), profileId: '00000000-0000-4000-8000-000000000001', scope: 'request' });
  const body = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(body.field_errors.map((item) => item.field), ['profileId', 'scope']);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('a body that is not an object, and one that is too large, are refused', async () => {
  const h = harness();
  for (const rawBody of ['not json at all', '[]', 'null', '"text"']) {
    const malformed = await h.call(ROUTE, 'POST', {
      rawBody,
      env: ON,
      headers: { 'X-Forwarded-For': CLIENT_IP, 'content-type': 'application/json' },
    });
    await expectEnvelope(malformed, { status: 400, code: 'validation_failed', retryable: false });
  }

  const huge = await h.call(ROUTE, 'POST', {
    rawBody: JSON.stringify({ ...attempt(1, LINKED), padding: 'p'.repeat(4096) }),
    env: ON,
    headers: { 'X-Forwarded-For': CLIENT_IP },
  });
  await expectEnvelope(huge, { status: 413, code: 'payload_too_large' });
  assert.equal(h.db.generatedLinks.length, 0);
});

// ---------------------------------------------------------------------------
// Nothing proof-bearing leaves the server
// ---------------------------------------------------------------------------

test('the provider\'s one-time link and token reach no response, no row and no log line', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  const response = await complete(h, attempt(1, LINKED));
  const text = await response.text();
  const stored = JSON.stringify([h.db.rows('recovery_challenges'), h.db.rows('operations')]);
  const secrets = h.db.generatedLinks[0].properties;

  assert.ok(Object.keys(secrets).length >= 3, 'the provider did hand back something worth hiding');
  for (const [name, value] of Object.entries(secrets)) {
    assert.ok(!text.includes(value), `${name} is not in the response`);
    assert.ok(!stored.includes(value), `${name} is not stored`);
    assert.ok(!loggedText(logged).includes(value), `${name} is not logged`);
  }
  assert.ok(!text.includes(LINKED) && !stored.includes(LINKED), 'and neither is the address');
  assert.ok(!text.includes(clientNonce(1)) && !stored.includes(clientNonce(1)), 'nor the nonce');
});

test('a provider failure is not reported to the caller and is logged without the address', async (t) => {
  for (const [index, mode] of ['returned', 'thrown'].entries()) {
    const logged = muteConsoleError(t);
    const h = harness();
    h.forceAuthOutage(mode);
    const response = await complete(h, attempt(index + 1, LINKED));

    assert.equal(response.status, 200, 'the caller was already told pending, truthfully');
    assert.deepEqual(await response.json(), PENDING(op(index + 1)));
    assert.equal(h.db.rows('recovery_challenges').length, 0, 'and no challenge is opened on a failed send');
    const text = loggedText(logged);
    assert.ok(text.length > 0, `${mode}: the failure is visible to us`);
    assert.ok(!text.includes(LINKED), 'without the address');
    assert.ok(!text.includes(clientNonce(index + 1)), 'and without the nonce');
    logged.mock.restore();
  }
});

test('an address that resolves to nothing is not logged at all, because that is the enumeration-sensitive case', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  await complete(h, attempt(1, UNLINKED));
  assert.equal(loggedText(logged), '', 'not finding an address is ordinary, not an error');
});

// ---------------------------------------------------------------------------
// The two intents share one table (Ruling 15)
// ---------------------------------------------------------------------------

test('a link challenge is invisible to this route: it is neither read, superseded nor counted', async () => {
  const h = harness({
    challenges: [{ id: CHALLENGE, intent: 'link', email_hash: sha256(LINKED), nonce_hash: hex('b2') }],
  });
  await complete(h, attempt(1, LINKED));

  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 2, 'the link challenge is still there, alongside the new recovery one');
  const link = rows.find((row) => row.id === CHALLENGE);
  assert.equal(link.intent, 'link');
  assert.equal(link.nonce_hash, hex('b2'), 'untouched: its nonce was discarded by the route that wrote it');
  assert.equal(rows.filter((row) => row.intent === 'recover').length, 1);

  // Every statement this route makes on the table names its own intent.
  const statementsOnChallenges = h.db.queryLog.filter((entry) => entry.table === 'recovery_challenges');
  assert.ok(statementsOnChallenges.length >= 2, 'the probe and the insert both ran');
  for (const entry of statementsOnChallenges) {
    const named = `${JSON.stringify(entry.filters ?? [])}${JSON.stringify(entry.rows ?? [])}`.includes('"intent"');
    assert.ok(named, `${entry.operation} on recovery_challenges did not name the intent`);
  }
});

test('a link challenge for the same address does not count towards the address limit', async () => {
  // A link row's nonce was generated and discarded by the route that wrote it,
  // so it can never be settled by a recovering browser. Counting it would
  // refuse a real recovery attempt because the owner had once linked something.
  const h = harness({
    challenges: Array.from({ length: ADDRESS_LIMIT + 2 }, () => ({ intent: 'link', email_hash: sha256(LINKED) })),
  });
  await complete(h, attempt(1, LINKED));
  assert.equal(h.db.generatedLinks.length, 1, 'the recovery attempt is accepted');
});

// ---------------------------------------------------------------------------
// Off, and not there yet
// ---------------------------------------------------------------------------

test('with the capability off the request is unavailable, and nothing is read or written', async () => {
  const h = harness();
  const response = await ask(h, attempt(1, LINKED), { env: {} });
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.deepEqual(h.db.queryLog, [], 'no table is read at all');
  assert.equal(h.db.generatedLinks.length, 0, 'and the provider is never contacted');
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('a misspelled flag value is off, like every other capability flag', async () => {
  const h = harness();
  for (const value of ['1', 'yes', 'ON ', '']) {
    const response = await ask(h, attempt(1, LINKED), { env: { HALO_FEATURE_RECOVERY: value } });
    const status = value.trim().toLowerCase() === 'on' ? 200 : 503;
    assert.equal(response.status, status, `${JSON.stringify(value)}`);
  }
});

test('before migration 0018 the answer is unavailable rather than a false pending', async () => {
  const h = harness({ tables: haloTables('profiles', 'operations') });
  const response = await ask(h, attempt(1, LINKED));
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(h.db.rows('operations').length, 0, 'nothing is recorded as attempted');
  await h.runAfter();
  assert.equal(h.db.generatedLinks.length, 0, 'and nothing was queued to send');
});

test('before migration 0017 there is no ledger to be idempotent against, so the request is unavailable', async () => {
  const h = harness({ tables: haloTables('profiles', 'recovery_challenges') });
  const response = await ask(h, attempt(1, LINKED));
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  await h.runAfter();
  assert.equal(h.db.generatedLinks.length, 0);
});

test('before migration 0019 the request is unavailable, because a row it cannot label is a row the link intent may delete', async () => {
  for (const code of ['PGRST204', '42703']) {
    const h = harness();
    const failed = withoutColumn(h.db, 'recovery_challenges', 'intent', code);
    const response = await ask(h, attempt(1, LINKED));
    await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
    assert.ok(failed.length > 0, `${code} is what refused it`);
    assert.equal(h.db.rows('operations').length, 0);
    await h.runAfter();
    assert.equal(h.db.generatedLinks.length, 0);
    failed.restore();
  }
});

// ---------------------------------------------------------------------------
// Failures that are ours
// ---------------------------------------------------------------------------

test('a ledger that cannot be written is a 500 with nothing sent, not a pending that promises a message', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  h.db.from = ((real) => (name) => {
    const builder = real(name);
    if (name !== 'operations') return builder;
    builder.then = (resolve) => Promise.resolve({ data: null, count: null, error: { code: '08006', message: 'connection failure' } }).then(resolve);
    return builder;
  })(h.db.from.bind(h.db));

  const response = await ask(h, attempt(1, LINKED));
  await expectEnvelope(response, { status: 500, code: 'internal_error' });
  await h.runAfter();
  assert.equal(h.db.generatedLinks.length, 0, 'nothing was sent');
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  assert.ok(!loggedText(logged).includes(LINKED), 'and the address is not in the log line');
});

test('GET is not a method this route has', async () => {
  const h = harness();
  const response = await h.call(ROUTE, 'GET', {});
  assert.equal(response.status, 405);
});
