/**
 * The home context routes against the real 0016 functions on a local in-memory PGlite database
 * (test/db/pgliteHarness.mjs), the way householdTransaction.test.mjs runs PUT /api/household:
 *
 *   1. POST /api/onboard: a first home, the same home again, then a move, with the real
 *      transition_home_context. The real home_contexts rows, the profile it keeps in step, and
 *      the closed home's reading for today are checked in the database.
 *   2. PATCH /api/home-contexts/[id] at a stale revision: a 409 from the real
 *      update_home_context_attributes, with nothing changed.
 *
 * What is real: every statement of those two functions, committed in PGlite (the migrations
 * applied as written). What is stubbed: the network (Mapbox and ArcGIS answer from the harness's
 * fetch), the rate limiters (always allow), the session (the harness's tokens; their user ids are
 * auth.users rows here), and the fake Supabase client for everything that is not the function
 * call. On the onboard path the function is the only database statement before the answer, so
 * the database checked here is the one the route wrote. The backfill that onboarding queues
 * after the answer is not run here: it uses supabase-js's query builder, which only the fake
 * implements (routesOnboardContext.test.mjs runs it there).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { TRANSITION_HOME_CONTEXT_ARGS, UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS } from './helpers/fakeHomeContext.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { createDb } from './db/pgliteHarness.mjs';

const { HOUSEHOLD_TZ } = await import('../lib/localDate.js');

// The route harness's ids for alice, bob and carol.
const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const CAROL = '00000000-0000-4000-8000-000000000003';
const R1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const R2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const R3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TODAY = `(now() at time zone '${HOUSEHOLD_TZ}')::date`;

const PLACES = {
  '2 Elm Court': { center: [-80.61, 35.41], context: [{ id: 'postcode.1', text: '28027' }, { id: 'district.1', text: 'Cabarrus County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }] },
  '9 Oak Lane': { center: [-80.84313, 35.22712], context: [{ id: 'district.1', text: 'Mecklenburg County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }] },
  '4 Pine Street': { center: [-78.64, 35.78], context: [{ id: 'district.1', text: 'Wake County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }] },
};

let db;

before(async () => {
  db = await createDb();
  // The auth trigger (0001) makes each household's bare profile row.
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true), ('${CAROL}', true);`);
});

after(async () => {
  await db?.close();
});

const json = (value) => (value === null || value === undefined ? null : JSON.stringify(value));

/** Runs `sql` as the service role and commits, as PostgREST does with the service key; a Postgres error comes back as PostgREST passes it on. */
async function asServiceCall(sql, params) {
  try {
    return await db.asService(async (tx) => (await tx.query(sql, params)).rows[0].result, { commit: true });
  } catch (error) {
    throw rpcError(error.code, error.message, error.detail ?? null);
  }
}

/** A route harness whose two home context functions are the real ones in this database. */
function harnessOnDatabase() {
  const h = createRouteHarness({
    tables: haloTables('profiles', 'daily_scores', 'home_contexts'),
    identities: { alice: {}, bob: {}, carol: {} },
    env: { MAPBOX_TOKEN: 'pk.test-token' },
    fetch: async (url) => {
      const target = String(url);
      if (target.startsWith('https://api.mapbox.com/')) {
        const address = decodeURIComponent(target.split('/mapbox.places/')[1].split('.json')[0]);
        return Response.json({ features: PLACES[address] ? [PLACES[address]] : [] });
      }
      if (target.startsWith('https://services.arcgis.com/')) return Response.json({ features: [{ attributes: { PWSID: 'NC0250010' } }] });
      return new Response('{}', { status: 503 });
    },
  });
  assert.deepEqual([h.identities.alice.id, h.identities.bob.id, h.identities.carol.id], [ALICE, BOB, CAROL]);
  h.db.registerRpc(
    'transition_home_context',
    (args) => asServiceCall('select public.transition_home_context($1, $2::jsonb, $3::jsonb, $4) as result', [
      args.p_profile_id, json(args.p_location), json(args.p_attributes), args.p_request_id,
    ]),
    { args: [...TRANSITION_HOME_CONTEXT_ARGS] },
  );
  h.db.registerRpc(
    'update_home_context_attributes',
    (args) => asServiceCall('select public.update_home_context_attributes($1, $2, $3, $4::jsonb) as result', [
      args.p_profile_id, args.p_context_id, args.p_expected_revision, json(args.p_attributes),
    ]),
    { args: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS] },
  );
  return h;
}

