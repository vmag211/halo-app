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
 * word. A place matches its own name. After a trailing "County" or "Co." word
 * the county comes first, and a place still matches the whole query, exactly
 * or by prefix, after it: "Columbus County" finds the county and not the town
 * of Columbus (no place starts "Columbus County"), "Yadkin Co" finds Yadkin
 * County and then Yadkin College, which it starts, and "Columbus" finds both
 * the county and the town. So "Spivey's Co", "Cape Co" and "Fairview (Union
 * Co" still find the places being typed. A last word that is
 * the start of "County" ("Wake C", "Wake Cou") is read both ways: the county
 * of the words before it, then the places the whole query starts. A query
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
 * St. James, St. Pauls, St. Stephens) and Fort (Old Fort). An alias typed in
 * its other spelling is a whole word, so a name must have a word break after
 * it: "Saint" is the four St. names, never Stanly or Statesville, while "St",
 * the Census spelling, still starts every name that begins "St". A last word
 * that starts "Saint" ("Sai", "Sain") and finds nothing is read as "Saint".
 *
 * A TRAILING STATE. "Charlotte, NC", "Charlotte NC", "Charlotte N.C." and
 * "Raleigh, North Carolina" are Charlotte and Raleigh. When the whole query
 * names no NC area exactly and ends, after at least one other word, in a North
 * Carolina form (NC, N.C. or North Carolina, with or without a comma before
 * it), the words before it are searched. Any other state counts only when a
 * comma sets it off ("Raleigh, VA", "Charlotte, Hawaii"), and gives no
 * candidates. Without a comma the last word stays part of the name, so a word
 * being typed still matches by prefix: "Chapel Hi" is Chapel Hill, not Hawaii,
 * and "Washington Pa" is Washington Park. "Co" is never Colorado: it is the
 * county word above. A name that is itself a state's (Washington) is still
 * that name, because nothing comes before it. An exact NC name wins over the
 * state reading. While a state is being typed, a query that finds nothing and
 * ends in the start of an NC form ("Charlotte, N", "Charlotte North",
 * "Raleigh, North Car") is read as North Carolina. A last comma followed by
 * "USA" or "US" (or its start, "U") is dropped when the query finds nothing
 * with it, so "Charlotte, North Carolina, USA" is Charlotte.
 *
 * POINTS (B10 Task 1). `placePoint(id)` is the Census internal point of a
 * county, place or ZCTA, rounded to 3 decimals in the build, or null. A
 * candidate never carries it: candidates keep exactly their five fields.
 *
 * EXACT (B10 Task 1). `exactPlaces(text)` is what one segment of text names
 * exactly, by the rules above and never by prefix, with the kinds kept apart
 * and in the order the forecast prefers them: ZCTAs (five digits, or "ZIP"
 * and five digits), then places, then counties. Nothing here reads a state, a
 * country or a word still being typed; the caller decides which kind wins and
 * whether more than one is ambiguous.
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
// Every other state (and DC by its code), as it may follow a query's last comma once its words
// are joined: the postal codes (less CO, which is the county word) and the names. A dotted
// code ("S.C.") is two one-letter words, joined like a name.
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
// The NC forms once their words are joined, for a state still being typed ("north car").
const NC_FORMS = ['nc', 'northcarolina'];
// What may follow a query's last comma to name the country, joined: "USA", "U.S.", "US".
const COUNTRY = 'usa';
// One spelling for each pair, on the query and on the names. Every pair is needed by an NC name.
const ALIASES = new Map([['mt', 'mount'], ['saint', 'st'], ['ft', 'fort']]);

/**
 * Lower-cased words of `text`; anything that is not a letter or digit separates them. Exported so
 * the forecast's place reading (lib/forecast/place.js) uses this module's own normalisation.
 */
export const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** A list of words with each alias in its one spelling. */
const alias = (list) => list.map((word) => ALIASES.get(word) ?? word);
const terms = (text) => alias(words(text));

/**
 * A query's words with each alias in its one spelling, and `bounds`: where, in the joined words,
 * each alias typed in its other spelling ends. A name must have a word break at each of them.
 */
function read(list) {
  const bounds = [];
  let at = 0;
  const out = list.map((word) => {
    const one = ALIASES.get(word) ?? word;
    at += one.length;
    if (one !== word) bounds.push(at);
    return one;
  });
  return { list: out, bounds };
}

/** A name's comparison key: its words joined, and the position after each word. */
function keyOf(list) {
  const bounds = new Set();
  let at = 0;
  for (const word of list) bounds.add((at += word.length));
  return { text: list.join(''), bounds };
}

