/**
 * The world GET /api/forecast runs in under test (B10 Task 8; reused by Task 9's
 * contract suite): a fetch stub per provider host answering the recorded
 * fixtures in test/fixtures/forecast/, a fake Upstash REST server that the real
 * @upstash/redis client (the forecast cache's default store) talks to, a
 * recording `rateLimit` for the limiter stub, and a stand-in for the AirNow
 * adapter (Task 5 is not built; lib/forecast/airNowSlot.js is where it plugs in).
 *
 *   const w = forecastWorld();
 *   const h = forecastHarness(w);
 *   t.mock.timers.enable({ apis: ['Date'], now: FORECAST_NOW });
 *   const res = await callForecast(h, { place: 'Charlotte' });
 *   w.counts()   -> { forecast, meta, airnow, nws } provider requests made
 *   w.limits     -> every limiter key checked, in order
 *   w.upstash    -> { data, commands, fail } the store's keys, values and commands
 *
 * Call `_resetForecastCache()` (lib/forecast/cache.js) before each test: the
 * cache's memory and resolved store are per process, shared by every harness.
 * No real network: any other host is recorded in `w.unexpected` and rejected.
 */
import { readFileSync } from 'node:fs';
import { createRouteHarness } from './routeHarness.mjs';
import { haloTables } from './tables.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/forecast/${name}`, import.meta.url), 'utf8')).response;

export const FIXTURES = Object.freeze({
  forecast: fixture('open-meteo-forecast-charlotte.json'),
  meta013: fixture('open-meteo-meta-gfs013.json'),
  meta025: fixture('open-meteo-meta-gfs025.json'),
  nwsNone: fixture('nws-alerts-none-charlotte.json'),
});

/** When the fixtures were captured; both grids hold the 12Z run, available 18:29:04Z (wait over at 18:39:04Z). */
export const FORECAST_NOW = Date.parse('2026-10-19T20:07:00Z');
export const HOUR = 3_600_000;
/** Tomorrow in America/New_York at FORECAST_NOW. */
export const FORECAST_DATE = '2026-10-20';
/** The run both metadata fixtures report. */
export const FORECAST_RUN = '2026-10-19T12:00:00.000Z';

/** Alice's saved home rounds to 35.23,-80.84 (F3); Bob's is Raleigh; Carol has none. */
export const ALICE_HOME = Object.freeze({ lat: 35.227, lng: -80.843 });
export const BOB_HOME = Object.freeze({ lat: 35.781, lng: -78.639 });

export const FORECAST_ENV = Object.freeze({
  NWS_CONTACT: 'forecast-ops@halo.test',
  UPSTASH_REDIS_REST_URL: 'https://redis.forecast.test',
  UPSTASH_REDIS_REST_TOKEN: 'fake-upstash-token',
  AIRNOW_API_KEY: 'FAKE-AIRNOW-KEY-7c1e',
});

/** AirNow-shaped rows for Charlotte: ozone with a number, PM2.5 category only (AQI -1). */
export const AIRNOW_ROWS = Object.freeze([
  { DateIssue: '2026-10-19 ', DateForecast: '2026-10-20 ', ReportingArea: 'Charlotte', StateCode: 'NC', ParameterName: 'O3', AQI: 41, Category: { Number: 1, Name: 'Good' }, ActionDay: false },
  { DateIssue: '2026-10-19 ', DateForecast: '2026-10-20 ', ReportingArea: 'Charlotte', StateCode: 'NC', ParameterName: 'PM2.5', AQI: -1, Category: { Number: 2, Name: 'Moderate' }, ActionDay: false },
]);

/**
 * Stands in for Task 5's adapter, with its contract (lib/forecast/airNowSlot.js): no key, no call;
 * the key in the query string; one row per received row; never throws. Not the real request shape,
 * which is gated on the authenticated AirNow documentation.
 */
export async function airNowStandIn(point, { getJson, env, now }) {
  const key = env.AIRNOW_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };
  const fetchedAt = new Date(now()).toISOString();
  const r = await getJson(`https://airnow.forecast.test/aq/forecast/latLong/?format=application/json&latitude=${point.lat}&longitude=${point.lng}&distance=25&API_KEY=${key}`, { timeoutMs: 6000 });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (!Array.isArray(r.json)) return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    fetchedAt,
    rows: r.json.map((row) => ({
      dateIssue: row.DateIssue,
      dateForecast: row.DateForecast,
      reportingArea: row.ReportingArea,
      stateCode: row.StateCode,
      parameter: row.ParameterName,
      aqi: row.AQI === -1 ? null : row.AQI,
      category: row.Category?.Name ?? null,
      actionDay: row.ActionDay === true,
    })),
  };
}

/**
 * Upstash's REST protocol, enough for the real client: one command or a
 * /pipeline batch, `Upstash-Encoding: base64` honoured, get/set with ex and nx.
 * `fail` answers every command with a 500, the way an Upstash outage reaches
 * @upstash/redis (it throws UpstashError at once, without retrying).
 */
