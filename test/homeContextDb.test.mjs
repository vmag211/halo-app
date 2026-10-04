/**
 * Migration 0016 (home contexts) on a local in-memory PGlite database
 * (test/db/pgliteHarness.mjs) with the reconstructed baseline and every
 * migration. The pure half is test/homeContext.test.mjs.
 *
 * 1. Shape and privileges: the table, its keys and checks, the link from
 *    daily_scores, and who may do what (owners select only; the two functions
 *    are the service role's only).
 * 2. transition_home_context: first onboard, re-submit of the same home, move,
 *    idempotent retry, a stale request id, refusals, and the profile row lock.
 * 3. update_home_context_attributes: revisioned update and its refusals.
 * 4. The database backstops: one current context, unique sequences, and a
 *    reading that can only point at its own household's context.
 * 5. Account deletion still cascades through contexts and readings.
 * 6. The legacy migration and re-running 0016.
 * 7. The JavaScript and SQL "is this a move?" decisions agree, and the
 *    documented read-only check passes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ES modules
import { createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';
import { COORDINATE_CASES } from './helpers/homeContextCases.mjs';

const { toContextAttributes, shouldOpenNewContext, contextSummary } = await import('../lib/homeContext.js');
const { roundCoord } = await import('../lib/geocode.js');
const { HOUSEHOLD_TZ } = await import('../lib/localDate.js');

const MIGRATION = listMigrations().find((migration) => migration.number === 16);
const MIGRATION_0001 = listMigrations().find((migration) => migration.number === 1);
const TRANSITION = 'public.transition_home_context(uuid, jsonb, jsonb, uuid)';
const UPDATE = 'public.update_home_context_attributes(uuid, uuid, integer, jsonb)';
const API_ROLES = ['anon', 'authenticated'];

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const CAROL = 'ca201000-0000-4000-8000-000000000003'; // a profile with no location and no context
const NOBODY = 'dead0000-0000-4000-8000-000000000004'; // an auth user whose profile row is gone
const MISSING = '99999999-9999-4999-8999-999999999999';
const request = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

/** Two homes as the onboard route would describe them (lat and lng as the geocoder gives them). */
const HOME_A = Object.freeze({
  lat: 35.408812, lng: -80.579521, county: 'Cabarrus County', state: 'NC', pwsid: 'NC0125010',
  service_area_status: 'measured', water_source: 'utility', home_year: 1988, match_method: 'mapbox_geocode_arcgis_point',
});
const HOME_B = Object.freeze({
  lat: 35.227121, lng: -80.843133, county: 'Mecklenburg County', state: 'NC', pwsid: 'NC0160010',
  service_area_status: 'measured', water_source: 'well', home_year: 1962, match_method: 'mapbox_geocode_arcgis_point',
});

/** The household's calendar day in SQL, as lib/localDate.js defines it. */
const TODAY = `(now() at time zone '${HOUSEHOLD_TZ}')::date`;

let db;
let bobContextId;

