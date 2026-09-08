/**
 * HALO API Helper Module
 * Owns all fetch calls to the backend routes (/api/*): onboard, daily-score,
 * and home-guard. Every call funnels through requestJson() so each screen gets
 * the same error shape instead of reimplementing its own try/catch.
 */

/**
 * Shared fetch wrapper. Throws an Error carrying the backend's own `error`
 * string when there is one, so the UI can show a real message instead of a
 * status code.
 *
 * @param {string} label - Name used in the console log, e.g. 'submitOnboard'
 * @param {string} url - Route to call
 * @param {RequestInit} [options] - Passed straight to fetch
 * @returns {Promise<Object>} Parsed JSON body
 */
async function requestJson(label, url, options) {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `${label} failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[API] ${label} error:`, error.message);
    throw error;
  }
}

/**
 * The backend compares water_source against the lowercase strings 'well' and
 * 'spring'. The onboarding form offers "Well" / "Spring" / "City utility", so
 * without this the private-well path would never match.
 *
 * @param {string} waterSource
 * @returns {string|null} Lowercased source, or null if nothing was chosen
 */
function normalizeWaterSource(waterSource) {
  if (typeof waterSource !== 'string') return null;
  const trimmed = waterSource.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * The build-year input hands us a string, and an empty one would break an
 * integer column. Anything that isn't a real year becomes null so the backend
 * leaves the existing value alone.
 *
 * @param {string|number} homeYear
 * @returns {number|null}
 */
function normalizeHomeYear(homeYear) {
  if (homeYear === null || homeYear === undefined || homeYear === '') return null;
  const parsed = Number(homeYear);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Submits an address to geocode and retrieve location/utility metadata.
 * NOTE: The backend geocodes via Mapbox and discards the raw address string.
 *
 * water_source and home_year are optional here because geocoding does not need
 * them, but both feed HomeGuard later: water_source decides whether the user
 * gets a utility lookup or a private-well test plan, and home_year drives the
 * lead-plumbing check. Omitted values are left out of the body entirely so a
 * re-run never wipes answers the user already gave.
 *
 * @param {string} address - User's full street address or zip code
 * @param {string} profileId - User's Supabase auth UUID
 * @param {Object} [answers] - Optional onboarding answers
 * @param {string} [answers.waterSource] - e.g. "Well", "Spring", "City utility"
 * @param {string|number} [answers.homeYear] - Year the home was built
 * @returns {Promise<Object>} Returns { lat, lng, zip, county, pwsid,
 *   service_area_status, water_source, home_year }
 */
export async function submitOnboard(address, profileId, { waterSource, homeYear } = {}) {
  const body = { address, profile_id: profileId };

  const normalizedSource = normalizeWaterSource(waterSource);
  if (normalizedSource !== null) body.water_source = normalizedSource;

  const normalizedYear = normalizeHomeYear(homeYear);
  if (normalizedYear !== null) body.home_year = normalizedYear;

  return requestJson('submitOnboard', '/api/onboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Fetches daily environmental metrics (Air Quality, UV, Pollen, Mold proxy).
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} profileId - User's Supabase auth UUID
 * @returns {Promise<Object>} Returns { air: { aqi, status }, uv: { index, status },
 *   pollen: { tree, grass, weed, status }, mold: { risk, is_proxy }, cached }
 */
export async function getDailyScore(lat, lng, profileId) {
  const queryParams = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    profile_id: profileId,
  });

  return requestJson('getDailyScore', `/api/daily-score?${queryParams.toString()}`);
}

/**
 * Fetches the household risk profile: county radon zone plus either the
 * utility's UCMR5/PFAS record or, for wells and springs, a ranked test plan.
 *
 * Only county is required. A missing pwsid is an expected state, not an error —
 * the backend returns a no_pwsid_available status the UI must handle.
 *
 * @param {string} county - County name, e.g. "Wake County"
 * @param {Object} [options]
 * @param {string} [options.pwsid] - Public water system ID from onboarding
 * @param {string} [options.waterSource] - e.g. "Well", "Spring", "City utility"
 * @param {string|number} [options.homeYear] - Year the home was built
 * @returns {Promise<Object>} Returns { success, radon, water }
 */
export async function getHomeGuard(county, { pwsid, waterSource, homeYear } = {}) {
  const queryParams = new URLSearchParams({ county });

  if (pwsid) queryParams.set('pwsid', pwsid);

  const normalizedSource = normalizeWaterSource(waterSource);
  if (normalizedSource !== null) queryParams.set('water_source', normalizedSource);

  const normalizedYear = normalizeHomeYear(homeYear);
  if (normalizedYear !== null) queryParams.set('home_year', String(normalizedYear));

  return requestJson('getHomeGuard', `/api/home-guard?${queryParams.toString()}`);
}
