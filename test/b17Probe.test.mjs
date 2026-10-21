/**
 * B17 adversarial probes (docs/backend/plans/b17-outreach-preparation.md): inputs
 * and states the main suites do not reach, on the same real stack (0017, 0022,
 * 0026 and 0031 on PGlite behind the real routes, the client's own runtime and
 * validators above). Each test names the failure it would catch. Nothing here
 * sends anything: every call runs with global fetch blocked.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDb } from './db/pgliteHarness.mjs';
import { RALEIGH, WAKE, createWorld } from './helpers/outreachWorld.mjs';
import { rpcError } from './helpers/routeHarness.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { allPlaces, placeById } from '../lib/places.js';
import { RECIPIENTS, TOPICS, WATERS, countyFor, draftKey, publicContext, resolveContacts } from '../lib/outreach.js';

const { FrontendServiceError } = await loadFrontend('production/runtime');
const { validContacts } = await loadFrontend('production/explore-service');
const { validOutreachEvidence, validOutreachHistory } = await loadFrontend('production/outreach-service');
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const PATHS = Object.freeze({
  contacts: '/api/outreach/contacts', context: '/api/outreach/context', connection: '/api/outreach/connection', connect: '/api/outreach/connect',
  messages: '/api/outreach/messages', prepare: '/api/outreach/messages/prepare', status: '/api/outreach/messages/status',
});
const DURHAM = placeById('us-county:37063');
const CONTEXT = { topic: 'A home concern', recipient: 'Local office', area: WAKE, water: 'Utility' };
const input = (over = {}) => ({
  to: 'office@wake.example', name: '', subject: 'A question', body: 'Hello, I have a question.', notes: [], publicContext: null,
  context: CONTEXT, signature: 'sig', senderRevision: 1, ...over,
});
const key = () => crypto.randomUUID();
const post = (w, body, { as = 'alice', idem = key(), raw } = {}) =>
  w.call(PATHS.prepare, 'POST', { as, body: raw ?? body, headers: { 'idempotency-key': idem } });
const rejection = (promise) => promise.then(() => null, (error) => error);

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });
const worlds = [];
async function world(options) { const w = await createWorld(db, options); worlds.push(w); return w; }
const ledger = async (w, who = 'alice') =>
  (await db.query(`select operation_id::text, status, result from public.operations where profile_id = $1 and domain = 'outreach' order by created_at`, [w.ids[who]])).rows;

/** console.error lines a test produced, as one string. */
const logged = (mock) => mock.mock.calls.map((call) => call.arguments.map(String).join(' ')).join('\n');

// ---------------------------------------------------------------- prepare input

test('characters PostgreSQL cannot store are a 400 before any claim, never a 5xx the client would park as unknown_outcome', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const w = await world();
  await w.saveArea('alice', WAKE);
  // JSON allows a lone surrogate escape; PostgreSQL jsonb and text do not.
  for (const [field, value] of [['body', 'Hello \\ud800 there'], ['subject', 'Hi \\udc00'], ['name', 'A \\ud83d'], ['to', 'a\\ud800@b.example']]) {
    const base = JSON.stringify(input()).replace(/^\{/, '').replace(/\}$/, '');
    const patched = base.replace(new RegExp(`"${field}":"[^"]*"`), `"${field}":"${value}"`);
    const res = await post(w, null, { raw: `{${patched}}` });
    assert.ok(res.status >= 400 && res.status < 500, `${field}: got ${res.status}`);
    assert.equal(res.status, 400, field);
  }
  assert.deepEqual(await ledger(w), []);
  assert.deepEqual(await w.drafts(), []);
  assert.equal(logged(errors), '');
});

test('an address whose lowercase form is longer than 300 characters is a 400, not a check violation', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const w = await world();
  await w.saveArea('alice', WAKE);
  // U+0130 lowercases to two code points: 150 of them plus a short domain is a valid 254-unit address
  // whose draft key (recipient + lowercase address) passes 300 characters.
  const to = `${'İ'.repeat(120)}@wake.example`;
  assert.ok(to.length <= 254);
  assert.ok(Array.from(draftKey('Local office', to)).length > 240);
  const longer = `${'İ'.repeat(250)}@a.b`.slice(0, 254);
  assert.ok(Array.from(draftKey('Local office', longer)).length > 300);
  const res = await post(w, input({ to: longer }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'validation_failed');
  const ok = await post(w, input({ to }));
  assert.equal(ok.status, 200);
  assert.equal(logged(errors), '');
});

