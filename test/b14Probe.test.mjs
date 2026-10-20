/**
 * B14 probe: edge inputs and cross-household attempts against the private
 * attachment routes, on the same world as test/routesAttachmentsDb.test.mjs
 * (real 0017, 0026 and 0028 on PGlite, a fake bucket, the frontend's own
 * runtime and adapter). Everything is local.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { muteConsoleError } from './helpers/routeHarness.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { sampleRecord, body as workspaceBody } from './helpers/workspaceWorld.mjs';
import { ON, createWorld } from './helpers/attachmentsWorld.mjs';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const jpeg = (opts = {}) => sharp({ create: { width: 24, height: 16, channels: 3, background: '#3a7' } }).jpeg(opts).toBuffer();
const png = (opts = {}) => sharp({ create: { width: 24, height: 16, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } }).png(opts).toBuffer();
const noMetadata = async (bytes) => {
  const meta = await sharp(bytes).metadata();
  return ['exif', 'xmp', 'iptc', 'icc'].every((key) => meta[key] === undefined);
};

const upload = (w, bytes, over = {}, options = {}) => w.upload({
  file: { blob: new Blob([bytes]), name: over.name ?? 'photo.jpg' },
  collection: 'observations', recordId: 'obs-1', metadataRemoved: 'true', reviewed: 'true', operationId: crypto.randomUUID(),
  ...over.fields,
}, options);

/** A PNG chunk with a correct CRC. */
function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
const withPngChunk = (bytes, type, data) => Buffer.concat([bytes.subarray(0, 33), pngChunk(type, data), bytes.subarray(33)]);

// ---------------------------------------------------------------- image kinds

