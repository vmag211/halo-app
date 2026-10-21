/**
 * Migration 0029 on PGlite (B15 plan, docs/backend/plans/b15-saved-summaries.md):
 * the summary table and its immutability, the reads, the commit function's
 * checks (ledger row, current home, exact revisions of workspace records and
 * tasks, the household limit), the settled guard, the clear-all trigger, the
 * account cascade, the client roles' lack of access, the one-paste bundle and
 * the back-out, on the reconstructed baseline plus every migration
 * (test/db/pgliteHarness.mjs). Each scenario runs as the service role inside
 * a transaction that is rolled back; a call expected to refuse runs inside a
 * savepoint, the statement-level atomicity a PostgREST RPC has.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, applySql, createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { BUNDLES, OUT_DIR, buildBundle, buildVerify } from '../scripts/build-apply-bundle.mjs';
import { fingerprintTables } from '../lib/privacyInventory.js';

const MIGRATION = listMigrations().find((migration) => migration.number === 29);
const BUNDLE = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0029.sql');
const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');
const ALICE = 'a11ce000-0000-4000-8000-0000000000a1';
const BOB = 'b0b00000-0000-4000-8000-0000000000b2';
const HOME_A = 'a11ce000-0000-4000-8000-00000000c0a1';
const HOME_B = 'b0b00000-0000-4000-8000-00000000c0b2';
const REPORT_TEXT = 'PRIVATE-REPORT-MARKER the basement note';

/** The ```sql block that follows `<!-- name -->` in YOUR_TODO.md (test/migrationBackout.test.mjs's reader). */
function docBlock(name) {
  const lines = TODO.split('\n');
  const at = lines.findIndex((line) => line.trim() === `<!-- ${name} -->`);
  assert.ok(at >= 0, `YOUR_TODO.md has no <!-- ${name} -->`);
  assert.equal(lines.filter((line) => line.trim() === `<!-- ${name} -->`).length, 1);
  const open = lines.findIndex((line, index) => index > at && line.trim() === '```sql');
  const close = lines.findIndex((line, index) => index > open && line.trim() === '```');
  return lines.slice(open + 1, close).join('\n');
}

let db;
before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`);
  await db.query(`insert into public.home_contexts (id, profile_id, sequence, origin, effective_from) values ($1, $2, 1, 'onboard', now()), ($3, $4, 1, 'onboard', now())`, [HOME_A, ALICE, HOME_B, BOB]);
});
after(async () => { await db?.close(); });

function scenario(fn) {
  return db.pg.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    const result = await fn(tx);
    await tx.rollback();
    return result;
  });
}
async function attempt(tx, sql, params = []) {
  await tx.exec('savepoint attempt');
  try {
    const { rows } = await tx.query(sql, params);
    await tx.exec('release savepoint attempt');
    return { ok: true, rows };
  } catch (error) {
    await tx.exec('rollback to savepoint attempt');
    return { ok: false, error };
  }
}
const refusal = (outcome) => (outcome.ok ? null : outcome.error.message);
async function claim(tx, { owner = ALICE, domain = 'summary', kind = 'summary.prepare', status = 'pending' } = {}) {
  const id = crypto.randomUUID();
  await tx.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, result) values ($1, $2, $3, $4, $5, $6)`,
    [id, owner, domain, kind, status, status === 'pending' ? null : JSON.stringify({ status })]);
  return id;
}
const ledger = async (tx, op) => (await tx.query('select status, result from public.operations where operation_id = $1', [op])).rows[0];

/** A workspace record through the real 0026 commit. */
async function writeRecord(tx, collection, record, { owner = ALICE, expectedRevision = null } = {}) {
  const op = await claim(tx, { owner, domain: 'workspace', kind: 'workspace.write' });
  const out = await attempt(tx, 'select public.commit_household_workspace($1, $2, $3::jsonb) as out', [owner, op, JSON.stringify({
    upserts: [{ collection, id: record.id, expectedRevision, record }], collections: [collection],
  })]);
  assert.ok(out.ok, refusal(out));
}
async function addTask(tx, owner = ALICE) {
  const id = crypto.randomUUID();
  await tx.query(`insert into public.household_actions (id, profile_id, action_key, title, reason, origin, state) values ($1, $2, $3, 'Run the fan', 'Moisture', 'homeguard', 'saved')`, [id, owner, `k-${id}`]);
  return id;
}

