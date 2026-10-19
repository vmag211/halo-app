/**
 * The copy-paste SQL blocks in docs/backend/YOUR_TODO.md that change the
 * database, run exactly as Vibhav would paste them, on a local in-memory PGlite
 * database (test/db/pgliteHarness.mjs):
 *
 *   backout-0024   undoes 0024 (the privacy clear, fingerprint, counts, purge and probe, the privacy guard)
 *   backout-0023   undoes 0023 (a household's tasks, the read and commit functions, the ledger guard)
 *   backout-0022   undoes 0022 (a household's saved discovery area)
 *   backout-0021   undoes 0021 (settings preferences, tenure, alerts columns)
 *   backout-0020   undoes 0020 (Luna conversations, turns and runs)
 *   backout-0019   undoes 0019 (which intent wrote a recovery challenge)
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

/** Tables a signed-in browser role must not be able to truncate. */
const TRUNCATABLE = ['public.profiles', 'public.symptom_logs', 'public.household_bands', 'public.notification_prefs', 'public.daily_scores', 'public.alerts'];

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
let audit19;
let audit20;
let audit21;
let audit22;
let audit23;
let audit24;

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
  for (const name of ['backout-0024', 'backout-0023', 'backout-0022', 'backout-0021', 'backout-0020', 'backout-0019', 'backout-0018', 'backout-0017', 'backout-0016', 'backout-0015', 'remedy-ucmr5']) assert.ok(docBlock(name).trim().length > 0, name);
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

// ---- 0019: one additive column on the table 0018 created. It is not a table
// of its own, so backing it out is a `drop column`, and what is lost is the
// distinction between the two intents rather than any row. These pick up where
// the 0017/0018 tests leave the database, at the 0018 schema.

test('0019 applies on top of 0018 and adds exactly the intent column', async () => {
  await db.applyMigration(migration(19));
  audit19 = await runAudit(db);

  assert.equal(
    await exists(`exists (select 1 from pg_attribute where attrelid = 'public.recovery_challenges'::regclass and attname = 'intent' and not attisdropped)`),
    true,
    'the intent column exists',
  );
  // One challenge of each intent, so the back-out has the distinction to lose.
  await db.exec(
    `insert into public.recovery_challenges (profile_id, email_hash, nonce_hash, expires_at, intent)
       values ('${ALICE}', repeat('a', 64), repeat('b', 64), '2026-10-18T00:00:00Z', 'link'),
              ('${ALICE}', repeat('c', 64), repeat('d', 64), '2026-10-18T00:00:00Z', 'recover');`,
  );
});

test('backing out 0019 removes the intent column and leaves the 0001..0018 schema exactly', async () => {
  await db.exec(docBlock('backout-0019'));

  assert.equal(
    await exists(`exists (select 1 from pg_attribute where attrelid = 'public.recovery_challenges'::regclass and attname = 'intent' and not attisdropped)`),
    false,
    'the intent column is gone',
  );
  assert.equal(
    await exists(`exists (select 1 from pg_constraint where conname = 'recovery_challenges_intent_check')`),
    false,
    'and so is its check',
  );
  // The challenges themselves stay; only which intent wrote them is lost.
  assert.deepEqual(
    (await db.query(`select count(*)::int as n from public.recovery_challenges where profile_id = $1`, [ALICE])).rows,
    [{ n: 2 }],
  );
  assert.deepEqual(await runAudit(db), audit18);
});

test('backing out 0019 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0019'));
  assert.deepEqual(await runAudit(db), audit18);
});

test('after the back-out, 0019 applies again and gives exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(19));
  assert.deepEqual(await runAudit(db), audit19);
  // Reapplied, every row that survived the back-out reads as a link row, which
  // is the whole point of the default: nothing that already exists changes
  // meaning, and the recover row that was there is no longer distinguishable.
  assert.deepEqual(
    (await db.query(`select intent, count(*)::int as n from public.recovery_challenges group by intent order by intent`)).rows,
    [{ intent: 'link', n: 2 }],
  );
});

// ---- 0020: Luna's three tables, which reference each other and profiles and
// which nothing outside them references. Backing them out is three drops in
// child-first order, and what is lost is every conversation, turn and run.
// These pick up where the 0019 tests leave the database, at the 0019 schema.

