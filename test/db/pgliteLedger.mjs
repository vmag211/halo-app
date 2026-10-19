/**
 * Exactly the two supabase-js calls runOperation (lib/operations.js) makes on
 * the ledger, run on a PGlite database (pgliteHarness.mjs), so the real
 * runOperation meets the real ledger triggers:
 *
 *   const outcome = await runOperation(ledgerClient(db), { ... }, execute);
 *
 *   claim   .from('operations').upsert(row, { onConflict: 'operation_id', ignoreDuplicates: true }).select(...)
 *   settle  .from('operations').update({ status, result, updated_at }).eq('operation_id', id)
 *
 * A Postgres error comes back as PostgREST passes it on ({ code, message }),
 * which is what runOperation's settle logs and does not throw. Anything else
 * throws, so a change to what runOperation sends fails here loudly.
 */
import assert from 'node:assert/strict';

const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

export function ledgerClient(db) {
  return {
    from(table) {
      assert.equal(table, 'operations');
      return {
        upsert(row, { onConflict, ignoreDuplicates }) {
          assert.deepEqual([onConflict, ignoreDuplicates], ['operation_id', true]);
          return {
            async select() {
              const { rows } = await db.query(
                `insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash)
                 values ($1, $2, $3, $4, $5, $6) on conflict (operation_id) do nothing returning operation_id`,
                [row.operation_id, row.profile_id, row.domain, row.kind, row.status, row.request_hash],
              );
              return { data: rows, error: null };
            },
          };
        },
        update(values) {
          return {
            async eq(column, value) {
              assert.equal(column, 'operation_id');
              try {
                await db.query(`update public.operations set status = $2, result = $3::jsonb, updated_at = $4 where operation_id = $1`,
                  [value, values.status, json(values.result), values.updated_at]);
                return { error: null };
              } catch (error) {
                return { error: { code: error.code, message: error.message } };
              }
            },
          };
        },
      };
    },
  };
}
