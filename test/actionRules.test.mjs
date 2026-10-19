/**
 * lib/actionRules.js: the client's action rules on the server, and the planner.
 *
 * Four parts, in order.
 *
 *  1. Self-checks. The transcription must reject what the client rejects, with
 *     the frontend's own cases (F: test/frontend-expanded-production.test.mjs,
 *     origin/codex/october15-review-refinement, lines 21-62). A transcription
 *     that said yes to everything would pass every other test here, so this
 *     part comes first.
 *  2. A differential test against the reference adapter. `applyReviewActionCommand`
 *     and `actionReceiptCoversCommand` are transcribed below, verbatim with types
 *     stripped (F: lib/frontend/production/action-service.ts:56-83, 103-115).
 *     Over a generated corpus the planner must agree with the reference on every
 *     command except the deviations the plan rules (H12, H13, H14, T5), each
 *     named, each asserted to occur, and each checked for its own direction.
 *     Every plan that succeeds must also pass the client's receipt coverage, and
 *     its `writes` applied to the snapshot must give exactly its `next`.
 *  3. The plan's acceptance cases by trap name (T3, T4, T5, T6) and ruling (H13,
 *     H14), plus refusals, writes and noop.
 *  4. Copy and purity: no U+2014 in any message, and no I/O or clock in the
 *     module.
 *
 * Pure: no database, no network, no clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  actionDraftError, actionMetadataError, emptyWeekMeta, eventInstant, revisedActionBatch, sameValue,
  validActionDate, validActionPreferences, validActionSnapshot, validReminderStates,
  parseActionCommand, planActionCommand, unstorableValue, ACTION_REFUSAL_MESSAGES, ACTION_REFUSAL_REASONS,
} from '../lib/actionRules.js';

const SOURCE = await readFile(new URL('../lib/actionRules.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// The reference adapter and the client's receipt coverage, transcribed.
// ---------------------------------------------------------------------------

// F: lib/frontend/production/action-service.ts:55-83
/** Pure review adapter. Production never uses its locally assigned revisions. */
function applyReviewActionCommand(snapshot, command, id) {
  const current = snapshot.actions;
  if (Object.entries(command.expectedMetadata ?? {}).some(([key, signature]) => JSON.stringify(snapshot.metas[key] ?? null) !== signature)) return null;
  let actions;
  if (command.kind === 'add') {
    if (!command.seeds.length || command.seeds.some(seed => actionDraftError(seed.title, command.date))) return null;
    if (Object.values(command.initialStates ?? {}).some(state => !['saved','waiting','completed'].includes(state))) return null;
    actions = command.seeds.reduce((rows, seed) => rows.some(row => row.key === seed.key) ? rows : [...rows, { ...seed, title: seed.title.trim(), id: id(), date: command.date, state: command.initialStates?.[seed.key] ?? 'saved', revision: 1 }], current);
  } else if (command.kind === 'revise') {
    const revised = revisedActionBatch(current, command.changes);
    if (!revised) return null;
    actions = revised;
  } else if (command.kind === 'delete') {
    if (!current.some(row => row.id === command.id && (row.revision ?? 1) === command.revision)) return null;
    actions = current.filter(row => row.id !== command.id);
  } else return null; // Account clearing has a separate exact scope review.
  const metas = { ...snapshot.metas };
  if (command.kind === 'delete') { const old = current.find(row => row.id === command.id); if (old) delete metas[old.key]; }
  for (const [key, meta] of Object.entries(command.metadata ?? {})) {
    if (meta === null) { delete metas[key]; continue; }
    const action = actions.find(row => row.key === key);
    if (!action || actionMetadataError(meta, action)) return null;
    // Repeated bundle/occurrence saves never overwrite existing planning details.
    if (command.kind === 'add' && current.some(row => row.key === key)) continue;
    metas[key] = structuredClone(meta);
  }
  return { actions, metas, preferences: { ...snapshot.preferences, ...command.preferences } };
}

