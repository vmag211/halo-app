/**
 * What migration 0021 does in the database for the settings surface (B04
 * Rulings S11 to S13), on a local in-memory PGlite database
 * (test/db/pgliteHarness.mjs) with the reconstructed baseline and every
 * migration applied as written:
 *
 *  1. public.save_settings is one settings save in one transaction: the
 *     compare-and-set on the revision, the group's own columns, and the home
 *     details (through the 0016 home functions), tenure, language, switches
 *     and bands. A refused or failed save applies nothing; an applied one
 *     advances the revision exactly once and returns the committed rows.
 *  2. Every writer of a snapshot value advances the revision once per
 *     statement that changed a stored value, in the same transaction: the
 *     statements PUT /api/notifications, PUT /api/household (save_household),
 *     PATCH /api/profile, POST /api/onboard (transition_home_context) and
 *     PATCH /api/home-contexts/[id] (update_home_context_attributes) run. A
 *     write that changes nothing advances nothing, and a save holding the old
 *     revision then conflicts.
 *  3. Tenure is reconciled with renter_mode inside the row write itself, so no
 *     writer can store the two disagreeing and no follow-up statement exists
 *     for another request to land in front of (review F3).
 *  4. The route tests' stand-ins (test/helpers/fakeSettingsDb.mjs) agree with
 *     the real thing, write by write.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // lib/operations.js imports through '@/lib'
import { createDb } from './db/pgliteHarness.mjs';
import { ledgerClient } from './db/pgliteLedger.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { HALO_TABLES, haloTables } from './helpers/tables.mjs';
import { registerHomeContextRpcs } from './helpers/fakeHomeContext.mjs';
import { registerSaveHousehold } from './helpers/fakeSaveHousehold.mjs';
import { installSettingsDb } from './helpers/fakeSettingsDb.mjs';

const { settingsSnapshot } = await import('../lib/settings.js');
const { runOperation, readOperation } = await import('../lib/operations.js');

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const notificationKinds = ['air_quality_change', 'weather_advisory', 'new_water_results', 'radon_season', 'season_summary'];
const BAND_COLUMNS = ['has_toddler', 'has_child', 'has_teen', 'has_adult', 'has_senior', 'has_pregnant', 'has_respiratory'];
const SIGNATURE = 'public.save_settings(uuid, uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb)';

let db;
let next = 0;
/** A fresh household with a preferences row at revision 1 and the profile `profile`. */
async function household(profile = {}) {
  next += 1;
  const id = `5e770000-0000-4000-8000-${next.toString(16).padStart(12, '0')}`;
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${id}', true)`);
  await db.query('insert into public.profile_preferences (profile_id) values ($1)', [id]);
  const columns = Object.keys(profile);
  if (columns.length) {
    await db.query(
      `update public.profiles set ${columns.map((column, i) => `${column} = $${i + 2}`).join(', ')} where id = $1`,
      [id, ...Object.values(profile)],
    );
    await db.query('update public.profile_preferences set revision = 1 where profile_id = $1', [id]);
  }
  return id;
}

