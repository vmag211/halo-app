import { NextResponse, after } from 'next/server';
import { mapboxLimiter, onboardLimiter, dailyScoreLimiter, checkLimit } from '@/lib/ratelimit';
import { requireUser, assertProfileMatches, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { parseMapboxFeature, roundCoord, serviceAreaFromArcgis, locationMoved, isUsZipCode } from '@/lib/geocode';
import { localDate } from '@/lib/localDate';
import { backfillHousehold, backfillHomeContext } from '@/lib/backfill';
import { ERROR_CODES, apiError, internalError, requestIdFor, validationError } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { parseOnboardBody } from '@/lib/onboardInput';
import { contextSummary, toContextAttributes } from '@/lib/homeContext';
import { transitionHomeContext } from '@/lib/homeContextRpc';

/**
 * POST /api/onboard: geocode the household's address, look up its water utility, and save the
 * home.
 *
 * Saving the home (migration 0016). The location is saved through the home context function
 * transition_home_context, in one transaction: the same rounded point updates the current home
 * in place, a new point closes it and opens the next one (a move), and the profile follows the
 * resulting home. A move also deletes today's reading of the home it closed (it described the
 * old address), which this route used to do itself. A key the request leaves out is kept at the
 * same home and unknown (null) at a new one: a move carries nothing of the old home over. The
 * utility lookup's outcome is stored as the home's service_area_status; a failed lookup never
 * replaces a utility already on file for that home.
 *
 * The response is the same as before, plus `home_context` (lib/homeContext.js contextSummary of
 * the saved home) and `moved` (whether this request closed the previous home). On a failed
 * utility lookup, `pwsid` is the saved home's utility: at the same home the one on file, at a
 * new home none (the old home's utility does not describe the new one).
 *
 * Until 0016 is applied (the function or table is missing) the route saves to the profile and
 * clears today's reading on a move exactly as it always has, says so in one warning per
 * process, and answers `home_context: null` with its own `moved`.
 *
 * After the response, the last few weeks of readings are backfilled for the saved home, and the
 * backfill's progress is recorded on it (lib/backfill.js backfillHomeContext). A failure there
 * never reaches onboarding.
 */

// The history backfill runs after the response (see below) within this budget.
export const maxDuration = 60;

// How the location of a home saved here was found.
const MATCH_METHOD = 'mapbox_geocode_arcgis_point';

let warnedNoHomeContexts = false;

/** Before migration 0016: the legacy save below. Says so once per process. */
function withoutHomeContexts(code) {
  if (warnedNoHomeContexts) return;
  warnedNoHomeContexts = true;
  console.warn(
    `Onboard: home contexts are not available (${code}), so migration 0016 is probably not applied yet. ` +
      'Saving the location to the profile only, as before.',
  );
}

let warnedHomeContextSchema = false;

/** A home context column the backfill writes is missing: the readings are saved without it. Once per process. */
function homeContextSchemaMissing(error) {
  if (warnedHomeContextSchema) return;
  warnedHomeContextSchema = true;
  console.warn(
    `Onboard backfill: a home context column is missing (${error?.code ?? 'unknown'}: ${error?.message ?? ''}). ` +
      'Readings are saved without their home, and the backfill progress is not recorded.',
  );
}

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

// The body is an address, an optional request id and two optional answers.
const POST_MAX_BYTES = 4096;
const NO_COORDINATES = 'Could not find coordinates for this address';

/**
 * Saves the home through transition_home_context (see the comment at the top).
 * Returns { unavailable } before 0016, else { context, moved, previous_context_id }.
 * Any refusal or error is thrown (a 500): nothing is half-saved, the function is one transaction.
 */
async function saveThroughHomeContext(userId, profileUpdate, serviceAreaStatus) {
  const { location, attributes } = toContextAttributes({
    ...profileUpdate,
    service_area_status: serviceAreaStatus,
    match_method: MATCH_METHOD,
  });
  const args = { profileId: userId, location, attributes, requestId: profileUpdate.onboard_request_id ?? null };
  let saved = await transitionHomeContext(supabaseAdmin, args);
  if (saved.refusal?.code === 'HALO_PROFILE_NOT_FOUND') {
    // The auth trigger normally makes the profile row; the old upsert below covered users who predate
    // it. Make the bare row the trigger would have (never touching an existing one), then save.
    const { error } = await supabaseAdmin.from('profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`Failed to create profile: ${error.message}`);
    saved = await transitionHomeContext(supabaseAdmin, args);
  }
  if (saved.refusal) {
    throw new Error(`transition_home_context refused the onboarding: ${saved.refusal.code} (${saved.refusal.detail})`);
  }
  return saved;
}

/**
 * Before migration 0016: the profile upsert and the move's clean-up, exactly as this route
 * always did them. Returns the utility to report and whether the location moved.
 */
async function saveToProfile(userId, profileUpdate, serviceArea) {
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
  if (serviceArea.status === 'lookup_failed') {
    const { data: stored } = await supabaseAdmin.from('profiles').select('pwsid').eq('id', userId).maybeSingle();
    pwsid = stored?.pwsid ?? null;
  }

  // A new home: today's cached reading belongs to the old one, and the
  // five-minute provider limit would otherwise make the results reveal's
  // fresh reading for the new home fail. Onboarding itself is limited to 10
  // per day per user, so this can't be used to hammer the providers.
  const moved = locationMoved(before, profileUpdate);
  if (moved) {
    const { error: clearError } = await supabaseAdmin
      .from('daily_scores')
      .delete()
      .eq('profile_id', userId)
      .eq('date', localDate());
    if (clearError) console.error('Could not clear the old home\'s reading:', clearError.message);
  }
  return { pwsid, moved };
}

/** A new home: the five-minute provider limit must not block the results reveal's fresh reading. */
async function resetDailyScoreLimit(userId) {
  try {
    await dailyScoreLimiter.resetUsedTokens(`daily-score:${userId}`);
  } catch (limitError) {
    console.error('Could not reset the daily-score limiter:', limitError.message);
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  const limited = (message) => apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message, requestId });
  const noCoordinates = () => apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: NO_COORDINATES, requestId });
  try {
    // --- IDENTITY ---
    // The profile id comes from the verified session token, never from the body.
    // It used to be a plain string the caller supplied, which meant anyone could
    // pass any UUID and overwrite another household's address and coordinates.
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: POST_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    // Older clients still send profile_id. We ignore it for identity, but a
    // mismatch means the client is confused about who it is, and quietly writing
    // to the token's profile instead would hide that.
    assertProfileMatches(body.value.profile_id, userId);

    // The address, the client's request id and the optional onboarding answers
    // (lib/onboardInput.js). water_source and home_year are not required to
    // geocode, but both feed HomeGuard later: water_source decides whether we
    // look up a utility or hand back a private-well testing plan, and home_year
    // drives the lead-plumbing risk check. The request id is stored with the
    // location so the app can confirm a timed-out request.
    const input = parseOnboardBody(body.value);
    if (!input.ok) return validationError(input.fieldErrors, requestId);
    const { address, requestId: onboardRequestId, waterSource, homeYear } = input.value;

    // --- RATE LIMIT CHECKS ---
    // Per-user first: the Mapbox window below is global, so one abusive client
    // could otherwise burn the whole day's geocoding budget for everybody.
    const withinUserQuota = await checkLimit(onboardLimiter, `onboard:${userId}`, {
      fallback: true,
      label: 'Per-user onboard limiter',
    });

    if (!withinUserQuota) {
      return limited('Too many address lookups from this device today. Please try again tomorrow.');
    }

    // Fails open: a limiter outage costs some geocoding budget, but failing
    // closed would shut the front door on every new user. Upstash has gone away
    // on this project before, and this call used to be unwrapped.
    const withinGlobalQuota = await checkLimit(mapboxLimiter, 'global_mapbox_calls', {
      fallback: true,
      label: 'Mapbox limiter',
    });

    if (!withinGlobalQuota) {
      return limited('Daily address search limit reached. Please try again tomorrow.');
    }

    // --- MAPBOX GEOCODING API ---
    const mapboxToken = process.env.MAPBOX_TOKEN;
    const encodedAddress = encodeURIComponent(address);
    const mapboxParams = new URLSearchParams({ access_token: mapboxToken });
    if (isUsZipCode(address)) mapboxParams.set('country', 'us');
    const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?${mapboxParams}`;

    const mapboxResponse = await fetch(mapboxUrl);

    if (!mapboxResponse.ok) {
      throw new Error('Failed to fetch data from Mapbox API');
    }

    const mapboxData = await mapboxResponse.json();

    if (!mapboxData.features || mapboxData.features.length === 0) return noCoordinates();

    // lat/lng here are Mapbox's precise point — used for the utility lookup
    // below, then rounded before anything is stored. zip is returned for
    // compatibility but no longer stored (nothing uses it, and the privacy
    // statement doesn't list it).
    const place = parseMapboxFeature(mapboxData.features[0]);
    // A feature with no usable centre is the same answer as no feature at all.
    if (!place) return noCoordinates();
    const { lat, lng, county, state, zip } = place;

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
    if (onboardRequestId !== null) profileUpdate.onboard_request_id = onboardRequestId;

    // --- SAVE THE HOME ---
    // Through the home context function (0016), else as before (see the comment at the top).
    const saved = await saveThroughHomeContext(userId, profileUpdate, serviceAreaStatus);
    let pwsid;
    let moved;
    let homeContext = null;
    if (saved.unavailable) {
      withoutHomeContexts(saved.code);
      ({ pwsid, moved } = await saveToProfile(userId, profileUpdate, serviceArea));
    } else {
      homeContext = saved.context;
      moved = saved.moved;
      // On a failed lookup, the utility the saved home has: the one on file at the same home, none at a new one.
      pwsid = serviceAreaStatus === 'lookup_failed' ? homeContext.pwsid ?? null : serviceArea.pwsid;
    }

    if (moved) await resetDailyScoreLimit(userId);

    // Backfill the last few weeks of readings so Journal has history from day
    // one (item 10). After the response, so onboarding and the results reveal
    // never wait on it; it never overwrites a real reading and never throws.
    // With a home context, the backfill is for that home and records its
    // progress on it (lib/backfill.js backfillHomeContext).
    if (homeContext) {
      const home = { lat: homeContext.lat, lng: homeContext.lng };
      const homeContextId = homeContext.id;
      after(() => backfillHomeContext(supabaseAdmin, userId, home, { homeContextId, onSchemaMissing: homeContextSchemaMissing }));
    } else {
      after(() => backfillHousehold(supabaseAdmin, userId, { lat: profileUpdate.lat, lng: profileUpdate.lng }));
    }

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
      // The saved home (null before migration 0016) and whether this request moved the household.
      home_context: contextSummary(homeContext),
      moved,
    }, { headers });

  } catch (error) {
    const authResponse = authErrorResponse(error, requestId);
    if (authResponse) return authResponse;

    // Details go to the log: database and provider messages are not for users.
    console.error(`Onboard failed (request ${requestId}):`, error);
    return internalError(requestId);
  }
}
