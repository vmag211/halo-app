/**
 * B14, private photo attachments end to end: POST /api/attachments,
 * GET /api/attachments/inspect, GET /api/attachments/download,
 * POST /api/attachments/remove, GET /api/operations?domain=attachments and the
 * workspace link, with EVERYTHING real below the routes (migrations 0026 and
 * 0028 and the 0017 ledger on PGlite, test/helpers/attachmentsWorld.mjs), a
 * fake Storage client in place of the bucket, and the CLIENT's own code above
 * them: the frontend runtime and home adapter compiled from this tree, the
 * workspace provider (frontendB11.mjs) and the private-file screens
 * transcribed verbatim (frontendB14.mjs, drift-tested below). Each scenario
 * ends on what the screen holds: the message, whether it is locked, the
 * records, and what the bucket holds.
 *
 * Everything is local: synthetic identities, PGlite, an in-memory bucket and a
 * fetch that throws on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { sampleRecord, body as workspaceBody } from './helpers/workspaceWorld.mjs';
import { BUCKET, ON, createWorld } from './helpers/attachmentsWorld.mjs';
import { validProductionCollection } from './helpers/frontendB11.mjs';
import * as fe from './helpers/frontendB14.mjs';
import { fingerprintTables } from '../lib/privacyInventory.js';
import { mintReviewToken } from '../lib/privacyToken.js';

const { REFUSALS, WORKSPACE_COLLECTIONS } = await import('../lib/workspaceStore.js');
const { ATTACHMENT_REFUSALS, INCOMPLETE_MESSAGE, sweepAttachmentObjects } = await import('../lib/attachmentStore.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(path.join(HERE, 'fixtures/attachments/gps-exif.jpg'));
const NAME = 'PRIVATE-NAME kitchen tap report.jpg';
const KEY = 'privacy-review-key-for-tests-only-0123456789';
const OFF = Object.freeze({ HALO_FEATURE_WORKSPACE: 'on' });
const STORED = 'Private file stored.';
const NOT_AVAILABLE = 'This action is not available for this account.';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const file = (bytes = FIXTURE, name = NAME, type = 'image/jpeg') => new File([bytes], name, { type });
const dataUrl = (bytes, type) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

/** A Homeguard for `who` with every collection loaded, and its upload hook. */
async function screen(w, who = 'alice', options = {}) {
  const ws = w.workspace(who, options);
  await ws.loadAll(WORKSPACE_COLLECTIONS);
  return { ws, upload: fe.privateUpload(ws) };
}
const locked = (ws) => ws.unknownOperations.map((item) => item.operationId);

/** A saved test for `who`, through the client. */
async function savedTest(w, ws, who = 'alice') {
  const record = sampleRecord('tests', { homeContextId: w.home[who], rows: [] });
  assert.equal(await ws.write('tests', record), true, ws.state.message);
  return ws.records.tests.find((row) => row.id === record.id);
}
const noMetadata = async (bytes) => {
  const meta = await sharp(bytes).metadata();
  return ['exif', 'xmp', 'iptc', 'icc'].every((key) => meta[key] === undefined);
};

// ------------------------------------------------------------------- drift