before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`);
});

after(async () => {
  await db?.close();
});

/** Runs one statement as the service role and commits, as PostgREST does; the Postgres error is thrown as it comes. */
const asService = (sql, params) => db.asService((tx) => tx.query(sql, params), { commit: true });

/** A ledger row for a settings save, as runOperation claims it: pending unless `status` says otherwise. */
async function ledgerRow(owner, { status = 'pending', domain = 'settings', result = null } = {}) {
  const operationId = crypto.randomUUID();
  await db.query(
    `insert into public.operations (operation_id, profile_id, domain, kind, status, result)
     values ($1, $2, $3, 'settings.save', $4, $5::jsonb)`,
    [operationId, owner, domain, status, result === null ? null : JSON.stringify(result)],
  );
  return operationId;
}
const operationOf = async (operationId) =>
  (await db.query('select status, result from public.operations where operation_id = $1', [operationId])).rows[0];

/**
 * save_settings with named arguments; null for each one left out. Each call
 * claims its own pending ledger row first, as the route's runOperation does,
 * unless `operationId` names one (Ruling S15).
 */
async function save(id, expected, { preferences = {}, profile = null, home = null, notifications = null, bands = null, operationId } = {}) {
  const json = (value) => (value === null ? null : JSON.stringify(value));
  const op = operationId ?? (id ? await ledgerRow(id) : crypto.randomUUID());
  const { rows } = await asService(`select ${SIGNATURE.replace(/\(.*\)/, '')}($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb) as result`, [
    id, op, expected, json(preferences), json(profile), json(home), json(notifications), json(bands),
  ]);
  return rows[0].result;
}
const saveError = (...args) => save(...args).then(() => null, (error) => error);

const revisionOf = async (id) => (await db.query('select revision from public.profile_preferences where profile_id = $1', [id])).rows[0]?.revision;
const profileOf = async (id) =>
  (await db.query('select home_year, water_source, locale, tenure, renter_mode from public.profiles where id = $1', [id])).rows[0];
/** Every row of this household in the four snapshot tables and its homes, for "nothing changed". */
async function everything(id) {
  const rows = {};
  for (const [table, key] of [['profiles', 'id'], ['profile_preferences', 'profile_id'], ['notification_prefs', 'profile_id'], ['household_bands', 'profile_id'], ['home_contexts', 'profile_id']]) {
    rows[table] = (await db.query(`select * from public.${table} where ${key} = $1`, [id])).rows;
  }
  return JSON.stringify(rows);
}

// ---------------------------------------------------------------------------
// 1. save_settings (Ruling S11)
// ---------------------------------------------------------------------------

test('a save applies the group\'s columns at revision + 1 and returns exactly the committed rows', async () => {
  const id = await household();
  const result = await save(id, 1, { preferences: { luna_home: true, quiet_enabled: true, quiet_from: '22:00', quiet_to: '07:00' } });
  assert.equal(result.saved, true);
  assert.equal(result.revision, 2);
  const { rows: [stored] } = await db.query('select to_jsonb(p) as row from public.profile_preferences p where profile_id = $1', [id]);
  assert.deepEqual(result.preferences, stored.row);
  assert.deepEqual([stored.row.luna_home, stored.row.quiet_enabled, stored.row.quiet_from, stored.row.quiet_to, stored.row.luna_tasks], [true, true, '22:00', '07:00', false]);
  assert.deepEqual(result.profile, await profileOf(id));
  assert.equal(result.changed, true);
  // Review finding A: the save makes the notification and band rows before it
  // locks the preferences row, with every value at its default.
  const { rows: [notes] } = await db.query('select to_jsonb(n) as row from public.notification_prefs n where profile_id = $1', [id]);
  assert.deepEqual(result.notifications, notes.row);
  assert.deepEqual(notificationKinds.map((key) => notes.row[key]), [true, true, true, true, true], 'all defaults');
  const { rows: [bands] } = await db.query('select * from public.household_bands where profile_id = $1', [id]);
  assert.deepEqual(BAND_COLUMNS.filter((key) => bands[key]), [], 'all defaults');
});

test('a save at a revision that has moved writes nothing, makes no row, and answers the current revision', async () => {
  const id = await household();
  await save(id, 1, { preferences: { luna_tasks: true } });
  const before = await everything(id);
  const operationId = await ledgerRow(id);
  assert.deepEqual(await save(id, 1, { preferences: { luna_home: true }, profile: { locale: 'es' }, operationId }), { saved: false, revision: 2 });
  assert.equal(await everything(id), before);
  assert.deepEqual(await operationOf(operationId), { status: 'pending', result: null }, 'the route settles a refusal itself');
  // A household with no notification or band row: the ones the save made for its lock go again.
  const fresh = await household();
  await db.query('delete from public.notification_prefs where profile_id = $1', [fresh]);
  await db.query('delete from public.household_bands where profile_id = $1', [fresh]);
  const untouched = await everything(fresh);
  assert.deepEqual(await save(fresh, 7, { notifications: { radon_season: false } }), { saved: false, revision: 1 });
  assert.equal(await everything(fresh), untouched, 'no notification or band row is left behind');
  // No preferences row: nothing to compare against, and nothing is left behind either.
  const bobBefore = await everything(BOB);
  assert.deepEqual(await save(BOB, 1), { saved: false, revision: null });
  assert.equal(await everything(BOB), bobBefore);
});

test('of two saves holding the same revision exactly one applies', async () => {
  const id = await household();
  const [a, b] = await Promise.all([
    save(id, 1, { preferences: { luna_home: true } }),
    save(id, 1, { preferences: { display_appearance: 'dark' } }),
  ]);
  assert.deepEqual([a.saved, b.saved].sort(), [false, true]);
  assert.equal(await revisionOf(id), 2);
});

test('a save across every table advances the revision exactly once, though each of its writes fired a trigger', async () => {
  const id = await household();
  const result = await save(id, 1, {
    profile: { tenure: 'renter', renter_mode: true },
    home: { home_year: 1990, water_source: 'spring' },
    notifications: { radon_season: false },
    bands: { has_child: true, has_adult: true },
  });
  assert.equal(result.revision, 2);
  assert.equal(await revisionOf(id), 2);
  assert.deepEqual(await profileOf(id), { home_year: 1990, water_source: 'spring', locale: 'en', tenure: 'renter', renter_mode: true });
  assert.deepEqual(result.profile, await profileOf(id));
  assert.equal(result.notifications.radon_season, false);
  assert.equal(result.notifications.weather_advisory, true);
  const { rows: [bands] } = await db.query('select has_child, has_adult, has_teen from public.household_bands where profile_id = $1', [id]);
  assert.deepEqual(bands, { has_child: true, has_adult: true, has_teen: false });
});

test('a save that fails at its last write applies nothing at all, and its ledger row stays pending', async () => {
  const id = await household({ home_year: 1975 });
  const before = await everything(id);
  // The bands are the last table a save writes. A trigger that refuses this
  // household's band update fails the save there, after everything else.
  await db.exec(`
    create function public.test_refuse_bands() returns trigger language plpgsql as $$
    begin raise exception 'TEST_BANDS_REFUSED' using errcode = '23514'; end; $$;
    create trigger test_refuse_bands before update on public.household_bands
      for each row when (new.profile_id = '${id}') execute function public.test_refuse_bands();`);
  try {
    const operationId = await ledgerRow(id);
    const error = await saveError(id, 1, {
      preferences: { display_appearance: 'dark', calendar_linked: true },
      home: { home_year: 1990 },
      profile: { locale: 'es', tenure: 'renter', renter_mode: true },
      notifications: { radon_season: false },
      bands: { has_child: true },
      operationId,
    });
    assert.deepEqual([error?.code, error?.message], ['23514', 'TEST_BANDS_REFUSED']);
    assert.equal(await everything(id), before, 'not the revision, not the display columns, not the year, not the switch');
    assert.deepEqual(await operationOf(operationId), { status: 'pending', result: null }, 'not settled: the route records the failure');
  } finally {
    await db.exec('drop trigger test_refuse_bands on public.household_bands; drop function public.test_refuse_bands();');
  }
});

test('home details go through the current home at its revision, and the profile follows it', async () => {
  const id = await household();
  const { rows: [{ result: made }] } = await asService(
    'select public.transition_home_context($1, $2::jsonb, $3::jsonb, null) as result',
    [id, JSON.stringify({ lat: 35.41, lng: -80.61 }), JSON.stringify({ water_source: 'well', home_year: 1975 })],
  );
  const revision = await revisionOf(id);
  const result = await save(id, revision, { home: { home_year: 2001 } });
  assert.equal(result.revision, revision + 1);
  const { rows: homes } = await db.query('select id, revision, home_year, water_source from public.home_contexts where profile_id = $1', [id]);
  assert.deepEqual(homes, [{ id: made.context.id, revision: made.context.revision + 1, home_year: 2001, water_source: 'well' }]);
  assert.deepEqual([result.profile.home_year, result.profile.water_source], [2001, 'well']);
});

test('located with no home yet, the save makes the legacy home and saves the answer in it', async () => {
  const id = await household({ lat: 35.5, lng: -80.5, water_source: 'utility', home_year: 1960 });
  const result = await save(id, 1, { home: { water_source: 'well' } });
  assert.equal(result.saved, true);
  const { rows: homes } = await db.query('select origin, water_source, home_year, lat, lng from public.home_contexts where profile_id = $1', [id]);
  assert.deepEqual(homes, [{ origin: 'legacy_migration', water_source: 'well', home_year: 1960, lat: 35.5, lng: -80.5 }]);
  assert.deepEqual([result.profile.water_source, result.profile.home_year], ['well', 1960]);
});

test('not located, the answers go on the profile', async () => {
  const id = await household();
  await save(id, 1, { home: { home_year: 1955, water_source: null } });
  assert.deepEqual([(await profileOf(id)).home_year, (await profileOf(id)).water_source], [1955, null]);
  assert.equal((await db.query('select count(*)::int as n from public.home_contexts where profile_id = $1', [id])).rows[0].n, 0);
});

test('a malformed call is HALO_INVALID_INPUT and nothing is read or written', async () => {
  const id = await household();
  const before = await everything(id);
  for (const args of [
    { preferences: { revision: 9 } },
    { preferences: { luna_home: 'yes' } },
    { preferences: { display_scale: 100 } },
    { profile: { id: BOB } },
    { profile: { renter_mode: 'true' } },
    { home: {} },
    { home: { lat: 1 } },
    { home: { home_year: 19.5 } },
    { notifications: { radon_season: 'off' } },
    { notifications: { profile_id: BOB } },
    { bands: { has_cat: true } },
  ]) {
    const error = await saveError(id, 1, args);
    assert.deepEqual([error?.code, error?.message], ['P0001', 'HALO_INVALID_INPUT'], JSON.stringify(args));
  }
  assert.deepEqual([(await saveError(id, 0))?.message, (await saveError(null, 1))?.message], ['HALO_INVALID_INPUT', 'HALO_INVALID_INPUT']);
  const noOperation = await asService(`select ${SIGNATURE.replace(/\(.*\)/, '')}($1, null, 1, '{}', null, null, null, null)`, [id]).then(() => null, (error) => error);
  assert.deepEqual([noOperation?.message, noOperation?.detail], ['HALO_INVALID_INPUT', 'p_operation_id is required']);
  assert.equal(await everything(id), before);
});

test('review finding B: a value its column refuses is HALO_INVALID_INPUT naming the key, and the value appears nowhere in the error', async () => {
  // A located household, so a CHECK violation's "Failing row contains (...)" would carry its coordinates and ZIP.
  const id = await household({ lat: 35.409, lng: -80.58, zip: '28025', county: 'Cabarrus County', pwsid: 'NC9990001' });
  const before = await everything(id);
  const MARKER = 'MARKER-0021-B-7731';
  for (const [args, key] of [
    [{ preferences: { display_appearance: MARKER } }, 'display_appearance'],
    [{ preferences: { display_palette: MARKER } }, 'display_palette'],
    [{ preferences: { display_scale: MARKER } }, 'display_scale'],
    [{ preferences: { display_motion: MARKER } }, 'display_motion'],
    [{ preferences: { quiet_from: MARKER } }, 'quiet_from'],
    [{ preferences: { quiet_to: '24:00' } }, 'quiet_to'],
    [{ preferences: { quiet_zone: `${MARKER} zone` } }, 'quiet_zone'],
    [{ preferences: { calendar_zone: '+05:00' } }, 'calendar_zone'],
    [{ profile: { tenure: MARKER } }, 'tenure'],
    [{ profile: { locale: MARKER } }, 'locale'],
    [{ profile: { locale: 'fr' } }, 'locale'],
    [{ preferences: { quiet_enabled: true, quiet_from: '22:00', quiet_to: '22:00' } }, 'quiet hours'],
  ]) {
    const operationId = await ledgerRow(id);
    const error = await saveError(id, 1, { ...args, operationId });
    assert.deepEqual([error?.code, error?.message], ['P0001', 'HALO_INVALID_INPUT'], JSON.stringify(args));
    assert.match(String(error.detail), new RegExp(key), 'the DETAIL names what was refused');
    for (const part of [error.message, error.detail, error.hint, error.where]) {
      assert.equal(String(part ?? '').includes(MARKER), false, `the value is not repeated: ${part}`);
      assert.equal(String(part ?? '').includes('28025'), false, `no row is quoted: ${part}`);
    }
    assert.deepEqual(await operationOf(operationId), { status: 'pending', result: null });
  }
  assert.equal(await everything(id), before);
  // Quiet hours whose stored ends are equal are refused when a save switches them on.
  const sameEnds = await household();
  await db.query(`update public.profile_preferences set quiet_from = '07:00', quiet_to = '07:00' where profile_id = $1`, [sameEnds]);
  const stored = await everything(sameEnds);
  assert.equal((await saveError(sameEnds, await revisionOf(sameEnds), { preferences: { quiet_enabled: true } }))?.message, 'HALO_INVALID_INPUT');
  assert.equal(await everything(sameEnds), stored);
});

test('review N1: a household with no profile row can hold no preferences row and claim no settings operation (23503)', async () => {
  // What GET and PATCH /api/settings answer as a 404 before writing anything: the
  // route's fake declares the same foreign key (test/helpers/tables.mjs).
  const id = crypto.randomUUID();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${id}', true); delete from public.profiles where id = '${id}';`);
  const create = await asService('insert into public.profile_preferences (profile_id) values ($1) on conflict (profile_id) do nothing', [id]).then(() => null, (error) => error);
  assert.equal(create?.code, '23503', 'ensurePreferences\'s insert is refused by the foreign key');
  const claim = await asService(`insert into public.operations (operation_id, profile_id, domain, kind) values ($1, $2, 'settings', 'settings.save')`, [crypto.randomUUID(), id]).then(() => null, (error) => error);
  assert.equal(claim?.code, '23503', 'and so would the ledger claim be');
  assert.equal((await saveError(id, 1, { operationId: crypto.randomUUID() }))?.message, 'HALO_OPERATION_NOT_PENDING', 'save_settings writes nothing');
});