/** A composed snapshot as the route sends it (lib/summaryStore.js composeSummary's shape). */
function snapshot({ id = crypto.randomUUID(), home = HOME_A, manifest = [], createdAt = new Date().toISOString(), report } = {}) {
  return {
    id,
    title: 'Household review',
    createdAt,
    homeContextId: home,
    report: report ?? { title: 'Household review', generated: createdAt, introduction: ['Purpose: Household review.'], sections: [{ title: 'Test reports', lines: [REPORT_TEXT] }] },
    selection: { purpose: 'Household review', start: '2026-01-01', end: '2026-12-31', sections: { scores: false, factors: false, tests: true, actions: false, maintenance: false, observations: false, gardens: false }, categories: false, location: false, notes: true, attachments: false, appendix: false, excluded: [] },
    manifest,
    omissions: ['Household categories were not included.'],
  };
}
const commit = (tx, op, summary, owner = ALICE) =>
  attempt(tx, 'select public.commit_household_summary($1, $2, $3::jsonb) as out', [owner, op, JSON.stringify(summary)]);

// ---------------------------------------------------------------------------
// Applying, verifying and the bundle
// ---------------------------------------------------------------------------

test('0029 applies over 0001 to 0028, re-applies to the same schema, and its bundle and check pass twice', async () => {
  assert.ok(BUNDLE, 'no apply-0029.sql bundle in BUNDLES');
  assert.deepEqual([...BUNDLE.migrations], ['0029_household_summaries']);
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.bundleFile), 'utf8'), buildBundle(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.verifyFile), 'utf8'), buildVerify(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  const fresh = await createDb({ upTo: 28 });
  try {
    await fresh.applyMigration(MIGRATION);
    const once = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), once);
    for (let pass = 0; pass < 2; pass += 1) {
      await applySql(fresh.pg, 'the 0029 bundle', buildBundle(BUNDLE));
      const { rows: [row] } = await fresh.query(buildVerify(BUNDLE));
      assert.deepEqual({ ...row, checks_run: Number(row.checks_run) }, { all_migrations_ok: true, checks_run: 7, failing: 'none' });
    }
  } finally {
    await fresh.close();
  }
});

