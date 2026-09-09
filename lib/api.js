/**
 * HALO API Helper Module
 * Owns all fetch calls to Vibhav's backend routes (/api/*).
 *
 * Every route derives the caller's identity from their session token, so these
 * helpers go through authedFetch, which attaches it and opens an anonymous
 * session first if the device does not have one yet. A plain fetch() here would
 * come back 401.
 */

import { authedFetch } from './auth';

/**
 * Submits an address to geocode and retrieve location/utility metadata.
 * NOTE: The backend geocodes via Mapbox and discards the raw address string.
 *
 * @param {string} address - User's full street address or zip code
 * The old profileId argument is gone: the backend takes the profile id from the
 * verified session token, and sending a different one is rejected as
 * impersonation. Existing three-argument calls keep working -- JavaScript
 * ignores the extra argument.
 *
 * @returns {Promise<Object>} Returns { profile_id, lat, lng, zip, county, pwsid }
 */
export async function submitOnboard(address) {
  try {
    const response = await authedFetch('/api/onboard', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ address }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Onboarding failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[API] submitOnboard error:', error.message);
    throw error;
  }
}

/**
 * Fetches daily environmental metrics (Air Quality, UV, Pollen, Mold proxy).
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>} Returns { score, air, uv, pollen, mold, ... }
 */
export async function getDailyScore(lat, lng) {
  try {
    const queryParams = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });

    const response = await authedFetch(`/api/daily-score?${queryParams.toString()}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Daily score fetch failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[API] getDailyScore error:', error.message);
    throw error;
  }
}

/**
 * Fetches the HomeGuard payload: radon zone plus either measured utility water
 * data or, for private wells and springs, a testing plan.
 *
 * @param {Object} params
 * @param {string} params.county - Required. NC county name, e.g. "Union County"
 * @param {string} [params.pwsid] - Public water system id from onboarding
 * @param {string} [params.waterSource] - 'utility' | 'well' | 'spring' | 'other'
 * @param {number} [params.homeYear] - Year the home was built
 * @returns {Promise<Object>} Returns { score, breakdown, radon, water }
 */
export async function getHomeGuard({ county, pwsid, waterSource, homeYear } = {}) {
  try {
    if (!county) throw new Error('county is required');

    const queryParams = new URLSearchParams({ county });
    if (pwsid) queryParams.set('pwsid', pwsid);
    if (waterSource) queryParams.set('water_source', waterSource);
    if (homeYear !== undefined && homeYear !== null) {
      queryParams.set('home_year', String(homeYear));
    }

    const response = await authedFetch(`/api/home-guard?${queryParams.toString()}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HomeGuard fetch failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[API] getHomeGuard error:', error.message);
    throw error;
  }
}