async function homes(profileId) {
  const { rows } = await db.query(
    `select id, sequence, revision, origin, lat, lng, county, state, pwsid, service_area_status, water_source, home_year,
            match_method, onboard_request_id, backfill_state, effective_to is null as current, closed_reason,
            effective_from = (select max(effective_to) from public.home_contexts p where p.profile_id = h.profile_id) as starts_where_last_ended
       from public.home_contexts h where profile_id = $1 order by sequence`,
    [profileId],
  );
  return rows;
}

async function profile(profileId) {
  const { rows } = await db.query(
    'select lat, lng, county, state, pwsid, water_source, home_year, onboard_request_id, zip from public.profiles where id = $1',
    [profileId],
  );
  return rows[0];
}

async function readings(profileId) {
  const { rows } = await db.query(
    `select (date - ${TODAY})::int as day, home_context_id, aqi from public.daily_scores where profile_id = $1 order by date, aqi`,
    [profileId],
  );
  return rows;
}

const onboard = async (h, who, body) => {
  const res = await h.call('/api/onboard', 'POST', { as: who, body });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return res.json();
};

/** The fields of the answer's home_context that the database row must equal. */
const fromAnswer = (summary) => ({
  id: summary.id, sequence: summary.sequence, revision: summary.revision, origin: summary.origin, current: summary.current,
  lat: summary.location.lat, lng: summary.location.lng, county: summary.location.county, state: summary.location.state,
  pwsid: summary.pwsid, service_area_status: summary.service_area_status, water_source: summary.water_source,
  home_year: summary.home_year, match_method: summary.match_method, backfill_state: summary.backfill.state,
  closed_reason: summary.closed_reason,
});
const fromRow = (row) => {
  const copy = { ...row };
  delete copy.onboard_request_id;
  delete copy.starts_where_last_ended;
  return copy;
};

