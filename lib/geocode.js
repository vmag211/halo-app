/**
 * Onboarding helpers (punch list v3 items 5, 7, 8). Pure and unit-tested.
 */

/**
 * The parts of a Mapbox geocoding feature HALO keeps.
 * `state` is the two-letter code from the region's short_code ("US-NC" → "NC"),
 * so radon — whose zone map here covers North Carolina only — is looked up only
 * for NC addresses. County names alone are ambiguous (Union County exists in NC
 * and SC, among others).
 */
export function parseMapboxFeature(feature) {
  if (!feature || !Array.isArray(feature.center)) return null;
  const [lng, lat] = feature.center;
  let county = null;
  let state = null;
  let zip = null;
  for (const item of feature.context || []) {
    const id = String(item?.id || '');
    const text = String(item?.text || '');
    if (id.startsWith('postcode')) zip = text;
    if (id.startsWith('district') || text.toLowerCase().includes('county')) county = text;
    if (id.startsWith('region')) {
      const code = String(item?.short_code || '').toUpperCase();
      const m = /^US-([A-Z]{2})$/.exec(code);
      if (m) state = m[1];
    }
  }
  return { lat, lng, county, state, zip };
}

/** Bare ZIP codes are ambiguous worldwide (for example, 28025 is also in Spain). */
export function isUsZipCode(address) {
  return typeof address === 'string' && /^\d{5}(?:-\d{4})?$/.test(address.trim());
}

/** Device GPS arrives as "lng,lat" (OnboardingScreen's Use my location): a reverse lookup. */
export function isCoordinateQuery(address) {
  return typeof address === 'string' && /^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,2}(?:\.\d+)?\s*$/.test(address);
}

/**
 * Mapbox place types precise enough to stand for a home. Country, region (a whole state) and
 * district (a county) are too broad: their centre says nothing about the home's water system.
 */
const HOME_TYPES = ['address', 'poi', 'postcode', 'place', 'locality', 'neighborhood'];
const POINT_TYPES = ['address', 'poi'];

/**
 * Mapbox v5 `relevance` is the share of the query the result accounts for (0 to 1). Below this,
 * the geocoder has guessed from a fragment of what was typed ("not-a-real-place-qa" matching some
 * town on one word), and a guess must not become someone's home.
 */
export const MIN_RELEVANCE = 0.8;

/** Another result this close to the best one, somewhere else, makes the answer ambiguous. */
const AMBIGUITY_MARGIN = 0.05;

const typesOf = (feature) => (Array.isArray(feature?.place_type) ? feature.place_type.map(String) : []);
const isHomeLike = (feature) => typesOf(feature).some((type) => HOME_TYPES.includes(type));

/**
 * A short area-level name for a geocoded feature, for the person to check: town, state and ZIP
 * ("Concord, North Carolina 28027"). Never the street line: the address itself is not echoed
 * back or kept.
 */
export function areaLabel(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const parts = {};
  for (const item of Array.isArray(feature.context) ? feature.context : []) {
    const kind = String(item?.id || '').split('.')[0];
    const text = String(item?.text || '').trim();
    if (kind && text && !(kind in parts)) parts[kind] = text;
  }
  const types = typesOf(feature);
  const own = String(feature.text || '').trim();
  if (own) {
    for (const kind of ['postcode', 'place', 'locality', 'neighborhood']) if (types.includes(kind)) parts[kind] = own;
  }
  const town = parts.place ?? parts.locality ?? parts.district ?? null;
  const within = (types.includes('neighborhood') || types.includes('locality')) && own && own !== town ? own : null;
  const tail = [parts.region, parts.postcode].filter(Boolean).join(' ');
  const label = [within, town, tail].filter(Boolean).join(', ');
  return label || null;
}

/**
 * Which geocoder answer, if any, is the home. Replaces "take the first feature":
 *   - a "lng,lat" reverse lookup takes the first home-like feature (its relevance is always 1);
 *   - a bare US ZIP must come back as that same ZIP's postcode feature;
 *   - anything else needs a home-like feature with relevance of at least MIN_RELEVANCE.
 * The answer says how precise the place is (`address` for a street address or point, `area`
 * for a ZIP, town or neighbourhood, whose centre may not be the home) and whether another
 * equally good match elsewhere makes it ambiguous, so the person is shown what was found.
 * @returns {{ok:true, feature:object, label:string|null, precision:'address'|'area', ambiguous:boolean}
 *         | {ok:false, reason:'no_result'|'too_broad'|'low_confidence'|'zip_mismatch'}}
 */
