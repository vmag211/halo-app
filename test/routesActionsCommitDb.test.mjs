/**
 * POST /api/frontend/actions/commands (`actions.commit`) and its reconcile,
 * GET /api/operations?domain=actions, with EVERYTHING real below the route:
 * migration 0023's read and commit functions AND the 0017 ledger, on PGlite
 * (test/helpers/actionsWorld.mjs with `ledger: 'pglite'`, through
 * test/db/pgliteLedger.mjs). This is where Ruling H8 is proved: the commit
 * function settles its own ledger row in the transaction that writes the
 * tasks, and 0023's settled-row guard (Ruling H28) stops runOperation from
 * turning that `succeeded` into `failed` when the response is lost, so the
 * client's "No save was applied" is true whenever it is said.
 *
 * THE CLIENT'S OWN CONSUMPTION LOGIC IS RUN, not only its validators
 * (test/helpers/frontendB06.mjs, transcribed from
 * origin/codex/october15-review-refinement at 5ac06f6): the runtime's status
 * mapping and unwrap (runtime.ts:144-153), the action adapter
 * (adapters.ts:7,9,10,11), and the screen's save and reconcile decisions
 * (ExpandedPreviewState.tsx:60-152, WeekReviewPlanner.tsx:17). Each scenario
 * ends in an assertion on the client's resulting STATE: whether the save
 * returned true, the sentence shown, whether My Week is locked on an
 * operation, and what it holds.
 *
 * Everything is local: synthetic identities, an in-memory fake for the
 * session, PGlite for the database, and a fetch that throws on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import { createWorld, body } from './helpers/actionsWorld.mjs';
import {
  actionReceiptCoversCommand,
  applyWeekPlan,
  captureReview,
  createActionAdapter,
  sameValue,
  setBrowserZones,
  validActionSnapshot,
} from './helpers/frontendB06.mjs';

const { requestHash } = await import('../lib/operations.js');

const NOTE = 'PRIVATE-NOTE-MARKER the inhaler is in the blue bag';
const TITLE = 'PRIVATE-TITLE-MARKER Test the kitchen tap';
const HISTORY = 'PRIVATE-HISTORY-MARKER Added from the week plan';
const MARKERS = ['PRIVATE-NOTE-MARKER', 'PRIVATE-TITLE-MARKER', 'PRIVATE-HISTORY-MARKER'];
const RECOVERED = 'Saved. The existing task result was recovered.';
const NOT_CONFIRMED = 'The save outcome is not confirmed. Check its status before changing tasks again.';
const NOT_APPLIED = 'No save was applied. Your draft is kept for review.';
const GAP = 'Choose a valid dated time outside clock-change gaps or ambiguous times.';

const meta = (over = {}) => ({ note: '', paused: false, archived: false, completedOn: '', time: '', duration: 60, zone: 'America/New_York', recurrence: 'none', reminder: false, history: [], ...over });
const seed = (key, title = 'A task', extra = {}) => ({ key, title, reason: 'Due this week', origin: 'Personal', ...extra });

let db;
before(async () => { db = await createDb(); });
after(async () => { setBrowserZones(null); await db?.close(); });

/** A loaded My Week for alice in a fresh world. */
async function loaded(options = {}) {
  const w = await createWorld(db, options);
  const week = w.week();
  await week.load();
  assert.deepEqual([week.readiness, week.error, week.unknownOperation], ['ready', '', ''], 'the precondition: My Week loaded and writable');
  return { w, week };
}

const state = (week) => ({ error: week.error, locked: week.unknownOperation, canMutate: week.canMutate() });
const UNLOCKED = (error = '') => ({ error, locked: '', canMutate: true });

async function assertNoContentInLedger(w) {
  const text = await w.ledgerText();
  for (const marker of MARKERS) assert.ok(!text.includes(marker), `H3: ${marker} is not in operations.result`);
}

/** What a fresh load shows now, through the client: it must still be ready. */
async function reloaded(w) {
  const week = w.week();
  await week.load();
  assert.equal(week.readiness, 'ready', `the next load is still valid: ${week.error}`);
  return week;
}

// ---------------------------------------------------------------------------
// Ruling H8: a task write exists if and only if its operation is succeeded
// ---------------------------------------------------------------------------

