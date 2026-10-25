import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './frontend-test-loader.mjs';
const { resolveWeekActivity, unresolvedWeekSources, weekActivitySourceCollections, weekSourceRefreshPlan, weekSourceStatus } = await loadFrontend('week-activity');
const { outdoorCoverage, describeCoverage, outdoorPlanKey, outdoorPlanFromNote } = await loadFrontend('outdoor-coverage');
const { forecastFixture } = await loadFrontend('week-evidence-preview');

const action = (key) => ({ id: key, key, title: 'Saved step', origin: 'Explore', reason: '', date: '2026-10-26', state: 'saved', revision: 1 });
const projectKey = 'explore:project:p-new:step:s1';

test('F09: a task whose origin record is not loaded yet names the collection to re-read', () => {
  assert.deepEqual(weekActivitySourceCollections(projectKey), ['exploreProjects']);
  assert.deepEqual(weekActivitySourceCollections('explore:commitment:e1'), ['exploreEngagements']);
  assert.deepEqual(weekActivitySourceCollections('home:t1'), ['tests', 'assets', 'observations', 'gardens']);
  assert.deepEqual(weekActivitySourceCollections('personal:abc'), []);
  assert.deepEqual(weekActivitySourceCollections('outdoors:abc'), []);
  const gaps = unresolvedWeekSources([action(projectKey), action('personal:x')], { exploreProjects: [] });
  assert.deepEqual(gaps, [{ key: projectKey, collections: ['exploreProjects'] }]);
});

test('F09: the task says it is being checked until a real re-read answers', () => {
  const gaps = unresolvedWeekSources([action(projectKey)], { exploreProjects: [] });
  const checking = weekSourceStatus(gaps, {});
  const pending = resolveWeekActivity(action(projectKey), { exploreProjects: [] }, [], checking);
  assert.equal(pending.resolvingRecord, true); assert.equal(pending.missingRecord, false);
  assert.match(pending.subtitle, /Checking the original record/);
  assert.doesNotMatch(pending.subtitle, /not available/);
  const failed = resolveWeekActivity(action(projectKey), { exploreProjects: [] }, [], weekSourceStatus(gaps, { [projectKey]: 'failed' }));
  assert.equal(failed.uncheckedRecord, true); assert.equal(failed.missingRecord, false);
  const confirmed = resolveWeekActivity(action(projectKey), { exploreProjects: [] }, [], weekSourceStatus(gaps, { [projectKey]: 'checked' }));
  assert.equal(confirmed.missingRecord, true); assert.equal(confirmed.subtitle, 'Original record is not available');
});

test('F09: re-reads skip checked, in-flight and still-loading collections', () => {
  const gaps = [{ key: 'a', collections: ['exploreProjects'] }, { key: 'b', collections: ['tests'] }, { key: 'c', collections: ['exploreNotes'] }, { key: 'd', collections: ['exploreProjects'] }];
  const plan = weekSourceRefreshPlan(gaps, { c: 'checked' }, new Set(['b']), collection => collection === 'tests');
  assert.deepEqual(plan.keys, ['a', 'd']);
  assert.deepEqual(plan.collections, ['exploreProjects']);
  assert.deepEqual(weekSourceRefreshPlan(gaps, {}, new Set(), () => true).keys, []);
});

