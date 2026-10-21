/**
 * Migration 0018's database rules: the recovery challenge table (B02 plan,
 * Task 1), on a local in-memory PGlite database (test/db/pgliteHarness.mjs)
 * with the reconstructed baseline and every migration.
 *
 * What the table is for. `POST /api/recovery/request` (Task 5) creates one row
 * when an email resolves to a linked identity; `/status` reads it and
 * `/complete` consumes it. The caller is not signed in while that happens, so
 * the row is the only thing standing between a stranger and someone's
 * household. Everything here is about that: the service role is the only
 * reader, nothing proof-bearing is stored in a form that could be replayed if
 * the row leaked, and a token can be spent exactly once.
 *
 * 1. Hashes only, never the address. email_hash, nonce_hash and
 *    restore_token_hash are constrained to 64 hex characters, so a plaintext
 *    email or nonce cannot physically be written to the column (BE-201: proofs
 *    and secrets stay server side).
 * 2. Service role only: row level security on, zero policies, and no privilege
 *    for anon or authenticated, so not even the owner can read their own
 *    challenge directly. The cross-table guardrail is test/rlsIsolation.test.mjs.
 * 3. The statuses the frontend's `validRecoveryStatus` accepts, and no others.
 *    'unknown' is never stored: it is what a route reports, the same way the
 *    operation ledger treats a stale pending row.
 * 4. A 'verified' row must carry a restore token hash, because the frontend
 *    rejects a verified response that has neither a restoreToken nor a session.
 * 5. Single use: consumed_at cannot be recorded for a row that never had a
 *    token, so a replay cannot be made to look like a first use.
 * 6. Deleting the account deletes its challenges (BE-230 ownership).
 * 7. Re-running 0018 changes nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { createDb, listMigrations, MIGRATION_FILE } from './db/pgliteHarness.mjs';

const TABLE = 'recovery_challenges';
const API_ROLES = ['anon', 'authenticated'];

/** A sha256 hex digest is 64 hex characters; the columns accept nothing else. */
const hex = (fill) => fill.repeat(64).slice(0, 64);
const EMAIL_HASH = hex('a1');
const NONCE_HASH = hex('b2');
const TOKEN_HASH = hex('c3');

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';

const MIGRATION = listMigrations().find((migration) => migration.number === 18);

let db;

/** Inserts a challenge as the service role, returning the error (or null) rather than throwing. */
async function insertChallenge(row, { commit = false } = {}) {
  const columns = Object.keys(row);
  const values = columns.map((_, index) => `$${index + 1}`);
  try {
    await db.asService(
      (tx) =>
        tx.query(
          `insert into public.${TABLE} (${columns.join(', ')}) values (${values.join(', ')})`,
          columns.map((column) => row[column]),
        ),
      { commit },
    );
    return null;
  } catch (error) {
    return error;
  }
}

/** A complete, valid pending challenge for `owner`. */
const pendingRow = (owner = ALICE, overrides = {}) => ({
  profile_id: owner,
  email_hash: EMAIL_HASH,
  nonce_hash: NONCE_HASH,
  expires_at: '2026-10-18T00:00:00Z',
  ...overrides,
});

before(async () => {
  db = await createDb();
  await db.exec(
    `insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`,
  ); // the 0001 trigger adds their profiles
});

after(async () => {
  await db?.close();
});

test('0018 exists, is named for what it does and applies in order after 0017', () => {
  assert.ok(MIGRATION, 'supabase/migrations has a 0018 migration');
  assert.match(basename(MIGRATION.file), MIGRATION_FILE, 'the file name is four digits and a snake_case name');
  assert.match(MIGRATION.name, /recovery/, 'the name says it is the recovery schema');
});

