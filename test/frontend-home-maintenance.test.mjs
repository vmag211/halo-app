import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { advanceDue, assetError, blankAsset, blankObservation, observationError, maintenanceTransition, sampleAssets, scheduleDescription, defaultSummarySelection, summaryDateError, withinSummaryDates, summaryHtml } = await loadFrontend('home-maintenance-preview');

test('routine schedule descriptions use singular and plural units without changing their basis', () => {
  assert.equal(scheduleDescription({ ...sampleAssets[0], interval: 1, unit: 'months' }), 'Every 1 month, on the fixed calendar schedule. No end date.');
  assert.equal(scheduleDescription({ ...sampleAssets[0], interval: 1, unit: 'days', policy: 'completion', endDate: '2026-12-01' }), 'Every 1 day, after the recorded completion. Ends Dec 1, 2026.');
  assert.match(scheduleDescription({ ...sampleAssets[0], interval: 2, unit: 'months' }), /^Every 2 months,/);
  assert.match(scheduleDescription({ ...sampleAssets[0], interval: 7, unit: 'days' }), /^Every 7 days,/);
});

test('completion-relative routines and calendar routines use different bases', () => {
  const base = { ...sampleAssets[0], installed: '2025-01-01', lastCompleted: '2025-02-01', nextDue: '2025-03-01', calendarAnchor: '2025-03-01', interval: 1, unit: 'months' };
  const calendar = maintenanceTransition(base, 'completed', '2025-03-18', 'Replaced cartridge');
  const relative = maintenanceTransition({ ...base, policy: 'completion' }, 'completed', '2025-03-18');
  assert.equal(calendar.nextDue, '2025-04-01');
  assert.equal(relative.nextDue, '2025-04-18');
  assert.equal(calendar.lastCompleted, '2025-03-18');
  assert.equal(calendar.history.at(-1).due, '2025-03-01');
  assert.equal(base.history.length, 1, 'input history is not mutated');
});

test('month-end calendar anchor survives February and missed occurrences', () => {
  assert.equal(advanceDue('2025-01-31', 1, 'months'), '2025-02-28');
  const base = { ...sampleAssets[0], installed: '2024-01-01', lastCompleted: '', nextDue: '2025-01-31', calendarAnchor: '2025-01-31' };
  const february = maintenanceTransition(base, 'completed', '2025-01-31');
  const march = maintenanceTransition(february, 'completed', '2025-02-28');
  assert.equal(march.nextDue, '2025-03-31');
  const late = maintenanceTransition(base, 'completed', '2025-05-10');
  assert.equal(late.nextDue, '2025-05-31');
  assert.equal(late.history.length, base.history.length + 1, 'missed dates are not silently completed');
  assert.equal(advanceDue('2028-01-31', 1, 'months'), '2028-02-29');
});

test('skip, snooze, pause and replacement retain distinct history and completion', () => {
  const base = { ...sampleAssets[0], installed: '2024-01-01', lastCompleted: '2025-01-01', nextDue: '2025-02-01', calendarAnchor: '2025-02-01' };
  const skipped = maintenanceTransition(base, 'skipped', '2025-02-01');
  assert.equal(skipped.lastCompleted, '2025-01-01');
  assert.equal(skipped.history.at(-1).kind, 'skipped');
  const snoozed = maintenanceTransition(base, 'snoozed', '2025-02-01', '', '2025-02-09');
  assert.equal(snoozed.nextDue, '2025-02-01');
  assert.equal(snoozed.snoozedUntil, '2025-02-09');
  assert.throws(() => maintenanceTransition(base, 'snoozed', '2025-02-01', '', '2025-01-31'));
  const paused = maintenanceTransition(base, 'paused', '2025-02-01');
  assert.equal(paused.status, 'paused');
  assert.equal(paused.nextDue, base.nextDue);
  assert.throws(() => maintenanceTransition(paused, 'completed', '2025-02-02'));
  const resumed = maintenanceTransition(paused, 'resumed', '2025-02-02');
  assert.equal(resumed.status, 'active');
  const replaced = maintenanceTransition(resumed, 'replaced', '2025-02-03');
  assert.equal(replaced.status, 'replaced');
  assert.equal(replaced.history.length, base.history.length + 3);
  assert.throws(() => maintenanceTransition(replaced, 'completed', '2025-02-04'));
});

test('end dates stop new occurrences and dates cannot fabricate completion', () => {
  const base = { ...sampleAssets[0], installed: '2025-01-01', lastCompleted: '2025-02-01', nextDue: '2025-03-01', endDate: '2025-03-31' };
  assert.equal(maintenanceTransition(base, 'completed', '2025-03-01').nextDue, '');
  assert.throws(() => maintenanceTransition(base, 'completed', '2024-01-01'));
  assert.throws(() => maintenanceTransition(base, 'completed', '2099-01-01'));
  assert.throws(() => maintenanceTransition(base, 'completed', '2025-02-30'));
});

test('routine validates useful fields and an actual interval source', () => {
  assert.ok(assetError(blankAsset()));
  const valid = { ...blankAsset(), title: 'Filter routine', nextDue: '2026-11-01' };
  assert.equal(assetError(valid), null);
  assert.ok(assetError({ ...valid, interval: 0 }));
  assert.ok(assetError({ ...valid, interval: 1.5 }));
  assert.ok(assetError({ ...valid, basis: 'manufacturer' }));
  assert.equal(assetError({ ...valid, basis: 'manufacturer', instructions: 'User-supplied product manual, replacement interval page 4' }), null);
});

test('observation retains zero, original unit and measurement source without detection', () => {
  const observation = { ...blankObservation(), title: 'Meter reading', observedAt: '2026-09-30T08:00', reading: '0', source: 'User hygrometer' };
  assert.equal(observationError(observation), null);
  assert.ok(observationError({ ...observation, source: '' }));
  assert.ok(observationError({ ...observation, reading: '101' }));
  assert.ok(observationError({ ...observation, observedAt: '2026-02-30T08:00' }));
  assert.ok(observationError({ ...observation, observedAt: '2026-09-30T25:00' }));
  assert.ok(observationError({ ...observation, timezone: 'Made/up' }));
  assert.equal(observationError({ ...observation, reading: '', source: '' }), null);
});

test('summary begins with public evidence and excludes private records and fields', () => {
  assert.equal(defaultSummarySelection.sections.scores, true);
  assert.equal(defaultSummarySelection.sections.factors, true);
  for (const key of ['tests', 'actions', 'maintenance', 'observations', 'gardens']) assert.equal(defaultSummarySelection.sections[key], false);
  for (const key of ['categories', 'location', 'notes', 'attachments']) assert.equal(defaultSummarySelection[key], false);
  assert.equal(summaryDateError(defaultSummarySelection), null);
  assert.ok(summaryDateError({ ...defaultSummarySelection, end: '2025-01-01' }));
  assert.equal(withinSummaryDates('2026-09-30T12:00', defaultSummarySelection), true);
  assert.equal(withinSummaryDates('2025-03-01', defaultSummarySelection), false);
  assert.equal(withinSummaryDates('', defaultSummarySelection), true, 'undated records remain visible with explicit labels');
});

test('local HTML export cannot execute private text as markup', () => {
  const html = summaryHtml(['Observation: <script>alert("private")</script>', 'Value: 0 µg/L & source retained']);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('0 µg/L &amp; source retained'));
  assert.ok(html.includes('background:#fff'));
  assert.ok(!html.includes('halo-navigation'));
});