test('H8: a commit whose response is lost after the function committed stays succeeded, and the client recovers it', async (t) => {
  const logged = muteConsoleError(t);
  let lose = true;
  const { w, week } = await loaded({
    onCommit: async (_args, call) => {
      const result = await call();
      if (lose) { lose = false; throw rpcError('', 'TypeError: fetch failed'); }
      return result;
    },
  });
  assert.equal(await week.save({ seed: seed('personal:1'), title: TITLE, date: '2026-10-20' }), false);
  const operationId = week.operationIds[0];
  assert.deepEqual(state(week), { error: NOT_CONFIRMED, locked: operationId, canMutate: false }, 'a 500 is unconfirmed (runtime.ts:144), and My Week locks on it');

  const row = await w.ledgerRow(operationId);
  assert.equal(row.status, 'succeeded', 'runOperation\'s failed settle was refused by the guard (H28)');
  assert.deepEqual((await w.tasks()).map((task) => task.title), [TITLE], 'and the task is there');
  const lines = loggedText(logged);
  assert.match(lines, new RegExp(`operations: could not settle ${operationId} as failed: HALO_OPERATION_SETTLED`));
  assert.ok(!lines.includes('PRIVATE'), 'nothing a person typed is logged');

  // The reconcile answers the truth, with a current snapshot the adapter takes.
  const answer = await (await w.reconcile(operationId)).json();
  assert.equal(answer.status, 'succeeded');
  assert.deepEqual(answer.snapshot.unresolvedOperations, [], 'never its own id');
  assert.ok(validActionSnapshot(answer.snapshot));
  assert.equal(await week.reconcile(), true);
  assert.deepEqual(state(week), UNLOCKED(RECOVERED));
  assert.deepEqual(week.actions.map((action) => action.title), [TITLE]);
  await assertNoContentInLedger(w);
});

