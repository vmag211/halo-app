/**
 * public.save_household (migration 0015) on a local in-memory PGlite database
 * (test/db/pgliteHarness.mjs), and PUT /api/household running against it.
 *
 * 1. Shape and privileges: security invoker, search_path pinned to public, and
 *    only the service role may execute it (not anon, not authenticated, not
 *    PUBLIC), even though Supabase's default privileges grant every new
 *    function to the API roles.
 * 2. Behaviour: the composition is replaced (a missing key is false), the
 *    preferences change only when given, the saved state comes back, and a bad
 *    locale, a missing profile or a group that is not a boolean fails the whole
 *    call with nothing written.
 * 3. The route through the real function, and the route tests' stand-in
 *    (test/helpers/fakeSaveHousehold.mjs) against the real function, call by call.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { SAVE_HOUSEHOLD_ARGS, SAVE_HOUSEHOLD_BANDS, registerSaveHousehold } from './helpers/fakeSaveHousehold.mjs';
import { createDb } from './db/pgliteHarness.mjs';

const { BAND_KEYS } = await import('../lib/household.js');

const SIGNATURE = 'public.save_household(uuid, jsonb, boolean, text)';
const ALL_FALSE = Object.fromEntries(BAND_KEYS.map((key) => [key, false]));

// The route harness's ids for alice, bob and carol, so the route can run against this database.
const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const NOBODY = '00000000-0000-4000-8000-000000000003'; // an auth user whose profile row is gone

let db;

before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true), ('${NOBODY}', true);
    delete from public.profiles where id = '${NOBODY}';`);
  await db.asService(
    (tx) => tx.exec(`insert into public.household_bands (profile_id, has_pregnant) values ('${BOB}', true);
      update public.profiles set renter_mode = true, locale = 'es' where id = '${BOB}';`),
    { commit: true },
  );
});

after(async () => {
  await db?.close();
});

/** Calls save_household as the service role (as PostgREST does with the service key) in `tx`. */
async function save(tx, profileId, bands, renterMode = null, locale = null) {
  const { rows } = await tx.query('select public.save_household($1, $2::jsonb, $3, $4) as saved', [
    profileId,
    bands === null ? null : JSON.stringify(bands),
    renterMode,
    locale,
  ]);
  return rows[0].saved;
}

/** The household's stored state: its bands row (or null) and its preferences. */
async function stateOf(tx, profileId) {
  const { rows: bands } = await tx.query('select * from public.household_bands where profile_id = $1', [profileId]);
  const { rows: profile } = await tx.query('select renter_mode, locale from public.profiles where id = $1', [profileId]);
  return { bands: bands[0] ?? null, profile: profile[0] ?? null };
}

/** Runs fn as the service role in a transaction that is rolled back. */
const asService = (fn) => db.asService(fn);

// ---------------------------------------------------------------------------
// Shape and privileges
// ---------------------------------------------------------------------------

test('save_household(uuid, jsonb, boolean, text) returns jsonb, runs as its caller and pins search_path to public', async () => {
  const { rows } = await db.query(
    `select p.oid::regprocedure::text as signature, p.prorettype::regtype::text as returns, p.prosecdef, p.proconfig,
            p.proargnames, p.provolatile
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_household'`,
  );
  assert.equal(rows.length, 1, 'exactly one save_household');
  const [fn] = rows;
  assert.equal(fn.signature, 'save_household(uuid,jsonb,boolean,text)');
  assert.equal(fn.returns, 'jsonb');
  assert.equal(fn.prosecdef, false, 'security invoker, not definer');
  assert.deepEqual(fn.proconfig, ['search_path=public']);
  assert.deepEqual(fn.proargnames, [...SAVE_HOUSEHOLD_ARGS], 'the route and its stand-in name the same parameters');
  assert.equal(fn.provolatile, 'v');
});