test('0020 applies on top of 0019 and adds exactly its three tables', async () => {
  await db.applyMigration(migration(20));
  audit20 = await runAudit(db);

  for (const table of ['luna_conversations', 'luna_turns', 'luna_runs']) {
    assert.equal(await exists(`to_regclass('public.${table}') is not null`), true, `${table} exists`);
  }
  // Something to lose: one conversation with the person's own turn, Luna's
  // answer, and the run that produced it.
  await db.exec(
    `insert into public.luna_conversations (id, profile_id)
       values ('00000000-0000-4000-8000-00000000a001', '${ALICE}');
     insert into public.luna_turns (id, conversation_id, profile_id, role, body)
       values ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000a001', '${ALICE}', 'user', 'What is radon?'),
              ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000a001', '${ALICE}', 'assistant', 'Radon is a gas.');
     insert into public.luna_runs (conversation_id, profile_id, turn_id, client_message_id, status, settled_at)
       values ('00000000-0000-4000-8000-00000000a001', '${ALICE}', '00000000-0000-4000-8000-00000000a002', 'client-message-1', 'completed', now());`,
  );
});

test('backing out 0020 removes the three tables and leaves the 0001..0019 schema exactly', async () => {
  await db.exec(docBlock('backout-0020'));

  for (const table of ['luna_conversations', 'luna_turns', 'luna_runs']) {
    assert.equal(await exists(`to_regclass('public.${table}') is not null`), false, `${table} is gone`);
  }
  // Nothing outside the three tables referenced them: the owned records and
  // the other B02 tables are untouched.
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  assert.equal(await exists(`to_regclass('public.operations') is not null`), true, 'the ledger stays');
  assert.equal(await exists(`to_regclass('public.recovery_challenges') is not null`), true, 'the challenge table stays');
  assert.deepEqual(await runAudit(db), audit19);
});

test('backing out 0020 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0020'));
  assert.deepEqual(await runAudit(db), audit19);
});

test('after the back-out, 0020 applies again and gives exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(20));
  assert.deepEqual(await runAudit(db), audit20);
  // Reapplied empty: the conversation, both turns and the run really were
  // deleted, not hidden.
  for (const table of ['luna_conversations', 'luna_turns', 'luna_runs']) {
    assert.deepEqual((await db.query(`select count(*)::int as n from public.${table}`)).rows, [{ n: 0 }], table);
  }
});

// ---- 0021: one new table plus one column on profiles and five on alerts.
// Backing it out is a drop table and two drop-column statements, and what is
// lost is every household's settings choices, its tenure answer, and each
// alert's revision, category and target. The alerts and profiles rows
// themselves stay. These pick up where the 0020 tests leave the database, at
// the 0020 schema.

const ADDED_0021 = [
  ['profiles', 'tenure'],
  ['alerts', 'revision'],
  ['alerts', 'category'],
  ['alerts', 'target_tab'],
  ['alerts', 'target_destination'],
  ['alerts', 'target_learn'],
];
const CHECKS_0021 = [
  'profiles_tenure_check',
  'alerts_revision_check',
  'alerts_category_check',
  'alerts_target_check',
  'alerts_target_learn_check',
];
const PATCHED_ALERT = '00000000-0000-4000-8000-00000000b001';
const SETTINGS_OP = '00000000-0000-4000-8000-00000000b021';
const settleSettingsOp = (status) => db.query('update public.operations set status = $2 where operation_id = $1', [SETTINGS_OP, status]);
const columnExists = ([table, column]) =>
  exists(`exists (select 1 from pg_attribute where attrelid = 'public.${table}'::regclass
            and attname = '${column}' and not attisdropped)`);

