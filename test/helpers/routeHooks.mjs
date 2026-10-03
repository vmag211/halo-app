/**
 * Module-customization hooks for route tests (registered by routeLoader.mjs).
 *
 *  - `@/x` resolves to the repo file (the tsconfig alias), trying .js, .mjs, .ts,
 *    .json and /index.js, like the Next.js bundler does.
 *  - Modules that would reach the network or build a client at import time are
 *    replaced by the stubs in ./stubs. They are matched by the file they resolve
 *    to, so `@/lib/serverAuth` and `../lib/serverAuth.js` are both caught:
 *      lib/serverAuth.js     -> stubs/serverAuth.mjs  (Supabase client, auth)
 *      lib/ratelimit.js      -> stubs/ratelimit.mjs   (Upstash Redis at import)
 *      next/server           -> stubs/nextServer.mjs  (NextResponse, after)
 *      @supabase/supabase-js -> stubs/supabaseJs.mjs  (home-guard builds its own
 *                                                      client at import)
 *  - Repo .js files under app/ and lib/ are loaded as ES modules outright. The
 *    package has no "type" field, so Node would otherwise sniff each file and
 *    print MODULE_TYPELESS_PACKAGE_JSON.
 *
 * No `load` hook is needed: the stubs are real files, and the format is decided
 * at resolve time.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SUFFIXES = ['', '.js', '.mjs', '.ts', '.json', '/index.js'];
const ESM_DIRS = ['app', 'lib'];

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function createRouteHooks({ repoRoot, stubDir }) {
  const stub = (name) => pathToFileURL(path.join(stubDir, name)).href;
  const repo = (relative) => pathToFileURL(path.join(repoRoot, relative)).href;

  const fileStubs = new Map([
    [repo('lib/serverAuth.js'), stub('serverAuth.mjs')],
    [repo('lib/ratelimit.js'), stub('ratelimit.mjs')],
  ]);
  const bareStubs = new Map([
    ['next/server', stub('nextServer.mjs')],
    ['@supabase/supabase-js', stub('supabaseJs.mjs')],
  ]);
  const esmPrefixes = ESM_DIRS.map((dir) => repo(`${dir}/`));

  function findRepoFile(relative) {
    const base = path.join(repoRoot, relative);
    return SUFFIXES.map((suffix) => base + suffix).find(isFile) ?? null;
  }

  function resolve(specifier, context, nextResolve) {
    const bare = bareStubs.get(specifier);
    if (bare) return { url: bare, format: 'module', shortCircuit: true };

    let target = specifier;
    if (specifier.startsWith('@/')) {
      const file = findRepoFile(specifier.slice(2));
      if (!file) {
        const error = new Error(`routeHooks: cannot resolve "${specifier}" under ${repoRoot}`);
        error.code = 'ERR_MODULE_NOT_FOUND';
        throw error;
      }
      target = pathToFileURL(file).href;
    }

    const resolved = nextResolve(target, context);
    const replacement = fileStubs.get(resolved.url);
    if (replacement) return { url: replacement, format: 'module', shortCircuit: true };

    const withoutQuery = resolved.url.split('?')[0];
    if (withoutQuery.endsWith('.js') && esmPrefixes.some((prefix) => withoutQuery.startsWith(prefix))) {
      return { ...resolved, format: 'module' };
    }
    return resolved;
  }

  return { resolve };
}
