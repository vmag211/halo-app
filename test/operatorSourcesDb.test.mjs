/**
 * Migration 0027 on a real Postgres (PGlite, test/db/pgliteHarness.mjs): the
 * operator roles and the append-only source operations audit (B13 plan).
 *
 *   - it applies on the migrated schema and again straight away;
 *   - a signed-in browser (anon, authenticated) can neither read nor write
 *     either table, so no client can see or grant a role;
 *   - the audit refuses UPDATE, DELETE and TRUNCATE for every role, the
 *     service role and the owner included;
 *   - the checks hold the role, decision, reason and refusal sets;
 *   - the grant SQL in YOUR_TODO.md 2.18 works and is safe to run twice;
 *   - the bundle and its check are current and pass on 0001 to 0025;
 *   - the back-out block in YOUR_TODO.md removes exactly what 0027 adds.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createDb, applySql, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { BUNDLES, OUT_DIR, buildBundle, buildVerify, verificationQuery } from '../scripts/build-apply-bundle.mjs';

const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');
const MIGRATION = listMigrations().find((m) => m.number === 27);
const BUNDLE = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0027.sql');

const OPERATOR = 'b1300000-0000-4000-8000-000000000001';
const HOUSEHOLD = 'b1300000-0000-4000-8000-000000000002';

/** The ```sql block after `<!-- name -->` in YOUR_TODO.md (as test/migrationBackout.test.mjs reads them). */
function docBlock(name) {
  const lines = TODO.split('\n');
  const at = lines.findIndex((line) => line.trim() === `<!-- ${name} -->`);
  assert.ok(at >= 0, `YOUR_TODO.md has no <!-- ${name} -->`);
  const open = lines.findIndex((line, index) => index > at && line.trim() === '```sql');
  const close = lines.findIndex((line, index) => index > open && line.trim() === '```');
  return lines.slice(open + 1, close).join('\n');
}

/** The grant block in YOUR_TODO.md 2.18, with an id in place of the placeholder. */
function grantSql(id, role = 'publisher') {
  const section = TODO.slice(TODO.indexOf('### 2.18 Apply 0027'));
  const block = section.slice(section.indexOf('```sql') + 6, section.indexOf('```', section.indexOf('```sql') + 6));
  assert.match(block, /insert into public\.operator_roles/);
  return block.replace('<your auth user id>', id).replace("'publisher'", `'${role}'`);
}

