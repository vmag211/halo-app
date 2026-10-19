/**
 * What a forecast request's `place` names (B10 plan F1, Task 2), and the point
 * the providers are sent (F3). Pure: no database, no network, no clock, no
 * logging. A typed place resolves through the repo's own Census gazetteer
 * (lib/places.js: counties, places and ZCTAs), never Mapbox and never a
 * geocoder (Vibhav, 2026-10-19, decision 9, D-F1), so a keystroke costs one
 * table scan and nothing else.
 *
 * API (for Task 8):
 *
 *   resolveForecastPlace(text) -> one of
 *     { kind: 'home' }                       text is empty once trimmed
 *     { kind: 'matched', id, label, lat, lng, timezone }
 *                                            id and label are the gazetteer
 *                                            candidate's; lat and lng its Census
 *                                            internal point (3 decimals); timezone
 *                                            America/New_York, as every NC place
 *     { kind: 'unmatched', reason }          reason from UNMATCHED_REASONS
 *     { kind: 'ambiguous', labels }          1 < distinct matches; at most
 *                                            MAX_AMBIGUOUS_LABELS labels
 *     { kind: 'outside' }                    a segment names another US state
 *   roundForProvider({ lat, lng }) -> { lat, lng } to 2 decimals, or null
 *
 * READING (F1, in order). Exact matches only: never a prefix, never fuzzy.
 *   1. ZIP codes. Every standalone run of five digits (a ZIP+4 keeps its first
 *      five, so "28202-1234" is 28202) that is an NC ZCTA. One distinct ZCTA wins
 *      outright, whatever else the text says ("Charlotte, NC 27601" is ZIP 27601,
 *      and its label says so); two or more are ambiguous.
 *   2. Names. Otherwise the ZIP runs are taken out and the text is split on
 *      commas and semicolons. A segment after the first that names another US
 *      state, by postal code or full name (STATES below), makes the answer
 *      `outside` ("Greenville, SC", "Austin, Texas"). The first segment is never
 *      read as a state, so "Washington" is still Washington, NC. A segment that is
 *      North Carolina (NC, N.C., North Carolina) is dropped, and so is a trailing
 *      NC form inside a segment that finds nothing with it ("Charlotte NC").
 *      Each other segment is matched exactly by lib/places.js's `exactPlaces`,
 *      with that module's own normalisation, so "Columbus County" is never the
 *      town. Segments that find nothing are ignored once another finds something
 *      ("Freedom Park, Charlotte" is Charlotte).
 *   3. Of the distinct matches the most specific kind wins: a ZCTA, then a place,
 *      then a county ("Columbus" is the town). One left is `matched`; more than
 *      one is `ambiguous` ("Fairview", two places; "Durham, Chapel Hill").
 *   Nothing found is `unmatched`: "not a North Carolina ZIP code" when the text
 *   held five digits, else "not a North Carolina city, county or ZIP code".
 *
 * The typed text is never returned, so a caller cannot log or cache it by
 * accident; only the gazetteer's own id and label come back.
 */

import { exactPlaces, placePoint, words } from '../places.js';

/** Every North Carolina place is in one zone. */
export const NC_TIMEZONE = 'America/New_York';
export const MAX_AMBIGUOUS_LABELS = 5;
/** Why a place did not resolve. Plain text, no U+2014. */
export const UNMATCHED_REASONS = Object.freeze({
  zip: 'not a North Carolina ZIP code',
  name: 'not a North Carolina city, county or ZIP code',
});

/**
 * The 50 states, as [postal code, name]. A fixed table (F1): a segment that is one of these, other
 * than North Carolina, is outside the gazetteer. DC and the territories are not states and are
 * simply unmatched.
 */
