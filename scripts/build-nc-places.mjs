/**
 * Builds lib/data/ncPlaces.json, the North Carolina cities, towns, villages,
 * census-designated places and ZIP Code Tabulation Areas behind
 * GET /api/locations/search (B05 Task 8), with the Census internal point of
 * every county, place and ZCTA for GET /api/forecast (B10 Task 1), from U.S.
 * Census Bureau files that were downloaded by hand and reviewed first.
 *
 *   node scripts/build-nc-places.mjs \
 *     --places <2026_gaz_place_37.txt> \
 *     --zctas <2026_Gaz_zcta_national.txt, unzipped> \
 *     --zctaZip <2026_Gaz_zcta_national.zip> \
 *     --relationship <tab20_zcta520_county20_natl.txt> \
 *     --counties <2026_Gaz_counties_national.txt, unzipped> \
 *     --countiesZip <2026_Gaz_counties_national.zip> \
 *     --retrieved 2026-10-19 \
 *     --out lib/data/ncPlaces.json
 *
 * The inputs are untrusted data: they are only read as pipe-delimited text,
 * never executed, and every value that reaches the output is checked against
 * a strict pattern. Nothing is fetched here; the sha256 of each input is
 * computed from the file given and written into the header, so a reviewer can
 * match the output to the downloads recorded in the task report.
 *
 * PLACES. Every row of the NC place Gazetteer, all four kinds North Carolina
 * has (LSAD 25 city, 43 town, 47 village, 57 census-designated place), active
 * or inactive. The display name is the Census NAME with its trailing LSAD
 * descriptor removed ("Aberdeen town" is "Aberdeen", "Advance CDP" is
 * "Advance"); a row whose LSAD is not one of the four, or whose NAME does not
 * end in its own descriptor, stops the build. Spelling, capitals, apostrophes
 * and hyphens are kept as the Census writes them. Where two places would then
 * share a display name, each gets its county in parentheses ("Fairview
 * (Buncombe County)"), the county being the one that contains the place's
 * Census internal point on the repo's own county boundaries
 * (lib/geoContainment.js); the build stops if that leaves any name ambiguous,
 * or if any point about a kilometre around that internal point is in another
 * county (COUNTY_MARGIN), because those boundaries are simplified to about
 * 200 m and a border place must then be checked by hand.
 *
 * NO EM DASH. A U+2014 in a source name is replaced here, at build time, by a
 * comma and a space, the same transformation the client's safeText applies,
 * and the build stops if one survives. The 2026 file has none.
 *
 * ZCTAS. A ZCTA is in North Carolina when the 2020 ZCTA to county relationship
 * file gives it a part with land area inside an NC county (GEOID 37xxx). A
 * ZCTA that crosses the state line is included, because some of it is in NC.
 * Each must also be in the 2026 ZCTA Gazetteer, or the build stops.
 *
 * POINTS (B10 Task 1, ruling F2). Every county, place and ZCTA carries its
 * Census internal point (INTPTLAT, INTPTLONG), rounded to 3 decimals, the
 * precision a saved home is stored at (lib/geocode.js roundCoord). Each value
 * must be a plain decimal of latitude or longitude, or the build stops. The
 * counties are the NC rows of the 2026 county Gazetteer (USPS NC, GEOID 37xxx),
 * and they must be exactly the 100 GEOIDs of lib/data/ncCounties.json. A ZCTA
 * that crosses the state line keeps its own point, which may lie outside NC.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import counties from '../lib/data/ncCounties.json' with { type: 'json' };
import { countyForPoint } from '../lib/geoContainment.js';
import { roundCoord } from '../lib/geocode.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, at, all) => (at % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), all[at + 1]]] : pairs), []),
);
for (const name of ['places', 'zctas', 'zctaZip', 'relationship', 'counties', 'countiesZip', 'retrieved', 'out']) {
  if (!args[name]) throw new Error(`--${name} is required`);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.retrieved)) throw new Error('--retrieved is a YYYY-MM-DD date');

// Each source URL and the argument that names its downloaded file. The ZCTA URL is the zip,
// so its sha256 is the zip's; the unzipped text the build reads is hashed separately.
const SOURCES = [
  { url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_gaz_place_37.txt', file: 'places' },
  { url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_zcta_national.zip', file: 'zctaZip', unzipped: 'zctas' },
  { url: 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt', file: 'relationship' },
  { url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_counties_national.zip', file: 'countiesZip', unzipped: 'counties' },
];
// The county of a place that shares its name must hold for every point this far (in degrees,
// about a kilometre) around the place's internal point, five times the ~200 m simplification
// of the repo's county boundaries, so a border place is never labelled by a simplified edge.
const COUNTY_MARGIN = 0.01;
const EM_DASH = String.fromCharCode(0x2014);
const DESCRIPTOR = { 25: 'city', 43: 'town', 47: 'village', 57: 'CDP' };

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Pipe-delimited rows as objects keyed by the header, every value trimmed. */
function table(file) {
  // The relationship file starts with a byte order mark. trim() below would also remove it
  // from the first column name; stripping it here says so.
  const lines = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  const head = lines[0].split('|').map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split('|');
    if (cells.length !== head.length) throw new Error(`${file}: a row has ${cells.length} cells, not ${head.length}`);
    return Object.fromEntries(cells.map((cell, at) => [head[at], cell.trim()]));
  });
}

