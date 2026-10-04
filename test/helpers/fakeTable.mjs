/**
 * One in-memory table: rows plus the Postgres rules the routes can trip over.
 *
 * Declared per table (all optional):
 *   primaryKey   'id' | ['a', 'b']     a null key column is a not-null violation
 *   unique       [['a', 'b'], ...]     composite unique constraints
 *   partialUnique [{ name, columns, where }]  a partial unique index: the key is
 *                unique among rows matching `where`, "<column> is null" or
 *                "<column> is not null" (nothing else is understood)
 *   ownerColumn  'profile_id'          rows cascade away with that auth user
 *   defaults     { id: () => uuid }    filled in for columns an insert omits
 *
 * Writes are statements: each one is planned against a copy and either commits
 * whole or returns an error and changes nothing, like a Postgres transaction.
 * Rows cross the boundary through JSON, like the network (undefined is dropped,
 * Dates become strings), so a route cannot mutate stored rows through a result.
 */
import { compareValue } from './fakeFilters.mjs';

export const wire = (value) => JSON.parse(JSON.stringify(value));

/** Shaped like postgrest-js's PostgrestError: an Error with code, details, hint. */
class PostgrestError extends Error {
  constructor(code, message, details, hint) {
    super(message);
    this.name = 'PostgrestError';
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

export function pgError(code, message, details = null, hint = null) {
  return new PostgrestError(code, message, details, hint);
}

const toColumns = (value) => (value === undefined ? [] : [].concat(value));
const isNil = (value) => value === null || value === undefined;
const sameColumns = (a, b) => a.length === b.length && a.every((column) => b.includes(column));

/** The rows a partial index covers, from its "<column> is [not] null" predicate. */
function partialPredicate(where) {
  const match = /^\s*(\w+) is (not )?null\s*$/i.exec(String(where));
  if (!match) throw new Error(`FakeTable: the partial unique predicate "${where}" is not "<column> is [not] null"`);
  const [, column, not] = match;
  return (row) => isNil(row[column]) === !not;
}

export class FakeTable {
  constructor(name, declaration = {}) {
    this.name = name;
    this.primaryKey = toColumns(declaration.primaryKey);
    this.unique = (declaration.unique ?? []).map(toColumns);
    this.partialUnique = (declaration.partialUnique ?? []).map(({ name: constraint, columns, where }) => ({
      constraint,
      columns: toColumns(columns),
      covers: partialPredicate(where),
    }));
    this.ownerColumn = declaration.ownerColumn ?? null;
    this.defaults = declaration.defaults ?? {};
    this.rows = [];
  }

  /** Every declared key as { columns, constraint }. */
  keys() {
    const keys = this.unique.map((columns) => ({
      columns,
      constraint: `${this.name}_${columns.join('_')}_key`,
    }));
    if (this.primaryKey.length) {
      keys.unshift({ columns: this.primaryKey, constraint: `${this.name}_pkey` });
    }
    return keys;
  }

  #withDefaults(row) {
    const filled = { ...row };
    for (const [column, make] of Object.entries(this.defaults)) {
      if (filled[column] === undefined) filled[column] = typeof make === 'function' ? make() : make;
    }
    return filled;
  }

  #nullKeyError(rows) {
    for (const row of rows) {
      for (const column of this.primaryKey) {
        if (isNil(row[column])) {
          return pgError('23502', `null value in column "${column}" of relation "${this.name}" violates not-null constraint`);
        }
      }
    }
    return null;
  }

  #uniqueError(rows) {
    const keys = [...this.keys(), ...this.partialUnique];
    for (const { columns, constraint, covers = () => true } of keys) {
      const seen = new Set();
      for (const row of rows.filter(covers)) {
        const values = columns.map((column) => row[column]);
        if (values.some(isNil)) continue; // NULLs never collide
        const signature = JSON.stringify(values);
        if (seen.has(signature)) {
          return pgError(
            '23505',
            `duplicate key value violates unique constraint "${constraint}"`,
            `Key (${columns.join(', ')})=(${values.join(', ')}) already exists.`,
          );
        }
        seen.add(signature);
      }
    }
    return null;
  }

  #plan(work, affected) {
    const error = this.#nullKeyError(work) ?? this.#uniqueError(work);
    if (error) return { error };
    return { rows: affected.map(wire), commit: () => { this.rows = work; } };
  }

  #copy() {
    return this.rows.map((row) => ({ ...row }));
  }

  /** Test setup. Constraints apply, so a bad seed fails loudly. */
  seed(rows) {
    const plan = this.insert(rows);
    if (plan.error) throw new Error(`fakeSupabase seed for "${this.name}": ${plan.error.message}`);
    plan.commit();
  }

  insert(rows) {
    const work = this.#copy();
    const added = [].concat(rows).map((row) => this.#withDefaults(wire(row)));
    work.push(...added);
    return this.#plan(work, added);
  }

  upsert(rows, { onConflict, ignoreDuplicates = false } = {}) {
    const columns = onConflict ? onConflict.split(',').map((column) => column.trim()) : this.primaryKey;
    if (!this.keys().some((key) => sameColumns(key.columns, columns))) {
      return {
        error: pgError(
          '42P10',
          'there is no unique or exclusion constraint matching the ON CONFLICT specification',
          columns.length ? `ON CONFLICT (${columns.join(', ')}) names no declared key of "${this.name}".` : null,
        ),
      };
    }
    const work = this.#copy();
    const touched = new Set();
    const affected = [];
    for (const raw of [].concat(rows)) {
      const payload = wire(raw);
      const candidate = this.#withDefaults(payload);
      const keyValues = columns.map((column) => candidate[column]);
      const at = keyValues.some(isNil)
        ? -1
        : work.findIndex((row) => columns.every((column) => compareValue('eq', row[column], candidate[column]) === true));
      if (at === -1) {
        work.push(candidate);
        touched.add(work.length - 1);
        affected.push(candidate);
      } else if (ignoreDuplicates) {
        continue;
      } else if (touched.has(at)) {
        return {
          error: pgError(
            '21000',
            'ON CONFLICT DO UPDATE command cannot affect row a second time',
            null,
            'Ensure that no rows proposed for insertion within the same command have duplicate constrained values.',
          ),
        };
      } else {
        work[at] = { ...work[at], ...payload };
        touched.add(at);
        affected.push(work[at]);
      }
    }
    return this.#plan(work, affected);
  }

  /** `indexes` are positions in this.rows chosen by the query's filters. */
  update(indexes, values) {
    const changes = wire(values);
    const work = this.#copy();
    for (const at of indexes) work[at] = { ...work[at], ...changes };
    return this.#plan(work, indexes.map((at) => work[at]));
  }

  delete(indexes) {
    const doomed = new Set(indexes);
    const removed = indexes.map((at) => this.rows[at]);
    return {
      rows: removed.map(wire),
      commit: () => { this.rows = this.rows.filter((_row, at) => !doomed.has(at)); },
    };
  }

  /** ON DELETE CASCADE from the auth user, for tables declaring an ownerColumn. */
  cascadeFromUser(userId) {
    if (!this.ownerColumn) return;
    this.rows = this.rows.filter((row) => row[this.ownerColumn] !== userId);
  }
}
