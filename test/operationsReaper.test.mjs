/**
 * The operation reaper (lib/operations.js, listUnresolvedOperations).
 *
 * `unresolvedOperations` is a lock on the frontend: a non-empty list disables
 * the whole surface until every id in it settles. Only an in-process throw ever
 * settled a row as failed, so a serverless timeout or a killed instance left
 * its claim pending for good, and the surface it belonged to stayed read-only
 * forever (docs/backend/STATE.md, "Known live risks").
 *
 * The fix is a lazy reap: immediately before listing, the ledger settles this
 * owner's stale pending rows in the listed domains as `failed`. These tests pin
 * what that may and may not touch:
 *
 *   - only rows past the same window `effectiveStatus` already uses to report
 *     'unknown', so nothing a reader would still call 'pending' is reaped;
 *   - only rows still stored as 'pending' at the moment of the write, so an
 *     operation that settles concurrently is never overwritten;
 *   - only this owner's rows in the listed domains;
 *   - `failed`, never `cancelled`, because `validSummaryReceipt` rejects
 *     `cancelled` and a cancelled summary could never be cleared by the client.
 *
 * The filter that decides what is listed (stored `status = 'pending'`) is
 * deliberately unchanged (Ruling S1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';

const {
  runOperation,
  readOperation,
  listUnresolvedOperations,
  requestHash,
  isOperationsUnavailable,
  DEFAULT_STALE_AFTER_MS,
  ABANDONED_REASON,
} = await import('../lib/operations.js');

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const STALE = '33333333-3333-4333-8333-333333333331';
const FRESH = '33333333-3333-4333-8333-333333333332';
const SETTLED = '33333333-3333-4333-8333-333333333333';
const BOBS = '33333333-3333-4333-8333-333333333334';
const ELSEWHERE = '33333333-3333-4333-8333-333333333335';

const ago = (ms) => new Date(Date.now() - ms).toISOString();
/** Just past the window: a reader is already told 'unknown' for this row. */
const staleAt = () => ago(DEFAULT_STALE_AFTER_MS + 1000);
/** Well inside the window: a reader is still told 'pending'. */
const freshAt = () => ago(DEFAULT_STALE_AFTER_MS - 5000);
const LONG_AGO = '2026-01-01T00:00:00.000Z';

/** A claimed row with no outcome, as a crashed process leaves it. */
const pending = (operationId, overrides = {}) => ({
  operation_id: operationId,
  profile_id: ALICE,
  domain: 'account',
  kind: 'account.request-recovery',
  status: 'pending',
  request_hash: requestHash({}),
  result: null,
  created_at: staleAt(),
  updated_at: LONG_AGO,
  ...overrides,
});

function ledger(operations = []) {
  return createFakeSupabase({
    tables: haloTables('profiles', 'operations'),
    seed: { profiles: [{ id: ALICE }, { id: BOB }], operations },
  });
}

const row = (db, operationId) => db.rows('operations').find((item) => item.operation_id === operationId);
const list = (db, profileId = ALICE, domains = ['account']) => listUnresolvedOperations(db, { profileId, domains });

/**
 * A client whose reap statement waits for `beforeReap()` before it runs, so a
 * test can settle the row in the gap between the reaper deciding to act and
 * its write landing. Recognises the reap by its payload (`status: 'failed'`
 * with the abandoned reason), not by call order.
 */
function interleaved(db, beforeReap) {
  return {
    ...db,
    from(name) {
      const builder = db.from(name);
      if (name !== 'operations') return builder;
      const update = builder.update.bind(builder);
      builder.update = (values, options) => {
        const query = update(values, options);
        if (values?.status !== 'failed' || values?.result?.reason !== ABANDONED_REASON) return query;
        const run = query.then.bind(query);
        query.then = (onFulfilled, onRejected) => beforeReap().then(() => run(onFulfilled, onRejected));
        return query;
      };
      return builder;
    },
  };
}

// ---------------------------------------------------------------------------
// What is reaped
// ---------------------------------------------------------------------------