test('H8: a commit that never reached the function leaves no task, so the reaped "No save was applied" is true; a late commit cannot land', async () => {
  const { w, week } = await loaded();
  // The server claimed the operation and its process died before the commit
  // function ran: a pending row past its window, and no task. The client lost
  // the response, so My Week is locked on it (ExpandedPreviewState.tsx:92).
  const command = body({ kind: 'add', date: '2026-10-20', seeds: [seed('personal:1', TITLE)] });
  const input = { ...command };
  delete input.operationId;
  await db.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, created_at)
     values ($1, $2, 'actions', 'actions.commit', 'pending', $3, now() - interval '10 minutes')`,
    [command.operationId, w.alice, requestHash(input)],
  );
  week.unknownOperation = command.operationId;
  week.error = NOT_CONFIRMED;

  assert.equal(await week.reconcile(), false);
  assert.deepEqual(state(week), UNLOCKED(NOT_APPLIED));
  assert.equal(week.reloads, 1, 'and it reloads My Week (:114)');
  assert.deepEqual(await w.tasks(), [], 'true: nothing was saved');
  assert.deepEqual((await w.ledgerRow(command.operationId)).result, { status: 'failed', reason: 'abandoned' });

  // A commit arriving after the reap is refused by the function itself (H29) and writes nothing.
  const late = await db.asService((tx) => tx.query(
    'select public.commit_household_actions($1, $2, 0, $3::jsonb)',
    [w.alice, command.operationId, JSON.stringify({ inserts: [{ id: crypto.randomUUID(), key: 'personal:1', title: 'x', reason: '', origin: '', date: '', state: 'saved', revision: 1, meta: null }] })],
  ), { commit: true }).then(() => null, (error) => error.message);
  assert.equal(late, 'HALO_OPERATION_NOT_PENDING');
  assert.deepEqual(await w.tasks(), []);
  // And replaying it through the route is the terminal 409, not a write.
  const replay = await expectEnvelope(await w.commit(command), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(replay.reason, 'abandoned');
  assert.deepEqual(await w.tasks(), []);
  assert.equal((await reloaded(w)).actions.length, 0);
});

test('T7: a commit whose response is discarded is answered by the reconcile with a current snapshot; a never-recorded id stays a 404 lock (F7)', async () => {
  let drop = true;
  const w = await createWorld(db);
  const week = w.week('alice', { lose: (operation) => operation === 'actions.commit' && drop && !(drop = false) });
  await week.load();
  assert.equal(await week.addActions([seed('personal:1', 'Water the beds')], '2026-10-21'), false);
  assert.deepEqual(state(week), { error: NOT_CONFIRMED, locked: week.operationIds[0], canMutate: false });
  // Meanwhile another device saves too: the reconcile shows the week as it is now.
  const other = w.week();
  await other.load();
  assert.equal(await other.addActions([seed('personal:2', 'Check the filter')], ''), true);
  assert.equal(await week.reconcile(), true);
  assert.deepEqual(state(week), UNLOCKED(RECOVERED));
  assert.deepEqual(week.actions.map((action) => action.key), ['personal:1', 'personal:2']);

  // A save whose request never arrived has no row: 404, which the client keeps
  // as a lock until a reload (finding F7, a client-side item).
  week.unknownOperation = crypto.randomUUID();
  await expectEnvelope(await w.reconcile(week.unknownOperation), { status: 404, code: 'not_found' });
  assert.equal(await week.reconcile(), false);
  assert.deepEqual([week.error, Boolean(week.unknownOperation)], ['Could not check this save. No new save was sent.', true]);
});

// ---------------------------------------------------------------------------
// The client's saves, end to end
// ---------------------------------------------------------------------------

test('client: add, add again, edit, a focus write with changes [], complete, reschedule and delete each save with no lock (T1, T2, T3)', async () => {
  const { w, week } = await loaded();
  // Add through the editor's save (ExpandedPreviewState.tsx:141-145): the title arrives untrimmed.
  assert.equal(await week.save({ seed: seed('personal:1'), title: `  ${TITLE} `, date: '2026-10-20' }), true);
  assert.deepEqual(state(week), UNLOCKED());
  const [task] = week.actions;
  assert.deepEqual([task.title, task.date, task.state, task.revision], [TITLE, '2026-10-20', 'saved', 1]);

  // A project bundle with metadata, then the same bundle again: deduplicated by key (T4).
  const steps = [seed('project:1:a', 'Gather the kit'), seed('project:1:b', 'Book the lab')];
  const options = { metadata: { 'project:1:a': meta({ note: NOTE }) }, initialStates: { 'project:1:b': 'waiting' } };
  assert.equal(await week.addActions(steps, '2026-10-22', options), true);
  const before = await w.tasks();
  assert.equal(await week.addActions(steps, '2026-10-29', { ...options, metadata: { 'project:1:a': meta({ note: 'overwritten?' }) } }), true, 'the re-add passes coverage');
  assert.deepEqual(await w.tasks(), before, 'a true no-op: no revision, date, meta or updated_at changed');

  // Edit through the editor's save (updateAction keeps the state).
  assert.equal(await week.save({ seed: task, title: 'Retest the tap', date: '2026-10-23', id: task.id, revision: 1 }), true);
  // The focus, the food topics and a season dismissal: revise [] with preferences only.
  assert.equal(await week.reviseActions([], { preferences: { 'week:focus': 'personal:1' } }), true);
  assert.equal(await week.reviseActions([], { preferences: { 'food-interests': ['water'], 'week:season-dismissals': ['fall-2026'] } }), true);
  assert.deepEqual([week.drafts['week:focus'], week.drafts['food-interests']], ['personal:1', ['water']], 'the screen holds them');
  // Complete (changeState: a signature and a history line, ExpandedPreviewState.tsx:151).
  assert.equal(await week.changeState(task.id, 'completed'), true);
  assert.equal(week.drafts['week:metas']['personal:1'].completedOn, '2026-10-19');
  // Reschedule a timed task with its meta and signature (MyWeekWorkspace.tsx:88).
  const kit = week.actions.find((action) => action.key === 'project:1:a');
  const kitMeta = week.drafts['week:metas']['project:1:a'];
  assert.equal(await week.reviseAction(kit.id, kit.revision, { title: kit.title, date: '2026-10-24', state: kit.state }, { metadata: { 'project:1:a': { ...kitMeta, time: '09:30', history: [...kitMeta.history, HISTORY] } }, expectedMetadata: { 'project:1:a': JSON.stringify(kitMeta) } }), true);
  // Delete.
  const lab = week.actions.find((action) => action.key === 'project:1:b');
  assert.equal(await week.deleteAction(lab.id, lab.revision), true);

  assert.deepEqual(state(week), UNLOCKED());
  assert.deepEqual(week.actions.map((action) => [action.key, action.state, action.date, action.revision]), [
    ['personal:1', 'completed', '2026-10-23', 3],
    ['project:1:a', 'saved', '2026-10-24', 2],
  ]);
  // The load agrees with what the receipts left on screen.
  const fresh = await reloaded(w);
  assert.deepEqual(fresh.actions, week.actions);
  assert.ok(sameValue(fresh.drafts['week:metas'], week.drafts['week:metas']));
  await assertNoContentInLedger(w);
});

test('T4: after jsonb reorders a meta\'s keys coverage still passes, and the next edit signed with the meta as returned succeeds', async () => {
  const { week } = await loaded();
  const sent = meta({ note: NOTE, history: [HISTORY], estimateSet: true, time: '08:00' });
  assert.equal(await week.addActions([seed('personal:1')], '2026-10-20', { metadata: { 'personal:1': sent }, expectedMetadata: { 'personal:1': 'null' } }), true);
  const returned = week.drafts['week:metas']['personal:1'];
  assert.notDeepEqual(Object.keys(returned), Object.keys(sent), 'the precondition: jsonb gave the keys back in another order');
  assert.ok(sameValue(returned, sent), 'with every value and the extra key intact');
  // The second edit signs with JSON.stringify of the meta as returned (A3): byte comparison would refuse it.
  const [task] = week.actions;
  assert.equal(await week.changeState(task.id, 'waiting'), true);
  assert.equal(await week.changeState(task.id, 'saved'), true);
  assert.deepEqual(state(week), UNLOCKED());
  assert.equal(week.actions[0].revision, 3);
});

test('T5: a move into a clock-change gap or an ambiguous hour, and a weekly task losing its date, are refused with the client\'s words and nothing is stored', async () => {
  const { w, week } = await loaded();
  assert.equal(await week.addActions([seed('timed:1', 'Spring check')], '2026-03-09', { metadata: { 'timed:1': meta({ time: '02:30' }) } }), true);
  assert.equal(await week.addActions([seed('timed:2', 'Fall check')], '2026-11-02', { metadata: { 'timed:2': meta({ time: '01:30' }) } }), true);
  assert.equal(await week.addActions([seed('weekly:1', 'Water the beds')], '2026-10-20', { metadata: { 'weekly:1': meta({ recurrence: 'weekly' }) } }), true);
  const stored = await w.tasks();
  const [spring, fall, weekly] = week.actions;
  // The Luna week-plan shape: a date-only revise, no metadata (LunaConversation.tsx:317).
  for (const [action, date, message] of [[spring, '2026-03-08', GAP], [fall, '2026-11-01', GAP], [weekly, '', 'Repeating tasks need an all-day date.']]) {
    assert.equal(await week.reviseAction(action.id, action.revision, { title: action.title, date, state: action.state }), false);
    assert.deepEqual(state(week), UNLOCKED(message), `${action.title}: the server's failed message, not a lock`);
  }
  // The practical-step shape: the edit with its meta and signature (ExpandedPreviewState.tsx:143).
  const metas = week.drafts['week:metas'];
  assert.equal(await week.reviseAction(spring.id, spring.revision, { title: spring.title, date: '2026-03-08', state: 'saved' }, { metadata: { 'timed:1': metas['timed:1'] }, expectedMetadata: { 'timed:1': JSON.stringify(metas['timed:1']) } }), false);
  assert.equal(week.error, GAP);
  assert.deepEqual(await w.tasks(), stored, 'nothing stored');
  assert.equal((await reloaded(w)).actions.length, 3);
});

