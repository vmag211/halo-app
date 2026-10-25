/**
 * lib/lunaActions.js, the pure half (B20): reading dates and times, finding
 * the task the person means, checking the model's intent, what Luna answers
 * for it, and the task command a review becomes. No database, no network.
 */
import './helpers/routeLoader.mjs'; // registers the `@/` module hooks the libs import through
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  LUNA_ACTION_COPY,
  LUNA_RECEIPT_COPY,
  cleanTitle,
  createdKey,
  editedPayload,
  looksLikeTaskRequest,
  matchTasks,
  normalizeTime,
  parseTaskIntent,
  planFromIntent,
  proposalCommandBody,
  resolveDateWords,
  toLunaProposal,
} = await import('../lib/lunaActions.js');
const { parseActionCommand, planActionCommand, validActionSnapshot } = await import('../lib/actionRules.js');
const { FEATURE_FLAGS, featureDisabledReason } = await import('../lib/features.js');

const TODAY = '2026-10-25'; // a Sunday

test('the flag is HALO_FEATURE_LUNA_ACTIONS, and its reason has no em dash', () => {
  assert.equal(FEATURE_FLAGS.lunaActions, 'HALO_FEATURE_LUNA_ACTIONS');
  assert.equal(featureDisabledReason('lunaActions').includes('—'), false);
});

test('resolveDateWords reads the common forms, in the household\'s calendar, and refuses to guess', () => {
  const at = (words) => resolveDateWords(words, TODAY);
  assert.deepEqual(at(''), { date: '', given: false, unclear: false });
  assert.equal(at('today').date, TODAY);
  assert.equal(at('tomorrow').date, '2026-10-26');
  assert.equal(at('the day after tomorrow').date, '2026-10-27');
  assert.equal(at('in 3 days').date, '2026-10-28');
  assert.equal(at('in a week').date, '2026-11-01');
  assert.equal(at('friday').date, '2026-10-30');
  assert.equal(at('on Sunday').date, TODAY, 'the weekday it is today means today');
  assert.equal(at('this Monday').date, '2026-10-26');
  assert.equal(at('2026-11-03').date, '2026-11-03');
  assert.equal(at('November 3').date, '2026-11-03');
  assert.equal(at('Nov 3rd 2027').date, '2027-11-03');
  assert.equal(at('3 November').date, '2026-11-03');
  assert.equal(at('January 5').date, '2027-01-05', 'a month and day already past this year is next year');
  assert.equal(at('11/3').date, '2026-11-03');
  for (const unclear of ['next friday', 'sometime soon', '2026-02-30', 'February 30', '13/40', 'in 900 days']) {
    assert.deepEqual(at(unclear), { date: '', given: true, unclear: true }, unclear);
  }
});

test('normalizeTime reads a time of day, and nothing that is not one', () => {
  assert.equal(normalizeTime('14:30'), '14:30');
  assert.equal(normalizeTime('2:30 pm'), '14:30');
  assert.equal(normalizeTime('2:30 PM'), '14:30');
  assert.equal(normalizeTime('9am'), '09:00');
  assert.equal(normalizeTime('12 am'), '00:00');
  assert.equal(normalizeTime('12pm'), '12:00');
  assert.equal(normalizeTime('noon'), '12:00');
  for (const junk of ['', '3', '25:00', '13pm', '9:75', 'soon']) assert.equal(normalizeTime(junk), '', junk);
});

test('cleanTitle keeps the person\'s words and removes only what cannot be shown', () => {
  assert.equal(cleanTitle('  "Test the  tap"  '), 'Test the tap');
  assert.equal(cleanTitle('Call the utility — ask about lead'), 'Call the utility, ask about lead');
  assert.equal(cleanTitle('a\u0007b'), 'a b');
  assert.ok(cleanTitle('word '.repeat(60)).length <= 160);
});

test('parseTaskIntent accepts only the agreed shape', () => {
  assert.deepEqual(parseTaskIntent('{"action":"create","title":"Test","task":"","date":"friday","time":"","minutes":30}'),
    { action: 'create', title: 'Test', task: '', date: 'friday', time: '', minutes: 30 });
  assert.equal(parseTaskIntent('Sure! ```json\n{"action":"none"}\n```').action, 'none', 'a fenced reply is read');
  for (const bad of ['', 'no json', '{"action":"delete"}', '{"action":"create","title":5}', '[1]', '{"action":"create","title":"' + 'x'.repeat(500) + '"}']) {
    assert.equal(parseTaskIntent(bad), null, bad.slice(0, 40));
  }
  assert.equal(parseTaskIntent('{"action":"create","title":"x","minutes":-4}').minutes, null);
});

