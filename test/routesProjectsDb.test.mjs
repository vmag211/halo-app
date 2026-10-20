/**
 * B16 Explore projects without generative AI: the six routes on the route
 * harness, with migration 0030's and 0026's REAL functions and the REAL 0017
 * ledger on PGlite (test/helpers/projectsWorld.mjs), and the CLIENT's own
 * runtime and validators compiled from this tree. What the screens do with
 * each answer is test/helpers/frontendB16.mjs, transcribed from
 * ProductionProjectGeneration.tsx and ExploreProjects.tsx; the tests assert
 * what the screen then holds (the batch, the guides, the message, the pending
 * attempt, the start receipt), never only a body's shape.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDb } from './db/pgliteHarness.mjs';
import { muteConsoleError } from './helpers/routeHarness.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { createWorld, generateBody, ROUTES, ON } from './helpers/projectsWorld.mjs';
import * as fe from './helpers/frontendB16.mjs';

const { validProjectGeneration, validProjectGuide } = await loadFrontend('production/explore-service');
const { validProductionCollection } = await loadFrontend('production/home-records');
const { requestHash } = await import('../lib/operations.js');
const { localDate, addDays } = await import('../lib/localDate.js');
const { featureDisabledReason } = await import('../lib/features.js');
const { PROJECT_COPY } = await import('../lib/projectsStore.js');
const { LIBRARY_GUIDES, SELECTION_COPY } = await import('../lib/projectSelection.js');

const EM_DASH = '—';
let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

test('drift: the transcribed screen code is still the frontend\'s, and the registry still names these routes', async () => {
  const mine = await readFile(new URL('./helpers/frontendB16.mjs', import.meta.url), 'utf8');
  for (const fragment of fe.FRAGMENTS) {
    const source = await readFile(new URL(`../${fragment.file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(fragment.text), `${fragment.file} no longer contains: ${fragment.text}`);
    assert.ok(mine.includes(fragment.text), `the transcription no longer contains: ${fragment.text}`);
  }
  const runtime = await readFile(new URL('../lib/frontend/production/runtime.ts', import.meta.url), 'utf8');
  for (const line of [
    "'projects.generate': {path:'/api/projects/generations',method:'POST'},",
    "'projects.current': {path:'/api/projects/generations/current'},",
    "'projects.guide': {path:'/api/projects/guides/detail'},",
    "'projects.start': {path:'/api/projects/start',method:'POST'},",
    "'projects.generation': {path:'/api/projects/generations/status'},",
    "'projects.cancel': {path:'/api/projects/generations/cancel',method:'POST'},",
  ]) assert.ok(runtime.includes(line), line);
});

test('flag off: generate is a settled failed answer, the reads are the 503, start is refused, and nothing is read, claimed or stored', async () => {
  const w = await createWorld(db, { env: {} });
  const ui = fe.projectGeneration(w.runtime());
  await ui.load();
  assert.equal(ui.message, 'This service is unavailable. Try again later.');
  await ui.regenerate();
  assert.equal(ui.state.pending, null, 'a settled refusal leaves nothing to check');
  assert.equal(ui.message, featureDisabledReason('projects'));
  assert.equal(ui.batch.items.length, 0);
  assert.deepEqual(await w.generations(), []);
  assert.equal((await db.query('select count(*)::int as n from public.operations where profile_id = $1', [w.ids.alice])).rows[0].n, 0);
  for (const [route, query] of [[ROUTES.current, {}], [ROUTES.status, { id: crypto.randomUUID() }], [ROUTES.guide, { id: LIBRARY_GUIDES[0].id }]]) {
    const res = await w.get(route, query);
    assert.equal(res.status, 503, route);
    assert.equal((await res.json()).code, 'feature_unavailable');
  }
  const started = await fe.startProject(w.runtime(), ui, LIBRARY_GUIDES[0]);
  assert.equal(started.error, 'This action is not available for this account.');
  assert.equal(ui.state.startAttempt, null, 'a 403 is settled: the attempt is cleared');
  assert.deepEqual(await w.projects(), []);
  const cancelled = await w.post(ROUTES.cancel, { id: crypto.randomUUID() }, { key: 'cancel:x' });
  assert.equal((await cancelled.json()).status, 'cancelled');
  assert.equal(w.h.db.queryLog.filter((entry) => entry.table === 'profiles' || entry.table === 'daily_scores').length, 0, 'no evidence was read');
});

test('a first request: the screen holds 10 to 15 sourced ideas for its own context, the saved set restores after a reload, and the ledger holds no idea or typed text', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime());
  await ui.load();
  assert.equal(ui.state.saved.data, null, 'a new household: { data: null }');
  await ui.regenerate(undefined, 'something for my small garden', false);
  assert.equal(ui.state.pending, null);
  assert.equal(ui.message, '12 ideas ready.');
  const { batch } = ui;
  assert.equal(batch.contextKey, w.scopeKey('alice'));
  assert.equal(batch.items.length, 12);
  assert.equal(batch.generation, 1);
  assert.equal(batch.request, 'something for my small garden');
  for (const item of batch.items) {
    const guide = ui.findGuide(item.id);
    assert.ok(validProjectGuide(guide), item.id);
    assert.ok(guide.sources.length && guide.sources.every((source) => source.url.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(source.checked)));
    assert.ok(item.reason && !item.reason.includes(EM_DASH));
  }
  // Evidence: the home's water source and building year, and Today's readings as unknown (none stored).
  const evidence = Object.fromEntries(ui.evidence.map((item) => [item.id, item]));
  assert.equal(evidence['home:water-source'].value, 'Public water system');
  assert.equal(evidence['home:building-year'].value, 'Built in 1975');
  assert.equal(evidence['today:air:none'].status, 'unknown', 'a missing reading is unknown, never healthy');
  assert.ok(batch.items.some((item) => item.id === 'water-report-check' && item.fit === 'context'));

  const [row] = await w.generations();
  assert.equal(row.status, 'completed');
  assert.equal(JSON.stringify(row.idea_set).includes(w.ids.alice), false, 'the stored set does not carry the owner id');
  const ledger = (await db.query(`select kind, result, request_hash from public.operations where profile_id = $1 and domain = 'projects'`, [w.ids.alice])).rows;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'projects.generate');
  assert.equal(JSON.stringify(ledger[0].result).includes('garden'), false, 'the receipt holds a status only');

  // A reload: a fresh screen restores the same set from projects.current.
  const again = fe.projectGeneration(w.runtime());
  await again.load();
  assert.deepEqual(again.batch, batch);
  assert.deepEqual(Object.keys(again.state.guides).sort(), batch.items.map((item) => item.id).sort());
  // Refresh: the next set is generation 2 and ranks the ideas just seen last.
  await again.regenerate();
  assert.equal(again.batch.generation, 2);
  const seen = new Set(batch.items.map((item) => item.id));
  assert.ok(again.batch.items.slice(0, 5).some((item) => !seen.has(item.id)), 'new ideas lead a refresh');
});

test('a direct interest is a smaller shortlist of what it names, and an interest nothing matches says so without inventing ideas', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate({ space: 'any', mode: 'any', time: 'any', budget: 'any', count: 3 }, 'help the bees', true);
  assert.ok(ui.batch.items.length >= 1 && ui.batch.items.length <= 3);
  assert.ok(ui.batch.items.every((item) => item.fit === 'interest'));
  assert.ok(ui.batch.items.some((item) => item.id === 'bee-house'));
  await ui.regenerate({ space: 'any', mode: 'any', time: 'any', budget: 'any', count: 3 }, 'quantum knitting', true);
  assert.equal(ui.batch.items.length, 0);
  assert.equal(ui.message, '0 ideas ready.');
  assert.equal((await w.generations()).at(-1).idea_set.message, SELECTION_COPY.noInterest);
});

test('a request for an earlier home is refused as settled, for another identity is a 400, and nothing is stored', async () => {
  const w = await createWorld(db);
  const stale = fe.projectGeneration(w.runtime('alice', { contextRevision: 2 }));
  await stale.regenerate();
  assert.equal(stale.state.pending, null);
  assert.equal(stale.message, PROJECT_COPY.homeChanged);
  const res = await w.post(ROUTES.generate, generateBody(w, 'alice', { contextKey: w.scopeKey('bob') }), { key: crypto.randomUUID() });
  assert.equal(res.status, 400);
  assert.deepEqual(await w.generations(), []);
});

test('a client never told its home (GET /api/profile carries none) is served for the current home, restores its set, and ends a wait on an unknown id', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime('alice', { homeless: true }));
  await ui.regenerate();
  assert.equal(ui.message, '12 ideas ready.');
  assert.equal(ui.batch.contextKey, `${w.ids.alice}:none:0`);
  assert.equal(ui.evidence.find((item) => item.id === 'home:water-source').value, 'Public water system', 'the current home is used');
  const again = fe.projectGeneration(w.runtime('alice', { homeless: true }));
  await again.load();
  assert.deepEqual(again.batch, ui.batch);
  // Retry of an attempt whose request never arrived: the check answers in the key this client holds, so the wait ends.
  again.state.pending = { id: crypto.randomUUID(), constraints: again.batch.constraints, request: '', interpret: false };
  await again.retry();
  assert.equal(again.state.pending, null);
  assert.equal(again.message, PROJECT_COPY.notFound);
  // The same for a client that does know its home.
  const known = fe.projectGeneration(w.runtime());
  known.state.pending = { id: crypto.randomUUID(), constraints: again.batch.constraints, request: '', interpret: false };
  await known.retry();
  assert.equal(known.state.pending, null);
  assert.equal(known.message, PROJECT_COPY.notFound);
});

test('the same request id twice answers the same set, and a different body under it is the 409', async () => {
  const w = await createWorld(db);
  const key = crypto.randomUUID();
  const first = await (await w.post(ROUTES.generate, generateBody(w), { key })).json();
  const second = await (await w.post(ROUTES.generate, generateBody(w), { key })).json();
  assert.deepEqual(second, first);
  assert.ok(validProjectGeneration(first));
  assert.equal((await w.generations()).length, 1);
  // Under the hood the ledger claim is checked too: drop the row and replay with other input.
  await db.query('delete from public.household_project_generations where generation_id = $1', [key]);
  const other = await w.post(ROUTES.generate, generateBody(w, 'alice', { request: 'trees' }), { key });
  assert.equal(other.status, 409);
});

test('cancel: before the request it wins and the late request stores nothing; after completion the screen gets the ready ideas', async () => {
  const w = await createWorld(db);
  const id = crypto.randomUUID();
  const cancelled = await (await w.post(ROUTES.cancel, { id }, { key: `cancel:${id}` })).json();
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(validProjectGeneration(cancelled));
  const late = await (await w.post(ROUTES.generate, generateBody(w), { key: id })).json();
  assert.equal(late.status, 'cancelled');
  assert.equal((await w.generations()).filter((row) => row.status === 'completed').length, 0);
  // The same cancel again is the same answer (a ledger replay).
  assert.deepEqual(await (await w.post(ROUTES.cancel, { id }, { key: `cancel:${id}` })).json(), cancelled);

  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate();
  // A person who stops waiting on a request that already finished: cancel answers the finished set.
  const finished = (await w.generations()).find((row) => row.status === 'completed');
  ui.state.pending = { id: finished.generation_id, jobId: finished.generation_id, constraints: ui.batch.constraints, request: '', interpret: false };
  await ui.cancel();
  assert.equal(ui.message, 'Ideas were ready before cancellation.');
  assert.equal(ui.state.pending, null);
  assert.equal(ui.batch.items.length, 12);
});

test('status: a check never starts a generation; an id never seen ends the wait, and an answer lost in transit is recovered by the check', async () => {
  const w = await createWorld(db);
  const unknown = await (await w.get(ROUTES.status, { id: crypto.randomUUID() })).json();
  assert.equal(unknown.status, 'failed');
  assert.equal(unknown.message, PROJECT_COPY.notFound);
  assert.equal(unknown.contextKey, `${w.ids.alice}:none:0`, 'no home header: the key of a client that names no home');
  assert.deepEqual(await w.generations(), []);

  // The generate answer is lost: the client keeps the attempt, and Retry checks the same id.
  const ui = fe.projectGeneration(w.runtime('alice', { lose: (path) => path === ROUTES.generate }));
  await ui.regenerate();
  assert.ok(ui.state.pending, 'not confirmed: the attempt is kept');
  assert.equal(ui.message, 'The result is not confirmed. Check its status before trying again.');
  await ui.retry();
  assert.equal(ui.state.pending, null);
  assert.equal(ui.message, '12 ideas ready.');
  assert.equal((await w.generations()).length, 1, 'the check found the stored set and made no new one');
});

test('another household: its ids are not found, its cancel records only its own, and its current set is its own', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime('alice'));
  await ui.regenerate();
  const [aliceRow] = await w.generations('alice');
  const seen = await (await w.get(ROUTES.status, { id: aliceRow.generation_id }, { as: 'bob' })).json();
  assert.equal(seen.status, 'failed');
  assert.equal(seen.message, PROJECT_COPY.notFound);
  assert.equal(JSON.stringify(seen).includes(w.ids.alice), false);
  const bobCancel = await (await w.post(ROUTES.cancel, { id: aliceRow.generation_id }, { as: 'bob', key: `cancel:${aliceRow.generation_id}` })).json();
  assert.equal(bobCancel.status, 'cancelled');
  assert.equal((await w.generations('alice'))[0].status, 'completed', 'alice\'s set is untouched');
  assert.equal((await w.get(ROUTES.current, {}, { as: 'bob' }).then((res) => res.json())).data, null);
  // Bob's own request under alice's id is a new request of his own (separate rows, separate ledger rows by owner).
  const bobUi = fe.projectGeneration(w.runtime('bob'));
  await bobUi.load();
  await bobUi.regenerate();
  assert.equal(bobUi.batch.contextKey, w.scopeKey('bob'));
  assert.ok(bobUi.evidence.some((item) => item.id === 'home:water-source' && item.value === 'Private well'));
  assert.ok(bobUi.batch.items.every((item) => !JSON.stringify(item).includes(w.ids.alice)));
  // Bob's home is in Virginia: North Carolina guidance carries the regional check.
  const nc = bobUi.batch.items.find((item) => bobUi.findGuide(item.id).scope.includes('North Carolina'));
  assert.ok(nc.needsCheck.includes(SELECTION_COPY.region));
});

test('evidence: a current fine-particle reading ranks the filtration project with its reason; an old one is stale and says when', async () => {
  const w = await createWorld(db);
  const today = localDate();
  w.h.db.seed('daily_scores', [{ id: crypto.randomUUID(), profile_id: w.ids.alice, home_context_id: w.home.alice, date: today, aqi: 152, aqi_source: 'airnow', uv_index: 6, pollen_level: JSON.stringify({ tree: 2, grass: 3, weed: null }), mold_risk: 'moderate', details: { dominant_pollutant: 'PM2.5' }, created_at: new Date().toISOString() }]);
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate();
  const air = ui.batch.items.find((item) => item.id === 'air-cleaner-plan');
  assert.equal(air.fit, 'context');
  assert.match(air.reason, /does not measure indoor air/);
  assert.ok(air.evidenceIds.includes(`today:air:${today}`));
  assert.equal(ui.evidence.find((item) => item.topic === 'pollen').value, 'Tree 2, Grass 3');

  const v = await createWorld(db);
  v.h.db.seed('daily_scores', [{ id: crypto.randomUUID(), profile_id: v.ids.alice, home_context_id: v.home.alice, date: '2026-01-01', aqi: 40, created_at: '2026-01-01T12:00:00Z' }]);
  const old = fe.projectGeneration(v.runtime());
  await old.regenerate();
  assert.ok(old.evidence.find((item) => item.topic === 'air').status === 'unknown', 'a reading older than a week is not used');
  assert.ok(old.batch.items.some((item) => item.needsCheck.includes(SELECTION_COPY.outdoorNone)), 'outdoor ideas say there is no recent reading');
  // Three days old: used, marked stale, and the outdoor check names its date.
  const s = await createWorld(db);
  const threeDays = addDays(today, -3);
  s.h.db.seed('daily_scores', [{ id: crypto.randomUUID(), profile_id: s.ids.alice, home_context_id: s.home.alice, date: threeDays, aqi: 40, created_at: `${threeDays}T12:00:00Z` }]);
  const stale = fe.projectGeneration(s.runtime());
  await stale.regenerate();
  const air3 = stale.evidence.find((item) => item.topic === 'air');
  assert.equal(air3.status, 'available');
  assert.equal(air3.stale, true);
  assert.equal(air3.asOf, threeDays);
  assert.ok(stale.batch.items.some((item) => item.needsCheck.includes(SELECTION_COPY.outdoorStale(threeDays))));
  // A reading from an earlier home is never this home's.
  const x = await createWorld(db);
  x.h.db.seed('daily_scores', [{ id: crypto.randomUUID(), profile_id: x.ids.alice, home_context_id: crypto.randomUUID(), date: today, aqi: 152, details: { dominant_pollutant: 'PM2.5' }, created_at: new Date().toISOString() }]);
  const moved = fe.projectGeneration(x.runtime());
  await moved.regenerate();
  assert.equal(moved.evidence.find((item) => item.topic === 'air').status, 'unknown');
});

test('evidence: Homeguard records of this home are used with server-written labels only, never the text a person typed', async () => {
  const w = await createWorld(db);
  const insert = (collection, record) => db.query(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record) values ($1, $2, $3, 1, $4::jsonb)`,
    [w.ids.alice, collection, record.id, JSON.stringify(record)]);
  await insert('gardens', { id: 'garden-1', title: 'SECRET-GARDEN-NAME', homeContextId: w.home.alice, irrigation: 'rain barrel', setup: 'Raised bed' });
  await insert('observations', { id: 'obs-1', title: 'SECRET-ROOM', homeContextId: w.home.alice, reading: '', observedAt: '2026-10-01T10:00:00Z', note: 'SECRET-NOTE' });
  await insert('tests', { id: 'test-1', title: 'SECRET-TEST', contextId: w.home.alice, review: 'needs_clarification', archived: false, reviewReason: 'SECRET-REASON' });
  await insert('observations', { id: 'obs-other-home', title: 'Other home', homeContextId: crypto.randomUUID(), observedAt: '2026-10-01T10:00:00Z' });
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate();
  const text = JSON.stringify((await w.generations())[0].idea_set);
  assert.equal(/SECRET/.test(text), false, 'no typed text is copied into the idea set');
  assert.ok(ui.evidence.some((item) => item.id === 'workspace:gardens:garden-1:1' && item.value === 'Watering source recorded'));
  assert.ok(!ui.evidence.some((item) => item.id.includes('obs-other-home')));
  const top = ui.batch.items.slice(0, 3).map((item) => item.id);
  assert.ok(top.includes('soil-test-plan') && top.includes('moisture-check'), top.join(','));
  // With the workspace flag off the records are not read.
  const off = await createWorld(db, { env: { HALO_FEATURE_PROJECTS: 'on' } });
  const offUi = fe.projectGeneration(off.runtime());
  await offUi.regenerate();
  assert.ok(!offUi.evidence.some((item) => item.id.startsWith('workspace:')));
});

test('start: the screen gets its own project with an immutable guide snapshot, and Homeguard\'s workspace and reconcile agree', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate();
  const guide = ui.findGuide(ui.batch.items[0].id);
  const started = await fe.startProject(w.runtime(), ui, guide);
  assert.equal(started.error, '');
  assert.equal(ui.state.startAttempt, null);
  const [, , recordId] = started.went;
  assert.match(recordId, /^project-[0-9a-f-]{36}$/);
  const collection = started.applied.collections.exploreProjects;
  assert.ok(validProductionCollection('exploreProjects', collection));
  const record = collection.find((item) => item.id === recordId);
  assert.equal(record.guideId, guide.id);
  assert.deepEqual(record.guide, guide);
  assert.deepEqual(record.history, [{ status: 'Active', note: `Started from guide version ${guide.version}.` }]);
  // Homeguard's own load returns the same row, and the ledger row reconciles as a workspace save.
  const load = await (await w.get(ROUTES.workspace, { collection: 'exploreProjects' })).json();
  assert.deepEqual(load.records, collection);
  assert.deepEqual(load.pendingOperations, []);
  const operationId = recordId.slice('project-'.length);
  const ledger = await w.ledgerRow(operationId);
  assert.equal(ledger.domain, 'workspace');
  assert.equal(ledger.kind, 'projects.start');
  assert.equal(JSON.stringify(ledger.result).includes(guide.title), false, 'the receipt holds ids and revisions only');
  const reconciled = await (await w.get(ROUTES.operations, { operationId, domain: 'workspace' })).json();
  assert.equal(reconciled.status, 'succeeded');
  assert.deepEqual(reconciled.changes.exploreProjects, collection);
  // The same start again (a retry of a lost answer) is the same project, not a second one.
  ui.state.startAttempt = { id: operationId, guideId: guide.id, version: guide.version };
  const repeat = await fe.startProject(w.runtime(), ui, guide);
  assert.equal(repeat.error, '');
  assert.deepEqual(repeat.applied.collections.exploreProjects, collection);
  assert.equal((await w.projects()).length, 1);
  // The guide detail of the owned project is its snapshot; bob asking for it is the 404.
  assert.deepEqual(await (await w.get(ROUTES.guide, { id: recordId })).json(), guide);
  assert.equal((await w.get(ROUTES.guide, { id: recordId }, { as: 'bob' })).status, 404);
});

test('start: one at a time, the pending one restores through projects.current, and an old version or unknown guide is settled', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate();
  const [first, second] = ui.batch.items.map((item) => ui.findGuide(item.id));
  // A start whose answer never came (the process died after the claim): a pending workspace row with that start's input.
  const pendingId = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'workspace', 'projects.start', 'pending', $3)`,
    [pendingId, w.ids.alice, requestHash({ guideId: first.id, guideVersion: first.version })]);
  const reload = fe.projectGeneration(w.runtime());
  await reload.load();
  assert.deepEqual(reload.state.startAttempt, { id: pendingId, guideId: first.id, version: first.version });
  const blocked = await fe.startProject(w.runtime(), reload, second);
  assert.equal(blocked.error, 'Check your previous project start before starting another.', 'the screen blocks a second start');
  const direct = await w.post(ROUTES.start, { guideId: second.id, guideVersion: second.version }, { key: crypto.randomUUID() });
  assert.equal(direct.status, 409, 'and so does the server');
  assert.equal((await direct.json()).reason, 'start_pending');
  // Bob is not blocked by alice's pending start.
  const bobUi = fe.projectGeneration(w.runtime('bob'));
  const bobStart = await fe.startProject(w.runtime('bob'), bobUi, second);
  assert.equal(bobStart.error, '');
  await db.query(`update public.operations set status = 'failed' where operation_id = $1`, [pendingId]);

  const stale = await w.post(ROUTES.start, { guideId: first.id, guideVersion: '2020-01-01.1' }, { key: crypto.randomUUID() });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).message, PROJECT_COPY.guideChanged);
  const missingGuide = await w.post(ROUTES.start, { guideId: 'no-such-guide', guideVersion: first.version }, { key: crypto.randomUUID() });
  assert.equal(missingGuide.status, 404);
  const fresh = fe.projectGeneration(w.runtime());
  fresh.state.startAttempt = null;
  const settled = await fe.startProject(w.runtime(), fresh, { ...first, version: '2020-01-01.1' });
  assert.equal(settled.error, 'This item changed. Review the latest version before saving.');
  assert.equal(fresh.state.startAttempt, null, 'a settled refusal clears the attempt');
  assert.deepEqual(await w.projects('alice'), []);
});

test('start: the workspace flag off, or 0026 missing, is refused before any claim', async (t) => {
  muteConsoleError(t);
  const w = await createWorld(db, { env: { HALO_FEATURE_PROJECTS: 'on' } });
  const key = crypto.randomUUID();
  const off = await w.post(ROUTES.start, { guideId: LIBRARY_GUIDES[0].id, guideVersion: LIBRARY_GUIDES[0].version }, { key });
  assert.equal(off.status, 403);
  assert.equal((await off.json()).message, featureDisabledReason('workspace'));
  const m = await createWorld(db, { missing: ['read_household_workspace'] });
  const gone = await m.post(ROUTES.start, { guideId: LIBRARY_GUIDES[0].id, guideVersion: LIBRARY_GUIDES[0].version }, { key });
  assert.equal(gone.status, 403);
  assert.equal(await w.ledgerRow(key), null);
});

test('0030 missing: generate is a settled failed answer with nothing claimed, the reads are the 503, cancel is cancelled', async () => {
  const w = await createWorld(db, { missing: ['read_project_generation', 'read_current_project_generation', 'record_project_generation'] });
  const ui = fe.projectGeneration(w.runtime());
  await ui.load();
  await ui.regenerate();
  assert.equal(ui.state.pending, null);
  assert.equal(ui.message, PROJECT_COPY.unavailable);
  assert.equal((await db.query('select count(*)::int as n from public.operations where profile_id = $1', [w.ids.alice])).rows[0].n, 0);
  assert.equal((await w.get(ROUTES.current)).status, 503);
  assert.equal((await w.get(ROUTES.status, { id: crypto.randomUUID() })).status, 503);
  const id = crypto.randomUUID();
  assert.equal((await (await w.post(ROUTES.cancel, { id }, { key: `cancel:${id}` })).json()).status, 'cancelled');
});

test('before 0016 the identity part of the key is still checked and generation works without home evidence', async () => {
  const w = await createWorld(db, { homes: false });
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate();
  assert.equal(ui.message, '12 ideas ready.');
  assert.equal(ui.evidence.find((item) => item.id === 'home:water-source').value, 'Public water system', 'from the profile');
});

test('guide detail: a library guide is its current version, a version it does not have is the 404, and every answer passes the client\'s check', async () => {
  const w = await createWorld(db);
  for (const guide of LIBRARY_GUIDES) {
    const body = await (await w.get(ROUTES.guide, { id: guide.id })).json();
    assert.ok(validProjectGuide(body), guide.id);
    assert.equal(JSON.stringify(body).includes(EM_DASH), false);
  }
  assert.equal((await w.get(ROUTES.guide, { id: LIBRARY_GUIDES[0].id, version: 'old' })).status, 404);
  assert.equal((await w.get(ROUTES.guide, { id: 'nope' })).status, 404);
});

test('every answer a route gave in this file is free of U+2014', async () => {
  const w = await createWorld(db, { env: ON });
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate(undefined, 'trees and water', true);
  const id = crypto.randomUUID();
  const bodies = [
    await (await w.get(ROUTES.current)).text(),
    await (await w.get(ROUTES.status, { id })).text(),
    await (await w.post(ROUTES.cancel, { id }, { key: `cancel:${id}` })).text(),
  ];
  for (const body of bodies) assert.equal(body.includes(EM_DASH), false);
});
