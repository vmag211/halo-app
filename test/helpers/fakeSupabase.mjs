/**
 * In-memory stand-in for the service-role Supabase client the routes use.
 *
 *   const db = createFakeSupabase({
 *     tables: { household_bands: { primaryKey: 'profile_id' } },
 *     seed: { household_bands: [{ profile_id: 'u1', has_senior: true }] },
 *     identities: [{ id: 'u1', name: 'alice', email: 'a@example.test' }],
 *   });
 *
 * Tables must be declared (or seeded) to exist: a query on any other table
 * returns PostgREST's PGRST205 error, which is how routes see "migration not
 * applied yet". Query behaviour lives in fakeQuery.mjs, constraints in
 * fakeTable.mjs, filters in fakeFilters.mjs. Not modelled: row-level security
 * (this is the service role), column lists, types, foreign keys, triggers.
 */
import { QueryBuilder } from './fakeQuery.mjs';
import { FakeTable, pgError, wire } from './fakeTable.mjs';

export const TOKEN_PREFIX = 'test-token:';

/** The bearer token that authenticates as the identity called `name`. */
export const tokenFor = (name) => `${TOKEN_PREFIX}${name}`;

const AUTH_OUTAGE_MESSAGE = 'fetch failed';

export function createFakeSupabase({ tables = {}, seed = {}, identities = [] } = {}) {
  const store = new Map();
  const users = new Map(); // auth user id -> { id, name, email, isAnonymous }
  const rpcHandlers = new Map();
  const rpcCalls = [];
  const queryLog = [];
  let authOutage = 'off';

  const declare = (name, declaration) => {
    if (!store.has(name)) store.set(name, new FakeTable(name, declaration));
    return store.get(name);
  };
  for (const [name, declaration] of Object.entries(tables)) declare(name, declaration);
  for (const [name, rows] of Object.entries(seed)) declare(name).seed(rows);
  for (const identity of identities) users.set(identity.id, { isAnonymous: false, email: null, ...identity });

  const publicUser = (user) => ({
    id: user.id,
    email: user.email,
    is_anonymous: user.isAnonymous === true,
    aud: 'authenticated',
    role: 'authenticated',
  });

  const authError = (status, message, extra = {}) => ({
    name: status >= 500 || status === 0 ? 'AuthRetryableFetchError' : 'AuthApiError',
    status,
    message,
    ...extra,
  });

  const db = {
    from: (name) => new QueryBuilder((table) => store.get(table), name, queryLog),

    /** Dispatches to a handler registered with registerRpc; unknown names fail like PostgREST. */
    rpc: async (name, args = {}) => {
      rpcCalls.push({ name, args: wire(args) });
      const handler = rpcHandlers.get(name);
      if (!handler) {
        return {
          data: null,
          error: pgError('PGRST202', `Could not find the function public.${name} in the schema cache`),
        };
      }
      try {
        return { data: wire((await handler(wire(args), db)) ?? null), error: null };
      } catch (error) {
        if (error?.name === 'PostgrestError') return { data: null, error };
        throw error;
      }
    },

    auth: {
      getUser: async (token) => {
        if (authOutage === 'thrown') throw new Error(AUTH_OUTAGE_MESSAGE);
        if (authOutage === 'returned') {
          return { data: { user: null }, error: authError(503, AUTH_OUTAGE_MESSAGE) };
        }
        const name = typeof token === 'string' && token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : null;
        const user = [...users.values()].find((candidate) => candidate.name === name);
        if (!user) return { data: { user: null }, error: authError(401, 'invalid JWT: unable to parse or verify signature') };
        return { data: { user: publicUser(user) }, error: null };
      },
      admin: {
        /** Removes the user and cascades to every table declaring an ownerColumn. */
        deleteUser: async (id) => {
          if (!users.delete(id)) {
            return { data: { user: null }, error: authError(404, 'User not found', { code: 'user_not_found' }) };
          }
          for (const table of store.values()) table.cascadeFromUser(id);
          return { data: { user: null }, error: null };
        },
      },
    },

    // Test controls below; the routes never call these.

    /** Registers `handler(args, db)` for rpc(name). Throw rpcError(code, message) to fail. */
    registerRpc: (name, handler) => { rpcHandlers.set(name, handler); },
    rpcCalls,

    /**
     * Every statement the routes ran, in order: { table, operation, filters, rows, values }.
     * `filters` are the parsed filter nodes ({ type: 'cmp', column, op, value }, ...), `rows`
     * the insert/upsert/delete payload and `values` the update payload. For audits such as
     * "every query on an owned table carried the owner filter".
     */
    queryLog,

    /** Adds rows to a table (declaring it if new). Constraints apply, so a bad row throws. */
    seed: (name, rows) => { declare(name).seed(rows); },

    /** A copy of a table's rows, for assertions. Throws for an undeclared table. */
    rows: (name) => {
      const table = store.get(name);
      if (!table) throw new Error(`fakeSupabase: no table "${name}" declared or seeded`);
      return wire(table.rows);
    },

    /** 'off' | 'returned' (auth-js returns a 5xx error) | 'thrown' (network failure). */
    setAuthOutage: (mode) => { authOutage = mode; },

    identities: users,
  };
  return db;
}

/** For rpc handlers: throw this to make the call return a Postgres-style error. */
export function rpcError(code, message, details = null, hint = null) {
  return pgError(code, message, details, hint);
}
