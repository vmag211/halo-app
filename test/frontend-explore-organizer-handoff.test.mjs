import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFrontend } from './frontend-test-loader.mjs';
import { RECIPIENTS, TOPICS, parsePrepare } from '../lib/outreach.js';

const { blankOutreachLetter, blankOutreachLetters, defaultOutreachSubject, handoffDecision, letterHasWork, organizerHandoff, organizerLetter, organizerRecipient, organizerTopic, publicEmail } = await loadFrontend('outreach-handoff');
const { outreachTemplate, recipients } = await loadFrontend('explore-preview');
const { projectIdeasView, projectMessageIsResult, projectReadyMessage } = await loadFrontend('explore-personalization');
const { SELECTION_COPY } = await import('../lib/projectSelection.js');

const EM_DASH = '\u2014';
const stream = { id: 'concord-stream', title: 'Adopt a stream or clean a creek', organizer: 'City of Concord Stormwater', area: 'Concord', url: 'https://example.invalid/concord-adopt-a-stream', contact: 'stormwater@example.org · 704-555-0100' };
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the organizer, program, area, public email and intended question are carried into the handoff', () => {
  const handoff = organizerHandoff(stream, 'Is there a role that does not involve lifting?');
  assert.deepEqual(handoff, { id: 'concord-stream', organizer: 'City of Concord Stormwater', program: 'Adopt a stream or clean a creek', area: 'Concord', url: stream.url, email: 'stormwater@example.org', question: 'Is there a role that does not involve lifting?' });
  assert.equal(publicEmail('info@catawbariverkeeper.org · 704-679-9494'), 'info@catawbariverkeeper.org');
  assert.equal(publicEmail('704-555-0100'), '');
  assert.equal(publicEmail(undefined), '');
  assert.equal(organizerHandoff({ ...stream, contact: undefined }).email, '');
});

test('only a plain public address is taken from contact text, and odd text still makes a letter the service accepts', () => {
  assert.equal(publicEmail('Contact: “info@x.org”'), 'info@x.org');
  assert.equal(publicEmail('mailto:help@example.org?subject=Hi'), 'help@example.org');
  assert.equal(publicEmail('https://user@site.org/path'), '');
  assert.equal(publicEmail(`${'a'.repeat(260)}@example.org`), '');
  const tab = String.fromCharCode(9), line = String.fromCharCode(10), separator = String.fromCharCode(0x2028), bell = String.fromCharCode(7);
  const letter = organizerLetter(organizerHandoff({ ...stream, title: `Creek${line}care${separator}day`, organizer: `City${tab}of Concord`, area: undefined }, `First line${line}second${bell} line${separator}end`));
  assert.equal(letter.subject, 'A question about Creek care day');
  assert.equal(letter.name, 'City of Concord');
  assert.match(letter.body, /First line\nsecond +line end/);
  const parsed = parsePrepare({ to: letter.email, name: letter.name, subject: letter.subject, body: letter.body, notes: [], publicContext: null, context: { topic: organizerTopic, recipient: organizerRecipient, area: { place: '', state: '' }, water: 'Utility' }, signature: 'sig', senderRevision: 1 });
  assert.equal(parsed.ok, true, JSON.stringify(parsed.fieldErrors));
  assert.equal(handoffDecision({}, organizerHandoff(stream)), 'apply', 'a letter missing fields is treated as empty');
});

test('the drafted letter is addressed to the selected organizer, not the water-service template', () => {
  const letter = organizerLetter(organizerHandoff(stream, 'Is there a role that does not involve lifting?'));
  assert.equal(letter.name, 'City of Concord Stormwater');
  assert.equal(letter.email, 'stormwater@example.org');
  assert.equal(letter.subject, 'A question about Adopt a stream or clean a creek');
  assert.match(letter.body, /Adopt a stream or clean a creek with City of Concord Stormwater \(Concord\)/);
  assert.match(letter.body, /Is there a role that does not involve lifting\?/);
  assert.doesNotMatch(letter.body, /water service/);
  assert.equal(letter.reviewedFor, '', 'the person still confirms the recipient');
  assert.deepEqual(letter.notes, []);
  assert.deepEqual(letter.organizer, { id: 'concord-stream', organizer: 'City of Concord Stormwater', program: 'Adopt a stream or clean a creek', area: 'Concord', url: stream.url });
  const general = organizerLetter(organizerHandoff(stream));
  assert.match(general.body, /how to take part/);
  const dashed = organizerLetter(organizerHandoff({ ...stream, title: `Creek care ${EM_DASH} autumn`, organizer: `Friends ${EM_DASH} Concord` }, `Can I help ${EM_DASH} on weekends?`));
  for (const value of [dashed.name, dashed.subject, dashed.body]) assert.ok(!value.includes(EM_DASH));
});

test('an empty Local office draft takes the organizer question directly', () => {
  const handoff = organizerHandoff(stream);
  assert.equal(handoffDecision(blankOutreachLetter(organizerRecipient), handoff), 'apply');
  assert.equal(handoffDecision(undefined, handoff), 'apply');
  for (const purpose of ['Request information', 'Ask about testing options', 'Request a follow-up']) {
    assert.equal(handoffDecision({ ...blankOutreachLetter(organizerRecipient), body: outreachTemplate(organizerRecipient, purpose) }, handoff), 'apply', purpose);
  }
  const { organizer: _organizer, ...sameContent } = organizerLetter(handoff);
  assert.equal(handoffDecision(sameContent, handoff), 'apply', 'identical content loses nothing');
});

