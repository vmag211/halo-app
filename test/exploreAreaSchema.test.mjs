/**
 * Migration 0022's database rules: a household's saved discovery area (B05
 * plan, Task 3, Rulings D5 and D6), on a local in-memory PGlite database
 * (test/db/pgliteHarness.mjs) with the reconstructed baseline and every
 * migration.
 *
 *  1. One row per household, keyed by the profile alone (Ruling D5), holding
 *     the five `DiscoveryPlace` fields, a revision and when it last changed.
 *  2. The revision is at least 2 and has no default (Ruling D6): 1 is the
 *     never-saved state, which has no row, so a stored 1 would be
 *     indistinguishable from it.
 *  3. The five place fields are null together (a cleared area) or set
 *     together, because the client discards a partial place, and a set field
 *     is never blank (space, tab, LF and CR only), Ruling D6a.
 *  4. Each field is at most 300 UTF-8 bytes (never more than the client's 300
 *     UTF-16 units) with no control character other than tab, line feed and
 *     carriage return: the client's `validPlaces`, or stricter.
 *  5. The compare and set the library relies on holds in the database: two
 *     first inserts leave one row and the loser gets a unique violation, and
 *     an update at a stale revision touches no row.
 *  6. Service role only: row level security on, no policy, no privilege for
 *     anon or authenticated, and the owner cannot read their own row either.
 *  7. Deleting the account deletes the area.
 *  8. Re-running 0022 changes nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { createDb, listMigrations, MIGRATION_FILE } from './db/pgliteHarness.mjs';

const TABLE = 'explore_areas';
const API_ROLES = ['anon', 'authenticated'];

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const CAROL = 'ca201000-0000-4000-8000-000000000003';
const DAVE = 'da7e0000-0000-4000-8000-000000000004';

const MIGRATION = listMigrations().find((migration) => migration.number === 22);

const ROWAN = { place_id: 'us-county:37159', place: 'Rowan County', state: 'NC', label: 'Rowan County, NC', timezone: 'America/New_York' };
const PLACE_COLUMNS = Object.keys(ROWAN);

let db;

/** Runs one statement as the service role, returning { error, result } rather than throwing. */
async function run(sql, values = [], { commit = false } = {}) {
  try {
    const result = await db.asService((tx) => tx.query(sql, values), { commit });
    return { error: null, result };
  } catch (error) {
    return { error, result: null };
  }
}

/** Inserts an area row as the service role (rolled back unless `commit`), returning the error or null. */
async function insertArea(row, options = {}) {
  const columns = Object.keys(row);
  const { error } = await run(
    `insert into public.${TABLE} (${columns.join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`,
    columns.map((column) => row[column]),
    options,
  );
  return error;
}

const count = async (owner) =>
  (await db.query(`select count(*)::int as n from public.${TABLE} where profile_id = $1`, [owner])).rows[0].n;

before(async () => {
  db = await createDb({ upTo: 21 });
  await db.exec(
    `insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true), ('${CAROL}', true), ('${DAVE}', true)`,
  ); // the 0001 trigger adds their profiles
});

after(async () => {
  await db?.close();
});

test('0022 exists, is named for what it does and applies on top of 0001 to 0021', async () => {
  assert.ok(MIGRATION, 'supabase/migrations has a 0022 migration');
  assert.match(basename(MIGRATION.file), MIGRATION_FILE, 'the file name is four digits and a snake_case name');
  assert.match(MIGRATION.name, /explore_area/, 'the name says what it adds');
  assert.equal((await db.query(`select to_regclass('public.${TABLE}') is null as absent`)).rows[0].absent, true, 'not there at 0021');
  await db.applyMigration(MIGRATION);
  assert.equal((await db.query(`select to_regclass('public.${TABLE}') is not null as present`)).rows[0].present, true);
});

// ---------------------------------------------------------------------------
// What it holds
// ---------------------------------------------------------------------------

test('one row per household, keyed by the profile alone, with the five place fields, a revision and a time', async () => {
  const { rows } = await db.query(
    `select column_name as name, is_nullable as nullable, data_type as type, column_default as "default"
       from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name`,
    [TABLE],
  );
  const columns = Object.fromEntries(rows.map((row) => [row.name, row]));
  assert.deepEqual(Object.keys(columns).sort(), ['label', 'place', 'place_id', 'profile_id', 'revision', 'state', 'timezone', 'updated_at']);
  assert.equal('home_context_id' in columns, false, 'the area belongs to the household, not to a home (Ruling D5)');
  for (const column of PLACE_COLUMNS) {
    assert.deepEqual([columns[column].type, columns[column].nullable, columns[column].default], ['text', 'YES', null], column);
  }
  assert.deepEqual([columns.revision.type, columns.revision.nullable, columns.revision.default], ['integer', 'NO', null], 'revision has no default');
  assert.equal(columns.updated_at.nullable, 'NO');

  const { rows: keys } = await db.query(
    `select a.attname as column from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = ('public.' || $1)::regclass and c.contype = 'p'`,
    [TABLE],
  );
  assert.deepEqual(keys, [{ column: 'profile_id' }], 'the primary key is the profile');
  assert.equal(await insertArea({ profile_id: ALICE, ...ROWAN, revision: 2 }, { commit: true }), null);
  const second = await insertArea({ profile_id: ALICE, ...ROWAN, revision: 3 });
  assert.equal(second?.code, '23505', 'a second row for the same household is a unique violation');
});

