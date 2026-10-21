/**
 * Migration 0030 on PGlite (test/db/pgliteHarness.mjs): the idea-set table and
 * its functions, the first-write-wins key, the retention the record function
 * keeps, the clear-all trigger, the grants, a re-run, and the back-out block
 * in the migration's own trailing comment, run as Vibhav would paste it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, listMigrations } from './db/pgliteHarness.mjs';

const MIGRATION = listMigrations().find((m) => m.name === '0030_project_generations');
const ALICE = 'b1600000-0000-4000-8000-0000000000a1';
const BOB = 'b1600000-0000-4000-8000-0000000000b2';
let db;
before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true);`);
});
after(async () => { await db?.close(); });

const id = (n) => `9e400000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (owner, n, status = 'completed') => db.asService(async (tx) => {
  return (await tx.query('select public.record_project_generation($1, $2, $3, $4, $5::jsonb) as r', [owner, id(n), `${owner}:none:0`, status, JSON.stringify({ id: id(n), status, n })])).rows[0].r;
}, { commit: true });
const rows = async (owner) => (await db.query('select generation_id::text as id, status from public.household_project_generations where profile_id = $1 order by created_at, generation_id', [owner])).rows;

test('the first write for an id stands: a repeat returns the stored row and inserts nothing', async () => {
  const first = await record(ALICE, 1, 'cancelled');
  assert.equal(first.inserted, true);
  assert.equal(first.row.status, 'cancelled');
  const second = await record(ALICE, 1, 'completed');
  assert.equal(second.inserted, false);
  assert.equal(second.row.status, 'cancelled', 'a cancellation stored first wins');
  // The same id for another household is its own row.
  assert.equal((await record(BOB, 1, 'completed')).inserted, true);
  const read = (await db.asService((tx) => tx.query('select public.read_project_generation($1, $2) as r', [BOB, id(1)]))).rows[0].r;
  assert.equal(read.status, 'completed');
  assert.equal(read.contextKey, `${BOB}:none:0`);
  assert.equal((await db.asService((tx) => tx.query('select public.read_project_generation($1, $2) as r', [ALICE, id(999)]))).rows[0].r, null);
});

test('retention: the newest 20 rows and always the newest completed one', async () => {
  const owner = 'b1600000-0000-4000-8000-0000000000c3';
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${owner}', true);`);
  await record(owner, 100, 'completed');
  for (let n = 101; n <= 125; n += 1) await record(owner, n, 'cancelled');
  const kept = await rows(owner);
  assert.equal(kept.length, 21, 'twenty newest and the one completed set');
  assert.ok(kept.some((row) => row.id === id(100) && row.status === 'completed'));
  const current = (await db.asService((tx) => tx.query('select public.read_current_project_generation($1) as r', [owner]))).rows[0].r;
  assert.equal(current.generationId, id(100));
  assert.equal((await db.query('select public.project_privacy_counts($1) as c', [owner])).rows[0].c.household_project_generations, 21);
});

test('malformed arguments are HALO_INVALID_INPUT', async () => {
  for (const args of [[null, id(1), 'k', 'completed', '{}'], [ALICE, id(2), 'k', 'running', '{}'], [ALICE, id(3), '', 'completed', '{}'], [ALICE, id(4), 'k', 'completed', '[]']]) {
    await assert.rejects(db.asService((tx) => tx.query('select public.record_project_generation($1, $2, $3, $4, $5::jsonb)', args)), /HALO_INVALID_INPUT/);
  }
});

test('clear all deletes the household\'s rows in the clear\'s own settle; another household and clear journal keep theirs', async () => {
  const op = 'c1ea0000-0000-4000-8000-000000000001';
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'privacy', 'privacy.clear.journal', 'pending')`, ['c1ea0000-0000-4000-8000-000000000002', ALICE]);
  await db.query(`update public.operations set status = 'succeeded', result = jsonb_build_object('operationId', operation_id::text, 'status', 'succeeded') where operation_id = $1`, ['c1ea0000-0000-4000-8000-000000000002']);
  assert.ok((await rows(ALICE)).length > 0, 'clear journal keeps them');
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status) values ($1, $2, 'privacy', 'privacy.clear.all', 'pending')`, [op, ALICE]);
  await db.query(`update public.operations set status = 'succeeded', result = jsonb_build_object('operationId', operation_id::text, 'status', 'succeeded') where operation_id = $1`, [op]);
  assert.deepEqual(await rows(ALICE), []);
  assert.ok((await rows(BOB)).length > 0);
});

test('no client role can reach the table or the functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select * from public.household_project_generations')), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select public.read_current_project_generation($1)', [ALICE])), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query(`select public.record_project_generation($1, $2, 'k', 'completed', '{}'::jsonb)`, [ALICE, id(7)])), /permission denied/);
  }
});

test('running 0030 again changes nothing, and the verification query is all true', async () => {
  const before = (await db.query('select count(*)::int as n from public.household_project_generations')).rows[0].n;
  await db.exec(MIGRATION.sql);
  assert.equal((await db.query('select count(*)::int as n from public.household_project_generations')).rows[0].n, before);
  const lines = MIGRATION.sql.split('\n');
  const start = lines.findIndex((line) => /^--\s*Verification \(read only\)/.test(line));
  const body = [];
  for (let i = start + 2; i < lines.length && /^--\s{3}/.test(lines[i]); i += 1) body.push(lines[i].replace(/^--\s{3}/, ''));
  const [check] = (await db.query(body.join('\n').replace(/;\s*$/, ''))).rows;
  assert.ok(Object.values(check).every((value) => value === true), JSON.stringify(check));
});

test('the back-out block removes everything 0030 made, and 0030 applies again afterwards', async () => {
  const lines = MIGRATION.sql.split('\n');
  const at = lines.findIndex((line) => line.trim() === '-- <!-- backout-0030 -->');
  assert.ok(at > 0);
  const block = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('-- '); i += 1) {
    const text = lines[i].slice(3);
    if (text.startsWith('Then run')) break;
    block.push(text);
  }
  await db.exec(block.join('\n'));
  assert.equal((await db.query(`select to_regclass('public.household_project_generations') as t`)).rows[0].t, null);
  assert.equal((await db.query(`select count(*)::int as n from pg_proc where proname in ('record_project_generation', 'read_project_generation', 'read_current_project_generation', 'project_privacy_counts', 'project_generation_json', 'clear_project_generations_with_privacy_clear')`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from pg_trigger where tgname = 'operations_privacy_clear_project_generations'`)).rows[0].n, 0);
  await db.exec(MIGRATION.sql);
  assert.notEqual((await db.query(`select to_regclass('public.household_project_generations') as t`)).rows[0].t, null);
});
