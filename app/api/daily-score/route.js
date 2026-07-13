import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!lat || !lng) {
      return NextResponse.json({ error: 'Latitude and longitude are required' }, { status: 400 });
    }

    const apiKey = process.env.AIRNOW_API_KEY;
    
    const url = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lng}&distance=25&API_KEY=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch data from AirNow API');
    }

    const data = await response.json();

    const aqi = data.length > 0 ? data[0].AQI : null;

    return NextResponse.json({ aqi: aqi });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}