test('a stale pending row is reaped to failed and no longer locks the surface', async () => {
  const db = ledger([pending(STALE)]);
  assert.equal(
    (await readOperation(db, { operationId: STALE, profileId: ALICE, domain: 'account' })).status,
    'unknown',
    'before the reap a reader is told unknown, which is the window the reaper uses',
  );

  assert.deepEqual(await list(db), [], 'the abandoned id is gone from the inventory, so the lock lifts');

  const reaped = row(db, STALE);
  assert.equal(reaped.status, 'failed', 'failed, never cancelled: validSummaryReceipt rejects cancelled');
  assert.notEqual(reaped.updated_at, LONG_AGO, 'the settle is stamped');
  assert.deepEqual(
    reaped.result,
    { status: 'failed', reason: ABANDONED_REASON },
    'a receipt with a machine reason and nothing else: no input, no hash, no record content',
  );
  assert.equal(reaped.request_hash, requestHash({}), 'the fingerprint is kept, so a replay is still recognised');
  assert.equal(reaped.kind, 'account.request-recovery');

  const read = await readOperation(db, { operationId: STALE, profileId: ALICE, domain: 'account' });
  assert.equal(read.status, 'failed', 'and a reconcile now reads a settled outcome the client can clear');
  assert.deepEqual(
    read.result,
    { operationId: STALE, status: 'failed', reason: ABANDONED_REASON },
    'the receipt read back carries its own id, which the client requires to match',
  );
});

test('the reason is a machine code, not copy, so each client keeps its own failure message', () => {
  assert.equal(typeof ABANDONED_REASON, 'string');
  assert.match(ABANDONED_REASON, /^[a-z_]+$/, 'lowercase letters and underscores only, so no punctuation can reach a person');
});

test('a fresh pending row is untouched: work still inside its window is never slandered as dead', async () => {
  const db = ledger([pending(FRESH, { created_at: freshAt() })]);
  assert.deepEqual(await list(db), [FRESH], 'still unresolved, and listed as such');
  const untouched = row(db, FRESH);
  assert.equal(untouched.status, 'pending');
  assert.equal(untouched.result, null);
  assert.equal(untouched.updated_at, LONG_AGO, 'not even restamped');
  assert.equal(
    (await readOperation(db, { operationId: FRESH, profileId: ALICE, domain: 'account' })).status,
    'pending',
    'a reader agrees it is still pending',
  );
});

test('a caller with a longer window reaps by that window, the same one it reports with', async () => {
  const db = ledger([pending(STALE, { created_at: ago(3 * 60_000) })]);
  const longWork = 10 * 60_000;
  assert.deepEqual(
    await listUnresolvedOperations(db, { profileId: ALICE, domains: ['account'], staleAfterMs: longWork }),
    [STALE],
  );
  assert.equal(row(db, STALE).status, 'pending', 'three minutes into ten is still live work');
  assert.equal(
    (await readOperation(db, { operationId: STALE, profileId: ALICE, domain: 'account', staleAfterMs: longWork })).status,
    'pending',
  );
});

test('an already settled row is untouched, whatever its age', async () => {
  const settled = [
    { status: 'succeeded', result: { operationId: SETTLED, status: 'succeeded', snapshot: { revision: 3 } } },
    { status: 'failed', result: null },
    { status: 'failed', result: { operationId: SETTLED, status: 'failed', message: 'Refused.' } },
    { status: 'cancelled', result: { operationId: SETTLED, status: 'cancelled' } },
  ];
  for (const outcome of settled) {
    const db = ledger([pending(SETTLED, { ...outcome, created_at: LONG_AGO })]);
    assert.deepEqual(await list(db), []);
    const kept = row(db, SETTLED);
    assert.equal(kept.status, outcome.status, `${outcome.status} is not re-settled`);
    assert.deepEqual(kept.result, outcome.result, `${outcome.status} keeps its own receipt`);
    assert.equal(kept.updated_at, LONG_AGO, `${outcome.status} is not even restamped`);
  }
});

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

test('a row that settles while the reaper is acting is not overwritten', async () => {
  const base = ledger([pending(STALE)]);
  const success = { operationId: STALE, status: 'succeeded', snapshot: { revision: 1 } };
  // The late process finishes in the gap between the reap being issued and its
  // write landing. A conditional update re-checks `status = 'pending'` at write
  // time, so it finds nothing to do.
  const db = interleaved(base, async () => {
    const { error } = await base
      .from('operations')
      .update({ status: 'succeeded', result: success, updated_at: new Date().toISOString() })
      .eq('operation_id', STALE);
    assert.equal(error, null);
  });

  assert.deepEqual(await list(db), [], 'settled, so not unresolved');
  const kept = row(base, STALE);
  assert.equal(kept.status, 'succeeded', 'the real outcome stands');
  assert.deepEqual(kept.result, success, 'and so does its receipt');
});