// ---------------------------------------------------------------------------
// Review N2: where home details go, in the profile route's JS and in this SQL
// ---------------------------------------------------------------------------

const HOME = 'a0e00000-0000-4000-8000-0000000000aa';
const HOME_SAVE = 'a0e00000-0000-4000-8000-0000000000bb';
/**
 * One household state per rule: the profile's own point, and the point of a
 * current home or null. A current home decides it whatever the profile holds;
 * otherwise a stored point (both set, rounded to 3 decimals) makes the legacy
 * home; anything else is the profile itself.
 */
const HOME_DETAIL_CASES = [
  ['a current home', { lat: 35.41, lng: -80.61 }, { lat: 35.41, lng: -80.61 }, 'update_home_context_attributes'],
  ['a current home, though the profile holds no point', { lat: null, lng: null }, { lat: 35.41, lng: -80.61 }, 'update_home_context_attributes'],
  ['located at a stored point, with no home yet', { lat: 35.412, lng: -80.615 }, null, 'transition_home_context'],
  ['not located', { lat: null, lng: null }, null, 'profile'],
  ['located at a point not rounded to 3 decimals', { lat: 35.4567, lng: -80.5 }, null, 'profile'],
  ['half a point', { lat: 35.5, lng: null }, null, 'profile'],
];
const ANSWERS = { water_source: 'well', home_year: 1975 };

