import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createDb, applySql } from './db/pgliteHarness.mjs';
import {
  OUT_DIR,
  BUNDLE_FILE,
  VERIFY_FILE,
  PENDING,
  BUNDLES,
  buildBundle,
  buildVerify,
} from '../scripts/build-apply-bundle.mjs';

// The one-paste bundle Vibhav runs in the Supabase SQL editor, and the one query
// that checks it. Both are generated from the migration files, so the first
// test pins the committed copies to them, and the rest run them on a real
// Postgres on top of 0001 to 0018, which is what production has.

const committed = (file) => readFileSync(path.join(OUT_DIR, file), 'utf8');

async function verify(db, bundle = BUNDLES[0]) {
  const { rows } = await db.query(buildVerify(bundle));
  assert.equal(rows.length, 1);
  return rows[0];
}

test('the committed bundle and check query match the migrations they are built from', () => {
  assert.equal(committed(BUNDLE_FILE), buildBundle(), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(committed(VERIFY_FILE), buildVerify(), 'run node scripts/build-apply-bundle.mjs');
  for (const name of PENDING) assert.ok(buildBundle().includes(`-- ${name}.sql`), name);
});

test('before the bundle, the check fails and names what is missing', async () => {
  const db = await createDb({ upTo: 18 });
  try {
    // Postgres resolves every regclass in the check up front, so on a database
    // without the new tables the query itself errors. That is a failure too,
    // and an unmistakable one.
    await assert.rejects(() => verify(db));
  } finally {
    await db.close();
  }
});

test('the bundle applies on top of 0001 to 0018, twice, and every check passes', async () => {
  const db = await createDb({ upTo: 18 });
  try {
    await applySql(db.pg, 'the bundle', buildBundle());
    const first = await verify(db);
    assert.equal(first.failing, 'none');
    assert.equal(first.all_migrations_ok, true);
    // 3 + 5 + 7 + 5 + 6: every column of every migration's own check.
    assert.equal(Number(first.checks_run), 26);

    await applySql(db.pg, 'the bundle, again', buildBundle());
    const second = await verify(db);
    assert.deepEqual({ ...second, checks_run: Number(second.checks_run) }, { ...first, checks_run: Number(first.checks_run) });
  } finally {
    await db.close();
  }
});

test('the check notices a broken migration and says which check failed', async () => {
  const db = await createDb({ upTo: 18 });
  try {
    await applySql(db.pg, 'the bundle', buildBundle());
    await db.exec('grant select on public.explore_areas to anon');
    const row = await verify(db);
    assert.equal(row.all_migrations_ok, false);
    assert.equal(row.failing, '0022.no_client_access');
  } finally {
    await db.close();
  }
});

test('a failure part way through leaves nothing applied', async () => {
  const db = await createDb({ upTo: 18 });
  try {
    const broken = buildBundle().replace('-- 0022_explore_areas.sql', '-- 0022_explore_areas.sql\nselect 1/0;');
    await assert.rejects(() => applySql(db.pg, 'a broken bundle', broken));
    // The bundle's own transaction is left aborted on this session; ending it
    // is what the header tells a person to do, and it changes nothing.
    await db.exec('rollback');
    const { rows } = await db.query("select to_regclass('public.luna_conversations') as luna, to_regclass('public.profile_preferences') as prefs");
    assert.deepEqual(rows[0], { luna: null, prefs: null });
  } finally {
    await db.close();
  }
});

// ---- The 0024 bundle (B07 Task 1): one migration, over 0001 to 0023, which
// is what production has since 2026-10-19.

const PRIVACY = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0024.sql');

test('the 0024 bundle and check are committed, current, and hold exactly 0024', () => {
  assert.ok(PRIVACY, 'no apply-0024.sql bundle in BUNDLES');
  assert.deepEqual([...PRIVACY.migrations], ['0024_privacy_clear']);
  assert.equal(committed(PRIVACY.bundleFile), buildBundle(PRIVACY), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(committed(PRIVACY.verifyFile), buildVerify(PRIVACY), 'run node scripts/build-apply-bundle.mjs');
  assert.ok(buildBundle(PRIVACY).includes('-- 0024_privacy_clear.sql'));
  assert.ok(!buildBundle(PRIVACY).includes('-- 0023_household_actions.sql'), 'an applied migration is not bundled again');
});

test('every migration is in exactly one bundle or applied before the first, so none is skipped', () => {
  const bundled = BUNDLES.flatMap((bundle) => bundle.migrations);
  assert.equal(new Set(bundled).size, bundled.length, 'a migration is in two bundles');
  assert.deepEqual(bundled.map((name) => Number(name.slice(0, 4))), bundled.map((_, at) => 19 + at), 'the bundles run 0019 upward with no gap');
});

test('the 0024 bundle applies on top of 0001 to 0023, twice, and every check passes', async () => {
  const db = await createDb({ upTo: 23 });
  try {
    await applySql(db.pg, 'the 0024 bundle', buildBundle(PRIVACY));
    const first = await verify(db, PRIVACY);
    assert.deepEqual({ ...first, checks_run: Number(first.checks_run) }, { all_migrations_ok: true, checks_run: 5, failing: 'none' });
    await applySql(db.pg, 'the 0024 bundle, again', buildBundle(PRIVACY));
    const second = await verify(db, PRIVACY);
    assert.deepEqual({ ...second, checks_run: Number(second.checks_run) }, { all_migrations_ok: true, checks_run: 5, failing: 'none' });
  } finally {
    await db.close();
  }
});

test('the 0024 check names a broken grant and an unplaced profiles column', async () => {
  const db = await createDb({ upTo: 23 });
  try {
    await applySql(db.pg, 'the 0024 bundle', buildBundle(PRIVACY));
    await db.exec('grant execute on function public.clear_household_records(uuid, uuid, text, text) to authenticated');
    await db.exec('alter table public.profiles add column nickname text');
    const row = await verify(db, PRIVACY);
    assert.equal(row.all_migrations_ok, false);
    assert.deepEqual(row.failing.split(', ').sort(), ['0024.functions_service_role_only', '0024.profiles_reset_complete']);
  } finally {
    await db.close();
  }
});

test('the 0024 bundle over a schema without 0023 refuses and leaves nothing applied', async () => {
  const db = await createDb({ upTo: 22 });
  try {
    await assert.rejects(() => applySql(db.pg, 'the 0024 bundle', buildBundle(PRIVACY)), /missing public\.household_actions/);
    await db.exec('rollback');
    const { rows } = await db.query("select to_regprocedure('public.privacy_schema_version()') as probe");
    assert.deepEqual(rows[0], { probe: null });
  } finally {
    await db.close();
  }
});
