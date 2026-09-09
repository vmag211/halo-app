import { NextResponse } from 'next/server';
import { mapboxLimiter, onboardLimiter, checkLimit } from '@/lib/ratelimit';
import { requireUser, assertProfileMatches, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeWaterSource } from '@/lib/waterSource';

export async function POST(request) {
  try {
    // --- IDENTITY ---
    // The profile id comes from the verified session token, never from the body.
    // It used to be a plain string the caller supplied, which meant anyone could
    // pass any UUID and overwrite another household's address and coordinates.
    const { userId } = await requireUser(request);

    const body = await request.json();
    const address = body.address;

    // Older clients still send profile_id. We ignore it for identity, but a
    // mismatch means the client is confused about who it is, and quietly writing
    // to the token's profile instead would hide that.
    assertProfileMatches(body.profile_id, userId);

    // Optional onboarding answers. Neither is required to geocode, but both
    // feed HomeGuard later: water_source decides whether we look up a utility
    // or hand back a private-well testing plan, and home_year drives the
    // lead-plumbing risk check.
    const waterSource = normalizeWaterSource(body.water_source);
    const homeYear = body.home_year ?? null;

    if (!address) {
      return NextResponse.json({ error: 'Address is required' }, { status: 400 });
    }

    // --- RATE LIMIT CHECKS ---
    // Per-user first: the Mapbox window below is global, so one abusive client
    // could otherwise burn the whole day's geocoding budget for everybody.
    const withinUserQuota = await checkLimit(onboardLimiter, `onboard:${userId}`, {
      fallback: true,
      label: 'Per-user onboard limiter',
    });

    if (!withinUserQuota) {
      return NextResponse.json(
        { error: 'Too many address lookups from this device today. Please try again tomorrow.' },
        { status: 429 },
      );
    }

    // Fails open: a limiter outage costs some geocoding budget, but failing
    // closed would shut the front door on every new user. Upstash has gone away
    // on this project before, and this call used to be unwrapped.
    const withinGlobalQuota = await checkLimit(mapboxLimiter, 'global_mapbox_calls', {
      fallback: true,
      label: 'Mapbox limiter',
    });

    if (!withinGlobalQuota) {
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
    // Only write the optional columns if the frontend actually sent them.
    // Otherwise a re-run of onboarding with a bare body would wipe out
    // answers the user already gave us.
    const profileUpdate = { id: userId, lat: lat, lng: lng, zip: zip, county: county, pwsid: pwsid };
    if (waterSource !== null) profileUpdate.water_source = waterSource;
    if (homeYear !== null) profileUpdate.home_year = homeYear;

    // upsert, not update: `UPDATE ... WHERE id = x` against a row that does not
    // exist is not an error in Postgres. It touches zero rows and reports
    // success, so this endpoint would return 200 with coordinates while having
    // persisted nothing at all -- silent data loss that looks exactly like a
    // working onboard. The auth.users trigger normally creates the row first;
    // this covers users who predate it and the case where it ever fails.
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileUpdate, { onConflict: 'id' });

    if (updateError) throw new Error(`Failed to update profile: ${updateError.message}`);

    // --- FINAL RESPONSE ---
    return NextResponse.json({ 
      profile_id: userId,
      lat, 
      lng, 
      zip, 
      county, 
      pwsid,
      service_area_status: serviceAreaStatus,
      water_source: waterSource,
      home_year: homeYear
    });

  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
