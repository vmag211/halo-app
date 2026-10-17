/**
 * The operation ledger (lib/operations.js, migration 0017).
 *
 * The frontend treats a lost response as "unknown" and asks later what
 * happened, so these tests are about one promise: the effect runs at most once,
 * and whatever a later caller is told is the truth rather than a guess.
 *
 * The claim is an atomic "insert if absent" (ON CONFLICT DO NOTHING RETURNING).
 * The in-memory fake implements that, and the last test in this file proves the
 * fake agrees with real Postgres on PGlite, so the fast tests above it are not
 * resting on a convenient fiction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { createDb } from './db/pgliteHarness.mjs';

const {
  runOperation,
  readOperation,
  requestHash,
  isOperationsUnavailable,
  operationsUnavailable,
  OPERATION_INPUT_MISMATCH,
  OPERATION_DOMAINS,
  DEFAULT_STALE_AFTER_MS,
} = await import('../lib/operations.js');

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';

/** A client with the ledger and the profiles it points at. */
function ledger() {
  return createFakeSupabase({
    tables: haloTables('profiles', 'operations'),
    seed: { profiles: [{ id: ALICE }, { id: BOB }] },
  });
}

const receipt = (extra = {}) => ({ status: 'succeeded', applied: ['a'], ...extra });

// ---------------------------------------------------------------------------
// Running once
// ---------------------------------------------------------------------------

test('the first call runs the effect and stores its receipt under the operation id', async () => {
  const db = ledger();
  let runs = 0;
  const outcome = await runOperation(
    db,
    { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: { id: 'x' } },
    async () => { runs += 1; return receipt(); },
  );
  assert.equal(runs, 1);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(outcome.result, { status: 'succeeded', applied: ['a'], operationId: OP });

  const [row] = db.rows('operations');
  assert.equal(row.status, 'succeeded');
  assert.equal(row.profile_id, ALICE);
  assert.equal(row.domain, 'actions');
  assert.equal(row.request_hash, requestHash({ id: 'x' }));
});

test('a repeat of the same operation replays the stored receipt and never runs the effect twice', async () => {
  const db = ledger();
  let runs = 0;
  const call = () =>
    runOperation(
      db,
      { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: { id: 'x' } },
      async () => { runs += 1; return receipt(); },
    );
  const first = await call();
  const second = await call();
  assert.equal(runs, 1, 'the effect ran once');
  assert.equal(second.replayed, true);
  assert.equal(second.status, 'succeeded');
  assert.deepEqual(second.result, first.result, 'the replay is the original receipt, not a new one');
  assert.equal(db.rows('operations').length, 1);
});

test('the receipt always carries the operation id the caller sent, even if the effect omits it', async () => {
  const db = ledger();
  const outcome = await runOperation(
    db,
    { operationId: OP, profileId: ALICE, domain: 'settings', kind: 'settings.save', input: {} },
    async () => ({ status: 'succeeded', snapshot: { revision: 2 } }),
  );
  assert.equal(outcome.result.operationId, OP, 'the frontend rejects a receipt whose operationId does not match');
});

// ---------------------------------------------------------------------------
// Failure is recorded, not swallowed
// ---------------------------------------------------------------------------

test('an effect that throws is recorded as failed and the error still reaches the route', async () => {
  const db = ledger();
  await assert.rejects(
    runOperation(
      db,
      { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: {} },
      async () => { throw new Error('the write blew up'); },
    ),
    /the write blew up/,
  );
  assert.equal(db.rows('operations')[0].status, 'failed');
});

test('a failed operation replays as failed, and the effect is not retried behind the caller\'s back', async () => {
  const db = ledger();
  let runs = 0;
  const call = () =>
    runOperation(
      db,
      { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: {} },
      async () => { runs += 1; throw new Error('nope'); },
    );
  await assert.rejects(call());
  const second = await call();
  assert.equal(runs, 1, 'a failed operation is a settled outcome, not an invitation to retry');
  assert.equal(second.status, 'failed');
  assert.equal(second.replayed, true);
});

// ---------------------------------------------------------------------------
// Concurrency and crashes
// ---------------------------------------------------------------------------

test('two concurrent calls with one id run the effect once; the loser is told pending, not success', async () => {
  const db = ledger();
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // The gate is bounded: if a regression lets the second caller run the effect
  // too, this test fails on the run count in under a second instead of
  // deadlocking on a gate that only the first caller's path ever releases.
  const held = () => Promise.race([gate, new Promise((resolve) => setTimeout(resolve, 500))]);
  const call = () =>
    runOperation(
      db,
      { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: {} },
      async () => { runs += 1; await held(); return receipt(); },
    );
  const first = call();
  const second = await call(); // claims nothing: the first already holds the id
  assert.equal(second.replayed, true);
  assert.equal(second.status, 'pending', 'still running, so not yet an outcome');
  assert.equal(second.result, null, 'a pending operation has no receipt to act on');
  release();
  assert.equal((await first).status, 'succeeded');
  assert.equal(runs, 1);
});

