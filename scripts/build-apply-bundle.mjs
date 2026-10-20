// Builds the one-paste bundles for migrations that are written but not yet
// applied to production, plus, for each, one read-only query that checks all
// of its migrations at once.
//
//   node scripts/build-apply-bundle.mjs           writes docs/backend/apply/
//   node scripts/build-apply-bundle.mjs --check   exits 1 if those files are stale
//
// A bundle is its migration files verbatim, in order, inside one transaction,
// so a failure part way leaves the database exactly as it was. Every migration
// is idempotent on its own, so a bundle is safe to run twice. Its check query
// is each migration's own "Verification (read only)" comment, unchanged,
// folded into one row: all_migrations_ok, checks_run, and the name of any
// check that failed. test/applyBundle.test.mjs proves both against a real
// Postgres (PGlite).
//
// BUNDLES is history as well as the queue: 0019 to 0023 were applied to
// production with the first bundle on 2026-10-19, and it is kept (and still
// tested) because YOUR_TODO.md 2.13 documents it. A new pending migration
// gets a new entry rather than being added to an applied bundle.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
export const OUT_DIR = path.join(ROOT, 'docs/backend/apply');

/** Each bundle: its migrations oldest first, what must already be applied, and its two files. */
export const BUNDLES = Object.freeze([
  Object.freeze({
    title: 'migrations 0019 to 0023',
    checks: 'migrations 0019 to 0023 are all',
    needs: 'Needs 0001 to 0018 applied first (they are, on production, since 2026-10-17).',
    bundleFile: 'apply-0019-to-0023.sql',
    verifyFile: 'verify-0019-to-0023.sql',
    migrations: Object.freeze([
      '0019_recovery_challenge_intent',
      '0020_luna_conversations',
      '0021_settings_preferences_and_alerts',
      '0022_explore_areas',
      '0023_household_actions',
    ]),
  }),
  Object.freeze({
    title: 'migration 0024',
    checks: 'migration 0024 is',
    needs: 'Needs 0001 to 0023 applied first (they are, on production, since 2026-10-19).',
    bundleFile: 'apply-0024.sql',
    verifyFile: 'verify-0024.sql',
    migrations: Object.freeze(['0024_privacy_clear']),
  }),
  Object.freeze({
    title: 'migration 0025',
    checks: 'migration 0025 is',
    needs: 'Needs 0001 to 0016 applied first (production has 0001 to 0023). It does not need 0024, and may go before or after it.',
    bundleFile: 'apply-0025.sql',
    verifyFile: 'verify-0025.sql',
    migrations: Object.freeze(['0025_daily_maxima']),
  }),
  Object.freeze({
    title: 'migration 0026',
    checks: 'migration 0026 is',
    needs: 'Needs 0016 and 0017 applied first (production has 0001 to 0023). It does not need 0024 or 0025, and may go before or after them.',
    bundleFile: 'apply-0026.sql',
    verifyFile: 'verify-0026.sql',
    migrations: Object.freeze(['0026_household_workspace']),
  }),
  Object.freeze({
    title: 'migration 0027',
    checks: 'migration 0027 is',
    needs: 'Needs 0001 applied first; the operator routes also use 0017. It does not need 0026, and may go before or after it.',
    bundleFile: 'apply-0027.sql',
    verifyFile: 'verify-0027.sql',
    migrations: Object.freeze(['0027_operator_source_ops']),
  }),
  Object.freeze({
    title: 'migration 0028',
    checks: 'migration 0028 is',
    needs: 'Needs 0017 and 0026 applied first (0026 is not on production yet: apply it first). It does not need 0024, 0025 or 0027.',
    bundleFile: 'apply-0028.sql',
    verifyFile: 'verify-0028.sql',
    migrations: Object.freeze(['0028_household_attachments']),
  }),
  Object.freeze({
    title: 'migration 0029',
    checks: 'migration 0029 is',
    needs: 'Needs 0016, 0017 and 0026 applied first (0026 is not on production yet: apply it first). It reads 0023 only for a summary that names a task. It does not need 0024, 0025, 0027 or 0028.',
    bundleFile: 'apply-0029.sql',
    verifyFile: 'verify-0029.sql',
    migrations: Object.freeze(['0029_household_summaries']),
  }),
  Object.freeze({
    title: 'migration 0030',
    checks: 'migration 0030 is',
    needs: 'Needs 0017 applied first (production has 0001 to 0023). It does not need 0024 to 0029, and may go before or after them.',
    bundleFile: 'apply-0030.sql',
    verifyFile: 'verify-0030.sql',
    migrations: Object.freeze(['0030_project_generations']),
  }),
  Object.freeze({
    title: 'migration 0031',
    checks: 'migration 0031 is',
    needs: 'Needs 0017 applied first. It does not need 0018 to 0030; a draft that includes notes needs 0026 at run time.',
    bundleFile: 'apply-0031.sql',
    verifyFile: 'verify-0031.sql',
    migrations: Object.freeze(['0031_outreach_drafts']),
  }),
]);

