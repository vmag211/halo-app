/**
 * The route tests' stand-ins for transition_home_context and
 * update_home_context_attributes (test/helpers/fakeHomeContext.mjs) against the
 * real functions from migration 0016 on a local in-memory PGlite database.
 *
 * Every scenario is a list of steps (calls to either function, and readings
 * written between them). It runs once through the fake Supabase with the
 * stand-ins registered and once through the real functions, and the two must
 * agree on every call's answer (the returned rows, or the SQLSTATE, message and
 * detail of the refusal) and on the final state of home_contexts, the profiles
 * columns the functions keep in step, and daily_scores. Ids are compared by
 * which household and sequence they name; timestamps by whether they are set,
 * and a closed stay's end must be the next stay's start in both.
 *
 * Also: the stand-ins answer PGRST202 like PostgREST when they are not
 * registered or are called with the wrong argument names, they list the same
 * columns as the table, and every statement they run is scoped to the
 * household they were called for.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ES modules
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import { createDb } from './db/pgliteHarness.mjs';
import {
  HOME_CONTEXT_COLUMNS,
  TRANSITION_HOME_CONTEXT_ARGS,
  UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS,
  fullContextRow,
  registerHomeContextRpcs,
} from './helpers/fakeHomeContext.mjs';

const { toContextAttributes } = await import('../lib/homeContext.js');
const { localDate, addDays, HOUSEHOLD_TZ } = await import('../lib/localDate.js');

const ALICE = 'a11ce000-0000-4000-8000-000000000001'; // a profile with no location and no context
const BOB = 'b0b00000-0000-4000-8000-000000000002'; // the same, used as "another household"
const CAROL = 'ca201000-0000-4000-8000-000000000003'; // located by the old onboard route, no context
const NOBODY = 'dead0000-0000-4000-8000-000000000004'; // an auth user whose profile row is gone
const MISSING = '99999999-9999-4999-8999-999999999999';
const WHO = { [ALICE]: 'alice', [BOB]: 'bob', [CAROL]: 'carol', [NOBODY]: 'nobody' };
const HOUSEHOLDS = [ALICE, BOB, CAROL];
const request = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

/** Carol's profile as the old onboard route left it (rounded point, a ZIP from before 0009). */
const CAROL_PROFILE = Object.freeze({
  lat: 35.409, lng: -80.58, county: 'Cabarrus County', state: 'NC', pwsid: 'NC0125010',
  water_source: 'utility', home_year: 1975, onboard_request_id: request(50), zip: '28025',
});
/** Carol's readings, none linked to a context: [day offset from today, aqi]. */
const CAROL_READINGS = [[-2, 40], [-1, 41], [0, 42]];

/** Two homes as the onboard route describes them (lat and lng as the geocoder gives them). */
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
const PROFILE_COLUMNS = ['lat', 'lng', 'county', 'state', 'pwsid', 'water_source', 'home_year', 'onboard_request_id', 'zip'];

let db;

