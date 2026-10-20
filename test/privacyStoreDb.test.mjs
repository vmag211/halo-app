/**
 * lib/privacyStore.js against the real migration 0024 on PGlite (B07 Task 2
 * review, finding 6).
 *
 * test/privacyStore.test.mjs pins each wrapper to the plan's signatures with a
 * stubbed client. That cannot see a parameter-name mismatch with the real
 * functions, and such a mismatch would not fail loudly in production either:
 * PostgREST answers PGRST202 for "no function with these argument names",
 * which isPrivacyUnavailable reads as "0024 is not applied", so every privacy
 * route would quietly answer 503. Here every wrapper is called through a
 * client whose rpc calls the function by argument name, as PostgREST does
 * (`select public.f(p_a => $1, ...)`), so a renamed or missing parameter is a
 * 42883 error and fails the test.
 *
 *   1. Every wrapper succeeds against the real functions, and each 0024
 *      function is called by at least one wrapper.
 *   2. Refusals arrive as privacyRefusal reads them, never as "unavailable".
 *   3. The failure this file exists for, shown: a wrong argument name is
 *      42883, which isPrivacyUnavailable would take for "not applied".
 *   4. Without 0024, the probe says unavailable and the wrappers' errors read
 *      as unavailable.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './db/pgliteHarness.mjs';
import { FINGERPRINT_TABLES, fingerprintTables } from '../lib/privacyInventory.js';
import {
  clearHouseholdRecords,
  isPrivacyUnavailable,
  privacyCounts,
  privacyFingerprint,
  privacyRefusal,
  probePrivacySchema,
  purgeAllPrivacyReceipts,
  purgePrivacyReceipts,
} from '../lib/privacyStore.js';

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const CLEAR_OP = '00000000-0000-4000-8000-0000000c1ea4';
const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * A Supabase-shaped client over one PGlite transaction: rpc(name, args) calls
 * public.<name> with every argument by name and answers {data, error} as
 * supabase-js does (a scalar for a scalar function, the object for jsonb). A
 * failing call is rolled back to a savepoint, as one PostgREST request is its
 * own transaction.
 */
function rpcClient(tx) {
  const called = [];
  return {
    called,
    async rpc(name, args) {
      assert.match(name, IDENT);
      const entries = Object.entries(args ?? {});
      for (const [arg] of entries) assert.match(arg, IDENT);
      called.push(name);
      const sql = `select public.${name}(${entries.map(([arg], at) => `${arg} => $${at + 1}`).join(', ')}) as data`;
      await tx.exec('savepoint rpc');
      try {
        const { rows } = await tx.query(sql, entries.map(([, value]) => value));
        await tx.exec('release savepoint rpc');
        return { data: rows[0].data, error: null };
      } catch (error) {
        await tx.exec('rollback to savepoint rpc');
        return { data: null, error: { code: error.code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null } };
      }
    },
  };
}

let db;

/** Runs fn(client, tx) as the service role in one transaction, rolled back afterwards. */
function asService(fn, target = () => db) {
  return target().pg.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    const result = await fn(rpcClient(tx), tx);
    await tx.rollback();
    return result;
  });
}

async function seed(tx) {
  await tx.query(`update public.profiles set county = 'Cabarrus County', lat = 35.4, lng = -80.6 where id = $1`, [ALICE]);
  await tx.query(`insert into public.symptom_logs (profile_id, entry_date, symptoms, note) values ($1, '2026-10-01', '{cough}', 'A note')`, [ALICE]);
  await tx.query(`insert into public.alerts (profile_id, type, title, message, dedupe_key) values ($1, 'season_summary', 'Fall', 'You logged 1 day.', 'season_summary:fall:2026')`, [ALICE]);
  for (const owner of [ALICE, BOB]) {
    await tx.query(
      `insert into public.operations (operation_id, profile_id, domain, kind, status, result, created_at, updated_at)
       values ($1, $2, 'privacy', 'privacy.export', 'succeeded', '{"status":"succeeded"}', now() - interval '30 hours', now() - interval '30 hours')`,
      [crypto.randomUUID(), owner],
    );
  }
}

