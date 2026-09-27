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
 * @param {{ok:boolean, json?:object}|null} outcome  null = the request threw
 * @returns {{pwsid:string|null, status:'measured'|'outside_known_area'|'lookup_failed'}}
 */
export function serviceAreaFromArcgis(outcome) {
  if (!outcome || !outcome.ok || !outcome.json || outcome.json.error) {
    return { pwsid: null, status: 'lookup_failed' };
  }
  const f = outcome.json.features;
  if (Array.isArray(f) && f.length > 0 && typeof f[0]?.attributes?.PWSID === 'string') {
    return { pwsid: f[0].attributes.PWSID, status: 'measured' };
  }
  return { pwsid: null, status: 'outside_known_area' };
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
