/**
 * B16 Explore projects, adversarial suite: edge inputs, other households,
 * missing migrations and flags, the collection limit, lost answers, races and
 * the client's own consumption logic. It reuses test/helpers/projectsWorld.mjs
 * (the real routes, REAL 0030/0026/0017 SQL on PGlite, the frontend's compiled
 * runtime and validators) and test/helpers/frontendB16.mjs (the transcribed
 * screen code). Assertions are on what the screen ends up holding (message,
 * pending attempt, start attempt) and on rows, not only on body shapes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './db/pgliteHarness.mjs';
import { muteConsoleError } from './helpers/routeHarness.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { createWorld, generateBody, ROUTES } from './helpers/projectsWorld.mjs';
import * as fe from './helpers/frontendB16.mjs';

const { validProjectGeneration, validProjectGuide } = await loadFrontend('production/explore-service');
const { validProductionCollection } = await loadFrontend('production/home-records');
const { featureDisabledReason } = await import('../lib/features.js');
const { PROJECT_COPY } = await import('../lib/projectsStore.js');
const { LIBRARY_GUIDES } = await import('../lib/projectSelection.js');

const EM_DASH = '—';
const SAFE = /\bsafe(?:ly|st|r)?\b/i;
let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

/** Every answer text a world gave, to scan for U+2014 and the word "safe". */
function spy(world) {
  const seen = [];
  const wrap = (fn) => async (...args) => {
    const res = await fn(...args);
    seen.push({ status: res.status, text: await res.clone().text() });
    return res;
  };
  return { ...world, post: wrap(world.post), get: wrap(world.get), seen };
}
const assertClean = (seen) => {
  for (const { text } of seen) {
    assert.equal(text.includes(EM_DASH), false, 'U+2014 in an answer');
    assert.equal(SAFE.test(text.replace(/"(?:safety)"/g, '')), false, `the word safe in: ${text.slice(0, 200)}`);
  }
};
const ledgerCount = async (id) => (await db.query('select count(*)::int as n from public.operations where profile_id = $1', [id])).rows[0].n;
const guideReq = (g) => ({ guideId: g.id, guideVersion: g.version });

test('generate: bad input is a 400 that reads, claims and stores nothing', async () => {
  const w = await createWorld(db);
  const key = () => crypto.randomUUID();
  const ok = generateBody(w);
  const cases = {
    'request 501 chars': { request: 'a'.repeat(501) },
    'request with NUL': { request: 'tree\u0000' },
    'request with C1 control': { request: 'tree\u0085' },
    'request with U+2028': { request: 'tree bee' },
    'request with ESC': { request: '\u001b[31mred' },
    'request not a string': { request: 5 },
    'request null': { request: null },
    'count 4': { constraints: { ...ok.constraints, count: 4 } },
    'count 16': { constraints: { ...ok.constraints, count: 16 } },
    'count 0': { constraints: { ...ok.constraints, count: 0 } },
    'count -3': { constraints: { ...ok.constraints, count: -3 } },
    'count 12.5': { constraints: { ...ok.constraints, count: 12.5 } },
    'count string': { constraints: { ...ok.constraints, count: '12' } },
    'count null': { constraints: { ...ok.constraints, count: null } },
    'space unknown': { constraints: { ...ok.constraints, space: 'attic' } },
    'constraints array': { constraints: [] },
    'constraints missing': { constraints: undefined },
    'interpret string': { interpret: 'true' },
    'interpret missing': { interpret: undefined },
    'previousIdeaIds 16': { previousIdeaIds: Array.from({ length: 16 }, (_, i) => `idea-${i}`) },
    'previousIdeaIds not an array': { previousIdeaIds: 'bee-house' },
    'previousIdeaIds number member': { previousIdeaIds: [1] },
    'previousIdeaIds empty member': { previousIdeaIds: [''] },
    'previousIdeaIds 201 chars': { previousIdeaIds: ['x'.repeat(201)] },
    'previousIdeaIds control': { previousIdeaIds: ['a\nb'] },
    'unknown key': { extra: 1 },
    'contextKey empty': { contextKey: '' },
    'contextKey 501 chars': { contextKey: `${w.ids.alice}:${'x'.repeat(500)}` },
    'contextKey control': { contextKey: `${w.scopeKey('alice')}\u0000` },
    'contextKey number': { contextKey: 7 },
  };
  for (const [name, patch] of Object.entries(cases)) {
    const res = await w.post(ROUTES.generate, { ...ok, ...patch }, { key: key() });
    assert.equal(res.status, 400, `${name}: ${res.status}`);
    assert.equal(res.headers.get('x-request-id') !== null, true);
  }
  // Header problems and body shapes.
  for (const [name, headerKey] of [['missing', null], ['empty', ''], ['not a uuid', 'abc'], ['cancel form', 'cancel:x'], ['uuid plus junk', `${crypto.randomUUID()}x`], ['very long', 'a'.repeat(10000)]]) {
    const res = await w.post(ROUTES.generate, ok, { key: headerKey });
    assert.equal(res.status, 400, `Idempotency-Key ${name}`);
  }
  for (const raw of ['[]', 'null', '"x"', '{bad', '7']) assert.equal((await w.post(ROUTES.generate, null, { key: key(), raw })).status, 400, raw);
  const empty = await w.post(ROUTES.generate, null, { key: key(), raw: '' });
  assert.equal(empty.status, 400, 'an empty body lacks every field');
  const big = await w.post(ROUTES.generate, null, { key: key(), raw: JSON.stringify({ ...ok, request: 'a'.repeat(20000) }) });
  assert.equal(big.status, 413);
  assert.deepEqual(await w.generations(), []);
  assert.equal(await ledgerCount(w.ids.alice), 0);
  assert.equal(w.h.db.queryLog.filter((entry) => entry.table === 'profiles' || entry.table === 'daily_scores').length, 0, 'nothing was read');
});

