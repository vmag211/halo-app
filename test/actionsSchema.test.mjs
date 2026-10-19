/**
 * Migration 0023's database rules: a household's tasks, their planning details
 * and task preferences, the one read function and the one atomic commit
 * function (B06 plan, Task 1, Rulings H2, H3, H6, H8, H9 and H10), on a local
 * in-memory PGlite database (test/db/pgliteHarness.mjs) with the reconstructed
 * baseline and every migration.
 *
 *  1. 0023 applies over 0001 to 0022 and re-applies to exactly the same schema.
 *  2. The checks refuse what the client would discard (a fourth state such as
 *     `cancelled`, trap T15; revision 0; an empty or 161 code point title; an
 *     empty key; an array meta; an unknown preference key; a JSON null
 *     preference; version 0) and a task key is unique per household only.
 *  3. Deleting the account deletes all three tables' rows.
 *  4. read_household_actions is one snapshot: the empty shape exactly, '' for
 *     no date, year 1 as '0001-01-01', exactly eight keys per action, and every
 *     one of 1,500 rows (PostgREST's max_rows would cut a plain select at
 *     1,000, finding F1).
 *  5. commit_household_actions applies everything together, advances only the
 *     changed tasks' revisions, refuses a stale base version, applies nothing
 *     when any write fails (trap T14), settles its own ledger row in the same
 *     transaction or refuses (Ruling H8), keeps record content out of the
 *     ledger (Ruling H3) and never touches another household's rows.
 *  6. A settled 'actions' ledger row keeps its status, so a settle-as-failed
 *     after a committed write cannot make the client say nothing was saved;
 *     the reaper and runOperation's own settle still work.
 *  7. Service role only, for the tables and both functions.
 *
 * The writes below are in exactly the shape lib/actionRules.js's
 * planActionCommand returns (B06 Task 2): inserts carry a JavaScript-generated
 * uuid and revision 1, updates carry baseRevision and revision baseRevision + 1,
 * metas never move a revision.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import './helpers/routeLoader.mjs';
import { createDb, listMigrations, MIGRATION_FILE, runAudit } from './db/pgliteHarness.mjs';

const { runOperation, readOperation } = await import('../lib/operations.js');

const MIGRATION = listMigrations().find((migration) => migration.number === 23);
const TABLES = ['household_actions', 'household_action_preferences', 'household_action_state'];
const READ = 'public.read_household_actions(uuid)';
const COMMIT = 'public.commit_household_actions(uuid, uuid, bigint, jsonb)';
const EMPTY = { version: 0, actions: [], metas: {}, preferences: {} };
const ACTION_KEYS = ['date', 'id', 'key', 'origin', 'reason', 'revision', 'state', 'title'];

const NOTE = 'PRIVATE-NOTE-MARKER the inhaler is in the blue bag';
const TITLE = 'PRIVATE-TITLE-MARKER Test the well water';
const PLACE = 'PRIVATE-PLACE-MARKER Hidden Creek trail';
const META = {
  time: '', completedOn: '', zone: 'America/New_York', paused: false, archived: false, reminder: false,
  note: NOTE, history: ['Added from the week plan'], duration: 30, recurrence: 'none', estimateSet: true,
};

let db;

before(async () => {
  db = await createDb({ upTo: 22 });
});

after(async () => {
  await db?.close();
});

const uuid = () => crypto.randomUUID();
const json = (value) => (value === undefined ? null : JSON.stringify(value));
const omit = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));

/** A new household: the 0001 trigger adds its profile. */
async function household() {
  const id = uuid();
  await db.query(`insert into auth.users (id, is_anonymous) values ($1, true)`, [id]);
  return id;
}

