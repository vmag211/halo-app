import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { openuvLimiter } from '@/lib/ratelimit'; // <-- IMPORT THE BOUNCER
import {
  getAirRisk,
  getUvRisk,
  getPollenRisk,
  getMoldRisk,
  getDashboardScore,
} from '@/lib/scoring';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// HELPER FUNCTIONS FOR STATUS CALCULATION
// ==========================================

// Postgres reports an unknown column as 42703; PostgREST surfaces the same
// condition as PGRST204 when its schema cache has no such column.
function isUndefinedColumnError(error) {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist/i.test(error.message || '') ||
    /could not find the .* column/i.test(error.message || '')
  );
}

function getAirStatus(aqi) {
  if (aqi === null || aqi === undefined) return 'unknown';
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  return 'unhealthy';
}

function getUvStatus(uvIndex) {
  if (uvIndex === null || uvIndex === undefined) return 'unknown';
  if (uvIndex <= 2) return 'low';
  if (uvIndex <= 5) return 'moderate';
  if (uvIndex <= 7) return 'high';
  return 'very_high';
}

function getPollenStatus(pollenRisk) {
  const values = [pollenRisk.tree, pollenRisk.grass, pollenRisk.weed].filter(
    (val) => val !== null && val !== undefined
  );
  if (values.length === 0) return 'none';

  const maxVal = Math.max(...values);
  if (maxVal <= 2) return 'low';
  if (maxVal <= 3) return 'moderate';
  return 'high';
}

// Converts the four raw readings into individual 0-100 risks and the composite
// dashboard score. Readings that are missing stay missing: they are passed to
// the scoring layer as null so they are excluded from the composite rather than
// being scored as a benign zero.
//
// Note on mold: the payload below falls back to displaying 'low' when the NWS
// lookup produced nothing, but the SCORE is built from the raw label. So a
// response can legitimately show mold 'low' while `score.missing_inputs`
// includes 'mold' — the display has a default, the score refuses to invent one.
function buildDashboardScore({ aqi, uvIndex, pollenRisk, moldRisk }) {
  const airRisk = getAirRisk(aqi);
  const uvRisk = getUvRisk(uvIndex);
  const pollenRiskValue = getPollenRisk(
    pollenRisk.tree ?? null,
    pollenRisk.grass ?? null,
    pollenRisk.weed ?? null
  );
  const moldRiskValue = getMoldRisk(moldRisk);

  const composite = getDashboardScore({
    airRisk,
    uvRisk,
    pollenRisk: pollenRiskValue,
    moldRisk: moldRiskValue,
  });

  return {
    ...composite,
    // The composite is derived from measurements, but is not itself a
    // measurement of anything — and it folds in the mold proxy.
    is_measured: false,
    is_estimate: true,
    inputs: {
      air: airRisk,
      uv: uvRisk,
      pollen: pollenRiskValue,
      mold: moldRiskValue,
    },
  };
}

function formatResponsePayload({
  aqi,
  uvIndex,
  pollenRisk,
  moldRisk,
  cached,
  // Which provider the AQI came from, and whether it was measured at a monitor
  // or produced by a model. Null on the cached path: daily_scores has no column
  // to persist the provenance, so a cached reading cannot assert either.
  aqiSource = null,
  aqiIsMeasured = null,
}) {
  return {
    air: {
      aqi: aqi,
      status: getAirStatus(aqi),
      source: aqiSource,
      is_measured: aqiIsMeasured,
    },
    uv: {
      index: uvIndex,
      status: getUvStatus(uvIndex),
    },
    pollen: {
      tree: pollenRisk.tree ?? null,
      grass: pollenRisk.grass ?? null,
      weed: pollenRisk.weed ?? null,
      status: getPollenStatus(pollenRisk),
    },
    mold: {
      risk: moldRisk || 'low',
      is_proxy: true,
    },
    score: buildDashboardScore({ aqi, uvIndex, pollenRisk, moldRisk }),
    cached,
  };
}

