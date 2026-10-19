/**
 * Migration 0021's database rules: the settings preferences table, the
 * three-state tenure column and the alerts presentation columns (B04 plan,
 * Task 1), on a local in-memory PGlite database (test/db/pgliteHarness.mjs)
 * with the reconstructed baseline and every migration.
 *
 * Why these exist. Neither surface in this package can be served from the
 * tables that already exist (B04 Ruling S2). The contract digest's section 8
 * is the derivation: `GET /api/settings` needs somewhere for the display,
 * quiet-hours, calendar and Luna-context values, an aggregate `revision` for
 * `If-Match`, and a tenure with three states that `profiles.renter_mode
 * boolean` cannot express; `GET /api/alerts` needs a per-alert `revision`, a
 * `category` and a navigation target.
 *
 *  1. Every value the settings snapshot has nowhere else to keep lives in one
 *     row per household, and nothing that already has a home is duplicated
 *     here: year, water source, language, the five notification booleans and
 *     the seven household bands stay where their existing readers look.
 *  2. The settings `revision` is a real column (Ruling S4), a positive
 *     integer, deliberately unlike the account revision which counts ledger
 *     rows and therefore advances even when a command fails.
 *  3. Only the exact strings the client's `validSettingsSnapshot` accepts are
 *     storable, including `scale` as text ('100', not 100) because a number
 *     fails the validator, and `palette` as the one field a server may omit:
 *     null here means "send no palette key", since the client rejects
 *     `palette: null` outright.
 *  4. Quiet hours are never null, because the validator requires a
 *     well-formed `HH:MM` for `from` and `to` even when `enabled` is false, so
 *     a null would make the whole snapshot unreadable.
 *  5. Luna's context switches default to off, so a row created before anybody
 *     answered does not hand Luna the household by accident, and both zones
 *     default to the client's America/New_York (Ruling S9).
 *  6. `profiles.tenure` has the three states the contract needs and is left
 *     null for a household that was never asked (Ruling S3). No check ties it
 *     to `renter_mode`, so a legacy household save that writes only
 *     `renter_mode` still succeeds once tenure is set (Ruling S7); a trigger
 *     reconciles the two in that same row write instead (Ruling S13, covered
 *     in full by test/settingsSaveDb.test.mjs).
 *  7. An alert's `revision` is not null, defaults to 1 and is at least 1,
 *     because the client rejects a snapshot containing any row whose revision
 *     is not a positive integer. That a row which existed before 0021 gets 1
 *     is proven by the reapply test in test/migrationBackout.test.mjs.
 *  8. An alert's category and navigation target can only hold the values the
 *     client's `validAlertSnapshot` accepts, and the `today` tab admits no
 *     destination at all.
 *  9. The preferences table is service-role only: row level security on, zero
 *     policies, no privilege for anon or authenticated, and the owner cannot
 *     read their own row directly either.
 * 10. Deleting the account deletes its preferences.
 * 11. Re-running 0021 changes nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { createDb, listMigrations, MIGRATION_FILE } from './db/pgliteHarness.mjs';

const PREFERENCES = 'profile_preferences';
const API_ROLES = ['anon', 'authenticated'];

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const CAROL = 'ca201000-0000-4000-8000-000000000003';
const DAVE = 'da7e0000-0000-4000-8000-000000000004';

const MIGRATION = listMigrations().find((migration) => migration.number === 21);

/** Every value the settings snapshot has nowhere else to keep, by its contract path. */
const PREFERENCE_COLUMNS = [
  'profile_id',
  'revision',
  'display_appearance',
  'display_palette',
  'display_ambient',
  'display_scale',
  'display_motion',
  'display_contrast',
  'quiet_enabled',
  'quiet_from',
  'quiet_to',
  'quiet_zone',
  'calendar_zone',
  'calendar_streak',
  'calendar_linked',
  'luna_tasks',
  'luna_home',
  'luna_projects',
  'created_at',
  'updated_at',
];

/** What the contract keeps in tables that already exist, so this one must not copy it. */
const ALREADY_HOUSED = [
  'home_year',
  'year',
  'water_source',
  'water',
  'locale',
  'language',
  'renter_mode',
  'tenure',
  'air_quality_change',
  'weather_advisory',
  'new_water_results',
  'radon_season',
  'season_summary',
  'has_toddler',
  'has_child',
  'has_teen',
  'has_adult',
  'has_senior',
  'has_pregnant',
  'has_respiratory',
];