test('client: a stale signature gives the server\'s failed message, not a lock (T6)', async () => {
  const { w, week } = await loaded();
  assert.equal(await week.addActions([seed('personal:1', 'One')], '2026-10-20', { metadata: { 'personal:1': meta() } }), true);
  // Another device edits the task's planning details.
  const other = await reloaded(w);
  const task = other.actions[0];
  assert.equal(await other.reviseActions([], { metadata: { 'personal:1': meta({ note: 'from the other device' }) }, expectedMetadata: { 'personal:1': JSON.stringify(other.drafts['week:metas']['personal:1']) } }), true);
  // This device, still showing the old details, completes it.
  assert.equal(await week.changeState(task.id, 'completed'), false);
  assert.deepEqual(state(week), UNLOCKED('This task\'s details changed since you opened them. Nothing was saved. Reload My Week to see the latest version.'));
  assert.equal((await w.tasks())[0].state, 'saved');
});

test('client: the weekly review saves past a row this server\'s ICU rejects and the browser accepts (H24, H25)', async (t) => {
  const logged = muteConsoleError(t);
  const w = await createWorld(db);
  // Three tasks, the third with a zone this Node does not know: stored directly,
  // as drift would leave it (the route would refuse to store it now).
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const rows = [
    [ids[0], 'week:1', 'Test the tap', '2026-10-20', meta({ time: '08:00', note: NOTE })],
    [ids[1], 'week:2', 'Change the filter', '2026-10-21', meta()],
    [ids[2], 'week:3', 'Walk by the creek', '2026-10-22', meta({ zone: 'Mars/Olympus_Mons' })],
  ];
  for (const [index, [id, key, title, date, value]] of rows.entries()) {
    await db.query(
      `insert into public.household_actions (id, profile_id, action_key, title, reason, origin, due_date, state, revision, meta, created_at)
       values ($1, $2, $3, $4, '', 'Personal', $5::date, 'saved', 1, $6::jsonb, now() + $7 * interval '1 second')`,
      [id, w.alice, key, title, date, JSON.stringify(value), index],
    );
  }
  setBrowserZones({ 'Mars/Olympus_Mons': 'America/Denver' });
  try {
    const week = w.week();
    await week.load();
    assert.deepEqual([week.readiness, week.unknownOperation], ['ready', ''], 'the browser loads it');
    assert.match(loggedText(logged), /invalid_meta [0-9a-f-]{36} zone/, 'the server logs the drift by id and code (H24, H31)');

    // Move the first task and set a focus and availability (WeekReviewPlanner.tsx:17):
    // the whole metas map and a signature for every task are sent.
    const decisions = captureReview(week.actions, week.drafts['week:metas']).map((decision) => (decision.id === ids[0] ? { ...decision, selected: true, choice: 'move', date: '2026-10-23' } : decision));
    assert.equal(await applyWeekPlan(week, { decisions, chosenFocus: 'week:2', capacity: 300, start: '2026-10-19', today: '2026-10-19' }), 'Week plan saved.');
    assert.deepEqual(state(week), UNLOCKED());
    assert.equal(week.actions[0].date, '2026-10-23');
    assert.deepEqual([week.drafts['week:focus'], week.drafts['week:availability']], ['week:2', { '2026-10-19': 300 }]);
    assert.equal((await w.tasks())[2].meta.zone, 'Mars/Olympus_Mons', 'the drifted row is carried, never hidden or rewritten');
  } finally {
    setBrowserZones(null);
  }
  await assertNoContentInLedger(w);
});

