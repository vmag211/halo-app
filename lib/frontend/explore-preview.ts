import type { EvidenceReference } from './explore-workspace';

/** Evergreen review examples. No live directory, event feed, bookings or reporting service. */
export const exploreSections = { opportunities: 'Volunteer', community: 'Your community', organizations: 'Organizations', projects: 'Ways to help', observations: 'My notes', outreach: 'Ask a question' } as const;
export type ExploreSection = keyof typeof exploreSections;
export const exploreCauses = ['All causes', 'Water', 'Habitats', 'Community'] as const;
export const organizations = [
  { id: 'demo-creek', title: 'Creek Care Collective', cause: 'Water', area: 'Example County', mission: 'An example group organizing supervised community activities and water education.', activities: 'Supervised litter walks, educational sessions and questions for local water providers.', access: 'Contact the organizer to confirm access needs.', checked: '2026-10-01', reviewed: 'Not verified, fictional listing' },
  { id: 'demo-habitat', title: 'Neighborhood Habitat Circle', cause: 'Habitats', area: 'Example County', mission: 'An example group helping neighbors learn about habitat projects.', activities: 'Garden planning sessions and community learning.', access: 'Accessibility information not supplied.', checked: '2026-09-24', reviewed: 'Not verified, fictional listing' },
  { id: 'demo-community', title: 'Community Environment Forum', cause: 'Community', area: 'Another County', mission: 'An example forum for environmental information and public questions.', activities: 'Public conversations and source-reading workshops.', access: 'Accessibility information not supplied.', checked: '2026-09-15', reviewed: 'Not verified, fictional listing' },
];
export const projects = [
  { id: 'demo-water-project', title: 'Get to know your water', cause: 'Water', effort: 'Three short sessions, at your pace', description: 'Organize your questions and find the right source to answer them.', suitability: 'Renters, owners and private-water households. No sampling equipment required.', materials: 'Your questions and any records you already have.', constraints: 'Use provider or laboratory instructions for any testing. This planning example does not measure water quality.', steps: ['Write down what you want to understand about your water.', 'Review a dated source or the test records you already have.', 'Choose a provider, lab or public resource to ask.', 'Record what you learned and choose a follow-up.'] },
  { id: 'demo-habitat-project', title: 'Plan a small habitat space', cause: 'Habitats', effort: 'A planning session and one follow-up', description: 'Prepare a practical question for a local garden or habitat resource.', suitability: 'People with a container, garden or shared growing space.', materials: 'A description of the space and permission to use it.', constraints: 'Confirm local suitability, permissions and plant choices with a qualified resource before starting work.', steps: ['Describe the space, sunlight and water source you know about.', 'Check permission and the time you can give.', 'Prepare questions for a local Extension or habitat resource.', 'Save a next step after reviewing their advice.'] },
];
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
