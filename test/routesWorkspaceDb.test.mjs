/**
 * B11, the Homeguard workspace end to end: GET /api/frontend/workspace,
 * POST /api/frontend/workspace/commands and GET /api/operations?domain=workspace,
 * with EVERYTHING real below the routes (migration 0026's functions and the
 * 0017 ledger on PGlite, test/helpers/workspaceWorld.mjs) and the CLIENT's own
 * code above them: the frontend runtime and home adapter compiled from this
 * tree, and the provider's decisions (test/helpers/frontendB11.mjs). Each
 * scenario ends on what the screen holds: whether a save returned true, the
 * sentence shown, whether Homeguard is locked on an operation, and the rows.
 *
 * Everything is local: synthetic identities, the in-memory fake for the
 * session, PGlite for the database, and a fetch that throws on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { loggedText } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { createWorld, body, sampleRecord, COMMANDS } from './helpers/workspaceWorld.mjs';
import { validProductionCollection } from './helpers/frontendB11.mjs';
// Dynamic, so the route harness's module hooks (the @/ alias) are registered first.
const { STORED_COLLECTIONS, UNSTORED_COLLECTIONS, WORKSPACE_COLLECTIONS, REFUSALS } = await import('../lib/workspaceStore.js');

const MARKER = 'PRIVATE-TEST-MARKER kitchen tap near the old pipes';
const SAVED = 'Saved.';
const STALE = REFUSALS.stale_revision.message;

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

/** A loaded Homeguard for `who`, every collection the provider preloads. */
async function loaded(w, who = 'alice', options = {}) {
  const ws = w.workspace(who, options);
  await ws.loadAll(WORKSPACE_COLLECTIONS);
  return ws;
}
const locked = (ws) => ws.state.unknownOperations.map((item) => item.operationId);

test('a new household loads all sixteen collections: fourteen ready and empty, the journal and home history unavailable, nothing locked', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  for (const key of STORED_COLLECTIONS) {
    assert.deepEqual(ws.status(key), { status: 'ready', revision: undefined, complete: true, message: undefined }, key);
    assert.deepEqual(ws.records[key], [], key);
  }
  for (const [key, copy] of Object.entries(UNSTORED_COLLECTIONS)) {
    assert.deepEqual(ws.status(key), { status: 'error', complete: false, message: copy.load }, key);
    assert.equal(ws.records[key], undefined);
  }
  assert.deepEqual(locked(ws), []);
  assert.equal(ws.canMutate(), true);
  // The wire shape: pendingOperations present though empty, no top-level data key.
  const raw = await (await w.load('tests')).json();
  assert.deepEqual(raw, { records: [], availability: 'empty', complete: true, pendingOperations: [] });
});

test('tests: create, update and delete through the client, each confirmed by the canonical rows and kept after a reload', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  const record = sampleRecord('tests', { title: MARKER, homeContextId: w.home.alice });
  assert.equal(await ws.write('tests', record), true);
  assert.equal(ws.state.message, SAVED);
  assert.deepEqual(ws.records.tests.map((row) => [row.id, row.revision, row.title]), [[record.id, 1, MARKER]]);

  const stored = ws.records.tests[0];
  assert.equal(await ws.write('tests', { ...stored, status: 'arranged', provider: 'County lab' }), true);
  assert.deepEqual(ws.records.tests.map((row) => [row.revision, row.status, row.provider]), [[2, 'arranged', 'County lab']]);

  const again = await loaded(w);
  assert.deepEqual(again.records.tests, ws.records.tests, 'a reload shows exactly what the receipt did');
  assert.ok(validProductionCollection('tests', again.records.tests));

  assert.equal(await ws.remove('tests', record.id, 2), true);
  assert.deepEqual(ws.records.tests, []);
  assert.deepEqual(await w.rows('alice', 'tests'), []);
  assert.ok(!(await w.ledgerText()).includes('PRIVATE-TEST-MARKER'), 'the ledger holds names, ids and revisions only');
  assert.deepEqual(locked(ws), []);
});

