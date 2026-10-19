/**
 * GET /api/profile emits `home_context` (B08 Task 5, Ruling E20) on the isolated harness:
 * synthetic identities, the in-memory database and a fetch that rejects any host.
 *
 * The authority is the frontend in this tree:
 *
 *   the profile read      lib/frontend/stage-api.ts:119-123 over lib/frontend/api.ts:172-176
 *                         (createLiveStageApi().getProfile), run for real through the loader;
 *   the session gate      components/stage/StageSession.tsx:137-140 (isProfileComplete, then
 *                         setProfile), with the real isProfileComplete;
 *   the context id        components/production/ProductionApp.tsx:41-42, transcribed verbatim
 *                         (the two lines are compared with the file at test time);
 *   the runtime           lib/frontend/production/runtime.ts:99-106 (createProductionRuntime),
 *                         run for real;
 *   the declared shape    lib/frontend/types.ts:20, `home_context?: {id, revision?} | null`.
 *
 * Every existing profile test (test/routesProfileHouseholdRead.test.mjs,
 * test/routesProfileWrite.test.mjs) runs unchanged: before 0016 the key is left out, so the
 * legacy answer is exactly as it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { haloTables } from './helpers/tables.mjs';
import { fullContextRow, registerHomeContextRpcs } from './helpers/fakeHomeContext.mjs';
import { loggedText } from './helpers/envelope.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { contextSummary } = await import('@/lib/homeContext');
const { createLiveStageApi } = await loadFrontend('stage-api');
const { isProfileComplete } = await loadFrontend('onboarding');
const { createProductionRuntime } = await loadFrontend('production/runtime');

const ALICE_HOME = 'a11ce000-2222-4000-8000-000000000001';
const ALICE_EARLIER_HOME = 'a11ce000-2222-4000-8000-000000000009';
const BOB_HOME = 'b0b00000-2222-4000-8000-000000000001';
const LEGACY_KEYS = ['household', 'household_set', 'onboarded', 'onboarding_complete', 'profile'];
const ALICE_POINT = { lat: 35.408, lng: -80.579 };

// The b01 HomeContext schema: the summary the PATCH, onboard and the home-context routes answer.
const contract = JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs/backend/contracts/b01.openapi.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b01', components: contract.components });
const homeContextSchema = ajv.compile({ $ref: 'urn:halo:b01#/components/schemas/HomeContext' });

/**
 * Alice with a current home (revision 3) and a closed earlier one, bob with his own home.
 * `context: false` leaves alice located with no home context; `tables` without 'home_contexts'
 * is the database before 0016 (PGRST205).
 */
function harness({ context = true, tables = ['profiles', 'household_bands', 'home_contexts'] } = {}) {
  const h = createRouteHarness({
    tables: haloTables(...tables),
    seed: ({ alice, bob }) => {
      const rows = {
        profiles: [
          { id: alice.id, county: 'Cabarrus County', state: 'NC', zip: '28025', pwsid: 'NC0113010', ...ALICE_POINT, water_source: 'utility', home_year: 1975, renter_mode: false, locale: 'en' },
          { id: bob.id, county: 'Union County', state: 'NC', zip: '28110', pwsid: 'NC0129010', lat: 35.1, lng: -80.6, water_source: 'well', home_year: 2001, renter_mode: true, locale: 'es' },
        ],
        household_bands: [{ profile_id: alice.id, has_adult: true }],
        home_contexts: [
          fullContextRow({
            id: ALICE_EARLIER_HOME, profile_id: alice.id, sequence: 1, revision: 7, origin: 'onboard', lat: 35.227, lng: -80.843,
            county: 'Mecklenburg County', state: 'NC', water_source: 'well', home_year: 1962, backfill_state: 'complete',
            effective_from: '2026-01-01T12:00:00Z', effective_to: '2026-06-01T12:00:00Z', closed_reason: 'moved',
          }),
          ...(context
            ? [fullContextRow({
                id: ALICE_HOME, profile_id: alice.id, sequence: 2, revision: 3, origin: 'move', ...ALICE_POINT, county: 'Cabarrus County', state: 'NC',
                pwsid: 'NC0113010', service_area_status: 'measured', water_source: 'utility', home_year: 1975,
                match_method: 'mapbox_geocode_arcgis_point', backfill_state: 'complete', effective_from: '2026-06-01T12:00:00Z',
              })]
            : []),
          fullContextRow({
            id: BOB_HOME, profile_id: bob.id, sequence: 1, revision: 1, origin: 'onboard', lat: 35.1, lng: -80.6, county: 'Union County',
            state: 'NC', pwsid: 'NC0129010', water_source: 'well', home_year: 2001, backfill_state: 'complete', effective_from: '2026-06-01T12:00:00Z',
          }),
        ],
      };
      return Object.fromEntries(Object.entries(rows).filter(([name]) => tables.includes(name)));
    },
  });
  registerHomeContextRpcs(h.db);
  return h;
}
const get = (h, as = 'alice', options = {}) => h.call('/api/profile', 'GET', { as, ...options });
const read = async (h, as, options) => {
  const res = await get(h, as, options);
  assert.equal(res.status, 200);
  return res.json();
};
const currentRow = (h, id) => h.db.rows('home_contexts').find((row) => row.id === id);