test('generate: the edges that are allowed are answered, trimmed and deduplicated, and the client holds them', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime());
  // Close to 500 characters with surrounding spaces and a newline (length counts the spaces), and every allowed count.
  for (const count of [3, 5, 10, 11, 12, 13, 14, 15]) {
    await ui.regenerate({ space: 'any', mode: 'any', time: 'any', budget: 'any', count }, `  ${'a'.repeat(494)}\n  `, false);
    assert.equal(ui.state.pending, null, `count ${count}`);
    assert.ok(ui.batch.items.length <= count && ui.batch.items.length > 0, `count ${count}: ${ui.batch.items.length} ${ui.message}`);
    assert.equal(ui.batch.request.length, 494, 'the request is stored trimmed');
  }
  const exact = await w.post(ROUTES.generate, generateBody(w, 'alice', { request: 'a'.repeat(500) }), { key: crypto.randomUUID() });
  assert.equal(exact.status, 200, 'exactly 500 characters is allowed');
  // 15 previous ids with duplicates and unknown ids: accepted, and the result is the same as for the distinct set.
  const first = await (await w.post(ROUTES.generate, generateBody(w, 'alice', { previousIdeaIds: ['bee-house', 'bee-house', 'nope', ...Array.from({ length: 12 }, (_, i) => `n${i}`)] }), { key: crypto.randomUUID() })).json();
  assert.equal(first.status, 'completed');
  assert.ok(validProjectGeneration(first));
  assert.equal(first.batch.items.at(-1).id === 'bee-house' || first.batch.items.every((item) => item.id !== 'bee-house'), true, 'a previous idea is ranked last or left out');
  // Unknown keys inside constraints are dropped, not stored.
  const sneaky = await (await w.post(ROUTES.generate, generateBody(w, 'alice', { constraints: { space: 'any', mode: 'any', time: 'any', budget: 'any', count: 3, admin: true } }), { key: crypto.randomUUID() })).json();
  assert.equal(JSON.stringify(sneaky).includes('admin'), false);
  assert.ok(validProjectGeneration(sneaky));
});

test('generate: text that Postgres cannot store is a settled 4xx, never a 500 that the client reads as unknown', async (t) => {
  muteConsoleError(t);
  const w = await createWorld(db);
  for (const request of ['\ud800', 'tree \udc00', 'bee \ud83d']) {
    const res = await w.post(ROUTES.generate, { ...generateBody(w), request }, { key: crypto.randomUUID() });
    assert.ok(res.status < 500, `lone surrogate in request answered ${res.status}`);
  }
  const homeless = await createWorld(db, { homes: false });
  const res = await homeless.post(ROUTES.generate, { ...generateBody(homeless), contextKey: `${homeless.ids.alice}:\ud800` }, { key: crypto.randomUUID() });
  assert.ok(res.status < 500, `lone surrogate in the context key answered ${res.status}`);
  const ui = fe.projectGeneration(w.runtime());
  await ui.regenerate(undefined, 'bee \ud83d', false);
  assert.notEqual(ui.message, 'The result is not confirmed. Check its status before trying again.');
});