// F: lib/frontend/production/action-service.ts:103-115
function actionReceiptCoversCommand(command,previous,receipt) {
 if(receipt.status!=='succeeded'||!validActionSnapshot(receipt.snapshot))return false;
 const next=receipt.snapshot;
 if(command.kind==='clear')return next.actions.length===0&&Object.keys(next.metas).length===0;
 if(command.kind==='delete'){const old=previous.actions.find(action=>action.id===command.id);return !!old&&!next.actions.some(action=>action.id===command.id)&&!Object.hasOwn(next.metas,old.key);}
 if(command.kind==='revise'&&!command.changes.every(change=>{const action=next.actions.find(item=>item.id===change.id);return action&&Number(action.revision)>change.revision&&action.title===change.patch.title.trim()&&action.date===change.patch.date&&action.state===change.patch.state;}))return false;
 if(command.kind==='add'&&!command.seeds.every(seed=>{const action=next.actions.find(item=>item.key===seed.key),old=previous.actions.find(item=>item.key===seed.key);return !!action&&(old?sameValue(action,old):action.title===seed.title.trim()&&action.date===command.date&&action.state===(command.initialStates?.[seed.key]??'saved'));}))return false;
 for(const [key,meta]of Object.entries(command.metadata??{})){
  if(command.kind==='add'&&previous.actions.some(action=>action.key===key))continue;
  if(meta===null?Object.hasOwn(next.metas,key):!sameValue(next.metas[key],meta))return false;
 }
 return Object.entries(command.preferences??{}).every(([key,value])=>sameValue(next.preferences?.[key],value));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OP = '0b6b1d2e-6f5c-4f7e-9c1a-2d3e4f5a6b7c';
const meta = (extra = {}) => ({ ...structuredClone(emptyWeekMeta), ...extra });
const ids = () => { let n = 0; return () => `new-${++n}`; };

/** Parse then plan, as the route will. */
function run(snapshot, command, newId = ids()) {
  const parsed = parseActionCommand({ operationId: OP, ...command });
  if (!parsed.ok) return { status: 400, fieldErrors: parsed.fieldErrors };
  return planActionCommand(snapshot, parsed.command, { newId });
}

function codes(result) {
  assert.equal(result.status, 400, `expected a 400, got ${JSON.stringify(result).slice(0, 300)}`);
  return result.fieldErrors.map((error) => error.code);
}

/** What the commit function will do with `writes`, in JavaScript (Task 1 does it in SQL). */
function applyWrites(snapshot, writes) {
  const deleted = new Set(writes.deletes);
  let actions = snapshot.actions.filter((action) => !deleted.has(action.id)).map((action) => ({ ...action }));
  const metas = new Map(Object.entries(snapshot.metas));
  for (const id of writes.deletes) metas.delete(snapshot.actions.find((action) => action.id === id).key);
  for (const update of writes.updates) {
    const row = actions.find((action) => action.id === update.id);
    assert.ok(row, 'an update names a stored row');
    assert.equal(row.revision, update.baseRevision, 'an update is guarded by the revision it was planned on');
    assert.equal(update.revision, update.baseRevision + 1);
    Object.assign(row, { title: update.title, date: update.date, state: update.state, revision: update.revision });
  }
  for (const { id, key, meta: value } of writes.metas) {
    const row = actions.find((action) => action.id === id);
    assert.ok(row && row.key === key, 'a meta write names a stored row by id and key');
    if (value === null) metas.delete(key); else metas.set(key, value);
  }
  for (const insert of writes.inserts) {
    const { meta: value, ...row } = insert;
    actions = [...actions, row];
    if (value !== null) metas.set(row.key, value);
  }
  return { actions, metas: Object.fromEntries(metas), preferences: { ...snapshot.preferences, ...writes.preferences } };
}

// A household with four tasks: timed, weekly, undated, and one whose stored
// meta is partial with an extra key and keys in another order (what jsonb
// hands back).
function household() {
  return {
    actions: [
      { id: 'id-1', key: 'k1', title: 'Keep my water report', reason: 'Review my own record', origin: 'Homeguard', date: '2026-10-13', state: 'saved', revision: 2 },
      { id: 'id-2', key: 'k2', title: 'Change the filter', reason: 'Routine', origin: 'Home', date: '2026-10-14', state: 'waiting', revision: 1 },
      { id: 'id-3', key: 'k3', title: 'Someday task', reason: 'Personal', origin: 'Personal', date: '', state: 'saved', revision: 3 },
      { id: 'id-4', key: 'k4', title: 'Late autumn walk', reason: 'Outdoors', origin: 'Explore', date: '2026-11-02', state: 'saved', revision: 1 },
    ],
    metas: {
      k1: meta({ time: '09:00' }),
      k2: meta({ recurrence: 'weekly' }),
      k4: { time: '01:30', zone: 'America/New_York', estimateSet: true, note: 'Bring water' },
    },
    preferences: { 'week:focus': 'k1' },
  };
}

// ---------------------------------------------------------------------------
// 1. Self-checks: the transcription rejects what the client rejects.
// ---------------------------------------------------------------------------

// The frontend's own fixture (F: test/frontend-expanded-production.test.mjs:14-16).
const action = { id: 'task1', key: 'owned:1', title: 'Keep my water report', date: '2026-10-13', state: 'saved', origin: 'Homeguard', reason: 'Review my own record', revision: 2 };
const snapshot = () => ({ actions: [structuredClone(action)], metas: { [action.key]: meta() }, unresolvedOperations: [] });

test('self-check: snapshots reject duplicate identities, bad revisions and unattached metadata (F: :21-24)', () => {
  assert.equal(validActionSnapshot(snapshot()), true);
  for (const value of [{ ...snapshot(), actions: [action, action] }, { ...snapshot(), actions: [{ ...action, revision: 0 }] }, { ...snapshot(), metas: { other: meta() } }, { ...snapshot(), unresolvedOperations: ['op', 'op'] }]) assert.equal(validActionSnapshot(value), false);
  // And the rest of the validator, field by field, so no clause is vacuous.
  for (const bad of [
    null, 'text', { metas: {} }, { actions: [], metas: [] }, { actions: [], metas: null },
    { actions: [], metas: {}, preferences: null }, { actions: [], metas: {}, unresolvedOperations: Array.from({ length: 101 }, (_, i) => `op${i}`) },
    { actions: [], metas: {}, unresolvedOperations: [''] }, { actions: [], metas: {}, unresolvedOperations: ['x'.repeat(201)] },
    { actions: [{ ...action, id: '' }], metas: {} }, { actions: [{ ...action, key: '' }], metas: {} },
    { actions: [action, { ...action, id: 'other' }], metas: {} }, { actions: [{ ...action, title: '  ' }], metas: {} },
    { actions: [{ ...action, title: 'x'.repeat(161) }], metas: {} }, { actions: [{ ...action, date: '2026-02-30' }], metas: {} },
    { actions: [{ ...action, state: 'cancelled' }], metas: {} }, { actions: [{ ...action, revision: undefined }], metas: {} },
    { actions: [{ ...action, revision: 1.5 }], metas: {} }, { actions: [{ ...action, reason: null }], metas: {} },
    { actions: [{ ...action, origin: 3 }], metas: {} }, { actions: [action], metas: { [action.key]: { duration: 10 } } },
    { actions: [action], metas: {}, reminderStates: { task1: { actionRevision: 0 } } }, { actions: [action], metas: {}, reminderStates: { other: {} } },
  ]) assert.equal(validActionSnapshot(bad), false, JSON.stringify(bad)?.slice(0, 120));
  assert.equal(validActionSnapshot({ actions: [], metas: {}, preferences: {}, unresolvedOperations: [] }), true);
  // A partial stored meta is valid: the validator merges emptyWeekMeta first.
  assert.equal(validActionSnapshot({ actions: [action], metas: { [action.key]: { note: 'x' } } }), true);
  assert.equal(validReminderStates({ task1: { actionRevision: 2, scheduleSignature: 's', status: 'scheduled', updatedAt: '2026-10-13T12:00:00Z', scheduledFor: '2026-10-14T12:00:00Z' } }, [action]), true);
});

test('self-check: metadata validates clock gaps, durations, recurrence and real dates (F: :25-29)', () => {
  for (const value of [{ ...meta(), duration: NaN }, { ...meta(), duration: 0 }, { ...meta(), zone: 'bad/zone' }, { ...meta(), recurrence: 'daily' }, { ...meta(), completedOn: '2026-02-30' }]) assert.ok(actionMetadataError(value, action));
  assert.ok(actionMetadataError({ ...meta(), time: '02:30' }, { ...action, date: '2026-03-08' }));
  assert.equal(actionMetadataError(meta(), action), null);
  // Every return of the validator, by its own sentence.
  const cases = [
    [{ ...meta(), paused: 'false' }, action, 'The task schedule is invalid.'],
    [{ ...meta(), estimateSet: 'yes' }, action, 'The task schedule is invalid.'],
    [{ ...meta(), note: 'x'.repeat(3001) }, action, 'The task details are invalid.'],
    [{ ...meta(), history: [1] }, action, 'The task details are invalid.'],
    [{ ...meta(), duration: 1441 }, action, 'Choose a duration between 15 and 1440 minutes.'],
    [{ ...meta(), zone: 'Not/AZone' }, action, 'Choose a valid timezone.'],
    [{ ...meta(), time: '01:30' }, { ...action, date: '2026-11-01' }, 'Choose a valid dated time outside clock-change gaps or ambiguous times.'],
    [{ ...meta(), time: '09:00' }, { ...action, date: '' }, 'Choose a valid dated time outside clock-change gaps or ambiguous times.'],
    [{ ...meta(), recurrence: 'weekly' }, { ...action, date: '' }, 'Repeating tasks need an all-day date.'],
    [{ ...meta(), recurrence: 'weekly', time: '09:00' }, action, 'Repeating tasks need an all-day date.'],
    [{ ...meta(), completedOn: '13/10/2026' }, action, 'The completion date is invalid.'],
  ];
  for (const [value, target, message] of cases) assert.equal(actionMetadataError(value, target), message);
  assert.equal(eventInstant('2026-10-13', '09:00', 'America/New_York'), '2026-10-13T13:00:00.000Z');
  assert.equal(eventInstant('2026-03-08', '02:30', 'America/New_York'), null);
  assert.equal(eventInstant('2026-11-01', '01:30', 'America/New_York'), null);
});

test('self-check: preferences reject malformed values and unrelated private namespaces (F: :31-37)', () => {
  const preferences = { 'week:focus': 'owned:1', 'week:availability': { '2026-10-12': 120 }, 'food-interests': ['gardens', 'water'], 'week:review-preferences': { enabled: true, weekday: 1, time: '17:00', zone: 'America/New_York' }, 'week:season-dismissals': ['autumn:2026'] };
  assert.equal(validActionPreferences(preferences), true);
  assert.equal(validActionSnapshot({ ...snapshot(), preferences }), true);
  for (const invalid of [{ 'food-interests': 'all' }, { 'food-interests': ['water', 'water'] }, { 'week:availability': { '2026-02-30': 60 } }, { 'week:review-preferences': { enabled: 'yes', weekday: 7, time: '25:00', zone: 'unknown' } }, { 'luna:production-request': { id: 'injected' } }]) assert.equal(validActionSnapshot({ ...snapshot(), preferences: invalid }), false);
  assert.ok(actionMetadataError({ ...meta(), paused: 'false' }, action));
  const review = { enabled: true, weekday: 1, time: '17:00', zone: 'America/New_York' };
  for (const zone of ['Not/AZone', '', 'x'.repeat(101), 5]) assert.equal(validActionPreferences({ 'week:review-preferences': { ...review, zone } }), false, String(zone));
  for (const invalid of [{ 'week:focus': 'x'.repeat(301) }, { 'week:focus': null }, { 'week:season-dismissals': [''] }, { 'week:availability': { '2026-10-12': 10081 } },
    { outdoorPlan: { key: 'k', place: 'p', period: 'am', watchRequested: true, forecastVersion: null, forecastIssuedAt: 'never', forecastExpiresAt: null } }, { outdoorPlan: { key: 'k', place: 'p', period: 'am', watchRequested: true, forecastVersion: null, forecastIssuedAt: null, forecastExpiresAt: null, extra: 1 } }])
    assert.equal(validActionPreferences(invalid), false, JSON.stringify(invalid));
  assert.equal(validActionPreferences({ outdoorPlan: { key: 'k', place: 'p', period: 'am', watchRequested: false, forecastVersion: null, forecastIssuedAt: null, forecastExpiresAt: null } }), true);
});

test('self-check: the transcribed reference applies atomically, keeps existing work on a repeated add (F: :38-50)', () => {
  const before = snapshot(), change = { kind: 'revise', changes: [{ id: action.id, revision: 2, patch: { title: 'Reviewed report', date: action.date, state: 'completed' } }], metadata: { [action.key]: { ...meta(), completedOn: '2026-10-13' } }, expectedMetadata: { [action.key]: JSON.stringify(meta()) } };
  const after = applyReviewActionCommand(before, change, () => 'new');
  assert.equal(after.actions[0].revision, 3); assert.equal(after.metas[action.key].completedOn, '2026-10-13'); assert.equal(before.actions[0].state, 'saved');
  assert.equal(applyReviewActionCommand(before, { ...change, expectedMetadata: { [action.key]: 'changed' } }, () => 'new'), null);
  assert.equal(applyReviewActionCommand(before, { ...change, metadata: { [action.key]: { ...meta(), duration: -1 } } }, () => 'new'), null);
  const repeated = applyReviewActionCommand(before, { kind: 'add', seeds: [action], date: '2027-01-01', metadata: { [action.key]: { ...meta(), note: 'replacement' } } }, () => 'new');
  assert.deepEqual(repeated.actions, before.actions); assert.deepEqual(repeated.metas, before.metas);
  const removed = applyReviewActionCommand(before, { kind: 'delete', id: action.id, revision: 2 }, () => 'new'); assert.deepEqual(removed.actions, []); assert.deepEqual(removed.metas, {});
  assert.equal(applyReviewActionCommand(before, { kind: 'delete', id: action.id, revision: 1 }, () => 'new'), null);
  // The server's planner gives the same three answers on the same inputs.
  const plan = run(before, change);
  assert.equal(plan.ok, true); assert.equal(plan.next.actions[0].revision, 3); assert.equal(plan.next.metas[action.key].completedOn, '2026-10-13');
  assert.equal(run(before, { ...change, expectedMetadata: { [action.key]: '"changed"' } }).reason, 'metadata_changed');
  assert.equal(run(before, { ...change, metadata: { [action.key]: { ...meta(), duration: -1 } } }).reason, 'invalid_result');
  const again = run(before, { kind: 'add', seeds: [action], date: '2027-01-01', metadata: { [action.key]: { ...meta(), note: 'replacement' } } });
  assert.deepEqual(again.next.actions, before.actions); assert.deepEqual(again.next.metas, before.metas); assert.equal(again.noop, true);
  assert.deepEqual(run(before, { kind: 'delete', id: action.id, revision: 2 }).next, { actions: [], metas: {}, preferences: {} });
  assert.equal(run(before, { kind: 'delete', id: action.id, revision: 1 }).reason, 'stale_revision');
});

test('self-check: success requires the actual action result, not a valid unrelated snapshot (F: :52-62)', () => {
  let value = { actions: [], metas: {} }; let identity = 0;
  for (const [key, date, time, duration] of [['design', '2026-10-13', '09:00', 45], ['assembly', '', '', 30], ['community', '2026-10-17', '10:00', 60]]) value = applyReviewActionCommand(value, { kind: 'add', seeds: [{ key, title: key, origin: 'Explore', reason: 'Explicit review example' }], date, metadata: { [key]: { ...meta(), time, duration, estimateSet: true } } }, () => String(++identity));
  assert.equal(value.actions.length, 3); assert.equal(value.metas.design.time, '09:00'); assert.equal(value.metas.assembly.estimateSet, true); assert.equal(value.metas.community.time, '10:00');
  const before = snapshot(), command = { kind: 'revise', changes: [{ id: action.id, revision: 2, patch: { title: 'Updated', date: action.date, state: 'saved' } }] };
  assert.equal(actionReceiptCoversCommand(command, before, { operationId: 'op', status: 'succeeded', snapshot: before }), false);
  const after = applyReviewActionCommand(before, command, () => 'new'); assert.equal(actionReceiptCoversCommand(command, before, { operationId: 'op', status: 'succeeded', snapshot: after }), true);
  assert.equal(actionReceiptCoversCommand(command, before, { operationId: 'op', status: 'unknown', snapshot: after }), false);
  // sameValue compares by value and key count, not by key order.
  assert.equal(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  for (const [a, b] of [[{ a: 1 }, { a: 1, b: undefined }], [[1], { 0: 1 }], [{ a: 0 }, { a: -0 }], [null, {}], [{ a: '1' }, { a: 1 }]]) assert.equal(sameValue(a, b), false);
});

test('self-check: dates and drafts', () => {
  for (const good of ['', '2026-10-13', '2024-02-29', '0001-01-01', '0000-01-01']) assert.equal(validActionDate(good), true, good);
  for (const bad of ['2026-02-30', '2025-02-29', '2026-13-01', '26-10-13', '2026-10-13T00:00', ' 2026-10-13']) assert.equal(validActionDate(bad), false, bad);
  assert.equal(actionDraftError('  ', ''), 'Enter a title between 1 and 160 characters.');
  assert.equal(actionDraftError(` ${'x'.repeat(160)} `, ''), null);
  assert.equal(actionDraftError('ok', '2026-02-30'), 'Choose a valid calendar date.');
  assert.deepEqual(revisedActionBatch([action], [{ id: 'task1', revision: 2, patch: { title: ' t ', date: '', state: 'waiting' } }]), [{ ...action, title: 't', date: '', state: 'waiting', revision: 3 }]);
  assert.equal(revisedActionBatch([action], [{ id: 'task1', revision: 1, patch: { title: 't', date: '', state: 'saved' } }]), null);
  assert.equal(Object.isFrozen(emptyWeekMeta) && Object.isFrozen(emptyWeekMeta.history), true);
});

// ---------------------------------------------------------------------------
// 2. Differential test against the reference adapter.
// ---------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const BAD_TEXT = ['nul\u0000here', 'lone\ud800surrogate'];
function generate(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (p) => random() < p;
  const base = chance(0.15) ? { actions: [], metas: {}, preferences: {} } : household();
  const keys = ['k1', 'k2', 'k3', 'k4', 'new1', 'new2', 'new3'];
  const titles = [' Trim me ', 'Plain title', 'Plain title', '', 'x'.repeat(161), chance(0.05) ? pick(BAD_TEXT) : 'Another'];
  const dates = ['', '2026-10-20', '2026-10-20', '2026-03-08', '2026-11-01', '2026-02-30', chance(0.1) ? '0000-01-01' : '2026-10-21'];
  const metaPool = () => pick([
    null, meta(), meta({ time: '09:00' }), meta({ time: '02:30' }), meta({ time: '01:30' }), meta({ recurrence: 'weekly' }),
    meta({ recurrence: 'weekly', time: '09:00' }), meta({ duration: 10 }), meta({ completedOn: '2026-10-13' }),
    meta({ estimateSet: true, duration: 30 }), { note: 'partial' }, { recurrence: 'none', zone: 'America/New_York', time: '', history: [], reminder: true, duration: 45, note: '', paused: false, archived: false, completedOn: '' },
    chance(0.1) ? meta({ completedOn: '0000-01-01' }) : meta(), chance(0.1) ? meta({ note: pick(BAD_TEXT) }) : meta(), chance(0.1) ? meta({ extra: Infinity }) : meta({ extra: 7 }),
  ]);
  const signature = (key) => {
    const stored = Object.hasOwn(base.metas, key) ? base.metas[key] : null;
    return pick([
      JSON.stringify(stored), JSON.stringify(stored), 'null', '{"note":"old"}', '{',
      stored ? JSON.stringify(Object.fromEntries(Object.entries(stored).reverse())) : 'null',
    ]);
  };
  const command = {};
  const kind = chance(0.03) ? 'clear' : pick(['add', 'add', 'revise', 'revise', 'delete']);
  command.kind = kind;
  if (kind === 'add') {
    command.seeds = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
      const seed = { key: pick(keys), title: pick(titles), reason: chance(0.05) ? pick(BAD_TEXT) : 'Because', origin: 'Personal' };
      return chance(0.2) ? { ...seed, date: '2027-01-01', note: 'seed extra', id: 'caller-id', state: 'completed', revision: 9 } : seed;
    });
    command.date = pick(dates);
  } else if (kind === 'revise') {
    const pool = [...base.actions.map((row) => row.id), 'id-missing'];
    command.changes = Array.from({ length: Math.floor(random() * 4) }, () => {
      const id = pick(pool);
      const row = base.actions.find((a) => a.id === id);
      const revision = row ? row.revision + (chance(0.15) ? 1 : 0) : 1;
      return { id, revision, patch: { title: chance(0.7) && row ? row.title : pick(titles), date: chance(0.5) && row ? row.date : pick(dates), state: chance(0.05) ? 'cancelled' : pick(['saved', 'waiting', 'completed']) } };
    });
  } else if (kind === 'delete') {
    const row = chance(0.8) ? pick(base.actions.length ? base.actions : [{ id: 'id-missing', revision: 1 }]) : { id: 'id-missing', revision: 1 };
    command.id = row.id;
    command.revision = row.revision + (chance(0.15) ? 1 : 0);
  } else command.fingerprint = 'f';
  if (chance(0.6)) command.metadata = Object.fromEntries(Array.from({ length: 1 + Math.floor(random() * 2) }, () => [pick([...keys, 'nokey']), metaPool()]));
  if (chance(0.5)) command.expectedMetadata = Object.fromEntries(Array.from({ length: 1 + Math.floor(random() * 3) }, () => { const key = pick(keys); return [key, signature(key)]; }));
  if (chance(0.3)) command.preferences = pick([{ 'week:focus': 'k2' }, { 'food-interests': ['water'] }, { 'week:focus': 'k1' }, { 'food-interests': 'all' }, { 'luna:request': 1 }]);
  if (chance(0.25)) command.initialStates = pick([{ new1: 'completed' }, { new2: 'waiting' }, { new1: 'cancelled' }]);
  return { base, command };
}

