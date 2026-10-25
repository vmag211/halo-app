/**
 * B11 adversarial probes: edge inputs, every collection through the client's
 * own runtime/adapter, references, interleaving, reconcile for every ledger
 * status, replays of refusals, log hygiene and the clear-all boundary. Uses
 * the same world as routesWorkspaceDb.test.mjs (migration 0026 and the 0017
 * ledger on PGlite, the frontend's compiled runtime and home adapter).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { muteConsoleError } from './helpers/routeHarness.mjs';
import { loggedText } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { createWorld, body, sampleRecord } from './helpers/workspaceWorld.mjs';
import { validProductionCollection, validHomeChanges } from './helpers/frontendB11.mjs';
const { STORED_COLLECTIONS, WORKSPACE_COLLECTIONS, REFUSALS, LIMITS } = await import('../lib/workspaceStore.js');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const ch = (code) => String.fromCharCode(code);
const loaded = async (w, who = 'alice', options = {}) => {
  const ws = w.workspace(who, options);
  await ws.loadAll(WORKSPACE_COLLECTIONS);
  return ws;
};
const locked = (ws) => ws.state.unknownOperations.map((item) => item.operationId);
const send = async (w, command, options) => {
  const response = await w.command(body(command), options);
  return { status: response.status, json: await response.json() };
};
const create = (collection, record) => ({ kind: 'write', collection, record, expectedRevision: null });

test('every stored collection: create, update, reload, delete through the client, unknown future fields round-trip', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  const future = { futureField: { nested: [1, 2.5, 'x', null, true], emoji: '\u{1F30A}' } };
  for (const key of STORED_COLLECTIONS) {
    const record = sampleRecord(key, key === 'tests' ? { homeContextId: w.home.alice, ...future } : future);
    assert.equal(await ws.write(key, record), true, `${key} create: ${ws.state.message}`);
    const stored = ws.records[key][0];
    assert.deepEqual(stored.futureField, future.futureField, `${key} keeps unknown fields`);
    assert.equal(stored.revision, 1);
    assert.equal(await ws.write(key, { ...stored, title: 'Renamed é中', futureField: { changed: true } }), true, `${key} update: ${ws.state.message}`);
    assert.equal(ws.records[key][0].revision, 2);
    assert.deepEqual(ws.records[key][0].futureField, { changed: true });
  }
  const again = await loaded(w);
  for (const key of STORED_COLLECTIONS) assert.deepEqual(again.records[key], ws.records[key], `${key} reload equals receipt`);
  for (const key of STORED_COLLECTIONS) {
    assert.equal(await ws.remove(key, ws.records[key][0].id, 2), true, `${key} delete: ${ws.state.message}`);
    assert.deepEqual(ws.records[key], [], key);
  }
  assert.deepEqual(await w.rows('alice'), []);
  assert.deepEqual(locked(ws), []);
});

test('odd record ids: unicode, quotes, backslashes, percent, colon, 200 characters, are stored and removed exactly', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  const ids = ['café-中', 'a"b\'c\\d%e:f/g?h#i', '  spaced  ', '\u{1F30A}'.repeat(100), 'x'.repeat(200), '__proto__', 'constructor', "a'; drop table x; --"];
  for (const id of ids) {
    assert.equal(await ws.write('foodQuestions', sampleRecord('foodQuestions', { id })), true, `${id.slice(0, 12)}: ${ws.state.message}`);
  }
  assert.deepEqual(ws.records.foodQuestions.map((row) => row.id).sort(), [...ids].sort());
  for (const id of ids) assert.equal(await ws.remove('foodQuestions', id, 1), true, id.slice(0, 12));
  assert.deepEqual(await w.rows('alice'), []);
});

test('bad ids are 400s recorded nowhere: empty, 201 characters, control characters, line separators, non-strings', async () => {
  const w = await createWorld(db);
  for (const id of ['', 'x'.repeat(201), `a${ch(0)}b`, `a${ch(10)}b`, `a${ch(0x2028)}b`, `a${ch(0x2029)}b`, `a${ch(0x85)}b`, 7, null, ['a'], {}]) {
    const { status, json } = await send(w, create('foodQuestions', { ...sampleRecord('foodQuestions'), id }));
    assert.equal(status, 400, JSON.stringify(id));
    assert.equal(json.error?.code ?? json.code, 'validation_failed');
  }
  assert.equal((await db.query('select count(*)::int as n from public.operations where profile_id = $1', [w.ids.alice])).rows[0].n, 0);
});

test('expectedRevision edges: strings, fractions, negatives, zero, huge, NaN-like are 400; the largest valid is a conflict, never a 500', async () => {
  const w = await createWorld(db);
  const record = sampleRecord('foodQuestions');
  for (const expectedRevision of ['1', 1.5, -1, 0, -0, 2147483647, 2 ** 53, 1e21, true, undefined]) {
    const command = { kind: 'write', collection: 'foodQuestions', record, expectedRevision };
    const raw = JSON.stringify({ operationId: crypto.randomUUID(), ...command });
    const response = await w.command(null, { raw, key: JSON.parse(raw).operationId });
    assert.equal(response.status, 400, String(expectedRevision));
  }
  const { status, json } = await send(w, { kind: 'write', collection: 'foodQuestions', record, expectedRevision: 2147483646 });
  assert.equal(status, 200);
  assert.deepEqual([json.status, json.code], ['failed', 'conflict']);
  const rem = await send(w, { kind: 'remove', collection: 'foodQuestions', recordId: record.id, expectedRevision: 2147483646 });
  assert.deepEqual([rem.json.status, rem.json.code], ['failed', 'conflict']);
});

test('record size: exactly 262,144 bytes is stored; one more byte is a clean validation refusal; nothing locks the client', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  const base = { ...sampleRecord('foodQuestions', { id: 'big' }), revision: 1 };
  const room = (pad) => LIMITS.recordBytes - Buffer.byteLength(JSON.stringify({ ...base, pad }), 'utf8');
  const exact = 'p'.repeat(room('') );
  assert.equal(Buffer.byteLength(JSON.stringify({ ...base, pad: exact }), 'utf8'), LIMITS.recordBytes);
  assert.equal(await ws.write('foodQuestions', { ...sampleRecord('foodQuestions', { id: 'big' }), pad: exact }), true, ws.state.message);
  assert.equal((await loaded(w)).records.foodQuestions[0].pad.length, exact.length);
  const over = await send(w, create('foodQuestions', { ...sampleRecord('foodQuestions', { id: 'big2' }), pad: `${exact}p` }));
  assert.deepEqual([over.status, over.json.status, over.json.code], [200, 'failed', 'validation']);
});

test('record size, structure-heavy: a record under 262,144 bytes whose jsonb text form is larger is still stored (not a 500 from the 300,000 backstop)', async (t) => {
  const logged = muteConsoleError(t);
  const w = await createWorld(db);
  const base = { ...sampleRecord('foodQuestions', { id: 'dense' }), revision: 1 };
  // `[1,1,...]` is 2 bytes an element as sent and 3 as jsonb prints it.
  const fixed = Buffer.byteLength(JSON.stringify({ ...base, dense: [] }), 'utf8');
  const count = Math.floor((LIMITS.recordBytes - fixed) / 2);
  const dense = new Array(count).fill(1);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...base, dense }), 'utf8') <= LIMITS.recordBytes);
  const { status, json } = await send(w, create('foodQuestions', { ...sampleRecord('foodQuestions', { id: 'dense' }), dense }));
  assert.equal(status, 200, `${status} ${JSON.stringify(json).slice(0, 200)} ${loggedText(logged).slice(0, 300)}`);
  assert.equal(json.status, 'succeeded');
});

test('text a database cannot hold (NUL, lone surrogate) never becomes a 500 that locks the client or leaks content', async (t) => {
  const logged = muteConsoleError(t);
  const w = await createWorld(db);
  const ws = await loaded(w);
  const secret = 'PRIVATE-NUL-MARKER';
  assert.equal(await ws.write('foodQuestions', sampleRecord('foodQuestions', { question: `${secret}${ch(0)}tail` })), false);
  const afterNul = { message: ws.state.message, locked: locked(ws) };
  const ws2 = await loaded(w);
  assert.equal(await ws2.write('foodQuestions', sampleRecord('foodQuestions', { question: `${secret}${ch(0xd800)}tail` })), false);
  const afterSurrogate = { message: ws2.state.message, locked: locked(ws2) };
  assert.ok(!loggedText(logged).includes(secret), 'no record content in logs');
  assert.deepEqual(await w.rows('alice'), []);
  assert.equal(afterNul.message, REFUSALS.invalid_record.message);
  assert.equal(afterSurrogate.message, REFUSALS.invalid_record.message);
  // Literal text that merely looks like an escape is ordinary text and saves, and so does a valid surrogate pair.
  const bs = ch(92);
  const text = [`${bs}u0000`, `${bs}${bs}u0000`, `${bs}ud800`, 'pair ' + ch(0xd83c) + ch(0xdf0a)];
  for (const question of text) {
    const ok = await send(w, create('foodQuestions', sampleRecord('foodQuestions', { question })));
    assert.equal(ok.json.status, 'succeeded', question);
    assert.equal(ok.json.changes.foodQuestions.at(-1).question, question);
  }
  // A lone surrogate in an id is a 400, in a create, a remove and a selection.
  for (const command of [create('foodQuestions', { ...sampleRecord('foodQuestions'), id: 'a' + ch(0xdc00) }), { kind: 'remove', collection: 'foodQuestions', recordId: ch(0xd800), expectedRevision: 1 }, { kind: 'remove-notes', selection: [{ id: ch(0xd800), revision: 1 }] }]) {
    assert.equal((await send(w, command)).status, 400);
  }
  assert.deepEqual(afterNul.locked, [], `NUL: ${afterNul.message}`);
  assert.deepEqual(afterSurrogate.locked, [], `lone surrogate: ${afterSurrogate.message}`);
});

test('home-owned writes: a foreign, unknown, empty or missing home is refused with nothing stored; changing to a foreign home on update is refused', async () => {
  const w = await createWorld(db);
  for (const key of ['assets', 'observations', 'gardens', 'usage', 'pantryItems']) {
    for (const homeContextId of [w.home.bob, crypto.randomUUID(), 'not-a-uuid', '']) {
      const { json } = await send(w, create(key, sampleRecord(key, { homeContextId })));
      assert.equal(json.status, 'failed', `${key} ${homeContextId}`);
      assert.equal(json.code, 'validation');
      assert.deepEqual(json.changes, {});
    }
    const missing = sampleRecord(key); // no homeContextId
    assert.equal((await send(w, create(key, missing))).json.status, 'failed', `${key} missing home`);
    const ok = await send(w, create(key, sampleRecord(key, { homeContextId: w.home.alice })));
    assert.equal(ok.json.status, 'succeeded', key);
    const row = ok.json.changes[key][0];
    const moved = await send(w, { kind: 'write', collection: key, record: { ...row, homeContextId: w.home.bob }, expectedRevision: 1 });
    assert.deepEqual([moved.json.status, moved.json.reason], ['failed', 'invalid_reference'], key);
    const same = await send(w, { kind: 'write', collection: key, record: { ...row, title: 'Edited' }, expectedRevision: 1 });
    assert.equal(same.json.status, 'succeeded', key);
  }
  assert.deepEqual((await w.rows('bob')), []);
  // A non-home collection that carries a foreign homeContextId is refused too.
  const food = await send(w, create('foodQuestions', { ...sampleRecord('foodQuestions'), homeContextId: w.home.bob }));
  assert.equal(food.json.status, 'failed');
});

test('tests contextId: own home and own garden pass; bob\'s home, bob\'s garden, an unknown id are refused; an unchanged dangling context still saves', async () => {
  const w = await createWorld(db);
  const alice = await loaded(w);
  const bob = await loaded(w, 'bob');
  assert.equal(await alice.write('gardens', sampleRecord('gardens', { id: 'garden-a', homeContextId: w.home.alice })), true);
  assert.equal(await bob.write('gardens', sampleRecord('gardens', { id: 'garden-b', homeContextId: w.home.bob })), true);
  const mk = (contextId, over = {}) => ({ ...sampleRecord('tests', { homeContextId: w.home.alice }), contextId, ...over });
  assert.equal(await alice.write('tests', mk(w.home.alice)), true);
  assert.equal(await alice.write('tests', mk('garden-a')), true, alice.state.message);
  for (const bad of [w.home.bob, 'garden-b', 'nowhere', 'sample-current-home']) {
    assert.equal(await alice.write('tests', mk(bad)), false, bad);
    assert.equal(alice.state.message, REFUSALS.invalid_reference.message, bad);
  }
  // Delete the garden: the test keeps the context ("Retained historical context") and edits still save.
  const gardenTest = alice.records.tests.find((row) => row.contextId === 'garden-a');
  assert.equal(await alice.remove('gardens', 'garden-a', 1), true);
  assert.equal(await alice.write('tests', { ...gardenTest, purpose: 'Edited later' }), true, alice.state.message);
  // But linking a NEW test to the deleted garden is refused.
  assert.equal(await alice.write('tests', mk('garden-a')), false);
});

test('gardens testIds: own tests may be added; foreign or missing ones are refused; existing dangling ids stay saveable; duplicates are fine', async () => {
  const w = await createWorld(db);
  const alice = await loaded(w);
  const bob = await loaded(w, 'bob');
  const t1 = sampleRecord('tests', { homeContextId: w.home.alice });
  const bobTest = sampleRecord('tests', { homeContextId: w.home.bob });
  assert.equal(await alice.write('tests', t1), true);
  assert.equal(await bob.write('tests', bobTest), true);
  const garden = (testIds, id = 'garden-1') => sampleRecord('gardens', { id, homeContextId: w.home.alice, testIds });
  assert.equal(await alice.write('gardens', garden([t1.id, t1.id])), true, alice.state.message);
  assert.equal(await alice.write('gardens', garden([bobTest.id], 'garden-2')), false);
  assert.equal(await alice.write('gardens', garden(['test-nowhere'], 'garden-3')), false);
  const stored = alice.records.gardens[0];
  assert.equal(await alice.write('gardens', { ...stored, testIds: [t1.id, bobTest.id] }), false, 'adding a foreign id on update');
  assert.equal(await alice.remove('tests', t1.id, 1), true);
  assert.equal(await alice.write('gardens', { ...stored, setup: 'Raised bed 2' }), true, 'dangling existing link does not block an edit');
});

test('exploreNotes: removing one removes its note-case in the same commit and both collections come back valid; a missing case is fine', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  assert.equal(await ws.write('exploreNotes', sampleRecord('exploreNotes', { id: 'n1' })), true);
  assert.equal(await ws.write('exploreNotes', sampleRecord('exploreNotes', { id: 'n2' })), true);
  assert.equal(await ws.write('exploreOutcomes', sampleRecord('exploreOutcomes', { id: 'note-case:n1' })), true);
  assert.equal(await ws.write('exploreOutcomes', { ...ws.records.exploreOutcomes[0], result: 'edited' }), true); // case at revision 2
  assert.equal(await ws.remove('exploreNotes', 'n1', 1), true, ws.state.message);
  assert.deepEqual(ws.records.exploreOutcomes, []);
  assert.deepEqual(ws.records.exploreNotes.map((row) => row.id), ['n2']);
  assert.equal(await ws.remove('exploreNotes', 'n2', 1), true, 'no case to remove');
  assert.deepEqual(await w.rows('alice'), []);
  // remove-notes: a case carried by another household with the same id is not touched.
  const bob = await loaded(w, 'bob');
  assert.equal(await bob.write('exploreOutcomes', sampleRecord('exploreOutcomes', { id: 'note-case:n9' })), true);
  assert.equal(await ws.write('exploreNotes', sampleRecord('exploreNotes', { id: 'n9' })), true);
  assert.equal(await ws.removeNotes([{ id: 'n9', revision: 1 }]), true);
  assert.equal((await w.rows('bob', 'exploreOutcomes')).length, 1);
});

test('remove-notes bad selections: duplicates, 101 notes, zero, bad revisions are 400; an unknown note is notes_changed with nothing removed', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  assert.equal(await ws.write('exploreNotes', sampleRecord('exploreNotes', { id: 'keep' })), true);
  for (const selection of [[], [{ id: 'keep', revision: 1 }, { id: 'keep', revision: 1 }], Array.from({ length: 101 }, (_, i) => ({ id: `n${i}`, revision: 1 })), [{ id: 'keep', revision: 0 }], [{ id: 'keep' }], 'keep']) {
    assert.equal((await send(w, { kind: 'remove-notes', selection })).status, 400);
  }
  const unknown = await send(w, { kind: 'remove-notes', selection: [{ id: 'keep', revision: 1 }, { id: 'ghost', revision: 1 }] });
  assert.deepEqual([unknown.json.status, unknown.json.reason], ['failed', 'notes_changed']);
  assert.equal((await w.rows('alice', 'exploreNotes')).length, 1);
  const exact100 = await send(w, { kind: 'remove-notes', selection: [{ id: 'keep', revision: 1 }, ...Array.from({ length: 99 }, (_, i) => ({ id: `n${i}`, revision: 1 }))] });
  assert.equal(exact100.json.reason, 'notes_changed');
});

test('If-Match: a mismatch is a 400, a match is accepted, remove-notes with an If-Match is a 400, no header is fine', async () => {
  const w = await createWorld(db);
  const record = sampleRecord('foodFollows', { id: 'f1' });
  assert.equal((await send(w, create('foodFollows', record))).json.status, 'succeeded');
  const cmd = { kind: 'remove', collection: 'foodFollows', recordId: 'f1', expectedRevision: 1 };
  assert.equal((await w.command(body(cmd), { headers: { 'if-match': '2' } })).status, 400);
  assert.equal((await w.command(body(cmd), { headers: { 'if-match': '01' } })).status, 400);
  assert.equal((await w.command(body({ kind: 'remove-notes', selection: [{ id: 'a', revision: 1 }] }), { headers: { 'if-match': '1' } })).status, 400);
  assert.equal((await w.command(body(cmd), { headers: { 'if-match': '1' } })).status, 200);
});

test('operation id edges: Idempotency-Key missing/mismatched/uppercase, other household reusing an id, and a body that is not an object', async () => {
  const w = await createWorld(db);
  const command = body(create('foodFollows', sampleRecord('foodFollows')));
  assert.equal((await w.command(command, { key: null })).status, 400);
  assert.equal((await w.command(command, { key: crypto.randomUUID() })).status, 400);
  assert.equal((await w.command(command, { key: command.operationId.toUpperCase() })).status, 200);
  for (const raw of ['null', '[]', '"x"', '7', '{', '']) {
    const status = (await w.command(null, { raw, key: command.operationId })).status;
    assert.ok(status >= 400 && status < 500, `${raw}: ${status}`);
  }
});

test('two households interleaving the same ids concurrently never cross; concurrent same-record saves: exactly one wins, the other is a stale refusal', async () => {
  const w = await createWorld(db);
  const ids = ['shared-1', 'shared-2', 'shared-3'];
  const results = await Promise.all(ids.flatMap((id) => [
    send(w, create('foodQuestions', sampleRecord('foodQuestions', { id, question: 'alice' })), { as: 'alice' }),
    send(w, create('foodQuestions', sampleRecord('foodQuestions', { id, question: 'bob' })), { as: 'bob' }),
  ]));
  assert.ok(results.every((r) => r.json.status === 'succeeded'));
  assert.deepEqual((await w.rows('alice', 'foodQuestions')).map((r) => r.record.question), ['alice', 'alice', 'alice']);
  assert.deepEqual((await w.rows('bob', 'foodQuestions')).map((r) => r.record.question), ['bob', 'bob', 'bob']);
  const race = await Promise.all([1, 2, 3, 4].map((n) => send(w, { kind: 'write', collection: 'foodQuestions', record: { ...sampleRecord('foodQuestions', { id: 'shared-1' }), note: `n${n}` }, expectedRevision: 1 })));
  assert.deepEqual(race.map((r) => r.json.status).sort(), ['failed', 'failed', 'failed', 'succeeded']);
  assert.ok(race.filter((r) => r.json.status === 'failed').every((r) => r.json.reason === 'stale_revision'));
  assert.equal((await w.rows('alice', 'foodQuestions')).find((r) => r.record_id === 'shared-1').revision, 2);
});

test('concurrent creates of one id, and a delete racing an edit of the same record: exactly one wins, the loser is a stale refusal, no duplicate rows', async () => {
  const w = await createWorld(db);
  const creates = await Promise.all([1, 2, 3].map((n) => send(w, create('foodQuestions', sampleRecord('foodQuestions', { id: 'same', note: `n${n}` })))));
  assert.deepEqual(creates.map((r) => r.json.status).sort(), ['failed', 'failed', 'succeeded']);
  assert.ok(creates.filter((r) => r.json.status === 'failed').every((r) => r.json.reason === 'stale_revision'));
  assert.equal((await w.rows('alice', 'foodQuestions')).length, 1);
  const [edit, del] = await Promise.all([
    send(w, { kind: 'write', collection: 'foodQuestions', record: sampleRecord('foodQuestions', { id: 'same', note: 'edit' }), expectedRevision: 1 }),
    send(w, { kind: 'remove', collection: 'foodQuestions', recordId: 'same', expectedRevision: 1 }),
  ]);
  assert.deepEqual([edit.json.status, del.json.status].sort(), ['failed', 'succeeded']);
  assert.equal((await w.rows('alice', 'foodQuestions')).length, edit.json.status === 'succeeded' ? 1 : 0);
});

test('reconcile for every ledger status passes the client adapter\'s receipt check and the sentence is honest', async () => {
  const w = await createWorld(db);
  const adapter = w.adapter();
  const signal = new AbortController().signal;
  const insert = (status, result, extra = '') => {
    const id = crypto.randomUUID();
    return db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, result ${extra ? ', created_at' : ''}) values ($1, $2, 'workspace', 'workspace.write', $3, $4 ${extra ? `, now() - interval '1 day'` : ''})`,
      [id, w.ids.alice, status, result === null ? null : JSON.stringify(result)]).then(() => id);
  };
  const cases = {
    pending: await insert('pending', null),
    stalePending: await insert('pending', null, 'old'),
    failedAbandoned: await insert('failed', { status: 'failed', reason: 'abandoned' }),
    failedStale: await insert('failed', { status: 'failed', reason: 'stale_revision', unresolvedOperations: [] }),
    failedNoResult: await insert('failed', null),
    succeededNoResult: await insert('succeeded', { status: 'succeeded' }),
    succeededUnknownCollection: await insert('succeeded', { status: 'succeeded', collections: ['weekJournal', 'tests', 7, 'bogus'], affected: [], removed: [] }),
  };
  for (const [name, id] of Object.entries(cases)) {
    const receipt = await adapter.reconcile(id, signal, 'workspace');
    assert.equal(receipt.operationId, id, name);
    assert.ok(['succeeded', 'failed', 'pending', 'unknown'].includes(receipt.status), `${name}: ${receipt.status}`);
    assert.ok(validHomeChanges(receipt.changes), name);
    cases[name] = receipt;
  }
  assert.equal(cases.pending.status, 'pending');
  assert.equal(cases.stalePending.status, 'failed', 'an abandoned claim is reaped on read');
  assert.match(cases.stalePending.message, /did not finish/);
  assert.deepEqual(cases.failedAbandoned.changes, {});
  assert.equal(cases.failedStale.code, 'conflict');
  assert.equal(cases.failedNoResult.status, 'failed');
  assert.equal(cases.succeededNoResult.status, 'succeeded');
  // The journal (0034) is read back for a succeeded save even with its flag off; unknown names are dropped.
  assert.deepEqual(cases.succeededUnknownCollection.changes, { weekJournal: [], tests: [] });
  // A workspace operation id read in another domain, or another household's, is a 404 and nothing more.
  const [id] = Object.values(cases).map((c) => c.operationId);
  assert.equal((await w.reconcile(id, { domain: 'explore' })).status, 404);
  assert.equal((await w.reconcile(id, { as: 'bob' })).status, 404);
});

test('a replay of a refusal answers the identical body even after the state would now allow it; reconcile agrees', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  const ghost = body({ kind: 'write', collection: 'observations', record: sampleRecord('observations', { homeContextId: w.home.alice, testId: 'test-late' }), expectedRevision: null });
  const first = await (await w.command(ghost)).json();
  assert.deepEqual([first.status, first.reason], ['failed', 'invalid_reference']);
  assert.equal(await ws.write('tests', sampleRecord('tests', { id: 'test-late', homeContextId: w.home.alice })), true);
  const replay = await (await w.command(ghost)).json();
  assert.deepEqual(replay, first);
  assert.deepEqual((await w.rows('alice', 'observations')), []);
  const rec = await (await w.reconcile(ghost.operationId)).json();
  assert.equal(rec.status, 'failed');
  assert.equal(rec.code, 'validation');
  assert.deepEqual(rec.changes, {});
  // Stale refusal, replayed.
  const stale = body({ kind: 'remove', collection: 'tests', recordId: 'test-late', expectedRevision: 9 });
  const a = await (await w.command(stale)).json();
  const b = await (await w.command(stale)).json();
  assert.deepEqual(a, b);
  assert.equal(a.reason, 'stale_revision');
  // Same id, different input: 409.
  assert.equal((await w.command({ ...stale, expectedRevision: 8 })).status, 409);
});

test('a ledger-refused attempt is a 200 failed receipt the client accepts without locking; the next save works', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  assert.equal(await ws.write('observations', sampleRecord('observations', { testId: 'test-nowhere' })), false);
  assert.deepEqual(locked(ws), []);
  assert.equal(ws.canMutate(), true);
  assert.equal(await ws.write('foodFollows', sampleRecord('foodFollows')), true);
});

test('no response body, success or refusal, fails the client\'s own collection validators; no top-level data key', async () => {
  const w = await createWorld(db);
  const results = [];
  for (const key of STORED_COLLECTIONS) {
    const r = await send(w, create(key, sampleRecord(key, ['tests', 'assets', 'observations', 'gardens', 'usage', 'pantryItems'].includes(key) ? { homeContextId: w.home.alice } : {})));
    results.push(r);
    assert.equal(r.json.status, 'succeeded', key);
    assert.ok(validHomeChanges(r.json.changes));
    for (const [name, rows] of Object.entries(r.json.changes)) assert.ok(validProductionCollection(name, rows), name);
    assert.ok(!('data' in r.json));
  }
  for (const key of STORED_COLLECTIONS) {
    const l = await (await w.load(key)).json();
    assert.ok(validProductionCollection(key, l.records), key);
    assert.equal(l.availability, 'ready');
    assert.ok(!('data' in l));
  }
});

test('flag off: load 503, execute 200 failed, reconcile of an earlier operation 503, nothing claimed', async () => {
  const w = await createWorld(db, { env: {} });
  const op = await send(w, create('foodFollows', sampleRecord('foodFollows')), { env: { HALO_FEATURE_WORKSPACE: 'on' } });
  assert.equal(op.json.status, 'succeeded');
  assert.equal((await w.load('tests')).status, 503);
  assert.equal((await w.reconcile(op.json.operationId)).status, 503);
  const ws = await loaded(w);
  assert.equal(ws.status('tests').status, 'error');
  assert.equal(await ws.write('foodFollows', sampleRecord('foodFollows')), false);
  // Garbage kind with the flag off is still the quiet 200 failed receipt, never a 5xx.
  const junk = await send(w, { kind: 'explode' });
  assert.deepEqual([junk.status, junk.json.status, junk.json.code], [200, 'failed', 'unavailable']);
});

test('no log line carries record content on any failure path', async (t) => {
  const logged = muteConsoleError(t);
  const secret = 'PRIVATE-LOG-MARKER-xyz';
  let lose = false;
  const w = await createWorld(db, { onCommit: async (_a, call) => { const r = await call(); if (lose) { lose = false; throw Object.assign(new Error(`boom ${secret}`), { code: '' }); } return r; } });
  const ws = await loaded(w);
  await ws.write('foodQuestions', sampleRecord('foodQuestions', { question: secret }));
  await ws.write('observations', sampleRecord('observations', { note: secret, testId: 'nowhere' }));
  await ws.write('tests', { ...sampleRecord('tests', { homeContextId: w.home.alice, title: secret }), kind: 'bad' });
  await send(w, create('tests', { ...sampleRecord('tests', { homeContextId: w.home.alice }), attachments: [{ secret }] }));
  await send(w, { kind: 'remove', collection: 'tests', recordId: secret, expectedRevision: 3 });
  assert.ok(!loggedText(logged).includes(secret), loggedText(logged));
  assert.ok(!(await w.ledgerText()).includes(secret));
});

test('clear all removes workspace rows through the privacy route boundary; clear journal keeps them', async () => {
  // The SQL boundary (0024 clear_household_records + 0026 trigger) is exercised in workspaceSchema.test.mjs;
  // here the rows are written through the real routes first, then cleared via the real function.
  const w = await createWorld(db);
  const ws = await loaded(w);
  assert.equal(await ws.write('foodFollows', sampleRecord('foodFollows')), true);
  const bobWs = await loaded(w, 'bob');
  assert.equal(await bobWs.write('foodFollows', sampleRecord('foodFollows')), true);
  const print = async (scope) => (await db.query(`select public.privacy_fingerprint($1, $2::text[]) as f`, [w.ids.alice, scope === 'journal' ? ['symptom_logs'] : ['profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs', 'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions', 'household_action_preferences', 'luna_conversations', 'luna_turns']])).rows[0].f;
  const clear = async (scope) => {
    const op = crypto.randomUUID();
    await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'privacy', $3, 'pending')`, [op, w.ids.alice, `privacy.clear.${scope}`]);
    return db.query(`select public.clear_household_records($1, $2, $3, $4) as out`, [w.ids.alice, op, scope, await print(scope)]);
  };
  await db.query(`delete from public.operations where profile_id = $1 and status = 'pending'`, [w.ids.alice]);
  await clear('journal');
  assert.equal((await w.rows('alice')).length, 1, 'clear journal keeps the workspace');
  await clear('all');
  assert.equal((await w.rows('alice')).length, 0, 'clear all removes it');
  assert.equal((await w.rows('bob')).length, 1);
  const after = await loaded(w);
  assert.deepEqual(after.records.foodFollows, []);
});

test('a deeply nested unknown field never becomes a 5xx that leaves the client locked', async (t) => {
  const logged = muteConsoleError(t);
  const w = await createWorld(db);
  for (const depth of [50, 2000, 100000]) {
    const id = crypto.randomUUID();
    const raw = JSON.stringify({ operationId: id, ...create('foodQuestions', sampleRecord('foodQuestions', { id: `deep-${depth}` })) }).replace('"record":{', `"record":{"nested":${'['.repeat(depth)}${']'.repeat(depth)},`);
    const response = await w.command(null, { raw, key: id });
    assert.ok(response.status < 500, `depth ${depth}: ${response.status} ${loggedText(logged).slice(0, 200)}`);
  }
});