/** A ledger row as runOperation's claim writes it (or any other shape a test needs). */
async function ledgerRow(owner, { domain = 'actions', kind = 'actions.commit', status = 'pending', result = null, createdAt = null } = {}) {
  const id = uuid();
  await db.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, result, created_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, coalesce($7::timestamptz, now()))`,
    [id, owner, domain, kind, status, json(result), createdAt],
  );
  return id;
}

/** A new task in the planner's insert shape. */
const insert = (key, over = {}) => ({
  id: uuid(), key, title: `Task ${key}`, reason: 'Because the week plan asked', origin: 'week', date: '', state: 'saved', revision: 1, meta: null, ...over,
});

/** The planner's update shape for a stored action. */
const update = (action, patch = {}) => ({
  id: action.id, baseRevision: action.revision, revision: action.revision + 1,
  title: action.title, date: action.date, state: action.state, ...patch,
});

async function read(owner) {
  return (await db.query(`select public.read_household_actions($1) as snapshot`, [owner])).rows[0].snapshot;
}

/** Calls the commit function as the service role and keeps what it did. */
async function commit(owner, operationId, baseVersion, writes) {
  return db.asService(
    async (tx) => (await tx.query(`select public.commit_household_actions($1, $2, $3, $4::jsonb) as out`, [owner, operationId, baseVersion, json(writes)])).rows[0].out,
    { commit: true },
  );
}

/** The commit function's refusal: the Postgres error, or null when it did not refuse. */
async function refusal(owner, operationId, baseVersion, writes) {
  try {
    await commit(owner, operationId, baseVersion, writes);
    return null;
  } catch (error) {
    return error;
  }
}

/** Everything 0023 holds for this household, plus its ledger rows: what "nothing changed" compares. */
async function everything(owner) {
  const rows = async (sql) => (await db.query(sql, [owner])).rows;
  return {
    actions: await rows(`select * from public.household_actions where profile_id = $1 order by id`),
    preferences: await rows(`select * from public.household_action_preferences where profile_id = $1 order by pref_key`),
    state: await rows(`select * from public.household_action_state where profile_id = $1`),
    operations: await rows(`select operation_id, status, result, updated_at from public.operations where profile_id = $1 order by operation_id`),
  };
}

async function operation(id) {
  return (await db.query(`select * from public.operations where operation_id = $1`, [id])).rows[0];
}

/** Inserts a row as the service role (rolled back unless `commit`), returning the error or null. */
async function insertRow(table, row, { commit: keep = false } = {}) {
  const columns = Object.keys(row);
  try {
    await db.asService(
      (tx) => tx.query(
        `insert into public.${table} (${columns.join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`,
        columns.map((column) => row[column]),
      ),
      { commit: keep },
    );
    return null;
  } catch (error) {
    return error;
  }
}

const taskRow = (owner, over = {}) => ({ profile_id: owner, action_key: `key-${uuid()}`, title: 'A task', reason: '', origin: '', state: 'saved', ...over });

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

test('0023 exists, is named for what it does, applies on top of 0001 to 0022 and re-applies to the same schema', async () => {
  assert.ok(MIGRATION, 'supabase/migrations has a 0023 migration');
  assert.match(basename(MIGRATION.file), MIGRATION_FILE);
  assert.match(MIGRATION.name, /household_actions/);
  for (const table of TABLES) {
    assert.equal((await db.query(`select to_regclass($1) is null as absent`, [`public.${table}`])).rows[0].absent, true, `${table} is not there at 0022`);
  }
  await db.applyMigration(MIGRATION);
  const once = await runAudit(db);
  await db.applyMigration(MIGRATION);
  assert.deepEqual(await runAudit(db), once, 're-running 0023 changes nothing');
  for (const table of TABLES) {
    assert.equal((await db.query(`select to_regclass($1) is not null as present`, [`public.${table}`])).rows[0].present, true, table);
  }
});

test('the columns are the contract\'s, keyed by the household, with no home context column (Ruling H2)', async () => {
  const columns = async (table) => Object.fromEntries((await db.query(
    `select column_name as name, data_type as type, is_nullable as nullable, column_default as "default"
       from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table],
  )).rows.map((row) => [row.name, [row.type, row.nullable, row.default]]));

  const actions = await columns('household_actions');
  assert.deepEqual(Object.keys(actions).sort(), [
    'action_key', 'created_at', 'due_date', 'id', 'meta', 'origin', 'profile_id', 'reason', 'revision', 'state', 'title', 'updated_at',
  ]);
  assert.deepEqual(actions.due_date, ['date', 'YES', null], 'no date is null, read back as \'\'');
  assert.deepEqual(actions.meta, ['jsonb', 'YES', null], 'no meta is null');
  assert.deepEqual(actions.revision, ['integer', 'NO', '1']);
  for (const column of ['action_key', 'title', 'reason', 'origin', 'state']) assert.deepEqual(actions[column], ['text', 'NO', null], column);

  const preferences = await columns('household_action_preferences');
  assert.deepEqual(Object.keys(preferences).sort(), ['pref_key', 'profile_id', 'updated_at', 'value']);
  assert.deepEqual(preferences.value, ['jsonb', 'NO', null]);

  const state = await columns('household_action_state');
  assert.deepEqual(Object.keys(state).sort(), ['profile_id', 'updated_at', 'version']);
  assert.deepEqual(state.version, ['bigint', 'NO', null], 'the version has no default: no row reads as 0 and the first commit writes 1');
});

// ---------------------------------------------------------------------------
// Checks and keys
// ---------------------------------------------------------------------------