before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values
    ('${ALICE}', true), ('${BOB}', true), ('${CAROL}', true), ('${NOBODY}', true);
    delete from public.profiles where id = '${NOBODY}';`);
  // Bob is onboarded (committed): one current context and one reading for today linked to it.
  await db.asService(
    async (tx) => {
      const { context } = await transition(tx, BOB, HOME_B, request(90));
      bobContextId = context.id;
      await tx.query(
        `insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY}, 163)`,
        [BOB, bobContextId],
      );
    },
    { commit: true },
  );
});

after(async () => {
  await db?.close();
});

/** The JSON text for a jsonb argument; { rawJson } passes text JavaScript could not produce. */
const json = (value) => value?.rawJson ?? (value === null || value === undefined ? null : JSON.stringify(value));

/** transition_home_context with exactly the arguments the route builds (toContextAttributes). */
async function transition(tx, profileId, profileLike, requestId = null) {
  const { location, attributes } = toContextAttributes(profileLike);
  return rawTransition(tx, profileId, location, attributes, requestId);
}

async function rawTransition(tx, profileId, location, attributes, requestId = null) {
  const { rows } = await tx.query('select public.transition_home_context($1, $2::jsonb, $3::jsonb, $4) as result', [
    profileId, json(location), json(attributes), requestId,
  ]);
  return rows[0].result;
}

async function updateAttributes(tx, profileId, contextId, expectedRevision, attributes) {
  const { rows } = await tx.query('select public.update_home_context_attributes($1, $2, $3, $4::jsonb) as result', [
    profileId, contextId, expectedRevision, json(attributes),
  ]);
  return rows[0].result;
}

/** The household's contexts in sequence order, as the database holds them. */
async function contextsOf(tx, profileId) {
  const { rows } = await tx.query('select * from public.home_contexts where profile_id = $1 order by sequence', [profileId]);
  return rows;
}

/** The profiles columns the transition keeps in step, and the row version (xmin changes on every write). */
async function profileOf(tx, profileId) {
  const { rows } = await tx.query(
    `select lat, lng, county, state, pwsid, water_source, home_year, onboard_request_id, zip, xmin::text as version
       from public.profiles where id = $1`,
    [profileId],
  );
  return rows[0] ?? null;
}

/** The household's readings as [date relative to today, context id, aqi], in a stable order. */
async function readingsOf(tx, profileId) {
  const { rows } = await tx.query(
    `select (date - ${TODAY})::int as day, home_context_id, aqi from public.daily_scores where profile_id = $1 order by date, aqi`,
    [profileId],
  );
  return rows.map((row) => [row.day, row.home_context_id, row.aqi]);
}

/** Inserts readings: [day offset from today, context id or null, aqi]. */
async function addReadings(tx, profileId, readings) {
  for (const [day, contextId, aqi] of readings) {
    await tx.query(
      `insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY} + $3::int, $4)`,
      [profileId, contextId, day, aqi],
    );
  }
}

/** Runs `call` in a savepoint: { result } or { error } (rolled back to the savepoint). */
async function attempt(tx, call) {
  await tx.exec('savepoint attempt');
  try {
    const result = await call();
    await tx.exec('release savepoint attempt');
    return { result };
  } catch (error) {
    await tx.exec('rollback to savepoint attempt');
    return { error };
  }
}

/** The stable part of a HALO_* refusal: SQLSTATE and message. */
const refusal = (outcome) => (outcome.error ? { code: outcome.error.code, message: outcome.error.message } : { result: outcome.result });
const HALO = (message) => ({ code: 'P0001', message });

/** Runs fn as the service role in a transaction that is rolled back. */
const asService = (fn) => db.asService(fn);

/** The modes of the locks this transaction holds on public.profiles. */
async function profileLocks(tx) {
  const { rows } = await tx.query(
    `select mode from pg_locks where relation = 'public.profiles'::regclass and pid = pg_backend_pid() order by mode`,
  );
  return rows.map((row) => row.mode);
}

// ---------------------------------------------------------------------------
// 1. Shape and privileges
// ---------------------------------------------------------------------------

test('home_contexts has the columns, types, defaults and nullability the brief fixes', async () => {
  const { rows } = await db.query(
    `select column_name as name, data_type as type, is_nullable = 'YES' as nullable, column_default as "default"
       from information_schema.columns where table_schema = 'public' and table_name = 'home_contexts' order by ordinal_position`,
  );
  assert.deepEqual(rows.map((row) => [row.name, row.type, row.nullable, row.default]), [
    ['id', 'uuid', false, 'gen_random_uuid()'],
    ['profile_id', 'uuid', false, null],
    ['sequence', 'integer', false, null],
    ['revision', 'integer', false, '1'],
    ['origin', 'text', false, null],
    ['lat', 'double precision', true, null],
    ['lng', 'double precision', true, null],
    ['county', 'text', true, null],
    ['state', 'text', true, null],
    ['pwsid', 'text', true, null],
    ['service_area_status', 'text', true, null],
    ['water_source', 'text', true, null],
    ['home_year', 'integer', true, null],
    ['match_method', 'text', true, null],
    ['onboard_request_id', 'uuid', true, null],
    ['backfill_state', 'text', false, "'not_started'::text"],
    ['backfill_from', 'date', true, null],
    ['backfill_to', 'date', true, null],
    ['backfill_updated_at', 'timestamp with time zone', true, null],
    ['effective_from', 'timestamp with time zone', false, 'now()'],
    ['effective_to', 'timestamp with time zone', true, null],
    ['closed_reason', 'text', true, null],
    ['created_at', 'timestamp with time zone', false, 'now()'],
    ['updated_at', 'timestamp with time zone', false, 'now()'],
  ]);
});

test('home_contexts keys: one current context per household, unique sequences, (profile_id, id) for ownership links, and the checks', async () => {
  const { rows: constraints } = await db.query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.home_contexts'::regclass and contype <> 'n' order by conname`,
  );
  assert.deepEqual(Object.fromEntries(constraints.map((row) => [row.conname, row.def])), {
    home_contexts_backfill_state_check:
      "CHECK ((backfill_state = ANY (ARRAY['not_started'::text, 'running'::text, 'complete'::text, 'partial'::text, 'failed'::text, 'not_applicable'::text])))",
    home_contexts_closed_reason_check: "CHECK ((closed_reason = 'moved'::text))",
    home_contexts_origin_check: "CHECK ((origin = ANY (ARRAY['onboard'::text, 'move'::text, 'legacy_migration'::text])))",
    home_contexts_pkey: 'PRIMARY KEY (id)',
    home_contexts_profile_id_fkey: 'FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE',
    home_contexts_profile_id_id_key: 'UNIQUE (profile_id, id)',
    home_contexts_profile_id_sequence_key: 'UNIQUE (profile_id, sequence)',
  });
  const { rows: [current] } = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'home_contexts_one_current'`);
  assert.equal(current.indexdef, 'CREATE UNIQUE INDEX home_contexts_one_current ON public.home_contexts USING btree (profile_id) WHERE (effective_to IS NULL)');
});

test('daily_scores.home_context_id is a nullable uuid; its composite foreign key is NO ACTION and an index covers it', async () => {
  const { rows: [column] } = await db.query(
    `select data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'daily_scores' and column_name = 'home_context_id'`,
  );
  assert.deepEqual(column, { data_type: 'uuid', is_nullable: 'YES' });
  const { rows: [key] } = await db.query(
    `select pg_get_constraintdef(oid) as def, confmatchtype, confdeltype from pg_constraint where conname = 'daily_scores_home_context_fkey'`,
  );
  assert.deepEqual(key, {
    def: 'FOREIGN KEY (profile_id, home_context_id) REFERENCES home_contexts(profile_id, id)',
    confmatchtype: 's', // MATCH SIMPLE: a NULL home_context_id is not checked
    confdeltype: 'a', // NO ACTION
  });
  const { rows: [index] } = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'daily_scores_profile_context_date'`);
  assert.equal(index.indexdef, 'CREATE INDEX daily_scores_profile_context_date ON public.daily_scores USING btree (profile_id, home_context_id, date)');
});

test('both functions return jsonb, run as their caller with search_path pinned to public, and only the service role may execute them', async () => {
  for (const [signature, args] of [
    [TRANSITION, ['p_profile_id', 'p_location', 'p_attributes', 'p_request_id']],
    [UPDATE, ['p_profile_id', 'p_context_id', 'p_expected_revision', 'p_attributes']],
  ]) {
    const { rows: [fn] } = await db.query(
      `select p.prorettype::regtype::text as returns, p.prosecdef, p.proconfig, p.proargnames,
              p.proacl is not null as explicit,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false) as public_execute,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
         from pg_proc p where p.oid = $1::regprocedure`,
      [signature],
    );
    assert.deepEqual(fn, {
      returns: 'jsonb', prosecdef: false, proconfig: ['search_path=public'], proargnames: args,
      explicit: true, public_execute: false, anon: false, authenticated: false, service_role: true,
    }, signature);
  }
});

test('called as anon or as a signed-in user, either function is refused before it touches anything', async () => {
  const { location, attributes } = toContextAttributes(HOME_A);
  for (const [role, userId] of [['anon', null], ['authenticated', ALICE]]) {
    await assert.rejects(
      db.asRole(role, userId, (tx) => rawTransition(tx, ALICE, location, attributes, request(1))),
      /permission denied for function transition_home_context/,
      role,
    );
    await assert.rejects(
      db.asRole(role, userId, (tx) => updateAttributes(tx, BOB, bobContextId, 1, { water_source: 'utility' })),
      /permission denied for function update_home_context_attributes/,
      role,
    );
  }
  assert.deepEqual(await asService((tx) => contextsOf(tx, ALICE)), []);
  assert.equal((await asService((tx) => contextsOf(tx, BOB)))[0].water_source, 'well');
});

test('an owner reads only their own contexts, never another household\'s, and anon reads none', async () => {
  const seen = await db.asRole(
    'authenticated',
    ALICE,
    async (tx) => {
      const { rows } = await tx.query('select profile_id from public.home_contexts');
      const { rows: bobs } = await tx.query('select count(*)::int as n from public.home_contexts where profile_id = $1', [BOB]);
      return { profiles: rows.map((row) => row.profile_id), bobs: bobs[0].n };
    },
    { prepare: (tx) => transition(tx, ALICE, HOME_A) }, // alice's context exists only inside this transaction
  );
  assert.deepEqual(seen, { profiles: [ALICE], bobs: 0 });
  const bobSees = await db.asRole('authenticated', BOB, async (tx) => (await tx.query('select id from public.home_contexts')).rows);
  assert.deepEqual(bobSees, [{ id: bobContextId }]);
  await assert.rejects(db.asRole('anon', null, (tx) => tx.query('select * from public.home_contexts')), /permission denied for table home_contexts/);
});

