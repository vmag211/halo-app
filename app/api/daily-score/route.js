import { NextResponse } from 'next/server';
import { openuvLimiter, dailyScoreLimiter, checkLimit } from '@/lib/ratelimit';
import { requireUser, assertProfileMatches, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeBands } from '@/lib/household';
import { fetchDailyReadings } from '@/lib/dailyReadings';
import { formatDailyPayload, toIsoUtc } from '@/lib/dailyPayload';
import { localDate } from '@/lib/localDate';
import { parseCoordinates } from '@/lib/validate';
import { ERROR_CODES, apiError, requestIdFor, validationError, internalError } from '@/lib/apiErrors';
import { contextIdForPoint, isMissingContextLink, readCurrentHomeContext } from '@/lib/homeContextRpc';

/**
 * GET /api/daily-score[?lat=&lng=][&fresh=1]
 *
 * Today's air, UV, pollen and mold for the household, with a composite score.
 *
 * - Location: lat/lng if given (kept for compatibility), otherwise the
 *   household's stored location. Give both or neither; each must be a plain
 *   decimal number in range (one of the pair, or anything else, is a 400).
 * - Cache: a reading taken at the household's own location in the last hour is
 *   served from daily_scores. `fresh=1` skips that read (pull to refresh).
 * - Provider fetches (cache misses and refreshes) are limited to one per
 *   household per five minutes, so repeated pulls can't hammer AirNow, Pollen
 *   and NWS. The limiter fails open.
 * - Readings are stored with the household's local (America/New_York) date,
 *   and with the household's current home (migration 0016's home_context_id)
 *   when that home is at the stored point the reading is for. Only the reading
 *   for the household's own location is stored, so only it is linked. Before
 *   0016 it is stored without the link, as before.
 * - `fresh` is literally "1"; any other value is the same as not sending it.
 * - Every response carries X-Request-Id; errors are the shared envelope.
 *
 * Fetching lives in lib/dailyReadings.js (shared with the daily job) and the
 * response shape in lib/dailyPayload.js.
 */

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

let warnedNoContextLink = false;

/** daily_scores has no home_context_id column (0016 not applied): the reading goes in without it. Once per process. */
function contextLinkDropped(error) {
  if (warnedNoContextLink) return;
  warnedNoContextLink = true;
  console.warn(
    `Daily score: daily_scores has no home_context_id column (${error?.code ?? 'unknown'}), so migration 0016 is probably not applied yet. ` +
      'Caching readings without their home.',
  );
}

/**
 * The household's current home for a reading taken at its stored point (lib/homeContextRpc.js
 * contextIdForPoint), or null: no home yet, 0016 not applied, a home elsewhere, or the home could
 * not be read (logged). With null the reading is cached without a home, as before.
 */
async function ownHomeContextId(profileId, point) {
  try {
    const current = await readCurrentHomeContext(supabaseAdmin, profileId);
    if (current.unavailable) return null;
    return contextIdForPoint(current.context, point);
  } catch (error) {
    console.error('Could not read the current home; caching the reading without it.', error.message);
    return null;
  }
}

// AirNow is a physical monitor; Open-Meteo is a model. A row with no recorded
// source stays null — unknown provenance, not assumed-modelled.
function isMeasuredSource(source) {
  if (!source) return null;
  return source === 'airnow';
}