/** Which named deviations apply to this case, decided from the inputs alone. */
function deviations(base, command, reference) {
  const found = new Set();
  const stored = [
    ...(command.seeds ?? []).flatMap((seed) => [seed.key, seed.title, seed.reason, seed.origin]),
    ...(command.changes ?? []).map((change) => change.patch.title),
    ...Object.entries(command.metadata ?? {}), ...Object.values(command.preferences ?? {}),
  ];
  const years = [command.date, ...(command.changes ?? []).map((change) => change.patch.date), ...Object.values(command.metadata ?? {}).map((value) => value?.completedOn)];
  if (unstorableValue(stored) || years.some((value) => typeof value === 'string' && value.startsWith('0000-'))) found.add('H13 unstorable value is a 400');
  if (command.kind === 'add' && new Set(command.seeds.map((seed) => seed.key)).size !== command.seeds.length) found.add('H14 duplicate seed keys are a 400');
  if (command.kind === 'add' && command.seeds.some((seed) => Object.keys(seed).length > 4)) found.add('H13 seed extras are not stored');
  if (command.kind === 'add' && Object.keys(command.metadata ?? {}).some((key) => base.actions.some((row) => row.key === key))) found.add('H14 add ignores metadata of a stored key');
  if (command.kind === 'delete' && !base.actions.some((row) => row.id === command.id)) found.add('H14 delete of an absent id succeeds');
  if (command.kind !== 'add' && Object.values(command.initialStates ?? {}).some((state) => !['saved', 'waiting', 'completed'].includes(state))) found.add('H14 initialStates is checked on every kind');
  if (Object.entries(command.expectedMetadata ?? {}).some(([key, signature]) => {
    const current = base.metas[key] ?? null;
    if (JSON.stringify(current) === signature) return false;
    try { return sameValue(JSON.parse(signature), current); } catch { return false; }
  })) found.add('H12 signatures compare by value');
  if (reference && !validActionSnapshot(reference)) found.add('T5 the whole result is validated');
  return found;
}