test('0021 applies on top of 0020 and adds exactly its table, its tenure column and its five alerts columns', async () => {
  await db.applyMigration(migration(21));
  audit21 = await runAudit(db);

  assert.equal(await exists(`to_regclass('public.profile_preferences') is not null`), true, 'the preferences table exists');
  for (const added of ADDED_0021) assert.equal(await columnExists(added), true, added.join('.'));
  // Something to lose: one household's settings, its tenure answer, and one
  // alert that has been patched twice and carries a category and a target.
  await db.exec(
    `insert into public.profile_preferences
       (profile_id, revision, display_appearance, quiet_enabled, quiet_from, quiet_to, quiet_zone, calendar_zone, luna_home)
       values ('${ALICE}', 6, 'dark', true, '22:00', '07:00', 'America/New_York', 'America/New_York', true);
     update public.profiles set tenure = 'renter', renter_mode = true where id = '${ALICE}';
     insert into public.alerts
       (id, profile_id, type, title, message, dedupe_key, revision, category, target_tab, target_destination, target_learn)
       values ('${PATCHED_ALERT}', '${ALICE}', 'new_water_results', 'New results',
               'Your utility published new results.', 'backout-0021', 3, 'Home', 'home', 'tests', 'pfas');
     insert into public.operations (operation_id, profile_id, domain, kind, status, result)
       values ('${SETTINGS_OP}', '${ALICE}', 'settings', 'settings.save', 'succeeded', '{"status":"succeeded"}');`,
  );
  // Ruling S15: a settled settings operation keeps its status.
  await assert.rejects(settleSettingsOp('failed'), /HALO_OPERATION_SETTLED/);
});

test('backing out 0021 removes the table and the six columns and leaves the 0001..0020 schema exactly', async () => {
  await db.exec(docBlock('backout-0021'));

  assert.equal(await exists(`to_regclass('public.profile_preferences') is not null`), false, 'the preferences table is gone');
  for (const added of ADDED_0021) assert.equal(await columnExists(added), false, `${added.join('.')} is gone`);
  for (const name of CHECKS_0021) {
    assert.equal(await exists(`exists (select 1 from pg_constraint where conname = '${name}')`), false, `${name} went with its column`);
  }
  // The alert and the profile stay; only what 0021 added to them is lost, and
  // renter_mode keeps the value it had, because nothing migrated it away.
  assert.deepEqual(
    (await db.query(`select title, read from public.alerts where id = $1`, [PATCHED_ALERT])).rows,
    [{ title: 'New results', read: false }],
    'the alert itself survives',
  );
  assert.deepEqual(
    (await db.query(`select renter_mode from public.profiles where id = $1`, [ALICE])).rows,
    [{ renter_mode: true }],
    'renter_mode is untouched, so every existing reader keeps working',
  );
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  // The settings ledger row stays, an ordinary row again: with the guard gone its status can change.
  await settleSettingsOp('failed');
  await settleSettingsOp('succeeded');
  assert.deepEqual(await runAudit(db), audit20);
});

test('review finding D: the 0021 back-out drops every trigger before the table they write and the column they name', () => {
  const statements = docBlock('backout-0021').split(';').map((part) => part.trim()).filter(Boolean);
  const at = (pattern) => statements.findIndex((statement) => pattern.test(statement));
  const triggers = statements.map((statement, index) => [statement, index]).filter(([statement]) => /^drop trigger/.test(statement));
  assert.equal(triggers.length, 7, 'every trigger 0021 creates on another table');
  for (const [statement, index] of triggers) {
    assert.ok(index < at(/^drop table if exists public\.profile_preferences$/), `${statement} comes before the table`);
    assert.ok(index < at(/drop column if exists tenure$/), `${statement} comes before the tenure column`);
  }
  assert.ok(at(/^drop function if exists public\.save_settings\(/) < at(/^drop table/), 'and so does the save function that writes it');
});

test('backing out 0021 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0021'));
  assert.deepEqual(await runAudit(db), audit20);
});

test('after the back-out, 0021 applies again and gives exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(21));
  assert.deepEqual(await runAudit(db), audit21);
  // Reapplied empty: the settings choices really were deleted, not hidden.
  assert.deepEqual((await db.query(`select count(*)::int as n from public.profile_preferences`)).rows, [{ n: 0 }]);
  // Every household reads as unanswered again rather than being guessed from
  // renter_mode, and every surviving alert is back at revision 1.
  assert.deepEqual((await db.query(`select count(*)::int as n from public.profiles where tenure is not null`)).rows, [{ n: 0 }]);
  assert.deepEqual(
    (await db.query(`select revision from public.alerts where id = $1`, [PATCHED_ALERT])).rows,
    [{ revision: 1 }],
    'the alert is back at revision 1, so a client holding revision 3 has to reload',
  );
  // The guard is back on the surviving settings ledger row too.
  await assert.rejects(settleSettingsOp('failed'), /HALO_OPERATION_SETTLED/);
});

