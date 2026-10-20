/**
 * B18 the participation directory (docs/backend/plans/b18-participation-directory.md,
 * Rulings P1 to P11): query parsing, the area's served ids, the answers of
 * `organizations.search`, `opportunities.search` and `opportunities.detail`.
 *
 * HALO WRITES NO LISTING. The rows are public reference data a person writes
 * by hand in the SQL editor (migration 0032, YOUR_TODO.md 2.23), and the SQL
 * read functions serve only rows that person verified, still fresh, and, for
 * a search, listed and not yet started. Nothing here inserts, invents or
 * fills in a field: a row the client's own validator would refuse is
 * withheld and the answer says `partial`, never a repaired copy.
 *
 * No household data is read: the answer depends only on the area id the
 * client sends, so two households asking the same question get the same
 * answer. No geocoder, no distance, no network.
 */
import { createHash } from 'node:crypto';
import { apiError, ERROR_CODES } from './apiErrors.js';
import { allPlaces, placeById, placePoint } from './places.js';
import { countyForPoint } from './geoContainment.js';

/** The four interests the screens offer (ExploreOpportunities.tsx:63, explore-local-resources.ts:4). */
export const INTERESTS = Object.freeze(['Cleanup', 'Trees & habitat', 'Gardening', 'Community learning']);
export const ALL_INTERESTS = 'All interests';
/** The "When?" select (ExploreOpportunities.tsx:63). */
export const TIMINGS = Object.freeze(['all', 'upcoming', 'rolling']);
/** Ruling P5: listings for the whole state carry this id. */
export const STATEWIDE = 'us-state:NC';
/** Ruling P9. */
export const PAGE_SIZE = 20;
export const SEARCH_MAX = 160;
/** What one SQL read returns at most (0032 section 5); reaching it is `partial`. */
export const READ_LIMIT = 1000;
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const MESSAGES = Object.freeze({
  unavailable: 'Local listings are not available yet. Use the organizers’ official sites.',
  notFound: 'This listing is not in HALO’s directory. Use the organizer’s official site.',
  interest: 'Choose an interest from the list.',
  timing: 'Choose upcoming, rolling or both.',
  search: `Search with up to ${SEARCH_MAX} characters.`,
  area: 'Choose an area from the list.',
  cursor: 'Those listings changed. Go back to the first listings.',
  id: 'Choose a listing from the list.',
});

/** Flag off or 0032 missing: the non-retryable 503 (Ruling P1). */
export const readUnavailable = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: MESSAGES.unavailable, retryable: false, requestId });
export const notFound = (requestId) =>
  apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: MESSAGES.notFound, retryable: false, requestId });

/** "Not there yet": a 0032 function (PostgREST, Postgres), then a table. */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);
export const isParticipationUnavailable = (error) => !!error && UNAVAILABLE_CODES.has(error.code);

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const fieldError = (field, code, message) => ({ field, code, message });
const EM_DASH = String.fromCharCode(0x2014);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

// ---------------------------------------------------------------- the area

const COUNTY_IDS = new Map(allPlaces().filter((place) => place.id.startsWith('us-county:')).map((place) => [place.place, place.id]));

/**
 * The served ids an area matches (Ruling P5): its own id, the id of the
 * county containing its Census internal point, and the statewide id. Never
 * a neighbouring area, a radius or a distance. [] for no area.
 */
export function placeIdsFor(place) {
  if (!place) return [];
  const ids = [place.id];
  if (!place.id.startsWith('us-county:')) {
    const point = placePoint(place.id);
    const county = point ? COUNTY_IDS.get(countyForPoint(point.lat, point.lng)) : null;
    if (county) ids.push(county);
  }
  ids.push(STATEWIDE);
  return ids;
}

/** The client's `area` query value (runtime.ts:111-115) as the gazetteer's own copy, or null. Only `id` is read. */
function parseArea(raw) {
  if (raw === null) return { ok: true, place: null };
  if (raw.length > 2000) return { ok: false };
  let value;
  try { value = JSON.parse(raw); } catch { return { ok: false }; }
  if (!isObject(value)) return { ok: false };
  if (value.id === undefined || value.id === '') return { ok: true, place: null };
  if (typeof value.id !== 'string' || value.id.length > 80) return { ok: false };
  return { ok: true, place: placeById(value.id) };
}

// --------------------------------------------------------------- the query

const digest = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