test('0029 needs only 0016, 0017 and 0026: it applies over 0001 to 0026 and saves a summary there', async () => {
  const fresh = await createDb({ upTo: 26 });
  try {
    await fresh.applyMigration(MIGRATION);
    await fresh.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true)`);
    const { rows: [row] } = await fresh.query(buildVerify(BUNDLE));
    assert.equal(row.all_migrations_ok, true);
  } finally {
    await fresh.close();
  }
});

// ---------------------------------------------------------------------------
// The commit
// ---------------------------------------------------------------------------

test('a commit saves the snapshot as sent, settles its own ledger row with the summary id only, and reads back the same createdAt', async () => {
  await scenario(async (tx) => {
    await writeRecord(tx, 'tests', { id: 'test-1', title: 'Kitchen tap', revision: 0 });
    const op = await claim(tx);
    const summary = snapshot({ manifest: [{ kind: 'tests', id: 'test-1', revision: 1, asOf: null }] });
    const out = await commit(tx, op, summary);
    assert.ok(out.ok, refusal(out));
    const saved = out.rows[0].out;
    assert.deepEqual(saved, { ...summary, revision: 1 });
    const row = await ledger(tx, op);
    assert.equal(row.status, 'succeeded');
    assert.deepEqual(row.result, { status: 'succeeded', summaryId: summary.id, unresolvedOperations: [] });
    assert.ok(!JSON.stringify(row.result).includes('PRIVATE-REPORT-MARKER'), 'the ledger holds the id only');
    assert.deepEqual((await tx.query('select public.read_household_summary($1, $2) as s', [ALICE, summary.id])).rows[0].s, saved);
    const list = (await tx.query('select public.read_household_summaries($1, 200) as l', [ALICE])).rows[0].l;
    assert.deepEqual(list, { items: [{ id: summary.id, revision: 1, title: 'Household review', createdAt: summary.createdAt, homeContextId: HOME_A }], complete: true });
    assert.deepEqual((await tx.query('select public.household_summary_usage($1) as u', [ALICE])).rows[0].u, { summaries: 1 });
  });
});

test('a saved summary is immutable: no column of it can be changed, by the service role either; it can be deleted', async () => {
  await scenario(async (tx) => {
    const op = await claim(tx);
    const summary = snapshot();
    assert.ok((await commit(tx, op, summary)).ok);
    for (const sql of [
      `update public.household_summaries set report = '{}'::jsonb where summary_id = $1`,
      `update public.household_summaries set title = 'Water provider questions' where summary_id = $1`,
      `update public.household_summaries set revision = 2 where summary_id = $1`,
      `update public.household_summaries set created_at = now() where summary_id = $1`,
    ]) assert.equal(refusal(await attempt(tx, sql, [summary.id])), 'HALO_SUMMARY_IMMUTABLE', sql);
    assert.ok((await attempt(tx, 'delete from public.household_summaries where summary_id = $1', [summary.id])).ok);
  });
});

test('commit refusals: not this household\'s operation, another domain, settled, the home changed, a stale or foreign record, the limit', async () => {
  await scenario(async (tx) => {
    await writeRecord(tx, 'tests', { id: 'test-1', title: 'Kitchen tap', revision: 0 });
    await writeRecord(tx, 'tests', { id: 'bob-test', title: 'Bob tap', revision: 0 }, { owner: BOB });
    const manifest = [{ kind: 'tests', id: 'test-1', revision: 1, asOf: null }];

    assert.equal(refusal(await commit(tx, await claim(tx, { owner: BOB }), snapshot())), 'HALO_OPERATION_NOT_PENDING', 'bob\'s operation');
    assert.equal(refusal(await commit(tx, await claim(tx, { domain: 'workspace' }), snapshot())), 'HALO_OPERATION_NOT_PENDING', 'another domain');
    assert.equal(refusal(await commit(tx, await claim(tx, { status: 'failed' }), snapshot())), 'HALO_OPERATION_NOT_PENDING', 'settled');
    assert.equal(refusal(await commit(tx, crypto.randomUUID(), snapshot())), 'HALO_OPERATION_NOT_PENDING', 'no row');
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ home: HOME_B }))), 'HALO_HOME_CHANGED', 'bob\'s home');
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ home: null }))), 'HALO_HOME_CHANGED', 'no home while one is current');
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ manifest: [{ ...manifest[0], revision: 2 }] }))), 'HALO_STALE_REVISION', 'a newer revision');
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ manifest: [{ kind: 'tests', id: 'bob-test', revision: 1, asOf: null }] }))), 'HALO_STALE_REVISION', 'bob\'s record');
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ manifest: [{ kind: 'maintenance', id: 'test-1', revision: 1, asOf: null }] }))), 'HALO_STALE_REVISION', 'the wrong collection');
    // After an edit the old revision is stale.
    await writeRecord(tx, 'tests', { id: 'test-1', title: 'Kitchen tap, edited', revision: 1 }, { expectedRevision: 1 });
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ manifest }))), 'HALO_STALE_REVISION');
    assert.equal((await tx.query('select count(*)::int as n from public.household_summaries')).rows[0].n, 0, 'nothing was saved');

    // The limit: 200 saved, the next is refused.
    for (let n = 0; n < 200; n += 1) assert.ok((await commit(tx, await claim(tx), snapshot())).ok);
    const op = await claim(tx);
    assert.equal(refusal(await commit(tx, op, snapshot())), 'HALO_LIMIT');
    assert.equal((await ledger(tx, op)).status, 'pending', 'a refusal settles nothing; the route stores the reason');
    const list = (await tx.query('select public.read_household_summaries($1, 200) as l', [ALICE])).rows[0].l;
    assert.equal(list.items.length, 200);
    assert.equal(list.complete, true);
    assert.equal((await tx.query('select public.read_household_summaries($1, 10) as l', [ALICE])).rows[0].l.complete, false);
  });
});

test('a task in the manifest is checked at its revision; maintenance names the assets collection', async () => {
  await scenario(async (tx) => {
    const task = await addTask(tx);
    const bobTask = await addTask(tx, BOB);
    await writeRecord(tx, 'assets', { id: 'filter-1', title: 'Filter', revision: 0, homeContextId: HOME_A });
    const ok = await commit(tx, await claim(tx), snapshot({ manifest: [{ kind: 'actions', id: task, revision: 1, asOf: null }, { kind: 'maintenance', id: 'filter-1', revision: 1, asOf: null }] }));
    assert.ok(ok.ok, refusal(ok));
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ manifest: [{ kind: 'actions', id: task, revision: 2, asOf: null }] }))), 'HALO_STALE_REVISION');
    assert.equal(refusal(await commit(tx, await claim(tx), snapshot({ manifest: [{ kind: 'actions', id: bobTask, revision: 1, asOf: null }] }))), 'HALO_STALE_REVISION', 'bob\'s task');
  });
});

test('malformed snapshots are refused before anything is read', async () => {
  await scenario(async (tx) => {
    const op = await claim(tx);
    const base = snapshot();
    const noId = { ...base };
    delete noId.id;
    for (const bad of [
      noId,
      { ...base, extra: 1 },
      { ...base, id: 'not-a-uuid' },
      { ...base, createdAt: '2001-01-01T00:00:00.000Z' },
      { ...base, manifest: [{ kind: 'notes', id: 'x', revision: 1, asOf: null }] },
      { ...base, manifest: [{ kind: 'tests', id: 'x', revision: 1.5, asOf: null }] },
      { ...base, manifest: [{ kind: 'tests', id: 'x', revision: 1, asOf: null }, { kind: 'tests', id: 'x', revision: 1, asOf: null }] },
      { ...base, report: [] },
    ]) assert.equal(refusal(await commit(tx, op, bad)), 'HALO_INVALID_INPUT', JSON.stringify(Object.keys(bad)));
    assert.equal((await ledger(tx, op)).status, 'pending');
  });
});

// ---------------------------------------------------------------------------
// The guard, clear all and the cascade
// ---------------------------------------------------------------------------

test('the settled guard: a succeeded summary operation cannot be turned failed, a failed one not succeeded; a pending one is still reaped', async () => {
  await scenario(async (tx) => {
    const op = await claim(tx);
    assert.ok((await commit(tx, op, snapshot())).ok);
    assert.equal(refusal(await attempt(tx, `update public.operations set status = 'failed', result = null where operation_id = $1`, [op])), 'HALO_OPERATION_SETTLED');
    const failed = await claim(tx, { status: 'failed' });
    assert.equal(refusal(await attempt(tx, `update public.operations set status = 'succeeded' where operation_id = $1`, [failed])), 'HALO_OPERATION_SETTLED');
    const pending = await claim(tx);
    assert.ok((await attempt(tx, `update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}'::jsonb where operation_id = $1 and status = 'pending'`, [pending])).ok);
    // Other domains are unaffected by this guard.
    const other = await claim(tx, { domain: 'luna', kind: 'luna.test', status: 'succeeded' });
    assert.ok((await attempt(tx, `update public.operations set status = 'failed' where operation_id = $1`, [other])).ok);
  });
});