test('no API role may insert, update or delete a context, on the table or on any column; the only policy is the owner select', async () => {
  for (const role of API_ROLES) {
    const { rows: [privileges] } = await db.query(
      `select has_any_column_privilege($1, 'public.home_contexts', 'SELECT') as select,
              has_any_column_privilege($1, 'public.home_contexts', 'INSERT') as insert,
              has_any_column_privilege($1, 'public.home_contexts', 'UPDATE') as update,
              has_table_privilege($1, 'public.home_contexts', 'DELETE') as delete,
              has_table_privilege($1, 'public.home_contexts', 'TRUNCATE') as truncate`,
      [role],
    );
    assert.deepEqual(privileges, { select: role === 'authenticated', insert: false, update: false, delete: false, truncate: false }, role);
  }
  const { rows: [service] } = await db.query(
    `select has_table_privilege('service_role', 'public.home_contexts', 'SELECT, INSERT, UPDATE, DELETE') as writes`,
  );
  assert.equal(service.writes, true, 'the service role still writes contexts');

  const attempts = {
    insert: `insert into public.home_contexts (profile_id, sequence, origin) values ('${BOB}', 9, 'onboard')`,
    update: `update public.home_contexts set water_source = water_source where profile_id = '${BOB}'`,
    delete: `delete from public.home_contexts where profile_id = '${BOB}'`,
  };
  for (const [command, statement] of Object.entries(attempts)) {
    await assert.rejects(db.asRole('authenticated', BOB, (tx) => tx.query(statement)), /permission denied for table home_contexts/, `bob ${command} on his own context`);
  }
  const { rows: policies } = await db.query(
    `select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'home_contexts'`,
  );
  assert.deepEqual(policies, [{ policyname: 'home_contexts_select_own', cmd: 'SELECT', roles: ['public'], qual: '(auth.uid() = profile_id)', with_check: null }]);
});

// ---------------------------------------------------------------------------
// 2. transition_home_context
// ---------------------------------------------------------------------------

test('first onboard: with no context, sequence 1 opens (origin onboard, revision 1) and the profile columns follow it', async () => {
  await asService(async (tx) => {
    const result = await transition(tx, ALICE, HOME_A, request(1));
    assert.deepEqual(Object.keys(result).sort(), ['context', 'moved', 'previous_context_id']);
    assert.equal(result.moved, false);
    assert.equal(result.previous_context_id, null);
    const [stored] = await contextsOf(tx, ALICE);
    assert.equal(result.context.id, stored.id);
    assert.deepEqual(
      [stored.sequence, stored.revision, stored.origin, stored.effective_to, stored.closed_reason, stored.backfill_state],
      [1, 1, 'onboard', null, null, 'not_started'],
    );
    assert.deepEqual(
      [stored.lat, stored.lng, stored.county, stored.state, stored.pwsid, stored.service_area_status, stored.water_source, stored.home_year, stored.match_method, stored.onboard_request_id],
      [35.409, -80.58, 'Cabarrus County', 'NC', 'NC0125010', 'measured', 'utility', 1988, 'mapbox_geocode_arcgis_point', request(1)],
    );
    const profile = await profileOf(tx, ALICE);
    assert.deepEqual(
      [profile.lat, profile.lng, profile.county, profile.state, profile.pwsid, profile.water_source, profile.home_year, profile.onboard_request_id, profile.zip],
      [35.409, -80.58, 'Cabarrus County', 'NC', 'NC0125010', 'utility', 1988, request(1), null],
    );
  });
});

test('a household whose profile has no location yet gets its first context the same way, and so does one located before contexts existed', async () => {
  await asService(async (tx) => {
    assert.equal((await profileOf(tx, CAROL)).lat, null);
    const first = await transition(tx, CAROL, HOME_B);
    assert.deepEqual([first.moved, first.context.sequence, first.context.origin], [false, 1, 'onboard']);

    // Alice's profile already has a location (written by the old onboard path) and a reading for today, but no context.
    await tx.query(`update public.profiles set lat = 36.1, lng = -79.8, county = 'Guilford County' where id = $1`, [ALICE]);
    await addReadings(tx, ALICE, [[0, null, 55]]);
    const located = await transition(tx, ALICE, HOME_A);
    assert.deepEqual([located.moved, located.previous_context_id, located.context.sequence, located.context.origin], [false, null, 1, 'onboard']);
    assert.deepEqual(await readingsOf(tx, ALICE), [[0, null, 55]], 'not a move: nothing is deleted or relinked');
  });
});

test('the same rounded point again updates the context in place: revision goes up, id and sequence stay, given attributes change and the rest are kept', async () => {
  await asService(async (tx) => {
    const first = await transition(tx, ALICE, HOME_A, request(1));
    await addReadings(tx, ALICE, [[0, first.context.id, 40]]);
    // A re-submit: the same point to 3 decimals, a new answer for water and a county spelled differently;
    // no pwsid, state, home_year or match_method this time.
    const again = await transition(tx, ALICE, { lat: 35.4091, lng: -80.5801, county: 'Cabarrus', water_source: 'well' }, request(2));
    assert.equal(again.moved, false);
    assert.equal(again.previous_context_id, null);
    const contexts = await contextsOf(tx, ALICE);
    assert.equal(contexts.length, 1);
    const [stored] = contexts;
    assert.deepEqual([stored.id, stored.sequence, stored.revision, stored.origin], [first.context.id, 1, 2, 'onboard']);
    assert.deepEqual(
      [stored.lat, stored.lng, stored.county, stored.state, stored.pwsid, stored.water_source, stored.home_year, stored.match_method, stored.onboard_request_id],
      [35.409, -80.58, 'Cabarrus', 'NC', 'NC0125010', 'well', 1988, 'mapbox_geocode_arcgis_point', request(2)],
    );
    assert.equal(again.context.revision, 2);
    const profile = await profileOf(tx, ALICE);
    assert.deepEqual([profile.county, profile.water_source, profile.home_year, profile.onboard_request_id], ['Cabarrus', 'well', 1988, request(2)]);
    assert.deepEqual(await readingsOf(tx, ALICE), [[0, first.context.id, 40]], 'the same home keeps today\'s reading');

    // No request id keeps the stored one.
    await transition(tx, ALICE, { lat: 35.409, lng: -80.58 });
    const [third] = await contextsOf(tx, ALICE);
    assert.deepEqual([third.revision, third.onboard_request_id], [3, request(2)]);
    assert.equal((await profileOf(tx, ALICE)).onboard_request_id, request(2));
  });
});

