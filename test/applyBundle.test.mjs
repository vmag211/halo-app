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

// ---- The 0025 bundle (B08 Task 1): one migration that needs only 0016, so
// it is proved over 0001 to 0023 (production, with 0024 still pending), over
// 0001 to 0024, and with 0024 applied after it.

const MAXIMA = BUNDLES.find((bundle) => bundle.bundleFile === 'apply-0025.sql');
const MAXIMA_CHECKS = { all_migrations_ok: true, checks_run: 9, failing: 'none' };
const asNumbers = (row) => ({ ...row, checks_run: Number(row.checks_run) });

test('the 0025 bundle and check are committed, current, and hold exactly 0025', () => {
  assert.ok(MAXIMA, 'no apply-0025.sql bundle in BUNDLES');
  assert.deepEqual([...MAXIMA.migrations], ['0025_daily_maxima']);
  assert.equal(committed(MAXIMA.bundleFile), buildBundle(MAXIMA), 'run node scripts/build-apply-bundle.mjs');
  assert.equal(committed(MAXIMA.verifyFile), buildVerify(MAXIMA), 'run node scripts/build-apply-bundle.mjs');
  assert.ok(!buildBundle(MAXIMA).includes('-- 0024_privacy_clear.sql'), 'the 0025 bundle does not carry 0024');
});

for (const upTo of [23, 24]) {
  test(`the 0025 bundle applies on top of 0001 to 00${upTo}, twice, and every check passes`, async () => {
    const db = await createDb({ upTo });
    try {
      await applySql(db.pg, 'the 0025 bundle', buildBundle(MAXIMA));
      assert.deepEqual(asNumbers(await verify(db, MAXIMA)), MAXIMA_CHECKS);
      await applySql(db.pg, 'the 0025 bundle, again', buildBundle(MAXIMA));
      assert.deepEqual(asNumbers(await verify(db, MAXIMA)), MAXIMA_CHECKS);
      assert.deepEqual((await db.query(`select public.daily_maxima_schema_version() as v`)).rows, [{ v: 1 }]);
    } finally {
      await db.close();
    }
  });
}

test('0025 first and 0024 after it: both checks pass, and clear all removes and counts the maxima', async () => {
  const db = await createDb({ upTo: 23 });
  const owner = 'a11ce000-0000-4000-8000-000000000025';
  const home = 'a11ce000-0000-4000-8000-00000000c025';
  const operation = '00000000-0000-4000-8000-0000000b0825';
  try {
    await applySql(db.pg, 'the 0025 bundle', buildBundle(MAXIMA));
    await applySql(db.pg, 'the 0024 bundle', buildBundle(PRIVACY));
    assert.deepEqual(asNumbers(await verify(db, MAXIMA)), MAXIMA_CHECKS);
    assert.equal((await verify(db, PRIVACY)).all_migrations_ok, true);
    await db.exec(`insert into auth.users (id, is_anonymous) values ('${owner}', true);
      insert into public.home_contexts (id, profile_id, sequence, origin, lat, lng) values ('${home}', '${owner}', 1, 'onboard', 35.409, -80.58);
      insert into public.daily_maxima (profile_id, home_context_id, local_date, factor, value, unit, source_code, method_version,
                                       time_zone, hours_expected, hours_observed, retrieved_at)
        values ('${owner}', '${home}', '2026-10-20', 'uv', 4.2, 'UV index', 'open_meteo_forecast', 'daily-max-v1',
                'America/New_York', 24, 24, '2026-10-21T12:00:00Z');
      insert into public.operations (operation_id, profile_id, domain, kind) values ('${operation}', '${owner}', 'privacy', 'privacy.clear.all');`);
    const { rows: [{ counts }] } = await db.query(`select public.privacy_counts($1, 'all') as counts`, [owner]);
    assert.equal(Number(counts.daily_maxima), 1);
    const { rows: [{ out }] } = await db.query(
      `select public.clear_household_records($1, $2, 'all', public.privacy_fingerprint($1, array['profiles', 'home_contexts',
         'household_bands', 'symptom_logs', 'notification_prefs', 'push_subscriptions', 'profile_preferences', 'explore_areas',
         'household_actions', 'household_action_preferences', 'luna_conversations', 'luna_turns'])) as out`,
      [owner, operation],
    );
    assert.equal(out.receipt.status, 'succeeded');
    assert.deepEqual((await db.query(`select count(*)::int as n from public.daily_maxima`)).rows, [{ n: 0 }]);
  } finally {
    await db.close();
  }
});

test('the 0025 check names an open grant and a link that no longer cascades', async () => {
  const db = await createDb({ upTo: 23 });
  try {
    await applySql(db.pg, 'the 0025 bundle', buildBundle(MAXIMA));
    await db.exec('grant select on public.daily_maxima to anon');
    await db.exec(`alter table public.daily_maxima drop constraint daily_maxima_home_context_fkey;
      alter table public.daily_maxima add constraint daily_maxima_home_context_fkey foreign key (profile_id, home_context_id)
        references public.home_contexts (profile_id, id) on delete no action`);
    const row = await verify(db, MAXIMA);
    assert.equal(row.all_migrations_ok, false);
    assert.deepEqual(row.failing.split(', ').sort(), ['0025.both_links_cascade', '0025.no_client_access']);
  } finally {
    await db.close();
  }
});

test('the 0025 bundle over a schema without 0016 refuses and leaves nothing applied', async () => {
  const db = await createDb({ upTo: 15 });
  try {
    await assert.rejects(() => applySql(db.pg, 'the 0025 bundle', buildBundle(MAXIMA)), /HALO 0025 cannot be applied: missing public\.home_contexts \(0016\)/);
    await db.exec('rollback');
    const { rows } = await db.query("select to_regclass('public.daily_maxima') as maxima, to_regprocedure('public.daily_maxima_schema_version()') as probe");
    assert.deepEqual(rows[0], { maxima: null, probe: null });
  } finally {
    await db.close();
  }
});