test('prepare edge inputs: whitespace, case, order, duplicates and size limits answer a definite 4xx or a clean 200', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const status = async (over, opts) => (await post(w, input(over), opts)).status;
  assert.equal(await status({ subject: '   ' }), 400, 'blank subject');
  assert.equal(await status({ subject: ' padded ' }), 400, 'the screen trims, so untrimmed is refused');
  assert.equal(await status({ to: 'office@wake.example ' }), 400, 'trailing space');
  assert.equal(await status({ to: ' office@wake.example' }), 400, 'leading space');
  assert.equal(await status({ body: '   \n ' }), 400, 'blank body');
  assert.equal(await status({ subject: 'x'.repeat(201) }), 400);
  assert.equal(await status({ subject: '\u{1F30A}'.repeat(200) }), 200, '200 emoji is 200 characters, not 400');
  assert.equal(await status({ subject: '\u{1F30A}'.repeat(201) }), 400);
  assert.equal(await status({ name: '\u{1F30A}'.repeat(160) }), 200);
  assert.equal(await status({ name: '\u{1F30A}'.repeat(161) }), 400);
  assert.equal(await status({ body: '\u{1F30A}'.repeat(20000) }), 200, 'the limit is in characters');
  assert.equal(await status({ body: '\u{1F30A}'.repeat(20001) }), 400);
  assert.equal(await status({ signature: 's'.repeat(200001) }), 400);
  assert.equal(await status({ signature: '' }), 400);
  assert.equal(await status({ senderRevision: 1.5 }), 400);
  assert.equal(await status({ senderRevision: '1' }), 400);
  // 413 for a body past the route's cap, before anything else.
  const huge = await post(w, null, { raw: JSON.stringify(input({ body: 'x'.repeat(450000) })) });
  assert.equal(huge.status, 413);
  // Duplicated note ids, too many notes, odd ids.
  assert.equal(await status({ notes: [{ id: 'n', revision: 1 }, { id: 'n', revision: 2 }] }), 400);
  assert.equal(await status({ notes: Array.from({ length: 31 }, (_, at) => ({ id: `n${at}`, revision: 1 })) }), 400);
  assert.equal(await status({ notes: [{ id: '', revision: 1 }] }), 400);
  assert.equal(await status({ notes: [{ id: 'n', revision: 0 }] }), 400);
  assert.equal(await status({ notes: [{ id: 'n', revision: 1, extra: true }] }), 400);
  assert.equal(await status({ notes: 'n' }), 400);
  assert.equal(await status({ publicContext: { id: 'x' } }), 400);
  assert.equal(await status({ publicContext: [] }), 400);
  assert.equal(await status({ context: { ...CONTEXT, extra: 1 } }), 400);
  assert.equal(await status({ context: { ...CONTEXT, area: 'wake' } }), 400);
  assert.equal(await status({ context: { ...CONTEXT, area: null } }), 400);
  assert.equal(await status({ context: { ...CONTEXT, topic: 'constructor' } }), 400);
  assert.equal(await status({ context: { ...CONTEXT, recipient: 'toString' } }), 400);
  assert.equal(await status({ context: { ...CONTEXT, area: { id: '__proto__' } } }), 409, 'an id outside the gazetteer is not the saved area');
  assert.equal(await status({ context: { ...CONTEXT, area: { id: ['us-county:37183'] } } }), 400);
  // Not an object, or not JSON, with a valid key.
  assert.equal((await post(w, null, { raw: '[]' })).status, 400);
  assert.equal((await post(w, null, { raw: '"x"' })).status, 400);
  assert.equal((await post(w, null, { raw: '{not json' })).status, 400);
  assert.equal((await post(w, null, { raw: '' })).status, 400, 'an empty body is {} and every key is required');
  // Idempotency-Key: missing, not a uuid, upper case (normalised).
  assert.equal((await w.call(PATHS.prepare, 'POST', { body: input() })).status, 400);
  assert.equal((await post(w, input(), { idem: 'not-a-uuid' })).status, 400);
  assert.equal((await post(w, input(), { idem: crypto.randomUUID().toUpperCase() })).status, 200);
  // Mixed-case address: accepted as typed, and the same draft as its lowercase form.
  const upper = await (await post(w, input({ to: 'Office@Wake.Example' }))).json();
  const lower = await (await post(w, input({ to: 'office@wake.example' }))).json();
  assert.equal(upper.id, lower.id);
  assert.equal(upper.to, 'Office@Wake.Example');
  assert.equal(lower.to, 'office@wake.example');
  assert.equal(lower.revision, upper.revision + 1, 'a casing change is a content change');
});

