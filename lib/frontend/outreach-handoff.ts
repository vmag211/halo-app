import { outreachTemplate, recipients, type Recipient } from './explore-preview';

/**
 * Carrying a selected organizer from Get involved into the outreach draft.
 *
 * An organizer question uses the existing "Local office" recipient class and the
 * "Volunteering" topic, both already accepted by `contacts.resolve`,
 * `outreach.context` and `outreach.prepare`, so no service input changes. Only the
 * Local office letter is written: other recipients' drafts are never touched. A
 * Local office letter the person has already worked on is replaced only after an
 * explicit choice. Nothing here sends anything; the person still reviews the
 * recipient and copies the message.
 */
export const organizerRecipient: Recipient = 'Local office';
export const organizerTopic = 'Volunteering';
export const defaultOutreachSubject = 'A question about local environmental information';
const outreachPurposes = ['Request information', 'Ask about testing options', 'Request a follow-up'];

export type OrganizerContext = { id: string; organizer: string; program: string; area: string; url: string };
export type OrganizerHandoff = OrganizerContext & { email: string; question: string };
export type OutreachLetter = { name: string; email: string; reviewedFor: string; body: string; subject: string; notes: { id: string }[]; organizer?: OrganizerContext };
export type OrganizerResource = { id: string; title: string; organizer: string; area: string; url: string; contact?: string };
export type HandoffDecision = 'apply' | 'already' | 'choose';

const clean = (value: string) => value.replace(/\u2014/g, ',');
const NEWLINE = String.fromCharCode(10);
// Control, line and paragraph separators would make a subject or name multi-line, which outreach.prepare refuses.
const oneLine = (value: string) => value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ');
const limit = (value: unknown, max: number, lines = false) => {
  const text = clean(String(value ?? ''));
  return Array.from((lines ? text.split(NEWLINE).map(oneLine).join(NEWLINE) : oneLine(text)).trim()).slice(0, max).join('');
};

export const blankOutreachLetter = (recipient: Recipient): OutreachLetter => ({ name: '', email: '', reviewedFor: '', body: outreachTemplate(recipient, 'Request information'), subject: defaultOutreachSubject, notes: [] });
export const blankOutreachLetters = () => Object.fromEntries(recipients.map(item => [item, blankOutreachLetter(item)])) as Record<Recipient, OutreachLetter>;

/** The first public email address in an organizer's listed contact text, else ''. */
export function publicEmail(contact?: string): string {
  const match = typeof contact === 'string' ? contact.match(/(?<![A-Za-z0-9._%+/-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/) : null;
  return match && match[0].length <= 254 ? match[0] : '';
}

export function organizerHandoff(resource: OrganizerResource, question = ''): OrganizerHandoff {
  return { id: resource.id, organizer: limit(resource.organizer, 160), program: limit(resource.title, 160), area: limit(resource.area, 160), url: resource.url, email: publicEmail(resource.contact), question: limit(question, 1000, true) };
}

/** The Local office letter for this organizer. The recipient check is left for the person to confirm. */
export function organizerLetter(handoff: OrganizerHandoff): OutreachLetter {
  const ask = handoff.question || 'Could you tell me how to take part, when the next suitable activity is, and anything I should know before joining?';
  const body = `Hello,\n\nI am interested in ${handoff.program} with ${handoff.organizer}${handoff.area ? ` (${handoff.area})` : ''}.\n\n${ask}\n\nThank you.`;
  const organizer: OrganizerContext = { id: handoff.id, organizer: handoff.organizer, program: handoff.program, area: handoff.area, url: handoff.url };
  return { name: handoff.organizer, email: handoff.email, reviewedFor: '', body: limit(body, 5000, true), subject: limit(`A question about ${handoff.program}`, 200), notes: [], organizer };
}

/** True when the letter holds something the person chose or wrote, so replacing it would lose work. */
export function letterHasWork(letter: OutreachLetter | undefined, recipient: Recipient): boolean {
  if (!letter) return false;
  const templates = outreachPurposes.map(purpose => outreachTemplate(recipient, purpose));
  const subject = String(letter.subject ?? '').trim(), body = String(letter.body ?? '');
  return Boolean(String(letter.name ?? '').trim() || String(letter.email ?? '').trim() || letter.notes?.length || (subject && subject !== defaultOutreachSubject) || (body.trim() && !templates.includes(body)));
}

/**
 * 'apply': nothing to lose, write the organizer letter. 'already': this is the
 * person's draft for the same organizer, open it unchanged. 'choose': another
 * unsent draft would be replaced, so ask (replace or keep).
 */
export function handoffDecision(letter: OutreachLetter | undefined, handoff: OrganizerHandoff): HandoffDecision {
  if (letter?.organizer?.id === handoff.id) return 'already';
  if (!letterHasWork(letter, organizerRecipient)) return 'apply';
  const next = organizerLetter(handoff);
  return letter && letter.name === next.name && letter.email === next.email && letter.subject === next.subject && letter.body === next.body && !letter.notes.length ? 'apply' : 'choose';
}