test('an existing unrelated unsent draft is never overwritten without a choice', () => {
  const handoff = organizerHandoff(stream);
  const blank = blankOutreachLetter(organizerRecipient);
  for (const [label, letter] of [
    ['written body', { ...blank, body: 'Hello, I have a question about the park restrooms.' }],
    ['chosen email', { ...blank, email: 'parks@example.org' }],
    ['chosen name', { ...blank, name: 'County Parks' }],
    ['custom subject', { ...blank, subject: 'Park question' }],
    ['selected notes', { ...blank, notes: [{ id: 'note-1' }] }],
    ['another organizer', organizerLetter(organizerHandoff({ ...stream, id: 'riverkeeper', organizer: 'Catawba Riverkeeper', title: 'Help care for local waterways' }))],
  ]) {
    assert.equal(letterHasWork(letter, organizerRecipient), true, label);
    assert.equal(handoffDecision(letter, handoff), 'choose', label);
  }
  assert.equal(letterHasWork(blank, organizerRecipient), false);
  assert.equal(letterHasWork({ ...blank, subject: defaultOutreachSubject }, organizerRecipient), false);
});

test('a draft already prepared for the same organizer opens unchanged', () => {
  const handoff = organizerHandoff(stream);
  const edited = { ...organizerLetter(handoff), body: 'My own rewrite of the question.' };
  assert.equal(handoffDecision(edited, handoff), 'already');
});

test('the handoff fits the existing outreach contract: no new recipient class, topic or send', () => {
  assert.ok(RECIPIENTS.includes(organizerRecipient));
  assert.ok(TOPICS.includes(organizerTopic));
  assert.deepEqual(blankOutreachLetters(), Object.fromEntries(recipients.map(item => [item, { name: '', email: '', reviewedFor: '', body: outreachTemplate(item, 'Request information'), subject: 'A question about local environmental information', notes: [] }])));
  const letter = organizerLetter(organizerHandoff(stream, 'When is the next creek cleanup?'));
  const parsed = parsePrepare({ to: letter.email, name: letter.name, subject: letter.subject, body: letter.body, notes: [], publicContext: null, context: { topic: organizerTopic, recipient: organizerRecipient, area: { place: '', state: '' }, water: 'Utility' }, signature: 'sig', senderRevision: 1 });
  assert.equal(parsed.ok, true, JSON.stringify(parsed.fieldErrors));
});

test('the organizer screen hands off through the shared hook and the outreach screens name the organizer', async () => {
  const discovery = await read('components/expanded/ExploreDiscovery.tsx');
  assert.match(discovery, /onClick=\{askOrganizer\}>Prepare a question for this organizer/);
  assert.match(discovery, /Keep my draft and open it/);
  assert.match(discovery, /Replace it with a question for/);
  const hook = await read('components/expanded/OrganizerOutreach.tsx');
  assert.doesNotMatch(hook, /outreach\.(send|prepare|connect)|runtime\.request/, 'the handoff writes local drafts only');
  for (const screen of ['components/expanded/ProductionOutreach.tsx', 'components/expanded/ExploreOutreach.tsx']) assert.match(await read(screen), /OrganizerQuestionBanner/);
});

test('the projects idea area always has content after loading: first visit, no fit, a problem or the list', () => {
  const base = { busy: false, loadingSaved: false, off: false, itemCount: 0, visibleCount: 0, generation: 0, canRetry: false, pendingGeneration: false };
  assert.equal(projectIdeasView({ ...base, loadingSaved: true, busy: true }), 'loading-saved', 'reading the saved set is not shown as picking');
  assert.equal(projectIdeasView({ ...base, busy: true }), 'picking');
  assert.equal(projectIdeasView({ ...base, off: true }), 'off');
  assert.equal(projectIdeasView(base), 'first', 'a new household with no saved set');
  assert.equal(projectIdeasView({ ...base, generation: 2 }), 'none-fit');
  assert.equal(projectIdeasView({ ...base, canRetry: true }), 'problem');
  assert.equal(projectIdeasView({ ...base, generation: 3, pendingGeneration: true }), 'problem');
  assert.equal(projectIdeasView({ ...base, itemCount: 4, visibleCount: 4, canRetry: true }), 'ready');
  assert.equal(projectIdeasView({ ...base, itemCount: 4, visibleCount: 0, generation: 1 }), 'filtered');
});

test('an empty completed set keeps the service explanation and needs no retry', () => {
  assert.equal(projectReadyMessage(12), '12 ideas ready.');
  assert.equal(projectReadyMessage(1), '1 idea ready.');
  assert.equal(projectReadyMessage(0, SELECTION_COPY.noInterest), SELECTION_COPY.noInterest);
  assert.match(projectReadyMessage(0), /No reviewed projects fit/);
  for (const message of ['12 ideas ready.', '1 idea ready.', SELECTION_COPY.none, SELECTION_COPY.noInterest]) assert.equal(projectMessageIsResult(message), true, message);
  for (const message of ['Could not load recommendations. Your current set is kept.', 'Request cancelled. Your current ideas are kept.', 'This service is unavailable. Try again later.']) assert.equal(projectMessageIsResult(message), false, message);
});

test('project copy describes picks from reviewed guides, not newly generated ideas', async () => {
  const screen = await read('components/expanded/ExploreProjects.tsx');
  for (const phrase of ['Generate project ideas', 'Generate a few ideas', 'Generate my project ideas', 'Ideas taking shape', 'Cancel generation', 'Retry generation', 'Generation details and sources', 'Generated project ideas']) assert.ok(!screen.includes(phrase), phrase);
  assert.match(screen, /Picking from HALO's reviewed guides/);
  assert.match(screen, /<ProjectIdeasEmpty view=\{ideasView\}/);
  assert.match(screen, /Cancel request/, 'the cancellable loading state stays');
  const hook = await read('components/expanded/ProductionProjectGeneration.tsx');
  assert.match(hook, /loadingSaved:saved\.loading&&!busy/);
});