let db;

/** Runs one statement as the service role, returning the error (or null) rather than throwing. */
async function write(sql, values = [], { commit = false } = {}) {
  try {
    await db.asService((tx) => tx.query(sql, values), { commit });
    return null;
  } catch (error) {
    return error;
  }
}

/** Inserts a row as the service role, returning the error (or null). */
async function insert(table, row, options = {}) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return write(
    `insert into public.${table} (${columns.join(', ')}) values (${placeholders.join(', ')})`,
    columns.map((column) => row[column]),
    options,
  );
}

/** The household's preferences row, created on first use, as a route's get-or-create would. */
async function preferencesFor(owner, overrides = {}) {
  const row = { profile_id: owner, ...overrides };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const assignments = columns.filter((column) => column !== 'profile_id');
  const { rows } = await db.asService(
    (tx) =>
      tx.query(
        `insert into public.${PREFERENCES} (${columns.join(', ')}) values (${placeholders.join(', ')})
           on conflict (profile_id) do update set ${
             assignments.length
               ? assignments.map((column) => `${column} = excluded.${column}`).join(', ')
               : 'profile_id = excluded.profile_id'
           }
         returning *`,
        columns.map((column) => row[column]),
      ),
    { commit: true },
  );
  return rows[0];
}

/** One column's catalog description, or undefined. */
async function columnsOf(table) {
  const { rows } = await db.query(
    `select column_name as name, is_nullable as nullable, data_type as type, column_default as "default"
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [table],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

const count = async (sql, values = []) => (await db.query(sql, values)).rows[0].n;

/** A fresh alert for `owner`, with only the columns 0006 and 0010 require. */
let alertSeq = 0;
const alertRow = (owner, overrides = {}) => ({
  profile_id: owner,
  type: 'air_quality_change',
  title: 'Air quality changed',
  message: 'The air quality index moved into a new band.',
  dedupe_key: `settings-alerts-schema-${(alertSeq += 1)}`,
  ...overrides,
});

before(async () => {
  db = await createDb();
  await db.exec(
    `insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true), ('${CAROL}', true)`,
  ); // the 0001 trigger adds their profiles
});

after(async () => {
  await db?.close();
});

test('0021 exists, is named for what it does and applies in order after 0020', () => {
  assert.ok(MIGRATION, 'supabase/migrations has a 0021 migration');
  assert.match(basename(MIGRATION.file), MIGRATION_FILE, 'the file name is four digits and a snake_case name');
  assert.match(MIGRATION.name, /settings|preferences/, 'the name says what it adds');
});

// ---------------------------------------------------------------------------
// The preferences table: what it holds, and what it deliberately does not
// ---------------------------------------------------------------------------

test('the preferences table holds every settings value that has nowhere else to live, and copies nothing that has', async () => {
  const columns = await columnsOf(PREFERENCES);
  assert.deepEqual(Object.keys(columns).sort(), [...PREFERENCE_COLUMNS].sort(), 'exactly the columns the contract needs');
  for (const copied of ALREADY_HOUSED) {
    assert.equal(copied in columns, false, `${PREFERENCES} does not copy ${copied}, which already has a home`);
  }
  // The validator needs a value for all of these on every read, so none may be null.
  for (const column of PREFERENCE_COLUMNS.filter((name) => name !== 'display_palette')) {
    assert.equal(columns[column].nullable, 'NO', `${column} is never null`);
  }
  // `display.palette` is the one field a server may omit: the client rejects
  // `palette: null` on the wire, so null here means "send no palette key".
  assert.equal(columns.display_palette.nullable, 'YES', 'palette is optional, and null means omit the key');
  // `display.scale` is '100' | '115' | '130' | '150' as STRINGS; a number fails the validator.
  assert.equal(columns.display_scale.type, 'text', 'scale is text, because the client rejects the number 100');
  assert.equal(columns.quiet_from.type, 'text', 'quiet hours are the HH:MM strings the client sends back');
  assert.equal(columns.quiet_to.type, 'text');
});

test('a household gets one preferences row, keyed by the profile, and a second cannot be opened behind its back', async () => {
  await preferencesFor(ALICE);
  assert.equal(await count(`select count(*)::int as n from public.${PREFERENCES} where profile_id = $1`, [ALICE]), 1);
  const second = await insert(PREFERENCES, { profile_id: ALICE });
  assert.ok(second, 'a second row for the same household is refused');
  assert.match(String(second.message), /profile_id|unique|duplicate key/i);
});

test('a fresh row is a valid snapshot on its own, with Luna\'s context switches off and the client\'s zone', async () => {
  const row = await preferencesFor(CAROL);
  assert.equal(row.revision, 1, 'the first revision the client accepts is 1');
  assert.deepEqual(
    {
      appearance: row.display_appearance,
      ambient: row.display_ambient,
      scale: row.display_scale,
      motion: row.display_motion,
      contrast: row.display_contrast,
      palette: row.display_palette,
    },
    { appearance: 'system', ambient: false, scale: '100', motion: 'system', contrast: false, palette: null },
    'the display defaults are the contract\'s neutral values, with no palette claimed',
  );
  // Required even when quiet hours are off, so the defaults have to be well formed.
  assert.equal(row.quiet_enabled, false);
  assert.match(row.quiet_from, /^([01]\d|2[0-3]):[0-5]\d$/);
  assert.match(row.quiet_to, /^([01]\d|2[0-3]):[0-5]\d$/);
  // The zone the client's own initialSettings and displayZones lead with (Ruling S9).
  assert.equal(row.quiet_zone, 'America/New_York');
  assert.equal(row.calendar_zone, 'America/New_York');
  // Nothing is linked, so claiming it is would be false (Ruling S9).
  assert.deepEqual([row.calendar_streak, row.calendar_linked], [false, false]);
  // Nothing is handed to Luna until somebody says so.
  assert.deepEqual(
    [row.luna_tasks, row.luna_home, row.luna_projects],
    [false, false, false],
    'Luna\'s context switches default to off',
  );
});

test('the settings revision is a positive integer, because the client rejects zero', async () => {
  await preferencesFor(ALICE);
  for (const revision of [0, -1]) {
    const error = await write(`update public.${PREFERENCES} set revision = $2 where profile_id = $1`, [ALICE, revision]);
    assert.ok(error, `revision ${revision} is refused`);
    assert.match(String(error.message), /revision/);
  }
  assert.equal(
    await write(`update public.${PREFERENCES} set revision = revision + 1 where profile_id = $1`, [ALICE], { commit: true }),
    null,
    'a successful save advances it by one',
  );
  assert.equal(
    await count(`select revision as n from public.${PREFERENCES} where profile_id = $1`, [ALICE]),
    2,
  );
});

test('only the display values the client accepts are storable', async () => {
  await preferencesFor(BOB);
  const set = (column, value) =>
    write(`update public.${PREFERENCES} set ${column} = $2 where profile_id = $1`, [BOB, value]);

  for (const value of ['system', 'light', 'dark']) assert.equal(await set('display_appearance', value), null, value);
  for (const value of ['neon', 'Dark', '', null]) {
    const error = await set('display_appearance', value);
    assert.ok(error, `appearance ${JSON.stringify(value)} is refused`);
    assert.match(String(error.message), /appearance/);
  }

  for (const value of ['ocean', 'forest', 'iris', null]) assert.equal(await set('display_palette', value), null, String(value));
  for (const value of ['neon', '', 'Ocean']) {
    const error = await set('display_palette', value);
    assert.ok(error, `palette ${JSON.stringify(value)} is refused`);
    assert.match(String(error.message), /palette/);
  }

  for (const value of ['100', '115', '130', '150']) assert.equal(await set('display_scale', value), null, value);
  for (const value of ['400', '100.0', '1', '', null]) {
    const error = await set('display_scale', value);
    assert.ok(error, `scale ${JSON.stringify(value)} is refused`);
    assert.match(String(error.message), /scale/);
  }

  // 'full' is never sent by the control, but the validator accepts it on the way back.
  for (const value of ['system', 'full', 'reduce']) assert.equal(await set('display_motion', value), null, value);
  for (const value of ['reduced', 'none', '', null]) {
    const error = await set('display_motion', value);
    assert.ok(error, `motion ${JSON.stringify(value)} is refused`);
    assert.match(String(error.message), /motion/);
  }
});

test('quiet hours are well-formed HH:MM even while they are switched off, and a zero-length window is refused', async () => {
  await preferencesFor(ALICE, { quiet_enabled: false, quiet_from: '21:00', quiet_to: '08:00' });
  const set = (values) =>
    write(
      `update public.${PREFERENCES} set quiet_enabled = $2, quiet_from = $3, quiet_to = $4 where profile_id = $1`,
      [ALICE, ...values],
    );

  assert.equal(await set([false, '00:00', '23:59']), null, 'the bounds of the day are valid');
  for (const bad of ['24:00', '9:00', '21:00:00', '2100', '', null]) {
    const error = await set([false, bad, '08:00']);
    assert.ok(error, `from ${JSON.stringify(bad)} is refused even with quiet hours off`);
    assert.match(String(error.message), /quiet/);
    const other = await set([false, '21:00', bad]);
    assert.ok(other, `to ${JSON.stringify(bad)} is refused even with quiet hours off`);
  }
  // The client refuses to send equal times while quiet hours are on, because a
  // window from a time to itself is not a window.
  assert.equal(await set([false, '21:00', '21:00']), null, 'equal times are harmless while it is off');
  const zero = await set([true, '21:00', '21:00']);
  assert.ok(zero, 'an enabled window whose ends are equal is refused');
  assert.match(String(zero.message), /quiet/);
  assert.equal(await set([true, '21:00', '08:00']), null, 'a real window is accepted');
});

test('a zone has to look like an IANA zone name, which is a floor and not the client\'s Intl check', async () => {
  await preferencesFor(BOB);
  const set = (column, value) =>
    write(`update public.${PREFERENCES} set ${column} = $2 where profile_id = $1`, [BOB, value]);

  for (const column of ['quiet_zone', 'calendar_zone']) {
    for (const value of ['UTC', 'America/New_York', 'Pacific/Honolulu', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5', 'America/Port-au-Prince']) {
      assert.equal(await set(column, value), null, `${column} accepts ${value}`);
    }
    for (const value of ['', null, 'america/new york', '../../etc/passwd', 'A/B/C/D', 'a'.repeat(200)]) {
      const error = await set(column, value);
      assert.ok(error, `${column} refuses ${JSON.stringify(value)}`);
      assert.match(String(error.message), /zone/);
    }
  }
});

// ---------------------------------------------------------------------------
// profiles.tenure (Ruling S3)
// ---------------------------------------------------------------------------

test('tenure has the three states the contract needs, beside the boolean every existing reader uses', async () => {
  const columns = await columnsOf('profiles');
  assert.ok(columns.tenure, 'profiles has a tenure column');
  assert.equal(columns.tenure.type, 'text');
  assert.equal(columns.tenure.nullable, 'YES', 'a household that was never asked has no answer to give');
  assert.equal(columns.tenure.default, null, 'nothing is assumed for a row that already exists');
  // renter_mode is untouched: every existing reader still uses it.
  assert.ok(columns.renter_mode, 'renter_mode stays');
  assert.equal(columns.renter_mode.nullable, 'NO');
});

test('tenure stores owner, renter and other, and nothing else', async () => {
  const set = (value) =>
    write(
      `update public.profiles set tenure = $2, renter_mode = ($2 = 'renter') where id = $1`,
      [ALICE, value],
      { commit: true },
    );
  for (const value of ['owner', 'renter', 'other']) assert.equal(await set(value), null, value);
  for (const value of ['Owner', 'landlord', '', 'owner ']) {
    const error = await write(`update public.profiles set tenure = $2 where id = $1`, [ALICE, value]);
    assert.ok(error, `${JSON.stringify(value)} is refused`);
    assert.match(String(error.message), /tenure/);
  }
  assert.equal(
    await write(`update public.profiles set tenure = null where id = $1`, [ALICE], { commit: true }),
    null,
    'and it can be cleared back to unanswered',
  );
});

test('every profile that existed before 0021 reads as unanswered rather than as an owner', async () => {
  assert.equal(
    await count(`select count(*)::int as n from public.profiles where tenure is not null`),
    0,
    'nothing was backfilled, because renter_mode cannot tell an owner from an other',
  );
});

test('a legacy household save that changes renter_mode still succeeds once tenure is set, bands included (Ruling S7)', async () => {
  // The scenario review finding 1 reproduced as a 23514 rollback. PUT
  // /api/household writes renter_mode through save_household (0015) without
  // touching tenure, and renter_mode is part of the published B01 contract. A
  // schema rule tying the two columns together would turn that valid request
  // into a 500 and lose the band change with it. 0021 therefore holds no such
  // rule (Ruling S7). Its BEFORE trigger reconciles the pair inside the same
  // row write instead (Ruling S13), so the save still succeeds and the two
  // never disagree.
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${DAVE}', true)`);
  assert.equal(
    await write(`update public.profiles set tenure = 'owner', renter_mode = false where id = $1`, [DAVE], { commit: true }),
    null,
  );

  const { rows } = await db.asService(
    (tx) =>
      tx.query('select public.save_household($1, $2::jsonb, $3, $4) as saved', [
        DAVE,
        JSON.stringify({ has_adult: true, has_child: true }),
        true,
        null,
      ]),
    { commit: true },
  );
  assert.equal(rows[0].saved.renter_mode, true, 'the save answers with the renter_mode it was given');
  assert.deepEqual(
    (await db.query(
      `select p.tenure, p.renter_mode, hb.has_adult, hb.has_child
         from public.profiles p join public.household_bands hb on hb.profile_id = p.id
        where p.id = $1`,
      [DAVE],
    )).rows,
    [{ tenure: 'renter', renter_mode: true, has_adult: true, has_child: true }],
    'the band change persists, and the owner who now rents reads as a renter (Ruling S13)',
  );

  // The pre-0015 two-step path writes the profile on its own; that is not refused either.
  assert.equal(
    await write(`update public.profiles set renter_mode = false where id = $1`, [DAVE]),
    null,
    'a direct renter_mode write is not refused either',
  );
  assert.equal(
    await write(`update public.profiles set tenure = 'renter', renter_mode = false where id = $1`, [DAVE]),
    null,
    'no combination of a valid tenure and either boolean is refused by the schema',
  );
});