test('two reapers racing are harmless: the row is settled once and neither errors', async () => {
  const db = ledger([pending(STALE)]);
  const [first, second] = await Promise.all([list(db), list(db)]);
  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.equal(row(db, STALE).status, 'failed');
  assert.equal(db.rows('operations').length, 1, 'nothing duplicated');

  // A later reaper finds nothing left to do and does not restamp the settle.
  const stamped = row(db, STALE).updated_at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await list(db), []);
  assert.equal(row(db, STALE).updated_at, stamped, 'a settled row is never re-settled');
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("one household's reap never touches another's rows", async () => {
  const db = ledger([pending(STALE), pending(BOBS, { profile_id: BOB })]);
  assert.deepEqual(await list(db, ALICE), []);
  assert.equal(row(db, STALE).status, 'failed');
  assert.equal(row(db, BOBS).status, 'pending', "bob's row is not alice's to settle");
  assert.equal(row(db, BOBS).updated_at, LONG_AGO);
  assert.deepEqual(await list(db, BOB), [], 'bob reaps his own when he reads');
  assert.equal(row(db, BOBS).status, 'failed');
});

test('a reap is limited to the domains being listed', async () => {
  const db = ledger([pending(STALE), pending(ELSEWHERE, { domain: 'settings', kind: 'settings.save' })]);
  assert.deepEqual(await list(db, ALICE, ['account']), []);
  assert.equal(row(db, ELSEWHERE).status, 'pending', 'a settings read decides about settings, not an account read');
});

test('every statement the reap issues is scoped to the verified owner', async () => {
  const db = ledger([pending(STALE)]);
  await list(db);
  const writes = db.queryLog.filter((entry) => entry.table === 'operations' && entry.operation === 'update');
  assert.equal(writes.length, 1, 'one conditional update, not a read followed by a write');
  const filters = writes[0].filters;
  const has = (column, op, value) =>
    filters.some((node) => node.type === 'cmp' && node.column === column && node.op === op
      && (value === undefined || JSON.stringify(node.value) === JSON.stringify(value)));
  assert.ok(has('profile_id', 'eq', ALICE), 'owner scoped');
  assert.ok(has('domain', 'in', ['account']), 'domain scoped');
  assert.ok(has('status', 'eq', 'pending'), 'guarded on still pending');
  assert.ok(has('created_at', 'lt'), 'guarded on stale');
});

test('listing still requires an owner, so there is no unscoped reap', async () => {
  const db = ledger([pending(STALE)]);
  await assert.rejects(listUnresolvedOperations(db, { profileId: null, domains: ['account'] }), /requires an owner/);
  assert.equal(row(db, STALE).status, 'pending');
  assert.equal(db.queryLog.length, 0, 'nothing was issued');
});

// ---------------------------------------------------------------------------
// Replays
// ---------------------------------------------------------------------------

test('a replay after the reap gets the failed receipt: no re-execution and no crash', async () => {
  const db = ledger([pending(STALE)]);
  await list(db);
  let runs = 0;
  const outcome = await runOperation(
    db,
    { operationId: STALE, profileId: ALICE, domain: 'account', kind: 'account.request-recovery', input: {} },
    async () => { runs += 1; return { status: 'succeeded' }; },
  );
  assert.equal(runs, 0, 'a settled operation is never run again behind the caller');
  assert.equal(outcome.replayed, true);
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(outcome.result, { operationId: STALE, status: 'failed', reason: ABANDONED_REASON });
  assert.equal(row(db, STALE).status, 'failed');
});

test('a replay with different input after the reap is still refused as a mismatch', async () => {
  const db = ledger([pending(STALE)]);
  await list(db);
  await assert.rejects(
    runOperation(
      db,
      { operationId: STALE, profileId: ALICE, domain: 'account', kind: 'account.request-recovery', input: { other: 1 } },
      async () => ({ status: 'succeeded' }),
    ),
    /OPERATION_INPUT_MISMATCH/,
  );
});

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

test('before migration 0017 the read reports the ledger unavailable, as it did before the reaper', async () => {
  const db = createFakeSupabase({ tables: haloTables('profiles'), seed: { profiles: [{ id: ALICE }] } });
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    await assert.rejects(list(db), (error) => {
      assert.equal(isOperationsUnavailable(error), true, 'the caller maps this to its 503');
      return true;
    });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [], 'an unapplied migration is a known state, not a reap failure to log on every read');
});

test('a reap that fails for another reason does not block the read: the row stays listed, honestly', async () => {
  const base = ledger([pending(STALE)]);
  const db = {
    ...base,
    from(name) {
      const builder = base.from(name);
      if (name !== 'operations') return builder;
      builder.update = () => ({
        eq() { return this; },
        in() { return this; },
        lt() { return this; },
        then: (onFulfilled) =>
          Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
            .then(onFulfilled),
      });
      return builder;
    },
  };
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    assert.deepEqual(await list(db), [STALE], 'still pending in storage, so still unresolved');
  } finally {
    console.error = original;
  }
  assert.equal(row(base, STALE).status, 'pending');
  assert.equal(logged.length, 1, 'the failure is logged for the operator');
  assert.match(logged[0], /57014|statement timeout/);
});