test('the table holds the columns the recovery flow needs, and no column for a plaintext address', async () => {
  const { rows } = await db.query(
    `select column_name as name, is_nullable as nullable, data_type as type
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [TABLE],
  );
  const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
  for (const column of [
    'id',
    'profile_id',
    'email_hash',
    'nonce_hash',
    'restore_token_hash',
    'status',
    'attempts',
    'expires_at',
    'consumed_at',
    'created_at',
  ]) {
    assert.ok(byName[column], `${TABLE} has ${column}`);
  }
  // The address itself is never stored, only its hash.
  for (const forbidden of ['email', 'address', 'nonce', 'restore_token', 'token']) {
    assert.equal(byName[forbidden], undefined, `${TABLE} has no ${forbidden} column`);
  }
  assert.equal(byName.profile_id.nullable, 'NO', 'a challenge always belongs to a resolved identity');
  assert.equal(byName.expires_at.nullable, 'NO', 'a challenge always expires');
  assert.equal(byName.consumed_at.nullable, 'YES', 'consumed_at is set only when the token is spent');
});

test('a valid pending challenge is accepted and defaults to pending with no attempts', async () => {
  const error = await insertChallenge(pendingRow(), { commit: true });
  assert.equal(error, null, 'the service role can create a challenge');
  const { rows } = await db.query(
    `select status, attempts, consumed_at, restore_token_hash from public.${TABLE} where profile_id = $1`,
    [ALICE],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].attempts, 0);
  assert.equal(rows[0].consumed_at, null);
  assert.equal(rows[0].restore_token_hash, null);
});

test('a plaintext email cannot be written to email_hash: the column takes 64 hex characters only', async () => {
  const error = await insertChallenge(pendingRow(BOB, { email_hash: 'person@example.test' }));
  assert.ok(error, 'a plaintext address is refused');
  assert.match(String(error.message), /email_hash/);
});

test('nonce_hash and restore_token_hash are hashes too, not the values themselves', async () => {
  const nonce = await insertChallenge(pendingRow(BOB, { nonce_hash: 'client-nonce-value' }));
  assert.ok(nonce, 'a plaintext nonce is refused');
  assert.match(String(nonce.message), /nonce_hash/);
  const token = await insertChallenge(
    pendingRow(BOB, { status: 'verified', restore_token_hash: 'restore-token-value' }),
  );
  assert.ok(token, 'a plaintext restore token is refused');
  assert.match(String(token.message), /restore_token_hash/);
});

test('only the statuses the frontend accepts are storable, and unknown is not one of them', async () => {
  for (const status of ['pending', 'expired', 'collision', 'failed']) {
    const error = await insertChallenge(pendingRow(BOB, { status }));
    assert.equal(error, null, `${status} is a valid stored status`);
  }
  const verified = await insertChallenge(
    pendingRow(BOB, { status: 'verified', restore_token_hash: TOKEN_HASH }),
  );
  assert.equal(verified, null, 'verified is valid when it carries a token hash');
  for (const status of ['unknown', 'succeeded', 'Pending', '']) {
    const error = await insertChallenge(pendingRow(BOB, { status }));
    assert.ok(error, `${JSON.stringify(status)} is refused`);
    assert.match(String(error.message), /status/);
  }
});

test('a verified challenge without a restore token hash is refused, because the client would reject that response', async () => {
  const error = await insertChallenge(pendingRow(BOB, { status: 'verified' }));
  assert.ok(error, 'verified with no token hash is refused');
  assert.match(String(error.message), /restore_token/);
});

test('consumed_at cannot be recorded for a challenge that never had a token', async () => {
  const error = await insertChallenge(
    pendingRow(BOB, { consumed_at: '2026-10-17T12:00:00Z' }),
  );
  assert.ok(error, 'a consumed row with no token hash is refused');
  assert.match(String(error.message), /consumed/);
});

test('attempts cannot go negative', async () => {
  const error = await insertChallenge(pendingRow(BOB, { attempts: -1 }));
  assert.ok(error, 'a negative attempt count is refused');
  assert.match(String(error.message), /attempts/);
});

test('row level security is on and the table carries no policy at all', async () => {
  const { rows: [table] } = await db.query(
    `select relrowsecurity as rls from pg_class
      where oid = ('public.' || $1)::regclass`,
    [TABLE],
  );
  assert.equal(table.rls, true, 'row level security is enabled');
  const { rows: policies } = await db.query(
    `select policyname from pg_policies where schemaname = 'public' and tablename = $1`,
    [TABLE],
  );
  assert.deepEqual(policies, [], 'no policy: the service role is the only reader');
});

test('neither anon nor authenticated holds any privilege, so an owner cannot read their own challenge directly', async () => {
  for (const role of API_ROLES) {
    const { rows: [privileges] } = await db.query(
      `select has_any_column_privilege($1, ($2::text)::regclass, 'SELECT') as select,
              has_any_column_privilege($1, ($2::text)::regclass, 'INSERT') as insert,
              has_any_column_privilege($1, ($2::text)::regclass, 'UPDATE') as update,
              has_table_privilege($1, ($2::text)::regclass, 'DELETE') as delete`,
      [role, `public.${TABLE}`],
    );
    assert.deepEqual(
      privileges,
      { select: false, insert: false, update: false, delete: false },
      `${role} holds no privilege on ${TABLE}`,
    );
  }
});

test('the owner reading their own challenge with their own session is denied', async () => {
  await assert.rejects(
    () => db.asRole('authenticated', ALICE, (tx) => tx.query(`select id from public.${TABLE}`)),
    /permission denied/i,
    'a signed-in owner cannot select their own challenge row',
  );
});

test('deleting the account deletes its challenges', async () => {
  await db.asService(
    (tx) =>
      tx.query(
        `insert into public.${TABLE} (profile_id, email_hash, nonce_hash, expires_at)
         values ($1, $2, $3, $4)`,
        [BOB, EMAIL_HASH, NONCE_HASH, '2026-10-18T00:00:00Z'],
      ),
    { commit: true },
  );
  const before = await db.query(`select count(*)::int as n from public.${TABLE} where profile_id = $1`, [BOB]);
  assert.equal(before.rows[0].n, 1, 'bob has a challenge to lose');
  await db.exec(`delete from auth.users where id = '${BOB}'`);
  const after = await db.query(`select count(*)::int as n from public.${TABLE} where profile_id = $1`, [BOB]);
  assert.equal(after.rows[0].n, 0, 'the challenge went with the account');
});

test('running 0018 again changes nothing', async () => {
  const shape = async () => {
    const { rows } = await db.query(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by column_name`,
      [TABLE],
    );
    const { rows: checks } = await db.query(
      `select conname from pg_constraint where conrelid = ('public.' || $1)::regclass order by conname`,
      [TABLE],
    );
    return { rows, checks };
  };
  const first = await shape();
  await db.exec(MIGRATION.sql);
  assert.deepEqual(await shape(), first, 're-running the migration is a no-op');
});

