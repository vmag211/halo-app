/**
 * B10 Task 1: the Census internal point of every county, place and ZCTA in
 * lib/data/ncPlaces.json (built by scripts/build-nc-places.mjs), `placePoint`
 * and `exactPlaces` in lib/places.js. No network: every check reads the repo.
 *
 * The id-and-name lists are compared with ec427ce's (the B05 Task 8 merge) by
 * sha256, computed from `git show ec427ce:lib/data/ncPlaces.json` when this
 * task was built, so the test needs no git history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { placePoint, exactPlaces, searchPlaces, placeById, allPlaces } = await import('../lib/places.js');
const { countyForPoint, pointInGeometry } = await import('../lib/geoContainment.js');
const DATA = new URL('../lib/data/ncPlaces.json', import.meta.url);
const gazetteer = JSON.parse(readFileSync(DATA, 'utf8'));
const counties = JSON.parse(readFileSync(new URL('../lib/data/ncCounties.json', import.meta.url), 'utf8'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIELDS = ['id', 'place', 'state', 'label', 'timezone'];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// North Carolina's bounding box, from the repo's own county boundaries.
const BOX = (() => {
  const box = { south: 90, north: -90, west: 180, east: -180 };
  const walk = (node) => {
    if (typeof node[0] === 'number') {
      box.south = Math.min(box.south, node[1]);
      box.north = Math.max(box.north, node[1]);
      box.west = Math.min(box.west, node[0]);
      box.east = Math.max(box.east, node[0]);
    } else node.forEach(walk);
  };
  for (const county of counties.counties) walk(county.geometry.coordinates);
  return box;
})();
const inBox = ({ lat, lng }) => lat >= BOX.south && lat <= BOX.north && lng >= BOX.west && lng <= BOX.east;
// A rounded point: a finite number with at most 3 decimals, inside latitude and longitude.
const threeDecimals = (value) => Number.isFinite(value) && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;
const validPoint = (point) =>
  threeDecimals(point.lat) && threeDecimals(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

test('the header records the county Gazetteer, its sha256 and the point rule', () => {
  assert.equal(gazetteer.files.length, 4);
  assert.deepEqual(gazetteer.files.map((file) => file.url), [
    'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_gaz_place_37.txt',
    'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_zcta_national.zip',
    'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt',
    'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_counties_national.zip',
  ]);
  // The three B05 inputs were downloaded again for this task and hashed the same.
  assert.equal(gazetteer.files[0].sha256, 'e7f5eb44d3d6f911d0ad575f2f7c8f240b1332e2fdb79959affb77b12f5edfae');
  assert.equal(gazetteer.files[1].sha256, 'f1e9046b91f6e60686a99343cb2752834c02b0764939403b331c78c017e2c54c');
  assert.equal(gazetteer.files[1].unzippedSha256, 'e85e5d6a3df1d4f0655dae4851383b0e8f68579fb0f3f62ef0f11928b70bbda4');
  assert.equal(gazetteer.files[2].sha256, '3ed41278d637dc249e0323306f68be8a6c234e3090f4de88ef328dee71aeaaaf');
  assert.equal(gazetteer.files[3].sha256, '6a99ca00efbc0be5112e225d4102704c51d5ce3b16e3afd6e4159460595fd12a');
  assert.equal(gazetteer.files[3].unzippedSha256, '0c9bb040b1cded73b77541cab8acae7b5851ff9c257ad97a1094c0d8adfab9c1');
  assert.match(gazetteer.pointRule, /^Census internal point \(INTPTLAT and INTPTLONG .*\), rounded to 3 decimals\./);
  assert.match(gazetteer.source, /national counties/);
  assert.equal(gazetteer.retrieved, '2026-10-19');
});

test('the place and ZCTA ids and names are exactly those of ec427ce; only the points were added', () => {
  const places = JSON.stringify(gazetteer.places.map(({ geoid, name }) => [geoid, name]));
  const zctas = JSON.stringify(gazetteer.zctas.map(({ zcta }) => zcta));
  assert.equal(sha256(places), 'fbfc8bbbe35767b8ae477988eb78940e7f4dd5b64604b9dde5ceb4a4399f7ef7');
  assert.equal(sha256(zctas), 'e5a5d0ccd71c57ff6775f55535b9b6177b01d083451b9fd3019b305bb60d75b6');
  for (const place of gazetteer.places) assert.deepEqual(Object.keys(place), ['geoid', 'name', 'lat', 'lng']);
  for (const zcta of gazetteer.zctas) assert.deepEqual(Object.keys(zcta), ['zcta', 'lat', 'lng']);
  for (const county of gazetteer.counties) assert.deepEqual(Object.keys(county), ['geoid', 'lat', 'lng']);
});

test('every county, place and ZCTA has a point, finite and rounded to 3 decimals', () => {
  assert.equal(gazetteer.counties.length, 100);
  assert.deepEqual(gazetteer.counties.map((c) => c.geoid), counties.counties.map((c) => c.geoid).sort(),
    'exactly the 100 counties of ncCounties.json, in GEOID order');
  assert.equal(gazetteer.places.length, 785);
  assert.equal(gazetteer.zctas.length, 853);
  for (const entry of [...gazetteer.counties, ...gazetteer.places, ...gazetteer.zctas]) {
    assert.equal(validPoint(entry), true, JSON.stringify(entry));
  }
  // At least some points use all three decimals, so nothing was rounded coarser.
  assert.ok(gazetteer.places.filter((p) => Math.round(p.lat * 1000) % 10 !== 0).length > 500);
});

test('every county and place point is in North Carolina, and every county point is inside its own county', () => {
  assert.ok(BOX.south > 33.7 && BOX.north < 36.6 && BOX.west > -84.4 && BOX.east < -75.4, JSON.stringify(BOX));
  for (const entry of [...gazetteer.counties, ...gazetteer.places]) assert.equal(inBox(entry), true, JSON.stringify(entry));
  const byGeoid = new Map(counties.counties.map((c) => [c.geoid, c]));
  // The simplified (~200 m) boundaries would explain a county point just outside its own line;
  // with the 2026 points there is none, and any that appears must be named here by hand.
  const outsideOwn = gazetteer.counties.filter(({ geoid, lat, lng }) => !pointInGeometry(lat, lng, byGeoid.get(geoid).geometry));
  assert.deepEqual(outsideOwn.map((c) => c.geoid), []);
  for (const { geoid, lat, lng } of gazetteer.counties) assert.equal(countyForPoint(lat, lng), byGeoid.get(geoid).name, geoid);
  assert.deepEqual(gazetteer.places.filter((p) => countyForPoint(p.lat, p.lng) === null).map((p) => p.name), [],
    'every place point is inside some NC county');
});

test('ZCTA points outside North Carolina are listed as cross-state (none in this vintage)', () => {
  // A cross-state ZCTA keeps its own point (pointRule), which could lie outside NC.
  const crossState = gazetteer.zctas.filter((z) => countyForPoint(z.lat, z.lng) === null).map((z) => z.zcta);
  assert.deepEqual(crossState, []);
  // 27048 crosses into Virginia (places.test.mjs) and its point is still in NC.
  assert.ok(countyForPoint(placePoint('us-zcta:27048').lat, placePoint('us-zcta:27048').lng));
});

test('placePoint gives the written point for every id, and null for anything else', () => {
  // The Gazetteer rows, rounded: Charlotte city 35.209045|-80.83099, Mecklenburg County
  // 35.247291|-80.83358, ZCTA 28202 35.227271|-80.844194.
  assert.deepEqual(placePoint('us-place:3712000'), { lat: 35.209, lng: -80.831 }, 'Charlotte');
  assert.deepEqual(placePoint('us-county:37119'), { lat: 35.247, lng: -80.834 }, 'Mecklenburg County');
  assert.deepEqual(placePoint('us-zcta:28202'), { lat: 35.227, lng: -80.844 }, 'ZIP 28202');
  for (const { geoid, lat, lng } of gazetteer.counties) assert.deepEqual(placePoint(`us-county:${geoid}`), { lat, lng });
  for (const { geoid, lat, lng } of gazetteer.places) assert.deepEqual(placePoint(`us-place:${geoid}`), { lat, lng });
  for (const { zcta, lat, lng } of gazetteer.zctas) assert.deepEqual(placePoint(`us-zcta:${zcta}`), { lat, lng });
  for (const candidate of allPlaces()) assert.ok(placePoint(candidate.id), candidate.id);
  for (const id of ['us-zcta:99999', 'us-zcta:29201', 'us-county:37000', 'us-place:3700000', 'US-PLACE:3712000', ' us-place:3712000',
    'us-place:3712000 ', 'us-zcta:2820', 'us-zcta:28202-1234', 'us-zip:28202', '28202', 'Charlotte', '', null, undefined, 3712000, {}, ['us-zcta:28202']]) {
    assert.equal(placePoint(id), null, JSON.stringify(id));
  }
  const point = placePoint('us-place:3712000');
  point.lat = 0;
  assert.equal(placePoint('us-place:3712000').lat, 35.209, 'a caller cannot change the gazetteer');
});

test('candidates keep exactly their five fields: no point leaks into search, placeById, allPlaces or exactPlaces', () => {
  const lists = [
    allPlaces(),
    searchPlaces({ query: 'Charlotte', state: '' }),
    searchPlaces({ query: 'Ca', state: '' }),
    searchPlaces({ query: '282', state: '' }),
    [placeById('us-place:3712000'), placeById('us-county:37119'), placeById('us-zcta:28202')],
    ...['Columbus', '28202', 'Fairview'].flatMap((text) => Object.values(exactPlaces(text))),
  ];
  for (const list of lists) for (const candidate of list) assert.deepEqual(Object.keys(candidate), FIELDS, JSON.stringify(candidate));
});

test('exactPlaces: exact county, place and ZCTA matches of one segment, kinds kept apart, never by prefix', () => {
  const ids = (text) => Object.fromEntries(Object.entries(exactPlaces(text)).map(([kind, list]) => [kind, list.map((c) => c.id)]));
  const none = { zctas: [], places: [], counties: [] };
  assert.deepEqual(ids('Columbus County'), { zctas: [], places: [], counties: ['us-county:37047'] });
  assert.deepEqual(ids('Columbus'), { zctas: [], places: ['us-place:3713980'], counties: ['us-county:37047'] });
  assert.deepEqual(exactPlaces('Columbus').places.map((c) => c.label), ['Columbus, NC']);
  for (const text of ['Mecklenburg', 'Mecklenburg County', 'Mecklenburg Co.', 'mecklenburg co', '  MECKLENBURG  ']) {
    assert.deepEqual(ids(text), { zctas: [], places: [], counties: ['us-county:37119'] }, text);
  }
  for (const text of ['Charlotte', 'charlotte', ' Charlotte. ']) assert.deepEqual(ids(text), { ...none, places: ['us-place:3712000'] }, text);
  assert.deepEqual(ids('Fairview'), { ...none, places: ['us-place:3722440', 'us-place:3722500'] }, 'two places of one name');
  assert.deepEqual(ids('Fairview (Union County)'), { ...none, places: ['us-place:3722500'] });
  assert.deepEqual(ids('Saint Pauls'), ids('St. Pauls'));
  assert.equal(ids('St. Pauls').places.length, 1);
  assert.deepEqual(ids('Mt Airy'), ids('Mount Airy'));
  for (const text of ['28202', 'ZIP 28202', 'zip code 28202']) assert.deepEqual(ids(text), { ...none, zctas: ['us-zcta:28202'] }, text);
  // Never a prefix, a word still being typed, a state or a ZIP that is not an NC ZCTA: those are
  // the caller's (B10 Task 2) to read.
  for (const text of ['Char', 'Charl', 'Charlo', 'Mecklen', 'Wake Cou', 'Wake C', 'Sai', 'Saint', 'Fair', '2820', '282', '29201', '99999',
    '282021', 'Charlotte, NC', 'Charlotte NC', 'NC', 'County', '', '   ', ',', 'Atlantis']) {
    assert.deepEqual(exactPlaces(text), none, JSON.stringify(text));
  }
  for (const value of [null, undefined, 28202, {}, ['Charlotte']]) assert.deepEqual(exactPlaces(value), none, JSON.stringify(value));
  // An alias typed in its other spelling is a whole word (Task 1 review N2): "Saint" is never the
  // start of a joined name, so "Saint Anley" is not Stanley and "Saint Okes" is not Stokes County.
  assert.ok(ids('Stanley').places.length === 1 && ids('Stokes').counties.length === 1, 'the names exist');
  assert.equal(ids('Mountain Home').places.length, 1);
  for (const text of ['Saint Anley', 'Saint Okes', 'Saint Atesville', 'Mt Ain Home', 'Mt Ain View']) assert.deepEqual(exactPlaces(text), none, text);
  // Every county and every place is found exactly by its own name.
  for (const candidate of allPlaces()) {
    const found = exactPlaces(candidate.place);
    const kind = candidate.id.startsWith('us-county:') ? 'counties' : candidate.id.startsWith('us-place:') ? 'places' : 'zctas';
    assert.ok(found[kind].some((c) => c.id === candidate.id), candidate.id);
    assert.deepEqual(found[kind].find((c) => c.id === candidate.id), candidate);
  }
});

test('the data file stays server-only, under 120 KB and free of U+2014', () => {
  const bytes = statSync(DATA).size;
  assert.ok(bytes < 120 * 1024, `${bytes} bytes`);
  assert.equal(readFileSync(DATA, 'utf8').includes(String.fromCharCode(0x2014)), false);
  // No client-side file reads the gazetteer or lib/places.js: only route handlers and the build do.
  const clientRoots = ['components', 'lib/frontend', 'app'];
  const readers = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) {
        if (path.replace(/\\/g, '/').endsWith('app/api')) continue;
        walk(path);
      } else if (/\.(js|jsx|ts|tsx|mjs)$/.test(name.name) && /ncPlaces|lib\/places['".]/.test(readFileSync(path, 'utf8'))) {
        readers.push(path);
      }
    }
  };
  for (const dir of clientRoots) walk(join(ROOT, dir));
  assert.deepEqual(readers, []);
});