test('every stored collection takes a create from the client and reloads valid; home-owned records carry the current home', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  for (const key of STORED_COLLECTIONS) {
    const record = sampleRecord(key, key === 'tests' ? { homeContextId: w.home.alice } : {});
    assert.equal(await ws.write(key, record), true, `${key}: ${ws.state.message}`);
  }
  const again = await loaded(w);
  for (const key of STORED_COLLECTIONS) {
    assert.equal(again.records[key].length, 1, key);
    assert.ok(validProductionCollection(key, again.records[key]), key);
  }
  for (const key of ['assets', 'observations', 'gardens', 'usage', 'pantryItems']) assert.equal(again.records[key][0].homeContextId, w.home.alice, key);
});

test('a stale write from a second tab is refused with the client\'s sentence, keeps the draft unlocked, and changes nothing', async () => {
  const w = await createWorld(db);
  const one = await loaded(w);
  const two = await loaded(w);
  assert.equal(await one.write('tests', sampleRecord('tests', { id: 'test-shared', homeContextId: w.home.alice })), true);
  await two.retry('tests');
  assert.equal(await two.write('tests', { ...two.records.tests[0], provider: 'Tab two' }), true);
  assert.equal(await one.write('tests', { ...one.records.tests[0], provider: 'Tab one' }), false);
  assert.equal(one.state.message, STALE);
  assert.deepEqual(locked(one), []);
  assert.deepEqual((await w.rows('alice', 'tests')).map((row) => [row.revision, row.record.provider]), [[2, 'Tab two']]);
  // A create of an id that already exists is the same refusal.
  const fresh = await loaded(w);
  const answer = await (await w.command(body({ kind: 'write', collection: 'tests', record: { ...fresh.records.tests[0], revision: 0 }, expectedRevision: null }))).json();
  assert.equal(answer.status, 'failed');
  assert.equal(answer.code, 'conflict');
  assert.deepEqual(answer.changes, {});
});

test('a save whose answer is lost after the commit stays succeeded; the client locks, reconciles to "Saved." and holds the record', async (t) => {
  const logged = muteConsoleError(t);
  const w = await createWorld(db);
  let lose = true;
  const ws = await loaded(w, 'alice', { lose: (path) => path === COMMANDS && lose && !(lose = false) });
  const record = sampleRecord('tests', { homeContextId: w.home.alice });
  assert.equal(await ws.write('tests', record), false);
  const [operationId] = ws.state.operationIds;
  assert.deepEqual(locked(ws), [operationId]);
  assert.equal(ws.canMutate(), false);
  assert.equal((await w.ledgerRow(operationId)).status, 'succeeded');

  assert.equal(await ws.reconcile(operationId), true);
  assert.equal(ws.state.message, SAVED);
  assert.deepEqual(locked(ws), []);
  assert.deepEqual(ws.records.tests.map((row) => [row.id, row.revision]), [[record.id, 1]]);
  assert.equal(loggedText(logged), '', 'nothing logged');
});

test('a 500 from a commit that did land: the settled guard keeps it succeeded, the reconcile recovers it', async (t) => {
  const logged = muteConsoleError(t);
  let lose = true;
  const w = await createWorld(db, {
    onCommit: async (_args, call) => {
      const result = await call();
      if (lose) { lose = false; throw rpcError('', 'TypeError: fetch failed'); }
      return result;
    },
  });
  const ws = await loaded(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { homeContextId: w.home.alice })), false);
  const [operationId] = ws.state.operationIds;
  assert.equal((await w.ledgerRow(operationId)).status, 'succeeded', 'runOperation\'s failed settle was refused by 0026\'s guard');
  assert.deepEqual(locked(ws), [operationId]);
  assert.equal(await ws.reconcile(operationId), true);
  assert.equal(ws.records.tests.length, 1);
  const lines = loggedText(logged);
  assert.match(lines, new RegExp(`operations: could not settle ${operationId} as failed: HALO_OPERATION_SETTLED`));
  assert.ok(!lines.includes('A record'), 'no record content is logged');
});

