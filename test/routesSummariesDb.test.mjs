/**
 * B15, saved household summaries end to end: GET and POST /api/summaries,
 * GET /api/summaries/detail and GET /api/operations?domain=summary, with
 * EVERYTHING real below the routes (migrations 0029, 0026, 0023 and the 0017
 * ledger on PGlite, test/helpers/summariesWorld.mjs) and the CLIENT's own
 * code above them: the frontend runtime compiled from this tree, the Summary
 * screen's decisions (test/helpers/frontendB15.mjs) and the Homeguard
 * provider that makes the records (test/helpers/frontendB11.mjs). Each
 * scenario ends on what the screen holds: the snapshot shown, the sentence,
 * whether Create is locked on an operation, and the saved rows.
 *
 * Everything is local: synthetic identities, the in-memory fake for the
 * session, PGlite for the database, and a fetch that throws on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { muteConsoleError } from './helpers/routeHarness.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { sampleRecord, ON } from './helpers/workspaceWorld.mjs';
import { createSummaryWorld, SUMMARIES_ON } from './helpers/summariesWorld.mjs';
import { buildPrepare, exportLines, productionSelection, reviewText, validSummarySnapshot } from './helpers/frontendB15.mjs';
const { REFUSALS } = await import('../lib/summaryStore.js');
const { WORKSPACE_COLLECTIONS } = await import('../lib/workspaceStore.js');

const NOTE = 'PRIVATE-NOTE-MARKER the damp smell near the stairs';
const CHECKING = 'The summary is still being checked. Check its status before creating another.';
const UNAVAILABLE = 'This service is unavailable. Try again later.';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

/** A household with a test and an observation saved through Homeguard, and the screen loaded. */
async function household(w, who = 'alice') {
  const ws = w.workspace(who);
  await ws.loadAll(WORKSPACE_COLLECTIONS);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Kitchen tap', homeContextId: w.home[who] })), true);
  assert.equal(await ws.write('observations', sampleRecord('observations', { title: 'Damp corner', homeContextId: w.home[who], note: NOTE })), true);
  const screen = w.summary(who);
  await screen.loadList();
  return { ws, screen };
}
const selectionFor = (sections, over = {}) => {
  const base = productionSelection(2026);
  return { ...base, ...over, sections: { ...base.sections, scores: false, factors: false, ...sections } };
};
const prepareFrom = (ws, selection, w, who = 'alice', extra = {}) => {
  const built = buildPrepare({ selection, collections: ws.records, collectionStates: ws.state.collectionStates, currentHomeId: w.home[who], ...extra });
  assert.ok(built.input, built.error);
  return built.input;
};
const ledgerRows = async (w, who = 'alice') => (await db.query(`select operation_id::text, status, result from public.operations where profile_id = $1 and domain = 'summary' order by created_at`, [w.ids[who]])).rows;