/** The 0019 to 0023 bundle under its original names, which test/applyBundle.test.mjs and YOUR_TODO.md 2.13 use. */
export const BUNDLE_FILE = BUNDLES[0].bundleFile;
export const VERIFY_FILE = BUNDLES[0].verifyFile;
export const PENDING = BUNDLES[0].migrations;

const read = (name) => readFileSync(path.join(MIGRATIONS, `${name}.sql`), 'utf8').replace(/\r\n/g, '\n');

/** The "Verification (read only)" select in a migration's trailing comment, uncommented. */
export function verificationQuery(name) {
  const lines = read(name).split('\n');
  const start = lines.findIndex((line) => /^--\s*Verification \(read only\)/.test(line));
  if (start < 0) throw new Error(`${name}: no "Verification (read only)" block`);
  const body = [];
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^-- -{10,}/.test(line)) break;
    if (!line.startsWith('--')) break;
    body.push(line.replace(/^--\s?/, ''));
  }
  const sql = body.join('\n').trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(sql)) throw new Error(`${name}: verification block is not a select`);
  return sql;
}

export function buildBundle(bundle = BUNDLES[0]) {
  const parts = [
    `-- HALO: apply ${bundle.title} in one paste.`,
    '-- Generated by scripts/build-apply-bundle.mjs from supabase/migrations; do not edit by hand.',
    `-- ${bundle.needs}`,
    '-- One transaction: if any statement fails, nothing is changed (run `rollback;` if the',
    '-- editor says the transaction is aborted), then send the error text. Safe to run twice.',
    `-- Afterwards run ${bundle.verifyFile} and expect all_migrations_ok = true.`,
    '',
    'begin;',
    '',
  ];
  for (const name of bundle.migrations) {
    parts.push(
      '-- ===========================================================================',
      `-- ${name}.sql`,
      '-- ===========================================================================',
      '',
      read(name).trimEnd(),
      '',
    );
  }
  parts.push('commit;', '', "notify pgrst, 'reload schema';", '');
  return parts.join('\n');
}

export function buildVerify(bundle = BUNDLES[0]) {
  const blocks = bundle.migrations.map((name) => {
    const tag = name.slice(0, 4);
    return [
      `  select '${tag}' as migration, j.key as check_name, coalesce(j.value::boolean, false) as ok`,
      `  from (`,
      verificationQuery(name).split('\n').map((line) => `    ${line}`).join('\n'),
      `  ) q, jsonb_each_text(to_jsonb(q)) j`,
    ].join('\n');
  });
  return [
    `-- HALO: check that ${bundle.checks} applied correctly. Read only.`,
    '-- Generated by scripts/build-apply-bundle.mjs from each migration\'s own verification query.',
    '-- Expect one row: all_migrations_ok = true and failing = none.',
    '',
    'with checks as (',
    blocks.join('\n  union all\n'),
    ')',
    'select bool_and(ok) as all_migrations_ok,',
    '       count(*) as checks_run,',
    "       coalesce(string_agg(migration || '.' || check_name, ', ') filter (where not ok), 'none') as failing",
    'from checks;',
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = Object.fromEntries(
    BUNDLES.flatMap((bundle) => [[bundle.bundleFile, buildBundle(bundle)], [bundle.verifyFile, buildVerify(bundle)]]),
  );
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([file, text]) => {
      try {
        return readFileSync(path.join(OUT_DIR, file), 'utf8') !== text;
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(`stale: ${stale.map(([file]) => file).join(', ')}; run node scripts/build-apply-bundle.mjs`);
      process.exit(1);
    }
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(OUT_DIR, file), text);
    console.log(`wrote ${Object.keys(files).join(', ')} to docs/backend/apply/`);
  }
}
