/**
 * The held-lock purge scenario of test/privacyClearDb.test.mjs (B07 Task 1
 * review, finding 1), run as its own process.
 *
 * PGlite has one connection, so the only way to have a second transaction
 * holding row locks is a prepared transaction (PREPARE TRANSACTION), which
 * keeps its locks after the session moves on. A statement that waits on such
 * a lock never returns: PGlite cannot fire lock_timeout or statement_timeout,
 * and the wait blocks the whole process. So this runs in a child process the
 * test kills after a deadline, and a purge that waits (no SKIP LOCKED) fails
 * the test by timing out instead of hanging the suite.
 *
 * Prints one JSON line with what it observed. Run directly:
 *   node test/db/privacyPurgeHeldLock.mjs
 */
import { createDb } from './pgliteHarness.mjs';

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const CLEAR_OP = '00000000-0000-4000-8000-0000000c1ea4';
const FINGERPRINT_TABLES = [
  'profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs',
  'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions',
  'household_action_preferences', 'luna_conversations', 'luna_turns',
];

const db = await createDb({ settings: { max_prepared_transactions: 2 } });

/** Settled privacy receipts settled 30 hours ago, committed, as the migration owner. */
async function oldReceipts(owner, n) {
  const ids = [];
  for (let at = 0; at < n; at += 1) {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.query(
      `insert into public.operations (operation_id, profile_id, domain, kind, status, result, created_at, updated_at)
       values ($1, $2, 'privacy', 'privacy.export', 'succeeded', '{"status":"succeeded"}', now() - interval '30 hours', now() - interval '30 hours')`,
      [id, owner],
    );
  }
  return ids;
}

const purge = async (owner) => {
  const { rows } = await db.asService((tx) => tx.query(`select public.purge_privacy_receipts($1) as n`, [owner]), { commit: true });
  return rows[0].n;
};
const idsOf = async (owner) =>
  (await db.query(`select operation_id from public.operations where profile_id = $1 order by 1`, [owner])).rows.map((row) => row.operation_id);

const out = {};
try {
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`);

  // 1. A clear all that has run to its last statement and is parked before
  //    its commit, holding the delete locks on alice's two old receipts.
  const aliceOld = await oldReceipts(ALICE, 2);
  const bobOld = await oldReceipts(BOB, 1);
  await db.exec(`begin;
    set local role service_role;
    insert into public.operations (operation_id, profile_id, domain, kind, status)
      values ('${CLEAR_OP}', '${ALICE}', 'privacy', 'privacy.clear.all', 'pending');
    select public.clear_household_records('${ALICE}', '${CLEAR_OP}', 'all',
      public.privacy_fingerprint('${ALICE}', array[${FINGERPRINT_TABLES.map((table) => `'${table}'`).join(', ')}]));
    prepare transaction 'privacy_clear';`);
  out.purgedWhileClearHeld = await purge(null);
  out.aliceWhileClearHeld = (await idsOf(ALICE)).filter((id) => aliceOld.includes(id)).length;
  out.bobWhileClearHeld = (await idsOf(BOB)).filter((id) => bobOld.includes(id)).length;
  await db.exec(`commit prepared 'privacy_clear'`);
  out.aliceAfterClear = await idsOf(ALICE);
  out.bobAfterClear = await idsOf(BOB);

  // 2. A transaction that locks two receipts and then fails: the purge skips
  //    them while they are held and takes them on its next run.
  const held = await oldReceipts(ALICE, 2);
  await db.exec(`begin;
    select 1 from public.operations where operation_id in ('${held.join("', '")}') for update;
    prepare transaction 'privacy_held';`);
  out.purgedWhileHeld = await purge(ALICE);
  await db.exec(`rollback prepared 'privacy_held'`);
  out.purgedAfterRelease = await purge(ALICE);
  out.heldLeft = (await idsOf(ALICE)).filter((id) => held.includes(id)).length;
} finally {
  for (const { gid } of (await db.query(`select gid from pg_prepared_xacts`)).rows) await db.exec(`rollback prepared '${gid}'`);
  await db.close();
}
process.stdout.write(`${JSON.stringify(out)}\n`);