test('the checks refuse what the client would discard, and accept the edges it allows', async () => {
  const owner = await household();
  const refused = async (table, row, constraint) => {
    const error = await insertRow(table, row);
    assert.equal(error?.code, '23514', `${table} ${JSON.stringify(row)} is refused`);
    assert.match(error.message, new RegExp(constraint));
  };
  await refused('household_actions', taskRow(owner, { state: 'cancelled' }), 'household_actions_state_check'); // T15
  await refused('household_actions', taskRow(owner, { revision: 0 }), 'household_actions_revision_check');
  await refused('household_actions', taskRow(owner, { title: '' }), 'household_actions_title_check');
  await refused('household_actions', taskRow(owner, { title: 'x'.repeat(161) }), 'household_actions_title_check');
  await refused('household_actions', taskRow(owner, { title: '\u{1F33F}'.repeat(161) }), 'household_actions_title_check');
  await refused('household_actions', taskRow(owner, { action_key: '' }), 'household_actions_key_check');
  await refused('household_actions', taskRow(owner, { meta: '[]' }), 'household_actions_meta_check');
  await refused('household_actions', taskRow(owner, { meta: '"note"' }), 'household_actions_meta_check');
  await refused('household_actions', taskRow(owner, { due_date: '10000-01-01' }), 'household_actions_due_date_check');
  await refused('household_actions', taskRow(owner, { due_date: '0001-12-31 BC' }), 'household_actions_due_date_check');
  await refused('household_action_preferences', { profile_id: owner, pref_key: 'week:mood', value: '"calm"' }, 'household_action_preferences_key_check');
  await refused('household_action_preferences', { profile_id: owner, pref_key: 'week:focus', value: 'null' }, 'household_action_preferences_value_check');
  await refused('household_action_state', { profile_id: owner, version: 0 }, 'household_action_state_version_check');

  // The edges the client allows: 160 code points (an emoji is one here and two
  // UTF-16 units there, so this is never tighter, finding F3), years 1 and 9999,
  // an object meta, each of the three states and each of the six keys.
  for (const title of ['x'.repeat(160), '\u{1F33F}'.repeat(80), 'x']) assert.equal(await insertRow('household_actions', taskRow(owner, { title })), null, `title of ${title.length} units`);
  for (const due_date of ['0001-01-01', '9999-12-31', null]) assert.equal(await insertRow('household_actions', taskRow(owner, { due_date })), null, `due_date ${due_date}`);
  for (const state of ['saved', 'waiting', 'completed']) assert.equal(await insertRow('household_actions', taskRow(owner, { state })), null, state);
  assert.equal(await insertRow('household_actions', taskRow(owner, { meta: json(META) })), null);
  for (const pref_key of ['week:focus', 'food-interests', 'week:availability', 'week:season-dismissals', 'week:review-preferences', 'outdoorPlan']) {
    assert.equal(await insertRow('household_action_preferences', { profile_id: owner, pref_key, value: '{}' }), null, pref_key);
  }
  assert.equal(await insertRow('household_action_state', { profile_id: owner, version: 1 }), null);

  const { rows } = await db.query(
    `select count(*)::int as n from pg_constraint where contype = 'c' and conrelid = any($1::regclass[])`,
    [TABLES.map((table) => `public.${table}`)],
  );
  assert.equal(rows[0].n, 9, 'nine checks, as the verification query in the migration expects');
});

test('a task key is unique per household, not across households (Ruling H2)', async () => {
  const alice = await household();
  const bob = await household();
  assert.equal(await insertRow('household_actions', taskRow(alice, { action_key: 'radon-test' }), { commit: true }), null);
  const twice = await insertRow('household_actions', taskRow(alice, { action_key: 'radon-test' }));
  assert.equal(twice?.code, '23505', 'the same key twice for one household is refused');
  assert.equal(await insertRow('household_actions', taskRow(bob, { action_key: 'radon-test' })), null, 'another household may use the same key');
  const prefTwice = async () => {
    await insertRow('household_action_preferences', { profile_id: alice, pref_key: 'week:focus', value: '"rest"' }, { commit: true });
    return insertRow('household_action_preferences', { profile_id: alice, pref_key: 'week:focus', value: '"walk"' });
  };
  assert.equal((await prefTwice())?.code, '23505', 'one value per preference key');
});

test('deleting the account deletes its tasks, preferences and version, and nobody else\'s', async () => {
  const alice = await household();
  const bob = await household();
  for (const owner of [alice, bob]) {
    const op = await ledgerRow(owner);
    await commit(owner, op, 0, { inserts: [insert('k1', { meta: META })], preferences: { 'week:focus': 'Rest more' } });
  }
  await db.query(`delete from public.profiles where id = $1`, [alice]);
  const after = await everything(alice);
  assert.deepEqual([after.actions, after.preferences, after.state, after.operations], [[], [], [], []]);
  const kept = await everything(bob);
  assert.deepEqual([kept.actions.length, kept.preferences.length, kept.state.length], [1, 1, 1]);
});

// ---------------------------------------------------------------------------
// read_household_actions (Ruling H9)
// ---------------------------------------------------------------------------

test('a household with nothing reads as exactly the empty snapshot at version 0', async () => {
  assert.deepEqual(await read(await household()), EMPTY);
  assert.deepEqual(await read(uuid()), EMPTY, 'an id with no profile reads the same, so it is no existence oracle');
});

test('an action is exactly eight keys; no date is \'\' and year 1 is 0001-01-01; metas only where there is one', async () => {
  const owner = await household();
  const plain = insert('plain');
  const dated = insert('dated', { date: '0001-01-01', state: 'waiting', meta: META });
  const late = insert('late', { date: '9999-12-31', state: 'completed' });
  await commit(owner, await ledgerRow(owner), 0, { inserts: [plain, dated, late], preferences: { 'food-interests': ['fish', 'water'] } });

  const snapshot = await read(owner);
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.actions, [plain, dated, late].map((action) => omit(action, 'meta')), 'echoed exactly, in batch order');
  for (const action of snapshot.actions) assert.deepEqual(Object.keys(action).sort(), ACTION_KEYS);
  assert.deepEqual(snapshot.actions.map((action) => action.date), ['', '0001-01-01', '9999-12-31']);
  assert.deepEqual(snapshot.metas, { dated: META }, 'only the task that has a meta, keyed by its key');
  assert.deepEqual(snapshot.preferences, { 'food-interests': ['fish', 'water'] });
});

