/**
 * The NC gazetteers behind GET /api/locations/search: the counties (B05 Task 2,
 * Ruling D4) and the Census places and ZCTAs added by Task 8
 * (lib/data/ncPlaces.json, built by scripts/build-nc-places.mjs).
 *
 * THE VALIDATOR USED HERE IS TRANSCRIBED, not summarised (test/helpers/frontendB05.mjs), from
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
// F: explore-service.ts:8-9,67, transcribed once for every B05 suite (see the helper's header).
import { validPlaces } from './helpers/frontendB05.mjs';

const { searchPlaces, placeById, parseLocationQuery, allPlaces, exactPlaces, MAX_CANDIDATES } = await import('../lib/places.js');
const source = JSON.parse(readFileSync(new URL('../lib/data/ncCounties.json', import.meta.url), 'utf8'));
const gazetteer = JSON.parse(readFileSync(new URL('../lib/data/ncPlaces.json', import.meta.url), 'utf8'));

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

test('every county is found by exact name in any case; with "County" it is the only answer, with "Co." or without it the first', () => {
  // B10 Task 2 (Task 1 review N1): after "Co" a place the whole query starts still follows the county.
  const AFTER_CO = { Yadkin: ['Yadkin College, NC'], Rutherford: ['Rutherford College, NC'] };
  for (const county of source.counties) {
    const expected = {
      id: `us-county:${county.geoid}`,
      place: county.name,
      state: 'NC',
      label: `${county.name}, NC`,
      timezone: 'America/New_York',
    };
    const n = bare(county.name);
    for (const query of [county.name, county.name.toUpperCase(), `  ${n} County  `]) {
      assert.deepEqual(searchPlaces({ query, state: '' }), [expected], `${county.name} by "${query}"`);
    }
    for (const query of [`${n} co.`, `${n} Co`]) {
      const found = searchPlaces({ query, state: '' });
      assert.deepEqual(found[0], expected, `${county.name} by "${query}"`);
      assert.deepEqual(found.slice(1).map((c) => c.label), AFTER_CO[n] ?? [], `${county.name} by "${query}": only places it starts follow`);
    }
    // A bare name can also be a place (Columbus, Cherokee) or start one (Wake Forest), and those follow.
    for (const query of [n, n.toUpperCase(), n.toLowerCase(), `  ${n}  `]) {
      const found = searchPlaces({ query, state: '' });
      assert.deepEqual(found[0], expected, `${county.name} by "${query}"`);
      assert.ok(found.slice(1).every((c) => c.id.startsWith('us-place:')), `${county.name} by "${query}": only places follow`);
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

test('a query of two or more characters also matches by prefix: exact first, then counties, then places, each by name', () => {
  assert.deepEqual(searchPlaces({ query: 'davi', state: '' }).map((c) => c.place), ['Davidson County', 'Davie County', 'Davidson', 'Davis']);
  assert.deepEqual(searchPlaces({ query: 'Le', state: '' }).map((c) => c.place),
    ['Lee County', 'Lenoir County', 'Leggett', 'Leland', 'Lenoir', 'Lewiston Woodville', 'Lewisville', 'Lexington']);
  assert.deepEqual(searchPlaces({ query: 'le co.', state: '' }).map((c) => c.place), ['Lee County', 'Lenoir County'],
    'a trailing County or Co. is dropped for counties, and no place name contains it');
  assert.deepEqual(searchPlaces({ query: 'Ca County', state: '' }), searchPlaces({ query: 'Ca', state: '' }).filter((c) => c.id.startsWith('us-county:')));
  assert.deepEqual(searchPlaces({ query: 'W', state: '' }), [], 'one character is exact only');
  const co = searchPlaces({ query: 'Co.', state: '' });
  assert.equal(co[0].place, 'Columbus County', '"Co." alone is a prefix, not a suffix');
  assert.ok(co.slice(1).every((c) => c.id.startsWith('us-place:') && /^co/i.test(c.place)));
  // Wake is exact and Wake Forest a prefix, so the county wins; Columbus is exact for both, and the county still leads.
  assert.deepEqual(searchPlaces({ query: 'Wake', state: '' }).map((c) => c.label), ['Wake County, NC', 'Wake Forest, NC']);
  assert.deepEqual(searchPlaces({ query: 'wake forest', state: '' }).map((c) => c.label), ['Wake Forest, NC']);
  assert.deepEqual(searchPlaces({ query: 'Columbus', state: '' }).map((c) => c.label), ['Columbus County, NC', 'Columbus, NC']);
  assert.deepEqual(searchPlaces({ query: 'Columbus County', state: '' }).map((c) => c.label), ['Columbus County, NC'],
    'a County suffix is a county query: the town of Columbus is not offered');
  assert.deepEqual(searchPlaces({ query: 'Yadkin Co', state: '' }).map((c) => c.label), ['Yadkin County, NC', 'Yadkin College, NC'],
    'the county leads, and Yadkin College, which "Yadkin Co" starts, follows (Task 1 review N1)');
  assert.deepEqual(searchPlaces({ query: 'Yadkin', state: '' }).map((c) => c.label), ['Yadkin County, NC', 'Yadkin College, NC', 'Yadkinville, NC']);
  assert.deepEqual(searchPlaces({ query: 'Cherokee', state: '' }).map((c) => c.id), ['us-county:37039', 'us-place:3712140']);
  // An exact place ahead of a county prefix: Ruth is a town, and Rutherford County starts with it.
  assert.deepEqual(searchPlaces({ query: 'Ruth', state: '' }).map((c) => c.label), ['Ruth, NC', 'Rutherford County, NC', 'Rutherford College, NC', 'Rutherfordton, NC'],
    'every exact match comes before every prefix match, whatever its kind');
});

test('the cap of 20 is reached, and keeps the first 20 in the documented order', () => {
  assert.equal(MAX_CANDIDATES, 20);
  const everything = allPlaces();
  const ca = searchPlaces({ query: 'Ca', state: '' });
  assert.equal(ca.length, 20);
  const counties = everything.filter((c) => c.id.startsWith('us-county:') && c.place.startsWith('Ca'));
  const places = everything.filter((c) => c.id.startsWith('us-place:') && c.place.startsWith('Ca'));
  assert.ok(counties.length + places.length > 20, `more than 20 match "Ca" (${counties.length + places.length})`);
  assert.deepEqual(ca, [...counties, ...places].slice(0, 20), 'the six counties, then the places by name, cut at 20');
  assert.equal(validPlaces({ candidates: ca }), true);
  const zip = searchPlaces({ query: '282', state: '' });
  const all282 = everything.filter((c) => c.id.startsWith('us-zcta:282'));
  assert.ok(all282.length > 20);
  assert.deepEqual(zip, all282.slice(0, 20), 'ZCTAs in numeric order, cut at 20');
  // The widest two-letter query is cut at 20 and every answer, cut or not, is one the client accepts.
  let widest = 0;
  for (const a of 'abcdefghijklmnopqrstuvwxyz') for (const b of 'abcdefghijklmnopqrstuvwxyz') {
    const found = searchPlaces({ query: a + b, state: '' });
    assert.equal(validPlaces({ candidates: found }), true, a + b);
    widest = Math.max(widest, found.length);
  }
  assert.equal(widest, 20);
});

test('the place and ZCTA gazetteer: header, 785 NC places with 7-digit GEOIDs, 853 NC ZCTAs, all unique', () => {
  for (const key of ['source', 'vintage', 'retrieved', 'licence', 'files', 'nameRule', 'zctaRule']) assert.ok(gazetteer[key], key);
  assert.match(gazetteer.licence, /[Pp]ublic domain/);
  assert.match(gazetteer.licence, /17 U\.S\.C\. 105/);
  assert.equal(gazetteer.retrieved, '2026-10-19');
  for (const file of gazetteer.files) {
    assert.match(file.url, /^https:\/\/www2\.census\.gov\//);
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(gazetteer.places.length, 785);
  assert.ok(gazetteer.places.every((p) => /^37\d{5}$/.test(p.geoid) && Object.keys(p).join() === 'geoid,name,lat,lng'), 'B10 Task 1 added the internal point');
  assert.equal(new Set(gazetteer.places.map((p) => p.geoid)).size, 785);
  assert.equal(new Set(gazetteer.places.map((p) => p.name)).size, 785, 'no two places share a display name');
  assert.equal(gazetteer.zctas.length, 853);
  assert.ok(gazetteer.zctas.every((z) => /^2[78]\d{3}$/.test(z.zcta) && Object.keys(z).join() === 'zcta,lat,lng'), 'NC ZIP codes are 27xxx and 28xxx (with the B10 point)');
  assert.equal(new Set(gazetteer.zctas.map((z) => z.zcta)).size, 853);
  // The display rule: the Census descriptor is gone, nothing reads as a county, no em dash.
  for (const { name } of gazetteer.places) {
    assert.doesNotMatch(name, / (city|town|village|CDP)$/, name);
    assert.doesNotMatch(name, / County$/, name);
    assert.equal(name.includes(EM_DASH), false, name);
    assert.equal(name, name.trim().replace(/\s+/g, ' '), name);
  }
  assert.deepEqual(gazetteer.places.filter((p) => p.name.includes('(')).map((p) => p.name),
    ['Fairview (Buncombe County)', 'Fairview (Union County)', 'Flat Rock (Henderson County)', 'Flat Rock (Surry County)']);
});

test('every place is found by its exact name, in any case and with any punctuation, among the exact matches', () => {
  const key = (text) => text.toLowerCase().replace(/ \([^)]*\)$/, '').replace(/[^a-z0-9]/g, '');
  for (const { geoid, name } of gazetteer.places) {
    const expected = { id: `us-place:${geoid}`, place: name, state: 'NC', label: `${name}, NC`, timezone: 'America/New_York' };
    for (const query of [name, name.toUpperCase(), name.toLowerCase().replace(/[-']/g, ' '), `  ${name}  `]) {
      const found = searchPlaces({ query, state: '' });
      const at = found.findIndex((c) => c.id === expected.id);
      assert.ok(at >= 0, `${name} by "${query}"`);
      assert.deepEqual(found[at], expected);
      // Everything ahead of it is another exact match: a county of that name, or a namesake place.
      for (const before of found.slice(0, at)) assert.equal(key(before.place.replace(/ County$/, '')), key(name), `${name}: ${before.label} ahead`);
    }
  }
  assert.deepEqual(searchPlaces({ query: 'Charlotte', state: '' }).map((c) => c.id), ['us-place:3712000']);
  assert.deepEqual(searchPlaces({ query: 'winston salem', state: '' }).map((c) => c.label), ['Winston-Salem, NC']);
  assert.deepEqual(searchPlaces({ query: 'Spiveys Corner', state: '' }).map((c) => c.label), ["Spivey's Corner, NC"]);
  assert.deepEqual(searchPlaces({ query: 'Raleigh', state: 'North Carolina' }).map((c) => c.label), ['Raleigh, NC']);
  assert.deepEqual(searchPlaces({ query: 'Fairview', state: '' }).map((c) => c.label),
    ['Fairview (Buncombe County), NC', 'Fairview (Union County), NC'], 'two places of one name, each with its county');
  // The chooser reopens with the saved place in the box (ExploreDiscovery.tsx:62, setDraft(area)), so the full name finds it too.
  assert.deepEqual(searchPlaces({ query: 'Fairview (Union County)', state: 'NC' }).map((c) => c.id), ['us-place:3722500']);
  assert.deepEqual(searchPlaces({ query: 'flat rock surry county', state: '' }).map((c) => c.id), ['us-place:3723640']);
});

test('a ZIP code: five digits are one exact ZCTA, three or four digits a prefix, anything else nothing', () => {
  for (const { zcta } of gazetteer.zctas) {
    assert.deepEqual(searchPlaces({ query: zcta, state: '' }),
      [{ id: `us-zcta:${zcta}`, place: zcta, state: 'NC', label: `ZIP ${zcta}, NC`, timezone: 'America/New_York' }], zcta);
  }
  const z28208 = placeById('us-zcta:28208');
  for (const query of ['28208', ' 28208 ', 'ZIP 28208', 'zip code 28208', 'Zipcode 28208', 'zip: 28208']) {
    assert.deepEqual(searchPlaces({ query, state: 'NC' }), [z28208], query);
  }
  assert.deepEqual(searchPlaces({ query: '2820', state: '' }).map((c) => c.place),
    ['28202', '28203', '28204', '28205', '28206', '28207', '28208', '28209']);
  assert.ok(searchPlaces({ query: 'zip 275', state: '' }).every((c) => c.place.startsWith('275')));
  for (const query of ['2', '28', '282081', '28208-1234', '282081234', '29707', '00000', '28000', '27', 'zip', 'zip code', 'ZIP 2', '28208 Charlotte', 'Charlotte 28208']) {
    assert.deepEqual(searchPlaces({ query, state: '' }), [], query);
  }
  // A ZCTA that crosses into Virginia is still offered: part of it is in North Carolina.
  assert.deepEqual(searchPlaces({ query: '27048', state: '' }).map((c) => c.label), ['ZIP 27048, NC']);
});

// Before the B05 follow-up round (Task 8 review N2) 'Mecklenburg County NC' and 'Charlotte NC'
// were in this list. A trailing state is now the query's state, in the next test.
test('anything that is not an NC county, place or ZCTA gives no candidates', () => {
  for (const query of ['County', '...', 'Wake Countyy', 'Atlantis', 'Columbia SC', 'NC', 'North Carolina', 'N.C.']) {
    assert.deepEqual(searchPlaces({ query, state: '' }), [], query);
  }
});

test('a trailing state in the query is its state: North Carolina searches the words before it, any other state gives nothing', () => {
  const one = (query, state = '') => searchPlaces({ query, state });
  const charlotte = one('Charlotte');
  assert.deepEqual(charlotte.map((c) => c.id), ['us-place:3712000']);
  for (const query of ['Charlotte, NC', 'Charlotte NC', 'charlotte nc', 'Charlotte N.C.', 'Charlotte, n.c.', 'Charlotte, North Carolina', 'CHARLOTTE NORTH CAROLINA']) {
    assert.deepEqual(one(query), charlotte, query);
    assert.deepEqual(one(query, 'NC'), charlotte, `${query} in NC`);
    assert.deepEqual(one(query, 'SC'), [], `${query} in SC: the state box still decides first`);
  }
  assert.deepEqual(one('Raleigh, North Carolina').map((c) => c.id), ['us-place:3755000']);
  assert.deepEqual(one('Mecklenburg County NC').map((c) => c.label), ['Mecklenburg County, NC']);
  assert.deepEqual(one('Wake Co, N.C.').map((c) => c.label), ['Wake County, NC']);
  assert.deepEqual(one('Wake, NC'), one('Wake'), 'the prefix matches of the words before the state are kept');
  assert.deepEqual(one('28208, NC'), one('28208'));
  assert.deepEqual(one('ZIP 28208 N.C.'), one('28208'));
  // Any other state set off by a comma, as a code, a dotted code or a name, is a different state,
  // even where the words before it, or the whole query, would find an NC place.
  for (const query of ['Raleigh, VA', 'Charlotte, SC', 'Charlotte, S.C.', 'Charlotte, South Carolina', 'Charlotte, Hawaii', 'Columbia, SC', 'Charlotte, DC',
    '28208, SC', 'Washington, PA', 'Spencer, MO', 'Scotland, NE', 'Chapel, HI', 'Helena, MT', 'Charlotte, West Virginia']) {
    assert.deepEqual(one(query), [], query);
  }
  // Without a comma another state's code is still part of the name, so a word being typed keeps
  // its prefix matches (live search never drops results mid-word).
  assert.deepEqual(one('Chapel Hi').map((c) => c.label), ['Chapel Hill, NC']);
  assert.deepEqual(one('Chapel Hil').map((c) => c.label), ['Chapel Hill, NC']);
  assert.deepEqual(one('Washington Pa').map((c) => c.label), ['Washington Park, NC']);
  assert.deepEqual(one('Scotland Ne').map((c) => c.label), ['Scotland Neck, NC']);
  assert.deepEqual(one('Spencer Mo').map((c) => c.label), ['Spencer Mountain, NC']);
  for (const query of ['Charlotte SC', 'Charlotte S.C.', 'Charlotte South Carolina', '28208 SC']) {
    assert.deepEqual(one(query), [], `${query}: no NC name starts this way`);
  }
  // A name that is a state's is still the name when nothing comes before it, and it can carry the state.
  assert.deepEqual(one('Washington').map((c) => c.label), ['Washington County, NC', 'Washington, NC', 'Washington Park, NC']);
  assert.deepEqual(one('Washington, NC'), one('Washington'));
  // "Co" is the county word, never Colorado, with or without a comma.
  assert.deepEqual(one('Yadkin Co').map((c) => c.label), ['Yadkin County, NC', 'Yadkin College, NC']);
  assert.deepEqual(one('Yadkin, Co').map((c) => c.label), ['Yadkin County, NC', 'Yadkin College, NC']);
  assert.deepEqual(one('Meck Co').map((c) => c.label), ['Mecklenburg County, NC'], 'a county prefix with Co. is not a query in Colorado');
  assert.deepEqual(one('Rocky Mt').map((c) => c.label), ['Rocky Mount, NC']);
  assert.deepEqual(one('Rocky Mt, NC').map((c) => c.label), ['Rocky Mount, NC']);
  // A disambiguated display name with its county, then the state.
  assert.deepEqual(one('Fairview, Union County, NC').map((c) => c.label), ['Fairview (Union County), NC']);
});

test('aliases: Mt and Mount, St and Saint, Ft and Fort are one word, each needed by an NC name', () => {
  const labels = (query) => searchPlaces({ query, state: '' }).map((c) => c.label);
  for (const query of ['Mt Airy', 'Mt. Airy', 'mt airy', 'Mount Airy', 'Mt Airy, NC']) assert.deepEqual(labels(query), ['Mount Airy, NC'], query);
  for (const query of ['Saint Pauls', 'St Pauls', 'St. Pauls', 'saint pauls nc']) assert.deepEqual(labels(query), ['St. Pauls, NC'], query);
  for (const query of ['Old Ft', 'Old Ft.', 'Old Fort']) assert.deepEqual(labels(query), ['Old Fort, NC'], query);
  assert.deepEqual(labels('Rocky Mt'), ['Rocky Mount, NC']);
  assert.deepEqual(labels('Saint Helena'), ['St. Helena, NC']);
  assert.deepEqual(labels('Mt Gilead'), ['Mount Gilead, NC']);
  // Every name an alias serves, found by the other spelling (the data's own list, so none is invented).
  const served = { mount: [], st: [], fort: [] };
  for (const { name } of gazetteer.places) {
    for (const word of name.split(/[^A-Za-z]+/)) {
      if (word === 'Mount') served.mount.push(name);
      if (word === 'St') served.st.push(name);
      if (word === 'Fort') served.fort.push(name);
    }
  }
  assert.deepEqual(served, {
    mount: ['Mount Airy', 'Mount Gilead', 'Mount Holly', 'Mount Olive', 'Mount Pleasant', 'Rocky Mount'],
    st: ['St. Helena', 'St. James', 'St. Pauls', 'St. Stephens'],
    fort: ['Old Fort'],
  });
  for (const name of served.mount) assert.ok(labels(name.replace('Mount', 'Mt')).includes(`${name}, NC`), name);
  for (const name of served.st) assert.ok(labels(name.replace('St.', 'Saint')).includes(`${name}, NC`), name);
  for (const name of served.fort) assert.ok(labels(name.replace('Fort', 'Ft')).includes(`${name}, NC`), name);
  // No NC name spells Mt, Saint or Ft, so the aliases never change what a Census spelling finds.
  assert.equal(gazetteer.places.some(({ name }) => /\b(Mt|Saint|Ft)\b/.test(name)), false);
});

test('state "", NC, N.C. and North Carolina (any case) mean North Carolina; any other state gives no candidates', () => {
  const wake = searchPlaces({ query: 'Wake', state: '' });
  assert.deepEqual(wake.map((c) => c.label), ['Wake County, NC', 'Wake Forest, NC']);
  for (const state of ['', 'NC', 'nc', 'N.C.', 'n.c.', 'North Carolina', 'NORTH CAROLINA', 'north carolina', ' NC ']) {
    assert.deepEqual(searchPlaces({ query: 'Wake', state }), wake, JSON.stringify(state));
  }
  // A state with no letters or digits is not blank: emptiness is decided before punctuation is stripped.
  for (const state of ['SC', 'South Carolina', 'Virginia', 'N', 'Carolina', 'North', 'NC USA', 'US', '?', '-', '...', 'é', '北']) {
    for (const query of ['Wake', 'Charlotte', '28208', '282', 'Ca']) {
      assert.deepEqual(searchPlaces({ query, state }), [], `${query} in ${state}`);
    }
  }
  assert.deepEqual(searchPlaces({ query: 'Wake' }), wake, 'no state given is the same as empty');
});

test('placeById round-trips every candidate of every kind; an unknown or malformed id is null; results are copies', () => {
  const everything = allPlaces();
  assert.equal(everything.length, 100 + 785 + 853);
  assert.equal(new Set(everything.map((c) => c.id)).size, everything.length, 'ids are unique across the three kinds');
  for (const candidate of everything) assert.deepEqual(placeById(candidate.id), candidate, candidate.id);
  for (const name of names) {
    const [candidate] = searchPlaces({ query: name, state: '' });
    assert.deepEqual(placeById(candidate.id), candidate);
  }
  assert.deepEqual(placeById('us-place:3712000'),
    { id: 'us-place:3712000', place: 'Charlotte', state: 'NC', label: 'Charlotte, NC', timezone: 'America/New_York' });
  assert.deepEqual(placeById('us-zcta:28208'),
    { id: 'us-zcta:28208', place: '28208', state: 'NC', label: 'ZIP 28208, NC', timezone: 'America/New_York' });
  for (const id of [
    'us-county:37000', 'us-county:37201', 'us-county:45001', 'us-county:3711', 'us-county:371190', 'US-COUNTY:37119', ' us-county:37119', 'us-county:37119 ', '37119', 'county:37119',
    'us-place:3700000', 'us-place:4513330', 'us-place:371200', 'us-place:37120000', 'US-PLACE:3712000', 'us-place:3712000 ', 'us-place:Charlotte', 'place:3712000', 'us-county:3712000', 'us-zcta:3712000',
    'us-zcta:2820', 'us-zcta:282080', 'us-zcta:29707', 'us-zcta:28000', 'US-ZCTA:28208', ' us-zcta:28208', 'us-zcta:28208-1234', 'us-zip:28208', 'zcta:28208', '28208', 'us-place:28208', 'us-county:28208',
    '', null, undefined, 37119, 28208, {}, ['us-county:37119'], ['us-zcta:28208'],
  ]) {
    assert.equal(placeById(id), null, JSON.stringify(id));
  }
  const first = placeById('us-county:37119');
  first.label = 'changed';
  assert.equal(placeById('us-county:37119').label, 'Mecklenburg County, NC', 'a caller cannot change the gazetteer');
  searchPlaces({ query: 'Mecklenburg', state: '' })[0].place = 'changed';
  assert.equal(searchPlaces({ query: 'Mecklenburg', state: '' })[0].place, 'Mecklenburg County');
  placeById('us-zcta:28208').label = 'changed';
  searchPlaces({ query: 'Charlotte', state: '' })[0].label = 'changed';
  allPlaces()[0].label = 'changed';
  assert.equal(placeById('us-zcta:28208').label, 'ZIP 28208, NC');
  assert.equal(searchPlaces({ query: 'Charlotte', state: '' })[0].label, 'Charlotte, NC');
  assert.equal(allPlaces()[0].label, everything[0].label);
});

test('every candidate passes the frontend validPlaces, has exactly the five fields, and no readable string has an em dash', () => {
  const everything = allPlaces();
  const lists = [
    ...names.map((name) => searchPlaces({ query: name, state: '' })),
    ...['Ca', 'Wa', 'Da', 'Pe', 'Ch', 'Charlotte', '28208', '282', '2750', 'Fairview'].map((query) => searchPlaces({ query, state: 'NC' })),
    // Every candidate of every kind, in lists of at most 20.
    ...Array.from({ length: Math.ceil(everything.length / 20) }, (_, at) => everything.slice(at * 20, at * 20 + 20)),
  ];
  for (const candidates of lists) {
    assert.equal(validPlaces({ candidates }), true);
    for (const candidate of candidates) {
      assert.deepEqual(Object.keys(candidate), ['id', 'place', 'state', 'label', 'timezone']);
      assert.equal(JSON.stringify(candidate).includes(EM_DASH), false);
    }
  }
  for (const candidate of everything) {
    assert.match(candidate.id, /^(us-county:37\d{3}|us-place:37\d{5}|us-zcta:2[78]\d{3})$/);
    assert.equal(candidate.state, 'NC');
    assert.equal(candidate.timezone, 'America/New_York');
    if (candidate.id.startsWith('us-place:')) assert.equal(candidate.label, `${candidate.place}, NC`);
    if (candidate.id.startsWith('us-zcta:')) assert.equal(candidate.label, `ZIP ${candidate.place}, NC`);
  }
});

test('every candidate of every kind satisfies migration 0022\'s CHECK rules', () => {
  // The three place rules of supabase/migrations/0022_explore_areas.sql, in JavaScript. The same
  // rows are inserted under the real constraints on PGlite in test/exploreAreaSchema.test.mjs.
  const sql = readFileSync(new URL('../supabase/migrations/0022_explore_areas.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes("btrim(place, E' \\t\\n\\r') <> ''"), 'the blank rule is the one tested here');
  assert.ok(sql.includes('coalesce(octet_length(label), 0) <= 300'), 'the byte rule is the one tested here');
  assert.ok(sql.includes("!~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f]'"), 'the control rule is the one tested here');
  const blank = (value) => value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '') === '';
  const control = /[\x01-\x08\x0b\x0c\x0e-\x1f]/;
  let longest = 0;
  for (const candidate of allPlaces()) {
    for (const [field, value] of Object.entries(candidate)) {
      assert.equal(typeof value, 'string');
      assert.equal(blank(value), false, `${candidate.id} ${field} is blank`);
      assert.ok(Buffer.byteLength(value, 'utf8') <= 300, `${candidate.id} ${field} is over 300 bytes`);
      assert.equal(control.test(value), false, `${candidate.id} ${field} has a control character`);
      longest = Math.max(longest, Buffer.byteLength(value, 'utf8'));
    }
  }
  assert.ok(longest < 60, `the longest field is ${longest} bytes, far inside 300`);
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

// ---------------------------------------------------------------- B10 Task 1: the search nits of
// the B05 follow-ups round 2 review (.superpowers/sdd/b05-discovery-and-summaries/followups-2-review.md).

test('F1: an alias typed in its other spelling is a whole word; "St", the Census spelling, still starts every St name', () => {
  const labels = (query) => searchPlaces({ query, state: '' }).map((c) => c.label);
  const SAINTS = ['St. Helena, NC', 'St. James, NC', 'St. Pauls, NC', 'St. Stephens, NC'];
  for (const query of ['Saint', 'saint', 'SAINT', 'Saint ', 'Saint, NC']) assert.deepEqual(labels(query), SAINTS, query);
  // "St" is a prefix as letters: the counties and places that start "St" come too, cut at 20.
  const st = labels('St');
  assert.equal(st.length, MAX_CANDIDATES);
  for (const label of ['Stanly County, NC', 'Stokes County, NC', 'Staley, NC', 'Stallings, NC']) assert.ok(st.includes(label), label);
  assert.ok(labels('Sta').includes('Statesville, NC'));
  assert.ok(st.some((label) => !SAINTS.includes(label)), 'St is not only the four St. names');
  // Both directions of each pair find the same names.
  for (const [one, other] of [['Saint Pauls', 'St Pauls'], ['Saint Stephens', 'St. Stephens'], ['Mt Olive', 'Mount Olive'], ['Old Ft', 'Old Fort']]) {
    assert.deepEqual(labels(one), labels(other), `${one} and ${other}`);
  }
  assert.deepEqual(labels('Saint J'), ['St. James, NC']);
  // "Mt" is the whole word Mount, so it is not the start of Mountain Home or Mountain View, which "Mount" still is.
  assert.deepEqual(labels('Mt'), ['Mount Airy, NC', 'Mount Gilead, NC', 'Mount Holly, NC', 'Mount Olive, NC', 'Mount Pleasant, NC']);
  for (const label of ['Mountain Home, NC', 'Mountain View, NC']) assert.ok(labels('Mount').includes(label), label);
  // Partial alias spellings, while "Saint" is typed, read as Saint once they find nothing alone.
  for (const query of ['Sai', 'Sain', 'sai']) assert.deepEqual(labels(query), SAINTS, query);
  assert.deepEqual(labels('S'), [], 'one character is still exact only');
  assert.ok(labels('Sa').length > 0 && labels('Sa').every((label) => /^Sa/.test(label)), '"Sa" alone finds names that start "Sa", so it is not read as Saint');
});

test('F2: live typing never loses results mid-word on a County word, a Co word, an alias or a state', () => {
  const labels = (query) => searchPlaces({ query, state: '' }).map((c) => c.label);
  // 1. "County" while it is typed.
  for (const query of ['Wake C', 'Wake Cou', 'Wake Coun', 'Wake Count', 'wake cou.']) assert.deepEqual(labels(query), ['Wake County, NC'], query);
  assert.deepEqual(labels('Rutherford C'), ['Rutherford County, NC', 'Rutherford College, NC'], 'read both ways: the county, then the places');
  assert.deepEqual(labels('Avery C'), ['Avery County, NC', 'Avery Creek, NC']);
  assert.deepEqual(labels('Meck Cou'), ['Mecklenburg County, NC']);
  // 2. A Co word that names no county exactly is also the start of a word.
  assert.deepEqual(labels("Spivey's Co"), ["Spivey's Corner, NC"]);
  assert.deepEqual(labels('Skippers Co'), ['Skippers Corner, NC']);
  assert.deepEqual(labels('Walnut Co'), ['Walnut Cove, NC']);
  assert.deepEqual(labels('Cape Co'), ['Cape Colony, NC']);
  assert.deepEqual(labels('Fairview (Union Co'), ['Fairview (Union County), NC']);
  assert.deepEqual(labels('Fairview (Union County'), ['Fairview (Union County), NC']);
  // ...and after an exact county it is the county word too: the county leads, the places follow (N1).
  assert.deepEqual(labels('Yadkin Co'), ['Yadkin County, NC', 'Yadkin College, NC']);
  assert.deepEqual(labels('Rutherford Co'), ['Rutherford County, NC', 'Rutherford College, NC']);
  assert.deepEqual(labels('Columbus County'), ['Columbus County, NC']);
  // 3. Partial aliases: in the F1 test. 4. A state while it is typed reads as North Carolina.
  for (const query of ['Charlotte, N', 'Charlotte, No', 'Charlotte, North', 'Charlotte, North ', 'Charlotte, North C', 'Charlotte, North Carolin',
    'Charlotte N', 'Charlotte North', 'Charlotte North Car', 'Charlotte, N.']) {
    assert.deepEqual(labels(query), ['Charlotte, NC'], query);
  }
  assert.deepEqual(labels('Raleigh, North Car'), ['Raleigh, NC']);
  assert.deepEqual(labels('Wake Co, N'), ['Wake County, NC']);
  assert.deepEqual(labels('28208, N'), ['ZIP 28208, NC']);
  // Not a start of an NC form, or another state: still nothing.
  for (const query of ['Charlotte, North D', 'Charlotte, Ne', 'Raleigh, ND', 'Charlotte, Carolina', 'Charlotte, S']) assert.deepEqual(labels(query), [], query);
  // A partial state never outranks what the words already find ("Chapel Hi" is Chapel Hill).
  assert.deepEqual(labels('Chapel Hi'), ['Chapel Hill, NC']);
  assert.deepEqual(labels('Washington N'), labels('Washington'));
  assert.deepEqual(labels('Scotland N'), ['Scotland Neck, NC'], 'not Scotland County: the words already find Scotland Neck');
});

test('N1 (B10 Task 2): after an exact county and its "Co" word, places the whole query starts follow the county', () => {
  const labels = (query) => searchPlaces({ query, state: '' }).map((c) => c.label);
  // The two names the Task 1 review's sweep found: the county first, and the College still offered.
  for (const query of ['Yadkin Co', 'yadkin co.', 'Yadkin Co, NC']) assert.deepEqual(labels(query), ['Yadkin County, NC', 'Yadkin College, NC'], query);
  for (const query of ['Rutherford Co', 'Rutherford Co.']) assert.deepEqual(labels(query), ['Rutherford County, NC', 'Rutherford College, NC'], query);
  // The next letters narrow to the College, as before.
  assert.deepEqual(labels('Yadkin Col'), ['Yadkin College, NC']);
  // A full "County" word starts no place, so it is still the county only, and so is the Columbus case.
  for (const query of ['Yadkin County', 'Rutherford County', 'Columbus County', 'Columbus Co']) assert.equal(labels(query).length, 1, query);
  // The bare name is unchanged: the county, then the places it starts.
  assert.deepEqual(labels('Yadkin'), ['Yadkin County, NC', 'Yadkin College, NC', 'Yadkinville, NC']);
  // exactPlaces stays strict: no prefix after "Co".
  assert.deepEqual(exactPlaces('Yadkin Co').places, []);
  assert.deepEqual(exactPlaces('Yadkin Co').counties.map((c) => c.label), ['Yadkin County, NC']);
});

test('F3: a trailing ", USA" or ", US" names the country and is dropped', () => {
  const labels = (query) => searchPlaces({ query, state: '' }).map((c) => c.label);
  for (const query of ['Charlotte, North Carolina, USA', 'Charlotte, NC, USA', 'Charlotte, NC, US', 'Charlotte, N.C., U.S.A.', 'Charlotte, USA',
    'charlotte, us', 'Charlotte NC, USA', 'Charlotte, North Carolina, U', 'Charlotte, North Carolina, US ']) {
    assert.deepEqual(labels(query), ['Charlotte, NC'], query);
  }
  assert.deepEqual(labels('Mecklenburg County, NC, USA'), ['Mecklenburg County, NC']);
  assert.deepEqual(labels('28208, NC, USA'), ['ZIP 28208, NC']);
  for (const query of ['Charlotte, SC, USA', 'Raleigh, VA, US', 'USA', ', USA', 'Charlotte, USSR', 'Charlotte USA']) assert.deepEqual(labels(query), [], query);
  // Only when the words find nothing with it: "Fairview, U" is still the start of "Fairview, Union County".
  assert.deepEqual(labels('Fairview, U'), ['Fairview (Union County), NC']);
});

test('typing sweep: every prefix of a sample of names, bare and with NC suffixes, still finds the name', () => {
  // The method of the round 2 review's rv-f2-out/typing.mjs, as an assertion. Every county, every
  // fourth place and every twentieth ZCTA, plus every place whose name an alias, a "C" word or
  // punctuation touches. Allowed misses: a prefix shorter than the search minimum (one character,
  // or a ZIP under three digits) and a list cut at the cap of 20. Since N1 nothing else is allowed.
  const everything = allPlaces();
  const places = everything.filter((c) => c.id.startsWith('us-place:'));
  const zctas = everything.filter((c) => c.id.startsWith('us-zcta:'));
  const special = (name) => /['().-]/.test(name) || / (St|Mount|Fort|C[a-z]*)\b/.test(name) || /^(St|Mount|Fort)\b/.test(name);
  const sample = [
    ...everything.filter((c) => c.id.startsWith('us-county:')),
    ...places.filter((c, at) => at % 4 === 0 || special(c.place)),
    ...zctas.filter((c, at) => at % 20 === 0),
  ];
  assert.ok(sample.length > 350, `${sample.length} names`);
  const misses = new Set();
  let checked = 0;
  for (const { id, place } of sample) {
    for (const suffix of ['', ', NC', ' NC', ', North Carolina', ' N.C.', ', North Carolina, USA']) {
      const full = place + suffix;
      for (let end = 1; end <= full.length; end += 1) {
        const query = full.slice(0, end);
        const typed = query.trim();
        if (typed.length === 1 || /^\d{1,2}$/.test(typed)) continue;
        checked += 1;
        const found = searchPlaces({ query, state: '' });
        if (found.length === MAX_CANDIDATES || found.some((c) => c.id === id)) continue;
        assert.ok(found.length > 0, `${place}: ${JSON.stringify(query)} found nothing`);
        misses.add(`${place} at ${JSON.stringify(query)}`);
      }
    }
  }
  assert.ok(checked > 40_000, `${checked} queries`);
  // "Yadkin Co" and "Rutherford Co" used to be their counties only; since N1 the College follows the county.
  assert.deepEqual([...misses].sort(), []);
});
