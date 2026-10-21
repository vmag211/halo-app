/**
 * B17 outreach preparation end to end (docs/backend/plans/b17-outreach-preparation.md):
 * the eight routes, with EVERYTHING real below them (0017, 0022, 0026 and
 * 0031 on PGlite, test/helpers/outreachWorld.mjs) and the CLIENT's own code
 * above them: the frontend runtime and validators compiled from this tree,
 * and the outreach screen transcribed verbatim (test/helpers/frontendB17.mjs,
 * drift-tested below). Each scenario ends on what the screen holds.
 *
 * Nothing is sent and nothing reaches the network: every call runs with
 * global fetch blocked, and the last test asserts no route tried it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDb } from './db/pgliteHarness.mjs';
import { ON, RALEIGH, WAKE, createWorld } from './helpers/outreachWorld.mjs';
import * as fe from './helpers/frontendB17.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { placeById } from '../lib/places.js';

const { FrontendServiceError } = await loadFrontend('production/runtime');
const { validContacts } = await loadFrontend('production/explore-service');
const { validOutreachAttempt, validOutreachConnection, validOutreachEvidence, validOutreachHistory, validOutreachReview } = await loadFrontend('production/outreach-service');

// An online browser: Node's navigator has no onLine, which the screen's `blocked` reads as offline.
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const NOT_AVAILABLE = 'This action is not available for this account.';
const UNAVAILABLE = 'This service is unavailable. Try again later.';
const PATHS = Object.freeze({
  contacts: '/api/outreach/contacts', context: '/api/outreach/context', connection: '/api/outreach/connection', connect: '/api/outreach/connect',
  messages: '/api/outreach/messages', prepare: '/api/outreach/messages/prepare', status: '/api/outreach/messages/status',
});

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });
const worlds = [];
async function world(options) { const w = await createWorld(db, options); worlds.push(w); return w; }

/** A screen for `who` whose area is the saved one, mounted. */
async function screen(w, who = 'alice', { area = WAKE, notes = [] } = {}) {
  await w.saveArea(who, area);
  const s = fe.outreachScreen(w.runtime(who), { area: area ?? { place: '', state: '' }, notes });
  await s.mount();
  return s;
}
const outreachLedger = async (w, who = 'alice') =>
  (await db.query(`select operation_id::text, kind, status, result from public.operations where profile_id = $1 and domain = 'outreach' order by created_at`, [w.ids[who]])).rows;
/** The body the screen would send for prepare, built by the screen itself with a connection it does not have. */
async function preparedByScreen(s) {
  const real = s.state.connection;
  s.state.connection = { data: { connected: true, sender: 'me@example.org', revision: 1 }, error: null, loading: false };
  try { await s.prepare(); } finally { s.state.connection = real; }
}
const rejection = (promise) => promise.then(() => null, (error) => error);

// ------------------------------------------------------------------- drift

test('the transcribed screen lines still match ProductionOutreach.tsx character for character, and the registry paths are the routes', async () => {
  const mine = await readFile(new URL('./helpers/frontendB17.mjs', import.meta.url), 'utf8');
  const source = await readFile(new URL('../components/expanded/ProductionOutreach.tsx', import.meta.url), 'utf8');
  for (const fragment of fe.FRAGMENTS) {
    assert.ok(source.includes(fragment), `ProductionOutreach.tsx no longer contains: ${fragment}`);
    assert.ok(mine.includes(fragment), `the transcription no longer contains: ${fragment}`);
  }
  const runtime = await readFile(new URL('../lib/frontend/production/runtime.ts', import.meta.url), 'utf8');
  for (const line of [
    "'contacts.resolve': {path:'/api/outreach/contacts',method:'POST'},",
    "'outreach.send': {path:'/api/outreach/messages',method:'POST'},",
    "'outreach.context': {path:'/api/outreach/context'},",
    "'outreach.connection': {path:'/api/outreach/connection'},",
    "'outreach.connect': {path:'/api/outreach/connect',method:'POST'},",
    "'outreach.prepare': {path:'/api/outreach/messages/prepare',method:'POST'},",
    "'outreach.history': {path:'/api/outreach/messages'},",
    "'outreach.status': {path:'/api/outreach/messages/status'},",
  ]) assert.ok(runtime.includes(line), line);
});

