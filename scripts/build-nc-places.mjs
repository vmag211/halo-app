/**
 * Builds lib/data/ncPlaces.json, the North Carolina cities, towns, villages,
 * census-designated places and ZIP Code Tabulation Areas behind
 * GET /api/locations/search (B05 Task 8), from U.S. Census Bureau files that
 * were downloaded by hand and reviewed first.
 *
 *   node scripts/build-nc-places.mjs \
 *     --places <2026_gaz_place_37.txt> \
 *     --zctas <2026_Gaz_zcta_national.txt, unzipped> \
 *     --zctaZip <2026_Gaz_zcta_national.zip> \
 *     --relationship <tab20_zcta520_county20_natl.txt> \
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
 * (lib/geoContainment.js); the build stops if that leaves any name ambiguous.
 *
 * NO EM DASH. A U+2014 in a source name is replaced here, at build time, by a
 * comma and a space, the same transformation the client's safeText applies,
 * and the build stops if one survives. The 2026 file has none.
 *
 * ZCTAS. A ZCTA is in North Carolina when the 2020 ZCTA to county relationship
 * file gives it a part with land area inside an NC county (GEOID 37xxx). A
 * ZCTA that crosses the state line is included, because some of it is in NC.
 * Each must also be in the 2026 ZCTA Gazetteer, or the build stops.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { countyForPoint } from '../lib/geoContainment.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, at, all) => (at % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), all[at + 1]]] : pairs), []),
);
for (const name of ['places', 'zctas', 'zctaZip', 'relationship', 'retrieved', 'out']) {
  if (!args[name]) throw new Error(`--${name} is required`);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.retrieved)) throw new Error('--retrieved is a YYYY-MM-DD date');

const SOURCES = {
  places: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_gaz_place_37.txt',
  zctas: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_zcta_national.zip',
  relationship: 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt',
};
const EM_DASH = String.fromCharCode(0x2014);
const DESCRIPTOR = { 25: 'city', 43: 'town', 47: 'village', 57: 'CDP' };

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Pipe-delimited rows as objects keyed by the header, every value trimmed. */
function table(file) {
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
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
  return { geoid: row.GEOID, name, lat: Number(row.INTPTLAT), lng: Number(row.INTPTLONG) };
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
    place.name = `${name} (${county})`;
    disambiguated.push(`${place.geoid} ${place.name}`);
  }
}
if (new Set(places.map((p) => p.name)).size !== places.length) throw new Error('a display name is still shared');
places.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// ----------------------------------------------------------------- ZCTAs

const gazetteer = new Set(table(args.zctas).map((row) => row.GEOID));
const zctas = new Set();
for (const row of table(args.relationship)) {
  if (!row.GEOID_ZCTA5_20 || !/^37\d{3}$/.test(row.GEOID_COUNTY_20) || !(Number(row.AREALAND_PART) > 0)) continue;
  if (!/^\d{5}$/.test(row.GEOID_ZCTA5_20)) throw new Error(`a malformed ZCTA: ${row.GEOID_ZCTA5_20}`);
  if (!gazetteer.has(row.GEOID_ZCTA5_20)) throw new Error(`${row.GEOID_ZCTA5_20} is not in the 2026 ZCTA Gazetteer`);
  zctas.add(row.GEOID_ZCTA5_20);
}

// ---------------------------------------------------------------- output

const header = {
  source: 'U.S. Census Bureau: 2026 Gazetteer Files (North Carolina places, and national ZIP Code Tabulation Areas), with the 2020 ZCTA to county relationship file to select the NC ZCTAs',
  vintage: 'Places: 2026 Gazetteer, boundaries as of January 1, 2026 (the vintage of TIGERweb Current, from which ncCounties.json was taken). ZCTAs: the 2020 Census ZCTA5 set, which the 2026 Gazetteer still carries',
  retrieved: args.retrieved,
  licence: 'Public domain: a work of the U.S. federal government, not subject to copyright in the United States (17 U.S.C. 105). The Census Bureau states its data is "freely available for use and re-use by the public" (https://www.census.gov/open/) and that its TIGER/Line products "are not copyrighted" and are "free to use in a product or publication, however acknowledgement must be given to the U.S. Census Bureau as the source" (TIGER/Line 2026 place metadata, Use Constraints). Credit: U.S. Census Bureau',
  files: Object.entries(SOURCES).map(([key, url]) => ({ url, sha256: sha256(args[key]), ...(key === 'zctas' ? { sha256: sha256(args.zctaZip), unzippedSha256: sha256(args.zctas) } : {}) })),
  nameRule: 'Census NAME less its trailing LSAD descriptor (city, town, village or CDP), spelled as the Census writes it. Two places that would share a name each carry their county in parentheses. A U+2014 is replaced by ", " at build time (none in this vintage). Built by scripts/build-nc-places.mjs',
  zctaRule: 'Every ZCTA with land area in an NC county in the 2020 ZCTA to county relationship file, cross-state ZCTAs included',
  disambiguated,
};

const lines = [
  '{',
  ...Object.entries(header).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
  '  "places": [',
  places.map(({ geoid, name }) => `    ${JSON.stringify({ geoid, name })}`).join(',\n'),
  '  ],',
  '  "zctas": [',
  [...zctas].sort().map((zcta) => `    ${JSON.stringify({ zcta })}`).join(',\n'),
  '  ]',
  '}',
  '',
];
writeFileSync(args.out, lines.join('\n'));
console.log(`${places.length} places (${disambiguated.length} disambiguated), ${zctas.size} ZCTAs written to ${args.out}`);