// ---------------------------------------------------------------------------
// The alerts columns
// ---------------------------------------------------------------------------

test('every alert carries a positive revision, 1 until it is patched (pre-0021 rows: see the migrationBackout reapply test)', async () => {
  const columns = await columnsOf('alerts');
  for (const column of ['revision', 'category', 'target_tab', 'target_destination', 'target_learn']) {
    assert.ok(columns[column], `alerts has ${column}`);
  }
  assert.equal(columns.revision.nullable, 'NO', 'the client rejects a snapshot with a revisionless row');
  assert.match(String(columns.revision.default), /1/, 'a row that was never patched is at revision 1');

  assert.equal(await insert('alerts', alertRow(ALICE), { commit: true }), null);
  const { rows } = await db.query(`select revision from public.alerts where profile_id = $1 order by revision`, [ALICE]);
  assert.ok(rows.length > 0, 'there is an alert to read');
  for (const row of rows) assert.ok(Number.isSafeInteger(row.revision) && row.revision > 0, 'every revision is a positive integer');

  const zero = await write(`update public.alerts set revision = 0 where profile_id = $1`, [ALICE]);
  assert.ok(zero, 'revision 0 is refused, because the client rejects it');
  assert.match(String(zero.message), /revision/);
});

test('an alert category is one of the three the filter offers, or unanswered', async () => {
  await insert('alerts', alertRow(BOB, { id: 'b0b00000-9999-4000-8000-00000000c001' }), { commit: true });
  const set = (value) =>
    write(`update public.alerts set category = $2 where id = $1`, ['b0b00000-9999-4000-8000-00000000c001', value]);
  for (const value of ['Home', 'Your week', 'Conditions', null]) assert.equal(await set(value), null, String(value));
  for (const value of ['home', 'Conditions ', 'Everything', '']) {
    const error = await set(value);
    assert.ok(error, `${JSON.stringify(value)} is refused`);
    assert.match(String(error.message), /category/);
  }
});

