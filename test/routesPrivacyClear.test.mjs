/**
 * POST /api/privacy/clear (`privacy.clear`, B07 plan, Task 6) on the fake
 * harness: everything the route decides itself, before and around the one
 * database function. The function's own behaviour (atomic delete, reset,
 * settle, the freeze trigger) is proved on the real 0024 in
 * test/routesPrivacyClearDb.test.mjs; here migration 0024's three functions
 * are small stand-ins so the route's refusals, its owner scoping, its
 * availability checks, its logs and its receipt shape can be checked in
 * every combination:
 *
 *   privacy_schema_version  1, or missing, or another version
 *   privacy_fingerprint     a hash of the household's fake rows in the tables named
 *   clear_household_records checks the operation's own pending row and the
 *                           fingerprint, deletes the caller's journal rows,
 *                           settles the row and returns the receipt
 *
 * The client's `accept` (ProductionPrivacy.tsx:23) is transcribed verbatim in
 * test/helpers/privacyClearClient.mjs; the first test here pins that
 * transcription to the component in this tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { HALO_TABLES } from './helpers/tables.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { ACCEPT_SIGNATURE, ACCEPT_SOURCE, COMPONENT, MESSAGES, privacyPanel } from './helpers/privacyClearClient.mjs';
import { fingerprintTables } from '../lib/privacyInventory.js';
import { REVIEW_TOKEN_TTL_MS, mintReviewToken } from '../lib/privacyToken.js';
import { RUNTIME_MESSAGES } from './helpers/frontendB04.mjs';

const { requestHash } = await import('../lib/operations.js');

const ROUTE = '/api/privacy/clear';
const ROUTE_FILE = path.join(REPO_ROOT, 'app/api/privacy/clear/route.js');
const KEY = 'privacy-review-key-for-tests-only-0123456789';
const ENV = Object.freeze({ HALO_PRIVACY_REVIEW_KEY: KEY });
const NOTE = 'PRIVATE-NOTE-MARKER the inhaler is in the blue bag';
const EM_DASH = '\u2014';

/** Every body this file receives, for the closing U+2014 check. */
const bodies = [];

// ---------------------------------------------------------------------------
// The 0024 stand-ins
// ---------------------------------------------------------------------------

/** A fingerprint of the household's fake rows in these tables: changes when any of them does. */
function fakeFingerprint(db, profileId, tables) {
  const picture = tables.map((table) => {
    let rows = [];
    try { rows = db.rows(table); } catch { rows = []; }
    const owner = table === 'profiles' ? 'id' : 'profile_id';
    return [table, rows.filter((row) => row[owner] === profileId).map((row) => JSON.stringify(row)).sort()];
  });
  return createHash('sha256').update(JSON.stringify(picture)).digest('hex');
}

/** The real function's contract (0024 header): its own pending row, the fingerprint, then the delete and the settle. */
function fakeClear(db, { p_profile_id: owner, p_operation_id: id, p_scope: scope, p_fingerprint: print }) {
  const row = db.rows('operations').find((item) => item.operation_id === id);
  if (!row || row.profile_id !== owner || row.domain !== 'privacy' || row.kind !== `privacy.clear.${scope}` || row.status !== 'pending') {
    throw rpcError('P0001', 'HALO_OPERATION_NOT_PENDING');
  }
  if (print !== fakeFingerprint(db, owner, fingerprintTables(scope))) throw rpcError('P0001', 'HALO_REVIEW_CHANGED');
  return { receipt: { operationId: id, status: 'succeeded', scope }, removed: 0, settle: true };
}

/**
 * A harness with alice's and bob's journals, and the stand-ins registered.
 * `clear(args, call)` wraps the clear; `version` is what the probe answers
 * (null: the probe function is missing, as before 0024).
 */
