/**
 * The copy-paste SQL blocks in docs/backend/YOUR_TODO.md that change the
 * database, run exactly as Vibhav would paste them, on a local in-memory PGlite
 * database (test/db/pgliteHarness.mjs):
 *
 *   backout-0018   undoes 0018 (recovery challenges)
 *   backout-0017   undoes 0017 (operation ledger)
 *   backout-0016   undoes 0016 (home contexts)
 *   backout-0015   undoes 0015 (household transaction, journal checks, revoke)
 *   remedy-ucmr5   only if the audit shows ucmr5_utilities writable by the API roles
 *
 * Each block sits in a ```sql fence right after an HTML comment naming it
 * (<!-- backout-0016 -->), which the rendered Markdown does not show.
 *
 * The back-outs are checked against the catalog audit (docs/backend/baseline-audit.sql):
 * after backing out 0016 the schema is exactly what 0001..0015 gave, after
 * backing out 0015 exactly what 0001..0014 gave, and applying 0015 and 0016
 * again afterwards gives exactly what one pass of every migration gives. So a
 * statement missing from a block fails here.
 *
 * The baseline is reconstructed, not captured from the deployed database
 * (docs/backend/baseline.md): this proves the blocks against the repository's
 * schema, not against the HALO project.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';

const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');

/** The ```sql block that follows `<!-- name -->` in YOUR_TODO.md. */
function docBlock(name) {
  const marker = `<!-- ${name} -->`;
  const lines = TODO.split('\n');
  const at = lines.findIndex((line) => line.trim() === marker);
  assert.ok(at >= 0, `YOUR_TODO.md has no ${marker}`);
  assert.equal(lines.filter((line) => line.trim() === marker).length, 1, `${marker} appears once`);
  const open = lines.findIndex((line, index) => index > at && line.trim() === '```sql');
  assert.equal(lines.slice(at + 1, open).every((line) => line.trim() === ''), true, `${marker} is followed by a sql block`);
  const close = lines.findIndex((line, index) => index > open && line.trim() === '```');
  assert.ok(close > open, `the sql block after ${marker} is closed`);
  return lines.slice(open + 1, close).join('\n');
}

const migration = (number) => listMigrations().find((m) => m.number === number);

const ALICE = 'b0c40000-0000-4000-8000-000000000001';
const WRITE_TABLES = ['public.profiles', 'public.household_bands', 'public.symptom_logs', 'public.notification_prefs'];
const API_ROLES = ['anon', 'authenticated'];
const ADDED_CHECKS = [
  'symptom_logs_band_check',
  'symptom_logs_entry_date_check',
  'symptom_logs_note_length_check',
  'symptom_logs_symptoms_count_check',
];

let db;
let audit14;
let audit15;
let audit16;
let audit17;
let audit18;

before(async () => {
  db = await createDb({ upTo: 14 });
  audit14 = await runAudit(db);
  await db.applyMigration(migration(15));
  audit15 = await runAudit(db);
  // A located household with one reading before 0016, so 0016 has something to link.
  await db.exec(`insert into auth.users (id) values ('${ALICE}');
    update public.profiles set lat = 35.409, lng = -80.58 where id = '${ALICE}';
    insert into public.daily_scores (profile_id, date, score) values ('${ALICE}', '2026-09-01', 61);`);
  await db.applyMigration(migration(16));
  audit16 = await runAudit(db);
});

after(async () => {
  await db?.close();
});

async function writePrivileges() {
  const { rows } = await db.query(
    `select t, r,
            has_any_column_privilege(r, t, 'INSERT') as ins,
            has_any_column_privilege(r, t, 'UPDATE') as upd,
            has_table_privilege(r, t, 'INSERT') as table_ins,
            has_table_privilege(r, t, 'UPDATE') as table_upd,
            has_table_privilege(r, t, 'DELETE') as del
       from unnest($1::text[]) as t cross join unnest($2::text[]) as r`,
    [WRITE_TABLES, API_ROLES],
  );
  return rows;
}

async function checkConstraints() {
  const { rows } = await db.query(
    `select conname, convalidated from pg_constraint
      where conrelid = 'public.symptom_logs'::regclass and contype = 'c' order by conname`,
  );
  return rows;
}

const exists = async (sql) => (await db.query(`select (${sql}) as present`)).rows[0].present;

test('the blocks are in YOUR_TODO.md, each after its marker', () => {
  for (const name of ['backout-0018', 'backout-0017', 'backout-0016', 'backout-0015', 'remedy-ucmr5']) assert.ok(docBlock(name).trim().length > 0, name);
});