test('the transcribed screen lines still match the frontend, character for character, and the registry paths are the routes', async () => {
  const mine = await readFile(new URL('./helpers/frontendB14.mjs', import.meta.url), 'utf8');
  const b11 = await readFile(new URL('./helpers/frontendB11.mjs', import.meta.url), 'utf8');
  for (const fragment of fe.FRAGMENTS) {
    const source = await readFile(new URL(`../${fragment.file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(fragment.text), `${fragment.file} no longer contains: ${fragment.text}`);
    assert.ok((fragment.helper === 'frontendB11.mjs' ? b11 : mine).includes(fragment.text), `the transcription no longer contains: ${fragment.text}`);
  }
  const runtime = await readFile(new URL('../lib/frontend/production/runtime.ts', import.meta.url), 'utf8');
  for (const line of [
    "'attachments.upload': {path:'/api/attachments',method:'POST'},",
    "'attachments.inspect': {path:'/api/attachments/inspect'},",
    "'attachments.download': {path:'/api/attachments/download'},",
    "'attachments.remove': {path:'/api/attachments/remove',method:'POST'},",
  ]) assert.ok(runtime.includes(line), line);
});

// ------------------------------------------------------------- the screens

test('a report: stored through the client, metadata gone from the bytes, linked to its test, opened, then removed with its results kept', async () => {
  const w = await createWorld(db);
  const { ws, upload } = await screen(w);
  const testRecord = await savedTest(w, ws);

  const next = await fe.saveReport(ws, upload, { recordId: testRecord.id, file: file() });
  assert.equal(upload.message, STORED);
  assert.deepEqual(locked(ws), []);
  assert.deepEqual(Object.keys(next).sort(), ['bytes', 'id', 'metadataRemoved', 'mime', 'name', 'revision', 'status']);
  assert.deepEqual([next.name, next.mime, next.status, next.metadataRemoved, next.revision], [NAME, 'image/jpeg', 'ready', true, 1]);

  // The test now shows the report (after the screen's own retry('tests')), at a new revision.
  assert.deepEqual(fe.storedReports(ws, testRecord.id), [next]);
  assert.equal(ws.records.tests.find((row) => row.id === testRecord.id).revision, 2);
  assert.ok(validProductionCollection('tests', ws.records.tests));

  // What the bucket holds is the server's re-encode: no EXIF, GPS, XMP or ICC, the size the record says.
  const [stored] = await w.files();
  assert.equal(stored.object_path, `${w.ids.alice}/${next.id}`, 'the path is the owner and a server id, nothing the client sent');
  const object = w.object(stored);
  assert.equal(object.contentType, 'image/jpeg');
  assert.equal(object.bytes.length, next.bytes);
  assert.ok(await noMetadata(object.bytes));
  for (const marker of ['HALO-FIXTURE-CAMERA', 'PRIVATE-ARTIST', 'PRIVATE-XMP', 'Exif']) assert.ok(!object.bytes.toString('latin1').includes(marker), marker);
  assert.ok(!(await w.ledgerText()).includes('PRIVATE-NAME'), 'the ledger never holds the file name');

  // Opening it: the client's own download, exact revision, the stored bytes.
  const blob = await w.adapter().attachments.download(next.id, 1, AbortSignal.timeout(5000));
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), object.bytes);
  const raw = await w.download(next.id, 1);
  assert.equal(raw.headers.get('cache-control'), 'private, no-store');
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
  assert.match(raw.headers.get('content-disposition'), /^attachment; filename="halo-private-file\.jpg"$/);
  assert.deepEqual(await (await w.inspect(next.id)).json(), next);

  // Removing it: the screen's own removal; results stay, the object is deleted at once.
  const removal = fe.reportRemoval(ws, upload);
  removal.choose(next);
  await removal.remove();
  assert.equal(upload.message, 'Private file removed. Entered results remain.');
  assert.deepEqual(fe.storedReports(ws, testRecord.id), []);
  const after = ws.records.tests.find((row) => row.id === testRecord.id);
  assert.deepEqual([after.revision, after.title, after.attachments], [3, testRecord.title, []]);
  assert.deepEqual(locked(ws), []);
  assert.deepEqual(await w.files(), []);
  assert.equal(w.object(stored), undefined, 'the object is gone');
  assert.deepEqual(await w.queued(), []);
});

test('an observation photo: uploaded staged, linked by the save that names it, and deleted when a later save drops it', async () => {
  const w = await createWorld(db);
  const { ws, upload } = await screen(w);
  const recordId = `observation-${crypto.randomUUID()}`;
  const draft = { ...sampleRecord('observations', { id: recordId, homeContextId: w.home.alice }), photoName: 'damp corner.jpg', photoData: dataUrl(FIXTURE, 'image/jpeg'), photoMetadataRemoved: true };
  const outcome = await fe.saveObservation(ws, upload, { draft, recordId });
  assert.equal(outcome.saved, true, ws.state.message);
  const saved = ws.records.observations.find((row) => row.id === recordId);
  assert.equal(saved.photoData, '');
  assert.equal(saved.photoAttachmentId, upload.attachment.id);
  assert.deepEqual([saved.photoAttachmentRevision, saved.photoMetadataRemoved], [1, true]);
  assert.deepEqual((await w.files()).map((row) => [row.collection, row.record_id, row.linked]), [['observations', recordId, true]]);
  assert.ok(await noMetadata(w.object((await w.files())[0]).bytes));

  // "Remove photo when saving" (MaintenanceWorkspace.tsx:157): the reference goes, so does the file.
  const [stored] = await w.files();
  assert.equal(await ws.write('observations', { ...saved, photoAttachmentId: undefined, photoAttachmentRevision: undefined, photoName: '' }), true, ws.state.message);
  assert.deepEqual(await w.files(), []);
  assert.equal(w.object(stored), undefined, 'the save swept the household\'s queued object');
});

test('a note photo (PNG with EXIF): staged under the stable note id, linked by the save, stored canonically and metadata-free', async () => {
  const w = await createWorld(db);
  const { ws, upload } = await screen(w);
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#2a7' } }).png().withExif({ IFD0: { Make: 'HALO-FIXTURE-CAMERA' } }).toBuffer();
  const stableId = `note-${crypto.randomUUID()}`;
  const draft = { ...sampleRecord('exploreNotes', { id: stableId }), photo: { data: dataUrl(png, 'image/png'), metadataRemoved: true } };
  const outcome = await fe.saveNote(ws, upload, { draft, stableId });
  assert.equal(outcome.saved, true, ws.state.message);
  const saved = ws.records.exploreNotes.find((row) => row.id === stableId);
  assert.deepEqual(saved.photoAttachment, { id: upload.attachment.id, revision: 1, name: 'halo-observation.png', metadataRemoved: true });
  assert.equal(saved.photo, undefined);
  const [stored] = await w.files();
  assert.equal(w.object(stored).contentType, 'image/png');
  assert.ok(await noMetadata(w.object(stored).bytes));
  assert.ok(!w.object(stored).bytes.toString('latin1').includes('HALO-FIXTURE-CAMERA'));
});

test('a lost upload answer: the screen locks and says so, then its status check finds the stored file without a second upload', async () => {
  const w = await createWorld(db);
  const { ws } = await screen(w, 'alice');
  const testRecord = await savedTest(w, ws);
  const lossy = await screen(w, 'alice', { lose: (pathname) => pathname === '/api/attachments' });
  await lossy.ws.loadAll(WORKSPACE_COLLECTIONS);
  const first = await fe.saveReport(lossy.ws, lossy.upload, { recordId: testRecord.id, file: file() });
  assert.equal(first, null);
  assert.equal(lossy.upload.unknown, true);
  assert.equal(lossy.upload.message, 'The upload result is not confirmed. Check its status before uploading again.');
  assert.deepEqual(locked(lossy.ws), [lossy.upload.operationId], 'the provider is locked on the upload');
  assert.equal(await lossy.ws.write('tests', { ...lossy.ws.records.tests[0] }), false, 'no other save while it is unknown');

  // "Check upload status" (PrivateAttachments.tsx:63): upload() with no input reconciles by id.
  const checked = await lossy.upload.upload();
  assert.equal(checked.status, 'ready');
  assert.equal(lossy.upload.message, STORED);
  assert.deepEqual(locked(lossy.ws), []);
  assert.equal((await w.files()).length, 1, 'exactly one file: no second upload was sent');
  assert.equal(w.storage.calls.filter((call) => call.op === 'upload').length, 1);
});

test('an unresolved file operation from another device locks Homeguard on load until its status settles', async () => {
  const w = await createWorld(db);
  const op = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'attachments', 'attachments.upload', 'pending')`, [op, w.ids.alice]);
  const raw = await (await w.load('tests')).json();
  assert.deepEqual(raw.pendingOperations, [{ operationId: op, domain: 'attachments' }]);
  const { ws } = await screen(w);
  assert.deepEqual(locked(ws), [op]);
  assert.equal(ws.canMutate(), false);
  assert.equal(await ws.reconcile(op), false, 'still pending: still locked');
  assert.deepEqual(locked(ws), [op]);
  await db.query(`update public.operations set status = 'failed', result = '{"status":"failed","reason":"limit"}' where operation_id = $1`, [op]);
  assert.equal(await ws.reconcile(op), false, 'a failed file request is settled, not saved');
  assert.equal(ws.state.message, ATTACHMENT_REFUSALS.limit.message);
  assert.deepEqual(locked(ws), []);
  assert.equal(ws.canMutate(), true);
});

test('a lost removal answer: the confirmation offers a status check, which finds it removed; no second removal is sent', async () => {
  const w = await createWorld(db);
  const { ws, upload } = await screen(w);
  const testRecord = await savedTest(w, ws);
  const next = await fe.saveReport(ws, upload, { recordId: testRecord.id, file: file() });
  const lossy = await screen(w, 'alice', { lose: (pathname) => pathname === '/api/attachments/remove' });
  const removal = fe.reportRemoval(lossy.ws, lossy.upload);
  removal.choose(next);
  await removal.remove();
  assert.equal(removal.state.removeUnknown, true);
  assert.equal(lossy.upload.message, 'The result is not confirmed. Check its status before trying again.');
  assert.deepEqual(locked(lossy.ws), [removal.state.removeOperation]);
  await removal.remove();
  assert.equal(lossy.upload.message, 'Private file removed. Entered results remain.');
  assert.deepEqual(locked(lossy.ws), []);
  assert.deepEqual(fe.storedReports(lossy.ws, testRecord.id), []);
  assert.equal(w.storage.calls.filter((call) => call.op === 'remove').length, 1, 'one sweep, from the removal that ran');
});

test('a file the server cannot read as an allowed image (a PDF report, an SVG) is refused before anything is recorded or stored', async () => {
  const w = await createWorld(db);
  const { ws, upload } = await screen(w);
  const testRecord = await savedTest(w, ws);
  const pdf = file(Buffer.from('%PDF-1.7\n%%EOF'), 'lab report.pdf', 'application/pdf');
  assert.equal(await fe.saveReport(ws, upload, { recordId: testRecord.id, file: pdf }), null);
  assert.equal(upload.message, 'Check the highlighted information and try again.');
  assert.equal(upload.unknown, false, 'a definite refusal: the draft stays and nothing is locked');
  assert.deepEqual(locked(ws), []);
  const svg = await w.upload({ file: { blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/jpeg' }), name: 'x.jpg' }, collection: 'tests', recordId: testRecord.id, metadataRemoved: 'false', reviewed: 'true', operationId: crypto.randomUUID() });
  const body = await expectEnvelope(svg, { status: 422, code: 'validation_failed', extraKeys: ['reason'] });
  assert.equal(body.reason, 'unsupported_type');
  assert.deepEqual(await w.files(), []);
  assert.equal(w.storage.calls.length, 0);
  assert.equal((await db.query(`select count(*)::int as n from public.operations where domain = 'attachments' and profile_id = $1`, [w.ids.alice])).rows[0].n, 0);
});

// ------------------------------------------------------- another household

test('another household can never inspect, download, remove or link alice\'s file, nor attach to her test, nor reuse her operation id', async () => {
  const w = await createWorld(db);
  const { ws, upload } = await screen(w);
  const testRecord = await savedTest(w, ws);
  const next = await fe.saveReport(ws, upload, { recordId: testRecord.id, file: file() });
  const [stored] = await w.files();

  await expectEnvelope(await w.inspect(next.id, { as: 'bob' }), { status: 404, code: 'not_found' });
  await expectEnvelope(await w.download(next.id, 1, { as: 'bob' }), { status: 404, code: 'not_found' });
  assert.equal(w.storage.calls.filter((call) => call.op === 'download').length, 0, 'bob\'s request never reached the bucket');

  const removeOp = crypto.randomUUID();
  const bobRemoves = await w.remove({ id: next.id, revision: 1, operationId: removeOp }, { as: 'bob', headers: { 'if-match': '1' } });
  assert.deepEqual(await bobRemoves.json(), {
    operationId: removeOp, status: 'failed', changes: {}, code: 'conflict', reason: 'not_found', message: ATTACHMENT_REFUSALS.not_found.message,
  });
  // The same through bob's own client: the screen says so, and is not locked.
  const bob = await screen(w, 'bob');
  const bobRemoval = fe.reportRemoval(bob.ws, bob.upload);
  bobRemoval.choose(next);
  await bobRemoval.remove();
  assert.equal(bob.upload.message, ATTACHMENT_REFUSALS.not_found.message);
  assert.deepEqual(locked(bob.ws), []);

  // A report for alice's test id, from bob: bob has no such test.
  const bobUpload = await w.upload({ file: { blob: new Blob([FIXTURE]), name: 'x.jpg' }, collection: 'tests', recordId: testRecord.id, metadataRemoved: 'false', reviewed: 'true', operationId: crypto.randomUUID() }, { as: 'bob' });
  const refused = await expectEnvelope(bobUpload, { status: 422, code: 'validation_failed', extraKeys: ['reason'] });
  assert.equal(refused.reason, 'invalid_reference');
  assert.deepEqual(await w.files('bob'), []);
  assert.deepEqual([...w.storage.objects.keys()], [`${BUCKET}/${stored.object_path}`], 'bob\'s written object was deleted at once');

  // Bob's observation naming alice's file: refused before any claim.
  const bobRecord = sampleRecord('observations', { homeContextId: w.home.bob, photoAttachmentId: next.id, photoAttachmentRevision: 1, photoMetadataRemoved: true });
  const linked = await (await w.command(workspaceBody({ kind: 'write', collection: 'observations', record: bobRecord, expectedRevision: null }), { as: 'bob' })).json();
  assert.deepEqual([linked.status, linked.reason], ['failed', 'invalid_reference']);

  // Alice's upload operation id from bob is the same operation_mismatch as any reuse.
  const aliceOp = (await db.query(`select operation_id::text as id from public.operations where domain = 'attachments' and profile_id = $1 and kind = 'attachments.upload'`, [w.ids.alice])).rows[0].id;
  const reused = await w.upload({ file: { blob: new Blob([FIXTURE]), name: 'x.jpg' }, collection: 'observations', recordId: 'obs-1', metadataRemoved: 'true', reviewed: 'true', operationId: aliceOp }, { as: 'bob' });
  const mismatch = await expectEnvelope(reused, { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(mismatch.reason, 'operation_mismatch');
  await expectEnvelope(await w.reconcileFiles(aliceOp, { as: 'bob' }), { status: 404, code: 'not_found' });

  // Alice's file, record and object are exactly as they were.
  assert.deepEqual(await w.files(), [stored]);
  assert.deepEqual(fe.storedReports(ws, testRecord.id), [next]);
  assert.ok(w.object(stored));
});

// ------------------------------------------------- the wire, replays, failures

test('wire rules: the key, the fields, review and metadata, the size cap; a replay answers the same file once; another file under the same id is refused', async () => {
  const w = await createWorld(db);
  const base = () => ({ file: { blob: new Blob([FIXTURE]), name: 'photo.jpg' }, collection: 'observations', recordId: 'obs-1', metadataRemoved: 'true', reviewed: 'true', operationId: crypto.randomUUID() });
  await expectEnvelope(await w.upload(base(), { key: null }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.upload(base(), { key: crypto.randomUUID() }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.upload({ ...base(), extra: 'x' }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.upload({ ...base(), collection: 'assets' }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.upload({ ...base(), recordId: 'a\u0000b' }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.upload({ ...base(), file: { blob: new Blob([FIXTURE]), name: 'x'.repeat(201) } }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.upload({ ...base(), reviewed: 'false' }), { status: 422, code: 'validation_failed' });
  await expectEnvelope(await w.upload({ ...base(), metadataRemoved: 'false' }), { status: 422, code: 'validation_failed' });
  const huge = Buffer.alloc(10 * 1024 * 1024 + 70 * 1024);
  FIXTURE.copy(huge);
  await expectEnvelope(await w.upload({ ...base(), file: { blob: new Blob([huge]), name: 'big.jpg' } }), { status: 413, code: 'payload_too_large' });
  await expectEnvelope(await w.h.call('/api/attachments', 'POST', { as: 'alice', rawBody: '{}', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() } }), { status: 400, code: 'bad_request' });
  assert.equal((await w.h.call('/api/attachments', 'POST', { rawBody: '{}' })).status, 401);
  assert.deepEqual(await w.files(), []);

  const first = base();
  const answer = await (await w.upload(first)).json();
  const again = await w.upload(first);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), answer, 'a replay answers the same file');
  assert.equal((await w.files()).length, 1);
  const other = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123' } }).jpeg().toBuffer();
  const swapped = await w.upload({ ...first, file: { blob: new Blob([other]), name: 'photo.jpg' } });
  assert.equal((await expectEnvelope(swapped, { status: 409, code: 'conflict', extraKeys: ['reason'] })).reason, 'operation_mismatch');
  const reconciled = await (await w.reconcileFiles(first.operationId)).json();
  assert.deepEqual([reconciled.status, reconciled.attachment, reconciled.changes], ['succeeded', answer, {}]);
  assert.ok(!JSON.stringify(reconciled).includes(w.ids.alice), 'no object path or owner id in a reconcile');
});

test('download and remove rules: exact revision, If-Match, ids; a stale removal is a conflict that replays the same', async () => {
  const w = await createWorld(db);
  const answer = await (await w.upload({ file: { blob: new Blob([FIXTURE]), name: 'photo.jpg' }, collection: 'observations', recordId: 'obs-1', metadataRemoved: 'true', reviewed: 'true', operationId: crypto.randomUUID() })).json();
  await expectEnvelope(await w.download(answer.id, 2), { status: 409, code: 'conflict' });
  await expectEnvelope(await w.h.call('/api/attachments/download', 'GET', { as: 'alice', url: `/api/attachments/download?id=${answer.id}` }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.download('not-an-id', 1), { status: 404, code: 'not_found' });
  await expectEnvelope(await w.inspect(crypto.randomUUID()), { status: 404, code: 'not_found' });
  const op = crypto.randomUUID();
  await expectEnvelope(await w.remove({ id: answer.id, revision: 1, operationId: op }, { headers: { 'if-match': '2' } }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.remove({ id: answer.id, revision: 1, operationId: op, extra: 1 }), { status: 400, code: 'validation_failed' });
  await expectEnvelope(await w.remove({ id: answer.id, revision: 0, operationId: op }), { status: 400, code: 'validation_failed' });
  const stale = await (await w.remove({ id: answer.id, revision: 2, operationId: op })).json();
  assert.deepEqual([stale.status, stale.code, stale.reason, stale.changes], ['failed', 'conflict', 'stale_revision', {}]);
  const replay = await (await w.remove({ id: answer.id, revision: 2, operationId: op })).json();
  assert.deepEqual(replay, stale, 'a refusal replays the same body');
  const done = await (await w.remove({ id: answer.id, revision: 1, operationId: crypto.randomUUID() })).json();
  assert.deepEqual([done.status, done.changes], ['succeeded', { observations: [] }], 'a staged file\'s removal answers its collection');
  assert.equal(w.storage.objects.size, 0);
});

test('a storage failure is a 500 the client reconciles to "did not finish"; the reserved path stays queued, never orphaned', async (t) => {
  const mock = muteConsoleError(t);
  const w = await createWorld(db);
  w.storage.fail.upload = true;
  const { ws, upload } = await screen(w);
  const testRecord = await savedTest(w, ws);
  assert.equal(await fe.saveReport(ws, upload, { recordId: testRecord.id, file: file() }), null);
  assert.equal(upload.unknown, true);
  assert.equal(await upload.upload(), null, 'the status check');
  assert.equal(upload.message, INCOMPLETE_MESSAGE);
  assert.equal(upload.unknown, false);
  assert.deepEqual(locked(ws), []);
  assert.deepEqual(await w.files(), []);
  assert.equal((await w.queued()).length, 1, 'the reserved path stays queued for the sweep');
  const logged = loggedText(mock);
  assert.ok(logged.includes('storage_500'));
  for (const secret of [w.ids.alice, 'PRIVATE-NAME', testRecord.id]) assert.ok(!logged.includes(secret), `the log names ${secret}`);
});

// ---------------------------------------------------------- unavailable

test('flag off: upload is a definite 403 (nothing read, processed or recorded), reads are 503, removal a failed receipt, and W4 stands', async () => {
  const w = await createWorld(db, { env: OFF });
  const { ws, upload } = await screen(w);
  const testRecord = await savedTest(w, ws);
  assert.equal(await fe.saveReport(ws, upload, { recordId: testRecord.id, file: file() }), null);
  assert.equal(upload.message, NOT_AVAILABLE);
  assert.equal(upload.unknown, false);
  assert.deepEqual(locked(ws), []);
  assert.equal(w.storage.calls.length, 0);
  assert.equal((await db.query(`select count(*)::int as n from public.operations where domain = 'attachments' and profile_id = $1`, [w.ids.alice])).rows[0].n, 0);
  const id = crypto.randomUUID();
  await expectEnvelope(await w.inspect(id), { status: 503, code: 'feature_unavailable', retryable: false });
  await expectEnvelope(await w.download(id, 1), { status: 503, code: 'feature_unavailable', retryable: false });
  const op = crypto.randomUUID();
  assert.deepEqual(await (await w.remove({ id, revision: 1, operationId: op })).json(), {
    operationId: op, status: 'failed', changes: {}, code: 'unavailable', message: 'Private files are not available yet. Nothing was saved.',
  });
  const withFile = { ...testRecord, attachments: [{ id, name: 'r.jpg', mime: 'image/jpeg', revision: 1, bytes: 10, status: 'ready', metadataRemoved: true }] };
  assert.equal(await ws.write('tests', withFile), false);
  assert.equal(ws.state.message, REFUSALS.attachments_unavailable.message);
});

test('before 0028: the same honest answers with the flag on; a save naming a file is refused, a save without one is not', async () => {
  const w = await createWorld(db, { migrated: false });
  const { ws, upload } = await screen(w);
  const testRecord = await savedTest(w, ws);
  assert.equal(await fe.saveReport(ws, upload, { recordId: testRecord.id, file: file() }), null);
  assert.equal(upload.message, NOT_AVAILABLE);
  assert.equal(upload.unknown, false);
  assert.equal(w.storage.calls.length, 0);
  await expectEnvelope(await w.inspect(crypto.randomUUID()), { status: 503, code: 'feature_unavailable', retryable: false });
  const op = crypto.randomUUID();
  assert.equal((await (await w.remove({ id: crypto.randomUUID(), revision: 1, operationId: op })).json()).code, 'unavailable');
  const withFile = { ...testRecord, attachments: [{ id: crypto.randomUUID(), name: 'r.jpg', mime: 'image/jpeg', revision: 1, bytes: 10, status: 'ready', metadataRemoved: true }] };
  assert.equal(await ws.write('tests', withFile), false);
  assert.equal(ws.state.message, REFUSALS.attachments_unavailable.message);
  assert.equal(await ws.write('tests', { ...testRecord, provider: 'County lab' }), true, 'a save without files is unaffected');
});

// ------------------------------------------------ privacy clear and the sweep

test('privacy clear all deletes the household\'s files and then their objects; bob\'s stay; the daily sweep expires staged uploads', async (t) => {
  // Its own database: a sweep with no owner reaches every household's queue.
  const db = await createDb();
  t.after(() => db.close());
  const w = await createWorld(db, { env: { ...ON, HALO_PRIVACY_REVIEW_KEY: KEY } });
  const call = (name, params) => async (args) => {
    try {
      return await db.asService(async (tx) => (await tx.query(`select public.${name}(${params.map((p, at) => `$${at + 1}${p.cast}`).join(', ')}) as result`, params.map((p) => args[p.name]))).rows[0].result, { commit: true });
    } catch (error) {
      throw rpcError(error?.code ?? '', error?.message ?? String(error));
    }
  };
  const fingerprintParams = [{ name: 'p_profile_id', cast: '::uuid' }, { name: 'p_tables', cast: '::text[]' }];
  w.h.db.registerRpc('privacy_schema_version', call('privacy_schema_version', []), { args: [] });
  w.h.db.registerRpc('privacy_fingerprint', call('privacy_fingerprint', fingerprintParams), { args: ['p_profile_id', 'p_tables'] });
  w.h.db.registerRpc('clear_household_records', call('clear_household_records', [{ name: 'p_profile_id', cast: '::uuid' }, { name: 'p_operation_id', cast: '::uuid' }, { name: 'p_scope', cast: '::text' }, { name: 'p_fingerprint', cast: '::text' }]), {
    args: ['p_profile_id', 'p_operation_id', 'p_scope', 'p_fingerprint'],
  });
  const send = (who, recordId) => w.upload({ file: { blob: new Blob([FIXTURE]), name: 'photo.jpg' }, collection: 'observations', recordId, metadataRemoved: 'true', reviewed: 'true', operationId: crypto.randomUUID() }, { as: who });
  assert.equal((await send('alice', 'obs-1')).status, 200);
  assert.equal((await send('alice', 'obs-2')).status, 200);
  assert.equal((await send('bob', 'obs-1')).status, 200);
  assert.equal(w.storage.objects.size, 3);

  const fingerprint = await call('privacy_fingerprint', fingerprintParams)({ p_profile_id: w.ids.alice, p_tables: fingerprintTables('all') });
  const reviewToken = mintReviewToken(KEY, { profileId: w.ids.alice, scope: 'all', groups: [], privateText: false, fingerprint }).reviewToken;
  const operationId = crypto.randomUUID();
  const cleared = await w.h.call('/api/privacy/clear', 'POST', {
    as: 'alice', rawBody: JSON.stringify({ operationId, scope: 'all', reviewToken }),
    headers: { 'content-type': 'application/json', 'idempotency-key': operationId },
  });
  assert.deepEqual(await cleared.json(), { operationId, status: 'succeeded', scope: 'all' });
  assert.deepEqual(await w.files(), []);
  assert.deepEqual([...w.storage.objects.keys()].map((key) => key.split('/')[1]), [w.ids.bob], 'only bob\'s object is left');
  assert.deepEqual(await w.queued(), []);

  // The daily sweep: bob's staged upload past 24 hours expires, and its object goes.
  await db.query(`update public.household_attachments set created_at = now() - interval '25 hours' where profile_id = $1`, [w.ids.bob]);
  assert.deepEqual(await sweepAttachmentObjects(w.h.db, { expire: true, limit: 500 }), { expired: 1, removed: 1, failed: 0 });
  assert.equal(w.storage.objects.size, 0);
  // A bucket outage leaves the queue for the next run, counted, never thrown.
  await db.query(`insert into public.attachment_object_sweep (object_path) values ($1)`, [`${w.ids.bob}/${crypto.randomUUID()}`]);
  w.storage.fail.remove = true;
  assert.deepEqual(await sweepAttachmentObjects(w.h.db, {}), { expired: 0, removed: 0, failed: 1 });
  assert.equal((await w.queued()).length, 1);
  w.storage.fail.remove = false;
  assert.deepEqual(await sweepAttachmentObjects(w.h.db, {}), { expired: 0, removed: 1, failed: 0 });
});