test('only the service role may execute it: anon, authenticated and PUBLIC hold no execute grant', async () => {
  const { rows: [acl] } = await db.query(
    `select p.proacl is not null as explicit,
            coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false) as public_execute,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
       from pg_proc p where p.oid = $1::regprocedure`,
    [SIGNATURE],
  );
  // A null proacl would mean the default, which is EXECUTE for PUBLIC.
  assert.deepEqual(acl, { explicit: true, public_execute: false, anon: false, authenticated: false, service_role: true });

  // A role with no grants of its own only has what PUBLIC has.
  const bystander = await db.pg.transaction(async (tx) => {
    await tx.exec('create role halo_test_bystander nologin');
    const { rows } = await tx.query(`select has_function_privilege('halo_test_bystander', $1::regprocedure, 'EXECUTE') as execute`, [SIGNATURE]);
    await tx.rollback();
    return rows[0].execute;
  });
  assert.equal(bystander, false, 'PUBLIC cannot execute save_household');
});

test('called as anon or as a signed-in user it is refused before it touches anything', async () => {
  for (const [role, userId] of [['anon', null], ['authenticated', ALICE]]) {
    await assert.rejects(
      db.asRole(role, userId, (tx) => save(tx, ALICE, { has_child: true })),
      /permission denied for function save_household/,
      role,
    );
  }
  const state = await asService((tx) => stateOf(tx, ALICE));
  assert.equal(state.bands, null);
});

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

test('a first save creates the household row from the seven groups (a missing key is false) and returns the saved state', async () => {
  await asService(async (tx) => {
    const saved = await save(tx, ALICE, { has_child: true, has_respiratory: true }, true, 'es');
    const state = await stateOf(tx, ALICE);
    assert.deepEqual(Object.keys(saved).sort(), ['household', 'locale', 'renter_mode', 'updated_at']);
    assert.deepEqual(saved.household, { ...ALL_FALSE, has_child: true, has_respiratory: true });
    assert.deepEqual(Object.keys(saved.household).sort(), [...BAND_KEYS].sort()); // jsonb keeps its own key order; the route normalizes it
    assert.deepEqual([saved.renter_mode, saved.locale], [true, 'es']);
    assert.equal(new Date(saved.updated_at).getTime(), state.bands.updated_at.getTime());
    assert.deepEqual(BAND_KEYS.filter((key) => state.bands[key]), ['has_child', 'has_respiratory']);
    assert.deepEqual(state.profile, { renter_mode: true, locale: 'es' });
  });
});

test('a later save replaces the composition, and preferences not given are left as they were', async () => {
  await asService(async (tx) => {
    const first = await save(tx, BOB, { has_toddler: true });
    assert.deepEqual(first.household, { ...ALL_FALSE, has_toddler: true }, 'has_pregnant was replaced');
    assert.deepEqual([first.renter_mode, first.locale], [true, 'es'], 'null preferences are not written');

    const renterOnly = await save(tx, BOB, {}, false, null);
    assert.deepEqual([renterOnly.renter_mode, renterOnly.locale], [false, 'es']);
    const localeOnly = await save(tx, BOB, { has_adult: null, has_senior: false }, null, 'en');
    assert.deepEqual([localeOnly.renter_mode, localeOnly.locale], [false, 'en']);
    assert.deepEqual(localeOnly.household, ALL_FALSE, 'JSON null and false are both false');

    const state = await stateOf(tx, BOB);
    assert.deepEqual(BAND_KEYS.filter((key) => state.bands[key]), []);
    assert.equal((await tx.query('select count(*)::int as n from public.household_bands where profile_id = $1', [BOB])).rows[0].n, 1);
  });
});

test('keys other than the seven groups are ignored, including ones that name another household or a column', async () => {
  await asService(async (tx) => {
    const saved = await save(tx, ALICE, { has_child: true, profile_id: BOB, updated_at: '2000-01-01T00:00:00Z', has_pet: true });
    assert.deepEqual(saved.household, { ...ALL_FALSE, has_child: true });
    assert.notEqual(new Date(saved.updated_at).getUTCFullYear(), 2000);
    const bob = await stateOf(tx, BOB);
    assert.deepEqual(BAND_KEYS.filter((key) => bob.bands[key]), ['has_pregnant']);
  });
});