before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values
    ('${ALICE}', true), ('${BOB}', true), ('${CAROL}', true), ('${NOBODY}', true);
    delete from public.profiles where id = '${NOBODY}';`);
  await db.asService(
    async (tx) => {
      const p = CAROL_PROFILE;
      await tx.query(
        `update public.profiles set lat = $2, lng = $3, county = $4, state = $5, pwsid = $6, water_source = $7,
                home_year = $8, onboard_request_id = $9, zip = $10 where id = $1`,
        [CAROL, p.lat, p.lng, p.county, p.state, p.pwsid, p.water_source, p.home_year, p.onboard_request_id, p.zip],
      );
      for (const [day, aqi] of CAROL_READINGS) {
        await tx.query(`insert into public.daily_scores (profile_id, date, aqi) values ($1, ${TODAY} + $2::int, $3)`, [CAROL, day, aqi]);
      }
    },
    { commit: true },
  );
});

after(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// The two runners
// ---------------------------------------------------------------------------

/**
 * Steps:
 *   ['transition', profileId, profileLike, requestId]  arguments built by toContextAttributes, as the routes do
 *   ['rawTransition', profileId, location, attributes, requestId]
 *   ['update', profileId, contextRef, expectedRevision, attributes]
 *   ['reading', profileId, dayOffset, contextRef, aqi]
 *   ['closedContext', profileId, sequence, lat, lng]  a closed context written directly (no function makes
 *                                                      a household whose only context is closed)
 * A contextRef is 'current' (that household's), 'seq:N' (its sequence N), 'bob:current', 'missing',
 * null, or any other string, passed as it is.
 */
function resolveRef(contexts, profileId, ref) {
  if (ref === null) return null;
  if (ref === 'missing') return MISSING;
  const [owner, which] = ref === 'bob:current' ? [BOB, 'current'] : [profileId, ref];
  const mine = contexts.filter((row) => row.profile_id === owner);
  if (which === 'current') return mine.find((row) => row.effective_to === null || row.effective_to === undefined)?.id ?? MISSING;
  const sequence = /^seq:(\d+)$/.exec(which);
  if (sequence) return mine.find((row) => row.sequence === Number(sequence[1]))?.id ?? MISSING;
  return ref;
}

const failure = (error) => ({ error: { code: error.code, message: error.message, details: error.detail ?? error.details ?? null } });

/** Whole days from today to a date (a 'YYYY-MM-DD' string or a Date at midnight UTC). */
function dayOffset(date, today) {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

async function runOnDatabase(steps) {
  return db.asService(async (tx) => {
    const contexts = async () => (await tx.query('select * from public.home_contexts order by profile_id, sequence')).rows;
    const outcomes = [];
    for (const step of steps) {
      const [kind, profileId] = step;
      await tx.exec('savepoint step');
      try {
        if (kind === 'reading') {
          const [, , day, ref, aqi] = step;
          const contextId = resolveRef(await contexts(), profileId, ref);
          await tx.query(
            `insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY} + $3::int, $4)`,
            [profileId, contextId, day, aqi],
          );
          outcomes.push({ ok: true });
        } else if (kind === 'closedContext') {
          const [, , sequence, lat, lng] = step;
          await tx.query(
            `insert into public.home_contexts (profile_id, sequence, origin, lat, lng, effective_to, closed_reason)
             values ($1, $2, 'onboard', $3, $4, now(), 'moved')`,
            [profileId, sequence, lat, lng],
          );
          outcomes.push({ ok: true });
        } else if (kind === 'update') {
          const [, , ref, revision, attributes] = step;
          const contextId = resolveRef(await contexts(), profileId, ref);
          const { rows } = await tx.query('select public.update_home_context_attributes($1, $2, $3, $4::jsonb) as result', [
            profileId, contextId, revision, attributes === null ? null : JSON.stringify(attributes),
          ]);
          outcomes.push({ result: rows[0].result });
        } else {
          const { location, attributes, requestId } = transitionArgs(step);
          const { rows } = await tx.query('select public.transition_home_context($1, $2::jsonb, $3::jsonb, $4) as result', [
            profileId,
            location === null ? null : JSON.stringify(location),
            attributes === null ? null : JSON.stringify(attributes),
            requestId,
          ]);
          outcomes.push({ result: rows[0].result });
        }
        await tx.exec('release savepoint step');
      } catch (error) {
        outcomes.push(failure(error));
        await tx.exec('rollback to savepoint step');
      }
    }
    const { rows: profiles } = await tx.query(`select id, ${PROFILE_COLUMNS.join(', ')} from public.profiles`);
    const { rows: readings } = await tx.query(
      `select profile_id, (date - ${TODAY})::int as day, home_context_id, aqi from public.daily_scores`,
    );
    return { outcomes, contexts: await contexts(), profiles, readings };
  });
}

async function runOnStandIn(steps) {
  // One instant for the whole scenario, as now() is one instant in the database's single transaction.
  const at = new Date();
  const today = localDate(at);
  const fake = createFakeSupabase({
    tables: haloTables('profiles', 'home_contexts', 'daily_scores'),
    seed: {
      profiles: [
        { id: ALICE, ...Object.fromEntries(PROFILE_COLUMNS.map((column) => [column, null])) },
        { id: BOB, ...Object.fromEntries(PROFILE_COLUMNS.map((column) => [column, null])) },
        { id: CAROL, ...CAROL_PROFILE },
      ],
      daily_scores: CAROL_READINGS.map(([day, aqi]) => ({ profile_id: CAROL, date: addDays(today, day), aqi, home_context_id: null })),
    },
  });
  registerHomeContextRpcs(fake, { clock: () => at });
  const outcomes = [];
  for (const step of steps) {
    const [kind, profileId] = step;
    if (kind === 'reading') {
      const [, , day, ref, aqi] = step;
      const contextId = resolveRef(fake.rows('home_contexts'), profileId, ref);
      fake.seed('daily_scores', [{ profile_id: profileId, home_context_id: contextId, date: addDays(today, day), aqi }]);
      outcomes.push({ ok: true });
      continue;
    }
    if (kind === 'closedContext') {
      const [, , sequence, lat, lng] = step;
      const now = at.toISOString();
      fake.seed('home_contexts', [fullContextRow({
        id: crypto.randomUUID(), profile_id: profileId, sequence, revision: 1, origin: 'onboard', lat, lng,
        backfill_state: 'not_started', effective_from: now, effective_to: now, closed_reason: 'moved', created_at: now, updated_at: now,
      })]);
      outcomes.push({ ok: true });
      continue;
    }
    let call;
    if (kind === 'update') {
      const [, , ref, revision, attributes] = step;
      call = fake.rpc('update_home_context_attributes', {
        p_profile_id: profileId,
        p_context_id: resolveRef(fake.rows('home_contexts'), profileId, ref),
        p_expected_revision: revision,
        p_attributes: attributes,
      });
    } else {
      const { location, attributes, requestId } = transitionArgs(step);
      call = fake.rpc('transition_home_context', {
        p_profile_id: profileId, p_location: location, p_attributes: attributes, p_request_id: requestId,
      });
    }
    const { data, error } = await call;
    outcomes.push(error ? failure(error) : { result: data });
  }
  return {
    outcomes,
    contexts: fake.rows('home_contexts'),
    profiles: fake.rows('profiles'),
    readings: fake.rows('daily_scores').map((row) => ({ ...row, day: dayOffset(row.date, today) })),
  };
}

function transitionArgs(step) {
  if (step[0] === 'rawTransition') {
    const [, , location, attributes, requestId = null] = step;
    return { location, attributes, requestId };
  }
  const [, , profileLike, requestId = null] = step;
  return { ...toContextAttributes(profileLike), requestId };
}

// ---------------------------------------------------------------------------
// Comparing the two
// ---------------------------------------------------------------------------

const TIMESTAMPS = new Set(['created_at', 'updated_at', 'effective_from', 'effective_to', 'backfill_updated_at']);
const millis = (value) => (value === null || value === undefined ? null : new Date(value).getTime());

/** Everything the scenario produced, with ids as "<household>#<sequence>" and timestamps as set or null. */
function normalize({ outcomes, contexts, profiles, readings }) {
  const labels = new Map(contexts.map((row) => [row.id, `${WHO[row.profile_id]}#${row.sequence}`]));
  const label = (id) => (id === null || id === undefined ? null : labels.get(id) ?? (id === MISSING ? 'missing' : `unknown:${id}`));

  const context = (row) => {
    const out = { keys: Object.keys(row).sort().join(',') };
    for (const column of HOME_CONTEXT_COLUMNS) {
      const value = row[column] ?? null;
      if (column === 'id') out.id = label(value);
      else if (column === 'profile_id') out.profile_id = WHO[value] ?? value;
      else if (TIMESTAMPS.has(column)) out[column] = value === null ? null : 'set';
      else if (value instanceof Date) out[column] = value.toISOString().slice(0, 10);
      else out[column] = value;
    }
    return out;
  };

  const outcome = (entry) => {
    if (!entry.result) return entry;
    const { context: row, ...rest } = entry.result;
    const out = { keys: Object.keys(entry.result).sort().join(','), context: row ? context(row) : row };
    if ('moved' in rest) out.moved = rest.moved;
    if ('previous_context_id' in rest) out.previous_context_id = label(rest.previous_context_id);
    return { result: out };
  };

  const byHousehold = {};
  for (const id of HOUSEHOLDS) {
    const mine = contexts.filter((row) => row.profile_id === id).sort((a, b) => a.sequence - b.sequence);
    byHousehold[WHO[id]] = {
      contexts: mine.map(context),
      // A closed stay ends at the instant the next one begins.
      contiguous: mine.slice(0, -1).map((row, at) => millis(row.effective_to) === millis(mine[at + 1].effective_from)),
      profile: (() => {
        const row = profiles.find((candidate) => candidate.id === id);
        return row ? Object.fromEntries(PROFILE_COLUMNS.map((column) => [column, row[column] ?? null])) : null;
      })(),
      readings: readings
        .filter((row) => row.profile_id === id)
        .map((row) => [row.day, label(row.home_context_id), row.aqi])
        .sort((a, b) => a[0] - b[0] || a[2] - b[2]),
    };
  }
  return { outcomes: outcomes.map(outcome), households: byHousehold };
}

