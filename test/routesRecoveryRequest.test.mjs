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
 * 5. Human verification (BE-340, Task 6) stands in front of all of it, and is
 *    not a silent bypass in any of its three situations: verified, refused, or
 *    not configured. It is also checked before the address is touched, so a
 *    refusal can be neither timed nor counted against whether an address
 *    resolves. `verifier()` below stands in for Cloudflare's siteverify
 *    endpoint; nothing in this file reaches the network, and the one test that
 *    proves the route really does call out asserts on the blocked attempt.
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

/**
 * What a configured deployment looks like: the capability flag on AND a
 * verification secret present. Both are required to reach the work, so neither
 * alone is "on" (Task 6). Off unless a test says otherwise.
 */
const ON = { HALO_FEATURE_RECOVERY: 'on', TURNSTILE_SECRET_KEY: 'turnstile-secret-key' };

/** Cloudflare's verification endpoint, transcribed from the route. Nothing here reaches it. */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** A token shaped like the provider's: opaque, and distinctive enough to grep for. */
const TOKEN = '0.cf-turnstile-response-ONE.AAAAbbbbCCCCdddd';

/** The size the provider's own documentation gives for a token. */
const DOCUMENTED_TOKEN_LENGTH = 2048;

/**
 * The route's own ceiling on a token, transcribed. Deliberately far above the
 * documented size, because it is an abuse bound and not a transcription: a
 * local refusal happens with no round trip, so it is invisible in the provider's
 * dashboard, which is the only place a verification outage shows (Ruling 25).
 */
const TOKEN_CEILING = 8192;

/** The route's body cap, transcribed: 1024 for the contract's three fields, plus the token's bound. */
const BODY_MAX_BYTES = 1024 + TOKEN_CEILING;

/** alice has proved this address; it is the only one that can recover anything. */
const LINKED = 'linked@example.test';
/** Nobody holds this one. */
const UNLINKED = 'nobody@example.test';
/** bob's address, present on the identity but never confirmed (what remove-recovery leaves). */
const UNCONFIRMED = 'unconfirmed@example.test';
const VERIFIED_AT = '2026-10-01T10:00:00Z';

/** The client this test speaks as: the hop the deployment itself appended. */
const CLIENT_IP = '203.0.113.7';
/** What a caller puts in the header hoping to be counted as someone else. */
const FORGED = '192.0.2.44';

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
 * The two budgets the route asks the limiters for, transcribed from
 * lib/ratelimit.js: requests per address digest per hour, and requests per
 * client digest per hour.
 */
const ADDRESS_BUDGET = 3;
const CLIENT_BUDGET = 10;

/**
 * A stand-in sliding window, because the real one lives in Redis and the
 * harness's limiter stub allows everything by default. Every call consumes a
 * token for its own key and the verdict is the limiter's: nothing here counts
 * rows, which is the point of Ruling 18. An unexpected key throws, so renaming
 * one breaks a test rather than silently disabling a budget.
 *
 * `decide.used` is the token count per key, for assertions.
 */
function budgets({ client = CLIENT_BUDGET, address = ADDRESS_BUDGET } = {}) {
  const used = new Map();
  const limits = [['recovery:client:', client], ['recovery:address:', address]];
  const decide = (key) => {
    const found = limits.find(([prefix]) => key.startsWith(prefix));
    if (!found) throw new Error(`routesRecoveryRequest: unexpected limiter key ${key}`);
    const spent = (used.get(key) ?? 0) + 1;
    used.set(key, spent);
    return spent <= found[1];
  };
  decide.used = used;
  return decide;
}

/**
 * Makes ONE kind of statement on one table fail, the way a database error
 * would, and leaves every other statement working. Patching `from` so that
 * every statement on a table fails is not the same thing: the route runs
 * several, and the first one to fail is then the only path a test can reach.
 *
 * Returns the list of statements that failed, so a test can assert the path it
 * meant to exercise was the one that broke.
 */
function failOnly(db, table, operation) {
  const real = db.from.bind(db);
  const failed = [];
  db.from = (name) => {
    const builder = real(name);
    if (name !== table) return builder;
    const start = builder[operation].bind(builder);
    builder[operation] = (...args) => {
      const chained = start(...args);
      failed.push(operation);
      chained.then = (resolve) =>
        Promise.resolve({ data: null, count: null, error: { code: '08006', message: 'connection failure' } }).then(resolve);
      return chained;
    };
    return builder;
  };
  return failed;
}

/**
 * A stand-in for Cloudflare's siteverify endpoint, as the harness's `fetch`.
 * Records every call (URL, method, headers, decoded form fields, the signal)
 * and answers what the test asked for. A fetch to anywhere else throws, so a
 * route reaching another host breaks a test rather than passing quietly.
 *
 *   success  the verdict the provider gives
 *   codes    the provider's own `error-codes`, which nothing may depend on
 *   status   a non-2xx answer, i.e. the provider refusing to answer at all
 *   body     a raw body, for an answer that is not the JSON the route expects
 *   reject   fetch itself fails, like a dead network
 *   onCall   runs when the verifier is asked, so a test can snapshot the moment
 */
