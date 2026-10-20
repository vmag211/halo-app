/**
 * A household world for the B15 summary suites: the B11 world
 * (test/helpers/workspaceWorld.mjs: the real workspace routes and 0026
 * functions, the real 0017 ledger on PGlite, two households with a current
 * home each) plus migration 0029's REAL functions, 0023's real task read, and
 * the household's home and bands read straight from PGlite
 * (test/db/pgliteSelect.mjs), all called as the service role as PostgREST
 * would call them.
 *
 * The CLIENT is the frontend's own `createProductionRuntime`, fetching
 * through the route harness, and what the Summary screen does with each
 * answer is `productionSummary` (test/helpers/frontendB15.mjs). Records are
 * made through the Homeguard provider (`w.workspace()`), exactly as a person
 * saves them, so every record a summary reads was accepted by the client's
 * own row check and given its revision by the server.
 *
 * `summaryRpcs: false` leaves the 0029 functions unregistered (PGRST202), as
 * a database without 0029 answers. `onCommit(args, call)` wraps the commit so
 * a test can call through and then lose the response.
 */
import { rpcError } from './routeHarness.mjs';
import { pgliteSelect } from '../db/pgliteSelect.mjs';
import { loadFrontend } from '../frontend-test-loader.mjs';
import { createWorld, ON } from './workspaceWorld.mjs';
import { productionSummary } from './frontendB15.mjs';

const { createProductionRuntime } = await loadFrontend('production/runtime');

export const SUMMARIES_ON = Object.freeze({ ...ON, HALO_FEATURE_SUMMARIES: 'on' });
export const SUMMARIES = '/api/summaries';
export const DETAIL = '/api/summaries/detail';

const asRpcError = (error) => rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);

export async function createSummaryWorld(db, { env = SUMMARIES_ON, onCommit, summaryRpcs = true, tasks = true } = {}) {
  const w = await createWorld(db, { env });
  const { h, ids, home } = w;

  const fakeFrom = h.db.from;
  h.db.from = (name) => (['home_contexts', 'household_bands'].includes(name) ? pgliteSelect(db, name, h.db.queryLog) : fakeFrom(name));

  const call = (sql, values, options) => async (args) => {
    try {
      return await db.asService(async (tx) => (await tx.query(sql, values(args))).rows[0].result, options);
    } catch (error) {
      throw asRpcError(error);
    }
  };
  if (summaryRpcs) {
    h.db.registerRpc('read_household_summaries', call('select public.read_household_summaries($1, $2) as result', (a) => [a.p_profile_id, a.p_limit]), { args: ['p_profile_id', 'p_limit'] });
    h.db.registerRpc('read_household_summary', call('select public.read_household_summary($1, $2) as result', (a) => [a.p_profile_id, a.p_summary_id]), { args: ['p_profile_id', 'p_summary_id'] });
    h.db.registerRpc('household_summary_usage', call('select public.household_summary_usage($1) as result', (a) => [a.p_profile_id]), { args: ['p_profile_id'] });
    const commit = call('select public.commit_household_summary($1, $2, $3::jsonb) as result', (a) => [a.p_profile_id, a.p_operation_id, JSON.stringify(a.p_summary)], { commit: true });
    h.db.registerRpc('commit_household_summary', (args) => (onCommit ? onCommit(args, () => commit(args)) : commit(args)), { args: ['p_profile_id', 'p_operation_id', 'p_summary'] });
  }
  if (tasks) {
    h.db.registerRpc('read_household_actions', call('select public.read_household_actions($1) as result', (a) => [a.p_profile_id]), { args: ['p_profile_id'] });
  }

  function runtime(who = 'alice', { lose = () => false, env: callEnv, homeContextId = home[who] } = {}) {
    const fetcher = async (path, init) => {
      const url = new URL(path, 'http://halo.test');
      const response = await h.call(url.pathname, init.method, {
        as: who, url: `${url.pathname}${url.search}`, headers: init.headers, rawBody: init.body, env: callEnv,
      });
      if (lose(url.pathname, init)) throw new TypeError('fetch failed');
      return response;
    };
    return createProductionRuntime({
      identityId: ids[who],
      homeContextId,
      contextRevision: 1,
      credential: async () => ({ identityId: ids[who], accessToken: h.identities[who].token }),
      fetcher,
    });
  }

  return {
    ...w,
    runtime,
    /** The Summary screen as production runs it, on the client's own runtime. */
    summary(who = 'alice', options = {}) {
      return productionSummary(runtime(who, options));
    },
    /** A task row for `who`, as 0023 holds it (the My Week save itself is B06's). */
    async addTask(who = 'alice', { title = 'Run the bathroom fan', date = '2026-10-15', state = 'saved' } = {}) {
      const id = crypto.randomUUID();
      await db.query(
        `insert into public.household_actions (id, profile_id, action_key, title, reason, origin, due_date, state, revision)
         values ($1, $2, $3, $4, 'Moisture', 'homeguard', $5, $6, 1)`,
        [id, ids[who], `task-${id}`, title, date || null, state],
      );
      return { id, key: `task-${id}`, title, reason: 'Moisture', origin: 'homeguard', date, state, revision: 1 };
    },
    async summaries(who = 'alice') {
      return (await db.query('select summary_id::text as id, title, report, manifest, omissions, selection from public.household_summaries where profile_id = $1 order by created_at', [ids[who] ?? who])).rows;
    },
    list: ({ as = 'alice', env: callEnv } = {}) => h.call(SUMMARIES, 'GET', { as, env: callEnv }),
    detail: (id, { as = 'alice', env: callEnv } = {}) => h.call(DETAIL, 'GET', { as, url: `${DETAIL}?id=${encodeURIComponent(id)}`, env: callEnv }),
    prepare(body, { as = 'alice', key = crypto.randomUUID(), headers = {}, raw, env: callEnv } = {}) {
      return h.call(SUMMARIES, 'POST', {
        as,
        rawBody: raw ?? JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'idempotency-key': key }), ...headers },
        env: callEnv,
      });
    },
  };
}
