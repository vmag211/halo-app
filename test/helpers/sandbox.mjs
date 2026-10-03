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
 * Every variable app/ and lib/ read from process.env. A drift test in
 * test/routeSandbox.test.mjs fails when the code starts reading one that is not
 * listed here, so a new provider key cannot slip through a developer's shell.
 */
export const SCRUBBED_ENV = [
  'AIRNOW_API_KEY',
  'ASSISTANT_CHAT_FALLBACK_MODELS',
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
  'GOOGLE_POLLEN_API_KEY',
  'MAPBOX_TOKEN',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'OPENAI_API_KEY',
  'OPENUV_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
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
