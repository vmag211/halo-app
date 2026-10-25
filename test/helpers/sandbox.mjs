/**
 * Keeps route tests off the network and off real services, whatever is in the
 * developer's shell. While a route handler (or an `after` callback, or the first
 * import of a route) runs inside `withSandbox`:
 *
 *   - global `fetch` is replaced. The replacement looks up the fetch of the call
 *     it is running inside (AsyncLocalStorage), so overlapping calls with
 *     different fetches never see each other's. Code running outside a sandboxed
 *     call (the test itself, node:test) still gets the real fetch.
 *   - the environment variables the app reads for providers and secrets are
 *     removed from `process.env`, then the call's own `env` values are applied.
 *     Everything is restored when the last overlapping call finishes. process.env
 *     is process-wide, so overlapping calls must agree on their `env` values.
 *
 * `blockedFetch(record)` is the default fetch: it rejects, like a dead network,
 * and records what was attempted so a test can assert it did not happen.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Every variable app/ and lib/ read from process.env, plus every capability
 * flag in lib/features.js (those are read as process.env[variable], which a
 * source scan cannot see, so the drift test takes them from the registry). A
 * drift test in test/routeSandbox.test.mjs fails when the code starts reading
 * one that is not listed here, so neither a new provider key nor a new
 * capability flag can slip through a developer's shell.
 */
export const SCRUBBED_ENV = [
  'AIRNOW_API_KEY',
  'ASSISTANT_CHAT_FALLBACK_MODELS',
  'ASSISTANT_CHAT_MAX_TOKENS',
  'ASSISTANT_CHAT_MODEL',
  'ASSISTANT_CHAT_URL',
  'ASSISTANT_EMBED_DIM',
  'ASSISTANT_EMBED_MODEL',
  'ASSISTANT_EMBED_URL',
  'ASSISTANT_GLOBAL_DAILY_LIMIT',
  'ASSISTANT_MIN_SIMILARITY',
  'ASSISTANT_MODEL_KEY',
  'ASSISTANT_SEND_HOUSEHOLD_CONTEXT',
  'CRON_SECRET',
  'DAILY_MAXIMA_MAX_POINTS',
  'FORECAST_OPEN_METEO_DAILY_LIMIT',
  'GOOGLE_POLLEN_API_KEY',
  'HALO_FEATURE_LUNA',
  'HALO_FEATURE_RECOVERY',
  'HALO_FEATURE_TASKS',
  'HALO_FEATURE_WORKSPACE',
  'HALO_FEATURE_JOURNAL',
  'HALO_FEATURE_ATTACHMENTS',
  'HALO_FEATURE_SUMMARIES',
  'HALO_FEATURE_PROJECTS',
  'HALO_FEATURE_OUTREACH',
  'HALO_FEATURE_PARTICIPATION',
  'HALO_FEATURE_PUBLIC_IMPORT',
  'HALO_PRIVACY_REVIEW_KEY',
  'HALO_RECOVERY_TOKEN_KEY',
  'LUNA_HISTORY_TURNS',
  'MAPBOX_TOKEN',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'NWS_CONTACT',
  'OPENAI_API_KEY',
  'OPENUV_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TURNSTILE_SECRET_KEY',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'VAPID_PRIVATE_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_SUBJECT',
];

const scope = new AsyncLocalStorage();

let depth = 0;
let saved = null;
let appliedKey = '';
let outerFetch = null; // whatever globalThis.fetch was when the first call entered

function dispatchFetch(input, init) {
  const active = scope.getStore();
  return active ? active.fetch(input, init) : outerFetch(input, init);
}

function enter(env) {
  const key = JSON.stringify(Object.entries(env).sort());
  if (depth > 0 && key !== appliedKey) {
    throw new Error('routeHarness: overlapping calls ask for different env values, but process.env is shared; run them one after the other');
  }
  if (depth === 0) {
    saved = new Map();
    for (const name of new Set([...SCRUBBED_ENV, ...Object.keys(env)])) {
      saved.set(name, Object.hasOwn(process.env, name) ? process.env[name] : undefined);
      delete process.env[name];
    }
    Object.assign(process.env, env);
    outerFetch = globalThis.fetch;
    globalThis.fetch = dispatchFetch;
    appliedKey = key;
  }
  depth += 1;
}

function leave() {
  depth -= 1;
  if (depth > 0) return;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = outerFetch;
  saved = null;
  outerFetch = null;
}

/**
 * Runs `work()` with the sandbox in place and returns its result.
 * @param {{fetch: Function, env?: Record<string, string>}} options
 */
export async function withSandbox({ fetch, env = {} }, work) {
  enter(env);
  try {
    return await scope.run({ fetch }, work);
  } finally {
    leave();
  }
}

/** The default fetch: rejects like a dead network and records the attempt (origin and path only). */
export function blockedFetch(record) {
  return async (input) => {
    const raw = typeof input === 'string' ? input : input?.url ?? String(input);
    let target = raw;
    try {
      const url = new URL(raw);
      target = `${url.origin}${url.pathname}`;
    } catch {
      /* keep the raw text */
    }
    record.push(target);
    throw new TypeError(`routeHarness: blocked network call to ${target}. Pass a fetch option to createRouteHarness() or call() to stub it.`);
  };
}