/**
 * The state a query ends in, after at least one other word, as { nc, rest } (rest: the words
 * before it), or null when it ends in none. A North Carolina form counts with or without a
 * comma ("Charlotte NC", "Charlotte, NC"; words() drops the comma). Another state counts only
 * as everything after the last comma ("Raleigh, VA"), so a word being typed ("Chapel Hi",
 * "Washington Pa") stays part of the name.
 */
function trailingState(query) {
  const comma = query.lastIndexOf(',');
  if (comma >= 0) {
    const rest = words(query.slice(0, comma));
    if (rest.length > 0 && OTHER_STATES.has(words(query.slice(comma + 1)).join(''))) return { nc: false, rest };
  }
  const list = words(query);
  for (let size = Math.min(STATE_WORDS_MAX, list.length - 1); size >= 1; size -= 1) {
    if (NC_STATES.has(list.slice(-size).join(''))) return { nc: true, rest: list.slice(0, -size) };
  }
  return null;
}

/**
 * The words that end in the start of an NC form still being typed ("Charlotte, N", "Raleigh North
 * Car"), less that start, or null. Something must come before it.
 */
function typingNc(list) {
  for (let size = Math.min(STATE_WORDS_MAX, list.length - 1); size >= 1; size -= 1) {
    const tail = list.slice(-size).join('');
    if (NC_FORMS.some((form) => form !== tail && form.startsWith(tail))) return list.slice(0, -size);
  }
  return null;
}

/** The words with a last word that starts an alias's other spelling ("sai") spelled out, or null. */
function typingAlias(list) {
  const last = list.at(-1);
  if (last.length < PREFIX_MIN) return null;
  for (const spelling of ALIASES.keys()) {
    if (spelling !== last && spelling.startsWith(last)) return [...list.slice(0, -1), spelling];
  }
  return null;
}

/** The query before its last comma when what follows names the country ("USA", "U.S."), or null. */
function beforeCountry(query) {
  const comma = query.lastIndexOf(',');
  if (comma < 0) return null;
  const tail = words(query.slice(comma + 1)).join('');
  return tail !== '' && COUNTRY.startsWith(tail) && words(query.slice(0, comma)).length > 0 ? query.slice(0, comma) : null;
}

const isCountyWord = (word) => word === 'county' || word === 'co';
/** The start of "county" being typed ("c", "cou", "count"), other than "co", the word itself. */
const isCountyStart = (word) => !isCountyWord(word) && 'county'.startsWith(word);

/** The words of a county query, less a trailing "county" or "co". */
const countyWords = (list) => (list.length > 1 && isCountyWord(list.at(-1)) ? list.slice(0, -1) : list);
/** The comparison key of a county query: its words joined, less a trailing "county" or "co". */
const countyKey = (list) => countyWords(list).join('');

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
    const key = keyOf(countyWords(terms(county.name)));
    return { key: key.text, keys: [key], place: candidate(`us-county:${county.geoid}`, county.name, `${county.name}, NC`) };
  })
  .sort(byKeyThenName);

// A disambiguated name, "Fairview (Union County)", is keyed by "Fairview" and by itself.
const PLACES = gazetteer.places
  .map(({ geoid, name }) => {
    const key = keyOf(terms(name.replace(/ \([^)]*\)$/, '')));
    const full = keyOf(terms(name));
    return { key: key.text, keys: key.text === full.text ? [key] : [key, full], place: candidate(`us-place:${geoid}`, name, `${name}, NC`) };
  })
  .sort(byKeyThenName);

const ZCTAS = gazetteer.zctas
  .map(({ zcta }) => ({ key: zcta, keys: [keyOf([zcta])], place: candidate(`us-zcta:${zcta}`, zcta, `ZIP ${zcta}, NC`) }))
  .sort(byKeyThenName);

const BY_ID = new Map([...COUNTIES, ...PLACES, ...ZCTAS].map(({ place }) => [place.id, place]));

// Each id's Census internal point, as the build wrote it (3 decimals). Frozen, and copied out.
const POINTS = new Map([
  ...gazetteer.counties.map(({ geoid, lat, lng }) => [`us-county:${geoid}`, Object.freeze({ lat, lng })]),
  ...gazetteer.places.map(({ geoid, lat, lng }) => [`us-place:${geoid}`, Object.freeze({ lat, lng })]),
  ...gazetteer.zctas.map(({ zcta, lat, lng }) => [`us-zcta:${zcta}`, Object.freeze({ lat, lng })]),
]);

const copy = (place) => ({ ...place });

/**
 * The exact and the prefix matches of `key` in one sorted list, each in list order. A key of the
 * entry matches only where it has a word break at every one of `bounds` (aliases typed as words).
 */