test('every allowed image kind is accepted, answers a 200 and leaves no metadata, comment or text chunk behind', async () => {
  const w = await createWorld(db);
  const marker = 'PRIVATE-PROBE-MARKER';
  const cmyk = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#3a7' } }).toColourspace('cmyk').jpeg().toBuffer();
  const gray = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#888' } }).grayscale().jpeg().toBuffer();
  const withIcc = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#3a7' } }).jpeg().withIccProfile('p3').toBuffer();
  const sixteen = await sharp(Buffer.alloc(24 * 16 * 3 * 2, 0x7f), { raw: { width: 24, height: 16, channels: 3, depth: 'ushort' } }).png().toBuffer();
  // A JPEG with a COM segment, a PNG with tEXt and iTXt, a WebP with EXIF + XMP.
  const jpegBase = await jpeg();
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, marker.length + 2]), Buffer.from(marker)]);
  const jpegCom = Buffer.concat([jpegBase.subarray(0, 2), comment, jpegBase.subarray(2)]);
  const pngBase = await png();
  const pngText = withPngChunk(withPngChunk(pngBase, 'tEXt', Buffer.from(`Comment\0${marker}`)), 'iTXt', Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${marker}`));
  const webpMeta = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#3a7' } }).webp().withExif({ IFD0: { Make: marker } }).toBuffer();
  const cases = {
    cmyk, gray, withIcc, sixteen, jpegCom, pngText, webpMeta,
    alphaPng: await png(), plainWebp: await sharp({ create: { width: 24, height: 16, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.3 } } }).webp().toBuffer(),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    const res = await upload(w, bytes, { fields: { recordId: `obs-${name}` } });
    assert.equal(res.status, 200, name);
    const answer = await res.json();
    const [stored] = (await w.files()).filter((row) => row.record_id === `obs-${name}`);
    const object = w.object(stored);
    assert.equal(object.bytes.length, answer.bytes, name);
    assert.ok(await noMetadata(object.bytes), `${name}: sharp sees metadata`);
    assert.ok(!object.bytes.toString('latin1').includes(marker), `${name}: the marker survived in the stored bytes`);
    assert.ok(!object.bytes.toString('latin1').includes('Exif'), `${name}: an Exif header survived`);
    assert.ok(!object.bytes.toString('latin1').includes('XML:com.adobe.xmp'), `${name}: XMP survived`);
  }
});

test('an animated WebP keeps one frame; huge declared dimensions are a 422 before any decode', async () => {
  const w = await createWorld(db);
  const square = (background) => sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer();
  const animated = await sharp([await square('#f00'), await square('#00f')], { join: { animated: true } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2, 'the fixture is animated');
  const accepted = await upload(w, animated);
  assert.equal(accepted.status, 200);
  const [stored] = await w.files();
  const meta = await sharp(w.object(stored).bytes, { animated: true }).metadata();
  assert.equal(meta.pages ?? 1, 1, 'one frame');
  assert.deepEqual([meta.width, meta.height], [8, 8]);

  // A JPEG whose SOF header claims 65535 x 65535: refused as too many pixels, not decoded.
  const base = await jpeg();
  const sof = base.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  const big = Buffer.from(base);
  big.writeUInt16BE(20000, sof + 5);
  big.writeUInt16BE(20000, sof + 7);
  const res = await upload(w, big);
  assert.equal(res.status, 422);
  assert.equal((await res.json()).reason, 'too_many_pixels');

  // A PNG whose IHDR claims 2^31-1 square: a clean 4xx, never a 500.
  const bigPng = Buffer.from(await png());
  bigPng.writeUInt32BE(0x7fffffff, 16);
  bigPng.writeUInt32BE(0x7fffffff, 20);
  bigPng.writeUInt32BE(crc32(bigPng.subarray(12, 29)) >>> 0, 29);
  const res2 = await upload(w, bigPng);
  assert.ok([422].includes(res2.status), `status ${res2.status}`);

  // Exactly at and over the 40 megapixel line, by header only.
  const line = Buffer.from(base);
  line.writeUInt16BE(5000, sof + 5);
  line.writeUInt16BE(8001, sof + 7);
  assert.equal((await upload(w, line)).status, 422);
});

test('a truncated image, a zero byte file, a text file with a JPEG name and a GIF are clean 4xx answers storing nothing', async () => {
  const w = await createWorld(db);
  const full = await jpeg();
  const before = (await w.files()).length;
  const answers = [
    (await upload(w, full.subarray(0, full.length - 40))).status,
    (await upload(w, Buffer.alloc(0))).status,
    (await upload(w, Buffer.from('hello world'))).status,
    (await upload(w, Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'))).status,
    (await upload(w, Buffer.from([0xff, 0xd8, 0xff]))).status,
  ];
  assert.ok(answers.every((status) => status === 400 || status === 422), answers.join());
  assert.equal((await w.files()).length, before);
  assert.equal(w.storage.objects.size, 0);
});

// ------------------------------------------------------------- the form shapes

test('two file fields, a file part without a file name, odd names and ids never produce a 500', async () => {
  const w = await createWorld(db);
  const image = await jpeg();
  const send = async (build, key = crypto.randomUUID()) => {
    const form = new FormData();
    build(form, key);
    const encoded = new Request('http://halo.test/encode', { method: 'POST', body: form });
    return w.h.call('/api/attachments', 'POST', {
      as: 'alice', rawBody: Buffer.from(await encoded.arrayBuffer()),
      headers: { 'content-type': encoded.headers.get('content-type'), 'idempotency-key': key },
    });
  };
  const fields = (form, key, over = {}) => {
    for (const [name, value] of Object.entries({ collection: 'observations', recordId: 'obs-1', metadataRemoved: 'true', reviewed: 'true', operationId: key, ...over })) form.set(name, value);
  };
  const two = await send((form, key) => { fields(form, key); form.append('file', new Blob([image]), 'a.jpg'); form.append('file', new Blob([image]), 'b.jpg'); });
  assert.equal(two.status, 400);
  const asText = await send((form, key) => { fields(form, key); form.set('file', 'not a file'); });
  assert.equal(asText.status, 400);
  const noName = await send((form, key) => { fields(form, key); form.set('file', new Blob([image]), ''); });
  assert.ok([200, 400].includes(noName.status), String(noName.status));
  for (const name of ['a\nb.jpg', 'tab\there.jpg', `${'é'.repeat(200)}.jpg`, '😀'.repeat(101), '../../etc/passwd', 'a"b.jpg', '‮gpj.exe', '  .jpg', 'x'.repeat(200)]) {
    const res = await send((form, key) => { fields(form, key, { recordId: `obs-${crypto.randomUUID()}` }); form.set('file', new Blob([image]), name); });
    assert.ok([200, 400].includes(res.status), `${JSON.stringify(name)} -> ${res.status}`);
    if (res.status === 200) {
      const stored = (await w.files()).at(-1);
      assert.ok(stored.name.length >= 1 && stored.name.length <= 200);
    }
  }
  for (const recordId of ['x'.repeat(200), 'x'.repeat(201), ' ', '😀'.repeat(100), '😀'.repeat(101), 'a b', 'a\ud800b', '\u0085']) {
    const res = await send((form, key) => { fields(form, key, { recordId }); form.set('file', new Blob([image]), 'p.jpg'); });
    assert.ok([200, 400].includes(res.status), `${JSON.stringify(recordId)} -> ${res.status}`);
  }
  // Uppercase operation id with a matching uppercase key.
  const upperKey = crypto.randomUUID().toUpperCase();
  const upper = await send((form, key) => { fields(form, key); form.set('file', new Blob([image]), 'p.jpg'); }, upperKey);
  assert.ok([200, 400].includes(upper.status), String(upper.status));
});

// ---------------------------------------------------------- unavailable modes

test('flag off and a missing migration: no 500 anywhere, including uploads of junk and the workspace write path', async (t) => {
  muteConsoleError(t);
  const image = await jpeg();
  for (const [label, options] of [['flag off', { env: { HALO_FEATURE_WORKSPACE: 'on' } }], ['not migrated', { migrated: false }], ['attachments on, workspace off', { env: { HALO_FEATURE_ATTACHMENTS: 'on' } }]]) {
    const w = await createWorld(db, options);
    const res = await upload(w, image);
    assert.equal(res.status, 403, `${label}: upload`);
    assert.equal((await upload(w, Buffer.from('junk'))).status, 403, `${label}: junk upload`);
    const id = crypto.randomUUID();
    assert.equal((await w.inspect(id)).status, 503, label);
    assert.equal((await w.download(id, 1)).status, 503, label);
    assert.equal((await w.reconcileFiles(crypto.randomUUID())).status, 404);
    const pending = crypto.randomUUID();
    await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'attachments', 'attachments.upload', 'pending')`, [pending, w.ids.alice]);
    assert.equal((await w.reconcileFiles(pending)).status, label === 'not migrated' ? 200 : 503, label);
    // A removal with a bad header still answers its documented 400, a good one a failed receipt.
    const op = crypto.randomUUID();
    const removed = await w.remove({ id, revision: 1, operationId: op });
    assert.equal(removed.status, 200, label);
    assert.equal((await removed.json()).status, 'failed');
  }
});

