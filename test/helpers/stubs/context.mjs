/**
 * The link between the harness and the stubbed modules.
 *
 * The stubs are loaded once per process and shared by every harness, so they
 * cannot hold a Supabase fake themselves. Instead the harness runs every route
 * call (and every `after` callback) inside `runWithHarness(state, fn)`, and the
 * stubs read the active state from AsyncLocalStorage. Two harnesses never see
 * each other's data, even when their calls overlap.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function runWithHarness(state, fn) {
  return storage.run(state, fn);
}

export function currentHarness() {
  const state = storage.getStore();
  if (!state) {
    throw new Error(
      'Route test stub used outside a harness call. Call routes through createRouteHarness().call().',
    );
  }
  return state;
}

/**
 * Stands in for a module-level Supabase client. Every property read is
 * forwarded to the active harness's fake, so `const db = supabaseAdmin` at
 * module scope keeps working across harnesses.
 */
export const fakeClient = new Proxy(
  {},
  {
    get: (_target, property) => currentHarness().db[property],
    has: (_target, property) => property in currentHarness().db,
  },
);