test('a navigation target can only name a tab the client routes to, and a destination that tab has', async () => {
  const id = 'b0b00000-9999-4000-8000-00000000c002';
  await insert('alerts', alertRow(BOB, { id }), { commit: true });
  const target = (tab, destination = null, learn = null) =>
    write(
      `update public.alerts set target_tab = $2, target_destination = $3, target_learn = $4 where id = $1`,
      [id, tab, destination, learn],
    );

  for (const tab of ['home', 'plan', 'today', null]) assert.equal(await target(tab), null, `tab ${String(tab)}`);
  for (const tab of ['other', 'act', 'settings', 'Home', '']) {
    const error = await target(tab);
    assert.ok(error, `tab ${JSON.stringify(tab)} is refused`);
    assert.match(String(error.message), /target/);
  }

  for (const destination of ['tests', 'maintenance', 'food', 'summary']) {
    assert.equal(await target('home', destination), null, `home/${destination}`);
  }
  for (const destination of ['journal', 'patterns', 'recap', 'outdoors', 'reminders']) {
    assert.equal(await target('plan', destination), null, `plan/${destination}`);
  }
  for (const [tab, destination] of [['home', 'journal'], ['plan', 'tests'], ['home', 'javascript:alert(1)']]) {
    const error = await target(tab, destination);
    assert.ok(error, `${tab}/${destination} is refused`);
    assert.match(String(error.message), /target/);
  }
  // `destinations.today` is the empty array, so the today tab admits no destination at all.
  const onToday = await target('today', 'tests');
  assert.ok(onToday, 'the today tab takes no destination');
  assert.match(String(onToday.message), /target/);
  // A destination with no tab could never produce a routable target.
  const orphan = await target(null, 'tests');
  assert.ok(orphan, 'a destination without a tab is refused');
  assert.match(String(orphan.message), /target/);
});