test('the date is formatted by the function, not by the session DateStyle', async () => {
  const owner = await household();
  await commit(owner, await ledgerRow(owner), 0, { inserts: [insert('k', { date: '2026-03-08' })] });
  const snapshot = await db.pg.transaction(async (tx) => {
    await tx.exec(`set local datestyle = 'SQL, DMY'`);
    const { rows } = await tx.query(`select public.read_household_actions($1) as snapshot`, [owner]);
    await tx.rollback();
    return rows[0].snapshot;
  });
  assert.equal(snapshot.actions[0].date, '2026-03-08');
});

test('every one of 1,500 rows comes back, oldest first, and none of another household\'s (finding F1)', async () => {
  const owner = await household();
  const other = await household();
  await db.query(
    `insert into public.household_actions (profile_id, action_key, title, reason, origin, state, created_at)
     select $1, 'bulk-' || n, 'Bulk ' || n, '', '', 'saved', timestamptz '2026-01-01' + n * interval '1 second'
       from generate_series(1, 1500) n`,
    [owner],
  );
  await db.query(`insert into public.household_actions (profile_id, action_key, title, reason, origin, state) values ($1, 'theirs', 'Not yours', '', '', 'saved')`, [other]);
  const snapshot = await read(owner);
  assert.equal(snapshot.actions.length, 1500);
  assert.deepEqual(snapshot.actions.slice(0, 3).map((action) => action.key), ['bulk-1', 'bulk-2', 'bulk-3']);
  assert.equal(snapshot.actions.at(-1).key, 'bulk-1500');
  assert.equal(snapshot.actions.some((action) => action.key === 'theirs'), false);
});

// ---------------------------------------------------------------------------
// commit_household_actions (Rulings H6, H8, H10)
// ---------------------------------------------------------------------------

test('inserts, updates, metas, deletes and preferences land together, and the result is the stored snapshot', async () => {
  const owner = await household();
  const keep = insert('keep');
  const move = insert('move', { meta: META });
  const gone = insert('gone');
  const noteOnly = insert('note-only');
  const first = await commit(owner, await ledgerRow(owner), 0, { inserts: [keep, move, gone, noteOnly], preferences: { 'week:focus': 'Fewer errands' } });
  assert.equal(first.snapshot.version, 1);

  const added = insert('added', { date: '2026-11-02' });
  const op = await ledgerRow(owner);
  const out = await commit(owner, op, 1, {
    inserts: [added],
    updates: [update(move, { date: '2026-11-05', state: 'waiting', title: 'Moved' })],
    metas: [{ id: move.id, key: 'move', meta: { ...META, note: 'changed' } }, { id: noteOnly.id, key: 'note-only', meta: { ...META, duration: 45 } }],
    deletes: [gone.id],
    preferences: { 'week:focus': 'More rest', 'week:availability': { '2026-11-02': 120 } },
  });

  const stored = await read(owner);
  assert.deepEqual(out.snapshot, stored, 'the function returns the snapshot as committed, read in its own transaction');
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.actions.map((action) => [action.key, action.revision]), [['keep', 1], ['move', 2], ['note-only', 1], ['added', 1]],
    'only the updated task advanced; a meta-only change leaves the revision; the deleted one is gone');
  assert.deepEqual(stored.actions[1], { id: move.id, key: 'move', title: 'Moved', reason: move.reason, origin: move.origin, date: '2026-11-05', state: 'waiting', revision: 2 });
  assert.deepEqual(stored.metas, { move: { ...META, note: 'changed' }, 'note-only': { ...META, duration: 45 } });
  assert.deepEqual(stored.preferences, { 'week:focus': 'More rest', 'week:availability': { '2026-11-02': 120 } });

  assert.deepEqual(out.receipt, {
    status: 'succeeded',
    affected: [{ id: move.id, revision: 2 }, { id: noteOnly.id, revision: 1 }, { id: added.id, revision: 1 }],
    removed: [gone.id],
  });
  const row = await operation(op);
  assert.equal(row.status, 'succeeded');
  assert.deepEqual(row.result, out.receipt, 'the ledger row was settled in the same transaction with the same receipt (H8)');
});

test('a meta set to null clears it, and a meta sent with extra and reordered keys is stored as sent', async () => {
  const owner = await household();
  const action = insert('k', { meta: META });
  await commit(owner, await ledgerRow(owner), 0, { inserts: [action] });
  await commit(owner, await ledgerRow(owner), 1, { metas: [{ id: action.id, key: 'k', meta: null }] });
  assert.deepEqual((await read(owner)).metas, {}, 'cleared');
  const extra = { zone: 'America/Chicago', ...META, futureField: { nested: [1, 'two'] } };
  await commit(owner, await ledgerRow(owner), 2, { metas: [{ id: action.id, key: 'k', meta: extra }] });
  assert.deepEqual((await read(owner)).metas.k, extra, 'deep-equal to what was sent, unknown keys included (H13)');
  assert.equal((await read(owner)).actions[0].revision, 1, 'no meta change moved the revision');
});