/** Where save_settings (0021) put a year change, read from what it changed. */
async function sqlDestination(point, homePoint) {
  const id = await household({ ...ANSWERS });
  if (homePoint) {
    await asService('select public.transition_home_context($1, $2::jsonb, $3::jsonb, null)', [id, JSON.stringify(homePoint), JSON.stringify(ANSWERS)]);
  }
  // The profile's own point last: the home function keeps the profile in step with the home.
  await db.query('update public.profiles set lat = $2, lng = $3 where id = $1', [id, point.lat, point.lng]);
  const homes = async () => (await db.query('select id, revision, origin, home_year from public.home_contexts where profile_id = $1 order by sequence', [id])).rows;
  const before = await homes();
  assert.equal((await save(id, await revisionOf(id), { home: { home_year: 2001 } })).saved, true);
  const after = await homes();
  assert.equal((await profileOf(id)).home_year, 2001, 'the profile has the answer whichever way it went');
  if (before.length === 1 && after.length === 1 && after[0].revision === before[0].revision + 1 && after[0].home_year === 2001) return 'update_home_context_attributes';
  if (before.length === 0 && after.length === 1 && after[0].origin === 'legacy_migration' && after[0].home_year === 2001) return 'transition_home_context';
  if (JSON.stringify(after) === JSON.stringify(before)) return 'profile';
  return `unexpected: ${JSON.stringify({ before, after })}`;
}

/** The rows a fake needs for this state, with the profile's id. */
const fakeState = (id, point, homePoint) => ({
  profiles: [{ id, ...point, ...ANSWERS, tenure: null }],
  home_contexts: homePoint ? [{ id: HOME, profile_id: id, sequence: 1, revision: 1, origin: 'onboard', ...homePoint, ...ANSWERS, effective_to: null }] : [],
});
const HOME_FUNCTIONS = new Set(['update_home_context_attributes', 'transition_home_context']);

/** Where PATCH /api/profile's JavaScript puts the same change: the function it calls, or none. */
async function routeDestination(point, homePoint) {
  const h = createRouteHarness({ tables: HALO_TABLES, seed: ({ alice }) => fakeState(alice.id, point, homePoint) });
  registerHomeContextRpcs(h.db);
  const res = await h.call('/api/profile', 'PATCH', { as: 'alice', body: { home_year: 2001 } });
  assert.equal(res.status, 200, await res.clone().text());
  return h.db.rpcCalls.map((call) => call.name).find((name) => HOME_FUNCTIONS.has(name)) ?? 'profile';
}

/** Where the route tests' stand-in for save_settings puts it (test/helpers/fakeSettingsDb.mjs). */
async function fakeDestination(point, homePoint) {
  const id = crypto.randomUUID();
  const fake = createFakeSupabase({
    tables: HALO_TABLES,
    seed: { ...fakeState(id, point, homePoint), profile_preferences: [{ profile_id: id }], operations: [{ operation_id: HOME_SAVE, profile_id: id, domain: 'settings', kind: 'settings.save' }] },
  });
  registerHomeContextRpcs(fake);
  installSettingsDb(fake);
  const { data, error } = await fake.rpc('save_settings', {
    p_profile_id: id, p_operation_id: HOME_SAVE, p_expected_revision: 1, p_preferences: {}, p_profile: null, p_home: { home_year: 2001 }, p_notifications: null, p_bands: null,
  });
  assert.deepEqual([error, data?.saved], [null, true]);
  return fake.rpcCalls.map((call) => call.name).find((name) => HOME_FUNCTIONS.has(name)) ?? 'profile';
}

for (const [label, point, homePoint, expected] of HOME_DETAIL_CASES) {
  test(`review N2: home details go to the same place from PATCH /api/profile, save_settings and its stand-in (${label})`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    const [sql, route, fake] = [await sqlDestination(point, homePoint), await routeDestination(point, homePoint), await fakeDestination(point, homePoint)];
    assert.deepEqual({ sql, route, fake }, { sql: expected, route: expected, fake: expected });
  });
}

test('only the service role may call save_settings', async () => {
  for (const role of ['anon', 'authenticated']) {
    const { rows: [{ allowed }] } = await db.query('select has_function_privilege($1, $2, \'EXECUTE\') as allowed', [role, SIGNATURE]);
    assert.equal(allowed, false, role);
  }
  const { rows: [{ allowed }] } = await db.query('select has_function_privilege(\'service_role\', $1, \'EXECUTE\') as allowed', [SIGNATURE]);
  assert.equal(allowed, true);
});

// ---------------------------------------------------------------------------
// 1a. The save settles its own ledger row (Ruling S15)
// ---------------------------------------------------------------------------

/** The rows a snapshot is built from, as the route reads them. */
async function rowsOf(id) {
  const { rows: [preferences] } = await db.query('select to_jsonb(p) as row from public.profile_preferences p where profile_id = $1', [id]);
  const { rows: [notifications] } = await db.query('select to_jsonb(n) as row from public.notification_prefs n where profile_id = $1', [id]);
  return { preferences: preferences.row, profile: await profileOf(id), notifications: notifications?.row ?? null };
}

