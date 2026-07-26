import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapboxLimiter } from '@/lib/ratelimit'; 

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

    // --- ARCGIS FEATURESERVER API (Spatial Query) ---
    let pwsid = null;
    let serviceAreaStatus = 'outside_known_area'; 

    try {
      // We use URLSearchParams to neatly build the query string without messing up the formatting
      const params = new URLSearchParams({
        geometryType: 'esriGeometryPoint',
        geometry: `${lng},${lat}`, // Longitude must always come first in ArcGIS
        inSR: '4326', // Standard GPS coordinates
        spatialRel: 'esriSpatialRelIntersects', // "Find boundaries touching this pin"
        outFields: 'PWSID', // Only give us the PWSID to save bandwidth
        returnGeometry: 'false', // Strip out the massive polygon drawing data
        f: 'json' // Return readable JavaScript objects
      });

      const arcgisUrl = `https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query?${params.toString()}`;
      
      const arcgisResponse = await fetch(arcgisUrl);
      
      if (arcgisResponse.ok) {
        const arcgisData = await arcgisResponse.json();
        
        // Check if the map actually found a boundary polygon for this point
        if (arcgisData.features && arcgisData.features.length > 0) {
          // ArcGIS tucks our requested data inside the "attributes" object
          pwsid = arcgisData.features[0].attributes.PWSID;
          serviceAreaStatus = 'measured';
        }
      }
    } catch (arcgisError) {
      console.error("Failed to fetch ArcGIS water data:", arcgisError.message);
      // It safely falls back to 'outside_known_area' and null pwsid if this crashes
    }

    // --- UPDATE SUPABASE ---
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ lat: lat, lng: lng, zip: zip, county: county, pwsid: pwsid })
      .eq('id', profileId);

    if (updateError) throw new Error(`Failed to update profile: ${updateError.message}`);

    // --- FINAL RESPONSE ---
    return NextResponse.json({ 
      lat, 
      lng, 
      zip, 
      county, 
      pwsid,
      service_area_status: serviceAreaStatus 
    });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}