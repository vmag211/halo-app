import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { comparisonIssues, correctResults, duplicateAnalytes, emptyResult, emptyTest, numericResult, resultIssues, sampleTests, testDraftErrors, testExport, testStatuses, validTestDate } = await loadFrontend('home-test-preview');
const copy = value => structuredClone(value);

test('test preparation requires explicit context, purpose, and medium', () => {
  const draft = emptyTest();
  assert.equal(draft.contextId, '');
  assert.equal(draft.medium, '');
  assert.equal(draft.plannedDate, '');
  assert.equal(draft.expectedDate, '');
  assert.equal(testDraftErrors(draft).length, 4);
  assert.deepEqual(testDraftErrors(sampleTests[0]), []);
  assert.ok(testDraftErrors({ ...sampleTests[0], collectionEnd: '2026-09-01' }).some(value => value.includes('before collection start')));
  assert.ok(testDraftErrors({ ...sampleTests[0], expectedDate: '2026-09-01' }).some(value => value.includes('Expected result date')));
});

test('test dates reject impossible dates and timestamps without replacing calendar dates', () => {
  for (const date of ['', '2026-10-03', '2028-02-29']) assert.equal(validTestDate(date), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-10-03T00:00:00Z', '2026-13-01', 'not a date']) assert.equal(validTestDate(date), false);
});

test('non-detect, less-than, numeric zero, missing and unclear results stay distinct', () => {
  const base = { ...emptyResult(), analyte: 'Example A', originalUnit: 'µg/L', reportDate: '2026-09-26' };
  assert.equal(numericResult({ ...base, qualifier: 'zero', originalValue: '0.00' }), 0);
  for (const [qualifier, originalValue] of [['non_detect', 'ND'], ['less_than', '< 0.5'], ['absent', ''], ['unknown', '0']]) assert.equal(numericResult({ ...base, qualifier, originalValue }), null);
  assert.ok(resultIssues(sampleTests[0], [{ ...base, qualifier: 'zero', originalValue: '4' }]).some(value => value.includes('numeric-zero')));
  assert.ok(resultIssues(sampleTests[0], [{ ...base, qualifier: 'less_than', originalValue: '< 0.5' }]).some(value => value.includes('reporting limit is missing')));
  for (const originalValue of ['-1', 'Infinity', 'NaN', '', '0x10', '1,8']) assert.equal(numericResult({ ...base, qualifier: 'measured', originalValue }), null);
  assert.equal(numericResult({ ...base, qualifier: 'measured', originalValue: '1.80e-2' }), 0.018);
});

test('unclear interpretation fields produce visible reasons without fabricating normalized values', () => {
  const record = copy(sampleTests[3]);
  const issues = resultIssues(record);
  assert.ok(issues.some(value => value.includes('reported unit')));
  assert.ok(issues.some(value => value.includes('limit unit')));
  assert.ok(issues.some(value => value.includes('sample basis')));
  assert.equal(record.rows[0].originalValue, '< 0.5');
  assert.equal(Object.hasOwn(record.rows[0], 'normalizedValue'), false);
  assert.ok(resultIssues(sampleTests[2], []).some(value => value.includes('No result rows')));
});

test('compatible comparison is strict about context, matrix, method, location and confirmation', () => {
  const first = copy(sampleTests[0]);
  const second = copy(sampleTests[1]);
  assert.deepEqual(comparisonIssues(first, second), []);
  for (const change of [{ contextId: 'another-home' }, { kind: 'soil' }, { medium: 'soil' }, { medium: 'unknown' }, { method: '' }, { sampleLabel: 'Other tap' }, { review: 'unreviewed' }]) assert.ok(comparisonIssues(first, { ...second, ...change }).length > 0, JSON.stringify(change));
  assert.ok(comparisonIssues(first, first).includes('Choose a different test record.'));
});

test('comparison rejects unlike units, bases, censored results and duplicate analytes', () => {
  const first = copy(sampleTests[0]);
  const second = copy(sampleTests[1]);
  for (const change of [{ originalUnit: 'mg/L' }, { basis: 'dry weight' }, { qualifier: 'non_detect', originalValue: 'ND' }, { analyte: 'Other analyte' }]) assert.ok(comparisonIssues(first, { ...second, rows: [{ ...second.rows[0], ...change }] }).length > 0);
  const duplicate = { ...second, rows: [...second.rows, { ...second.rows[0], id: 'another-row', analyte: ' EXAMPLE ANALYTE A ' }] };
  assert.deepEqual(duplicateAnalytes(duplicate.rows), ['example analyte a']);
  assert.ok(comparisonIssues(first, duplicate).some(value => value.includes('Repeated analytes')));
  assert.equal(duplicate.rows.length, 2, 'duplicate rows must not merge automatically');
});

test('corrections require reasons and preserve previous originals with expected revision', () => {
  const original = copy(sampleTests[0]);
  const before = copy(original);
  const rows = [{ ...original.rows[0], originalValue: '1.80' }];
  assert.throws(() => correctResults(original, rows, '  ', true, '2026-10-03'), /reason/);
  const corrected = correctResults(original, rows, 'Fixed transcription precision', true, '2026-10-03');
  assert.equal(corrected.rows[0].originalValue, '1.80');
  assert.equal(corrected.history[0].rows[0].originalValue, '1.8');
  assert.equal(corrected.history[0].reason, 'Fixed transcription precision');
  assert.equal(corrected.revision, original.revision, 'save receives the known revision for conflict checking');
  assert.equal(corrected.review, 'user_confirmed');
  assert.deepEqual(original, before);
  rows[0].originalValue = '9';
  assert.equal(corrected.rows[0].originalValue, '1.80', 'saved correction is independent of future draft edits');
});

test('unresolved fields cannot become confirmed merely by checking transcription confirmation', () => {
  const record = copy(sampleTests[0]);
  const rows = [{ ...record.rows[0], originalUnit: '' }];
  const corrected = correctResults(record, rows, 'Unit is unreadable', true, '2026-10-03');
  assert.equal(corrected.review, 'needs_clarification');
  assert.ok(corrected.reviewReason.includes('reported unit'));
  assert.equal(correctResults(record, record.rows, 'Please review', false, '2026-10-03').review, 'unreviewed');
});

test('scoped export retains originals and revisions but omits context unless selected', () => {
  const record = { ...correctResults(sampleTests[0], sampleTests[0].rows, 'Example correction', true, '2026-10-03'), contextSnapshot: { label: 'Example garden', revision: 2, irrigation: 'Example well' } };
  const safe = testExport(record, false);
  assert.equal(safe.synthetic, true);
  assert.equal(Object.hasOwn(safe, 'contextId'), false);
  assert.equal(Object.hasOwn(safe, 'sampleLabel'), false);
  assert.equal(Object.hasOwn(safe, 'contextSnapshot'), false);
  assert.deepEqual(safe.rows, record.rows);
  assert.deepEqual(safe.history, record.history);
  assert.ok(safe.omitted.includes('File contents'));
  assert.equal(testExport(record, true).contextId, record.contextId);
  assert.equal(testExport(record, true).sampleLabel, record.sampleLabel);
  assert.equal(testExport(record, true).contextSnapshot.irrigation, 'Example well');
});

test('garden source snapshots and sample collection periods affect compatibility', () => {
  const first = { ...copy(sampleTests[0]), contextSnapshot: { label: 'Garden', revision: 1, irrigation: 'Example well' } };
  const second = { ...copy(sampleTests[1]), contextSnapshot: { label: 'Garden', revision: 2, irrigation: 'Example utility' } };
  assert.ok(comparisonIssues(first, second).some(issue => issue.includes('irrigation-source')));
  assert.ok(resultIssues({ ...first, collectionEnd: '2026-09-30' }).some(issue => issue.includes('collection end')));
});

test('test lifecycle keeps arranged, collected, awaiting, recorded and follow-up distinct', () => {
  assert.deepEqual(testStatuses, ['draft', 'arranged', 'sampled', 'awaiting', 'recorded', 'followup']);
  const waiting = sampleTests.find(record => record.status === 'awaiting');
  assert.equal(waiting.rows.length, 0);
  assert.equal(waiting.review, 'not_received');
  assert.equal(waiting.expectedDate, '');
});

test('review component has no live writes, persistence or automatic extraction', () => {
  const component = readFileSync(new URL('../components/homeguard/TestsWorkspace.tsx', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('../lib/frontend/home-test-preview.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(component + helper, /fetch\(|localStorage|sessionStorage|supabase|\/api\//);
  assert.doesNotMatch(component + helper, /\u2014/);
  assert.match(component, /A file selection is not an upload receipt/);
  assert.match(component, /confirm the transcription/);
  assert.match(component, /revision: draft\.baseRevision/, 'result edits must send the revision captured with their draft');
});
