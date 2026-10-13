import type { FieldNote } from './explore-preview';

export type HandoffExportKind = 'copied' | 'download-requested' | 'share-completed' | 'print-opened';
export type NoteHandoffSnapshot = {
  id: string; sourceRevision: number; preparedAt: string; body: string;
  scope: { place: boolean; evidence: boolean; photo: false };
  exports?: { kind: HandoffExportKind; at: string }[];
  officialOpenedAt?: string; reportedAt?: string; reference?: string;
};
export const noteHandoffCopy = {
  title: 'Share or prepare an official handoff',
  privacy: 'Choose a copy to share. Preparing it does not publish your note or send a report.',
  scope: 'Only the text below is included. Photos and exact coordinates are excluded.',
  destination: 'Choose the correct topic and jurisdiction on the official site. Check whether reports become public. HALO does not pass your note to that site.',
  changed: 'Your note has changed. This earlier copy stays unchanged. Prepare a new copy to include your edits.',
  revision: 'Prepared from note version',
  submission: 'I submitted this prepared copy through an official channel.',
  reported: 'Submission recorded by you. No agency acknowledgment is connected.',
  saved: 'Prepared copy saved. Review it before sharing.',
  failed: 'The record could not be updated. Review its current version before trying again.',
  exportFailed: 'The device action finished, but its history was not saved. No delivery is confirmed.',
  opened: 'Official link opened. HALO cannot verify whether the page loaded or a form was submitted.',
  archive: 'Archiving keeps this note, photo and history. Previously saved tasks stay in My Week.',
} as const;
export function handoffText(note: FieldNote, scope: Pick<NoteHandoffSnapshot['scope'], 'place' | 'evidence'>) {
  const time = note.observedAt ? `${note.observedAt.replace('T', ' ')} (${note.timezone})` : 'No date supplied';
  const context = scope.evidence && note.evidence?.length ? `\n\nSelected public context:\n${note.evidence.map(item => `${item.title}\n${item.observedAt ?? 'No observation date supplied'}\n${item.scope}`).join('\n\n')}\nPublic references do not establish the cause of this observation.` : '';
  return `${note.title}\n${note.noteType ?? 'Observation'}\n${time}\n${scope.place && note.place ? `Place: ${note.place}\n` : ''}${note.description}${(!note.noteType || note.noteType === 'Observation') ? '\nCause unknown.' : ''}${context}`;
}
export function handoffChanged(note: FieldNote, snapshot: NoteHandoffSnapshot) { return handoffText(note, snapshot.scope) !== snapshot.body; }
export function handoffStatus(note: FieldNote) { return note.status === 'reported' ? 'Submission recorded' : note.status === 'form-opened' ? 'Official link opened' : note.status === 'prepared' ? 'Prepared' : 'Private draft'; }
export const handoffExportLabel: Record<HandoffExportKind, string> = { copied: 'Copied to clipboard', 'download-requested': 'Download requested', 'share-completed': 'Handed to device share sheet', 'print-opened': 'Print preview opened' };