export const STATES = Object.freeze([
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map((pair) => Object.freeze(pair)));

const NC_CODE = 'NC';
// A state's comparison key is its words joined, as lib/places.js compares names: "N.C." is "nc",
// "North Carolina" is "northcarolina".
const STATE_BY_KEY = new Map(STATES.flatMap(([code, name]) => [[code.toLowerCase(), code], [words(name).join(''), code]]));
// The most words an NC form takes ("north carolina"; "n c" from "N.C.").
const NC_WORDS_MAX = 2;

// Five digits standing alone, with an optional ZIP+4 tail; a letter or digit on either side means
// the run is part of something else ("123456", "NC28202").
const ZIP_RUN = /(?<![A-Za-z0-9])(\d{5})(?:-\d{4})?(?![A-Za-z0-9])/g;
const SEGMENT_SPLIT = /[,;]/;

const isNc = (list) => STATE_BY_KEY.get(list.join('')) === NC_CODE;
const isOtherState = (list) => {
  const code = STATE_BY_KEY.get(list.join(''));
  return code !== undefined && code !== NC_CODE;
};

/** A gazetteer candidate as a match, with its Census internal point, or null when it has none. */
function located(candidate) {
  const point = placePoint(candidate.id);
  return point ? { id: candidate.id, label: candidate.label, lat: point.lat, lng: point.lng } : null;
}

/** Adds the located candidates of `list` to `into` (id -> match); an id seen again keeps its place. */
function collect(into, list) {
  for (const candidate of list) {
    const match = located(candidate);
    if (match) into.set(candidate.id, match);
  }
}

/** One kind's distinct matches as an answer, or null when there are none. */
function answer(found) {
  if (found.size === 0) return null;
  const all = [...found.values()];
  if (all.length === 1) return { kind: 'matched', ...all[0], timezone: NC_TIMEZONE };
  return { kind: 'ambiguous', labels: all.slice(0, MAX_AMBIGUOUS_LABELS).map((match) => match.label) };
}

/** What one segment's words name exactly; a trailing NC form is dropped when the whole finds nothing. */
function segmentMatches(list) {
  const found = exactPlaces(list.join(' '));
  if (found.zctas.length + found.places.length + found.counties.length > 0) return found;
  for (let size = Math.min(NC_WORDS_MAX, list.length - 1); size >= 1; size -= 1) {
    if (isNc(list.slice(-size))) return exactPlaces(list.slice(0, -size).join(' '));
  }
  return found;
}

/** Step 2: the names in text with its ZIP runs already taken out. */
function resolveNames(text) {
  const segments = text.split(SEGMENT_SPLIT).map((segment) => words(segment)).filter((list) => list.length > 0);
  if (segments.slice(1).some(isOtherState)) return { kind: 'outside' };
  const zctas = new Map();
  const places = new Map();
  const counties = new Map();
  // A North Carolina segment ("NC") names no place, county or ZCTA, so it adds nothing here.
  for (const list of segments) {
    const found = segmentMatches(list);
    collect(zctas, found.zctas);
    collect(places, found.places);
    collect(counties, found.counties);
  }
  return answer(zctas) ?? answer(places) ?? answer(counties);
}

/**
 * @param {string} text the request's `place`, already length-checked by the route
 * @returns {{kind: 'home'} | {kind: 'matched', id: string, label: string, lat: number, lng: number, timezone: string}
 *   | {kind: 'unmatched', reason: string} | {kind: 'ambiguous', labels: string[]} | {kind: 'outside'}}
 */
export function resolveForecastPlace(text) {
  if (typeof text !== 'string') return { kind: 'unmatched', reason: UNMATCHED_REASONS.name };
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'home' };

  // 1. ZIP codes: one distinct NC ZCTA wins outright.
  const digits = new Set([...trimmed.matchAll(ZIP_RUN)].map((match) => match[1]));
  const zctas = new Map();
  for (const zip of digits) collect(zctas, exactPlaces(zip).zctas);
  const zip = answer(zctas);
  if (zip) return zip;

  // 2 and 3. Names, with the ZIP runs taken out.
  const named = resolveNames(trimmed.replace(ZIP_RUN, ' '));
  if (named) return named;
  return { kind: 'unmatched', reason: digits.size > 0 ? UNMATCHED_REASONS.zip : UNMATCHED_REASONS.name };
}

/** `value` to 2 decimals, half away from zero on its decimal digits; -0 is 0. */
function round2(value) {
  const size = Math.abs(value);
  // String(size) is plain decimal from 1e-6 up (a coordinate never reaches 1e21), so "e2" shifts
  // its decimal digits exactly: 35.205 is 3520.5, where 35.205 * 100 is 3520.4999999999995.
  const hundredths = size < 1e-6 ? 0 : Math.round(Number(`${size}e2`));
  const rounded = hundredths / 100;
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/**
 * The point sent to every provider and used in every cache key (F3): 2 decimals, about 1.1 km,
 * coarser than any stored point and never more precise than the input (35.2 stays 35.2).
 *
 * @param {{lat: number, lng: number}} point
 * @returns {{lat: number, lng: number} | null} null when either value is not a finite coordinate
 */
export function roundForProvider(point) {
  const lat = point?.lat;
  const lng = point?.lng;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { lat: round2(lat), lng: round2(lng) };
}
