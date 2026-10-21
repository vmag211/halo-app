/**
 * lib/forecast/cache.js, the forecast provider cache (B10 plan F9, Task 3).
 * Memory, then the store, then the provider; only a good answer is cached as
 * good; a failure is remembered for a minute and then retried. The store is a
 * fake with Upstash's get/set shape and the clock is injected. No network.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  cached,
  peekCached,
  hourKey,
  lastConfirmedKey,
  storeCached,
  _resetForecastCache,
  _forecastMemorySize,
  ENVELOPE_VERSION,
} from '../lib/forecast/cache.js';
import { withSandbox, blockedFetch } from './helpers/sandbox.mjs';

const T0 = Date.parse('2026-10-24T14:05:00Z');
const CHARLOTTE = { lat: 35.23, lng: -80.84 };
const KEY = hourKey('open-meteo', CHARLOTTE, T0);
const GOOD = { ok: true, fetchedAt: '2026-10-24T14:05:00.000Z', hours: [{ t: 1, temperatureF: 64, uv: null }] };

beforeEach(() => _resetForecastCache());

/** A fake Upstash store: get/set, `ex` recorded, `nx` honoured, and a switch to make calls throw. */
function fakeStore() {
  const data = new Map();
  const calls = [];
  const store = {
    data,
    calls,
    failGet: false,
    failSet: false,
    hangGet: false,
    async get(key) {
      calls.push(['get', key]);
      if (store.failGet) throw Object.assign(new Error('Upstash unreachable'), { code: 'ECONNRESET' });
      if (store.hangGet) return new Promise(() => {});
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value, options) {
      calls.push(['set', key, options]);
      if (store.failSet) throw new Error('Upstash unreachable');
      if (options?.nx && data.has(key)) return null;
      data.set(key, structuredClone(value));
      return 'OK';
    },
  };
  return store;
}

function clock(start = T0) {
  const c = { t: start, now: () => c.t };
  return c;
}

function counter(answer) {
  const p = async () => {
    p.calls += 1;
    return typeof answer === 'function' ? answer(p.calls) : structuredClone(answer);
  };
  p.calls = 0;
  return p;
}

async function captureErrors(work) {
  const lines = [];
  const saved = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    return { value: await work(), lines };
  } finally {
    console.error = saved;
  }
}

// --- hourKey -----------------------------------------------------------------

test('hourKey: the F9 layout, two decimals and the UTC hour', () => {
  assert.equal(KEY, 'halo:forecast:v1:open-meteo:35.23,-80.84:2026102414');
  assert.equal(hourKey('airnow', { lat: 35.2271, lng: -80.8431 }, new Date(T0)), 'halo:forecast:v1:airnow:35.23,-80.84:2026102414');
});

test('hourKey: 35.2271,-80.8431 and 35.2349,-80.8389 share a key at 2 decimals', () => {
  assert.equal(hourKey('open-meteo', { lat: 35.2271, lng: -80.8431 }, T0), hourKey('open-meteo', { lat: 35.2349, lng: -80.8389 }, T0));
  assert.notEqual(hourKey('open-meteo', { lat: 35.2271, lng: -80.8431 }, T0), hourKey('open-meteo', { lat: 35.2451, lng: -80.8431 }, T0));
});

test('hourKey: differs across an hour boundary, and by provider', () => {
  const before = Date.parse('2026-10-24T14:59:59.999Z');
  const after = Date.parse('2026-10-24T15:00:00.000Z');
  assert.equal(hourKey('open-meteo', CHARLOTTE, before), 'halo:forecast:v1:open-meteo:35.23,-80.84:2026102414');
  assert.equal(hourKey('open-meteo', CHARLOTTE, after), 'halo:forecast:v1:open-meteo:35.23,-80.84:2026102415');
  assert.notEqual(hourKey('airnow', CHARLOTTE, T0), hourKey('open-meteo', CHARLOTTE, T0));
  // the UTC date rolls over, not the local one
  assert.equal(hourKey('open-meteo', CHARLOTTE, Date.parse('2026-10-24T23:30:00-04:00')), 'halo:forecast:v1:open-meteo:35.23,-80.84:2026102503');
});

