/**
 * A household world for the B16 project suites: the real route handlers on
 * the isolated route harness, with migration 0030's REAL functions, 0026's
 * REAL workspace functions and the REAL 0017 ledger on a PGlite database,
 * called as the service role as PostgREST would call them. Profiles, home
 * contexts and daily readings are the harness's fake tables (the evidence
 * reads), seeded per test.
 *
 * The CLIENT is the frontend's own runtime (`createProductionRuntime`,
 * compiled from this tree); what the screens then do is
 * test/helpers/frontendB16.mjs.
 */
import { createRouteHarness, rpcError } from './routeHarness.mjs';
import { haloTables } from './tables.mjs';
import { pgliteLedger } from '../db/pgliteLedger.mjs';
import { loadFrontend } from '../frontend-test-loader.mjs';

const { createProductionRuntime } = await loadFrontend('production/runtime');

export const ON = Object.freeze({ HALO_FEATURE_PROJECTS: 'on', HALO_FEATURE_WORKSPACE: 'on' });
export const ROUTES = Object.freeze({
  generate: '/api/projects/generations',
  current: '/api/projects/generations/current',
  status: '/api/projects/generations/status',
  cancel: '/api/projects/generations/cancel',
  guide: '/api/projects/guides/detail',
  start: '/api/projects/start',
  workspace: '/api/frontend/workspace',
  operations: '/api/operations',
});

const asRpcError = (error) => rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);

let worlds = 0;

/**
 * `missing`: names of RPCs to answer as "function does not exist" (a
 * migration not applied). `homes: false` makes home_contexts answer missing.
 */
