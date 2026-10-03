/**
 * Runs the real route handlers under `node --test` with no network, Redis or
 * Supabase. Importing this file registers the module hooks first (routeLoader),
 * then routes are imported on demand, so no extra node flags are needed.
 *
 *   const h = createRouteHarness({
 *     tables: { household_bands: { primaryKey: 'profile_id' } },
 *     seed: ({ alice, bob }) => ({
 *       household_bands: [{ profile_id: alice.id, has_senior: true }, { profile_id: bob.id }],
 *     }),
 *   });
 *   const res = await h.call('/api/household', 'GET', { as: 'alice' });
 *   assert.equal(res.status, 200);
 *   assert.equal(h.db.rows('household_bands').length, 2);
 *
 * Every harness has its own fake database, identities and `after` queue. A route
 * module is imported once per harness (fresh module state); the lib modules it
 * imports are shared across the process. A handler that throws rejects `call`
 * (Next.js would answer 500); `runAfter` likewise rethrows a failing callback.
 *
 * No call reaches the network or a real service (see sandbox.mjs). While a
 * handler, an `after` callback or a route import runs, global `fetch` rejects
 * (attempts are listed in `h.blockedFetches`) and the provider and secret
 * variables (UPSTASH_*, AIRNOW_API_KEY, MAPBOX_TOKEN, ASSISTANT_MODEL_KEY, ...)
 * are removed from process.env. A test that needs a provider passes its own
 * `fetch` (option of createRouteHarness, or of one call) and the `env` values
 * the route should see. A route that reads env at import (assistant) sees the
 * `env` of the harness's first call to it.
 *
 * Helpers re-exported for tests: tokenFor(name), rpcError(code, message) for
 * registered fake RPCs (`h.db.registerRpc`), muteConsoleError(t).
 */
import { REPO_ROOT } from './routeLoader.mjs'; // first: evaluating it registers the module hooks
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFakeSupabase, tokenFor } from './fakeSupabase.mjs';
import { blockedFetch, withSandbox } from './sandbox.mjs';
import { runWithHarness } from './stubs/context.mjs';
import { NextRequest } from './stubs/nextServer.mjs';

export { tokenFor } from './fakeSupabase.mjs';
export { rpcError } from './fakeSupabase.mjs';

const DEFAULT_IDENTITIES = { alice: {}, bob: {} };
const ORIGIN = 'http://halo.test';
let harnessCount = 0;