test('hourKey: the alerts slot changes every ten minutes, 0 to 5', () => {
  const at = (hhmm) => hourKey('nws-alerts', CHARLOTTE, Date.parse(`2026-10-24T14:${hhmm}Z`), { slotMinutes: 10 });
  assert.equal(at('00:00'), 'halo:forecast:v1:nws-alerts:35.23,-80.84:2026102414:0');
  assert.equal(at('09:59'), 'halo:forecast:v1:nws-alerts:35.23,-80.84:2026102414:0');
  assert.equal(at('10:00'), 'halo:forecast:v1:nws-alerts:35.23,-80.84:2026102414:1');
  assert.deepEqual(['05', '15', '25', '35', '45', '55'].map((m) => at(`${m}:00`).split(':').pop()), ['0', '1', '2', '3', '4', '5']);
  assert.equal(new Set(['00', '10', '20', '30', '40', '50'].map((m) => at(`${m}:00`))).size, 6);
});

test('hourKey: no negative zero, and bad input is refused rather than keyed', () => {
  assert.equal(hourKey('open-meteo', { lat: -0.001, lng: 0.004 }, T0), 'halo:forecast:v1:open-meteo:0.00,0.00:2026102414');
  for (const point of [null, {}, { lat: Number.NaN, lng: 1 }, { lat: 91, lng: 1 }, { lat: 1, lng: -181 }, { lat: '35.2', lng: -80.8 }]) {
    assert.throws(() => hourKey('open-meteo', /** @type {any} */ (point), T0), TypeError, JSON.stringify(point));
  }
  for (const provider of ['', 'Open-Meteo', 'open meteo', 'open:meteo', 5]) {
    assert.throws(() => hourKey(/** @type {any} */ (provider), CHARLOTTE, T0), TypeError, String(provider));
  }
  assert.throws(() => hourKey('open-meteo', CHARLOTTE, Number.NaN), TypeError);
  assert.throws(() => hourKey('open-meteo', CHARLOTTE, /** @type {any} */ ('2026-10-24')), TypeError);
  for (const slotMinutes of [0, 7, 60, 1.5, -10]) {
    assert.throws(() => hourKey('nws-alerts', CHARLOTTE, T0, { slotMinutes }), TypeError, String(slotMinutes));
  }
});

// --- the three layers --------------------------------------------------------

test('memory hit, then a store hit after memory is reset, then produce once both are empty', async () => {
  const store = fakeStore();
  const produce = counter(GOOD);
  const c = clock();
  const options = { ttlSeconds: 7200, now: c.now, store };

  const first = await cached(KEY, options, produce);
  assert.deepEqual(first, { result: GOOD, source: 'provider', remembered: false });
  assert.equal(produce.calls, 1);
  assert.deepEqual(store.calls.at(-1), ['set', KEY, { ex: 7200 }], 'stored under the same key with the TTL');
  assert.deepEqual(store.data.get(KEY), { v: ENVELOPE_VERSION, at: T0, kind: 'good', result: GOOD });

  c.t += 60_000;
  const second = await cached(KEY, options, produce);
  assert.equal(second.source, 'memory');
  assert.deepEqual(second.result, GOOD);
  assert.equal(produce.calls, 1);

  _resetForecastCache(); // a fresh instance: memory empty, Redis still holds it
  const third = await cached(KEY, options, produce);
  assert.equal(third.source, 'store');
  assert.deepEqual(third.result, GOOD);
  assert.equal(produce.calls, 1);
  const gets = store.calls.filter(([op]) => op === 'get').length;
  assert.equal((await cached(KEY, options, produce)).source, 'memory', 'a store hit fills memory');
  assert.equal(store.calls.filter(([op]) => op === 'get').length, gets, 'and memory is read before the store');

  _resetForecastCache();
  store.data.clear();
  assert.equal((await cached(KEY, options, produce)).source, 'provider');
  assert.equal(produce.calls, 2);
});

