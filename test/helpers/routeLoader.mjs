/**
 * Registers the route-test module hooks (see routeHooks.mjs) for this process.
 *
 * Importing this file is enough: routeHarness.mjs does it before it imports any
 * route, so `node --test test/*.test.mjs` needs no extra flags. It uses
 * `module.registerHooks` (in-thread, synchronous) rather than `module.register`,
 * which Node 26 deprecates with a runtime warning (DEP0205). Only modules
 * imported after this runs are affected.
 */
import nodeModule from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRouteHooks } from './routeHooks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '..', '..');

const REGISTERED = Symbol.for('halo.routeHarness.hooksRegistered');

if (!globalThis[REGISTERED]) {
  if (typeof nodeModule.registerHooks !== 'function') {
    throw new Error('The route test harness needs module.registerHooks (Node 22.15 or newer).');
  }
  globalThis[REGISTERED] = true;
  nodeModule.registerHooks(createRouteHooks({ repoRoot: REPO_ROOT, stubDir: path.join(here, 'stubs') }));
}
