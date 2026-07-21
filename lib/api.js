/**
 * HALO API Helper Module
 * Owns all fetch calls to Vibhav's backend routes (/api/*).
 */

/**
 * Submits an address to geocode and retrieve location/utility metadata.
 * NOTE: The backend geocodes via Mapbox and discards the raw address string.
 *
 * @param {string} address - User's full street address or zip code
 * @param {string} profileId - User's Supabase auth UUID
 * @returns {Promise<Object>} Returns { lat, lng, zip, county, pwsid }
 */
export async function submitOnboard(address, profileId) {
  try {
    const response = await fetch('/api/onboard', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        address, 
        profile_id: profileId 
      }),
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
 * @param {string} profileId - User's Supabase auth UUID
 * @returns {Promise<Object>} Returns { aqi, uv, pollen, mold_risk, cached }
 */
export async function getDailyScore(lat, lng, profileId) {
  try {
    const queryParams = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      profile_id: profileId,
    });

    const response = await fetch(`/api/daily-score?${queryParams.toString()}`);

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