test('client: the frontend\'s 500-task week, saved through the weekly review with every meta and signature, fits under the cap and succeeds (H21)', async () => {
  const { week } = await loaded();
  const keys = Array.from({ length: 500 }, (_, i) => `home:${String(i).padStart(3, '0')}`);
  const metas = Object.fromEntries(keys.map((key, i) => [key, meta({ note: `${NOTE} ${'n'.repeat(400)}`, history: [HISTORY, `2026-10-0${(i % 9) + 1}: Added`], time: i % 2 ? '08:30' : '', estimateSet: true, duration: 45 })]));
  assert.equal(await week.addActions(keys.map((key, i) => seed(key, `Task ${i}`)), '2026-10-21', { metadata: metas }), true);
  assert.equal(week.actions.length, 500);

  let sentBytes = 0;
  const realMutate = week.mutate;
  week.mutate = (command) => { sentBytes = Buffer.byteLength(JSON.stringify({ ...command, operationId: crypto.randomUUID() })); return realMutate(command); };
  const decisions = captureReview(week.actions, week.drafts['week:metas']).map((decision, i) => (i < 10 ? { ...decision, selected: true, choice: 'move', date: '2026-10-24' } : decision));
  assert.equal(await applyWeekPlan(week, { decisions, chosenFocus: keys[0], capacity: null, start: '2026-10-19', today: '2026-10-19' }), 'Week plan saved.');
  assert.ok(sentBytes > 250_000 && sentBytes < 4_000_000, `the planner's body is ${sentBytes} bytes`);
  assert.deepEqual(state(week), UNLOCKED());
  assert.equal(week.actions.filter((action) => action.date === '2026-10-24').length, 10);
});