// --------------------------------------------------------------- the screen

test('on mount: not connected, an empty complete history, and dated public context for the saved county; the screen is ready to write', async () => {
  const w = await world();
  const s = await screen(w);
  const d = s.derive();
  assert.deepEqual(s.state.connection.data, { connected: false, sender: null, revision: 1 });
  assert.ok(validOutreachConnection(s.state.connection.data));
  assert.equal(d.account.connected, false);
  assert.ok(validOutreachHistory(s.state.history.data));
  assert.deepEqual(s.state.history.data.attempts, []);
  assert.equal(s.state.history.data.complete, true);
  assert.deepEqual(s.state.attempts, []);
  assert.equal(d.historyReady, true);
  assert.equal(d.blocked, false);
  assert.ok(validOutreachEvidence(s.state.evidenceRead.data));
  assert.equal(s.state.evidenceRead.data.availability, 'ready');
  const drought = s.state.evidenceRead.data.entries[0];
  assert.match(drought.title, /U\.S\. Drought Monitor for Wake County/);
  assert.match(drought.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(drought.url.startsWith('https://'));
  assert.ok(s.state.evidenceRead.data.entries.some((entry) => /\(Wake County\): water conservation status$/.test(entry.title)));
  // A private well household gets the drought release but no utility listing.
  s.set({ water: 'Private well' });
  await s.reloadEvidence();
  assert.deepEqual(s.state.evidenceRead.data.entries.map((entry) => entry.id), [drought.id]);
  // Another topic has no invented context.
  s.set({ topic: 'Air & outdoor conditions', water: 'Utility' });
  await s.reloadEvidence();
  assert.deepEqual(s.state.evidenceRead.data, { revision: 20261020, availability: 'empty', entries: [], complete: true });
});

test('find a contact: official offices with their source pages, no guessed email, and "Use this contact" only for a printed mailbox', async () => {
  const w = await world();
  const s = await screen(w);
  s.set({ recipient: 'Local office' });
  await s.lookup();
  assert.equal(s.state.message, '');
  const items = s.state.candidates.items;
  assert.ok(validContacts({ contacts: items }));
  assert.deepEqual(items.map((c) => c.id), ['nc-lhd-37183', 'nc-deq-public-water-supply']);
  assert.ok(items.every((c) => c.email === null && !s.usable(c) && c.url.startsWith('https://') && c.checkedAt === '2026-10-20'));
  assert.match(items[0].reason, /919-250-1120/);
  assert.equal(s.state.candidates.scope, s.derive().context);

  s.set({ topic: 'Parks & public spaces' });
  await s.lookup();
  const [parks] = s.state.candidates.items;
  assert.equal(parks.email, 'state.parks@ncparks.gov');
  assert.equal(s.usable(parks), true);

  s.set({ topic: 'Drinking water', recipient: 'Representative' });
  await s.lookup();
  assert.deepEqual(s.state.candidates.items.map((c) => c.organization), ['North Carolina General Assembly', 'U.S. House of Representatives']);
  assert.ok(s.state.candidates.items.every((c) => /does not guess yours/.test(c.reason)));

  // Landlord: the screen never asks, and the server would not look one up either.
  s.set({ recipient: 'Landlord' });
  assert.equal(s.lookupDisabled(), true);
  const landlord = await w.runtime().request('contacts.resolve', { topic: 'A home concern', recipient: 'Landlord', water: 'Utility', area: WAKE });
  assert.deepEqual(landlord.contacts, []);
  assert.match(landlord.message, /does not look up landlords/);

  // A private well home is never offered Utility; the server refuses it too.
  s.set({ recipient: 'Utility', water: 'Private well' });
  assert.equal(s.derive().active, 'Representative');
  const utility = await w.runtime().request('contacts.resolve', { topic: 'Drinking water', recipient: 'Utility', water: 'Private well', area: WAKE });
  assert.deepEqual(utility.contacts, []);

  // A city is matched to its county and says how.
  const city = await w.runtime().request('contacts.resolve', { topic: 'A home concern', recipient: 'Local office', water: 'Utility', area: RALEIGH });
  assert.equal(city.contacts[0].id, 'nc-lhd-37183');
  assert.match(city.contacts[0].reason, /Raleigh, NC is matched to Wake County by its Census center point/);

  // Without an area the screen does not look anything up.
  const none = await screen(w, 'bob', { area: null });
  const before = none.state.requests.length;
  none.set({ recipient: 'Local office' });
  await none.lookup();
  assert.equal(none.state.requests.length, before);
  // And an id outside the gazetteer is no area, said plainly.
  const unknown = await w.runtime('bob').request('contacts.resolve', { topic: 'Volunteering', recipient: 'Local office', water: 'Utility', area: { id: 'us-county:99999', place: 'Nowhere', state: 'NC', label: 'x', timezone: 'x' } });
  assert.deepEqual(unknown.contacts, []);
  assert.match(unknown.message, /Choose a North Carolina county/);
});

test('connect: refused with nothing recorded, so the screen shows its sentence and never navigates', async () => {
  const w = await world();
  const s = await screen(w);
  await s.authorize();
  assert.equal(s.state.message, NOT_AVAILABLE);
  assert.deepEqual(s.state.assigned, []);
  assert.equal(s.state.authorizing, false);
  const res = await w.call(PATHS.connect, 'POST', { body: { provider: 'gmail', returnPath: '/act' }, headers: { 'idempotency-key': crypto.randomUUID() } });
  assert.equal(res.status, 403);
  const out = await res.json();
  assert.equal(out.code, 'feature_unavailable');
  assert.equal(out.reason, 'email_sending_unsupported');
  assert.equal(out.authorizationUrl, undefined);
  assert.deepEqual(await outreachLedger(w), []);
});

test('the screen never asks for a send review while not connected, even with a ready message', async () => {
  const w = await world();
  const s = await screen(w);
  s.set({ recipient: 'Local office' });
  s.update({ email: 'office@wake.example', name: 'Office' });
  s.confirmRecipient();
  assert.equal(s.derive().ready, true);
  await s.prepare();
  assert.ok(!s.state.requests.includes('outreach.prepare'));
  assert.equal(s.state.review, null);
  // Send without a review does nothing either.
  await s.send();
  assert.ok(!s.state.requests.includes('outreach.send'));
  assert.equal(s.state.message, 'This review changed or expired. Review the current message again.');
});

test('prepare stores a copy-only draft from the saved note and the chosen source, which is never a send review', async () => {
  const w = await world();
  const note = await w.saveNote('alice', { title: 'Creek foam', description: 'White foam below the culvert on Saturday.' });
  const s = await screen(w, 'alice', { notes: [note] });
  s.set({ recipient: 'Local office' });
  s.update({ email: 'office@wake.example', name: 'Environmental health', notes: [{ id: note.id, revision: note.revision, title: note.title, description: note.description }] });
  s.chooseEvidence(s.state.evidenceRead.data.entries[0]);
  s.confirmRecipient();
  const d = s.derive();
  assert.equal(d.ready, true);
  await preparedByScreen(s);

  // The server answered a draft; the screen's validator refuses it as a review, so nothing can be sent.
  assert.ok(s.state.requests.includes('outreach.prepare'));
  assert.equal(s.state.review, null);
  assert.equal(s.state.message, UNAVAILABLE);
  const [stored] = await w.drafts();
  assert.equal(stored.body, d.body);
  assert.equal(stored.to_address, 'office@wake.example');
  assert.deepEqual(stored.notes, [{ id: note.id, revision: note.revision, title: 'Creek foam', description: 'White foam below the culvert on Saturday.' }]);
  assert.ok(stored.body.includes('Notes I chose to include:\nCreek foam\nWhite foam below the culvert on Saturday.'));
  assert.ok(stored.body.includes('Public context I chose to include:\nU.S. Drought Monitor for Wake County'));

  // History lists it as a draft, beside an empty attempts list the screen accepts.
  const history = await w.runtime().request('outreach.history', {});
  assert.ok(validOutreachHistory(history));
  assert.deepEqual(history.attempts, []);
  assert.equal(history.drafts.length, 1);
  const [draft] = history.drafts;
  assert.deepEqual([draft.status, draft.delivery, draft.from, draft.expiresAt, draft.revision], ['draft', 'copy', null, null, 1]);
  assert.equal(validOutreachReview({ ...draft, signature: d.signature }), false);
  assert.equal(validOutreachAttempt(draft), false);
  assert.deepEqual(draft.area, WAKE);

  // Status of the draft is the draft; the screen's attempt check refuses it.
  const status = await w.runtime().request('outreach.status', { id: draft.id });
  assert.equal(status.status, 'draft');
  await s.check(draft.id);
  assert.equal(s.state.message, UNAVAILABLE);
  assert.deepEqual(s.state.attempts, []);

  // The ledger row holds the draft id and revision only, never the text.
  const [row] = await outreachLedger(w);
  assert.equal(row.status, 'succeeded');
  assert.deepEqual(Object.keys(row.result).sort(), ['draftId', 'operationId', 'revision', 'status', 'unresolvedOperations']);
  assert.ok(!JSON.stringify(row.result).includes('Creek foam'));
});

test('draft revisions: identical keeps the revision, a change raises it by one, another address is another draft', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const rt = w.runtime();
  const body = (over = {}) => ({
    to: 'office@wake.example', name: '', subject: 'A question', body: 'Hello, I have a question.', notes: [], publicContext: null,
    context: { topic: 'A home concern', recipient: 'Local office', area: WAKE, water: 'Utility' }, signature: 'sig', senderRevision: 1, ...over,
  });
  const first = await rt.request('outreach.prepare', body(), { idempotencyKey: crypto.randomUUID() });
  const same = await rt.request('outreach.prepare', body(), { idempotencyKey: crypto.randomUUID() });
  assert.deepEqual([first.revision, same.revision, same.id], [1, 1, first.id]);
  const changed = await rt.request('outreach.prepare', body({ body: 'Hello, a better question.' }), { idempotencyKey: crypto.randomUUID() });
  assert.deepEqual([changed.id, changed.revision], [first.id, 2]);
  const other = await rt.request('outreach.prepare', body({ to: 'Other@Wake.example' }), { idempotencyKey: crypto.randomUUID() });
  assert.notEqual(other.id, first.id);
  const upper = await rt.request('outreach.prepare', body({ to: 'other@wake.example' }), { idempotencyKey: crypto.randomUUID() });
  assert.equal(upper.id, other.id, 'the address is compared lowercased');
  const empty = await rt.request('outreach.prepare', body({ to: '' }), { idempotencyKey: crypto.randomUUID() });
  assert.equal(empty.to, '');
  assert.equal((await w.drafts()).length, 3);
  assert.equal(first.signature, 'sig');
});