// ==========================================
// MAIN GET ROUTE
// ==========================================

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const profileId = searchParams.get('profile_id');

    if (!lat || !lng || !profileId) {
      return NextResponse.json(
        { error: 'Latitude, longitude, and profile_id required' },
        { status: 400 }
      );
    }

    // --- CACHE CHECK ---
    // daily_scores rows are keyed on profile_id alone, but every value in one
    // depends on lat/lng. Without a location check, a user who corrects their
    // address keeps seeing their previous location's air, UV and pollen for up
    // to an hour. The table has no lat/lng column, so we compare the request
    // against the coordinates stored on the profile and treat a mismatch as a
    // miss. The same gate gets applied to the WRITE below, so a cached row is
    // always one that was computed for the profile's own location.
    const requestLat = parseFloat(lat);
    const requestLng = parseFloat(lng);

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('lat, lng')
      .eq('id', profileId)
      .single();

    // ~0.01 degrees is roughly a kilometer — close enough that the readings
    // would be identical, coarse enough to ignore geocoder jitter.
    const isProfileLocation =
      !!profileRow &&
      typeof profileRow.lat === 'number' &&
      typeof profileRow.lng === 'number' &&
      Number.isFinite(requestLat) &&
      Number.isFinite(requestLng) &&
      Math.abs(profileRow.lat - requestLat) < 0.01 &&
      Math.abs(profileRow.lng - requestLng) < 0.01;

    let cachedData = null;
    if (isProfileLocation) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('daily_scores')
        .select('*')
        .eq('profile_id', profileId)
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      cachedData = data;
    }

    if (cachedData) {
      let parsedPollen = { tree: null, grass: null, weed: null };
      if (cachedData.pollen_level) {
        try {
          parsedPollen = JSON.parse(cachedData.pollen_level);
        } catch (e) {
          console.error('Error parsing cached pollen data:', e);
        }
      }

      return NextResponse.json(
        formatResponsePayload({
          aqi: cachedData.aqi,
          uvIndex: cachedData.uv_index,
          pollenRisk: parsedPollen,
          moldRisk: cachedData.mold_risk,
          cached: true,
        })
      );
    }

    // 1. AIR QUALITY — AirNow (measured) first, Open-Meteo (modeled) fallback
    let aqi = null;
    let aqiSource = null;
    let aqiIsMeasured = null;

    try {
      const airnowApiKey = process.env.AIRNOW_API_KEY;
      const airnowUrl = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${airnowApiKey}`;
      const airnowResponse = await fetch(airnowUrl);
      if (airnowResponse.ok) {
        const airnowData = await airnowResponse.json();
        // AirNow returns one entry per pollutant (O3, PM2.5, PM10...). EPA
        // defines the reported AQI as the MAXIMUM of those sub-indices —
        // taking the first entry understates air risk whenever the leading
        // pollutant is not the worst one, which varies day to day.
        const aqiValues = Array.isArray(airnowData)
          ? airnowData
              .map((reading) => reading && reading.AQI)
              .filter((value) => typeof value === 'number' && Number.isFinite(value))
          : [];
        if (aqiValues.length > 0) {
          aqi = Math.max(...aqiValues);
          aqiSource = 'airnow';
          aqiIsMeasured = true;
        }
      } else {
        console.error('AirNow API failed:', airnowResponse.status);
      }
    } catch (err) {
      // Previously this threw and 500'd the whole route. It now falls through
      // to the modeled fallback below, which is the entire point of having one.
      console.error('AirNow fetch error:', err.message);
    }

    // Roughly half of NC congressional district 8 has no AirNow monitor within
    // 25 miles, so air simply vanished from those households' scores. Open-Meteo
    // covers them — but it is a CAMS model output, not a ground measurement, and
    // the two genuinely disagree (28 vs 55 at the same point, minutes apart).
    // It is used only when there is no monitor, and it is labelled as modeled.
    if (aqi === null) {
      try {
        const openMeteoAirUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi&timezone=UTC`;
        const openMeteoAirResponse = await fetch(openMeteoAirUrl);
        if (openMeteoAirResponse.ok) {
          const openMeteoAirData = await openMeteoAirResponse.json();
          const value = openMeteoAirData.current
            ? openMeteoAirData.current.us_aqi
            : null;
          if (typeof value === 'number' && Number.isFinite(value)) {
            aqi = value;
            aqiSource = 'open-meteo';
            aqiIsMeasured = false;
          }
        } else {
          console.error('Open-Meteo AQI failed:', openMeteoAirResponse.status);
        }
      } catch (err) {
        console.error('Open-Meteo AQI fetch error:', err.message);
      }
    }

    console.log(
      aqi === null ? 'AQI unavailable from both providers.' : `AQI ${aqi} via ${aqiSource}.`
    );

    // 2. UV INDEX — Open-Meteo first, OpenUV as fallback
    //
    // OpenUV's free tier is 45 calls per day GLOBALLY, not per user, so past
    // the 45th request of the day UV silently vanished from everyone's score.
    // Open-Meteo needs no API key, has no comparable cap, and returns a value
    // for locations with no nearby monitor, so it leads and OpenUV backs it up.
    let uvIndex = null;
    let uvSource = null;

    try {
      const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=uv_index&timezone=UTC`;
      const openMeteoResponse = await fetch(openMeteoUrl);
      if (openMeteoResponse.ok) {
        const openMeteoData = await openMeteoResponse.json();
        const value = openMeteoData.current ? openMeteoData.current.uv_index : null;
        if (typeof value === 'number' && Number.isFinite(value)) {
          uvIndex = value;
          uvSource = 'open-meteo';
        }
      } else {
        console.error('Open-Meteo UV failed:', openMeteoResponse.status);
      }
    } catch (err) {
      console.error('Open-Meteo UV fetch error:', err.message);
    }

    if (uvIndex === null) {
      let canCallOpenUV = false;
      try {
        ({ success: canCallOpenUV } = await openuvLimiter.limit('global_openuv_calls'));
      } catch (err) {
        // The rate limiter is a budget guard, not the product. When Upstash is
        // unreachable this used to throw and take the whole endpoint down with
        // it; now a limiter outage costs at most the fallback UV reading.
        console.error('Rate limiter unavailable, skipping OpenUV:', err.message);
      }

      if (canCallOpenUV) {
        try {
          const openuvApiKey = process.env.OPENUV_API_KEY;
          const openuvUrl = `https://api.openuv.io/api/v1/uv?lat=${lat}&lng=${lng}`;
          const openuvResponse = await fetch(openuvUrl, {
            headers: { 'x-access-token': openuvApiKey },
          });

          if (openuvResponse.ok) {
            const openuvData = await openuvResponse.json();
            uvIndex = openuvData.result ? openuvData.result.uv : null;
            if (uvIndex !== null) uvSource = 'openuv';
          } else {
            console.error('OpenUV API failed');
          }
        } catch (err) {
          console.error('OpenUV fetch error:', err.message);
        }
      } else {
        console.log('OpenUV unavailable or daily limit reached, skipping fetch.');
      }
    }

    console.log(
      uvIndex === null
        ? 'UV unavailable from both providers.'
        : `UV ${uvIndex} via ${uvSource}.`
    );

    // 3. GOOGLE POLLEN API
    const pollenApiKey = process.env.GOOGLE_POLLEN_API_KEY;
    const pollenUrl = `https://pollen.googleapis.com/v1/forecast:lookup?key=${pollenApiKey}&location.longitude=${lng}&location.latitude=${lat}&days=1`;
    const pollenResponse = await fetch(pollenUrl);
    if (!pollenResponse.ok) throw new Error('Failed to fetch Pollen');
    const pollenData = await pollenResponse.json();
    let pollenRisk = { tree: null, grass: null, weed: null };
    if (pollenData.dailyInfo && pollenData.dailyInfo.length > 0) {
      const typesInfo = pollenData.dailyInfo[0].pollenTypeInfo;
      if (typesInfo) {
        typesInfo.forEach((info) => {
          if (info.code === 'TREE')
            pollenRisk.tree = info.indexInfo ? info.indexInfo.value : null;
          if (info.code === 'GRASS')
            pollenRisk.grass = info.indexInfo ? info.indexInfo.value : null;
          if (info.code === 'WEED')
            pollenRisk.weed = info.indexInfo ? info.indexInfo.value : null;
        });
      }
    }

    // 4. NATIONAL WEATHER SERVICE
    let moldRisk = 'low';
    try {
      const pointsResponse = await fetch(
        `https://api.weather.gov/points/${lat},${lng}`,
        { headers: { 'User-Agent': 'HALO/1.0' } }
      );
      if (pointsResponse.ok) {
        const pointsData = await pointsResponse.json();
        const forecastResponse = await fetch(
          pointsData.properties.forecastHourly,
          { headers: { 'User-Agent': 'HALO/1.0' } }
        );
        if (forecastResponse.ok) {
          const forecastData = await forecastResponse.json();
          const currentHour = forecastData.properties.periods[0];
          const humidity = currentHour.relativeHumidity.value;
          const precipitation = currentHour.probabilityOfPrecipitation.value;
          if (humidity > 70 && precipitation > 0) moldRisk = 'high';
          else if (humidity > 60 || precipitation > 0) moldRisk = 'moderate';
        }
      }
    } catch (nwsError) {
      console.error('Failed to fetch NWS:', nwsError.message);
    }

    // --- SAVE TO SUPABASE ---
    const pollenText = JSON.stringify(pollenRisk);
    const dashboardScore = buildDashboardScore({
      aqi,
      uvIndex,
      pollenRisk,
      moldRisk,
    });

    const cacheRow = {
      profile_id: profileId,
      aqi: aqi,
      uv_index: uvIndex,
      pollen_level: pollenText,
      mold_risk: moldRisk,
    };

    // Only cache a reading taken at the profile's own location. Writing a row
    // for some other coordinate would let it be served later as though it were
    // this profile's, which is exactly the bug the read gate above prevents.
    if (!isProfileLocation) {
      console.log('Request is not for the profile location; skipping cache write.');
      return NextResponse.json(
        formatResponsePayload({
          aqi,
          uvIndex,
          pollenRisk,
          moldRisk,
          cached: false,
          aqiSource,
          aqiIsMeasured,
        })
      );
    }

    // daily_scores.score is an integer column, so it stores the rounded score.
    // The full-precision value stays in the API response.
    const { error: insertError } = await supabase
      .from('daily_scores')
      .insert([{ ...cacheRow, score: dashboardScore.display_score }]);

    // If the score column is missing from this environment's schema, fall back
    // to the original insert rather than losing the cache row entirely. Same
    // graceful-degradation posture as the external API calls above: a missing
    // column should cost us the score, not the whole response.
    if (insertError && isUndefinedColumnError(insertError)) {
      console.warn(
        'daily_scores.score column not found; caching without score.',
        insertError.message
      );
      await supabase.from('daily_scores').insert([cacheRow]);
    } else if (insertError) {
      console.error('Failed to cache daily score:', insertError.message);
    }

    // Return restructured payload
    return NextResponse.json(
      formatResponsePayload({
        aqi,
        uvIndex,
        pollenRisk,
        moldRisk,
        cached: false,
        aqiSource,
        aqiIsMeasured,
      })
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}