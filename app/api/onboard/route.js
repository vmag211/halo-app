import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// --- INITIALIZE SUPABASE ---
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
    
    // Mapbox weirdly returns coordinates in [longitude, latitude] order
    const lng = bestResult.center[0];
    const lat = bestResult.center[1];

    let zip = null;
    let county = null;

    if (bestResult.context) {
      bestResult.context.forEach(item => {
        if (item.id.startsWith('postcode')) {
          zip = item.text;
        }
        if (item.id.startsWith('district') || item.text.toLowerCase().includes('county')) {
          county = item.text;
        }
      });
    }

    // --- EPA ENVIROFACTS API (Water Utility) ---
    let pwsid = null;
    
    if (zip) {
      try {
        const epaUrl = `https://data.epa.gov/efservice/WATER_SYSTEM/ZIP_CODE/${zip}/JSON`;
        const epaResponse = await fetch(epaUrl);
        
        if (epaResponse.ok) {
          const epaData = await epaResponse.json();
          
          if (epaData && epaData.length > 0) {
            // FIXED: Using lowercase 'pwsid' to match the EPA's exact data structure
            pwsid = epaData[0].pwsid;
          }
        }
      } catch (epaError) {
        console.error("Failed to fetch EPA water data:", epaError.message);
      }
    }

    // --- UPDATE SUPABASE PROFILES TABLE ---
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        lat: lat, 
        lng: lng, 
        zip: zip, 
        county: county,
        pwsid: pwsid 
      })
      .eq('id', profileId);

    if (updateError) {
      throw new Error(`Failed to update profile in Supabase: ${updateError.message}`);
    }

    // --- FINAL RESPONSE ---
    return NextResponse.json({ 
      lat: lat,
      lng: lng,
      zip: zip,
      county: county,
      pwsid: pwsid 
    });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}