before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`);
});

after(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// 1. Every wrapper, against the real functions
// ---------------------------------------------------------------------------

test('every privacyStore wrapper succeeds against the real 0024 functions, called by argument name', async () => {
  const called = await asService(async (client, tx) => {
    await seed(tx);
    assert.deepEqual(await probePrivacySchema(client), { available: true });

    const fingerprint = await privacyFingerprint(client, { profileId: ALICE, tables: fingerprintTables('all') });
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
    const direct = (await tx.query(`select public.privacy_fingerprint($1, $2::text[]) as f`, [ALICE, [...FINGERPRINT_TABLES]])).rows[0].f;
    assert.equal(fingerprint, direct);
    const exportPrint = await privacyFingerprint(client, { profileId: ALICE, tables: fingerprintTables('export', ['journal', 'tasks']) });
    assert.match(exportPrint, /^[0-9a-f]{64}$/);

    assert.deepEqual(await privacyCounts(client, { profileId: ALICE, scope: 'journal' }), { symptom_logs: 1, alerts: 1 });
    const all = await privacyCounts(client, { profileId: ALICE, scope: 'all' });
    assert.equal(Object.keys(all).length, 22); // daily_maxima included (0025), the workspace (0026), the files (0028) and the idea sets (0030)
    assert.equal(all.household_project_generations, 0);
    assert.equal(all.daily_maxima, 0);
    assert.equal(all.household_workspace_records, 0);
    assert.equal(all.household_attachments, 0);
    assert.equal(all.profiles, 1);
    assert.equal(all.operations, 1);

    // The ledger row the route's runOperation would have claimed, lowercase as Postgres stores it.
    await tx.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'privacy', 'privacy.clear.all', 'pending')`, [CLEAR_OP, ALICE]);
    // Passed in capitals, the id is still this clear's own (finding 7).
    const cleared = await clearHouseholdRecords(client, { profileId: ALICE, operationId: CLEAR_OP.toUpperCase(), scope: 'all', fingerprint });
    assert.deepEqual(cleared.receipt, { operationId: CLEAR_OP, status: 'succeeded', scope: 'all' });
    assert.equal(cleared.removed, 4, 'a symptom log, an alert, a settled receipt and the profile reset');

    assert.equal(await purgePrivacyReceipts(client, { profileId: ALICE }), 0, 'alice\'s old receipt went with the clear');
    assert.equal(await purgeAllPrivacyReceipts(client), 1, 'bob\'s old receipt');
    return client.called;
  });

  // Each callable 0024 function, 0026's workspace count, 0028's file count and 0030's idea-set count, is reached by a wrapper.
  const { rows } = await db.query(
    `select p.proname::text as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any ($1::text[]) and p.prorettype <> 'trigger'::regtype order by 1`,
    [['privacy_schema_version', 'privacy_fingerprint', 'privacy_counts', 'clear_household_records', 'purge_privacy_receipts', 'guard_settled_privacy_operation', 'workspace_privacy_counts', 'attachment_privacy_counts', 'project_privacy_counts']],
  );
  assert.deepEqual([...new Set(called)].sort(), rows.map((row) => row.name));
});

// ---------------------------------------------------------------------------
// 2. Refusals
// ---------------------------------------------------------------------------

test('refusals from the real functions arrive as privacyRefusal reads them, never as unavailable', async () => {
  await asService(async (client, tx) => {
    await seed(tx);
    const attempt = async (fn) => {
      try {
        await fn();
      } catch (error) {
        return error;
      }
      assert.fail('expected a refusal');
    };
    const notPending = await attempt(() => clearHouseholdRecords(client, { profileId: ALICE, operationId: CLEAR_OP, scope: 'all', fingerprint: 'f'.repeat(64) }));
    assert.deepEqual(privacyRefusal(notPending), { code: 'HALO_OPERATION_NOT_PENDING', reason: 'operation_not_pending' });
    assert.equal(isPrivacyUnavailable(notPending), false);

    await tx.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'privacy', 'privacy.clear.journal', 'pending')`, [CLEAR_OP, ALICE]);
    const changed = await attempt(() => clearHouseholdRecords(client, { profileId: ALICE, operationId: CLEAR_OP, scope: 'journal', fingerprint: 'f'.repeat(64) }));
    assert.deepEqual(privacyRefusal(changed), { code: 'HALO_REVIEW_CHANGED', reason: 'review_changed' });

    const invalid = await attempt(() => clearHouseholdRecords(client, { profileId: ALICE, operationId: CLEAR_OP, scope: 'journal', fingerprint: 'not hex' }));
    assert.deepEqual(privacyRefusal(invalid), { code: 'HALO_INVALID_INPUT', reason: 'invalid_input' });

    const busy = crypto.randomUUID();
    await tx.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'privacy', 'privacy.export', 'pending')`, [busy, ALICE]);
    const journalPrint = await privacyFingerprint(client, { profileId: ALICE, tables: fingerprintTables('journal') });
    const refusedBusy = await attempt(() => clearHouseholdRecords(client, { profileId: ALICE, operationId: CLEAR_OP, scope: 'journal', fingerprint: journalPrint }));
    assert.deepEqual(privacyRefusal(refusedBusy), { code: 'HALO_BUSY', reason: 'busy' });
  });
});

// ---------------------------------------------------------------------------
// 3. The failure this file rules out
// ---------------------------------------------------------------------------

test('negative control: a wrong argument name is 42883, which isPrivacyUnavailable would read as "not applied"', async () => {
  await asService(async (client) => {
    const { error } = await client.rpc('privacy_counts', { p_owner: ALICE, p_scope: 'all' });
    assert.equal(error.code, '42883');
    assert.equal(isPrivacyUnavailable(error), true, 'this is why a mismatch would hide as a 503');
    const { error: none } = await client.rpc('privacy_counts', { p_profile_id: ALICE, p_scope: 'all' });
    assert.equal(none, null);
  });
});

// ---------------------------------------------------------------------------
// 4. Before 0024
// ---------------------------------------------------------------------------

test('without 0024 the probe answers unavailable and every wrapper\'s error reads as unavailable', async () => {
  const lagging = await createDb({ upTo: 23 });
  try {
    await asService(async (client) => {
      assert.deepEqual(await probePrivacySchema(client), { available: false, code: '42883' });
      for (const call of [
        () => privacyFingerprint(client, { profileId: ALICE, tables: ['symptom_logs'] }),
        () => privacyCounts(client, { profileId: ALICE, scope: 'all' }),
        () => clearHouseholdRecords(client, { profileId: ALICE, operationId: CLEAR_OP, scope: 'all', fingerprint: 'f'.repeat(64) }),
        () => purgePrivacyReceipts(client, { profileId: ALICE }),
        () => purgeAllPrivacyReceipts(client),
      ]) {
        await assert.rejects(call(), (error) => isPrivacyUnavailable(error));
      }
    }, () => lagging);
  } finally {
    await lagging.close();
  }
});