test('ids on the read and cancel routes: non-uuid, very long, control characters and empty are settled', async () => {
  const w = await createWorld(db);
  const long = 'a'.repeat(5000);
  for (const id of ['not-a-uuid', 'cancel:x', '../../etc', long, '0'.repeat(36)]) {
    const status = await w.get(ROUTES.status, { id: id.slice(0, 200) });
    assert.equal(status.status, 200, `status ${id.slice(0, 20)}`);
    assert.equal((await status.json()).status, 'failed');
  }
  for (const id of [long, 'a\nb', '', '   ']) {
    assert.equal((await w.get(ROUTES.status, { id })).status, 400, `status ${JSON.stringify(id.slice(0, 10))}`);
    assert.equal((await w.get(ROUTES.guide, { id })).status, 400, `guide ${JSON.stringify(id.slice(0, 10))}`);
  }
  for (const id of ['a'.repeat(201), 'a\nb', '', '   ', '\ud800']) {
    const cancel = await w.post(ROUTES.cancel, { id }, { key: 'cancel:x' });
    assert.equal(cancel.status, 400, `cancel ${JSON.stringify(id.slice(0, 10))}`);
  }
  assert.equal((await w.post(ROUTES.cancel, { id: long }, { key: 'cancel:x' })).status, 413, 'a body over 2 KiB');
  assert.equal((await w.get(ROUTES.status, {})).status, 400);
  // A cancel of an id that is not a uuid cannot be ours: cancelled, nothing written.
  const odd = await w.post(ROUTES.cancel, { id: 'not-a-uuid' }, { key: 'cancel:not-a-uuid' });
  assert.equal(odd.status, 200);
  assert.equal((await odd.json()).status, 'cancelled');
  assert.deepEqual(await w.generations(), []);
  assert.equal(await ledgerCount(w.ids.alice), 0);
  // Missing header, header too long, unknown key.
  const id = crypto.randomUUID();
  assert.equal((await w.post(ROUTES.cancel, { id }, { key: null })).status, 400);
  assert.equal((await w.post(ROUTES.cancel, { id }, { key: 'c'.repeat(221) })).status, 400);
  assert.equal((await w.post(ROUTES.cancel, { id, extra: 1 }, { key: `cancel:${id}` })).status, 400);
  assert.equal((await w.post(ROUTES.cancel, null, { key: `cancel:${id}`, raw: '{}' })).status, 400);
  // Start: bad ids, unknown keys, key shapes.
  const g = LIBRARY_GUIDES[0];
  for (const body of [{ guideId: 'g'.repeat(201), guideVersion: g.version }, { guideId: g.id }, { guideVersion: g.version }, { guideId: 5, guideVersion: g.version }, { ...guideReq(g), extra: 1 }, { guideId: 'a\u0000b', guideVersion: g.version }, { guideId: g.id, guideVersion: 'v'.repeat(101) }]) {
    assert.equal((await w.post(ROUTES.start, body, { key: crypto.randomUUID() })).status, 400, JSON.stringify(body).slice(0, 60));
  }
  for (const key of [null, '', 'nope', 'cancel:x']) assert.equal((await w.post(ROUTES.start, guideReq(g), { key })).status, 400, `start key ${key}`);
  assert.deepEqual(await w.projects(), []);
  assert.equal(await ledgerCount(w.ids.alice), 0);
});

test('another household: bob cannot read, cancel, replay or start against alice\'s ids, and learns nothing of hers', async () => {
  const base = await createWorld(db);
  const w = spy(base);
  const ui = fe.projectGeneration(w.runtime('alice'));
  await ui.regenerate();
  const aliceId = (await w.generations('alice'))[0].generation_id;
  const started = await fe.startProject(w.runtime('alice'), ui, LIBRARY_GUIDES.find((guide) => guide.id === ui.batch.items[0].id));
  const projectId = started.went[2];
  const startOp = projectId.slice('project-'.length);

  // Status of alice's job id: bob gets the identical "not found" he would get for any id.
  const mine = await (await w.get(ROUTES.status, { id: aliceId }, { as: 'bob' })).json();
  const none = await (await w.get(ROUTES.status, { id: crypto.randomUUID() }, { as: 'bob' })).json();
  assert.deepEqual({ ...mine, id: null }, { ...none, id: null });
  assert.equal(mine.contextKey, `${w.ids.bob}:none:0`, 'no home header: the key of a client that names no home');
  const viaClient = await w.runtime('bob').request('projects.generation', { id: aliceId });
  assert.equal(viaClient.contextKey, w.scopeKey('bob'), 'a client that names its home gets its own key');
  assert.equal(viaClient.status, 'failed');
  // Guide detail for alice's project record, with and without a version.
  assert.equal((await w.get(ROUTES.guide, { id: projectId }, { as: 'bob' })).status, 404);
  assert.equal((await w.get(ROUTES.guide, { id: projectId, version: LIBRARY_GUIDES[0].version }, { as: 'bob' })).status, 404);
  assert.equal((await w.get(ROUTES.guide, { id: projectId }, { as: 'alice' })).status, 200);
  // Bob generates with alice's job id as his key: his own request, his own row; alice's stays hers.
  const before = (await w.generations('alice'))[0];
  // The ledger's operation ids are global (0017), so another household's id is the settled 409, which says nothing about whose it is.
  const bobHttp = await w.post(ROUTES.generate, generateBody(w, 'bob'), { as: 'bob', key: aliceId });
  const bobRes = await bobHttp.json();
  assert.equal(bobHttp.status, 409, JSON.stringify(bobRes));
  assert.equal(JSON.stringify(bobRes).includes(w.ids.alice), false);
  assert.deepEqual((await w.generations('alice'))[0], before);
  assert.equal((await w.generations('bob')).length, 0);
  assert.equal((await w.ledgerRow(aliceId)).profile_id, w.ids.alice);
  const bobUi = fe.projectGeneration(w.runtime('bob'));
  await bobUi.regenerate();
  assert.equal(bobUi.message, '12 ideas ready.', 'a fresh id works for bob');
  assert.equal(bobUi.batch.contextKey, w.scopeKey('bob'));
  // Bob presents alice's context key: a 400, and nothing about her home.
  const forged = await w.post(ROUTES.generate, generateBody(w, 'alice'), { as: 'bob', key: crypto.randomUUID() });
  assert.equal(forged.status, 400);
  assert.equal((await forged.text()).includes(w.home.alice), false);
  // Replaying alice's start operation id as bob, with her guide or another: the settled 409, no receipt of hers, nothing created for him.
  for (const guide of [LIBRARY_GUIDES.find((item) => item.id === ui.batch.items[0].id), LIBRARY_GUIDES[1]]) {
    const bobStart = await w.post(ROUTES.start, guideReq(guide), { as: 'bob', key: startOp });
    assert.equal(bobStart.status, 409, guide.id);
    const text = await bobStart.text();
    assert.equal(text.includes(projectId), false);
    assert.equal(text.includes(w.ids.alice), false);
  }
  assert.equal((await w.projects('bob')).length, 0);
  assert.equal((await w.projects('alice')).length, 1);
  assert.equal((await w.projects('alice'))[0].record.guideId, ui.batch.items[0].id);
  // Alice's operation is not readable by bob through the reconcile route either.
  const peek = await w.get(ROUTES.operations, { operationId: startOp, domain: 'workspace' }, { as: 'bob' });
  assert.ok(peek.status >= 400 && peek.status < 500, `${peek.status}`);
  assert.equal((await peek.text()).includes(projectId), false);
  // Bob's cancel of alice's id records a cancellation of his own only, and alice's set is untouched.
  const cancel = await (await w.post(ROUTES.cancel, { id: aliceId }, { as: 'bob', key: `cancel:${aliceId}` })).json();
  assert.equal(cancel.status, 'cancelled');
  assert.equal((await w.generations('alice'))[0].status, 'completed');
  assert.equal((await w.get(ROUTES.current, {}, { as: 'alice' }).then((res) => res.json())).data.id, aliceId);
  assertClean(w.seen);
});