test('looksLikeTaskRequest: imperatives and task words pass; ordinary questions do not', () => {
  for (const yes of ['Add a task to test the tap', 'please move the gutters to Friday', 'Mark the filter done', 'Remind me to call the county', 'What is on my week?', 'reopen it']) {
    assert.equal(looksLikeTaskRequest(yes), true, yes);
  }
  for (const no of ['What is radon?', 'Is my tap water safe?', 'How much PFAS is too much?', '']) {
    assert.equal(looksLikeTaskRequest(no), false, no);
  }
});

const actions = [
  { id: 'a1', key: 'k1', title: 'Test the kitchen tap', date: '2026-11-03', state: 'saved', revision: 2, reason: 'r', origin: 'Personal' },
  { id: 'a2', key: 'k2', title: 'Test the bathroom tap', date: '', state: 'saved', revision: 1, reason: 'r', origin: 'Personal' },
  { id: 'a3', key: 'k3', title: 'Clean gutters', date: '2026-11-01', state: 'completed', revision: 4, reason: 'r', origin: 'Personal' },
];

test('matchTasks: exact title first, then contains, then all words; pronouns and batch words', () => {
  assert.deepEqual(matchTasks(actions, 'the kitchen tap').map((a) => a.id), ['a1']);
  assert.deepEqual(matchTasks(actions, 'Test the kitchen tap').map((a) => a.id), ['a1']);
  assert.deepEqual(matchTasks(actions, 'tap').map((a) => a.id), ['a1', 'a2']);
  assert.deepEqual(matchTasks(actions, 'bathroom test').map((a) => a.id), ['a2']);
  assert.deepEqual(matchTasks(actions, 'it', { lastTaskId: 'a3' }).map((a) => a.id), ['a3']);
  assert.deepEqual(matchTasks(actions, 'it'), []);
  assert.deepEqual(matchTasks(actions, 'all my tasks'), []);
  assert.deepEqual(matchTasks(actions, 'radon'), []);
});

test('planFromIntent: one review, a choice, or an honest sentence; never a change', () => {
  const snapshot = { actions, metas: {} };
  const plan = (intent) => planFromIntent({ intent: { title: '', task: '', date: '', time: '', minutes: null, ...intent }, snapshot, today: TODAY });

  const create = plan({ action: 'create', title: 'Buy a radon kit', date: 'friday', time: '3pm', minutes: 20 });
  assert.equal(create.reply, LUNA_ACTION_COPY.prepared);
  assert.deepEqual(create.proposal, { kind: 'create', payload: { title: 'Buy a radon kit', date: '2026-10-30', time: '15:00', minutes: 20, notes: [] } });
  assert.deepEqual(plan({ action: 'create', title: 'x', time: '3pm' }).proposal.payload.notes, ['timeDropped'], 'a time with no date is dropped, and said');
  assert.equal(plan({ action: 'create', title: '' }).reply, LUNA_ACTION_COPY.noTitle);

  const choose = plan({ action: 'complete', task: 'tap' });
  assert.equal(choose.reply, LUNA_ACTION_COPY.choose);
  assert.equal(choose.proposal.kind, 'choose');
  assert.deepEqual(choose.proposal.payload.candidates.map((c) => c.taskId), ['a1', 'a2']);

  assert.equal(plan({ action: 'complete', task: 'gutters' }).reply, LUNA_ACTION_COPY.alreadyComplete);
  assert.equal(plan({ action: 'reopen', task: 'kitchen tap' }).reply, LUNA_ACTION_COPY.notComplete);
  assert.equal(plan({ action: 'later', task: 'bathroom tap' }).reply, LUNA_ACTION_COPY.alreadyLater);
  assert.equal(plan({ action: 'complete', task: 'radon' }).reply, LUNA_ACTION_COPY.notFound);
  assert.equal(plan({ action: 'complete', task: '' }).reply, LUNA_ACTION_COPY.noReference);

  const move = plan({ action: 'reschedule', task: 'kitchen tap', date: 'tomorrow' });
  assert.deepEqual([move.proposal.kind, move.proposal.payload.newDate, move.proposal.payload.taskRevision], ['reschedule', '2026-10-26', 2]);
  const timeOnly = plan({ action: 'reschedule', task: 'kitchen tap', time: '9:30 am' });
  assert.deepEqual([timeOnly.proposal.payload.newDate, timeOnly.proposal.payload.newTime], ['2026-11-03', '09:30'], 'a new time alone keeps the date');

  const paused = planFromIntent({ intent: { action: 'complete', task: 'kitchen tap', title: '', date: '', time: '', minutes: null }, snapshot: { actions, metas: { k1: { paused: true } } }, today: TODAY });
  assert.equal(paused.reply, LUNA_ACTION_COPY.paused);
});

