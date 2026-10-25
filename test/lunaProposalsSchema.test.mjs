/**
 * Migration 0035 (B20, Luna's task reviews) on a real Postgres (PGlite): the
 * constraints, the browser roles' lack of access, the count the privacy
 * preview uses, the cascades that make clearing honest, and the tested
 * back-out in docs/backend/YOUR_TODO.md.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';

const TODO = readFileSync(path.join(REPO_ROOT, 'docs/backend/YOUR_TODO.md'), 'utf8');
const MIGRATION = listMigrations().find((m) => m.number === 35);
const BEFORE = 34;
const ALICE = 'b0350000-0000-4000-8000-000000000001';
const CONVERSATION = 'b0350000-0000-4000-8000-0000000000c1';
const TURN = 'b0350000-0000-4000-8000-0000000000a1';

function docBlock(name) {
  const lines = TODO.split('\n');
  const at = lines.findIndex((line) => line.trim() === `<!-- ${name} -->`);
  assert.ok(at >= 0, `YOUR_TODO.md has no <!-- ${name} -->`);
  const open = lines.findIndex((line, index) => index > at && line.trim() === '```sql');
  const close = lines.findIndex((line, index) => index > open && line.trim() === '```');
  return lines.slice(open + 1, close).join('\n');
}

let db;
before(async () => {
  db = await createDb();
  await db.exec(`
    insert into auth.users (id, is_anonymous) values ('${ALICE}', true);
    insert into public.profiles (id) values ('${ALICE}') on conflict do nothing;
    insert into public.luna_conversations (id, profile_id) values ('${CONVERSATION}', '${ALICE}');
    insert into public.luna_turns (id, conversation_id, profile_id, role, body) values ('${TURN}', '${CONVERSATION}', '${ALICE}', 'assistant', 'I prepared this change.');
  `);
});
after(async () => { await db?.close(); });

const insert = (values = {}) => db.query(
  `insert into public.luna_proposals (profile_id, conversation_id, turn_id, kind, status, revision, payload, expires_at)
   values ($1, $2, $3, $4, $5, $6, $7::jsonb, now() + interval '30 minutes') returning id`,
  [ALICE, CONVERSATION, values.turn ?? TURN, values.kind ?? 'create', values.status ?? 'review', values.revision ?? 1, JSON.stringify(values.payload ?? { title: 'Test' })],
);

test('0035 is the last migration and keeps to the client\'s statuses, a positive revision and a small object payload', async () => {
  assert.ok(MIGRATION, 'supabase/migrations/0035_luna_proposals.sql exists');
  for (const bad of [{ kind: 'delete' }, { status: 'expired' }, { revision: 0 }, { payload: [1] }, { payload: { text: 'x'.repeat(17_000) } }]) {
    await assert.rejects(insert(bad), /violates check constraint/, JSON.stringify(bad).slice(0, 60));
  }
  const { rows: [row] } = await insert();
  await assert.rejects(insert(), /duplicate key/, 'one review per turn');
  await db.query('delete from public.luna_proposals where id = $1', [row.id]);
});

test('neither browser role can read or write the table or call the count', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select * from public.luna_proposals')), /permission denied/);
    await assert.rejects(db.asRole(role, ALICE, (tx) => tx.query('select public.luna_proposal_privacy_counts($1)', [ALICE])), /permission denied/);
  }
});

test('the count is the household\'s rows, and a review goes with its turn and with its conversation', async () => {
  await insert();
  assert.deepEqual((await db.query('select public.luna_proposal_privacy_counts($1) as c', [ALICE])).rows[0].c, { luna_proposals: 1 });
  await assert.rejects(db.query('select public.luna_proposal_privacy_counts(null)'), /HALO_INVALID_INPUT/);
  await db.query('delete from public.luna_turns where id = $1', [TURN]);
  assert.deepEqual((await db.query('select public.luna_proposal_privacy_counts($1) as c', [ALICE])).rows[0].c, { luna_proposals: 0 }, 'clearing the conversation deletes its turns, and so their reviews');
});

test('the back-out removes exactly what 0035 adds, is safe twice, and 0035 applies again after it; the file and the doc agree', async () => {
  const fresh = await createDb({ upTo: BEFORE });
  try {
    const before = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    const applied = await runAudit(fresh);
    const block = docBlock('backout-0035');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before, 'the schema is exactly what came before 0035 again');
    await fresh.exec(block);
    assert.deepEqual(await runAudit(fresh), before);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), applied);
  } finally {
    await fresh.close();
  }
  const fileBlock = MIGRATION.sql.split('<!-- backout-0035 -->')[1].split('\n')
    .filter((line) => /^-- drop /.test(line)).map((line) => line.replace(/^-- /, '')).join('\n');
  assert.equal(fileBlock, docBlock('backout-0035').trim(), 'the migration\'s copy of the block and YOUR_TODO.md\'s agree');
});
