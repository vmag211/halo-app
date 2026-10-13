import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { blankEngagement, blankOutcome, engagementError, outcomeError, validDay, safePublicLink } = await loadFrontend('explore-workspace');
test('Explore private records begin without participation, outcomes or inferred measurements', () => {
  const record = blankEngagement();
  assert.equal(record.status, 'Considering'); assert.equal(record.hours, '');
  assert.equal(record.outcome, ''); assert.deepEqual(record.history, []);
  const outcome = blankOutcome('case', 'Question', 'Get a dated report');
  assert.equal(outcome.status, 'Open'); assert.equal(outcome.result, '');
});
test('Explore calendar dates reject invalid dates without shifting timezone days', () => {
  for (const value of ['2026-10-10', '2028-02-29']) assert.equal(validDay(value), true);
  for (const value of ['', '2026-02-29', '2026-04-31', '2026-10-10T00:00:00Z']) assert.equal(validDay(value), false);
});
test('manual organizer links allow HTTPS only and reject credentials or executable schemes', () => {
  assert.equal(safePublicLink('https://example.invalid/opportunity'), 'https://example.invalid/opportunity');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.invalid', 'https://name:secret@example.invalid', 'not a url']) assert.equal(safePublicLink(value), null);
});
test('participation requires an organizer, a factual result and dated self-report', () => {
  const record = { ...blankEngagement(), title: 'A sample activity', organizer: 'Sample group' };
  assert.equal(engagementError(record), null);
  assert.match(engagementError({ ...record, status: 'Participated' }), /date/);
  assert.match(engagementError({ ...record, status: 'Participated', statusDate: '2026-10-01' }), /actually did/);
  assert.equal(engagementError({ ...record, status: 'Participated', statusDate: '2026-10-01', outcome: 'I helped with an organizer-led activity.' }), null);
});
test('hours preserve a valid zero and reject malformed or unsupported quantities', () => {
  const record = { ...blankEngagement(), title: 'Example', organizer: 'Example group' };
  for (const hours of ['', '0', '1.5', '1000']) assert.equal(engagementError({ ...record, hours }), null);
  for (const hours of ['NaN', 'Infinity', '-1', '0x10', '1001', '1,5']) assert.match(engagementError({ ...record, hours }), /hours/);
});
test('a result cannot be recorded from a checkbox or undated claim alone', () => {
  const record = blankOutcome('case', 'Question', 'Receive a report');
  assert.equal(outcomeError(record), null);
  assert.match(outcomeError({ ...record, status: 'Result recorded' }), /date/);
  assert.match(outcomeError({ ...record, status: 'Result recorded', date: '2026-10-01' }), /Describe/);
  assert.equal(outcomeError({ ...record, status: 'Result recorded', date: '2026-10-01', result: 'I received the report.' }), null);
});
test('future plans are allowed but future participation and result claims are not', () => {
  const record = { ...blankEngagement(), title: 'Example', organizer: 'Example', date: '2099-10-10' };
  assert.equal(engagementError(record), null);
  assert.match(engagementError({ ...record, statusDate: '2099-10-10' }), /future/);
  const result = { ...blankOutcome('case', 'Question', 'Receive an answer'), followupDate: '2099-10-10' };
  assert.equal(outcomeError(result), null);
  assert.match(outcomeError({ ...result, date: '2099-10-10' }), /future/);
});
