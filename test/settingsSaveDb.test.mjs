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
import { createDb } from './db/pgliteHarness.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { registerHomeContextRpcs } from './helpers/fakeHomeContext.mjs';
import { registerSaveHousehold } from './helpers/fakeSaveHousehold.mjs';
import { installSettingsDb } from './helpers/fakeSettingsDb.mjs';

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const SIGNATURE = 'public.save_settings(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb)';

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

/** save_settings with named arguments; null for each one left out. */
async function save(id, expected, { preferences = {}, profile = null, home = null, notifications = null, bands = null } = {}) {
  const json = (value) => (value === null ? null : JSON.stringify(value));
  const { rows } = await asService(`select ${SIGNATURE.replace(/\(.*\)/, '')}($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb) as result`, [
    id, expected, json(preferences), json(profile), json(home), json(notifications), json(bands),
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
  assert.equal(result.notifications, null, 'no notification row, and none made');
});

test('a save at a revision that has moved writes nothing and answers the current revision', async () => {
  const id = await household();
  await save(id, 1, { preferences: { luna_tasks: true } });
  const before = await everything(id);
  assert.deepEqual(await save(id, 1, { preferences: { luna_home: true }, profile: { locale: 'es' } }), { saved: false, revision: 2 });
  assert.equal(await everything(id), before);
  assert.deepEqual(await save(BOB, 1), { saved: false, revision: null }, 'no preferences row: nothing to compare against');
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

test('a save that fails after its compare-and-set applies nothing at all', async () => {
  const id = await household({ home_year: 1975 });
  const before = await everything(id);
  // The language is written after the revision, the group's columns and the home details;
  // 'fr' fails profiles_locale_check there.
  const error = await saveError(id, 1, {
    preferences: { display_appearance: 'dark', calendar_linked: true },
    home: { home_year: 1990 },
    profile: { locale: 'fr' },
    bands: { has_child: true },
  });
  assert.equal(error?.code, '23514');
  assert.equal(await everything(id), before, 'not the revision, not the display columns, not the year');
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
  assert.equal(await everything(id), before);
});

test('only the service role may call save_settings', async () => {
  for (const role of ['anon', 'authenticated']) {
    const { rows: [{ allowed }] } = await db.query('select has_function_privilege($1, $2, \'EXECUTE\') as allowed', [role, SIGNATURE]);
    assert.equal(allowed, false, role);
  }
  const { rows: [{ allowed }] } = await db.query('select has_function_privilege(\'service_role\', $1, \'EXECUTE\') as allowed', [SIGNATURE]);
  assert.equal(allowed, true);
});

// ---------------------------------------------------------------------------
// 2. Every writer advances the revision (Ruling S12)
// ---------------------------------------------------------------------------

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
];

async function runReal(id) {
  const trace = [];
  for (const step of SCRIPT) {
    const [[table, values]] = Object.entries(step);
    if (table === 'save') {
      const [expected, args] = values;
      const result = await save(id, expected ?? await revisionOf(id), args);
      trace.push({ saved: result.saved, revision: result.revision });
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
    tables: haloTables('profiles', 'profile_preferences', 'notification_prefs', 'household_bands', 'home_contexts'),
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
      const { data, error } = await fake.rpc('save_settings', {
        p_profile_id: id,
        p_expected_revision: expected ?? row('profile_preferences', 'profile_id').revision,
        p_preferences: args.preferences ?? {},
        p_profile: args.profile ?? null,
        p_home: args.home ?? null,
        p_notifications: args.notifications ?? null,
        p_bands: args.bands ?? null,
      });
      assert.equal(error, null);
      trace.push({ saved: data.saved, revision: data.revision });
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