const EIGHT = ['id', 'key', 'title', 'reason', 'origin', 'date', 'state', 'revision'];
const project = (row) => Object.fromEntries(EIGHT.map((key) => [key, row[key]]));

test('differential: the planner agrees with the reference adapter except by named ruling', () => {
  const random = rng(20261018);
  const seen = new Map();
  const tally = { agreeRefused: 0, agreeApplied: 0, cases: 0 };
  for (let i = 0; i < 4000; i++) {
    const { base, command } = generate(random);
    const reference = applyReviewActionCommand(base, command, ids());
    const ours = run(base, command, ids());
    const named = deviations(base, command, reference);
    for (const name of named) seen.set(name, (seen.get(name) ?? 0) + 1);
    const label = `case ${i}: ${JSON.stringify(command).slice(0, 400)}`;
    tally.cases++;

    // Directional rules for the deviations that decide the outcome.
    if (named.has('H13 unstorable value is a 400') || named.has('H14 duplicate seed keys are a 400') || named.has('H14 initialStates is checked on every kind')) {
      assert.equal(ours.status, 400, label);
      continue;
    }
    if (ours.status === 400) {
      // Every other 400 is something the reference refuses too, or a result the
      // client could never load.
      assert.ok(reference === null || named.has('T5 the whole result is validated'), label);
      if (reference === null) tally.agreeRefused++;
      continue;
    }
    if (!ours.ok) {
      assert.ok(Object.values(ACTION_REFUSAL_REASONS).includes(ours.reason), label);
      assert.equal(typeof ours.message, 'string', label);
      assert.ok(reference === null || named.has('T5 the whole result is validated'), `${label} refused as ${ours.reason}, but the reference applied it`);
      if (reference === null) tally.agreeRefused++;
      continue;
    }
    // The planner applied it: its result is one the client loads, covers the
    // command, and is exactly what its writes produce.
    assert.equal(validActionSnapshot(ours.next), true, label);
    assert.ok(ours.next.actions.every((row) => sameValue(Object.keys(row).sort(), [...EIGHT].sort())), `${label}: an action has exactly eight keys`);
    const previous = named.has('H14 delete of an absent id succeeds')
      ? { ...base, actions: [...base.actions, { id: command.id, key: 'deleted-elsewhere', title: 'Gone', reason: '', origin: '', date: '', state: 'saved', revision: command.revision }] }
      : base;
    assert.equal(actionReceiptCoversCommand(command, previous, { operationId: OP, status: 'succeeded', snapshot: { ...ours.next, unresolvedOperations: [] } }), true, `${label}: coverage`);
    assert.ok(sameValue(applyWrites(base, ours.writes), ours.next), `${label}: writes reproduce next`);
    const unchanged = sameValue(ours.next, { ...base, preferences: base.preferences ?? {} });
    assert.equal(ours.noop, unchanged, `${label}: noop means nothing changes`);
    if (reference === null) {
      assert.ok(named.has('H14 delete of an absent id succeeds') || named.has('H14 add ignores metadata of a stored key') || named.has('H12 signatures compare by value'), `${label}: applied, but the reference refused`);
      continue;
    }
    // Both applied: the same result, but for seed extras (the reference keeps
    // them on the new action) and a stored key's metadata on add (the reference
    // deletes it on null).
    assert.ok(validActionSnapshot(reference), label);
    assert.deepEqual(ours.next.actions, named.has('H13 seed extras are not stored') ? reference.actions.map(project) : reference.actions, label);
    if (named.has('H14 add ignores metadata of a stored key')) {
      for (const key of Object.keys(command.metadata)) if (base.actions.some((row) => row.key === key)) assert.ok(sameValue(ours.next.metas[key], base.metas[key]), label);
    } else assert.ok(sameValue(ours.next.metas, reference.metas), label);
    assert.ok(sameValue(ours.next.preferences, reference.preferences), label);
    tally.agreeApplied++;
  }
  // Every named deviation was actually exercised, and so was plain agreement.
  for (const name of ['H12 signatures compare by value', 'H13 unstorable value is a 400', 'H13 seed extras are not stored', 'H14 duplicate seed keys are a 400',
    'H14 add ignores metadata of a stored key', 'H14 delete of an absent id succeeds', 'H14 initialStates is checked on every kind', 'T5 the whole result is validated'])
    assert.ok((seen.get(name) ?? 0) > 0, `the corpus never exercised: ${name}`);
  assert.ok(tally.agreeApplied > 300 && tally.agreeRefused > 300, JSON.stringify(tally));
});

