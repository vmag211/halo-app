/**
 * B16 Ruling J13 end to end: a project started through the REAL projects.start
 * route keeps its guide when it is updated through the REAL workspace commands
 * route (migration 0030's and 0026's real functions on PGlite). The person's own
 * fields save; a changed guide, guide id or guide version is a settled 200
 * failed receipt `project_guide_locked`, recorded on the ledger and replayed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './db/pgliteHarness.mjs';
import { createWorld, ROUTES } from './helpers/projectsWorld.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { validProductionRecord } = await loadFrontend('production/home-records');
const { LIBRARY_GUIDES } = await import('../lib/projectSelection.js');
const { REFUSALS } = await import('../lib/workspaceStore.js');
const COMMANDS = '/api/frontend/workspace/commands';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const clone = (value) => JSON.parse(JSON.stringify(value));
const reverseKeys = (value) => (Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value);

async function start(w, who = 'alice', guide = LIBRARY_GUIDES[0]) {
  const res = await w.post(ROUTES.start, { guideId: guide.id, guideVersion: guide.version }, { as: who, key: crypto.randomUUID() });
  assert.equal(res.status, 200);
  return (await res.json()).record;
}

/** POST /api/frontend/workspace/commands as the client sends it (If-Match carries the expected revision). */
async function send(w, command, { as = 'alice', operationId = crypto.randomUUID() } = {}) {
  const body = { operationId, ...command };
  const headers = { 'content-type': 'application/json', 'idempotency-key': operationId, ...(body.expectedRevision == null ? {} : { 'if-match': String(body.expectedRevision) }) };
  const res = await w.h.call(COMMANDS, 'POST', { as, rawBody: JSON.stringify(body), headers });
  return { status: res.status, body: await res.json(), operationId };
}
const put = (w, record, expectedRevision, options) => send(w, { kind: 'write', collection: 'exploreProjects', record, expectedRevision }, options);
const stored = async (w, who = 'alice') => (await w.projects(who)).map((row) => [row.record_id, row.revision, row.record]);

test('J13: a started project saves its own fields, refuses a changed guide, and accepts the guide re-sent unchanged', async () => {
  const w = await createWorld(db);
  const project = await start(w);
  assert.ok(validProductionRecord('exploreProjects', project));
  const stepId = project.guide.steps[0].id;

  // Progress: status, step notes, review date, outcome and goal save.
  const progress = { ...clone(project), status: 'Paused', outcome: 'Marked the spot', goal: 'My yard', reviewDate: '2026-11-01', stepNotes: { [stepId]: 'Done on Saturday' }, history: [...project.history, { status: 'Paused', note: 'Rain' }] };
  const saved = await put(w, progress, project.revision);
  assert.equal(saved.body.status, 'succeeded');
  const afterProgress = saved.body.changes.exploreProjects[0];
  assert.deepEqual([afterProgress.revision, afterProgress.status, afterProgress.stepNotes[stepId]], [project.revision + 1, 'Paused', 'Done on Saturday']);
  assert.deepEqual(afterProgress.guide, project.guide, 'the stored guide is the library snapshot');

  // The production client re-sends the guide it loaded (here in another key order): not a change.
  const resent = await put(w, { ...reverseKeys(afterProgress), status: 'Active' }, afterProgress.revision);
  assert.equal(resent.body.status, 'succeeded', 'the same guide in another key order saves');
  const current = resent.body.changes.exploreProjects[0];
  const before = await stored(w);

  // Each guide edit is refused, with the stored row untouched.
  const edits = {
    title: (g) => { g.title = `${g.title} (mine)`; },
    step: (g) => { g.steps[0].instructions = [...g.steps[0].instructions, 'Skip the last part.']; },
    sources: (g) => { g.sources = g.sources.slice(0, 1).map((source) => ({ ...source, title: 'Another source' })); g.steps.forEach((step) => { step.sourceIds = [g.sources[0].id]; }); },
    version: (g) => { g.version = `${g.version}.x`; },
    id: (g) => { g.id = `${g.id}-copy`; },
    materials: (g) => { g.materials = [...g.materials, 'Extra spade']; },
    reorderSteps: (g) => { g.steps = [...g.steps].reverse(); },
  };
  for (const [name, edit] of Object.entries(edits)) {
    const record = { ...clone(current), status: 'Completed' };
    edit(record.guide);
    record.guideId = record.guide.id;
    record.guideVersion = record.guide.version;
    if (name === 'reorderSteps' && record.guide.steps.length < 2) continue;
    const refused = await put(w, record, current.revision);
    assert.equal(refused.status, 200, name);
    assert.deepEqual([refused.body.status, refused.body.code, refused.body.reason, refused.body.changes, refused.body.message], ['failed', 'validation', 'project_guide_locked', {}, REFUSALS.project_guide_locked.message], name);
    assert.deepEqual(await stored(w), before, `${name}: nothing was written`);
  }

  // A refusal is on the ledger and replays as the same answer, even after the person's own save moves the revision.
  const locked = { ...clone(current), guide: { ...clone(current.guide), title: 'Other' } };
  const first = await put(w, locked, current.revision);
  assert.equal((await w.ledgerRow(first.operationId)).status, 'failed');
  const next = await put(w, { ...clone(current), reviewDate: '2026-12-01' }, current.revision);
  assert.equal(next.body.status, 'succeeded');
  const replay = await put(w, locked, current.revision, { operationId: first.operationId });
  assert.deepEqual(replay.body, first.body, 'the replayed refusal is the stored one');
  assert.equal((await stored(w))[0][1], next.body.changes.exploreProjects[0].revision);

  // A stale revision combined with a guide change: stale_revision (the revision is checked first).
  const both = await put(w, locked, current.revision);
  assert.equal(both.body.reason, 'stale_revision');
});