test('preferences upsert, last write wins, and the version counts every commit', async () => {
  const owner = await household();
  await commit(owner, await ledgerRow(owner), 0, { preferences: { 'week:focus': 'one' } });
  await commit(owner, await ledgerRow(owner), 1, { preferences: { 'week:focus': 'two', 'week:season-dismissals': ['spring'] } });
  await commit(owner, await ledgerRow(owner), 2, {});
  const snapshot = await read(owner);
  assert.deepEqual(snapshot.preferences, { 'week:focus': 'two', 'week:season-dismissals': ['spring'] });
  assert.equal(snapshot.version, 3, 'even an empty commit advances it');
});

test('a stale base version is HALO_STALE_BASE and changes nothing, from a first commit and from a later one (H10)', async () => {
  const owner = await household();
  const action = insert('k');
  await commit(owner, await ledgerRow(owner), 0, { inserts: [action] });
  const before = await everything(owner);

  for (const base of [0, 2, 7]) {
    const op = await ledgerRow(owner);
    const snapshot = await everything(owner);
    const error = await refusal(owner, op, base, { inserts: [insert('new')], updates: [update(action, { title: 'Changed' })], preferences: { 'week:focus': 'x' } });
    assert.equal(error?.code, 'P0001', `base ${base}`);
    assert.equal(error.message, 'HALO_STALE_BASE', `base ${base}`);
    assert.deepEqual(await everything(owner), snapshot, `base ${base}: nothing changed, the ledger row still pending`);
    assert.equal((await operation(op)).status, 'pending');
  }
  assert.deepEqual((await everything(owner)).actions, before.actions);
});

test('a write that names a row not there as planned is HALO_STALE_BASE, and another household\'s rows are never touched', async () => {
  const alice = await household();
  const bob = await household();
  const mine = insert('mine');
  const theirs = insert('theirs', { meta: META });
  await commit(alice, await ledgerRow(alice), 0, { inserts: [mine] });
  await commit(bob, await ledgerRow(bob), 0, { inserts: [theirs] });
  const bobBefore = await everything(bob);
  const aliceBefore = await everything(alice);

  const attempts = {
    'an update of another household\'s task': { updates: [update(theirs, { title: 'Taken over' })] },
    'a meta write on another household\'s task': { metas: [{ id: theirs.id, key: 'theirs', meta: null }] },
    'a delete of another household\'s task': { deletes: [theirs.id] },
    'an update at a revision the task is not at': { updates: [{ ...update(mine), baseRevision: 2, revision: 3 }] },
    'a meta write whose key does not match the id': { metas: [{ id: mine.id, key: 'other', meta: META }] },
    'a delete of a task that does not exist': { deletes: [uuid()] },
  };
  for (const [label, writes] of Object.entries(attempts)) {
    const op = await ledgerRow(alice);
    const error = await refusal(alice, op, 1, { inserts: [insert('extra')], ...writes });
    assert.equal(error?.message, 'HALO_STALE_BASE', label);
    assert.equal((await operation(op)).status, 'pending', `${label}: the ledger row is still pending`);
    await db.query(`delete from public.operations where operation_id = $1`, [op]);
    assert.deepEqual(await everything(bob), bobBefore, `${label}: bob is untouched`);
    assert.deepEqual(await everything(alice), aliceBefore, `${label}: alice is untouched`);
  }
});

test('atomicity: a check violation in the third insert leaves nothing of the first two, and the ledger row pending (T14)', async () => {
  const owner = await household();
  const seeded = insert('seeded');
  await commit(owner, await ledgerRow(owner), 0, { inserts: [seeded], preferences: { 'week:focus': 'before' } });
  const before = await everything(owner);

  const failing = {
    'a fourth state in the third insert': { inserts: [insert('a'), insert('b'), insert('c', { state: 'cancelled' })] },
    'a 161 character title in the third insert': { inserts: [insert('a'), insert('b'), insert('c', { title: 'x'.repeat(161) })] },
    'a JSON null preference after the task writes': { inserts: [insert('a')], updates: [update(seeded, { title: 'changed' })], preferences: { 'week:focus': 'after', 'outdoorPlan': null } },
    'an unknown preference key': { inserts: [insert('a')], preferences: { 'week:mood': 'calm' } },
    'an insert of a key the household already has': { inserts: [insert('a'), insert('seeded')] },
  };
  for (const [label, writes] of Object.entries(failing)) {
    const op = await ledgerRow(owner);
    const error = await refusal(owner, op, 1, writes);
    assert.ok(['23514', '23505'].includes(error?.code), `${label}: refused by the database (${error?.code} ${error?.message})`);
    const now = await everything(owner);
    assert.deepEqual(now.actions, before.actions, `${label}: no task written`);
    assert.deepEqual(now.preferences, before.preferences, `${label}: no preference written`);
    assert.deepEqual(now.state, before.state, `${label}: the version did not move`);
    assert.equal((await operation(op)).status, 'pending', `${label}: the ledger row is not succeeded`);
    assert.equal((await operation(op)).result, null);
  }
});