test('the ucmr5 remedy turns an open table into public read only, and is safe to run twice', async () => {
  const remedy = docBlock('remedy-ucmr5');
  await db.pg.transaction(async (tx) => {
    // The case the audit would flag: row level security off, no policy, the default grants.
    await tx.exec(`alter table public.ucmr5_utilities disable row level security;
      drop policy if exists "Allow public read access on ucmr5_utilities" on public.ucmr5_utilities;
      insert into public.ucmr5_utilities (pwsid, pws_name) values ('NC0000001', 'Synthetic Utility');`);
    assert.equal(
      (await tx.query(`select has_table_privilege('anon', 'public.ucmr5_utilities', 'INSERT') as open`)).rows[0].open,
      true,
      'starting point: anon may insert',
    );
    await tx.exec(remedy);
    await tx.exec(remedy);
    const { rows: [state] } = await tx.query(
      `select c.relrowsecurity as rls,
              (select array_agg(p.cmd::text || ':' || p.qual) from pg_policies p
                where p.schemaname = 'public' and p.tablename = 'ucmr5_utilities') as policies,
              (select bool_or(has_any_column_privilege(r, 'public.ucmr5_utilities', 'INSERT')
                           or has_any_column_privilege(r, 'public.ucmr5_utilities', 'UPDATE')
                           or has_table_privilege(r, 'public.ucmr5_utilities', 'DELETE'))
                 from unnest(array['anon', 'authenticated']) r) as api_writes,
              has_table_privilege('anon', 'public.ucmr5_utilities', 'SELECT') as anon_select,
              has_table_privilege('service_role', 'public.ucmr5_utilities', 'INSERT') as service_insert
         from pg_class c where c.oid = 'public.ucmr5_utilities'::regclass`,
    );
    assert.deepEqual(state, { rls: true, policies: ['SELECT:true'], api_writes: false, anon_select: true, service_insert: true });
    // The anon key still reads it (app/api/home-guard/route.js reads it with the anon key).
    await tx.exec('set local role anon');
    const { rows } = await tx.query(`select pws_name from public.ucmr5_utilities where pwsid = 'NC0000001'`);
    assert.deepEqual(rows, [{ pws_name: 'Synthetic Utility' }]);
    await tx.rollback();
  });
});

test('the ucmr5 remedy on the reconstructed baseline changes nothing but the write privileges', async () => {
  const remedy = docBlock('remedy-ucmr5');
  const after = await db.pg.transaction(async (tx) => {
    await tx.exec(remedy);
    const { rows } = await tx.query(readFileSync(path.join(REPO_ROOT, 'docs/backend/baseline-audit.sql'), 'utf8'));
    await tx.rollback();
    return rows[0].halo_baseline_audit;
  });
  const ucmr5 = (audit) => audit.tables.find((table) => table.table === 'ucmr5_utilities');
  assert.deepEqual(ucmr5(after), ucmr5(audit16));
  assert.deepEqual(
    after.policies.filter((p) => p.table === 'ucmr5_utilities'),
    audit16.policies.filter((p) => p.table === 'ucmr5_utilities'),
  );
  const grants = (audit) => audit.table_grants.find((grant) => grant.table === 'ucmr5_utilities');
  for (const role of API_ROLES) {
    assert.equal(grants(after)[role].includes('SELECT'), true, `${role} keeps SELECT`);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) assert.equal(grants(after)[role].includes(privilege), false, `${role} loses ${privilege}`);
  }
});

test('backing out 0016 removes everything 0016 added and leaves the 0001..0015 schema exactly', async () => {
  assert.equal(await exists(`select home_context_id is not null from public.daily_scores where profile_id = '${ALICE}'`), true, '0016 linked the reading');
  await db.exec(docBlock('backout-0016'));

  assert.equal(await exists(`to_regclass('public.home_contexts') is not null`), false, 'home_contexts is gone');
  assert.equal(await exists(`to_regprocedure('public.transition_home_context(uuid, jsonb, jsonb, uuid)') is not null`), false);
  assert.equal(await exists(`to_regprocedure('public.update_home_context_attributes(uuid, uuid, integer, jsonb)') is not null`), false);
  assert.equal(await exists(`exists (select 1 from pg_constraint where conname = 'daily_scores_home_context_fkey')`), false);
  assert.equal(await exists(`to_regclass('public.daily_scores_profile_context_date') is not null`), false);
  assert.equal(
    await exists(`exists (select 1 from pg_attribute where attrelid = 'public.daily_scores'::regclass and attname = 'home_context_id' and not attisdropped)`),
    false,
  );
  // The readings themselves stay.
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  // Every earlier table, column, constraint, policy, grant and function is as 0001..0015 left it.
  assert.deepEqual(await runAudit(db), audit15);
});

test('backing out 0016 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0016'));
  assert.deepEqual(await runAudit(db), audit15);
});