test('an unsettled operation from another device locks the load, and its reconcile says so until it settles', async () => {
  const w = await createWorld(db);
  const operationId = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'workspace', 'workspace.write', 'pending')`, [operationId, w.ids.alice]);
  const ws = await loaded(w);
  assert.deepEqual(locked(ws), [operationId]);
  assert.equal(await ws.write('tests', sampleRecord('tests', { homeContextId: w.home.alice })), false);
  assert.equal(ws.state.message, 'Check the pending save status before making another change. Your draft is kept.');

  assert.equal(await ws.reconcile(operationId), false, 'still pending');
  assert.deepEqual(locked(ws), [operationId]);

  await db.query(`update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}' where operation_id = $1`, [operationId]);
  assert.equal(await ws.reconcile(operationId), false, 'a failed operation saved nothing');
  assert.deepEqual(locked(ws), [], 'and no longer locks');
  assert.equal(ws.canMutate(), true);
  assert.equal(await ws.write('tests', sampleRecord('tests', { homeContextId: w.home.alice })), true);
});

test('references: an own test links; a missing one, or another household\'s, is refused with nothing written', async () => {
  const w = await createWorld(db);
  const alice = await loaded(w);
  const bob = await loaded(w, 'bob');
  const test1 = sampleRecord('tests', { homeContextId: w.home.alice });
  assert.equal(await alice.write('tests', test1), true);
  assert.equal(await alice.write('observations', sampleRecord('observations', { testId: test1.id })), true);

  assert.equal(await alice.write('observations', sampleRecord('observations', { testId: 'test-nowhere' })), false);
  assert.equal(alice.state.message, REFUSALS.invalid_reference.message);
  assert.deepEqual(locked(alice), []);

  assert.equal(await bob.write('observations', sampleRecord('observations', { testId: test1.id })), false, 'alice\'s test is not bob\'s');
  assert.equal(bob.state.message, REFUSALS.invalid_reference.message);
  assert.equal(await bob.write('tests', sampleRecord('tests', { homeContextId: w.home.alice })), false, 'nor is her home');
  assert.deepEqual(await w.rows('bob'), []);
  assert.equal((await w.rows('alice', 'observations')).length, 1);
});

test('another household: its records, pending list and operations never reach alice, and the same record id is its own', async () => {
  const w = await createWorld(db);
  const alice = await loaded(w);
  const bob = await loaded(w, 'bob');
  assert.equal(await alice.write('foodQuestions', sampleRecord('foodQuestions', { id: 'shared-id', question: MARKER })), true);
  assert.equal(await bob.write('foodQuestions', sampleRecord('foodQuestions', { id: 'shared-id', question: 'Bob asks' })), true);
  const [aliceOp] = alice.state.operationIds;
  const bobView = await loaded(w, 'bob');
  assert.deepEqual(bobView.records.foodQuestions.map((row) => row.question), ['Bob asks']);
  assert.equal((await w.reconcile(aliceOp, { as: 'bob' })).status, 404);
  // Bob deleting "shared-id" deletes his own only.
  assert.equal(await bobView.remove('foodQuestions', 'shared-id', 1), true);
  assert.deepEqual((await w.rows('alice', 'foodQuestions')).map((row) => row.record.question), [MARKER]);
  // Reusing alice's operation id as bob is the identical mismatch.
  const reuse = await w.command({ operationId: aliceOp, kind: 'remove', collection: 'foodQuestions', recordId: 'shared-id', expectedRevision: 1 }, { as: 'bob' });
  assert.equal(reuse.status, 409);
});

test('remove-notes removes the selected notes and their own cases in one commit; other outcomes stay', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  for (const id of ['note-a', 'note-b', 'note-c']) assert.equal(await ws.write('exploreNotes', sampleRecord('exploreNotes', { id })), true);
  for (const id of ['note-case:note-a', 'outcome-free']) assert.equal(await ws.write('exploreOutcomes', sampleRecord('exploreOutcomes', { id })), true);
  assert.equal(await ws.removeNotes([{ id: 'note-a', revision: 1 }, { id: 'note-b', revision: 1 }]), true);
  assert.deepEqual(ws.records.exploreNotes.map((row) => row.id), ['note-c']);
  assert.deepEqual(ws.records.exploreOutcomes.map((row) => row.id), ['outcome-free']);
  // A stale selection removes nothing.
  const other = await loaded(w);
  assert.equal(await ws.write('exploreNotes', { ...ws.records.exploreNotes[0], description: 'edited' }), true);
  assert.equal(await other.removeNotes([{ id: 'note-c', revision: 1 }]), false);
  assert.equal(other.state.message, REFUSALS.notes_changed.message);
  assert.equal((await w.rows('alice', 'exploreNotes')).length, 1);
});