function harness({ env = ENV, tables = HALO_TABLES, version = 1, clear } = {}) {
  const h = createRouteHarness({
    tables,
    env,
    seed: ({ alice, bob }) => ({
      profiles: [{ id: alice.id, lat: 35.4, lng: -80.6 }, { id: bob.id, lat: 35.1, lng: -80.2 }],
      symptom_logs: [
        { id: crypto.randomUUID(), profile_id: alice.id, entry_date: '2026-10-01', symptoms: ['cough'], note: NOTE },
        { id: crypto.randomUUID(), profile_id: bob.id, entry_date: '2026-10-01', symptoms: ['wheeze'] },
      ],
    }),
  });
  if (version !== null) h.db.registerRpc('privacy_schema_version', () => version, { args: [] });
  h.db.registerRpc('privacy_fingerprint', (args, db) => fakeFingerprint(db, args.p_profile_id, args.p_tables), { args: ['p_profile_id', 'p_tables'] });
  const real = async (args, db) => {
    const out = fakeClear(db, args);
    // The settle and the delete, through the fake client so they are scoped like the SQL.
    await db.from('symptom_logs').delete().eq('profile_id', args.p_profile_id);
    await db.from('operations').update({ status: 'succeeded', result: out.receipt }).eq('operation_id', args.p_operation_id);
    return { receipt: out.receipt, removed: 1 };
  };
  h.db.registerRpc('clear_household_records', (args, db) => (clear ? clear(args, () => real(args, db)) : real(args, db)), {
    args: ['p_profile_id', 'p_operation_id', 'p_scope', 'p_fingerprint'],
  });
  return h;
}

/** A review token alice (or `who`) would be given by inspect now. */
function review(h, { who = 'alice', scope = 'journal', groups = ['tasks'], now } = {}) {
  const profileId = h.identities[who].id;
  const fingerprint = fakeFingerprint(h.db, profileId, fingerprintTables(scope, groups));
  return mintReviewToken(KEY, { profileId, scope, groups, privateText: false, fingerprint, now }).reviewToken;
}

/** POST as `as`: the body as JSON (or `raw`), Idempotency-Key equal to its operationId unless `key` says otherwise. */
async function send(h, body, { as = 'alice', key = body?.operationId, headers = {}, raw, url } = {}) {
  const response = await h.call(ROUTE, 'POST', {
    as,
    url,
    rawBody: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(key == null ? {} : { 'idempotency-key': key }), ...headers },
  });
  bodies.push(await response.clone().text());
  return response;
}

const clearBody = (h, over = {}) => ({ reviewToken: review(h, { scope: over.scope ?? 'journal' }), scope: 'journal', operationId: crypto.randomUUID(), ...over });
const ledger = (h) => h.db.rows('operations');
const calls = (h, name) => h.db.rpcCalls.filter((call) => call.name === name);

// ---------------------------------------------------------------------------
// The transcription
// ---------------------------------------------------------------------------

test('the transcribed accept is the component\'s line, verbatim with the parameter types removed', () => {
  const lines = readFileSync(path.join(REPO_ROOT, COMPONENT), 'utf8').split('\n').filter((line) => line.trim().startsWith('function accept('));
  assert.equal(lines.length, 1, 'one accept in the component');
  assert.ok(lines[0].trim().startsWith(ACCEPT_SIGNATURE.typed), 'the component\'s signature is the one the transcription strips');
  assert.equal(lines[0].trim().replace(ACCEPT_SIGNATURE.typed, ACCEPT_SIGNATURE.plain), ACCEPT_SOURCE);
});

test('the transcribed accept rejects what the client rejects: another id, a pending status', () => {
  const id = crypto.randomUUID();
  const other = privacyPanel();
  other.accept({ operationId: crypto.randomUUID(), status: 'succeeded' }, 'all', id);
  assert.deepEqual([other.message, other.unknown, other.workspaceRetries], [MESSAGES.checking, { id, scope: 'all' }, 0]);
  const pending = privacyPanel();
  pending.accept({ operationId: id, status: 'pending' }, 'journal', id);
  assert.deepEqual([pending.message, pending.unknown], [MESSAGES.checking, { id, scope: 'journal' }]);
});

// ---------------------------------------------------------------------------
// The route's own decisions
// ---------------------------------------------------------------------------

test('maxDuration is 60, under the ledger\'s staleness window', async () => {
  const route = await import('../app/api/privacy/clear/route.js');
  assert.equal(route.maxDuration, 60);
});

test('401 without a session, with nothing read or recorded', async () => {
  const h = harness();
  const response = await send(h, clearBody(h), { as: null });
  await expectEnvelope(response, { status: 401, code: 'auth_required' });
  assert.deepEqual([ledger(h), h.db.rpcCalls], [[], []]);
});