test('the revision is at least 2, because 1 is the never-saved state with no row', async () => {
  for (const revision of [1, 0, -1]) {
    const error = await insertArea({ profile_id: BOB, ...ROWAN, revision });
    assert.equal(error?.code, '23514', `revision ${revision} is refused`);
    assert.match(error.message, /explore_areas_revision_check/);
  }
  const missing = await insertArea({ profile_id: BOB, ...ROWAN });
  assert.equal(missing?.code, '23502', 'and there is no default to fall back on');
  assert.equal(await insertArea({ profile_id: BOB, ...ROWAN, revision: 2 }), null, '2 is the first storable revision');
  assert.equal(await insertArea({ profile_id: BOB, ...ROWAN, revision: 2147483647 }), null);
  const { error } = await run(`update public.${TABLE} set revision = 1 where profile_id = $1`, [ALICE]);
  assert.equal(error?.code, '23514', 'an update cannot set it back to 1 either');
});

test('a place is all five fields or none of them', async () => {
  assert.equal(
    await insertArea({ profile_id: BOB, revision: 2 }),
    null,
    'none: a household that cleared its area',
  );
  for (const column of PLACE_COLUMNS) {
    const partial = { profile_id: BOB, ...ROWAN, revision: 2, [column]: null };
    const error = await insertArea(partial);
    assert.equal(error?.code, '23514', `${column} missing from an otherwise complete place is refused`);
    assert.match(error.message, /explore_areas_place_complete_check/);
    const lone = await insertArea({ profile_id: BOB, revision: 2, [column]: ROWAN[column] });
    assert.equal(lone?.code, '23514', `${column} on its own is refused`);
  }
  const { error } = await run(`update public.${TABLE} set label = null where profile_id = $1`, [ALICE]);
  assert.equal(error?.code, '23514', 'an update cannot leave a partial place behind');
});

test('a set place has no blank field, so the database refuses what validDiscoveryArea refuses (Ruling D6a)', async () => {
  const blankId = await insertArea({ profile_id: BOB, ...ROWAN, place_id: '', revision: 2 });
  assert.equal(blankId?.code, '23514', 'a blank place_id is refused');
  assert.match(blankId.message, /explore_areas_place_complete_check/);
  const spacedLabel = await insertArea({ profile_id: BOB, ...ROWAN, label: '   ', revision: 2 });
  assert.equal(spacedLabel?.code, '23514', 'a whitespace-only label is refused');
  assert.match(spacedLabel.message, /explore_areas_place_complete_check/);
  for (const column of PLACE_COLUMNS) {
    // Space, tab, line feed and carriage return are the whitespace the
    // control check admits, so each, alone or mixed, still counts as blank.
    for (const blank of ['', ' ', '    ', '\t', '\n', '\r', ' \t\n\r ']) {
      const error = await insertArea({ profile_id: BOB, ...ROWAN, revision: 2, [column]: blank });
      assert.equal(error?.code, '23514', `${column} = ${JSON.stringify(blank)} is refused`);
      assert.match(error.message, /explore_areas_place_complete_check/);
    }
    // Whitespace inside or around a real value is not blank.
    for (const value of ['Rowan\tCounty', ' Rowan ', '\tx\n']) {
      assert.equal(
        await insertArea({ profile_id: BOB, ...ROWAN, revision: 2, [column]: value }),
        null,
        `${column} = ${JSON.stringify(value)} is not blank`,
      );
    }
  }
  const { error } = await run(`update public.${TABLE} set place_id = ' ' where profile_id = $1`, [ALICE]);
  assert.equal(error?.code, '23514', 'an update cannot blank a field of a stored place');
  // Not tied to the county form: city and ZIP ids may follow (Open question 2).
  for (const id of ['us-place:3712000', 'us-zcta:28208', 'x']) {
    assert.equal(await insertArea({ profile_id: BOB, ...ROWAN, place_id: id, revision: 2 }), null, `${id} is storable`);
  }
  assert.equal(await insertArea({ profile_id: BOB, revision: 2 }), null, 'a cleared area (all null) is still storable');
});

