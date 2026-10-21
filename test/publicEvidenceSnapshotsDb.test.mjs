/**
 * Migration 0033 on a real Postgres (PGlite, test/db/pgliteHarness.mjs): the
 * public water copies and the import's runs (B19 plan,
 * docs/backend/plans/b19-public-evidence-refresh.md).
 *
 *   - it applies on the migrated schema and again straight away, and its
 *     verification query is all true;
 *   - a signed-in browser (anon, authenticated) can neither read nor write
 *     either table, nor call the function;
 *   - the checks hold the sources, reason codes, counts, hash and body;
 *   - record_public_evidence_run refuses malformed input, stores a copy only
 *     for a stored result, and prunes to the newest 8 copies and 200 runs
 *     per source, never the newest copy;
 *   - the bundle and its check are current and pass on 0001 to 0031, twice;
 *   - the back-out block in YOUR_TODO.md removes exactly what 0033 adds.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createDb, applySql, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { BUNDLES, OUT_DIR, buildBundle, buildVerify, verificationQuery } from '../scripts/build-apply-bundle.mjs';

const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');
const MIGRATION = listMigrations().find((m) => m.number === 33);
const BUNDLE = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0033.sql');
const HOUSEHOLD = 'b1900000-0000-4000-8000-000000000001';
const SHA = 'a'.repeat(64);

/** The ```sql block after `<!-- name -->` in YOUR_TODO.md (as test/migrationBackout.test.mjs reads them). */
function docBlock(name) {
  const lines = TODO.split('\n');
  const at = lines.findIndex((line) => line.trim() === `<!-- ${name} -->`);
  assert.ok(at >= 0, `YOUR_TODO.md has no <!-- ${name} -->`);
  assert.equal(lines.filter((line) => line.trim() === `<!-- ${name} -->`).length, 1);
  const open = lines.findIndex((line, index) => index > at && line.trim() === '```sql');
  const close = lines.findIndex((line, index) => index > open && line.trim() === '```');
  return lines.slice(open + 1, close).join('\n');
}

const stored = (source, extra = {}) => ({ source, outcome: 'stored', reason: null, row_count: 3, snapshot: { source_date: '2026-10-13', content_sha256: SHA, body: { releases: [] } }, ...extra });
const failed = (source, reason = 'timeout') => ({ source, outcome: 'failed', reason, row_count: null });
const record = (runner, results) => runner.query('select public.record_public_evidence_run(p_results => $1::jsonb) as result', [JSON.stringify(results)]);
const asService = (results) => db.asService((tx) => record(tx, results), { commit: true });

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.public_evidence_runs; delete from public.public_evidence_snapshots;');
});

test('0033 applies again over itself, and its verification query is all true', async () => {
  assert.ok(MIGRATION, 'no 0033 migration');
  await db.applyMigration(MIGRATION);
  const { rows: [checks] } = await db.query(verificationQuery('0033_public_evidence_snapshots'));
  assert.deepEqual(checks, { rls_on: true, no_policies: true, no_client_access: true, function_service_role_only: true, eight_checks: true });
});

test('a signed-in browser can neither read nor write a copy or a run, nor call the function', async () => {
  await asService([stored('usdm-drought')]);
  for (const role of ['anon', 'authenticated']) {
    for (const sql of [
      'select * from public.public_evidence_snapshots',
      'select * from public.public_evidence_runs',
      `insert into public.public_evidence_runs (source, outcome, reason) values ('usdm-drought', 'failed', 'timeout')`,
      `update public.public_evidence_snapshots set row_count = 1`,
      'delete from public.public_evidence_snapshots',
      `select public.record_public_evidence_run('[]'::jsonb)`,
    ]) {
      await assert.rejects(db.asRole(role, role === 'anon' ? null : HOUSEHOLD, (tx) => tx.query(sql)), /permission denied/, `${role}: ${sql}`);
    }
  }
});

