/**
 * A household world for the `actions.commit` suites (B06 plan, Task 4):
 * the real route handlers on the isolated route harness, with migration
 * 0023's two REAL functions (read_household_actions, commit_household_actions)
 * running on a PGlite database (test/db/pgliteHarness.mjs), called as the
 * service role as PostgREST would call them.
 *
 * The ledger is one of two:
 *
 *   ledger: 'pglite'  lib/operations.js runs against the real
 *                     public.operations (test/db/pgliteLedger.mjs), with its
 *                     constraints and 0023's settled-row guard. This is the
 *                     world for Ruling H8: the commit function settles the
 *                     operation's own row in its transaction, and nothing the
 *                     route does afterwards can turn that into `failed`.
 *   ledger: 'fake'    the in-memory fake's `operations` table, whose
 *                     statements are in the query log and which a test can
 *                     seed in any shape. Before each commit call the
 *                     operation's row is mirrored into PGlite (insert if
 *                     absent), because the real function locks and settles
 *                     its own row there first (Ruling H29).
 *
 * Every world has two fresh households, alice and bob, in both the fake and
 * PGlite, so one database serves a whole file. `onCommit(args, call)` and
 * `onRead(args, call)` wrap the functions: a test can raise a refusal instead,
 * call through and then lose the response, or hold a call to race another.
 */
import { createRouteHarness, rpcError } from './routeHarness.mjs';
import { haloTables } from './tables.mjs';
import { pgliteLedger } from '../db/pgliteLedger.mjs';
import { clientRuntime, createActionAdapter, myWeek } from './frontendB06.mjs';

export const ON = Object.freeze({ HALO_FEATURE_TASKS: 'on' });
export const COMMIT = '/api/frontend/actions/commands';
export const LOAD = '/api/frontend/actions';
export const OPERATIONS = '/api/operations';

/** A PGlite error as PostgREST passes it on: code, message, details, hint. */
const asRpcError = (error) => rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);

let worlds = 0;

/**
 * @param {object} db a database from createDb()
 * @param {{ ledger?: 'pglite'|'fake', env?: object, onCommit?: Function, onRead?: Function }} [options]
 */