test('atomic: an invalid locale fails the whole call and the composition is exactly as before', async () => {
  // Bob has a row: it is not changed. Alice has none: none is created.
  for (const profileId of [BOB, ALICE]) {
    const result = await asService(async (tx) => {
      const before = await stateOf(tx, profileId);
      await tx.exec('savepoint call');
      let failure = null;
      try {
        await save(tx, profileId, { has_child: true, has_senior: true }, true, 'fr');
      } catch (error) {
        failure = { code: error.code, constraint: error.constraint };
        await tx.exec('rollback to savepoint call');
      }
      return { failure, before, after: await stateOf(tx, profileId) };
    });
    assert.deepEqual(result.failure, { code: '23514', constraint: 'profiles_locale_check' }, profileId);
    assert.deepEqual(result.after, result.before, `${profileId}: bands and preferences unchanged`);
  }
});

test('a household without a profile row is a clear error, not a silent no-op, and nothing is written', async () => {
  await assert.rejects(
    asService((tx) => save(tx, NOBODY, { has_child: true })),
    (error) => error.code === 'P0002' && /save_household: no profile row for this household/.test(error.message),
  );
  await assert.rejects(asService((tx) => save(tx, NOBODY, { has_child: true }, true, 'en')), (error) => error.code === 'P0002');
  assert.equal((await asService((tx) => stateOf(tx, NOBODY))).bands, null);
});

test('a group that is not true, false or null, or bands that are not an object, fail the call with nothing written', async () => {
  for (const [bands, message] of [
    [{ has_child: 'yes' }, /has_child must be true or false/],
    [{ has_senior: 1 }, /has_senior must be true or false/],
    [{ has_teen: { value: true } }, /has_teen must be true or false/],
    [[true], /p_bands must be a JSON object/],
    ['has_child', /p_bands must be a JSON object/],
  ]) {
    await assert.rejects(asService((tx) => save(tx, BOB, bands)), (error) => error.code === '22023' && message.test(error.message), JSON.stringify(bands));
  }
  const state = await asService((tx) => stateOf(tx, BOB));
  assert.deepEqual(BAND_KEYS.filter((key) => state.bands[key]), ['has_pregnant']);
});

test('null bands save an all-false household', async () => {
  await asService(async (tx) => {
    assert.deepEqual((await save(tx, BOB, null)).household, ALL_FALSE);
  });
});

// ---------------------------------------------------------------------------
// The route against the real function
// ---------------------------------------------------------------------------

/** A route harness whose rpc('save_household') runs the real function in this database, committed. */
function harnessOnDatabase() {
  const h = createRouteHarness({ tables: haloTables('profiles', 'household_bands'), identities: { alice: {}, bob: {}, nobody: {} } });
  assert.deepEqual([h.identities.alice.id, h.identities.bob.id, h.identities.nobody.id], [ALICE, BOB, NOBODY]);
  h.db.registerRpc(
    'save_household',
    async (args) => {
      try {
        return await db.asService((tx) => save(tx, args.p_profile_id, args.p_bands, args.p_renter_mode, args.p_locale), { commit: true });
      } catch (error) {
        throw rpcError(error.code, error.message);
      }
    },
    { args: [...SAVE_HOUSEHOLD_ARGS] },
  );
  return h;
}

test('PUT /api/household on the real function: one transaction, transactional: true, and the database holds the answer', async () => {
  const h = harnessOnDatabase();
  try {
    const res = await h.call('/api/household', 'PUT', { as: 'alice', body: { has_toddler: true, has_pet: true, renter_mode: true, locale: 'es', profile_id: BOB } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      household: { ...ALL_FALSE, has_toddler: true },
      household_set: true,
      renter_mode: true,
      locale: 'es',
      transactional: true,
    });
    const state = await asService((tx) => stateOf(tx, ALICE));
    assert.deepEqual(BAND_KEYS.filter((key) => state.bands[key]), ['has_toddler']);
    assert.deepEqual(state.profile, { renter_mode: true, locale: 'es' });
    const bob = await asService((tx) => stateOf(tx, BOB));
    assert.deepEqual(BAND_KEYS.filter((key) => bob.bands[key]), ['has_pregnant']);
  } finally {
    await db.exec(`delete from public.household_bands where profile_id = '${ALICE}';
      update public.profiles set renter_mode = false, locale = 'en' where id = '${ALICE}';`);
  }
});

