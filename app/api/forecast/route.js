import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import {
  checkLimit,
  forecastOpenMeteoDailyLimiter,
  forecastOpenMeteoMinuteLimiter,
  forecastAirNowLimiter,
  forecastNwsLimiter,
  forecastHouseholdLimiter,
} from '@/lib/ratelimit';
import { forecastLimitArgs } from '@/lib/forecast/budgets';
import { cached, peekCached, hourKey, lastConfirmedKey, storeCached } from '@/lib/forecast/cache';
import { getJson } from '@/lib/forecast/http';
import { resolveForecastPlace, roundForProvider } from '@/lib/forecast/place';
import { fetchOpenMeteo } from '@/lib/forecast/openMeteo';
import { fetchActiveAlerts } from '@/lib/forecast/nwsAlerts';
import { airNowAdapter } from '@/lib/forecast/airNowSlot';
import { buildForecastSnapshot } from '@/lib/forecast/snapshot';
import { COPY } from '@/lib/forecast/copy';
import { parseIsoDate, parseText } from '@/lib/validate';
import { ERROR_CODES, apiError, requestIdFor, validationError, internalError, loggableError } from '@/lib/apiErrors';

/**
 * GET /api/forecast?date=YYYY-MM-DD&place=<free text> (operation `forecast.read`,
 * B10 Task 8). The outdoor planner's forecast snapshot for one date.
 *
 * F1, place. `place` empty (or absent) means the household's saved home: the
 *   caller's own `profiles` row (lat, lng), read owner-scoped and only then;
 *   `X-Halo-Home-Context` is ignored. No saved point is an empty snapshot
 *   (`no_home`). Typed text resolves through the Census gazetteer
 *   (lib/forecast/place.js), exact matches only; unmatched, ambiguous and
 *   outside are empty snapshots made with no provider call and no limiter
 *   token, so keystrokes are free. The typed text is never logged, cached or
 *   stored: logs carry a fixed reason token only, and every cache key and
 *   provider URL is built from `roundForProvider` (2 decimals, F3).
 * F9, cache. Provider data is cached, never the snapshot: memory, then Upstash,
 *   then the provider, under hour keys (NWS alerts ten-minute slots), a failure
 *   remembered for 60 s. Ruling F18-S: every confirmed Open-Meteo forecast is
 *   also kept under an hour-free key, and while Open-Meteo answers
 *   `run_unknown` that last confirmed forecast is served with `stale: true`
 *   (the builder caps it at 8 hours and sets expiresAt = now + 30 min); with
 *   none, 503 with Retry-After from the adapter's `retryAfterMs`.
 * F10, budgets. The household limiter (`forecast:<profileId>`, fail-open) is
 *   spent once, and only when a provider would be called after both cache
 *   layers missed; a refusal is 429. Each provider call first takes its global
 *   budget (fail-closed); a refusal is that provider's `budget` failure.
 * F21, statuses. 200 populated or empty (`periods: []`); 400 for a missing or
 *   non-calendar date, or a place over 100 characters or with control
 *   characters, before anything is read or fetched; 401 without a session;
 *   429 household budget; 503 with Retry-After when Open-Meteo did not answer
 *   usably or the profile read failed. AirNow or NWS failing alone is still a
 *   200. The 503 `reason` from the builder is a log token, never in the body.
 *   No top-level `data` key. Cache-Control: private, no-store on every answer.
 *
 * AirNow (Task 5) plugs in through lib/forecast/airNowSlot.js; until then air
 * is not called and coverage says so. Provider calls are not aborted when the
 * client disconnects (F8), so a superseded keystroke still fills the cache.
 *
 * Worst case under the 15 s budget: Open-Meteo is metadata (3 s), forecast
 * (6 s), metadata (3 s), in parallel with NWS (6 s); store calls are bounded at
 * STORE_TIMEOUT_MS each.
 */
export const maxDuration = 15;

/** F9 lifetimes, in seconds. */
const TTL = Object.freeze({ openMeteo: 7200, airNow: 7200, nws: 1200 });
/** F18-S: the last confirmed forecast outlives the builder's 8-hour cap, so the builder is what refuses it. */
const LAST_CONFIRMED_TTL_SECONDS = 9 * 3600;
const NEGATIVE_SECONDS = 60;
const STORE_TIMEOUT_MS = 1000;
/** The household budget is 30 an hour, one every 120 s on average. */
const HOUSEHOLD_RETRY_SECONDS = 120;
/** A profile read that failed: try again in a minute. */
const PROFILE_RETRY_SECONDS = 60;
const PLACE_MAX_LENGTH = 100;

