import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { resolveWeekActivity, projectStepProgress, weekProgressEntries, weekActivityHref } = await loadFrontend('week-activity');
const { findProjectGuide, projectActionKey } = await loadFrontend('explore-project-guides');
const action = (key, state = 'saved') => ({ id: key, key, title: 'My saved task', origin: 'Explore', reason: '', date: '', state, revision: 1 });
const href = (tab, destination) => `?tab=${tab}&destination=${destination}`;

test('empty owned collections never borrow home or project examples', () => {
  assert.deepEqual(weekProgressEntries({}, []), []);
  assert.equal(resolveWeekActivity(action('home:sample-filter'), {}).missingRecord, true);
  assert.equal(resolveWeekActivity(action('explore:commitment:not-owned'), {}).missingRecord, true);
});
test('exact origin IDs, not similar titles, determine linked home context', () => {
  const source = { id: 'mine', title: 'My saved task', status: 'active', instructions: 'My actual instruction', model: 'My device', lastCompleted: '2026-10-01' };
  const context = resolveWeekActivity(action('home:mine'), { assets: [source] });
  assert.equal(context.kind, 'routine'); assert.equal(context.preparation, source.instructions);
  assert.equal(context.fields.find(item => item.label === 'Last recorded care').value, '2026-10-01');
  assert.equal(resolveWeekActivity(action('home:not-mine'), { assets: [source] }).missingRecord, true);
  assert.match(weekActivityHref(context, href), /homeView=detail&record=mine/);
});
test('an entered report does not backfill unrecorded arranged or collected facts', () => {
  const context = resolveWeekActivity(action('home:test'), { tests: [{ id: 'test', title: 'Test', status: 'recorded', rows: [{}], collectionStart: '', expectedDate: '2026-10-20', review: 'unreviewed' }] });
  assert.deepEqual(context.milestones.map(item => item.done), [false, false, true]);
  assert.ok(!context.fields.some(item => item.label === 'Expected result'));
});
test('community context uses the saved meeting place and safe organizer URL', () => {
  const collection = { exploreEngagements: [{ id: 'local', title: 'Cleanup', organizer: 'Actual organizer', place: 'Chosen meeting point', status: 'Considering', date: '2026-10-17', preparation: 'Bring my gloves', url: 'https://example.org/signup' }] };
  const context = resolveWeekActivity(action('explore:commitment:local:followup'), collection);
  assert.equal(context.kind, 'volunteering'); assert.equal(context.preparation, 'Bring my gloves');
  assert.equal(context.fields.find(item => item.label === 'Meeting place').value, 'Chosen meeting point');
  assert.equal(context.sourceLinks[0].url, 'https://example.org/signup');
  collection.exploreEngagements[0].url = 'javascript:alert(1)';
  assert.deepEqual(resolveWeekActivity(action('explore:commitment:local'), collection).sourceLinks, []);
});
test('canonical project step completion alone determines next unfinished work', () => {
  const guide = findProjectGuide('demo-habitat-project');
  const steps = [action(projectActionKey(guide.id, 0), 'completed'), action(projectActionKey(guide.id, 2), 'completed'), action('unrelated:step:1', 'completed')];
  const progress = projectStepProgress(guide, steps);
  assert.equal(progress.completed, 2); assert.equal(progress.nextStep, 1);
  const context = resolveWeekActivity(action(`explore:project:${guide.id}`), {}, steps);
  assert.equal(context.stepIndex, 1); assert.equal(context.project, undefined); assert.equal(context.fields[0].value, 'Not started');
  assert.deepEqual(weekProgressEntries({}, steps), []);
});
test('invalid project steps never become a real guide step', () => {
  assert.equal(resolveWeekActivity(action('explore:project:demo-habitat-project:step:900'), {}).missingRecord, true);
  assert.equal(resolveWeekActivity(action('explore:project:unknown:step:0'), {}).missingRecord, true);
});
test('paused, completed, closed and archived owned work have truthful progress states', () => {
  const guide = findProjectGuide('demo-habitat-project');
  const collection = { exploreProjects: [{ id: guide.id, title: 'Mine', status: 'Paused' }, { id: 'bee-house', title: 'Done', status: 'Completed' }], exploreEngagements: [{ id: 'closed', status: 'Closed' }], tests: [{ id: 'archived', archived: true, status: 'awaiting' }] };
  const entries = weekProgressEntries(collection, []); assert.equal(entries.length, 1); assert.equal(entries[0].status, 'Paused');
  collection.exploreProjects[0].status = 'Active';
  const task = action(projectActionKey(guide.id, 0));
  assert.equal(weekProgressEntries(collection, [task], { [task.key]: { archived: true } })[0].status, 'Step archived');
});
test('garden and note follow-ups reopen the exact owned record without inventing reports', () => {
  const garden = resolveWeekActivity(action('home:garden'), { gardens: [{ id: 'garden', title: 'Mine', questions: 'My actual question' }] });
  assert.equal(garden.preparation, 'My actual question'); assert.match(weekActivityHref(garden, href), /homeView=garden-detail&record=garden/);
  const note = resolveWeekActivity(action('explore:note:private-note'), { exploreNotes: [{ id: 'private-note', title: 'My idea', description: 'Only my saved context' }] });
  assert.equal(note.preparation, 'Only my saved context'); assert.match(weekActivityHref(note, href), /exploreRecord=private-note/);
});
test('all completed steps ask for a result, not automatic whole-project completion', () => {
  const guide = findProjectGuide('demo-habitat-project');
  const tasks = guide.steps.map((_, index) => action(projectActionKey(guide.id, index), 'completed'));
  const entry = weekProgressEntries({ exploreProjects: [{ id: guide.id, title: 'Mine', status: 'Active' }] }, tasks)[0];
  assert.equal(entry.status, 'Ready for your result'); assert.equal(entry.project.status, 'Active'); assert.equal(entry.currentAction, undefined);
});