// ---------------------------------------------------------------------------
// H10: two commits from one base never store a pair neither validated
// ---------------------------------------------------------------------------

test('H10: two concurrent commits from one base never store a pair that fails the load check', async () => {
  // Task T is all-day on 2026-03-09. Device A moves it to 2026-03-08, valid
  // while it is all-day. Device B sets 02:30 on it, valid on 2026-03-09.
  // Together, 02:30 on 2026-03-08 does not exist. A is held after planning
  // until B has committed, so both plan from the same base version.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let holdFor = null;
  let reachedHold;
  const atHold = new Promise((resolve) => { reachedHold = resolve; });
  const w = await createWorld(db, {
    onCommit: async (args, call) => {
      if (args.p_operation_id === holdFor) { holdFor = null; reachedHold(); await held; }
      return call();
    },
  });
  const a = w.week();
  await a.load();
  assert.equal(await a.addActions([seed('personal:1', 'Spring check')], '2026-03-09', { metadata: { 'personal:1': meta() } }), true);
  const b = await reloaded(w);
  const [task] = a.actions;

  const moving = body({ kind: 'revise', changes: [{ id: task.id, revision: 1, patch: { title: task.title, date: '2026-03-08', state: 'saved' } }] });
  holdFor = moving.operationId;
  const first = w.commit(moving);
  await atHold;
  const signature = JSON.stringify(b.drafts['week:metas']['personal:1']);
  assert.equal(await b.reviseActions([], { metadata: { 'personal:1': meta({ time: '02:30' }) }, expectedMetadata: { 'personal:1': signature } }), true, 'B commits first');
  release();
  const answer = await (await first).json();
  assert.deepEqual(answer, { operationId: moving.operationId, status: 'failed', reason: 'invalid_result', message: GAP }, 'A is re-planned on the fresh read and refused');
  const stored = await w.tasks();
  assert.deepEqual([stored[0].date, stored[0].meta.time], ['2026-03-09', '02:30']);
  const load = await (await w.load()).json();
  assert.ok(validActionSnapshot(load), 'what is stored still passes the client\'s load check');
});