test('H8: without its own pending actions row the commit is HALO_OPERATION_NOT_PENDING and writes nothing', async () => {
  const owner = await household();
  const other = await household();
  await commit(owner, await ledgerRow(owner), 0, { preferences: { 'week:focus': 'seed' } });
  const before = await everything(owner);

  const cases = {
    'no ledger row at all': uuid(),
    'a row settled failed by an in-process throw (result null)': await ledgerRow(owner, { status: 'failed' }),
    'a row the reaper settled': await ledgerRow(owner, { status: 'failed', result: { status: 'failed', reason: 'abandoned' } }),
    'a row already succeeded': await ledgerRow(owner, { status: 'succeeded', result: { status: 'succeeded', affected: [], removed: [] } }),
    'a row that is cancelled': await ledgerRow(owner, { status: 'cancelled' }),
    'another household\'s pending row': await ledgerRow(other),
    'a pending row in another domain': await ledgerRow(owner, { domain: 'week-updates', kind: 'week.acknowledge' }),
  };
  for (const [label, op] of Object.entries(cases)) {
    const rowBefore = await operation(op);
    const error = await refusal(owner, op, 1, { inserts: [insert('k', { title: TITLE, meta: META })], preferences: { 'week:focus': 'x' } });
    assert.equal(error?.code, 'P0001', label);
    assert.equal(error.message, 'HALO_OPERATION_NOT_PENDING', label);
    const now = await everything(owner);
    assert.deepEqual([now.actions, now.preferences, now.state], [before.actions, before.preferences, before.state], `${label}: nothing written`);
    assert.deepEqual(await operation(op), rowBefore, `${label}: the ledger row is unchanged`);
  }
});

test('H8 against the reaper: a row reaped first refuses the commit; a committed row is never reaped', async () => {
  const owner = await household();
  const stale = '2026-01-01T00:00:00Z';
  // The reaper's own statement (lib/operations.js, reapAbandonedOperations).
  const reap = () => db.query(
    `update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}'::jsonb, updated_at = now()
      where profile_id = $1 and domain = any($2) and status = 'pending' and created_at < $3`,
    [owner, ['actions'], new Date(Date.now() - 120_000).toISOString()],
  );

  const reaped = await ledgerRow(owner, { createdAt: stale });
  assert.equal((await reap()).affectedRows, 1);
  assert.equal((await refusal(owner, reaped, 0, { inserts: [insert('lost')] }))?.message, 'HALO_OPERATION_NOT_PENDING');
  assert.deepEqual(await read(owner), EMPTY, 'a reaped row never becomes succeeded and nothing was written, so "No save was applied" is true');
  assert.equal((await operation(reaped)).status, 'failed');

  const committed = await ledgerRow(owner, { createdAt: stale });
  const out = await commit(owner, committed, 0, { inserts: [insert('kept')] });
  assert.equal((await reap()).affectedRows, 0, 'the reaper finds nothing pending to settle');
  assert.deepEqual(await operation(committed).then((row) => [row.status, row.result]), ['succeeded', out.receipt]);
});

test('the receipt and every ledger column hold no record content (H3, T14)', async () => {
  const owner = await household();
  const op = await ledgerRow(owner);
  const action = insert('private-key-marker', { title: TITLE, reason: 'PRIVATE-REASON-MARKER', origin: 'PRIVATE-ORIGIN-MARKER', meta: META });
  const out = await commit(owner, op, 0, {
    inserts: [action],
    preferences: { 'week:focus': 'PRIVATE-FOCUS-MARKER', outdoorPlan: { key: 'walk', place: PLACE, period: 'morning', watchRequested: false, forecastVersion: null, forecastIssuedAt: null, forecastExpiresAt: null } },
  });
  const row = JSON.stringify(await operation(op));
  for (const marker of [TITLE, NOTE, PLACE, 'PRIVATE-REASON-MARKER', 'PRIVATE-ORIGIN-MARKER', 'PRIVATE-FOCUS-MARKER', 'private-key-marker', 'Added from the week plan']) {
    assert.equal(row.includes(marker), false, `the ledger row does not contain ${marker}`);
    assert.equal(JSON.stringify(out.receipt).includes(marker), false, `the receipt does not contain ${marker}`);
  }
  assert.deepEqual(Object.keys(out.receipt).sort(), ['affected', 'removed', 'status']);
});

test('a batch of inserts keeps its order whatever the ids, and 500 tasks with metas commit in one call', async () => {
  const owner = await household();
  const ids = ['ffffffff', 'cccccccc', 'eeeeeeee', '11111111', 'aaaaaaaa'].map((head) => `${head}-0000-4000-8000-000000000000`);
  await commit(owner, await ledgerRow(owner), 0, { inserts: ids.map((id, at) => insert(`ordered-${at}`, { id })) });
  assert.deepEqual((await read(owner)).actions.map((action) => action.id), ids);

  const big = await household();
  const many = Array.from({ length: 500 }, (_, at) => insert(`large-${at}`, { date: '2026-11-02', meta: { ...META, history: Array.from({ length: 20 }, (__, line) => `Line ${line}`) } }));
  await commit(big, await ledgerRow(big), 0, { inserts: many });
  const snapshot = await read(big);
  assert.equal(snapshot.actions.length, 500);
  assert.equal(Object.keys(snapshot.metas).length, 500);
  assert.deepEqual(snapshot.actions.map((action) => action.key), many.map((action) => action.key));
});

