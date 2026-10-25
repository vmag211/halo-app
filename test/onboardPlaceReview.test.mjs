/**
 * Audit F03: onboarding must not turn an implausible place into a home, and must show the person
 * the place it found (with the water utility as a suggestion for the area) before the household
 * step goes on. Covers lib/geocode.js chooseGeocodeFeature and areaLabel, POST /api/onboard over a
 * mocked Mapbox and ArcGIS (never the live services), lib/frontend/onboarding.ts placeReview, and
 * the Explore area lookup's out-of-coverage wording.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { chooseGeocodeFeature, areaLabel, isCoordinateQuery, MIN_RELEVANCE } from '../lib/geocode.js';

const domain = await loadFrontend('onboarding');
const { copy } = await loadFrontend('copy');
const { searchPlaces } = await import('../lib/places.js');

const NC = { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' };
const US = { id: 'country.1', text: 'United States', short_code: 'us' };
const CABARRUS = { id: 'district.1', text: 'Cabarrus County' };
const NOT_FOUND = "We couldn't find that place. Try a street address with a city, or a ZIP code.";

// Shapes as Mapbox v5 forward geocoding returns them (place_type, relevance, text, context).
const ZIP_28027 = {
  id: 'postcode.1', place_type: ['postcode'], relevance: 1, text: '28027', center: [-80.6, 35.4],
  context: [{ id: 'place.1', text: 'Concord' }, CABARRUS, NC, US],
};
const ADDRESS = {
  id: 'address.1', place_type: ['address'], relevance: 1, text: 'Elm Court', address: '2', center: [-80.61, 35.41],
  context: [{ id: 'postcode.1', text: '28027' }, { id: 'place.1', text: 'Concord' }, CABARRUS, NC, US],
};
const town = (text, region, code, relevance = 1, center = [-80.58, 35.41]) => ({
  id: `place.${text}.${code}`, place_type: ['place'], relevance, text, center,
  context: [{ id: 'district.1', text: `${text} County` }, { id: 'region.1', text: region, short_code: `US-${code}` }, US],
});
const CONCORDS = [town('Concord', 'North Carolina', 'NC'), town('Concord', 'California', 'CA', 1, [-122.03, 37.98]), town('Concord', 'New Hampshire', 'NH', 0.99, [-71.54, 43.21])];
// What a fuzzy geocoder can hand back for "not-a-real-place-qa": a guess from one word.
const NONSENSE = [town('Real', 'Texas', 'TX', 0.42, [-99.8, 29.8]), { id: 'poi.1', place_type: ['poi'], relevance: 0.33, text: 'Place Cafe', center: [-80, 35], context: [NC] }];
// "123 Nowhere Lane, Faketown": a different street, matching only part of what was typed.
const UNMATCHED = [{ ...ADDRESS, text: 'Nowhere Road', relevance: 0.55 }, { id: 'region.1', place_type: ['region'], relevance: 0.3, text: 'North Carolina', center: [-79.4, 35.5] }];
const STATE_ONLY = [{ id: 'region.1', place_type: ['region'], relevance: 1, text: 'North Carolina', center: [-79.4, 35.5], context: [US] }];

// ------------------------------------------------------------- the choice itself

test('chooseGeocodeFeature: a nonsense string, an unmatched address and a whole state are no answer, never a silent home', () => {
  assert.deepEqual(chooseGeocodeFeature(NONSENSE, 'not-a-real-place-qa'), { ok: false, reason: 'low_confidence' });
  assert.deepEqual(chooseGeocodeFeature(UNMATCHED, '123 Nowhere Lane, Faketown'), { ok: false, reason: 'low_confidence' });
  assert.deepEqual(chooseGeocodeFeature(STATE_ONLY, 'North Carolina'), { ok: false, reason: 'too_broad' });
  assert.deepEqual(chooseGeocodeFeature([], 'anything'), { ok: false, reason: 'no_result' });
  assert.deepEqual(chooseGeocodeFeature(undefined, 'anything'), { ok: false, reason: 'no_result' });
  // A result just under the threshold is still a guess; missing relevance is not confidence.
  assert.equal(chooseGeocodeFeature([{ ...ADDRESS, relevance: MIN_RELEVANCE - 0.01 }], '2 Elm Court').ok, false);
  assert.equal(chooseGeocodeFeature([{ ...ADDRESS, relevance: undefined }], '2 Elm Court').ok, false);
});

test('chooseGeocodeFeature: a bare ZIP must come back as that same ZIP, an area-level place', () => {
  const found = chooseGeocodeFeature([ZIP_28027], '28027');
  assert.equal(found.ok, true);
  assert.equal(found.feature, ZIP_28027);
  assert.deepEqual([found.label, found.precision, found.ambiguous], ['Concord, North Carolina 28027', 'area', false]);
  assert.equal(chooseGeocodeFeature([ZIP_28027], '28027-1234').ok, true, 'ZIP+4 matches its five digits');
  assert.deepEqual(chooseGeocodeFeature([ZIP_28027], '28025'), { ok: false, reason: 'zip_mismatch' }, 'a different ZIP is not this one');
  assert.deepEqual(chooseGeocodeFeature([ADDRESS], '28027'), { ok: false, reason: 'zip_mismatch' }, 'nor is a street that happens to be in it');
});

test('chooseGeocodeFeature: an ambiguous town name is flagged so the person checks it; a single good match is not', () => {
  const concord = chooseGeocodeFeature(CONCORDS, 'Concord');
  assert.equal(concord.ok, true);
  assert.equal(concord.feature, CONCORDS[0], 'the best match is still proposed');
  assert.deepEqual([concord.label, concord.precision, concord.ambiguous], ['Concord, North Carolina', 'area', true]);
  const exact = chooseGeocodeFeature([CONCORDS[0], { ...CONCORDS[1], relevance: 0.6 }], 'Concord, NC');
  assert.equal(exact.ambiguous, false, 'a far weaker match elsewhere is not ambiguity');
  const street = chooseGeocodeFeature([ADDRESS, { ...ADDRESS, relevance: 0.97 }], '2 Elm Court, Concord');
  assert.equal(street.ambiguous, false, 'two hits in the same area are one place');
  assert.deepEqual([street.label, street.precision], ['Concord, North Carolina 28027', 'address']);
});

test('chooseGeocodeFeature: device GPS ("lng,lat") takes the most specific home-like reverse result', () => {
  assert.equal(isCoordinateQuery('-80.57952,35.40881'), true);
  assert.equal(isCoordinateQuery('28027'), false);
  const reverse = chooseGeocodeFeature([STATE_ONLY[0], ADDRESS], '-80.57952,35.40881');
  assert.equal(reverse.feature, ADDRESS);
  assert.equal(reverse.precision, 'address');
  assert.deepEqual(chooseGeocodeFeature(STATE_ONLY, '-80.5,35.4'), { ok: false, reason: 'too_broad' });
});

test('areaLabel never echoes the street line', () => {
  assert.equal(areaLabel(ADDRESS), 'Concord, North Carolina 28027');
  assert.doesNotMatch(areaLabel(ADDRESS), /Elm|\b2\b/);
  assert.equal(areaLabel({ place_type: ['neighborhood'], text: 'Dilworth', context: [{ id: 'place.1', text: 'Charlotte' }, NC] }), 'Dilworth, Charlotte, North Carolina');
  assert.equal(areaLabel(null), null);
});

// ------------------------------------------------------------- the route, over mocked providers

const ALICE = { lat: 35.5, lng: -80.5, county: 'Old County', state: 'NC', pwsid: 'NC9990001', zip: null };

/** POST /api/onboard before migration 0016 (the legacy save), Mapbox answered per address. */
function harness({ places = {}, utilities = ['NC0112010'] } = {}) {
  const outbound = [];
  const h = createRouteHarness({
    tables: haloTables('profiles', 'daily_scores'),
    env: { MAPBOX_TOKEN: 'pk.test-token' },
    seed: ({ alice }) => ({ profiles: [{ id: alice.id, ...ALICE }], daily_scores: [] }),
    fetch: async (url) => {
      const target = String(url);
      outbound.push(target);
      if (target.startsWith('https://api.mapbox.com/')) {
        const query = decodeURIComponent(target.split('/mapbox.places/')[1].split('.json')[0]);
        return Response.json({ features: places[query] ?? [] });
      }
      if (target.startsWith('https://services.arcgis.com/')) return Response.json({ features: utilities.map((PWSID) => ({ attributes: { PWSID } })) });
      return new Response('{}', { status: 503 });
    },
  });
  return Object.assign(h, { outbound });
}
const post = (h, body) => h.call('/api/onboard', 'POST', { as: 'alice', body });
const aliceRow = (h) => h.db.rows('profiles').find((row) => row.id === h.identities.alice.id);
const quiet = (t) => t.mock.method(console, 'warn', () => {});