function matches(list, key, prefixMin, bounds = []) {
  const exact = [];
  const prefix = [];
  if (!key) return { exact, prefix };
  const fits = (k) => bounds.every((at) => k.bounds.has(at));
  for (const entry of list) {
    if (entry.keys.some((k) => k.text === key && fits(k))) exact.push(entry);
    else if (key.length >= prefixMin && entry.keys.some((k) => k.text.startsWith(key) && fits(k))) prefix.push(entry);
  }
  return { exact, prefix };
}

/** The matches of one read query (see read()): { exact, all }, `all` in answer order. */
function search({ list, bounds }) {
  const digits = zipDigits(list);
  if (digits !== null) {
    // No county or place name has a digit, so a ZIP query matches ZCTAs only.
    if (digits.length > ZIP_LENGTH) return { exact: [], all: [] };
    const zcta = matches(ZCTAS, digits, ZIP_PREFIX_MIN);
    return { exact: zcta.exact, all: [...zcta.exact, ...zcta.prefix] };
  }
  const whole = list.join('');
  const named = list.length > 1 && isCountyWord(list.at(-1));
  const typing = list.length > 1 && isCountyStart(list.at(-1));
  const county = matches(COUNTIES, named || typing ? list.slice(0, -1).join('') : whole, PREFIX_MIN, bounds);
  // A place always matches the whole query, exactly or by prefix, so the last word may be one
  // being typed ("Spivey's Co", "Wake Cou"). After a "County" or "Co." word that names a county
  // exactly, the county is an exact match and so leads, and a place the query starts follows it:
  // "Yadkin Co" is Yadkin County, then Yadkin College. "Columbus County" starts no place.
  const place = matches(PLACES, whole, PREFIX_MIN, bounds);
  // "County" being typed is not yet a county query, so its counties are not exact matches.
  const exact = typing ? place.exact : [...county.exact, ...place.exact];
  const prefix = typing ? [...county.exact, ...county.prefix, ...place.prefix] : [...county.prefix, ...place.prefix];
  return { exact, all: [...exact, ...prefix] };
}

/** The candidates of one query, in answer order (see the header). */
function lookup(query) {
  const list = words(query);
  if (list.length === 0) return [];
  const found = search(read(list));
  if (found.exact.length > 0) return found.all;
  // The trailing state is read from the query as typed, so "Helena, MT" is Montana. Only an
  // exact NC name outranks it ("Rocky Mt, NC" is still found after the state is read).
  const named = trailingState(query);
  if (named) return named.nc ? search(read(named.rest)).all : [];
  if (found.all.length > 0) return found.all;
  // Nothing at all: the query may end in the country, or in a state or alias still being typed.
  const country = beforeCountry(query);
  if (country !== null) return lookup(country);
  for (const reading of [typingNc(list), typingAlias(list)]) {
    const more = reading ? search(read(reading)).all : [];
    if (more.length > 0) return more;
  }
  return [];
}

/**
 * @param {{ query: string, state?: string }} input an already validated query and state
 * @returns {{ id: string, place: string, state: string, label: string, timezone: string }[]}
 */
export function searchPlaces({ query, state = '' }) {
  if (typeof query !== 'string' || typeof state !== 'string') return [];
  if (state.trim() !== '' && !NC_STATES.has(words(state).join(''))) return [];
  return lookup(query).slice(0, MAX_CANDIDATES).map(({ place }) => copy(place));
}

/**
 * What one segment of text names exactly (see EXACT in the header), each kind in name order:
 * { zctas, places, counties }, every entry a candidate of the five fields. Never by prefix.
 * "Columbus County" is the county only; "Columbus" is the town and the county.
 *
 * @param {string} text
 * @returns {{ zctas: object[], places: object[], counties: object[] }}
 */
export function exactPlaces(text) {
  const found = { zctas: [], places: [], counties: [] };
  if (typeof text !== 'string') return found;
  const { list, bounds } = read(words(text));
  if (list.length === 0) return found;
  const out = (entries) => entries.map(({ place }) => copy(place));
  const digits = zipDigits(list);
  if (digits !== null) {
    if (digits.length === ZIP_LENGTH) found.zctas = out(matches(ZCTAS, digits, Infinity).exact);
    return found;
  }
  found.places = out(matches(PLACES, list.join(''), Infinity, bounds).exact);
  found.counties = out(matches(COUNTIES, countyKey(list), Infinity, bounds).exact);
  return found;
}

/**
 * The Census internal point of a gazetteer id ('us-county:37119', 'us-place:3712000',
 * 'us-zcta:28208'), as { lat, lng } rounded to 3 decimals, or null for any other id.
 */
export function placePoint(id) {
  if (typeof id !== 'string') return null;
  const point = POINTS.get(id);
  return point ? { lat: point.lat, lng: point.lng } : null;
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