// ----------------------------------------------------------- cross household

test('bob cannot reach alice\'s file by any route: operations, a workspace write naming it, a note or test write, an upload for her test', async () => {
  const w = await createWorld(db);
  const image = await jpeg();
  const answer = await (await upload(w, image, { fields: { recordId: 'obs-alice' } })).json();
  const aliceOp = (await db.query(`select operation_id::text as id from public.operations where domain = 'attachments' and profile_id = $1`, [w.ids.alice])).rows[0].id;

  // Her op id from bob's reconcile, in every readable domain.
  for (const domain of ['attachments', 'workspace', 'actions', 'privacy']) {
    const res = await w.h.call('/api/operations', 'GET', { as: 'bob', url: `/api/operations?operationId=${aliceOp}&domain=${domain}` });
    assert.equal(res.status, 404, domain);
  }
  // Bob's note and test writes naming her file, with each collection's shape and every combination of id, revision and record id.
  const noteRecord = { ...sampleRecord('exploreNotes', { id: 'obs-alice' }), photoAttachment: { id: answer.id, revision: 1, name: answer.name, metadataRemoved: true } };
  const testRecord = { ...sampleRecord('tests', { id: 'obs-alice', homeContextId: w.home.bob }), attachments: [answer] };
  const obsRecord = { ...sampleRecord('observations', { id: 'obs-alice', homeContextId: w.home.bob }), photoAttachmentId: answer.id, photoAttachmentRevision: 1, photoMetadataRemoved: true };
  for (const [collection, record] of [['exploreNotes', noteRecord], ['tests', testRecord], ['observations', obsRecord]]) {
    const res = await (await w.command(workspaceBody({ kind: 'write', collection, record, expectedRevision: null }), { as: 'bob' })).json();
    assert.deepEqual([res.status, res.reason], ['failed', 'invalid_reference'], collection);
  }
  // Direct database attempt through the trigger (past the route's early check): also refused.
  await assert.rejects(db.query(
    `insert into public.household_workspace_records (profile_id, collection, record_id, record, revision)
       values ($1, 'observations', 'obs-alice', $2::jsonb, 1)`,
    [w.ids.bob, JSON.stringify(obsRecord)]), /HALO_INVALID_REFERENCE/);
  // A removal of her file through a different file's revision, from bob, and bob's upload to her record id.
  const bobUpload = await upload(w, image, { fields: { recordId: 'obs-alice' } }, { as: 'bob' });
  assert.equal(bobUpload.status, 200, 'bob\'s own staged file under the same record id string is his own');
  assert.equal((await w.files('bob')).length, 1);
  // Alice's file is untouched.
  assert.equal((await w.files('alice')).length, 1);
  assert.equal((await w.inspect(answer.id, { as: 'alice' })).status, 200);
});