test('prepare refuses what is not the household\'s saved context: a changed note, another household\'s note, another area, a stale source, different sections', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const note = await w.saveNote('alice', { title: 'Odor', description: 'A smell after rain.' });
  const bobs = await w.saveNote('bob', { title: 'Bob note', description: 'Private to bob.' });
  const rt = w.runtime();
  const sections = `\n\nNotes I chose to include:\n${note.title}\n${note.description}`;
  const body = (over = {}) => ({
    to: '', name: '', subject: 'A question', body: `Hello.${sections}`, notes: [{ id: note.id, revision: note.revision }], publicContext: null,
    context: { topic: 'A home concern', recipient: 'Local office', area: WAKE, water: 'Utility' }, signature: 'sig', senderRevision: 1, ...over,
  });
  const code = async (input) => (await rejection(rt.request('outreach.prepare', input, { idempotencyKey: crypto.randomUUID() })))?.code ?? 'ok';

  assert.equal(await code(body()), 'ok');
  assert.equal(await code(body({ notes: [{ id: note.id, revision: note.revision + 1 }] })), 'conflict', 'a revision the note is not at');
  assert.equal(await code(body({ notes: [{ id: bobs.id, revision: bobs.revision }], body: `Hello.\n\nNotes I chose to include:\nBob note\nPrivate to bob.` })), 'conflict', 'another household\'s note is not found');
  assert.equal(await code(body({ body: 'Hello. No sections.' })), 'validation', 'notes selected but not in the body');
  assert.equal(await code(body({ body: sections })), 'validation', 'nothing but the sections');
  assert.equal(await code(body({ context: { topic: 'A home concern', recipient: 'Local office', area: RALEIGH, water: 'Utility' } })), 'conflict', 'not the saved area');
  assert.equal(await code(body({ context: { topic: 'A home concern', recipient: 'Local office', area: { place: '', state: '' }, water: 'Utility' } })), 'conflict', 'blank, but an area is saved');
  assert.equal(await code(body({ publicContext: { id: 'usdm-37183-2026-10-13', revision: 1 } })), 'conflict', 'a source revision that is not the current one');
  assert.equal(await code(body({ senderRevision: 2 })), 'conflict', 'a sender revision the connection does not have');
  assert.equal(await code(body({ to: 'a@b.c\r\nBcc: x@y.z' })), 'validation', 'header injection');
  assert.equal(await code(body({ subject: 'Hi\nBcc: x@y.z' })), 'validation');
  assert.equal(await code(body({ subject: 'Question \u2014 water' })), 'validation', 'the screen never sends an em dash');
  assert.equal(await code(body({ extra: 1 })), 'validation', 'unknown key');
  assert.equal(await code(body({ context: { topic: 'Drinking water', recipient: 'Utility', area: WAKE, water: 'Private well' } })), 'validation');

  // The note changes after the screen read it: the screen marks it stale, and the server refuses the old revision.
  const s = fe.outreachScreen(rt, { area: WAKE, notes: [{ ...note, revision: note.revision + 1 }] });
  await s.mount();
  s.update({ email: 'x@example.org', notes: [{ id: note.id, revision: note.revision, title: note.title, description: note.description }] });
  s.confirmRecipient();
  assert.equal(s.derive().stale, true);
  assert.equal(s.derive().ready, false);
  assert.equal((await w.drafts()).length, 1, 'only the accepted prepare stored a draft');
});