test('start: every library guide starts, snapshots exactly, and passes the screen\'s receipt check', async () => {
  const w = spy(await createWorld(db));
  for (const guide of LIBRARY_GUIDES) {
    const ui = fe.projectGeneration(w.runtime());
    const started = await fe.startProject(w.runtime(), ui, guide);
    assert.equal(started.error, '', guide.id);
    assert.equal(ui.state.startAttempt, null, guide.id);
    assert.deepEqual(started.applied.collections.exploreProjects.find((row) => row.id === started.went[2]).guide, guide);
  }
  assert.equal((await w.projects()).length, LIBRARY_GUIDES.length);
  assert.ok(validProductionCollection('exploreProjects', (await (await w.get(ROUTES.workspace, { collection: 'exploreProjects' })).json()).records));
  // Two starts of the same guide are two projects (each its own instance id).
  const ui = fe.projectGeneration(w.runtime());
  await fe.startProject(w.runtime(), ui, LIBRARY_GUIDES[0]);
  assert.equal((await w.projects()).length, LIBRARY_GUIDES.length + 1);
  assertClean(w.seen);
});

test('start at the collection limit: a settled 409 that clears the attempt, nothing half-written, and a start works again once there is room', async () => {
  const w = await createWorld(db);
  await db.query(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record)
     select $1, 'exploreProjects', 'filler-' || g, 1, jsonb_build_object('id', 'filler-' || g, 'revision', 1, 'title', 't')
       from generate_series(1, 1000) g`, [w.ids.alice]);
  const ui = fe.projectGeneration(w.runtime());
  const g = LIBRARY_GUIDES[0];
  const key = crypto.randomUUID();
  const res = await w.post(ROUTES.start, guideReq(g), { key });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.reason, 'limit');
  assert.equal(body.message, PROJECT_COPY.startLimit);
  assert.equal((await w.projects()).length, 1000);
  const row = await w.ledgerRow(key);
  assert.equal(row.status, 'failed', 'a refused start is settled, not pending');
  // The same key again is the same answer, and the unresolved list stays empty.
  const again = await w.post(ROUTES.start, guideReq(g), { key });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).reason, 'limit');
  const screen = await fe.startProject(w.runtime(), ui, g);
  assert.equal(ui.state.startAttempt, null, 'a 409 is settled for the screen');
  assert.equal(screen.error, 'This item changed. Review the latest version before saving.');
  assert.equal(screen.error.includes(EM_DASH), false);
  // Another start is not blocked (the refused one is not pending), and current shows no pendingStart.
  await ui.regenerate();
  const current = await (await w.get(ROUTES.current)).json();
  assert.equal(current.data.pendingStart, undefined);
  // Room again: a delete, and the same guide starts (the route; the filler rows are not valid records for the screen's own collection check).
  await db.query(`delete from public.household_workspace_records where profile_id = $1 and record_id = 'filler-1'`, [w.ids.alice]);
  const ok = await w.post(ROUTES.start, guideReq(g), { key: crypto.randomUUID() });
  assert.equal(ok.status, 200);
  assert.equal((await w.projects()).length, 1000);
});

test('start at the collection byte limit is the same settled 409', async () => {
  const w = await createWorld(db);
  // 300 records of about 5 KB: past 1.5 MB with the next start.
  const pad = 'x'.repeat(5200);
  await db.query(
    `insert into public.household_workspace_records (profile_id, collection, record_id, revision, record)
     select $1, 'exploreProjects', 'filler-' || g, 1, jsonb_build_object('id', 'filler-' || g, 'revision', 1, 'title', $2::text)
       from generate_series(1, 300) g`, [w.ids.alice, pad]);
  const res = await w.post(ROUTES.start, guideReq(LIBRARY_GUIDES[0]), { key: crypto.randomUUID() });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, 'limit');
});

test('a lost start answer: the screen keeps its attempt, the same key returns the same project, and the workspace reconcile agrees', async () => {
  const w = await createWorld(db);
  const g = LIBRARY_GUIDES[2];
  const ui = fe.projectGeneration(w.runtime('alice', { lose: (path) => path === ROUTES.start }));
  const lost = await fe.startProject(w.runtime('alice', { lose: (path) => path === ROUTES.start }), ui, g);
  assert.equal(lost.went, null);
  assert.ok(ui.state.startAttempt, 'unknown outcome keeps the attempt');
  assert.equal(ui.state.startAttempt.guideId, g.id);
  assert.equal((await w.projects()).length, 1, 'the start did commit');
  // The screen reconciles through the operations route with the attempt's own id.
  const reconcile = await (await w.get(ROUTES.operations, { operationId: ui.state.startAttempt.id, domain: 'workspace' })).json();
  assert.equal(reconcile.status, 'succeeded');
  assert.equal(reconcile.changes.exploreProjects.length, 1);
  assert.equal(reconcile.changes.exploreProjects[0].id, `project-${ui.state.startAttempt.id}`);
  // Retrying with the kept attempt returns the identical project.
  const retry = await fe.startProject(w.runtime(), ui, g);
  assert.equal(retry.error, '');
  assert.equal(retry.went[2], `project-${reconcile.operationId}`);
  assert.equal(ui.state.startAttempt, null);
  assert.equal((await w.projects()).length, 1);
  // A different guide while a lost attempt is kept is blocked by the screen itself.
  const second = fe.projectGeneration(w.runtime('alice', { lose: (path) => path === ROUTES.start }));
  await fe.startProject(w.runtime('alice', { lose: (path) => path === ROUTES.start }), second, LIBRARY_GUIDES[3]);
  const blocked = await fe.startProject(w.runtime(), second, LIBRARY_GUIDES[4]);
  assert.equal(blocked.error, 'Check your previous project start before starting another.');
  assert.equal((await w.projects()).length, 2);
});

test('a lost start whose claim is still pending: the retry is the retryable 503, the screen keeps the attempt, nothing else may start', async (t) => {
  muteConsoleError(t);
  const w = await createWorld(db);
  const g = LIBRARY_GUIDES[0];
  const pendingId = crypto.randomUUID();
  const { requestHash } = await import('../lib/operations.js');
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'workspace', 'projects.start', 'pending', $3)`,
    [pendingId, w.ids.alice, requestHash({ guideId: g.id, guideVersion: g.version })]);
  const res = await w.post(ROUTES.start, guideReq(g), { key: pendingId });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.retryable, true);
  const ui = fe.projectGeneration(w.runtime());
  ui.state.startAttempt = { id: pendingId, guideId: g.id, version: g.version };
  const screen = await fe.startProject(w.runtime(), ui, g);
  assert.ok(ui.state.startAttempt, 'a 503 is not settled: the attempt is kept');
  assert.notEqual(screen.error, '');
  // The same key with another guide is the input mismatch, settled.
  const other = await w.post(ROUTES.start, guideReq(LIBRARY_GUIDES[1]), { key: pendingId });
  assert.equal(other.status, 409);
  assert.equal((await w.projects()).length, 0);
});