test('PUT /api/household on the real function for a household whose profile is gone: a 500 envelope and nothing written', async (t) => {
  muteConsoleError(t);
  const h = harnessOnDatabase();
  const res = await h.call('/api/household', 'PUT', { as: 'nobody', body: { has_child: true, locale: 'en' } });
  await expectEnvelope(res, { status: 500, code: 'internal_error' });
  assert.equal((await asService((tx) => stateOf(tx, NOBODY))).bands, null);
});

// ---------------------------------------------------------------------------
// The route tests' stand-in agrees with the real function
// ---------------------------------------------------------------------------

const SCENARIOS = {
  'first save with both preferences': [[ALICE, { has_child: true, has_senior: true }, true, 'es']],
  'replace, then preferences one at a time': [
    [BOB, { has_teen: true }, null, null],
    [BOB, { has_adult: null }, false, null],
    [BOB, {}, null, 'en'],
  ],
  'invalid locale after a good save': [[ALICE, { has_child: true }, null, null], [ALICE, { has_senior: true }, true, 'fr']],
  'no profile row': [[NOBODY, { has_child: true }, null, null]],
  'a group that is not a boolean': [[BOB, { has_child: 'yes' }, null, null]],
  'bands that are not an object': [[BOB, [true], null, null]],
  'null bands': [[BOB, null, null, null]],
  'unknown keys and another household\'s id': [[ALICE, { has_toddler: true, profile_id: BOB, has_pet: true }, null, null]],
};

const outcome = (saved) => ({ household: saved.household, renter_mode: saved.renter_mode, locale: saved.locale });
const failure = (error) => ({ error: error.code });

async function runOnDatabase(calls) {
  return asService(async (tx) => {
    const results = [];
    for (const [profileId, bands, renterMode, locale] of calls) {
      await tx.exec('savepoint call');
      try {
        results.push(outcome(await save(tx, profileId, bands, renterMode, locale)));
        await tx.exec('release savepoint call');
      } catch (error) {
        results.push(failure(error));
        await tx.exec('rollback to savepoint call');
      }
    }
    const states = {};
    for (const id of [ALICE, BOB]) {
      const { bands, profile } = await stateOf(tx, id);
      states[id] = { bands: bands && Object.fromEntries(BAND_KEYS.map((key) => [key, bands[key]])), ...profile };
    }
    return { results, states };
  });
}

async function runOnStandIn(calls) {
  const fake = createFakeSupabase({
    tables: haloTables('profiles', 'household_bands'),
    seed: {
      profiles: [{ id: ALICE }, { id: BOB, renter_mode: true, locale: 'es' }],
      household_bands: [{ profile_id: BOB, has_pregnant: true }],
    },
  });
  registerSaveHousehold(fake);
  const results = [];
  for (const [profileId, bands, renterMode, locale] of calls) {
    const { data, error } = await fake.rpc('save_household', { p_profile_id: profileId, p_bands: bands, p_renter_mode: renterMode, p_locale: locale });
    results.push(error ? failure(error) : outcome(data));
  }
  const states = {};
  for (const id of [ALICE, BOB]) {
    const bands = fake.rows('household_bands').find((row) => row.profile_id === id);
    const profile = fake.rows('profiles').find((row) => row.id === id);
    states[id] = {
      bands: bands ? Object.fromEntries(BAND_KEYS.map((key) => [key, bands[key]])) : null,
      renter_mode: profile.renter_mode,
      locale: profile.locale,
    };
  }
  return { results, states };
}

test('the stand-in lists the same seven groups as lib/household.js', () => {
  assert.deepEqual([...SAVE_HOUSEHOLD_BANDS], BAND_KEYS);
});

for (const [label, calls] of Object.entries(SCENARIOS)) {
  test(`the route tests' stand-in matches the real function: ${label}`, async () => {
    assert.deepEqual(await runOnStandIn(calls), await runOnDatabase(calls));
  });
}