test('a learn target names one of the seven factors the client knows', async () => {
  const id = 'b0b00000-9999-4000-8000-00000000c003';
  await insert('alerts', alertRow(BOB, { id }), { commit: true });
  const learn = (value) => write(`update public.alerts set target_learn = $2 where id = $1`, [id, value]);
  for (const value of ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead', null]) {
    assert.equal(await learn(value), null, String(value));
  }
  for (const value of ['water', 'unreviewed', 'Air', '']) {
    const error = await learn(value);
    assert.ok(error, `${JSON.stringify(value)} is refused`);
    assert.match(String(error.message), /learn/);
  }
});

// ---------------------------------------------------------------------------
// Service role only, ownership, idempotence
// ---------------------------------------------------------------------------

test('row level security is on and the preferences table carries no policy', async () => {
  const { rows: [state] } = await db.query(
    `select relrowsecurity as rls from pg_class where oid = ('public.' || $1)::regclass`,
    [PREFERENCES],
  );
  assert.equal(state.rls, true, 'row level security is enabled');
  const { rows: policies } = await db.query(
    `select policyname from pg_policies where schemaname = 'public' and tablename = $1`,
    [PREFERENCES],
  );
  assert.deepEqual(policies, [], 'no policy, the service role is the only reader');
});

test('neither anon nor authenticated holds any privilege on the preferences table', async () => {
  for (const role of API_ROLES) {
    const { rows: [privileges] } = await db.query(
      `select has_any_column_privilege($1, ($2::text)::regclass, 'SELECT') as select,
              has_any_column_privilege($1, ($2::text)::regclass, 'INSERT') as insert,
              has_any_column_privilege($1, ($2::text)::regclass, 'UPDATE') as update,
              has_table_privilege($1, ($2::text)::regclass, 'DELETE') as delete`,
      [role, `public.${PREFERENCES}`],
    );
    assert.deepEqual(
      privileges,
      { select: false, insert: false, update: false, delete: false },
      `${role} holds no privilege on ${PREFERENCES}`,
    );
  }
});