test('a move closes the current context and opens the next one; only the closed context\'s reading for today is deleted', async () => {
  await asService(async (tx) => {
    const first = await transition(tx, ALICE, HOME_A, request(1));
    const oldId = first.context.id;
    // Today and yesterday at home A, linked; one of each written before the writers carried a context.
    await addReadings(tx, ALICE, [[-1, oldId, 41], [-1, null, 42], [0, oldId, 43], [0, null, 44]]);
    const bobBefore = await readingsOf(tx, BOB);

    const moved = await transition(tx, ALICE, HOME_B, request(2));
    assert.equal(moved.moved, true);
    assert.equal(moved.previous_context_id, oldId);
    const [closed, opened] = await contextsOf(tx, ALICE);
    assert.deepEqual([closed.id, closed.sequence, closed.closed_reason, closed.revision], [oldId, 1, 'moved', 1]);
    assert.ok(closed.effective_to instanceof Date, 'the old context is closed');
    assert.deepEqual([opened.id, opened.sequence, opened.origin, opened.revision, opened.effective_to], [moved.context.id, 2, 'move', 1, null]);
    assert.equal(opened.effective_from.getTime(), closed.effective_to.getTime(), 'the new stay starts when the old one ends');
    assert.deepEqual([opened.lat, opened.lng, opened.county, opened.onboard_request_id], [35.227, -80.843, 'Mecklenburg County', request(2)]);

    // Yesterday stays and belongs to the old home; today's old-home readings are gone; the new home has none.
    assert.deepEqual(await readingsOf(tx, ALICE), [[-1, oldId, 41], [-1, oldId, 42]]);
    assert.deepEqual(await readingsOf(tx, BOB), bobBefore, 'another household\'s reading for today is untouched');

    const profile = await profileOf(tx, ALICE);
    assert.deepEqual([profile.lat, profile.lng, profile.county, profile.pwsid, profile.water_source, profile.home_year], [35.227, -80.843, 'Mecklenburg County', 'NC0160010', 'well', 1962]);

    // A third home: sequence 3 and the second context closes too.
    const third = await transition(tx, ALICE, { lat: 36.07, lng: -79.79 }, request(3));
    assert.deepEqual([third.moved, third.previous_context_id, third.context.sequence], [true, opened.id, 3]);
    assert.deepEqual((await contextsOf(tx, ALICE)).map((row) => row.effective_to === null), [false, false, true]);
  });
});

test('after a move the new home starts with only what was sent: nothing is carried over from the old home', async () => {
  await asService(async (tx) => {
    await transition(tx, ALICE, HOME_A, request(1));
    const moved = await transition(tx, ALICE, { lat: HOME_B.lat, lng: HOME_B.lng, county: 'Mecklenburg County' }, request(2));
    assert.equal(moved.moved, true);
    const [, opened] = await contextsOf(tx, ALICE);
    assert.deepEqual(
      [opened.state, opened.pwsid, opened.service_area_status, opened.water_source, opened.home_year, opened.match_method],
      [null, null, null, null, null, null],
    );
    const profile = await profileOf(tx, ALICE);
    assert.deepEqual([profile.state, profile.pwsid, profile.water_source, profile.home_year], [null, null, null, null]);
  });
});

test('a failed utility lookup never overwrites a stored utility; at a new home it is recorded as lookup_failed with no utility', async () => {
  await asService(async (tx) => {
    await transition(tx, ALICE, HOME_A);
    // Same home, the lookup failed: the utility and its status stay (even if a pwsid is sent with the failure).
    await transition(tx, ALICE, { lat: HOME_A.lat, lng: HOME_A.lng, service_area_status: 'lookup_failed', pwsid: 'NC0000000' });
    const [same] = await contextsOf(tx, ALICE);
    assert.deepEqual([same.revision, same.pwsid, same.service_area_status], [2, 'NC0125010', 'measured']);
    assert.equal((await profileOf(tx, ALICE)).pwsid, 'NC0125010');

    // A new home, the lookup failed: the old home's utility is not carried over.
    await transition(tx, ALICE, { lat: HOME_B.lat, lng: HOME_B.lng, service_area_status: 'lookup_failed', pwsid: 'NC0000000' });
    const [, opened] = await contextsOf(tx, ALICE);
    assert.deepEqual([opened.pwsid, opened.service_area_status], [null, 'lookup_failed']);
    assert.equal((await profileOf(tx, ALICE)).pwsid, null);

    // "No utility here" is a finding, not a failure: it is stored.
    await transition(tx, ALICE, { lat: HOME_B.lat, lng: HOME_B.lng, service_area_status: 'outside_known_area', pwsid: null });
    const [, found] = await contextsOf(tx, ALICE);
    assert.deepEqual([found.pwsid, found.service_area_status, found.revision], [null, 'outside_known_area', 2]);
  });
});

test('an identical retry returns the current context unchanged: no revision bump, no profile write, no reading deleted', async () => {
  await asService(async (tx) => {
    const first = await transition(tx, ALICE, HOME_A, request(1));
    await addReadings(tx, ALICE, [[0, first.context.id, 40]]);
    const contextBefore = await contextsOf(tx, ALICE);
    const profileBefore = await profileOf(tx, ALICE);

    // The retry carries the same request id; even a different point (a confused client) changes nothing.
    for (const body of [HOME_A, HOME_B, { lat: 1, lng: 1 }]) {
      const retry = await transition(tx, ALICE, body, request(1));
      assert.deepEqual(retry, { context: first.context, moved: false, previous_context_id: null }, JSON.stringify(body));
    }
    assert.deepEqual(await contextsOf(tx, ALICE), contextBefore);
    assert.deepEqual(await profileOf(tx, ALICE), profileBefore, 'the profile row was not rewritten (same xmin)');
    assert.deepEqual(await readingsOf(tx, ALICE), [[0, first.context.id, 40]]);
  });
});

test('a retry whose request id belongs to an earlier, closed context is a new request: the closed context is never reopened', async () => {
  await asService(async (tx) => {
    const atA = await transition(tx, ALICE, HOME_A, request(1));
    const atB = await transition(tx, ALICE, HOME_B, request(2));
    // Request 1 arrives again late, with home A: treated as a new request, so a move to a new (third) context.
    const late = await transition(tx, ALICE, HOME_A, request(1));
    assert.equal(late.moved, true);
    assert.equal(late.previous_context_id, atB.context.id);
    const contexts = await contextsOf(tx, ALICE);
    assert.deepEqual(contexts.map((row) => [row.sequence, row.effective_to === null, row.onboard_request_id]), [
      [1, false, request(1)], [2, false, request(2)], [3, true, request(1)],
    ]);
    assert.notEqual(late.context.id, atA.context.id, 'a new context, not the closed one');
    assert.equal(contexts[0].closed_reason, 'moved');

    // The same request id again now matches the current context: an idempotent retry.
    const retry = await transition(tx, ALICE, HOME_A, request(1));
    assert.deepEqual([retry.moved, retry.context.id, retry.context.revision], [false, late.context.id, 1]);
  });
});