export async function createWorld(db, { ledger = 'pglite', env = ON, onCommit, onRead, tables: extraTables = [], fetch: harnessFetch } = {}) {
  worlds += 1;
  const prefix = (0xa0000000 + worlds).toString(16);
  const alice = `${prefix}-0000-4000-8000-00000000000a`;
  const bob = `${prefix}-0000-4000-8000-00000000000b`;
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${alice}', true), ('${bob}', true);`);

  const fake = ledger === 'fake';
  const h = createRouteHarness({
    // `tables` adds fake tables beside the PGlite-backed ones (B20's Luna world adds Luna's).
    tables: fake ? haloTables('profiles', 'operations', ...extraTables) : haloTables('profiles', ...extraTables),
    env,
    fetch: harnessFetch,
    identities: { alice: { id: alice }, bob: { id: bob } },
    seed: { profiles: [{ id: alice }, { id: bob }] },
  });
  if (!fake) {
    const fakeFrom = h.db.from;
    h.db.from = (name) => (name === 'operations' ? pgliteLedger(db, name, h.db.queryLog) : fakeFrom(name));
  }

  const read = async (args) => {
    try {
      return await db.asService(async (tx) => (await tx.query('select public.read_household_actions($1) as result', [args.p_profile_id])).rows[0].result);
    } catch (error) {
      throw asRpcError(error);
    }
  };

  /** The fake ledger's row for this operation, copied into PGlite if absent, so the real function finds it. */
  const mirror = async (operationId) => {
    if (!fake) return;
    const row = h.db.rows('operations').find((item) => item.operation_id === operationId);
    if (!row) return;
    await db.query(
      `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash, result, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) on conflict (operation_id) do nothing`,
      [row.operation_id, row.profile_id, row.domain, row.kind, row.status, row.request_hash, row.result === null || row.result === undefined ? null : JSON.stringify(row.result), row.created_at],
    );
  };

  const commit = async (args) => {
    await mirror(args.p_operation_id);
    try {
      return await db.asService(async (tx) => (await tx.query(
        'select public.commit_household_actions($1, $2, $3, $4::jsonb) as result',
        [args.p_profile_id, args.p_operation_id, args.p_base_version, JSON.stringify(args.p_writes)],
      )).rows[0].result, { commit: true });
    } catch (error) {
      throw asRpcError(error);
    }
  };

  h.db.registerRpc('read_household_actions', (args) => (onRead ? onRead(args, () => read(args)) : read(args)), { args: ['p_profile_id'] });
  h.db.registerRpc('commit_household_actions', (args) => (onCommit ? onCommit(args, () => commit(args)) : commit(args)), {
    args: ['p_profile_id', 'p_operation_id', 'p_base_version', 'p_writes'],
  });

  const world = {
    h, db, alice, bob, fake,
    ids: { alice, bob },

    /** POST the command as `as`, with `Idempotency-Key` equal to its operationId unless `key` says otherwise (null: none). */
    commit(body, { as = 'alice', key = body?.operationId, headers = {}, raw, env: callEnv } = {}) {
      return h.call(COMMIT, 'POST', {
        as,
        rawBody: raw ?? JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(key === null || key === undefined ? {} : { 'idempotency-key': key }), ...headers },
        env: callEnv,
      });
    },
    load: (as = 'alice', { headers = {} } = {}) => h.call(LOAD, 'GET', { as, headers }),
    reconcile: (operationId, { as = 'alice', domain = 'actions', env: callEnv } = {}) =>
      h.call(OPERATIONS, 'GET', { as, url: `${OPERATIONS}?operationId=${operationId}&domain=${domain}`, env: callEnv }),

    /** My Week as the client runs it, through the real handlers. */
    week(as = 'alice', { lose, today, homeContextId } = {}) {
      return myWeek(createActionAdapter(clientRuntime(h, as, { lose, homeContextId })), { today });
    },

    /** The household's stored tasks, as the 0023 table holds them, oldest first. */
    async tasks(who = 'alice') {
      const owner = world.ids[who] ?? who;
      return (await db.query(
        `select id::text, action_key, title, reason, origin, coalesce(to_char(due_date, 'YYYY-MM-DD'), '') as date, state, revision, meta, updated_at
           from public.household_actions where profile_id = $1 order by created_at, id`, [owner])).rows;
    },
    async preferences(who = 'alice') {
      const owner = world.ids[who] ?? who;
      return Object.fromEntries((await db.query('select pref_key, value from public.household_action_preferences where profile_id = $1', [owner])).rows.map((row) => [row.pref_key, row.value]));
    },
    async version(who = 'alice') {
      const owner = world.ids[who] ?? who;
      return (await db.query('select version from public.household_action_state where profile_id = $1', [owner])).rows[0]?.version ?? 0;
    },
    /** The operation's ledger row: the fake's for a fake ledger, else PGlite's. */
    async ledgerRow(operationId) {
      if (fake) return h.db.rows('operations').find((row) => row.operation_id === operationId) ?? null;
      return (await db.query('select operation_id::text, profile_id::text, domain, kind, status, request_hash, result from public.operations where operation_id = $1', [operationId])).rows[0] ?? null;
    },
    /** Every `result` this world's households hold in the ledger(s), as text, for the H3 audit. */
    async ledgerText() {
      const rows = (await db.query('select result from public.operations where profile_id in ($1, $2)', [alice, bob])).rows.map((row) => row.result);
      if (fake) rows.push(...h.db.rows('operations').map((row) => row.result));
      return JSON.stringify(rows);
    },
  };
  return world;
}

/** A command body with a fresh operation id. */
export const body = (command) => ({ operationId: crypto.randomUUID(), ...command });
