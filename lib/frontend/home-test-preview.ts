/** Synthetic design-review records. No live client, interpretation or unit conversion. */
export const testKinds = ['water', 'radon', 'lead', 'soil'] as const;
export type TestKind = typeof testKinds[number];
export const testStatuses = ['draft', 'arranged', 'sampled', 'awaiting', 'recorded', 'followup'] as const;
export type TestStatus = typeof testStatuses[number];
export const testStatusLabels: Record<TestStatus, string> = { draft: 'Draft', arranged: 'Arranged', sampled: 'Sample collected', awaiting: 'Awaiting result', recorded: 'Result recorded', followup: 'Follow-up' };
export const testContexts = [
  { id: 'sample-current-home', label: 'Example home', state: 'Current home' },
  { id: 'sample-previous-home', label: 'Previous example home', state: 'Archived home' },
  { id: 'demo-garden', label: 'Back garden', state: 'Garden site' },
] as const;
export const resultQualifiers = { measured: 'Reported numeric value', less_than: 'Less than (<)', non_detect: 'Non-detect (ND)', zero: 'Reported numeric zero', absent: 'Result not reported', unknown: 'Qualifier unclear' } as const;
export type TestResultRow = {
  id: string; analyte: string; originalValue: string; originalUnit: string;
  qualifier: keyof typeof resultQualifiers; limit: string; limitUnit: string;
  basis: string; reportDate: string; reportReference: string;
};
export type TestRevision = { revision: number; date: string; reason: string; rows: TestResultRow[]; review: TestRecord['review'] };
export type TestRecord = {
  id: string; title: string; revision: number; kind: TestKind; purpose: string;
  contextId: string; contextSnapshot?: { label: string; revision?: number; irrigation?: string }; medium: string; provider: string; plannedDate: string;
  collectionStart: string; collectionEnd: string; sampleLabel: string; method: string;
  expectedDate: string; status: TestStatus; arrangedByUser?: boolean; awaitingRecorded?: boolean; rows: TestResultRow[];
  review: 'not_received' | 'unreviewed' | 'needs_clarification' | 'user_confirmed';
  reviewReason: string; history: TestRevision[]; archived: boolean;
};
export function emptyTest(id = 'draft-test'): TestRecord {
  return { id, title: '', revision: 1, kind: 'water', purpose: '', contextId: '', medium: '', provider: '', plannedDate: '', collectionStart: '', collectionEnd: '', sampleLabel: '', method: '', expectedDate: '', status: 'draft', rows: [], review: 'not_received', reviewReason: '', history: [], archived: false };
}
export function emptyResult(id = 'row-1'): TestResultRow {
  return { id, analyte: '', originalValue: '', originalUnit: '', qualifier: 'unknown', limit: '', limitUnit: '', basis: '', reportDate: '', reportReference: '' };
}
export function validTestDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function testDraftErrors(record: TestRecord): string[] {
  const errors: string[] = [];
  if (!record.title.trim()) errors.push('Give this test a label.');
  if (!record.purpose.trim()) errors.push('Enter the purpose of this test.');
  if (!record.contextId) errors.push('Choose a home or site context.');
  if (!record.medium) errors.push('Choose the sample medium, or choose Unknown.');
  for (const [field, value] of [['Proposed date', record.plannedDate], ['Collection start', record.collectionStart], ['Collection end', record.collectionEnd], ['Expected result date', record.expectedDate]]) {
    if (!validTestDate(value)) errors.push(`${field} must be a real calendar date.`);
  }
  if (record.collectionStart && record.collectionEnd && record.collectionEnd < record.collectionStart) errors.push('Collection end cannot be before collection start.');
  if (record.collectionStart && record.expectedDate && record.expectedDate < record.collectionStart) errors.push('Expected result date cannot be before collection start.');
  return errors;
}
export function resultIssues(record: TestRecord, rows = record.rows): string[] {
  const issues: string[] = [];
  if (!rows.length) issues.push('No result rows have been entered.');
  if (!record.collectionStart) issues.push('Collection date is missing.');
  if (!record.method.trim()) issues.push('Collection or test method is not known.');
  if (record.medium === 'unknown' || !record.medium) issues.push('Sample medium is unknown.');
  if (record.kind === 'radon' && !record.collectionEnd) issues.push('Radon collection end is missing.');
  rows.forEach((row, index) => {
    const prefix = `Row ${index + 1}: `;
    if (!row.analyte.trim()) issues.push(`${prefix}analyte is missing.`);
    if (!row.reportDate || !validTestDate(row.reportDate)) issues.push(`${prefix}report date is missing or invalid.`);
    if (row.reportDate && record.collectionStart && row.reportDate < record.collectionStart) issues.push(`${prefix}report date precedes collection.`);
    if (row.reportDate && record.collectionEnd && row.reportDate < record.collectionEnd) issues.push(`${prefix}report date precedes the collection end.`);
    if (row.qualifier === 'unknown') issues.push(`${prefix}qualifier needs clarification.`);
    if (row.qualifier === 'absent') issues.push(`${prefix}no result was reported.`);
    if (!row.originalValue.trim() && row.qualifier !== 'absent') issues.push(`${prefix}original reported text is missing.`);
    if (!row.originalUnit.trim() && row.qualifier !== 'absent') issues.push(`${prefix}reported unit is missing.`);
    if (row.qualifier === 'measured' || row.qualifier === 'zero') {
      const value = numericResult(row);
      if (value === null) issues.push(`${prefix}reported numeric value is not a finite nonnegative number.`);
      if (row.qualifier === 'zero' && value !== 0) issues.push(`${prefix}the numeric-zero qualifier requires a reported value of zero.`);
    }
    if (row.qualifier === 'less_than' && !row.limit.trim()) issues.push(`${prefix}less-than reporting limit is missing.`);
    if (row.limit.trim() && (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(row.limit.trim()) || !Number.isFinite(Number(row.limit)))) issues.push(`${prefix}reporting limit needs clarification.`);
    if (row.limit.trim() && !row.limitUnit.trim()) issues.push(`${prefix}limit unit is missing.`);
    if (['soil', 'tissue'].includes(record.medium) && !row.basis.trim()) issues.push(`${prefix}sample basis is needed for this medium.`);
  });
  return issues;
}
export function duplicateAnalytes(rows: TestResultRow[]): string[] {
  const names = rows.map(row => row.analyte.trim().toLowerCase()).filter(Boolean);
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}
export function numericResult(row: TestResultRow): number | null {
  if (!['measured', 'zero'].includes(row.qualifier) || !row.originalValue.trim()) return null;
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(row.originalValue.trim())) return null;
  const value = Number(row.originalValue);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
