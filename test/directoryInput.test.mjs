import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ESM without the typeless-package warning

const { parseLearnQuery, parseVolunteerQuery } = await import('../lib/directoryInput.js');

const learn = (query) => parseLearnQuery(new URLSearchParams(query));
const volunteer = (query) => parseVolunteerQuery(new URLSearchParams(query));
const codes = (result) => result.fieldErrors.map((e) => [e.field, e.code]);

// ------------------------------------------------------------------ volunteer

test('volunteer: no input is ok with no county (use the household\'s) and no causes', () => {
  assert.deepEqual(volunteer(''), { ok: true, value: { county: null, causes: [] } });
  assert.deepEqual(volunteer('unrelated=1&profile_id=x'), { ok: true, value: { county: null, causes: [] } });
});

test('volunteer: county is trimmed, and a blank county means "use the household\'s"', () => {
  assert.equal(volunteer('county=%20Cabarrus%20County%20').value.county, 'Cabarrus County');
  assert.equal(volunteer('county=').value.county, null);
  assert.equal(volunteer('county=%20%20').value.county, null);
});

test('volunteer: county is at most 100 characters (counted as characters) and holds no control characters', () => {
  assert.equal(volunteer(`county=${'a'.repeat(100)}`).ok, true);
  assert.equal(volunteer(`county=${encodeURIComponent('\u{1F4A7}'.repeat(100))}`).ok, true, 'an emoji is one character');
  assert.deepEqual(codes(volunteer(`county=${'a'.repeat(101)}`)), [['county', 'text_too_long']]);
  for (const bad of ['Cabarrus%0ACounty', 'Cabarrus%00', 'a%09b', 'a%1Fb', 'a%7Fb', 'a%C2%85b', 'a%E2%80%A8b']) {
    assert.deepEqual(codes(volunteer(`county=${bad}`)), [['county', 'invalid_characters']], bad);
  }
  assert.equal(volunteer('county=%0ACabarrus').value.county, 'Cabarrus', 'edge whitespace is trimmed, not rejected');
});

test('volunteer: causes are comma separated tags, trimmed, empty ones dropped, case kept for the echo', () => {
  assert.deepEqual(volunteer('causes=water,pfas').value.causes, ['water', 'pfas']);
  assert.deepEqual(volunteer('causes=%20Water%20,%20pfas%20').value.causes, ['Water', 'pfas']);
  assert.deepEqual(volunteer('causes=water,,pfas,').value.causes, ['water', 'pfas']);
  assert.deepEqual(volunteer('causes=,%20,').value.causes, []);
  assert.deepEqual(volunteer('causes=').value.causes, []);
  // Every tag the directory documents, and a tag it does not know (lead) are all well formed.
  assert.equal(volunteer('causes=water,pfas,radon,air,wells,advocacy,lead,well_water,low-income').ok, true);
});

test('volunteer: at most 12 tags of 1 to 32 letters, digits, hyphens or underscores, starting with a letter', () => {
  const tags = (n) => Array.from({ length: n }, (_, i) => `cause${i}`).join(',');
  assert.equal(volunteer(`causes=${tags(12)}`).ok, true);
  assert.deepEqual(codes(volunteer(`causes=${tags(13)}`)), [['causes', 'too_many_causes']]);
  assert.equal(volunteer(`causes=a${'b'.repeat(31)}`).ok, true);
  assert.deepEqual(codes(volunteer(`causes=a${'b'.repeat(32)}`)), [['causes', 'invalid_cause']]);
  for (const bad of ['well%20water', '1abc', '-water', 'wa%2Fter', "water'--", 'water;drop', 'caf%C3%A9', 'a%0Ab', '%3Cscript%3E']) {
    assert.deepEqual(codes(volunteer(`causes=water,${bad}`)), [['causes', bad.includes('%0A') ? 'invalid_characters' : 'invalid_cause']], bad);
  }
});

test('volunteer: a very long causes string is refused before it is split', () => {
  assert.deepEqual(codes(volunteer(`causes=${'water,'.repeat(200)}`)), [['causes', 'text_too_long']]);
});

test('volunteer: both fields can fail together, county first; messages are plain sentences without em dashes', () => {
  const result = volunteer(`county=${'a'.repeat(101)}&causes=%3Cx%3E`);
  assert.deepEqual(codes(result), [['county', 'text_too_long'], ['causes', 'invalid_cause']]);
  for (const { message } of result.fieldErrors) {
    assert.ok(message.length > 0);
    assert.equal(message.includes('\u2014'), false);
  }
});

// ---------------------------------------------------------------------- learn

test('learn: topic and locale are read as before (topic lower-cased, locale en unless es)', () => {
  assert.deepEqual(learn('topic=pfas'), { ok: true, value: { topic: 'pfas', locale: 'en' } });
  assert.deepEqual(learn('topic=PFAS&locale=es').value, { topic: 'pfas', locale: 'es' });
  assert.deepEqual(learn('topic=uv&locale=').value, { topic: 'uv', locale: 'en' }, 'an empty locale is "not given"');
  for (const topic of ['pfas', 'radon', 'lead', 'air', 'pollen', 'uv', 'mold']) assert.equal(learn(`topic=${topic}`).ok, true, topic);
});

test('learn: an unknown, missing or empty topic keeps the legacy sentence', () => {
  for (const query of ['', 'topic=', 'topic=bogus', 'topic=pfas%20', 'topic=pfas,radon', "topic=pfas'--"]) {
    const result = learn(query);
    assert.deepEqual(codes(result), [['topic', 'invalid_option']], query);
    assert.equal(result.fieldErrors[0].message, 'Unknown topic. One of: pfas, radon, lead, air, pollen, uv, mold');
  }
});

test('learn: locale is en or es in any case; anything else is a field error', () => {
  assert.equal(learn('topic=uv&locale=EN').value.locale, 'en');
  assert.equal(learn('topic=uv&locale=Es').value.locale, 'es');
  for (const bad of ['fr', 'en-US', 'es%20', 'english', 'e']) {
    assert.deepEqual(codes(learn(`topic=uv&locale=${bad}`)), [['locale', 'invalid_option']], bad);
  }
});

test('learn: the text a reading carries (county, zone, contaminant, source, pollutant, ...) is at most 100 characters with no control characters', () => {
  const fields = ['county', 'zone', 'contaminant', 'source', 'pollutant', 'peak_start', 'peak_end', 'category', 'risk', 'severity'];
  for (const field of fields) {
    assert.equal(learn(`topic=radon&${field}=${'a'.repeat(100)}`).ok, true, field);
    assert.deepEqual(codes(learn(`topic=radon&${field}=${'a'.repeat(101)}`)), [[field, 'text_too_long']], field);
    assert.deepEqual(codes(learn(`topic=radon&${field}=a%0Ab`)), [[field, 'invalid_characters']], field);
  }
  assert.equal(learn('topic=radon&county=Cabarrus%20County&zone=1').ok, true);
});

test('learn: the numbers a reading carries are left alone (a value that is not a number is simply not used)', () => {
  assert.equal(learn('topic=pfas&value=abc&limit=&home_year=x&humidity=1e999&precip=-').ok, true);
});

test('learn: field errors come in a fixed order, topic then locale then the reading text', () => {
  const result = learn(`topic=nope&locale=fr&source=${'a'.repeat(101)}&county=${'b'.repeat(101)}`);
  assert.deepEqual(codes(result), [['topic', 'invalid_option'], ['locale', 'invalid_option'], ['county', 'text_too_long'], ['source', 'text_too_long']]);
});