test('a malformed call is HALO_INVALID_INPUT, decided before anything is read, locked or written', async () => {
  const owner = await household();
  const action = insert('k');
  await commit(owner, await ledgerRow(owner), 0, { inserts: [action] });
  const stored = (await read(owner)).actions[0];
  const before = await everything(owner);
  const malformed = {
    'an unknown key in p_writes': { inserts: [], clear: true },
    'inserts that is not an array': { inserts: {} },
    'preferences that is not an object': { preferences: [] },
    'an insert missing its meta': { inserts: [omit(insert('x'), 'meta')] },
    'an insert with an extra key': { inserts: [{ ...insert('x'), seedDate: '2026-11-02' }] },
    'an insert whose id is not lowercase': { inserts: [insert('x', { id: uuid().toUpperCase() })] },
    'an insert whose id is not a uuid': { inserts: [insert('x', { id: 'task-1' })] },
    'an insert at revision 2': { inserts: [insert('x', { revision: 2 })] },
    'an insert whose meta is an array': { inserts: [insert('x', { meta: [] })] },
    'an insert whose title is a number': { inserts: [insert('x', { title: 5 })] },
    'an update whose revision is not baseRevision + 1': { updates: [{ ...update(stored), revision: 3 }] },
    'an update at revision 0': { updates: [{ ...update(stored), baseRevision: 0, revision: 1 }] },
    'an update at a fractional revision': { updates: [{ ...update(stored), baseRevision: 1.5, revision: 2.5 }] },
    'an update without its baseRevision': { updates: [omit(update(stored), 'baseRevision')] },
    'a meta write without a key': { metas: [{ id: stored.id, meta: null }] },
    'a delete that is not a string': { deletes: [7] },
    'an impossible date': { inserts: [insert('x', { date: '2026-02-30' })] },
    'year 0000': { inserts: [insert('x', { date: '0000-01-01' })] },
    'a month 13': { updates: [update(stored, { date: '2026-13-01' })] },
    'a date with a time': { inserts: [insert('x', { date: '2026-11-02T10:00' })] },
    'the same id inserted twice': (() => { const twice = insert('x'); return { inserts: [twice, { ...twice, key: 'y' }] }; })(),
    'the same key inserted twice': { inserts: [insert('x'), insert('x')] },
    'an id updated and deleted': { updates: [update(stored)], deletes: [stored.id] },
    'an id in metas twice': { metas: [{ id: stored.id, key: 'k', meta: null }, { id: stored.id, key: 'k', meta: META }] },
    'a meta write for a task inserted in the same commit': (() => { const fresh = insert('x'); return { inserts: [fresh], metas: [{ id: fresh.id, key: 'x', meta: META }] }; })(),
  };
  for (const [label, writes] of Object.entries(malformed)) {
    const op = await ledgerRow(owner);
    const error = await refusal(owner, op, 1, writes);
    assert.equal(error?.code, 'P0001', label);
    assert.equal(error.message, 'HALO_INVALID_INPUT', `${label}: ${error.message}`);
    assert.ok(error.detail, `${label}: the detail names what is wrong`);
    const now = await everything(owner);
    assert.deepEqual([now.actions, now.preferences, now.state], [before.actions, before.preferences, before.state], `${label}: nothing changed`);
    assert.deepEqual([(await operation(op)).status, (await operation(op)).result], ['pending', null], `${label}: the ledger row is untouched`);
    await db.query(`delete from public.operations where operation_id = $1`, [op]);
  }
  // The arguments themselves.
  const op = await ledgerRow(owner);
  for (const [label, args] of Object.entries({
    'no owner': [null, op, 1, '{}'],
    'no operation': [owner, null, 1, '{}'],
    'no base version': [owner, op, null, '{}'],
    'a negative base version': [owner, op, -1, '{}'],
    'no writes': [owner, op, 1, null],
    'writes that are an array': [owner, op, 1, '[]'],
  })) {
    const error = await db.asService((tx) => tx.query(`select public.commit_household_actions($1, $2, $3, $4::jsonb)`, args)).then(() => null, (e) => e);
    assert.equal(error?.message, 'HALO_INVALID_INPUT', label);
  }
  assert.equal((await db.query(`select public.read_household_actions(null) as r`).then(() => null, (e) => e))?.message, 'HALO_INVALID_INPUT');
});

// ---------------------------------------------------------------------------
// A settled 'actions' row keeps its status (section 4 of 0023)
// ---------------------------------------------------------------------------