test('flags individually: workspace off keeps generation and the library guide, drops owned guides and pendingStart; projects off closes everything', async () => {
  const noWorkspace = spy(await createWorld(db, { env: { HALO_FEATURE_PROJECTS: 'on' } }));
  const w = noWorkspace;
  const ui = fe.projectGeneration(w.runtime());
  await ui.load();
  await ui.regenerate();
  assert.equal(ui.message, '12 ideas ready.');
  assert.equal(ui.state.startAttempt, null);
  const pendingId = crypto.randomUUID();
  const g = LIBRARY_GUIDES[0];
  const { requestHash } = await import('../lib/operations.js');
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'workspace', 'projects.start', 'pending', $3)`,
    [pendingId, w.ids.alice, requestHash({ guideId: g.id, guideVersion: g.version })]);
  const cur = await (await w.get(ROUTES.current)).json();
  assert.equal(cur.data.pendingStart, undefined, 'the workspace is off: no start is reported');
  assert.equal((await w.get(ROUTES.guide, { id: g.id })).status, 200);
  assert.equal((await w.get(ROUTES.guide, { id: `project-${pendingId}` })).status, 404);
  const start = await w.post(ROUTES.start, guideReq(g), { key: crypto.randomUUID() });
  assert.equal(start.status, 403);
  assert.equal((await start.json()).message, featureDisabledReason('workspace'));
  assertClean(w.seen);

  // Projects off, workspace on: the same gate, and a workspace record id is not leaked through guide detail.
  const off = spy(await createWorld(db, { env: { HALO_FEATURE_WORKSPACE: 'on' } }));
  const offUi = fe.projectGeneration(off.runtime());
  await offUi.load();
  await offUi.regenerate();
  assert.equal(offUi.message, featureDisabledReason('projects'));
  assert.equal(offUi.state.pending, null);
  assert.equal((await off.post(ROUTES.start, guideReq(g), { key: crypto.randomUUID() })).status, 403);
  assert.equal((await off.get(ROUTES.guide, { id: g.id })).status, 503);
  assert.equal(await ledgerCount(off.ids.alice), 0);
  assert.deepEqual(await off.generations(), []);
  assertClean(off.seen);
});

test('migrations missing one by one are settled for the screen, and a missing ledger is too', async (t) => {
  muteConsoleError(t);
  // 0026 (workspace) missing: start is refused before any claim; generation still works without records.
  const m = spy(await createWorld(db, { missing: ['read_household_workspace', 'commit_household_workspace'] }));
  const ui = fe.projectGeneration(m.runtime());
  await ui.load();
  await ui.regenerate();
  assert.equal(ui.message, '12 ideas ready.');
  const start = await fe.startProject(m.runtime(), ui, LIBRARY_GUIDES[0]);
  assert.equal(start.error, 'This action is not available for this account.');
  assert.equal(ui.state.startAttempt, null);
  assert.equal((await m.get(ROUTES.guide, { id: LIBRARY_GUIDES[0].id })).status, 200);
  assert.equal((await m.get(ROUTES.guide, { id: 'project-x' })).status, 404, 'owned guides without 0026 are a 404, not a 500');
  assertClean(m.seen);

  // The ledger (0017) missing: generate is a settled failed answer, start 403, cancel cancelled, status 503.
  const l = spy(await createWorld(db));
  const real = l.h.db.from;
  const gone = () => { const q = new Proxy({}, { get: (_, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) : () => q) }); return q; };
  l.h.db.from = (name) => (name === 'operations' ? gone() : real(name));
  const lui = fe.projectGeneration(l.runtime());
  await lui.regenerate();
  assert.equal(lui.state.pending, null);
  assert.equal(lui.message, PROJECT_COPY.unavailable);
  assert.equal((await l.post(ROUTES.start, guideReq(LIBRARY_GUIDES[0]), { key: crypto.randomUUID() })).status, 403);
  const id = crypto.randomUUID();
  assert.equal((await (await l.post(ROUTES.cancel, { id }, { key: `cancel:${id}` })).json()).status, 'cancelled');
  assert.equal((await l.get(ROUTES.status, { id })).status, 503);
  assert.deepEqual(await l.generations(), []);
  assertClean(l.seen);
});

test('every 200 generate, status and cancel answer passes the client\'s check and carries the client\'s own context key', async () => {
  const w = spy(await createWorld(db));
  const rt = w.runtime();
  const scope = rt.scopeKey;
  assert.equal(scope, w.scopeKey('alice'));
  const cancelOf = (id) => rt.request('projects.cancel', { id }, { idempotencyKey: `cancel:${id}` });
  const statusOf = (id) => rt.request('projects.generation', { id });
  const answers = [];
  const gen = async (patch = {}, key = crypto.randomUUID()) => {
    const res = await w.post(ROUTES.generate, generateBody(w, 'alice', patch), { key });
    assert.equal(res.status, 200);
    const body = await res.json();
    answers.push(body);
    return { key, body };
  };
  const a = await gen();
  await gen({ request: 'bees', interpret: true });
  await gen({ request: 'zzzz', interpret: true });
  await gen({ constraints: { space: 'indoors', mode: 'solo', time: 'quick', budget: 'reuse', count: 3 } });
  await gen({ constraints: { space: 'balcony', mode: 'group', time: 'half-day', budget: 'low', count: 15 }, previousIdeaIds: a.body.batch.items.map((item) => item.id) });
  // cancelled-first, failed, status of a completed/unknown/cancelled id, cancel of a completed/cancelled/unknown id.
  const c = crypto.randomUUID();
  answers.push(await cancelOf(c));
  answers.push(await (await w.post(ROUTES.generate, generateBody(w), { key: c })).json());
  answers.push(await statusOf(c));
  answers.push(await statusOf(a.key));
  answers.push(await statusOf(crypto.randomUUID()));
  answers.push(await cancelOf(a.key));
  answers.push(await cancelOf(crypto.randomUUID()));
  const stale = await (await w.post(ROUTES.generate, generateBody(w, 'alice', { contextKey: `${w.ids.alice}:${w.home.alice}:2` }), { key: crypto.randomUUID() })).json();
  answers.push(stale);
  for (const answer of answers) {
    assert.ok(validProjectGeneration(answer), JSON.stringify(answer).slice(0, 200));
    if (answer !== stale) assert.equal(answer.contextKey, scope, `${answer.status}: ${answer.message ?? ''}`);
    if (answer.status === 'completed') {
      assert.equal(answer.batch.contextKey, scope);
      assert.ok(answer.batch.items.length <= answer.batch.constraints.count);
      assert.ok(answer.batch.items.every((item) => answer.guides.some((guide) => guide.id === item.id && validProjectGuide(guide))));
    }
  }
  // current: the newest completed set, with the same key.
  const current = await (await w.get(ROUTES.current)).json();
  assert.ok(validProjectGeneration(current.data));
  assert.equal(current.data.contextKey, scope);
  assert.equal(current.data.batch.generation, 5);
  assertClean(w.seen);
});

test('a client that names no home (a reload, or before 0016): cancelled-first, a late request and a status of an unseen id carry its own key, and the screen ends cleanly', async () => {
  for (const homes of [true, false]) {
    const w = await createWorld(db, { homes });
    const rt = w.runtime('alice', { homeless: true });
    const scope = rt.scopeKey;
    assert.equal(scope, `${w.ids.alice}:none:0`);
    const id = crypto.randomUUID();
    await rt.request('projects.cancel', { id }, { idempotencyKey: `cancel:${id}` });
    const late = await (await w.post(ROUTES.generate, generateBody(w, 'alice', { contextKey: scope }), { key: id })).json();
    assert.equal(late.status, 'cancelled', `homes ${homes}`);
    assert.equal(late.contextKey, scope, 'the client compares this before the status');
    const unseen = await rt.request('projects.generation', { id: crypto.randomUUID() });
    assert.ok(validProjectGeneration(unseen));
    assert.equal(unseen.contextKey, scope);
    // The screen: a generation, a reload that restores it, a lost answer recovered by the check.
    const ui = fe.projectGeneration(rt);
    await ui.regenerate();
    assert.equal(ui.message, '12 ideas ready.', `homes ${homes}`);
    const again = fe.projectGeneration(w.runtime('alice', { homeless: true }));
    await again.load();
    assert.deepEqual(again.batch, ui.batch);
    const lossy = fe.projectGeneration(w.runtime('alice', { homeless: true, lose: (path) => path === ROUTES.generate }));
    await lossy.regenerate();
    assert.ok(lossy.state.pending);
    await lossy.retry();
    assert.equal(lossy.state.pending, null, `homes ${homes}`);
    assert.equal(lossy.message, '12 ideas ready.');
  }
});

test('a cancel racing a generate settles on one answer for both callers and for every later read', async () => {
  // Case 1: the generation is held just before it records; the cancel lands first.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = null;
  const w = await createWorld(db, {
    onRecord: async (args, record) => {
      if (args.p_status === 'completed' && !held) { held = args.p_generation_id; await gate; }
      return record();
    },
  });
  const id = crypto.randomUUID();
  const pending = w.post(ROUTES.generate, generateBody(w), { key: id });
  while (!held) await new Promise((resolve) => setTimeout(resolve, 5));
  const cancel = await w.runtime().request('projects.cancel', { id }, { idempotencyKey: `cancel:${id}` });
  assert.equal(cancel.status, 'cancelled');
  // While it is held, a status check sees "queued" or the cancellation, never a failure or a second generation.
  const mid = await w.runtime().request('projects.generation', { id });
  assert.ok(['queued', 'cancelled'].includes(mid.status), mid.status);
  release();
  const answer = await (await pending).json();
  assert.equal(answer.status, 'cancelled');
  assert.ok(validProjectGeneration(answer));
  assert.equal(answer.contextKey, w.scopeKey('alice'));
  const rows = await w.generations();
  assert.deepEqual(rows.map((row) => row.status), ['cancelled']);
  assert.equal((await (await w.get(ROUTES.status, { id })).json()).status, 'cancelled');
  assert.equal((await (await w.get(ROUTES.current)).json()).data, null, 'a cancelled request is not a saved set');
  // The generation's ledger row is settled, not left pending.
  assert.equal((await w.ledgerRow(id)).status, 'succeeded');

  // Case 2: the cancel is held just before it records; the generation completes first.
  let release2;
  const gate2 = new Promise((resolve) => { release2 = resolve; });
  let held2 = false;
  const v = await createWorld(db, {
    onRecord: async (args, record) => {
      if (args.p_status === 'cancelled' && !held2) { held2 = true; await gate2; }
      return record();
    },
  });
  const id2 = crypto.randomUUID();
  const cancelPending = v.runtime().request('projects.cancel', { id: id2 }, { idempotencyKey: `cancel:${id2}` });
  while (!held2) await new Promise((resolve) => setTimeout(resolve, 5));
  const generated = await (await v.post(ROUTES.generate, generateBody(v), { key: id2 })).json();
  assert.equal(generated.status, 'completed');
  release2();
  const cancelled = await cancelPending;
  assert.equal(cancelled.status, 'completed', 'the ideas were ready first, and cancel says so');
  assert.deepEqual(cancelled, generated);
  assert.deepEqual((await v.generations()).map((row) => row.status), ['completed']);
  // The screen's cancel path with that answer commits the ideas.
  const ui = fe.projectGeneration(v.runtime());
  ui.state.pending = { id: id2, jobId: id2, constraints: ui.batch.constraints, request: '', interpret: false };
  await ui.cancel();
  assert.equal(ui.message, 'Ideas were ready before cancellation.');
});

test('the screen after a cancelled-first generation: the late request ends cleanly with the cancellation message and no pending attempt', async () => {
  const w = await createWorld(db);
  const ui = fe.projectGeneration(w.runtime());
  const original = crypto.randomUUID;
  const id = original.call(crypto);
  await w.runtime().request('projects.cancel', { id }, { idempotencyKey: `cancel:${id}` });
  crypto.randomUUID = () => { crypto.randomUUID = original; return id; };
  try { await ui.regenerate(); } finally { crypto.randomUUID = original; }
  assert.equal(ui.state.pending, null);
  assert.equal(ui.message, PROJECT_COPY.cancelled);
  assert.equal(ui.batch.items.length, 0);
});

test('replays: a repeated id from a second tab, a poll of an in-flight id, and a repeat after the row is gone', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  const w = await createWorld(db, {
    onRecord: async (args, record) => { if (!held) { held = true; await gate; } return record(); },
  });
  const id = crypto.randomUUID();
  const first = w.post(ROUTES.generate, generateBody(w), { key: id });
  while (!held) await new Promise((resolve) => setTimeout(resolve, 5));
  // Second tab with the same id while the first is in flight: queued (never a 5xx, never a second set).
  const second = await w.post(ROUTES.generate, generateBody(w), { key: id });
  assert.equal(second.status, 200);
  const queued = await second.json();
  assert.equal(queued.status, 'queued');
  assert.ok(validProjectGeneration(queued));
  assert.equal(queued.contextKey, w.scopeKey('alice'));
  const poll = await (await w.get(ROUTES.status, { id })).json();
  assert.equal(poll.status, 'queued');
  release();
  const done = await (await first).json();
  assert.equal(done.status, 'completed');
  assert.equal((await w.generations()).length, 1);
  assert.deepEqual(await (await w.get(ROUTES.status, { id })).json(), done);
});

test('the retention prune keeps the newest completed set reachable through current, status and the screen', async () => {
  const w = await createWorld(db);
  const first = await (await w.post(ROUTES.generate, generateBody(w), { key: crypto.randomUUID() })).json();
  for (let i = 0; i < 22; i += 1) {
    const id = crypto.randomUUID();
    await w.post(ROUTES.cancel, { id }, { key: `cancel:${id}` });
  }
  const after = await (await w.post(ROUTES.generate, generateBody(w), { key: crypto.randomUUID() })).json();
  assert.equal(after.status, 'completed');
  assert.equal(after.batch.generation, 2, 'the generation counter survives the prune');
  assert.ok((await w.generations()).length <= 21);
  assert.equal((await (await w.get(ROUTES.current)).json()).data.id, after.id);
  void first;
});

test('guide detail: version, case and lookalike ids', async () => {
  const w = await createWorld(db);
  const g = LIBRARY_GUIDES[0];
  assert.equal((await w.get(ROUTES.guide, { id: g.id, version: g.version })).status, 200);
  assert.equal((await w.get(ROUTES.guide, { id: g.id.toUpperCase() })).status, 404);
  assert.equal((await w.get(ROUTES.guide, { id: `${g.id} ` })).status, 200, 'trimmed like every text field');
  assert.equal((await w.get(ROUTES.guide, { id: g.id, version: '' })).status, 400);
  assert.equal((await w.get(ROUTES.guide, { id: '__proto__' })).status, 404);
  assert.equal((await w.get(ROUTES.guide, { id: 'constructor' })).status, 404);
  assert.equal((await w.get(ROUTES.guide, { id: 'toString' })).status, 404);
});

test('no route answers a 5xx for an outcome known before the claim, and every answer is free of U+2014 and the word safe', async (t) => {
  muteConsoleError(t);
  const worlds = [
    spy(await createWorld(db)),
    spy(await createWorld(db, { env: {} })),
    spy(await createWorld(db, { env: { HALO_FEATURE_PROJECTS: 'on' } })),
    spy(await createWorld(db, { env: { HALO_FEATURE_WORKSPACE: 'on' } })),
    spy(await createWorld(db, { homes: false })),
    spy(await createWorld(db, { missing: ['read_project_generation', 'read_current_project_generation', 'record_project_generation'] })),
    spy(await createWorld(db, { missing: ['read_household_workspace', 'commit_household_workspace'] })),
  ];
  const g = LIBRARY_GUIDES[0];
  for (const w of worlds) {
    const id = crypto.randomUUID();
    const calls = [
      w.post(ROUTES.generate, generateBody(w), { key: id }),
      w.post(ROUTES.generate, generateBody(w), { key: id }),
      w.post(ROUTES.generate, generateBody(w, 'alice', { contextKey: `${w.ids.alice}:${w.home.alice}:9` }), { key: crypto.randomUUID() }),
      w.post(ROUTES.cancel, { id }, { key: `cancel:${id}` }),
      w.post(ROUTES.cancel, { id: crypto.randomUUID() }, { key: 'cancel:x' }),
      w.post(ROUTES.start, guideReq(g), { key: crypto.randomUUID() }),
      w.post(ROUTES.start, { guideId: 'nope', guideVersion: '1' }, { key: crypto.randomUUID() }),
      w.post(ROUTES.start, { guideId: g.id, guideVersion: 'old' }, { key: crypto.randomUUID() }),
      w.get(ROUTES.current),
      w.get(ROUTES.status, { id }),
      w.get(ROUTES.guide, { id: g.id }),
      w.get(ROUTES.guide, { id: 'project-x' }),
    ];
    for (const res of await Promise.all(calls)) assert.ok(res.status < 500 || res.status === 503, `${res.status}`);
    for (const { status, text } of w.seen) if (status === 503) assert.equal(JSON.parse(text).retryable, false, 'a 503 here is the non-retryable one');
    assertClean(w.seen);
  }
});

test('the library text itself has no U+2014 and no claim of "safe"', async () => {
  const text = JSON.stringify(LIBRARY_GUIDES);
  assert.equal(text.includes(EM_DASH), false);
  assert.equal(SAFE.test(text), false, text.match(SAFE)?.[0]);
});