function verifier({ success = true, codes = [], status = 200, body, reject = false, onCall } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url !== SITEVERIFY) throw new Error(`routesRecoveryRequest: unexpected fetch to ${url}`);
    const raw = String(init.body ?? '');
    calls.push({
      url,
      method: init.method,
      headers: new Headers(init.headers ?? {}),
      fields: Object.fromEntries(new URLSearchParams(raw)),
      raw,
      signal: init.signal ?? null,
      aborted: init.signal?.aborted ?? null,
    });
    if (onCall) onCall();
    if (reject) throw new TypeError('routesRecoveryRequest: the verifier is unreachable');
    return new Response(body ?? JSON.stringify({ success, 'error-codes': codes }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** Collects the client keys the route asked about, allowing every request. */
function clientKeys() {
  const seen = [];
  const decide = (key) => {
    if (key.startsWith('recovery:client:')) seen.push(key);
    return true;
  };
  return { seen, decide };
}

/**
 * alice holds LINKED, confirmed. bob holds UNCONFIRMED, never confirmed, which
 * is the state `remove-recovery` leaves an address in. `operations` and
 * `challenges` default to empty so each test seeds only what it is about.
 */
function harness({
  challenges = [],
  operations = [],
  tables = TABLES,
  rateLimit = budgets(),
  household = false,
  verify = verifier(),
} = {}) {
  return createRouteHarness({
    tables,
    rateLimit,
    // `verify: null` leaves the harness's own blocking fetch in place, which is
    // how one test proves the route really does call out to the provider.
    fetch: verify ?? undefined,
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
 * One request, sent the way the real client will have to send it once the
 * contract carries the token: no Authorization header, the operation id also in
 * `Idempotency-Key`, a forwarded client address because that is what a
 * deployment puts there, and a human-verification token.
 *
 * The token is filled in only when the key is ABSENT, so a test that means to
 * send none writes `captchaToken: undefined` (JSON.stringify drops the key,
 * which is exactly the body today's frontend sends).
 */
function ask(h, body, { env = ON, headers = {}, as = null, url } = {}) {
  const sent = { 'X-Forwarded-For': CLIENT_IP, ...headers };
  if (body.operationId !== undefined && !('Idempotency-Key' in sent)) {
    sent['Idempotency-Key'] = String(body.operationId);
  }
  const sentBody = 'captchaToken' in body ? body : { ...body, captchaToken: TOKEN };
  return h.call(ROUTE, 'POST', { as, body: sentBody, env, headers: sent, url });
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
  // Both really were refused as conflicts, or this would be two identical
  // replays and the comparison would prove nothing.
  assert.equal(toUnlinked.status, 409);
  assert.equal(toOtherLinked.status, 409);
  assert.equal(bodies[0].code, 'conflict');
  assert.equal(bodies[0].reason, 'operation_mismatch');
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
  for (let n = 1; n <= ADDRESS_BUDGET; n += 1) {
    const response = await complete(h, attempt(n, LINKED));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), PENDING(op(n)), `attempt ${n} is accepted`);
  }
  assert.equal(h.db.generatedLinks.length, ADDRESS_BUDGET, 'each accepted attempt sent one verification');
  assert.equal(h.db.rows('recovery_challenges').length, ADDRESS_BUDGET);

  const refused = await complete(h, attempt(ADDRESS_BUDGET + 1, LINKED));
  assert.equal(refused.status, 200, 'being limited is not something the caller can observe');
  assert.deepEqual(await refused.json(), PENDING(op(ADDRESS_BUDGET + 1)), 'the same pending answer');
  assert.equal(h.db.generatedLinks.length, ADDRESS_BUDGET, 'but the inbox is not sent to again');
  assert.equal(h.db.rows('recovery_challenges').length, ADDRESS_BUDGET, 'and no further challenge is opened');
  assert.equal(h.db.rows('operations').length, ADDRESS_BUDGET + 1, 'while the attempt is still recorded');
});

test('the address budget is keyed by the address digest, and by nothing the caller can vary', async () => {
  const limiter = budgets();
  const h = harness({ rateLimit: limiter });
  for (let n = 1; n <= ADDRESS_BUDGET; n += 1) {
    await complete(h, attempt(n, LINKED), { headers: { 'X-Forwarded-For': `198.51.100.${n}` } });
  }
  const addressKeys = [...limiter.used.keys()].filter((key) => key.startsWith('recovery:address:'));
  assert.deepEqual(addressKeys, [`recovery:address:${sha256(LINKED)}`], 'one key, the digest of the address');
  assert.equal(limiter.used.get(addressKeys[0]), ADDRESS_BUDGET, 'one token per attempt, whatever the caller claims to be');
});

test('the address budget is not a row count, so deleting every challenge does not refill it', async () => {
  // Ruling 14, carried into Ruling 18. Counting challenge rows would
  // under-count, because the link intent deletes them when a person cancels or
  // the address is confirmed. The budget now lives in the limiter's own window,
  // which is not a row anyone can delete, and is not the ledger either.
  const h = harness();
  for (let n = 1; n <= ADDRESS_BUDGET; n += 1) await complete(h, attempt(n, LINKED));

  const challenges = await h.db.from('recovery_challenges').delete().eq('intent', 'recover');
  assert.equal(challenges.error, null);
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'every challenge row is gone');
  const ledger = await h.db.from('operations').delete().eq('domain', 'recovery');
  assert.equal(ledger.error, null);
  assert.equal(h.db.rows('operations').length, 0, 'and so is every ledger row');

  await complete(h, attempt(ADDRESS_BUDGET + 1, LINKED));
  assert.equal(h.db.generatedLinks.length, ADDRESS_BUDGET, 'the budget still holds');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'nothing was reopened');
});

test('a replay does not spend the address budget, because it does nothing', async () => {
  const limiter = budgets();
  const h = harness({ rateLimit: limiter });
  await complete(h, attempt(1, LINKED));
  await complete(h, attempt(1, LINKED));
  await complete(h, attempt(1, LINKED));
  assert.equal(limiter.used.get(`recovery:address:${sha256(LINKED)}`), 1, 'one token for one operation');
  assert.equal(h.db.generatedLinks.length, 1);
});

test('the budget is per address, so one address being asked about does not block another', async () => {
  const h = harness();
  for (let n = 1; n <= ADDRESS_BUDGET + 1; n += 1) await complete(h, attempt(n, UNLINKED));
  assert.equal(h.db.rows('recovery_challenges').length, 0);

  await complete(h, attempt(20, LINKED));
  assert.equal(h.db.generatedLinks.length, 1, 'the linked address is on its own budget');
  assert.equal(h.db.rows('recovery_challenges').length, 1);
});

test('a concurrent burst on one address cannot outrun the budget', async () => {
  // Ruling 18. The budget used to be a count read before the write inside the
  // operation, which N simultaneous requests could all pass. It is now one
  // decision per request taken by the limiter, so a burst spends tokens rather
  // than racing a count. Each request carries a different forged client
  // address, so the per-client budget cannot be what refuses them: this is the
  // address budget alone, which is exactly the composition the review found.
  const h = harness();
  const burst = Array.from({ length: 50 }, (_, index) =>
    ask(h, attempt(index + 1, LINKED), { headers: { 'X-Forwarded-For': `198.51.100.${index + 1}` } }),
  );
  const responses = await Promise.all(burst);
  await h.runAfter();

  assert.deepEqual([...new Set(responses.map((response) => response.status))], [200], 'every caller is answered the same');
  assert.equal(h.db.generatedLinks.length, ADDRESS_BUDGET, 'and one inbox gets the budget, not the burst');
  assert.equal(h.db.rows('recovery_challenges').length, ADDRESS_BUDGET);
  assert.equal(h.db.rows('operations').length, 50, 'while every attempt is still recorded');
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
  assert.deepEqual(limitedKeys, [`recovery:client:${sha256(CLIENT_IP)}`], 'the client budget, checked once, keyed by a digest');
  assert.ok(!limitedKeys[0].includes(CLIENT_IP), 'the client address itself is not a limiter key');
  assert.deepEqual(h.db.queryLog, [], 'a shed request reads nothing');
  assert.equal(h.db.rows('operations').length, 0, 'and records nothing');
  assert.equal(h.db.generatedLinks.length, 0);
});

test('a client that spends its budget is refused even though the address has budget left', async () => {
  const limiter = budgets({ client: 2 });
  const h = harness({ rateLimit: limiter });
  await complete(h, attempt(1, UNLINKED));
  await complete(h, attempt(2, UNLINKED));
  const refused = await ask(h, attempt(3, UNLINKED));
  await expectEnvelope(refused, { status: 429, code: 'rate_limited' });
  assert.equal(limiter.used.get(`recovery:client:${sha256(CLIENT_IP)}`), 3, 'the client window is what refused it');
});

test('being rate limited does not reveal whether the address exists', async () => {
  const linked = harness({ rateLimit: () => false });
  const unlinked = harness({ rateLimit: () => false });
  const first = await ask(linked, attempt(1, LINKED));
  const second = await ask(unlinked, attempt(1, UNLINKED));
  const bodies = await Promise.all([first.json(), second.json()]);
  // Both really were refused, or the comparison below would hold for two
  // ordinary answers and prove nothing.
  assert.equal(first.status, 429);
  assert.equal(second.status, 429);
  assert.equal(bodies[0].code, 'rate_limited');
  assert.deepEqual(
    { ...bodies[0], request_id: 'ID' },
    { ...bodies[1], request_id: 'ID' },
    'the same refusal for an address that exists and one that does not',
  );
});

test('every client shares ONE bucket when the deployment forwards no address, rather than a fresh one each time', async () => {
  // The hazard this guards: a per-request stand-in (a random id, say) would
  // look like a key and give every caller an unlimited budget. Two
  // unattributed requests have to land in the same bucket.
  const keys = clientKeys();
  const h = harness({ rateLimit: keys.decide });
  await complete(h, attempt(1, UNLINKED), { headers: { 'X-Forwarded-For': '' } });
  await complete(h, attempt(2, UNLINKED), { headers: { 'X-Forwarded-For': '' } });
  assert.equal(keys.seen.length, 2);
  assert.equal(keys.seen[0], keys.seen[1], 'the same bucket for both, so the budget still applies');
  assert.ok(keys.seen[0].length > 'recovery:client:'.length, 'and it is a usable key');
  assert.ok(!keys.seen[0].includes(sha256(CLIENT_IP)));
});

test('the client key is the hop nearest the trusted proxy, so a prepended one cannot buy a fresh bucket', async () => {
  // Ruling 19. The leftmost entry is the end furthest from the proxy and is
  // whatever the caller sent; the rightmost is what the hop nearest us
  // appended. Taking the leftmost let an attacker vary the key per request and
  // never be refused.
  const keys = clientKeys();
  const h = harness({ rateLimit: keys.decide });
  await complete(h, attempt(1, UNLINKED), {
    headers: { 'X-Forwarded-For': ` ${FORGED} , 198.51.100.4, ${CLIENT_IP} ` },
  });
  assert.deepEqual(keys.seen, [`recovery:client:${sha256(CLIENT_IP)}`], 'the hop nearest the proxy');
  assert.ok(!keys.seen[0].includes(sha256(FORGED)), 'never the one the caller chose');
});

test('a forged chain cannot vary the client key from request to request', async () => {
  const keys = clientKeys();
  const h = harness({ rateLimit: keys.decide });
  for (let n = 1; n <= 3; n += 1) {
    await complete(h, attempt(n, UNLINKED), {
      headers: { 'X-Forwarded-For': `10.0.0.${n}, 192.0.2.${n}, ${CLIENT_IP}` },
    });
  }
  assert.deepEqual([...new Set(keys.seen)], [`recovery:client:${sha256(CLIENT_IP)}`], 'one bucket for all three');
});

/**
 * The client keys one request produced, with exactly these headers and no
 * default forwarding chain, so each case says precisely what it sends.
 */
async function keysFor(headers) {
  const keys = clientKeys();
  const h = harness({ rateLimit: keys.decide });
  const response = await h.call(ROUTE, 'POST', {
    body: { ...attempt(1, UNLINKED), captchaToken: TOKEN },
    env: ON,
    headers: { 'Idempotency-Key': op(1), ...headers },
  });
  assert.equal(response.status, 200);
  await h.runAfter();
  return keys.seen;
}

test('the client address is taken from the header a caller has least influence over (Ruling 21)', async () => {
  // The order is: the platform's own header, because it exists only where that
  // platform sets it; then the RIGHTMOST forwarded hop, which is what a proxy
  // in front appends; then x-real-ip, and only when no chain was forwarded at
  // all, because it is a single value with no hop structure and any caller can
  // send one. Preferring x-real-ip over a forwarded chain, which is what this
  // route did before, hands the bucket back to the caller on every front that
  // appends to x-forwarded-for without setting x-real-ip itself.
  const cases = [
    {
      name: 'the platform header wins over a forged chain',
      headers: { 'X-Vercel-Forwarded-For': CLIENT_IP, 'X-Forwarded-For': FORGED },
    },
    {
      name: 'the platform header wins over a forged x-real-ip',
      headers: { 'X-Vercel-Forwarded-For': CLIENT_IP, 'X-Real-IP': FORGED },
    },
    {
      name: 'the rightmost forwarded hop wins over a forged x-real-ip',
      headers: { 'X-Forwarded-For': `${FORGED}, 198.51.100.9, ${CLIENT_IP}`, 'X-Real-IP': FORGED },
    },
    {
      name: 'a single forwarded hop also wins over a forged x-real-ip',
      headers: { 'X-Forwarded-For': CLIENT_IP, 'X-Real-IP': FORGED },
    },
    {
      name: 'x-real-ip is used only when no chain was forwarded',
      headers: { 'X-Real-IP': CLIENT_IP },
    },
    {
      name: 'and when the chain is forwarded empty, which carries no hop',
      headers: { 'X-Forwarded-For': '', 'X-Real-IP': CLIENT_IP },
    },
  ];
  for (const item of cases) {
    assert.deepEqual(await keysFor(item.headers), [`recovery:client:${sha256(CLIENT_IP)}`], item.name);
  }
});

test('a forged x-real-ip cannot vary the bucket while a chain carries the real peer', async () => {
  const keys = clientKeys();
  const h = harness({ rateLimit: keys.decide });
  for (let n = 1; n <= 3; n += 1) {
    await complete(h, attempt(n, UNLINKED), {
      headers: { 'X-Forwarded-For': `10.0.0.${n}, ${CLIENT_IP}`, 'X-Real-IP': `192.0.2.${n}` },
    });
  }
  assert.deepEqual(
    [...new Set(keys.seen)],
    [`recovery:client:${sha256(CLIENT_IP)}`],
    'one bucket for all three, whatever the caller claims to be',
  );
  assert.equal(keys.seen.length, 3);
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

test('validation answers on the shape of the address and never on whether it exists', async () => {
  // The four combinations of {well formed, malformed} and {linked, unlinked}.
  // The answer must depend on the first and never on the second: the two well
  // formed ones are byte-identical to each other, the two malformed ones are
  // byte-identical to each other, and the two groups differ, so neither
  // comparison is one shape of answer against itself.
  const broken = (address) => address.replace(/\.[^.]+$/, ''); // drop the dot and the last label
  const cases = [
    { name: 'well formed, linked', email: LINKED, group: 'accepted' },
    { name: 'well formed, unlinked', email: UNLINKED, group: 'accepted' },
    { name: 'malformed, from a linked address', email: broken(LINKED), group: 'refused' },
    { name: 'malformed, from an unlinked address', email: broken(UNLINKED), group: 'refused' },
  ];
  const answers = [];
  for (const [index, item] of cases.entries()) {
    const h = harness();
    const response = await ask(h, { email: item.email, clientNonce: clientNonce(index + 1), operationId: op(1) });
    const text = (await response.text()).replaceAll(op(1), 'OPERATION');
    answers.push({ ...item, status: response.status, text: text.replace(/"request_id":"[^"]+"/, '"request_id":"ID"') });
  }
  const accepted = answers.filter((item) => item.group === 'accepted');
  const refused = answers.filter((item) => item.group === 'refused');
  assert.equal(accepted[0].text, accepted[1].text, 'a linked and an unlinked address are accepted identically');
  assert.equal(accepted[0].status, accepted[1].status);
  assert.equal(refused[0].text, refused[1].text, 'and both malformed addresses are refused identically');
  assert.equal(refused[0].status, refused[1].status);
  assert.notEqual(accepted[0].text, refused[0].text, 'while the two groups really do differ');
  assert.deepEqual([accepted[0].status, refused[0].status], [200, 400]);
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
    await expectEnvelope(malformed, { status: 400, code: 'bad_request', retryable: false });
  }

  // Over the cap, which has to leave room for a token at the route's own
  // ceiling, so the padding is sized from the cap rather than guessed at.
  const huge = await h.call(ROUTE, 'POST', {
    rawBody: JSON.stringify({ ...attempt(1, LINKED), padding: 'p'.repeat(BODY_MAX_BYTES) }),
    env: ON,
    headers: { 'X-Forwarded-For': CLIENT_IP },
  });
  await expectEnvelope(huge, { status: 413, code: 'payload_too_large' });
  assert.equal(h.db.generatedLinks.length, 0);
});

// ---------------------------------------------------------------------------
// Human verification, in front of all of it (BE-340, Task 6)
// ---------------------------------------------------------------------------

/** The address keys a limiter was asked about, which a refusal must never produce. */
const addressKeys = (limiter) => [...limiter.used.keys()].filter((key) => key.startsWith('recovery:address:'));

/** A refusal's body, with the one id that legitimately varies normalized out. */
const refusalText = async (response) =>
  (await response.text()).replace(/"request_id":"[^"]+"/, '"request_id":"ID"');

test('the verifier is asked once, with the secret and the token and nothing about the person', async () => {
  const verify = verifier();
  const h = harness({ verify });
  const response = await complete(h, attempt(1, LINKED));

  assert.equal(response.status, 200);
  assert.equal(verify.calls.length, 1, 'one verification per request');
  const [call] = verify.calls;
  assert.equal(call.url, SITEVERIFY, 'the provider\'s own endpoint');
  assert.equal(call.method, 'POST');
  assert.equal(call.fields.secret, ON.TURNSTILE_SECRET_KEY, 'the server-side secret');
  assert.equal(call.fields.response, TOKEN, 'and the token the client sent');
  assert.ok(call.signal && typeof call.signal.aborted === 'boolean', 'the call is bounded by a signal');
  assert.equal(call.aborted, false, 'which is live when the call is made');

  // Nothing about the person goes to a third party: not the address, not its
  // digest, not the nonce, not the client address a proxy reported.
  for (const secret of [LINKED, sha256(LINKED), clientNonce(1), sha256(clientNonce(1)), CLIENT_IP]) {
    assert.ok(!call.raw.includes(secret), `${secret.slice(0, 12)} is not sent to the verifier`);
  }
  assert.deepEqual(Object.keys(call.fields).sort(), ['idempotency_key', 'response', 'secret']);
  assert.equal(call.fields.idempotency_key, op(1), 'the operation id, so the same token can be re-verified');
});

test('a missing token is refused, and nothing is read about the address, written or sent', async (t) => {
  const logged = muteConsoleError(t);
  const limiter = budgets();
  const verify = verifier();
  const h = harness({ rateLimit: limiter, verify });
  const response = await ask(h, { ...attempt(1, LINKED), captchaToken: undefined });

  const body = await expectEnvelope(response, {
    status: 400,
    code: 'validation_failed',
    retryable: false,
    extraKeys: ['reason'],
  });
  assert.equal(body.reason, 'verification_required', 'a reason the client can switch on');
  assert.deepEqual(body.field_errors, [{
    field: 'captchaToken',
    code: 'verification_required',
    message: body.message,
  }]);
  assert.equal(verify.calls.length, 0, 'no token means nothing to ask the provider about');
  await h.runAfter();
  assert.equal(h.db.rows('operations').length, 0, 'the attempt is not claimed');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'no challenge is opened');
  assert.equal(h.db.generatedLinks.length, 0, 'and no message is sent');
  assert.deepEqual(addressKeys(limiter), [], 'the address budget is never even consulted');
  assert.equal(loggedText(logged), '', 'and nothing is logged');
});

test('a token the verifier rejects is refused, and nothing is written', async (t) => {
  const logged = muteConsoleError(t);
  const limiter = budgets();
  const verify = verifier({ success: false, codes: ['invalid-input-response'] });
  const h = harness({ rateLimit: limiter, verify });
  const response = await ask(h, attempt(1, LINKED));

  const body = await expectEnvelope(response, {
    status: 400,
    code: 'validation_failed',
    retryable: false,
    extraKeys: ['reason'],
  });
  assert.equal(body.reason, 'verification_failed', 'distinct from having sent no token at all');
  assert.equal(body.field_errors[0].code, 'verification_failed');
  assert.equal(verify.calls.length, 1, 'the provider was asked');
  await h.runAfter();
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  assert.equal(h.db.generatedLinks.length, 0);
  assert.deepEqual(addressKeys(limiter), [], 'a rejected token spends no address budget either');
  assert.equal(loggedText(logged), '', 'nothing is logged');
  assert.ok(!JSON.stringify(body).includes('invalid-input-response'), 'the provider\'s own codes stay on the server');
  assert.ok(!JSON.stringify(body).includes(TOKEN), 'and so does the token');
});

/**
 * How to provoke each verification refusal: the verifier to install, and the
 * body to send. Three distinct facts, which must not collapse into each other.
 * `verification_unavailable` is the provider failing to answer at all, which is
 * not the person's own failure and must not be reported as one (Ruling 24).
 */
const REFUSALS = Object.freeze({
  verification_required: {
    verify: () => verifier(),
    body: (n, email) => ({ ...attempt(n, email), captchaToken: undefined }),
  },
  verification_failed: {
    verify: () => verifier({ success: false, codes: ['invalid-input-response'] }),
    body: (n, email) => attempt(n, email),
  },
  verification_unavailable: {
    verify: () => verifier({ reject: true }),
    body: (n, email) => attempt(n, email),
  },
});

test('the three refusals are distinguishable from each other and identical for every address', async () => {
  // Both halves matter. The client has to be able to tell "you sent no token"
  // from "your token did not verify" from "we could not ask", so it can offer a
  // route forward rather than a dead end; and no refusal may differ for an
  // address that resolves and one that does not, or the refusal becomes the
  // oracle the pending body is not.
  const seen = {};
  for (const [reason, how] of Object.entries(REFUSALS)) {
    const texts = [];
    for (const [index, email] of [LINKED, UNLINKED].entries()) {
      const h = harness({ verify: how.verify() });
      const response = await ask(h, how.body(index + 1, email));
      assert.equal(response.status, 400);
      texts.push(await refusalText(response));
    }
    assert.equal(texts[0], texts[1], `${reason}: byte-identical for both addresses`);
    assert.ok(texts[0].includes(`"reason":"${reason}"`));
    seen[reason] = texts[0];
  }
  const distinct = new Set(Object.values(seen));
  assert.equal(distinct.size, Object.keys(REFUSALS).length, 'and every case differs from every other');

  // Not vacuous: that address really does resolve, in the same harness shape.
  const control = harness();
  await complete(control, attempt(9, LINKED));
  assert.equal(control.db.rows('recovery_challenges').length, 1, 'the linked address resolves and opens a challenge');
});

test('a provider that cannot answer is not reported as the person\'s own failure', async () => {
  // Ruling 24. A verifier outage and a verifier refusing the token are
  // different facts about different things, and collapsing them tells every
  // locked-out person during an outage that their own check failed and to try
  // it again, which cannot succeed. Recovery is the one route a locked-out
  // person has, so the two must stay apart.
  const down = harness({ verify: verifier({ status: 500 }) });
  const rejecting = harness({ verify: verifier({ success: false }) });
  const outage = await ask(down, attempt(1, LINKED));
  const rejected = await ask(rejecting, attempt(2, LINKED));

  const unavailable = await expectEnvelope(outage, {
    status: 400,
    code: 'validation_failed',
    retryable: false,
    extraKeys: ['reason'],
  });
  const failed = await expectEnvelope(rejected, {
    status: 400,
    code: 'validation_failed',
    retryable: false,
    extraKeys: ['reason'],
  });

  assert.equal(unavailable.reason, 'verification_unavailable');
  assert.equal(failed.reason, 'verification_failed');
  assert.deepEqual(unavailable.field_errors, [{
    field: 'captchaToken',
    code: 'verification_unavailable',
    message: unavailable.message,
  }], 'the reason is carried in the field error too, so either one can be switched on');
  assert.notEqual(unavailable.message, failed.message, 'and the copy differs, not only the code');
  assert.match(
    unavailable.message,
    /unavailable/i,
    'an outage says the check could not be made, rather than that the person failed it',
  );
  // And it offers no help that does not exist: there is no support route behind
  // this refusal, so the copy may not name one (BE-340).
  assert.ok(
    !/support|contact|help|email us/i.test(unavailable.message),
    'no copy promising a human who does not exist',
  );
});

test('verification runs before any statement or provider call that depends on the address', async () => {
  // The same method Task 5 proves its timing mitigation with: compare the
  // statements made and the provider calls attempted, not wall-clock timing.
  // At the moment the verifier is asked, nothing has been claimed, written or
  // sent, and what was read before it does not depend on the address.
  const before = [];
  for (const [index, email] of [LINKED, UNLINKED].entries()) {
    let atVerify = null;
    const verify = verifier({
      onCall: () => {
        atVerify = { statements: statements(h), links: h.db.generatedLinks.length };
      },
    });
    const h = harness({ verify });
    const response = await ask(h, attempt(index + 1, email));

    assert.equal(response.status, 200);
    assert.ok(atVerify, 'the verifier was asked');
    assert.equal(atVerify.links, 0, 'the provider was not resolved before the token was verified');
    assert.deepEqual(
      atVerify.statements.filter((entry) => entry.operation !== 'select'),
      [],
      'nothing was written before the token was verified',
    );
    before.push(atVerify.statements);
  }
  assert.deepEqual(before[0], before[1], 'and the reads before verification are the same either way');
});

test('a verifier that cannot answer fails closed, in every way it can fail to answer', async (t) => {
  // Fails closed, and says which fact it is: no answer at all is
  // `verification_unavailable`, never the person's `verification_failed`
  // (Ruling 24). Every case below is the provider not answering, including the
  // ones where it answered something this route cannot read.
  const logged = muteConsoleError(t);
  const cases = [
    { name: 'the network is dead', options: { reject: true } },
    { name: 'the provider answers 500', options: { status: 500 } },
    { name: 'the provider answers 429', options: { status: 429 } },
    { name: 'the answer is not JSON', options: { body: 'not json at all' } },
    { name: 'the answer is JSON but not an object', options: { body: '"yes"' } },
    { name: 'success is a string rather than true', options: { body: JSON.stringify({ success: 'true' }) } },
    { name: 'success is missing', options: { body: JSON.stringify({ 'error-codes': [] }) } },
  ];
  for (const [index, item] of cases.entries()) {
    const verify = verifier(item.options);
    const h = harness({ verify });
    const response = await complete(h, attempt(index + 1, LINKED));
    const body = await expectEnvelope(response, {
      status: 400,
      code: 'validation_failed',
      retryable: false,
      extraKeys: ['reason'],
    });
    assert.equal(body.reason, 'verification_unavailable', item.name);
    assert.equal(verify.calls.length, 1, `${item.name}: the provider was asked`);
    assert.equal(h.db.rows('recovery_challenges').length, 0, `${item.name}: nothing was opened`);
    assert.equal(h.db.generatedLinks.length, 0, `${item.name}: nothing was sent`);
  }
  // And the one answer that IS the person's own failure stays theirs, so the
  // comparison above is not every outcome collapsing into one reason.
  const refused = harness({ verify: verifier({ success: false }) });
  const response = await complete(refused, attempt(99, LINKED));
  assert.equal((await response.json()).reason, 'verification_failed', 'an explicit refusal is still the token\'s');
  assert.equal(loggedText(logged), '', 'and no failure leaves a line');
});

test('a token that could not be one is refused without asking the provider at all', async () => {
  const verify = verifier();
  const h = harness({ verify });
  const tokens = [null, 42, '', '   ', { token: 'x' }, ['x'], 'x'.repeat(TOKEN_CEILING + 1), `ab\ncd${'x'.repeat(40)}`];
  for (const captchaToken of tokens) {
    const response = await ask(h, { ...attempt(1, LINKED), captchaToken });
    const body = await expectEnvelope(response, {
      status: 400,
      code: 'validation_failed',
      retryable: false,
      extraKeys: ['reason'],
    });
    assert.equal(body.reason, 'verification_required', `${JSON.stringify(captchaToken)} is refused locally`);
    assert.equal(body.field_errors[0].field, 'captchaToken');
  }
  assert.equal(verify.calls.length, 0, 'a token this route can see is unusable is not worth a round trip');
  assert.equal(h.db.rows('operations').length, 0);
});

test('a token at the provider\'s documented maximum length is still sent to be verified', async () => {
  const verify = verifier();
  const h = harness({ verify });
  const long = `0.${'t'.repeat(DOCUMENTED_TOKEN_LENGTH - 2)}`;
  assert.equal(long.length, DOCUMENTED_TOKEN_LENGTH, 'the documented ceiling, not one character under it');
  const response = await complete(h, { ...attempt(1, LINKED), captchaToken: long });
  assert.equal(response.status, 200);
  assert.equal(verify.calls[0].fields.response, long);
  assert.equal(h.db.rows('recovery_challenges').length, 1);
});

test('a token longer than the provider documents still reaches the provider, because the provider is the judge', async () => {
  // Ruling 25. The local ceiling is an abuse bound, deliberately far above the
  // documented size, and not a second opinion on what the provider will accept.
  // A documented number used as a tight local limit is the one assumption here
  // that fails with NO round trip: a longer token would be refused as
  // `verification_required`, telling a person to complete a check they already
  // completed, and leaving nothing in the provider's dashboard, which the route
  // names as the place a verification problem becomes visible.
  const verify = verifier();
  const h = harness({ verify });
  const tokens = [
    `0.${'t'.repeat(DOCUMENTED_TOKEN_LENGTH)}`,
    `0.${'t'.repeat(DOCUMENTED_TOKEN_LENGTH * 2)}`,
    `0.${'t'.repeat(TOKEN_CEILING - 2)}`,
  ];
  for (const [index, token] of tokens.entries()) {
    assert.ok(token.length > DOCUMENTED_TOKEN_LENGTH, `${token.length} is over the documented size`);
    const response = await complete(h, { ...attempt(index + 1, LINKED), captchaToken: token });
    assert.equal(response.status, 200, `${token.length} characters is the provider's to judge`);
    assert.equal(verify.calls[index].fields.response, token, 'and it arrived there whole');
  }
  assert.equal(h.db.rows('recovery_challenges').length, tokens.length, 'all three were accepted');

  // The byte cap must not refuse first either, or the ceiling is decorative:
  // one character over the bound is the TOKEN check refusing, not a 413.
  const over = await ask(h, { ...attempt(4, LINKED), captchaToken: `0.${'t'.repeat(TOKEN_CEILING - 1)}` });
  const body = await expectEnvelope(over, {
    status: 400,
    code: 'validation_failed',
    retryable: false,
    extraKeys: ['reason'],
  });
  assert.equal(body.reason, 'verification_required', 'the abuse bound still holds, as a local refusal');
  assert.equal(verify.calls.length, tokens.length, 'and costs the provider nothing');
});

test('the route really does call out to the provider, which a test can prove without reaching it', async () => {
  // `verify: null` leaves the harness's blocking fetch in place: it records the
  // attempt and fails like a dead network. So this pins the endpoint the route
  // asks, and that a dead provider is a refusal rather than a pass.
  const h = harness({ verify: null });
  const response = await ask(h, attempt(1, LINKED));
  const body = await expectEnvelope(response, {
    status: 400,
    code: 'validation_failed',
    retryable: false,
    extraKeys: ['reason'],
  });
  assert.equal(body.reason, 'verification_unavailable', 'a dead provider is its own fact, not the person\'s');
  assert.deepEqual(h.blockedFetches, [SITEVERIFY], 'one outbound verification, to Cloudflare\'s siteverify endpoint');
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('the token reaches no row, no response and no log line, and neither does the verifier\'s answer', async (t) => {
  const logged = muteConsoleError(t);
  const marker = 'VERIFIER-SAID-THIS';
  const verify = verifier({ body: JSON.stringify({ success: true, hostname: marker, 'error-codes': [] }) });
  const h = harness({ verify });
  const response = await complete(h, attempt(1, LINKED));

  // The request really was accepted and really did write, or there would be
  // nothing for the token to be absent from.
  assert.equal(response.status, 200);
  assert.equal(h.db.rows('recovery_challenges').length, 1);
  assert.equal(h.db.rows('operations').length, 1);
  const text = await response.text();
  const stored = JSON.stringify([h.db.rows('recovery_challenges'), h.db.rows('operations')]);
  for (const value of [TOKEN, marker]) {
    assert.ok(!text.includes(value), `${value} is not in the response`);
    assert.ok(!stored.includes(value), `${value} is not stored`);
    assert.ok(!loggedText(logged).includes(value), `${value} is not logged`);
  }
  assert.ok(!stored.includes(sha256(TOKEN)), 'not even as a digest: the token is used and dropped');
});

test('a settled operation replays without burning a second token', async () => {
  // The real client reuses one operationId for a retried request and holds one
  // token, which the provider will only accept once. A replay does no work, so
  // it asks for no second proof: the answer is already recorded.
  const verify = verifier();
  const h = harness({ verify });
  const first = await complete(h, attempt(1, LINKED));
  const again = await complete(h, { ...attempt(1, LINKED), captchaToken: undefined });

  assert.equal(again.status, first.status);
  assert.equal(await again.text(), await first.text(), 'the first outcome, replayed verbatim');
  assert.equal(verify.calls.length, 1, 'the provider is asked once, however many times the client asks');
  assert.equal(h.db.generatedLinks.length, 1, 'and no second verification is sent');
  assert.equal(h.db.rows('recovery_challenges').length, 1);
});

test('an operation that never settled is not a free pass', async () => {
  // Both unsettled shapes. A fresh pending row is work in flight; a stale one
  // is a dead attempt the ledger reports as unknown. Neither has a recorded
  // outcome to replay, so neither may skip the check.
  for (const [index, created] of [ago(0), ago(10 * 60 * 1000)].entries()) {
    const verify = verifier();
    const h = harness({
      verify,
      operations: [{
        operation_id: op(index + 1),
        status: 'pending',
        created_at: created,
        request_hash: null,
        result: null,
      }],
    });
    const refused = await ask(h, { ...attempt(index + 1, LINKED), captchaToken: undefined });
    const body = await expectEnvelope(refused, {
      status: 400,
      code: 'validation_failed',
      retryable: false,
      extraKeys: ['reason'],
    });
    assert.equal(body.reason, 'verification_required', 'an unsettled id still needs a token');
    assert.equal(verify.calls.length, 0);

    const withToken = await ask(h, attempt(index + 1, LINKED));
    assert.equal(withToken.status, 200, 'and with one it is answered as the ledger says');
    assert.equal(verify.calls.length, 1, 'the token really was verified');
    assert.ok(['pending', 'unknown'].includes((await withToken.json()).status));
  }
});

test('the token is not part of the operation fingerprint: the same id with another token is a replay', async () => {
  // If the token were in the fingerprint, the replay below would be a 409
  // mismatch instead of the first answer, and a person who re-solved the
  // widget could never retry their own request.
  const verify = verifier();
  const h = harness({ verify });
  const first = await complete(h, attempt(1, LINKED));
  const again = await complete(h, { ...attempt(1, LINKED), captchaToken: `${TOKEN}-DIFFERENT` });

  assert.equal(again.status, 200);
  assert.equal(await again.text(), await first.text(), 'the first outcome, not a conflict');
  assert.equal(h.db.generatedLinks.length, 1);
  assert.equal(h.db.rows('operations').length, 1);
  assert.ok(!JSON.stringify(h.db.rows('operations')).includes('DIFFERENT'), 'and no token is in the ledger');
});

test('verification is checked after the client budget, so a flood cannot be aimed at the provider', async () => {
  const verify = verifier();
  const h = harness({ rateLimit: () => false, verify });
  const response = await ask(h, attempt(1, LINKED));
  await expectEnvelope(response, { status: 429, code: 'rate_limited' });
  assert.equal(verify.calls.length, 0, 'a shed request costs the provider nothing');
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

test('a provider failure is not reported to the caller, and leaves no line to count either', async (t) => {
  // The inverse oracle (review I2). The provider resolves the address before it
  // hands anything to its mailer, so a mailer failure can only happen for an
  // address that DID resolve. A line per such failure would accumulate one
  // entry per existing address and none per address that does not exist, which
  // is exactly the record the unknown-address case refuses to keep. Nothing is
  // granted on failure, so the line buys little and costs that.
  for (const [index, mode] of ['returned', 'thrown'].entries()) {
    const logged = muteConsoleError(t);
    const h = harness();
    h.forceAuthOutage(mode);
    const response = await complete(h, attempt(index + 1, LINKED));

    assert.equal(response.status, 200, 'the caller was already told pending, truthfully');
    assert.deepEqual(await response.json(), PENDING(op(index + 1)));
    assert.equal(h.db.rows('recovery_challenges').length, 0, 'and no challenge is opened on a failed send');
    assert.equal(loggedText(logged), '', `${mode}: no per-request line`);
    logged.mock.restore();
  }
});

test('a challenge that cannot be written leaves no line to count either', async (t) => {
  // The same oracle, one statement later: an insert can only fail for an
  // address that resolved to a linked identity. Only the INSERT is made to
  // fail, so that path is genuinely entered: failing every statement on the
  // table would stop at the supersede, which runs first and returns, and this
  // test would then be about that instead (review Ruling 22).
  const logged = muteConsoleError(t);
  const h = harness();
  const response = await ask(h, attempt(1, LINKED));
  assert.equal(response.status, 200);
  const failed = failOnly(h.db, 'recovery_challenges', 'insert');
  await h.runAfter();

  assert.deepEqual(failed, ['insert'], 'the insert is what failed, and it was reached');
  assert.equal(h.db.generatedLinks.length, 1, 'the provider was asked');
  assert.equal(h.db.rows('recovery_challenges').length, 0, 'and no challenge exists');
  assert.equal(loggedText(logged), '', 'the failed write is not a line per existing address');
});

test('a supersede that fails writes nothing, rather than leaving two live rows for one nonce', async (t) => {
  // The one-live-row invariant is the point of the supersede, so if it cannot
  // run, inserting anyway would produce exactly what it exists to prevent. The
  // person keeps the challenge their earlier request opened.
  const logged = muteConsoleError(t);
  const h = harness({
    challenges: [{ id: CHALLENGE, intent: 'recover', nonce_hash: sha256(clientNonce(1)), email_hash: sha256(LINKED) }],
  });
  const before = h.db.rows('recovery_challenges');
  const response = await ask(h, attempt(1, LINKED));
  assert.equal(response.status, 200);
  const failed = failOnly(h.db, 'recovery_challenges', 'delete');
  await h.runAfter();

  assert.deepEqual(failed, ['delete'], 'the supersede is what failed');
  assert.equal(h.db.generatedLinks.length, 1, 'the provider was asked');
  assert.deepEqual(h.db.rows('recovery_challenges'), before, 'and the table is exactly as it was');
  assert.equal(loggedText(logged), '', 'with no line to count');
});

test('an address that resolves to nothing is not logged at all, because that is the enumeration-sensitive case', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  await complete(h, attempt(1, UNLINKED));
  assert.equal(loggedText(logged), '', 'not finding an address is ordinary, not an error');
});

test('whatever the outcome, the number of log lines is the same, so no count can be read off them', async (t) => {
  const logged = muteConsoleError(t);
  for (const [index, email] of [LINKED, UNLINKED, UNCONFIRMED].entries()) {
    const h = harness();
    await complete(h, attempt(index + 1, email));
  }
  assert.equal(loggedText(logged), '', 'three different outcomes, no lines at all');
});

// ---------------------------------------------------------------------------
// The two intents share one table (Ruling 15)
// ---------------------------------------------------------------------------

test('a second request from the same browser supersedes its own live challenge, so the nonce digest stays one row', async () => {
  // Ruling 20. The answer carries no challenge id, so the nonce digest is the
  // only handle /status and /complete have. Two accepted requests reusing one
  // clientNonce are not replays to the ledger (different operation ids), and
  // without this they would leave two live rows sharing one digest, which a
  // single-row lookup there cannot resolve.
  const h = harness();
  await complete(h, attempt(1, LINKED));
  const first = h.db.rows('recovery_challenges')[0];
  await complete(h, { email: LINKED, clientNonce: clientNonce(1), operationId: op(2) });

  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 1, 'one live row for one nonce digest');
  assert.notEqual(rows[0].id, first.id, 'the newer request is the one that stands');
  assert.equal(rows[0].nonce_hash, sha256(clientNonce(1)));
  assert.equal(h.db.generatedLinks.length, 2, 'both requests really did ask for a verification');
});

test('superseding is scoped to the one browser: another nonce on the same identity survives', async () => {
  const h = harness();
  await complete(h, attempt(1, LINKED));
  await complete(h, attempt(2, LINKED));
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 2, 'two browsers, two live challenges');
  assert.deepEqual(
    rows.map((row) => row.nonce_hash).sort(),
    [sha256(clientNonce(1)), sha256(clientNonce(2))].sort(),
    'each keeps its own digest',
  );
});

test('superseding never touches a spent challenge, which is the record that a token was used', async () => {
  // consumed_at is the single-use evidence /complete relies on. A re-request
  // with the same nonce must not erase it.
  const h = harness({
    challenges: [{
      id: CHALLENGE,
      intent: 'recover',
      nonce_hash: sha256(clientNonce(1)),
      email_hash: sha256(LINKED),
      status: 'verified',
      restore_token_hash: hex('d4'),
      consumed_at: ago(1000),
    }],
  });
  const before = h.db.rows('recovery_challenges')[0];
  assert.ok(before.consumed_at, 'the spent row is there to lose');
  await complete(h, attempt(1, LINKED));

  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 2, 'the spent row stays, alongside the new live one');
  const spent = rows.find((row) => row.id === CHALLENGE);
  assert.deepEqual(spent, before, 'untouched, including the single-use record');
  assert.equal(rows.filter((row) => !row.consumed_at).length, 1, 'exactly one unconsumed row for the digest');
});

test('superseding never touches another household, even for the same nonce digest', async () => {
  const h = harness({
    challenges: [{
      owner: 'bob',
      id: CHALLENGE,
      intent: 'recover',
      nonce_hash: sha256(clientNonce(1)),
      email_hash: sha256(UNCONFIRMED),
    }],
  });
  await complete(h, attempt(1, LINKED));
  const rows = h.db.rows('recovery_challenges');
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.id === CHALLENGE && row.profile_id === h.identities.bob.id), "bob's row is untouched");
});

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

  // Every statement this route makes on the table either names its own intent,
  // or is the schema probe, which carries no filter at all and so cannot be a
  // lookup of anything: it reads one column of at most one row and discards it.
  const statementsOnChallenges = h.db.queryLog.filter((entry) => entry.table === 'recovery_challenges');
  assert.ok(statementsOnChallenges.length >= 3, 'the probe, the supersede and the insert all ran');
  const probes = statementsOnChallenges.filter(
    (entry) => entry.operation === 'select' && (entry.filters ?? []).length === 0,
  );
  assert.equal(probes.length, 1, 'exactly one unfiltered read, the probe');
  for (const entry of statementsOnChallenges.filter((item) => item !== probes[0])) {
    const named = `${JSON.stringify(entry.filters ?? [])}${JSON.stringify(entry.rows ?? [])}`.includes('"intent"');
    assert.ok(named, `${entry.operation} on recovery_challenges did not name the intent`);
  }
});