test('a good value lives for ttlSeconds in memory and in the store, then is fetched again', async () => {
  const store = fakeStore();
  const produce = counter(GOOD);
  const c = clock();
  const options = { ttlSeconds: 7200, now: c.now, store };
  await cached(KEY, options, produce);
  c.t = T0 + 7_200_000 - 1;
  assert.equal((await cached(KEY, options, produce)).source, 'memory');
  _resetForecastCache();
  assert.equal((await cached(KEY, options, produce)).source, 'store', 'the store entry is judged by its own write time');
  c.t = T0 + 7_200_000;
  assert.equal((await cached(KEY, options, produce)).source, 'provider', 'memory expired');
  _resetForecastCache();
  store.data.set(KEY, { v: ENVELOPE_VERSION, at: T0, kind: 'good', result: GOOD }); // a store that has not expired it yet
  assert.equal((await cached(KEY, options, produce)).source, 'provider', 'nor is an old store entry served');
  assert.equal(produce.calls, 3);
});

test('a store get that throws is a miss; a set that throws is swallowed; one log line a minute, never the key', async () => {
  const store = fakeStore();
  store.failGet = true;
  store.failSet = true;
  const produce = counter(GOOD);
  const c = clock();
  const options = { ttlSeconds: 7200, memoryMax: 0, now: c.now, store }; // memory off, so every call reaches the store

  const { value, lines } = await captureErrors(async () => {
    const out = [];
    out.push(await cached(KEY, options, produce));
    c.t += 30_000;
    out.push(await cached(KEY, options, produce));
    c.t += 30_000;
    out.push(await cached(KEY, options, produce));
    return out;
  });
  assert.deepEqual(value.map((r) => r.source), ['provider', 'provider', 'provider']);
  for (const r of value) assert.deepEqual(r.result, GOOD, 'answered from the provider, never a 5xx');
  assert.equal(produce.calls, 3);
  assert.equal(lines.length, 2, `one line per instance per minute, got ${JSON.stringify(lines)}`);
  for (const line of lines) {
    assert.match(line, /^Forecast cache store unavailable, treated as a miss: Error ECONNRESET: Upstash unreachable$/);
    assert.ok(!line.includes('35.23') && !line.includes('halo:forecast'), 'the key (a rounded home point) is never logged');
  }
});

test('a real Upstash error, which quotes the command, never puts the key or the value in the log', async () => {
  // A real @upstash/redis client, its HTTP answered by a stub (no network):
  // Upstash builds the error as `${body.error}, command was: ${JSON.stringify(command)}`.
  const { Redis } = await import('@upstash/redis');
  const point = { lat: 12.34, lng: -56.78 }; // the marker: a "home" that must never be logged
  const key = hourKey('open-meteo', point, T0);
  const VALUE_MARKER = 'VALUE-MARKER-7f3a';
  const commands = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const pipelined = Array.isArray(body[0]); // the client batches commands into /pipeline
    const op = pipelined ? body[0][0] : body[0];
    commands.push(op);
    if (op === 'get' && commands.filter((c) => c === 'get').length > 1) {
      return new Response(pipelined || String(url).endsWith('/pipeline') ? '[{"result":null}]' : '{"result":null}');
    }
    return new Response('{"error":"ERR max daily request limit exceeded"}', { status: 400 });
  };
  const { value, lines } = await captureErrors(() =>
    withSandbox({ fetch }, async () => {
      const store = new Redis({ url: 'https://fake-upstash.example.test', token: 'test-token', retry: false, enableTelemetry: false });
      const options = { ttlSeconds: 7200, memoryMax: 0, now: () => T0, store };
      const first = await cached(key, options, counter({ ...GOOD, marker: VALUE_MARKER })); // get fails, set fails
      _resetForecastCache(); // a new instance: the log throttle starts again
      const second = await cached(key, options, counter({ ...GOOD, marker: VALUE_MARKER })); // get misses, set fails with the value in its command
      return [first, second];
    }),
  );
  assert.deepEqual(value.map((r) => r.source), ['provider', 'provider']);
  assert.deepEqual(commands, ['get', 'set', 'get', 'set'], 'both a failed get and a failed set were logged');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line, 'Forecast cache store unavailable, treated as a miss: UpstashError: ERR max daily request limit exceeded');
    for (const marker of ['12.34', '-56.78', 'halo:forecast', VALUE_MARKER, 'command was']) assert.ok(!line.includes(marker), `${marker} reached the log: ${line}`);
  }
});