test('J13 edges: create, remove then re-create, another household, a row with no guide, numbers and unicode', async () => {
  const w = await createWorld(db);
  const aliceProject = await start(w, 'alice');
  const bobProject = await start(w, 'bob', LIBRARY_GUIDES[1] ?? LIBRARY_GUIDES[0]);
  const bobBefore = await stored(w, 'bob');

  // A new id (expectedRevision null) is a create, not an update: any valid guide may be written once.
  const forged = { ...clone(aliceProject), id: 'project-new-one', revision: 0, guide: { ...clone(aliceProject.guide), title: 'Zażółć gęślą jaźń \u{1F33F} / ŝ' } };
  forged.guide.buildPlan = { title: 'Box', note: 'n', sourceId: forged.guide.sources[0].id, assembly: ['Cut'], parts: [{ name: 'Board', size: '2x4', quantity: 2.5 }, { name: 'Pin', size: 'x', quantity: 1e21 }, { name: 'Dot', size: 'x', quantity: 0.1 + 0.2 }] };
  const created = await put(w, forged, null);
  assert.equal(created.body.status, 'succeeded');
  const createdRow = created.body.changes.exploreProjects.find((row) => row.id === 'project-new-one');

  // Unicode and number fidelity: the guide re-sent as loaded (jsonb numeric round trip, another key order) is unchanged.
  const echoed = await put(w, { ...reverseKeys(createdRow), status: 'Paused' }, createdRow.revision);
  assert.equal(echoed.body.status, 'succeeded', 'numbers and unicode survive the stored round trip');
  const echoedRow = echoed.body.changes.exploreProjects.find((row) => row.id === 'project-new-one');
  const nudged = clone(echoedRow);
  nudged.guide.buildPlan.parts[0].quantity = 2.500000001;
  assert.equal((await put(w, nudged, echoedRow.revision)).body.reason, 'project_guide_locked', 'a number that differs is a change');
  const dropped = clone(echoedRow);
  delete dropped.guide.buildPlan;
  assert.equal((await put(w, dropped, echoedRow.revision)).body.reason, 'project_guide_locked', 'removing an optional part is a change');
  const accent = clone(echoedRow);
  accent.guide.title = accent.guide.title.replace('ŝ', 'ŝ');
  assert.equal((await put(w, accent, echoedRow.revision)).body.reason, 'project_guide_locked', 'a different code point sequence is a change');

  // Another household: alice cannot update bob's project (no such row for her), and bob's row is untouched.
  const crossUpdate = await put(w, { ...clone(bobProject), status: 'Paused' }, bobProject.revision);
  assert.equal(crossUpdate.body.reason, 'stale_revision');
  assert.deepEqual(await stored(w, 'bob'), bobBefore);
  // Bob's own progress is unaffected by alice's refusals and keeps his guide.
  const bobSave = await put(w, { ...clone(bobProject), status: 'Completed' }, bobProject.revision, { as: 'bob' });
  assert.equal(bobSave.body.status, 'succeeded');
  assert.equal((await stored(w, 'alice')).length, 2);

  // Remove, then create the same id with a different guide: a new record, allowed.
  const removed = await send(w, { kind: 'remove', collection: 'exploreProjects', recordId: aliceProject.id, expectedRevision: aliceProject.revision });
  assert.equal(removed.body.status, 'succeeded');
  const other = clone(aliceProject);
  other.revision = 0;
  other.guide.title = 'A different title';
  const recreated = await put(w, other, null);
  assert.equal(recreated.body.status, 'succeeded');
  assert.equal((await stored(w, 'alice')).find(([id]) => id === aliceProject.id)[2].guide.title, 'A different title');
  // A create over a live id is stale_revision, never a guide overwrite.
  assert.equal((await put(w, clone(aliceProject), null)).body.reason, 'stale_revision');

  // A stored row without a guide (never written by this route): a write that carries a guide is a change of guide.
  const legacyId = 'project-legacy';
  const legacy = clone(aliceProject);
  delete legacy.guide;
  await db.query(`insert into public.household_workspace_records (profile_id, collection, record_id, revision, record) values ($1, 'exploreProjects', $2, 1, $3::jsonb)`, [w.ids.alice, legacyId, JSON.stringify({ ...legacy, id: legacyId })]);
  const fill = await put(w, { ...clone(aliceProject), id: legacyId }, 1);
  assert.equal(fill.body.reason, 'project_guide_locked');
});