// ---- 0022: one new table, keyed by the profile, which nothing else
// references. Backing it out is a single drop table, and what is lost is every
// household's chosen discovery area and its revision. These pick up where the
// 0021 tests leave the database, at the 0021 schema with 0021 reapplied.

/**
 * Ruling D6a: a set place may not have a blank field. Checked on the schema as
 * first applied and again after the back-out and reapply, so a reapplied 0022
 * cannot quietly come back without it. Each attempt is rolled back.
 */
async function assertBlankPlaceRefused(when) {
  const attempt = (overrides) =>
    db.pg.transaction(async (tx) => {
      const row = { place_id: 'us-county:37159', place: 'Rowan County', state: 'NC', label: 'Rowan County, NC', timezone: 'America/New_York', ...overrides };
      try {
        await tx.query(
          `insert into public.explore_areas (profile_id, place_id, place, state, label, timezone, revision)
             values ($1, $2, $3, $4, $5, $6, 2)`,
          [ALICE, row.place_id, row.place, row.state, row.label, row.timezone],
        );
        return null;
      } catch (error) {
        return error;
      } finally {
        if (!tx.closed) await tx.rollback();
      }
    });
  const blanks = [{ place_id: '' }, { label: '   ' }, { label: '\t' }, { label: '\n' }, { label: '\r' }, { label: ' \t\n\r ' }];
  for (const overrides of blanks) {
    const error = await attempt(overrides);
    assert.equal(error?.code, '23514', `${when}: ${JSON.stringify(overrides)} is refused`);
    assert.match(error.message, /explore_areas_place_complete_check/);
  }
  assert.equal(await attempt({ label: 'Rowan\tCounty, NC' }), null, `${when}: a tab inside a value is not blank`);
}

test('0022 applies on top of 0021 and adds exactly the discovery-area table', async () => {
  await db.applyMigration(migration(22));
  audit22 = await runAudit(db);

  assert.equal(await exists(`to_regclass('public.explore_areas') is not null`), true, 'the area table exists');
  await assertBlankPlaceRefused('as first applied');
  // Something to lose: alice has saved an area and changed it once since.
  await db.exec(
    `insert into public.explore_areas (profile_id, place_id, place, state, label, timezone, revision)
       values ('${ALICE}', 'us-county:37159', 'Rowan County', 'NC', 'Rowan County, NC', 'America/New_York', 3);`,
  );
});

test('backing out 0022 removes the table and leaves the 0001..0021 schema exactly, 0021 included', async () => {
  await db.exec(docBlock('backout-0022'));

  assert.equal(await exists(`to_regclass('public.explore_areas') is not null`), false, 'the area table is gone');
  for (const name of ['explore_areas_revision_check', 'explore_areas_place_complete_check', 'explore_areas_place_length_check', 'explore_areas_place_control_check']) {
    assert.equal(await exists(`exists (select 1 from pg_constraint where conname = '${name}')`), false, `${name} went with its table`);
  }
  // 0021 is untouched: its table and its six columns stay.
  assert.equal(await exists(`to_regclass('public.profile_preferences') is not null`), true, '0021\'s table stays');
  for (const added of ADDED_0021) assert.equal(await columnExists(added), true, `${added.join('.')} stays`);
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  assert.deepEqual(await runAudit(db), audit21);
});

test('backing out 0022 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0022'));
  assert.deepEqual(await runAudit(db), audit21);
});

test('after the back-out, 0022 applies again and gives exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(22));
  assert.deepEqual(await runAudit(db), audit22);
  await assertBlankPlaceRefused('after the back-out and reapply');
  // Reapplied empty: alice's area really was deleted, so she reads as never
  // saved (revision 1) again, and a client still holding revision 3 has to reload.
  assert.deepEqual((await db.query(`select count(*)::int as n from public.explore_areas`)).rows, [{ n: 0 }]);
});

// ---- 0023: three new tables keyed by the profile, two functions and one
// trigger on public.operations. Backing it out drops all of them; what is lost
// is every household's tasks, planning details and task preferences. The
// ledger rows in domain 'actions' stay, and they hold no task content. These
// pick up where the 0022 tests leave the database, at 0022 reapplied.