test('the owner reading their own preferences with their own session is denied', async () => {
  await assert.rejects(
    () => db.asRole('authenticated', ALICE, (tx) => tx.query(`select 1 from public.${PREFERENCES}`)),
    /permission denied/i,
    'a signed-in owner cannot select their own preferences row',
  );
});

test('the service role can still write it, which is how the routes read and save', async () => {
  const { rows: [privileges] } = await db.query(
    `select has_table_privilege('service_role', $1, 'INSERT') as insert,
            has_table_privilege('service_role', $1, 'UPDATE') as update,
            has_table_privilege('service_role', $1, 'SELECT') as select`,
    [`public.${PREFERENCES}`],
  );
  assert.deepEqual(privileges, { insert: true, update: true, select: true });
});

test('deleting the account deletes its preferences', async () => {
  await preferencesFor(CAROL);
  assert.equal(await count(`select count(*)::int as n from public.${PREFERENCES} where profile_id = $1`, [CAROL]), 1);
  await db.exec(`delete from auth.users where id = '${CAROL}'`);
  assert.equal(
    await count(`select count(*)::int as n from public.${PREFERENCES} where profile_id = $1`, [CAROL]),
    0,
    'the preferences went with the account',
  );
  assert.ok(
    (await count(`select count(*)::int as n from public.${PREFERENCES} where profile_id = $1`, [ALICE])) > 0,
    'and alice keeps hers',
  );
});