test('POST /api/onboard on the real transition_home_context: first home, the same home again, then a move', async () => {
  const h = harnessOnDatabase();

  // Bob onboards too, so his home and reading can be shown to be untouched by alice's.
  const bobHome = (await onboard(h, 'bob', { address: '4 Pine Street', request_id: R3 })).home_context;
  await db.asService((tx) => tx.query(`insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY}, 150)`, [BOB, bobHome.id]), { commit: true });
  const bobBefore = JSON.stringify([await homes(BOB), await profile(BOB), await readings(BOB)]);

  // 1. First home: sequence 1, origin onboard, the profile in step.
  const first = await onboard(h, 'alice', { address: '2 Elm Court', request_id: R1, water_source: 'well', home_year: 1990 });
  assert.equal(first.moved, false);
  let rows = await homes(ALICE);
  assert.equal(rows.length, 1);
  assert.deepEqual(fromRow(rows[0]), fromAnswer(first.home_context));
  assert.deepEqual(
    [rows[0].sequence, rows[0].revision, rows[0].origin, rows[0].current, rows[0].lat, rows[0].lng, rows[0].pwsid, rows[0].service_area_status, rows[0].match_method, rows[0].onboard_request_id],
    [1, 1, 'onboard', true, 35.41, -80.61, 'NC0250010', 'measured', 'mapbox_geocode_arcgis_point', R1],
  );
  assert.deepEqual(await profile(ALICE), {
    lat: 35.41, lng: -80.61, county: 'Cabarrus County', state: 'NC', pwsid: 'NC0250010', water_source: 'well', home_year: 1990, onboard_request_id: R1, zip: null,
  });

  // Readings at the first home: today's and yesterday's linked to it, one from before the link existed.
  const firstId = first.home_context.id;
  await db.asService(async (tx) => {
    await tx.query(`insert into public.daily_scores (profile_id, home_context_id, date, aqi) values ($1, $2, ${TODAY}, 41), ($1, $2, ${TODAY} - 1, 42), ($1, null, ${TODAY} - 2, 43)`, [ALICE, firstId]);
  }, { commit: true });

  // 2. The same home again: in place, revision 2, same id and sequence, the answers already given kept.
  const again = await onboard(h, 'alice', { address: '2 Elm Court', request_id: R2 });
  assert.equal(again.moved, false);
  rows = await homes(ALICE);
  assert.equal(rows.length, 1);
  assert.deepEqual(fromRow(rows[0]), fromAnswer(again.home_context));
  assert.deepEqual([rows[0].id, rows[0].sequence, rows[0].revision, rows[0].water_source, rows[0].home_year, rows[0].onboard_request_id], [firstId, 1, 2, 'well', 1990, R2]);
  assert.deepEqual(await readings(ALICE), [
    { day: -2, home_context_id: null, aqi: 43 },
    { day: -1, home_context_id: firstId, aqi: 42 },
    { day: 0, home_context_id: firstId, aqi: 41 },
  ]);

  // 3. A move: the first home closes, the second opens where it ended, today's old reading goes,
  //    the earlier days stay with the first home (the unlinked one is linked to it now).
  const moved = await onboard(h, 'alice', { address: '9 Oak Lane', request_id: R3 });
  assert.equal(moved.moved, true);
  rows = await homes(ALICE);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].id, rows[0].current, rows[0].closed_reason, rows[0].lat, rows[0].water_source], [firstId, false, 'moved', 35.41, 'well']);
  assert.deepEqual(fromRow(rows[1]), fromAnswer(moved.home_context));
  assert.deepEqual(
    [rows[1].sequence, rows[1].origin, rows[1].current, rows[1].starts_where_last_ended, rows[1].lat, rows[1].lng, rows[1].water_source, rows[1].home_year],
    [2, 'move', true, true, 35.227, -80.843, null, null],
  );
  assert.deepEqual(await profile(ALICE), {
    lat: 35.227, lng: -80.843, county: 'Mecklenburg County', state: 'NC', pwsid: 'NC0250010', water_source: null, home_year: null, onboard_request_id: R3, zip: null,
  });
  assert.deepEqual(await readings(ALICE), [
    { day: -2, home_context_id: firstId, aqi: 43 },
    { day: -1, home_context_id: firstId, aqi: 42 },
  ]);
  assert.equal(JSON.stringify([await homes(BOB), await profile(BOB), await readings(BOB)]), bobBefore);
});

test('PATCH /api/home-contexts/[id] on the real update_home_context_attributes: a stale revision is a 409 with the current one, and nothing changes', async () => {
  const h = harnessOnDatabase();
  const carol = await onboard(h, 'carol', { address: '4 Pine Street', request_id: R1, water_source: 'utility', home_year: 1970 });
  const id = carol.home_context.id;
  const patch = (who, body) => h.call('/api/home-contexts/[id]', 'PATCH', { as: who, url: `/api/home-contexts/${id}`, params: { id }, body });

  // Revision 1 to 2, through the route.
  const saved = await patch('carol', { expected_revision: 1, home_year: 1971 });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).context.revision, 2);
  const before = JSON.stringify([await homes(CAROL), await profile(CAROL)]);

  // A client still holding revision 1.
  const stale = await expectEnvelope(await patch('carol', { expected_revision: 1, water_source: 'well' }), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason', 'revision'] });
  assert.deepEqual([stale.reason, stale.revision], ['stale_revision', 2]);
  assert.equal(JSON.stringify([await homes(CAROL), await profile(CAROL)]), before, 'nothing changed');

  // Another household's id is the same 404 as a missing one, from the real function too.
  const foreign = await expectEnvelope(await patch('alice', { expected_revision: 2, water_source: 'well' }), { status: 404, code: 'not_found' });
  assert.equal(foreign.error, 'We could not find that home.');
  assert.equal(JSON.stringify([await homes(CAROL), await profile(CAROL)]), before);

  // At the current revision it saves, and the profile follows.
  const fresh = await patch('carol', { expected_revision: 2, water_source: 'well' });
  assert.equal(fresh.status, 200);
  const [row] = await homes(CAROL);
  assert.deepEqual([row.revision, row.water_source, row.home_year], [3, 'well', 1971]);
  assert.deepEqual([(await profile(CAROL)).water_source, (await profile(CAROL)).home_year], ['well', 1971]);
});