/** name -> { name, id, email, isAnonymous, token }; ids are valid, distinct UUIDs. */
function buildIdentities(spec) {
  const identities = {};
  Object.entries(spec).forEach(([name, overrides], index) => {
    const id = `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;
    identities[name] = {
      name,
      id,
      email: `${name}@example.test`,
      isAnonymous: false,
      ...overrides,
      token: tokenFor(name),
    };
  });
  return identities;
}

/**
 * `/api/household` or `api/household` -> app/api/household/route.js. A path that
 * already ends in .js or .mjs (a route file, or a fixture route in test/) is
 * taken relative to the repo root.
 */
function routeFile(routePath) {
  let relative = routePath.replace(/^\/+/, '');
  if (!/\.m?js$/.test(relative)) {
    if (!relative.startsWith('app/')) relative = `app/${relative}`;
    relative = `${relative.replace(/\/+$/, '')}/route.js`;
  }
  const file = path.join(REPO_ROOT, relative);
  if (!existsSync(file)) throw new Error(`routeHarness: no route file at ${relative}`);
  return file;
}

/**
 * @param {object} [options]
 * @param {object|function} [options.seed] table name -> rows, or a function of the identities returning that.
 * @param {object} [options.tables] table name -> { primaryKey, unique, ownerColumn, defaults }; see fakeTable.mjs.
 * @param {object} [options.identities] name -> { id, email, isAnonymous } overrides; default is alice and bob.
 * @param {Function} [options.fetch] stands in for global fetch inside every call; default rejects and records.
 * @param {object} [options.env] environment values the routes see (strings); everything else the app reads is removed.
 */
export function createRouteHarness({
  seed = {},
  tables = {},
  identities: identitySpec = DEFAULT_IDENTITIES,
  fetch: harnessFetch,
  env: harnessEnv = {},
} = {}) {
  harnessCount += 1;
  const harnessId = harnessCount;
  const identities = buildIdentities(identitySpec);
  const db = createFakeSupabase({
    tables,
    seed: typeof seed === 'function' ? seed(identities) : seed,
    identities: Object.values(identities),
  });
  const state = { db, afterQueue: [] };
  const modules = new Map();
  const blockedFetches = [];
  const defaultFetch = harnessFetch ?? blockedFetch(blockedFetches);

  /** Runs work inside this harness with fetch and env sandboxed (see sandbox.mjs). */
  const sandboxed = (overrides, work) =>
    withSandbox(
      { fetch: overrides.fetch ?? defaultFetch, env: { ...harnessEnv, ...overrides.env } },
      () => runWithHarness(state, work),
    );

  const loadRoute = (routePath, overrides) => {
    const file = routeFile(routePath);
    if (!modules.has(file)) {
      const url = `${pathToFileURL(file).href}?harness=${harnessId}`;
      modules.set(file, sandboxed(overrides, () => import(url)));
    }
    return modules.get(file);
  };

  /**
   * Calls a route handler as Next.js would and returns its Response.
   *
   * @param {string} routePath e.g. '/api/journal' (use the folder name for dynamic segments)
   * @param {string} method GET, POST, PUT, PATCH or DELETE
   * @param {object} [options]
   * @param {string|null} [options.as] identity name; omit or null for no Authorization header
   * @param {string} [options.url] path with query ('/api/history?days=7') or a full URL
   * @param {*} [options.body] sent as JSON
   * @param {string} [options.rawBody] sent as is (malformed JSON, empty body)
   * @param {object} [options.headers] extra headers; an `authorization` here overrides `as`
   * @param {object} [options.params] dynamic route params, passed as a Promise like Next 16
   * @param {Function} [options.fetch] fetch for this call only; `after` callbacks use the harness's fetch unless runAfter is given one
   * @param {object} [options.env] env values for this call, on top of the harness's
   */
  const call = async (routePath, method, { as = null, url, body, rawBody, headers = {}, params = {}, fetch, env } = {}) => {
    const verb = method.toUpperCase();
    const overrides = { fetch, env };
    const route = await loadRoute(routePath, overrides);
    const handler = route[verb];
    if (typeof handler !== 'function') {
      const allow = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((name) => typeof route[name] === 'function');
      return new Response(null, { status: 405, headers: { Allow: allow.join(', ') } });
    }

    const requestHeaders = new Headers(headers);
    if (as !== null && as !== undefined) {
      if (!identities[as]) throw new Error(`routeHarness: no identity named "${as}" (have ${Object.keys(identities).join(', ')})`);
      if (!requestHeaders.has('authorization')) requestHeaders.set('authorization', `Bearer ${identities[as].token}`);
    }
    let payload;
    if (rawBody !== undefined) payload = rawBody;
    else if (body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined && !requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');

    const target = url ?? routePath.replace(/^\/?(app\/)?/, '/').replace(/\/route\.m?js$/, '');
    const request = new NextRequest(target.startsWith('http') ? target : `${ORIGIN}${target}`, {
      method: verb,
      headers: requestHeaders,
      body: payload,
    });
    return sandboxed(overrides, () => handler(request, { params: Promise.resolve(params) }));
  };

  /**
   * Runs the callbacks the routes passed to `after()`, including ones queued while running,
   * with the same sandbox. Pass `{ fetch, env }` when the callbacks need a provider.
   */
  const runAfter = async (overrides = {}) => {
    while (state.afterQueue.length) {
      const task = state.afterQueue.shift();
      await sandboxed(overrides, () => (typeof task === 'function' ? task() : task));
    }
  };

  /** 'returned' (default): auth-js returns a 5xx error. 'thrown': network failure. 'off': back to normal. */
  const forceAuthOutage = (mode = 'returned') => db.setAuthOutage(mode);

  return { db, identities, call, runAfter, forceAuthOutage, blockedFetches };
}

/** Silences console.error for one test and returns the mock, so a test can also assert on it. */
export function muteConsoleError(t) {
  return t.mock.method(console, 'error', () => {});
}