test('a link challenge for the same address does not count towards the address limit', async () => {
  // A link row's nonce was generated and discarded by the route that wrote it,
  // so it can never be settled by a recovering browser. Counting it would
  // refuse a real recovery attempt because the owner had once linked something.
  const h = harness({
    challenges: Array.from({ length: ADDRESS_BUDGET + 2 }, () => ({ intent: 'link', email_hash: sha256(LINKED) })),
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

test('with no verification secret the route is shut, and says exactly what the flag being off says', async (t) => {
  // The decision BE-340 turns on. A capability that silently skips human
  // verification because a key is absent is the failure the requirement names,
  // so an unconfigured deployment is refused instead, in the same words and
  // with the same envelope as the capability being off. The flag and the key
  // compose as AND, never as "the flag is on, so the missing key is waived":
  // nothing is read, nothing is written, and no request reaches the work.
  const logged = muteConsoleError(t);
  const verify = verifier();
  const h = harness({ verify });
  const unconfigured = await ask(h, attempt(1, LINKED), { env: { HALO_FEATURE_RECOVERY: 'on' } });
  const shutText = await refusalText(unconfigured.clone());
  await expectEnvelope(unconfigured, { status: 503, code: 'feature_unavailable', retryable: false });

  const off = await ask(h, attempt(2, LINKED), { env: {} });
  assert.equal(off.status, unconfigured.status);
  assert.equal(
    shutText,
    await refusalText(off),
    'the same refusal, so a stranger cannot read our configuration off it',
  );

  assert.equal(verify.calls.length, 0, 'the provider is never asked');
  assert.deepEqual(h.db.queryLog, [], 'no table is read at all');
  await h.runAfter();
  assert.equal(h.db.rows('operations').length, 0);
  assert.equal(h.db.rows('recovery_challenges').length, 0);
  assert.equal(h.db.generatedLinks.length, 0, 'and no message is sent to anybody');
  assert.equal(loggedText(logged), '');

  // Nothing outbound is attempted either, asserted where the assertion can
  // actually fail: `blockedFetches` is filled by the harness's own blocking
  // fetch, which a stand-in verifier replaces, so the harness above could never
  // have recorded an attempt whatever the route did.
  const blocked = harness({ verify: null });
  const shut = await ask(blocked, attempt(3, LINKED), { env: { HALO_FEATURE_RECOVERY: 'on' } });
  assert.equal(shut.status, 503, 'shut on that harness too');
  assert.deepEqual(blocked.blockedFetches, [], 'and no host is contacted at all');
});

test('a secret that is only whitespace is not a secret', async () => {
  const h = harness();
  for (const secret of ['', ' ', '\t\n']) {
    const response = await ask(h, attempt(1, LINKED), { env: { ...ON, TURNSTILE_SECRET_KEY: secret } });
    assert.equal(response.status, 503, `${JSON.stringify(secret)} leaves the route shut`);
  }
  assert.equal(h.db.rows('recovery_challenges').length, 0);
});

test('with the capability off the verifier is not asked either, whatever the request carries', async () => {
  const verify = verifier();
  const h = harness({ verify });
  const response = await ask(h, attempt(1, LINKED), { env: { TURNSTILE_SECRET_KEY: 'turnstile-secret-key' } });
  await expectEnvelope(response, { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(verify.calls.length, 0, 'the flag is checked first, so a token costs the provider nothing');
  assert.deepEqual(h.db.queryLog, []);
});

test('a misspelled flag value is off, like every other capability flag', async () => {
  const h = harness();
  for (const value of ['1', 'yes', 'ON ', '']) {
    const response = await ask(h, attempt(1, LINKED), { env: { ...ON, HALO_FEATURE_RECOVERY: value } });
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

// ---------------------------------------------------------------------------
// The refusals' own copy, which assertRecoveryStatus never sees
// ---------------------------------------------------------------------------

test('no refusal this route can give carries an em dash, not even the ones only a failure reaches', async (t) => {
  // `assertRecoveryStatus` enforces this repo's no-em-dash rule, but it runs
  // only on an accepted 200 body, so every refusal below sat outside the rule's
  // coverage. They are all clean today; this is what makes a future edit to one
  // of them fail here instead of shipping.
  const logged = muteConsoleError(t);
  const refusals = [];
  const record = async (label, response) => {
    assert.ok(response.status >= 400, `${label} really is a refusal, got ${response.status}`);
    const body = await response.json();
    assert.ok(typeof body.message === 'string' && body.message.length > 0, `${label} says something`);
    refusals.push([label, body]);
  };

  await record('the capability is off', await ask(harness(), attempt(1, LINKED), { env: {} }));
  await record(
    'no verification secret',
    await ask(harness(), attempt(1, LINKED), { env: { HALO_FEATURE_RECOVERY: 'on' } }),
  );
  for (const [reason, how] of Object.entries(REFUSALS)) {
    await record(reason, await ask(harness({ verify: how.verify() }), how.body(1, LINKED)));
  }
  await record('not an address', await ask(harness(), { ...attempt(1, LINKED), email: 'not-an-address' }));
  await record('an address too long', await ask(harness(), { ...attempt(1, LINKED), email: `${'a'.repeat(250)}@example.test` }));
  await record('no usable nonce', await ask(harness(), { ...attempt(1, LINKED), clientNonce: 'too-short' }));
  await record('an id that is not a uuid', await ask(harness(), { ...attempt(1, LINKED), operationId: 'not-a-uuid' }));
  await record('a key this route does not know', await ask(harness(), { ...attempt(1, LINKED), scope: 'request' }));
  await record(
    'an Idempotency-Key that disagrees',
    await ask(harness(), attempt(1, LINKED), { headers: { 'Idempotency-Key': op(2) } }),
  );
  await record('too many requests', await ask(harness({ rateLimit: () => false }), attempt(1, LINKED)));

  const conflicting = harness();
  await complete(conflicting, attempt(1, LINKED));
  await record('the same id with another address', await ask(conflicting, attempt(1, UNLINKED)));

  const malformed = harness();
  await record('a body over the cap', await malformed.call(ROUTE, 'POST', {
    rawBody: JSON.stringify({ ...attempt(1, LINKED), padding: 'p'.repeat(BODY_MAX_BYTES) }),
    env: ON,
    headers: { 'X-Forwarded-For': CLIENT_IP },
  }));
  await record('a body that is not JSON', await malformed.call(ROUTE, 'POST', {
    rawBody: 'not json at all',
    env: ON,
    headers: { 'X-Forwarded-For': CLIENT_IP, 'content-type': 'application/json' },
  }));

  const broken = harness();
  const failed = failOnly(broken.db, 'operations', 'upsert');
  await record('a failure of ours', await ask(broken, attempt(1, LINKED)));
  assert.ok(failed.length > 0, 'the 500 really came from the ledger write');

  // The whole envelope, so a field error message is covered as well as the
  // top-level one.
  for (const [label, body] of refusals) {
    assert.ok(!JSON.stringify(body).includes('—'), `${label}: app-facing copy uses no em dash`);
  }
  assert.equal(refusals.length, 16, 'and every refusal shape this route has is in the sweep');
  assert.ok(!loggedText(logged).includes('—'), 'nor does the one line a failure of ours leaves');
});