const SAME_POINT_AS_A = { lat: HOME_A.lat, lng: HOME_A.lng };
const CAROL_POINT = { lat: CAROL_PROFILE.lat, lng: CAROL_PROFILE.lng };

const SCENARIOS = {
  'first onboard of a household with no location': [['transition', ALICE, HOME_A, request(1)]],
  'the same point again updates in place: revision up, given keys written, keys left out kept': [
    ['transition', ALICE, HOME_A, request(1)],
    ['transition', ALICE, { ...SAME_POINT_AS_A, water_source: 'well' }, request(2)],
    ['transition', ALICE, { ...SAME_POINT_AS_A, home_year: null, county: null }, null],
  ],
  'an identical retry returns the current context and changes nothing': [
    ['transition', ALICE, HOME_A, request(1)],
    ['reading', ALICE, 0, 'current', 50],
    ['transition', ALICE, HOME_A, request(1)],
  ],
  'a move closes the old home, opens the next sequence with nothing carried over, links unlinked readings and deletes only the closed home\'s reading for today': [
    ['transition', ALICE, HOME_A, request(1)],
    ['reading', ALICE, -3, null, 39],
    ['reading', ALICE, -1, 'current', 40],
    ['reading', ALICE, 0, 'current', 41],
    ['reading', BOB, 0, null, 99],
    ['transition', ALICE, { lat: HOME_B.lat, lng: HOME_B.lng, county: HOME_B.county }, request(2)],
    ['reading', ALICE, 0, 'current', 60],
    ['reading', ALICE, 0, 'seq:1', 61],
    ['transition', ALICE, HOME_A, request(3)],
  ],
  'a located household with no context: the stored point makes its legacy context and updates it in place': [
    ['transition', CAROL, { ...CAROL_POINT, water_source: 'well', home_year: 1975 }, null],
  ],
  'a located household with no context: a new point closes the legacy context and opens sequence 2': [
    ['transition', CAROL, HOME_B, request(2)],
  ],
  'a located household with no context: a retry of the stored request returns the legacy context': [
    ['transition', CAROL, CAROL_POINT, CAROL_PROFILE.onboard_request_id],
  ],
  'a located household whose only context is closed gets no legacy context: the sequence after the highest opens': [
    ['closedContext', CAROL, 2, 35.0, -80.0],
    ['transition', CAROL, HOME_B, request(2)],
  ],
  'a located household with no context: an attribute update before any transition is not found': [
    ['update', CAROL, 'current', 1, { water_source: 'well' }],
  ],
  'a failed utility lookup keeps the stored utility at the same home, and records none at a new one': [
    ['transition', ALICE, HOME_A, request(1)],
    ['transition', ALICE, { ...HOME_A, service_area_status: 'lookup_failed', pwsid: 'NC0000000' }, request(2)],
    ['transition', ALICE, { ...HOME_B, service_area_status: 'lookup_failed', pwsid: null }, request(3)],
  ],
  'a request id that matches only an earlier, closed context is a new request': [
    ['transition', ALICE, HOME_A, request(1)],
    ['transition', ALICE, HOME_B, request(2)],
    ['transition', ALICE, HOME_A, request(1)],
  ],
  'attribute updates bump the revision, null clears, and the profile follows': [
    ['transition', ALICE, HOME_A, request(1)],
    ['update', ALICE, 'current', 1, { water_source: 'well', home_year: 1979 }],
    ['update', ALICE, 'current', 2, { home_year: null }],
    ['update', ALICE, 'current', 3, { water_source: null }],
  ],
  'a stale revision is refused with the current revision in the detail': [
    ['transition', ALICE, HOME_A, request(1)],
    ['update', ALICE, 'current', 1, { water_source: 'well' }],
    ['update', ALICE, 'current', 1, { water_source: 'utility' }],
    ['update', ALICE, 'current', 3, { water_source: 'utility' }],
    ['update', ALICE, 'current', 0, { home_year: 1990 }],
  ],
  'a closed context is refused even at its current revision': [
    ['transition', ALICE, HOME_A, request(1)],
    ['transition', ALICE, HOME_B, request(2)],
    ['update', ALICE, 'seq:1', 1, { home_year: 1990 }],
  ],
  'another household\'s context and a missing one are the same refusal': [
    ['transition', ALICE, HOME_A, request(1)],
    ['transition', BOB, HOME_B, request(2)],
    ['update', ALICE, 'bob:current', 1, { water_source: 'utility' }],
    ['update', ALICE, 'missing', 1, { water_source: 'utility' }],
  ],
  'a household without a profile row': [
    ['transition', NOBODY, HOME_A, request(1)],
    ['transition', BOB, HOME_B, request(2)],
    ['update', NOBODY, 'bob:current', 1, { water_source: 'well' }],
  ],
  'malformed transition arguments are refused, naming the problem, and write nothing': [
    ['transition', ALICE, HOME_A, request(1)],
    ['rawTransition', null, { lat: 35.409, lng: -80.58 }, {}],
    ['rawTransition', ALICE, null, {}],
    ['rawTransition', ALICE, [35.4, -80.5], {}],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, 'utility'],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58, zip: '28025', apt: '2' }, {}],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, { profile_id: BOB, lat: 1 }],
    ['rawTransition', ALICE, { lng: -80.58 }, {}],
    ['rawTransition', ALICE, { lat: '35.409', lng: -80.58 }, {}],
    ['rawTransition', ALICE, { lat: 35.409, lng: null }, {}],
    ['rawTransition', ALICE, { lat: 91, lng: -80.58 }, {}],
    ['rawTransition', ALICE, { lat: 35.409, lng: -180.5 }, {}],
    ['rawTransition', ALICE, { lat: 35.408812, lng: -80.58 }, {}],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58, county: 7 }, {}],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58, state: false }, {}],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, { pwsid: 125010 }],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, { water_source: true }],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, { match_method: ['x'] }],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, { home_year: 1988.5 }],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, { home_year: '1988' }],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, { home_year: 3000000000 }],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, null, request(9)],
  ],
  'malformed attribute updates are refused, naming the problem, and write nothing': [
    ['transition', ALICE, HOME_A, request(1)],
    ['update', null, 'missing', 1, { home_year: 1990 }],
    ['update', ALICE, null, 1, { home_year: 1990 }],
    ['update', ALICE, 'current', null, { home_year: 1990 }],
    ['update', ALICE, 'current', 1, null],
    ['update', ALICE, 'current', 1, {}],
    ['update', ALICE, 'current', 1, ['well']],
    ['update', ALICE, 'current', 1, { lat: 36.1, revision: 9 }],
    ['update', ALICE, 'current', 1, { pwsid: 'NC0000000' }],
    ['update', ALICE, 'current', 1, { water_source: 3 }],
    ['update', ALICE, 'current', 1, { home_year: 19.5 }],
    ['update', ALICE, 'current', 1, { home_year: '1990' }],
  ],
  'arguments of the wrong type fail before the function runs, as Postgres casts them': [
    ['transition', ALICE, HOME_A, request(1)],
    ['update', ALICE, 'not-a-uuid', 1, { home_year: 1990 }],
    ['update', ALICE, 'current', 1.5, { home_year: 1990 }],
    ['update', ALICE, 'current', 2147483648, { home_year: 1990 }],
    ['rawTransition', ALICE, { lat: 35.409, lng: -80.58 }, {}, 'not-a-request-id'],
    ['rawTransition', 'not-a-household', { lat: 35.409, lng: -80.58 }, {}],
  ],
  'an upper-case request id is the same id': [
    ['transition', ALICE, HOME_A, request(1).toUpperCase()],
    ['transition', ALICE, HOME_A, request(1)],
  ],
};