test('a household without a profile row is HALO_PROFILE_NOT_FOUND and nothing is written', async () => {
  await asService(async (tx) => {
    assert.deepEqual(refusal(await attempt(tx, () => transition(tx, NOBODY, HOME_A, request(1)))), HALO('HALO_PROFILE_NOT_FOUND'));
    assert.deepEqual(refusal(await attempt(tx, () => updateAttributes(tx, NOBODY, bobContextId, 1, { water_source: 'well' }))), HALO('HALO_PROFILE_NOT_FOUND'));
    assert.deepEqual(await contextsOf(tx, NOBODY), []);
  });
});

test('bad arguments are HALO_INVALID_INPUT, naming the problem, and write nothing', async () => {
  const good = toContextAttributes(HOME_A);
  const cases = [
    ['no profile id', [null, good.location, good.attributes], /p_profile_id/],
    ['no location', [ALICE, null, good.attributes], /p_location/],
    ['location not an object', [ALICE, [35.4, -80.5], good.attributes], /p_location/],
    ['no lat', [ALICE, { lng: -80.58 }, {}], /lat/],
    ['lat as a string', [ALICE, { lat: '35.409', lng: -80.58 }, {}], /lat/],
    ['lng null', [ALICE, { lat: 35.409, lng: null }, {}], /lng/],
    ['lat out of range', [ALICE, { lat: 91, lng: -80.58 }, {}], /lat/],
    ['lng out of range', [ALICE, { lat: 35.409, lng: -180.5 }, {}], /lng/],
    ['a number too large for double precision', [ALICE, { rawJson: '{"lat": 1e400, "lng": -80.58}' }, {}], /between -90 and 90/],
    ['an unrounded point (more than 3 decimals)', [ALICE, { lat: 35.408812, lng: -80.58 }, {}], /3 decimals/],
    ['an unknown location key', [ALICE, { ...good.location, zip: '28025' }, {}], /zip/],
    ['an attribute in the location', [ALICE, { ...good.location, water_source: 'well' }, {}], /water_source/],
    ['county not a string', [ALICE, { ...good.location, county: 7 }, {}], /county/],
    ['attributes not an object', [ALICE, good.location, 'utility'], /p_attributes/],
    ['an unknown attribute key', [ALICE, good.location, { profile_id: BOB }], /profile_id/],
    ['a location key in the attributes', [ALICE, good.location, { lat: 1 }], /lat/],
    ['home_year not a whole number', [ALICE, good.location, { home_year: 1988.5 }], /home_year/],
    ['home_year as a string', [ALICE, good.location, { home_year: '1988' }], /home_year/],
    ['water_source not a string', [ALICE, good.location, { water_source: true }], /water_source/],
    ['pwsid not a string', [ALICE, good.location, { pwsid: 125010 }], /pwsid/],
  ];
  await asService(async (tx) => {
    await transition(tx, ALICE, HOME_A, request(1));
    const before = { contexts: await contextsOf(tx, ALICE), profile: await profileOf(tx, ALICE) };
    for (const [label, [profileId, location, attributes], detail] of cases) {
      const outcome = await attempt(tx, () => rawTransition(tx, profileId, location, attributes, request(2)));
      assert.deepEqual(refusal(outcome), HALO('HALO_INVALID_INPUT'), label);
      assert.match(outcome.error.detail ?? '', detail, `${label}: the detail names the problem`);
    }
    assert.deepEqual({ contexts: await contextsOf(tx, ALICE), profile: await profileOf(tx, ALICE) }, before);
  });
});

test('both functions lock the household\'s profile row first, so two calls for one household run one after the other', async () => {
  // The in-place path, the retry path and the attribute update take no foreign key lock on profiles,
  // so a row lock (RowShareLock on the table) can only come from the functions' own lock.
  for (const [label, call] of [
    ['transition, same home', (tx) => transition(tx, BOB, HOME_B, request(91))],
    ['transition, idempotent retry', (tx) => transition(tx, BOB, HOME_B, request(90))],
    ['update_home_context_attributes', (tx) => updateAttributes(tx, BOB, bobContextId, 1, { home_year: 1963 })],
  ]) {
    const locks = await asService(async (tx) => {
      assert.deepEqual(await profileLocks(tx), [], 'no lock before the call');
      await call(tx);
      return profileLocks(tx);
    });
    assert.ok(locks.includes('RowShareLock'), `${label}: profiles row lock taken (locks: ${locks.join(', ')})`);
  }
  // PGlite has one connection, so two calls cannot actually race here. The strength is pinned in the source:
  // FOR NO KEY UPDATE conflicts with itself (one call per household at a time); FOR SHARE would not.
  for (const signature of [TRANSITION, UPDATE]) {
    const { rows: [{ body }] } = await db.query('select prosrc as body from pg_proc where oid = $1::regprocedure', [signature]);
    const locksTaken = [...body.matchAll(/from public\.profiles where id = p_profile_id for ([a-z ]+);/g)].map((match) => match[1]);
    assert.deepEqual(locksTaken, ['no key update'], `${signature} locks the profile row once, FOR NO KEY UPDATE`);
    assert.ok(body.indexOf('for no key update') < body.indexOf('from public.home_contexts'), `${signature} locks before it reads a context`);
  }
});

// ---------------------------------------------------------------------------
// 3. update_home_context_attributes
// ---------------------------------------------------------------------------

test('update_home_context_attributes changes water_source and home_year at the expected revision, bumps it and syncs the profile', async () => {
  await asService(async (tx) => {
    const { context } = await transition(tx, ALICE, HOME_A, request(1));
    const updated = await updateAttributes(tx, ALICE, context.id, 1, { water_source: 'well', home_year: 1979 });
    assert.deepEqual(Object.keys(updated), ['context']);
    assert.deepEqual([updated.context.id, updated.context.revision, updated.context.water_source, updated.context.home_year], [context.id, 2, 'well', 1979]);
    const second = await updateAttributes(tx, ALICE, context.id, 2, { home_year: null });
    assert.deepEqual([second.context.revision, second.context.water_source, second.context.home_year], [3, 'well', null]);
    const [stored] = await contextsOf(tx, ALICE);
    assert.deepEqual([stored.revision, stored.lat, stored.lng, stored.pwsid, stored.onboard_request_id], [3, 35.409, -80.58, 'NC0125010', request(1)]);
    const profile = await profileOf(tx, ALICE);
    assert.deepEqual([profile.water_source, profile.home_year, profile.lat], ['well', null, 35.409]);
  });
});

test('a stale revision is HALO_STALE_REVISION with the current revision in the detail, and nothing changes', async () => {
  await asService(async (tx) => {
    const { context } = await transition(tx, ALICE, HOME_A, request(1));
    await updateAttributes(tx, ALICE, context.id, 1, { water_source: 'well' });
    const before = { contexts: await contextsOf(tx, ALICE), profile: await profileOf(tx, ALICE) };
    for (const stale of [1, 3, 0]) {
      const outcome = await attempt(tx, () => updateAttributes(tx, ALICE, context.id, stale, { water_source: 'utility' }));
      assert.deepEqual(refusal(outcome), HALO('HALO_STALE_REVISION'), `expected ${stale}`);
      assert.deepEqual(JSON.parse(outcome.error.detail), { revision: 2 });
    }
    assert.deepEqual({ contexts: await contextsOf(tx, ALICE), profile: await profileOf(tx, ALICE) }, before);
  });
});