test('a pending row older than the window reports unknown, so a dead process never looks alive', async () => {
  // A crash leaves the claim behind with no outcome, seeded here as the stale row.
  const db = createFakeSupabase({
    tables: haloTables('profiles', 'operations'),
    seed: {
      profiles: [{ id: ALICE }, { id: BOB }],
      operations: [{
        operation_id: OP,
        profile_id: ALICE,
        domain: 'actions',
        kind: 'actions.commit',
        status: 'pending',
        request_hash: requestHash({}),
        result: null,
        created_at: new Date(Date.now() - DEFAULT_STALE_AFTER_MS - 1000).toISOString(),
      }],
    },
  });
  const outcome = await runOperation(
    db,
    { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: {} },
    async () => { throw new Error('must not run'); },
  );
  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.result, null);
  const read = await readOperation(db, { operationId: OP, profileId: ALICE, domain: 'actions' });
  assert.equal(read.status, 'unknown', 'and a reader is told the same thing');
});

// ---------------------------------------------------------------------------
// Misuse of an id
// ---------------------------------------------------------------------------

test('reusing an operation id with different input is refused instead of replaying the wrong outcome', async () => {
  const db = ledger();
  await runOperation(
    db,
    { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: { id: 'first' } },
    async () => receipt(),
  );
  await assert.rejects(
    runOperation(
      db,
      { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: { id: 'second' } },
      async () => receipt(),
    ),
    new RegExp(OPERATION_INPUT_MISMATCH),
  );
});