test('S15: an applied save settles its own ledger row as succeeded, with the receipt the route stores', async () => {
  const id = await household();
  const operationId = await ledgerRow(id);
  const result = await save(id, 1, { preferences: { luna_projects: true }, operationId });
  const op = await operationOf(operationId);
  assert.equal(op.status, 'succeeded');
  assert.deepEqual(op.result, {
    operationId,
    status: 'succeeded',
    snapshot: settingsSnapshot({ preferences: result.preferences, profile: result.profile, notifications: result.notifications, unresolvedOperations: [] }),
  });
  assert.deepEqual(op.result.snapshot.unresolvedOperations, [], 'a stored receipt is history, not a lock (Ruling S14)');
  assert.equal(op.result.snapshot.values.luna.projects, true);
});

/** Households whose stored rows exercise every rule of the snapshot, for the JS and SQL copies to agree on. */
const SNAPSHOT_CASES = [
  ['nothing answered', {}, {}, null],
  ['every answer given', { home_year: 1975, water_source: 'well', tenure: 'owner', locale: 'es' }, { display_palette: 'forest' }, { weather_advisory: false }],
  ['an unanswered tenure while renting', { tenure: null, renter_mode: true, water_source: 'spring' }, { quiet_enabled: true, quiet_from: '22:30', quiet_to: '06:15' }, null],
  ['an unanswered tenure, not renting', { tenure: null, renter_mode: false, home_year: 2024 }, { display_palette: 'ocean', display_scale: '150', display_motion: 'full' }, null],
  ['a tenure of other', { tenure: 'other', water_source: 'utility' }, { calendar_zone: 'Pacific/Honolulu', calendar_linked: true, luna_home: true }, { season_summary: false, radon_season: false }],
  ['a year outside four digits', { home_year: 999 }, {}, null],
];

for (const [label, profile, preferences, notifications] of SNAPSHOT_CASES) {
  test(`S15: the receipt save_settings stores is the one lib/settings.js builds from the same rows (${label})`, async () => {
    const id = await household(profile);
    // The stored state, set directly so a case need not be reachable through a save.
    const columns = Object.keys(preferences);
    if (columns.length) {
      await db.query(
        `update public.profile_preferences set ${columns.map((column, i) => `${column} = $${i + 2}`).join(', ')}, revision = 1 where profile_id = $1`,
        [id, ...Object.values(preferences)],
      );
      await db.query('update public.profile_preferences set revision = 1 where profile_id = $1', [id]);
    }
    if (notifications) {
      await db.query(
        `insert into public.notification_prefs (profile_id, ${Object.keys(notifications).join(', ')}) values ($1, ${Object.keys(notifications).map((_, i) => `$${i + 2}`).join(', ')})`,
        [id, ...Object.values(notifications)],
      );
      await db.query('update public.profile_preferences set revision = 1 where profile_id = $1', [id]);
    }
    // A save that changes one thing, so the receipt is built from rows the save committed.
    const operationId = await ledgerRow(id);
    await save(id, 1, { preferences: { luna_tasks: true }, operationId });
    const stored = (await operationOf(operationId)).result.snapshot;
    assert.deepEqual(stored, settingsSnapshot({ ...(await rowsOf(id)), unresolvedOperations: [] }));
    // Key for key, order aside: jsonb sorts keys, and the client reads by name.
    assert.equal(Object.hasOwn(stored.display, 'palette'), ['ocean', 'forest', 'iris'].includes(preferences.display_palette));
  });
}

test('S15: a ledger row that is not this household\'s pending settings row refuses the save with nothing written', async () => {
  const id = await household();
  const before = await everything(id);
  const cases = {
    'reaped as abandoned': await ledgerRow(id, { status: 'failed', result: { status: 'failed', reason: 'abandoned' } }),
    'already succeeded': await ledgerRow(id, { status: 'succeeded', result: { status: 'succeeded' } }),
    'another household\'s': await ledgerRow(ALICE),
    'another domain\'s': await ledgerRow(id, { domain: 'alerts' }),
    'never claimed': crypto.randomUUID(),
  };
  for (const [label, operationId] of Object.entries(cases)) {
    const statusBefore = await operationOf(operationId);
    // Checked first (H29): before the revision, so a stale save of a reaped row is refused as
    // not pending too, rather than answered as a revision conflict.
    for (const expected of [1, 99]) {
      const error = await saveError(id, expected, { preferences: { luna_home: true }, notifications: { radon_season: false }, operationId });
      assert.deepEqual([error?.code, error?.message], ['P0001', 'HALO_OPERATION_NOT_PENDING'], `${label} at revision ${expected}`);
    }
    assert.deepEqual(await operationOf(operationId), statusBefore, `${label}: the ledger row is untouched`);
  }
  assert.equal(await everything(id), before, 'no setting, no revision, no notification or band row');
});

test('S15: a settled settings row keeps its status; its receipt can be rewritten as succeeded; a pending row and other domains settle as before', async () => {
  const id = await household();
  const operationId = await ledgerRow(id);
  await save(id, 1, { preferences: { luna_home: true }, operationId });
  const settle = (op, status, result) =>
    db.query('update public.operations set status = $2, result = $3::jsonb, updated_at = now() where operation_id = $1', [op, status, result === null ? null : JSON.stringify(result)]);

  const stored = (await operationOf(operationId)).result;
  const refused = await settle(operationId, 'failed', null).then(() => null, (error) => error);
  assert.deepEqual([refused?.code, refused?.message], ['P0001', 'HALO_OPERATION_SETTLED'], 'runOperation\'s later settle as failed is refused');
  assert.deepEqual(await operationOf(operationId), { status: 'succeeded', result: stored });
  await settle(operationId, 'succeeded', { ...stored, status: 'succeeded' });
  assert.equal((await operationOf(operationId)).status, 'succeeded', 'runOperation\'s settle of a save it saw commit is allowed');

  const reaped = await ledgerRow(id, { status: 'failed', result: { status: 'failed', reason: 'abandoned' } });
  assert.equal((await settle(reaped, 'succeeded', { status: 'succeeded' }).then(() => null, (error) => error))?.message, 'HALO_OPERATION_SETTLED',
    'a reaped row never becomes succeeded');
  const pending = await ledgerRow(id);
  await settle(pending, 'failed', null);
  assert.equal((await operationOf(pending)).status, 'failed', 'a pending row settles as before (a refused save)');
  const alerts = await ledgerRow(id, { domain: 'alerts', status: 'succeeded', result: { status: 'succeeded' } });
  await settle(alerts, 'failed', null);
  assert.equal((await operationOf(alerts)).status, 'failed', 'a domain without a guard is unchanged');
});

