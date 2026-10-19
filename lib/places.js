/**
 * North Carolina's counties as places a household can choose for Explore
 * (B05 Ruling D4), and the query string of GET /api/locations/search.
 *
 * The gazetteer is the public-domain Census Bureau TIGERweb county set already
 * in the repo (lib/data/ncCounties.json, also read by lib/geoContainment.js).
 * No geocoder is called: Mapbox storage rights are an open question (DS-016,
 * HO-074) and its one daily window belongs to onboarding. So a city or a ZIP
 * code finds nothing until that is decided (B05 Open question 2).
 *
 * A candidate is exactly the frontend's DiscoveryPlace:
 *   { id: 'us-county:<GEOID>', place: '<Name> County', state: 'NC',
 *     label: '<Name> County, NC', timezone: 'America/New_York' }
 * `placeById` turns an id back into that candidate, so a saved area can be
 * stored as the server's own copy rather than what a client sent (Ruling D8).
 *
 * Matching ignores case, whitespace and punctuation, and a trailing "County" or
 * "Co." word, on the query and on the county names alike. An exact name comes
 * first; a query of two or more characters also matches the start of a name, in
 * name order. At most MAX_CANDIDATES come back (the frontend's validPlaces
 * refuses more than 20). On this data no county name starts another and no two
 * letters start more than six, so neither the ordering of an exact match nor the
 * cap changes an answer today; both hold if the gazetteer grows.
 *
 * Pure module: no database, no network.
 */

import counties from './data/ncCounties.json' with { type: 'json' };
import { parseText } from './validate.js';

export const MAX_CANDIDATES = 20;
const QUERY_MAX = 80;
const STATE_MAX = 40;
const PREFIX_MIN = 2;
const TIMEZONE = 'America/New_York';
// What a person may type for North Carolina, once case and punctuation are gone. A blank state
// also means North Carolina, but blank is decided before stripping, so "?" is not blank.
const NC_STATES = new Set(['nc', 'northcarolina']);

/** Lower-cased words of `text`; anything that is not a letter or digit separates them. */
const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The comparison key of a county query: its words joined, less a trailing "county" or "co". */
function queryKey(text) {
  const list = words(text);
  if (list.length > 1 && (list.at(-1) === 'county' || list.at(-1) === 'co')) list.pop();
  return list.join('');
}

const PLACES = counties.counties
  .map((county) => ({
    key: queryKey(county.name),
    place: Object.freeze({
      id: `us-county:${county.geoid}`,
      place: county.name,
      state: 'NC',
      label: `${county.name}, NC`,
      timezone: TIMEZONE,
    }),
  }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const BY_ID = new Map(PLACES.map(({ place }) => [place.id, place]));

const copy = (place) => ({ ...place });

/**
 * @param {{ query: string, state?: string }} input an already validated query and state
 * @returns {{ id: string, place: string, state: string, label: string, timezone: string }[]}
 */
export function searchPlaces({ query, state = '' }) {
  if (typeof query !== 'string' || typeof state !== 'string') return [];
  if (state.trim() !== '' && !NC_STATES.has(words(state).join(''))) return [];
  const key = queryKey(query);
  if (!key) return [];
  // PLACES is sorted by key and a key sorts before every longer key it starts,
  // so an exact name always comes ahead of the names it is a prefix of.
  const prefix = key.length >= PREFIX_MIN;
  return PLACES.filter((entry) => entry.key === key || (prefix && entry.key.startsWith(key)))
    .slice(0, MAX_CANDIDATES)
    .map(({ place }) => copy(place));
}

/**
 * The canonical candidate for an id such as 'us-county:37119', or null for an
 * id that is not exactly one of the gazetteer's.
 */
export function placeById(id) {
  if (typeof id !== 'string') return null;
  const place = BY_ID.get(id);
  return place ? copy(place) : null;
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