const OBJECTS_0023 = {
  tables: ['household_actions', 'household_action_preferences', 'household_action_state'],
  functions: ['read_household_actions(uuid)', 'commit_household_actions(uuid, uuid, bigint, jsonb)', 'guard_settled_action_operation()'],
};
const ACTION_OP = '00000000-0000-4000-8000-00000000a023';

async function objects0023() {
  const present = {};
  for (const table of OBJECTS_0023.tables) present[table] = await exists(`to_regclass('public.${table}') is not null`);
  for (const fn of OBJECTS_0023.functions) present[fn] = await exists(`to_regprocedure('public.${fn}') is not null`);
  present.trigger = await exists(`exists (select 1 from pg_trigger where tgname = 'operations_actions_settled_guard')`);
  // The note backstop (Ruling H23) goes with its table and must come back with it.
  present.noteCheck = await exists(`exists (select 1 from pg_constraint where conname = 'household_actions_note_check')`);
  return present;
}

test('0023 applies on top of 0022 and adds exactly its three tables, two functions and the ledger guard', async () => {
  await db.applyMigration(migration(23));
  audit23 = await runAudit(db);
  const present = await objects0023();
  assert.deepEqual(present, Object.fromEntries(Object.keys(present).map((name) => [name, true])));
  // Something to lose: alice has committed one task with a meta and a preference.
  await db.exec(`insert into public.operations (operation_id, profile_id, domain, kind) values ('${ACTION_OP}', '${ALICE}', 'actions', 'actions.commit')`);
  const { rows } = await db.query(
    `select public.commit_household_actions($1, $2, 0, $3::jsonb) as out`,
    [ALICE, ACTION_OP, JSON.stringify({
      inserts: [{ id: '00000000-0000-4000-8000-0000000a0001', key: 'radon', title: 'Test for radon', reason: 'Season', origin: 'week', date: '2026-11-02', state: 'saved', revision: 1, meta: { note: 'In the basement' } }],
      preferences: { 'week:focus': 'Rest more' },
    })],
  );
  assert.equal(rows[0].out.receipt.status, 'succeeded');
});

test('backing out 0023 removes everything it added and leaves the 0001..0022 schema exactly, 0022 included', async () => {
  await db.exec(docBlock('backout-0023'));

  const present = await objects0023();
  assert.deepEqual(present, Object.fromEntries(Object.keys(present).map((name) => [name, false])));
  assert.equal(await exists(`to_regclass('public.explore_areas') is not null`), true, 'the 0022 table stays');
  // The ledger row stays, holding ids and revisions only, and is an ordinary
  // row again: with the guard gone its status can be settled like any other.
  const { rows: [op] } = await db.query(`select status, result from public.operations where operation_id = $1`, [ACTION_OP]);
  assert.equal(op.status, 'succeeded');
  assert.equal(JSON.stringify(op.result).includes('Test for radon'), false, 'no task content was ever in the ledger');
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  assert.deepEqual(await runAudit(db), audit22);
});

test('backing out 0023 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0023'));
  assert.deepEqual(await runAudit(db), audit22);
});

test('after the back-out, 0023 applies again and gives exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(23));
  assert.deepEqual(await runAudit(db), audit23);
  // Reapplied empty: alice's task and preference really were deleted, and her
  // version restarts, so a stale tab's next commit refuses as a stale base.
  for (const table of OBJECTS_0023.tables) {
    assert.deepEqual((await db.query(`select count(*)::int as n from public.${table}`)).rows, [{ n: 0 }], table);
  }
  // The note backstop is back: a 3,001 character note is refused again.
  await assert.rejects(
    db.query(`insert into public.household_actions (profile_id, action_key, title, reason, origin, state, meta)
                values ($1, 'long-note', 'Long note', '', '', 'saved', $2::jsonb)`, [ALICE, JSON.stringify({ note: 'n'.repeat(3001) })]),
    /household_actions_note_check/,
  );
  // The guard is back on the surviving ledger row too.
  await assert.rejects(db.query(`update public.operations set status = 'failed' where operation_id = $1`, [ACTION_OP]), /HALO_OPERATION_SETTLED/);
});

