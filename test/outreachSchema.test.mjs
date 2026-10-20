/**
 * Migration 0031 on PGlite (B17 plan, docs/backend/plans/b17-outreach-preparation.md):
 * the draft table, the save, read and count functions, the settled guard,
 * the clear-all trigger, the one-paste bundle and the back-out, on the
 * reconstructed baseline plus every migration (test/db/pgliteHarness.mjs).
 * Each scenario runs as the service role inside a transaction that is rolled
 * back; a call expected to refuse runs inside a savepoint, the
 * statement-level atomicity a PostgREST RPC has.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, applySql, createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { BUNDLES, OUT_DIR, buildBundle, buildVerify } from '../scripts/build-apply-bundle.mjs';
import { fingerprintTables } from '../lib/privacyInventory.js';

const MIGRATION = listMigrations().find((migration) => migration.number === 31);
const BEFORE = MIGRATION.number - 1;
const BUNDLE = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0031.sql');
const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');
const ALICE = 'a11ce000-0000-4000-8000-0000000003a1';
const BOB = 'b0b00000-0000-4000-8000-0000000003b2';

function docBlock(name) {
  const lines = TODO.split('\n');
  const at = lines.findIndex((line) => line.trim() === `<!-- ${name} -->`);
  assert.ok(at >= 0, `YOUR_TODO.md has no <!-- ${name} -->`);
  const open = lines.findIndex((line, index) => index > at && line.trim() === '```sql');
  const close = lines.findIndex((line, index) => index > open && line.trim() === '```');
  return lines.slice(open + 1, close).join('\n');
}

let db;
before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`);
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
async function claim(tx, { owner = ALICE, domain = 'outreach', kind = 'outreach.prepare', status = 'pending' } = {}) {
  const id = crypto.randomUUID();
  await tx.query('insert into public.operations (operation_id, profile_id, domain, kind, status, result) values ($1, $2, $3, $4, $5, $6)',
    [id, owner, domain, kind, status, status === 'pending' ? null : JSON.stringify({ status })]);
  return id;
}
const ledger = async (tx, op) => (await tx.query('select status, result from public.operations where operation_id = $1', [op])).rows[0];

const draft = (over = {}) => ({
  id: crypto.randomUUID(), key: 'Local office|office@example.org', recipient: 'Local office', topic: 'Drinking water', water: 'Utility',
  area: { id: 'us-county:37183', place: 'Wake County', state: 'NC', label: 'Wake County, NC', timezone: 'America/New_York' },
  name: 'Office', to: 'office@example.org', subject: 'A question', body: 'PRIVATE-BODY Hello.', notes: [], publicContext: null,
  signatureHash: 'a'.repeat(64), ...over,
});
async function save(tx, value, { owner = ALICE, op } = {}) {
  const operation = op ?? await claim(tx, { owner });
  const outcome = await attempt(tx, 'select public.save_outreach_draft($1, $2, $3::jsonb) as out', [owner, operation, JSON.stringify(value)]);
  return { ...outcome, operation, out: outcome.ok ? outcome.rows[0].out : null };
}
const read = async (tx, owner = ALICE, id = null) => (await tx.query('select public.read_outreach_drafts($1, $2) as r', [owner, id])).rows[0].r;

/** A saved Explore note through the real 0026 commit. */
async function note(tx, owner = ALICE, id = 'note-1') {
  const op = await claim(tx, { owner, domain: 'workspace', kind: 'workspace.write' });
  await tx.query('select public.commit_household_workspace($1, $2, $3::jsonb)', [owner, op, JSON.stringify({
    upserts: [{ collection: 'exploreNotes', id, expectedRevision: null, record: { id, title: 'Foam', revision: 0, description: 'On the creek' } }], collections: ['exploreNotes'],
  })]);
}

// ---------------------------------------------------------------------------
// Applying, verifying and the bundle
// ---------------------------------------------------------------------------

test('0031 applies over every earlier migration, re-applies to the same schema, and its bundle and check pass twice', async () => {
  assert.ok(BUNDLE, 'no apply-0031.sql bundle in BUNDLES');
  assert.deepEqual([...BUNDLE.migrations], ['0031_outreach_drafts']);
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.bundleFile), 'utf8'), buildBundle(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.verifyFile), 'utf8'), buildVerify(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  const fresh = await createDb({ upTo: BEFORE });
  try {
    await fresh.applyMigration(MIGRATION);
    const once = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), once);
    for (let pass = 0; pass < 2; pass += 1) {
      await applySql(fresh.pg, 'the 0031 bundle', buildBundle(BUNDLE));
      const { rows: [row] } = await fresh.query(buildVerify(BUNDLE));
      assert.deepEqual({ ...row, checks_run: Number(row.checks_run) }, { all_migrations_ok: true, checks_run: 7, failing: 'none' });
    }
  } finally {
    await fresh.close();
  }
});

