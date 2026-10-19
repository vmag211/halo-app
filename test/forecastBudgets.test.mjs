/**
 * The forecast budgets (B10 plan F10, Task 3): lib/forecast/budgets.js, the
 * table, and the five limiters lib/ratelimit.js builds from it.
 *
 * The limiters are built against a FAKE Redis: `Redis.fromEnv` is replaced
 * before lib/ratelimit.js is imported, so every limiter it constructs talks to
 * the fake, and a `.limit()` call shows the exact tokens and window the
 * sliding-window script is sent. No network, no Upstash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Redis } from '@upstash/redis';
import {
  FORECAST_BUDGETS,
  FORECAST_OPEN_METEO_DAILY_DEFAULT,
  FORECAST_OPEN_METEO_DAILY_MAX,
  OPEN_METEO_FREE_TIER,
  forecastBudgets,
  forecastLimitArgs,
  openMeteoDailyLimit,
} from '../lib/forecast/budgets.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Records what each sliding-window evaluation is sent: [tokens, now, windowMs, incrementBy]. */
function fakeRedis() {
  const evals = [];
  return {
    evals,
    async evalsha(_hash, keys, args) {
      evals.push({ keys, args });
      const [tokens] = args;
      return [tokens - 1, tokens];
    },
    async eval(_script, keys, args) {
      return this.evalsha('', keys, args);
    },
    async zincrby() {
      return 1;
    },
  };
}

const redis = fakeRedis();
delete process.env.FORECAST_OPEN_METEO_DAILY_LIMIT;
Redis.fromEnv = () => /** @type {any} */ (redis);
const limiters = await import('../lib/ratelimit.js');

const HOUR = 3_600_000;

/** The tokens and window a limiter really evaluates with. */
async function shapeOf(limiter, key) {
  const before = redis.evals.length;
  await limiter.limit(key);
  const call = redis.evals[before];
  assert.ok(call, 'the limiter reached the fake Redis');
  const [tokens, , windowMs] = call.args;
  return { tokens: Number(tokens), windowMs: Number(windowMs), keys: call.keys };
}

test('each forecast limiter is exported with the stated budget and window', async () => {
  const expected = {
    forecastOpenMeteoDailyLimiter: { tokens: 3000, windowMs: 24 * HOUR },
    forecastOpenMeteoMinuteLimiter: { tokens: 200, windowMs: 60_000 },
    forecastAirNowLimiter: { tokens: 200, windowMs: HOUR },
    forecastNwsLimiter: { tokens: 600, windowMs: HOUR },
    forecastHouseholdLimiter: { tokens: 30, windowMs: HOUR },
  };
  for (const [name, want] of Object.entries(expected)) {
    const limiter = limiters[name];
    assert.ok(limiter, `${name} is exported`);
    const { tokens, windowMs } = await shapeOf(limiter, `probe:${name}`);
    assert.deepEqual({ tokens, windowMs }, want, name);
  }
});

test('the limiters are numbered 13 to 17 after privacyLimiter (12), each with its rationale', () => {
  const source = readFileSync(`${REPO_ROOT}lib/ratelimit.js`, 'utf8');
  const privacy = source.indexOf('export const privacyLimiter');
  const names = ['forecastOpenMeteoDailyLimiter', 'forecastOpenMeteoMinuteLimiter', 'forecastAirNowLimiter', 'forecastNwsLimiter', 'forecastHouseholdLimiter'];
  for (const name of names) assert.ok(source.indexOf(`export const ${name}`) > privacy, `${name} follows privacyLimiter`);
  for (const n of [13, 14, 15, 16, 17]) assert.match(source, new RegExp(`^// ${n}\\. `, 'm'), `rationale ${n}`);
  assert.match(source, /fail-CLOSED: they protect shared free quotas/);
  assert.match(source, /Checked fail-OPEN, the critical-path rule/);
});

