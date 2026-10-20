/**
 * A household world for the B17 outreach suite: the B11 workspace world
 * (test/helpers/workspaceWorld.mjs: the real routes on the isolated route
 * harness, the real 0017 ledger and 0026 functions on PGlite) plus
 * migration 0031's REAL functions, called as the service role as PostgREST
 * would, and the household's saved Explore area read from PGlite's real 0022
 * table (test/db/pgliteSelect.mjs).
 *
 * The CLIENT is the frontend's own runtime (lib/frontend/production/runtime.ts,
 * compiled from this tree), with the route harness as its fetcher. What the
 * screen then does is test/helpers/frontendB17.mjs.
 *
 * Every call runs with global fetch blocked (test/helpers/sandbox.mjs); a
 * test asserts `w.h.blockedFetches` stays empty, so no B17 route reaches the
 * network.
 */
import { rpcError } from './routeHarness.mjs';
import { createWorld as createWorkspaceWorld, sampleRecord, body as commandBody } from './workspaceWorld.mjs';
import { pgliteSelect } from '../db/pgliteSelect.mjs';
import { loadFrontend } from '../frontend-test-loader.mjs';
import { placeById } from '../../lib/places.js';

const { createProductionRuntime } = await loadFrontend('production/runtime');

export const ON = Object.freeze({ HALO_FEATURE_OUTREACH: 'on', HALO_FEATURE_WORKSPACE: 'on' });
export const WAKE = placeById('us-county:37183');
export const RALEIGH = placeById('us-place:3755000');

const asRpcError = (error) => rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);

/** Each 0031 function the routes call: its parameters in order and their casts. */
const FUNCTIONS = Object.freeze({
  read_outreach_drafts: [['p_profile_id', 'uuid'], ['p_draft_id', 'uuid']],
  save_outreach_draft: [['p_profile_id', 'uuid'], ['p_operation_id', 'uuid'], ['p_draft', 'jsonb']],
});

export async function createWorld(db, { env = ON, migrated = true, wrap = {} } = {}) {
  const w = await createWorkspaceWorld(db, { env });
  if (migrated) {
    for (const [name, params] of Object.entries(FUNCTIONS)) {
      const call = async (args) => {
        const sql = `select public.${name}(${params.map(([, type], at) => `$${at + 1}::${type}`).join(', ')}) as result`;
        const values = params.map(([param, type]) => (type === 'jsonb' ? JSON.stringify(args[param]) : args[param] ?? null));
        try {
          return await db.asService(async (tx) => (await tx.query(sql, values)).rows[0].result, { commit: true });
        } catch (error) {
          throw asRpcError(error);
        }
      };
      w.h.db.registerRpc(name, (args) => (wrap[name] ? wrap[name](args, () => call(args)) : call(args)), { args: params.map(([param]) => param) });
    }
  }
  const fakeFrom = w.h.db.from;
  w.h.db.from = (name) => (name === 'explore_areas' ? pgliteSelect(db, name, w.h.db.queryLog) : fakeFrom(name));

  /** The frontend's own runtime for `who`; `lose(path, init)` drops an answer after the server gave it. */
  function runtime(who = 'alice', { lose = () => false, env: callEnv } = {}) {
    const fetcher = async (path, init) => {
      const url = new URL(path, 'http://halo.test');
      const response = await w.h.call(url.pathname, init.method, { as: who, url: `${url.pathname}${url.search}`, headers: init.headers, rawBody: init.body, env: callEnv });
      if (lose(url.pathname, init)) throw new TypeError('fetch failed');
      return response;
    };
    return createProductionRuntime({
      identityId: w.ids[who],
      homeContextId: w.home[who],
      contextRevision: 1,
      credential: async () => ({ identityId: w.ids[who], accessToken: w.h.identities[who].token }),
      fetcher,
    });
  }

  return Object.assign(w, {
    runtime,
    /** Saves `place` as the household's Explore area, as the 0022 table holds it. */
    async saveArea(who, place) {
      await db.query(
        `insert into public.explore_areas (profile_id, place_id, place, state, label, timezone, revision) values ($1, $2, $3, $4, $5, $6, 2)
         on conflict (profile_id) do update set place_id = excluded.place_id, place = excluded.place, state = excluded.state,
           label = excluded.label, timezone = excluded.timezone, revision = public.explore_areas.revision + 1`,
        [w.ids[who], place?.id ?? null, place?.place ?? null, place?.state ?? null, place?.label ?? null, place?.timezone ?? null],
      );
    },
    /** A saved Explore note through the real workspace route; returns the stored record. */
    async saveNote(who, over = {}) {
      const record = sampleRecord('exploreNotes', over);
      const res = await w.command(commandBody({ kind: 'write', collection: 'exploreNotes', record, expectedRevision: null }), { as: who });
      const out = await res.json();
      if (out.status !== 'succeeded') throw new Error(`saveNote: ${JSON.stringify(out)}`);
      return out.changes.exploreNotes.find((row) => row.id === record.id);
    },
    /** A raw call to an outreach route. */
    call(path, method, { as = 'alice', body, query = '', headers = {}, env: callEnv } = {}) {
      return w.h.call(path, method, {
        as,
        url: `${path}${query}`,
        rawBody: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        env: callEnv,
      });
    },
    async drafts(who = 'alice') {
      return (await db.query('select draft_id::text as id, recipient, to_address, subject, body, revision, notes from public.outreach_drafts where profile_id = $1 order by created_at', [w.ids[who] ?? who])).rows;
    },
  });
}
