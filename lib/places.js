/**
 * The places a household can choose for Explore (B05 Ruling D4, widened by
 * Task 8): North Carolina's counties, its cities, towns, villages and
 * census-designated places, and its ZIP codes, and the query string of
 * GET /api/locations/search.
 *
 * Both gazetteers are public-domain U.S. Census Bureau files in the repo, so
 * no geocoder is called and no Mapbox window is spent (Vibhav, 2026-10-19, B05
 * Open question 2):
 *   lib/data/ncCounties.json  TIGERweb counties (also read by lib/geoContainment.js)
 *   lib/data/ncPlaces.json    2026 Gazetteer places and the 2020 ZCTAs with land
 *                             in NC, built by scripts/build-nc-places.mjs, whose
 *                             header records the source files, their sha256, the
 *                             licence and the display-name rule
 *
 * A candidate is exactly the frontend's DiscoveryPlace, one of:
 *   { id: 'us-county:<GEOID>', place: '<Name> County', state: 'NC',
 *     label: '<Name> County, NC', timezone: 'America/New_York' }
 *   { id: 'us-place:<GEOID>', place: '<Name>', state: 'NC',
 *     label: '<Name>, NC', timezone: 'America/New_York' }
 *   { id: 'us-zcta:<ZCTA5>', place: '<ZCTA5>', state: 'NC',
 *     label: 'ZIP <ZCTA5>, NC', timezone: 'America/New_York' }
 * `placeById` turns any of these ids back into its candidate, so a saved area
 * is stored as the server's own copy rather than what a client sent (Ruling D8).
 *
 * MATCHING. Case, whitespace and punctuation are ignored on the query and the
 * names alike. A county also matches without its trailing "County" or "Co."
 * word. A place matches its own name, and after a trailing "County" or "Co."
 * word only exactly, never by prefix: "Columbus County" finds the county and
 * not the town of Columbus, and "Yadkin Co" is not a prefix of Yadkin College,
 * while "Columbus" finds both the county and the town. A query
 * that is digits, optionally after a leading "ZIP" or "ZIP code", is a ZIP
 * code: five digits match one ZCTA exactly, three or four digits match the
 * ZCTAs they start, and any other length matches none (a ZIP+4 is not split).
 *
 * ORDER. Every exact match comes before every prefix match. Within each of the
 * two, counties come before places, each in name order, so "Wake" is Wake
 * County, then Wake Forest. A county is the area the chooser was first built
 * for, and the coarser one; a place that shares a county's name (Columbus,
 * Columbus County) still follows straight after it. ZCTAs are in numeric order.
 * A query of two or more characters (three digits for a ZIP) also matches by
 * prefix. At most MAX_CANDIDATES come back, because the frontend's validPlaces
 * refuses more than 20, and short queries such as "Ch" reach that cap.
 *
 * Two places that the Census names alike carry their county in parentheses
 * ("Fairview (Union County)"); each is found by its bare name and by its full
 * display name, so the chooser can search again for exactly what it saved.
 *
 * Pure module: no database, no network.
 */

import counties from './data/ncCounties.json' with { type: 'json' };
import gazetteer from './data/ncPlaces.json' with { type: 'json' };
import { parseText } from './validate.js';

export const MAX_CANDIDATES = 20;
const QUERY_MAX = 80;
const STATE_MAX = 40;
const PREFIX_MIN = 2;
const ZIP_PREFIX_MIN = 3;
const ZIP_LENGTH = 5;
const TIMEZONE = 'America/New_York';
// What a person may type for North Carolina, once case and punctuation are gone. A blank state
// also means North Carolina, but blank is decided before stripping, so "?" is not blank.
const NC_STATES = new Set(['nc', 'northcarolina']);

/** Lower-cased words of `text`; anything that is not a letter or digit separates them. */
const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The comparison key of a county query: its words joined, less a trailing "county" or "co". */
function countyKey(list) {
  const kept = list.length > 1 && (list.at(-1) === 'county' || list.at(-1) === 'co') ? list.slice(0, -1) : list;
  return kept.join('');
}

/** The digits of a ZIP query ("28208", "ZIP 28208", "zip code 282"), or null for any other query. */
function zipDigits(list) {
  let rest = list;
  if (rest[0] === 'zip') rest = rest[1] === 'code' ? rest.slice(2) : rest.slice(1);
  else if (rest[0] === 'zipcode') rest = rest.slice(1);
  const digits = rest.join('');
  return /^\d+$/.test(digits) ? digits : null;
}

const byKeyThenName = (a, b) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : a.place.place < b.place.place ? -1 : a.place.place > b.place.place ? 1 : 0;