test('the table: windows, keys and the fail-closed globals against the fail-open household', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FORECAST_BUDGETS).map(([name, b]) => [name, [b.tokens, b.window, b.key, b.fallback]])),
    {
      openMeteoDaily: [3000, '24 h', 'forecast:open-meteo:day', false],
      openMeteoMinute: [200, '1 m', 'forecast:open-meteo:minute', false],
      airNow: [200, '1 h', 'forecast:airnow:hour', false],
      nws: [600, '1 h', 'forecast:nws:hour', false],
      household: [30, '1 h', 'forecast:', true],
    },
  );
  assert.ok(Object.isFrozen(FORECAST_BUDGETS) && Object.values(FORECAST_BUDGETS).every(Object.isFrozen));
  const keys = Object.values(FORECAST_BUDGETS).map((b) => b.key);
  assert.equal(new Set(keys).size, keys.length, 'no two budgets share an identifier in the one Upstash prefix');
});

test('Open-Meteo is held below every free-tier limit', () => {
  const day = FORECAST_BUDGETS.openMeteoDaily.tokens;
  const minute = FORECAST_BUDGETS.openMeteoMinute.tokens;
  assert.ok(day < OPEN_METEO_FREE_TIER.perDay, 'under the day');
  assert.ok(day < OPEN_METEO_FREE_TIER.perHour, 'a whole day spent inside one hour is still under the hour');
  assert.ok(minute < OPEN_METEO_FREE_TIER.perMinute, 'under the minute');
  assert.ok(FORECAST_OPEN_METEO_DAILY_MAX < OPEN_METEO_FREE_TIER.perHour && FORECAST_OPEN_METEO_DAILY_MAX < OPEN_METEO_FREE_TIER.perDay, 'and so is the largest override');
  assert.deepEqual(OPEN_METEO_FREE_TIER, { perDay: 10_000, perHour: 5_000, perMinute: 600 });
});

test('FORECAST_OPEN_METEO_DAILY_LIMIT: whole numbers honoured, 0 accepted, anything else falls back to 3,000', () => {
  assert.equal(FORECAST_OPEN_METEO_DAILY_DEFAULT, 3000);
  const cases = [
    [undefined, 3000],
    ['', 3000],
    ['   ', 3000],
    ['abc', 3000],
    ['NaN', 3000],
    ['-5', 3000],
    ['1.5', 3000],
    ['1e3', 3000],
    ['0x10', 3000],
    ['Infinity', 3000],
    ['0', 0],
    [' 0 ', 0],
    ['1200', 1200],
    ['4999', 4999],
    ['5000', FORECAST_OPEN_METEO_DAILY_MAX],
    ['99999', FORECAST_OPEN_METEO_DAILY_MAX],
  ];
  for (const [raw, want] of cases) {
    assert.equal(openMeteoDailyLimit(raw), want, JSON.stringify(raw));
    assert.equal(forecastBudgets({ FORECAST_OPEN_METEO_DAILY_LIMIT: raw }).openMeteoDaily.tokens, want, JSON.stringify(raw));
  }
  assert.equal(openMeteoDailyLimit(/** @type {any} */ (500)), 3000, 'only the environment string is read');
  assert.equal(forecastBudgets({ FORECAST_OPEN_METEO_DAILY_LIMIT: '0' }).openMeteoMinute.tokens, 200, 'the override touches only the day');
});

test('0 refuses everything: the exported limiter is built with 0, and the sliding window refuses at 0', () => {
  // A separate process, because the table is read from the environment once, at import.
  const script = `
    import { Redis } from '@upstash/redis';
    const seen = [];
    Redis.fromEnv = () => ({ async evalsha(_h, _k, args) { seen.push(args); return [-1, args[0]]; }, async zincrby() { return 1; } });
    const { forecastOpenMeteoDailyLimiter, forecastOpenMeteoMinuteLimiter } = await import('./lib/ratelimit.js');
    await forecastOpenMeteoDailyLimiter.limit('probe');
    await forecastOpenMeteoMinuteLimiter.limit('probe');
    console.log(JSON.stringify(seen.map((a) => Number(a[0]))));
  `;
  const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', FORECAST_OPEN_METEO_DAILY_LIMIT: '0' },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), [0, 200]);

  // And Upstash's own script refuses any request once used >= tokens, so 0
  // tokens refuses the first one (@upstash/ratelimit, slidingWindowLimitScript).
  const require = createRequire(import.meta.url);
  const dist = readFileSync(require.resolve('@upstash/ratelimit'), 'utf8');
  assert.ok(dist.includes('if incrementBy > 0 and requestsInPreviousWindow + requestsInCurrentWindow >= effectiveLimit then'), 'the library still refuses at used >= limit');
});