test('0031 needs only 0017: it applies right after the ledger, and a draft without notes saves there', async () => {
  const fresh = await createDb({ upTo: 17 });
  try {
    await fresh.applyMigration(MIGRATION);
    await fresh.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true)`);
    const op = crypto.randomUUID();
    await fresh.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'outreach', 'outreach.prepare', 'pending')`, [op, ALICE]);
    const { rows: [{ out }] } = await fresh.query('select public.save_outreach_draft($1, $2, $3::jsonb) as out', [ALICE, op, JSON.stringify(draft())]);
    assert.equal(out.draft.revision, 1);
    // A note needs 0026's table, which is not there: the database's own error, which the route never reaches (it refuses notes first).
    const op2 = crypto.randomUUID();
    await fresh.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'outreach', 'outreach.prepare', 'pending')`, [op2, ALICE]);
    await assert.rejects(fresh.query('select public.save_outreach_draft($1, $2, $3::jsonb)', [ALICE, op2, JSON.stringify(draft({ notes: [{ id: 'n', revision: 1 }] }))]), /household_workspace_records/);
  } finally {
    await fresh.close();
  }
});

// ---------------------------------------------------------------------------
// The save
// ---------------------------------------------------------------------------

test('a save creates the draft, settles its own ledger row with ids only, and returns the draft as the routes answer it', async () => {
  await scenario(async (tx) => {
    const value = draft();
    const saved = await save(tx, value);
    assert.equal(saved.ok, true);
    const { receipt, draft: out } = saved.out;
    assert.deepEqual(receipt, { status: 'succeeded', draftId: value.id, revision: 1, unresolvedOperations: [] });
    assert.deepEqual(
      Object.keys(out).sort(),
      ['area', 'body', 'createdAt', 'delivery', 'expiresAt', 'from', 'id', 'name', 'notes', 'publicContext', 'recipient', 'revision', 'status', 'subject', 'to', 'topic', 'updatedAt', 'water'],
    );
    assert.deepEqual([out.status, out.delivery, out.from, out.expiresAt, out.to, out.body], ['draft', 'copy', null, null, 'office@example.org', 'PRIVATE-BODY Hello.']);
    const row = await ledger(tx, saved.operation);
    assert.equal(row.status, 'succeeded');
    assert.ok(!JSON.stringify(row.result).includes('PRIVATE-BODY'));
    assert.deepEqual(await read(tx), [out]);
    assert.deepEqual(await read(tx, ALICE, value.id), [out]);
    assert.deepEqual(await read(tx, BOB), []);
    assert.deepEqual(await read(tx, BOB, value.id), [], 'another household\'s id is not found');
  });
});

test('the same key: identical content keeps the revision and the id, changed content raises it by one; another key is another draft', async () => {
  await scenario(async (tx) => {
    const first = await save(tx, draft());
    const same = await save(tx, draft());
    assert.deepEqual([same.out.draft.id, same.out.draft.revision], [first.out.draft.id, 1]);
    const changed = await save(tx, draft({ body: 'PRIVATE-BODY Changed.' }));
    assert.deepEqual([changed.out.draft.id, changed.out.draft.revision], [first.out.draft.id, 2]);
    const area = await save(tx, draft({ body: 'PRIVATE-BODY Changed.', area: null }));
    assert.equal(area.out.draft.revision, 3, 'the area is part of the content');
    const other = await save(tx, draft({ key: 'Local office|', to: '' }));
    assert.notEqual(other.out.draft.id, first.out.draft.id);
    assert.equal((await read(tx)).length, 2);
    // Bob's draft with alice's key is his own.
    const bobs = await save(tx, draft(), { owner: BOB });
    assert.equal(bobs.out.draft.revision, 1);
    assert.equal((await read(tx)).length, 2);
  });
});

test('refusals: a note not at its revision or another household\'s, a ledger row that is not this household\'s pending outreach row, the limit, malformed input', async () => {
  await scenario(async (tx) => {
    await note(tx, ALICE, 'note-a');
    await note(tx, BOB, 'note-b');
    assert.equal((await save(tx, draft({ notes: [{ id: 'note-a', revision: 1, title: 'Foam', description: 'On the creek' }] }))).ok, true);
    assert.equal(refusal(await save(tx, draft({ notes: [{ id: 'note-a', revision: 2 }] }))), 'HALO_STALE_REVISION');
    assert.equal(refusal(await save(tx, draft({ notes: [{ id: 'note-b', revision: 1 }] }))), 'HALO_STALE_REVISION');
    assert.equal(refusal(await save(tx, draft({ notes: [{ id: 'note-a', revision: 1.5 }] }))), 'HALO_STALE_REVISION');

    const settled = await claim(tx, { status: 'succeeded' });
    assert.equal(refusal(await save(tx, draft(), { op: settled })), 'HALO_OPERATION_NOT_PENDING');
    const bobs = await claim(tx, { owner: BOB });
    assert.equal(refusal(await save(tx, draft(), { op: bobs })), 'HALO_OPERATION_NOT_PENDING');
    const workspace = await claim(tx, { domain: 'workspace', kind: 'workspace.write' });
    assert.equal(refusal(await save(tx, draft(), { op: workspace })), 'HALO_OPERATION_NOT_PENDING');

    assert.equal(refusal(await save(tx, { ...draft(), extra: 1 })), 'HALO_INVALID_INPUT');
    assert.equal(refusal(await save(tx, draft({ id: 'NOT-A-UUID' }))), 'HALO_INVALID_INPUT');
    assert.equal(refusal(await save(tx, draft({ notes: 'x' }))), 'HALO_INVALID_INPUT');
    assert.match(refusal(await save(tx, draft({ recipient: 'Neighbor' }))), /outreach_drafts_recipient_check/);
    assert.match(refusal(await save(tx, draft({ subject: '' }))), /outreach_drafts_text_check/);
    assert.match(refusal(await save(tx, draft({ signatureHash: 'nope' }))), /outreach_drafts_text_check/);

    for (let n = (await read(tx)).length; n < 100; n += 1) assert.equal((await save(tx, draft({ key: `Local office|n${n}@example.org`, to: `n${n}@example.org` }))).ok, true);
    assert.equal(refusal(await save(tx, draft({ key: 'Local office|over@example.org', to: 'over@example.org' }))), 'HALO_LIMIT');
    assert.equal((await save(tx, draft({ body: 'PRIVATE-BODY An edit is still allowed at the limit.' }))).ok, true);
    assert.equal((await read(tx)).length, 100);
  });
});

test('a settled outreach row keeps its status, and a failed save writes nothing', async () => {
  await scenario(async (tx) => {
    const saved = await save(tx, draft());
    const flip = await attempt(tx, `update public.operations set status = 'failed' where operation_id = $1`, [saved.operation]);
    assert.equal(refusal(flip), 'HALO_OPERATION_SETTLED');
    // The same status again (runOperation's own settle) is allowed.
    assert.equal((await attempt(tx, `update public.operations set status = 'succeeded' where operation_id = $1`, [saved.operation])).ok, true);
    const pending = await claim(tx);
    await note(tx);
    assert.equal(refusal(await save(tx, draft({ key: 'x|', to: '', notes: [{ id: 'note-1', revision: 9 }] }), { op: pending })), 'HALO_STALE_REVISION');
    assert.equal((await ledger(tx, pending)).status, 'pending', 'the refused save did not settle its row');
    assert.equal((await read(tx)).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Clear all, account deletion, counts and access
// ---------------------------------------------------------------------------

test('clear all deletes the household\'s drafts inside the clear; clear journal and bob keep theirs; counts say so first', async () => {
  await scenario(async (tx) => {
    await save(tx, draft());
    await save(tx, draft(), { owner: BOB });
    assert.deepEqual((await tx.query('select public.outreach_privacy_counts($1) as c', [ALICE])).rows[0].c, { outreach_drafts: 1 });
    const clear = async (scope) => {
      const op = await claim(tx, { domain: 'privacy', kind: `privacy.clear.${scope}` });
      return attempt(tx, 'select public.clear_household_records($1, $2, $3, public.privacy_fingerprint($1, $4::text[])) as out', [ALICE, op, scope, fingerprintTables(scope)]);
    };
    assert.equal((await clear('journal')).ok, true);
    assert.equal((await read(tx)).length, 1, 'clear journal keeps drafts');
    const all = await clear('all');
    assert.equal(all.ok, true, all.ok ? '' : all.error.message);
    assert.deepEqual(await read(tx), []);
    assert.equal((await read(tx, BOB)).length, 1);
    assert.deepEqual((await tx.query('select public.outreach_privacy_counts($1) as c', [ALICE])).rows[0].c, { outreach_drafts: 0 });
  });
});

test('deleting the account deletes its drafts', async () => {
  const owner = 'de1e7e00-0000-4000-8000-0000000003c3';
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${owner}', true)`);
  const op = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'outreach', 'outreach.prepare', 'pending')`, [op, owner]);
  await db.query('select public.save_outreach_draft($1, $2, $3::jsonb)', [owner, op, JSON.stringify(draft())]);
  assert.equal((await db.query('select count(*)::int as n from public.outreach_drafts where profile_id = $1', [owner])).rows[0].n, 1);
  await db.query('delete from auth.users where id = $1', [owner]);
  assert.equal((await db.query('select count(*)::int as n from public.outreach_drafts where profile_id = $1', [owner])).rows[0].n, 0);
});

test('neither browser role can read the table or call a function', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select * from public.outreach_drafts')), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select public.read_outreach_drafts($1, null)', [ALICE])), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select public.save_outreach_draft($1, $2, $3::jsonb)', [ALICE, crypto.randomUUID(), '{}'])), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select public.outreach_privacy_counts($1)', [ALICE])), /permission denied/);
  }
});

// ---------------------------------------------------------------------------
// The back-out
// ---------------------------------------------------------------------------

test('the back-out removes exactly what 0031 adds, is safe twice, and 0031 applies again after it; the file and the doc agree', async () => {
  const fresh = await createDb({ upTo: BEFORE });
  try {
    const before = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    const applied = await runAudit(fresh);
    const block = docBlock('backout-0031');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before, 'the schema is exactly what came before 0031 again');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), applied);
  } finally {
    await fresh.close();
  }
  const fileBlock = MIGRATION.sql.split('<!-- backout-0031 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0031').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});