test('clear-private is refused before any claim: one clearing path (C11), nothing deleted, nothing recorded, nothing locked', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  assert.equal(await ws.write('foodQuestions', sampleRecord('foodQuestions')), true);
  const { recordFingerprint } = await import('./helpers/frontendB11.mjs');
  const expected = recordFingerprint(ws.records, 'all');
  assert.equal(await ws.clearPrivate('all', expected), false);
  assert.equal(ws.state.message, REFUSALS.clear_unsupported.message);
  assert.deepEqual(locked(ws), []);
  const [, clearOp] = ws.state.operationIds;
  assert.equal(await w.ledgerRow(clearOp), null);
  assert.equal((await w.rows('alice')).length, 1);
});

test('the journal, home history and attachments are refused before any claim with their own sentences', async () => {
  const w = await createWorld(db);
  const send = async (command) => (await w.command(body(command))).json();
  const journal = await send({ kind: 'write', collection: 'weekJournal', record: { id: 'j1', title: 'Today', revision: 0 }, expectedRevision: null });
  assert.deepEqual([journal.status, journal.code, journal.message, journal.changes], ['failed', 'unavailable', UNSTORED_COLLECTIONS.weekJournal.write, {}]);
  const moved = await send({ kind: 'write', collection: 'homeTransitions', record: { id: 'h1', title: 'Moved', revision: 0 }, expectedRevision: null });
  assert.equal(moved.message, UNSTORED_COLLECTIONS.homeTransitions.write);
  const withFile = sampleRecord('tests', { homeContextId: w.home.alice, attachments: [{ id: 'a1', name: 'r.pdf', mime: 'application/pdf', revision: 1, bytes: 10, status: 'ready', metadataRemoved: true }] });
  const file = await send({ kind: 'write', collection: 'tests', record: withFile, expectedRevision: null });
  assert.deepEqual([file.status, file.message], ['failed', REFUSALS.attachments_unavailable.message]);
  const ledger = await db.query('select count(*)::int as n from public.operations where profile_id = $1', [w.ids.alice]);
  assert.deepEqual(ledger.rows, [{ n: 0 }]);
});

test('a record the client\'s row check would refuse is never stored, so no load can be discarded', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  assert.equal(await ws.write('tests', { ...sampleRecord('tests', { homeContextId: w.home.alice }), kind: 'plutonium' }), false);
  assert.equal(ws.state.message, REFUSALS.invalid_record.message);
  assert.equal(await ws.write('fishNotes', { ...sampleRecord('fishNotes'), date: '2026-02-30' }), false);
  assert.deepEqual(await w.rows('alice'), []);
});

test('flag off: the load is the 503 the screen shows as an error, a save is refused, and nothing is read or claimed', async () => {
  const w = await createWorld(db, { env: {} });
  const ws = await loaded(w);
  assert.equal(ws.status('tests').status, 'error');
  const answer = await (await w.command(body({ kind: 'remove', collection: 'tests', recordId: 'x', expectedRevision: 1 }))).json();
  assert.deepEqual([answer.status, answer.code, answer.changes], ['failed', 'unavailable', {}]);
  assert.equal(w.h.db.queryLog.filter((entry) => entry.table === 'operations').length, 0);
});

test('a replay of a succeeded save answers the current rows; the same id with other input is a 409', async () => {
  const w = await createWorld(db);
  const command = body({ kind: 'write', collection: 'foodFollows', record: sampleRecord('foodFollows', { id: 'follow-1' }), expectedRevision: null });
  const first = await (await w.command(command)).json();
  const replay = await (await w.command(command)).json();
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(replay, first);
  const changed = await w.command({ ...command, record: { ...command.record, saved: false } });
  assert.equal(changed.status, 409);
  const reconciled = await (await w.reconcile(command.operationId)).json();
  assert.equal(reconciled.status, 'succeeded');
  assert.deepEqual(reconciled.changes, first.changes);
});