// ---------------------------------------------------------------- the client, run and transcribed

// F: components/production/ProductionApp.tsx:41-42, verbatim (leading space trimmed).
const HOME_ID_LINE = 'const homeId=session.profile?.home_context?.id??session.profile?.profile?.home_context_id??null;';
const REVISION_LINE = 'const currentContextRevision=session.profile?.home_context?.revision??session.profile?.profile?.context_revision;';
// Runs the transcribed client lines exactly as written.
const derive = new Function('session', `${HOME_ID_LINE}\n${REVISION_LINE}\nreturn { homeId, currentContextRevision };`);

test('drift: the transcribed context id lines are still the ones ProductionApp.tsx runs', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'components/production/ProductionApp.tsx'), 'utf8').split('\n').map((line) => line.trim());
  assert.equal(source[40], HOME_ID_LINE, 'ProductionApp.tsx:41 changed; re-transcribe it');
  assert.equal(source[41], REVISION_LINE, 'ProductionApp.tsx:42 changed; re-transcribe it');
  assert.match(readFileSync(path.join(REPO_ROOT, 'lib/frontend/types.ts'), 'utf8').split('\n')[19], /home_context\?: \{ id: string; revision\?: number; \[key: string\]: unknown \} \| null;/);
});

/**
 * The client's own consumption: the live stage API reads GET /api/profile through the harness,
 * the session keeps it only if isProfileComplete, ProductionApp derives the id, and the real
 * runtime is built with it. Returns the client state.
 */
async function clientState(h, as = 'alice') {
  const identity = h.identities[as];
  const auth = {
    async ensureAnonSession() {},
    async getUserId() { return identity.id; },
    async authedFetch(url, init = {}) {
      return h.call(url.split('?')[0], init.method ?? 'GET', { as, url, headers: init.headers });
    },
  };
  const api = createLiveStageApi({ loadAuth: async () => auth });
  const value = await api.getProfile();
  assert.equal(isProfileComplete(value), true, 'StageSession.tsx:137 keeps the profile');
  const session = { profile: value };
  const { homeId, currentContextRevision } = derive(session);
  const runtime = createProductionRuntime({
    active: () => true, writeAllowed: () => true, identityId: identity.id, homeContextId: homeId, contextRevision: currentContextRevision,
    credential: async () => ({ identityId: identity.id, accessToken: identity.token }),
    fetcher: async () => { throw new Error('this test makes no runtime request'); },
  });
  return { profile: value, homeId, currentContextRevision, runtime };
}

test('client: the live profile read gives the runtime the household\'s current home context id and revision', async () => {
  const h = harness();
  const state = await clientState(h);
  assert.equal(state.homeId, ALICE_HOME);
  assert.equal(state.currentContextRevision, 3);
  assert.equal(state.runtime.homeContextId, ALICE_HOME);
  assert.equal(state.runtime.scopeKey, `${h.identities.alice.id}:${ALICE_HOME}:3`);
  const bob = await clientState(h, 'bob');
  assert.equal(bob.runtime.homeContextId, BOB_HOME, 'each household gets its own home');
});

test('client: no current home and no 0016 both give the runtime a null context id', async () => {
  for (const h of [harness({ context: false }), harness({ tables: ['profiles', 'household_bands'] })]) {
    const state = await clientState(h);
    assert.equal(state.homeId, null);
    assert.equal(state.currentContextRevision, undefined);
    assert.equal(state.runtime.homeContextId, null);
    assert.equal(state.runtime.scopeKey, `${h.identities.alice.id}:none:0`);
  }
});

// ---------------------------------------------------------------- the route

