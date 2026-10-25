/**
 * F04: an untouched result row is not a result. Entering results on a home
 * test and saving the one blank row must not mark the test "Result recorded"
 * or make My Week say "Results entered by you". A genuine partial
 * transcription is kept as an incomplete record that does not complete the
 * milestone. Unconfirmed transcriptions stay allowed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { homepageAttention } = await loadFrontend('homepage-preview');
const { applyResultEntry, blankResultRow, effectiveTestStatus, emptyResult, emptyTest, enteredResultRows, hasRecordedResult, recordedResultRow, resultIssues } = await loadFrontend('home-test-preview');
const { resolveWeekActivity, weekProgressEntries } = await loadFrontend('week-activity');
const { weekSourceSnapshots } = await loadFrontend('week-planning');
const { datedWeekRecords } = await loadFrontend('week-records');

const TODAY = '2026-10-25';
const base = (over = {}) => ({ ...emptyTest('kitchen'), title: 'Kitchen tap', kind: 'water', purpose: 'Check the tap', contextId: 'home-1', medium: 'water', method: 'EPA 200.8', collectionStart: '2026-10-01', sampleLabel: 'Kitchen', status: 'sampled', ...over });
const row = (over = {}) => ({ ...emptyResult(`row-${Math.random().toString(16).slice(2)}`), ...over });
const draft = (rows, over = {}) => ({ rows, reason: '', confirmed: false, ...over });
const action = (id) => ({ id: `a-${id}`, key: `home:${id}`, title: 'Follow up', origin: 'Homeguard', reason: '', date: '', state: 'saved', revision: 1 });

test('completely blank: the one untouched row saves nothing, and the record stays short of a result everywhere', () => {
  const record = base();
  assert.equal(blankResultRow(emptyResult()), true);
  const out = applyResultEntry(record, draft([emptyResult()]), TODAY);
  assert.equal(out.record, undefined, 'nothing is saved');
  assert.deepEqual(out.errors, ['Enter at least one result from your report, or cancel to keep this test without results.']);
  // Whitespace only is still blank.
  assert.equal(applyResultEntry(record, draft([row({ analyte: '   ', originalValue: ' ' })]), TODAY).record, undefined);
  // A record stored by the old build with one blank row is read as having no result.
  const legacy = base({ status: 'recorded', rows: [emptyResult()], review: 'needs_clarification' });
  assert.equal(hasRecordedResult(legacy.rows), false);
  assert.deepEqual(enteredResultRows(legacy.rows), []);
  const week = resolveWeekActivity(action('kitchen'), { tests: [legacy] });
  assert.equal(week.milestones.find((m) => m.label === 'Result entered').done, false);
  assert.notEqual(week.subtitle, 'Results entered by you');
  assert.ok(!resultIssues(record, [emptyResult()]).some((issue) => issue.startsWith('Row 1')), 'an untouched row raises no row issues');
});

test('partial transcription: saved, flagged for clarification, not "Result recorded"; My Week says entry is not finished', () => {
  const record = base();
  const partial = row({ analyte: 'Lead' });
  const out = applyResultEntry(record, draft([partial, emptyResult()]), TODAY);
  assert.ok(out.record, out.errors.join(' '));
  assert.equal(out.record.rows.length, 1, 'the untouched second row is dropped');
  assert.equal(out.record.rows[0].analyte, 'Lead');
  assert.equal(out.record.review, 'needs_clarification');
  assert.equal(out.record.status, 'sampled', 'status does not advance to recorded');
  assert.equal(recordedResultRow(partial), false);
  assert.equal(hasRecordedResult(out.record.rows), false);
  const week = resolveWeekActivity(action('kitchen'), { tests: [out.record] });
  assert.equal(week.milestones[2].done, false);
  assert.equal(week.subtitle, 'Result entry not finished');
  const entry = weekProgressEntries({ tests: [out.record] }, []).find((item) => item.id === 'test:kitchen');
  assert.equal(entry.subtitle, 'Finish entering the result');
  // A value with no analyte is partial too.
  assert.equal(hasRecordedResult([row({ originalValue: '3', qualifier: 'measured' })]), false);
  // Still listed as awaiting its result in My Week's dated records.
  const dated = datedWeekRecords({ tests: [{ ...out.record, expectedDate: '2026-10-30', revision: 2 }] }, []);
  assert.ok(dated.some((item) => item.kind === 'test-result'), JSON.stringify(dated));
});

test('numeric result, unconfirmed: allowed, recorded, and My Week says results were entered', () => {
  const record = base();
  const out = applyResultEntry(record, draft([row({ analyte: 'Lead', originalValue: '3.2', originalUnit: 'ug/L', qualifier: 'measured', reportDate: '2026-10-05' })]), TODAY);
  assert.ok(out.record);
  assert.equal(out.record.status, 'recorded');
  assert.equal(out.record.review, 'unreviewed', 'an unconfirmed transcription is saved, not refused');
  const week = resolveWeekActivity(action('kitchen'), { tests: [out.record] });
  assert.equal(week.milestones[2].done, true);
  assert.equal(week.subtitle, 'Results entered by you');
  const confirmed = applyResultEntry(record, draft(out.record.rows, { confirmed: true }), TODAY);
  assert.equal(confirmed.record.review, 'user_confirmed');
});

test('non-detect, less than a limit, not reported and numeric zero each state a result without a number', () => {
  for (const [qualifier, extra] of [['non_detect', {}], ['less_than', { limit: '0.5', limitUnit: 'ug/L' }], ['absent', {}], ['zero', { originalValue: '0' }]]) {
    const r = row({ analyte: 'PFOS', qualifier, ...extra });
    assert.equal(recordedResultRow(r), true, qualifier);
    const out = applyResultEntry(base(), draft([r]), TODAY);
    assert.equal(out.record.status, 'recorded', qualifier);
  }
  assert.equal(recordedResultRow(row({ analyte: 'PFOS', qualifier: 'less_than' })), false, 'less than with no limit is partial');
  assert.equal(recordedResultRow(row({ analyte: 'PFOS', qualifier: 'measured' })), false, 'measured with no value is partial');
  assert.equal(blankResultRow(row({ qualifier: 'non_detect' })), false, 'choosing a qualifier is an entry');
});

test('corrected: a correction needs a reason, keeps the earlier rows in history, and correcting down to partial drops the milestone', () => {
  const first = applyResultEntry(base(), draft([row({ analyte: 'Lead', originalValue: '3.2', originalUnit: 'ug/L', qualifier: 'measured', reportDate: '2026-10-05' })]), TODAY).record;
  assert.equal(first.status, 'recorded');
  const noReason = applyResultEntry(first, draft([{ ...first.rows[0], originalValue: '2.3' }]), TODAY);
  assert.deepEqual(noReason.errors, ['Give a reason for this correction.']);
  const fixed = applyResultEntry(first, draft([{ ...first.rows[0], originalValue: '2.3' }, emptyResult('row-extra')], { reason: 'Typo' }), TODAY).record;
  assert.equal(fixed.rows.length, 1);
  assert.equal(fixed.rows[0].originalValue, '2.3');
  assert.equal(fixed.history.length, 1);
  assert.equal(fixed.history[0].rows[0].originalValue, '3.2');
  assert.equal(fixed.history[0].reason, 'Typo');
  assert.equal(fixed.status, 'recorded');
  const backToPartial = applyResultEntry(fixed, draft([{ ...fixed.rows[0], originalValue: '', qualifier: 'unknown' }], { reason: 'Value was misread' }), TODAY).record;
  assert.equal(hasRecordedResult(backToPartial.rows), false);
  assert.equal(backToPartial.status, 'sampled', 'a recorded test whose result is withdrawn returns to its collected stage');
  assert.equal(backToPartial.history.length, 2);
  // A follow-up stage is the person's own and is kept.
  const followup = applyResultEntry({ ...fixed, status: 'followup' }, draft(fixed.rows, { reason: 'Recheck' }), TODAY).record;
  assert.equal(followup.status, 'followup');
});

test('a newly recorded result is a source change for a saved My Week task; a blank or partial save is not', () => {
  const actions = [action('kitchen')];
  const before = weekSourceSnapshots(actions, { tests: [{ ...base(), revision: 1 }] });
  assert.equal(before[0].hasResult, false);
  const partial = weekSourceSnapshots(actions, { tests: [{ ...base(), revision: 2, rows: [row({ analyte: 'Lead' })] }] });
  assert.equal(partial[0].hasResult, false);
  const legacyBlank = weekSourceSnapshots(actions, { tests: [{ ...base(), revision: 2, rows: [emptyResult()] }] });
  assert.equal(legacyBlank[0].hasResult, false);
  const recorded = weekSourceSnapshots(actions, { tests: [{ ...base(), revision: 3, rows: [row({ analyte: 'Lead', originalValue: '1' })] }] });
  assert.equal(recorded[0].hasResult, true);
});

test('a record an earlier build saved as "recorded" with only a blank or partial row reads as its real stage and stays in continuation views', () => {
  const legacy = base({ status: 'recorded', rows: [emptyResult()], expectedDate: '2026-10-30', revision: 1 });
  assert.equal(effectiveTestStatus(legacy), 'sampled');
  assert.equal(effectiveTestStatus({ ...legacy, collectionStart: '', arrangedByUser: true }), 'arranged');
  assert.equal(effectiveTestStatus({ ...legacy, awaitingRecorded: true }), 'awaiting');
  assert.equal(effectiveTestStatus({ ...legacy, rows: [row({ analyte: 'Lead' })] }), 'sampled');
  assert.equal(effectiveTestStatus(base({ status: 'recorded', rows: [row({ analyte: 'Lead', originalValue: '1' })] })), 'recorded');
  assert.equal(effectiveTestStatus(base({ status: 'followup', rows: [] })), 'followup');
  assert.ok(weekProgressEntries({ tests: [legacy] }, []).some((item) => item.id === 'test:kitchen'));
  assert.ok(datedWeekRecords({ tests: [legacy] }, []).some((item) => item.kind === 'test-result'));
});

test('homepage attention calls a partial entry unfinished and a recorded one a report to review', () => {
  const partial = base({ revision: 1, rows: [row({ analyte: 'Lead' })], review: 'needs_clarification' });
  const recorded = base({ id: 'other', revision: 1, status: 'recorded', rows: [row({ analyte: 'Lead', originalValue: '1' })], review: 'unreviewed' });
  const items = homepageAttention([], {}, [], { tests: [partial, recorded, base({ id: 'blank', rows: [emptyResult()] })] }, TODAY, 'America/New_York');
  assert.equal(items.find((item) => item.id === 'report:kitchen').label, 'Result entry not finished');
  assert.equal(items.find((item) => item.id === 'report:other').label, 'Recorded report needs your review');
  assert.equal(items.find((item) => item.id === 'report:blank'), undefined);
});