test('each place field is at most 300 bytes, so it is never over the client\'s 300 UTF-16 units', async () => {
  // The client's text(v, 300) is JavaScript .length (UTF-16 units). A UTF-8
  // byte count is never smaller, so a 300-byte bound is always within it.
  const accepted = ['x'.repeat(300), 'é'.repeat(150), '\u{1F600}'.repeat(75)];
  const refused = ['x'.repeat(301), 'é'.repeat(151), '\u{1F600}'.repeat(76), '\u{1F600}'.repeat(300)];
  for (const value of accepted) assert.ok(value.length <= 300, 'every accepted value is within the client\'s UTF-16 bound');
  assert.ok('\u{1F600}'.repeat(300).length > 300, 'the case char_length() would wrongly accept: 300 code points, 600 units');
  for (const column of PLACE_COLUMNS) {
    for (const value of accepted) {
      assert.equal(await insertArea({ profile_id: BOB, ...ROWAN, revision: 2, [column]: value }), null, `${column}: ${Buffer.byteLength(value)} bytes`);
    }
    for (const value of refused) {
      const error = await insertArea({ profile_id: BOB, ...ROWAN, revision: 2, [column]: value });
      assert.equal(error?.code, '23514', `${column}: ${Buffer.byteLength(value)} bytes is refused`);
      assert.match(error.message, /explore_areas_place_length_check/);
    }
  }
});

