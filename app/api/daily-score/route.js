import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!lat || !lng) {
      return NextResponse.json({ error: 'Latitude and longitude are required' }, { status: 400 });
    }

    // --- AIRNOW API (AQI) ---
    const airnowApiKey = process.env.AIRNOW_API_KEY;
    const airnowUrl = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${airnowApiKey}`;
    
    const airnowResponse = await fetch(airnowUrl);

    if (!airnowResponse.ok) {
      throw new Error('Failed to fetch data from AirNow API');
    }

    const airnowData = await airnowResponse.json();
    const aqi = airnowData.length > 0 ? airnowData[0].AQI : null;

    // --- OPENUV API (UV Index) ---
    const openuvApiKey = process.env.OPENUV_API_KEY;
    const openuvUrl = `https://api.openuv.io/api/v1/uv?lat=${lat}&lng=${lng}`;

    const openuvResponse = await fetch(openuvUrl, {
      headers: {
        'x-access-token': openuvApiKey
      }
    });

    if (!openuvResponse.ok) {
      throw new Error('Failed to fetch data from OpenUV API');
    }

    const openuvData = await openuvResponse.json();
    const uvIndex = openuvData.result ? openuvData.result.uv : null;

    // --- GOOGLE POLLEN API (Pollen Risk) ---
    const pollenApiKey = process.env.GOOGLE_POLLEN_API_KEY;
    const pollenUrl = `https://pollen.googleapis.com/v1/forecast:lookup?key=${pollenApiKey}&location.longitude=${lng}&location.latitude=${lat}&days=1`;

    const pollenResponse = await fetch(pollenUrl);

    if (!pollenResponse.ok) {
      throw new Error('Failed to fetch data from Google Pollen API');
    }

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

    // --- FINAL RESPONSE ---
    return NextResponse.json({ 
      aqi: aqi,
      uv: uvIndex,
      pollen: pollenRisk
    });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}