export async function createWorld(db, { env = ON, missing = [], homes = true, onRecord } = {}) {
  worlds += 1;
  const prefix = (0xb1600000 + worlds).toString(16);
  const alice = `${prefix}-0000-4000-8000-00000000000a`;
  const bob = `${prefix}-0000-4000-8000-00000000000b`;
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${alice}', true), ('${bob}', true);`);
  const home = { alice: crypto.randomUUID(), bob: crypto.randomUUID() };

  const h = createRouteHarness({
    tables: haloTables('profiles', 'home_contexts', 'daily_scores'),
    env,
    identities: { alice: { id: alice }, bob: { id: bob } },
    seed: {
      profiles: [
        { id: alice, state: 'NC', county: 'Wake', water_source: 'utility', home_year: 1975, renter_mode: false },
        { id: bob, state: 'VA', county: 'Fairfax', water_source: 'well', home_year: null, renter_mode: true },
      ],
      home_contexts: homes ? [
        { id: home.alice, profile_id: alice, sequence: 1, revision: 1, origin: 'onboard', county: 'Wake', state: 'NC', water_source: 'utility', home_year: 1975, effective_from: '2026-09-01T00:00:00Z', effective_to: null },
        { id: home.bob, profile_id: bob, sequence: 1, revision: 1, origin: 'onboard', county: 'Fairfax', state: 'VA', water_source: 'well', home_year: null, effective_from: '2026-09-01T00:00:00Z', effective_to: null },
      ] : [],
    },
  });
  const fakeFrom = h.db.from;
  // A query on a table that does not exist yet (0016 not applied): every call chains, and it answers 42P01.
  const missingTable = () => {
    const query = new Proxy({}, { get: (_, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) : () => query) });
    return query;
  };
  h.db.from = (name) => {
    if (name === 'operations') return pgliteLedger(db, name, h.db.queryLog);
    if (name === 'home_contexts' && !homes) return missingTable();
    return fakeFrom(name);
  };

  const call = (fn, sql, params, commit) => async (args) => {
    if (missing.includes(fn)) throw rpcError('PGRST202', `Could not find the function public.${fn}`);
    try {
      return await db.asService(async (tx) => (await tx.query(sql, params(args))).rows[0].result, { commit });
    } catch (error) {
      throw asRpcError(error);
    }
  };
  const record = call('record_project_generation', 'select public.record_project_generation($1, $2, $3, $4, $5::jsonb) as result',
    (a) => [a.p_profile_id, a.p_generation_id, a.p_context_key, a.p_status, JSON.stringify(a.p_result)], true);
  h.db.registerRpc('record_project_generation', (args) => (onRecord ? onRecord(args, () => record(args)) : record(args)), { args: ['p_profile_id', 'p_generation_id', 'p_context_key', 'p_status', 'p_result'] });
  h.db.registerRpc('read_project_generation', call('read_project_generation', 'select public.read_project_generation($1, $2) as result', (a) => [a.p_profile_id, a.p_generation_id], false), { args: ['p_profile_id', 'p_generation_id'] });
  h.db.registerRpc('read_current_project_generation', call('read_current_project_generation', 'select public.read_current_project_generation($1) as result', (a) => [a.p_profile_id], false), { args: ['p_profile_id'] });
  h.db.registerRpc('read_household_workspace', call('read_household_workspace', 'select public.read_household_workspace($1, $2::text[]) as result', (a) => [a.p_profile_id, a.p_collections], false), { args: ['p_profile_id', 'p_collections'] });
  h.db.registerRpc('commit_household_workspace', call('commit_household_workspace', 'select public.commit_household_workspace($1, $2, $3::jsonb) as result', (a) => [a.p_profile_id, a.p_operation_id, JSON.stringify(a.p_writes)], true), { args: ['p_profile_id', 'p_operation_id', 'p_writes'] });

  const ids = { alice, bob };
  const scopeKey = (who) => `${ids[who]}:${home[who]}:1`;

  /** The frontend's own runtime, fetching through the route harness. */
  function runtime(who = 'alice', { lose = () => false, env: callEnv, contextRevision = 1 } = {}) {
    const fetcher = async (path, init) => {
      const url = new URL(path, 'http://halo.test');
      const response = await h.call(url.pathname, init.method, { as: who, url: `${url.pathname}${url.search}`, headers: init.headers, rawBody: init.body, env: callEnv });
      if (lose(url.pathname, init)) throw new TypeError('fetch failed');
      return response;
    };
    return createProductionRuntime({
      identityId: ids[who], homeContextId: home[who], contextRevision,
      credential: async () => ({ identityId: ids[who], accessToken: h.identities[who].token }), fetcher,
    });
  }

  return {
    h, db, ids, home, runtime, scopeKey,
    post: (route, body, { as = 'alice', key, env: callEnv, raw } = {}) => h.call(route, 'POST', {
      as, rawBody: raw ?? JSON.stringify(body), env: callEnv,
      headers: { 'content-type': 'application/json', ...(key === undefined || key === null ? {} : { 'idempotency-key': key }) },
    }),
    get: (route, query = {}, { as = 'alice', env: callEnv } = {}) => {
      const search = new URLSearchParams(query).toString();
      return h.call(route, 'GET', { as, url: `${route}${search ? `?${search}` : ''}`, env: callEnv });
    },
    async generations(who = 'alice') {
      return (await db.query('select generation_id::text, status, context_key, idea_set from public.household_project_generations where profile_id = $1 order by created_at, generation_id', [ids[who] ?? who])).rows;
    },
    async projects(who = 'alice') {
      return (await db.query(`select record_id, revision, record from public.household_workspace_records where profile_id = $1 and collection = 'exploreProjects' order by created_at`, [ids[who] ?? who])).rows;
    },
    async ledgerRow(operationId) {
      return (await db.query('select operation_id::text, profile_id::text, domain, kind, status, result from public.operations where operation_id = $1', [operationId])).rows[0] ?? null;
    },
  };
}

/** A generation request body as the client sends it. */
export function generateBody(world, who = 'alice', over = {}) {
  return { contextKey: world.scopeKey(who), constraints: { space: 'any', mode: 'any', time: 'any', budget: 'any', count: 12 }, request: '', interpret: false, previousIdeaIds: [], ...over };
}