// ---------------------------------------------------------------------------
// 3. Acceptance cases.
// ---------------------------------------------------------------------------

test('T3: revise with changes [] and only preferences plans, and writes only the preferences', () => {
  const base = household();
  const preferences = { 'week:focus': 'k2', 'food-interests': ['fish', 'water'], 'week:season-dismissals': ['autumn:2026'], 'week:review-preferences': { enabled: true, weekday: 0, time: '18:00', zone: 'America/New_York' } };
  const plan = run(base, { kind: 'revise', changes: [], preferences });
  assert.equal(plan.ok, true);
  assert.equal(plan.noop, false);
  assert.deepEqual(plan.writes, { inserts: [], updates: [], metas: [], deletes: [], preferences });
  assert.deepEqual(plan.next.actions, base.actions);
  for (const [key, value] of Object.entries(preferences)) assert.ok(sameValue(plan.next.preferences[key], value));
  // The review-prompt write rides on an add (F: WeekPlanningRail.tsx:31).
  assert.equal(run(base, { kind: 'add', seeds: [{ key: 'k1', title: 'x', reason: '', origin: '' }], date: '', preferences: { 'week:review-preferences': preferences['week:review-preferences'] } }).ok, true);
  // Nothing at all is a no-op; a value-equal preference writes nothing.
  assert.equal(run(base, { kind: 'revise', changes: [] }).noop, true);
  assert.equal(run(base, { kind: 'revise', changes: [], preferences: { 'week:focus': 'k1' } }).noop, true);
});

test('T4: an add of an existing key returns the identical action and writes nothing', () => {
  const base = household();
  const plan = run(base, { kind: 'add', seeds: [{ key: 'k1', title: 'Different title', reason: 'r', origin: 'o' }], date: '2027-01-01', initialStates: { k1: 'completed' }, metadata: { k1: meta({ note: 'replacement' }), k2: null } });
  assert.equal(plan.ok, true);
  assert.equal(plan.noop, true);
  assert.equal(plan.next.actions[0], base.actions[0], 'the stored action object itself, revision included');
  assert.ok(sameValue(plan.next.metas, base.metas), 'metadata of stored keys is ignored, null included');
});

test('T4: a sent meta is echoed exactly, extra keys and key order included; titles are trimmed', () => {
  const base = household();
  const sent = { history: ['2026-10-13: Added.'], reminder: true, recurrence: 'none', zone: 'America/Chicago', duration: 30, estimateSet: true, time: '07:15', completedOn: '', archived: false, paused: false, note: 'My own words' };
  const plan = run(base, { kind: 'add', seeds: [{ key: 'personal:1', title: '  Walk the dog  ', reason: 'A task you deliberately added in My Week.', origin: 'Personal' }], date: '2026-10-20', metadata: { 'personal:1': sent }, expectedMetadata: { 'personal:1': 'null' }, initialStates: { 'personal:1': 'waiting' } });
  assert.equal(plan.ok, true);
  const [insert] = plan.writes.inserts;
  assert.deepEqual(insert, { id: 'new-1', key: 'personal:1', title: 'Walk the dog', reason: 'A task you deliberately added in My Week.', origin: 'Personal', date: '2026-10-20', state: 'waiting', revision: 1, meta: sent });
  assert.deepEqual(Object.keys(plan.next.metas['personal:1']), Object.keys(sent));
  assert.ok(sameValue(plan.next.metas['personal:1'], sent));
  // A revise title is trimmed the same way.
  const revise = run(base, { kind: 'revise', changes: [{ id: 'id-3', revision: 3, patch: { title: '  Someday  ', date: '', state: 'saved' } }] });
  assert.equal(revise.writes.updates[0].title, 'Someday');
});

test('T4, H13: seed extras and seed.date are ignored; command.date is used', () => {
  const stored = household().actions[0];
  const plan = run({ actions: [], metas: {}, preferences: {} }, { kind: 'add', seeds: [{ ...stored, key: 'fresh', note: 'extra', date: '2099-01-01' }], date: '' });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.next.actions, [{ id: 'new-1', key: 'fresh', title: stored.title, reason: stored.reason, origin: stored.origin, date: '', state: 'saved', revision: 1 }]);
});

test('T5: a date-only revise that leaves a time in a clock-change gap, or a repeating task undated, is refused', () => {
  const gap = 'Choose a valid dated time outside clock-change gaps or ambiguous times.';
  const repeat = 'Repeating tasks need an all-day date.';
  const base = household();
  base.metas.k1 = meta({ time: '02:30', zone: 'America/New_York' });
  base.metas.k4 = meta({ time: '01:30', zone: 'America/New_York' });
  const a1 = base.actions[0], a2 = base.actions[1], a4 = base.actions[3];
  // Luna's week plan: patches with state 'saved' and no metadata (F: luna-week-plan.ts:18).
  const luna = (row, date) => ({ kind: 'revise', changes: [{ id: row.id, revision: row.revision, patch: { title: row.title, date, state: 'saved' } }] });
  // The practical-step sheet: title and date, the current state, no options (F: ExpandedPreviewState.tsx:139-143).
  const step = (row, date) => ({ kind: 'revise', changes: [{ id: row.id, revision: row.revision, patch: { title: row.title, date, state: row.state } }] });
  for (const shape of [luna, step]) {
    for (const [row, date, message] of [[a1, '2026-03-08', gap], [a4, '2026-11-01', gap], [a2, '', repeat]]) {
      const command = shape(row, date);
      // The reference would have stored it; the client could then never load it.
      const reference = applyReviewActionCommand(base, command, ids());
      assert.ok(reference && !validActionSnapshot(reference), 'the reference accepts what the load rejects');
      const plan = run(base, command);
      assert.deepEqual(plan, { ok: false, reason: 'invalid_result', message });
    }
    assert.equal(run(base, shape(a1, '2026-03-09')).ok, true, 'the same move to an ordinary day is fine');
  }
});