test('the checks hold the source, outcome, reason code, counts, hash and body', async () => {
  const insertSnapshot = (overrides) => {
    const row = { source: 'usdm-drought', source_date: '2026-10-13', row_count: 1, content_sha256: SHA, body: '{}', ...overrides };
    const columns = Object.keys(row);
    return db.query(`insert into public.public_evidence_snapshots (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
  };
  for (const overrides of [{ source: 'nc-fish' }, { row_count: 0 }, { row_count: 10001 }, { content_sha256: 'ABC' }, { body: '[]' }, { body: '"text"' }, { source_date: '1999-12-31' }, { body: JSON.stringify({ big: 'x'.repeat(4_000_001) }) }]) {
    await assert.rejects(insertSnapshot(overrides), /violates check constraint/, JSON.stringify(overrides).slice(0, 80));
  }
  const insertRun = (row) => db.query('insert into public.public_evidence_runs (source, outcome, reason, row_count) values ($1, $2, $3, $4)', [row.source ?? 'usdm-drought', row.outcome, row.reason ?? null, row.row_count ?? null]);
  for (const row of [{ outcome: 'failed' }, { outcome: 'stored', reason: 'timeout' }, { outcome: 'failed', reason: 'the host https://example.test said no' }, { outcome: 'failed', reason: 'http_5000' }, { outcome: 'skipped', reason: null }, { outcome: 'failed', reason: 'timeout', row_count: -1 }, { source: 'other', outcome: 'failed', reason: 'timeout' }]) {
    await assert.rejects(insertRun(row), /violates check constraint/, JSON.stringify(row));
  }
  for (const reason of ['timeout', 'network', 'too_large', 'invalid', 'no_timeout', 'bad_headers', 'shape', 'incomplete', 'bad_date', 'stale', 'internal', 'http_503']) {
    await insertRun({ outcome: 'failed', reason });
  }
});

test('record_public_evidence_run refuses malformed input and changes nothing', async () => {
  for (const bad of [
    {}, [], [stored('usdm-drought'), stored('ncdwr-conservation'), failed('usdm-drought')],
    [stored('usdm-drought'), failed('usdm-drought')],
    [{ source: 'usdm-drought', outcome: 'stored', reason: null, row_count: 3 }],
    [{ ...failed('usdm-drought'), snapshot: { source_date: '2026-10-13', content_sha256: SHA, body: {} } }],
    ['usdm-drought'],
  ]) {
    await assert.rejects(asService(bad), /HALO_INVALID_INPUT/, JSON.stringify(bad).slice(0, 80));
  }
  await assert.rejects(asService([stored('usdm-drought', { snapshot: { source_date: 'soon', content_sha256: SHA, body: {} } })]), /invalid input syntax/);
  await assert.rejects(asService([failed('usdm-drought', 'because')]), /violates check constraint/);
  assert.equal((await db.query('select count(*)::int as n from public.public_evidence_runs')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from public.public_evidence_snapshots')).rows[0].n, 0);
});

test('a stored result keeps a copy and a run pointing at it; a failed one keeps only its run, and the copy survives', async () => {
  const { rows: [{ result }] } = await asService([stored('usdm-drought'), failed('ncdwr-conservation', 'http_503')]);
  assert.equal(result[0].outcome, 'stored');
  assert.ok(Number.isSafeInteger(Number(result[0].snapshotId)));
  assert.equal(result[1].snapshotId, null);
  await asService([failed('usdm-drought', 'incomplete')]);
  const copies = (await db.query('select source, retrieved_at from public.public_evidence_snapshots')).rows;
  assert.equal(copies.length, 1, 'the failed run left the copy alone');
  assert.ok(copies[0].retrieved_at instanceof Date, 'the server stamps the time');
  const runs = (await db.query('select source, outcome, reason, snapshot_id from public.public_evidence_runs order by id')).rows;
  assert.deepEqual(runs.map((r) => [r.source, r.outcome, r.reason, r.snapshot_id !== null]), [
    ['usdm-drought', 'stored', null, true], ['ncdwr-conservation', 'failed', 'http_503', false], ['usdm-drought', 'failed', 'incomplete', false],
  ]);
});

test('each source keeps its newest 8 copies and 200 runs; the newest copy is never pruned and the other source is untouched', async () => {
  await asService([stored('ncdwr-conservation')]);
  for (let n = 1; n <= 11; n += 1) await asService([stored('usdm-drought', { row_count: n })]);
  const counts = (await db.query(`select row_count from public.public_evidence_snapshots where source = 'usdm-drought' order by id`)).rows.map((r) => r.row_count);
  assert.deepEqual(counts, [4, 5, 6, 7, 8, 9, 10, 11], 'the newest 8, the newest last');
  assert.equal((await db.query(`select count(*)::int as n from public.public_evidence_snapshots where source = 'ncdwr-conservation'`)).rows[0].n, 1);
  const pruned = (await db.query(`select count(*)::int as n from public.public_evidence_runs where source = 'usdm-drought' and snapshot_id is null`)).rows[0].n;
  assert.equal(pruned, 3, 'the runs of pruned copies remain, without their link');
  for (let n = 0; n < 205; n += 1) await asService([failed('usdm-drought')]);
  assert.equal((await db.query(`select count(*)::int as n from public.public_evidence_runs where source = 'usdm-drought'`)).rows[0].n, 200);
  assert.equal((await db.query(`select count(*)::int as n from public.public_evidence_runs where source = 'ncdwr-conservation'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.public_evidence_snapshots where source = 'usdm-drought'`)).rows[0].n, 8, 'two hundred failures keep every copy');
});

test('the 0033 bundle and check are committed and current, and pass on 0001 to 0031, twice', async () => {
  assert.ok(BUNDLE, 'no apply-0033.sql bundle in BUNDLES');
  assert.deepEqual([...BUNDLE.migrations], ['0033_public_evidence_snapshots']);
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.bundleFile), 'utf8'), buildBundle(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.verifyFile), 'utf8'), buildVerify(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  const fresh = await createDb({ upTo: 31 });
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      await applySql(fresh.pg, 'the 0033 bundle', buildBundle(BUNDLE));
      const { rows: [row] } = await fresh.query(buildVerify(BUNDLE));
      assert.deepEqual({ ...row, checks_run: Number(row.checks_run) }, { all_migrations_ok: true, checks_run: 5, failing: 'none' });
    }
  } finally {
    await fresh.close();
  }
});

test('the back-out removes exactly what 0033 adds, is safe twice, and 0033 applies again after it', async () => {
  const fresh = await createDb({ upTo: 31 });
  try {
    const beforeAudit = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    const applied = await runAudit(fresh);
    const block = docBlock('backout-0033');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), beforeAudit, 'the schema is exactly 0001 to 0031 again');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), beforeAudit);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), applied);
  } finally {
    await fresh.close();
  }
  const fileBlock = MIGRATION.sql.split('<!-- backout-0033 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0033').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});
