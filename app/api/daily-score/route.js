import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { openuvLimiter } from '@/lib/ratelimit'; // <-- IMPORT THE BOUNCER

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// HELPER FUNCTIONS FOR STATUS CALCULATION
// ==========================================

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

function formatResponsePayload({ aqi, uvIndex, pollenRisk, moldRisk, cached }) {
  return {
    air: {
      aqi: aqi,
      status: getAirStatus(aqi),
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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: cachedData } = await supabase
      .from('daily_scores')
      .select('*')
      .eq('profile_id', profileId)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

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

    // 1. AIRNOW API
    const airnowApiKey = process.env.AIRNOW_API_KEY;
    const airnowUrl = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${airnowApiKey}`;
    const airnowResponse = await fetch(airnowUrl);
    if (!airnowResponse.ok) throw new Error('Failed to fetch AirNow');
    const airnowData = await airnowResponse.json();
    const aqi = airnowData.length > 0 ? airnowData[0].AQI : null;

    // 2. OPENUV API (WITH RATE LIMIT)
    let uvIndex = null;
    const { success: canCallOpenUV } = await openuvLimiter.limit('global_openuv_calls');

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
        } else {
          console.error('OpenUV API failed');
        }
      } catch (err) {
        console.error('OpenUV fetch error:', err.message);
      }
    } else {
      console.log('OpenUV daily limit reached, skipping fetch.');
    }

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
    await supabase.from('daily_scores').insert([
      {
        profile_id: profileId,
        aqi: aqi,
        uv_index: uvIndex,
        pollen_level: pollenText,
        mold_risk: moldRisk,
      },
    ]);

    // Return restructured payload
    return NextResponse.json(
      formatResponsePayload({
        aqi,
        uvIndex,
        pollenRisk,
        moldRisk,
        cached: false,
      })
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}