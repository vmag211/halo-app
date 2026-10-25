/**
 * Audit F07 and F12 (2026-10-25): production Luna answers and cites but does not
 * act (B03, Vibhav's Option A), and notes never reach it (B09 decision 2).
 *
 * F12: asked to "add a task", Luna said it could not, then offered to remind the
 * person anyway. The prompt now states the capability, and an output guard
 * removes any offer or claim of an action and appends the self-service steps.
 *
 * F07: the note handoff accepted a field selection and consent that the message
 * route then ignored. It now says note context is not available before anything
 * is chosen, and the conversation never offers, shows or sends a note.
 *
 * Synthetic provider, no network, no real model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './helpers/routeLoader.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const luna = await import('../lib/luna.js');
const { buildGeneralPrompt, buildAnswerPrompt, ACTION_RULE } = await import('../lib/assistantRag.js');
const { lunaCapabilityCopy } = await loadFrontend('copy/luna-capability');

const EM_DASH = String.fromCharCode(0x2014);
const MODELS = { ASSISTANT_EMBED_MODEL: 'test-embed-model', ASSISTANT_CHAT_MODEL: 'test-chat-model' };
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const PASSAGES = [{ id: 'p1', source_label: 'EPA, Radon', source_url: 'https://www.epa.gov/radon', retrieved: '2026-01-01', passage: 'Radon is a radioactive gas. Test your home.', similarity: 0.9 }];

async function withModels(work) {
  const saved = Object.fromEntries(Object.keys(MODELS).map((name) => [name, process.env[name]]));
  Object.assign(process.env, MODELS);
  try {
    return await work();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function provider(answer) {
  const chats = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/embeddings')) return { ok: true, json: async () => ({ data: [{ embedding: new Array(2048).fill(0.01) }] }) };
    chats.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: answer } }] }) };
  };
  return { fetchImpl, chats };
}
const ask = (question, answer, rpc = async () => ({ data: [], error: null })) => {
  const p = provider(answer);
  return withModels(async () => ({ result: await luna.answerFromCorpus({ question, apiKey: 'k', rpc, fetchImpl: p.fetchImpl }), chats: p.chats }));
};

// ---------------------------------------------------------------------------
// F12: the capability statement in every prompt
// ---------------------------------------------------------------------------

test('both answer prompts state that Luna cannot add tasks, set reminders or act, and never to offer it', () => {
  const general = buildGeneralPrompt({ question: 'add a task QA: check recycling for tomorrow in My Week' }).system;
  const sourced = buildAnswerPrompt({ question: 'Remind me to test for radon next week', passages: PASSAGES }).system;
  for (const [name, system] of [['general', general], ['sourced', sourced]]) {
    assert.ok(system.includes(ACTION_RULE), `${name} prompt carries the capability rule`);
    assert.match(system, /cannot add, change or delete tasks/, name);
    assert.match(system, /set reminders/, name);
    assert.match(system, /Never offer to do any of these/, name);
    assert.match(system, /never say you will remind/, name);
    assert.match(system, /in My Week, choose Add task/, name);
    assert.match(system, /Request a reminder/, name);
    assert.equal(system.includes(EM_DASH), false, `${name} prompt has no em dash`);
  }
  assert.match(general, /Luna cannot add tasks, set reminders or change anything in the app/, 'the app guide agrees');
});

test('the self-service steps name the real My Week controls', () => {
  const week = source('components/expanded/MyWeekWorkspace.tsx');
  for (const control of ['Add task', 'Time, repeat & preparation', 'Request a reminder']) {
    assert.ok(week.includes(control), `My Week has "${control}"`);
    assert.ok(luna.LUNA_SELF_SERVE_ACTIONS.includes(control), `Luna names "${control}"`);
  }
  assert.equal(luna.LUNA_SELF_SERVE_ACTIONS.includes(EM_DASH), false);
  assert.equal(luna.offersAction(luna.LUNA_SELF_SERVE_ACTIONS), false, 'the replacement is not itself an offer');
});

// ---------------------------------------------------------------------------
// F12: the output guard
// ---------------------------------------------------------------------------

test('offers, questions and claims of an action are recognised', () => {
  for (const sentence of [
    "I can't add tasks, but I can remind you to check your recycling tomorrow.",
    'I can remind you to check your recycling tomorrow.',
    'I’ll remind you in the morning.',
    'Would you like me to set a reminder for 9:00 AM?',
    'Do you want me to add it to your calendar?',
    'Shall I schedule that for tomorrow?',
    'Let me set up a reminder for you.',
    'I can also help you create a task for that.',
    "I've added it to your tasks.",
    'I have scheduled the check for tomorrow.',
    'Your reminder has been set.',
    "I'd be happy to add that to My Week.",
    "I'll follow up with you tomorrow.",
    "I'll make a note to remind you on Friday.",
    "I'm happy to remind you next week.",
    "I've gone ahead and scheduled it.",
    "I'd remind you on Monday.",
    "Okay, it's on your calendar now.",
    'Reminder set!',
    'Should I add this to your planner?',
    'I could jot that down in your week.',
  ]) assert.equal(luna.offersAction(sentence), true, sentence);
});

test('advice, refusals and ordinary offers of more text are left alone', () => {
  for (const sentence of [
    'You can add a task in My Week.',
    'To add a task yourself, open My Week and choose Add task.',
    "I can't set reminders.",
    'I cannot add tasks or change anything in HALO.',
    'I can add more detail if you like.',
    'I can create a list of cat names.',
    'I would follow up with your water utility.',
    'I can remind you that radon has no smell.',
    'Would you like me to explain the test?',
    'Set a phone alarm if that helps you remember.',
    '15% of 80 is 12.',
    'I can add a sentence that mentions your appointment.',
    'I can add a reminder line at the end of the letter.',
    'I can update the draft to mention your calendar conflict.',
    'Should I add more examples to the list?',
    'I can draft an email asking the landlord to schedule a plumber.',
  ]) assert.equal(luna.offersAction(sentence), false, sentence);
});

test('the guard removes only the offending sentences and appends the self-service steps once', () => {
  const reply = "Sure. I can't add tasks, but I can remind you to check your recycling tomorrow. What time works best?\nRecycling usually goes out the night before.";
  const guarded = luna.withoutActionOffers(reply);
  assert.doesNotMatch(guarded, /remind you to check/);
  assert.ok(guarded.startsWith('What time works best?'), 'the rest of the line is kept, without the "Sure." that introduced the offer');
  assert.ok(guarded.includes('Recycling usually goes out the night before.'), 'other lines are kept');
  assert.ok(guarded.endsWith(luna.LUNA_SELF_SERVE_ACTIONS));
  assert.equal(guarded.split(luna.LUNA_SELF_SERVE_ACTIONS).length, 2, 'appended once');
  assert.equal(luna.withoutActionOffers(guarded), guarded, 'idempotent');
  assert.equal(luna.withoutActionOffers('I can set a reminder for you.'), luna.LUNA_SELF_SERVE_ACTIONS, 'nothing left: only the steps');
  assert.equal(luna.withoutActionOffers("Done! I've added it to your tasks."), luna.LUNA_SELF_SERVE_ACTIONS, 'an affirmation of a removed claim goes with it');
  const plain = 'Radon is a gas.\n\nTest your home.';
  assert.equal(luna.withoutActionOffers(plain), plain, 'a reply with no offer is unchanged');
});

test('the audited request: a general answer that offers a reminder is guarded before it is stored', async () => {
  const { result, chats } = await ask(
    'add a task QA: check recycling for tomorrow in My Week',
    "I can't add tasks, but I can remind you to check your recycling tomorrow. Would you like me to set a time or add it to your calendar?",
  );
  assert.equal(result.outcome, 'general');
  assert.equal(chats.length, 1);
  assert.ok(chats[0].messages[0].content.includes(ACTION_RULE), 'the provider was told the capability');
  assert.doesNotMatch(result.text, /remind you|set a time|your calendar/);
  assert.equal(result.text, luna.LUNA_SELF_SERVE_ACTIONS);
});

test('a cited answer that offers a reminder keeps its citation and loses the offer', async () => {
  const { result } = await ask(
    'Remind me to test for radon next week',
    'Radon is a radioactive gas, so testing your home is worthwhile [1]. I can remind you next week to buy a test kit.',
    async () => ({ data: PASSAGES, error: null }),
  );
  assert.equal(result.outcome, 'answered');
  assert.deepEqual(result.sources.map((s) => s.url), ['https://www.epa.gov/radon']);
  assert.ok(result.text.startsWith('Radon is a radioactive gas, so testing your home is worthwhile.'));
  assert.doesNotMatch(result.text, /I can remind you/);
  assert.ok(result.text.endsWith(luna.LUNA_SELF_SERVE_ACTIONS));
});

// ---------------------------------------------------------------------------
// One capability statement at every entry point
// ---------------------------------------------------------------------------

test('the client capability copy says the same thing as the server and has no em dash', () => {
  for (const [key, value] of Object.entries(lunaCapabilityCopy)) assert.equal(String(value).includes(EM_DASH), false, key);
  assert.match(lunaCapabilityCopy.answersOnly, /cannot add tasks, set reminders, save notes or change anything in HALO/);
  assert.match(lunaCapabilityCopy.selfServe, /open My Week and choose Add task/);
  assert.match(lunaCapabilityCopy.noteUnavailable, /cannot read your notes, so nothing from this note is sent/);
  const route = source('app/api/luna/capabilities/route.js');
  assert.match(route, /cannot add tasks, set reminders, change anything in HALO or act for you/, 'the server summary agrees');
  assert.match(route, /notes, journal and tasks are not part of this conversation/);
});

test('every production Luna entry point uses the shared capability copy, and none promises reminders', () => {
  const conversation = source('components/expanded/ProductionLunaConversation.tsx');
  const note = source('components/expanded/ProductionNoteLuna.tsx');
  const settings = source('components/expanded/SettingsPanels.tsx');
  // The shared launcher and the My Week header both open ProductionLunaConversation.
  const shell = source('components/foundation/FoundationPreview.tsx');
  assert.match(shell, /mw-header-luna[^>]*onClick=\{\(\)=>openSheet\(\{type:"assistant"/, 'the My Week header opens the shared conversation');
  for (const [name, text] of [['conversation', conversation], ['note', note], ['settings', settings]]) {
    assert.match(text, /lunaCapabilityCopy/, `${name} uses the shared copy`);
    assert.doesNotMatch(text, /remind you|I can remind|set a reminder for you/i, name);
  }
  assert.match(conversation, /answersOnly&&<p className="lc-capability">\{lunaCapabilityCopy\.answersOnly\} \{lunaCapabilityCopy\.selfServe\}/, 'the welcome states it');
  assert.match(settings, /Luna is available\. \$\{lunaCapabilityCopy\.answersOnly\}/, 'Settings states it when no tool is permitted');
});

// ---------------------------------------------------------------------------
// F07: no note selection is accepted and then dropped
// ---------------------------------------------------------------------------

test('the note handoff offers no field selection, consent or review, so title-only and title-and-description cannot be chosen', () => {
  const note = source('components/expanded/ProductionNoteLuna.tsx');
  assert.doesNotMatch(note, /type="checkbox"|setSelection|setConsent|I choose only these fields|Review Luna request|Continue with Luna/);
  assert.doesNotMatch(note, /luna:production-note-context/, 'it never writes a note selection');
  assert.match(note, /lunaCapabilityCopy as copy/);
  assert.match(note, /\{copy\.noteUnavailable\}/, 'it explains before anything is chosen');
});

test('no note field, private or not, reaches the Luna draft or the message', () => {
  const note = source('components/expanded/ProductionNoteLuna.tsx');
  for (const field of ['record.title', 'record.description', 'record.place', 'record.observedAt', 'record.evidence', 'record.timezone', 'record.photo']) {
    assert.equal(note.includes(field), false, `${field} is not read by the handoff`);
  }
  assert.doesNotMatch(note, /setDraft|luna:production-draft/, 'the person\'s own draft is left alone');
});

test('the conversation never offers, shows or sends a note, and clears a selection an older build left', () => {
  const conversation = source('components/expanded/ProductionLunaConversation.tsx');
  assert.match(conversation, /noteContext:\[\],/, 'the message always carries an empty note context');
  assert.doesNotMatch(conversation, /Choose note context|selected note|Notes are included only when you choose them|Remove selected notes/);
  assert.doesNotMatch(conversation, /exploreNotes/, 'notes are not even read');
  assert.match(conversation, /if\(hasLeftoverNotes\)clearLeftover\.current\(\)/, 'a leftover selection is cleared');
  assert.match(conversation, /\{lunaCapabilityCopy\.notesNotSent\}/, 'Context & privacy says notes are never sent');
});

test('an edited note revision cannot matter: nothing about the note is held to compare', () => {
  const note = source('components/expanded/ProductionNoteLuna.tsx');
  const conversation = source('components/expanded/ProductionLunaConversation.tsx');
  assert.doesNotMatch(note, /revision/);
  assert.doesNotMatch(conversation, /A selected note changed/);
});

test('with Luna unavailable the handoff offers nothing to send', () => {
  const note = source('components/expanded/ProductionNoteLuna.tsx');
  assert.match(note, /caps\?\.available\?<button[\s\S]*?>\{copy\.noteAsk\}<\/button>:<p className="ex-meta" role="status">\{copy\.unavailable\}/);
  assert.match(lunaCapabilityCopy.unavailable, /Luna is unavailable right now/);
});
