import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { localDate, addDays } from './helpers/isolationSeed.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const { BAND_KEYS } = await import('../lib/household.js');
const chr = (code) => String.fromCharCode(code);
const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const TABLES = ['symptom_logs', 'profiles', 'household_bands', 'daily_scores'];
const ALICE_ENTRY = 'a11ce000-0000-4000-8000-000000000001';
const BOB_ENTRY = 'b0b00000-0000-4000-8000-000000000001';

function harness() {
  return createRouteHarness({
    tables: haloTables(...TABLES),
    seed: ({ alice, bob }) => ({
      symptom_logs: [
        { id: ALICE_ENTRY, profile_id: alice.id, entry_date: day(2), band: 'household', symptoms: ['cough'], severity: 'bad', note: 'old note' },
        { id: BOB_ENTRY, profile_id: bob.id, entry_date: day(2), band: 'household', symptoms: ['sneezing'], severity: 'mild', note: 'bob note' },
      ],
    }),
  });
}
const post = (h, body, options = {}) => h.call('/api/journal', 'POST', { as: 'alice', body, ...options });
const postRaw = (h, rawBody, options = {}) => h.call('/api/journal', 'POST', { as: 'alice', rawBody, ...options });
const snapshot = (h) => JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, h.db.rows(table)])));
const bad = async (h, body, expected) => {
  const before = snapshot(h);
  const logBefore = h.db.queryLog.length;
  const res = await post(h, body);
  const envelope = await expectEnvelope(res, { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(envelope.error, envelope.field_errors[0].message);
  assert.equal(snapshot(h), before, 'a rejected entry changes no table');
  assert.equal(h.db.queryLog.length, logBefore, 'and no statement was run');
};

// ------------------------------------------------------------ legacy

test('legacy request: a full valid entry is saved with the same status and body shape, plus a request id header', async () => {
  const h = harness();
  const res = await post(h, { entry_date: day(1), band: 'has_toddler', symptoms: ['cough', 'itchy eyes'], severity: 'Moderate', note: 'Windy day', retrospective: true, possibly_illness: false });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['entry']);
  assert.deepEqual(Object.keys(body.entry).sort(), ['band', 'created_at', 'entry_date', 'id', 'note', 'possibly_illness', 'profile_id', 'retrospective', 'severity', 'symptoms', 'updated_at']);
  assert.deepEqual(
    { ...body.entry, id: undefined, created_at: undefined, updated_at: undefined },
    { id: undefined, created_at: undefined, updated_at: undefined, profile_id: h.identities.alice.id, entry_date: day(1), band: 'has_toddler', symptoms: ['cough', 'itchy eyes'], severity: 'moderate', note: 'Windy day', retrospective: true, possibly_illness: false },
  );
  assert.match(body.entry.id, UUID);
  assert.equal(h.db.rows('symptom_logs').length, 3);
});

test('legacy request: only entry_date is needed, and every other field takes its old default', async () => {
  const h = harness();
  const { entry } = await (await post(h, { entry_date: day(5) })).json();
  assert.deepEqual([entry.band, entry.symptoms, entry.severity, entry.note, entry.retrospective, entry.possibly_illness], ['household', [], null, null, false, false]);
});

test('legacy request: re-logging a date and group replaces the whole row, it never duplicates', async () => {
  const h = harness();
  const { entry } = await (await post(h, { entry_date: day(2) })).json();
  assert.equal(entry.id, ALICE_ENTRY, 'merged into the existing row');
  assert.deepEqual([entry.symptoms, entry.severity, entry.note], [[], null, null], 'fields left out are cleared, as before');
  assert.equal(h.db.rows('symptom_logs').filter((row) => row.profile_id === h.identities.alice.id).length, 1);
});

test('legacy request: the identity is the token, whatever profile_id, user_id or id the body names; unknown keys are ignored', async () => {
  const h = harness();
  const bobBefore = JSON.stringify(h.db.rows('symptom_logs').filter((row) => row.profile_id === h.identities.bob.id));
  const { entry } = await (await post(h, { entry_date: day(2), symptoms: ['x'], profile_id: h.identities.bob.id, user_id: h.identities.bob.id, id: BOB_ENTRY, owner_id: h.identities.bob.id, extra: 1 })).json();
  assert.equal(entry.profile_id, h.identities.alice.id);
  assert.equal(entry.id, ALICE_ENTRY);
  assert.equal(JSON.stringify(h.db.rows('symptom_logs').filter((row) => row.profile_id === h.identities.bob.id)), bobBefore);
  const upsert = h.db.queryLog.find((q) => q.table === 'symptom_logs' && q.operation === 'upsert');
  assert.deepEqual(upsert.rows.map((row) => row.profile_id), [h.identities.alice.id]);
  assert.equal('extra' in entry, false);
});

test('severity is case-insensitive, as before, and null means none', async () => {
  const h = harness();
  for (const [sent, stored] of [['MILD', 'mild'], ['Moderate', 'moderate'], ['bad', 'bad'], [null, null]]) {
    const { entry } = await (await post(h, { entry_date: day(3), severity: sent })).json();
    assert.equal(entry.severity, stored, String(sent));
  }
});

// ------------------------------------------------------- entry_date

test('entry_date: today, tomorrow and 2000-01-01 are accepted; the day after tomorrow and 1999-12-31 are not', async () => {
  const h = harness();
  for (const date of [TODAY, addDays(TODAY, 1), '2000-01-01', '2024-02-29']) assert.equal((await post(h, { entry_date: date })).status, 200, date);
  await bad(h, { entry_date: addDays(TODAY, 2) }, [['entry_date', 'date_out_of_range']]);
  await bad(h, { entry_date: '1999-12-31' }, [['entry_date', 'date_out_of_range']]);
});

for (const [label, value, code] of [
  ['a missing date', undefined, 'date_required'],
  ['null', null, 'date_required'],
  ['an impossible date', '2026-02-31', 'invalid_date'],
  ['a non-leap 29 February', '2025-02-29', 'invalid_date'],
  ['the wrong format', '10/01/2026', 'invalid_date'],
  ['a timestamp', `${TODAY}T10:00:00Z`, 'invalid_date'],
  ['an empty string', '', 'invalid_date'],
  ['a number', 20260101, 'invalid_date'],
  ['an array', [TODAY], 'invalid_date'],
  ['an object', { date: TODAY }, 'invalid_date'],
]) {
  test(`entry_date: ${label} is a 400 and changes nothing`, async () => {
    const body = value === undefined ? { symptoms: ['cough'] } : { entry_date: value };
    await bad(harness(), body, [['entry_date', code]]);
  });
}

test('a missing entry_date keeps the old sentence', async () => {
  const body = await expectEnvelope(await post(harness(), {}), { status: 400, code: 'validation_failed' });
  assert.equal(body.error, 'A valid entry_date (YYYY-MM-DD) is required.');
});

// ----------------------------------------------------- band, severity

test('band: each of the eight values is accepted; an empty or null band is the household, as before', async () => {
  const h = harness();
  for (const band of [...BAND_KEYS, 'household']) assert.equal((await (await post(h, { entry_date: day(4), band })).json()).entry.band, band);
  for (const band of ['', null]) assert.equal((await (await post(h, { entry_date: day(6), band })).json()).entry.band, 'household');
});

for (const [label, band] of [['an unknown group', 'has_pet'], ['a different case', 'HOUSEHOLD'], ['a number', 5], ['a boolean', true], ['an array', ['household']], ['an object', {}], ['padded text', ' household']]) {
  test(`band: ${label} is a 400 (it used to be silently the household for a non-string) and changes nothing`, async () => {
    await bad(harness(), { entry_date: day(1), band }, [['band', 'invalid_option']]);
  });
}

for (const [label, severity] of [['severe', 'severe'], ['empty', ''], ['a number', 5], ['an array', ['mild']], ['true', true], ['an object', {}]]) {
  test(`severity: ${label} is a 400 and changes nothing`, async () => {
    await bad(harness(), { entry_date: day(1), severity }, [['severity', 'invalid_option']]);
  });
}

// ---------------------------------------------------------- symptoms

test('symptoms: 20 are accepted and 21 are refused (not cut to 20); each is at most 80 characters', async () => {
  const h = harness();
  const names = (n) => Array.from({ length: n }, (_, i) => `symptom ${i}`);
  assert.equal((await (await post(h, { entry_date: day(1), symptoms: names(20) })).json()).entry.symptoms.length, 20);
  await bad(h, { entry_date: day(1), symptoms: names(21) }, [['symptoms', 'too_many_symptoms']]);
  assert.equal((await post(h, { entry_date: day(1), symptoms: ['a'.repeat(80)] })).status, 200);
  await bad(h, { entry_date: day(1), symptoms: ['ok', 'a'.repeat(81)] }, [['symptoms[1]', 'text_too_long']]);
  assert.equal((await post(h, { entry_date: day(1), symptoms: ['\u{1F927}'.repeat(80)] })).status, 200, 'an emoji is one character');
});

for (const [label, symptoms, expected] of [
  ['a string', 'cough', [['symptoms', 'invalid_symptoms']]],
  ['an object', { 0: 'cough' }, [['symptoms', 'invalid_symptoms']]],
  ['a number', 3, [['symptoms', 'invalid_symptoms']]],
  ['a number inside the list', ['cough', 5], [['symptoms[1]', 'invalid_text']]],
  ['null inside the list', [null], [['symptoms[0]', 'invalid_text']]],
  ['a nested list', [['cough']], [['symptoms[0]', 'invalid_text']]],
  ['a blank symptom, which would flag the day as symptomatic', ['cough', '   '], [['symptoms[1]', 'text_required']]],
  ['a line break inside a symptom', [`co${chr(0x0a)}ugh`], [['symptoms[0]', 'invalid_characters']]],
  ['a tab inside a symptom', [`co${chr(0x09)}ugh`], [['symptoms[0]', 'invalid_characters']]],
  ['a NUL inside a symptom', [`cough${chr(0)}`], [['symptoms[0]', 'invalid_characters']]],
  ['two bad symptoms', [5, 'a'.repeat(81)], [['symptoms[0]', 'invalid_text'], ['symptoms[1]', 'text_too_long']]],
]) {
  test(`symptoms: ${label} is a 400 and changes nothing`, async () => {
    await bad(harness(), { entry_date: day(1), symptoms }, expected);
  });
}

test('symptoms: null or absent is an empty list, and each symptom is stored trimmed', async () => {
  const h = harness();
  assert.deepEqual((await (await post(h, { entry_date: day(1), symptoms: null })).json()).entry.symptoms, []);
  assert.deepEqual((await (await post(h, { entry_date: day(1), symptoms: ['  itchy eyes ', 'cough'] })).json()).entry.symptoms, ['itchy eyes', 'cough']);
});

// -------------------------------------------------------------- note

test('note: 500 characters are accepted and 501 are refused, never truncated', async () => {
  const h = harness();
  assert.equal((await (await post(h, { entry_date: day(1), note: 'n'.repeat(500) })).json()).entry.note.length, 500);
  await bad(h, { entry_date: day(1), note: 'n'.repeat(501) }, [['note', 'text_too_long']]);
  assert.equal((await post(h, { entry_date: day(1), note: '\u{1F4A7}'.repeat(500) })).status, 200, 'an emoji is one character');
  await bad(h, { entry_date: day(1), note: '\u{1F4A7}'.repeat(501) }, [['note', 'text_too_long']]);
});

test('note: line breaks and tabs are kept exactly as written, and null or an empty note is stored as given', async () => {
  const h = harness();
  const note = `First line${chr(0x0d)}${chr(0x0a)}\tindented${chr(0x0a)}last `;
  assert.equal((await (await post(h, { entry_date: day(1), note })).json()).entry.note, note);
  assert.equal((await (await post(h, { entry_date: day(1), note: null })).json()).entry.note, null);
  assert.equal((await (await post(h, { entry_date: day(1), note: '' })).json()).entry.note, '');
});

for (const [label, note, code] of [
  ['a NUL, which Postgres cannot store', `a${chr(0)}b`, 'invalid_characters'],
  ['an escape character', `a${chr(0x1b)}b`, 'invalid_characters'],
  ['a DEL character', `a${chr(0x7f)}b`, 'invalid_characters'],
  ['a C1 control', `a${chr(0x85)}b`, 'invalid_characters'],
  ['a line separator', `a${chr(0x2028)}b`, 'invalid_characters'],
  ['a lone surrogate', `a${chr(0xd800)}b`, 'invalid_characters'],
  ['a number', 5, 'invalid_text'],
  ['an array', ['note'], 'invalid_text'],
  ['an object', { text: 'note' }, 'invalid_text'],
  ['a boolean', false, 'invalid_text'],
]) {
  test(`note: ${label} is a 400 and changes nothing`, async () => {
    await bad(harness(), { entry_date: day(1), note }, [['note', code]]);
  });
}

// ------------------------------------------------------------ flags

test('retrospective and possibly_illness: booleans are stored; null or absent is false', async () => {
  const h = harness();
  const on = (await (await post(h, { entry_date: day(1), retrospective: true, possibly_illness: true })).json()).entry;
  assert.deepEqual([on.retrospective, on.possibly_illness], [true, true]);
  const off = (await (await post(h, { entry_date: day(1), retrospective: null })).json()).entry;
  assert.deepEqual([off.retrospective, off.possibly_illness], [false, false]);
});

for (const field of ['retrospective', 'possibly_illness']) {
  for (const value of ['true', 1, 'yes', [], {}]) {
    test(`${field}: ${JSON.stringify(value)} is a 400 (it used to be silently false) and changes nothing`, async () => {
      await bad(harness(), { entry_date: day(1), [field]: value }, [[field, 'invalid_boolean']]);
    });
  }
}

test('every problem is reported at once, in field order', async () => {
  await bad(harness(), { entry_date: 'x', band: 'y', severity: 'z', symptoms: 'q', note: 5, retrospective: 'r', possibly_illness: 's' }, [
    ['entry_date', 'invalid_date'], ['band', 'invalid_option'], ['severity', 'invalid_option'], ['symptoms', 'invalid_symptoms'],
    ['note', 'invalid_text'], ['retrospective', 'invalid_boolean'], ['possibly_illness', 'invalid_boolean'],
  ]);
});

// ------------------------------------------------------------- body

test('invalid JSON, a non-object body and a whitespace body are 400 bad_request, and change nothing', async () => {
  const h = harness();
  const before = snapshot(h);
  for (const rawBody of ['{not json', '[]', '"entry"', '5', 'null', '   ', '{"entry_date":']) {
    const body = await expectEnvelope(await postRaw(h, rawBody), { status: 400, code: 'bad_request', retryable: false });
    assert.equal(body.field_errors.length, 0, rawBody);
  }
  assert.equal(snapshot(h), before);
  assert.equal(h.db.queryLog.length, 0);
});

test('an empty body means {}: it is then a missing entry_date, not a bad request', async () => {
  const body = await expectEnvelope(await postRaw(harness(), ''), { status: 400, code: 'validation_failed' });
  assert.deepEqual(body.field_errors.map((e) => e.code), ['date_required']);
});

test('the body limit is 8192 bytes: exactly that is read, one more byte is a 413 and changes nothing', async () => {
  const h = harness();
  const exact = JSON.stringify({ entry_date: day(1), pad: '' });
  const padded = (size) => JSON.stringify({ entry_date: day(1), pad: 'p'.repeat(size - exact.length) });
  assert.equal(Buffer.byteLength(padded(8192)), 8192);
  assert.equal((await postRaw(h, padded(8192))).status, 200);

  const before = snapshot(h);
  const body = await expectEnvelope(await postRaw(h, padded(8193)), { status: 413, code: 'payload_too_large', retryable: false });
  assert.equal(body.error, 'That request is too large.');
  const declared = await postRaw(h, '{}', { headers: { 'content-length': '9000' } }); // a truthful header is refused without reading
  await expectEnvelope(declared, { status: 413, code: 'payload_too_large' });
  assert.equal(snapshot(h), before);
});

// --------------------------------------------------- envelope, errors

test('auth failures use the envelope and echo a client request id; nothing is read or written', async () => {
  const h = harness();
  const none = await expectEnvelope(await h.call('/api/journal', 'POST', { body: { entry_date: day(1) } }), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  const echoed = await h.call('/api/journal', 'POST', { body: { entry_date: day(1) }, headers: { 'x-request-id': 'client-trace-0001' } });
  await expectEnvelope(echoed, { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal(h.db.queryLog.length, 0);
});

test('validation errors and successes echo a well formed client request id', async () => {
  const h = harness();
  const headers = { 'x-request-id': 'client-trace-0002' };
  await expectEnvelope(await post(h, {}, { headers }), { status: 400, code: 'validation_failed', requestId: 'client-trace-0002' });
  await expectEnvelope(await postRaw(h, '{', { headers }), { status: 400, code: 'bad_request', requestId: 'client-trace-0002' });
  assert.equal((await post(h, { entry_date: day(1) }, { headers })).headers.get('x-request-id'), 'client-trace-0002');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const broken = createRouteHarness({ tables: {} }); // symptom_logs missing: PGRST205
  const res = await broken.call('/api/journal', 'POST', { as: 'alice', body: { entry_date: day(1) } });
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|symptom_logs|PGRST|Could not find/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});