test('sections: order, repetition, CRLF and a source chosen without its text', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const a = await w.saveNote('alice', { title: 'First', description: 'Line one\r\nLine two' });
  const b = await w.saveNote('alice', { title: 'Second', description: 'Plain.' });
  const ctx = { ...CONTEXT, topic: 'Drinking water' };
  const evidence = (await w.runtime().request('outreach.context', { topic: ctx.topic, water: 'Utility', area: WAKE }));
  const entry = evidence.entries[0];
  const evidenceText = `\n\nPublic context I chose to include:\n${entry.title}\n${entry.text}\n${entry.scope}\nAs of ${entry.asOf}\n${entry.url}`;
  const notesText = (list) => `\n\nNotes I chose to include:\n${list.map((n) => `${n.title}\n${n.description}`).join('\n\n')}`;
  const refs = (list) => list.map((n) => ({ id: n.id, revision: n.revision }));
  const status = async (over) => (await post(w, input({ context: ctx, ...over }))).status;

  // The order of `notes` is the order of the body.
  assert.equal(await status({ notes: refs([a, b]), body: `Hi.${notesText([a, b])}` }), 200);
  assert.equal(await status({ notes: refs([a, b]), body: `Hi.${notesText([b, a])}` }), 422, 'body order differs from notes order');
  assert.equal(await status({ notes: refs([b, a]), body: `Hi.${notesText([b, a])}` }), 200, 'the reverse is another valid draft');
  // The source goes before the notes, as the screen composes them.
  const both = `Hi.${evidenceText}${notesText([a])}`;
  assert.equal(await status({ publicContext: { id: entry.id, revision: evidence.revision }, notes: refs([a]), body: both }), 200);
  assert.equal(await status({ publicContext: { id: entry.id, revision: evidence.revision }, notes: refs([a]), body: `Hi.${notesText([a])}${evidenceText}` }), 422, 'notes before the source');
  // A source named but missing from the body, and a body carrying the source with none named.
  assert.equal(await status({ publicContext: { id: entry.id, revision: evidence.revision }, body: 'Hi.' }), 422);
  assert.equal(await status({ body: `Hi.${evidenceText}` }), 200, 'with no source chosen it is only the letter quoting one');
  // The sections twice: the letter may quote them; only the end must match.
  const twice = await post(w, input({ context: ctx, notes: refs([b]), body: `Hi.${notesText([b])}${notesText([b])}` }));
  assert.equal(twice.status, 200);
  assert.equal((await twice.json()).body, `Hi.${notesText([b])}${notesText([b])}`);
  // Text after the sections.
  assert.equal(await status({ notes: refs([b]), body: `Hi.${notesText([b])}\nP.S.` }), 422);
  // CRLF anywhere in the letter, and a note whose own text carries CRLF.
  assert.equal(await status({ body: 'Line one\r\nLine two\r\n' }), 200);
  assert.equal(await status({ notes: refs([a]), body: `Hi\r\nthere.${notesText([a])}` }), 200);
  // A source from the wrong county or topic.
  assert.equal(await status({ context: { ...ctx, topic: 'A home concern' }, publicContext: { id: entry.id, revision: evidence.revision }, body: both }), 409);
  await w.saveArea('alice', DURHAM);
  assert.equal(await status({ context: { ...ctx, area: DURHAM }, publicContext: { id: entry.id, revision: evidence.revision }, body: both, notes: refs([a]) }), 409, "Wake County's release in a Durham County message");
  assert.equal(await status({ context: ctx, publicContext: { id: entry.id, revision: evidence.revision }, body: both, notes: refs([a]) }), 409, 'the saved area is Durham now');
});