// ---- 0024: six functions and one trigger on public.operations, and no
// table. Backing it out drops all of them and loses nothing: privacy receipts
// stay in the ledger as ordinary rows. These pick up where the 0023 tests
// leave the database, at 0023 reapplied.

const OBJECTS_0024 = {
  functions: [
    'privacy_schema_version()',
    'privacy_fingerprint(uuid, text[])',
    'privacy_counts(uuid, text)',
    'clear_household_records(uuid, uuid, text, text)',
    'purge_privacy_receipts(uuid)',
    'guard_settled_privacy_operation()',
  ],
};
const PRIVACY_OP = '00000000-0000-4000-8000-00000000a024';

async function objects0024() {
  const present = {};
  for (const fn of OBJECTS_0024.functions) present[fn] = await exists(`to_regprocedure('public.${fn}') is not null`);
  present.trigger = await exists(`exists (select 1 from pg_trigger where tgname = 'operations_privacy_settled_guard')`);
  return present;
}

test('0024 applies on top of 0023 and adds exactly its six functions and the privacy guard', async () => {
  await db.applyMigration(migration(24));
  audit24 = await runAudit(db);
  const present = await objects0024();
  assert.deepEqual(present, Object.fromEntries(Object.keys(present).map((name) => [name, true])));
  // Something that must survive the back-out: alice clears her (empty) journal, which leaves a settled receipt.
  await db.exec(`insert into public.operations (operation_id, profile_id, domain, kind) values ('${PRIVACY_OP}', '${ALICE}', 'privacy', 'privacy.clear.journal')`);
  const { rows } = await db.query(
    `select public.clear_household_records($1, $2, 'journal', public.privacy_fingerprint($1, array['symptom_logs'])) as out`,
    [ALICE, PRIVACY_OP],
  );
  assert.equal(rows[0].out.receipt.status, 'succeeded');
});

test('backing out 0024 removes everything it added and leaves the 0001..0023 schema exactly, 0023 included', async () => {
  await db.exec(docBlock('backout-0024'));

  const present = await objects0024();
  assert.deepEqual(present, Object.fromEntries(Object.keys(present).map((name) => [name, false])));
  const kept = await objects0023();
  assert.deepEqual(kept, Object.fromEntries(Object.keys(kept).map((name) => [name, true])), '0023 stays whole');
  // Nothing is lost: the receipt stays, holding no content, and with the
  // guard gone it is an ordinary ledger row again.
  const { rows: [op] } = await db.query(`select status, result from public.operations where operation_id = $1`, [PRIVACY_OP]);
  assert.deepEqual(op, { status: 'succeeded', result: { operationId: PRIVACY_OP, status: 'succeeded', scope: 'journal' } });
  await db.pg.transaction(async (tx) => {
    await tx.query(`update public.operations set status = 'failed' where operation_id = $1`, [PRIVACY_OP]);
    await tx.rollback();
  });
  assert.deepEqual((await db.query(`select score from public.daily_scores where profile_id = $1`, [ALICE])).rows, [{ score: 61 }]);
  assert.deepEqual(await runAudit(db), audit23);
});

test('backing out 0024 is safe to run twice', async () => {
  await db.exec(docBlock('backout-0024'));
  assert.deepEqual(await runAudit(db), audit23);
});

test('the 0024 back-out drops the trigger before the function it runs, as the migration file does', () => {
  const statements = docBlock('backout-0024').split(';').map((part) => part.trim()).filter(Boolean);
  const at = (needle) => statements.findIndex((statement) => statement.includes(needle));
  assert.ok(at('drop trigger if exists operations_privacy_settled_guard') >= 0);
  assert.ok(at('drop trigger if exists operations_privacy_settled_guard') < at('drop function if exists public.guard_settled_privacy_operation()'));
  const fileBlock = migration(24).sql.split('<!-- backout-0024 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0024').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});

test('after the back-out, 0024 applies again and gives exactly the schema one pass gives', async () => {
  await db.applyMigration(migration(24));
  assert.deepEqual(await runAudit(db), audit24);
  // The guard is back on the surviving receipt.
  await assert.rejects(db.query(`update public.operations set status = 'failed' where operation_id = $1`, [PRIVACY_OP]), /HALO_OPERATION_SETTLED/);
});