test('S15, end to end with runOperation: a save whose answer is lost still reads as succeeded, and reconcile shows it applied', async () => {
  const id = await household();
  const operationId = crypto.randomUUID();
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await assert.rejects(
      runOperation(ledgerClient(db), { operationId, profileId: id, domain: 'settings', kind: 'settings.save', input: { group: 'luna' } }, async () => {
        await save(id, 1, { preferences: { luna_tasks: true, luna_home: true }, operationId });
        throw new Error('fetch failed'); // the save committed, its answer did not arrive
      }),
      /fetch failed/,
    );
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((line) => line.includes(`could not settle ${operationId} as failed`) && line.includes('HALO_OPERATION_SETTLED')),
    'runOperation\'s settle as failed was refused and logged, not thrown');
  // What GET /api/operations answers: lib/operations.js readOperation, on this database.
  const read = await readOperation({ from: (table) => pgliteSelect(db, table) }, { operationId, profileId: id, domain: 'settings' });
  assert.equal(read.status, 'succeeded');
  assert.deepEqual(read.result.snapshot.values.luna, { tasks: true, home: true, projects: false }, 'the save as applied');
  assert.equal(read.result.snapshot.revision, 2);
  assert.deepEqual(read.result.snapshot, settingsSnapshot({ ...(await rowsOf(id)), unresolvedOperations: [] }));

  // A save the reaper settled first: save_settings refuses, nothing is applied, and
  // runOperation's own settle as failed (failed to failed) is allowed.
  const reapedId = crypto.randomUUID();
  const before = await everything(id);
  await assert.rejects(
    runOperation(ledgerClient(db), { operationId: reapedId, profileId: id, domain: 'settings', kind: 'settings.save', input: { group: 'luna', n: 2 } }, async () => {
      await db.query(`update public.operations set status = 'failed', result = '{"status":"failed","reason":"abandoned"}' where operation_id = $1`, [reapedId]);
      return save(id, 2, { preferences: { luna_projects: true }, operationId: reapedId });
    }),
    /HALO_OPERATION_NOT_PENDING/,
  );
  assert.equal(await everything(id), before);
  assert.equal((await operationOf(reapedId)).status, 'failed');
});

// ---------------------------------------------------------------------------
// 1b. A save of the values already stored (review finding C)
// ---------------------------------------------------------------------------

test('finding C: a save of the values already stored keeps the revision, settles succeeded, and a device at the same revision can still save', async () => {
  const id = await household();
  await save(id, 1, { preferences: { display_appearance: 'dark' }, notifications: { radon_season: false }, bands: { has_adult: true } });
  const before = await everything(id);
  const operationId = await ledgerRow(id);
  const same = await save(id, 2, {
    preferences: { display_appearance: 'dark', luna_home: false },
    profile: { locale: 'en' },
    notifications: { radon_season: false },
    bands: { has_adult: true },
    operationId,
  });
  assert.deepEqual([same.saved, same.changed, same.revision], [true, false, 2]);
  assert.equal(await revisionOf(id), 2);
  assert.equal((await operationOf(operationId)).status, 'succeeded');
  assert.equal((await operationOf(operationId)).result.snapshot.revision, 2);
  const after = JSON.parse(await everything(id));
  // Only the write times move: the save wrote its columns, unchanged.
  const unstamped = (rows) => rows.map((row) => ({ ...row, updated_at: null }));
  for (const table of Object.keys(after)) assert.deepEqual(unstamped(after[table]), unstamped(JSON.parse(before)[table]), table);
  // Another device still holding revision 2 saves a real change.
  const other = await save(id, 2, { preferences: { luna_home: true } });
  assert.deepEqual([other.saved, other.changed, other.revision], [true, true, 3]);
});

/** The statements each route runs, as the service role. */
const WRITES = {
  'PUT /api/notifications': (id, values) => asService(
    `insert into public.notification_prefs (profile_id, ${Object.keys(values).join(', ')}, updated_at)
       values ($1, ${Object.keys(values).map((_, i) => `$${i + 2}`).join(', ')}, now())
     on conflict (profile_id) do update set ${Object.keys(values).map((key) => `${key} = excluded.${key}`).join(', ')}, updated_at = excluded.updated_at`,
    [id, ...Object.values(values)],
  ),
  'PUT /api/household': (id, bands, renterMode = null) => asService('select public.save_household($1, $2::jsonb, $3, null)', [id, JSON.stringify(bands), renterMode]),
  'PATCH /api/profile': (id, values) => asService(
    `insert into public.profiles (id, ${Object.keys(values).join(', ')}) values ($1, ${Object.keys(values).map((_, i) => `$${i + 2}`).join(', ')})
     on conflict (id) do update set ${Object.keys(values).map((key) => `${key} = excluded.${key}`).join(', ')}`,
    [id, ...Object.values(values)],
  ),
  'POST /api/onboard': (id, attributes) => asService(
    'select public.transition_home_context($1, $2::jsonb, $3::jsonb, null) as result',
    [id, JSON.stringify({ lat: 35.41, lng: -80.61, county: 'Cabarrus County', state: 'NC' }), JSON.stringify(attributes)],
  ),
  'PATCH /api/home-contexts/[id]': async (id, attributes) => {
    const { rows: [home] } = await db.query('select id, revision from public.home_contexts where profile_id = $1 and effective_to is null', [id]);
    return asService('select public.update_home_context_attributes($1, $2, $3, $4::jsonb)', [id, home.id, home.revision, JSON.stringify(attributes)]);
  },
};