export function chooseGeocodeFeature(features, address) {
  const list = Array.isArray(features) ? features.filter((f) => f && typeof f === 'object') : [];
  if (list.length === 0) return { ok: false, reason: 'no_result' };
  const chosen = (feature, ambiguous = false) => ({
    ok: true,
    feature,
    label: areaLabel(feature),
    precision: typesOf(feature).some((type) => POINT_TYPES.includes(type)) ? 'address' : 'area',
    ambiguous,
  });

  if (isCoordinateQuery(address)) {
    if (!coordinatesInRange(address)) return { ok: false, reason: 'no_result' };
    const feature = list.find(isHomeLike);
    return feature ? chosen(feature) : { ok: false, reason: 'too_broad' };
  }

  if (isUsZipCode(address)) {
    const zip = address.trim().slice(0, 5);
    const feature = list.find((f) => typesOf(f).includes('postcode') && String(f.text || '').trim() === zip);
    return feature ? chosen(feature) : { ok: false, reason: 'zip_mismatch' };
  }

  const confident = list.filter(
    (f) => isHomeLike(f) && typeof f.relevance === 'number' && Number.isFinite(f.relevance) && f.relevance >= MIN_RELEVANCE,
  );
  if (confident.length === 0) return { ok: false, reason: list.some(isHomeLike) ? 'low_confidence' : 'too_broad' };
  const [top, ...rest] = confident;
  const ambiguous = rest.some((f) => f.relevance >= top.relevance - AMBIGUITY_MARGIN && elsewhere(top, f));
  return chosen(top, ambiguous);
}

/** About 10 km: two results further apart than this are different places, whatever their names. */
const SAME_PLACE_DEGREES = 0.1;

/**
 * Whether two geocoder results are different places: another area label, another county (two
 * Franklins in North Carolina share a label), or centres far apart.
 */
function elsewhere(a, b) {
  if (areaLabel(a) !== areaLabel(b)) return true;
  const pa = parseMapboxFeature(a);
  const pb = parseMapboxFeature(b);
  if (!pa || !pb) return false;
  if (pa.county !== pb.county) return true;
  return Math.hypot(pa.lat - pb.lat, pa.lng - pb.lng) > SAME_PLACE_DEGREES;
}

/** A "lng,lat" query that is a real point on Earth (Mapbox rejects anything else with a 422). */
export function coordinatesInRange(address) {
  if (!isCoordinateQuery(address)) return false;
  const [lng, lat] = address.split(',').map((part) => Number(part.trim()));
  return Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

/**
 * Round to `places` decimals. 3 places ≈ 110 m of latitude — the "approximate
 * coordinates" the privacy statement promises, applied only AFTER the utility
 * lookup (which needs the precise point).
 */
export function roundCoord(value, places = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * The ArcGIS point-in-polygon outcome. A failed lookup must not be reported —
 * or stored — as "no utility here": the first is our problem, the second is a
 * finding (often a private well).
 *
 * Service-area boundaries overlap, so a point can sit inside several systems' polygons, in no
 * meaningful order. `pwsid` is the first, a suggestion for the area, never a confirmed supplier;
 * `candidates` lists every distinct system found so the answer can say there were several.
 * @param {{ok:boolean, json?:object}|null} outcome  null = the request threw
 * @returns {{pwsid:string|null, status:'measured'|'outside_known_area'|'lookup_failed', candidates:string[]}}
 */
export function serviceAreaFromArcgis(outcome) {
  if (!outcome || !outcome.ok || !outcome.json || outcome.json.error) {
    return { pwsid: null, status: 'lookup_failed', candidates: [] };
  }
  const f = Array.isArray(outcome.json.features) ? outcome.json.features : [];
  const candidates = [...new Set(f.map((item) => item?.attributes?.PWSID).filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))];
  if (candidates.length > 0) return { pwsid: candidates[0], status: 'measured', candidates };
  return { pwsid: null, status: 'outside_known_area', candidates: [] };
}

/**
 * Validate a home build year: an integer from 1700 to the current year, or
 * null / empty for "not sure". Nothing validated this before.
 * @returns {{ok:true, value:number|null} | {ok:false, error:string}}
 */
export function validateHomeYear(input, now = new Date()) {
  if (input === null || input === undefined || input === '') return { ok: true, value: null };
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  const max = now.getFullYear();
  if (!Number.isInteger(n) || n < 1700 || n > max) {
    return { ok: false, error: `Year built must be a whole year between 1700 and ${max}, or left blank.` };
  }
  return { ok: true, value: n };
}

/** Radon zones here are North Carolina's; unknown (legacy) state keeps the old lookup. */
export function radonAppliesTo(state) {
  return state === null || state === undefined || state === 'NC';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The client's id for one /api/onboard request, stored with the location so a
 * timed-out request can be confirmed later. Anything but a UUID is ignored
 * (null), never an error: older clients don't send one.
 */
export function parseRequestId(input) {
  return typeof input === 'string' && UUID.test(input) ? input.toLowerCase() : null;
}

/**
 * Whether a new (rounded) location is a different home from the stored one.
 * No stored location is not a move: there is no old home's data to discard.
 */
export function locationMoved(stored, next) {
  if (typeof stored?.lat !== 'number' || typeof stored?.lng !== 'number') return false;
  return stored.lat !== next.lat || stored.lng !== next.lng;
}