test('another household\'s context and a missing one are the same HALO_CONTEXT_NOT_FOUND, and the other household is untouched', async () => {
  await asService(async (tx) => {
    await transition(tx, ALICE, HOME_A, request(1));
    const bobBefore = { contexts: await contextsOf(tx, BOB), profile: await profileOf(tx, BOB) };
    const foreign = await attempt(tx, () => updateAttributes(tx, ALICE, bobContextId, 1, { water_source: 'utility' }));
    const missing = await attempt(tx, () => updateAttributes(tx, ALICE, MISSING, 1, { water_source: 'utility' }));
    assert.deepEqual(refusal(foreign), HALO('HALO_CONTEXT_NOT_FOUND'));
    assert.deepEqual(refusal(missing), refusal(foreign));
    assert.equal(foreign.error.detail ?? null, missing.error.detail ?? null, 'nothing tells the two apart');
    assert.deepEqual({ contexts: await contextsOf(tx, BOB), profile: await profileOf(tx, BOB) }, bobBefore);
  });
});

test('a closed context is HALO_CONTEXT_CLOSED, even at its current revision', async () => {
  await asService(async (tx) => {
    const atA = await transition(tx, ALICE, HOME_A, request(1));
    await transition(tx, ALICE, HOME_B, request(2));
    const outcome = await attempt(tx, () => updateAttributes(tx, ALICE, atA.context.id, 1, { home_year: 1990 }));
    assert.deepEqual(refusal(outcome), HALO('HALO_CONTEXT_CLOSED'));
    assert.equal((await contextsOf(tx, ALICE))[0].home_year, 1988);
  });
});

test('only water_source and home_year change through it; anything else, nothing at all, or no revision is HALO_INVALID_INPUT', async () => {
  await asService(async (tx) => {
    const { context } = await transition(tx, ALICE, HOME_A, request(1));
    const cases = [
      ['a location key', [ALICE, context.id, 1, { lat: 36.1 }], /lat/],
      ['the utility', [ALICE, context.id, 1, { pwsid: 'NC0000000' }], /pwsid/],
      ['an owner key', [ALICE, context.id, 1, { profile_id: BOB }], /profile_id/],
      ['the revision itself', [ALICE, context.id, 1, { revision: 9 }], /revision/],
      ['an empty object', [ALICE, context.id, 1, {}], /p_attributes/],
      ['no attributes', [ALICE, context.id, 1, null], /p_attributes/],
      ['home_year not a whole number', [ALICE, context.id, 1, { home_year: 19.5 }], /home_year/],
      ['water_source not a string', [ALICE, context.id, 1, { water_source: 3 }], /water_source/],
      ['no expected revision', [ALICE, context.id, null, { home_year: 1990 }], /p_expected_revision/],
      ['no context id', [ALICE, null, 1, { home_year: 1990 }], /p_context_id/],
      ['no profile id', [null, context.id, 1, { home_year: 1990 }], /p_profile_id/],
    ];
    const before = await contextsOf(tx, ALICE);
    for (const [label, args, detail] of cases) {
      const outcome = await attempt(tx, () => updateAttributes(tx, ...args));
      assert.deepEqual(refusal(outcome), HALO('HALO_INVALID_INPUT'), label);
      assert.match(outcome.error.detail ?? '', detail, `${label}: the detail names the problem`);
    }
    assert.deepEqual(await contextsOf(tx, ALICE), before);
  });
});

// ---------------------------------------------------------------------------
// 4. Backstops, even for the service role
// ---------------------------------------------------------------------------

test('the partial unique index refuses a second current context and the unique key a repeated sequence', async () => {
  await asService(async (tx) => {
    await transition(tx, ALICE, HOME_A, request(1));
    const secondCurrent = await attempt(tx, () =>
      tx.query(`insert into public.home_contexts (profile_id, sequence, origin, lat, lng) values ($1, 2, 'move', 1, 1)`, [ALICE]));
    assert.equal(secondCurrent.error?.code, '23505');
    assert.match(secondCurrent.error.message, /home_contexts_one_current/);

    const repeated = await attempt(tx, () =>
      tx.query(`insert into public.home_contexts (profile_id, sequence, origin, effective_to, closed_reason) values ($1, 1, 'move', now(), 'moved')`, [ALICE]));
    assert.equal(repeated.error?.code, '23505');
    assert.match(repeated.error.message, /home_contexts_profile_id_sequence_key/);

    // A closed earlier context alongside the current one is fine; another household's sequence 1 is too.
    const closedEarlier = await attempt(tx, () =>
      tx.query(`insert into public.home_contexts (profile_id, sequence, origin, effective_to, closed_reason) values ($1, 0, 'onboard', now(), 'moved')`, [ALICE]));
    assert.equal(closedEarlier.error, undefined);
    assert.equal((await contextsOf(tx, ALICE)).filter((row) => row.effective_to === null).length, 1);
  });
});

test('a reading cannot point at another household\'s context or at one that does not exist; no context at all is allowed', async () => {
  await asService(async (tx) => {
    const { context } = await transition(tx, ALICE, HOME_A, request(1));
    for (const [label, statement, values] of [
      ['insert pointing at bob\'s context', `insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY}, 1)`, [ALICE, bobContextId]],
      ['insert pointing at a missing context', `insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY}, 1)`, [ALICE, MISSING]],
      ['bob\'s reading moved onto alice\'s context', 'update public.daily_scores set home_context_id = $2 where profile_id = $1', [BOB, context.id]],
      ['alice\'s context id on a reading handed to bob', `insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY}, 1)`, [BOB, context.id]],
    ]) {
      const outcome = await attempt(tx, () => tx.query(statement, values));
      assert.equal(outcome.error?.code, '23503', label);
      assert.match(outcome.error.message, /daily_scores_home_context_fkey/, label);
    }
    await addReadings(tx, ALICE, [[0, context.id, 1], [0, null, 2]]);
    assert.deepEqual(await readingsOf(tx, ALICE), [[0, context.id, 1], [0, null, 2]]);
  });
});

// ---------------------------------------------------------------------------
// 5. Account deletion
// ---------------------------------------------------------------------------

/** Which owning key's cascade from profiles fires first: triggers fire in name order, named by OID. */
async function cascadeOrder(target) {
  const { rows } = await target.query(
    `select c.conname from pg_trigger t join pg_constraint c on c.oid = t.tgconstraint
      where t.tgrelid = 'public.profiles'::regclass
        and c.conname in ('daily_scores_profile_id_fkey', 'home_contexts_profile_id_fkey')
      order by t.tgname`,
  );
  return [...new Set(rows.map((row) => row.conname))];
}