test('no control character other than tab, line feed and carriage return, as the client\'s text() rule', async () => {
  const refused = ['\u0001', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f'];
  for (const column of PLACE_COLUMNS) {
    for (const char of refused) {
      const error = await insertArea({ profile_id: BOB, ...ROWAN, revision: 2, [column]: `Rowan${char}County` });
      assert.equal(error?.code, '23514', `${column} with U+${char.charCodeAt(0).toString(16).padStart(4, '0')} is refused`);
      assert.match(error.message, /explore_areas_place_control_check/);
    }
    for (const char of ['\t', '\n', '\r']) {
      assert.equal(
        await insertArea({ profile_id: BOB, ...ROWAN, revision: 2, [column]: `Rowan${char}County` }),
        null,
        `${column} may hold ${JSON.stringify(char)}, which the client accepts`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The compare and set the library relies on (lib/exploreArea.js)
// ---------------------------------------------------------------------------

test('two first saves for one household leave exactly one row, and the loser sees a unique violation', async () => {
  // PGlite is one connection: its transactions queue rather than interleave, so
  // this cannot show two sessions racing inside Postgres. What it does show is
  // the path that race ends in: whichever insert comes second, whenever it
  // comes, hits the primary key and gets 23505, the code the library maps to a
  // conflict, and the table keeps one row. On Postgres a concurrent second
  // insert of the same key waits for the first transaction and then raises
  // the same 23505 once it commits, so the outcome is the same.
  const first = (place) => insertArea({ profile_id: CAROL, ...ROWAN, place, label: `${place}, NC`, revision: 2 }, { commit: true });
  const outcomes = await Promise.all([first('Rowan County'), first('Gaston County')]);
  const errors = outcomes.filter(Boolean);
  assert.equal(outcomes.filter((outcome) => outcome === null).length, 1, 'exactly one insert succeeds');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, '23505', 'the other is a unique violation, which is the conflict');
  assert.equal(await count(CAROL), 1, 'and there is one row');
  const { rows: [row] } = await db.query(`select revision from public.${TABLE} where profile_id = $1`, [CAROL]);
  assert.equal(row.revision, 2);
});

test('an update at the current revision advances it by one; at a stale revision it touches no row', async () => {
  const save = (expected, label) =>
    run(
      `update public.${TABLE} set label = $3, revision = $2 + 1, updated_at = now()
        where profile_id = $1 and revision = $2 returning revision`,
      [CAROL, expected, label],
      { commit: true },
    );
  const ok = await save(2, 'Rowan County, North Carolina');
  assert.equal(ok.error, null);
  assert.deepEqual([ok.result.affectedRows, ok.result.rows], [1, [{ revision: 3 }]]);
  for (const stale of [2, 1, 4]) {
    const refused = await save(stale, 'stale');
    assert.equal(refused.error, null, 'a stale save is not an error');
    assert.equal(refused.result.affectedRows, 0, `revision ${stale} matches no row, so nothing is written`);
  }
  const { rows: [row] } = await db.query(`select label, revision from public.${TABLE} where profile_id = $1`, [CAROL]);
  assert.deepEqual(row, { label: 'Rowan County, North Carolina', revision: 3 }, 'the row is as the one good save left it');
});

// ---------------------------------------------------------------------------
// Service role only, ownership, idempotence
// ---------------------------------------------------------------------------

test('row level security is on and the table carries no policy', async () => {
  const { rows: [state] } = await db.query(`select relrowsecurity as rls from pg_class where oid = ('public.' || $1)::regclass`, [TABLE]);
  assert.equal(state.rls, true);
  const { rows: policies } = await db.query(`select policyname from pg_policies where schemaname = 'public' and tablename = $1`, [TABLE]);
  assert.deepEqual(policies, [], 'no policy, the service role is the only reader');
});

test('neither anon nor authenticated holds any privilege on the table', async () => {
  for (const role of API_ROLES) {
    const { rows: [privileges] } = await db.query(
      `select has_any_column_privilege($1, ($2::text)::regclass, 'SELECT') as select,
              has_any_column_privilege($1, ($2::text)::regclass, 'INSERT') as insert,
              has_any_column_privilege($1, ($2::text)::regclass, 'UPDATE') as update,
              has_table_privilege($1, ($2::text)::regclass, 'DELETE') as delete`,
      [role, `public.${TABLE}`],
    );
    assert.deepEqual(privileges, { select: false, insert: false, update: false, delete: false }, role);
  }
});

test('the owner reading or writing their own area with their own session is denied', async () => {
  await assert.rejects(
    () => db.asRole('authenticated', ALICE, (tx) => tx.query(`select 1 from public.${TABLE}`)),
    /permission denied/i,
  );
  await assert.rejects(
    () => db.asRole('authenticated', DAVE, (tx) =>
      tx.query(`insert into public.${TABLE} (profile_id, revision) values ($1, 2)`, [DAVE])),
    /permission denied/i,
  );
});

test('the service role can read and write it, which is how the routes will', async () => {
  const { rows: [privileges] } = await db.query(
    `select has_table_privilege('service_role', $1, 'INSERT') as insert,
            has_table_privilege('service_role', $1, 'UPDATE') as update,
            has_table_privilege('service_role', $1, 'SELECT') as select`,
    [`public.${TABLE}`],
  );
  assert.deepEqual(privileges, { insert: true, update: true, select: true });
});

test('deleting the account deletes its area, and nobody else\'s', async () => {
  assert.equal(await insertArea({ profile_id: DAVE, ...ROWAN, revision: 5 }, { commit: true }), null);
  assert.equal(await count(DAVE), 1);
  await db.exec(`delete from auth.users where id = '${DAVE}'`);
  assert.equal(await count(DAVE), 0, 'the area went with the account');
  assert.equal(await count(ALICE), 1, 'alice keeps hers');
});

test('the verification query in the migration\'s trailing comment really answers true in every column', async () => {
  const lines = MIGRATION.sql.split('\n');
  const at = lines.findIndex((line) => line.startsWith('-- Verification (read only)'));
  assert.ok(at > 0, 'the migration carries a verification comment');
  assert.match(lines[at], /all five columns true/, 'the comment says how many columns to expect');
  const rule = /^--\s*-{10,}\s*$/;
  const body = [];
  for (let index = at + 2; index < lines.length && !rule.test(lines[index]); index += 1) {
    body.push(lines[index].replace(/^--/, ''));
  }
  const query = body.join('\n').trim();
  assert.match(query, /^select\b/i, 'the comment holds one read-only select');
  const code = query.replace(/'[^']*'/g, "''");
  assert.equal(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/i.test(code), false, 'and it changes nothing');
  assert.equal(code.split(';').filter((part) => part.trim()).length, 1, 'one statement, because the SQL editor shows only the last result');
  const { rows } = await db.query(query);
  assert.equal(rows.length, 1);
  assert.equal(Object.keys(rows[0]).length, 5, 'five columns, as the comment says');
  assert.deepEqual(Object.entries(rows[0]).filter(([, value]) => value !== true), [], 'every column is true once 0022 is applied');
});

test('running 0022 again changes nothing and keeps the rows', async () => {
  const shape = async () => {
    const { rows: columns } = await db.query(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by column_name`,
      [TABLE],
    );
    const { rows: constraints } = await db.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = ('public.' || $1)::regclass order by conname`,
      [TABLE],
    );
    const { rows: indexes } = await db.query(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = $1 order by indexname`,
      [TABLE],
    );
    const { rows: data } = await db.query(`select profile_id, revision from public.${TABLE} order by profile_id`);
    return { columns, constraints, indexes, data };
  };
  const first = await shape();
  assert.equal(first.constraints.filter((constraint) => /^CHECK/.test(constraint.def)).length, 4, 'four checks');
  await db.exec(MIGRATION.sql);
  assert.deepEqual(await shape(), first, 're-running the migration is a no-op');
});