test('the read-only profiles check before 0024 returns no rows, and names a column the reset does not', async () => {
  const check = docBlock('check-0024-profiles');
  assert.deepEqual((await db.query(check)).rows, []);
  const named = await db.pg.transaction(async (tx) => {
    await tx.exec(`alter table public.profiles add column nickname text`);
    const { rows } = await tx.query(check);
    await tx.rollback();
    return rows;
  });
  assert.deepEqual(named, [{ column_name: 'nickname' }]);
  // It is the same list the migration's own verification column uses.
  const list = (text) => text.match(/column_name not in \(([^)]*)\)/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(list(check), list(migration(24).sql.replace(/\n--\s*/g, '\n')));
});

// ---- remedy-truncate: the privilege row level security does not govern.
// 0015 revoked INSERT, UPDATE and DELETE on the four written tables, but
// TRUNCATE, REFERENCES and TRIGGER were left in place by Supabase's default
// privileges on every public table. RLS does not apply to TRUNCATE, so the
// grant is not inert the way the write grants are: it would let a signed-in
// role empty a table outright. The 2026-10-17 production catalog shows it
// live there. Nothing reachable exposes it (PostgREST has no TRUNCATE verb and
// no callable function issues one), so this is defence in depth, not an open
// door, which is why it is a documented remedy rather than a migration.

test('before the remedy, an authenticated role can truncate household tables even though DELETE is denied', async () => {
  const db2 = await createDb();
  await db2.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true)`);
  await assert.rejects(
    () => db2.asRole('authenticated', ALICE, (tx) => tx.query('delete from public.symptom_logs')),
    /permission denied/i,
    'DELETE is denied, because row level security governs it',
  );
  // And yet TRUNCATE is allowed, which is the whole point of the remedy.
  await db2.asRole('authenticated', ALICE, (tx) => tx.query('truncate public.symptom_logs'));
  await db2.close();
});

test('the remedy removes truncate, references and trigger from both browser roles on every public table', async () => {
  const db2 = await createDb();
  await db2.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true)`);
  await db2.exec(docBlock('remedy-truncate'));

  for (const table of TRUNCATABLE) {
    for (const role of API_ROLES) {
      for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const { rows: [row] } = await db2.query(
          `select has_table_privilege($1, $2, $3) as held`,
          [role, table, privilege],
        );
        assert.equal(row.held, false, `${role} no longer holds ${privilege} on ${table}`);
      }
    }
  }
  await assert.rejects(
    () => db2.asRole('authenticated', ALICE, (tx) => tx.query('truncate public.symptom_logs')),
    /permission denied/i,
    'the owner can no longer empty the table',
  );
  await db2.close();
});

test('the remedy leaves the reads the app depends on working', async () => {
  const db2 = await createDb();
  await db2.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true)`);
  await db2.asService(
    (tx) => tx.exec(`insert into public.symptom_logs (profile_id, entry_date, symptoms) values ('${ALICE}', '2026-09-10', array['cough'])`),
    { commit: true },
  );
  await db2.exec(docBlock('remedy-truncate'));

  // The owner still reads their own rows, and the public reference tables are still readable.
  const own = await db2.asRole('authenticated', ALICE, (tx) => tx.query('select count(*)::int as n from public.symptom_logs'));
  assert.equal(own.rows[0].n, 1, 'the owner still sees their own journal');
  const reference = await db2.asRole('anon', ALICE, (tx) => tx.query('select count(*)::int as n from public.learn_content'));
  assert.ok(Number.isInteger(reference.rows[0].n), 'public reference content is still readable');
  // The service role, which every route uses, is untouched.
  for (const table of TRUNCATABLE) {
    const { rows: [row] } = await db2.query(`select has_table_privilege('service_role', $1, 'TRUNCATE') as held`, [table]);
    assert.equal(row.held, true, `service_role keeps TRUNCATE on ${table}`);
  }
  await db2.close();
});

test('the remedy is safe to run twice', async () => {
  const db2 = await createDb();
  await db2.exec(docBlock('remedy-truncate'));
  const first = await runAudit(db2);
  await db2.exec(docBlock('remedy-truncate'));
  assert.deepEqual(await runAudit(db2), first);
  await db2.close();
});
