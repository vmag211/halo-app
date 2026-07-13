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

    // --- CACHE CHECK: DID WE ALREADY FETCH THIS RECENTLY? ---
    // Calculate the exact time 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Ask Supabase for a recent score for this specific user
    const { data: cachedData, error: cacheError } = await supabase
      .from('daily_scores')
      .select('*')
      .eq('profile_id', profileId)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // If we found recent data, send it back immediately and stop the code here!
    if (cachedData) {
      // We convert the pollen text back into a JavaScript object
      let parsedPollen = null;
      if (cachedData.pollen_level) {
        parsedPollen = JSON.parse(cachedData.pollen_level);
      }

      return NextResponse.json({ 
        aqi: cachedData.aqi,
        uv: cachedData.uv_index,
        pollen: parsedPollen,
        cached: true // Helping Teammate 3 know where the data came from
      });
    }

    // --- NO CACHE FOUND. CALLING EXTERNAL APIs ---

    // 1. AIRNOW API (AQI)
    const airnowApiKey = process.env.AIRNOW_API_KEY;
    const airnowUrl = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${airnowApiKey}`;
    
    const airnowResponse = await fetch(airnowUrl);
    if (!airnowResponse.ok) throw new Error('Failed to fetch data from AirNow API');
    
    const airnowData = await airnowResponse.json();
    const aqi = airnowData.length > 0 ? airnowData[0].AQI : null;

    // 2. OPENUV API (UV Index)
    const openuvApiKey = process.env.OPENUV_API_KEY;
    const openuvUrl = `https://api.openuv.io/api/v1/uv?lat=${lat}&lng=${lng}`;

    const openuvResponse = await fetch(openuvUrl, {
      headers: { 'x-access-token': openuvApiKey }
    });
    if (!openuvResponse.ok) throw new Error('Failed to fetch data from OpenUV API');
    
    const openuvData = await openuvResponse.json();
    const uvIndex = openuvData.result ? openuvData.result.uv : null;

    // 3. GOOGLE POLLEN API (Pollen Risk)
    const pollenApiKey = process.env.GOOGLE_POLLEN_API_KEY;
    const pollenUrl = `https://pollen.googleapis.com/v1/forecast:lookup?key=${pollenApiKey}&location.longitude=${lng}&location.latitude=${lat}&days=1`;

    const pollenResponse = await fetch(pollenUrl);
    if (!pollenResponse.ok) throw new Error('Failed to fetch data from Google Pollen API');
    
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

    // --- SAVE NEW DATA TO SUPABASE CACHE ---
    // We turn the pollen object into text because your database column is type "text"
    const pollenText = JSON.stringify(pollenRisk);

    const { error: insertError } = await supabase
      .from('daily_scores')
      .insert([
        {
          profile_id: profileId,
          aqi: aqi,
          uv_index: uvIndex,
          pollen_level: pollenText
        }
      ]);

    // If saving fails, we log it, but we don't crash the app (the user still gets their data)
    if (insertError) {
      console.error("Failed to save to Supabase:", insertError);
    }

    // --- FINAL RESPONSE ---
    return NextResponse.json({ 
      aqi: aqi,
      uv: uvIndex,
      pollen: pollenRisk,
      cached: false
    });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}