// ------------------------------------------------------------ workspace links

test('workspace interplay: a stale write cannot drop or steal a file; removing a record, a note and remove-notes delete the files and their objects', async () => {
  const w = await createWorld(db);
  const ws = w.workspace('alice');
  await ws.loadAll(['tests', 'observations', 'exploreNotes']);
  const image = await jpeg();

  // A test with a report, then a stale write of the test (revision from before the upload).
  const record = sampleRecord('tests', { homeContextId: w.home.alice, rows: [] });
  assert.equal(await ws.write('tests', record), true, ws.state.message);
  const saved = ws.records.tests.find((row) => row.id === record.id);
  const reportRes = await w.upload({
    file: { blob: new Blob([image]), name: 'r.jpg' }, collection: 'tests', recordId: record.id, metadataRemoved: 'false', reviewed: 'true', operationId: crypto.randomUUID(),
  });
  assert.equal(reportRes.status, 200);
  const report = await reportRes.json();
  const stale = await (await w.command(workspaceBody({ kind: 'write', collection: 'tests', record: { ...saved, provider: 'Stale lab', attachments: [] }, expectedRevision: saved.revision }))).json();
  assert.equal(stale.status, 'failed', 'a stale write is refused');
  assert.equal((await w.files()).length, 1, 'the report survived');
  // The same stale record but at the current revision and WITH the file: fine, canonicalised.
  const current = (await w.rows('alice', 'tests'))[0];
  const fine = await (await w.command(workspaceBody({ kind: 'write', collection: 'tests', record: { ...current.record, attachments: [{ ...report, name: 'changed.jpg' }] }, expectedRevision: current.revision }))).json();
  assert.equal(fine.status, 'succeeded');
  assert.equal((await w.rows('alice', 'tests'))[0].record.attachments[0].name, 'r.jpg', 'the stored name is the canonical one');

  // Remove the test record: its report and object go.
  const [stored] = await w.files();
  const removed = await (await w.command(workspaceBody({ kind: 'remove', collection: 'tests', recordId: record.id, expectedRevision: (await w.rows('alice', 'tests'))[0].revision }))).json();
  assert.equal(removed.status, 'succeeded', JSON.stringify(removed));
  assert.deepEqual(await w.files(), []);
  assert.equal(w.object(stored), undefined);
  assert.deepEqual(await w.queued(), []);

  // A note with a photo, then remove-notes.
  const noteId = `note-${crypto.randomUUID()}`;
  const png8 = await png();
  const up = await (await w.upload({ file: { blob: new Blob([png8]), name: 'n.png' }, collection: 'exploreNotes', recordId: noteId, metadataRemoved: 'true', reviewed: 'true', operationId: crypto.randomUUID() })).json();
  const note = { ...sampleRecord('exploreNotes', { id: noteId }), photoAttachment: { id: up.id, revision: 1, name: up.name, metadataRemoved: true } };
  const wrote = await (await w.command(workspaceBody({ kind: 'write', collection: 'exploreNotes', record: note, expectedRevision: null }))).json();
  assert.equal(wrote.status, 'succeeded', JSON.stringify(wrote));
  const [noteFile] = await w.files();
  assert.equal(noteFile.linked, true);
  const gone = await (await w.command(workspaceBody({ kind: 'remove-notes', selection: [{ id: noteId, revision: 1 }] }))).json();
  assert.equal(gone.status, 'succeeded', JSON.stringify(gone));
  assert.deepEqual(await w.files(), []);
  assert.equal(w.object(noteFile), undefined, 'the note photo object is deleted');
});