test('deleting a household removes its contexts and readings with no foreign key error, whichever cascade fires first', async () => {
  const fresh = await createDb();
  try {
    const orders = [];
    for (const [round, how] of [[1, 'profile'], [2, 'auth user'], [3, 'profile']]) {
      if (round === 2) await fresh.applyMigration(MIGRATION_0001); // re-creates daily_scores' owning key: its cascade now fires last
      orders.push((await cascadeOrder(fresh)).join(' then '));
      await fresh.exec(`insert into auth.users (id) values ('${ALICE}'), ('${BOB}')`);
      await fresh.asService(
        async (tx) => {
          for (const who of [ALICE, BOB]) {
            const atA = await transition(tx, who, HOME_A, request(1));
            await addReadings(tx, who, [[-2, atA.context.id, 1], [-1, null, 2]]);
            const atB = await transition(tx, who, HOME_B, request(2));
            await addReadings(tx, who, [[0, atB.context.id, 3], [0, null, 4]]);
          }
        },
        { commit: true },
      );
      if (how === 'auth user') await fresh.exec(`delete from auth.users where id = '${ALICE}'`);
      else await fresh.exec(`delete from public.profiles where id = '${ALICE}'`);
      const { rows: [left] } = await fresh.query(
        `select (select count(*)::int from public.home_contexts where profile_id = $1) as contexts,
                (select count(*)::int from public.daily_scores where profile_id = $1) as readings,
                (select count(*)::int from public.home_contexts where profile_id = $2) as bob_contexts,
                (select count(*)::int from public.daily_scores where profile_id = $2) as bob_readings`,
        [ALICE, BOB],
      );
      assert.deepEqual(left, { contexts: 0, readings: 0, bob_contexts: 2, bob_readings: 4 }, `round ${round}, deleting the ${how}`);
      await fresh.exec(`delete from auth.users`);
    }
    assert.deepEqual(orders, [
      'daily_scores_profile_id_fkey then home_contexts_profile_id_fkey',
      'home_contexts_profile_id_fkey then daily_scores_profile_id_fkey',
      'home_contexts_profile_id_fkey then daily_scores_profile_id_fkey',
    ], 'both cascade orders were exercised');
  } finally {
    await fresh.close();
  }
});

test('a context that still has readings cannot be deleted on its own (NO ACTION); its readings stay linked', async () => {
  await asService(async (tx) => {
    const atA = await transition(tx, ALICE, HOME_A, request(1));
    await addReadings(tx, ALICE, [[-2, atA.context.id, 1]]);
    const atB = await transition(tx, ALICE, HOME_B, request(2));
    const refused = await attempt(tx, () => tx.query('delete from public.home_contexts where id = $1', [atA.context.id]));
    assert.equal(refused.error?.code, '23503');
    assert.match(refused.error.message, /daily_scores_home_context_fkey/);
    assert.deepEqual(await readingsOf(tx, ALICE), [[-2, atA.context.id, 1]]);
    // Without readings it can be (only the service role or the SQL editor could try).
    await tx.query('delete from public.home_contexts where id = $1', [atB.context.id]);
    assert.deepEqual((await contextsOf(tx, ALICE)).map((row) => row.id), [atA.context.id]);
  });
});

// ---------------------------------------------------------------------------
// 6. The legacy migration, and running 0016 again
// ---------------------------------------------------------------------------

const P1 = 'f1000000-0000-4000-8000-000000000001'; // located, with readings
const P2 = 'f2000000-0000-4000-8000-000000000002'; // located, no readings
const P3 = 'f3000000-0000-4000-8000-000000000003'; // never located

/** A database at 0015 with three households as the old onboard path left them, then 0016 applied. */
async function legacyDatabase() {
  const legacy = await createDb({ upTo: 15 });
  await legacy.exec(`insert into auth.users (id) values ('${P1}'), ('${P2}'), ('${P3}')`);
  await legacy.asService(
    (tx) =>
      tx.exec(`update public.profiles set lat = 35.409, lng = -80.58, county = 'Cabarrus County', state = 'NC',
                 pwsid = 'NC0125010', water_source = 'utility', home_year = 1988,
                 onboard_request_id = '${request(7)}' where id = '${P1}';
               update public.profiles set lat = 35.227, lng = -80.843 where id = '${P2}';
               insert into public.daily_scores (profile_id, date, aqi) values
                 ('${P1}', '2026-09-01', 10), ('${P1}', '2026-09-02', 11), ('${P1}', '2026-09-03', 12);`),
    { commit: true },
  );
  await legacy.applyMigration(MIGRATION);
  return legacy;
}

test('the legacy migration gives every located household one legacy context and links its existing readings', async () => {
  const legacy = await legacyDatabase();
  try {
    const { rows: contexts } = await legacy.query('select * from public.home_contexts order by profile_id');
    assert.deepEqual(contexts.map((row) => row.profile_id), [P1, P2], 'P3 has no location, so no context');
    const [p1, p2] = contexts;
    assert.deepEqual(
      [p1.sequence, p1.revision, p1.origin, p1.match_method, p1.backfill_state, p1.effective_to, p1.closed_reason, p1.service_area_status],
      [1, 1, 'legacy_migration', 'legacy_profile', 'not_applicable', null, null, null],
    );
    assert.deepEqual(
      [p1.lat, p1.lng, p1.county, p1.state, p1.pwsid, p1.water_source, p1.home_year, p1.onboard_request_id],
      [35.409, -80.58, 'Cabarrus County', 'NC', 'NC0125010', 'utility', 1988, request(7)],
    );
    assert.deepEqual([p2.lat, p2.lng, p2.county, p2.origin], [35.227, -80.843, null, 'legacy_migration']);
    const { rows: readings } = await legacy.query('select profile_id, home_context_id from public.daily_scores');
    assert.ok(readings.length === 3 && readings.every((row) => row.home_context_id === p1.id), 'every P1 reading is linked to its legacy context');
  } finally {
    await legacy.close();
  }
});