for (const [label, steps] of Object.entries(SCENARIOS)) {
  test(`the route tests' stand-in matches the real functions: ${label}`, async () => {
    const real = normalize(await runOnDatabase(steps));
    const standIn = normalize(await runOnStandIn(steps));
    assert.deepEqual(standIn, real);
  });
}

// ---------------------------------------------------------------------------
// The stand-ins themselves
// ---------------------------------------------------------------------------

test('the stand-ins list the table\'s columns in table order and the functions\' parameter names', async () => {
  const { rows: columns } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'home_contexts' order by ordinal_position`,
  );
  assert.deepEqual([...HOME_CONTEXT_COLUMNS], columns.map((row) => row.column_name));

  const { rows: functions } = await db.query(
    `select p.proname, p.proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('transition_home_context', 'update_home_context_attributes') order by p.proname`,
  );
  assert.deepEqual(functions, [
    { proname: 'transition_home_context', proargnames: [...TRANSITION_HOME_CONTEXT_ARGS] },
    { proname: 'update_home_context_attributes', proargnames: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS] },
  ]);
});

test('not registered (0016 not applied) both answer PGRST202, and a call with other argument names does too', async () => {
  const bare = createFakeSupabase({ tables: haloTables('profiles', 'home_contexts', 'daily_scores') });
  for (const name of ['transition_home_context', 'update_home_context_attributes']) {
    const { data, error } = await bare.rpc(name, {});
    assert.equal(data, null);
    assert.equal(error.code, 'PGRST202', name);
  }

  const fake = createFakeSupabase({ tables: haloTables('profiles', 'home_contexts', 'daily_scores'), seed: { profiles: [{ id: ALICE }] } });
  registerHomeContextRpcs(fake);
  const { location, attributes } = toContextAttributes(HOME_A);
  const missingRequestId = await fake.rpc('transition_home_context', { p_profile_id: ALICE, p_location: location, p_attributes: attributes });
  assert.equal(missingRequestId.error.code, 'PGRST202', 'p_request_id must be sent, even as null');
  const misnamed = await fake.rpc('update_home_context_attributes', { p_profile_id: ALICE, p_id: MISSING, p_expected_revision: 1, p_attributes: {} });
  assert.equal(misnamed.error.code, 'PGRST202');
  assert.deepEqual(fake.rows('home_contexts'), [], 'nothing was written');
});

test('registerHomeContextRpcs can register just one of the two, so a test can leave the other missing', async () => {
  const fake = createFakeSupabase({ tables: haloTables('profiles', 'home_contexts', 'daily_scores'), seed: { profiles: [{ id: ALICE }] } });
  registerHomeContextRpcs(fake, { update: false });
  const { location, attributes } = toContextAttributes(HOME_A);
  const moved = await fake.rpc('transition_home_context', { p_profile_id: ALICE, p_location: location, p_attributes: attributes, p_request_id: null });
  assert.equal(moved.error, null);
  const update = await fake.rpc('update_home_context_attributes', {
    p_profile_id: ALICE, p_context_id: moved.data.context.id, p_expected_revision: 1, p_attributes: { home_year: 1990 },
  });
  assert.equal(update.error.code, 'PGRST202');
});

test('every statement the stand-ins run on a household\'s tables is scoped to the household they were called for', async () => {
  const today = localDate();
  const fake = createFakeSupabase({
    tables: haloTables('profiles', 'home_contexts', 'daily_scores'),
    seed: {
      profiles: [{ id: ALICE }, { id: BOB, lat: 35.1, lng: -80.6 }, { id: CAROL, ...CAROL_PROFILE }],
      daily_scores: [
        { profile_id: CAROL, date: today, aqi: 42, home_context_id: null },
        { profile_id: BOB, date: today, aqi: 99, home_context_id: null },
      ],
    },
  });
  registerHomeContextRpcs(fake);
  const call = async (name, args) => {
    const from = fake.queryLog.length;
    const { error } = await fake.rpc(name, args);
    assert.ok(fake.queryLog.length > from, `${name} ran statements`);
    auditOwnerScope(fake.queryLog.slice(from), args.p_profile_id, name);
    return error;
  };
  const carol = toContextAttributes({ ...CAROL_PROFILE, water_source: 'well' });
  assert.equal(await call('transition_home_context', { p_profile_id: CAROL, p_location: carol.location, p_attributes: carol.attributes, p_request_id: null }), null);
  const b = toContextAttributes(HOME_B);
  assert.equal(await call('transition_home_context', { p_profile_id: CAROL, p_location: b.location, p_attributes: b.attributes, p_request_id: request(2) }), null);
  const current = fake.rows('home_contexts').find((row) => row.profile_id === CAROL && row.effective_to === null);
  assert.equal(await call('update_home_context_attributes', { p_profile_id: CAROL, p_context_id: current.id, p_expected_revision: 1, p_attributes: { home_year: 1990 } }), null);
  assert.equal((await call('update_home_context_attributes', { p_profile_id: ALICE, p_context_id: current.id, p_expected_revision: 1, p_attributes: { home_year: 1 } })).message, 'HALO_CONTEXT_NOT_FOUND');
  assert.deepEqual(
    fake.rows('daily_scores').filter((row) => row.profile_id === BOB).map((row) => [row.aqi, row.home_context_id]),
    [[99, null]],
    'bob\'s unlinked reading was neither linked nor deleted',
  );
  assert.deepEqual(fake.rows('profiles').find((row) => row.id === BOB), { id: BOB, lat: 35.1, lng: -80.6, renter_mode: false, locale: 'en' });
});

test('the clock option sets "now" and "today" for the stand-ins, so a test can pin the day a move deletes', async () => {
  const at = new Date('2026-03-08T04:30:00Z'); // 23:30 on 7 March in New York
  const fake = createFakeSupabase({
    tables: haloTables('profiles', 'home_contexts', 'daily_scores'),
    seed: { profiles: [{ id: ALICE }] },
  });
  registerHomeContextRpcs(fake, { clock: () => at });
  const a = toContextAttributes(HOME_A);
  const first = await fake.rpc('transition_home_context', { p_profile_id: ALICE, p_location: a.location, p_attributes: a.attributes, p_request_id: null });
  assert.equal(first.data.context.effective_from, at.toISOString());
  fake.seed('daily_scores', [
    { profile_id: ALICE, home_context_id: first.data.context.id, date: '2026-03-07', aqi: 1 },
    { profile_id: ALICE, home_context_id: first.data.context.id, date: '2026-03-08', aqi: 2 },
  ]);
  const b = toContextAttributes(HOME_B);
  await fake.rpc('transition_home_context', { p_profile_id: ALICE, p_location: b.location, p_attributes: b.attributes, p_request_id: null });
  assert.deepEqual(fake.rows('daily_scores').map((row) => row.date), ['2026-03-08'], 'the household\'s today (7 March) was deleted, not the UTC date');
});