// ---------------------------------------------------------------- ledger

test('a lost database answer after the commit leaves the file recorded, the operation succeeded and a replay answers the same descriptor', async (t) => {
  muteConsoleError(t);
  let lose = true;
  const w = await createWorld(db, { wrap: { commit_household_attachment: async (args, call) => { const result = await call(); if (lose) { lose = false; throw new Error('connection reset'); } return result; } } });
  const image = await jpeg();
  const operationId = crypto.randomUUID();
  const first = await upload(w, image, { fields: { operationId } });
  assert.equal(first.status, 500);
  const row = await w.ledgerRow(operationId);
  assert.equal(row.status, 'succeeded', 'the guard keeps the settled row succeeded');
  const reconciled = await (await w.reconcileFiles(operationId)).json();
  assert.equal(reconciled.status, 'succeeded');
  assert.equal(reconciled.attachment.id, (await w.files())[0].id);
  const replay = await upload(w, image, { fields: { operationId } });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), reconciled.attachment);
  assert.equal(w.storage.objects.size, 1);
  assert.deepEqual(await w.queued(), []);
  assert.ok(!(await w.ledgerText()).includes('photo.jpg'));
});

test('the same operation id with a different collection or record is a 409, and a reconcile never names a file or a path', async () => {
  const w = await createWorld(db);
  const image = await jpeg();
  const operationId = crypto.randomUUID();
  assert.equal((await upload(w, image, { fields: { operationId } })).status, 200);
  assert.equal((await upload(w, image, { fields: { operationId, collection: 'exploreNotes' } })).status, 409);
  assert.equal((await upload(w, image, { fields: { operationId, recordId: 'obs-2' } })).status, 409);
  assert.equal((await upload(w, image, { fields: { operationId }, name: 'other.jpg' })).status, 409);
  const text = JSON.stringify(await (await w.reconcileFiles(operationId)).json());
  assert.ok(!text.includes(w.ids.alice) && !text.includes('object'));
  assert.ok(await db.query(`select 1`), 'db alive');
  void ON;
});

// ------------------------------------------------------ references and limits