const CASES = [
  ['PUT /api/notifications, a switch turned off', 'PUT /api/notifications', [{ radon_season: false }], 1],
  ['PUT /api/notifications, a new row with every switch on', 'PUT /api/notifications', [{ radon_season: true }], 0],
  ['PUT /api/household, the bands only', 'PUT /api/household', [{ has_child: true }], 1],
  ['PUT /api/household, renter_mode only', 'PUT /api/household', [{}, true], 1],
  ['PUT /api/household, the bands and renter_mode (two statements)', 'PUT /api/household', [{ has_child: true }, true], 2],
  ['PUT /api/household, nothing new', 'PUT /api/household', [{}, false], 0],
  ['PATCH /api/profile, the year', 'PATCH /api/profile', [{ home_year: 1990 }], 1],
  ['PATCH /api/profile, the language', 'PATCH /api/profile', [{ locale: 'es' }], 1],
  ['PATCH /api/profile, the stored year again', 'PATCH /api/profile', [{ home_year: 1975 }], 0],
  ['PATCH /api/profile, a column outside the snapshot', 'PATCH /api/profile', [{ county: 'Elsewhere' }], 0],
  ['POST /api/onboard, a first home with new answers', 'POST /api/onboard', [{ water_source: 'utility', home_year: 1990 }], 1],
  ['POST /api/onboard, a first home with the stored answers', 'POST /api/onboard', [{ water_source: 'well', home_year: 1975 }], 0],
];

for (const [label, writer, args, advances] of CASES) {
  test(`S12: ${label} advances the revision ${advances === 0 ? 'not at all' : `${advances === 1 ? 'once' : 'twice'}`}`, async () => {
    const id = await household({ home_year: 1975, water_source: 'well' });
    const other = await household({ home_year: 1975, water_source: 'well' });
    await WRITES[writer](id, ...args);
    assert.equal(await revisionOf(id), 1 + advances);
    assert.equal(await revisionOf(other), 1, 'only the household written');
    if (advances > 0) assert.deepEqual(await save(id, 1, { preferences: { luna_home: true } }), { saved: false, revision: 1 + advances }, 'a save holding the old revision conflicts');
  });
}

test('S12: PATCH /api/home-contexts/[id] advances the revision once, and the stored answer again not at all', async () => {
  const id = await household();
  await WRITES['POST /api/onboard'](id, { water_source: 'well', home_year: 1975 });
  const start = await revisionOf(id);
  await WRITES['PATCH /api/home-contexts/[id]'](id, { home_year: 1990 });
  assert.equal(await revisionOf(id), start + 1);
  await WRITES['PATCH /api/home-contexts/[id]'](id, { home_year: 1990 });
  assert.equal(await revisionOf(id), start + 1);
  assert.deepEqual((await save(id, start, { profile: { tenure: 'other' } })).saved, false);
});

test('S12: an existing band or switch row changed advances once, and the same values again not at all', async () => {
  const id = await household();
  await WRITES['PUT /api/household'](id, { has_adult: true });
  await WRITES['PUT /api/notifications'](id, { radon_season: false });
  const start = await revisionOf(id);
  await WRITES['PUT /api/household'](id, { has_adult: true, has_child: true });
  assert.equal(await revisionOf(id), start + 1, 'a band changed on the stored row');
  await WRITES['PUT /api/household'](id, { has_adult: true, has_child: true });
  assert.equal(await revisionOf(id), start + 1, 'the same bands again');
  await WRITES['PUT /api/notifications'](id, { radon_season: true });
  assert.equal(await revisionOf(id), start + 2, 'a switch changed on the stored row');
  await WRITES['PUT /api/notifications'](id, { radon_season: true });
  assert.equal(await revisionOf(id), start + 2, 'the same switch again');
});

test('S12: the preferences table itself: a changed value advances, a write that sets the revision or changes nothing does not', async () => {
  const id = await household();
  await asService('update public.profile_preferences set luna_projects = true where profile_id = $1', [id]);
  assert.equal(await revisionOf(id), 2);
  await asService('update public.profile_preferences set luna_projects = true where profile_id = $1', [id]);
  assert.equal(await revisionOf(id), 2);
  await asService('update public.profile_preferences set luna_tasks = true, revision = 7 where profile_id = $1', [id]);
  assert.equal(await revisionOf(id), 7);
});

test('S12: a household with no preferences row has never been shown a revision, and a write makes none', async () => {
  await WRITES['PUT /api/notifications'](BOB, { radon_season: false });
  await WRITES['PATCH /api/profile'](BOB, { home_year: 1990 });
  assert.equal(await revisionOf(BOB), undefined);
});

// ---------------------------------------------------------------------------
// 3. Tenure and renter_mode (Rulings S7 and S13)
// ---------------------------------------------------------------------------

for (const [stored, renterMode, expected] of [
  ['owner', true, 'renter'], ['other', true, 'renter'], ['renter', true, 'renter'], [null, true, null],
  ['renter', false, null], ['owner', false, 'owner'], ['other', false, 'other'], [null, false, null],
]) {
  test(`S13: a household save writing renter_mode ${renterMode} over tenure ${stored} stores ${expected}, in the same row write`, async () => {
    const id = await household({ tenure: stored, renter_mode: stored === 'renter' });
    await WRITES['PUT /api/household'](id, { has_adult: true }, renterMode);
    assert.deepEqual([(await profileOf(id)).tenure, (await profileOf(id)).renter_mode], [expected, renterMode]);
    // The two-step path before 0015 writes the profile on its own: the same.
    const twoStep = await household({ tenure: stored, renter_mode: stored === 'renter' });
    await asService('update public.profiles set renter_mode = $2 where id = $1', [twoStep, renterMode]);
    assert.deepEqual([(await profileOf(twoStep)).tenure, (await profileOf(twoStep)).renter_mode], [expected, renterMode]);
  });
}

test('S13: a new tenure answer sets renter_mode from it, whatever renter_mode the statement carried', async () => {
  const id = await household();
  for (const [tenure, sent, expected] of [['renter', false, true], ['owner', true, false], ['other', true, false], ['renter', null, true]]) {
    const set = sent === null ? 'tenure = $2' : 'tenure = $2, renter_mode = $3';
    await asService(`update public.profiles set ${set} where id = $1`, sent === null ? [id, tenure] : [id, tenure, sent]);
    assert.deepEqual([(await profileOf(id)).tenure, (await profileOf(id)).renter_mode], [tenure, expected], `${tenure} with ${sent}`);
  }
});