test('flags off: the history cannot be verified and Create stays locked; a direct prepare is a failed receipt recorded nowhere', async () => {
  const w = await createSummaryWorld(db, { env: ON });
  const screen = w.summary();
  await screen.loadList();
  assert.equal(screen.error, UNAVAILABLE);
  assert.equal(screen.ready, false);
  assert.equal(screen.canCreate, false);
  const list = await w.list();
  assert.equal(list.status, 503);
  assert.equal((await list.json()).code, 'feature_unavailable');
  const key = crypto.randomUUID();
  const res = await w.prepare({ selection: selectionFor({ tests: true }) }, { key });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { operationId: key, status: 'failed', reason: 'unavailable', message: 'Saved summaries are not available yet. Nothing was saved.' });
  assert.deepEqual(await ledgerRows(w), []);
  assert.equal((await w.detail(crypto.randomUUID())).status, 503);
  assert.equal((await w.reconcile(key, { domain: 'summary' })).status, 404, 'never recorded, as in every domain');
  // A recorded summary operation is not read back while the flag is off.
  const recorded = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, result) values ($1, $2, 'summary', 'summary.prepare', 'failed', '{"status":"failed","reason":"changed"}')`, [recorded, w.ids.alice]);
  assert.equal((await w.reconcile(recorded, { domain: 'summary' })).status, 503);
  // The summaries flag alone is not enough: the workspace must be on too.
  assert.equal((await w.list({ env: { HALO_FEATURE_SUMMARIES: 'on', HALO_FEATURE_WORKSPACE: '' } })).status, 503);
});

test('a new household: the exact empty history, Create unlocked, nothing locked', async () => {
  const w = await createSummaryWorld(db);
  const res = await w.list();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { items: [], complete: true, unresolvedOperations: [] });
  const screen = w.summary();
  await screen.loadList();
  assert.equal(screen.error, null);
  assert.deepEqual(screen.archives, []);
  assert.equal(screen.canCreate, true);
});

test('prepare, list, reopen: the snapshot is exactly what was selected, reopens unchanged after the records change, and the ledger holds only the id', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  const selection = selectionFor({ tests: true, observations: true }, { notes: true });
  const input = prepareFrom(ws, selection, w);
  assert.equal(input.records.length, 2);
  const snapshot = await screen.prepare(input);
  assert.ok(snapshot, screen.message);
  assert.equal(validSummarySnapshot(snapshot), true);
  assert.equal(screen.message, '');
  assert.equal(screen.canCreate, true);
  assert.deepEqual(screen.archives.map((item) => [item.id, item.title, item.homeContextId]), [[snapshot.id, 'Household review', w.home.alice]]);
  assert.deepEqual(snapshot.manifest.map((row) => [row.kind, row.revision]), [['tests', 1], ['observations', 1]]);
  assert.ok(reviewText(snapshot).some((line) => line.includes(NOTE)), 'the chosen note is in the review');
  assert.ok(exportLines(snapshot).some((line) => line.startsWith('Omitted by selection or export scope:')), 'the export carries the scope line');
  assert.ok(!JSON.stringify(await ledgerRows(w)).includes('PRIVATE-NOTE-MARKER'), 'the ledger holds the summary id only');

  // Edit the observation; the saved summary does not change.
  const observation = ws.records.observations[0];
  assert.equal(await ws.write('observations', { ...observation, note: 'An edited note' }), true);
  const again = w.summary();
  await again.loadList();
  assert.equal(await again.open(snapshot.id), true);
  assert.deepEqual(again.snapshot, snapshot);
  const detail = await w.detail(snapshot.id);
  assert.equal(detail.headers.get('cache-control'), 'no-store');

  // Without notes, the note is not in the report.
  const quiet = await screen.prepare(prepareFrom(ws, selectionFor({ observations: true }), w));
  assert.ok(quiet);
  assert.ok(!JSON.stringify(quiet).includes('edited note'));
  assert.equal(quiet.manifest[0].revision, 2);
  assert.equal(screen.archives.length, 2);
  assert.equal(screen.archives[0].id, quiet.id, 'newest first');
});

test('a record changed after it was chosen: failed with its sentence, nothing saved, Create unlocked', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  const other = w.workspace('alice');
  await other.loadAll(['tests']);
  assert.equal(await other.write('tests', { ...other.records.tests[0], provider: 'County lab' }), true);
  assert.equal(await screen.prepare(input), null);
  assert.equal(screen.message, REFUSALS.changed);
  assert.equal(screen.canCreate, true);
  assert.deepEqual(await w.summaries(), []);
  assert.equal((await ledgerRows(w))[0].result.reason, 'changed');
  // A record deleted since is the same answer.
  const fresh = prepareFrom(other, selectionFor({ tests: true }), w);
  assert.equal(await other.remove('tests', other.records.tests[0].id, other.records.tests[0].revision), true);
  assert.equal(await screen.prepare(fresh), null);
  assert.equal(screen.message, REFUSALS.changed);
});

test('the home precedence rule: a header or body naming another home is home_changed; no home sent uses the current one', async () => {
  const w = await createSummaryWorld(db);
  const { ws } = await household(w);
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  // The runtime's header names bob's home.
  const wrongHeader = w.summary('alice', { homeContextId: w.home.bob });
  await wrongHeader.loadList();
  assert.equal(await wrongHeader.prepare(input), null);
  assert.equal(wrongHeader.message, REFUSALS.home_changed);
  // The body names bob's home.
  const screen = w.summary();
  await screen.loadList();
  assert.equal(await screen.prepare({ ...input, homeContextId: w.home.bob }), null);
  assert.equal(screen.message, REFUSALS.home_changed);
  // Neither sent: the server's current home is frozen into the summary.
  const noHome = { ...input };
  delete noHome.homeContextId;
  const plain = w.summary('alice', { homeContextId: null });
  await plain.loadList();
  const snapshot = await plain.prepare(noHome);
  assert.ok(snapshot, plain.message);
  assert.equal(snapshot.homeContextId, w.home.alice);
});

test('a lost answer after the save parks the id and locks Create; Check summary status settles it with the saved snapshot', async () => {
  const w = await createSummaryWorld(db);
  const { ws } = await household(w);
  const screen = w.summary('alice', { lose: (pathname, init) => pathname === '/api/summaries' && init.method === 'POST' });
  await screen.loadList();
  assert.equal(await screen.prepare(prepareFrom(ws, selectionFor({ tests: true }), w)), null);
  assert.equal(screen.unknown.length, 1);
  assert.equal(screen.canCreate, false);
  const [id] = screen.unknown;
  const checker = w.summary();
  await checker.loadList();
  await screen.reconcile(id);
  assert.deepEqual(screen.unknown, []);
  assert.equal(validSummarySnapshot(screen.snapshot), true);
  assert.equal(screen.snapshot.id, (await w.summaries())[0].id);
  assert.equal(screen.canCreate, true);
});

test('a commit whose database answer is lost (a 500) is reconciled from the ledger: saved stays saved, unsaved settles failed', async (t) => {
  muteConsoleError(t);
  let mode = 'after';
  const w = await createSummaryWorld(db, {
    onCommit: async (args, call) => {
      if (mode === 'after') { await call(); throw new Error('connection reset'); }
      throw new Error('connection reset');
    },
  });
  const { ws, screen } = await household(w);
  assert.equal(await screen.prepare(prepareFrom(ws, selectionFor({ tests: true }), w)), null);
  assert.equal(screen.message, 'The result is not confirmed. Check its status before trying again.');
  const [saved] = screen.unknown;
  assert.equal((await ledgerRows(w))[0].status, 'succeeded', 'the 0029 guard kept the truth over the failed settle');
  await screen.reconcile(saved);
  assert.ok(screen.snapshot);
  assert.deepEqual(screen.unknown, []);

  mode = 'before';
  assert.equal(await screen.prepare(prepareFrom(ws, selectionFor({ observations: true }), w)), null);
  const [unsaved] = screen.unknown;
  await screen.reconcile(unsaved);
  assert.deepEqual(screen.unknown, []);
  assert.equal(screen.message, REFUSALS.not_applied);
  assert.equal((await w.summaries()).length, 1);
});

test('a pending prepare locks the history; a stale one is reaped to failed, never cancelled, and unlocks', async () => {
  const w = await createSummaryWorld(db);
  await household(w);
  const op = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'summary', 'summary.prepare', 'pending', 'x')`, [op, w.ids.alice]);
  const screen = w.summary();
  await screen.loadList();
  assert.deepEqual(screen.unknown, [op]);
  assert.equal(screen.canCreate, false);
  await screen.reconcile(op);
  assert.deepEqual(screen.unknown, [op], 'still pending');
  assert.equal(screen.message, CHECKING);
  await db.query(`update public.operations set created_at = now() - interval '10 minutes' where operation_id = $1`, [op]);
  await screen.reconcile(op);
  assert.deepEqual(screen.unknown, []);
  assert.equal(screen.message, REFUSALS.abandoned);
  const [row] = await ledgerRows(w);
  assert.equal(row.status, 'failed');
  // A row some older writer settled as cancelled is answered failed, so the screen can settle it.
  const cancelled = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, result) values ($1, $2, 'summary', 'summary.prepare', 'cancelled', '{"status":"cancelled"}')`, [cancelled, w.ids.alice]);
  const body = await (await w.reconcile(cancelled, { domain: 'summary' })).json();
  assert.equal(body.status, 'failed');
  assert.equal(body.message, REFUSALS.not_applied);
});

test('another household: never listed, never readable (the same 404), its records refused as changed, its key a 409 that parks nothing', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  const aliceKey = crypto.randomUUID();
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  assert.ok(await screen.prepare(input, { idempotencyKey: aliceKey }));
  const [saved] = await w.summaries();

  const bob = w.summary('bob');
  await bob.loadList();
  assert.deepEqual(bob.archives, []);
  assert.equal(await bob.open(saved.id), false);
  assert.equal(bob.message, UNAVAILABLE);
  const missing = await w.detail(crypto.randomUUID(), { as: 'bob' });
  const foreign = await w.detail(saved.id, { as: 'bob' });
  assert.equal(foreign.status, 404);
  assert.deepEqual({ ...(await foreign.json()), request_id: null }, { ...(await missing.json()), request_id: null });

  assert.equal(await bob.prepare({ ...input, homeContextId: w.home.bob }), null, 'alice\'s record ids');
  assert.equal(bob.message, REFUSALS.changed);
  assert.equal(await bob.prepare({ ...input, homeContextId: w.home.bob }, { idempotencyKey: aliceKey }), null);
  assert.equal(bob.message, 'This item changed. Review the latest version before saving.');
  assert.ok(!bob.unknown.includes(aliceKey), 'a 409 parks nothing');
  assert.equal((await w.reconcile(aliceKey, { as: 'bob', domain: 'summary' })).status, 404);
  assert.equal((await w.summaries('bob')).length, 0);
});

test('a replay of the same key answers the same snapshot; the same key with different input is a 409', async () => {
  const w = await createSummaryWorld(db);
  const { ws } = await household(w);
  const key = crypto.randomUUID();
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  const first = await (await w.prepare(input, { key, headers: { 'x-halo-home-context': w.home.alice } })).json();
  const second = await (await w.prepare(input, { key, headers: { 'x-halo-home-context': w.home.alice } })).json();
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(second, first);
  const other = await w.prepare({ ...input, selection: { ...input.selection, purpose: 'Water provider questions' } }, { key, headers: { 'x-halo-home-context': w.home.alice } });
  assert.equal(other.status, 409);
  assert.equal((await w.summaries()).length, 1);
});

test('tasks: included at their revision while My Week is on; disclosed as unavailable while it is off', async () => {
  const w = await createSummaryWorld(db, { env: { ...SUMMARIES_ON, HALO_FEATURE_TASKS: 'on' } });
  const { ws, screen } = await household(w);
  const task = await w.addTask();
  const selection = selectionFor({ actions: true });
  const snapshot = await screen.prepare(prepareFrom(ws, selection, w, 'alice', { actions: [task] }));
  assert.ok(snapshot, screen.message);
  assert.deepEqual(snapshot.manifest, [{ kind: 'actions', id: task.id, revision: 1, asOf: '2026-10-15' }]);
  assert.ok(snapshot.report.sections[0].lines[0].startsWith('Run the bathroom fan: saved · 2026-10-15'));

  const off = await w.prepare(prepareFrom(ws, selection, w, 'alice', { actions: [task] }), { env: { HALO_FEATURE_TASKS: '' } });
  const body = await off.json();
  assert.equal(body.status, 'succeeded');
  assert.deepEqual(body.snapshot.manifest, []);
  assert.ok(body.snapshot.omissions.includes('Saved actions were unavailable when this summary was prepared.'));
});

test('before 0029: the history is unavailable and a prepare is a failed receipt with no ledger row', async () => {
  const w = await createSummaryWorld(db, { summaryRpcs: false });
  const screen = w.summary();
  await screen.loadList();
  assert.equal(screen.error, UNAVAILABLE);
  assert.equal(screen.canCreate, false);
  const key = crypto.randomUUID();
  const body = await (await w.prepare({ selection: selectionFor({ tests: true }) }, { key })).json();
  assert.deepEqual(body, { operationId: key, status: 'failed', reason: 'unavailable', message: REFUSALS.unavailable });
  assert.deepEqual(await ledgerRows(w), []);
  assert.equal((await w.detail(crypto.randomUUID())).status, 503);
});

test('the household limit is a failed receipt with its sentence; malformed requests are 400s', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  w.h.db.registerRpc('household_summary_usage', async () => ({ summaries: 200 }), { args: ['p_profile_id'] });
  assert.equal(await screen.prepare(input), null);
  assert.equal(screen.message, REFUSALS.limit);
  assert.equal(screen.canCreate, true);

  assert.equal((await w.prepare(input, { key: null })).status, 400, 'no Idempotency-Key');
  assert.equal((await w.prepare(input, { key: 'not-a-uuid' })).status, 400);
  assert.equal((await w.prepare({ ...input, records: [{ kind: 'tests', id: 'x' }] })).status, 400, 'a record with no revision');
  assert.equal((await w.prepare(input, { raw: '{not json' })).status, 400);
  assert.equal((await w.detail('nope')).status, 400);
});