test('a clear succeeds with exactly {operationId, status, scope}; the key is trimmed and lowercased; every statement is the verified caller\'s', async () => {
  const h = harness();
  const body = clearBody(h);
  const from = h.db.queryLog.length;
  const response = await send(h, body, {
    key: `  ${body.operationId.toUpperCase()} `,
    url: `${ROUTE}?profileId=${h.identities.bob.id}`,
    headers: { 'x-halo-home-context': crypto.randomUUID() },
  });
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.deepEqual(answer, { operationId: body.operationId, status: 'succeeded', scope: 'journal' }, 'no data key, no unresolvedOperations');

  const panel = privacyPanel();
  panel.accept(answer, 'journal', body.operationId);
  assert.deepEqual([panel.message, panel.unknown], [MESSAGES.journal, null]);

  const alice = h.identities.alice.id;
  assert.deepEqual(calls(h, 'clear_household_records').map((call) => call.args.p_profile_id), [alice]);
  assert.deepEqual(calls(h, 'privacy_fingerprint').map((call) => call.args), [{ p_profile_id: alice, p_tables: ['symptom_logs'] }]);
  const [row] = ledger(h);
  assert.deepEqual([row.profile_id, row.domain, row.kind, row.status], [alice, 'privacy', 'privacy.clear.journal', 'succeeded']);
  assert.deepEqual(row.result, { operationId: body.operationId, status: 'succeeded', scope: 'journal' });
  assert.ok(!JSON.stringify(row).includes(body.reviewToken), 'the token is hashed into request_hash, never stored');
  // The ledger's settle by its own claimed id aside, every statement names the caller.
  auditOwnerScope(h.db.queryLog.slice(from).filter((q) => !(q.table === 'operations' && q.operation === 'update')), alice, 'clear');
  assert.deepEqual(h.db.rows('symptom_logs').map((log) => log.profile_id), [h.identities.bob.id], 'bob\'s journal is untouched');
  assert.deepEqual(h.blockedFetches, [], 'zero fetch calls');
});

const without = (body, key) => Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));

const BAD_BODIES = [
  ['confirm: DELETE (trap P-5)', (b) => ({ ...b, confirm: 'DELETE' }), 'confirm'],
  ['groups', (b) => ({ ...b, groups: [] }), 'groups'],
  ['no operationId', (b) => without(b, 'operationId'), 'operationId'],
  ['operationId not a UUID', (b) => ({ ...b, operationId: 'op-1' }), 'operationId'],
  ['scope export', (b) => ({ ...b, scope: 'export' }), 'scope'],
  ['scope ALL', (b) => ({ ...b, scope: 'ALL' }), 'scope'],
  ['no scope', (b) => without(b, 'scope'), 'scope'],
  ['no reviewToken', (b) => without(b, 'reviewToken'), 'reviewToken'],
  ['reviewToken a number', (b) => ({ ...b, reviewToken: 7 }), 'reviewToken'],
  ['reviewToken not a token', (b) => ({ ...b, reviewToken: 'abc.def' }), 'reviewToken'],
];

