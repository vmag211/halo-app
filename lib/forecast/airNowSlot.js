/**
 * Where the AirNow forecast adapter plugs into `GET /api/forecast` (B10 plan,
 * Tasks 5 and 8). Task 8 merged with the slot empty; Task 5 wired the real
 * adapter (lib/forecast/airnow.js) here, and no other route code changed.
 *
 * With the slot empty the route calls nothing for air and the snapshot
 * builder says so in `coverage.Air` ("Air was not checked. HALO's AirNow
 * forecast connection is not set up."). With the adapter wired but
 * `AIRNOW_API_KEY` unset, the adapter answers `no_key` without a call and the
 * builder says the same thing, so a deployment without the key is honest.
 *
 * The adapter's contract (plan, "Adapter output shapes" and Task 5): called as
 * `adapter(point, { getJson, env, now })`, where `point` is the 2-decimal point
 * from `roundForProvider`, `getJson` is lib/forecast/http.js's, `env` is
 * process.env (it reads AIRNOW_API_KEY and answers `no_key` without a call when
 * it is missing) and `now` a clock function; it resolves, never rejects, to
 * `{ok: true, fetchedAt, rows}` or `{ok: false, reason}`.
 */

import { airNowKey, fetchAirNowForecast } from './airnow.js';

/** @type {null | ((point: {lat: number, lng: number}, options: {getJson: Function, env: Record<string, string|undefined>, now: () => number}) => Promise<any>)} */
let adapter = fetchAirNowForecast;

/** The wired AirNow forecast adapter, or null when a test has emptied the slot. */
export function airNowAdapter() {
  return adapter;
}

/**
 * The wired adapter's answer when it cannot be called at all, decided before the
 * route spends any budget or cache entry on it: `{ok: false, reason: 'no_key'}`
 * for the real adapter without a usable AIRNOW_API_KEY, otherwise null (call it).
 * A deployment without the key then spends no AirNow or household token and
 * logs nothing per request; coverage still says air was not checked.
 * @param {Record<string, string|undefined>} env
 */
export function airNowUnavailable(env) {
  return adapter === fetchAirNowForecast && !airNowKey(env) ? { ok: false, reason: 'no_key' } : null;
}

/**
 * Test hook: stands a function in for the adapter (null empties the slot, as
 * before Task 5; undefined restores the real adapter). Never called by app code.
 */
export function _setAirNowAdapter(fn) {
  if (fn === undefined) {
    adapter = fetchAirNowForecast;
    return;
  }
  if (fn !== null && typeof fn !== 'function') throw new TypeError('_setAirNowAdapter: a function, null or undefined');
  adapter = fn;
}
