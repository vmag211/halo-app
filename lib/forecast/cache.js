/**
 * The forecast provider cache (plan F9; Task 3 of docs/backend/plans/b10-forecast.md).
 *
 * Provider data is cached, never a snapshot. Three layers, read in order:
 * this instance's memory, then the shared store (Upstash Redis, resolved
 * lazily exactly as lib/waterGeo.js does), then the provider through the
 * caller's `produce`. Only a good answer is cached as good. The geography
 * outage taught that a half answer pinned in a cache is worse than none
 * (lib/waterGeo.js caches a lookup only when no batch failed), so here a value
 * is good only when `produce` resolved to an object whose `ok` is exactly
 * `true`. Anything else (`ok: false`, a missing `ok`, a throw, a value that
 * will not survive JSON) is a FAILURE: remembered for `negativeSeconds` so a
 * burst of keystrokes and a quick "Retry forecast" do not hammer a failing
 * provider, and then retried. It is never served as data.
 *
 * API (for Tasks 4 to 8):
 *
 *   hourKey(provider, point, now, { slotMinutes })
 *     -> 'halo:forecast:v1:<provider>:<lat2>,<lng2>:<YYYYMMDDHH UTC>[:<slot>]'
 *     `provider` is a lower-case token ('open-meteo', 'airnow', 'nws-alerts').
 *     `point` is {lat, lng}; each is written with 2 decimals (F3). Pass the
 *     SAME rounded point the provider URL is built from (Task 2's
 *     `roundForProvider`), so the key and the request can never disagree.
 *     `now` is epoch milliseconds or a Date. `slotMinutes` (NWS alerts: 10)
 *     appends the slot of the hour, 0 to 5 for ten minutes; it must divide 60.
 *
 *   await cached(key, { ttlSeconds, negativeSeconds, memoryMax, now, store, storeTimeoutMs }, produce)
 *     -> { result, source, remembered }
 *     key             a key from `hourKey`, nothing else (checked; this is
 *                     what keeps typed text and household ids out of keys)
 *     ttlSeconds      REQUIRED life of a good value, in memory and in the
 *                     store (F9: 7200 for Open-Meteo and AirNow, 1200 for NWS)
 *     negativeSeconds life of a remembered failure, default 60
 *     memoryMax       memory entries kept per instance, default 500 (the
 *                     oldest-used is dropped first)
 *     now             the clock: a function returning epoch ms, or a number;
 *                     default Date.now
 *     store           {get(key), set(key, value, {ex, nx})}, the Upstash
 *                     shape. `undefined` means the default Redis when the
 *                     UPSTASH_ variables are set, `null` means memory only.
 *     storeTimeoutMs  bound on each store call, default 1500
 *     produce         async () => adapter answer ({ok: true, ...} or
 *                     {ok: false, reason}). Called at most once per key per
 *                     instance at a time (single flight).
 *     `result` is the good value or `{ok: false, reason}`, always a JSON copy,
 *     so every layer hands back the same shape. `source` is 'memory', 'store'
 *     or 'provider'. `remembered` is true when the result is a remembered
 *     failure (no provider was called for it).
 *
 *   await peekCached(key, options)
 *     The first two layers only: `{ result, source, remembered }` on a hit,
 *     `null` on a miss. It never calls a provider. The route uses it to learn
 *     whether any provider would be reached before it spends the household
 *     budget (F10), then calls `cached` for the misses.
 *
 * The store failing is a miss, never an error: `get` throwing or timing out
 * falls through to the provider, `set` failing is swallowed, and one line is
 * logged per instance per minute (code and message only, never the key: the
 * key is a rounded point, which for a home is a household's location to 1 km).
 * A remembered failure is written to the store with `nx`, so it can never
 * overwrite a good value another instance has just stored.
 */
import { loggableError } from '../apiErrors.js';

export const KEY_PREFIX = 'halo:forecast:v1:';
export const ENVELOPE_VERSION = 'halo-forecast-cache/1';
export const DEFAULT_NEGATIVE_SECONDS = 60;
export const DEFAULT_MEMORY_MAX = 500;
export const DEFAULT_STORE_TIMEOUT_MS = 1500;
const STORE_LOG_INTERVAL_MS = 60_000;

const PROVIDER_RE = /^[a-z][a-z0-9-]{0,31}$/;
const KEY_RE = /^halo:forecast:v1:[a-z][a-z0-9-]{0,31}:-?\d{1,3}\.\d{2},-?\d{1,3}\.\d{2}:\d{10}(?::\d{1,2})?$/;