test('route: nonsense and an unmatched address are the friendly 404, nothing saved and no utility lookup', async () => {
  for (const [address, features] of [['not-a-real-place-qa', NONSENSE], ['123 Nowhere Lane, Faketown', UNMATCHED], ['North Carolina', STATE_ONLY]]) {
    const h = harness({ places: { [address]: features } });
    const before = JSON.stringify(aliceRow(h));
    const body = await expectEnvelope(await post(h, { address }), { status: 404, code: 'not_found', retryable: false });
    assert.equal(body.error, NOT_FOUND, address);
    assert.equal(JSON.stringify(aliceRow(h)), before, `${address}: the stored home is untouched`);
    assert.equal(h.outbound.some((url) => url.startsWith('https://services.arcgis.com/')), false, `${address}: no utility was looked up`);
    await h.runAfter();
    assert.equal(h.db.queryLog.filter((q) => q.operation !== 'select').length, 0, `${address}: no backfill`);
  }
  assert.match(copy.errors.address_not_found, /couldn't find that place/, 'the screen says the same thing');
});

test('route: a valid ZIP saves and answers the area it found, with the utility only a suggestion', async (t) => {
  quiet(t);
  const h = harness({ places: { 28027: [ZIP_28027] } });
  const body = await (await post(h, { address: '28027' })).json();
  assert.deepEqual(
    [body.place_label, body.place_precision, body.place_ambiguous, body.pwsid, body.utility_candidates, body.service_area_status],
    ['Concord, North Carolina 28027', 'area', false, 'NC0112010', ['NC0112010'], 'measured'],
  );
  assert.deepEqual([aliceRow(h).lat, aliceRow(h).lng, aliceRow(h).county], [35.4, -80.6, 'Cabarrus County']);
  assert.equal('place_label' in aliceRow(h), false, 'the label is not stored');
});

test('route: an ambiguous town name saves the best match and says it is ambiguous', async (t) => {
  quiet(t);
  const h = harness({ places: { Concord: CONCORDS } });
  const body = await (await post(h, { address: 'Concord' })).json();
  assert.deepEqual([body.place_label, body.place_ambiguous, body.state], ['Concord, North Carolina', true, 'NC']);
});

test('route: several water systems at the point are all reported, and the first is only suggested', async (t) => {
  quiet(t);
  const h = harness({ places: { '2 Elm Court': [ADDRESS] }, utilities: ['NC0113010', 'NC0112010', 'NC0113010'] });
  const body = await (await post(h, { address: '2 Elm Court' })).json();
  assert.deepEqual([body.pwsid, body.utility_candidates, body.place_precision], ['NC0113010', ['NC0113010', 'NC0112010'], 'address']);
  const review = domain.placeReview(body);
  assert.ok(review.notes.includes(copy.household.place.severalUtilities));
});

test('route: a private well with no public system at the point still onboards', async (t) => {
  quiet(t);
  const h = harness({ places: { '2 Elm Court': [ADDRESS] }, utilities: [] });
  const body = await (await post(h, { address: '2 Elm Court', water_source: 'Well' }));
  assert.equal(body.status, 200);
  const json = await body.json();
  assert.deepEqual([json.water_source, json.pwsid, json.service_area_status, json.utility_candidates], ['well', null, 'outside_known_area', []]);
  assert.equal(aliceRow(h).water_source, 'well');
  assert.ok(domain.placeReview(json).notes.includes(copy.household.place.noUtility));
});

test('route: after a rejected place, a corrected one is saved', async (t) => {
  quiet(t);
  const h = harness({ places: { 'not-a-real-place-qa': NONSENSE, '2 Elm Court, Concord': [ADDRESS] } });
  assert.equal((await post(h, { address: 'not-a-real-place-qa' })).status, 404);
  assert.deepEqual([aliceRow(h).lat, aliceRow(h).county], [35.5, 'Old County'], 'the rejected place changed nothing');
  const body = await (await post(h, { address: '2 Elm Court, Concord' })).json();
  assert.deepEqual([body.lat, body.lng, body.place_label], [35.41, -80.61, 'Concord, North Carolina 28027']);
  assert.deepEqual([aliceRow(h).lat, aliceRow(h).lng, aliceRow(h).county], [35.41, -80.61, 'Cabarrus County']);
});

// ------------------------------------------------------------- what the household step shows

test('placeReview: the found place with the right notes, a county fallback, and nothing without a place', () => {
  const p = copy.household.place;
  assert.deepEqual(domain.placeReview({ place_label: 'Concord, North Carolina 28027', place_precision: 'address', service_area_status: 'measured', utility_candidates: ['NC0112010'] }),
    { label: 'Concord, North Carolina 28027', notes: [p.likelyUtility] });
  assert.deepEqual(domain.placeReview({ place_label: 'Concord, North Carolina', place_ambiguous: true, place_precision: 'area', service_area_status: 'measured', utility_candidates: ['A', 'B'] }).notes,
    [p.ambiguous, p.area, p.severalUtilities]);
  assert.deepEqual(domain.placeReview({ county: 'Cabarrus County', state: 'NC', service_area_status: null, recovered_after_timeout: true }), { label: 'Cabarrus County, NC', notes: [] },
    'a timeout-recovered profile has no label but still shows its area');
  assert.deepEqual(domain.placeReview({ place_label: 'X', service_area_status: 'lookup_failed' }).notes, [], 'a failed lookup claims nothing about water');
  assert.equal(domain.placeReview(null), null);
  assert.equal(domain.placeReview({ county: null, state: null }), null);
  for (const text of Object.values(p)) assert.equal(text.includes(String.fromCharCode(0x2014)), false);
  assert.match(copy.reveal.likelyUtility('Concord, City of'), /likely supplier for this area/);
  assert.doesNotMatch(copy.reveal.foundSystem('NC0112010'), /your water system/i, 'a match is not "your" system');
});

// ------------------------------------------------------------- Explore area coverage

test('Explore area lookup: Seattle and 98101 are outside coverage, and the message says so instead of calling them invalid', () => {
  assert.deepEqual(searchPlaces({ query: 'Seattle', state: 'WA' }), []);
  assert.deepEqual(searchPlaces({ query: '98101', state: '' }), []);
  assert.ok(searchPlaces({ query: 'Charlotte', state: '' }).length > 0, 'Charlotte, NC is still found');
  const source = readFileSync(new URL('../components/expanded/ExploreDiscovery.tsx', import.meta.url), 'utf8');
  assert.match(source, /if\(!result\.candidates\.length\)setError\('No North Carolina area matched\. Area lookup covers North Carolina for now, so try a North Carolina city, county or ZIP code\.'\)/);
  assert.doesNotMatch(source, /No matching area was found/);
});