test('a note text that cannot be in a body the server accepts is a definite refusal, not a 5xx', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const w = await world();
  await w.saveArea('alice', WAKE);
  const note = await w.saveNote('alice', { title: 'Odd', description: 'Em dash \u2014 inside' });
  const sections = `\n\nNotes I chose to include:\n${note.title}\n${note.description}`.replace(/\u2014/g, ',');
  const res = await post(w, input({ notes: [{ id: note.id, revision: note.revision }], body: `Hi.${sections}` }));
  assert.equal(res.status, 200, 'the screen cleans the dash, and the server composes the same cleaned text');
  const [stored] = await w.drafts();
  assert.ok(!stored.body.includes('\u2014'));
  assert.equal(logged(errors), '');
});

// ------------------------------------------------------ races, limits, replays

test('two identical requests at once: one draft, the answers agree, and neither is a 5xx', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const idem = key();
  const [one, two] = await Promise.all([post(w, input(), { idem }), post(w, input(), { idem })]);
  for (const res of [one, two]) assert.ok([200, 503].includes(res.status), String(res.status));
  assert.ok([one.status, two.status].includes(200));
  assert.equal((await w.drafts()).length, 1);
  assert.equal((await ledger(w)).length, 1);
  const retry = await post(w, input(), { idem });
  assert.equal(retry.status, 200);
});