export function comparisonIssues(first: TestRecord, second: TestRecord): string[] {
  const issues: string[] = [];
  if (first.id === second.id) issues.push('Choose a different test record.');
  if (first.contextId !== second.contextId) issues.push('Different home or site contexts.');
  if (first.contextSnapshot?.irrigation !== second.contextSnapshot?.irrigation) issues.push('Different or missing irrigation-source context snapshots.');
  if (first.kind !== second.kind) issues.push('Different test kinds.');
  if (!first.medium || first.medium === 'unknown' || first.medium !== second.medium) issues.push('Different or unknown sample media.');
  if (!first.method.trim() || first.method.trim().toLowerCase() !== second.method.trim().toLowerCase()) issues.push('Different or unknown test methods.');
  if (!first.sampleLabel.trim() || first.sampleLabel.trim().toLowerCase() !== second.sampleLabel.trim().toLowerCase()) issues.push('Different or unknown sample locations.');
  if (resultIssues(first).length || resultIssues(second).length) issues.push('One or both records still need result clarification.');
  if (first.review !== 'user_confirmed' || second.review !== 'user_confirmed') issues.push('Both transcriptions must be confirmed by the user.');
  if (duplicateAnalytes(first.rows).length || duplicateAnalytes(second.rows).length) issues.push('Repeated analytes need a separate sample comparison.');
  if (first.rows.length !== second.rows.length) issues.push('The records contain different analyte sets.');
  for (const row of first.rows) {
    const match = second.rows.find(candidate => candidate.analyte.trim().toLowerCase() === row.analyte.trim().toLowerCase());
    if (!match) issues.push(`${row.analyte || 'A row'} has no matching analyte.`);
    else {
      if (row.originalUnit.trim() !== match.originalUnit.trim()) issues.push(`${row.analyte}: original units differ; no conversion is available.`);
      if (row.basis.trim().toLowerCase() !== match.basis.trim().toLowerCase()) issues.push(`${row.analyte}: sample bases differ.`);
      if (numericResult(row) === null || numericResult(match) === null) issues.push(`${row.analyte}: censored, missing or unclear results cannot be treated as exact numbers.`);
    }
  }
  return [...new Set(issues)];
}
export function correctResults(record: TestRecord, rows: TestResultRow[], reason: string, confirmed: boolean, date: string): TestRecord {
  if (!reason.trim()) throw new Error('A correction reason is required.');
  const issues = resultIssues(record, rows);
  return { ...record, rows: rows.map(row => ({ ...row })), review: issues.length ? 'needs_clarification' : confirmed ? 'user_confirmed' : 'unreviewed', reviewReason: issues.join(' '), history: [...record.history, { revision: record.revision, date, reason: reason.trim(), rows: record.rows.map(row => ({ ...row })), review: record.review }] };
}
export function testExport(record: TestRecord, includeContext: boolean) {
  return { format: 'HALO synthetic test review', schemaVersion: 1, synthetic: true, title: record.title, kind: record.kind, purpose: record.purpose, status: record.status, revision: record.revision, medium: record.medium, collectionStart: record.collectionStart, collectionEnd: record.collectionEnd, method: record.method, provider: record.provider || 'User-entered', ...(includeContext ? { contextId: record.contextId, contextSnapshot: record.contextSnapshot, sampleLabel: record.sampleLabel } : {}), review: record.review, reviewReason: record.reviewReason, rows: record.rows, history: record.history, omitted: ['File contents', ...(includeContext ? [] : ['Home or site context', 'Sample location'])], caveat: 'Synthetic wireframe record. Original values are uninterpreted and never change a HALO score.' };
}
const waterRow = { ...emptyResult(), analyte: 'Example analyte A', originalValue: '1.8', originalUnit: 'µg/L', qualifier: 'measured' as const, reportDate: '2026-09-26', reportReference: 'DEMO-026' };
const waterBase: TestRecord = { ...emptyTest('test-water-september'), title: 'Kitchen tap, September', kind: 'water', purpose: 'Keep an example household report', contextId: 'sample-current-home', medium: 'water', provider: 'Example Lab (fictional)', plannedDate: '2026-09-20', collectionStart: '2026-09-22', collectionEnd: '2026-09-22', sampleLabel: 'Kitchen tap', method: 'Example method A', status: 'recorded', rows: [waterRow], review: 'user_confirmed' };
export const syntheticTests: TestRecord[] = [
  waterBase,
  { ...waterBase, id: 'test-water-june', title: 'Kitchen tap, June', plannedDate: '2026-06-01', collectionStart: '2026-06-02', collectionEnd: '2026-06-02', rows: [{ ...waterRow, originalValue: '2.1', reportDate: '2026-06-07', reportReference: 'DEMO-007' }] },
  { ...emptyTest('test-radon'), title: 'Lower-level radon test', kind: 'radon', purpose: 'Track an example home test', contextId: 'sample-current-home', medium: 'air', provider: 'Example kit provider (fictional)', plannedDate: '2026-09-28', collectionStart: '2026-09-28', collectionEnd: '2026-09-30', sampleLabel: 'Lower-level room', method: 'Example short-duration kit', status: 'awaiting' },
  { ...emptyTest('test-soil'), title: 'Garden soil report', kind: 'soil', purpose: 'Retain a sample report with an unclear unit', contextId: 'demo-garden', medium: 'soil', collectionStart: '2026-09-18', sampleLabel: 'Raised bed', method: 'User-reported sample', status: 'recorded', rows: [{ ...emptyResult(), analyte: 'Example analyte B', originalValue: '< 0.5', qualifier: 'less_than', limit: '0.5', basis: '', reportDate: '2026-09-24' }], review: 'needs_clarification', reviewReason: 'Reported unit and soil sample basis are missing.' },
];
export const sampleTests = syntheticTests;