test('F09: the provider re-reads missing sources quietly and on focus without replacing drafts', () => {
  const provider = readFileSync(new URL('../components/expanded/ExpandedPreviewState.tsx', import.meta.url), 'utf8');
  assert.match(provider, /unresolvedWeekSources\(actions, workspace\.collections\)/);
  assert.match(provider, /addEventListener\('focus'/);
  assert.match(provider, /addEventListener\('visibilitychange'/);
  assert.match(provider, /started !== commands\.current/);
  const workspace = readFileSync(new URL('../components/homeguard/HomeWorkspaceState.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /loadCollection\(key, true, true, true\)/);
});

// Production periods: Morning 08:00 to 12:00, Afternoon 12:00 to 17:00, Evening 17:00 to 21:00, New York.
const live = (overrides = {}) => [
  { name: 'Morning', start: '2026-10-26T08:00:00-04:00', end: '2026-10-26T12:00:00-04:00', air: 30, uv: 2, pollen: 'Low', weather: 'Clear', tradeoff: '', version: 'v1' },
  { name: 'Afternoon', start: '2026-10-26T12:00:00-04:00', end: '2026-10-26T17:00:00-04:00', air: 55, uv: 6, pollen: 'Low', weather: 'Sunny', tradeoff: '', version: 'v1' },
  { name: 'Evening', start: '2026-10-26T17:00:00-04:00', end: '2026-10-26T21:00:00-04:00', air: 40, uv: 0, pollen: 'Low', weather: 'Clear', tradeoff: '', version: 'v1' },
].map(period => ({ ...period, ...overrides[period.name] }));
const ny = ms => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }).format(ms).replace(/[  ]/g, ' ');

test('F10: an 8-hour morning activity is judged on morning and afternoon, including afternoon UV', () => {
  const coverage = outdoorCoverage(live(), 'Morning', 480);
  assert.deepEqual(coverage.periods.map(period => period.name), ['Morning', 'Afternoon']);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.uv.highest, 6);
  const text = describeCoverage(coverage, ny);
  assert.match(text.headline, /morning and afternoon forecasts cover your whole activity/);
  assert.ok(text.factors.includes('UV index: up to 6.'));
});

test('F10: gaps between periods, past the last period and past midnight are named', () => {
  const fixture = outdoorCoverage(forecastFixture('2026-10-26', 'current'), 'Morning', 480);
  assert.equal(fixture.complete, false);
  assert.equal(fixture.gaps.length, 1);
  const overnight = outdoorCoverage(live(), 'Evening', 480);
  assert.equal(overnight.complete, false);
  assert.equal(overnight.gaps.length, 1);
  assert.equal(overnight.gaps[0].start, Date.parse('2026-10-26T21:00:00-04:00'));
  assert.equal(overnight.gaps[0].end, Date.parse('2026-10-27T01:00:00-04:00'));
  const text = describeCoverage(overnight, ny);
  assert.match(text.headline, /covers only part of your activity/);
  assert.match(text.uncoveredSentence, /^No forecast covers .+ to .+\. Check conditions again before that part\.$/);
  assert.equal(outdoorCoverage(live(), 'Morning', 0), null);
  assert.equal(outdoorCoverage([], 'Morning', 60), null);
});

test('F10: unavailable air or pollen is named, never read as favourable', () => {
  const coverage = outdoorCoverage(live({ Afternoon: { air: null, pollen: null } }), 'Morning', 480);
  assert.equal(coverage.air.highest, 30);
  assert.deepEqual(coverage.air.unavailable, ['Afternoon']);
  const text = describeCoverage(coverage, ny);
  assert.ok(text.factors.includes('Air: up to 30 AQI, unavailable for the afternoon.'));
  assert.match(text.factors[2], /Pollen, daily: Low, unavailable for the afternoon\./);
  const none = describeCoverage(outdoorCoverage(live({ Morning: { air: null, pollen: null } }), 'Morning', 60), ny);
  assert.ok(none.factors.includes('Air: unavailable for this activity.'));
  assert.ok(none.factors.includes('Pollen, daily: unavailable for this activity.'));
});

test('F10: a saved outdoor task returns to its plan, and its note is read back exactly', () => {
  assert.equal(outdoorPlanKey('outdoors:abc'), 'outdoors:abc');
  assert.equal(outdoorPlanKey('outdoors:abc:check-forecast'), 'outdoors:abc');
  assert.equal(outdoorPlanKey('personal:abc'), null);
  const note = 'Riverside Park. Afternoon. Preparation checked: Check official weather notices; Prepare the equipment I need. Watch: off. Household context: general. Forecast coverage: The forecast covers only part of your activity, 5:00 PM to 1:00 AM on Tue, Oct 27.';
  assert.deepEqual(outdoorPlanFromNote(note), { place: 'Riverside Park', period: 'Afternoon', preparation: ['Check official weather notices', 'Prepare the equipment I need'], watch: false, group: '' });
  assert.equal(outdoorPlanFromNote('My own words now'), null);
  assert.equal(outdoorPlanFromNote('Place not specified. Morning. Preparation checked: None. Watch: requested, not activated. Household context: children.').place, '');
  const week = readFileSync(new URL('../components/expanded/MyWeekWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(week, /href\('plan','outdoors'\)\}&outdoorTask=/);
});

test('copy added by this pass has no em dashes', () => {
  for (const file of ['../lib/frontend/outdoor-coverage.ts', '../components/expanded/WeekOutdoors.tsx', '../components/expanded/WeekActivityDetails.tsx', '../components/production/ProductionReadingStatus.tsx', '../lib/frontend/week-activity.ts']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /—/);
  }
});