test('running 0016 again makes no second context and re-points no reading; it only fills in what is still missing', async () => {
  const legacy = await legacyDatabase();
  try {
    const legacyIds = Object.fromEntries((await legacy.query('select profile_id, id from public.home_contexts')).rows.map((row) => [row.profile_id, row.id]));
    await legacy.asService(
      async (tx) => {
        // P1 moves (its legacy context closes), then an old writer stores a reading with no context.
        await transition(tx, P1, HOME_B, request(8));
        await tx.query(`insert into public.daily_scores (profile_id, date, aqi) values ($1, '2026-09-04', 13)`, [P1]);
        // P2 has not moved: an old writer's reading with no context. Its legacy context is current, and a
        // reading linked to another (hand-made, closed) P2 context must not be moved onto the legacy one.
        await tx.query(`insert into public.daily_scores (profile_id, date, aqi) values ($1, '2026-09-04', 20)`, [P2]);
        const { rows: [handMade] } = await tx.query(
          `insert into public.home_contexts (profile_id, sequence, origin, effective_to, closed_reason)
           values ($1, 2, 'move', now(), 'moved') returning id`,
          [P2],
        );
        await tx.query(`insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, '2026-08-01', 21)`, [P2, handMade.id]);
        // P3 is located by the old onboard path after the first run.
        await tx.query(`update public.profiles set lat = 36.07, lng = -79.79 where id = $1`, [P3]);
      },
      { commit: true },
    );
    const readings = async () =>
      (await legacy.query('select profile_id, date::text, aqi, home_context_id from public.daily_scores order by profile_id, date, aqi')).rows;
    const before = await readings();

    await legacy.applyMigration(MIGRATION);
    await legacy.applyMigration(MIGRATION);

    const { rows: contexts } = await legacy.query('select profile_id, sequence, origin, effective_to is null as current from public.home_contexts order by profile_id, sequence');
    assert.deepEqual(contexts, [
      { profile_id: P1, sequence: 1, origin: 'legacy_migration', current: false },
      { profile_id: P1, sequence: 2, origin: 'move', current: true },
      { profile_id: P2, sequence: 1, origin: 'legacy_migration', current: true },
      { profile_id: P2, sequence: 2, origin: 'move', current: false },
      { profile_id: P3, sequence: 1, origin: 'legacy_migration', current: true },
    ]);
    const after = await readings();
    const expected = before.map((row) => (row.profile_id === P2 && row.home_context_id === null ? { ...row, home_context_id: legacyIds[P2] } : row));
    assert.deepEqual(after, expected, 'only P2\'s unlinked reading was linked; P1\'s stays unlinked because its legacy context is closed');
    assert.ok(before.some((row) => row.profile_id === P2 && row.aqi === 21 && row.home_context_id !== null && row.home_context_id !== legacyIds[P2]), 'the linked P2 case is real');
    assert.ok(before.some((row) => row.profile_id === P1 && row.home_context_id === null), 'the P1 case is real');
  } finally {
    await legacy.close();
  }
});

test('re-applying 0016 over itself leaves the schema, the grants and the data exactly as they were', async () => {
  const snapshot = async () => ({
    contexts: (await db.query('select * from public.home_contexts order by id')).rows,
    readings: (await db.query('select * from public.daily_scores order by id')).rows,
  });
  const audit = await runAudit(db);
  const data = await snapshot();
  await db.applyMigration(MIGRATION);
  await db.applyMigration(MIGRATION);
  assert.deepEqual(await runAudit(db), audit);
  assert.deepEqual(await snapshot(), data);
});

// ---------------------------------------------------------------------------
// 7. JavaScript and SQL agree; the documented check passes
// ---------------------------------------------------------------------------

test('transition_home_context and shouldOpenNewContext make the same decision for every coordinate pair', async () => {
  for (const [label, current, next, expected] of COORDINATE_CASES) {
    const decided = await asService(async (tx) => {
      let currentId = null;
      if (current) {
        const { rows } = await tx.query(
          `insert into public.home_contexts (profile_id, sequence, origin, lat, lng) values ($1, 1, 'onboard', $2, $3) returning id`,
          [ALICE, current.lat, current.lng],
        );
        currentId = rows[0].id;
      }
      const result = await transition(tx, ALICE, next);
      return {
        opened: result.context.id !== currentId,
        moved: result.moved,
        stored: [result.context.lat, result.context.lng],
      };
    });
    assert.equal(shouldOpenNewContext(current, next), expected, `${label}: JavaScript`);
    assert.equal(decided.opened, expected, `${label}: SQL`);
    assert.equal(decided.moved, expected && current !== null, `${label}: moved only when a context was closed`);
    // + 0 turns roundCoord's -0 into the 0 that JSON carries.
    assert.deepEqual(decided.stored, [roundCoord(next.lat) + 0, roundCoord(next.lng) + 0], `${label}: the stored point is the one JavaScript rounded`);
  }
});

test('the function takes exactly what toContextAttributes builds and returns a row contextSummary shapes without the owner id', async () => {
  await asService(async (tx) => {
    const { context } = await transition(tx, ALICE, { ...HOME_A, id: ALICE, zip: '28025', onboard_request_id: request(5) }, request(5));
    const summary = contextSummary(context);
    assert.deepEqual(summary.location, { lat: 35.409, lng: -80.58, county: 'Cabarrus County', state: 'NC' });
    assert.deepEqual(
      [summary.sequence, summary.revision, summary.origin, summary.current, summary.pwsid, summary.service_area_status, summary.water_source, summary.home_year, summary.match_method],
      [1, 1, 'onboard', true, 'NC0125010', 'measured', 'utility', 1988, 'mapbox_geocode_arcgis_point'],
    );
    assert.deepEqual(summary.backfill, { state: 'not_started', from: null, to: null, updated_at: null });
    assert.equal(typeof summary.effective_from, 'string');
    const text = JSON.stringify(summary);
    assert.equal(text.includes(ALICE), false);
    assert.equal(text.includes(request(5)), false);
  });
});

test('"today" in the migration is the household\'s day: the time zone is lib/localDate.js\'s', () => {
  const zones = [...MIGRATION.sql.matchAll(/at time zone '([^']+)'/gi)].map((match) => match[1]);
  assert.ok(zones.length > 0, '0016 computes today in a named time zone');
  assert.deepEqual([...new Set(zones)], [HOUSEHOLD_TZ]);
});

/** The read-only check in 0016's header, as Vibhav copies it. */
function verificationQuery() {
  const lines = MIGRATION.sql.split('\n');
  const start = lines.findIndex((line) => /^--\s+select\s*$/.test(line));
  assert.ok(start > 0, '0016 documents a read-only check');
  const query = [];
  for (const line of lines.slice(start)) {
    query.push(line.replace(/^--\s?/, ''));
    if (line.trim().endsWith(';')) break;
  }
  return query.join('\n');
}

test('the read-only check in 0016\'s header passes on the migrated database, and flags a household out of step', async () => {
  const [row] = await db.pg.transaction(async (tx) => {
    await tx.exec('set transaction read only');
    const { rows } = await tx.query(verificationQuery());
    await tx.rollback();
    return rows;
  });
  assert.deepEqual(row, {
    home_contexts_rls_on: true,
    owner_select_policy_only: true,
    no_direct_writes: true,
    functions_service_role_only: true,
    readings_link_checked: true,
    every_located_household_has_a_context: true,
    legacy_readings_linked: true,
    profiles_match_current_context: true,
  });
  // The old onboard path moving bob after 0016 (before the routes call the function) shows up.
  const [drift] = await db.pg.transaction(async (tx) => {
    await tx.query(`update public.profiles set lat = 36.07 where id = $1`, [BOB]);
    const { rows } = await tx.query(verificationQuery());
    await tx.rollback();
    return rows;
  });
  assert.equal(drift.profiles_match_current_context, false);
  assert.equal(drift.home_contexts_rls_on, true);
});
