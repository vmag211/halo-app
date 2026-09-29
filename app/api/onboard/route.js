import { NextResponse, after } from 'next/server';
import { mapboxLimiter, onboardLimiter, dailyScoreLimiter, checkLimit } from '@/lib/ratelimit';
import { requireUser, assertProfileMatches, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeWaterSource } from '@/lib/waterSource';
import { parseMapboxFeature, roundCoord, serviceAreaFromArcgis, validateHomeYear, parseRequestId, locationMoved } from '@/lib/geocode';
import { localDate } from '@/lib/localDate';
import { backfillHousehold } from '@/lib/backfill';

// The history backfill runs after the response (see below) within this budget.
export const maxDuration = 60;

// Postgres reports an unknown column as 42703; PostgREST as PGRST204.
function isUndefinedColumnError(error) {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist/i.test(error.message || '') ||
    /could not find the .* column/i.test(error.message || '')
  );
}

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
    const year = validateHomeYear(body.home_year);
    if (!year.ok) {
      return NextResponse.json({ error: year.error }, { status: 400 });
    }
    const homeYear = year.value;
    // Stored with the location so the app can confirm a timed-out request.
    const requestId = parseRequestId(body.request_id);

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

    // lat/lng here are Mapbox's precise point — used for the utility lookup
    // below, then rounded before anything is stored. zip is returned for
    // compatibility but no longer stored (nothing uses it, and the privacy
    // statement doesn't list it).
    const { lat, lng, county, state, zip } = parseMapboxFeature(mapboxData.features[0]);

    // --- ARCGIS FEATURESERVER API (Spatial Query) ---
    let arcgisOutcome = null;

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
      arcgisOutcome = {
        ok: arcgisResponse.ok,
        json: arcgisResponse.ok ? await arcgisResponse.json() : null,
      };
    } catch (arcgisError) {
      console.error("Failed to fetch ArcGIS water data:", arcgisError.message);
    }

    // "No polygon here" (a finding — often a private well) and "the lookup
    // failed" (our problem) are different: a failure keeps the utility already
    // on file rather than overwriting it with null.
    const serviceArea = serviceAreaFromArcgis(arcgisOutcome);
    const serviceAreaStatus = serviceArea.status;

    // --- UPDATE SUPABASE ---
    // Only write the optional columns if the frontend actually sent them.
    // Otherwise a re-run of onboarding with a bare body would wipe out
    // answers the user already gave us.
    const profileUpdate = {
      id: userId,
      // Approximate coordinates (~100 m), as the privacy statement promises.
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      county: county,
      // Clears any zip stored by earlier versions.
      zip: null,
    };
    if (serviceAreaStatus !== 'lookup_failed') profileUpdate.pwsid = serviceArea.pwsid;
    if (state) profileUpdate.state = state;
    if (waterSource !== null) profileUpdate.water_source = waterSource;
    if (homeYear !== null) profileUpdate.home_year = homeYear;
    if (requestId !== null) profileUpdate.onboard_request_id = requestId;

    // The location on file before this write, to tell a move from a re-submit.
    const { data: before } = await supabaseAdmin.from('profiles').select('lat, lng').eq('id', userId).maybeSingle();

    // upsert, not update: `UPDATE ... WHERE id = x` against a row that does not
    // exist is not an error in Postgres. It touches zero rows and reports
    // success, so this endpoint would return 200 with coordinates while having
    // persisted nothing at all -- silent data loss that looks exactly like a
    // working onboard. The auth.users trigger normally creates the row first;
    // this covers users who predate it and the case where it ever fails.
    let { error: updateError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileUpdate, { onConflict: 'id' });

    // profiles.state arrives with migration 0009 and onboard_request_id with
    // 0014; until then store the rest. Drop the column the error names, else
    // the newest one first.
    const optional = ['onboard_request_id', 'state'].filter((column) => column in profileUpdate);
    while (updateError && isUndefinedColumnError(updateError) && optional.length) {
      const named = optional.find((column) => (updateError.message || '').includes(column)) ?? optional[0];
      optional.splice(optional.indexOf(named), 1);
      delete profileUpdate[named];
      ({ error: updateError } = await supabaseAdmin.from('profiles').upsert(profileUpdate, { onConflict: 'id' }));
    }

    if (updateError) throw new Error(`Failed to update profile: ${updateError.message}`);

    // On a failed lookup, report the utility already on file (if any).
    let pwsid = serviceArea.pwsid;
    if (serviceAreaStatus === 'lookup_failed') {
      const { data: stored } = await supabaseAdmin.from('profiles').select('pwsid').eq('id', userId).maybeSingle();
      pwsid = stored?.pwsid ?? null;
    }

    // A new home: today's cached reading belongs to the old one, and the
    // five-minute provider limit would otherwise make the results reveal's
    // fresh reading for the new home fail. Onboarding itself is limited to 10
    // per day per user, so this can't be used to hammer the providers.
    if (locationMoved(before, profileUpdate)) {
      const { error: clearError } = await supabaseAdmin
        .from('daily_scores')
        .delete()
        .eq('profile_id', userId)
        .eq('date', localDate());
      if (clearError) console.error('Could not clear the old home\'s reading:', clearError.message);
      try {
        await dailyScoreLimiter.resetUsedTokens(`daily-score:${userId}`);
      } catch (limitError) {
        console.error('Could not reset the daily-score limiter:', limitError.message);
      }
    }

    // Backfill the last few weeks of readings so Journal has history from day
    // one (item 10). After the response, so onboarding and the results reveal
    // never wait on it; it never overwrites a real reading and never throws.
    after(() => backfillHousehold(supabaseAdmin, userId, { lat: profileUpdate.lat, lng: profileUpdate.lng }));

    // --- FINAL RESPONSE ---
    return NextResponse.json({ 
      profile_id: userId,
      lat: profileUpdate.lat,
      lng: profileUpdate.lng,
      zip,
      county,
      state,
      pwsid,
      service_area_status: serviceAreaStatus,
      water_source: waterSource,
      home_year: homeYear,
      // Echoed only if it was stored (null before migration 0014).
      onboard_request_id: profileUpdate.onboard_request_id ?? null,
    });

  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    // Details go to the log: database and provider messages are not for users.
    console.error('Onboard failed:', error);
    return NextResponse.json({ error: 'Could not save this address. Please try again.' }, { status: 500 });
  }
}