// ---------------------------------------------------------------------------
// 8. Migration 0019: the intent column (B02 Task 5, Ruling 15)
//
// Two different operations write this table. The signed-in link intent
// (POST /api/account/commands) attaches an address to the caller's own
// identity; the unauthenticated recover intent (POST /api/recovery/request)
// proves ownership of an address that is already linked. 0018's columns cannot
// tell them apart: a fresh row of either kind carries a nonce hash, a null
// restore_token_hash and a null consumed_at, so the link intent's "supersede
// whatever this household had open" delete would take an in-flight recovery
// challenge with it. `intent` is what makes each statement name the rows it
// means.
//
// It defaults to 'link' so any row that already exists keeps the meaning it
// was written with. Nothing needs backfilling because the capability has never
// been enabled, but the default is what makes that true rather than assumed.
// ---------------------------------------------------------------------------

const INTENT_MIGRATION = listMigrations().find((migration) => migration.number === 19);

test('0019 exists, is named for what it adds and applies in order after 0018', () => {
  assert.ok(INTENT_MIGRATION, 'supabase/migrations has a 0019 migration');
  assert.match(basename(INTENT_MIGRATION.file), MIGRATION_FILE, 'the file name is four digits and a snake_case name');
  assert.match(INTENT_MIGRATION.name, /intent/, 'the name says it is the challenge intent');
});

test('intent is not null and defaults to link, so a row written without one keeps the link meaning', async () => {
  const { rows } = await db.query(
    `select is_nullable as nullable, column_default as "default", data_type as type
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = 'intent'`,
    [TABLE],
  );
  assert.equal(rows.length, 1, `${TABLE} has an intent column`);
  assert.equal(rows[0].nullable, 'NO', 'every challenge says which intent wrote it');
  assert.match(String(rows[0].default), /'link'/, "the default is 'link'");

  const error = await insertChallenge(pendingRow(ALICE), { commit: true });
  assert.equal(error, null);
  const { rows: written } = await db.query(
    `select intent from public.${TABLE} where profile_id = $1 order by created_at desc limit 1`,
    [ALICE],
  );
  assert.equal(written[0].intent, 'link', 'a row written without an intent is a link row');
});

test('intent accepts link and recover and nothing else', async () => {
  // ALICE rather than BOB: the cascade test above deleted bob's account.
  for (const intent of ['link', 'recover']) {
    const error = await insertChallenge(pendingRow(ALICE, { intent }));
    assert.equal(error, null, `${intent} is a valid intent`);
  }
  for (const intent of ['Link', 'recovery', 'both', '']) {
    const error = await insertChallenge(pendingRow(ALICE, { intent }));
    assert.ok(error, `${JSON.stringify(intent)} is refused`);
    assert.match(String(error.message), /intent/);
  }
});

test('running 0019 again changes nothing', async () => {
  const shape = async () => {
    const { rows } = await db.query(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by column_name`,
      [TABLE],
    );
    const { rows: checks } = await db.query(
      `select conname from pg_constraint where conrelid = ('public.' || $1)::regclass order by conname`,
      [TABLE],
    );
    return { rows, checks };
  };
  const first = await shape();
  await db.exec(INTENT_MIGRATION.sql);
  assert.deepEqual(await shape(), first, 're-running the migration is a no-op');
});