export function fakeUpstash() {
  const u = { data: new Map(), commands: [], fail: false };
  const run = ([op, key, ...rest], base64) => {
    u.commands.push([op, key, ...rest]);
    if (op === 'get') {
      const value = u.data.get(key);
      if (value === undefined) return null;
      return base64 ? Buffer.from(value, 'utf8').toString('base64') : value;
    }
    if (op === 'set') {
      const flags = rest.slice(1).map((x) => String(x).toLowerCase());
      if (flags.includes('nx') && u.data.has(key)) return null;
      u.data.set(key, String(rest[0]));
      return 'OK';
    }
    throw new Error(`fake Upstash: unsupported command ${op}`);
  };
  u.handle = async (url, init) => {
    if (u.fail) return new Response(JSON.stringify({ error: 'ERR fake outage' }), { status: 500 });
    const body = JSON.parse(init.body);
    const base64 = new Headers(init.headers).get('upstash-encoding') === 'base64';
    if (Array.isArray(body[0])) return Response.json(body.map((command) => ({ result: run(command, base64) })));
    return Response.json({ result: run(body, base64) });
  };
  return u;
}

const KINDS = [
  ['meta', (u) => u.origin === 'https://api.open-meteo.com' && /^\/data\/ncep_gfs0(13|25)\/static\/meta\.json$/.test(u.pathname)],
  ['forecast', (u) => u.origin === 'https://api.open-meteo.com' && u.pathname === '/v1/forecast'],
  ['nws', (u) => u.origin === 'https://api.weather.gov' && u.pathname === '/alerts/active'],
  ['airnow', (u) => u.origin === 'https://airnow.forecast.test' && u.pathname === '/aq/forecast/latLong/'],
];

/**
 * The providers and the store, as one fetch. `w.calls` lists every provider
 * request ({kind, url, headers}); `w.unexpected` any other host; `w.status[kind]`
 * makes a provider answer that HTTP status; `w.meta013`/`w.meta025`, `w.forecast`,
 * `w.nws` and `w.airnow` are the bodies served (edit them per test); `w.decide`
 * answers each limiter key (true allows, false refuses, LIMITER_UNAVAILABLE is
 * an Upstash outage).
 */
export function forecastWorld() {
  const w = {
    calls: [],
    unexpected: [],
    status: {},
    upstash: fakeUpstash(),
    meta013: structuredClone(FIXTURES.meta013),
    meta025: structuredClone(FIXTURES.meta025),
    forecast: structuredClone(FIXTURES.forecast),
    nws: structuredClone(FIXTURES.nwsNone),
    airnow: structuredClone(AIRNOW_ROWS),
    limits: [],
    decide: () => true,
  };
  w.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    if (u.origin === FORECAST_ENV.UPSTASH_REDIS_REST_URL) return w.upstash.handle(url, init);
    const kind = KINDS.find(([, match]) => match(u))?.[0];
    if (!kind) {
      w.unexpected.push(`${u.origin}${u.pathname}`);
      throw new TypeError('forecastWorld: unexpected host');
    }
    w.calls.push({ kind, url, headers: { ...init.headers } });
    if (w.status[kind]) return new Response('{"error":true,"reason":"stubbed failure"}', { status: w.status[kind] });
    const body = kind === 'meta' ? (u.pathname.includes('gfs013') ? w.meta013 : w.meta025) : w[kind];
    return Response.json(body);
  };
  w.count = (kind) => w.calls.filter((c) => c.kind === kind).length;
  w.counts = () => Object.fromEntries(['forecast', 'meta', 'airnow', 'nws'].map((k) => [k, w.count(k)]));
  w.reset = () => {
    w.calls.length = 0;
    w.limits.length = 0;
  };
  return w;
}

/** A route harness in world `w`: alice (home), bob (another home) and carol (no home). */
export function forecastHarness(w, { tables = haloTables('profiles'), env = FORECAST_ENV } = {}) {
  return createRouteHarness({
    tables,
    identities: { alice: {}, bob: {}, carol: {} },
    seed: ({ alice, bob, carol }) => (tables.profiles
      ? { profiles: [{ id: alice.id, ...ALICE_HOME }, { id: bob.id, ...BOB_HOME }, { id: carol.id, lat: null, lng: null }] }
      : {}),
    fetch: w.fetch,
    env,
    rateLimit: (key) => {
      w.limits.push(key);
      return w.decide(key);
    },
  });
}

/** The request the client sends: runtime.ts builds `?date=..&place=..` with URLSearchParams, keeping an empty place. */
export function callForecast(h, { as = 'alice', date = FORECAST_DATE, place = '', headers, query } = {}) {
  const params = query ?? `?${new URLSearchParams({ date, place })}`;
  return h.call('/api/forecast', 'GET', { as, url: `/api/forecast${params}`, headers });
}

/** Captures every console line for one test (and keeps the test output quiet). */
export function captureLogs(t) {
  const lines = [];
  for (const method of ['error', 'warn', 'log', 'info']) {
    t.mock.method(console, method, (...args) => lines.push(args.map(String).join(' ')));
  }
  return lines;
}