test('a set that throws still leaves the value in memory', async () => {
  const store = fakeStore();
  store.failSet = true;
  const produce = counter(GOOD);
  const options = { ttlSeconds: 7200, now: () => T0, store };
  await captureErrors(() => cached(KEY, options, produce));
  assert.equal((await cached(KEY, options, produce)).source, 'memory');
  assert.equal(produce.calls, 1);
});

test('a store get that hangs is a miss after storeTimeoutMs', async () => {
  const store = fakeStore();
  store.hangGet = true;
  const produce = counter(GOOD);
  const started = Date.now();
  const { value } = await captureErrors(() => cached(KEY, { ttlSeconds: 7200, now: () => T0, store, storeTimeoutMs: 30 }, produce));
  assert.equal(value.source, 'provider');
  assert.ok(Date.now() - started < 2000);
});

test('two concurrent calls for one key call produce once and both get the answer', async () => {
  const store = fakeStore();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const produce = counter(async () => {
    await gate;
    return structuredClone(GOOD);
  });
  const options = { ttlSeconds: 7200, now: () => T0, store };
  const a = cached(KEY, options, produce);
  const b = cached(KEY, options, produce);
  const other = cached(hourKey('airnow', CHARLOTTE, T0), options, produce);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [ra, rb] = await Promise.all([a, b, other]);
  assert.equal(produce.calls, 2, 'once for the shared key, once for the other key');
  assert.deepEqual(ra.result, GOOD);
  assert.deepEqual(rb.result, GOOD);
  ra.result.hours[0].temperatureF = 999;
  assert.equal(rb.result.hours[0].temperatureF, 64, 'each caller has its own copy');
});

test('concurrent calls share a failure too, and it is not produced twice', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const produce = counter(async () => {
    await gate;
    return { ok: false, reason: 'timeout' };
  });
  const options = { ttlSeconds: 7200, now: () => T0, store: null };
  const both = Promise.all([cached(KEY, options, produce), cached(KEY, options, produce)]);
  release();
  const results = await both;
  assert.equal(produce.calls, 1);
  for (const r of results) assert.deepEqual(r.result, { ok: false, reason: 'timeout' });
});

test('a failed produce is remembered for exactly negativeSeconds, then retried', async () => {
  const store = fakeStore();
  const produce = counter((n) => (n === 1 ? { ok: false, reason: 'http_503' } : structuredClone(GOOD)));
  const c = clock();
  const options = { ttlSeconds: 7200, negativeSeconds: 60, now: c.now, store };

  const first = await cached(KEY, options, produce);
  assert.deepEqual(first, { result: { ok: false, reason: 'http_503' }, source: 'provider', remembered: false });
  assert.deepEqual(store.calls.at(-1), ['set', KEY, { ex: 60, nx: true }], 'the marker is written with nx and the negative TTL');
  assert.deepEqual(store.data.get(KEY), { v: ENVELOPE_VERSION, at: T0, kind: 'failed', reason: 'http_503' });

  c.t = T0 + 59_999;
  assert.deepEqual(await cached(KEY, options, produce), { result: { ok: false, reason: 'http_503' }, source: 'memory', remembered: true });
  _resetForecastCache();
  assert.deepEqual(await cached(KEY, options, produce), { result: { ok: false, reason: 'http_503' }, source: 'store', remembered: true }, 'another instance sees the marker too');
  assert.equal(produce.calls, 1, 'no provider call while the failure is remembered');

  c.t = T0 + 60_000;
  const retried = await cached(KEY, options, produce);
  assert.equal(retried.source, 'provider');
  assert.deepEqual(retried.result, GOOD);
  assert.equal(produce.calls, 2);
  assert.deepEqual(store.calls.at(-1), ['set', KEY, { ex: 7200 }], 'a good value overwrites the marker (no nx)');
  assert.equal(store.data.get(KEY).kind, 'good');
});

