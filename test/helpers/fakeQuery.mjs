/**
 * The PostgREST-style query builder returned by `fake.from(table)`.
 *
 * It is a thenable like supabase-js's builder: nothing runs until it is awaited,
 * and awaiting yields `{ data, error, count }`. Supported: select (with count and
 * head), insert, upsert, update, delete; the filters eq, neq, gt, gte, lt, lte,
 * like, ilike, in, is, not, or, match; order (several keys), limit, range,
 * single, maybeSingle. A mutation returns rows only when `.select()` follows it.
 * Anything else that supabase-js has (contains, textSearch, embedded resources)
 * throws a clear error instead of silently doing nothing.
 */
import { matches, parseLogicTree, sortRows } from './fakeFilters.mjs';
import { pgError, wire } from './fakeTable.mjs';

const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is'];
const UNSUPPORTED = ['contains', 'containedBy', 'overlaps', 'textSearch', 'filter', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'csv', 'explain'];

/** `*` or `a, b, alias:c` -> null (all columns) or [{ source, name }]. */
function parseColumns(spec) {
  if (spec === undefined || spec === null || spec.trim() === '*') return null;
  if (/[()!]|::/.test(spec)) {
    throw new Error(`fakeSupabase: select("${spec}") uses embedded resources or casts, which the fake does not support`);
  }
  return spec.split(',').map((part) => {
    const [alias, source] = part.includes(':') ? part.split(':') : [null, part];
    return { source: source.trim(), name: (alias ?? source).trim() };
  });
}

function project(row, columns) {
  if (!columns) return row;
  return Object.fromEntries(columns.map(({ source, name }) => [name, row[source] === undefined ? null : row[source]]));
}

const singleRowError = (count) =>
  pgError('PGRST116', 'Cannot coerce the result to a single JSON object', `The result contains ${count} rows`);

export class QueryBuilder {
  #lookup;
  #name;
  #log;
  #maxRows;
  #state = {
    operation: 'select', payload: undefined, options: {}, columns: null, returning: true,
    count: null, head: false, filters: [], orders: [], offset: 0, limit: Infinity, single: null,
  };

  /**
   * `log` (optional) receives one { table, operation, filters, rows, values } entry per executed statement.
   * `maxRows` (optional) returns PostgREST's `db-max-rows` for a select: the server returns at most that many
   * rows whatever `.limit()` asked for, while `count` still reports every match.
   */
  constructor(lookup, name, log = null, maxRows = () => Infinity) {
    this.#lookup = lookup;
    this.#name = name;
    this.#log = log;
    this.#maxRows = maxRows;
  }

  static {
    for (const op of FILTER_OPS) {
      QueryBuilder.prototype[op] = function filter(column, value) {
        this.#state.filters.push({ type: 'cmp', column, op, value });
        return this;
      };
    }
    for (const name of UNSUPPORTED) {
      QueryBuilder.prototype[name] = function unsupported() {
        throw new Error(`fakeSupabase does not support .${name}() yet: add it to test/helpers/fakeFilters.mjs and fakeQuery.mjs`);
      };
    }
  }

  select(columns = '*', { count, head = false } = {}) {
    const state = this.#state;
    state.columns = parseColumns(columns);
    if (state.operation === 'select') {
      state.count = count ?? null;
      state.head = head;
    } else {
      state.returning = true;
    }
    return this;
  }

  insert(rows, options = {}) { return this.#mutate('insert', rows, options); }
  upsert(rows, options = {}) { return this.#mutate('upsert', rows, options); }
  update(values, options = {}) { return this.#mutate('update', values, options); }
  delete(options = {}) { return this.#mutate('delete', undefined, options); }

  #mutate(operation, payload, options) {
    Object.assign(this.#state, { operation, payload, options, returning: false });
    return this;
  }

  not(column, op, value) {
    this.#state.filters.push({ type: 'not', node: { type: 'cmp', column, op, value } });
    return this;
  }

  or(conditions) {
    this.#state.filters.push(parseLogicTree(conditions));
    return this;
  }

  match(query) {
    for (const [column, value] of Object.entries(query)) this.eq(column, value);
    return this;
  }

  order(column, { ascending = true, nullsFirst } = {}) {
    this.#state.orders.push({ column, ascending, nullsFirst });
    return this;
  }

  limit(count) {
    this.#state.limit = count;
    return this;
  }

  range(from, to) {
    this.#state.offset = from;
    this.#state.limit = to - from + 1;
    return this;
  }

  single() { this.#state.single = 'single'; return this; }
  maybeSingle() { this.#state.single = 'maybeSingle'; return this; }

  then(onFulfilled, onRejected) {
    return this.#run().then(onFulfilled, onRejected);
  }

  async #run() {
    const state = this.#state;
    this.#log?.push({
      table: this.#name,
      operation: state.operation,
      filters: structuredClone(state.filters),
      rows: state.payload === undefined || state.operation === 'update' ? [] : wire([].concat(state.payload)),
      values: state.operation === 'update' ? wire(state.payload) : null,
    });
    const table = this.#lookup(this.#name);
    if (!table) {
      return {
        data: null,
        count: null,
        error: pgError('PGRST205', `Could not find the table 'public.${this.#name}' in the schema cache`),
      };
    }
    if (state.single && state.operation !== 'select' && !state.returning) {
      throw new Error('fakeSupabase: .single() or .maybeSingle() after a write needs .select() first');
    }

    const hits = [];
    table.rows.forEach((row, index) => { if (matches(state.filters, row)) hits.push({ row, index }); });
    const total = hits.length;
    const rowCap = state.operation === 'select' ? Math.min(state.limit, this.#maxRows()) : state.limit;
    const chosen = sortRows(hits, state.orders, (hit) => hit.row).slice(state.offset, state.offset + rowCap);

    if (state.operation === 'select') {
      return this.#finish(chosen.map((hit) => hit.row), total, null);
    }
    const indexes = chosen.map((hit) => hit.index);
    const plan = {
      insert: () => table.insert(state.payload),
      upsert: () => table.upsert(state.payload, state.options),
      update: () => table.update(indexes, state.payload),
      delete: () => table.delete(indexes),
    }[state.operation]();
    if (plan.error) return { data: null, count: null, error: plan.error };
    return this.#finish(plan.rows, plan.rows.length, plan);
  }

  /** Shapes rows into { data, error, count }; commits a write plan only on success. */
  #finish(rows, total, plan) {
    const state = this.#state;
    const out = { data: null, error: null, count: !plan && state.count ? total : null };

    if (state.single && (rows.length > 1 || (state.single === 'single' && rows.length === 0))) {
      return { data: null, count: null, error: singleRowError(rows.length) }; // writes roll back
    }
    plan?.commit();
    if (plan && !state.returning) return out;
    if (state.head) return out;

    const shaped = rows.map((row) => wire(project(row, state.columns)));
    out.data = state.single ? (shaped[0] ?? null) : shaped;
    return out;
  }
}