test('T6: every signature is checked first, by value; one mismatch refuses everything', () => {
  const base = household();
  const all = Object.fromEntries(base.actions.map((row) => [row.key, JSON.stringify(base.metas[row.key] ?? null)]));
  const changes = [{ id: 'id-1', revision: 2, patch: { title: 'Moved', date: '2026-10-15', state: 'saved' } }];
  const metadata = { k1: meta({ time: '10:00' }) };
  const preferences = { 'week:focus': 'k2', 'week:availability': { '2026-10-12': 120 } };
  assert.equal(run(base, { kind: 'revise', changes, metadata, expectedMetadata: all, preferences }).ok, true);
  for (const key of Object.keys(all)) {
    const stale = { ...all, [key]: JSON.stringify(meta({ note: 'from another device' })) };
    const refused = run(base, { kind: 'revise', changes, metadata, expectedMetadata: stale, preferences });
    assert.deepEqual(refused, { ok: false, reason: 'metadata_changed', message: ACTION_REFUSAL_MESSAGES.metadata_changed }, key);
    assert.equal(refused.writes, undefined, 'a refusal carries no writes, preferences included');
  }
  // 'null' for a key with no meta passes; a key with a meta fails on 'null'.
  assert.equal(all.k3, 'null');
  assert.equal(run(base, { kind: 'revise', changes: [], expectedMetadata: { k3: 'null', 'personal:new': 'null' } }).ok, true);
  assert.equal(run(base, { kind: 'revise', changes: [], expectedMetadata: { k1: 'null' } }).reason, 'metadata_changed');
  // The stored meta's keys in another order (what jsonb returns) still match.
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(base.metas.k4).reverse()));
  assert.notEqual(reordered, JSON.stringify(base.metas.k4));
  assert.equal(run(base, { kind: 'revise', changes: [], expectedMetadata: { k4: reordered } }).ok, true);
  // An unparseable or non-text signature is a 400.
  assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], expectedMetadata: { k1: '{' } })), ['invalid_signature']);
  assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], expectedMetadata: { k1: { note: '' } } })), ['invalid_signature']);
});

test('H13: values storage cannot hold are 400s, wherever they are stored', () => {
  const base = household();
  const seed = (extra) => ({ kind: 'add', seeds: [{ key: 'n', title: 'T', reason: 'r', origin: 'o', ...extra }], date: '' });
  for (const bad of BAD_TEXT) {
    assert.deepEqual(codes(run(base, seed({ title: bad }))), ['unstorable_text']);
    assert.deepEqual(codes(run(base, seed({ reason: bad }))), ['unstorable_text']);
    assert.deepEqual(codes(run(base, seed({ key: bad }))), ['unstorable_text']);
    assert.deepEqual(codes(run(base, { kind: 'revise', changes: [{ id: 'id-3', revision: 3, patch: { title: bad, date: '', state: 'saved' } }] })), ['unstorable_text']);
    assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], metadata: { k3: meta({ history: [bad] }) } })), ['unstorable_text']);
    assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], metadata: { k3: { ...meta(), [bad]: 1 } } })), ['unstorable_text']);
    assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], preferences: { 'week:focus': bad } })), ['unstorable_text']);
  }
  // A paired surrogate (an emoji) is ordinary text.
  assert.equal(run(base, seed({ title: 'Water the garden 🌱' })).ok, true);
  // JSON's 1e400 parses to Infinity, which supabase-js would send as null.
  const body = JSON.parse(`{"operationId":"${OP}","kind":"revise","changes":[],"metadata":{"k3":{"note":"","paused":false,"archived":false,"completedOn":"","time":"","duration":60,"zone":"America/New_York","recurrence":"none","reminder":false,"history":[],"weight":1e400}}}`);
  assert.equal(body.metadata.k3.weight, Infinity);
  assert.deepEqual(parseActionCommand(body).fieldErrors.map((error) => error.code), ['unstorable_number']);
  // Year 0000 passes the client's date rule and no Postgres date holds it.
  assert.equal(validActionDate('0000-01-01'), true);
  assert.deepEqual(codes(run(base, { ...seed({}), date: '0000-01-01' })), ['unstorable_date']);
  assert.deepEqual(codes(run(base, { kind: 'revise', changes: [{ id: 'id-3', revision: 3, patch: { title: 'T', date: '0000-12-31', state: 'saved' } }] })), ['unstorable_date']);
  assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], metadata: { k3: meta({ completedOn: '0000-01-01' }) } })), ['unstorable_date']);
  assert.equal(run(base, { ...seed({}), date: '0001-01-01' }).ok, true);
});

test('H14: clear, duplicate seed keys, initialStates on revise, and a delete of an absent id', () => {
  const base = household();
  assert.deepEqual(codes(run(base, { kind: 'clear', fingerprint: 'abc' })), ['unsupported_kind']);
  assert.deepEqual(codes(run(base, { kind: 'add', seeds: [{ key: 'a', title: 'one', reason: '', origin: '' }, { key: 'a', title: 'two', reason: '', origin: '' }], date: '' })), ['duplicate_seed_key']);
  // The edit-task path sends initialStates on revise (finding F6): accepted, not applied.
  const edit = run(base, { kind: 'revise', changes: [{ id: 'id-1', revision: 2, patch: { title: 'Edited', date: '2026-10-13', state: 'saved' } }], initialStates: { k1: 'completed' } });
  assert.equal(edit.ok, true);
  assert.equal(edit.next.actions[0].state, 'saved');
  assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], initialStates: { k1: 'cancelled' } })), ['invalid_initial_states']);
  // A delete of an id with no row succeeds with nothing written, and an id that
  // never existed answers exactly as one that is another household's.
  const never = run(base, { kind: 'delete', id: 'never-existed', revision: 1 });
  const foreign = run(base, { kind: 'delete', id: '7d0b6a3c-1f2e-4d5c-8b9a-0e1f2a3b4c5d', revision: 4 });
  assert.equal(never.ok, true); assert.equal(never.noop, true);
  assert.deepEqual(never, foreign);
  assert.deepEqual(never.writes, { inserts: [], updates: [], metas: [], deletes: [], preferences: {} });
});

test('refusals: stale revisions name the current revisions; an unknown task or key is unknown_action', () => {
  const base = household();
  const stale = run(base, { kind: 'revise', changes: [{ id: 'id-3', revision: 3, patch: { title: 'x', date: '', state: 'saved' } }, { id: 'id-1', revision: 1, patch: { title: 'x', date: '', state: 'saved' } }] });
  assert.deepEqual(stale, { ok: false, reason: 'stale_revision', message: ACTION_REFUSAL_MESSAGES.stale_revision, revisions: [{ id: 'id-3', revision: 3 }, { id: 'id-1', revision: 2 }] });
  assert.deepEqual(run(base, { kind: 'delete', id: 'id-1', revision: 1 }), { ok: false, reason: 'stale_revision', message: ACTION_REFUSAL_MESSAGES.stale_revision, revisions: [{ id: 'id-1', revision: 2 }] });
  assert.equal(run(base, { kind: 'revise', changes: [{ id: 'gone', revision: 1, patch: { title: 'x', date: '', state: 'saved' } }] }).reason, 'unknown_action');
  assert.equal(run(base, { kind: 'revise', changes: [], metadata: { nokey: meta() } }).reason, 'unknown_action');
  // A meta for the action being deleted in the same command has nowhere to go.
  assert.equal(run(base, { kind: 'delete', id: 'id-1', revision: 2, metadata: { k1: meta() } }).reason, 'unknown_action');
  // A sent meta is validated unmerged against its resulting action, as the reference does.
  assert.deepEqual(run(base, { kind: 'revise', changes: [], metadata: { k3: { note: 'partial' } } }), { ok: false, reason: 'invalid_result', message: 'The task schedule is invalid.' });
});