test('a competing first save for the same recipient (unique violation) settles as a clean save, not a 5xx', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  let raced = false;
  const w = await world({
    wrap: {
      save_outreach_draft: async (args, call) => {
        if (!raced) {
          raced = true;
          // The other request's save lands first, in its own transaction, for the same draft key.
          const sibling = crypto.randomUUID();
          await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'outreach', 'outreach.prepare', 'pending', 'x')`, [sibling, args.p_profile_id]);
          await db.asService((tx) => tx.query('select public.save_outreach_draft($1::uuid, $2::uuid, $3::jsonb)', [args.p_profile_id, sibling, JSON.stringify(args.p_draft)]), { commit: true });
          throw rpcError('23505', 'duplicate key value violates unique constraint "outreach_drafts_profile_id_draft_key_key"');
        }
        return call();
      },
    },
  });
  await w.saveArea('alice', WAKE);
  const res = await post(w, input());
  assert.equal(res.status, 200, 'the client would otherwise park this as unknown_outcome');
  const draft = await res.json();
  assert.equal(draft.revision, 1, 'the same content as the competing save');
  assert.equal((await w.drafts()).length, 1);
  assert.equal(logged(errors), '');
});

test('the 100 draft limit through the route: refused with 422 limit and replayed, while changing an existing draft still works', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const first = await (await post(w, input({ to: 'first@wake.example' }))).json();
  await db.query(
    `insert into public.outreach_drafts (draft_id, profile_id, draft_key, recipient, topic, water, subject, body, signature_hash, operation_id)
     select gen_random_uuid(), $1, 'Local office|seed' || n, 'Local office', 'A home concern', 'Utility', 's', 'b', repeat('a', 64), gen_random_uuid() from generate_series(1, 99) n`,
    [w.ids.alice],
  );
  assert.equal((await w.drafts()).length, 100);
  const idem = key();
  const over = await post(w, input({ to: 'new@wake.example' }), { idem });
  assert.equal(over.status, 422);
  const refusal = await over.json();
  assert.equal(refusal.reason, 'limit');
  assert.equal(refusal.code, 'validation_failed');
  const again = await post(w, input({ to: 'new@wake.example' }), { idem });
  assert.equal(again.status, 422, 'the stored refusal replays');
  assert.equal((await again.json()).reason, 'limit');
  assert.equal((await w.drafts()).length, 100);
  const edit = await post(w, input({ to: 'first@wake.example', body: 'Changed text.' }));
  assert.equal(edit.status, 200);
  assert.deepEqual([(await edit.json()).id, (await w.drafts()).length], [first.id, 100]);
  const rows = await ledger(w);
  assert.ok(rows.every((row) => ['succeeded', 'failed'].includes(row.status)), 'no row left pending');
  // The history lists all 100 and the client accepts it.
  const history = await w.runtime().request('outreach.history', {});
  assert.equal(history.drafts.length, 100);
  assert.ok(validOutreachHistory(history));
});

test('a household that is not alice cannot read, replay, reconcile or reference her drafts, notes or keys', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  await w.saveArea('bob', WAKE);
  const note = await w.saveNote('alice', { title: 'Alice only', description: 'Secret text.' });
  const idem = key();
  const mine = await (await post(w, input({ body: 'ALICE-BODY' }), { idem })).json();
  const bobKey = (over, opts = {}) => post(w, input(over), { as: 'bob', ...opts });

  // Reusing alice's key is a mismatch, whatever the body, and says nothing about whose it is.
  for (const body of [input({ body: 'ALICE-BODY' }), input({ body: 'other' })]) {
    const res = await post(w, body, { as: 'bob', idem });
    assert.equal(res.status, 409);
    const text = JSON.stringify(await res.json());
    assert.ok(!text.includes('ALICE') && !text.includes(mine.id));
  }
  assert.equal((await w.drafts('bob')).length, 0);
  // Reconcile her operation as bob: not found, in either domain.
  assert.equal((await w.reconcile(idem, { as: 'bob', domain: 'outreach' })).status, 404);
  // Her note and her draft id.
  const noted = await bobKey({ notes: [{ id: note.id, revision: note.revision }], body: 'Hi\n\nNotes I chose to include:\nAlice only\nSecret text.' });
  assert.equal(noted.status, 409);
  assert.ok(!(await noted.text()).includes('Secret'));
  const peek = await w.call(PATHS.status, 'GET', { as: 'bob', query: `?id=${mine.id}` });
  assert.equal(peek.status, 404);
  assert.deepEqual((await (await w.call(PATHS.messages, 'GET', { as: 'bob' })).json()).drafts, []);
  // The same address and text for bob is bob's own draft, not alice's.
  const own = await (await bobKey({ body: 'ALICE-BODY' })).json();
  assert.notEqual(own.id, mine.id);
  assert.equal((await w.drafts('alice')).length, 1);
  // A header cannot choose the household.
  const forged = await w.call(PATHS.messages, 'GET', { as: 'bob', headers: { 'x-halo-user-id': w.ids.alice, 'x-user-id': w.ids.alice } });
  assert.deepEqual((await forged.json()).drafts.map((d) => d.id), [own.id]);
});

// -------------------------------------------------------------- reads and status

test('status and context never 5xx on malformed ids and odd query strings', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const w = await world();
  await w.saveArea('alice', WAKE);
  const draft = await (await post(w, input())).json();
  const statusOf = async (query) => (await w.call(PATHS.status, 'GET', { query })).status;
  for (const query of ['', '?id=', '?id=abc', `?id=${draft.id}x`, `?id=other&id=${draft.id}`, '?id[]=x', `?id=${'a'.repeat(5000)}`, '?id=%ff%fe', `?id={${draft.id}}`, `?id=${draft.id.replace(/-/g, '')}`, '?id=00000000-0000-0000-0000-000000000000', "?id=1'; drop table outreach_drafts;--"]) {
    const code = await statusOf(query);
    assert.ok(code === 400 || code === 404, `${query.slice(0, 40)} -> ${code}`);
  }
  assert.equal(await statusOf(`?id=${draft.id}`), 200);
  assert.ok([200, 400].includes(await statusOf(`?id=${draft.id.toUpperCase()}`)));
  assert.equal((await w.drafts()).length, 1, 'the injection string did nothing');

  const q = (params) => `?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const base = { topic: 'Drinking water', water: 'Utility' };
  const area = JSON.stringify(WAKE);
  const cases = [
    ['', 400], [q(base), 200], [q({ ...base, area: '' }), 400], [q({ ...base, area: 'null' }), 400], [q({ ...base, area: '[]' }), 400],
    [q({ ...base, area: '"x"' }), 400], [q({ ...base, area: '{}' }), 200], [q({ ...base, area: '{"id":5}' }), 400], [q({ ...base, area: '{"id":null}' }), 400],
    [q({ ...base, area: `{"id":"${'x'.repeat(81)}"}` }), 400], [q({ ...base, area: 'x'.repeat(2001) }), 400], [q({ ...base, area }), 200],
    [q({ ...base, area, extra: '1' }), 200], [q({ topic: 'drinking water', water: 'Utility', area }), 400], [q({ ...base, water: 'Well', area }), 400],
    [`${q({ ...base, area })}&topic=Volunteering`, 200], ['?topic=%ff&water=Utility', 400], [q({ ...base, area: '{"id":"__proto__"}' }), 200],
    [q({ ...base, area: '{"id":"constructor"}' }), 200],
  ];
  for (const [query, expected] of cases) {
    const res = await w.call(PATHS.context, 'GET', { query });
    assert.equal(res.status, expected, query.slice(0, 80));
    if (res.status === 200) assert.ok(validOutreachEvidence(await res.json()));
  }
  assert.equal(logged(errors), '');
});

test('contacts.resolve bodies: wrong shapes are 400, an oversize body 413, and nothing throws', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const w = await world();
  const send = async (body) => (await w.call(PATHS.contacts, 'POST', { body })).status;
  const ok = { topic: 'Volunteering', recipient: 'Local office', water: 'Utility', area: WAKE };
  assert.equal(await send(ok), 200);
  for (const bad of [{}, { ...ok, area: null }, { ...ok, area: 'x' }, { ...ok, area: [] }, { ...ok, area: { id: 7 } }, { ...ok, topic: ['Volunteering'] },
    { ...ok, recipient: null }, { ...ok, water: undefined }, { ...ok, extra: 1 }, { ...ok, topic: '__proto__' }]) {
    assert.equal(await send(bad), 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(await send({ ...ok, area: { place: '', state: '' } }), 200);
  assert.equal(await send({ ...ok, area: { id: '__proto__' } }), 200);
  assert.equal(await send({ ...ok, area: { id: 'constructor' } }), 200);
  assert.equal(await send({ ...ok, padding: 'x'.repeat(9000) }), 413);
  assert.equal((await w.call(PATHS.contacts, 'POST', { body: '[1]' })).status, 400);
  assert.equal(logged(errors), '');
});

test('every recipient, topic and water context for every city, ZIP and county in the gazetteer passes the client validators', () => {
  const places = [null, ...allPlaces()];
  assert.ok(places.length > 500);
  let withoutCounty = 0;
  for (const place of places) {
    const county = countyFor(place);
    if (place && !county) withoutCounty += 1;
    for (const topic of TOPICS) {
      for (const water of WATERS) {
        for (const recipient of RECIPIENTS) {
          const answer = resolveContacts({ topic, recipient, water, place });
          assert.ok(validContacts(answer), `${place?.id} ${topic} ${recipient} ${water}`);
          assert.ok(answer.contacts.length <= 20);
          assert.equal(answer.coverage, answer.contacts.length ? 'matched' : 'none');
          assert.ok(!JSON.stringify(answer).includes('\u2014'));
          if (county && county.byPoint && (recipient === 'Local office' || recipient === undefined)) {
            const local = answer.contacts.filter((c) => /^nc-(lhd|extension)-/.test(c.id));
            for (const office of local) assert.match(office.reason, /Census center point/, `${place.id}: a matched city or ZIP says how`);
          }
        }
        if (water === 'Utility' || topic === 'Drinking water') assert.ok(validOutreachEvidence(publicContext({ topic, water, place })), `${place?.id} ${topic} ${water}`);
      }
    }
  }
  assert.ok(withoutCounty < places.length / 20, `${withoutCounty} places have no county`);
  // A place with no county never invents a local office.
  const outside = allPlaces().find((place) => !countyFor(place));
  if (outside) {
    const answer = resolveContacts({ topic: 'A home concern', recipient: 'Local office', water: 'Utility', place: outside });
    assert.ok(answer.contacts.every((c) => !/^nc-(lhd|extension)-/.test(c.id)));
    assert.ok(answer.contacts.length === 0 || answer.contacts.every((c) => c.id.startsWith('nc-')));
  }
});

test('a city is looked up by its Census point and the answer says so; a county says nothing of the kind', async () => {
  const w = await world();
  const lookup = (area) => w.runtime().request('contacts.resolve', { topic: 'Volunteering', recipient: 'Local office', water: 'Utility', area });
  const city = await lookup(RALEIGH);
  const county = await lookup(WAKE);
  assert.match(city.contacts[0].reason, /matched to Wake County by its Census center point/);
  assert.doesNotMatch(county.contacts[0].reason, /Census/);
  assert.deepEqual(city.contacts.map((c) => c.id), county.contacts.map((c) => c.id));
});

// ---------------------------------------------------------- flags and migrations

test('flag combinations: outreach on with workspace off keeps every read and the note-free prepare; only notes are refused', async () => {
  const w = await world({ env: { HALO_FEATURE_OUTREACH: 'on' } });
  await w.saveArea('alice', WAKE);
  for (const path of [PATHS.connection, PATHS.messages]) assert.equal((await w.call(path, 'GET')).status, 200, path);
  assert.equal((await post(w, input())).status, 200);
  const refused = await post(w, input({ notes: [{ id: 'exploreNotes-x', revision: 1 }], body: 'B\n\nNotes I chose to include:\nA\nB' }));
  assert.equal(refused.status, 403);
  assert.equal((await ledger(w)).length, 1, 'the refused prepare claimed nothing');
});

test('a missing dependency table is a definite 403 for prepare and a non-retryable 503 for history, with nothing claimed', async () => {
  for (const [table, ledgerRows] of [['explore_areas', 0], ['operations', null]]) {
    const w = await world();
    await w.saveArea('alice', WAKE);
    const real = w.h.db.from;
    w.h.db.from = (name) => (name === table ? { select: () => { const q = {}; q.eq = () => q; q.maybeSingle = async () => ({ data: null, error: { code: 'PGRST205', message: `no ${table}` } }); q.then = (res) => res({ data: null, error: { code: 'PGRST205', message: `no ${table}` } }); return q; } } : real(name));
    const res = await post(w, input());
    assert.equal(res.status, 403, table);
    assert.equal((await res.json()).code, 'feature_unavailable');
    w.h.db.from = real;
    if (ledgerRows !== null) assert.equal((await ledger(w)).length, ledgerRows);
  }
});

// ------------------------------------------------------------ logs and the network

test('what the routes log on a failure: the request id and the database error code and message only, never a body, address or draft id', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const SECRET = 'SECRET-BODY-TEXT';
  let failures = 0;
  const w = await world({
    wrap: {
      save_outreach_draft: async () => { failures += 1; throw rpcError('XX000', `boom`, `Failing row contains (${SECRET}, someone@example.org)`, `hint ${SECRET}`); },
      read_outreach_drafts: async (args, call) => {
        if (args.p_draft_id === '00000000-0000-0000-0000-000000000000') return call();
        throw rpcError('XX000', 'read boom', `detail ${SECRET}`);
      },
    },
  });
  await w.saveArea('alice', WAKE);
  const res = await post(w, input({ body: SECRET, to: 'someone@example.org' }));
  assert.equal(res.status, 500);
  const status = await w.call(PATHS.status, 'GET', { query: `?id=${crypto.randomUUID()}` });
  assert.equal(status.status, 500);
  const history = await w.call(PATHS.messages, 'GET');
  assert.equal(history.status, 500);
  assert.ok(failures >= 1);
  const text = logged(errors);
  assert.match(text, /outreach prepare failed \(request [^)]+\): XX000 boom/);
  for (const secret of [SECRET, 'someone@example.org', w.ids.alice, 'office@wake']) assert.ok(!text.includes(secret), `the log names ${secret}`);
  // The save threw after the claim: the row is settled failed, so a retry with the same key says "did not finish".
  const [row] = await ledger(w);
  assert.equal(row.status, 'failed');
});

test('every console.error in the B17 files prints only a request id and a loggable error', async () => {
  const files = ['lib/outreach.js', 'app/api/outreach/connect/route.js', 'app/api/outreach/connection/route.js', 'app/api/outreach/contacts/route.js', 'app/api/outreach/context/route.js',
    'app/api/outreach/messages/route.js', 'app/api/outreach/messages/prepare/route.js', 'app/api/outreach/messages/status/route.js'];
  let calls = 0;
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [call] of source.matchAll(/console\.(error|log|warn|info|debug)\([^;]*;/g)) {
      calls += 1;
      const args = call.replace(/^console\.\w+\(/, '');
      assert.match(args, /^`[a-z: ]+ \(request \$\{requestId\}(, ledger status \$\{outcome\.status\})?\)(:)?`(, loggableError\(err\))?\);$/, `${file}: ${call}`);
    }
  }
  assert.ok(calls >= 7);
});

test('the dependencies of the B17 libraries reach no network or mail module', async () => {
  const BAD = /node:(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)|\bfetch\s*\(|XMLHttpRequest|WebSocket|nodemailer|googleapis|sendgrid|mailgun|smtp/i;
  for (const file of ['lib/outreach.js', 'lib/places.js', 'lib/geoContainment.js', 'lib/validate.js', 'lib/apiErrors.js', 'lib/features.js', 'lib/exploreArea.js', 'lib/workspaceStore.js']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, BAD, file);
  }
  for (const w of worlds) assert.deepEqual(w.h.blockedFetches, []);
});

test('the client reads the refusal statuses as definite, and only a real 5xx as unknown_outcome', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const code = async (promise) => (await rejection(promise))?.code ?? 'ok';
  const rt = w.runtime();
  assert.equal(await code(rt.request('outreach.prepare', input({ senderRevision: 9 }), { idempotencyKey: key() })), 'conflict');
  assert.equal(await code(rt.request('outreach.prepare', input({ subject: '' }), { idempotencyKey: key() })), 'validation');
  assert.equal(await code(rt.request('outreach.prepare', input({ body: 'x'.repeat(450000) }), { idempotencyKey: key() })), 'unavailable', '413 is not a 5xx');
  assert.equal(await code(rt.request('outreach.connect', { provider: 'gmail', returnPath: '/act' }, { idempotencyKey: key() })), 'permission');
  assert.equal(await code(rt.request('contacts.resolve', { topic: 'Volunteering', recipient: 'Landlord', water: 'Utility', area: WAKE }, { idempotencyKey: key() })), 'ok');
  assert.ok(FrontendServiceError);
});

