/**
 * The operation ledger (migration 0017's `public.operations`) through
 * supabase-js's query builder, run on a PGlite database (pgliteHarness.mjs),
 * for route tests whose ledger must be the real table, with its constraints
 * and triggers:
 *
 *   const fakeFrom = h.db.from;
 *   h.db.from = (name) => (name === 'operations' ? pgliteLedger(db, name, h.db.queryLog) : fakeFrom(name));
 *
 * Why it exists. B06 Ruling H8 puts a task write and the settle of its own
 * ledger row in one transaction, and 0023's `operations_actions_settled_guard`
 * trigger then stops runOperation from turning that `succeeded` row into
 * `failed` when the commit's response is lost (Ruling H28). The in-memory fake
 * has neither, so the test that proves "a task write exists if and only if its
 * operation is succeeded" has to run lib/operations.js against the real table.
 *
 * Only what lib/operations.js does to the table is supported: select(columns),
 * upsert(row, { onConflict: 'operation_id', ignoreDuplicates: true }) followed
 * by select(columns), update(values), and the filters eq, in, lt and
 * is(column, null), order(column, { ascending }) and maybeSingle(). Anything
 * else throws, so a ledger that starts doing more fails loudly here instead of
 * doing something else.
 *
 * Rows come back as PostgREST sends them (json_build_object: a timestamp as ISO
 * text, `result` as its JSON value), and a Postgres error as PostgREST passes
 * it on ({ code, message, details, hint }). Each statement runs as the service
 * role and commits, as the routes' client does. With `log`, each statement is
 * listed there in the fake's queryLog shape, so the owner-scope audits still
 * apply.
 */
const COLUMNS = Object.freeze({
  operation_id: 'uuid',
  profile_id: 'uuid',
  domain: 'text',
  kind: 'text',
  status: 'text',
  request_hash: 'text',
  result: 'jsonb',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
});

function column(name) {
  const trimmed = String(name).trim();
  if (!Object.hasOwn(COLUMNS, trimmed)) throw new Error(`pgliteLedger: "${name}" is not a column of operations`);
  return trimmed;
}

const asParam = (name, value) => (COLUMNS[name] === 'jsonb' && value !== null && value !== undefined ? JSON.stringify(value) : value ?? null);

export function pgliteLedger(db, table = 'operations', log = null) {
  if (table !== 'operations') throw new Error(`pgliteLedger: only the operations table is supported, not "${table}"`);
  const state = { mode: 'select', columns: null, row: null, values: null, where: [], params: [], filters: [], orders: [], single: false };

  const param = (name, value) => {
    state.params.push(asParam(name, value));
    return `$${state.params.length}::${COLUMNS[name]}`;
  };
  const compare = (op, sql) => (name, value) => {
    const col = column(name);
    state.where.push(`"${col}" ${sql} ${param(col, value)}`);
    state.filters.push({ type: 'cmp', column: col, op, value });
    return builder;
  };

  const builder = {
    select(columns) {
      state.columns = String(columns).split(',').map(column);
      return builder;
    },
    upsert(row, { onConflict, ignoreDuplicates } = {}) {
      if (onConflict !== 'operation_id' || ignoreDuplicates !== true) throw new Error('pgliteLedger: only the claim (insert if absent on operation_id) is supported');
      state.mode = 'upsert';
      state.row = row;
      return builder;
    },
    update(values) {
      state.mode = 'update';
      state.values = values;
      return builder;
    },
    eq: compare('eq', '='),
    lt: compare('lt', '<'),
    in(name, values) {
      const col = column(name);
      const list = values.map((value) => param(col, value));
      state.where.push(list.length ? `"${col}" in (${list.join(', ')})` : 'false');
      state.filters.push({ type: 'in', column: col, op: 'in', value: [...values] });
      return builder;
    },
    is(name, value) {
      if (value !== null) throw new Error('pgliteLedger: only is(column, null) is supported');
      const col = column(name);
      state.where.push(`"${col}" is null`);
      state.filters.push({ type: 'cmp', column: col, op: 'is', value: null });
      return builder;
    },
    order(name, { ascending = true } = {}) {
      state.orders.push(`"${column(name)}" ${ascending ? 'asc' : 'desc'}`);
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
  for (const method of ['insert', 'delete', 'neq', 'gt', 'gte', 'lte', 'not', 'or', 'match', 'range', 'single', 'limit', 'like', 'ilike']) {
    builder[method] = () => { throw new Error(`pgliteLedger: .${method}() is not supported`); };
  }

  const returning = () => (state.columns ? ` returning json_build_object(${state.columns.map((col) => `'${col}', "${col}"`).join(', ')}) as row` : '');
  const where = () => (state.where.length ? ` where ${state.where.join(' and ')}` : '');

  function statement() {
    if (state.mode === 'upsert') {
      const names = Object.keys(state.row).map(column);
      const values = names.map((name) => param(name, state.row[name]));
      return `insert into public.operations (${names.map((name) => `"${name}"`).join(', ')}) values (${values.join(', ')}) on conflict (operation_id) do nothing${returning()}`;
    }
    if (state.mode === 'update') {
      // The SET parameters come first in the text but are numbered after the
      // filters' ones, which were added as the builder was called.
      const sets = Object.entries(state.values).map(([name, value]) => `"${column(name)}" = ${param(name, value)}`);
      return `update public.operations set ${sets.join(', ')}${where()}${returning()}`;
    }
    if (!state.columns) throw new Error('pgliteLedger: call select() first');
    const fields = state.columns.map((col) => `'${col}', "${col}"`).join(', ');
    const order = state.orders.length ? ` order by ${state.orders.join(', ')}` : '';
    return `select json_build_object(${fields}) as row from public.operations${where()}${order}`;
  }

  async function run() {
    const sql = statement();
    log?.push({
      table: 'operations',
      operation: state.mode,
      filters: structuredClone(state.filters),
      rows: state.row ? [structuredClone(state.row)] : [],
      values: state.values ? structuredClone(state.values) : null,
    });
    try {
      const rows = await db.asService(async (tx) => (await tx.query(sql, state.params)).rows, { commit: true });
      const data = rows.map((row) => row.row);
      if (state.mode === 'update' && !state.columns) return { data: null, error: null };
      if (state.single) {
        if (data.length > 1) {
          return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.length} rows`, hint: null } };
        }
        return { data: data[0] ?? null, error: null };
      }
      return { data, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code ?? null, message: error.message, details: error.detail ?? null, hint: error.hint ?? null } };
    }
  }

  return builder;
}