test('the verification query in the migration\'s trailing comment really answers true in every column', async () => {
  // Vibhav runs this by hand after pasting 0021 (YOUR_TODO.md section 2.10),
  // and a stale count in it would report a correct apply as a failure, or the
  // reverse. The comment is the single copy, so it is run from there rather
  // than transcribed here.
  const lines = MIGRATION.sql.split('\n');
  const at = lines.findIndex((line) => line.startsWith('-- Verification (read only)'));
  assert.ok(at > 0, 'the migration carries a verification comment');
  assert.match(lines[at], /all seven columns true/, 'the comment says how many columns to expect');
  const rule = /^--\s*-{10,}\s*$/;
  const body = [];
  for (let index = at + 2; index < lines.length && !rule.test(lines[index]); index += 1) {
    body.push(lines[index].replace(/^--/, ''));
  }
  const query = body.join('\n').trim();
  assert.match(query, /^select\b/i, 'the comment holds one read-only select');
  // The privilege names it asks about are string literals ('INSERT', ...), so
  // the literals come out before looking for a statement that would write.
  const code = query.replace(/'[^']*'/g, "''");
  assert.equal(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/i.test(code), false, 'and it changes nothing');
  assert.equal(code.split(';').filter((part) => part.trim()).length, 1, 'one statement, because the SQL editor shows only the last result');
  const { rows } = await db.query(query);
  assert.equal(rows.length, 1, 'one row');
  assert.equal(Object.keys(rows[0]).length, 7, 'seven columns, as the comment says');
  assert.deepEqual(
    Object.entries(rows[0]).filter(([, value]) => value !== true),
    [],
    'every column is true once 0021 is applied',
  );
});

test('running 0021 again changes nothing', async () => {
  const shape = async () => {
    const { rows: columns } = await db.query(
      `select table_name, column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) order by table_name, column_name`,
      [[PREFERENCES, 'alerts', 'profiles']],
    );
    const { rows: constraints } = await db.query(
      `select conname from pg_constraint where conrelid = any($1::regclass[]) order by conname`,
      [[`public.${PREFERENCES}`, 'public.alerts', 'public.profiles']],
    );
    const { rows: indexes } = await db.query(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = any($1) order by indexname`,
      [[PREFERENCES, 'alerts', 'profiles']],
    );
    // Rulings S11 to S13 and S15: the save function, the ledger guard and the eight triggers,
    // created once whatever the runs. 0023's guard on operations is not 0021's, so it is left out.
    const { rows: triggers } = await db.query(
      `select tgrelid::regclass::text as on_table, tgname, pg_get_triggerdef(oid) as definition from pg_trigger
        where not tgisinternal and tgrelid = any($1::regclass[]) and tgname <> 'operations_actions_settled_guard' order by tgname`,
      [[`public.${PREFERENCES}`, 'public.profiles', 'public.notification_prefs', 'public.household_bands', 'public.operations']],
    );
    const { rows: functions } = await db.query(
      `select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('save_settings', 'advance_settings_revision', 'reconcile_profile_tenure', 'guard_settled_settings_operation')
        order by 1`,
    );
    return { columns, constraints, indexes, triggers, functions };
  };
  const first = await shape();
  assert.equal(first.triggers.length, 8, 'eight triggers');
  assert.equal(first.functions.length, 4, 'four functions, so one save_settings: the earlier draft\'s signature is gone');
  await db.exec(MIGRATION.sql);
  assert.deepEqual(await shape(), first, 're-running the migration is a no-op');
});