test('send is refused before anything is recorded, and the client reads it as definite', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const error = await rejection(w.runtime().request('outreach.send', { reviewId: crypto.randomUUID(), reviewRevision: 1 }, { idempotencyKey: crypto.randomUUID(), expectedRevision: 1 }));
  assert.ok(error instanceof FrontendServiceError);
  assert.equal(error.code, 'permission', 'definite, so the screen clears its parked send');
  const res = await w.call(PATHS.messages, 'POST', { body: 'not even json', headers: { 'idempotency-key': crypto.randomUUID() } });
  assert.equal(res.status, 403, 'the body is never read');
  assert.equal((await res.json()).reason, 'email_sending_unsupported');
  assert.deepEqual(await outreachLedger(w), []);
  assert.deepEqual(await w.drafts(), []);
});

test('replays: the same key and body answer the same draft, a different body is a mismatch, and a draft changed since is changed_elsewhere; a lost answer reconciles', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const input = (text) => ({
    to: 'office@wake.example', name: '', subject: 'Q', body: text, notes: [], publicContext: null,
    context: { topic: 'A home concern', recipient: 'Local office', area: WAKE, water: 'Utility' }, signature: 's', senderRevision: 1,
  });
  const key = crypto.randomUUID();
  const rt = w.runtime();
  const first = await rt.request('outreach.prepare', input('One.'), { idempotencyKey: key });
  const again = await rt.request('outreach.prepare', input('One.'), { idempotencyKey: key });
  assert.deepEqual(again, first);
  assert.equal((await rejection(rt.request('outreach.prepare', input('Two.'), { idempotencyKey: key }))).code, 'conflict');
  await rt.request('outreach.prepare', input('Three.'), { idempotencyKey: crypto.randomUUID() });
  const late = await w.call(PATHS.prepare, 'POST', { body: input('One.'), headers: { 'idempotency-key': key } });
  assert.equal(late.status, 409);
  assert.equal((await late.json()).reason, 'changed_elsewhere');
  // Another household's key is the same mismatch, and leaves alice's row alone.
  await w.saveArea('bob', WAKE);
  const bob = await w.call(PATHS.prepare, 'POST', { as: 'bob', body: input('One.'), headers: { 'idempotency-key': key } });
  assert.equal(bob.status, 409);
  assert.equal((await bob.json()).reason, 'operation_mismatch');

  const lost = crypto.randomUUID();
  const dropped = await rejection(w.runtime('alice', { lose: (path) => path === PATHS.prepare }).request('outreach.prepare', input('Four.'), { idempotencyKey: lost }));
  assert.equal(dropped.code, 'unknown_outcome');
  const reconcile = await w.reconcile(lost, { domain: 'outreach' });
  assert.equal(reconcile.status, 200);
  const receipt = await reconcile.json();
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.operationId ?? receipt.result?.operationId, lost);
});