test('clear all deletes the household\'s summaries inside the clear; clear journal and bob keep theirs; counts say so', async () => {
  await scenario(async (tx) => {
    assert.ok((await commit(tx, await claim(tx), snapshot())).ok);
    assert.ok((await commit(tx, await claim(tx, { owner: BOB }), snapshot({ home: HOME_B }), BOB)).ok);
    assert.deepEqual((await tx.query('select public.summary_privacy_counts($1) as c', [ALICE])).rows[0].c, { household_summaries: 1 });
    const clear = async (scope) => {
      const op = await claim(tx, { domain: 'privacy', kind: `privacy.clear.${scope}` });
      return attempt(tx, 'select public.clear_household_records($1, $2, $3, public.privacy_fingerprint($1, $4::text[])) as out', [ALICE, op, scope, fingerprintTables(scope)]);
    };
    const journal = await clear('journal');
    assert.ok(journal.ok, refusal(journal));
    assert.equal((await tx.query('select count(*)::int as n from public.household_summaries where profile_id = $1', [ALICE])).rows[0].n, 1, 'clear journal keeps it');
    const all = await clear('all');
    assert.ok(all.ok, refusal(all));
    assert.equal((await tx.query('select count(*)::int as n from public.household_summaries where profile_id = $1', [ALICE])).rows[0].n, 0, 'clear all removes it');
    assert.equal((await tx.query('select count(*)::int as n from public.household_summaries where profile_id = $1', [BOB])).rows[0].n, 1, 'bob keeps his');
  });
});

test('deleting the account cascades the summaries', async () => {
  await scenario(async (tx) => {
    assert.ok((await commit(tx, await claim(tx), snapshot())).ok);
    await tx.exec('reset role');
    await tx.query('delete from auth.users where id = $1', [ALICE]);
    assert.equal((await tx.query('select count(*)::int as n from public.household_summaries')).rows[0].n, 0);
  });
});

test('neither browser role can read, write or call anything 0029 adds', async () => {
  for (const role of ['anon', 'authenticated']) {
    const outcome = await db.pg.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      const results = [];
      for (const sql of [
        'select * from public.household_summaries',
        `select public.read_household_summaries('${ALICE}', 10)`,
        `select public.read_household_summary('${ALICE}', '${ALICE}')`,
        `select public.household_summary_usage('${ALICE}')`,
        `select public.summary_privacy_counts('${ALICE}')`,
        `select public.commit_household_summary('${ALICE}', '${ALICE}', '{}'::jsonb)`,
      ]) results.push(refusal(await attempt(tx, sql)));
      await tx.rollback();
      return results;
    });
    for (const message of outcome) assert.match(message ?? '', /permission denied/, role);
  }
});

// ---------------------------------------------------------------------------
// The back-out
// ---------------------------------------------------------------------------

test('the back-out removes exactly what 0029 adds, is safe twice, and 0029 applies again after it; the file and the doc agree', async () => {
  const fresh = await createDb({ upTo: 28 });
  try {
    const beforeAudit = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    const applied = await runAudit(fresh);
    const block = docBlock('backout-0029');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), beforeAudit, 'the schema is exactly 0001 to 0028 again');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), beforeAudit);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), applied);
  } finally {
    await fresh.close();
  }
  const fileBlock = MIGRATION.sql.split('<!-- backout-0029 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0029').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});