test('input order does not change the fingerprint, so a reordered body is still a replay', async () => {
  assert.equal(requestHash({ a: 1, b: { c: 2, d: 3 } }), requestHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
  assert.notEqual(requestHash([1, 2]), requestHash([2, 1]), 'array order is meaningful');
});

test('another household cannot claim, replay or read an operation id that is not theirs', async () => {
  const db = ledger();
  await runOperation(
    db,
    { operationId: OP, profileId: ALICE, domain: 'actions', kind: 'actions.commit', input: {} },
    async () => receipt(),
  );
  await assert.rejects(
    runOperation(
      db,
      { operationId: OP, profileId: BOB, domain: 'actions', kind: 'actions.commit', input: {} },
      async () => receipt(),
    ),
    new RegExp(OPERATION_INPUT_MISMATCH),
    'bob is refused without being told whose id it is',
  );
  assert.equal(await readOperation(db, { operationId: OP, profileId: BOB, domain: 'actions' }), null);
  assert.equal(db.rows('operations').length, 1, 'and nothing of bob\'s was written');
});

test('an operation is scoped to its domain, so the same id in another domain is not found', async () => {
  const db = ledger();
  await runOperation(
    db,
    { operationId: OP, profileId: ALICE, domain: 'settings', kind: 'settings.save', input: {} },
    async () => receipt(),
  );
  assert.equal(await readOperation(db, { operationId: OP, profileId: ALICE, domain: 'alerts' }), null);
});

// ---------------------------------------------------------------------------
// Reading an outcome back
// ---------------------------------------------------------------------------

test('reading an operation that was never recorded is null, not a fabricated status', async () => {
  const db = ledger();
  assert.equal(await readOperation(db, { operationId: OP, profileId: ALICE, domain: 'actions' }), null);
});

test('reading a settled operation returns its stored receipt verbatim', async () => {
  const db = ledger();
  await runOperation(
    db,
    { operationId: OP, profileId: ALICE, domain: 'alerts', kind: 'alerts.update', input: {} },
    async () => ({ status: 'succeeded', items: [{ id: 'a', revision: 2 }], unresolvedOperations: [] }),
  );
  const read = await readOperation(db, { operationId: OP, profileId: ALICE, domain: 'alerts' });
  assert.equal(read.status, 'succeeded');
  assert.deepEqual(read.result, {
    status: 'succeeded',
    items: [{ id: 'a', revision: 2 }],
    unresolvedOperations: [],
    operationId: OP,
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test('only the recovery domain may record an operation with no owner', async () => {
  const db = ledger();
  await assert.rejects(
    runOperation(db, { operationId: OP, domain: 'actions', kind: 'actions.commit', input: {} }, async () => receipt()),
    /requires an owner/,
  );
  const outcome = await runOperation(
    db,
    { operationId: OP, domain: 'recovery', kind: 'recovery.request', input: {} },
    async () => ({ status: 'pending' }),
  );
  assert.equal(outcome.replayed, false);
  assert.equal(db.rows('operations')[0].profile_id, null);
});

test('an unknown domain is a programming error, caught before anything is written', async () => {
  const db = ledger();
  await assert.rejects(
    runOperation(db, { operationId: OP, profileId: ALICE, domain: 'nope', kind: 'x', input: {} }, async () => receipt()),
    /unknown domain/,
  );
  assert.equal(db.rows('operations').length, 0);
});

test('the declared domains are the ones the frontend reconciles against', () => {
  for (const domain of ['actions', 'alerts', 'settings', 'privacy', 'account', 'summary', 'attachments', 'workspace', 'week-updates', 'source-operations', 'recovery']) {
    assert.ok(OPERATION_DOMAINS.includes(domain), `${domain} is used by a frontend service but is not declared`);
  }
});

test('before migration 0017 the ledger reports an unavailable feature, not a false success', async () => {
  assert.equal(isOperationsUnavailable({ code: 'PGRST205' }), true, 'PostgREST: table not found');
  assert.equal(isOperationsUnavailable({ code: '42P01' }), true, 'Postgres: undefined table');
  assert.equal(isOperationsUnavailable({ code: '23505' }), false, 'a duplicate key is not a missing table');
  assert.equal(isOperationsUnavailable(null), false);
  const response = operationsUnavailable('req-1');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal(body.retryable, false, 'retrying cannot apply a migration');
});

// ---------------------------------------------------------------------------
// The fake against real Postgres
// ---------------------------------------------------------------------------

/**
 * These use the 'recovery' domain so no row needs an owner: service_role holds
 * no privileges on auth.users, so seeding a profile here is not possible and is
 * not what these tests are about. A constraint violation aborts the surrounding
 * transaction, so each attempt runs inside its own savepoint.
 */
async function attempt(tx, sql, values = []) {
  await tx.exec('savepoint probe');
  try {
    await tx.query(sql, values);
    await tx.exec('release savepoint probe');
    return 'allowed';
  } catch (error) {
    await tx.exec('rollback to savepoint probe');
    return String(error.message || error);
  }
}

test('real Postgres agrees with the fake: the claim is atomic, so exactly one of two inserts wins', async () => {
  const db = await createDb();
  try {
    await db.pg.transaction(async (tx) => {
      const claim = `insert into public.operations (operation_id, domain, kind, status, request_hash)
                     values ($1, 'recovery', 'recovery.request', 'pending', $2)
                     on conflict (operation_id) do nothing
                     returning operation_id`;
      const first = await tx.query(claim, [OP, 'hash-a']);
      const second = await tx.query(claim, [OP, 'hash-a']);
      assert.equal(first.rows.length, 1, 'the first caller claims the id');
      assert.equal(second.rows.length, 0, 'the second gets nothing back, exactly as the fake reports');

      const { rows } = await tx.query(`select count(*)::int as n from public.operations where operation_id = $1`, [OP]);
      assert.equal(rows[0].n, 1, 'and only one row exists');
    });
  } finally {
    await db.close();
  }
});

test('real Postgres enforces the table rules the ledger relies on', async () => {
  const db = await createDb();
  try {
    await db.pg.transaction(async (tx) => {
      const unowned = await attempt(
        tx,
        `insert into public.operations (operation_id, domain, kind) values ($1, 'actions', 'actions.commit')`,
        [OP],
      );
      assert.match(unowned, /operations_owner_check/, 'an unowned operation outside recovery is refused by the database itself');

      const recovery = await attempt(
        tx,
        `insert into public.operations (operation_id, domain, kind) values ($1, 'recovery', 'recovery.request')`,
        [OP],
      );
      assert.equal(recovery, 'allowed', 'recovery is the one domain allowed no owner');

      const noReceipt = await attempt(
        tx,
        `insert into public.operations (operation_id, domain, kind, status)
         values ($1, 'recovery', 'recovery.request', 'succeeded')`,
        ['44444444-4444-4444-8444-444444444444'],
      );
      assert.match(noReceipt, /operations_result_check/, 'a succeeded row must carry the receipt that will be replayed');

      const badStatus = await attempt(
        tx,
        `insert into public.operations (operation_id, domain, kind, status)
         values ($1, 'recovery', 'recovery.request', 'finished')`,
        ['55555555-5555-4555-8555-555555555555'],
      );
      assert.match(badStatus, /operations_status_check/, 'only the four declared statuses are storable');
    });
  } finally {
    await db.close();
  }
});
