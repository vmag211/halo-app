'use client';
import { ArrowUpRight } from 'lucide-react';
import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';
import { useProductionRuntime } from '@/components/production/ProductionContext';
import { outreachTemplate, recipients, type Recipient } from '@/lib/frontend/explore-preview';
import { blankOutreachLetter, blankOutreachLetters, defaultOutreachSubject, handoffDecision, organizerLetter, organizerRecipient, organizerTopic, type OrganizerContext, type OrganizerHandoff, type OutreachLetter } from '@/lib/frontend/outreach-handoff';

type ReviewContact = { email: string; name: string; reviewed: boolean; reviewedFor?: string };
const reviewDrafts = () => Object.fromEntries(recipients.map(item => [item, outreachTemplate(item, 'Request information')])) as Record<Recipient, string>;
const reviewSubjects = () => Object.fromEntries(recipients.map(item => [item, defaultOutreachSubject])) as Record<Recipient, string>;
const reviewContacts = () => Object.fromEntries(recipients.map(item => [item, { email: '', name: '', reviewed: false }])) as Record<Recipient, ReviewContact>;

/**
 * The organizer question handoff for both the production outreach screen
 * (`explore:production-letters`) and the review screen (its separate stores).
 * Only the Local office letter changes, and `apply` is the only write.
 */
export function useOrganizerOutreach() {
  const runtime = useProductionRuntime();
  const [letters, setLetters] = useHomeDraft<Record<Recipient, OutreachLetter>>('explore:production-letters', blankOutreachLetters());
  const [drafts, setDrafts] = useHomeDraft('explore:outreach-drafts', reviewDrafts());
  const [subjects, setSubjects] = useHomeDraft('explore:outreach-subjects', reviewSubjects());
  const [contacts, setContacts] = useHomeDraft('explore:outreach-contacts', reviewContacts());
  const [included, setIncluded] = useHomeDraft<Record<Recipient, { id: string }[]>>('explore:outreach-note-selection', { Utility: [], Landlord: [], Representative: [], 'Local office': [] });
  const [reviewOrganizer, setReviewOrganizer] = useHomeDraft<OrganizerContext | null>('explore:outreach-organizer', null);
  const [, setRecipient] = useHomeDraft<Recipient>('explore:recipient', 'Utility');
  const [, setTopic] = useHomeDraft('explore:contact-topic', 'Drinking water');
  const current: OutreachLetter = runtime ? letters[organizerRecipient] ?? blankOutreachLetter(organizerRecipient) : { name: contacts[organizerRecipient]?.name ?? '', email: contacts[organizerRecipient]?.email ?? '', reviewedFor: '', body: drafts[organizerRecipient] ?? '', subject: subjects[organizerRecipient] ?? '', notes: included[organizerRecipient] ?? [], organizer: reviewOrganizer ?? undefined };
  function open() { setRecipient(organizerRecipient); setTopic(organizerTopic); }
  function apply(handoff: OrganizerHandoff) {
    const next = organizerLetter(handoff);
    if (runtime) setLetters(old => ({ ...old, [organizerRecipient]: next }));
    else {
      setDrafts(old => ({ ...old, [organizerRecipient]: next.body })); setSubjects(old => ({ ...old, [organizerRecipient]: next.subject }));
      setContacts(old => ({ ...old, [organizerRecipient]: { name: next.name, email: next.email, reviewed: false } })); setIncluded(old => ({ ...old, [organizerRecipient]: [] })); setReviewOrganizer(next.organizer ?? null);
    }
    open();
  }
  return { decide: (handoff: OrganizerHandoff) => handoffDecision(current, handoff), apply, open, current, organizer: current.organizer };
}

/** Says who the Local office draft is for, so the recipient shown is the selected organizer. */
export function OrganizerQuestionBanner({ organizer }: { organizer?: OrganizerContext }) {
  if (!organizer) return null;
  return <section className="ex-notice ex-organizer-question" aria-label="Organizer question"><h4>Question for {organizer.organizer}</h4><p>About {organizer.program}{organizer.area ? ` (${organizer.area})` : ''}. This draft is under Local office. Check the recipient address on the organizer&apos;s official page before you use it.</p><a className="ex-text-button" href={organizer.url} target="_blank" rel="noreferrer">Official organizer page<ArrowUpRight size={15} aria-hidden="true" /></a></section>;
}
