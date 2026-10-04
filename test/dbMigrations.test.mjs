/**
 * The migrations against the reconstructed baseline, on a local in-memory
 * PGlite database (test/db/pgliteHarness.mjs).
 *
 * 1. Every migration applies cleanly, in numeric order, on the baseline, and
 *    applies again straight away (each file says it is safe to re-run).
 * 2. Every migration also re-applies over the fully migrated schema, which is
 *    what pasting an old file into the SQL editor again would do, and doing so
 *    leaves the schema exactly as one pass did.
 * 3. docs/backend/baseline-audit.sql is one read-only statement that returns one
 *    JSON document describing the schema and no table rows.
 *
 * The baseline is reconstructed, not captured from the deployed database
 * (docs/backend/baseline.md): passing here means the migrations agree with the
 * reconstruction, not that they match the HALO project.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  AUDIT_FILE,
  MIGRATION_FILE,
  MIGRATIONS_DIR,
  createDb,
  listMigrations,
  runAudit,
} from './db/pgliteHarness.mjs';

const migrations = listMigrations();

const AUDIT_SECTIONS = [
  'audit_version', 'server_version_num', 'tables', 'policies', 'foreign_keys', 'functions', 'table_grants',
  'function_grants', 'triggers', 'extensions', 'roles', 'default_privileges', 'auth_users_columns',
  'supabase_migrations_ledger',
];

let db;
let onePass;

before(async () => {
  db = await createDb({ migrations: false });
});

after(async () => {
  await db?.close();
});

test('every file in supabase/migrations is a migration numbered 0001 upward without gaps or repeats', () => {
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => !name.startsWith('.'))) {
    assert.match(file, MIGRATION_FILE, `${file} is not named NNNN_snake_case.sql, so the harness would never apply it`);
  }
  assert.ok(migrations.length >= 14, `expected at least 0001..0014, found ${migrations.length}`);
  assert.deepEqual(
    migrations.map((migration) => migration.number),
    migrations.map((_, index) => index + 1),
    `migration numbers must run 1, 2, 3, ... with no gap or repeat: ${migrations.map((m) => m.name).join(', ')}`,
  );
});

for (const migration of migrations) {
  test(`${migration.name} applies cleanly in order on the baseline`, async () => {
    await db.applyMigration(migration);
  });

  test(`${migration.name} applies a second time straight away`, async () => {
    await db.applyMigration(migration);
  });
}

test('one pass of every migration gives a schema with row level security on every public table', async () => {
  onePass = await runAudit(db); // the replay below is compared against this
  assert.ok(onePass.tables.length >= 14, `expected the baseline and migration tables, found ${onePass.tables.length}`);
  for (const table of onePass.tables) assert.equal(table.rls_enabled, true, `public.${table.table} has row level security off`);
});

for (const migration of migrations) {
  test(`${migration.name} re-applies over the fully migrated schema`, async () => {
    await db.applyMigration(migration);
  });
}

test('replaying every migration leaves the schema exactly as one pass did', async () => {
  assert.deepEqual(await runAudit(db), onePass);
});

test('0007 still builds its HNSW index on a fresh database, and a re-run after 0013 leaves it off', async () => {
  const indexes = async (target) =>
    (await target.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'assistant_corpus_embedding'`)).rows
      .map((row) => row.indexdef);
  const fresh = await createDb({ upTo: 7 });
  try {
    assert.deepEqual(await indexes(fresh), [
      'CREATE INDEX assistant_corpus_embedding ON public.assistant_corpus USING hnsw (embedding extensions.vector_cosine_ops)',
    ]);
  } finally {
    await fresh.close();
  }
  // db has had every migration applied twice over, 0007 after 0013 included: 2,048 dimensions, no HNSW index.
  assert.deepEqual(await indexes(db), []);
});

test('the catalog audit is exactly one statement and starts with WITH (runAudit runs it read-only)', () => {
  const statements = readFileSync(AUDIT_FILE, 'utf8')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.length, 1, 'the SQL editor shows only the last result, so the audit must be one statement');
  assert.match(statements[0], /^with\b/i);
});

test('the catalog audit runs in a read-only transaction and describes the migrated schema as one JSON document', async () => {
  const audit = await runAudit(db);
  assert.deepEqual(Object.keys(audit), AUDIT_SECTIONS);

  const { rows: tables } = await db.query(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
  );
  assert.deepEqual(audit.tables.map((table) => table.table), tables.map((table) => table.relname));
  assert.deepEqual(audit.tables.map((table) => table.rls_enabled), tables.map((table) => table.relrowsecurity));
  const { rows: [{ policies }] } = await db.query(`select count(*)::int as policies from pg_policies where schemaname = 'public'`);
  assert.equal(audit.policies.length, policies);

  const symptomLogs = audit.tables.find((table) => table.table === 'symptom_logs');
  assert.deepEqual(
    symptomLogs.columns.find((column) => column.name === 'symptoms'),
    { name: 'symptoms', type: 'text[]', nullable: false, default: "'{}'::text[]" },
  );
  assert.deepEqual(
    audit.foreign_keys.find((key) => key.table === 'profiles'),
    {
      table: 'profiles',
      constraint: 'profiles_id_fkey',
      references: 'auth.users',
      definition: 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE',
      on_delete: 'cascade',
    },
  );
  assert.deepEqual(
    audit.function_grants.find((grant) => grant.function === 'match_assistant_corpus'),
    {
      function: 'match_assistant_corpus',
      arguments: 'query_embedding extensions.vector, match_count integer, min_similarity double precision',
      anon_execute: false,
      authenticated_execute: false,
      service_role_execute: true,
    },
  );
  assert.equal(audit.functions.find((fn) => fn.function === 'handle_new_user').security_definer, true);
  assert.equal(audit.supabase_migrations_ledger, null, 'no supabase_migrations schema here, so the ledger is null, not an error');
});

test('the catalog audit leaves NOT NULL out of constraints, so Postgres 18 and older servers compare', async () => {
  // Postgres 18 stores each NOT NULL as a pg_constraint row (contype 'n'); older majors do not.
  // Nullability is already reported per column.
  const audit = await runAudit(db);
  const types = new Set(['primary key', 'unique', 'check', 'exclusion']);
  const unexpected = audit.tables.flatMap((table) =>
    table.constraints.filter((constraint) => !types.has(constraint.type)).map((constraint) => `${table.table}.${constraint.name} (${constraint.type})`),
  );
  assert.deepEqual(unexpected, []);
  assert.equal(audit.tables.find((table) => table.table === 'profiles').columns.find((column) => column.name === 'id').nullable, false);
});

test('the catalog audit reports column-level grants to anon and authenticated', async () => {
  const audit = await runAudit(db);
  assert.ok(audit.table_grants.every((grant) => Array.isArray(grant.column_grants)), 'every table_grants entry has column_grants');

  // Rolled back: narrow profiles updates to two columns and give anon one column of a service-only table.
  const narrowed = await db.pg.transaction(async (tx) => {
    await tx.exec(`revoke update on public.profiles from authenticated;
      grant update (county, water_source) on public.profiles to authenticated;
      grant select (pwsid) on public.water_snapshots to anon;`);
    const { rows } = await tx.query(readFileSync(AUDIT_FILE, 'utf8'));
    await tx.rollback();
    return rows[0].halo_baseline_audit.table_grants;
  });
  const columnGrants = Object.fromEntries(narrowed.map((grant) => [grant.table, grant.column_grants]));
  // The revoke cleared any earlier UPDATE column grants on profiles, so these two are all of them.
  assert.deepEqual(
    columnGrants.profiles.filter((grant) => grant.grantee === 'authenticated' && grant.privilege === 'UPDATE'),
    [
      { column: 'county', grantee: 'authenticated', privilege: 'UPDATE' },
      { column: 'water_source', grantee: 'authenticated', privilege: 'UPDATE' },
    ],
  );
  assert.ok(
    columnGrants.water_snapshots.some((grant) => grant.column === 'pwsid' && grant.grantee === 'anon' && grant.privilege === 'SELECT'),
    'anon SELECT on water_snapshots.pwsid is reported',
  );
  assert.equal(narrowed.find((grant) => grant.table === 'profiles').authenticated.includes('UPDATE'), false, 'no table-level UPDATE left');
});

test('the catalog audit returns no table rows', async () => {
  const marker = 'audit-must-not-show-this';
  await db.pg.transaction(async (tx) => {
    await tx.query(`insert into auth.users (id, email) values ('a0d17000-0000-4000-8000-000000000001', $1)`, [`${marker}@example.test`]);
    await tx.query(`update public.profiles set county = $1 where id = 'a0d17000-0000-4000-8000-000000000001'`, [marker]);
    await tx.query(
      `insert into public.symptom_logs (profile_id, entry_date, note) values ('a0d17000-0000-4000-8000-000000000001', '2026-09-01', $1)`,
      [marker],
    );
    const { rows } = await tx.query(readFileSync(AUDIT_FILE, 'utf8'));
    assert.doesNotMatch(JSON.stringify(rows[0].halo_baseline_audit), new RegExp(marker));
    await tx.rollback();
  });
});

test('the catalog audit lists the supabase_migrations ledger when present, with version and name only', async () => {
  const ledgerWith = async (columns, values) =>
    db.pg.transaction(async (tx) => {
      await tx.exec(`create schema supabase_migrations;
        create table supabase_migrations.schema_migrations (${columns});
        insert into supabase_migrations.schema_migrations values ${values};`);
      const { rows } = await tx.query(readFileSync(AUDIT_FILE, 'utf8'));
      await tx.rollback();
      return rows[0].halo_baseline_audit.supabase_migrations_ledger;
    });

  const full = await ledgerWith(
    'version text primary key, statements text[], name text, created_by text',
    `('20260102000000', array['select 2'], 'household_and_profile', 'someone@example.test'),
     ('20260101000000', array['select 1'], 'anon_auth', 'someone@example.test')`,
  );
  assert.deepEqual(full, [
    { version: '20260101000000', name: 'anon_auth' },
    { version: '20260102000000', name: 'household_and_profile' },
  ]);

  // Older ledgers have no name column.
  const versionOnly = await ledgerWith('version text primary key, statements text[]', `('20260101000000', array['select 1'])`);
  assert.deepEqual(versionOnly, [{ version: '20260101000000', name: null }]);
});
