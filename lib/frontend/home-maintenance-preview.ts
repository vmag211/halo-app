import { validActionDate } from './expanded-preview';
import type { FactorKey } from './factor-preview';

export type MaintenanceEvent = { id: string; kind: 'completed' | 'skipped' | 'snoozed' | 'paused' | 'resumed' | 'replaced' | 'cadence changed'; date: string; due: string; note: string };
export type HomeAsset = {
  id: string; title: string; revision: number; model: string; installed: string; serviced: string; factor: FactorKey;
  instructions: string; basis: 'user' | 'manufacturer' | 'reviewed'; policy: 'calendar' | 'completion'; interval: number;
  unit: 'days' | 'months'; nextDue: string; calendarAnchor: string; endDate: string; lastCompleted: string; snoozedUntil: string;
  status: 'active' | 'paused' | 'replaced'; history: MaintenanceEvent[]; testId: string;
};
export type MoistureObservation = {
  id: string; title: string; revision: number; kind: 'dampness' | 'leak' | 'condensation' | 'humidity' | 'other';
  observedAt: string; timezone: string; room: string; reading: string; unit: string; source: string; note: string;
  photoName: string; photoData: string; assetId: string; testId: string;
};
export const sampleAssets: HomeAsset[] = [{
  id: 'sample-filter', title: 'Kitchen filter upkeep', revision: 1, model: '', installed: '2026-07-01', serviced: '2026-09-01', factor: 'pfas',
  instructions: 'Sample user reminder to review the product instructions. Model and certification have not been supplied.', basis: 'user', policy: 'calendar',
  interval: 1, unit: 'months', nextDue: '2026-10-01', calendarAnchor: '2026-10-01', endDate: '', lastCompleted: '2026-09-01', snoozedUntil: '', status: 'active', testId: '',
  history: [{ id: 'sample-filter-service', kind: 'completed', date: '2026-09-01', due: '2026-09-01', note: 'Sample user-reported service record.' }],
}];
export const sampleObservations: MoistureObservation[] = [{
  id: 'sample-moisture', title: 'Window condensation', revision: 1, kind: 'condensation', observedAt: '2026-09-30T08:30', timezone: 'America/New_York',
  room: 'Sample bathroom', reading: '', unit: '% RH', source: 'Visual observation by household', note: '', photoName: '', photoData: '', assetId: '', testId: '',
}];
export function blankAsset(factor: FactorKey = 'pfas'): HomeAsset {
  return { id: '', title: '', revision: 0, model: '', installed: '', serviced: '', factor, instructions: '', basis: 'user', policy: 'calendar', interval: 1, unit: 'months', nextDue: '', calendarAnchor: '', endDate: '', lastCompleted: '', snoozedUntil: '', status: 'active', history: [], testId: '' };
}
export function blankObservation(): MoistureObservation {
  return { id: '', title: '', revision: 0, kind: 'dampness', observedAt: '', timezone: 'America/New_York', room: '', reading: '', unit: '% RH', source: '', note: '', photoName: '', photoData: '', assetId: '', testId: '' };
}
export function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function advanceDue(date: string, interval: number, unit: HomeAsset['unit'], anchor = ''): string {
  if (!date || !validActionDate(date) || !Number.isInteger(interval) || interval < 1) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  if (unit === 'days') parsed.setUTCDate(parsed.getUTCDate() + interval);
  else {
    const day = anchor && validActionDate(anchor) ? Number(anchor.slice(8, 10)) : parsed.getUTCDate();
    parsed.setUTCDate(1); parsed.setUTCMonth(parsed.getUTCMonth() + interval);
    const lastDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
    parsed.setUTCDate(Math.min(day, lastDay));
  }
  return parsed.toISOString().slice(0, 10);
}
export function assetError(asset: HomeAsset): string | null {
  if (!asset.title.trim() || asset.title.length > 160) return 'Enter a label between 1 and 160 characters.';
  if (![asset.installed, asset.serviced, asset.nextDue, asset.endDate].every(validActionDate)) return 'Choose valid calendar dates.';
  if (!asset.nextDue) return 'Choose the first due date for this routine.';
  if (!Number.isInteger(asset.interval) || asset.interval < 1 || asset.interval > 365) return 'Choose an interval from 1 to 365.';
  if (asset.endDate && asset.endDate < asset.nextDue) return 'The end date must be on or after the first due date.';
  if (asset.installed && asset.serviced && asset.serviced < asset.installed) return 'The service date cannot precede installation.';
  if (asset.basis !== 'user' && !asset.instructions.trim()) return 'Add the instructions or source that supports this interval.';
  return null;
}
export function observationError(record: MoistureObservation): string | null {
  if (!record.title.trim()) return 'Add a short observation label.';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(record.observedAt) || !validActionDate(record.observedAt.slice(0, 10)) || Number(record.observedAt.slice(11, 13)) > 23 || Number(record.observedAt.slice(14, 16)) > 59) return 'Choose a valid observation date and time.';
  try { new Intl.DateTimeFormat('en', { timeZone: record.timezone }); } catch { return 'Enter a valid timezone, for example America/New_York.'; }
  if (record.reading !== '' && (!Number.isFinite(Number(record.reading)) || Number(record.reading) < 0)) return 'Enter a nonnegative measured value, or leave it empty.';
  if (record.reading !== '' && record.unit === '% RH' && Number(record.reading) > 100) return 'Relative humidity must be from 0 to 100 percent.';
  if (record.reading !== '' && (!record.source.trim() || !record.unit.trim())) return 'A measurement needs its original unit and source.';
  return null;
}
/** Preview-only user records. No certification, safety result, or score changes. */
export function maintenanceTransition(asset: HomeAsset, kind: MaintenanceEvent['kind'], date: string, note = '', snooze = ''): HomeAsset {
  if (!date || !validActionDate(date)) throw new Error('Choose a valid occurrence date.');
  if (date > localDay()) throw new Error('An occurrence cannot be recorded in the future.');
  if (kind === 'completed' && ((asset.installed && date < asset.installed) || (asset.lastCompleted && date < asset.lastCompleted))) throw new Error('Completion cannot precede installation or the last recorded completion.');
  if (asset.status === 'replaced') throw new Error('A replaced asset keeps its history and cannot receive new occurrences.');
  if (asset.status === 'paused' && !['resumed', 'replaced'].includes(kind)) throw new Error('Resume this routine before changing an occurrence.');
  if (kind === 'snoozed' && (!snooze || !validActionDate(snooze) || snooze <= date || (asset.endDate && snooze > asset.endDate))) throw new Error('Snooze to a later date within the routine end date.');
  let nextDue = asset.nextDue;
  if (kind === 'completed' || kind === 'skipped') {
    if (!asset.nextDue) throw new Error('This routine has no future occurrence. Edit its cadence to schedule another.');
    const anchor = asset.policy === 'calendar' ? asset.calendarAnchor || asset.nextDue : '';
    nextDue = advanceDue(kind === 'completed' && asset.policy === 'completion' ? date : asset.nextDue, asset.interval, asset.unit, anchor);
    // Calendar routines retain their existing anchor instead of drifting to completion time.
    while (nextDue && nextDue <= date) nextDue = advanceDue(nextDue, asset.interval, asset.unit, anchor);
    if (asset.endDate && nextDue > asset.endDate) nextDue = '';
  }
  return { ...asset, nextDue,
    lastCompleted: kind === 'completed' ? date : asset.lastCompleted,
    serviced: kind === 'completed' ? date : asset.serviced,
    snoozedUntil: kind === 'snoozed' ? snooze : ['completed', 'skipped', 'replaced'].includes(kind) ? '' : asset.snoozedUntil,
    status: kind === 'paused' ? 'paused' : kind === 'resumed' ? 'active' : kind === 'replaced' ? 'replaced' : asset.status,
    history: [...asset.history, { id: `${asset.id}-${asset.history.length + 1}`, kind, date, due: asset.snoozedUntil || asset.nextDue, note: kind === 'snoozed' ? `${note}${note ? ' ' : ''}Moved this occurrence to ${snooze}.` : note }],
  };
}
export function scheduleDescription(asset: HomeAsset): string {
  const unit = asset.interval === 1 ? asset.unit.slice(0, -1) : asset.unit;
  return `Every ${asset.interval} ${unit}, ${asset.policy === 'calendar' ? 'on the fixed calendar schedule' : 'after the recorded completion'}. ${asset.endDate ? `Ends ${asset.endDate}.` : 'No end date.'}`;
}
export type SummarySection = 'scores' | 'factors' | 'tests' | 'actions' | 'maintenance' | 'observations' | 'gardens';
export type SummarySelection = {
  purpose: string; start: string; end: string; sections: Record<SummarySection, boolean>; categories: boolean; location: boolean; notes: boolean; attachments: boolean; appendix: boolean; excluded: string[];
};
export const defaultSummarySelection: SummarySelection = {
  purpose: 'Household review', start: '2026-01-01', end: '2026-12-31', sections: { scores: true, factors: true, tests: false, actions: false, maintenance: false, observations: false, gardens: false },
  categories: false, location: false, notes: false, attachments: false, appendix: false, excluded: [],
};
export function summaryDateError(selection: SummarySelection): string | null {
  if (!selection.start || !selection.end || !validActionDate(selection.start) || !validActionDate(selection.end)) return 'Choose valid start and end dates.';
  if (selection.end < selection.start) return 'The end date must be on or after the start date.';
  if (!Object.values(selection.sections).some(Boolean)) return 'Choose at least one section.';
  return null;
}
export function withinSummaryDates(date: unknown, selection: SummarySelection): boolean {
  if (typeof date !== 'string' || date.length < 10) return true;
  const day = date.slice(0, 10);
  return !validActionDate(day) || (day >= selection.start && day <= selection.end);
}
export function escapeSummaryHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function summaryHtml(lines: string[]): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HALO household summary</title><style>body{color:#111;background:#fff;max-width:760px;margin:40px auto;padding:20px;font:16px/1.6 Arial,sans-serif}h1{font-size:28px}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0;padding:0}@page{margin:18mm}}</style></head><body><h1>HALO household summary</h1>${lines.map(line => `<p>${escapeSummaryHtml(line)}</p>`).join('')}</body></html>`;
}
