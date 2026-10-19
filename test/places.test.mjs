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

const { searchPlaces, placeById, parseLocationQuery, allPlaces, MAX_CANDIDATES } = await import('../lib/places.js');
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

test('every county is found by exact name in any case; with "County" or "Co." it is the only answer, without it the first', () => {
  for (const county of source.counties) {
    const expected = {
      id: `us-county:${county.geoid}`,
      place: county.name,
      state: 'NC',
      label: `${county.name}, NC`,
      timezone: 'America/New_York',
    };
    const n = bare(county.name);
    for (const query of [county.name, county.name.toUpperCase(), `${n} co.`, `${n} Co`, `  ${n} County  `]) {
      assert.deepEqual(searchPlaces({ query, state: '' }), [expected], `${county.name} by "${query}"`);
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
  assert.deepEqual(searchPlaces({ query: 'Yadkin Co', state: '' }).map((c) => c.label), ['Yadkin County, NC'], 'and "Co" is not a prefix of Yadkin College');
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
  assert.ok(gazetteer.places.every((p) => /^37\d{5}$/.test(p.geoid) && Object.keys(p).join() === 'geoid,name'));
  assert.equal(new Set(gazetteer.places.map((p) => p.geoid)).size, 785);
  assert.equal(new Set(gazetteer.places.map((p) => p.name)).size, 785, 'no two places share a display name');
  assert.equal(gazetteer.zctas.length, 853);
  assert.ok(gazetteer.zctas.every((z) => /^2[78]\d{3}$/.test(z.zcta) && Object.keys(z).join() === 'zcta'), 'NC ZIP codes are 27xxx and 28xxx');
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
  assert.deepEqual(one('Yadkin Co').map((c) => c.label), ['Yadkin County, NC']);
  assert.deepEqual(one('Yadkin, Co').map((c) => c.label), ['Yadkin County, NC']);
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