test('negativeSeconds defaults to 60', async () => {
  const produce = counter({ ok: false, reason: 'timeout' });
  const c = clock();
  const options = { ttlSeconds: 7200, now: c.now, store: null };
  await cached(KEY, options, produce);
  c.t = T0 + 59_999;
  await cached(KEY, options, produce);
  assert.equal(produce.calls, 1);
  c.t = T0 + 60_000;
  await cached(KEY, options, produce);
  assert.equal(produce.calls, 2);
});

test('a failure marker never overwrites a good value another instance stored', async () => {
  const store = fakeStore();
  store.data.set(KEY, { v: ENVELOPE_VERSION, at: T0, kind: 'good', result: GOOD });
  const realGet = store.get;
  store.get = async () => null; // this instance's read raced the other instance's write
  await cached(KEY, { ttlSeconds: 7200, now: () => T0, store }, counter({ ok: false, reason: 'timeout' }));
  store.get = realGet;
  assert.equal(store.data.get(KEY).kind, 'good');
});

test('a failed or partial upstream answer is never cached as good', async () => {
  const cases = [
    [{ ok: false, reason: 'invalid' }, 'invalid'],
    [{ ok: 'true', hours: [] }, 'invalid'],
    [{ ok: 1, hours: [] }, 'invalid'],
    [{ hours: [] }, 'invalid'],
    [undefined, 'invalid'],
    [null, 'invalid'],
    ['ok', 'invalid'],
    [{ ok: false }, 'invalid'],
    [{ ok: false, reason: 'budget' }, 'budget'],
  ];
  for (const [answer, reason] of cases) {
    _resetForecastCache();
    const store = fakeStore();
    const produce = counter(() => answer);
    const r = await cached(KEY, { ttlSeconds: 7200, now: () => T0, store }, produce);
    assert.deepEqual(r.result, { ok: false, reason }, JSON.stringify(answer));
    assert.equal(store.data.get(KEY).kind, 'failed', JSON.stringify(answer));
    assert.equal((await cached(KEY, { ttlSeconds: 7200, now: () => T0, store }, produce)).remembered, true);
  }
});

test('a produce that throws is a remembered failure, logged as code and message only', async () => {
  const store = fakeStore();
  const produce = async () => {
    throw Object.assign(new Error('adapter bug'), { code: 'E_ADAPTER', details: 'secret detail' });
  };
  const { value, lines } = await captureErrors(() => cached(KEY, { ttlSeconds: 7200, now: () => T0, store }, produce));
  assert.deepEqual(value.result, { ok: false, reason: 'error' });
  assert.equal(store.data.get(KEY).kind, 'failed');
  assert.deepEqual(lines, ['Forecast provider call failed: E_ADAPTER adapter bug']);
});

test('a value that will not survive JSON is not cached as good', async () => {
  const store = fakeStore();
  const r = await cached(KEY, { ttlSeconds: 7200, now: () => T0, store }, async () => ({ ok: true, n: 10n }));
  assert.deepEqual(r.result, { ok: false, reason: 'invalid' });
  assert.equal(store.data.get(KEY).kind, 'failed');
});