for (const [label, change, field] of BAD_BODIES) {
  test(`400 before anything is read: ${label}`, async () => {
    const h = harness();
    const body = change(clearBody(h));
    const response = await send(h, body, { key: body.operationId ?? crypto.randomUUID() });
    const envelope = await expectEnvelope(response, { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(envelope.field_errors[0].field, field);
    assert.deepEqual([ledger(h), h.db.rpcCalls], [[], []], 'nothing recorded, nothing called');
  });
}

test('400: an Idempotency-Key missing, not a UUID, or another id; any If-Match; a token for the other scope', async () => {
  const h = harness();
  const body = clearBody(h);
  const cases = [
    [{ key: null }, 'Idempotency-Key'],
    [{ key: 'not-a-uuid' }, 'Idempotency-Key'],
    [{ key: crypto.randomUUID() }, 'operationId'],
    [{ headers: { 'if-match': '3' } }, 'If-Match'],
  ];
  for (const [options, field] of cases) {
    const envelope = await expectEnvelope(await send(h, body, options), { status: 400, code: 'validation_failed' });
    assert.equal(envelope.field_errors[0].field, field);
  }
  const allToken = { ...body, reviewToken: review(h, { scope: 'all' }) };
  const envelope = await expectEnvelope(await send(h, allToken), { status: 400, code: 'validation_failed' });
  assert.deepEqual([envelope.field_errors[0].field, envelope.field_errors[0].code], ['scope', 'scope_mismatch']);
  assert.deepEqual([ledger(h), h.db.rpcCalls], [[], []]);
});

test('400 for a body that is not a JSON object; 413 over 4,096 bytes; nothing recorded', async () => {
  const h = harness();
  const operationId = crypto.randomUUID();
  await expectEnvelope(await send(h, null, { raw: '[1]', key: operationId }), { status: 400, code: 'bad_request' });
  await expectEnvelope(await send(h, null, { raw: '{"scope":', key: operationId }), { status: 400, code: 'bad_request' });
  const big = { ...clearBody(h), operationId, reviewToken: 'x'.repeat(4100) };
  await expectEnvelope(await send(h, big), { status: 413, code: 'payload_too_large' });
  assert.deepEqual([ledger(h), h.db.rpcCalls], [[], []]);
});

for (const [label, options, called] of [
  // Without a key nothing is asked of the database at all.
  ['no review key', { env: {} }, []],
  ['a 31-character key', { env: { HALO_PRIVACY_REVIEW_KEY: 'k'.repeat(31) } }, []],
  ['an all-space key', { env: { HALO_PRIVACY_REVIEW_KEY: ' '.repeat(40) } }, []],
  // Without 0024 only the probe is.
  ['0024 not applied (the probe is PGRST202)', { version: null }, ['privacy_schema_version']],
  ['another 0024 version', { version: 2 }, ['privacy_schema_version']],
]) {
  test(`503 feature_unavailable, not retryable, with nothing recorded: ${label}`, async () => {
    const h = harness(options);
    await expectEnvelope(await send(h, clearBody(h)), { status: 503, code: 'feature_unavailable', retryable: false });
    assert.deepEqual(ledger(h), []);
    assert.deepEqual(h.db.rpcCalls.map((call) => call.name), called);
  });
}

/**
 * An unverified token with a recorded row (P15): the token no longer verifies
 * (a journal entry since review), and a settled row for this id exists. The
 * route must answer from the ledger and never claim. `purgeAfter` deletes the
 * row right after the route's Nth statement on operations: 1 is after the
 * request_hash read, 2 after readOperation's fetch, which is the moment a
 * claim would otherwise have followed.
 */
function recordedWorld({ hash } = {}) {
  const h = harness();
  const body = clearBody(h);
  h.db.seed('symptom_logs', [{ id: crypto.randomUUID(), profile_id: h.identities.alice.id, entry_date: '2026-10-02', symptoms: ['sneeze'] }]);
  h.db.seed('operations', [{
    operation_id: body.operationId, profile_id: h.identities.alice.id, domain: 'privacy', kind: 'privacy.clear.journal', status: 'succeeded',
    request_hash: hash ?? requestHash({ reviewToken: body.reviewToken, scope: 'journal' }),
    result: { operationId: body.operationId, status: 'succeeded', scope: 'journal' },
  }]);
  return { h, body };
}

for (const [purgeAfter, expected] of [[1, 'review_changed'], [2, 'succeeded']]) {
  test(`an unverified token never claims: the recorded row purged after the route's statement ${purgeAfter} on the ledger answers ${expected} and no row is written`, async () => {
    const { h, body } = recordedWorld();
    const fakeFrom = h.db.from;
    let seen = 0;
    h.db.from = (name) => {
      const builder = fakeFrom(name);
      if (name !== 'operations') return builder;
      const then = builder.then.bind(builder);
      builder.then = (ok, fail) => then(async (result) => {
        seen += 1;
        if (seen === purgeAfter) await fakeFrom('operations').delete().eq('operation_id', body.operationId);
        return result;
      }).then(ok, fail);
      return builder;
    };
    const from = h.db.queryLog.length;
    const response = await send(h, body);
    const panel = privacyPanel();
    if (expected === 'review_changed') {
      const envelope = await expectEnvelope(response.clone(), { status: 409, code: 'conflict', extraKeys: ['reason'] });
      assert.equal(envelope.reason, 'review_changed');
      await panel.answer(response, 'journal', body.operationId);
      assert.deepEqual([panel.message, panel.unknown], [MESSAGES.conflict, null]);
    } else {
      assert.deepEqual(await response.clone().json(), { operationId: body.operationId, status: 'succeeded', scope: 'journal' }, 'the outcome as it was read');
      await panel.answer(response, 'journal', body.operationId);
      assert.deepEqual([panel.message, panel.unknown], [MESSAGES.journal, null]);
    }
    assert.ok(seen >= purgeAfter, 'the purge ran');
    assert.deepEqual(ledger(h), [], 'no ledger row was written for the unverified request');
    assert.deepEqual(h.db.queryLog.slice(from).filter((q) => q.table === 'operations' && q.operation !== 'select' && q.operation !== 'delete'), [], 'no claim, no settle');
    assert.deepEqual(calls(h, 'clear_household_records'), [], 'the clear function was never called');
    assert.equal(h.db.rows('symptom_logs').length, 3, 'nothing deleted');
  });
}

test('an unverified token for a recorded row of another request is 409 operation_mismatch, read before anything is reaped or claimed', async () => {
  const { h, body } = recordedWorld({ hash: 'f'.repeat(64) });
  const before = structuredClone(ledger(h));
  const from = h.db.queryLog.length;
  const envelope = await expectEnvelope(await send(h, body), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'operation_mismatch');
  assert.deepEqual(ledger(h), before);
  assert.deepEqual(h.db.queryLog.slice(from).filter((q) => q.table === 'operations').map((q) => q.operation), ['select'], 'one read, nothing else');
  assert.deepEqual(calls(h, 'clear_household_records'), []);
});

/**
 * Task 6 review, finding 2: what the panel shows for each refusal. 401 asks
 * for the session, 400 asks to check the details, 413 (a status the runtime
 * does not map) is unavailable, and a 503 on a mutation is unknown_outcome,
 * which locks the panel. Its reconcile then finds no row (nothing was
 * claimed), so the panel says the service is unavailable and stays locked
 * until a reload (P11 accepts this: privacy.status reports the 503 first).
 */
test('the panel after a refusal: 401, 400, 413 and 503, and the 503\'s reconcile', async () => {
  const cases = [
    ['401', harness(), { as: null }, RUNTIME_MESSAGES.session, false],
    ['400', harness(), { headers: { 'if-match': '1' } }, RUNTIME_MESSAGES.validation, false],
    ['413', harness(), { big: true }, RUNTIME_MESSAGES.unavailable, false],
    ['503', harness({ env: {} }), {}, RUNTIME_MESSAGES.unknown_outcome, true],
  ];
  for (const [label, h, { big, ...options }, message, locked] of cases) {
    const body = clearBody(h);
    if (big) body.reviewToken = `${body.reviewToken}${'x'.repeat(4100)}`;
    const response = await send(h, body, options);
    assert.equal(String(response.status), label);
    const panel = privacyPanel();
    panel.review = { scope: 'journal' };
    await panel.answer(response, 'journal', body.operationId);
    assert.equal(panel.message, message, `${label}: the message`);
    assert.deepEqual(panel.unknown, locked ? { id: body.operationId, scope: 'journal' } : null, `${label}: the lock`);
    assert.deepEqual(panel.review, { scope: 'journal' }, `${label}: the review stays open`);
    assert.deepEqual(ledger(h), [], `${label}: nothing recorded`);
    if (locked) {
      await panel.reconcile((id) => h.call('/api/operations', 'GET', { as: 'alice', url: `/api/operations?operationId=${id}&domain=privacy` }));
      assert.deepEqual([panel.message, panel.unknown], [RUNTIME_MESSAGES.unavailable, { id: body.operationId, scope: 'journal' }], 'reconcile is a 404: unavailable, still locked');
    }
  }
});

test('503 when the ledger table is missing (0017): the claim fails and nothing is cleared', async () => {
  const tables = Object.fromEntries(Object.entries(HALO_TABLES).filter(([name]) => name !== 'operations'));
  const h = harness({ tables });
  await expectEnvelope(await send(h, clearBody(h)), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.deepEqual(calls(h, 'clear_household_records'), []);
  assert.equal(h.db.rows('symptom_logs').length, 2);
});

test('409 review_changed with nothing recorded: an expired token, a tampered one, one minted before a new journal entry', async () => {
  const h = harness();
  const expired = { ...clearBody(h), reviewToken: review(h, { now: Date.now() - REVIEW_TOKEN_TTL_MS - 1000 }) };
  const good = review(h);
  const [payload, mac] = good.split('.');
  const tampered = { ...clearBody(h), reviewToken: `${payload}.${mac.slice(0, -2)}${mac.endsWith('AA') ? 'BB' : 'AA'}` };
  const stale = clearBody(h);
  h.db.seed('symptom_logs', [{ id: crypto.randomUUID(), profile_id: h.identities.alice.id, entry_date: '2026-10-02', symptoms: ['sneeze'] }]);
  for (const body of [expired, tampered, stale]) {
    const response = await send(h, body);
    const envelope = await expectEnvelope(response.clone(), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
    assert.equal(envelope.reason, 'review_changed');
    const panel = privacyPanel();
    await panel.answer(response, 'journal', body.operationId);
    assert.deepEqual([panel.message, panel.unknown], [MESSAGES.conflict, null], 'the client keeps its review and shows the conflict message');
  }
  assert.deepEqual(ledger(h), []);
  assert.deepEqual(calls(h, 'clear_household_records'), []);
});

test('a refusal the route does not settle (HALO_INVALID_INPUT) and a database failure are 500s whose logs carry no token, fingerprint or row', async (t) => {
  const logged = muteConsoleError(t);
  let fail = 'refusal';
  const h = harness({
    clear: async () => {
      if (fail === 'refusal') throw rpcError('P0001', 'HALO_INVALID_INPUT');
      throw rpcError('XX000', 'boom', `Failing row contains (${NOTE}).`, 'a hint');
    },
  });
  const first = clearBody(h);
  await expectEnvelope(await send(h, first), { status: 500, code: 'internal_error' });
  fail = 'database';
  const second = clearBody(h);
  await expectEnvelope(await send(h, second), { status: 500, code: 'internal_error' });
  assert.deepEqual(ledger(h).map((row) => [row.status, row.result]), [['failed', null], ['failed', null]], 'runOperation settles an in-process throw as failed with no receipt');
  const text = loggedText(logged);
  assert.match(text, /privacy clear failed .*P0001 HALO_INVALID_INPUT/);
  for (const secret of [first.reviewToken, second.reviewToken, NOTE, 'a hint', fakeFingerprint(h.db, h.identities.alice.id, ['symptom_logs'])]) {
    assert.ok(!text.includes(secret), 'no token, fingerprint, detail or hint in any log line');
  }
});

test('the function\'s busy and review_changed refusals settle failed with the reason and answer 200', async () => {
  for (const [code, reason] of [['HALO_BUSY', 'busy'], ['HALO_REVIEW_CHANGED', 'review_changed']]) {
    const h = harness({ clear: async () => { throw rpcError('P0001', code); } });
    const body = clearBody(h);
    const answer = await (await send(h, body)).json();
    assert.deepEqual(answer, { operationId: body.operationId, status: 'failed', reason });
    assert.deepEqual(ledger(h)[0].result, { operationId: body.operationId, status: 'failed', reason });
    const panel = privacyPanel();
    panel.accept(answer, 'journal', body.operationId);
    assert.equal(panel.message, MESSAGES.unchanged);
    assert.equal(h.db.rows('symptom_logs').length, 2, 'nothing deleted');
  }
});

test('another household\'s operation id is 409 operation_mismatch and leaves its ledger row as it was', async () => {
  const h = harness();
  const theirs = clearBody(h);
  // Bob's clear, with his own review.
  const bobBody = { ...theirs, reviewToken: review(h, { who: 'bob' }) };
  assert.equal((await send(h, bobBody, { as: 'bob' })).status, 200);
  const before = structuredClone(ledger(h));
  const mine = { ...clearBody(h), operationId: theirs.operationId };
  const envelope = await expectEnvelope(await send(h, mine), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'operation_mismatch');
  assert.deepEqual(ledger(h), before);
  assert.deepEqual(h.db.rows('symptom_logs').map((log) => log.profile_id), [h.identities.alice.id], 'alice\'s journal untouched by the refused call');
});

test('no U+2014 in the route\'s source or in any body this file received', () => {
  assert.ok(!readFileSync(ROUTE_FILE, 'utf8').includes(EM_DASH));
  assert.ok(bodies.length > 20, 'the check is not vacuous');
  for (const text of bodies) assert.ok(!text.includes(EM_DASH));
});
