import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapboxLimiter } from '@/lib/ratelimit'; // <-- IMPORT THE BOUNCER

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request) {
  try {
    const body = await request.json();
    const address = body.address;
    const profileId = body.profile_id;

    if (!address || !profileId) {
      return NextResponse.json({ error: 'Address and profile_id are required' }, { status: 400 });
    }

    // --- RATE LIMIT CHECK FOR MAPBOX ---
    // We use a single global identifier because we want to limit the total calls 
    // made by the whole app, not just by one specific user.
    const { success } = await mapboxLimiter.limit('global_mapbox_calls');
    
    if (!success) {
      return NextResponse.json(
        { error: 'Daily address search limit reached. Please try again tomorrow.' }, 
        { status: 429 }
      );
    }

    // --- MAPBOX GEOCODING API ---
    const mapboxToken = process.env.MAPBOX_TOKEN;
    const encodedAddress = encodeURIComponent(address);
    const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${mapboxToken}`;

    const mapboxResponse = await fetch(mapboxUrl);

    if (!mapboxResponse.ok) {
      throw new Error('Failed to fetch data from Mapbox API');
    }

    const mapboxData = await mapboxResponse.json();

    if (!mapboxData.features || mapboxData.features.length === 0) {
      return NextResponse.json({ error: 'Could not find coordinates for this address' }, { status: 404 });
    }

    const bestResult = mapboxData.features[0];
    const lng = bestResult.center[0];
    const lat = bestResult.center[1];

    let zip = null;
    let county = null;

    if (bestResult.context) {
      bestResult.context.forEach(item => {
        if (item.id.startsWith('postcode')) zip = item.text;
        if (item.id.startsWith('district') || item.text.toLowerCase().includes('county')) county = item.text;
      });
    }

    // --- EPA ENVIROFACTS API ---
    let pwsid = null;
    if (zip) {
      try {
        const epaUrl = `https://data.epa.gov/efservice/WATER_SYSTEM/ZIP_CODE/${zip}/JSON`;
        const epaResponse = await fetch(epaUrl);
        if (epaResponse.ok) {
          const epaData = await epaResponse.json();
          if (epaData && epaData.length > 0) pwsid = epaData[0].pwsid;
        }
      } catch (epaError) {
        console.error("Failed to fetch EPA water data:", epaError.message);
      }
    }

    // --- UPDATE SUPABASE ---
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ lat: lat, lng: lng, zip: zip, county: county, pwsid: pwsid })
      .eq('id', profileId);

    if (updateError) throw new Error(`Failed to update profile: ${updateError.message}`);

    return NextResponse.json({ lat, lng, zip, county, pwsid });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}