test('a malformed store value is a miss, never served', async () => {
  const bad = [
    'a string',
    { v: 'other/1', at: T0, kind: 'good', result: GOOD },
    { v: ENVELOPE_VERSION, at: T0, kind: 'good', result: { ok: false } },
    { v: ENVELOPE_VERSION, at: T0, kind: 'good', result: { ...GOOD, ok: 'true' } },
    { v: ENVELOPE_VERSION, at: 'yesterday', kind: 'good', result: GOOD },
    { v: ENVELOPE_VERSION, at: T0, kind: 'failed' },
    { v: ENVELOPE_VERSION, at: T0, kind: 'stale', result: GOOD },
    { ok: true, hours: [] },
  ];
  for (const value of bad) {
    _resetForecastCache();
    const store = fakeStore();
    store.data.set(KEY, value);
    const produce = counter(GOOD);
    const r = await cached(KEY, { ttlSeconds: 7200, now: () => T0, store }, produce);
    assert.equal(r.source, 'provider', JSON.stringify(value));
    assert.equal(produce.calls, 1);
  }
});

test('memory never exceeds memoryMax, and the least recently used goes first', async () => {
  const options = { ttlSeconds: 7200, memoryMax: 3, now: () => T0, store: null };
  const keys = Array.from({ length: 10 }, (_, i) => hourKey('open-meteo', { lat: 35 + i / 100, lng: -80 }, T0));
  for (const key of keys.slice(0, 3)) await cached(key, options, counter(GOOD));
  await cached(keys[0], options, counter(GOOD)); // keys[0] is now the most recently used
  for (const key of keys.slice(3)) {
    await cached(key, options, counter(GOOD));
    assert.ok(_forecastMemorySize() <= 3, `memory holds ${_forecastMemorySize()}`);
  }
  assert.equal(_forecastMemorySize(), 3);
  const again = counter(GOOD);
  await cached(keys[9], options, again);
  assert.equal(again.calls, 0, 'the newest is still held');
  await cached(keys[1], options, again);
  assert.equal(again.calls, 1, 'an old one was dropped');
});

test('the default memoryMax is 500', async () => {
  const options = { ttlSeconds: 7200, now: () => T0, store: null };
  for (let i = 0; i < 520; i += 1) {
    await cached(hourKey('open-meteo', { lat: 30 + i / 100, lng: -80 }, T0), options, counter(GOOD));
  }
  assert.equal(_forecastMemorySize(), 500);
});

test('the caller gets a copy: editing a result does not edit the cache', async () => {
  const options = { ttlSeconds: 7200, now: () => T0, store: null };
  const first = await cached(KEY, options, counter(GOOD));
  first.result.hours[0].temperatureF = -40;
  const second = await cached(KEY, options, counter(GOOD));
  assert.equal(second.result.hours[0].temperatureF, 64);
  second.result.hours.length = 0;
  assert.equal((await cached(KEY, options, counter(GOOD))).result.hours.length, 1);
});

test('peekCached reads memory and the store only, and never calls a provider', async () => {
  const store = fakeStore();
  const options = { ttlSeconds: 7200, now: () => T0, store };
  assert.equal(await peekCached(KEY, options), null);
  await cached(KEY, options, counter(GOOD));
  assert.deepEqual(await peekCached(KEY, options), { result: GOOD, source: 'memory', remembered: false });
  _resetForecastCache();
  assert.deepEqual(await peekCached(KEY, options), { result: GOOD, source: 'store', remembered: false });

  _resetForecastCache();
  const failing = hourKey('nws-alerts', CHARLOTTE, T0, { slotMinutes: 10 });
  await cached(failing, { ...options, ttlSeconds: 1200 }, counter({ ok: false, reason: 'timeout' }));
  assert.deepEqual(await peekCached(failing, { ...options, ttlSeconds: 1200 }), { result: { ok: false, reason: 'timeout' }, source: 'memory', remembered: true }, 'a remembered failure is a hit: no provider, no budget');

  store.failGet = true;
  _resetForecastCache();
  const { value } = await captureErrors(() => peekCached(KEY, options));
  assert.equal(value, null, 'a store outage is a miss');
});