test('refusals: the answer to a revise does not depend on the order of its changes', () => {
  const base = household();
  const missing = { id: 'gone', revision: 1, patch: { title: 'x', date: '', state: 'saved' } };
  const stale = { id: 'id-1', revision: 1, patch: { title: 'x', date: '', state: 'saved' } };
  const fine = { id: 'id-3', revision: 3, patch: { title: 'x', date: '', state: 'saved' } };
  // Any missing task wins: unknown_action, whichever comes first.
  for (const changes of [[missing, stale], [stale, missing], [fine, stale, missing]]) {
    assert.deepEqual(run(base, { kind: 'revise', changes }), { ok: false, reason: 'unknown_action', message: ACTION_REFUSAL_MESSAGES.unknown_action });
  }
  // Otherwise stale_revision, naming every task's current revision, in change order.
  assert.deepEqual(run(base, { kind: 'revise', changes: [stale, fine] }).revisions, [{ id: 'id-1', revision: 2 }, { id: 'id-3', revision: 3 }]);
  assert.deepEqual(run(base, { kind: 'revise', changes: [fine, stale] }).revisions, [{ id: 'id-3', revision: 3 }, { id: 'id-1', revision: 2 }]);
});

test('H25: a failure already in the stored snapshot blocks no unrelated save; one the command adds is refused', () => {
  const gap = 'Choose a valid dated time outside clock-change gaps or ambiguous times.';
  const drifted = 'Choose a valid timezone.';
  // Task k3 holds a zone this Node's ICU rejects (H24 drift); the browser loaded it.
  const base = household();
  base.metas.k1 = meta({ time: '02:30' });
  base.metas.k3 = meta({ zone: 'Mars/Olympus_Mons' });
  assert.equal(validActionSnapshot(base), false);
  assert.equal(actionMetadataError({ ...emptyWeekMeta, ...base.metas.k3 }, base.actions[2]), drifted);
  const unrelated = {
    'edit a different task': { kind: 'revise', changes: [{ id: 'id-2', revision: 1, patch: { title: 'Change the filter today', date: '2026-10-14', state: 'completed' } }] },
    'a focus write with changes []': { kind: 'revise', changes: [], preferences: { 'week:focus': 'k2' } },
    'a new task': { kind: 'add', seeds: [{ key: 'personal:new', title: 'New task', reason: 'Mine', origin: 'Personal' }], date: '2026-10-20', metadata: { 'personal:new': meta() } },
    'delete the bad row': { kind: 'delete', id: 'id-3', revision: 3 },
    'fix the bad row': { kind: 'revise', changes: [], metadata: { k3: meta({ zone: 'America/Chicago' }) }, expectedMetadata: { k3: JSON.stringify(base.metas.k3) } },
  };
  for (const [name, command] of Object.entries(unrelated)) {
    const plan = run(base, command);
    assert.equal(plan.ok, true, `${name}: ${JSON.stringify(plan)}`);
    if (name !== 'delete the bad row' && name !== 'fix the bad row') {
      // The stored row is carried, not hidden (H24), and the H25 path ran.
      assert.ok(sameValue(plan.next.metas.k3, base.metas.k3), name);
      assert.equal(validActionSnapshot(plan.next), false, name);
    }
    assert.ok(sameValue(applyWrites(base, plan.writes), plan.next), name);
  }
  assert.equal(validActionSnapshot(run(base, unrelated['fix the bad row']).next), true, 'fixing the one drifted row leaves a snapshot the server loads');
  // A command that adds its own failure is refused with its own sentence, not the drifted row's.
  assert.deepEqual(run(base, { kind: 'revise', changes: [{ id: 'id-1', revision: 2, patch: { title: 'Keep my water report', date: '2026-03-08', state: 'saved' } }] }),
    { ok: false, reason: 'invalid_result', message: gap });
  // Touching the drifted row and leaving it failing is the command's failure.
  assert.deepEqual(run(base, { kind: 'revise', changes: [{ id: 'id-3', revision: 3, patch: { title: 'Renamed', date: '', state: 'saved' } }] }),
    { ok: false, reason: 'invalid_result', message: drifted });
});

test('H25: a drifted stored preference blocks no unrelated save; a fix of it succeeds', () => {
  const base = household();
  base.metas.k1 = meta({ time: '02:30' });
  const review = { enabled: true, weekday: 1, time: '17:00', zone: 'Mars/Olympus_Mons' };
  base.preferences['week:review-preferences'] = review;
  assert.equal(validActionSnapshot(base), false);
  for (const command of [
    { kind: 'revise', changes: [{ id: 'id-2', revision: 1, patch: { title: 'Filter', date: '2026-10-15', state: 'saved' } }] },
    { kind: 'revise', changes: [], preferences: { 'week:focus': 'k3' } },
    { kind: 'add', seeds: [{ key: 'n', title: 'New', reason: '', origin: '' }], date: '' },
  ]) {
    const plan = run(base, command);
    assert.equal(plan.ok, true, JSON.stringify(plan));
    assert.ok(sameValue(plan.next.preferences['week:review-preferences'], review));
  }
  const fixed = run(base, { kind: 'revise', changes: [], preferences: { 'week:review-preferences': { ...review, zone: 'America/New_York' } } });
  assert.equal(fixed.ok, true);
  assert.equal(validActionSnapshot(fixed.next), true);
  assert.deepEqual(run(base, { kind: 'revise', changes: [{ id: 'id-1', revision: 2, patch: { title: 'Keep my water report', date: '2026-03-08', state: 'saved' } }] }),
    { ok: false, reason: 'invalid_result', message: 'Choose a valid dated time outside clock-change gaps or ambiguous times.' });
});

test('H26: nesting deeper than 32 is a 400, never a stack overflow', () => {
  const nest = (depth) => { let value = {}; for (let i = 1; i < depth; i++) value = { a: value }; return value; };
  assert.equal(unstorableValue(nest(32)), null);
  assert.equal(unstorableValue(nest(33)), 'unstorable_depth');
  assert.equal(unstorableValue([[[]]]), null);
  const base = household();
  // A meta is one level, so an extra of depth 31 makes 32 and of depth 32 makes 33.
  assert.equal(run(base, { kind: 'revise', changes: [], metadata: { k3: meta({ extra: nest(31) }) } }).ok, true);
  assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], metadata: { k3: meta({ extra: nest(32) }) } })), ['unstorable_depth']);
  // 5,000 deep, as JSON text the route would parse, through parse and plan.
  const deep = `${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}`;
  const body = JSON.parse(`{"operationId":"${OP}","kind":"revise","changes":[],"metadata":{"k3":{"note":"","paused":false,"archived":false,"completedOn":"","time":"","duration":60,"zone":"America/New_York","recurrence":"none","reminder":false,"history":[],"extra":${deep}}},"expectedMetadata":{"k1":${JSON.stringify(deep)}}}`);
  const parsed = parseActionCommand(body);
  assert.deepEqual(parsed.fieldErrors.map((error) => error.code), ['unstorable_depth', 'invalid_signature']);
  // And a deep signature alone, which the planner would otherwise recurse into.
  assert.deepEqual(codes(run(base, { kind: 'revise', changes: [], expectedMetadata: { k1: deep } })), ['invalid_signature']);
  // Every value the client sends is at most 3 deep, so no caller is refused.
  assert.equal(unstorableValue({ outdoorPlan: { key: 'k', place: 'p', period: 'am', watchRequested: true, forecastVersion: null, forecastIssuedAt: null, forecastExpiresAt: null } }), null);
});

