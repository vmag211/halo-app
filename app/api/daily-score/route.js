import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// --- INITIALIZE SUPABASE ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const profileId = searchParams.get('profile_id');

    if (!lat || !lng || !profileId) {
      return NextResponse.json({ error: 'Latitude, longitude, and profile_id are required' }, { status: 400 });
    }

    // --- CACHE CHECK ---
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: cachedData, error: cacheError } = await supabase
      .from('daily_scores')
      .select('*')
      .eq('profile_id', profileId)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cachedData) {
      let parsedPollen = null;
      if (cachedData.pollen_level) {
        parsedPollen = JSON.parse(cachedData.pollen_level);
      }

      return NextResponse.json({ 
        aqi: cachedData.aqi,
        uv: cachedData.uv_index,
        pollen: parsedPollen,
        mold_risk: cachedData.mold_risk,
        cached: true
      });
    }

    // --- EXTERNAL APIS ---

    // 1. AIRNOW API (AQI)
    const airnowApiKey = process.env.AIRNOW_API_KEY;
    const airnowUrl = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${airnowApiKey}`;
    const airnowResponse = await fetch(airnowUrl);
    if (!airnowResponse.ok) throw new Error('Failed to fetch AirNow');
    const airnowData = await airnowResponse.json();
    const aqi = airnowData.length > 0 ? airnowData[0].AQI : null;

    // 2. OPENUV API (UV Index)
    const openuvApiKey = process.env.OPENUV_API_KEY;
    const openuvUrl = `https://api.openuv.io/api/v1/uv?lat=${lat}&lng=${lng}`;
    const openuvResponse = await fetch(openuvUrl, { headers: { 'x-access-token': openuvApiKey } });
    if (!openuvResponse.ok) throw new Error('Failed to fetch OpenUV');
    const openuvData = await openuvResponse.json();
    const uvIndex = openuvData.result ? openuvData.result.uv : null;

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
        typesInfo.forEach(info => {
          if (info.code === 'TREE') pollenRisk.tree = info.indexInfo ? info.indexInfo.value : null;
          if (info.code === 'GRASS') pollenRisk.grass = info.indexInfo ? info.indexInfo.value : null;
          if (info.code === 'WEED') pollenRisk.weed = info.indexInfo ? info.indexInfo.value : null;
        });
      }
    }

    // 4. NATIONAL WEATHER SERVICE (Mold Risk Proxy)
    let moldRisk = 'low'; // Default starting point
    
    // We wrap this in its own try/catch. The NWS API is notoriously unstable. 
    // If it fails, we don't want to crash the whole app, we just accept 'low' risk.
    try {
      const nwsHeaders = { 'User-Agent': 'HALO/1.0' };
      const pointsUrl = `https://api.weather.gov/points/${lat},${lng}`;
      
      // Step 1: Get the forecast office grid points
      const pointsResponse = await fetch(pointsUrl, { headers: nwsHeaders });
      if (!pointsResponse.ok) throw new Error('NWS Points API failed');
      const pointsData = await pointsResponse.json();
      
      // Step 2: Extract the specific hourly forecast URL from that first response
      const forecastUrl = pointsData.properties.forecastHourly;
      
      // Step 3: Fetch the actual hourly weather data
      const forecastResponse = await fetch(forecastUrl, { headers: nwsHeaders });
      if (!forecastResponse.ok) throw new Error('NWS Forecast API failed');
      const forecastData = await forecastResponse.json();
      
      // Look at the very first hour in the list (right now)
      const currentHour = forecastData.properties.periods[0];
      const humidity = currentHour.relativeHumidity.value;
      const precipitation = currentHour.probabilityOfPrecipitation.value; // NWS returns probability %
      
      // Apply your exact logic
      if (humidity > 70 && precipitation > 0) {
        moldRisk = 'high';
      } else if (humidity > 60 || precipitation > 0) {
        moldRisk = 'moderate';
      }
    } catch (nwsError) {
      console.error("Failed to fetch NWS data:", nwsError.message);
    }

    // --- SAVE NEW DATA TO SUPABASE CACHE ---
    const pollenText = JSON.stringify(pollenRisk);

    const { error: insertError } = await supabase
      .from('daily_scores')
      .insert([
        {
          profile_id: profileId,
          aqi: aqi,
          uv_index: uvIndex,
          pollen_level: pollenText,
          mold_risk: moldRisk
        }
      ]);

    if (insertError) {
      console.error("Failed to save to Supabase:", insertError);
    }

    // --- FINAL RESPONSE ---
    return NextResponse.json({ 
      aqi: aqi,
      uv: uvIndex,
      pollen: pollenRisk,
      mold_risk: moldRisk,
      cached: false
    });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}