test('a staged file cannot be moved to another record or named twice; the trigger is the authority past the route\'s early check', async () => {
  const w = await createWorld(db);
  const image = await jpeg();
  const a = await (await upload(w, image, { fields: { recordId: 'obs-a' } })).json();
  const b = await (await upload(w, image, { fields: { recordId: 'obs-b' } })).json();
  const write = async (record) => (await (await w.command(workspaceBody({ kind: 'write', collection: 'observations', record, expectedRevision: null }))).json());
  const obs = (id, file) => ({ ...sampleRecord('observations', { id, homeContextId: w.home.alice }), photoAttachmentId: file.id, photoAttachmentRevision: 1, photoMetadataRemoved: true });
  // obs-b names obs-a's file, obs-a a wrong revision: both refused by the route, nothing linked.
  assert.equal((await write(obs('obs-b', a))).reason, 'invalid_reference');
  assert.equal((await write({ ...obs('obs-a', a), photoAttachmentRevision: 2 })).reason, 'invalid_reference');
  assert.deepEqual((await w.files()).map((row) => row.linked), [false, false]);
  // The same refusals when the early check is blinded: the trigger raises, the route answers the stored refusal, and nothing is half written.
  const blind = await createWorld(db, { wrap: { check_attachment_references: async (args) => args.p_ids.map((id) => ({ id, revision: 1, status: 'ready' })) } });
  const own = await (await upload(blind, image, { fields: { recordId: 'obs-a' } })).json();
  const stolen = await (await blind.command(workspaceBody({ kind: 'write', collection: 'observations', record: { ...sampleRecord('observations', { id: 'obs-z', homeContextId: blind.home.alice }), photoAttachmentId: own.id, photoAttachmentRevision: 1, photoMetadataRemoved: true }, expectedRevision: null }))).json();
  assert.deepEqual([stolen.status, stolen.reason], ['failed', 'invalid_reference']);
  assert.deepEqual((await blind.rows('alice', 'observations')), []);
  assert.deepEqual((await blind.files()).map((row) => row.linked), [false]);
  // A test naming one report twice.
  const record = sampleRecord('tests', { homeContextId: w.home.alice, rows: [] });
  assert.equal((await (await w.command(workspaceBody({ kind: 'write', collection: 'tests', record, expectedRevision: null }))).json()).status, 'succeeded');
  const report = await (await w.upload({ file: { blob: new Blob([image]), name: 'r.jpg' }, collection: 'tests', recordId: record.id, metadataRemoved: 'false', reviewed: 'true', operationId: crypto.randomUUID() })).json();
  const current = (await w.rows('alice', 'tests'))[0];
  const twice = await (await w.command(workspaceBody({ kind: 'write', collection: 'tests', record: { ...current.record, attachments: [report, report] }, expectedRevision: current.revision }))).json();
  assert.deepEqual([twice.status, twice.reason], ['failed', 'invalid_reference']);
  assert.equal((await w.files()).filter((row) => row.collection === 'tests').length, 1);
});

test('the 20 files a record limit: the 21st is a stored 422 that writes nothing; a stale usage read is caught by the commit and its object is deleted', async () => {
  const w = await createWorld(db);
  const image = await jpeg();
  for (let at = 0; at < 20; at += 1) assert.equal((await upload(w, image, { fields: { recordId: 'obs-many' } })).status, 200, `file ${at}`);
  const operationId = crypto.randomUUID();
  const over = await upload(w, image, { fields: { recordId: 'obs-many', operationId } });
  assert.equal(over.status, 422);
  assert.equal((await over.json()).reason, 'limit');
  assert.equal((await upload(w, image, { fields: { recordId: 'obs-many', operationId } })).status, 422, 'a replay answers the same refusal');
  assert.equal(w.storage.objects.size, 20);

  const stale = await createWorld(db, { wrap: { household_attachment_usage: async () => ({ files: 0, bytes: 0, recordFiles: 0 }) } });
  for (let at = 0; at < 20; at += 1) assert.equal((await upload(stale, image, { fields: { recordId: 'obs-many' } })).status, 200);
  const raced = await upload(stale, image, { fields: { recordId: 'obs-many' } });
  assert.equal(raced.status, 422);
  assert.equal((await raced.json()).reason, 'limit');
  assert.equal(stale.storage.objects.size, 20, 'the 21st object was deleted at once');
  assert.equal((await stale.files()).length, 20);
});

test('an operation id from another domain, or a workspace id, cannot be reused for an upload or a removal', async () => {
  const w = await createWorld(db);
  const image = await jpeg();
  const ws = w.workspace('alice');
  await ws.loadAll(['tests']);
  const record = sampleRecord('tests', { homeContextId: w.home.alice, rows: [] });
  const command = workspaceBody({ kind: 'write', collection: 'tests', record, expectedRevision: null });
  assert.equal((await (await w.command(command)).json()).status, 'succeeded');
  const reused = await upload(w, image, { fields: { operationId: command.operationId } });
  assert.equal(reused.status, 409);
  const removed = await w.remove({ id: crypto.randomUUID(), revision: 1, operationId: command.operationId });
  assert.equal(removed.status, 409);
  assert.deepEqual((await w.rows('alice', 'tests')).map((row) => row.revision), [1], 'the test is untouched');
});

