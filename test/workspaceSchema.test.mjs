/**
 * Migration 0026 on PGlite (B11 plan): the workspace table, its read and
 * commit functions, the settled-workspace guard, the clear-all trigger and the
 * privacy count, on the reconstructed baseline plus every migration
 * (test/db/pgliteHarness.mjs). Each scenario runs as the service role inside a
 * transaction that is rolled back; a call expected to refuse runs inside a
 * savepoint, the statement-level atomicity a PostgREST RPC has.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';

const MIGRATION = listMigrations().find((migration) => migration.number === 26);
const ALICE = 'a11ce000-0000-4000-8000-0000000000a1';
const BOB = 'b0b00000-0000-4000-8000-0000000000b2';
const HOME_A = 'a11ce000-0000-4000-8000-00000000c0a1';
const HOME_B = 'b0b00000-0000-4000-8000-00000000c0b2';
const MARKER = 'PRIVATE-WORKSPACE-MARKER';

let db;
before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`);
  for (const [id, owner] of [[HOME_A, ALICE], [HOME_B, BOB]]) {
    await db.query(`insert into public.home_contexts (id, profile_id, sequence, origin, effective_from) values ($1, $2, 1, 'onboard', now())`, [id, owner]);
  }
});
after(async () => { await db?.close(); });

function scenario(fn) {
  return db.pg.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    const result = await fn(tx);
    await tx.rollback();
    return result;
  });
}
async function attempt(tx, sql, params = []) {
  await tx.exec('savepoint attempt');
  try {
    const { rows } = await tx.query(sql, params);
    await tx.exec('release savepoint attempt');
    return { ok: true, rows };
  } catch (error) {
    await tx.exec('rollback to savepoint attempt');
    return { ok: false, error };
  }
}
async function claim(tx, { owner = ALICE, domain = 'workspace', kind = 'workspace.write', status = 'pending' } = {}) {
  const id = crypto.randomUUID();
  await tx.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, result) values ($1, $2, $3, $4, $5, $6)`, [id, owner, domain, kind, status, status === 'pending' ? null : JSON.stringify({ status })]);
  return id;
}
const COMMIT = 'select public.commit_household_workspace($1, $2, $3::jsonb) as out';
const commit = (tx, op, writes, owner = ALICE) => attempt(tx, COMMIT, [owner, op, JSON.stringify(writes)]);
const record = (id, extra = {}) => ({ id, title: MARKER, revision: 0, ...extra });
const upsert = (collection, id, expectedRevision = null, extra = {}) => ({ collection, id, expectedRevision, record: record(id, extra) });
const rows = async (tx, owner = ALICE) => (await tx.query(`select collection, record_id, revision, record from public.household_workspace_records where profile_id = $1 order by collection, record_id`, [owner])).rows;
const refusal = (outcome) => (outcome.ok ? null : outcome.error.message);

test('0026 applies over 0001 to 0025, re-applies, and leaves the schema as one pass did; its verification query is all true', async () => {
  const fresh = await createDb({ upTo: 25 });
  try {
    await fresh.applyMigration(MIGRATION);
    const once = await runAudit(fresh);
    await fresh.applyMigration(MIGRATION);
    assert.deepEqual(await runAudit(fresh), once);
    const lines = MIGRATION.sql.split('\n');
    const start = lines.findIndex((line) => /^--\s*Verification \(read only\)/.test(line));
    const body = [];
    for (let i = start + 2; i < lines.length && lines[i].startsWith('--') && !/^-- -{10,}/.test(lines[i]); i += 1) body.push(lines[i].replace(/^--\s?/, ''));
    const { rows: [row] } = await fresh.query(body.join('\n'));
    assert.deepEqual(Object.keys(row), ['rls_on', 'no_policies', 'no_client_access', 'functions_service_role_only', 'functions_invoker_pinned', 'triggers_on', 'five_checks']);
    for (const [column, value] of Object.entries(row)) assert.equal(value, true, column);
  } finally {
    await fresh.close();
  }
});

test('0026 applies over 0023 alone (0024 and 0025 pending, as on production)', async () => {
  const lagging = await createDb({ upTo: 23 });
  try {
    await lagging.applyMigration(MIGRATION);
    const { rows: [row] } = await lagging.query(`select to_regprocedure('public.commit_household_workspace(uuid, uuid, jsonb)') is not null as ok`);
    assert.equal(row.ok, true);
  } finally {
    await lagging.close();
  }
});

test('anon and authenticated can neither read the table nor call a function', async () => {
  const calls = [
    `select * from public.household_workspace_records`,
    `select public.read_household_workspace('${ALICE}', array['tests'])`,
    `select public.commit_household_workspace('${ALICE}', '${crypto.randomUUID()}', '{"collections":["tests"]}')`,
    `select public.workspace_privacy_counts('${ALICE}')`,
  ];
  for (const [role, user] of [['anon', null], ['authenticated', ALICE]]) {
    for (const call of calls) await assert.rejects(db.asRole(role, user, (tx) => tx.query(call)), /permission denied/, `${role}: ${call}`);
  }
});

test('a commit creates, updates and deletes at exact revisions, settles its own row with ids only, and returns the touched collections', async () => {
  await scenario(async (tx) => {
    const op1 = await claim(tx);
    const created = await commit(tx, op1, { upserts: [upsert('tests', 't1'), upsert('tests', 't2')], collections: ['tests'] });
    assert.ok(created.ok, created.error?.message);
    const out = created.rows[0].out;
    assert.deepEqual(out.changes.tests.map((row) => [row.id, row.revision]), [['t1', 1], ['t2', 1]], 'oldest first, server revisions');
    const { rows: [ledger] } = await tx.query(`select status, result from public.operations where operation_id = $1`, [op1]);
    assert.equal(ledger.status, 'succeeded');
    assert.ok(!JSON.stringify(ledger.result).includes(MARKER), 'no record content in the receipt');
    assert.deepEqual(ledger.result.collections, ['tests']);

    const op2 = await claim(tx);
    const updated = await commit(tx, op2, { upserts: [upsert('tests', 't1', 1, { status: 'x' })], deletes: [{ collection: 'tests', id: 't2', expectedRevision: 1 }], collections: ['tests'] });
    assert.ok(updated.ok);
    assert.deepEqual(updated.rows[0].out.changes.tests.map((row) => [row.id, row.revision, row.status]), [['t1', 2, 'x']]);
  });
});

test('refusals write nothing and leave the ledger row pending: stale revision, existing id, missing reference, other household, limits, wrong domain', async () => {
  await scenario(async (tx) => {
    const seed = await claim(tx);
    assert.ok((await commit(tx, seed, { upserts: [upsert('tests', 't1'), upsert('gardens', 'g1', null, { homeContextId: HOME_A })], collections: ['tests', 'gardens'] })).ok);
    const before = await rows(tx);
    const cases = [
      [{ upserts: [upsert('tests', 't1', 5)], collections: ['tests'] }, 'HALO_STALE_REVISION'],
      [{ upserts: [upsert('tests', 't1')], collections: ['tests'] }, 'HALO_STALE_REVISION'],
      [{ deletes: [{ collection: 'tests', id: 't1', expectedRevision: 2 }], collections: ['tests'] }, 'HALO_STALE_REVISION'],
      [{ deletes: [{ collection: 'tests', id: 'nowhere', expectedRevision: 1 }], collections: ['tests'] }, 'HALO_STALE_REVISION'],
      [{ upserts: [upsert('observations', 'o1')], references: [{ collection: 'tests', id: 'nowhere' }], collections: ['observations'] }, 'HALO_INVALID_REFERENCE'],
      [{ upserts: [upsert('observations', 'o1')], homeContexts: [HOME_B], collections: ['observations'] }, 'HALO_INVALID_REFERENCE'],
      [{ upserts: [upsert('observations', 'o1')], homeContexts: ['not-a-uuid'], collections: ['observations'] }, 'HALO_INVALID_REFERENCE'],
      [{ upserts: [upsert('tests', 't9')], contexts: ['g-nowhere'], collections: ['tests'] }, 'HALO_INVALID_REFERENCE'],
      [{ upserts: [upsert('tests', 't9', null, { pad: 'x'.repeat(290000) })], collections: ['tests'] }, null],
      [{ upserts: [upsert('weekJournal', 'j1')], collections: ['weekJournal'] }, 'HALO_INVALID_INPUT'],
      [{ upserts: [upsert('tests', 't9')], collections: ['gardens'] }, 'HALO_INVALID_INPUT'],
      [{ upserts: [upsert('tests', 't9'), upsert('tests', 't9')], collections: ['tests'] }, 'HALO_INVALID_INPUT'],
      [{ upserts: [{ ...upsert('tests', 't9'), extra: 1 }], collections: ['tests'] }, 'HALO_INVALID_INPUT'],
      [{ upserts: [upsert('tests', 't9', 0)], collections: ['tests'] }, 'HALO_INVALID_INPUT'],
      [{ upserts: [] }, 'HALO_INVALID_INPUT'],
    ];
    for (const [writes, code] of cases) {
      const op = await claim(tx);
      const outcome = await commit(tx, op, writes);
      if (code === null) {
        // 290,000 bytes passes the record backstop but not the 1.5 MB collection? It is under it: a success.
        assert.ok(outcome.ok, outcome.error?.message);
        await tx.query(`delete from public.household_workspace_records where profile_id = $1 and record_id = 't9'`, [ALICE]);
        continue;
      }
      assert.equal(refusal(outcome), code, JSON.stringify(writes).slice(0, 160));
      const { rows: [ledger] } = await tx.query(`select status from public.operations where operation_id = $1`, [op]);
      assert.equal(ledger.status, 'pending', 'a refused commit settles nothing');
    }
    assert.deepEqual(await rows(tx), before, 'nothing was written by any refusal');
    // The ledger row must be this household's, in this domain, and pending.
    for (const [owner, domain, status] of [[BOB, 'workspace', 'pending'], [ALICE, 'actions', 'pending'], [ALICE, 'workspace', 'succeeded']]) {
      const op = await claim(tx, { owner, domain, status });
      assert.equal(refusal(await commit(tx, op, { upserts: [upsert('tests', 't8')], collections: ['tests'] })), 'HALO_OPERATION_NOT_PENDING');
    }
    // A record over the 300,000-byte backstop is a CHECK violation.
    const big = await commit(tx, await claim(tx), { upserts: [upsert('tests', 't7', null, { pad: 'x'.repeat(300001) })], collections: ['tests'] });
    assert.equal(big.ok, false);
    assert.equal(big.error.code, '23514');
  });
});

test('limits: a collection past 1,000 records or 1,500,000 bytes is HALO_LIMIT', async () => {
  await scenario(async (tx) => {
    const many = Array.from({ length: 1001 }, (_, i) => upsert('foodFollows', `f${i}`));
    assert.equal(refusal(await commit(tx, await claim(tx), { upserts: many, collections: ['foodFollows'] })), 'HALO_LIMIT');
    const heavy = Array.from({ length: 6 }, (_, i) => upsert('foodQuestions', `q${i}`, null, { note: 'x'.repeat(260000) }));
    assert.equal(refusal(await commit(tx, await claim(tx), { upserts: heavy, collections: ['foodQuestions'] })), 'HALO_LIMIT');
    assert.deepEqual(await rows(tx), []);
  });
});

test('references and linked deletes: an owned test and home pass; a linked delete of a missing row is fine', async () => {
  await scenario(async (tx) => {
    assert.ok((await commit(tx, await claim(tx), { upserts: [upsert('tests', 't1'), upsert('gardens', 'g1')], collections: ['tests', 'gardens'] })).ok);
    const linked = await commit(tx, await claim(tx), {
      upserts: [upsert('observations', 'o1', null, { homeContextId: HOME_A })],
      references: [{ collection: 'tests', id: 't1' }], homeContexts: [HOME_A], contexts: [HOME_A, 'g1'], collections: ['observations'],
    });
    assert.ok(linked.ok, linked.error?.message);
    assert.ok((await commit(tx, await claim(tx), { upserts: [upsert('exploreNotes', 'n1')], collections: ['exploreNotes'] })).ok);
    const removed = await commit(tx, await claim(tx), {
      deletes: [{ collection: 'exploreNotes', id: 'n1', expectedRevision: 1 }, { collection: 'exploreOutcomes', id: 'note-case:n1', expectedRevision: null }],
      collections: ['exploreNotes', 'exploreOutcomes'],
    });
    assert.ok(removed.ok);
    assert.deepEqual(removed.rows[0].out.changes, { exploreNotes: [], exploreOutcomes: [] });
  });
});

test('the settled guard: a succeeded workspace row cannot be turned failed, a receipt rewrite is allowed, other domains are unchanged', async () => {
  await scenario(async (tx) => {
    const op = await claim(tx);
    assert.ok((await commit(tx, op, { upserts: [upsert('tests', 't1')], collections: ['tests'] })).ok);
    const flip = await attempt(tx, `update public.operations set status = 'failed' where operation_id = $1`, [op]);
    assert.equal(refusal(flip), 'HALO_OPERATION_SETTLED');
    assert.ok((await attempt(tx, `update public.operations set result = result || '{"operationId":"x"}' where operation_id = $1`, [op])).ok);
    // A domain with no guard of its own (settings, actions and privacy have theirs).
    const other = await claim(tx, { domain: 'explore', kind: 'explore.update', status: 'succeeded' });
    assert.ok((await attempt(tx, `update public.operations set status = 'failed' where operation_id = $1`, [other])).ok);
  });
});

test('clear all removes the household\'s workspace inside the clear, counted beforehand; clear journal, a refused clear and bob keep theirs', async () => {
  await scenario(async (tx) => {
    for (const owner of [ALICE, BOB]) {
      assert.ok((await commit(tx, await claim(tx, { owner }), { upserts: [upsert('tests', 't1'), upsert('exploreNotes', 'n1')], collections: ['tests', 'exploreNotes'] }, owner)).ok);
    }
    const counts = async (owner) => (await tx.query(`select public.workspace_privacy_counts($1) as c`, [owner])).rows[0].c;
    assert.deepEqual(await counts(ALICE), { household_workspace_records: 2 });

    const print = async (scope) => (await tx.query(`select public.privacy_fingerprint($1, $2::text[]) as f`, [ALICE, scope === 'journal' ? ['symptom_logs'] : ['profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs', 'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions', 'household_action_preferences', 'luna_conversations', 'luna_turns']])).rows[0].f;
    const clear = async (scope, fingerprint) => {
      const op = await claim(tx, { domain: 'privacy', kind: `privacy.clear.${scope}` });
      return attempt(tx, `select public.clear_household_records($1, $2, $3, $4) as out`, [ALICE, op, scope, fingerprint ?? await print(scope)]);
    };
    assert.ok((await clear('journal')).ok);
    assert.equal((await rows(tx)).length, 2, 'Clear Journal keeps the workspace');
    assert.equal(refusal(await clear('all', '0'.repeat(64))), 'HALO_REVIEW_CHANGED');
    assert.equal((await rows(tx)).length, 2, 'a refused clear deletes nothing');
    // The refused clear's own claim is still pending, which would make clear all refuse as busy.
    await tx.query(`delete from public.operations where profile_id = $1 and status = 'pending'`, [ALICE]);
    const done = await clear('all');
    assert.ok(done.ok, done.error?.message);
    assert.deepEqual(await rows(tx), []);
    assert.deepEqual(await counts(ALICE), { household_workspace_records: 0 });
    assert.equal((await rows(tx, BOB)).length, 2, 'bob\'s records are untouched');
  });
});