const auditRow = (overrides = {}) => ({
  operation_id: crypto.randomUUID(), actor_profile_id: OPERATOR, role: 'reviewer', source_id: 'census-places', source_revision: 1,
  target: 'census-places@2026-10-19', decision: 'approve', reason: 'Checked against the release notes.', locale: null,
  outcome: 'refused', refusal: 'unsupported', ...overrides,
});
const insertAudit = (runner, row) => {
  const columns = Object.keys(row);
  return runner.query(`insert into public.source_ops_audit (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
};

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

test('0027 applies again over itself, and its verification query is all true', async () => {
  await db.applyMigration(MIGRATION);
  const { rows: [checks] } = await db.query(verificationQuery('0027_operator_source_ops'));
  assert.deepEqual(checks, { rls_on: true, no_policies: true, no_client_access: true, audit_append_only: true, ten_checks: true });
});

test('a signed-in browser can neither read nor write a role or an audit entry', async () => {
  await db.query(`insert into public.operator_roles (profile_id, role, granted_by) values ($1, 'publisher', 'test') on conflict do nothing`, [OPERATOR]);
  for (const role of ['anon', 'authenticated']) {
    for (const sql of [
      'select * from public.operator_roles',
      `insert into public.operator_roles (profile_id, role, granted_by) values ('${HOUSEHOLD}', 'publisher', 'me')`,
      `update public.operator_roles set role = 'publisher'`,
      'select * from public.source_ops_audit',
      'delete from public.operator_roles',
    ]) {
      await assert.rejects(db.asRole(role, role === 'anon' ? null : HOUSEHOLD, (tx) => tx.query(sql)), /permission denied/, `${role}: ${sql}`);
    }
  }
  const rows = await db.asService((tx) => tx.query('select role from public.operator_roles where profile_id = $1', [OPERATOR]));
  assert.deepEqual(rows.rows, [{ role: 'publisher' }], 'the service role reads it');
});

test('the audit is append-only for every role, the owner included', async () => {
  await db.asService((tx) => insertAudit(tx, auditRow()), { commit: true });
  for (const sql of ['update public.source_ops_audit set reason = \'Rewritten afterwards.\'', 'delete from public.source_ops_audit', 'truncate public.source_ops_audit']) {
    await assert.rejects(db.asService((tx) => tx.query(sql)), /HALO_AUDIT_APPEND_ONLY/, `service role: ${sql}`);
    await assert.rejects(db.query(sql), /HALO_AUDIT_APPEND_ONLY/, `owner: ${sql}`);
  }
  assert.equal((await db.query('select count(*)::int as n from public.source_ops_audit')).rows[0].n, 1);
  const { rows: [row] } = await db.query('select recorded_at from public.source_ops_audit');
  assert.ok(row.recorded_at instanceof Date, 'the server stamps the time');
});

test('the checks hold the role, decision, reason, locale and outcome sets', async () => {
  const refused = [
    { role: 'admin' },
    { outcome: 'applied', refusal: null, role: 'viewer' },
    { outcome: 'applied', refusal: 'unsupported' },
    { outcome: 'refused', refusal: null },
    { outcome: 'refused', refusal: 'because' },
    { decision: 'delete' },
    { reason: 'short' },
    { reason: '        padded ' },
    { reason: 'x'.repeat(501) },
    { locale: 'fr' },
    { source_id: 'Not An Id' },
    { source_revision: 0 },
    { target: 't'.repeat(201) },
  ];
  for (const overrides of refused) {
    await assert.rejects(db.asService((tx) => insertAudit(tx, auditRow(overrides))), /violates check constraint/, JSON.stringify(overrides));
  }
  for (const overrides of [{ role: 'denied', refusal: 'forbidden' }, { role: 'publisher', outcome: 'applied', refusal: null }, { locale: 'es', decision: 'publish-translation' }]) {
    await db.asService((tx) => insertAudit(tx, auditRow(overrides)));
  }
  await assert.rejects(db.query(`insert into public.operator_roles (profile_id, role, granted_by) values ($1, 'owner', 'test')`, [HOUSEHOLD]), /violates check constraint/);
  await assert.rejects(db.query(`insert into public.operator_roles (profile_id, role, granted_by) values ($1, 'viewer', '  ')`, [HOUSEHOLD]), /violates check constraint/);
});

test('the grant SQL in YOUR_TODO.md grants, changes and is safe to run twice', async () => {
  await db.exec(grantSql(HOUSEHOLD, 'viewer'));
  await db.exec(grantSql(HOUSEHOLD, 'viewer'));
  await db.exec(grantSql(HOUSEHOLD, 'reviewer'));
  assert.deepEqual((await db.query('select role, granted_by from public.operator_roles where profile_id = $1', [HOUSEHOLD])).rows, [{ role: 'reviewer', granted_by: 'vibhav' }]);
});

test('the 0027 bundle and check are committed and current, and pass on 0001 to 0025, twice', async () => {
  assert.ok(BUNDLE, 'no apply-0027.sql bundle in BUNDLES');
  assert.deepEqual([...BUNDLE.migrations], ['0027_operator_source_ops']);
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.bundleFile), 'utf8'), buildBundle(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.verifyFile), 'utf8'), buildVerify(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  const fresh = await createDb({ upTo: 25 });
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      await applySql(fresh.pg, 'the 0027 bundle', buildBundle(BUNDLE));
      const { rows: [row] } = await fresh.query(buildVerify(BUNDLE));
      assert.deepEqual({ ...row, checks_run: Number(row.checks_run) }, { all_migrations_ok: true, checks_run: 5, failing: 'none' });
    }
  } finally {
    await fresh.close();
  }
});

test('the back-out removes exactly what 0027 adds, is safe twice, and 0027 applies again after it', async () => {
  const fresh = await createDb({ upTo: 25 });
  try {
    const before = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    const applied = await runAudit(fresh);
    const block = docBlock('backout-0027');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before, 'the schema is exactly 0001 to 0025 again');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), applied);
  } finally {
    await fresh.close();
  }
  const fileBlock = MIGRATION.sql.split('<!-- backout-0027 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0027').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});
