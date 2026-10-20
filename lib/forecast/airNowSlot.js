/**
 * Where the AirNow forecast adapter plugs into `GET /api/forecast` (B10 plan,
 * Tasks 5 and 8). Task 5 is gated on the authenticated AirNow documentation
 * (Open question 2), so Task 8 merges with AirNow absent: `airNowAdapter()` is
 * null, the route calls nothing for air, and the snapshot builder says so in
 * `coverage.Air` ("Air was not checked. HALO's AirNow forecast connection is
 * not set up."). No other forecast code changes when Task 5 lands.
 *
 * TASK 5 WIRES ITS ADAPTER WITH ONE LINE here, replacing `let adapter = null;`:
 *
 *   import { fetchAirNowForecast } from './airnow.js';
 *   let adapter = fetchAirNowForecast;
 *
 * The adapter's contract (plan, "Adapter output shapes" and Task 5): called as
 * `adapter(point, { getJson, env, now })`, where `point` is the 2-decimal point
 * from `roundForProvider`, `getJson` is lib/forecast/http.js's, `env` is
 * process.env (it reads AIRNOW_API_KEY and answers `no_key` without a call when
 * it is missing) and `now` a clock function; it resolves, never rejects, to
 * `{ok: true, fetchedAt, rows}` or `{ok: false, reason}`.
 */

/** @type {null | ((point: {lat: number, lng: number}, options: {getJson: Function, env: Record<string, string|undefined>, now: () => number}) => Promise<any>)} */
let adapter = null;

/** The wired AirNow forecast adapter, or null while Task 5 has not landed. */
export function airNowAdapter() {
  return adapter;
}

/**
 * Test hook: stands a function in for the adapter (null removes it). The route
 * tests use it to prove the wiring (cache, budget, failure coverage) before
 * Task 5 exists. Never called by app code.
 */
export function _setAirNowAdapter(fn) {
  if (fn !== null && typeof fn !== 'function') throw new TypeError('_setAirNowAdapter: a function or null');
  adapter = fn;
}
