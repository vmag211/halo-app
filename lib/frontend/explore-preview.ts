import type { EvidenceReference } from './explore-workspace';

/** Evergreen review examples. No live directory, event feed, bookings or reporting service. */
export const exploreSections = { opportunities: 'Get involved', community: 'Your community', organizations: 'Get involved', projects: 'Projects', observations: 'My notes', outreach: 'Ask a question' } as const;
export type ExploreSection = keyof typeof exploreSections;
export const recipients = ['Utility', 'Landlord', 'Representative', 'Local office'] as const;
export type Recipient = typeof recipients[number];
export const outreachTemplate = (recipient: Recipient, purpose: string) => `Hello,\n\nI would like to ${purpose.toLowerCase()}${recipient === 'Utility' ? ' about my water service' : recipient === 'Landlord' ? ' about the home I rent' : ' about local environmental information'}.\n\nCould you point me to the relevant records, their dates and the best person to answer my questions?\n\nThank you.`;
export type FieldNote = { id: string; title: string; revision: number; kind: string; observedAt: string; timezone: string; place: string; description: string; status: 'draft' | 'prepared' | 'reported'; reference: string; noteType?: 'Observation' | 'Question' | 'Idea' | 'Conversation'; pinned?: boolean; evidence?: EvidenceReference[] };
export const initialFieldNotes: FieldNote[] = [{ id: 'demo-field-note', title: 'A change near the walking path', revision: 1, kind: 'Appearance', observedAt: '2026-10-01T16:30', timezone: 'America/New_York', place: 'Example creek path', description: 'Fictional note: the water looked cloudier than on my previous visit. The cause is unknown.', status: 'draft', reference: '' }];
export const blankFieldNote = (): FieldNote => ({ id: '', title: '', revision: 0, kind: 'Appearance', observedAt: '', timezone: 'America/New_York', place: '', description: '', status: 'draft', reference: '' });
export function fieldNoteError(note: FieldNote): string | null {
  if (!note.title.trim() || !note.description.trim()) return 'Add a title and a factual description.';
  if (note.title.length > 160 || note.description.length > 3000) return 'Keep the title under 160 characters and the description under 3,000.';
  if ((!note.noteType || note.noteType === 'Observation' || note.observedAt) && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(note.observedAt) || !Number.isFinite(new Date(note.observedAt).getTime()))) return 'Choose a valid observation date and time.';
  try { new Intl.DateTimeFormat('en', { timeZone: note.timezone }); } catch { return 'Enter a valid timezone.'; }
  return null;
}
