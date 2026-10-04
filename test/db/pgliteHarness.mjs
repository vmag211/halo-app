/**
 * PGlite harness: an in-memory Postgres for database-level tests.
 *
 *   const db = await createDb();                  // baseline + every migration
 *   const db = await createDb({ upTo: 7 });       // baseline + 0001..0007
 *   const db = await createDb({ migrations: false }); // baseline only
 *
 *   await db.exec(sql)                            // as the migration owner (the SQL editor's role)
 *   await db.query(sql, params)
 *   await db.asRole('authenticated', userId, (tx) => tx.query(...))  // rolled back
 *   await db.asService((tx) => tx.query(...), { commit: true })      // kept
 *   await db.close()
 *
 * The database is PGlite (Postgres compiled to WebAssembly), in memory and
 * local to the test process. It loads supabase/baseline/reconstructed_baseline.sql
 * (a reconstruction, not a capture of the deployed schema) and then applies
 * supabase/migrations/*.sql in numeric order, unmodified. pgvector is the real
 * extension (@electric-sql/pglite-pgvector), so 0007, 0008 and 0013 run as
 * written; nothing is stubbed or skipped.
 *
 * asRole runs the callback inside one transaction that first does
 * `set local role <role>` and sets request.jwt.claim.sub (and the newer
 * request.jwt.claims) so auth.uid() returns userId, exactly as PostgREST does
 * for a signed-in request. The transaction is rolled back afterwards unless the
 * caller passes { commit: true }, so a test cannot leak state into the next. An
 * error inside the callback rolls back and rethrows. One failed statement aborts
 * the transaction, so check one denied operation per asRole call.
 *
 * Postgres notices (for example "relation already exists, skipping") are not
 * printed: PGlite only logs them at debug level 1 and above, and the harness
 * leaves debug off.
 *
 * Run directly to work with the catalog audit (docs/backend/baseline.md):
 *   node test/db/pgliteHarness.mjs audit              reconstructed audit JSON
 *   node test/db/pgliteHarness.mjs normalize <file>   pretty-print a pasted result
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BASELINE_FILE = path.join(REPO_ROOT, 'supabase/baseline/reconstructed_baseline.sql');
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase/migrations');
export const AUDIT_FILE = path.join(REPO_ROOT, 'docs/backend/baseline-audit.sql');

/** The roles a Supabase API request runs as. */
export const ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);

/** A migration file name: four digits, an underscore, a snake_case name. */
export const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The migration files in apply order, read from disk.
 * @returns {Array<{ number: number, name: string, file: string, sql: string }>}
 */
export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort()
    .map((file) => ({
      number: Number(file.slice(0, 4)),
      name: file.replace(/\.sql$/, ''),
      file: path.join(dir, file),
      sql: readFileSync(path.join(dir, file), 'utf8'),
    }));
}

/**
 * Runs one SQL script as the migration owner. A failure is rethrown as a short
 * error naming the script, the Postgres error code and the character position,
 * instead of PGlite's error, which carries the whole script text.
 */
export async function applySql(pg, label, sql) {
  try {
    await pg.exec(sql);
  } catch (error) {
    const where = error.position ? ` at character ${error.position}` : '';
    const code = error.code ? ` [${error.code}]` : '';
    throw new Error(`${label} failed${code}${where}: ${error.message}`);
  }
}

/**
 * Boots a fresh in-memory database with the baseline and the migrations.
 * @param {{ upTo?: number, migrations?: boolean }} [options]
 *   upTo: apply only migrations numbered up to this one; migrations: false loads the baseline only.
 */
export async function createDb({ upTo = Infinity, migrations = true } = {}) {
  const pg = new PGlite({ extensions: { vector } });
  await pg.waitReady;
  const applied = [];
  try {
    await applySql(pg, 'the reconstructed baseline', readFileSync(BASELINE_FILE, 'utf8'));
    if (migrations) {
      for (const migration of listMigrations()) {
        if (migration.number > upTo) break;
        await applySql(pg, migration.name, migration.sql);
        applied.push(migration.name);
      }
    }
  } catch (error) {
    await pg.close();
    throw error;
  }

  /**
   * Runs fn(tx) as `role` with auth.uid() = userId (null for none) in one transaction.
   * @template T
   * @param {'anon'|'authenticated'|'service_role'} role
   * @param {string|null} userId
   * @param {(tx: import('@electric-sql/pglite').Transaction) => Promise<T>} fn
   * @param {{ commit?: boolean }} [options] commit: keep the changes (default: roll back)
   * @returns {Promise<T>}
   */
  async function asRole(role, userId, fn, { commit = false } = {}) {
    if (!ROLES.includes(role)) throw new Error(`asRole: unknown role "${role}" (expected one of ${ROLES.join(', ')})`);
    if (userId != null && !UUID.test(userId)) throw new Error(`asRole: "${userId}" is not a uuid`);
    const claims = userId == null ? { role } : { sub: userId, role };
    return pg.transaction(async (tx) => {
      // role is one of ROLES, so it is safe to place in the statement.
      await tx.exec(`set local role ${role}`);
      await tx.query(
        `select set_config('request.jwt.claim.sub', $1, true),
                set_config('request.jwt.claim.role', $2, true),
                set_config('request.jwt.claims', $3, true)`,
        [userId ?? '', role, JSON.stringify(claims)],
      );
      const result = await fn(tx);
      if (!commit && !tx.closed) await tx.rollback();
      return result;
    });
  }

  return {
    pg,
    applied,
    /** Applies a migration file's SQL as the owner; a failure names it briefly. */
    applyMigration: (migration) => applySql(pg, migration.name, migration.sql),
    exec: (sql) => pg.exec(sql),
    query: (sql, params) => pg.query(sql, params),
    asRole,
    /** As the service role key: no user, bypasses row level security. */
    asService: (fn, options) => asRole('service_role', null, fn, options),
    close: () => pg.close(),
  };
}

/** Runs docs/backend/baseline-audit.sql read-only and returns its JSON document. */
export async function runAudit(db) {
  const sql = readFileSync(AUDIT_FILE, 'utf8');
  return db.pg.transaction(async (tx) => {
    await tx.exec('set transaction read only');
    const { rows } = await tx.query(sql);
    await tx.rollback();
    return rows[0].halo_baseline_audit;
  });
}

/** Accepts the audit as pasted from the SQL editor: the bare object, or the row or rows around it. */
export function unwrapAudit(value) {
  if (Array.isArray(value) && value.length === 1) return unwrapAudit(value[0]);
  if (value && typeof value === 'object' && 'halo_baseline_audit' in value) return unwrapAudit(value.halo_baseline_audit);
  if (typeof value === 'string') return unwrapAudit(JSON.parse(value));
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file] = process.argv.slice(2);
  if (command === 'audit') {
    const db = await createDb();
    try {
      process.stdout.write(`${JSON.stringify(await runAudit(db), null, 2)}\n`);
    } finally {
      await db.close();
    }
  } else if (command === 'normalize' && file) {
    process.stdout.write(`${JSON.stringify(unwrapAudit(JSON.parse(readFileSync(file, 'utf8'))), null, 2)}\n`);
  } else {
    process.stderr.write('usage: node test/db/pgliteHarness.mjs audit | normalize <file>\n');
    process.exitCode = 2;
  }
}
