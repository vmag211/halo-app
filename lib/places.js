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
 * A ZIP is a ZCTA, so a PO-box or unique ZIP with no ZCTA (27699, 28201) finds
 * nothing.
 *
 * ALIASES. "Mt" and "Mount", "St" and "Saint", and "Ft" and "Fort" are the
 * same word, on the query and the names alike, because the Census spells
 * Mount Airy, St. Pauls and Old Fort one way and people type the other. Each
 * pair is there because NC names need it: Mount (Mount Airy, Mount Gilead,
 * Mount Holly, Mount Olive, Mount Pleasant, Rocky Mount), St. (St. Helena,
 * St. James, St. Pauls, St. Stephens) and Fort (Old Fort).
 *
 * A TRAILING STATE. "Charlotte, NC", "Charlotte NC", "Charlotte N.C." and
 * "Raleigh, North Carolina" are Charlotte and Raleigh. When the whole query
 * names no NC area exactly, and its last word or words are a state (a postal
 * code, a dotted code or a state's name) after at least one other word, that
 * is the query's state. For North Carolina the words before it are searched;
 * any other state ("Columbia, SC", "Washington, PA") gives no candidates.
 * "Co" is never Colorado: it is the county word above. A name that is itself
 * a state's (Washington) is still that name, because nothing comes before it.
 * An exact NC name wins over the state reading ("Rocky Mt" is Rocky Mount, not
 * Rocky in Montana), but a query that ends in a state code is never a prefix
 * of a longer name ("Washington Pa" is not Washington Park, and "Chapel Hi"
 * finds nothing).
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
// Every other state (and DC by its code), as a query may end in it once its words are joined: the postal
// codes (less CO, which is the county word) and the names. A dotted code ("S.C.") is two
// one-letter words, joined like a name.
const OTHER_STATES = new Set([
  ...'al ak az ar ca ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy'.split(' '),
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'newhampshire', 'newjersey', 'newmexico', 'newyork', 'northdakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhodeisland', 'southcarolina', 'southdakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'westvirginia', 'wisconsin', 'wyoming',
]);
// The most words a state's name or dotted code takes ("North Carolina", "N.C.").
const STATE_WORDS_MAX = 2;
// One spelling for each pair, on the query and on the names. Every pair is needed by an NC name.
const ALIASES = new Map([['mt', 'mount'], ['saint', 'st'], ['ft', 'fort']]);

/** Lower-cased words of `text`; anything that is not a letter or digit separates them. */
const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** A list of words with each alias in its one spelling. */
const alias = (list) => list.map((word) => ALIASES.get(word) ?? word);
const terms = (text) => alias(words(text));

/**
 * The state named by the last one or two words of a query, after at least one other word,
 * as { nc, rest } (rest: the words before it), or null when the query does not end in one.
 */
function trailingState(list) {
  for (let size = Math.min(STATE_WORDS_MAX, list.length - 1); size >= 1; size -= 1) {
    const tail = list.slice(-size).join('');
    if (NC_STATES.has(tail)) return { nc: true, rest: list.slice(0, -size) };
    if (OTHER_STATES.has(tail)) return { nc: false, rest: list.slice(0, -size) };
  }
  return null;
}

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
    const key = countyKey(terms(county.name));
    return { key, keys: [key], place: candidate(`us-county:${county.geoid}`, county.name, `${county.name}, NC`) };
  })
  .sort(byKeyThenName);

// A disambiguated name, "Fairview (Union County)", is keyed by "Fairview" and by itself.
const PLACES = gazetteer.places
  .map(({ geoid, name }) => {
    const key = terms(name.replace(/ \([^)]*\)$/, '')).join('');
    const full = terms(name).join('');
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
/** The matches of one list of query words, aliases applied: { exact, all }, `all` in answer order. */
function search(list) {
  const digits = zipDigits(list);
  if (digits !== null) {
    // No county or place name has a digit, so a ZIP query matches ZCTAs only.
    if (digits.length > ZIP_LENGTH) return { exact: [], all: [] };
    const zcta = matches(ZCTAS, digits, ZIP_PREFIX_MIN);
    return { exact: zcta.exact, all: [...zcta.exact, ...zcta.prefix] };
  }
  // After a trailing "County" or "Co." word a place must match the whole query exactly
  // ("Fairview (Union County)"), never by prefix: "Yadkin Co" is not Yadkin College.
  const key = countyKey(list);
  const whole = list.join('');
  const county = matches(COUNTIES, key, PREFIX_MIN);
  const place = matches(PLACES, whole, key === whole ? PREFIX_MIN : Infinity);
  const exact = [...county.exact, ...place.exact];
  return { exact, all: [...exact, ...county.prefix, ...place.prefix] };
}

export function searchPlaces({ query, state = '' }) {
  if (typeof query !== 'string' || typeof state !== 'string') return [];
  if (state.trim() !== '' && !NC_STATES.has(words(state).join(''))) return [];
  const list = words(query);
  if (list.length === 0) return [];
  let found = search(alias(list));
  // The trailing state is read from the words as typed, so "Helena, MT" is Montana. Only an
  // exact NC name outranks it ("Rocky Mt").
  const named = found.exact.length === 0 ? trailingState(list) : null;
  if (named) found = named.nc ? search(alias(named.rest)) : { all: [] };
  return found.all.slice(0, MAX_CANDIDATES).map(({ place }) => copy(place));
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
