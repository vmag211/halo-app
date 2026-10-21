import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { lunaIntent, explicitLunaDate, lunaCalendarAnchor, resolveLunaCalendarDate, matchingLunaNotes, matchingLunaProjects, lunaTaskRevisionMatches, lunaTaskReviewError } = await loadFrontend('luna-tools-preview');

test('Luna supports representative conversation tasks without making every request a note operation', () => {
  assert.deepEqual(lunaIntent('Open my tests'), { kind: 'navigate', tab: 'home', destination: 'tests' });
  assert.deepEqual(lunaIntent('Open the map'), { kind: 'navigate', tab: 'map' });
  assert.equal(lunaIntent('Find projects based on my home').kind, 'projects');
  assert.equal(lunaIntent('Find local ways to volunteer').kind, 'local');
  assert.equal(lunaIntent('Guide me through this step').kind, 'guide');
  assert.equal(lunaIntent('Can you do something unclear?').kind, 'clarify');
});

test('Luna all-day scheduling never guesses relative dates or accepts invalid dates', () => {
  assert.deepEqual(explicitLunaDate('tomorrow'), { date: '', invalid: false, requiresDate: true });
  assert.equal(explicitLunaDate('2026-02-30').invalid, true);
  assert.equal(explicitLunaDate('2026-10-12 and 2026-10-13').invalid, true);
  assert.deepEqual(lunaIntent('Create a task: check the garden on 2026-10-12'), { kind: 'create-task', title: 'check the garden', date: '2026-10-12', requiresDate: true });
  assert.equal(lunaTaskReviewError('Check the garden', '', true), 'Choose an exact all-day date before saving this schedule.');
  assert.equal(lunaTaskReviewError('Check the garden', '', false), null);
  assert.equal(lunaIntent('Move that task to 2026-02-30').kind, 'clarify');
});

test('Luna note text is data and negated mutations do not become proposals', () => {
  const request = lunaIntent('Save a note: do not delete my plants. Ask about native flowers.');
  assert.equal(request.kind, 'save-note');
  assert.equal(request.description, 'do not delete my plants. Ask about native flowers.');
  assert.equal(lunaIntent('Save a note: My plants need water.').kind, 'save-note');
  assert.equal(lunaIntent('Do not delete the creek note').kind, 'clarify');
  assert.equal(lunaIntent('Delete my account').kind, 'clarify');
});

test('Named note lookup is exact first and ambiguous or broad names never select every note', () => {
  const records = [{ title: 'Creek' }, { title: 'Creek visit' }, { title: 'Garden' }];
  assert.deepEqual(matchingLunaNotes(records, 'Creek'), [records[0]]);
  assert.deepEqual(matchingLunaNotes(records, ''), []);
  assert.equal(matchingLunaNotes(records, 'cre').length, 2);
  assert.deepEqual(lunaIntent('Delete the note titled "Creek visit"'), { kind: 'delete-note', name: 'Creek visit' });
  assert.equal(lunaIntent('Delete all notes').kind, 'delete-note');
  assert.deepEqual(matchingLunaNotes(records, lunaIntent('Delete all notes').name), []);
});

test('Task revisions protect the same canonical action and reject stale or missing records', () => {
  const action = { id: 'a', key: 'a', title: 'Garden', reason: '', origin: 'Luna', date: '', state: 'saved', revision: 3 };
  assert.equal(lunaTaskRevisionMatches(action, 3), true);
  assert.equal(lunaTaskRevisionMatches(action, 2), false);
  assert.equal(lunaTaskRevisionMatches(undefined, 1), false);
});

test('Natural calendar dates use a disclosed timezone anchor and deterministic Monday-to-Sunday task week', () => {
  const anchor = '2026-10-11'; const timezone = 'America/New_York';
  assert.equal(lunaCalendarAnchor(new Date('2026-10-11T02:00:00Z'), timezone), '2026-10-10');
  assert.equal(resolveLunaCalendarDate('Saturday', { anchor, timezone }).date, '2026-10-17');
  assert.equal(resolveLunaCalendarDate('tomorrow', { anchor, timezone }).date, '2026-10-12');
  assert.equal(resolveLunaCalendarDate('tomorrow', { anchor, timezone }).explanation, 'Tomorrow, based on 2026-10-11 in Eastern Time.', 'the zone is named for people, not as its IANA id');
  assert.equal(resolveLunaCalendarDate('Move that to Sunday', { anchor, timezone, referenceDate: '2026-10-17' }).date, '2026-10-18');
  assert.equal(resolveLunaCalendarDate('Move that to Monday', { anchor, timezone, referenceDate: '2026-10-17' }).date, '2026-10-12');
  assert.ok(resolveLunaCalendarDate('next Saturday', { anchor, timezone }).ambiguous);
  assert.ok(resolveLunaCalendarDate('this Friday', { anchor, timezone }).ambiguous);
  assert.ok(resolveLunaCalendarDate('2026-10-12 at 4pm', { anchor, timezone }).ambiguous);
});

test('Project starts resolve natural guide names without selecting ambiguous projects', () => {
  const records = [{ id: 'solar-oven', title: 'Build a solar energy experiment' }, { id: 'bee-house', title: 'Build and maintain a bee house' }, { id: 'native-tree', title: 'Plant and care for a native tree' }];
  assert.deepEqual(matchingLunaProjects(records, 'solar oven project'), [records[0]]);
  assert.deepEqual(matchingLunaProjects(records, 'bee house'), [records[1]]);
  assert.equal(matchingLunaProjects(records, 'build').length, 2);
  assert.equal(lunaIntent('Start the solar oven project on Saturday').kind, 'start-project');
});

test('Missing public readings preserve supplied owned records without borrowing public fixtures', async () => {
  const { getPreviewProjectContext, createProjectGeneration } = await loadFrontend('explore-personalization');
  const context = getPreviewProjectContext({ observations: [{ id: 'own-condensation', title: 'My window observation', revision: 2, kind: 'condensation', observedAt: '2026-10-10T08:00' }] }, undefined, false);
  assert.deepEqual(context.evidence.map(item => item.id), ['preview:observation:own-condensation:2']);
  assert.equal(context.hasMoistureObservation, true);
  assert.equal(context.county, '');
  const batch = createProjectGeneration(context);
  assert.ok(batch.items.some(item => item.id === 'moisture-check' && item.evidenceIds.includes('preview:observation:own-condensation:2')));
  assert.ok(batch.items.every(item => item.evidenceIds.every(id => id.startsWith('preview:observation:'))));
});