const candidate = (id, place, label) => Object.freeze({ id, place, state: 'NC', label, timezone: TIMEZONE });

const COUNTIES = counties.counties
  .map((county) => {
    const key = countyKey(words(county.name));
    return { key, keys: [key], place: candidate(`us-county:${county.geoid}`, county.name, `${county.name}, NC`) };
  })
  .sort(byKeyThenName);

// A disambiguated name, "Fairview (Union County)", is keyed by "Fairview" and by itself.
const PLACES = gazetteer.places
  .map(({ geoid, name }) => {
    const key = words(name.replace(/ \([^)]*\)$/, '')).join('');
    const full = words(name).join('');
    return { key, keys: key === full ? [key] : [key, full], place: candidate(`us-place:${geoid}`, name, `${name}, NC`) };
  })
  .sort(byKeyThenName);

const ZCTAS = gazetteer.zctas
  .map(({ zcta }) => ({ key: zcta, keys: [zcta], place: candidate(`us-zcta:${zcta}`, zcta, `ZIP ${zcta}, NC`) }))
  .sort(byKeyThenName);

const BY_ID = new Map([...COUNTIES, ...PLACES, ...ZCTAS].map(({ place }) => [place.id, place]));

const copy = (place) => ({ ...place });

/** The exact and the prefix matches of `key` in one sorted list, each in list order. */
function matches(list, key, prefixMin) {
  const exact = [];
  const prefix = [];
  if (!key) return { exact, prefix };
  for (const entry of list) {
    if (entry.keys.includes(key)) exact.push(entry);
    else if (key.length >= prefixMin && entry.keys.some((k) => k.startsWith(key))) prefix.push(entry);
  }
  return { exact, prefix };
}

/**
 * @param {{ query: string, state?: string }} input an already validated query and state
 * @returns {{ id: string, place: string, state: string, label: string, timezone: string }[]}
 */
export function searchPlaces({ query, state = '' }) {
  if (typeof query !== 'string' || typeof state !== 'string') return [];
  if (state.trim() !== '' && !NC_STATES.has(words(state).join(''))) return [];
  const list = words(query);
  if (list.length === 0) return [];
  let found;
  const digits = zipDigits(list);
  if (digits !== null) {
    // No county or place name has a digit, so a ZIP query matches ZCTAs only.
    if (digits.length > ZIP_LENGTH) return [];
    const zcta = matches(ZCTAS, digits, ZIP_PREFIX_MIN);
    found = [...zcta.exact, ...zcta.prefix];
  } else {
    // After a trailing "County" or "Co." word a place must match the whole query exactly
    // ("Fairview (Union County)"), never by prefix: "Yadkin Co" is not Yadkin College.
    const key = countyKey(list);
    const whole = list.join('');
    const county = matches(COUNTIES, key, PREFIX_MIN);
    const place = matches(PLACES, whole, key === whole ? PREFIX_MIN : Infinity);
    found = [...county.exact, ...place.exact, ...county.prefix, ...place.prefix];
  }
  return found.slice(0, MAX_CANDIDATES).map(({ place }) => copy(place));
}

/**
 * The canonical candidate for an id such as 'us-county:37119',
 * 'us-place:3712000' or 'us-zcta:28208', or null for an id that is not
 * exactly one of the gazetteers'.
 */
export function placeById(id) {
  if (typeof id !== 'string') return null;
  const place = BY_ID.get(id);
  return place ? copy(place) : null;
}

/** Every candidate the gazetteers hold, in county, place, ZCTA order (for tests and audits). */
export function allPlaces() {
  return [...COUNTIES, ...PLACES, ...ZCTAS].map(({ place }) => copy(place));
}

/**
 * GET /api/locations/search?query=Wake&state=NC
 *   query  trimmed, 1 to 80 characters, no control characters (required)
 *   state  trimmed, 0 to 40 characters, no control characters; not given is ''
 * The limits are the frontend's own input limits.
 *
 * @param {URLSearchParams} searchParams
 * @returns {{ ok: true, value: { query: string, state: string } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseLocationQuery(searchParams) {
  const fieldErrors = [];
  const query = parseText(searchParams.get('query') ?? '', { maxLength: QUERY_MAX, required: true, rejectControl: true });
  if (!query.ok) fieldErrors.push({ field: 'query', code: query.code, message: query.message });
  const state = parseText(searchParams.get('state') ?? '', { maxLength: STATE_MAX, rejectControl: true });
  if (!state.ok) fieldErrors.push({ field: 'state', code: state.code, message: state.message });
  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { query: query.value, state: state.value } };
}