test('households are isolated: history, status and drafts are the caller\'s only', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  await w.saveArea('bob', WAKE);
  const mine = await w.runtime().request('outreach.prepare', {
    to: '', name: '', subject: 'ALICE-SUBJECT', body: 'ALICE-BODY', notes: [], publicContext: null,
    context: { topic: 'A home concern', recipient: 'Local office', area: WAKE, water: 'Utility' }, signature: 's', senderRevision: 1,
  }, { idempotencyKey: crypto.randomUUID() });
  const bobHistory = await w.runtime('bob').request('outreach.history', {});
  assert.deepEqual(bobHistory.drafts, []);
  assert.ok(!JSON.stringify(bobHistory).includes('ALICE'));
  const peek = await w.call(PATHS.status, 'GET', { as: 'bob', query: `?id=${mine.id}` });
  assert.equal(peek.status, 404);
  assert.equal((await rejection(w.runtime('bob').request('outreach.status', { id: mine.id }))).code, 'unavailable');
  const never = await w.call(PATHS.status, 'GET', { query: `?id=${crypto.randomUUID()}` });
  assert.equal(never.status, 404);
  assert.match((await never.json()).message, /HALO has never sent a message/);
});

test('flag off: reads are the non-retryable 503, posts a definite 403, and nothing is read, claimed or stored', async () => {
  const w = await world({ env: { HALO_FEATURE_WORKSPACE: 'on' } });
  await w.saveArea('alice', WAKE);
  const s = fe.outreachScreen(w.runtime(), { area: WAKE });
  await s.mount();
  for (const read of [s.state.connection, s.state.history, s.state.evidenceRead]) assert.deepEqual([read.data, read.error], [null, UNAVAILABLE]);
  assert.equal(s.derive().blocked, true);
  s.set({ recipient: 'Local office' });
  await s.lookup();
  assert.equal(s.state.message, NOT_AVAILABLE);
  for (const [path, method] of [[PATHS.connection, 'GET'], [PATHS.messages, 'GET'], [PATHS.context, 'GET'], [PATHS.status, 'GET']]) {
    const res = await w.call(path, method, { query: path === PATHS.status ? `?id=${crypto.randomUUID()}` : '' });
    assert.equal(res.status, 503, path);
    assert.equal((await res.json()).retryable, false);
  }
  for (const path of [PATHS.contacts, PATHS.connect, PATHS.prepare, PATHS.messages]) {
    const res = await w.call(path, 'POST', { body: {}, headers: { 'idempotency-key': crypto.randomUUID() } });
    assert.equal(res.status, 403, path);
  }
  assert.deepEqual(await outreachLedger(w), []);
});

