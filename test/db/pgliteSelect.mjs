/**
 * Read-only selects of supabase-js's query builder, run on a PGlite database (pgliteHarness.mjs),
 * for route tests that should read what the real database functions wrote:
 *
 *   h.db.from = (name) => (name === 'daily_scores' ? pgliteSelect(db, name, h.db.queryLog) : fakeFrom(name));
 *
 * Only what the history reads use is supported: select(columns, { count: 'exact' }), eq, gte, lte,
 * is(column, null), order, limit and maybeSingle. Anything else throws, so a route that starts
 * using more fails loudly here instead of reading something else.
 *
 * Rows come back as PostgREST sends them (json_build_object: a date as 'YYYY-MM-DD', a timestamp
 * as ISO text, numbers as numbers), and a Postgres error as PostgREST passes it on ({ code,
 * message, details, hint }). Unlike the fake client, a column the schema does not have is an
 * error (42703), not a silent null. Each statement runs as the service role, as the routes' client
 * does, and is rolled back (it only reads). With `log`, each statement is also listed there in the
 * fake's queryLog shape, so auditOwnerScope can check it.
 */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifier(name) {
  const trimmed = String(name).trim();
  if (!IDENTIFIER.test(trimmed)) throw new Error(`pgliteSelect: "${name}" is not a plain column name`);
  return trimmed;
}

export function pgliteSelect(db, table, log = null) {
  const name = identifier(table);
  const state = { columns: null, count: null, where: [], params: [], filters: [], orders: [], limit: null, single: false };

  const compare = (op, sql) => (column, value) => {
    const col = identifier(column);
    state.params.push(value);
    state.where.push(`"${col}" ${sql} $${state.params.length}`);
    state.filters.push({ type: 'cmp', column: col, op, value });
    return builder;
  };

  const builder = {
    select(columns, { count = null, head = false } = {}) {
      if (head) throw new Error('pgliteSelect: head selects are not supported');
      state.columns = String(columns).split(',').map(identifier);
      state.count = count;
      return builder;
    },
    eq: compare('eq', '='),
    gte: compare('gte', '>='),
    lte: compare('lte', '<='),
    is(column, value) {
      if (value !== null) throw new Error('pgliteSelect: only is(column, null) is supported');
      const col = identifier(column);
      state.where.push(`"${col}" is null`);
      state.filters.push({ type: 'cmp', column: col, op: 'is', value: null });
      return builder;
    },
    order(column, { ascending = true } = {}) {
      state.orders.push(`"${identifier(column)}" ${ascending ? 'asc' : 'desc'}`);
      return builder;
    },
    limit(count) {
      state.limit = Number(count);
      return builder;
    },
    maybeSingle() {
      state.single = true;
      return builder;
    },
    then(onFulfilled, onRejected) {
      return run().then(onFulfilled, onRejected);
    },
  };
  for (const method of ['insert', 'upsert', 'update', 'delete', 'neq', 'gt', 'lt', 'in', 'not', 'or', 'match', 'range', 'single', 'like', 'ilike']) {
    builder[method] = () => { throw new Error(`pgliteSelect: .${method}() is not supported`); };
  }

  async function run() {
    if (!state.columns) throw new Error('pgliteSelect: call select() first');
    log?.push({ table: name, operation: 'select', filters: structuredClone(state.filters), rows: [], values: null });
    const where = state.where.length ? ` where ${state.where.join(' and ')}` : '';
    const fields = state.columns.map((col) => `'${col}', "${col}"`).join(', ');
    const order = state.orders.length ? ` order by ${state.orders.join(', ')}` : '';
    const limit = Number.isInteger(state.limit) ? ` limit ${state.limit}` : '';
    try {
      return await db.asService(async (tx) => {
        const { rows } = await tx.query(`select json_build_object(${fields}) as row from public."${name}"${where}${order}${limit}`, state.params);
        const data = rows.map((row) => row.row);
        let count = null;
        if (state.count === 'exact') {
          count = (await tx.query(`select count(*)::int as n from public."${name}"${where}`, state.params)).rows[0].n;
        }
        if (state.single) {
          if (data.length > 1) {
            return { data: null, count: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.length} rows`, hint: null } };
          }
          return { data: data[0] ?? null, count, error: null };
        }
        return { data, count, error: null };
      });
    } catch (error) {
      return { data: null, count: null, error: { code: error.code ?? null, message: error.message, details: error.detail ?? null, hint: error.hint ?? null } };
    }
  }

  return builder;
}