test('S13 and review F3: the last writer of the pair wins whole, in either order', async () => {
  // The household save first, then a settings save that saw it: the settings answer stands.
  const first = await household({ tenure: 'owner' });
  await WRITES['PUT /api/household'](first, { has_child: true }, true);
  assert.equal((await profileOf(first)).tenure, 'renter');
  const revision = await revisionOf(first);
  assert.equal((await save(first, revision, { profile: { tenure: 'owner', renter_mode: false } })).saved, true);
  assert.deepEqual([(await profileOf(first)).tenure, (await profileOf(first)).renter_mode], ['owner', false]);
  // The settings save first, then the household save: renter_mode true makes it a renter again.
  const second = await household({ tenure: 'renter', renter_mode: true });
  await save(second, 1, { profile: { tenure: 'owner', renter_mode: false } });
  await WRITES['PUT /api/household'](second, { has_child: true }, true);
  assert.deepEqual([(await profileOf(second)).tenure, (await profileOf(second)).renter_mode], ['renter', true]);
});

// ---------------------------------------------------------------------------
// 4. The route tests' stand-ins agree with the real thing
// ---------------------------------------------------------------------------

/** One script of writes, each described once and run both ways. */
const SCRIPT = [
  { profiles: { home_year: 1990 } },
  { profiles: { home_year: 1990 } },
  { profiles: { renter_mode: true } },
  { profiles: { tenure: 'owner' } },
  { profiles: { renter_mode: false } },
  { profiles: { tenure: 'renter', renter_mode: false } },
  { profiles: { renter_mode: false } },
  { notification_prefs: { radon_season: true } },
  { notification_prefs: { radon_season: false } },
  { notification_prefs: { radon_season: false } },
  { household_bands: { has_child: false } },
  { household_bands: { has_child: true } },
  { profile_preferences: { luna_home: true } },
  { profile_preferences: { luna_home: true } },
  { save: [null, { preferences: { luna_tasks: true }, profile: { tenure: 'other', renter_mode: false }, notifications: { season_summary: false }, bands: { has_teen: true } }] },
  { save: [3, { preferences: { luna_projects: true } }] },
  { save: [null, { profile: { locale: 'es' }, home: { home_year: 2000 } }] },
  // The values already stored: applied, and the revision stays (review finding C).
  { save: [null, { preferences: { luna_tasks: true }, profile: { locale: 'es' }, notifications: { season_summary: false } }] },
];

async function runReal(id) {
  const trace = [];
  for (const step of SCRIPT) {
    const [[table, values]] = Object.entries(step);
    if (table === 'save') {
      const [expected, args] = values;
      const operationId = await ledgerRow(id);
      const result = await save(id, expected ?? await revisionOf(id), { ...args, operationId });
      trace.push({ saved: result.saved, changed: result.changed ?? null, revision: result.revision, settled: (await operationOf(operationId)).status });
    } else if (table === 'profiles' || table === 'profile_preferences') {
      const key = table === 'profiles' ? 'id' : 'profile_id';
      await asService(`update public.${table} set ${Object.keys(values).map((k, i) => `${k} = $${i + 2}`).join(', ')} where ${key} = $1`, [id, ...Object.values(values)]);
    } else {
      await asService(
        `insert into public.${table} (profile_id, ${Object.keys(values).join(', ')}) values ($1, ${Object.keys(values).map((_, i) => `$${i + 2}`).join(', ')})
         on conflict (profile_id) do update set ${Object.keys(values).map((k) => `${k} = excluded.${k}`).join(', ')}`,
        [id, ...Object.values(values)],
      );
    }
    const profile = await profileOf(id);
    trace.push({ revision: await revisionOf(id), tenure: profile.tenure, renter_mode: profile.renter_mode, home_year: profile.home_year, locale: profile.locale });
  }
  return trace;
}

async function runFake(id) {
  const fake = createFakeSupabase({
    tables: haloTables('profiles', 'profile_preferences', 'notification_prefs', 'household_bands', 'home_contexts', 'operations'),
    seed: { profiles: [{ id, home_year: null, water_source: null, tenure: null }], profile_preferences: [{ profile_id: id }] },
  });
  registerHomeContextRpcs(fake);
  registerSaveHousehold(fake);
  installSettingsDb(fake);
  const ok = async (query) => {
    const { error } = await query;
    assert.equal(error, null);
  };
  const row = (table, key) => fake.rows(table).find((r) => r[key] === id);
  const trace = [];
  for (const step of SCRIPT) {
    const [[table, values]] = Object.entries(step);
    if (table === 'save') {
      const [expected, args] = values;
      const operationId = crypto.randomUUID();
      await ok(fake.from('operations').insert({ operation_id: operationId, profile_id: id, domain: 'settings', kind: 'settings.save' }));
      const { data, error } = await fake.rpc('save_settings', {
        p_profile_id: id,
        p_operation_id: operationId,
        p_expected_revision: expected ?? row('profile_preferences', 'profile_id').revision,
        p_preferences: args.preferences ?? {},
        p_profile: args.profile ?? null,
        p_home: args.home ?? null,
        p_notifications: args.notifications ?? null,
        p_bands: args.bands ?? null,
      });
      assert.equal(error, null);
      trace.push({ saved: data.saved, changed: data.changed ?? null, revision: data.revision, settled: fake.rows('operations').find((r) => r.operation_id === operationId).status });
    } else if (table === 'profiles' || table === 'profile_preferences') {
      await ok(fake.from(table).update(values).eq(table === 'profiles' ? 'id' : 'profile_id', id));
    } else {
      await ok(fake.from(table).upsert({ profile_id: id, ...values }, { onConflict: 'profile_id' }));
    }
    const profile = row('profiles', 'id');
    trace.push({ revision: row('profile_preferences', 'profile_id').revision, tenure: profile.tenure ?? null, renter_mode: profile.renter_mode, home_year: profile.home_year ?? null, locale: profile.locale });
  }
  return trace;
}

test('the fake save_settings and triggers give the revision and tenure the real ones give, write by write', async () => {
  const id = await household();
  const real = await runReal(id);
  assert.deepEqual(await runFake(id), real);
  // The script really exercises them: advances, no-ops, reconciles, a conflict and saves.
  assert.ok(real.some((step) => step.saved === false), 'a stale save');
  assert.ok(real.filter((step) => step.saved === true).length >= 2, 'applied saves');
  assert.equal(real.at(-1).locale, 'es');
});
