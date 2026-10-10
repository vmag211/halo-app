/**
 * Makes one column of one table look missing on a fake Supabase (h.db or createFakeSupabase()),
 * the way the database answers before the migration that adds it:
 *
 *   const calls = withoutColumn(h.db, 'daily_scores', 'home_context_id');            // PGRST204 (PostgREST)
 *   const calls = withoutColumn(h.db, 'daily_scores', 'home_context_id', '42703');   // 42703 (Postgres)
 *
 * Any statement on that table that names the column (a row key of an insert, upsert or update, a
 * selected column, a filter, an or() condition) fails with that error and changes nothing; every
 * other statement runs as usual. `calls` lists the statements that failed, as { method, code }.
 * Returns the list; `restore()` on it puts the real `from` back.
 */
import { pgError } from './fakeTable.mjs';

function missingColumnError(code, table, column) {
  if (code === '42703') return pgError('42703', `column "${column}" of relation "${table}" does not exist`);
  return pgError('PGRST204', `Could not find the '${column}' column of '${table}' in the schema cache`);
}

export function withoutColumn(db, table, column, code = 'PGRST204') {
  const realFrom = db.from;
  const failed = [];
  db.from = (name) => {
    const builder = realFrom(name);
    if (name !== table) return builder;
    let mentions = null;
    const proxy = new Proxy(builder, {
      get(target, property) {
        if (property === 'then') {
          if (mentions) {
            failed.push({ method: mentions, code });
            const answer = { data: null, count: null, error: missingColumnError(code, table, column) };
            return (resolve, reject) => Promise.resolve(answer).then(resolve, reject);
          }
          return target.then.bind(target);
        }
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => {
          if (!mentions && JSON.stringify(args).includes(column)) mentions = String(property);
          const out = value.apply(target, args);
          return out === target ? proxy : out;
        };
      },
    });
    return proxy;
  };
  failed.restore = () => { db.from = realFrom; };
  return failed;
}
