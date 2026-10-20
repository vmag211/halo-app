/**
 * Migration 0028 on PGlite (B14 plan, docs/backend/plans/b14-private-attachments.md):
 * the file table, the deletion queue, the upload, removal, reference, expiry
 * and sweep functions, the settled guard, the clear-all trigger, the guarded
 * bucket block, the one-paste bundle and the back-out, on the reconstructed
 * baseline plus every migration (test/db/pgliteHarness.mjs). Each scenario
 * runs as the service role inside a transaction that is rolled back; a call
 * expected to refuse runs inside a savepoint, the statement-level atomicity a
 * PostgREST RPC has.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, applySql, createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { BUNDLES, OUT_DIR, buildBundle, buildVerify } from '../scripts/build-apply-bundle.mjs';
import { fingerprintTables } from '../lib/privacyInventory.js';

const MIGRATION = listMigrations().find((migration) => migration.number === 28);
const BUNDLE = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0028.sql');
const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');
const ALICE = 'a11ce000-0000-4000-8000-0000000000a1';
const BOB = 'b0b00000-0000-4000-8000-0000000000b2';
const HOME_A = 'a11ce000-0000-4000-8000-00000000c0a1';
const NAME = 'PRIVATE-FILE-NAME kitchen report.jpg';

/** The ```sql block that follows `<!-- name -->` in YOUR_TODO.md (test/migrationBackout.test.mjs's reader). */
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
  await db.query(`insert into public.home_contexts (id, profile_id, sequence, origin, effective_from) values ($1, $2, 1, 'onboard', now())`, [HOME_A, ALICE]);
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
async function claim(tx, { owner = ALICE, domain = 'attachments', kind = 'attachments.upload', status = 'pending' } = {}) {
  const id = crypto.randomUUID();
  await tx.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, result) values ($1, $2, $3, $4, $5, $6)`,
    [id, owner, domain, kind, status, status === 'pending' ? null : JSON.stringify({ status })]);
  return id;
}
const ledger = async (tx, op) => (await tx.query('select status, result from public.operations where operation_id = $1', [op])).rows[0];

/** A workspace record through the real 0026 commit (so 0028's triggers run as in production). */
async function writeRecord(tx, collection, record, { owner = ALICE, expectedRevision = null } = {}) {
  const op = await claim(tx, { owner, domain: 'workspace', kind: 'workspace.write' });
  return attempt(tx, 'select public.commit_household_workspace($1, $2, $3::jsonb) as out', [owner, op, JSON.stringify({
    upserts: [{ collection, id: record.id, expectedRevision, record }], collections: [collection],
  })]);
}
async function removeRecord(tx, collection, id, expectedRevision, owner = ALICE) {
  const op = await claim(tx, { owner, domain: 'workspace', kind: 'workspace.remove' });
  return attempt(tx, 'select public.commit_household_workspace($1, $2, $3::jsonb) as out', [owner, op, JSON.stringify({
    deletes: [{ collection, id, expectedRevision }], collections: [collection],
  })]);
}
const storedRecord = async (tx, collection, id, owner = ALICE) =>
  (await tx.query('select revision, record from public.household_workspace_records where profile_id = $1 and collection = $2 and record_id = $3', [owner, collection, id])).rows[0];

/** One upload through reserve and commit, as the route calls them. */
async function upload(tx, { owner = ALICE, collection = 'observations', recordId = 'obs-1', name = NAME, bytes = 1234, op, reserve = true } = {}) {
  const operation = op ?? await claim(tx, { owner });
  const attachmentId = crypto.randomUUID();
  if (reserve) {
    const reserved = await attempt(tx, 'select public.reserve_attachment_object($1, $2, $3) as path', [owner, operation, attachmentId]);
    if (!reserved.ok) return { ...reserved, operation, attachmentId };
  }
  const outcome = await attempt(tx, 'select public.commit_household_attachment($1, $2, $3::jsonb) as out', [owner, operation, JSON.stringify({
    attachmentId, collection, recordId, name, mime: 'image/jpeg', bytes, width: 40, height: 30,
  })]);
  return { ...outcome, operation, attachmentId, out: outcome.ok ? outcome.rows[0].out : null };
}
const files = async (tx, owner = ALICE) => (await tx.query(
  'select attachment_id::text as id, collection, record_id, linked, object_path from public.household_attachments where profile_id = $1 order by created_at, attachment_id', [owner])).rows;
const queue = async (tx) => (await tx.query('select object_path, due_at <= now() as due from public.attachment_object_sweep order by object_path')).rows;

const testRecord = (id, extra = {}) => ({
  id, title: 'Water test', revision: 0, purpose: '', contextId: HOME_A, medium: 'water', provider: '', sampleLabel: '', method: '', reviewReason: '',
  kind: 'water', status: 'draft', plannedDate: '', collectionStart: '', collectionEnd: '', expectedDate: '', rows: [{ id: 'row-1' }],
  review: 'not_received', archived: false, history: [], ...extra,
});
const observation = (id, extra = {}) => ({ id, title: 'Damp corner', revision: 0, photoData: '', photoName: '', ...extra });

// ---------------------------------------------------------------------------
// Applying, verifying, the bundle and the bucket
// ---------------------------------------------------------------------------

test('0028 applies over 0001 to 0027, re-applies to the same schema, and its bundle and check pass twice with the storage schema absent', async () => {
  assert.ok(BUNDLE, 'no apply-0028.sql bundle in BUNDLES');
  assert.deepEqual([...BUNDLE.migrations], ['0028_household_attachments']);
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.bundleFile), 'utf8'), buildBundle(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(readFileSync(path.join(OUT_DIR, BUNDLE.verifyFile), 'utf8'), buildVerify(BUNDLE), 'run node scripts/build-apply-bundle.mjs');
  const fresh = await createDb({ upTo: 27 });
  try {
    await fresh.applyMigration(MIGRATION);
    const once = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), once);
    for (let pass = 0; pass < 2; pass += 1) {
      await applySql(fresh.pg, 'the 0028 bundle', buildBundle(BUNDLE));
      const { rows: [row] } = await fresh.query(buildVerify(BUNDLE));
      assert.deepEqual({ ...row, checks_run: Number(row.checks_run) }, { all_migrations_ok: true, checks_run: 8, failing: 'none' });
    }
    assert.deepEqual((await fresh.query('select public.attachment_storage_state() as s')).rows[0].s, { storage: false, bucket: false, private: false, policies: 0 });
  } finally {
    await fresh.close();
  }
});

/** A minimal stand-in for Supabase's storage schema: the two tables the block and the check read. */
const FAKE_STORAGE = `
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;`;

test('where the storage schema exists, 0028 creates the private bucket once, and the check reports it and any policy naming it', async () => {
  const fresh = await createDb({ upTo: 27 });
  try {
    await fresh.exec(FAKE_STORAGE);
    await applySql(fresh.pg, 'the 0028 bundle', buildBundle(BUNDLE));
    assert.deepEqual((await fresh.query('select id, name, public, file_size_limit::int as size, allowed_mime_types from storage.buckets')).rows, [
      { id: 'household-attachments', name: 'household-attachments', public: false, size: 15728640, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
    ]);
    await applySql(fresh.pg, 'the 0028 bundle again', buildBundle(BUNDLE));
    assert.equal((await fresh.query('select count(*)::int as n from storage.buckets')).rows[0].n, 1, 'on conflict do nothing');
    const check = async () => (await fresh.query(buildVerify(BUNDLE))).rows[0];
    assert.equal((await check()).all_migrations_ok, true);

    await fresh.exec(`create policy "anyone reads files" on storage.objects for select using (bucket_id = 'household-attachments')`);
    assert.deepEqual((await check()).failing, '0028.no_bucket_policy', 'a storage policy naming the bucket is reported');
    await fresh.exec(`drop policy "anyone reads files" on storage.objects`);

    await fresh.exec(`update storage.buckets set public = true where id = 'household-attachments'`);
    assert.deepEqual((await check()).failing, '0028.bucket_private', 'a public bucket is reported');
    await fresh.exec(`delete from storage.buckets`);
    assert.deepEqual((await check()).failing, '0028.bucket_private', 'a missing bucket is reported');
  } finally {
    await fresh.close();
  }
});

test('a bucket that already exists and is public is left as it is and reported, never silently trusted', async () => {
  const fresh = await createDb({ upTo: 27 });
  try {
    await fresh.exec(`${FAKE_STORAGE} insert into storage.buckets (id, name, public) values ('household-attachments', 'household-attachments', true);`);
    await applySql(fresh.pg, 'the 0028 bundle', buildBundle(BUNDLE));
    assert.equal((await fresh.query(buildVerify(BUNDLE))).rows[0].failing, '0028.bucket_private');
  } finally {
    await fresh.close();
  }
});

// ---------------------------------------------------------------------------
// Upload: reserve, then commit
// ---------------------------------------------------------------------------

test('a staged photo: reserve queues the server-built path an hour ahead, the commit records it, clears the queue and settles with ids only', async () => {
  await scenario(async (tx) => {
    const op = await claim(tx);
    const attachmentId = crypto.randomUUID();
    const reserved = (await tx.query('select public.reserve_attachment_object($1, $2, $3) as path', [ALICE, op, attachmentId])).rows[0].path;
    assert.equal(reserved, `${ALICE}/${attachmentId}`);
    assert.deepEqual(await queue(tx), [{ object_path: reserved, due: false }]);
    const out = (await tx.query('select public.commit_household_attachment($1, $2, $3::jsonb) as out', [ALICE, op, JSON.stringify({
      attachmentId, collection: 'observations', recordId: 'obs-1', name: NAME, mime: 'image/jpeg', bytes: 1234, width: 40, height: 30,
    })])).rows[0].out;
    assert.deepEqual(out.attachment, { id: attachmentId, revision: 1, name: NAME, mime: 'image/jpeg', bytes: 1234, status: 'ready', metadataRemoved: true });
    assert.deepEqual(out.changes, {}, 'a staged photo changes no record');
    assert.deepEqual(out.receipt, { status: 'succeeded', attachmentId, collections: [], unresolvedOperations: [] });
    assert.deepEqual(await queue(tx), []);
    assert.deepEqual(await files(tx), [{ id: attachmentId, collection: 'observations', record_id: 'obs-1', linked: false, object_path: reserved }]);
    const row = await ledger(tx, op);
    assert.equal(row.status, 'succeeded');
    assert.ok(!JSON.stringify(row.result).includes('PRIVATE-FILE-NAME'), 'the ledger never holds the file name');
  });
});

test('a report links to its own saved test at once: the descriptor is appended, the test revision advances, results stay', async () => {
  await scenario(async (tx) => {
    assert.equal((await writeRecord(tx, 'tests', testRecord('test-1'))).ok, true);
    const first = await upload(tx, { collection: 'tests', recordId: 'test-1' });
    assert.equal(first.ok, true, refusal(first));
    assert.deepEqual(first.out.receipt.collections, ['tests']);
    const stored = await storedRecord(tx, 'tests', 'test-1');
    assert.equal(stored.revision, 2);
    assert.deepEqual(stored.record.attachments, [first.out.attachment]);
    assert.deepEqual(stored.record.rows, [{ id: 'row-1' }]);
    assert.deepEqual(first.out.changes.tests.map((row) => [row.id, row.revision, row.attachments.length]), [['test-1', 2, 1]]);
    const second = await upload(tx, { collection: 'tests', recordId: 'test-1', name: 'second.png' });
    assert.deepEqual((await storedRecord(tx, 'tests', 'test-1')).record.attachments.map((item) => item.id), [first.attachmentId, second.attachmentId]);
    assert.deepEqual((await files(tx)).map((file) => file.linked), [true, true]);
  });
});

test('upload refusals: no test, another household\'s test, no reservation, a settled or foreign operation, the limits', async () => {
  await scenario(async (tx) => {
    assert.equal(refusal(await upload(tx, { collection: 'tests', recordId: 'missing-test' })), 'HALO_INVALID_REFERENCE');
    assert.equal((await writeRecord(tx, 'tests', testRecord('bob-test'), { owner: BOB })).ok, true);
    assert.equal(refusal(await upload(tx, { collection: 'tests', recordId: 'bob-test' })), 'HALO_INVALID_REFERENCE', 'bob\'s test is not alice\'s');
    assert.equal(refusal(await upload(tx, { reserve: false })), 'HALO_INVALID_INPUT', 'an object never reserved');
    assert.equal(refusal(await upload(tx, { op: await claim(tx, { status: 'succeeded' }) })), 'HALO_OPERATION_NOT_PENDING');
    assert.equal(refusal(await upload(tx, { op: await claim(tx, { owner: BOB }) })), 'HALO_OPERATION_NOT_PENDING', 'bob\'s operation');
    assert.equal(refusal(await upload(tx, { op: await claim(tx, { domain: 'workspace', kind: 'workspace.write' }) })), 'HALO_OPERATION_NOT_PENDING');
    for (let n = 0; n < 20; n += 1) assert.equal((await upload(tx, { recordId: 'full' })).ok, true);
    assert.equal(refusal(await upload(tx, { recordId: 'full' })), 'HALO_LIMIT', '20 files a record');
    assert.equal(refusal(await upload(tx, { recordId: 'big', bytes: 500 * 1024 * 1024 })), 'HALO_LIMIT', '500 MiB a household');
    assert.equal((await files(tx, BOB)).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Workspace references (Ruling A7)
// ---------------------------------------------------------------------------

test('a workspace write links a staged photo of its own record at its revision, and stores the canonical reference', async () => {
  await scenario(async (tx) => {
    const photo = await upload(tx, { recordId: 'obs-1' });
    const saved = await writeRecord(tx, 'observations', observation('obs-1', {
      homeContextId: HOME_A, photoAttachmentId: photo.attachmentId, photoAttachmentRevision: 1, photoMetadataRemoved: true, photoName: 'x',
    }));
    assert.equal(saved.ok, true, refusal(saved));
    assert.deepEqual((await files(tx)).map((file) => file.linked), [true]);
    const note = await upload(tx, { collection: 'exploreNotes', recordId: 'note-1', name: 'halo-observation.png' });
    const noted = await writeRecord(tx, 'exploreNotes', { id: 'note-1', title: 'Foam', revision: 0, photoAttachment: { id: note.attachmentId, revision: 1, name: 'renamed by client', metadataRemoved: true } });
    assert.equal(noted.ok, true, refusal(noted));
    assert.deepEqual((await storedRecord(tx, 'exploreNotes', 'note-1')).record.photoAttachment,
      { id: note.attachmentId, revision: 1, name: 'halo-observation.png', metadataRemoved: true }, 'the stored name is the file\'s own');
  });
});

test('a workspace write may not name another household\'s file, another record\'s file, a wrong revision or one file twice', async () => {
  await scenario(async (tx) => {
    const bobs = await upload(tx, { owner: BOB, recordId: 'obs-1' });
    const other = await upload(tx, { recordId: 'obs-2' });
    const mine = await upload(tx, { recordId: 'obs-1' });
    const ref = (id, revision = 1) => observation('obs-1', { homeContextId: HOME_A, photoAttachmentId: id, photoAttachmentRevision: revision, photoMetadataRemoved: true });
    assert.equal(refusal(await writeRecord(tx, 'observations', ref(bobs.attachmentId))), 'HALO_INVALID_REFERENCE');
    assert.equal(refusal(await writeRecord(tx, 'observations', ref(other.attachmentId))), 'HALO_INVALID_REFERENCE');
    assert.equal(refusal(await writeRecord(tx, 'observations', ref(mine.attachmentId, 2))), 'HALO_INVALID_REFERENCE');
    assert.equal(refusal(await writeRecord(tx, 'observations', ref('not-a-uuid'))), 'HALO_INVALID_REFERENCE');
    assert.equal((await writeRecord(tx, 'tests', testRecord('t-1'))).ok, true);
    const report = await upload(tx, { collection: 'tests', recordId: 't-1' });
    const twice = { ...report.out.attachment };
    assert.equal(refusal(await writeRecord(tx, 'tests', testRecord('t-1', { attachments: [twice, twice] }), { expectedRevision: 2 })), 'HALO_INVALID_REFERENCE');
    assert.deepEqual((await files(tx, BOB)).map((file) => file.linked), [false], 'bob\'s file is untouched');
  });
});

test('a write that drops a reference deletes that file and queues its object; removing a record deletes its files', async () => {
  await scenario(async (tx) => {
    const photo = await upload(tx, { recordId: 'obs-1' });
    const linked = observation('obs-1', { homeContextId: HOME_A, photoAttachmentId: photo.attachmentId, photoAttachmentRevision: 1, photoMetadataRemoved: true });
    assert.equal((await writeRecord(tx, 'observations', linked)).ok, true);
    const { photoAttachmentId, photoAttachmentRevision, ...dropped } = linked;
    assert.ok(photoAttachmentId && photoAttachmentRevision);
    assert.equal((await writeRecord(tx, 'observations', dropped, { expectedRevision: 1 })).ok, true);
    assert.deepEqual(await files(tx), []);
    assert.deepEqual(await queue(tx), [{ object_path: `${ALICE}/${photo.attachmentId}`, due: true }]);

    assert.equal((await writeRecord(tx, 'tests', testRecord('t-1'))).ok, true);
    const report = await upload(tx, { collection: 'tests', recordId: 't-1' });
    const staged = await upload(tx, { collection: 'tests', recordId: 't-1' });
    assert.equal((await removeRecord(tx, 'tests', 't-1', 3)).ok, true);
    assert.deepEqual(await files(tx), []);
    assert.deepEqual((await queue(tx)).map((row) => row.object_path).sort(),
      [photo.attachmentId, report.attachmentId, staged.attachmentId].map((id) => `${ALICE}/${id}`).sort());
  });
});

test('an editing write keeps the files it still names, and a test write keeps the canonical descriptor whatever the client sent', async () => {
  await scenario(async (tx) => {
    assert.equal((await writeRecord(tx, 'tests', testRecord('t-1'))).ok, true);
    const report = await upload(tx, { collection: 'tests', recordId: 't-1' });
    const forged = { ...report.out.attachment, name: 'forged.pdf', mime: 'application/pdf', bytes: 1, status: 'ready' };
    const saved = await writeRecord(tx, 'tests', testRecord('t-1', { status: 'arranged', attachments: [forged] }), { expectedRevision: 2 });
    assert.equal(saved.ok, true, refusal(saved));
    const stored = await storedRecord(tx, 'tests', 't-1');
    assert.equal(stored.record.status, 'arranged');
    assert.deepEqual(stored.record.attachments, [report.out.attachment]);
    assert.equal((await files(tx)).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Removal (Ruling A8)
// ---------------------------------------------------------------------------

test('removal at the exact revision: the row goes, the record loses only that reference, the object is queued, the receipt is ids only', async () => {
  await scenario(async (tx) => {
    assert.equal((await writeRecord(tx, 'tests', testRecord('t-1'))).ok, true);
    const keep = await upload(tx, { collection: 'tests', recordId: 't-1' });
    const gone = await upload(tx, { collection: 'tests', recordId: 't-1' });
    const op = await claim(tx, { kind: 'attachments.remove' });
    const out = (await tx.query('select public.remove_household_attachment($1, $2, $3, 1) as out', [ALICE, op, gone.attachmentId])).rows[0].out;
    assert.equal(out.objectPath, `${ALICE}/${gone.attachmentId}`);
    assert.deepEqual(out.receipt, { status: 'succeeded', attachmentId: gone.attachmentId, collections: ['tests'], unresolvedOperations: [] });
    const row = out.changes.tests[0];
    assert.deepEqual([row.revision, row.attachments.map((item) => item.id), row.rows], [4, [keep.attachmentId], [{ id: 'row-1' }]]);
    assert.deepEqual(await queue(tx), [{ object_path: out.objectPath, due: true }]);

    const photo = await upload(tx, { recordId: 'obs-1' });
    assert.equal((await writeRecord(tx, 'observations', observation('obs-1', { homeContextId: HOME_A, photoName: 'p.jpg', photoAttachmentId: photo.attachmentId, photoAttachmentRevision: 1, photoMetadataRemoved: true }))).ok, true);
    const op2 = await claim(tx, { kind: 'attachments.remove' });
    const out2 = (await tx.query('select public.remove_household_attachment($1, $2, $3, 1) as out', [ALICE, op2, photo.attachmentId])).rows[0].out;
    const obs = out2.changes.observations[0];
    assert.deepEqual([obs.revision, obs.photoAttachmentId, obs.photoAttachmentRevision, obs.photoName], [2, undefined, undefined, '']);

    const staged = await upload(tx, { collection: 'exploreNotes', recordId: 'note-x' });
    const op3 = await claim(tx, { kind: 'attachments.remove' });
    const out3 = (await tx.query('select public.remove_household_attachment($1, $2, $3, 1) as out', [ALICE, op3, staged.attachmentId])).rows[0].out;
    assert.deepEqual(out3.changes, { exploreNotes: [] }, 'a staged file\'s removal still answers its collection');
  });
});

test('removal refusals: another household\'s file is not found and stays, a stale revision, a foreign operation', async () => {
  await scenario(async (tx) => {
    const bobs = await upload(tx, { owner: BOB });
    const mine = await upload(tx);
    const remove = async (id, revision = 1, op) => attempt(tx, 'select public.remove_household_attachment($1, $2, $3, $4) as out',
      [ALICE, op ?? await claim(tx, { kind: 'attachments.remove' }), id, revision]);
    assert.equal(refusal(await remove(bobs.attachmentId)), 'HALO_NOT_FOUND');
    assert.equal(refusal(await remove(crypto.randomUUID())), 'HALO_NOT_FOUND');
    assert.equal(refusal(await remove(mine.attachmentId, 2)), 'HALO_STALE_REVISION');
    assert.equal(refusal(await remove(mine.attachmentId, 1, await claim(tx, { owner: BOB, kind: 'attachments.remove' }))), 'HALO_OPERATION_NOT_PENDING');
    assert.equal((await files(tx, BOB)).length, 1);
    assert.equal((await files(tx)).length, 1);
  });
});

test('the settled guard: a succeeded attachments operation cannot be turned failed; a receipt rewrite and other domains are unaffected', async () => {
  await scenario(async (tx) => {
    const done = await upload(tx);
    assert.equal(refusal(await attempt(tx, `update public.operations set status = 'failed' where operation_id = $1`, [done.operation])), 'HALO_OPERATION_SETTLED');
    assert.equal((await attempt(tx, `update public.operations set result = result where operation_id = $1`, [done.operation])).ok, true);
    const pending = await claim(tx);
    assert.equal((await attempt(tx, `update public.operations set status = 'failed' where operation_id = $1`, [pending])).ok, true, 'the reaper may settle a pending row');
  });
});

// ---------------------------------------------------------------------------
// Clear all, account deletion, expiry and the sweep queue (Ruling A9)
// ---------------------------------------------------------------------------

test('clear all deletes the household\'s files inside the clear and queues their objects; clear journal and bob keep theirs', async () => {
  await scenario(async (tx) => {
    const mine = await upload(tx);
    const bobs = await upload(tx, { owner: BOB });
    assert.deepEqual((await tx.query('select public.attachment_privacy_counts($1) as c', [ALICE])).rows[0].c, { household_attachments: 1 });
    const clear = async (scope) => {
      const op = await claim(tx, { domain: 'privacy', kind: `privacy.clear.${scope}` });
      const tables = fingerprintTables(scope);
      return attempt(tx, 'select public.clear_household_records($1, $2, $3, public.privacy_fingerprint($1, $4::text[])) as out', [ALICE, op, scope, tables]);
    };
    assert.equal((await clear('journal')).ok, true);
    assert.equal((await files(tx)).length, 1, 'Clear Journal keeps files');
    const all = await clear('all');
    assert.equal(all.ok, true, refusal(all));
    assert.deepEqual(await files(tx), []);
    assert.deepEqual(await queue(tx), [{ object_path: `${ALICE}/${mine.attachmentId}`, due: true }]);
    assert.equal((await files(tx, BOB))[0].id, bobs.attachmentId);
  });
});

test('deleting the account cascades the files and queues their objects, the queue surviving the cascade', async () => {
  await scenario(async (tx) => {
    const mine = await upload(tx);
    await tx.exec('reset role');
    await tx.query('delete from auth.users where id = $1', [ALICE]);
    assert.deepEqual(await queue(tx), [{ object_path: `${ALICE}/${mine.attachmentId}`, due: true }]);
  });
});

test('staged uploads expire after 24 hours, linked ones never do; due lists only due paths with no live row, per household; forget keeps a live one', async () => {
  await scenario(async (tx) => {
    const old = await upload(tx, { recordId: 'obs-old' });
    const fresh = await upload(tx, { recordId: 'obs-new' });
    assert.equal((await writeRecord(tx, 'tests', testRecord('t-1'))).ok, true);
    const report = await upload(tx, { collection: 'tests', recordId: 't-1' });
    await tx.query(`update public.household_attachments set created_at = now() - interval '25 hours' where attachment_id in ($1, $2)`, [old.attachmentId, report.attachmentId]);
    assert.equal((await tx.query('select public.expire_staged_attachments(100) as n')).rows[0].n, 1);
    assert.deepEqual((await files(tx)).map((file) => file.id).sort(), [fresh.attachmentId, report.attachmentId].sort());

    const bobs = await upload(tx, { owner: BOB });
    const bobOp = await claim(tx, { owner: BOB, kind: 'attachments.remove' });
    await tx.query('select public.remove_household_attachment($1, $2, $3, 1)', [BOB, bobOp, bobs.attachmentId]);
    // A live file's path queued by mistake is never listed or forgotten.
    await tx.query(`insert into public.attachment_object_sweep (object_path, due_at) values ($1, now() - interval '1 minute')`, [`${ALICE}/${fresh.attachmentId}`]);
    // A reservation is not due for an hour.
    await tx.query('select public.reserve_attachment_object($1, $2, $3)', [ALICE, await claim(tx), crypto.randomUUID()]);
    const due = async (owner) => (await tx.query('select public.due_attachment_objects($1, 100) as d', [owner])).rows[0].d;
    assert.deepEqual(await due(ALICE), [`${ALICE}/${old.attachmentId}`]);
    assert.deepEqual(await due(BOB), [`${BOB}/${bobs.attachmentId}`]);
    assert.deepEqual((await due(null)).length, 2);
    const forgot = (await tx.query('select public.forget_attachment_objects($1::text[]) as n', [[`${ALICE}/${old.attachmentId}`, `${ALICE}/${fresh.attachmentId}`]])).rows[0].n;
    assert.equal(forgot, 1);
    assert.ok((await queue(tx)).some((row) => row.object_path === `${ALICE}/${fresh.attachmentId}`), 'the live path stays queued, unlisted');
    assert.equal(refusal(await attempt(tx, 'select public.due_attachment_objects(null, 0)')), 'HALO_INVALID_INPUT');
  });
});

test('reads: one household\'s file only, usage, references and the descriptor shape', async () => {
  await scenario(async (tx) => {
    const mine = await upload(tx, { recordId: 'obs-1' });
    const read = async (owner, id) => (await tx.query('select public.read_household_attachment($1, $2) as f', [owner, id])).rows[0].f;
    const found = await read(ALICE, mine.attachmentId);
    assert.deepEqual(found, { ...mine.out.attachment, collection: 'observations', recordId: 'obs-1', objectPath: `${ALICE}/${mine.attachmentId}`, linked: false, width: 40, height: 30 });
    assert.equal(await read(BOB, mine.attachmentId), null);
    assert.deepEqual((await tx.query('select public.household_attachment_usage($1, $2, $3) as u', [ALICE, 'observations', 'obs-1'])).rows[0].u, { files: 1, bytes: 1234, recordFiles: 1 });
    const refs = async (owner, record) => (await tx.query('select public.check_attachment_references($1, $2, $3, $4::text[]) as r', [owner, 'observations', record, [mine.attachmentId]])).rows[0].r;
    assert.deepEqual(await refs(ALICE, 'obs-1'), [mine.out.attachment]);
    assert.deepEqual(await refs(ALICE, 'obs-2'), []);
    assert.deepEqual(await refs(BOB, 'obs-1'), []);
  });
});

test('neither browser role can read the tables or call a function; the bucket path check holds', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select * from public.household_attachments')), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select * from public.attachment_object_sweep')), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select public.read_household_attachment($1, $2)', [ALICE, crypto.randomUUID()])), /permission denied/);
  }
  await assert.rejects(db.query(`insert into public.attachment_object_sweep (object_path) values ('../other/file')`), /violates check constraint/);
});

// ---------------------------------------------------------------------------
// The back-out
// ---------------------------------------------------------------------------

test('the back-out removes exactly what 0028 adds, is safe twice, and 0028 applies again after it; the file and the doc agree', async () => {
  const fresh = await createDb({ upTo: 27 });
  try {
    const before = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    const applied = await runAudit(fresh);
    const block = docBlock('backout-0028');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before, 'the schema is exactly 0001 to 0027 again');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), applied);
  } finally {
    await fresh.close();
  }
  const fileBlock = MIGRATION.sql.split('<!-- backout-0028 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0028').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});
