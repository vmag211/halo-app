/** Private, visit-local wireframe records. These are not provider or agency outcomes. */
export type EvidenceReference = { recordId: string; title: string; layer: string; observedAt: string | null; scope: string };
export type Engagement = {
  id: string; revision: number; title: string; organizer: string; cause: string;
  url: string; place: string; date: string; status: 'Considering' | 'Contacted' | 'Confirmed by me' | 'Participated' | 'Follow-up' | 'Closed';
  statusDate: string; participatedOn?: string; hours: string; preparation: string; outcome: string; reference: string; followupDate: string;
  history: { status: string; date: string; note: string }[];
};
export const noEngagements: Engagement[] = [];
export const blankEngagement = (): Engagement => ({ id: '', revision: 0, title: '', organizer: '', cause: 'Water', url: '', place: '', date: '', status: 'Considering', statusDate: '', participatedOn: '', hours: '', preparation: '', outcome: '', reference: '', followupDate: '', history: [] });
export type OutcomeRecord = {
  id: string; revision: number; title: string; goal: string;
  status: 'Open' | 'Working on it' | 'Waiting for a response' | 'Result recorded' | 'Closed without a result';
  date: string; result: string; reference: string; nextStep: string; followupDate: string;
  history: { status: string; date: string; result: string }[];
};
export const noOutcomes: OutcomeRecord[] = [];
export const blankOutcome = (id: string, title: string, goal: string): OutcomeRecord => ({ id, revision: 0, title, goal, status: 'Open', date: '', result: '', reference: '', nextStep: '', followupDate: '', history: [] });
export type ProjectRecord = { id: string; revision: number; title: string; status: 'Active' | 'Paused' | 'Completed'; goal: string; stepNotes: Record<string, string>; outcome: string; reviewDate: string; history: { status: string; note: string }[]; guideId?:string;guideVersion?:string;guide?:import('./production/explore-service').ProductionProjectGuide };
export const noProjects: ProjectRecord[] = [];

export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function futureReportedDay(value: string): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return Boolean(value && value > today);
}
export function safePublicLink(value: string): string | null {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function engagementError(record: Engagement): string | null {
  if (!record.title.trim() || !record.organizer.trim()) return 'Add the opportunity name and organizer.';
  if (record.title.length > 160 || record.organizer.length > 160 || record.preparation.length > 2000 || record.outcome.length > 2000) return 'Keep the name short and each note under 2,000 characters.';
  if (record.url && !safePublicLink(record.url)) return 'Use an HTTPS organizer link without sign-in details.';
  if ([record.date, record.statusDate, record.followupDate, record.participatedOn].some(day => day && !validDay(day))) return 'Choose valid calendar dates.';
  if (record.participatedOn && futureReportedDay(record.participatedOn)) return 'Participation must use a date that has actually happened.';
  if (record.participatedOn && !['Participated','Follow-up','Closed'].includes(record.status)) return 'Choose a participation or follow-up status for a recorded participation date.';
  if (record.status !== 'Considering' && !record.statusDate) return 'Add the date of the update you are recording.';
  if (futureReportedDay(record.statusDate)) return 'An update about something that happened cannot have a future date. Keep the activity date for future plans.';
  if (record.hours && (!/^\d+(\.\d+)?$/.test(record.hours) || !Number.isFinite(Number(record.hours)) || Number(record.hours) < 0 || Number(record.hours) > 1000)) return 'Use hours from 0 to 1,000, or leave them blank.';
  if (record.status === 'Participated' && !record.outcome.trim()) return 'Describe what you actually did before recording participation.';
  return null;
}
export function outcomeError(record: OutcomeRecord): string | null {
  if (!record.goal.trim() || record.goal.length > 500) return 'Describe the answer or result you want in 500 characters or fewer.';
  if ([record.date, record.followupDate].some(day => day && !validDay(day))) return 'Choose valid calendar dates.';
  if (record.status !== 'Open' && !record.date) return 'Add the date of the update you are recording.';
  if (futureReportedDay(record.date)) return 'An update about something that happened cannot have a future date. Use the check-back date for future plans.';
  if (record.status === 'Result recorded' && !record.result.trim()) return 'Describe the information received or action completed.';
  if (record.result.length > 2000 || record.nextStep.length > 1000 || record.reference.length > 160) return 'Shorten the result, next step or reference before saving.';
  return null;
}