test('before 0031: drafts are unavailable with nothing claimed, while contacts, context and the connection still answer', async () => {
  const w = await world({ migrated: false });
  await w.saveArea('alice', WAKE);
  const s = fe.outreachScreen(w.runtime(), { area: WAKE });
  await s.mount();
  assert.equal(s.state.history.error, UNAVAILABLE);
  assert.equal(s.derive().blocked, true);
  assert.ok(validOutreachConnection(s.state.connection.data));
  assert.ok(validOutreachEvidence(s.state.evidenceRead.data));
  s.set({ recipient: 'Local office' });
  await s.lookup();
  assert.equal(s.state.candidates.items.length, 2);
  const res = await w.call(PATHS.prepare, 'POST', {
    body: { to: '', name: '', subject: 'Q', body: 'B', notes: [], publicContext: null, context: { topic: 'A home concern', recipient: 'Local office', area: WAKE, water: 'Utility' }, signature: 's', senderRevision: 1 },
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await outreachLedger(w), [], 'nothing was claimed');
});

test('notes need the workspace: with its flag off a prepare naming a note is a definite 403, and one without notes works', async () => {
  const w = await world({ env: { HALO_FEATURE_OUTREACH: 'on' } });
  await w.saveArea('alice', WAKE);
  const input = (notes) => ({
    to: '', name: '', subject: 'Q', body: notes.length ? 'B\n\nNotes I chose to include:\nA record\nFoam on the creek' : 'B', notes, publicContext: null,
    context: { topic: 'A home concern', recipient: 'Local office', area: WAKE, water: 'Utility' }, signature: 's', senderRevision: 1,
  });
  const refused = await rejection(w.runtime().request('outreach.prepare', input([{ id: 'exploreNotes-x', revision: 1 }]), { idempotencyKey: crypto.randomUUID() }));
  assert.equal(refused.code, 'permission');
  const fine = await w.runtime().request('outreach.prepare', input([]), { idempotencyKey: crypto.randomUUID() });
  assert.equal(fine.status, 'draft');
});

test('every route needs a session', async () => {
  const w = await world();
  for (const [path, method] of [[PATHS.contacts, 'POST'], [PATHS.context, 'GET'], [PATHS.connection, 'GET'], [PATHS.connect, 'POST'], [PATHS.messages, 'GET'], [PATHS.messages, 'POST'], [PATHS.prepare, 'POST'], [PATHS.status, 'GET']]) {
    const res = await w.h.call(path, method, { url: path, rawBody: method === 'POST' ? '{}' : undefined, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('the context query and lookup body are checked: a malformed area is a 400, an unknown place reads as no area', async () => {
  const w = await world();
  const bad = await w.call(PATHS.context, 'GET', { query: '?topic=Drinking%20water&water=Utility&area=%7Bnot-json' });
  assert.equal(bad.status, 400);
  const unknown = await w.runtime().request('outreach.context', { topic: 'Drinking water', water: 'Utility', area: { id: 'us-place:0000000' } });
  assert.equal(unknown.availability, 'empty');
  const extra = await w.call(PATHS.contacts, 'POST', { body: { topic: 'Drinking water', recipient: 'Utility', water: 'Utility', area: WAKE, email: 'x@y.z' } });
  assert.equal(extra.status, 400);
  assert.ok(placeById(WAKE.id));
});

test('no route reached the network, and none ever sent anything', () => {
  for (const w of worlds) assert.deepEqual(w.h.blockedFetches, []);
  assert.ok(worlds.length >= 10);
  assert.equal(ON.HALO_FEATURE_OUTREACH, 'on');
});

test('with outreach off the three reads are settled as off: lookup is disabled and no contact request is made', async () => {
  const w = await world({ env: { HALO_FEATURE_WORKSPACE: 'on' } });
  const s = await screen(w);
  for (const read of ['connection', 'history', 'evidenceRead']) assert.equal(s.state[read].off, true, read);
  assert.equal(s.derive().off, true);
  assert.equal(s.lookupDisabled(), true);
  assert.ok(!s.state.requests.includes('contacts.resolve'));
});