test('writes: a meta-only change never moves a revision; a value-equal meta writes nothing; a delete takes its meta', () => {
  const base = household();
  const only = run(base, { kind: 'revise', changes: [], metadata: { k3: meta({ note: 'Bring gloves' }), k2: null } });
  assert.deepEqual(only.writes.updates, []);
  assert.deepEqual(only.writes.metas, [{ id: 'id-3', key: 'k3', meta: meta({ note: 'Bring gloves' }) }, { id: 'id-2', key: 'k2', meta: null }]);
  assert.deepEqual(only.next.actions, base.actions);
  const same = run(base, { kind: 'revise', changes: [], metadata: { k1: JSON.parse(JSON.stringify(base.metas.k1)) } });
  assert.equal(same.noop, true);
  // Clearing a meta that does not exist writes nothing either.
  assert.equal(run(base, { kind: 'revise', changes: [], metadata: { k3: null } }).noop, true);
  const removed = run(base, { kind: 'delete', id: 'id-1', revision: 2 });
  assert.deepEqual(removed.writes, { inserts: [], updates: [], metas: [], deletes: ['id-1'], preferences: {} });
  assert.equal(Object.hasOwn(removed.next.metas, 'k1'), false);
  // An unchanged patch still advances the revision: coverage requires it (F: action-service.ts:108).
  const touch = run(base, { kind: 'revise', changes: [{ id: 'id-2', revision: 1, patch: { title: 'Change the filter', date: '2026-10-14', state: 'waiting' } }] });
  assert.deepEqual(touch.writes.updates, [{ id: 'id-2', baseRevision: 1, revision: 2, title: 'Change the filter', date: '2026-10-14', state: 'waiting' }]);
  assert.equal(touch.noop, false);
});

test('parse: fields, kinds and shapes decided without state', () => {
  const ok = { kind: 'revise', changes: [] };
  assert.deepEqual(parseActionCommand(null).fieldErrors.map((error) => error.code), ['invalid_body']);
  assert.deepEqual(parseActionCommand([]).fieldErrors.map((error) => error.code), ['invalid_body']);
  assert.deepEqual(parseActionCommand(ok).fieldErrors.map((error) => error.field), ['operationId']);
  assert.deepEqual(parseActionCommand({ ...ok, operationId: 'not-a-uuid' }).fieldErrors.map((error) => error.code), ['invalid_operation_id']);
  // H27, the house rule (parseUuid): lowercased, never trimmed.
  assert.equal(parseActionCommand({ ...ok, operationId: OP.toUpperCase() }).command.operationId, OP);
  for (const padded of [` ${OP}`, `${OP} `, `${OP}\n`]) assert.deepEqual(parseActionCommand({ ...ok, operationId: padded }).fieldErrors.map((error) => error.code), ['invalid_operation_id']);
  assert.deepEqual(codes(run({}, { ...ok, ifMatch: 3, data: {} })), ['unknown_field', 'unknown_field']);
  assert.deepEqual(codes(run({}, { kind: 'revise', changes: [], seeds: [] })), ['unknown_field']);
  assert.deepEqual(codes(run({}, { kind: 'rename' })), ['invalid_kind']);
  assert.deepEqual(codes(run({}, { kind: 'add', seeds: [], date: '' })), ['seeds_required']);
  assert.deepEqual(codes(run({}, { kind: 'add', seeds: [{ key: '', title: '', reason: '', origin: '' }], date: '2026-02-30' })), ['invalid_date', 'invalid_key', 'invalid_title']);
  assert.deepEqual(codes(run({}, { kind: 'add', seeds: [{ key: 'k', title: 't' }], date: '' })), ['invalid_seed']);
  assert.deepEqual(codes(run({}, { kind: 'revise', changes: {} })), ['invalid_changes']);
  assert.deepEqual(codes(run({}, { kind: 'revise', changes: [{ id: 'a', revision: 0, patch: { title: 't', date: 'x', state: 'paused', extra: 1 }, more: 1 }] })), ['unknown_field', 'unknown_field', 'invalid_revision', 'invalid_date', 'invalid_state']);
  assert.deepEqual(codes(run({}, { kind: 'revise', changes: [{ id: 'a', revision: 1, patch: { title: 't', date: '', state: 'saved' } }, { id: 'a', revision: 1, patch: { title: 't', date: '', state: 'saved' } }] })), ['duplicate_change_id']);
  assert.deepEqual(codes(run({}, { kind: 'delete', id: '', revision: '1' })), ['invalid_id', 'invalid_revision']);
  assert.deepEqual(codes(run({}, { ...ok, metadata: { k: [] }, preferences: { 'week:focus': 1 } })), ['invalid_metadata', 'invalid_preference']);
  assert.deepEqual(codes(run({}, { ...ok, metadata: [], expectedMetadata: 'x', preferences: [], initialStates: 1 })), ['invalid_metadata', 'invalid_signature', 'invalid_preferences', 'invalid_initial_states']);
  // null for an option is the reference's own `?? {}`: absent.
  assert.equal(parseActionCommand({ operationId: OP, ...ok, metadata: null, expectedMetadata: null, preferences: null, initialStates: null }).ok, true);
  // Keys that look like prototypes are ordinary keys.
  const proto = JSON.parse(`{"operationId":"${OP}","kind":"add","seeds":[{"key":"__proto__","title":"T","reason":"","origin":""}],"date":"","metadata":{"__proto__":${JSON.stringify(meta())}}}`);
  const plan = planActionCommand({ actions: [], metas: {}, preferences: {} }, parseActionCommand(proto).command, { newId: ids() });
  assert.equal(plan.ok, true);
  assert.equal(Object.hasOwn(plan.next.metas, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(plan.next.metas), Object.prototype);
  // Field errors are bounded.
  const many = { kind: 'revise', changes: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, revision: 0, patch: { title: 't', date: '', state: 'saved' } })) };
  assert.equal(codes(run({}, many)).length, 50);
});

// ---------------------------------------------------------------------------
// 4. Copy and purity.
// ---------------------------------------------------------------------------

test('no U+2014 anywhere in the module, its messages or its field errors', () => {
  // Spelled by code point, so this file holds no U+2014 either.
  const EM_DASH = String.fromCharCode(0x2014);
  assert.equal(SOURCE.includes(EM_DASH), false);
  for (const message of Object.values(ACTION_REFUSAL_MESSAGES)) assert.equal(message.includes(EM_DASH), false);
  const errors = [
    run({}, { kind: 'clear' }), run({}, { kind: 'x', a: 1 }), run({}, { kind: 'add', seeds: [{}], date: 1 }),
    run({}, { kind: 'revise', changes: [{}, { id: 1, revision: 0, patch: { title: 1 } }], metadata: 1, expectedMetadata: { a: 1 }, preferences: { x: 1 }, initialStates: { a: 1 } }),
    run({}, { kind: 'add', seeds: [{ key: 'k', title: BAD_TEXT[0], reason: '', origin: '' }], date: '0000-01-01', metadata: { k: { a: Infinity } } }),
  ].flatMap((result) => result.fieldErrors);
  assert.ok(errors.length > 10);
  for (const { message } of errors) assert.ok(typeof message === 'string' && message.length > 0 && !message.includes(EM_DASH));
});

test('the module is pure: no imports, network, environment or clock', () => {
  assert.doesNotMatch(SOURCE, /^\s*import\s/m);
  assert.doesNotMatch(SOURCE, /\brequire\(|\bfetch\(|process\.env|Date\.now|new Date\(\)|performance\.now|Math\.random/);
  // The same inputs plan to the same output.
  const command = { kind: 'add', seeds: [{ key: 'n', title: 'T', reason: '', origin: '' }], date: '2026-10-20' };
  assert.deepEqual(run(household(), command), run(household(), command));
  // The planner does not change the snapshot it was given.
  const base = household(), copy = structuredClone(base);
  run(base, { kind: 'revise', changes: [{ id: 'id-1', revision: 2, patch: { title: 'x', date: '', state: 'saved' } }], metadata: { k1: null, k3: meta() }, preferences: { 'week:focus': 'k3' } });
  assert.deepEqual(base, copy);
});