const PLACE_KINDS = new Set(['home', 'matched', 'unmatched', 'ambiguous', 'outside']);
const EMPTY_KINDS = new Set(['unmatched', 'ambiguous', 'outside']);

const NO_STORE = 'private, no-store';

function withHeaders(response) {
  response.headers.set('Cache-Control', NO_STORE);
  return response;
}

function unavailable(requestId, retryAfterSeconds) {
  return withHeaders(apiError({
    status: 503,
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: COPY.errors.unavailable,
    retryAfterSeconds,
    requestId,
  }));
}

function snapshotResponse(built, requestId, reasonForLog) {
  if (built.status === 200) {
    return NextResponse.json(built.body, { status: 200, headers: { 'X-Request-Id': requestId, 'Cache-Control': NO_STORE } });
  }
  // The builder's reason is a fixed token (open_meteo_<reason>, zone, stale): logged, never sent.
  console.error(`Forecast unavailable: ${reasonForLog ?? built.reason}`);
  return unavailable(requestId, built.retryAfter);
}

/** Both Open-Meteo budgets, the day first so a refused day spends no minute token. */
async function openMeteoAllowed() {
  for (const name of ['openMeteoDaily', 'openMeteoMinute']) {
    const { key, options } = forecastLimitArgs(name);
    const limiter = name === 'openMeteoDaily' ? forecastOpenMeteoDailyLimiter : forecastOpenMeteoMinuteLimiter;
    if (!(await checkLimit(limiter, key, options))) return false;
  }
  return true;
}

async function globalAllowed(name, limiter) {
  const { key, options } = forecastLimitArgs(name);
  return checkLimit(limiter, key, options);
}

const BUDGET = Object.freeze({ ok: false, reason: 'budget' });

/** The providers for one point, each with its key, lifetime and call. */
function providersFor(point, now) {
  const clock = () => Date.now();
  const openMeteo = {
    name: 'open-meteo',
    key: hourKey('open-meteo', point, now),
    ttlSeconds: TTL.openMeteo,
    // The cache keeps a failure's reason only; the adapter's exact `retryAfterMs` (run_unknown inside
    // the documented wait) is kept here for this request's Retry-After.
    retryAfterMs: undefined,
    produce: async () => {
      if (!(await openMeteoAllowed())) return BUDGET;
      const answer = await fetchOpenMeteo(point, { getJson, now: clock });
      openMeteo.retryAfterMs = answer?.retryAfterMs;
      return answer;
    },
  };
  const list = [
    openMeteo,
    {
      name: 'nws-alerts',
      key: hourKey('nws-alerts', point, now, { slotMinutes: 10 }),
      ttlSeconds: TTL.nws,
      produce: async () => ((await globalAllowed('nws', forecastNwsLimiter)) ? fetchActiveAlerts(point, { getJson, env: process.env, now: clock }) : BUDGET),
    },
  ];
  const airNow = airNowAdapter();
  if (airNow) {
    list.push({
      name: 'airnow',
      key: hourKey('airnow', point, now),
      ttlSeconds: TTL.airNow,
      produce: async () => ((await globalAllowed('airNow', forecastAirNowLimiter)) ? airNow(point, { getJson, env: process.env, now: clock }) : BUDGET),
    });
  }
  return list;
}

const cacheOptions = (ttlSeconds) => ({ ttlSeconds, negativeSeconds: NEGATIVE_SECONDS, storeTimeoutMs: STORE_TIMEOUT_MS, now: () => Date.now() });