/** A display name that 0022 and the client will both hold. */
function cleanName(raw) {
  const name = raw.replaceAll(new RegExp(`\\s*${EM_DASH}\\s*`, 'g'), ', ').replace(/\s+/g, ' ').trim();
  if (name.includes(EM_DASH)) throw new Error(`an em dash survived in ${JSON.stringify(raw)}`);
  if (!/^[A-Za-z][A-Za-z .,'()-]*$/.test(name)) throw new Error(`unexpected characters in ${JSON.stringify(raw)}`);
  if (Buffer.byteLength(name) > 200) throw new Error(`${JSON.stringify(raw)} is too long`);
  return name;
}

/**
 * The Census internal point of a row, rounded to 3 decimals. The Gazetteer writes each as a
 * plain decimal; anything else, or a value outside latitude and longitude, stops the build.
 */
function point(row, what) {
  const decimal = /^-?\d{1,3}\.\d+$/;
  if (!decimal.test(row.INTPTLAT) || !decimal.test(row.INTPTLONG)) throw new Error(`${what}: a malformed internal point`);
  const lat = Number(row.INTPTLAT);
  const lng = Number(row.INTPTLONG);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Error(`${what}: an internal point out of range`);
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

// ---------------------------------------------------------------- places

const places = table(args.places).map((row) => {
  if (row.USPS !== 'NC') throw new Error(`a place outside NC: ${row.GEOID}`);
  if (!/^37\d{5}$/.test(row.GEOID)) throw new Error(`a malformed place GEOID: ${row.GEOID}`);
  const descriptor = DESCRIPTOR[row.LSAD];
  if (!descriptor) throw new Error(`an unexpected LSAD ${row.LSAD} on ${row.NAME}`);
  const suffix = ` ${descriptor}`;
  if (!row.NAME.endsWith(suffix)) throw new Error(`${row.NAME} does not end in "${suffix}"`);
  const name = cleanName(row.NAME.slice(0, -suffix.length));
  if (/ County$/.test(name)) throw new Error(`${row.NAME} would read as a county`);
  // The unrounded point decides a shared name's county below; the rounded one is written.
  return { geoid: row.GEOID, name, lat: Number(row.INTPTLAT), lng: Number(row.INTPTLONG), point: point(row, row.GEOID) };
});
if (new Set(places.map((p) => p.geoid)).size !== places.length) throw new Error('a place GEOID repeats');

const byName = new Map();
for (const place of places) byName.set(place.name, [...(byName.get(place.name) ?? []), place]);
const disambiguated = [];
for (const [name, shared] of byName) {
  if (shared.length < 2) continue;
  for (const place of shared) {
    const county = countyForPoint(place.lat, place.lng);
    if (!county) throw new Error(`no county contains ${name} (${place.geoid})`);
    for (const [dLat, dLng] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const near = countyForPoint(place.lat + dLat * COUNTY_MARGIN, place.lng + dLng * COUNTY_MARGIN);
      if (near !== county) {
        throw new Error(`${name} (${place.geoid}) is within ${COUNTY_MARGIN} degrees of the ${county} line (${near} is next to it): check its county by hand`);
      }
    }
    place.name = `${name} (${county})`;
    disambiguated.push(`${place.geoid} ${place.name}`);
  }
}
if (new Set(places.map((p) => p.name)).size !== places.length) throw new Error('a display name is still shared');
places.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// ----------------------------------------------------------------- ZCTAs

const gazetteer = new Map(table(args.zctas).map((row) => [row.GEOID, row]));
const zctas = new Set();
for (const row of table(args.relationship)) {
  if (!row.GEOID_ZCTA5_20 || !/^37\d{3}$/.test(row.GEOID_COUNTY_20) || !(Number(row.AREALAND_PART) > 0)) continue;
  if (!/^\d{5}$/.test(row.GEOID_ZCTA5_20)) throw new Error(`a malformed ZCTA: ${row.GEOID_ZCTA5_20}`);
  if (!gazetteer.has(row.GEOID_ZCTA5_20)) throw new Error(`${row.GEOID_ZCTA5_20} is not in the 2026 ZCTA Gazetteer`);
  zctas.add(row.GEOID_ZCTA5_20);
}

// -------------------------------------------------------------- counties

const countyPoints = table(args.counties)
  .filter((row) => row.USPS === 'NC')
  .map((row) => {
    if (!/^37\d{3}$/.test(row.GEOID)) throw new Error(`a malformed NC county GEOID: ${row.GEOID}`);
    return { geoid: row.GEOID, ...point(row, row.GEOID) };
  })
  .sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));
const expectedCounties = counties.counties.map((c) => c.geoid).sort();
if (countyPoints.map((c) => c.geoid).join() !== expectedCounties.join()) {
  throw new Error('the NC rows of the county Gazetteer are not exactly the 100 counties of lib/data/ncCounties.json');
}

// ---------------------------------------------------------------- output

const header = {
  source: 'U.S. Census Bureau: 2026 Gazetteer Files (North Carolina places, national ZIP Code Tabulation Areas, and national counties for the internal points of the NC counties), with the 2020 ZCTA to county relationship file to select the NC ZCTAs',
  vintage: 'Places: 2026 Gazetteer, boundaries as of January 1, 2026 (the vintage of TIGERweb Current, from which ncCounties.json was taken). ZCTAs: the 2020 Census ZCTA5 set, which the 2026 Gazetteer still carries. County internal points: 2026 Gazetteer, the same vintage as the places',
  retrieved: args.retrieved,
  licence: 'Public domain: a work of the U.S. federal government, not subject to copyright in the United States (17 U.S.C. 105). The Census Bureau states its data is "freely available for use and re-use by the public" (https://www.census.gov/open/) and that its TIGER/Line products "are not copyrighted" and are "free to use in a product or publication, however acknowledgement must be given to the U.S. Census Bureau as the source" (TIGER/Line 2026 place metadata, Use Constraints). Credit: U.S. Census Bureau',
  files: SOURCES.map(({ url, file, unzipped }) => ({ url, sha256: sha256(args[file]), ...(unzipped ? { unzippedSha256: sha256(args[unzipped]) } : {}) })),
  nameRule: 'Census NAME less its trailing LSAD descriptor (city, town, village or CDP), spelled as the Census writes it. Two places that would share a name each carry their county in parentheses. A U+2014 is replaced by ", " at build time (none in this vintage). Built by scripts/build-nc-places.mjs',
  zctaRule: 'Every ZCTA with land area in an NC county in the 2020 ZCTA to county relationship file, cross-state ZCTAs included',
  pointRule: 'Census internal point (INTPTLAT and INTPTLONG of the 2026 Gazetteer files), rounded to 3 decimals. A cross-state ZCTA keeps its own point, which may lie outside NC',
  disambiguated,
};

const lines = [
  '{',
  ...Object.entries(header).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
  '  "places": [',
  places.map(({ geoid, name, point: { lat, lng } }) => `    ${JSON.stringify({ geoid, name, lat, lng })}`).join(',\n'),
  '  ],',
  '  "zctas": [',
  [...zctas].sort().map((zcta) => `    ${JSON.stringify({ zcta, ...point(gazetteer.get(zcta), zcta) })}`).join(',\n'),
  '  ],',
  '  "counties": [',
  countyPoints.map((county) => `    ${JSON.stringify(county)}`).join(',\n'),
  '  ]',
  '}',
  '',
];
writeFileSync(args.out, lines.join('\n'));
console.log(`${places.length} places (${disambiguated.length} disambiguated), ${zctas.size} ZCTAs, ${countyPoints.length} county points written to ${args.out}`);