export function encodeCursor(offset, key) {
  return Buffer.from(JSON.stringify({ v: 1, o: offset, q: key })).toString('base64url');
}
function decodeCursor(raw, key) {
  if (raw.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let value;
  try { value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { return null; }
  if (!isObject(value) || value.v !== 1 || value.q !== key || !Number.isSafeInteger(value.o) || value.o < PAGE_SIZE || value.o % PAGE_SIZE) return null;
  return value.o;
}

/**
 * GET `?area=<json>&interest=&search=&timing=&cursor=` (Ruling P9). `timing`
 * only when `withTiming` (organizations take none, ExploreDiscovery.tsx:74).
 * Unknown keys are ignored and never echoed.
 */
export function parseSearchQuery(searchParams, { withTiming }) {
  const errors = [];
  const area = parseArea(searchParams.get('area'));
  if (!area.ok) errors.push(fieldError('area', 'invalid_area', MESSAGES.area));
  const interest = searchParams.get('interest') ?? ALL_INTERESTS;
  if (interest !== ALL_INTERESTS && !INTERESTS.includes(interest)) errors.push(fieldError('interest', 'invalid_interest', MESSAGES.interest));
  const search = searchParams.get('search') ?? '';
  if (search.length > SEARCH_MAX || CONTROL.test(search)) errors.push(fieldError('search', 'invalid_search', MESSAGES.search));
  const timing = withTiming ? searchParams.get('timing') ?? 'all' : 'all';
  if (!TIMINGS.includes(timing)) errors.push(fieldError('timing', 'invalid_timing', MESSAGES.timing));
  if (errors.length) return { ok: false, fieldErrors: errors };
  // Bound to the route as well, so an opportunities cursor is refused by organizations.
  const key = digest([withTiming ? 'opportunities' : 'organizations', area.place?.id ?? null, interest, search.trim().toLocaleLowerCase('en'), timing]);
  const rawCursor = searchParams.get('cursor');
  let offset = 0;
  if (rawCursor !== null) {
    offset = decodeCursor(rawCursor, key);
    if (offset === null) return { ok: false, fieldErrors: [fieldError('cursor', 'invalid_cursor', MESSAGES.cursor)] };
  }
  return { ok: true, value: { place: area.place, interest, search, timing, offset, key } };
}

/** GET `?id=` for `opportunities.detail`. */
export function parseDetailQuery(searchParams) {
  const id = searchParams.get('id');
  if (typeof id !== 'string' || !ID.test(id)) return { ok: false, fieldErrors: [fieldError('id', 'invalid_id', MESSAGES.id)] };
  return { ok: true, value: { id } };
}

// ----------------------------------------------------- the client's checks

// The client's own rules (lib/frontend/production/explore-service.ts:9-11,
// :43-55, :62-65), so a stored row they would refuse is withheld rather than
// sent. test/routesParticipationDb.test.mjs runs the real validators over
// every answer; the SQL checks in 0032 make a refusal here a should-not-happen.
const text = (value, max = 10000) => typeof value === 'string' && value.length <= max && !CONTROL.test(value);
const strings = (value, max = 100) => Array.isArray(value) && value.length <= max && value.every((item) => text(item));
function safeUrl(value) {
  if (!text(value, 3000)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value) => typeof value === 'string' && DAY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const instant = (value) => (typeof value === 'string' && INSTANT.test(value) && validDay(value.slice(0, 10)) ? Date.parse(value) : NaN);
function validZone(value) {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return Boolean(value); } catch { return false; }
}
const OPPORTUNITY_TEXT = ['id', 'organizer', 'title', 'interest', 'area', 'venue', 'timeLabel', 'checkedAt', 'summary', 'duration', 'cost', 'age', 'access', 'bring', 'join', 'safety'];
const ORGANIZATION_TEXT = ['id', 'title', 'organizer', 'area', 'mission', 'work', 'sourceTitle', 'effort', 'age', 'cost', 'access', 'bring', 'followup', 'checkedAt'];

/** True when the client's validOpportunity would accept this item and it carries no em dash. */
export function opportunityShapeOk(item) {
  if (!isObject(item) || !OPPORTUNITY_TEXT.every((key) => text(item[key]) && item[key].trim())) return false;
  if (!INTERESTS.includes(item.interest) || !['tree', 'cleanup', 'garden'].includes(item.artwork) || !['scheduled', 'rolling'].includes(item.kind)) return false;
  if (!['listed', 'cancelled', 'full', 'postponed'].includes(item.status) || !safeUrl(item.url) || !strings(item.work) || !item.work.length || !strings(item.scopes)) return false;
  if (item.kind === 'scheduled' && !(instant(item.endsAt) > instant(item.startsAt))) return false;
  if (item.kind === 'rolling' && (item.startsAt !== undefined || item.endsAt !== undefined || item.venueLocalDate !== undefined)) return false;
  if (item.venueLocalDate !== undefined && !validDay(item.venueLocalDate)) return false;
  if (item.venueTimezone !== undefined && !(text(item.venueTimezone, 100) && validZone(item.venueTimezone))) return false;
  if (item.venueTimezoneBasis !== undefined && !(['source', 'inferred'].includes(item.venueTimezoneBasis) && item.venueTimezone)) return false;
  if (item.address !== undefined && !text(item.address)) return false;
  return validDay(item.checkedAt) && !JSON.stringify(item).includes(EM_DASH);
}

/** True when the client's validOrganizations would accept this item and it carries no em dash. */
export function organizationShapeOk(item) {
  if (!isObject(item) || !ORGANIZATION_TEXT.every((key) => text(item[key]) && item[key].trim())) return false;
  if (!INTERESTS.includes(item.interest) || !strings(item.scopes) || !safeUrl(item.url)) return false;
  if (!['address', 'addressRole', 'contact'].every((key) => item[key] === undefined || text(item[key]))) return false;
  if (!Array.isArray(item.steps) || !item.steps.length || item.steps.length > 30 || !item.steps.every((step) => isObject(step) && text(step.title) && text(step.text))) return false;
  if (item.extraSources !== undefined && !(Array.isArray(item.extraSources) && item.extraSources.length <= 20 && item.extraSources.every((source) => isObject(source) && text(source.title) && safeUrl(source.url)))) return false;
  return validDay(item.checkedAt) && !JSON.stringify(item).includes(EM_DASH);
}

// ------------------------------------------------------------ the answers

/** The fixtures' search (explore-opportunities.ts:86,94; explore-local-resources.ts:93,97). */
const termsOf = (search) => search.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
const matchesOpportunity = (item, { interest, search, timing }) =>
  (interest === ALL_INTERESTS || item.interest === interest)
  && (timing === 'all' || (timing === 'upcoming' ? item.kind === 'scheduled' : item.kind === 'rolling'))
  && termsOf(search).every((term) => `${item.title} ${item.organizer} ${item.area} ${item.summary}`.toLocaleLowerCase('en').includes(term));
const matchesOrganization = (item, { interest, search }) =>
  (interest === ALL_INTERESTS || item.interest === interest)
  && termsOf(search).every((term) => `${item.title} ${item.organizer} ${item.area} ${item.work}`.toLocaleLowerCase('en').includes(term));

function page(list, { offset, key }) {
  const items = list.slice(offset, offset + PAGE_SIZE);
  return { items, nextCursor: offset + PAGE_SIZE < list.length ? encodeCursor(offset + PAGE_SIZE, key) : null };
}

async function rpcList(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error(`participation: ${name} returned an unexpected shape`);
  return data;
}

/**
 * `opportunities.search` (Rulings P2, P3, P5 to P9). The SQL read is made even
 * without an area, so a missing 0032 is always the 503 and never an answer.
 */
export async function searchOpportunities(supabase, query, now = new Date()) {
  const rows = await rpcList(supabase, 'read_participation_opportunities', { p_place_ids: placeIdsFor(query.place), p_now: now.toISOString() });
  const coverage = rows.filter(opportunityShapeOk);
  const partial = coverage.length !== rows.length || rows.length >= READ_LIMIT;
  const matching = coverage.filter((item) => matchesOpportunity(item, query));
  const availability = partial ? 'partial' : !query.place || !coverage.length ? 'no_coverage' : matching.length ? 'ready' : 'empty';
  const checked = coverage.map((item) => item.checkedAt).sort();
  return {
    ...page(matching, query),
    areaLabel: query.place?.label ?? '',
    checkedAt: checked[0] ?? '',
    availability,
    complete: false,
  };
}

/** `organizations.search` (Rulings P2, P5, P7, P9, P10). */
export async function searchOrganizations(supabase, query, now = new Date()) {
  const rows = await rpcList(supabase, 'read_participation_profiles', { p_place_ids: placeIdsFor(query.place), p_now: now.toISOString() });
  const matching = rows.filter(organizationShapeOk).filter((item) => matchesOrganization(item, query));
  const { items, nextCursor } = page(matching, query);
  return { items, complete: false, nextCursor };
}

/** `opportunities.detail` (Ruling P4): the item, or null for unknown or unverified. Throws on a malformed row. */
export async function readOpportunity(supabase, id, now = new Date()) {
  const { data, error } = await supabase.rpc('read_participation_opportunity', { p_id: id, p_now: now.toISOString() });
  if (error) throw error;
  if (data === null || data === undefined) return null;
  if (!opportunityShapeOk(data)) throw new Error('participation: a stored opportunity failed the client shape');
  return data;
}
