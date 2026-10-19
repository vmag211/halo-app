/**
 * The forecast budgets (plan F10), as data: how many calls, over what window,
 * under which limiter key, and which way each fails when Upstash is down.
 * lib/ratelimit.js builds its five forecast limiters from this table, and the
 * route (Task 8) takes its keys and fallbacks from here, so the number, the
 * window and the fail-open or fail-closed choice live in one place. This file
 * touches no Redis, which is why it is separate: the route harness replaces
 * lib/ratelimit.js with a stub, and this table must stay real in tests.
 *
 * API (for Task 8):
 *
 *   FORECAST_BUDGETS.<name> = { tokens, window, key, fallback, label }
 *     names: openMeteoDaily, openMeteoMinute, airNow, nws, household
 *   forecastLimitArgs(name, { profileId })
 *     -> { key, options: { fallback, label } }, the arguments for
 *        `checkLimit(limiter, key, options)`. Only `household` takes a
 *        profileId, and requires one.
 *
 *   Open-Meteo is reached only when BOTH Open-Meteo limiters allow. A refused
 *   or unreachable global limiter is `{ok: false, reason: 'budget'}` from the
 *   adapter call site, which the cache remembers for a minute and the snapshot
 *   reports honestly as unavailable (F21: 503 for Open-Meteo, "not checked"
 *   air for AirNow, the frontend's fallback notice for NWS). Never stale data
 *   presented as fresh: a budget refusal serves nothing it did not just have
 *   in cache under the current hour's key.
 */

/** Open-Meteo's free tier: "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute" (open-meteo.com/en/terms, retrieved 2026-10-19). */
export const OPEN_METEO_FREE_TIER = Object.freeze({ perDay: 10_000, perHour: 5_000, perMinute: 600 });

/** A third of the free day, because /api/daily-score and the cron spend the same quota (F10). */
export const FORECAST_OPEN_METEO_DAILY_DEFAULT = 3_000;

/**
 * The most FORECAST_OPEN_METEO_DAILY_LIMIT may raise the day to. Below the
 * free tier's HOURLY limit, so even a whole day's budget spent inside one hour
 * stays under every Open-Meteo limit; the minute limiter (200) stays the
 * binding bound on bursts. A larger value is clamped here, never honoured.
 *
 * That holds for FORECAST traffic alone. The daily cron (vercel.json,
 * 0 11 * * *) also spends the same free quota with no limiter: one Open-Meteo
 * forecast call per profile for UV, and sometimes an air-quality call
 * (lib/dailyReadings.js:160,174), for up to 5,000 profiles inside about one
 * hour. At the 4,999 cap there is almost no room left in that hour, so keep
 * the default 3,000 (B10 Task 3 review, N2; raised with Vibhav).
 */
export const FORECAST_OPEN_METEO_DAILY_MAX = OPEN_METEO_FREE_TIER.perHour - 1;

/**
 * Reads FORECAST_OPEN_METEO_DAILY_LIMIT. A whole number from 0 is honoured
 * (`0` refuses every Open-Meteo call: the operational kill switch, F11), up
 * to FORECAST_OPEN_METEO_DAILY_MAX. Unset, empty, negative, fractional or not
 * a number falls back to the default.
 * @param {string|undefined} raw
 */
export function openMeteoDailyLimit(raw) {
  if (typeof raw !== 'string') return FORECAST_OPEN_METEO_DAILY_DEFAULT;
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text)) return FORECAST_OPEN_METEO_DAILY_DEFAULT;
  return Math.min(Number(text), FORECAST_OPEN_METEO_DAILY_MAX);
}

/**
 * The table, read once from the environment given.
 * @param {Record<string, string|undefined>} [env]
 */
export function forecastBudgets(env = process.env) {
  return Object.freeze({
    // Global, fail-CLOSED: protects a shared free quota whose terms bind HALO.
    openMeteoDaily: Object.freeze({
      tokens: openMeteoDailyLimit(env.FORECAST_OPEN_METEO_DAILY_LIMIT),
      window: '24 h',
      key: 'forecast:open-meteo:day',
      fallback: false,
      label: 'Forecast Open-Meteo daily budget',
    }),
    // Global, fail-CLOSED: a third of the 600 per minute free limit.
    openMeteoMinute: Object.freeze({
      tokens: 200,
      window: '1 m',
      key: 'forecast:open-meteo:minute',
      fallback: false,
      label: 'Forecast Open-Meteo minute budget',
    }),
    // Global, fail-CLOSED: under the reported 500 per hour per key, leaving
    // room for the observation calls the cron and daily-score make with it.
    airNow: Object.freeze({
      tokens: 200,
      window: '1 h',
      key: 'forecast:airnow:hour',
      fallback: false,
      label: 'Forecast AirNow budget',
    }),
    // Global, fail-CLOSED: NWS publishes no limit, so a fixed ceiling.
    nws: Object.freeze({
      tokens: 600,
      window: '1 h',
      key: 'forecast:nws:hour',
      fallback: false,
      label: 'Forecast NWS alerts budget',
    }),
    // Per household, fail-OPEN (the critical-path rule): counted only when a
    // request would reach a provider after both caches missed.
    household: Object.freeze({
      tokens: 30,
      window: '1 h',
      key: 'forecast:', // a prefix: forecastLimitArgs appends the profile id
      fallback: true,
      label: 'Forecast household budget',
    }),
  });
}

export const FORECAST_BUDGETS = forecastBudgets();

// The verified id from requireUser (a UUID in production). Only the character
// set is checked, so a key can never be widened with a colon or whitespace.
const PROFILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @param {'openMeteoDaily'|'openMeteoMinute'|'airNow'|'nws'|'household'} name
 * @param {{profileId?: string}} [options]
 * @returns {{key: string, options: {fallback: boolean, label: string}}}
 */
export function forecastLimitArgs(name, { profileId } = {}) {
  const budget = Object.hasOwn(FORECAST_BUDGETS, name) ? FORECAST_BUDGETS[/** @type {keyof typeof FORECAST_BUDGETS} */ (name)] : null;
  if (!budget) throw new TypeError(`forecastLimitArgs: unknown budget ${name}`);
  let key = budget.key;
  if (name === 'household') {
    if (typeof profileId !== 'string' || !PROFILE_ID_RE.test(profileId)) throw new TypeError('forecastLimitArgs: household needs the verified profile id');
    key = `${budget.key}${profileId}`;
  }
  return { key, options: { fallback: budget.fallback, label: budget.label } };
}
