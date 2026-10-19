/**
 * The NC county gazetteer behind GET /api/locations/search (B05 Task 2, Ruling D4).
 *
 * THE VALIDATOR BELOW IS TRANSCRIBED, not summarised, from
 * `lib/frontend/production/explore-service.ts` on
 * `origin/codex/october15-review-refinement` (read with `git show`; lines 8-9
 * for `object` and `text`, line 67 for `validPlaces`), TypeScript to
 * JavaScript with the types stripped and nothing else changed. A transcription
 * that always said yes would pass every candidate here, so the transcription is
 * first shown to reject what the client rejects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { searchPlaces, placeById, parseLocationQuery, MAX_CANDIDATES } = await import('../lib/places.js');
const source = JSON.parse(readFileSync(new URL('../lib/data/ncCounties.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------- transcribed (F: explore-service.ts:8-9,67)
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 10000) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function validPlaces(value){return object(value)&&Array.isArray(value.candidates)&&value.candidates.length<=20&&value.candidates.every(place=>object(place)&&['id','place','state','label','timezone'].every(key=>text(place[key],300))&&!!place.id);}
// ----------------------------------------------------------------

const GOOD = { id: 'us-county:37119', place: 'Mecklenburg County', state: 'NC', label: 'Mecklenburg County, NC', timezone: 'America/New_York' };
const EM_DASH = String.fromCharCode(0x2014);
const names = source.counties.map((c) => c.name);
const bare = (name) => name.replace(/ County$/, '');

test('the transcribed validPlaces rejects what the client rejects', () => {
  assert.equal(validPlaces({ candidates: [] }), true, 'an empty list is valid (the client shows "No matching area")');
  assert.equal(validPlaces({ candidates: [GOOD] }), true);
  assert.equal(validPlaces({ candidates: [{ ...GOOD, place: '', state: '', timezone: '' }] }), true, 'empty strings other than id pass');
  assert.equal(validPlaces({ candidates: [{ ...GOOD, label: 'a\tb\nc\r' }] }), true, 'tab, LF and CR are allowed');
  const rejected = [
    ['null', null],
    ['an array', [GOOD]],
    ['no candidates', {}],
    ['candidates not an array', { candidates: GOOD }],
    ['21 candidates', { candidates: Array.from({ length: 21 }, () => GOOD) }],
    ['a candidate that is an array', { candidates: [[GOOD]] }],
    ['a candidate that is null', { candidates: [null] }],
    ['an empty id', { candidates: [{ ...GOOD, id: '' }] }],
    ['a numeric id', { candidates: [{ ...GOOD, id: 37119 }] }],
    ['a missing timezone', { candidates: [{ ...GOOD, timezone: undefined }] }],
    ['a null place', { candidates: [{ ...GOOD, place: null }] }],
    ['a 301-character label', { candidates: [{ ...GOOD, label: 'a'.repeat(301) }] }],
    ['a NUL in state', { candidates: [{ ...GOOD, state: 'N\u0000C' }] }],
    ['an escape in label', { candidates: [{ ...GOOD, label: 'x\u001bx' }] }],
    ['a vertical tab in place', { candidates: [{ ...GOOD, place: 'x\u000bx' }] }],
  ];
  for (const [label, value] of rejected) assert.equal(validPlaces(value), false, label);
  assert.equal(validPlaces({ candidates: [{ ...GOOD, label: 'a'.repeat(300) }] }), true, '300 characters is the limit, inclusive');
});

test('the gazetteer is exactly North Carolina\'s 100 counties, GEOIDs 37xxx, ids unique', () => {
  assert.equal(source.counties.length, 100);
  assert.ok(source.counties.every((c) => /^37\d{3}$/.test(c.geoid)), 'every GEOID is 37 followed by a county code');
  const all = names.map((name) => searchPlaces({ query: name, state: '' })[0]);
  assert.equal(all.length, 100);
  assert.equal(new Set(all.map((c) => c.id)).size, 100, 'unique ids');
  assert.deepEqual(new Set(all.map((c) => c.id)), new Set(source.counties.map((c) => `us-county:${c.geoid}`)));
});

test('every county is found by exact name, with and without "County" or "Co.", in any case, and is the only answer', () => {
  for (const county of source.counties) {
    const expected = {
      id: `us-county:${county.geoid}`,
      place: county.name,
      state: 'NC',
      label: `${county.name}, NC`,
      timezone: 'America/New_York',
    };
    const n = bare(county.name);
    for (const query of [county.name, n, n.toUpperCase(), n.toLowerCase(), county.name.toUpperCase(), `${n} co.`, `${n} Co`, `  ${n}  `]) {
      assert.deepEqual(searchPlaces({ query, state: '' }), [expected], `${county.name} by "${query}"`);
    }
  }
});

test('matching tolerates whitespace and punctuation', () => {
  const hanover = placeById('us-county:37129');
  assert.equal(hanover.place, 'New Hanover County');
  for (const query of ['new hanover', 'New   Hanover', 'new-hanover', 'NewHanover', 'New Hanover County.', 'new hanover, county']) {
    assert.deepEqual(searchPlaces({ query, state: 'NC' }), [hanover], query);
  }
  assert.deepEqual(searchPlaces({ query: 'Mc Dowell', state: '' }).map((c) => c.place), ['McDowell County']);
  assert.deepEqual(searchPlaces({ query: "Mecklenburg's", state: '' }), [], 'an apostrophe-s is a different word, not punctuation noise');
});

test('a query of two or more characters also matches by prefix, exact first, then by name', () => {
  assert.deepEqual(searchPlaces({ query: 'Ca', state: '' }).map((c) => c.place),
    ['Cabarrus County', 'Caldwell County', 'Camden County', 'Carteret County', 'Caswell County', 'Catawba County']);
  assert.deepEqual(searchPlaces({ query: 'davi', state: '' }).map((c) => c.place), ['Davidson County', 'Davie County']);
  assert.deepEqual(searchPlaces({ query: 'Le', state: '' }).map((c) => c.place), ['Lee County', 'Lenoir County']);
  assert.deepEqual(searchPlaces({ query: 'Ca County', state: '' }), searchPlaces({ query: 'Ca', state: '' }), 'a trailing County is dropped before the prefix is matched');
  assert.deepEqual(searchPlaces({ query: 'le co.', state: '' }).map((c) => c.place), ['Lee County', 'Lenoir County']);
  assert.deepEqual(searchPlaces({ query: 'W', state: '' }), [], 'one character is exact only');
  assert.deepEqual(searchPlaces({ query: 'Co.', state: '' }).map((c) => c.place), ['Columbus County'], '"Co." alone is a prefix, not a suffix');
  assert.equal(MAX_CANDIDATES, 20);
  // The data facts lib/places.js documents: no county name starts another (so an
  // exact match is always the only answer, as the test above shows for all 100),
  // and no two letters start more than six names (so the cap of 20 is never reached today).
  let widest = 0;
  for (const a of 'abcdefghijklmnopqrstuvwxyz') for (const b of 'abcdefghijklmnopqrstuvwxyz') {
    widest = Math.max(widest, searchPlaces({ query: a + b, state: '' }).length);
  }
  assert.equal(widest, 6);
});

test('city and ZIP queries, and anything that is not a county, give no candidates', () => {
  for (const query of ['Charlotte', '28208', 'Raleigh', 'Mecklenburg County NC', 'County', '...', 'Wake Countyy']) {
    assert.deepEqual(searchPlaces({ query, state: '' }), [], query);
  }
});

test('state "", NC, N.C. and North Carolina (any case) mean North Carolina; any other state gives no candidates', () => {
  const wake = searchPlaces({ query: 'Wake', state: '' });
  assert.equal(wake.length, 1);
  for (const state of ['', 'NC', 'nc', 'N.C.', 'n.c.', 'North Carolina', 'NORTH CAROLINA', 'north carolina', ' NC ']) {
    assert.deepEqual(searchPlaces({ query: 'Wake', state }), wake, JSON.stringify(state));
  }
  for (const state of ['SC', 'South Carolina', 'Virginia', 'N', 'Carolina', 'North', 'NC USA', 'US']) {
    assert.deepEqual(searchPlaces({ query: 'Wake', state }), [], state);
  }
  assert.deepEqual(searchPlaces({ query: 'Wake' }), wake, 'no state given is the same as empty');
});

test('placeById round-trips every candidate; an unknown or malformed id is null; results are copies', () => {
  for (const name of names) {
    const [candidate] = searchPlaces({ query: name, state: '' });
    assert.deepEqual(placeById(candidate.id), candidate);
  }
  for (const id of ['us-county:37000', 'us-county:37201', 'us-county:45001', 'us-county:3711', 'us-county:371190', 'US-COUNTY:37119', ' us-county:37119', 'us-county:37119 ', '37119', 'county:37119', '', null, undefined, 37119, {}, ['us-county:37119']]) {
    assert.equal(placeById(id), null, JSON.stringify(id));
  }
  const first = placeById('us-county:37119');
  first.label = 'changed';
  assert.equal(placeById('us-county:37119').label, 'Mecklenburg County, NC', 'a caller cannot change the gazetteer');
  searchPlaces({ query: 'Mecklenburg', state: '' })[0].place = 'changed';
  assert.equal(searchPlaces({ query: 'Mecklenburg', state: '' })[0].place, 'Mecklenburg County');
});

test('every candidate passes the frontend validPlaces, has exactly the five fields, and no readable string has an em dash', () => {
  const lists = [
    ...names.map((name) => searchPlaces({ query: name, state: '' })),
    ...['Ca', 'Wa', 'Da', 'Pe', 'Ch', 'Charlotte'].map((query) => searchPlaces({ query, state: 'NC' })),
  ];
  for (const candidates of lists) {
    assert.equal(validPlaces({ candidates }), true);
    for (const candidate of candidates) {
      assert.deepEqual(Object.keys(candidate), ['id', 'place', 'state', 'label', 'timezone']);
      assert.equal(JSON.stringify(candidate).includes(EM_DASH), false);
    }
  }
});

test('parseLocationQuery: query trimmed 1 to 80, no control characters; state 0 to 40; field errors otherwise', () => {
  const parse = (q) => parseLocationQuery(new URLSearchParams(q));
  assert.deepEqual(parse('query=%20Wake%20&state=%20NC%20'), { ok: true, value: { query: 'Wake', state: 'NC' } });
  assert.deepEqual(parse('query=Wake'), { ok: true, value: { query: 'Wake', state: '' } });
  assert.deepEqual(parse('query=Wake&state='), { ok: true, value: { query: 'Wake', state: '' } });
  assert.equal(parse(`query=${'a'.repeat(80)}&state=${'b'.repeat(40)}`).ok, true, 'the limits are inclusive');
  const codes = (q) => parse(q).fieldErrors.map((e) => [e.field, e.code]);
  assert.deepEqual(codes(''), [['query', 'text_required']]);
  assert.deepEqual(codes('query='), [['query', 'text_required']]);
  assert.deepEqual(codes('query=%20%20'), [['query', 'text_required']]);
  assert.deepEqual(codes(`query=${'a'.repeat(81)}`), [['query', 'text_too_long']]);
  assert.deepEqual(codes(`query=Wake&state=${'b'.repeat(41)}`), [['state', 'text_too_long']]);
  assert.deepEqual(codes('query=Wa%00ke'), [['query', 'invalid_characters']]);
  assert.deepEqual(codes('query=Wa%0Ake'), [['query', 'invalid_characters']]);
  assert.deepEqual(codes('query=Wake&state=N%1BC'), [['state', 'invalid_characters']]);
  assert.deepEqual(codes(`query=&state=${'b'.repeat(41)}`), [['query', 'text_required'], ['state', 'text_too_long']]);
  for (const error of parse(`query=&state=${'b'.repeat(41)}`).fieldErrors) {
    assert.equal(typeof error.message, 'string');
    assert.equal(error.message.includes(EM_DASH), false);
  }
});
