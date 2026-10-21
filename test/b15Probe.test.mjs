/**
 * B15 probe: edge inputs against the saved-summary routes, on the same world
 * as test/routesSummariesDb.test.mjs (real 0017, 0026, 0029 and 0023 reads on
 * PGlite, the frontend's own runtime and validators). Everything is local.
 * Each test asserts what the client's own validators and Summary screen do
 * with the answer, not only the route's status.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { sampleRecord, body as workspaceBody } from './helpers/workspaceWorld.mjs';
import { createSummaryWorld, SUMMARIES_ON } from './helpers/summariesWorld.mjs';
import { buildPrepare, exportLines, productionSelection, reviewText, validSummaryList, validSummaryReceipt, validSummarySnapshot } from './helpers/frontendB15.mjs';

const { REFUSALS, STORED_REFUSALS } = await import('../lib/summaryStore.js');
const { WORKSPACE_COLLECTIONS } = await import('../lib/workspaceStore.js');

const EM_DASH = '—';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

async function household(w, who = 'alice') {
  const ws = w.workspace(who);
  await ws.loadAll(WORKSPACE_COLLECTIONS);
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
const ledgerRows = async (w, who = 'alice') => (await db.query(`select operation_id::text, status, result, request_hash from public.operations where profile_id = $1 and domain = 'summary' order by created_at`, [w.ids[who]])).rows;
const testRow = (i) => ({ id: `r${i}`, analyte: 'Lead', originalValue: '1', originalUnit: 'ppb', limit: '', limitUnit: '', basis: '', reportReference: '', reportDate: '2026-01-01', qualifier: 'measured' });
const allStrings = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => allStrings(item, out));
  return out;
};

// ---------------------------------------------------------------- content the client's row check accepts

test('extreme record text: 30,000-character fields and an emoji straddling the 20,000 cut are saved, shortened, well formed, and pass the client validators', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  const big = (c) => c.repeat(30000);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: big('T'), method: big('M'), reviewReason: big('R'), review: 'needs_clarification', homeContextId: w.home.alice })), true);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: `${'a'.repeat(19999)}\u{1F600}tail`, homeContextId: w.home.alice })), true);
  assert.equal(await ws.write('observations', sampleRecord('observations', { title: '‮مرحبا é 東京 \u{1F9EA}', room: '\u{1F3E0} Cellar', reading: '0', unit: 'µg/L', note: 'Nöte with separators', homeContextId: w.home.alice })), true);
  const selection = selectionFor({ tests: true, observations: true }, { notes: true, location: true, attachments: true, appendix: true });
  const snapshot = await screen.prepare(prepareFrom(ws, selection, w));
  assert.ok(snapshot, screen.message);
  assert.equal(validSummarySnapshot(snapshot), true);
  for (const line of allStrings(snapshot)) {
    assert.ok(line.length <= 30000, `a string of ${line.length} characters`);
    assert.ok(line.isWellFormed(), 'no lone surrogate');
  }
  assert.ok(snapshot.omissions.includes('Some long text was shortened to fit this summary.'));
  const stored = (await w.summaries())[0];
  assert.equal(JSON.stringify(stored.report), JSON.stringify(snapshot.report), 'the stored report is the answered one');
  const again = w.summary();
  await again.loadList();
  assert.equal(await again.open(snapshot.id), true);
  assert.deepEqual(again.snapshot, snapshot);
});

test('a stored record carrying an unknown date field of 100,000 characters still yields a snapshot the client accepts (manifest asOf is bounded)', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  // The server stores unknown fields; an empty observedAt lets recordDate fall through to them.
  const record = { ...sampleRecord('observations', { id: 'obs-long', title: 'Odd', homeContextId: w.home.alice }), observedAt: '', date: 'D'.repeat(100000) };
  const saved = await (await w.command(workspaceBody({ kind: 'write', collection: 'observations', record, expectedRevision: null }))).json();
  assert.equal(saved.status, 'succeeded');
  await ws.loadAll(WORKSPACE_COLLECTIONS);
  const selection = selectionFor({ observations: true });
  const input = { selection, records: [{ kind: 'observations', id: 'obs-long', revision: 1 }], homeContextId: w.home.alice };
  const snapshot = await screen.prepare(input);
  assert.ok(snapshot, screen.message);
  assert.equal(validSummarySnapshot(snapshot), true, 'the manifest row must pass text(): at most 30,000 characters');
});

// ---------------------------------------------------------------- limits the client enforces

test('line count: exactly 5,000 lines in a section saves; 5,001 is a failed too_large receipt with nothing saved', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  // Each test record is 3 fixed lines plus one per result row.
  const rowsFor = (n) => Array.from({ length: n }, (_, i) => testRow(i));
  for (let i = 0; i < 9; i += 1) assert.equal(await ws.write('tests', sampleRecord('tests', { title: `Big ${i}`, rows: rowsFor(497), homeContextId: w.home.alice })), true);
  // 9 records x (3 + 497) = 4,500; the tenth takes the section to 5,000.
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Last', rows: rowsFor(497), homeContextId: w.home.alice })), true);
  const selection = selectionFor({ tests: true });
  const ok = await screen.prepare(prepareFrom(ws, selection, w));
  assert.ok(ok, screen.message);
  assert.equal(ok.report.sections[0].lines.length, 5000);
  assert.equal(validSummarySnapshot(ok), true);
  // One more row somewhere: 5,001 lines.
  const first = ws.records.tests[0];
  assert.equal(await ws.write('tests', { ...first, rows: rowsFor(498) }), true);
  assert.equal(await screen.prepare(prepareFrom(ws, selection, w)), null);
  assert.equal(screen.message, REFUSALS.too_large);
  assert.equal(screen.canCreate, true);
  assert.equal((await w.summaries()).length, 1);
  assert.equal((await ledgerRows(w)).at(-1).result.reason, 'too_large');
});

test('excluded: 5,000 entries pass the client check; 5,001 or a 401-character entry is a 400', async () => {
  const w = await createSummaryWorld(db);
  const { screen } = await household(w);
  const excluded = Array.from({ length: 5000 }, (_, i) => `tests:gone-${i}`);
  const snapshot = await screen.prepare({ selection: selectionFor({ tests: true }, { excluded }), records: [], homeContextId: w.home.alice });
  assert.ok(snapshot, screen.message);
  assert.equal(validSummarySnapshot(snapshot), true);
  assert.equal(snapshot.selection.excluded.length, 5000);
  const send = (list) => w.prepare({ selection: selectionFor({ tests: true }, { excluded: list }), records: [] });
  assert.equal((await send([...excluded, 'tests:one-more'])).status, 400);
  assert.equal((await send([`tests:${'x'.repeat(396)}`])).status, 400);
  assert.equal((await send(['scores'])).status, 400, 'no section prefix');
  assert.equal((await send(['tests:'])).status, 400, 'no id');
});

test('500 records saves with a valid manifest; 501 is a 400', async () => {
  const w = await createSummaryWorld(db);
  const { screen } = await household(w);
  // Unknown ids are refused as changed, so only the parser's limit is probed here.
  const records = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'tests', id: `t${i}`, revision: 1 }));
  assert.equal((await w.prepare({ selection: selectionFor({ tests: true }), records: records(501) })).status, 400);
  const body = await (await w.prepare({ selection: selectionFor({ tests: true }), records: records(500) })).json();
  assert.equal(body.status, 'failed');
  assert.equal(body.reason, 'changed');
  assert.equal(screen.canCreate, true);
});

// ---------------------------------------------------------------- selection edges

test('a selected section with no records says so; a record of an unselected section, a duplicate, a wrong kind and a foreign id never save', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const empty = await screen.prepare({ selection: selectionFor({ gardens: true }), records: [], homeContextId: w.home.alice });
  assert.ok(empty, screen.message);
  assert.deepEqual(empty.manifest, []);
  assert.equal(empty.report.sections[0].title, 'Garden records');
  assert.equal(validSummarySnapshot(empty), true);

  const [test] = ws.records.tests;
  const post = (records, sections = { tests: true }) => w.prepare({ selection: selectionFor(sections), records });
  assert.equal((await post([{ kind: 'observations', id: test.id, revision: 1 }])).status, 400, 'section not selected');
  assert.equal((await post([{ kind: 'tests', id: test.id, revision: 1 }, { kind: 'tests', id: test.id, revision: 1 }])).status, 400, 'duplicate');
  const wrongKind = await (await post([{ kind: 'gardens', id: test.id, revision: 1 }], { tests: true, gardens: true })).json();
  assert.equal(wrongKind.reason, 'changed');
  const stale = await (await post([{ kind: 'tests', id: test.id, revision: 2 }])).json();
  assert.equal(stale.reason, 'changed');
  const bobScreen = w.summary('bob');
  await bobScreen.loadList();
  assert.equal(await bobScreen.prepare({ selection: selectionFor({ tests: true }), records: [{ kind: 'tests', id: test.id, revision: 1 }], homeContextId: w.home.bob }), null);
  assert.equal(bobScreen.message, REFUSALS.changed);
  assert.equal((await w.summaries()).length, 1, 'only the empty one');
  assert.equal((await w.summaries('bob')).length, 0);
  // A request body of 1,000,001 bytes is refused as too large.
  const huge = await w.prepare({ selection: selectionFor({ tests: true }), records: [], pad: 'x'.repeat(1_000_001) });
  assert.equal(huge.status, 413);
});

test('dates the client accepts: a four-digit year below 0100 is a valid summary range', async () => {
  const w = await createSummaryWorld(db);
  const { screen } = await household(w);
  for (const start of ['0001-01-01', '0099-12-31', '1900-01-01']) {
    const snapshot = await screen.prepare({ selection: selectionFor({ tests: true }, { start, end: '2026-12-31' }), records: [], homeContextId: w.home.alice });
    assert.ok(snapshot, `${start}: ${screen.message}`);
    assert.equal(snapshot.selection.start, start);
  }
});

// ---------------------------------------------------------------- concurrency and replay

test('two simultaneous prepares with one key save exactly one summary and both answers are receipts the client accepts', async () => {
  const w = await createSummaryWorld(db);
  const { ws } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  const key = crypto.randomUUID();
  const [a, b] = await Promise.all([w.prepare(input, { key }), w.prepare(input, { key })]);
  const bodies = [await a.json(), await b.json()];
  for (const body of bodies) {
    assert.equal(a.status, 200);
    assert.equal(validSummaryReceipt(body, key), true, JSON.stringify(body).slice(0, 200));
  }
  assert.ok(bodies.some((body) => body.status === 'succeeded'));
  assert.equal((await w.summaries()).length, 1);
  assert.equal((await ledgerRows(w)).length, 1);
  // Whatever the loser saw, a reconcile settles to the same snapshot.
  const settled = await (await w.reconcile(key, { domain: 'summary' })).json();
  assert.equal(settled.status, 'succeeded');
  assert.equal(settled.snapshot.id, (await w.summaries())[0].id);
});

test('two simultaneous prepares with different keys save two distinct summaries', async () => {
  const w = await createSummaryWorld(db);
  const { ws } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  const [a, b] = await Promise.all([w.prepare(input), w.prepare(input)]);
  const [x, y] = [await a.json(), await b.json()];
  assert.equal(x.status, 'succeeded');
  assert.equal(y.status, 'succeeded');
  assert.notEqual(x.snapshot.id, y.snapshot.id);
  assert.equal((await w.summaries()).length, 2);
});

test('a replay after the records changed answers the saved snapshot, not a fresh check; a replayed refusal stays the refusal', async () => {
  const w = await createSummaryWorld(db);
  const { ws } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  const key = crypto.randomUUID();
  const first = await (await w.prepare(input, { key })).json();
  assert.equal(await ws.write('tests', { ...ws.records.tests[0], provider: 'Changed lab' }), true);
  assert.deepEqual(await (await w.prepare(input, { key })).json(), first);
  // The same input now fails as changed; a replay of that key repeats it even after a fresh input would pass.
  const failKey = crypto.randomUUID();
  const failed = await (await w.prepare(input, { key: failKey })).json();
  assert.equal(failed.reason, 'changed');
  const fresh = prepareFrom(ws, selectionFor({ tests: true }), w);
  assert.equal((await (await w.prepare(fresh, { key: crypto.randomUUID() })).json()).status, 'succeeded');
  assert.deepEqual(await (await w.prepare(input, { key: failKey })).json(), failed);
});

// ---------------------------------------------------------------- reconcile, every ledger status

test('reconcile answers every ledger state with a receipt the client settles (or parks, for pending), carrying no data key and no em dash', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const real = crypto.randomUUID();
  assert.ok(await screen.prepare(prepareFrom(ws, selectionFor({ tests: true }), w), { idempotencyKey: real }));
  const [saved] = await w.summaries();
  const bobKey = crypto.randomUUID();
  const bobScreen = w.summary('bob');
  await bobScreen.loadList();
  assert.ok(await bobScreen.prepare({ selection: selectionFor({ gardens: true }), records: [], homeContextId: w.home.bob }, { idempotencyKey: bobKey }));
  const [bobSaved] = await w.summaries('bob');

  const insert = async (status, result, ageMinutes = 0) => {
    const id = crypto.randomUUID();
    await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, result, request_hash, created_at) values ($1, $2, 'summary', 'summary.prepare', $3, $4, 'x', now() - ($5 || ' minutes')::interval)`,
      [id, w.ids.alice, status, result === undefined ? null : JSON.stringify(result), String(ageMinutes)]);
    return id;
  };
  const cases = [
    ['pending', await insert('pending'), ['pending']],
    ['stale pending', await insert('pending', undefined, 30), ['failed']],
    ...STORED_REFUSALS.map((reason) => [`failed ${reason}`, null, ['failed'], { status: 'failed', reason }]),
    ['failed abandoned', null, ['failed'], { status: 'failed', reason: 'abandoned' }],
    ['failed no result', null, ['failed'], null],
    ['failed odd reason', null, ['failed'], { status: 'failed', reason: '<b>x</b>' }],
    ['failed non-object result', null, ['failed'], 'text'],
    ['cancelled', null, ['failed'], { status: 'cancelled' }],
    ['succeeded, summary of another household', null, ['failed'], { status: 'succeeded', summaryId: bobSaved.id }],
    ['succeeded, id not a uuid', null, ['failed'], { status: 'succeeded', summaryId: 'nope' }],
    ['succeeded, no id', null, ['failed'], { status: 'succeeded' }],
  ];
  for (const [label, preset, allowed, result] of cases) {
    const id = preset ?? await insert(label.startsWith('cancelled') ? 'cancelled' : label.startsWith('succeeded') ? 'succeeded' : 'failed', result);
    const res = await w.reconcile(id, { domain: 'summary' });
    assert.equal(res.status, 200, label);
    const body = await res.json();
    assert.equal(Object.hasOwn(body, 'data'), false, label);
    assert.ok(!JSON.stringify(body).includes(EM_DASH), label);
    assert.ok(allowed.includes(body.status), `${label}: ${body.status}`);
    assert.equal(validSummaryReceipt(body, id), true, label);
    if (body.status === 'failed') assert.ok(body.message && body.message.length > 0, label);
    assert.ok(!JSON.stringify(body).includes('<b>'), `${label}: stored text is never echoed`);
  }
  // The real one answers the saved snapshot.
  const real200 = await (await w.reconcile(real, { domain: 'summary' })).json();
  assert.equal(real200.status, 'succeeded');
  assert.equal(real200.snapshot.id, saved.id);
  // A summary operation read as another domain, or another household's key, is a 404.
  assert.equal((await w.reconcile(real, { domain: 'workspace' })).status, 404);
  assert.equal((await w.reconcile(real, { as: 'bob', domain: 'summary' })).status, 404);
  assert.equal((await w.reconcile(bobKey, { domain: 'summary' })).status, 404);
});

test('a summary removed by privacy clear all: the list is empty, a read is 404, a reconcile and a replay are failed gone, and the other household keeps its summary', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const key = crypto.randomUUID();
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  const snapshot = await screen.prepare(input, { idempotencyKey: key });
  assert.ok(snapshot);
  const bobScreen = w.summary('bob');
  await bobScreen.loadList();
  assert.ok(await bobScreen.prepare({ selection: selectionFor({ gardens: true }), records: [], homeContextId: w.home.bob }));

  const clear = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'privacy', 'privacy.clear.all', 'pending')`, [clear, w.ids.alice]);
  await db.query(`update public.operations set status = 'succeeded', result = '{"status":"succeeded"}' where operation_id = $1`, [clear]);
  assert.equal((await w.summaries()).length, 0);
  assert.equal((await w.summaries('bob')).length, 1);

  const list = await (await w.list()).json();
  assert.deepEqual(list.items, []);
  assert.equal((await w.detail(snapshot.id)).status, 404);
  const goneRes = await w.reconcile(key, { domain: 'summary' });
  const gone = await goneRes.json();
  assert.equal(goneRes.status, 200, JSON.stringify(gone));
  assert.equal(gone.status, 'failed');
  assert.equal(gone.message, REFUSALS.gone);
  const replay = await (await w.prepare(input, { key, headers: { 'x-halo-home-context': w.home.alice } })).json();
  assert.equal(replay.status, 'failed');
  assert.equal(replay.message, REFUSALS.gone);
  // The screen settles it and is unlocked.
  const lost = w.summary();
  await lost.loadList();
  await lost.reconcile(key);
  assert.equal(lost.message, REFUSALS.gone);
  assert.equal(lost.canCreate, true);
  assert.equal(await lost.open(snapshot.id), false);
});

// ---------------------------------------------------------------- homes

test('home edge cases: no current home saves a null home; a moved household refuses the old home id and saves the new one', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const oldHome = w.home.alice;
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  const newHome = crypto.randomUUID();
  await db.query(`update public.home_contexts set effective_to = now(), closed_reason = 'moved' where id = $1`, [oldHome]);
  await db.query(`insert into public.home_contexts (id, profile_id, sequence, origin, effective_from) values ($1, $2, 2, 'move', now())`, [newHome, w.ids.alice]);
  assert.equal(await screen.prepare(input), null);
  assert.equal(screen.message, REFUSALS.home_changed, 'the old home is refused');
  const moved = w.summary('alice', { homeContextId: newHome });
  await moved.loadList();
  const ok = await moved.prepare({ ...input, homeContextId: newHome });
  assert.ok(ok, moved.message);
  assert.equal(ok.homeContextId, newHome);
  assert.equal(validSummarySnapshot(ok), true);
  // The record still names the old home, and is still summarized (no re-filtering).
  assert.equal(ok.manifest.length, 1);

  // No current home at all.
  await db.query(`update public.home_contexts set effective_to = now(), closed_reason = 'moved' where id = $1`, [newHome]);
  const none = w.summary('alice', { homeContextId: null });
  await none.loadList();
  const nothing = await none.prepare({ ...input, homeContextId: undefined });
  assert.ok(nothing, none.message);
  assert.equal(nothing.homeContextId, null);
  assert.equal(validSummarySnapshot(nothing), true);
  assert.deepEqual((await none.archives).map((item) => item.homeContextId).sort(), [newHome, null].sort());
  assert.equal(validSummaryList(await (await w.list()).json()), true);
  // And a body that names a home when there is none is a refusal.
  assert.equal(await none.prepare({ ...input, homeContextId: newHome }), null);
  assert.equal(none.message, REFUSALS.home_changed);
});

// ---------------------------------------------------------------- privacy

test('private text appears only with its own opt-in and never reaches the ledger, the list or a task report', async () => {
  const w = await createSummaryWorld(db, { env: { ...SUMMARIES_ON, HALO_FEATURE_TASKS: 'on' } });
  const { ws, screen } = await household(w);
  await db.query(`update public.home_contexts set county = 'Mecklenburg', state = 'NC' where id = $1`, [w.home.alice]);
  await db.query(`insert into public.household_bands (profile_id, has_toddler, has_senior) values ($1, true, true)`, [w.ids.alice]);
  assert.equal(await ws.write('observations', sampleRecord('observations', { title: 'Damp', room: 'ROOMMARK', note: 'NOTEMARK', photoName: 'PHOTOMARK.jpg', homeContextId: w.home.alice })), true);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Tap', sampleLabel: 'LABELMARK', homeContextId: w.home.alice })), true);
  assert.equal(await ws.write('gardens', sampleRecord('gardens', { title: 'Bed', county: 'GARDENCOUNTYMARK', homeContextId: w.home.alice })), true);
  const task = await w.addTask();
  const sections = { tests: true, observations: true, gardens: true, actions: true };
  const marks = { notes: 'NOTEMARK', location: ['ROOMMARK', 'LABELMARK', 'GARDENCOUNTYMARK', 'Mecklenburg, NC'], attachments: 'PHOTOMARK', categories: ['Toddlers', 'Older adults'] };
  const flat = (v) => [v].flat();
  const run = async (over) => {
    const snapshot = await screen.prepare(prepareFrom(ws, selectionFor(sections, { appendix: true, ...over }), w, 'alice', { actions: [task] }));
    assert.ok(snapshot, screen.message);
    return JSON.stringify(snapshot);
  };
  const off = await run({});
  for (const mark of Object.values(marks).flatMap(flat)) assert.ok(!off.includes(mark), `${mark} leaked with every opt-in off`);
  for (const [scope, wanted] of Object.entries(marks)) {
    const text = await run({ [scope]: true });
    for (const mark of flat(wanted)) assert.ok(text.includes(mark), `${scope} should include ${mark}`);
    for (const [other, hidden] of Object.entries(marks)) if (other !== scope) for (const mark of flat(hidden)) assert.ok(!text.includes(mark), `${scope} alone leaked ${mark}`);
    assert.ok(!text.includes('35.409') && !text.includes('-80.58'), 'no coordinates');
    const actions = JSON.parse(text).report.sections.find((section) => section.title === 'Saved actions');
    assert.ok(actions.lines.length > 0 && !JSON.stringify(actions).includes('Moisture') && !text.includes('"homeguard"'), 'no task reason or origin');
  }
  const everything = await run({ notes: true, location: true, attachments: true, categories: true });
  assert.ok(!everything.includes('photoData'));
  const secrets = ['NOTEMARK', 'ROOMMARK', 'PHOTOMARK', 'LABELMARK', 'GARDENCOUNTYMARK', 'Mecklenburg', 'Toddlers'];
  const ledger = JSON.stringify(await ledgerRows(w));
  const list = JSON.stringify(await (await w.list()).json());
  for (const mark of secrets) {
    assert.ok(!ledger.includes(mark), `${mark} in the ledger`);
    assert.ok(!list.includes(mark), `${mark} in the list`);
  }
  // The same through the reconcile of a succeeded operation: it carries the snapshot the person chose, nothing more.
  const [{ operation_id: op }] = (await ledgerRows(w)).filter((row) => row.status === 'succeeded').slice(0, 1);
  const rec = JSON.stringify(await (await w.reconcile(op, { domain: 'summary' })).json());
  assert.ok(!rec.includes('NOTEMARK'), 'the first summary had notes off');
});

// ---------------------------------------------------------------- tasks

test('tasks: another household\'s task id is refused as changed; a stale revision too', async () => {
  const w = await createSummaryWorld(db, { env: { ...SUMMARIES_ON, HALO_FEATURE_TASKS: 'on' } });
  const { screen } = await household(w);
  const bobsTask = await w.addTask('bob', { title: 'Bob private chore' });
  const mine = await w.addTask('alice');
  const send = (task, revision = task.revision) => w.prepare({ selection: selectionFor({ actions: true }), records: [{ kind: 'actions', id: task.id, revision }], homeContextId: w.home.alice });
  const foreign = await (await send(bobsTask)).json();
  assert.equal(foreign.reason, 'changed');
  assert.ok(!JSON.stringify(foreign).includes('Bob private chore'));
  assert.equal((await (await send(mine, 2)).json()).reason, 'changed');
  const good = await (await send(mine)).json();
  assert.equal(good.status, 'succeeded');
  assert.equal(validSummaryReceipt(good, good.operationId), true);
  assert.ok(!JSON.stringify(good).includes('Bob private chore'));
  assert.equal(screen.canCreate, true);
});

// ---------------------------------------------------------------- unavailable and failing databases

test('0026 missing: a workspace section is a failed unavailable receipt that parks nothing; a scores-only summary still saves', async () => {
  const w = await createSummaryWorld(db);
  const { screen } = await household(w);
  w.h.db.registerRpc('read_household_workspace', async () => { throw rpcError('PGRST202', 'Could not find the function public.read_household_workspace', null, null); }, { args: ['p_profile_id', 'p_collections'] });
  const key = crypto.randomUUID();
  const body = await (await w.prepare({ selection: selectionFor({ tests: true }), records: [{ kind: 'tests', id: 'x', revision: 1 }], homeContextId: w.home.alice }, { key })).json();
  assert.deepEqual(body, { operationId: key, status: 'failed', reason: 'unavailable', message: REFUSALS.unavailable });
  assert.equal(await screen.prepare({ selection: selectionFor({ tests: true }), records: [], homeContextId: w.home.alice }), null);
  assert.equal(screen.message, REFUSALS.unavailable);
  assert.equal(screen.canCreate, true);
  assert.equal(screen.unknown.length, 0);
  const scores = await screen.prepare({ selection: selectionFor({ scores: true }), records: [], homeContextId: w.home.alice });
  assert.ok(scores, screen.message);
  assert.equal(validSummarySnapshot(scores), true);
});

test('a database error mid-prepare is a 500 the screen parks, and the reconcile settles it failed so Create unlocks', async (t) => {
  muteConsoleError(t);
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const input = prepareFrom(ws, selectionFor({ tests: true }), w);
  w.h.db.registerRpc('read_household_workspace', async () => { throw rpcError('57P01', 'terminating connection', null, null); }, { args: ['p_profile_id', 'p_collections'] });
  assert.equal(await screen.prepare(input), null);
  assert.equal(screen.unknown.length, 1);
  assert.equal(screen.canCreate, false);
  const [id] = screen.unknown;
  assert.equal((await ledgerRows(w))[0].status, 'failed');
  await screen.reconcile(id);
  assert.deepEqual(screen.unknown, []);
  assert.equal(screen.message, REFUSALS.not_applied);
  assert.equal(screen.canCreate, true);
});

// ---------------------------------------------------------------- headers, shape, characters

test('every answer that can carry a report is no-store, has no top-level data key, and server text has no em dash', async () => {
  const w = await createSummaryWorld(db);
  const { ws, screen } = await household(w);
  assert.equal(await ws.write('tests', sampleRecord('tests', { title: 'Mine', homeContextId: w.home.alice })), true);
  const input = prepareFrom(ws, selectionFor({ tests: true, scores: true, factors: true }, { categories: true, location: true, appendix: true }), w);
  const key = crypto.randomUUID();
  const responses = {
    success: await w.prepare(input, { key }),
    replay: await w.prepare(input, { key }),
    failed: await w.prepare({ ...input, records: [{ kind: 'tests', id: 'nope', revision: 1 }] }),
    list: await w.list(),
    reconcile: await w.reconcile(key, { domain: 'summary' }),
  };
  const id = (await screen.archives)[0]?.id ?? (await (await w.list()).json()).items[0].id;
  responses.detail = await w.detail(id);
  for (const [label, res] of Object.entries(responses)) {
    assert.equal(res.status, 200, label);
    const text = await res.text();
    assert.ok(!text.includes(EM_DASH), `${label}: em dash`);
    assert.equal(Object.hasOwn(JSON.parse(text), 'data'), false, `${label}: data key`);
    assert.equal(res.headers.get('cache-control'), 'no-store', `${label}: Cache-Control`);
  }
  // The detail snapshot's own strings, and the export lines, carry no em dash either.
  const snapshot = await (await w.detail(id)).json();
  for (const line of [...reviewText(snapshot), ...exportLines(snapshot)]) assert.ok(!line.includes(EM_DASH), line);
});