test('every sentence Luna says here is free of em dashes, task content and any claim that something changed', () => {
  for (const sentence of [...Object.values(LUNA_ACTION_COPY), ...Object.values(LUNA_RECEIPT_COPY)]) {
    assert.equal(sentence.includes('—'), false, sentence);
    assert.equal(/\b(?:I(?:'ve| have)|has been) (?:added|saved|moved|completed|changed|scheduled)\b/i.test(sentence), false, sentence);
    assert.ok(sentence.length <= 1000);
  }
});

test('a review becomes an ordinary task command that My Week\'s own planner accepts, bound to the revision and details it was prepared against', () => {
  const snapshot = { actions: [actions[0]], metas: { k1: { time: '10:00', note: 'private', history: ['old'] } } };
  const plan = planFromIntent({ intent: { action: 'complete', task: 'kitchen tap', title: '', date: '', time: '', minutes: null }, snapshot, today: TODAY });
  const row = { id: 'p1', kind: 'complete', status: 'review', revision: 1, payload: plan.proposal.payload, expires_at: '2026-10-25T13:00:00Z' };
  const body = proposalCommandBody(row, { operationId: '00000000-0000-4000-8000-000000000001', today: TODAY });
  assert.deepEqual(body.changes, [{ id: 'a1', revision: 2, patch: { title: 'Test the kitchen tap', date: '2026-11-03', state: 'completed' } }]);
  assert.equal(body.expectedMetadata.k1, JSON.stringify(snapshot.metas.k1));
  const parsed = parseActionCommand(body);
  assert.equal(parsed.ok, true);
  const planned = planActionCommand(snapshot, parsed.command);
  assert.equal(planned.ok, true);
  assert.ok(validActionSnapshot(planned.next));
  assert.equal(planned.next.metas.k1.note, 'private', 'the private note is kept, not rewritten');
  assert.deepEqual(planned.next.metas.k1.history, ['old', `${TODAY}: Completed by you after a Luna review.`]);

  // The task moved on: the same command is refused.
  const moved = { ...snapshot, actions: [{ ...actions[0], revision: 3 }] };
  assert.equal(planActionCommand(moved, parsed.command).reason, 'stale_revision');

  const create = proposalCommandBody({ id: 'p2', kind: 'create', payload: { title: 'Buy a kit', date: '', time: '', minutes: null } }, { operationId: '00000000-0000-4000-8000-000000000002', today: TODAY });
  assert.equal(create.seeds[0].key, createdKey('p2'));
  assert.equal(create.seeds[0].origin, 'Luna');
  assert.equal(parseActionCommand(create).ok, true);
});

test('editedPayload checks every field with My Week\'s rules, and toLunaProposal shows the result the client accepts', () => {
  const row = { id: 'p', kind: 'create', status: 'review', revision: 1, payload: { title: 'Old', date: '', time: '', minutes: null, notes: ['dateUnclear'] }, expires_at: '2026-10-25T13:00:00Z' };
  const edited = editedPayload(row, { title: 'New', date: '2026-11-01', time: '10:30 am', minutes: '90' });
  assert.deepEqual(edited.payload, { title: 'New', date: '2026-11-01', time: '10:30', minutes: 90 });
  assert.equal(editedPayload(row, { date: '2027-03-14', time: '2:30 am' }).fieldErrors[0].field, 'fields.time', 'a clock-change gap is refused');
  assert.equal(editedPayload(row, { date: '2026-11-01', time: '1:30 am' }).fieldErrors[0].field, 'fields.time', 'and an ambiguous time');
  assert.equal(editedPayload(row, { time: '9:00' }).fieldErrors[0].code, 'time_needs_date');
  assert.equal(editedPayload({ ...row, kind: 'reschedule', payload: { newDate: '2026-11-01' } }, { date: '' }).fieldErrors[0].code, 'date_required');
  const proposal = toLunaProposal({ ...row, payload: edited.payload, revision: 2 });
  assert.equal(proposal.revision, 2);
  assert.deepEqual(proposal.fields.map((f) => [f.name, f.value]), [['title', 'New'], ['date', '2026-11-01'], ['time', '10:30 AM'], ['minutes', '90']]);
  assert.equal(toLunaProposal({ ...row, status: 'applied' }).fields, undefined, 'a settled review has nothing to edit');
});