test('only hourKey keys are accepted, so typed text and ids cannot become keys', async () => {
  const options = { ttlSeconds: 7200, now: () => T0, store: null };
  for (const key of ['', 'Freedom Park, Charlotte', 'halo:forecast:v1:open-meteo:Charlotte:2026102414', 'halo:forecast:v1:open-meteo:35.2271,-80.84:2026102414', `${KEY}:extra`, 42]) {
    await assert.rejects(cached(/** @type {any} */ (key), options, counter(GOOD)), TypeError, String(key));
  }
});

test('options are checked: a TTL is required and produce must be a function', async () => {
  for (const ttlSeconds of [undefined, 0, -1, 1.5, '7200']) {
    await assert.rejects(cached(KEY, /** @type {any} */ ({ ttlSeconds, store: null }), counter(GOOD)), TypeError, String(ttlSeconds));
  }
  await assert.rejects(cached(KEY, { ttlSeconds: 60, negativeSeconds: 0, store: null }, counter(GOOD)), TypeError);
  await assert.rejects(cached(KEY, { ttlSeconds: 60, store: null }, /** @type {any} */ (null)), TypeError);
});

test('with no store given and no Upstash configured, the cache is memory only and touches no network', async () => {
  const attempts = [];
  const produce = counter(GOOD);
  const r = await withSandbox({ fetch: blockedFetch(attempts) }, () => cached(KEY, { ttlSeconds: 7200, now: () => T0 }, produce));
  assert.equal(r.source, 'provider');
  assert.deepEqual(attempts, []);
  assert.equal((await withSandbox({ fetch: blockedFetch(attempts) }, () => cached(KEY, { ttlSeconds: 7200, now: () => T0 }, produce))).source, 'memory');
  assert.deepEqual(attempts, []);
});

// --- the last confirmed forecast (ruling F18-S, Task 8) -----------------------

test('lastConfirmedKey: the hour-free layout, two decimals, the same in every hour', () => {
  assert.equal(lastConfirmedKey('open-meteo', CHARLOTTE), 'halo:forecast:v1:open-meteo:35.23,-80.84:last');
  assert.equal(lastConfirmedKey('open-meteo', { lat: 35.2271, lng: -80.8431 }), lastConfirmedKey('open-meteo', { lat: 35.2349, lng: -80.8389 }));
  assert.throws(() => lastConfirmedKey('Open Meteo', CHARLOTTE), TypeError);
  assert.throws(() => lastConfirmedKey('open-meteo', { lat: 91, lng: 0 }), TypeError);
});

test('storeCached writes a good value to memory and the store, and peekCached reads it back across instances', async () => {
  const store = fakeStore();
  const key = lastConfirmedKey('open-meteo', CHARLOTTE);
  const options = { ttlSeconds: 9 * 3600, now: () => T0, store };
  assert.equal(await storeCached(key, options, GOOD), true);
  assert.deepEqual(store.calls.find(([op]) => op === 'set'), ['set', key, { ex: 9 * 3600 }]);
  assert.deepEqual((await peekCached(key, options)).result, GOOD);
  _resetForecastCache(); // another instance
  const fromStore = await peekCached(key, options);
  assert.equal(fromStore.source, 'store');
  assert.deepEqual(fromStore.result, GOOD);
  // Past its lifetime it is gone.
  assert.equal(await peekCached(key, { ...options, now: () => T0 + 9 * 3600 * 1000 }), null);
});

test('storeCached refuses anything not ok: true, and any key but a lastConfirmedKey', async () => {
  const store = fakeStore();
  const key = lastConfirmedKey('open-meteo', CHARLOTTE);
  const options = { ttlSeconds: 3600, now: () => T0, store };
  for (const value of [{ ok: false, reason: 'run_unknown' }, { hours: [] }, null]) {
    assert.equal(await storeCached(key, options, value), false);
  }
  assert.equal(store.data.size, 0, 'nothing written');
  assert.equal(await peekCached(key, { ...options, store: null }), null);
  await assert.rejects(storeCached(KEY, options, GOOD), TypeError, 'an hour key is filled only through cached');
  await assert.rejects(storeCached('halo:forecast:v1:open-meteo:Charlotte:last', options, GOOD), TypeError);
});
