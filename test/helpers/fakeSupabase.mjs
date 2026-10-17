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

const sameNames = (a, b) => a.length === b.length && a.every((name) => b.includes(name));

export function createFakeSupabase({ tables = {}, seed = {}, identities = [] } = {}) {
  const store = new Map();
  const users = new Map(); // auth user id -> { id, name, email, isAnonymous }
  const rpcHandlers = new Map();
  const rpcCalls = [];
  const queryLog = [];
  let authOutage = 'off';
  let maxRows = Infinity;

  const declare = (name, declaration) => {
    if (!store.has(name)) store.set(name, new FakeTable(name, declaration));
    return store.get(name);
  };
  for (const [name, declaration] of Object.entries(tables)) declare(name, declaration);
  for (const [name, rows] of Object.entries(seed)) declare(name).seed(rows);
  // `newEmail` and `emailChangeSentAt` are the provider's staged email change:
  // the address a person has asked for and not yet proved. It is deliberately
  // separate from `email`, which is unique and only ever holds a confirmed
  // address (see stageEmailChange and confirmEmailChange below).
  for (const identity of identities) {
    users.set(identity.id, {
      isAnonymous: false,
      email: null,
      emailConfirmedAt: null,
      newEmail: null,
      emailChangeSentAt: null,
      ...identity,
    });
  }

  const publicUser = (user) => ({
    id: user.id,
    email: user.email,
    is_anonymous: user.isAnonymous === true,
    aud: 'authenticated',
    role: 'authenticated',
  });

  /**
   * The Admin API's user payload: `email_confirmed_at` because that is how a
   * verified address is reported, and `new_email` with `email_change_sent_at`
   * because that is how an address awaiting confirmation is.
   */
  const adminUser = (user) => ({
    ...publicUser(user),
    email_confirmed_at: user.emailConfirmedAt ?? null,
    new_email: user.newEmail ?? null,
    email_change_sent_at: user.emailChangeSentAt ?? null,
  });

  const authError = (status, message, extra = {}) => ({
    name: status >= 500 || status === 0 ? 'AuthRetryableFetchError' : 'AuthApiError',
    status,
    message,
    ...extra,
  });

  const db = {
    from: (name) => new QueryBuilder((table) => store.get(table), name, queryLog, () => maxRows),

    /**
     * Dispatches to a handler registered with registerRpc; unknown names fail like PostgREST.
     * A function registered with `args` is found only when the call names exactly those
     * parameters (after the JSON trip, so an undefined argument is missing), as PostgREST
     * matches by argument names.
     */
    rpc: async (name, args = {}) => {
      const sent = wire(args);
      rpcCalls.push({ name, args: sent });
      const registered = rpcHandlers.get(name);
      if (!registered) {
        return {
          data: null,
          error: pgError('PGRST202', `Could not find the function public.${name} in the schema cache`),
        };
      }
      const { handler, params } = registered;
      if (params && !sameNames(Object.keys(sent), params)) {
        return {
          data: null,
          error: pgError(
            'PGRST202',
            `Could not find the function public.${name}(${Object.keys(sent).sort().join(', ')}) in the schema cache`,
            null,
            `Perhaps you meant to call the function public.${name}(${[...params].sort().join(', ')})`,
          ),
        };
      }
      try {
        return { data: wire((await handler(sent, db)) ?? null), error: null };
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
        /**
         * One user by id, as the Admin API returns it: `{ data: { user }, error }`,
         * with `email_confirmed_at` because that is how the real payload reports
         * a verified address (a linked-but-unconfirmed address has null).
         */
        getUserById: async (id) => {
          const user = users.get(id);
          if (!user) {
            return { data: { user: null }, error: authError(404, 'User not found', { code: 'user_not_found' }) };
          }
          return { data: { user: adminUser(user) }, error: null };
        },

        /**
         * Changes one user, as `auth.admin.updateUserById(id, attributes)` does.
         * Only `email_confirm` is modelled, which is what `remove-recovery`
         * uses to make a confirmed address stop being a credential.
         *
         * Setting `email` through the admin API is deliberately NOT modelled and
         * fails loudly: writing an address straight into the unique column
         * before anyone has proved it lets any identity occupy any unregistered
         * address, so linking goes through the caller's own email change
         * (stageEmailChange) instead. A route reaching for the shortcut should
         * break a test rather than pass one.
         *
         * The id never changes: there is no path here that creates a second
         * identity or moves rows between them (BE-050, BE-334).
         */
        updateUserById: async (id, attributes = {}) => {
          if (Object.hasOwn(attributes, 'email')) {
            throw new Error(
              'fakeSupabase: linking an address must use the caller\'s own email change, not admin.updateUserById({ email })',
            );
          }
          const user = users.get(id);
          if (!user) {
            return { data: { user: null }, error: authError(404, 'User not found', { code: 'user_not_found' }) };
          }
          const next = { ...user };
          if (Object.hasOwn(attributes, 'email_confirm')) {
            next.emailConfirmedAt = attributes.email_confirm
              ? next.emailConfirmedAt ?? new Date().toISOString()
              : null;
          }
          users.set(id, next);
          return { data: { user: adminUser(next) }, error: null };
        },

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

    /**
     * Registers `handler(args, db)` for rpc(name). Throw rpcError(code, message) to fail.
     * `args`: the function's parameter names; when given, a call must name exactly these.
     */
    registerRpc: (name, handler, { args: params } = {}) => { rpcHandlers.set(name, { handler, params }); },
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

    /**
     * Simulates PostgREST's `db-max-rows` (Supabase's API row cap): a select returns at most `limit`
     * rows however large a `.limit()` it asked for; `count: 'exact'` still reports every match.
     * Default `Infinity` (no cap).
     */
    setMaxRows: (limit) => { maxRows = limit; },

    /** 'off' | 'returned' (auth-js returns a 5xx error) | 'thrown' (network failure). */
    setAuthOutage: (mode) => { authOutage = mode; },

    /**
     * The provider's half of a user-scoped email change, step one: what
     * `PUT /auth/v1/user` with `{ email }` does. The address is recorded as
     * pending and a confirmation is sent; `email` and `email_confirmed_at` are
     * untouched, so the unique address column is not claimed by an address
     * nobody has proved. An address another identity already holds is refused
     * with `email_exists` before anything is staged, which is the provider's
     * unique constraint answering and is how a collision is detected.
     *
     * Returns `{ user }` or `{ error }`. A test route reaches this through the
     * fetch it injects, because the real call is HTTP rather than a client
     * method the fake could expose.
     */
    stageEmailChange: (id, email) => {
      const user = users.get(id);
      if (!user) return { error: 'user_not_found' };
      if (typeof email !== 'string' || !email.includes('@')) return { error: 'validation_failed' };
      const wanted = email.toLowerCase();
      // The provider only stages a change when the address differs from the one
      // the identity already carries. Asking for the same address is accepted
      // and does nothing: no pending change, and no message sent. Reachable
      // straight after remove-recovery, which leaves the address in place.
      if (wanted === (user.email ?? '').toLowerCase()) return { user: adminUser(user), staged: false };
      const held = (other) => other.id !== id && typeof other.email === 'string' && other.email.toLowerCase() === wanted;
      if ([...users.values()].some(held)) return { error: 'email_exists' };
      const next = { ...user, newEmail: email, emailChangeSentAt: new Date().toISOString() };
      users.set(id, next);
      return { user: adminUser(next) };
    },

    /**
     * Step two: what the provider does when the person opens the confirmation
     * link. The pending address becomes the identity's own address, confirmed,
     * and the identity stops being anonymous. The id does not change.
     *
     * If another identity has taken the address in the meantime the promotion
     * is refused and the pending change is dropped, because there is nothing
     * left to wait for. That is the second point at which a collision can
     * arrive, and all a later reader can see is that nothing is pending and
     * nothing is confirmed.
     */
    confirmEmailChange: (id) => {
      const user = users.get(id);
      if (!user?.newEmail) return { error: 'email_change_missing' };
      const wanted = String(user.newEmail).toLowerCase();
      const held = (other) => other.id !== id && typeof other.email === 'string' && other.email.toLowerCase() === wanted;
      if ([...users.values()].some(held)) {
        users.set(id, { ...user, newEmail: null, emailChangeSentAt: null });
        return { error: 'email_exists' };
      }
      const next = {
        ...user,
        email: user.newEmail,
        emailConfirmedAt: new Date().toISOString(),
        newEmail: null,
        emailChangeSentAt: null,
        isAnonymous: false,
      };
      users.set(id, next);
      return { user: adminUser(next) };
    },

    identities: users,
  };
  return db;
}

/** For rpc handlers: throw this to make the call return a Postgres-style error. */
export function rpcError(code, message, details = null, hint = null) {
  return pgError(code, message, details, hint);
}