/** A fresh provider failure, as a fixed token (adapters reduce every reason to [a-z0-9_]). */
function logFailure(name, outcome) {
  if (outcome.source !== 'provider' || outcome.result?.ok === true) return;
  const reason = typeof outcome.result?.reason === 'string' && /^[a-z0-9_]{1,40}$/.test(outcome.result.reason) ? outcome.result.reason : 'invalid';
  console.error(`Forecast provider ${name} not used: ${reason}`);
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    // Identity comes from the verified session, never a query parameter or header.
    const { userId: profileId } = await requireUser(request);

    const { searchParams } = new URL(request.url);
    // F21: the date, then the place, both before anything is read or fetched.
    const date = parseIsoDate(searchParams.get('date'));
    if (!date.ok) return withHeaders(validationError([{ field: 'date', code: date.code, message: date.message }], requestId));
    const rawPlace = searchParams.get('place') ?? '';
    const placeText = parseText(rawPlace, { maxLength: PLACE_MAX_LENGTH, trim: false, rejectControl: true });
    if (!placeText.ok) return withHeaders(validationError([{ field: 'place', code: placeText.code, message: placeText.message }], requestId));

    const resolved = resolveForecastPlace(rawPlace);
    if (!resolved || !PLACE_KINDS.has(resolved.kind)) {
      return withHeaders(validationError([{ field: 'place', code: 'invalid_place', message: COPY.errors.placeUnreadable }], requestId));
    }
    const now = Date.now();

    if (EMPTY_KINDS.has(resolved.kind)) {
      return snapshotResponse(buildForecastSnapshot({ place: resolved, date: date.value, now }), requestId);
    }

    let place = resolved;
    let point = null;
    if (resolved.kind === 'home') {
      // The caller's own row, and only when no place was typed.
      const { data: profile, error } = await supabaseAdmin.from('profiles').select('lat, lng').eq('id', profileId).maybeSingle();
      if (error) {
        // The code alone: a database message can quote what was asked for.
        console.error(`Forecast profile read failed: ${typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'unknown'}`);
        return unavailable(requestId, PROFILE_RETRY_SECONDS);
      }
      point = profile ? roundForProvider({ lat: profile.lat, lng: profile.lng }) : null;
      if (!point) place = { kind: 'no_home' };
    } else {
      point = roundForProvider({ lat: resolved.lat, lng: resolved.lng });
      if (!point) {
        console.error('Forecast unavailable: gazetteer_point');
        return unavailable(requestId, PROFILE_RETRY_SECONDS);
      }
    }
    if (place.kind === 'no_home') {
      return snapshotResponse(buildForecastSnapshot({ place, date: date.value, now }), requestId);
    }

    // F10: the household budget is spent once, only when some provider would be called.
    const providers = providersFor(point, now);
    const peeked = await Promise.all(providers.map((p) => peekCached(p.key, cacheOptions(p.ttlSeconds))));
    if (peeked.some((hit) => hit === null)) {
      const { key, options } = forecastLimitArgs('household', { profileId });
      if (!(await checkLimit(forecastHouseholdLimiter, key, options))) {
        return withHeaders(apiError({
          status: 429,
          code: ERROR_CODES.RATE_LIMITED,
          message: COPY.errors.rateLimited,
          retryAfterSeconds: HOUSEHOLD_RETRY_SECONDS,
          requestId,
        }));
      }
    }

    const outcomes = await Promise.all(providers.map((p, i) => peeked[i] ?? cached(p.key, cacheOptions(p.ttlSeconds), p.produce)));
    const byName = Object.fromEntries(providers.map((p, i) => [p.name, outcomes[i]]));
    for (const [name, outcome] of Object.entries(byName)) logFailure(name, outcome);

    const fetched = byName['open-meteo'].result;
    const exactRetry = providers.find((p) => p.name === 'open-meteo').retryAfterMs;
    const openMeteo = fetched.ok !== true && fetched.retryAfterMs === undefined && Number.isFinite(exactRetry)
      ? { ...fetched, retryAfterMs: exactRetry }
      : fetched;
    const inputs = {
      place,
      date: date.value,
      now,
      airNow: byName.airnow?.result,
      alerts: byName['nws-alerts'].result,
    };
    const lastKey = lastConfirmedKey('open-meteo', point);
    const lastOptions = cacheOptions(LAST_CONFIRMED_TTL_SECONDS);

    if (openMeteo.ok === true) {
      // F18-S: a confirmed forecast just fetched becomes the one served while a later run is unknown.
      if (byName['open-meteo'].source === 'provider') await storeCached(lastKey, lastOptions, openMeteo);
      return snapshotResponse(buildForecastSnapshot({ ...inputs, openMeteo }), requestId);
    }

    if (openMeteo.reason === 'run_unknown') {
      const last = await peekCached(lastKey, lastOptions);
      if (last && last.result?.ok === true) {
        const stale = buildForecastSnapshot({ ...inputs, openMeteo: last.result, stale: true });
        if (stale.status === 200) return snapshotResponse(stale, requestId);
        // Past the builder's 8-hour cap the last run is as good as none.
        return snapshotResponse(buildForecastSnapshot({ ...inputs, openMeteo }), requestId, `open_meteo_run_unknown_${stale.reason}`);
      }
    }
    return snapshotResponse(buildForecastSnapshot({ ...inputs, openMeteo }), requestId);
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return withHeaders(authResponse);
    console.error('Forecast failed:', loggableError(err));
    return withHeaders(internalError(requestId));
  }
}