test('forecastLimitArgs: fixed keys for the globals, forecast:<profileId> for the household', () => {
  assert.deepEqual(forecastLimitArgs('openMeteoDaily'), { key: 'forecast:open-meteo:day', options: { fallback: false, label: 'Forecast Open-Meteo daily budget' } });
  assert.deepEqual(forecastLimitArgs('airNow').options.fallback, false);
  assert.deepEqual(forecastLimitArgs('nws').options.fallback, false);
  assert.deepEqual(forecastLimitArgs('openMeteoMinute').options.fallback, false);
  const id = '5b0e4f1c-2a8d-4c3e-9f6a-1d2e3f4a5b6c';
  assert.deepEqual(forecastLimitArgs('household', { profileId: id }), { key: `forecast:${id}`, options: { fallback: true, label: 'Forecast household budget' } });
  assert.throws(() => forecastLimitArgs('household'), TypeError);
  for (const profileId of ['', 'a:b', 'a b', 'x'.repeat(65)]) assert.throws(() => forecastLimitArgs('household', { profileId }), TypeError, profileId);
  assert.throws(() => forecastLimitArgs(/** @type {any} */ ('dailyScore')), TypeError);
  assert.throws(() => forecastLimitArgs(/** @type {any} */ ('toString')), TypeError);
});

test('during an Upstash outage the globals refuse and the household is allowed', async () => {
  const broken = { limit: async () => Promise.reject(new Error('Upstash unreachable')) };
  const lines = [];
  const saved = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    for (const name of ['openMeteoDaily', 'openMeteoMinute', 'airNow', 'nws']) {
      const { key, options } = forecastLimitArgs(name);
      assert.equal(await limiters.checkLimit(broken, key, options), false, `${name} fails closed`);
    }
    const { key, options } = forecastLimitArgs('household', { profileId: 'p1' });
    assert.equal(await limiters.checkLimit(broken, key, options), true, 'household fails open');
  } finally {
    console.error = saved;
  }
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^Forecast Open-Meteo daily budget unavailable \(Error: Upstash unreachable\); skipping the call\.$/);
  assert.match(lines[4], /^Forecast household budget unavailable \(Error: Upstash unreachable\); allowing the call\.$/);
});

test('a slow Upstash (the library answers success with reason timeout) is an outage, not an allow', async () => {
  const slow = { limit: async () => ({ success: true, limit: 0, remaining: 0, reset: 0, reason: 'timeout' }) };
  const saved = console.error;
  console.error = () => {};
  try {
    const global = forecastLimitArgs('openMeteoDaily');
    assert.equal(await limiters.checkLimit(slow, global.key, global.options), false, 'a fail-closed budget stays closed');
    const household = forecastLimitArgs('household', { profileId: 'p1' });
    assert.equal(await limiters.checkLimit(slow, household.key, household.options), true);
  } finally {
    console.error = saved;
  }
});

test('the route harness stub exports the forecast limiters, allowing everything', async () => {
  const stub = await import('./helpers/stubs/ratelimit.mjs');
  for (const name of ['forecastOpenMeteoDailyLimiter', 'forecastOpenMeteoMinuteLimiter', 'forecastAirNowLimiter', 'forecastNwsLimiter', 'forecastHouseholdLimiter']) {
    assert.equal((await stub[name].limit('k')).success, true, name);
  }
});