test('backing out 0015 restores the direct write privileges and removes what 0015 added, keeping 0003\'s severity check', async () => {
  for (const row of await writePrivileges()) {
    assert.deepEqual([row.ins, row.upd, row.del], [false, false, false], `before: ${row.r} on ${row.t}`);
  }
  await db.exec(docBlock('backout-0015'));

  for (const row of await writePrivileges()) {
    assert.deepEqual(
      [row.ins, row.upd, row.del, row.table_ins, row.table_upd],
      [true, true, true, true, true],
      `${row.r} may insert, update and delete ${row.t} again (row level security still decides which rows)`,
    );
  }
  assert.equal(await exists(`to_regprocedure('public.save_household(uuid, jsonb, boolean, text)') is not null`), false);
  const checks = await checkConstraints();
  for (const name of ADDED_CHECKS) assert.equal(checks.some((c) => c.conname === name), false, `${name} is gone`);
  assert.deepEqual(checks, [{ conname: 'symptom_logs_severity_check', convalidated: true }], '0003\'s severity check stays, validated');
  assert.deepEqual(await runAudit(db), audit14);
});

test('backing out 0015 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0015'));
  assert.deepEqual(await runAudit(db), audit14);
});

test('after both back-outs, 0015 and 0016 apply again and give exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(15));
  assert.deepEqual(await runAudit(db), audit15);
  await db.applyMigration(migration(16));
  assert.deepEqual(await runAudit(db), audit16);
  // The legacy context is made again from the profile and the reading is linked to it.
  const { rows } = await db.query(
    `select h.origin from public.daily_scores s join public.home_contexts h on h.id = s.home_context_id where s.profile_id = $1`,
    [ALICE],
  );
  assert.deepEqual(rows, [{ origin: 'legacy_migration' }]);
});

// ---- 0017 and 0018: the two B02 tables. Both are a single `drop table`, and
// neither is referenced by anything outside itself, so the back-outs are
// independent of each other and of 0015/0016. The tests above leave the
// database at the 0016 schema, which is where these pick up.

test('0017 and 0018 apply on top of 0016 and each adds exactly its own table', async () => {
  await db.applyMigration(migration(17));
  audit17 = await runAudit(db);
  await db.applyMigration(migration(18));
  audit18 = await runAudit(db);

  assert.equal(await exists(`to_regclass('public.operations') is not null`), true, 'the ledger exists');
  assert.equal(await exists(`to_regclass('public.recovery_challenges') is not null`), true, 'the challenge table exists');
  // Something to lose: one settled receipt and one live challenge for alice.
  await db.exec(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, result)
       values ('00000000-0000-4000-8000-00000000f001', '${ALICE}', 'actions', 'actions.commit', 'succeeded', '{"status":"succeeded"}');
     insert into public.recovery_challenges (profile_id, email_hash, nonce_hash, expires_at)
       values ('${ALICE}', repeat('a', 64), repeat('b', 64), '2026-10-18T00:00:00Z');`,
  );
});

test('backing out 0018 removes the challenge table and leaves the 0001..0017 schema exactly', async () => {
  await db.exec(docBlock('backout-0018'));

  assert.equal(await exists(`to_regclass('public.recovery_challenges') is not null`), false, 'the challenge table is gone');
  // The ledger and every owned record are untouched: nothing outside the table referenced it.
  assert.equal(await exists(`to_regclass('public.operations') is not null`), true, 'the ledger stays');
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  assert.deepEqual(await runAudit(db), audit17);
});

test('backing out 0018 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0018'));
  assert.deepEqual(await runAudit(db), audit17);
});

test('backing out 0017 removes the ledger and leaves the 0001..0016 schema exactly', async () => {
  assert.equal(
    await exists(`exists (select 1 from public.operations where operation_id = '00000000-0000-4000-8000-00000000f001')`),
    true,
    'the receipt is there to lose',
  );
  await db.exec(docBlock('backout-0017'));

  assert.equal(await exists(`to_regclass('public.operations') is not null`), false, 'the ledger is gone');
  // The effects those operations applied stay applied; only the receipts go.
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  assert.deepEqual(await runAudit(db), audit16);
});

test('backing out 0017 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0017'));
  assert.deepEqual(await runAudit(db), audit16);
});

test('after both back-outs, 0017 and 0018 apply again and give exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(17));
  assert.deepEqual(await runAudit(db), audit17);
  await db.applyMigration(migration(18));
  assert.deepEqual(await runAudit(db), audit18);
  // Reapplied empty: the receipts and challenges really were deleted, not hidden.
  assert.deepEqual((await db.query(`select count(*)::int as n from public.operations`)).rows, [{ n: 0 }]);
  assert.deepEqual((await db.query(`select count(*)::int as n from public.recovery_challenges`)).rows, [{ n: 0 }]);
});