test('a located household\'s GET carries its current home: the id, the revision and the PATCH\'s summary shape', async () => {
  const h = harness();
  const body = await read(h);
  assert.deepEqual(Object.keys(body).sort(), [...LEGACY_KEYS, 'home_context'].sort(), 'every old field, plus the home');
  assert.equal(body.home_context.id, ALICE_HOME, 'the current home, never the closed earlier one');
  assert.equal(body.home_context.revision, 3);
  assert.equal(body.home_context.current, true);
  assert.deepEqual(body.home_context, contextSummary(currentRow(h, ALICE_HOME)));
  assert.equal(homeContextSchema(body.home_context), true, ajv.errorsText(homeContextSchema.errors));
  for (const key of ['profile_id', 'onboard_request_id', 'request_id', 'created_at', 'updated_at']) {
    assert.equal(key in body.home_context, false, `${key} is never in the summary`);
  }
  assert.equal('unavailable' in body, false);
  assert.deepEqual([body.profile.county, body.profile.water_source, body.household.has_adult], ['Cabarrus County', 'utility', true], 'the old fields are unchanged');
});

test('the GET\'s home_context equals the PATCH\'s for the same context', async () => {
  const h = harness();
  const patched = await h.call('/api/profile', 'PATCH', { as: 'alice', body: { home_year: 1976 } });
  assert.equal(patched.status, 200);
  const fromPatch = (await patched.json()).home_context;
  assert.equal(fromPatch.revision, 4);
  assert.deepEqual((await read(h)).home_context, fromPatch);
});

test('a household with no current home gets home_context: null', async () => {
  const body = await read(harness({ context: false }));
  assert.equal(Object.hasOwn(body, 'home_context'), true);
  assert.equal(body.home_context, null);
  assert.equal(body.onboarded, true);
});

test('before 0016 the answer is exactly the legacy one: no home_context key, still 200', async () => {
  const h = harness({ tables: ['profiles', 'household_bands'] });
  const body = await read(h);
  assert.deepEqual(Object.keys(body).sort(), LEGACY_KEYS);
  assert.equal(body.profile.county, 'Cabarrus County');
});

test('a context read that fails leaves the key out, answers 200 and logs the request id but no coordinates', async (t) => {
  const failures = {
    thrown: () => { throw new Error('secret database detail'); },
    returned: () => {
      const chain = { select: () => chain, eq: () => chain, is: () => chain, maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) };
      return chain;
    },
  };
  for (const [name, broken] of Object.entries(failures)) {
    const logged = muteConsoleError(t);
    const h = harness();
    const from = h.db.from.bind(h.db);
    h.db.from = (table) => (table === 'home_contexts' ? broken() : from(table));
    const res = await get(h);
    assert.equal(res.status, 200, name);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), LEGACY_KEYS, `${name}: the profile answer as before, without the home`);
    assert.equal(body.profile.county, 'Cabarrus County');
    const text = loggedText(logged);
    assert.ok(text.includes(res.headers.get('x-request-id')), `${name}: the failure is logged with the request id`);
    assert.match(text, /Profile home context read failed/);
    for (const coordinate of [ALICE_POINT.lat, ALICE_POINT.lng]) assert.equal(text.includes(String(coordinate)), false, `${name}: no coordinate in the log`);
    logged.mock.restore();
  }
});

test('ownership: the context read is the caller\'s own, whatever the request names', async () => {
  const h = harness();
  const foreign = await read(h, 'alice', {
    url: `/api/profile?id=${h.identities.bob.id}&profile_id=${h.identities.bob.id}&context=${BOB_HOME}`,
    headers: { 'X-Halo-Home-Context': BOB_HOME },
  });
  assert.equal(foreign.home_context.id, ALICE_HOME);
  assert.equal(JSON.stringify(foreign).includes(BOB_HOME), false, 'bob\'s home never appears');
  const reads = h.db.queryLog.filter((q) => q.table === 'home_contexts');
  assert.equal(reads.length, 1);
  assert.ok(reads[0].filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id), 'owner-scoped');
  assert.equal(reads[0].filters.some((f) => f.column === 'id'), false, 'no id from the request is a filter');
  assert.equal((await read(h, 'bob')).home_context.id, BOB_HOME);
});

test('the account snapshot emits no home id, so the restart effect (ProductionAccountFlows.tsx:21-22) cannot loop', async () => {
  const h = harness();
  const res = await h.call('/api/account', 'GET', { as: 'alice', url: '/api/account?feature=home' });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'feature_unavailable');
  assert.equal('home' in body, false, 'no current home id that could differ from the profile\'s');
});
