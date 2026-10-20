/**
 * A client that is built on first use instead of at import.
 *
 * `next build` imports every route module to collect its configuration, with
 * no secrets in the environment. A module that called `createClient(url, key)`
 * or `Redis.fromEnv()` at import therefore failed the build ("supabaseUrl is
 * required."), so a build needed real credentials. Wrapping the constructor in
 * this keeps the module's export (same name, same `client.from(...)` /
 * `client.auth.getUser(...)` usage) and moves construction to the first
 * property read, which only happens inside a request.
 *
 * Runtime behaviour is unchanged: the first read builds the client once and
 * every later read goes to that same instance. If the constructor throws (for
 * example a missing URL), nothing is cached, the error surfaces where the
 * client is first used, inside the handler's own try/catch, and the next use
 * tries again.
 *
 * Methods are bound to the real client, so `this` inside them is the client,
 * not this proxy.
 *
 * @template T
 * @param {() => T} construct
 * @returns {T}
 */
export function lazyClient(construct) {
  let instance;
  const real = () => {
    if (instance === undefined) instance = construct();
    return instance;
  };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const client = real();
        const value = Reflect.get(client, prop, client);
        return typeof value === 'function' ? value.bind(client) : value;
      },
      set(_target, prop, value) {
        return Reflect.set(real(), prop, value);
      },
      has(_target, prop) {
        return Reflect.has(real(), prop);
      },
    },
  );
}