test('a settled actions row cannot change status; its receipt can be rewritten as succeeded; other domains are unchanged', async () => {
  const owner = await household();
  const op = await ledgerRow(owner);
  const out = await commit(owner, op, 0, { inserts: [insert('k')] });
  const settle = (id, status, result) => db.query(`update public.operations set status = $2, result = $3::jsonb, updated_at = now() where operation_id = $1`, [id, status, json(result)]);

  const failed = await settle(op, 'failed', null).then(() => null, (error) => error);
  assert.equal(failed?.message, 'HALO_OPERATION_SETTLED', 'a committed write cannot be relabelled failed');
  assert.deepEqual([(await operation(op)).status, (await operation(op)).result], ['succeeded', out.receipt]);
  await settle(op, 'succeeded', { ...out.receipt, operationId: op });
  assert.deepEqual((await operation(op)).result, { ...out.receipt, operationId: op }, 'runOperation\'s own settle adds operationId');

  const reaped = await ledgerRow(owner, { status: 'failed', result: { status: 'failed', reason: 'abandoned' } });
  assert.equal((await settle(reaped, 'succeeded', { status: 'succeeded' }).then(() => null, (error) => error))?.message, 'HALO_OPERATION_SETTLED',
    'a failed row can never become succeeded');
  await settle(reaped, 'failed', null);
  assert.equal((await operation(reaped)).status, 'failed', 'failed to failed is allowed (an in-process throw after the reaper)');

  const pending = await ledgerRow(owner);
  await settle(pending, 'failed', { status: 'failed', reason: 'stale_revision' });
  assert.equal((await operation(pending)).status, 'failed', 'a pending row settles as before');

  const settings = await ledgerRow(owner, { domain: 'settings', kind: 'settings.save', status: 'succeeded', result: { status: 'succeeded' } });
  await settle(settings, 'failed', null);
  assert.equal((await operation(settings)).status, 'failed', 'every other domain is unchanged');
});

/**
 * Exactly the two supabase-js calls runOperation makes on the ledger (the
 * claim, an upsert that ignores duplicates, and the settle, an update by id),
 * run on PGlite, so the real lib/operations.js meets the real trigger.
 */
function ledgerClient() {
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

test('end to end with runOperation: a commit whose response is lost still reads as succeeded, with its receipt', async () => {
  const owner = await household();
  const operationId = uuid();
  const supabase = ledgerClient();
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  let committed;
  try {
    await assert.rejects(
      runOperation(supabase, { operationId, profileId: owner, domain: 'actions', kind: 'actions.commit', input: { kind: 'add' } }, async () => {
        committed = await commit(owner, operationId, 0, { inserts: [insert('k', { title: TITLE })] });
        throw new Error('fetch failed'); // the commit landed, its response did not
      }),
      /fetch failed/,
    );
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((line) => line.includes('HALO_OPERATION_SETTLED')), 'runOperation\'s settle-as-failed was refused and logged, not thrown');
  const row = await operation(operationId);
  assert.deepEqual([row.status, row.result], ['succeeded', committed.receipt], 'the row tells the truth: the task was saved');
  assert.equal((await read(owner)).actions.length, 1);

  // And the ordinary path: execute returns the function's receipt, and the
  // settle rewrites it with operationId added.
  const second = uuid();
  const outcome = await runOperation(supabase, { operationId: second, profileId: owner, domain: 'actions', kind: 'actions.commit', input: { kind: 'add', n: 2 } },
    async () => (await commit(owner, second, 1, { inserts: [insert('k2')] })).receipt);
  assert.equal(outcome.status, 'succeeded');
  const settled = await operation(second);
  assert.equal(settled.status, 'succeeded');
  assert.deepEqual(settled.result, { ...outcome.result }, 'the stored receipt is the function\'s, with operationId');
  assert.equal(settled.result.operationId, second);
  assert.deepEqual(Object.keys(settled.result).sort(), ['affected', 'operationId', 'removed', 'status']);
  assert.equal(typeof readOperation, 'function');
});

// ---------------------------------------------------------------------------
// Privileges
// ---------------------------------------------------------------------------

test('only the service role may execute either function, and the browser roles reach none of the three tables', async () => {
  const owner = await household();
  const op = await ledgerRow(owner);
  for (const [role, userId] of [['anon', null], ['authenticated', owner]]) {
    await assert.rejects(db.asRole(role, userId, (tx) => tx.query(`select public.read_household_actions($1)`, [owner])), /permission denied for function read_household_actions/, role);
    await assert.rejects(db.asRole(role, userId, (tx) => tx.query(`select public.commit_household_actions($1, $2, 0, '{}'::jsonb)`, [owner, op])), /permission denied for function commit_household_actions/, role);
    for (const table of TABLES) {
      await assert.rejects(db.asRole(role, userId, (tx) => tx.query(`select count(*) from public.${table}`)), /permission denied/, `${role} ${table}`);
    }
  }
  const { rows } = await db.query(
    `select has_function_privilege('service_role', $1, 'EXECUTE') and has_function_privilege('service_role', $2, 'EXECUTE') as service,
            has_function_privilege('anon', $1, 'EXECUTE') or has_function_privilege('authenticated', $1, 'EXECUTE')
              or has_function_privilege('anon', $2, 'EXECUTE') or has_function_privilege('authenticated', $2, 'EXECUTE') as browser`,
    [READ, COMMIT],
  );
  assert.deepEqual(rows[0], { service: true, browser: false });
  const snapshot = await db.asService((tx) => tx.query(`select public.read_household_actions($1) as s`, [owner]));
  assert.deepEqual(snapshot.rows[0].s, EMPTY);
  const committed = await db.asService((tx) => tx.query(`select public.commit_household_actions($1, $2, 0, '{}'::jsonb) as r`, [owner, op]));
  assert.equal(committed.rows[0].r.receipt.status, 'succeeded');
});
