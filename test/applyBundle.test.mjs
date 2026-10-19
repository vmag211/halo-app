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
  buildBundle,
  buildVerify,
} from '../scripts/build-apply-bundle.mjs';

// The one-paste bundle Vibhav runs in the Supabase SQL editor, and the one query
// that checks it. Both are generated from the migration files, so the first
// test pins the committed copies to them, and the rest run them on a real
// Postgres on top of 0001 to 0018, which is what production has.

const committed = (file) => readFileSync(path.join(OUT_DIR, file), 'utf8');

async function verify(db) {
  const { rows } = await db.query(buildVerify());
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