test('deleting an account queues every file object and keeps the queue; the privacy export names no id, path or byte', async () => {
  const w = await createWorld(db);
  const image = await jpeg();
  const answer = await (await upload(w, image, { fields: { recordId: 'obs-bye' } }, { as: 'bob' })).json();
  const [stored] = await w.files('bob');
  await db.query('delete from auth.users where id = $1', [w.ids.bob]);
  assert.deepEqual(await w.files('bob'), [], 'the cascade took the rows');
  assert.deepEqual(await w.queued(), [stored.object_path], 'and queued their objects');
  const { sweepAttachmentObjects } = await import('../lib/attachmentStore.js');
  assert.deepEqual(await sweepAttachmentObjects(w.h.db, { expire: false }), { expired: 0, removed: 1, failed: 0 });
  assert.equal(w.storage.objects.size, 0);
  assert.ok(answer.id);

  const { PRIVACY_INVENTORY } = await import('../lib/privacyInventory.js');
  const part = PRIVACY_INVENTORY.household_attachments.export;
  const exported = part.parts.flatMap((one) => [...one.base, ...one.private]);
  for (const withheld of ['attachment_id', 'operation_id', 'object_path', 'profile_id']) assert.ok(!exported.includes(withheld), withheld);
  assert.deepEqual(Object.keys(part.withheld).sort(), ['attachment_id', 'object_path', 'operation_id']);
});

test('removal locks the record that holds a file before the file, the order a workspace write and its link trigger use (no deadlock between a removal and a save)', async () => {
  const definition = (await db.query(`select pg_get_functiondef('public.remove_household_attachment(uuid,uuid,uuid,integer)'::regprocedure) as sql`)).rows[0].sql;
  const recordLock = definition.search(/from public\.household_workspace_records r\s+where r\.profile_id = p_profile_id and r\.collection = stored\.collection[^;]*for no key update/);
  const fileLock = definition.search(/from public\.household_attachments a\s+where a\.attachment_id = p_attachment_id and a\.profile_id = p_profile_id\s+for update/);
  assert.ok(recordLock > 0 && fileLock > 0, 'both locks are present');
  assert.ok(recordLock < fileLock, 'the record is locked first');

  // And it still removes: a linked report, and a staged file whose record does not exist.
  const w = await createWorld(db);
  const image = await jpeg();
  const staged = await (await upload(w, image, { fields: { recordId: 'obs-never-saved' } })).json();
  const gone = await (await w.remove({ id: staged.id, revision: 1, operationId: crypto.randomUUID() })).json();
  assert.equal(gone.status, 'succeeded');
  assert.deepEqual(await w.files(), []);
  const record = sampleRecord('tests', { homeContextId: w.home.alice, rows: [] });
  assert.equal((await (await w.command(workspaceBody({ kind: 'write', collection: 'tests', record, expectedRevision: null }))).json()).status, 'succeeded');
  const report = await (await w.upload({ file: { blob: new Blob([image]), name: 'r.jpg' }, collection: 'tests', recordId: record.id, metadataRemoved: 'false', reviewed: 'true', operationId: crypto.randomUUID() })).json();
  const removed = await (await w.remove({ id: report.id, revision: 1, operationId: crypto.randomUUID() })).json();
  assert.equal(removed.status, 'succeeded');
  assert.deepEqual((await w.rows('alice', 'tests'))[0].record.attachments, []);
});

// ------------------------------------------------------------ database limits

test('a decodable PNG wider than the table\'s 100,000 pixel check is a clean 422, never a 500 after the bytes were stored', async (t) => {
  muteConsoleError(t);
  const w = await createWorld(db);
  const strip = await sharp({ create: { width: 100_001, height: 4, channels: 3, background: '#123456' } }).png({ compressionLevel: 1 }).toBuffer();
  const res = await upload(w, strip);
  assert.equal(res.status, 422, `status ${res.status}`);
  assert.equal((await res.json()).reason, 'too_wide');
  assert.deepEqual(await w.files(), []);
  assert.equal(w.storage.objects.size, 0, 'nothing was written');
  const edge = await sharp({ create: { width: 100_000, height: 4, channels: 3, background: '#123456' } }).png({ compressionLevel: 1 }).toBuffer();
  assert.equal((await upload(w, edge)).status, 200, 'the check\'s own limit is allowed');
});