test('no public context entry carries an em dash into the screen, for any county, and each entry is addressable by id', () => {
  for (const place of allPlaces().filter((item) => item.id.startsWith('us-county:'))) {
    const evidence = publicContext({ topic: 'Drinking water', water: 'Utility', place });
    assert.ok(!JSON.stringify(evidence).includes('\u2014'), place.label);
    assert.equal(new Set(evidence.entries.map((entry) => entry.id)).size, evidence.entries.length, `${place.label}: ids are unique, so a chosen entry is one entry`);
    assert.ok(evidence.entries.every((entry) => entry.url.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(entry.asOf)));
  }
});

test('a note that changes between the check and the save is a stored 409 stale_note: nothing saved, replayed as the same refusal', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  let bump = false;
  const w = await world({
    wrap: {
      save_outreach_draft: async (args, call) => {
        if (bump) await db.query(`update public.household_workspace_records set revision = revision + 1 where profile_id = $1 and collection = 'exploreNotes'`, [args.p_profile_id]);
        return call();
      },
    },
  });
  await w.saveArea('alice', WAKE);
  const note = await w.saveNote('alice', { title: 'Odor', description: 'After rain.' });
  const body = input({ notes: [{ id: note.id, revision: note.revision }], body: `Hi.\n\nNotes I chose to include:\n${note.title}\n${note.description}` });
  bump = true;
  const idem = key();
  const first = await post(w, body, { idem });
  assert.equal(first.status, 409);
  assert.equal((await first.json()).reason, 'stale_note');
  const again = await post(w, body, { idem });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).reason, 'stale_note');
  assert.deepEqual(await w.drafts(), []);
  const [row] = await ledger(w);
  assert.equal(row.status, 'failed');
  assert.equal(logged(errors), '');
});

test('without the ledger table, history is the non-retryable 503 and a prepare is a definite 403', async () => {
  const w = await world();
  await w.saveArea('alice', WAKE);
  const real = w.h.db.from;
  const missing = { code: 'PGRST205', message: 'no operations' };
  w.h.db.from = (name) => {
    if (name !== 'operations') return real(name);
    // Every builder method chains; awaiting any chain answers the missing-table error.
    const q = new Proxy({}, { get: (_, prop) => (prop === 'then' ? (res) => res({ data: null, error: missing }) : prop === 'maybeSingle' || prop === 'single' ? async () => ({ data: null, error: missing }) : () => q) });
    return q;
  };
  const history = await w.call(PATHS.messages, 'GET');
  assert.equal(history.status, 503);
  assert.equal((await history.json()).retryable, false);
  assert.equal((await post(w, input())).status, 403);
  w.h.db.from = real;
});