const pad = (n, width = 2) => String(n).padStart(width, '0');

function coordinate(value, limit, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new TypeError(`hourKey: ${name} must be a finite number within ${limit}`);
  }
  const text = value.toFixed(2);
  return text === '-0.00' ? '0.00' : text;
}

/**
 * @param {string} provider
 * @param {{lat: number, lng: number}} point
 * @param {number|Date} now
 * @param {{slotMinutes?: number}} [options]
 */
export function hourKey(provider, point, now, { slotMinutes } = {}) {
  if (typeof provider !== 'string' || !PROVIDER_RE.test(provider)) throw new TypeError('hourKey: provider must be a lower-case token');
  const lat = coordinate(point?.lat, 90, 'lat');
  const lng = coordinate(point?.lng, 180, 'lng');
  const ms = now instanceof Date ? now.getTime() : now;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) throw new TypeError('hourKey: now must be epoch milliseconds or a Date');
  const at = new Date(ms);
  const hour = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}${pad(at.getUTCHours())}`;
  let key = `${KEY_PREFIX}${provider}:${lat},${lng}:${hour}`;
  if (slotMinutes !== undefined) {
    if (!Number.isInteger(slotMinutes) || slotMinutes < 1 || slotMinutes >= 60 || 60 % slotMinutes !== 0) {
      throw new TypeError('hourKey: slotMinutes must be a whole number of minutes that divides the hour');
    }
    key += `:${Math.floor(at.getUTCMinutes() / slotMinutes)}`;
  }
  return key;
}

// --- per-instance state ------------------------------------------------------

/** key -> { expiresAt, entry }, in least-recently-used order. */
const memory = new Map();
/** key -> Promise<{result, source, remembered}>, the single flight. */
const inflight = new Map();
let lastStoreLogAt = -Infinity;

let defaultStore; // undefined = not resolved yet; null = no Redis configured
async function resolveDefaultStore() {
  if (defaultStore !== undefined) return defaultStore;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    defaultStore = null;
    return null;
  }
  const { Redis } = await import('@upstash/redis');
  defaultStore = Redis.fromEnv();
  return defaultStore;
}

/** Test hook: forgets memory, flights, the log throttle and the resolved store. */
export function _resetForecastCache() {
  memory.clear();
  inflight.clear();
  lastStoreLogAt = -Infinity;
  defaultStore = undefined;
}

/** Test hook: how many entries memory holds. */
export function _forecastMemorySize() {
  return memory.size;
}

// --- options -----------------------------------------------------------------

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`cached: ${name} must be a positive whole number`);
  return value;
}

function settings(key, options = {}) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new TypeError('cached: key must come from hourKey');
  const { now = Date.now } = options;
  const clock = typeof now === 'function' ? now : () => now;
  const memoryMax = options.memoryMax ?? DEFAULT_MEMORY_MAX;
  if (!Number.isInteger(memoryMax) || memoryMax < 0) throw new TypeError('cached: memoryMax must be a whole number');
  return {
    ttlMs: positiveInteger(options.ttlSeconds, 'ttlSeconds') * 1000,
    ttlSeconds: options.ttlSeconds,
    negativeMs: positiveInteger(options.negativeSeconds ?? DEFAULT_NEGATIVE_SECONDS, 'negativeSeconds') * 1000,
    negativeSeconds: options.negativeSeconds ?? DEFAULT_NEGATIVE_SECONDS,
    memoryMax,
    clock,
    store: options.store,
    storeTimeoutMs: positiveInteger(options.storeTimeoutMs ?? DEFAULT_STORE_TIMEOUT_MS, 'storeTimeoutMs'),
  };
}

// --- entries -----------------------------------------------------------------

/** An entry is what memory and the store hold: a good value or a failure, with the time it was made. */
function good(result, at) {
  return { v: ENVELOPE_VERSION, at, kind: 'good', result };
}
function failed(reason, at) {
  return { v: ENVELOPE_VERSION, at, kind: 'failed', reason };
}

/** The entry's expiry, or null when it is malformed (a malformed store value is a miss). */
function expiryOf(entry, s) {
  if (!entry || typeof entry !== 'object' || entry.v !== ENVELOPE_VERSION) return null;
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null;
  if (entry.kind === 'good' && entry.result && typeof entry.result === 'object' && entry.result.ok === true) return entry.at + s.ttlMs;
  if (entry.kind === 'failed' && typeof entry.reason === 'string' && entry.reason) return entry.at + s.negativeMs;
  return null;
}

function answer(entry, source) {
  // A JSON copy every time, so a caller that edits its result cannot edit the cache.
  if (entry.kind === 'good') return { result: JSON.parse(JSON.stringify(entry.result)), source, remembered: false };
  return { result: { ok: false, reason: entry.reason }, source, remembered: true };
}

function remember(key, entry, expiresAt, s) {
  memory.delete(key);
  if (s.memoryMax === 0) return;
  memory.set(key, { expiresAt, entry });
  while (memory.size > s.memoryMax) memory.delete(memory.keys().next().value);
}

function fromMemory(key, s) {
  const held = memory.get(key);
  if (!held) return null;
  if (s.clock() >= held.expiresAt) {
    memory.delete(key);
    return null;
  }
  memory.delete(key); // most recently used goes last
  memory.set(key, held);
  return answer(held.entry, 'memory');
}

// --- the store ---------------------------------------------------------------

function storeFailed(err, s) {
  const t = s.clock();
  if (t - lastStoreLogAt < STORE_LOG_INTERVAL_MS) return;
  lastStoreLogAt = t;
  console.error('Forecast cache store unavailable, treated as a miss:', loggableError(err));
}

async function bounded(work, s) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('store call timed out'), { code: 'STORE_TIMEOUT' })), s.storeTimeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function storeFor(s) {
  if (s.store !== undefined) return s.store;
  return resolveDefaultStore().catch(() => null);
}

async function fromStore(key, s, store) {
  if (!store) return null;
  let entry;
  try {
    entry = await bounded(() => store.get(key), s);
  } catch (err) {
    storeFailed(err, s);
    return null;
  }
  const expiresAt = expiryOf(entry, s);
  if (expiresAt === null || s.clock() >= expiresAt) return null;
  remember(key, entry, expiresAt, s);
  return answer(entry, 'store');
}

async function toStore(key, entry, s, store) {
  if (!store) return;
  const options = entry.kind === 'good' ? { ex: s.ttlSeconds } : { ex: s.negativeSeconds, nx: true };
  try {
    await bounded(() => store.set(key, entry, options), s);
  } catch (err) {
    storeFailed(err, s);
  }
}

// --- reads -------------------------------------------------------------------

/**
 * Memory, then the store. Never a provider.
 * @returns {Promise<{result: object, source: string, remembered: boolean} | null>}
 */
export async function peekCached(key, options) {
  const s = settings(key, options);
  return fromMemory(key, s) ?? fromStore(key, s, await storeFor(s));
}

/** Whatever `produce` gave, as an entry: good only for an object whose `ok` is exactly true. */
async function produceEntry(produce, s) {
  let result;
  try {
    result = await produce();
  } catch (err) {
    console.error('Forecast provider call failed:', loggableError(err));
    return failed('error', s.clock());
  }
  const at = s.clock();
  if (!result || typeof result !== 'object' || result.ok !== true) {
    const reason = result && typeof result === 'object' && typeof result.reason === 'string' && result.reason ? result.reason : 'invalid';
    return failed(reason, at);
  }
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(result));
  } catch {
    return failed('invalid', at);
  }
  return good(copy, at);
}

/**
 * Memory, then the store, then `produce`, with one flight per key.
 * @param {string} key
 * @param {{ttlSeconds: number, negativeSeconds?: number, memoryMax?: number, now?: number|(() => number),
 *          store?: {get: Function, set: Function}|null, storeTimeoutMs?: number}} options
 * @param {() => Promise<any>} produce
 * @returns {Promise<{result: object, source: 'memory'|'store'|'provider', remembered: boolean}>}
 */
export async function cached(key, options, produce) {
  const s = settings(key, options);
  if (typeof produce !== 'function') throw new TypeError('cached: produce must be a function');
  const hit = fromMemory(key, s);
  if (hit) return hit;

  const running = inflight.get(key);
  if (running) return running.then((shared) => ({ ...shared, result: JSON.parse(JSON.stringify(shared.result)) }));

  const flight = (async () => {
    const store = await storeFor(s);
    const stored = await fromStore(key, s, store);
    if (stored) return stored;
    const entry = await produceEntry(produce, s);
    const expiresAt = expiryOf(entry, s);
    remember(key, entry, /** @type {number} */ (expiresAt), s);
    await toStore(key, entry, s, store);
    return { ...answer(entry, 'provider'), remembered: false };
  })();
  inflight.set(key, flight);
  try {
    return await flight;
  } finally {
    inflight.delete(key);
  }
}