/** A cached daily_scores row → the readings shape formatDailyPayload takes. */
function readingsFromRow(row) {
  let pollen = { tree: null, grass: null, weed: null };
  if (row.pollen_level) {
    try {
      pollen = { ...pollen, ...JSON.parse(row.pollen_level) };
    } catch (e) {
      console.error('Error parsing cached pollen data:', e);
    }
  }
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  return {
    aqi: row.aqi,
    aqiSource: row.aqi_source ?? null,
    aqiIsMeasured: isMeasuredSource(row.aqi_source),
    dominantPollutant: details.dominant_pollutant ?? null,
    uvIndex: row.uv_index,
    uvPeakWindow: details.uv_peak_window ?? null,
    pollen,
    mold: { risk: row.mold_risk ?? null, basis: details.mold_basis ?? null },
  };
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    // Identity comes from the verified session, never a query parameter.
    const { userId: profileId } = await requireUser(request);

    const { searchParams } = new URL(request.url);
    assertProfileMatches(searchParams.get('profile_id'), profileId);
    const fresh = searchParams.get('fresh') === '1';

    // lat and lng come as a pair or not at all. Checked before anything is read.
    const qLat = searchParams.get('lat');
    const qLng = searchParams.get('lng');
    let requested = null;
    if (qLat !== null || qLng !== null) {
      if (qLat === null || qLng === null) {
        return validationError(
          [{
            field: qLat === null ? 'lat' : 'lng',
            code: 'coordinate_pair_required',
            message: 'Send both lat and lng, or neither.',
          }],
          requestId,
        );
      }
      const parsed = parseCoordinates({ lat: qLat, lng: qLng });
      if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
      requested = parsed.value;
    }

    const { data: profileRow, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('lat, lng')
      .eq('id', profileId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);

    const hasStored =
      !!profileRow && typeof profileRow.lat === 'number' && typeof profileRow.lng === 'number';
    const lat = requested ? requested.lat : hasStored ? profileRow.lat : NaN;
    const lng = requested ? requested.lng : hasStored ? profileRow.lng : NaN;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return validationError(
        [{
          field: 'location',
          code: 'location_required',
          message: 'No location yet. Finish onboarding, or pass lat and lng.',
        }],
        requestId,
      );
    }

    // Household composition only chooses wording (§8.2).
    let bands = normalizeBands(null);
    {
      const { data: bandRow } = await supabaseAdmin
        .from('household_bands')
        .select('*')
        .eq('profile_id', profileId)
        .maybeSingle();
      if (bandRow) bands = normalizeBands(bandRow);
    }

    // daily_scores has no lat/lng, so only readings for the profile's own
    // location (~1 km) are cached or served from cache.
    const isProfileLocation =
      hasStored && Math.abs(profileRow.lat - lat) < 0.01 && Math.abs(profileRow.lng - lng) < 0.01;

    if (isProfileLocation && !fresh) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      // Today's reading only: backfilled rows for PAST days are also created
      // "just now" (at onboarding), so recency alone would serve yesterday's
      // reading as today's.
      const { data: cachedRow } = await supabaseAdmin
        .from('daily_scores')
        .select('*')
        .eq('profile_id', profileId)
        .eq('date', localDate())
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cachedRow) {
        return NextResponse.json(
          formatDailyPayload({
            ...readingsFromRow(cachedRow),
            cached: true,
            retrievedAt: toIsoUtc(cachedRow.created_at),
            bands,
          }),
          { headers },
        );
      }
    }

    // About to call the providers: one fetch per household per five minutes.
    const allowed = await checkLimit(dailyScoreLimiter, `daily-score:${profileId}`, {
      fallback: true,
      label: 'daily-score limiter',
    });
    if (!allowed) {
      // The shared envelope, plus the legacy retry_after_seconds field next to it.
      const limited = apiError({
        status: 429,
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Readings were just refreshed. Try again in a few minutes.',
        retryAfterSeconds: 300,
        requestId,
      });
      return NextResponse.json({ ...(await limited.json()), retry_after_seconds: 300 }, { status: 429, headers: limited.headers });
    }

    const readings = await fetchDailyReadings(
      { lat, lng },
      {
        openuvAllowed: () =>
          checkLimit(openuvLimiter, 'global_openuv_calls', { fallback: false, label: 'OpenUV limiter' }),
      },
    );
    const retrievedAt = new Date().toISOString();
    const payload = formatDailyPayload({ ...readings, cached: false, retrievedAt, bands });

    if (!isProfileLocation) {
      // Never cache a reading for some other point as this household's.
      return NextResponse.json(payload, { headers });
    }

    const cacheRow = {
      profile_id: profileId,
      // The household's local calendar day (item 10) — readings and journal
      // entries are joined by this date string.
      date: localDate(),
      aqi: readings.aqi,
      uv_index: readings.uvIndex,
      pollen_level: JSON.stringify(readings.pollen),
      mold_risk: readings.mold.risk,
    };
    // Columns some environments may lack; one missing column costs only itself.
    const optionalColumns = {
      score: payload.score.display_score,
      aqi_source: readings.aqiSource,
      details: {
        dominant_pollutant: readings.dominantPollutant,
        uv_peak_window: readings.uvPeakWindow,
        uv_source: readings.uvSource,
        mold_basis: readings.mold.basis,
      },
    };

    // The household's current home, when it is at the stored point this reading is for. Only
    // this own-location row is ever linked; the link is dropped (once, with a warning) when the
    // column does not exist yet, and every other column is kept.
    const homeContextId = await ownHomeContextId(profileId, profileRow);
    let link = homeContextId ? { home_context_id: homeContextId } : {};
    const insert = (columns) => supabaseAdmin.from('daily_scores').insert([{ ...cacheRow, ...columns, ...link }]);

    let { error: insertError } = await insert(optionalColumns);
    if (insertError && homeContextId && isMissingContextLink(insertError)) {
      contextLinkDropped(insertError);
      link = {};
      ({ error: insertError } = await insert(optionalColumns));
    }
    if (insertError && isUndefinedColumnError(insertError)) {
      console.warn('Optional daily_scores column missing; caching without it.', insertError.message);
      const { details, ...withoutDetails } = optionalColumns;
      const { error: retryError } = await insert(withoutDetails);
      if (retryError && isUndefinedColumnError(retryError)) {
        const { error: lastError } = await insert({});
        if (lastError) console.error('Failed to cache daily score:', lastError.message);
      } else if (retryError) {
        console.error('Failed to cache daily score:', retryError.message);
      }
    } else if (insertError) {
      console.error('Failed to cache daily score:', insertError.message);
    }

    return NextResponse.json(payload, { headers });
  } catch (error) {
    const authResponse = authErrorResponse(error, requestId);
    if (authResponse) return authResponse;
    console.error(`Daily score failed (request ${requestId}):`, error);
    return internalError(requestId);
  }
}