test('H32: an operation claimed before this save and settling between its commit and its answer is listed, and one reconcile brings it in', async () => {
  // The reviewer's interleaving (Task 4 review, N1). D2's save B is claimed
  // and held at its commit. D1's save A then commits; before A's answer goes
  // out, B is released, re-plans on the fresh version and settles. B is not in
  // A's snapshot (it committed after A). Read after A's commit, the list would
  // miss it too, and D1 would edit B's task with no lock. Read before the
  // claim (H32), B is listed.
  let releaseB;
  const gateB = new Promise((resolve) => { releaseB = resolve; });
  let reachedB;
  const atB = new Promise((resolve) => { reachedB = resolve; });
  let bId = null;
  let aId = null;
  let bDone = null;
  const w = await createWorld(db, {
    onCommit: async (args, call) => {
      if (args.p_operation_id === bId) { bId = null; reachedB(); await gateB; return call(); }
      if (args.p_operation_id === aId) {
        aId = null;
        const result = await call();
        releaseB();
        await bDone;
        return result;
      }
      return call();
    },
  });
  const d1 = w.week();
  await d1.load();
  assert.equal(await d1.addActions([seed('personal:x', 'Filter')], '2026-10-20'), true);
  const [x] = d1.actions;

  const b = body({ kind: 'revise', changes: [{ id: x.id, revision: 1, patch: { title: 'Filter, changed on D2', date: '2026-10-20', state: 'saved' } }] });
  bId = b.operationId;
  bDone = w.commit(b, { as: 'alice' }).then((response) => response.json());
  await atB;

  const realMutate = d1.mutate;
  d1.mutate = (command) => { const pending = realMutate(command); aId = d1.operationIds.at(-1); return pending; };
  assert.equal(await d1.addActions([seed('personal:a', 'Water the beds')], ''), true, 'A saves');
  assert.equal((await bDone).status, 'succeeded', 'B settled before A answered');
  assert.equal(d1.actions.find((action) => action.id === x.id).revision, 1, 'B is not in A\'s snapshot');
  assert.deepEqual(state(d1), { error: 'An earlier save needs checking before changing tasks.', locked: b.operationId, canMutate: false }, 'B is listed, so D1 locks');

  assert.equal(await d1.reconcile(), true);
  assert.deepEqual(state(d1), UNLOCKED(RECOVERED));
  const current = d1.actions.find((action) => action.id === x.id);
  assert.deepEqual([current.title, current.revision], ['Filter, changed on D2', 2], 'and the reconcile brings B in');
  assert.equal(await d1.reviseAction(x.id, 2, { title: 'Filter, again', date: '2026-10-20', state: 'saved' }), true, 'so the next edit is not stale');
});

// ---------------------------------------------------------------------------
// The receipt the client is given, everywhere it is given
// ---------------------------------------------------------------------------

test('T1, T2: the commit, its replay and its reconcile all carry the array, never the operation\'s own id, and pass the adapter', async () => {
  const w = await createWorld(db);
  const command = body({ kind: 'add', date: '', seeds: [seed('personal:1')] });
  const pending = body({ kind: 'revise', changes: [] });
  const input = { ...pending };
  delete input.operationId;
  const live = await (await w.commit(command)).json();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'actions', 'actions.commit', 'pending', $3)`, [pending.operationId, w.alice, requestHash(input)]);
  const replay = await (await w.commit(command)).json();
  const reconcile = await (await w.reconcile(command.operationId)).json();
  const adapter = (receipt) => createActionAdapter({ request: async () => receipt });
  for (const [label, receipt] of [['commit', live], ['replay', replay], ['reconcile', reconcile]]) {
    assert.equal(receipt.status, 'succeeded', label);
    assert.ok(Array.isArray(receipt.snapshot.unresolvedOperations), `${label}: T1`);
    assert.ok(!receipt.snapshot.unresolvedOperations.includes(command.operationId), `${label}: T2`);
    assert.equal((await adapter(receipt).reconcile(command.operationId)).status, 'succeeded', `${label}: the adapter takes it`);
    assert.ok(actionReceiptCoversCommand(command, { actions: [], metas: {} }, receipt), `${label}: and it still covers the command`);
  }
  assert.deepEqual(live.snapshot.unresolvedOperations, []);
  assert.deepEqual(replay.snapshot.unresolvedOperations, [pending.operationId], 'the replay and the reconcile carry the live list');
  assert.deepEqual(reconcile.snapshot.unresolvedOperations, [pending.operationId]);
  const withoutList = (snapshot) => ({ actions: snapshot.actions, metas: snapshot.metas, preferences: snapshot.preferences });
  assert.deepEqual(withoutList(live.snapshot), withoutList(reconcile.snapshot), 'the receipt and the reconcile agree on the snapshot');
  assert.deepEqual((await w.ledgerRow(command.operationId)).result.unresolvedOperations, [], 'the stored receipt holds [] (S14)');
  assert.deepEqual(reconcile.unresolvedOperations, [pending.operationId], 'S16: the live list overlays it in the answer');
  // S16, through the client: reconciling the settled save keeps the other,
  // genuinely pending save locked.
  const week = w.week();
  week.readiness = 'ready';
  week.unknownOperation = command.operationId;
  assert.equal(await week.reconcile(), true);
  assert.deepEqual([week.unknownOperation, week.error, week.canMutate()], [pending.operationId, 'Another earlier save needs checking.', false]);
});
