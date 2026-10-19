/**
 * GET and PATCH /api/settings (B04 plan, Task 2a), and what 0021 does in the
 * database for every other writer of the same values (Rulings S11 to S13):
 * save_settings, the revision triggers and the tenure reconcile, run here by
 * their stand-ins in test/helpers/fakeSettingsDb.mjs and on the real schema in
 * test/settingsSaveDb.test.mjs.
 *
 * The authority for the shape is the frontend, not this file:
 * `validSettingsSnapshot` in lib/frontend/production/preferences-service.ts on
 * origin/codex/october15-review-refinement, transcribed verbatim below (types
 * removed, nothing else changed). ProductionPreferences throws away any read or
 * receipt that fails it, so every 200 here is run through it whole.
 *
 * What the client does with a receipt, also from the frontend
 * (ProductionPreferences.tsx:15, :18): a receipt is applied only when its
 * operationId is the one sent, its status is 'succeeded' and its snapshot is
 * valid, and `hydrate` then parks `unresolvedOperations[0]` as unknown, which
 * locks the whole settings surface. So a success receipt must never list its
 * own operation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { HALO_TABLES, haloTables } from './helpers/tables.mjs';
import { withoutColumn } from './helpers/missingColumn.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { auditOwnerScope, setup } from './helpers/isolationKit.mjs';
import { SETTINGS, PROFILE } from './helpers/isolationSeed.mjs';
import { registerSaveHousehold } from './helpers/fakeSaveHousehold.mjs';
import { registerHomeContextRpcs } from './helpers/fakeHomeContext.mjs';
import { installSettingsDb } from './helpers/fakeSettingsDb.mjs';

const { BAND_KEYS } = await import('../lib/household.js');

// ---------------------------------------------------------------------------
// The frontend validator, verbatim (preferences-service.ts:4-11, settings-preview.ts:2)
// ---------------------------------------------------------------------------

const notificationKinds = ['air_quality_change','weather_advisory','new_water_results','radon_season','season_summary'];
function zone(value){if(typeof value!=='string')return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}
const bool=(value)=>typeof value==='boolean';
function validSettingsSnapshot(value){
 const v=value;if(!v||!Number.isSafeInteger(v.revision)||v.revision<1||!Array.isArray(v.unresolvedOperations)||v.unresolvedOperations.some(id=>typeof id!=='string'||!id)||!v.values?.home||!v.values.quiet||!v.values.notifications||!v.values.luna||!v.display||!v.calendar)return false;
 if(v.display.palette!==undefined&&!['ocean','forest','iris'].includes(v.display.palette))return false;
 const {home,quiet,notifications,luna,language}=v.values;
 return typeof home.year==='string'&&(!home.year||/^\d{4}$/.test(home.year))&&['utility','well','spring','other'].includes(home.water)&&['owner','renter','other'].includes(home.tenure)&&notificationKinds.every(key=>bool(notifications[key]))&&bool(quiet.enabled)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.from)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.to)&&zone(quiet.zone)&&['tasks','home','projects'].every(key=>bool(luna[key]))&&['en','es'].includes(language)&&['system','light','dark'].includes(v.display.appearance)&&['100','115','130','150'].includes(v.display.scale)&&['system','full','reduce'].includes(v.display.motion)&&bool(v.display.contrast)&&bool(v.display.ambient)&&zone(v.calendar.zone)&&bool(v.calendar.streak)&&bool(v.calendar.linked);
}

/** The whole contract for a read, plus the traps the validator cannot see. */
function assertSnapshot(body) {
  assert.equal(validSettingsSnapshot(body), true, `the client would discard this snapshot: ${JSON.stringify(body)}`);
  assert.equal(Object.hasOwn(body, 'data'), false, 'a top-level data key would be unwrapped as an envelope (runtime.ts:149)');
  assert.equal(body.display.palette === null, false, 'palette is omitted, never null');
  assert.equal(JSON.stringify(body).includes('—'), false, 'no em dash');
}

/** The whole contract for a success receipt (ProductionPreferences.tsx:18). */
function assertReceipt(body, operationId) {
  assert.deepEqual(Object.keys(body).sort(), ['operationId', 'snapshot', 'status']);
  assert.equal(body.operationId, operationId);
  assert.equal(body.status, 'succeeded');
  assertSnapshot(body.snapshot);
  assert.equal(body.snapshot.unresolvedOperations.includes(operationId), false, 'a save never lists itself, or hydrate would lock the surface');
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ROUTE = '/api/settings';
let opCount = 0;
const nextOp = () => `5e771265-0000-4000-8000-${(opCount += 1).toString(16).padStart(12, '0')}`;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * alice: a household that has saved settings (revision 4) with every answer given.
 * bob: one that has never opened settings: no preferences row, no notification
 * row, and nothing answered on the profile.
 */
function harness({ tables = HALO_TABLES, alicePrefs = {}, aliceProfile = {}, operations = [], extra = {} } = {}) {
  // Seeding a table declares it, so a table left out of `tables` (a migration not applied) is not seeded either.
  const declared = (rows) => Object.fromEntries(Object.entries(rows).filter(([name]) => Object.hasOwn(tables, name)));
  const h = createRouteHarness({
    ...extra,
    tables,
    seed: ({ alice, bob }) => declared({
      profiles: [
        { id: alice.id, home_year: 1975, water_source: 'well', locale: 'en', renter_mode: false, tenure: 'owner', ...aliceProfile },
        { id: bob.id, home_year: null, water_source: null, locale: 'en', renter_mode: false, tenure: null },
      ],
      profile_preferences: [{ profile_id: alice.id, ...SETTINGS.alice, ...alicePrefs }],
      notification_prefs: [{ profile_id: alice.id, weather_advisory: false }],
      household_bands: [{ profile_id: alice.id, has_adult: true }],
      operations: operations.map((row) => ({
        domain: 'settings', kind: 'settings.save', status: 'pending', created_at: ago(1000), result: null,
        ...row,
        profile_id: row.profile_id === 'bob' ? bob.id : alice.id,
      })),
    }),
  });
  // 0021's save_settings and triggers, when its table is there (test/helpers/fakeSettingsDb.mjs).
  installSettingsDb(h.db);
  return h;
}

/**
 * The owner-scope audit, less the ledger's own settle: lib/operations.js
 * settles a row by its primary key, the operation id this call has just
 * claimed for the caller, which is how every ledger route works.
 */
const auditScope = (queries, callerId, label) =>
  auditOwnerScope(queries.filter((q) => !(q.table === 'operations' && q.operation === 'update')), callerId, label);

/** h.call as `who`, audited. */
async function audited(h, who, route, method, options = {}) {
  const from = h.db.queryLog.length;
  const res = await h.call(route, method, { as: who, ...options });
  auditScope(h.db.queryLog.slice(from), h.identities[who].id, `${who} ${method} ${route}`);
  return res;
}

const read = (h, who = 'alice', options = {}) => h.call(ROUTE, 'GET', { as: who, ...options });
const readBody = async (h, who = 'alice') => {
  const res = await read(h, who);
  assert.equal(res.status, 200);
  const body = await res.json();
  assertSnapshot(body);
  return body;
};

/**
 * A save the way the real client builds it (SettingsWorkspace.tsx:88-90): the
 * whole `values` from the snapshot with only the group's slice edited, plus
 * household for home and display/calendar for display.
 */
function saveBody(snapshot, group, edit = {}, operationId = nextOp()) {
  const values = structuredClone(snapshot.values);
  if (edit.values) edit.values(values);
  const body = { group, values, operationId };
  if (group === 'home') body.household = { ...Object.fromEntries(BAND_KEYS.map((key) => [key, false])), has_adult: true, ...edit.household };
  if (group === 'display') {
    body.display = { ...snapshot.display, ...edit.display };
    body.calendar = { ...snapshot.calendar, ...edit.calendar };
  }
  return body;
}

const patch = (h, body, { who = 'alice', revision, headers = {}, ...options } = {}) =>
  h.call(ROUTE, 'PATCH', {
    as: who,
    body,
    headers: {
      ...(revision === undefined ? {} : { 'if-match': String(revision) }),
      ...(body?.operationId ? { 'idempotency-key': body.operationId } : {}),
      ...headers,
    },
    ...options,
  });

const prefsOf = (h, who = 'alice') => h.db.rows('profile_preferences').find((row) => row.profile_id === h.identities[who].id);
const profileOf = (h, who = 'alice') => h.db.rows('profiles').find((row) => row.id === h.identities[who].id);
const notifOf = (h, who = 'alice') => h.db.rows('notification_prefs').find((row) => row.profile_id === h.identities[who].id);
const bandsOf = (h, who = 'alice') => h.db.rows('household_bands').find((row) => row.profile_id === h.identities[who].id);
const opRow = (h, id) => h.db.rows('operations').find((row) => row.operation_id === id);
const saveCalls = (h) => h.db.rpcCalls.filter((call) => call.name === 'save_settings').map((call) => call.args);
const OWNED = ['profiles', 'profile_preferences', 'notification_prefs', 'household_bands', 'operations'];
const tablesSnapshot = (h) => JSON.stringify(Object.fromEntries(OWNED.filter((t) => { try { h.db.rows(t); return true; } catch { return false; } }).map((t) => [t, h.db.rows(t)])));

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

test('GET: a household with saved settings reads every value from where it lives, at its stored revision', async () => {
  const h = harness();
  const body = await readBody(h);
  const s = SETTINGS.alice;
  assert.deepEqual(body, {
    revision: 4,
    values: {
      home: { year: '1975', water: 'well', tenure: 'owner' },
      notifications: { air_quality_change: true, weather_advisory: false, new_water_results: true, radon_season: true, season_summary: true },
      quiet: { enabled: s.quiet_enabled, from: s.quiet_from, to: s.quiet_to, zone: s.quiet_zone },
      luna: { tasks: s.luna_tasks, home: s.luna_home, projects: s.luna_projects },
      language: 'en',
    },
    display: { appearance: s.display_appearance, ambient: s.display_ambient, scale: s.display_scale, motion: s.display_motion, contrast: s.display_contrast, palette: s.display_palette },
    calendar: { zone: s.calendar_zone, streak: s.calendar_streak, linked: s.calendar_linked },
    unresolvedOperations: [],
  });
});

test('GET: a household that never saved settings gets the defaults at revision 1 (not a 404, not the 0 the client refuses), stored as its row', async () => {
  const h = harness();
  assert.equal(prefsOf(h, 'bob'), undefined);
  const body = await readBody(h, 'bob');
  assert.equal(body.revision, 1);
  // Unanswered is reported as unanswered in the client's words: never 'owner' (Ruling S8),
  // never 'utility' for an unknown water source, and a blank year.
  assert.deepEqual(body.values.home, { year: '', water: 'other', tenure: 'other' });
  assert.deepEqual(body.values.notifications, Object.fromEntries(notificationKinds.map((k) => [k, true])));
  assert.deepEqual(body.values.quiet, { enabled: false, from: '21:00', to: '08:00', zone: 'America/New_York' });
  assert.deepEqual(body.values.luna, { tasks: false, home: false, projects: false });
  assert.deepEqual(body.display, { appearance: 'system', ambient: false, scale: '100', motion: 'system', contrast: false });
  assert.equal(Object.hasOwn(body.display, 'palette'), false, 'no stored palette means no palette key');
  assert.deepEqual(body.calendar, { zone: 'America/New_York', streak: false, linked: false });
  assert.deepEqual(body.unresolvedOperations, []);
  assert.equal(prefsOf(h, 'bob').revision, 1, 'the revision shown is a stored one a save can compare against');
  // Reading again does not create a second row or move the revision.
  assert.equal((await readBody(h, 'bob')).revision, 1);
  assert.equal(h.db.rows('profile_preferences').filter((row) => row.profile_id === h.identities.bob.id).length, 1);
});

test('GET: a household with no profile row still gets a valid snapshot', async () => {
  const h = createRouteHarness({ tables: HALO_TABLES, identities: { carol: {} } });
  const body = await readBody(h, 'carol');
  assert.deepEqual(body.values.home, { year: '', water: 'other', tenure: 'other' });
  assert.equal(body.values.language, 'en');
});

test('GET: unresolvedOperations is a lock, so it lists only this household\'s pending settings operations', async () => {
  const PENDING = '5e771265-aaaa-4000-8000-000000000001';
  const STALE = '5e771265-aaaa-4000-8000-000000000002';
  const h = harness({
    operations: [
      { operation_id: PENDING },
      // Past the ledger's window: the reaper in lib/operations.js settles it as failed
      // (abandoned) when the inventory is read, so it is no longer a lock.
      { operation_id: STALE, created_at: ago(10 * 60 * 1000) },
      { operation_id: '5e771265-aaaa-4000-8000-000000000003', status: 'succeeded', result: { status: 'succeeded' } },
      { operation_id: '5e771265-aaaa-4000-8000-000000000004', status: 'failed' },
      { operation_id: '5e771265-aaaa-4000-8000-000000000005', domain: 'alerts', kind: 'alerts.update' },
      { operation_id: '5e771265-aaaa-4000-8000-000000000006', profile_id: 'bob' },
    ],
  });
  const body = await readBody(h);
  assert.deepEqual(body.unresolvedOperations, [PENDING]);
  assert.deepEqual([opRow(h, STALE).status, opRow(h, STALE).result?.reason], ['failed', 'abandoned']);
  assert.deepEqual((await readBody(h, 'bob')).unresolvedOperations, ['5e771265-aaaa-4000-8000-000000000006']);
});

test('GET: palette, scale, motion and zones come back as the strings the client accepts', async () => {
  const h = harness({ alicePrefs: { display_palette: null, display_scale: '150', display_motion: 'full', quiet_zone: 'Pacific/Honolulu', calendar_zone: 'UTC' } });
  const body = await readBody(h);
  assert.equal(Object.hasOwn(body.display, 'palette'), false);
  assert.equal(body.display.scale, '150');
  assert.equal(body.display.motion, 'full');
  assert.equal(body.values.quiet.zone, 'Pacific/Honolulu');
  assert.equal(body.calendar.zone, 'UTC');
});

test('GET: identity is the token: each household sees its own values, and a profile_id in the query or a header changes nothing', async () => {
  const ctx = setup();
  for (const who of ['alice', 'bob']) {
    const other = who === 'alice' ? 'bob' : 'alice';
    const res = await audited(ctx.h, who, ROUTE, 'GET', {
      url: `${ROUTE}?profile_id=${ctx.id(other)}&user_id=${ctx.id(other)}`,
      headers: { 'x-user-id': ctx.id(other) },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assertSnapshot(body);
    assert.equal(body.revision, SETTINGS[who].revision);
    assert.equal(body.values.home.tenure, PROFILE[who].tenure);
    assert.equal(body.values.language, PROFILE[who].locale);
    assert.equal(body.display.palette, SETTINGS[who].display_palette);
    assert.equal(body.calendar.zone, SETTINGS[who].calendar_zone);
    ctx.assertNoLeak(who, body, `GET /api/settings as ${who}`);
  }
});

test('GET: no session is a 401 and nothing is read', async () => {
  const h = harness();
  await expectEnvelope(await h.call(ROUTE, 'GET'), { status: 401, code: 'auth_required' });
  assert.deepEqual(h.db.queryLog, []);
});

// ---------------------------------------------------------------------------
// Unavailable until 0021 (and 0017)
// ---------------------------------------------------------------------------

const allBut = (...missing) => haloTables(...Object.keys(HALO_TABLES).filter((name) => !missing.includes(name)));

test('before 0021 (no preferences table) GET and PATCH answer the one non-retryable 503, and PATCH claims no operation', async () => {
  const h = harness({ tables: allBut('profile_preferences') });
  const got = await expectEnvelope(await read(h), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.doesNotMatch(JSON.stringify(got), /profile_preferences|PGRST|relation|schema/);
  const before = tablesSnapshot(h);
  const body = { group: 'luna', values: { luna: { tasks: true, home: true, projects: true } }, operationId: nextOp() };
  await expectEnvelope(await patch(h, body, { revision: 1 }), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(tablesSnapshot(h), before, 'nothing was changed, as the 503 says');
  assert.equal(opRow(h, body.operationId), undefined, 'no operation id is claimed');
});

for (const code of ['42703', 'PGRST204']) {
  test(`before 0021 (no profiles.tenure, ${code}) GET and PATCH are unavailable rather than guessing tenure from renter_mode`, async () => {
    const h = harness();
    withoutColumn(h.db, 'profiles', 'tenure', code);
    await expectEnvelope(await read(h), { status: 503, code: 'feature_unavailable' });
    const body = { group: 'luna', values: { luna: { tasks: true, home: true, projects: true } }, operationId: nextOp() };
    await expectEnvelope(await patch(h, body, { revision: 4 }), { status: 503, code: 'feature_unavailable' });
    assert.equal(opRow(h, body.operationId), undefined);
    assert.equal(prefsOf(h).revision, 4);
  });
}

test('before 0017 (no ledger) GET and PATCH are unavailable, not a 500', async () => {
  const h = harness({ tables: allBut('operations') });
  await expectEnvelope(await read(h), { status: 503, code: 'feature_unavailable' });
  const snapshotLike = { values: { luna: { tasks: true, home: true, projects: true } } };
  await expectEnvelope(await patch(h, { group: 'luna', ...snapshotLike, operationId: nextOp() }, { revision: 4 }), { status: 503, code: 'feature_unavailable' });
  assert.equal(prefsOf(h).luna_home, SETTINGS.alice.luna_home);
});

// ---------------------------------------------------------------------------
// PATCH: one group at a time
// ---------------------------------------------------------------------------

test('PATCH luna: the receipt is the full snapshot at revision + 1, applied, and the ledger holds that receipt', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna = { tasks: false, home: true, projects: true }; } });
  const res = await patch(h, body, { revision: shown.revision });
  assert.equal(res.status, 200);
  const receipt = await res.json();
  assertReceipt(receipt, body.operationId);
  assert.equal(receipt.snapshot.revision, shown.revision + 1);
  assert.deepEqual(receipt.snapshot.values.luna, { tasks: false, home: true, projects: true });
  assert.deepEqual({ ...receipt.snapshot, values: { ...receipt.snapshot.values, luna: shown.values.luna }, revision: shown.revision }, shown, 'nothing else changed');
  assert.deepEqual(await readBody(h), receipt.snapshot, 'the receipt is what the next read says');
  const op = opRow(h, body.operationId);
  assert.deepEqual([op.status, op.domain, op.kind], ['succeeded', 'settings', 'settings.save']);
  assert.deepEqual(op.result, receipt, 'GET /api/operations replays exactly this receipt');
});

test('PATCH notifications: the five switches and quiet hours are saved, and only the switches that changed are written', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'notifications', {
    values: (v) => {
      v.notifications.radon_season = false;
      v.quiet = { enabled: true, from: '23:00', to: '06:30', zone: 'America/Denver' };
    },
  });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.equal(receipt.snapshot.values.notifications.radon_season, false);
  assert.equal(receipt.snapshot.values.notifications.weather_advisory, false);
  assert.deepEqual(receipt.snapshot.values.quiet, { enabled: true, from: '23:00', to: '06:30', zone: 'America/Denver' });
  const upserts = h.db.queryLog.filter((q) => q.table === 'notification_prefs' && q.operation === 'upsert');
  assert.equal(upserts.length, 1);
  assert.deepEqual(Object.keys(upserts[0].rows[0]).sort(), ['profile_id', 'radon_season', 'updated_at']);
  // The whole save is one save_settings call (Ruling S11), and it names only what changed.
  assert.deepEqual(saveCalls(h), [{
    p_profile_id: h.identities.alice.id,
    p_expected_revision: 4,
    p_preferences: { quiet_enabled: true, quiet_from: '23:00', quiet_to: '06:30', quiet_zone: 'America/Denver' },
    p_profile: null,
    p_home: null,
    p_notifications: { radon_season: false },
    p_bands: null,
  }]);
});

test('PATCH notifications: equal quiet times are allowed while quiet hours are off, because they are only a remembered draft', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'notifications', { values: (v) => { v.quiet = { enabled: false, from: '07:00', to: '07:00', zone: 'UTC' }; } });
  assertReceipt(await (await patch(h, body, { revision: 4 })).json(), body.operationId);
  assert.deepEqual([prefsOf(h).quiet_from, prefsOf(h).quiet_to, prefsOf(h).quiet_enabled], ['07:00', '07:00', false]);
});

test('PATCH display: language, the display block and the calendar block are saved; a left-out palette is kept', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'display', {
    values: (v) => { v.language = 'es'; },
    display: { appearance: 'dark', scale: '130', motion: 'system', contrast: false, ambient: false },
    calendar: { zone: 'America/Argentina/Buenos_Aires', streak: false, linked: true },
  });
  delete body.display.palette; // MyWeekWorkspace.tsx:51 sends snapshot.display, which may carry none
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.equal(receipt.snapshot.values.language, 'es');
  assert.deepEqual(receipt.snapshot.display, { appearance: 'dark', ambient: false, scale: '130', motion: 'system', contrast: false, palette: SETTINGS.alice.display_palette });
  assert.deepEqual(receipt.snapshot.calendar, { zone: 'America/Argentina/Buenos_Aires', streak: false, linked: true });
  assert.equal(profileOf(h).locale, 'es', 'language is the profile\'s locale, which GET /api/profile reads');
  const withPalette = saveBody(receipt.snapshot, 'display', { display: { palette: 'iris' } });
  assert.equal((await (await patch(h, withPalette, { revision: 5 })).json()).snapshot.display.palette, 'iris');
});

test('PATCH home: year, water, tenure and the household bands are saved, and GET /api/profile sees them', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'home', {
    values: (v) => { v.home = { year: '1990', water: 'spring', tenure: 'renter' }; },
    household: { has_child: true },
  });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.deepEqual(receipt.snapshot.values.home, { year: '1990', water: 'spring', tenure: 'renter' });
  assert.deepEqual(BAND_KEYS.filter((key) => bandsOf(h)[key]), ['has_child', 'has_adult']);
  const profile = await (await h.call('/api/profile', 'GET', { as: 'alice' })).json();
  assert.deepEqual([profile.profile.home_year, profile.profile.water_source, profile.profile.renter_mode], [1990, 'spring', true]);
  assert.equal(profile.household.has_child, true);
});

test('PATCH home through the current home (0016): the answers are saved in the home context and the profile follows it', async () => {
  const ctx = setup();
  registerHomeContextRpcs(ctx.h.db);
  installSettingsDb(ctx.h.db);
  const shown = await (await audited(ctx.h, 'alice', ROUTE, 'GET')).json();
  const body = saveBody(shown, 'home', { values: (v) => { v.home.year = '2001'; } });
  const res = await audited(ctx.h, 'alice', ROUTE, 'PATCH', { body, headers: { 'if-match': String(shown.revision), 'idempotency-key': body.operationId } });
  assertReceipt(await res.json(), body.operationId);
  const home = ctx.rowsOf('home_contexts', 'alice').find((row) => row.effective_to === null);
  assert.equal(home.home_year, 2001);
  assert.equal(home.revision, 2, 'saved through update_home_context_attributes, not around it');
  assert.equal(ctx.rowsOf('profiles', 'alice')[0].home_year, 2001);
  assert.ok(ctx.h.db.rpcCalls.some((call) => call.name === 'update_home_context_attributes' && call.args.p_profile_id === ctx.id('alice')));
});

test('PATCH home: a home that changed under the save is a 409 and the tenure and bands are not written', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const h = harness({ aliceProfile: { lat: 35.1, lng: -80.1 } });
  h.db.seed('home_contexts', [{ id: '5e771265-cccc-4000-8000-000000000001', profile_id: h.identities.alice.id, sequence: 1, revision: 3, effective_to: null }]);
  h.db.registerRpc('update_home_context_attributes', () => { throw rpcError('P0001', 'HALO_STALE_REVISION', '{"revision": 4}'); });
  const shown = await readBody(h);
  const body = saveBody(shown, 'home', { values: (v) => { v.home = { year: '1999', water: 'well', tenure: 'renter' }; }, household: { has_teen: true } });
  const res = await patch(h, body, { revision: 4 });
  const envelope = await expectEnvelope(res, { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'home_changed');
  assert.equal(profileOf(h).tenure, 'owner');
  assert.equal(bandsOf(h).has_teen ?? false, false);
  assert.equal(prefsOf(h).revision, 4, 'the whole save rolled back, the revision with it (Rulings S4 and S11)');
  assert.equal(opRow(h, body.operationId).status, 'failed');
});

test('PATCH home: an unanswered tenure and water source stay unanswered when only the year is edited', async () => {
  const h = harness();
  const shown = await readBody(h, 'bob');
  const body = saveBody(shown, 'home', { values: (v) => { v.home.year = '1955'; }, household: { has_adult: false } });
  const receipt = await (await patch(h, body, { who: 'bob', revision: 1 })).json();
  assertReceipt(receipt, body.operationId);
  assert.deepEqual(receipt.snapshot.values.home, { year: '1955', water: 'other', tenure: 'other' });
  assert.deepEqual([profileOf(h, 'bob').tenure, profileOf(h, 'bob').water_source, profileOf(h, 'bob').home_year], [null, null, 1955]);
});

test('PATCH home: clearing the year stores null; unchanged bands are not rewritten', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'home', { values: (v) => { v.home.year = ''; } });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assert.equal(receipt.snapshot.values.home.year, '');
  assert.equal(profileOf(h).home_year, null);
  assert.equal(h.db.queryLog.filter((q) => q.table === 'household_bands' && q.operation !== 'select').length, 0);
});

// ---------------------------------------------------------------------------
// Rulings S7 and S13: tenure and renter_mode, for every writer
// ---------------------------------------------------------------------------

for (const [tenure, renterMode] of [['renter', true], ['owner', false], ['other', false]]) {
  test(`S7, PATCH: tenure ${tenure} is saved with renter_mode ${renterMode}, in the one save_settings call`, async () => {
    const h = harness({ aliceProfile: { tenure: tenure === 'owner' ? 'renter' : 'owner', renter_mode: tenure === 'owner' } });
    const shown = await readBody(h);
    const body = saveBody(shown, 'home', { values: (v) => { v.home.tenure = tenure; } });
    assertReceipt(await (await patch(h, body, { revision: 4 })).json(), body.operationId);
    assert.deepEqual(saveCalls(h).map((args) => args.p_profile), [{ tenure, renter_mode: renterMode }]);
    assert.deepEqual([profileOf(h).tenure, profileOf(h).renter_mode], [tenure, renterMode]);
  });
}

test('S13: an unanswered tenure reads as renter while renter_mode is true, and as other (never owner) while it is false', async () => {
  for (const [renterMode, expected] of [[true, 'renter'], [false, 'other']]) {
    const h = harness({ aliceProfile: { tenure: null, renter_mode: renterMode } });
    assert.equal((await readBody(h)).values.home.tenure, expected);
  }
});

test('S13: a home save that leaves an unanswered renter\'s tenure as shown keeps it unanswered', async () => {
  const h = harness({ aliceProfile: { tenure: null, renter_mode: true } });
  const shown = await readBody(h);
  const body = saveBody(shown, 'home', { values: (v) => { v.home.year = '2002'; } });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.equal(receipt.snapshot.values.home.tenure, 'renter');
  assert.deepEqual([profileOf(h).tenure, profileOf(h).renter_mode], [null, true]);
  assert.equal(saveCalls(h)[0].p_profile, null, 'the stand-in is not written back as an answer');
});

const householdPut = (h, body, who = 'alice') => h.call('/api/household', 'PUT', { as: who, body });
const writesTenure = (q) =>
  q.table === 'profiles' && q.operation !== 'select' && [...(q.rows ?? []), q.values ?? {}].some((row) => Object.hasOwn(row, 'tenure'));

for (const rpc of [true, false]) {
  const label = rpc ? 'save_household' : 'the two-step write before 0015';
  for (const [stored, renterMode, expected, reads] of [
    ['owner', true, 'renter', 'renter'], ['other', true, 'renter', 'renter'], ['renter', true, 'renter', 'renter'],
    ['renter', false, null, 'other'], ['owner', false, 'owner', 'owner'], ['other', false, 'other', 'other'],
    [null, true, null, 'renter'], [null, false, null, 'other'],
  ]) {
    test(`S13, PUT /api/household (${label}): renter_mode ${renterMode} over tenure ${stored} stores ${expected}, reads as ${reads}, and the bands are saved`, async (t) => {
      t.mock.method(console, 'warn', () => {});
      const h = harness({ aliceProfile: { tenure: stored, renter_mode: stored === 'renter' } });
      if (rpc) registerSaveHousehold(h.db);
      const res = await householdPut(h, { has_senior: true, renter_mode: renterMode });
      assert.equal(res.status, 200);
      assert.deepEqual([profileOf(h).tenure, profileOf(h).renter_mode], [expected, renterMode]);
      assert.equal(bandsOf(h).has_senior, true);
      assert.equal(profileOf(h, 'bob').tenure, null);
      assert.equal((await readBody(h)).values.home.tenure, reads);
      // The database reconciles inside the row write (0021's profiles_tenure_reconcile); the
      // route runs no tenure statement of its own, so nothing can land between the two.
      assert.equal(h.db.queryLog.some(writesTenure), false);
    });
  }
}

test('S13 and review F3: a settings save that lands while a household save is in flight keeps the tenure it wrote', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const h = harness();
  registerSaveHousehold(h.db);
  // Device B re-reads and saves tenure 'owner' after the household save's own write and
  // before PUT /api/household answers: the point where a follow-up "clear tenure" used to run.
  const rpc = h.db.rpc;
  let interleaved = null;
  h.db.rpc = async (name, args) => {
    const result = await rpc(name, args);
    if (name === 'save_household' && !interleaved) {
      const shown = await readBody(h);
      assert.equal(shown.values.home.tenure, 'renter', 'the household save made the owner a renter');
      const body = saveBody(shown, 'home', { values: (v) => { v.home.tenure = 'owner'; } });
      interleaved = await patch(h, body, { revision: shown.revision });
    }
    return result;
  };
  assert.equal((await householdPut(h, { has_child: true, renter_mode: true })).status, 200);
  assert.equal(interleaved?.status, 200);
  assert.deepEqual([profileOf(h).tenure, profileOf(h).renter_mode], ['owner', false], 'the later answer stands');
  assert.equal((await readBody(h)).values.home.tenure, 'owner', 'and the next read agrees with the receipt device B was given');
});

test('S7, PUT /api/household: no renter_mode in the body leaves tenure alone', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const h = harness();
  assert.equal((await householdPut(h, { has_child: true })).status, 200);
  assert.equal(profileOf(h).tenure, 'owner');
  assert.equal(h.db.queryLog.filter((q) => q.table === 'profiles' && q.operation === 'update').length, 0);
});

for (const code of ['42703', 'PGRST204']) {
  test(`S7, PUT /api/household before 0021 (no tenure column, ${code}): the save never 500s and keeps its band change`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    const errors = muteConsoleError(t);
    const h = harness({ tables: allBut('profile_preferences') });
    withoutColumn(h.db, 'profiles', 'tenure', code);
    const res = await householdPut(h, { has_toddler: true, renter_mode: true });
    assert.equal(res.status, 200);
    assert.equal(bandsOf(h).has_toddler, true);
    assert.equal(profileOf(h).renter_mode, true);
    assert.equal(errors.mock.callCount(), 0, 'a missing 0021 is not an error');
  });
}

// ---------------------------------------------------------------------------
// Ruling S12: every writer of a snapshot value advances the revision
// ---------------------------------------------------------------------------

const HOME = '5e771265-cccc-4000-8000-0000000000aa';
const PLACE = {
  center: [-80.61, 35.41],
  context: [{ id: 'postcode.1', text: '28027' }, { id: 'district.1', text: 'Cabarrus County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }],
};

/** The settings harness, plus what the other writers need: the 0015 and 0016 stand-ins and the network. */
function writersHarness() {
  const h = harness({
    extra: {
      env: { MAPBOX_TOKEN: 'pk.test-token' },
      fetch: async (url) => {
        const target = String(url);
        if (target.startsWith('https://api.mapbox.com/')) return Response.json({ features: [PLACE] });
        if (target.startsWith('https://services.arcgis.com/')) return Response.json({ features: [{ attributes: { PWSID: 'NC0250010' } }] });
        return new Response('{}', { status: 503 });
      },
    },
  });
  registerHomeContextRpcs(h.db);
  registerSaveHousehold(h.db);
  return h;
}
/** alice with a current home describing the answers her profile holds. */
const withHome = (h) => {
  h.db.seed('home_contexts', [{
    id: HOME, profile_id: h.identities.alice.id, sequence: 1, revision: 1, origin: 'onboard',
    lat: 35.41, lng: -80.61, water_source: 'well', home_year: 1975, effective_to: null,
  }]);
  return h;
};

const WRITERS = [
  ['PUT /api/notifications', (h) => h.call('/api/notifications', 'PUT', { as: 'alice', body: { preferences: { radon_season: false } } })],
  ['PUT /api/household', (h) => householdPut(h, { has_child: true, renter_mode: false })],
  ['PATCH /api/profile', (h) => h.call('/api/profile', 'PATCH', { as: 'alice', body: { home_year: 1990 } })],
  ['PATCH /api/profile through the current home', (h) => withHome(h).call('/api/profile', 'PATCH', { as: 'alice', body: { home_year: 1990 } })],
  ['POST /api/onboard', (h) => h.call('/api/onboard', 'POST', { as: 'alice', body: { address: '2 Elm Court', home_year: 1990, water_source: 'utility' } })],
  ['PATCH /api/home-contexts/[id]', (h) => withHome(h).call('/api/home-contexts/[id]', 'PATCH', {
    as: 'alice', url: `/api/home-contexts/${HOME}`, params: { id: HOME }, body: { expected_revision: 1, home_year: 1990 },
  })],
];

for (const [name, write] of WRITERS) {
  test(`S12: ${name} advances the settings revision, so a settings save holding the old one is a 409 and does not revert it`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    muteConsoleError(t); // onboarding's history backfill runs after the answer and finds no network here
    const h = writersHarness();
    await readBody(h, 'bob');
    const shown = await readBody(h);
    const res = await write(h);
    assert.equal(res.status, 200, `${name}: ${await res.clone().text()}`);
    const revision = prefsOf(h).revision;
    assert.ok(revision > shown.revision, `${name} advanced the revision (${shown.revision} to ${revision})`);
    assert.equal(prefsOf(h, 'bob').revision, 1, 'owner scoped: the other household\'s revision is not touched');
    // A device still showing the old snapshot edits one thing and saves: its stale values
    // must not be written back over what the writer above changed.
    const fresh = await readBody(h);
    const stale = saveBody(shown, 'home', { values: (v) => { v.home.tenure = 'other'; } });
    const envelope = await expectEnvelope(await patch(h, stale, { revision: shown.revision }), { status: 409, code: 'conflict', extraKeys: ['reason', 'revision'] });
    assert.deepEqual([envelope.reason, envelope.revision], ['stale_revision', revision]);
    assert.deepEqual(await readBody(h), fresh, 'the stale save wrote nothing');
  });
}

for (const [name, write] of [
  ['PUT /api/notifications', (h) => h.call('/api/notifications', 'PUT', { as: 'alice', body: { preferences: { air_quality_change: true } } })],
  ['PATCH /api/profile', (h) => h.call('/api/profile', 'PATCH', { as: 'alice', body: { home_year: 1975 } })],
  ['PUT /api/household', (h) => householdPut(h, { has_adult: true, renter_mode: false })],
]) {
  test(`S12: ${name} writing the values already stored does not advance the revision, so a save at it still applies`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    const h = writersHarness();
    const shown = await readBody(h);
    assert.equal((await write(h)).status, 200);
    assert.equal(prefsOf(h).revision, shown.revision);
    const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
    assertReceipt(await (await patch(h, body, { revision: shown.revision })).json(), body.operationId);
  });
}

test('S12: a household that never read its settings has no row, and a legacy write creates none', async () => {
  const h = harness();
  assert.equal((await h.call('/api/notifications', 'PUT', { as: 'bob', body: { preferences: { radon_season: false } } })).status, 200);
  assert.equal(prefsOf(h, 'bob'), undefined);
});

test('S12: before 0021 the legacy writers work exactly as before, without a log line', async (t) => {
  const errors = muteConsoleError(t);
  const h = harness({ tables: allBut('profile_preferences') });
  const res = await h.call('/api/notifications', 'PUT', { as: 'alice', body: { preferences: { radon_season: false } } });
  assert.equal(res.status, 200);
  assert.equal(notifOf(h).radon_season, false);
  assert.equal(errors.mock.callCount(), 0);
});

test('S12: a save advances the revision exactly once, however many of its writes the database counted', async () => {
  const h = harness();
  const shown = await readBody(h);
  // Profile columns (year, water, tenure) and the bands: each write advances it inside the save.
  const body = saveBody(shown, 'home', { values: (v) => { v.home = { year: '1990', water: 'spring', tenure: 'renter' }; }, household: { has_child: true } });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.equal(receipt.snapshot.revision, 5);
  assert.equal(prefsOf(h).revision, 5);
});

// ---------------------------------------------------------------------------
// Ruling S11: a save is all or nothing, and its receipt is what it committed
// ---------------------------------------------------------------------------

const withoutOperations = (json) => JSON.stringify(JSON.parse(json), (key, value) => (key === 'operations' ? undefined : value));

test('S11: a save that fails part way applies nothing: not the revision, not the group\'s columns, not the tenure', async (t) => {
  const errors = muteConsoleError(t);
  const h = harness();
  const shown = await readBody(h);
  const before = tablesSnapshot(h);
  // The bands are the last table the save writes; that one statement fails.
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name === 'household_bands') {
      builder.upsert = () => ({ then: (ok) => ok({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) });
    }
    return builder;
  };
  const body = saveBody(shown, 'home', { values: (v) => { v.home = { year: '1990', water: 'spring', tenure: 'renter' }; }, household: { has_child: true } });
  await expectEnvelope(await patch(h, body, { revision: 4 }), { status: 500, code: 'internal_error' });
  h.db.from = from;
  assert.equal(errors.mock.callCount(), 1, 'logged once');
  assert.equal(opRow(h, body.operationId).status, 'failed', 'recorded as failed');
  assert.equal(withoutOperations(tablesSnapshot(h)), withoutOperations(before), 'and "failed" is true: every settings table is exactly as it was');
  assert.deepEqual(await readBody(h), shown);
});

test('S11: the receipt is built from what save_settings returned, with nothing read after it commits', async () => {
  const h = harness();
  const shown = await readBody(h);
  const rpc = h.db.rpc;
  let committedAt = null;
  h.db.rpc = async (name, args) => {
    const result = await rpc(name, args);
    if (name === 'save_settings') committedAt = h.db.queryLog.length;
    return result;
  };
  const body = saveBody(shown, 'display', { values: (v) => { v.language = 'es'; }, display: { appearance: 'dark' } });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.ok(committedAt !== null);
  assert.deepEqual(
    h.db.queryLog.slice(committedAt).map((q) => [q.table, q.operation]),
    [['operations', 'update']],
    'between the commit and the answer only the ledger settles',
  );
  assert.deepEqual(await readBody(h), receipt.snapshot, 'and it is what the next read says');
});

test('S11: save_settings missing alone (0021 half applied) is the same 503, recorded as failed with nothing changed', async () => {
  const h = harness();
  h.db.registerRpc('save_settings', () => { throw rpcError('PGRST202', 'Could not find the function public.save_settings in the schema cache'); });
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  await expectEnvelope(await patch(h, body, { revision: 4 }), { status: 503, code: 'feature_unavailable', retryable: false });
  assert.equal(prefsOf(h).revision, 4);
  assert.equal(opRow(h, body.operationId).status, 'failed');
});

test('S11: an answer from save_settings that is not a saved state is a 500, not a made-up receipt', async (t) => {
  muteConsoleError(t);
  const h = harness();
  h.db.registerRpc('save_settings', () => ({ saved: true, revision: 5 }));
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  await expectEnvelope(await patch(h, body, { revision: 4 }), { status: 500, code: 'internal_error' });
});

// ---------------------------------------------------------------------------
// The read order (review F5, mutation R1)
// ---------------------------------------------------------------------------

test('a read pairs a revision only with values at least that new: the revision is read before the values it covers', async () => {
  const h = harness();
  // Another device changes the year, and the database advances the revision with it, right
  // after the read's first statement on the snapshot's tables.
  const from = h.db.from;
  let interposed = false;
  h.db.from = (name) => {
    const builder = from(name);
    if (interposed || !['profile_preferences', 'profiles', 'notification_prefs'].includes(name)) return builder;
    const then = builder.then.bind(builder);
    builder.then = (ok, ko) => then((result) => {
      if (interposed) return result;
      interposed = true;
      return from('profiles').update({ home_year: 1990 }).eq('id', h.identities.alice.id).then(() => result);
    }).then(ok, ko);
    return builder;
  };
  const shown = await readBody(h);
  h.db.from = from;
  assert.equal(interposed, true);
  assert.equal(prefsOf(h).revision, 5, 'the write advanced the revision');
  // Revision first: the old revision with the new year, which a save then conflicts on. The
  // other order answers revision 5 with the old year, and a save from that puts 1975 back.
  assert.deepEqual([shown.revision, shown.values.home.year], [4, '1990']);
  const body = saveBody(shown, 'home', { values: (v) => { v.home.tenure = 'other'; } });
  await expectEnvelope(await patch(h, body, { revision: shown.revision }), { status: 409, code: 'conflict', extraKeys: ['reason', 'revision'] });
  assert.equal(profileOf(h).home_year, 1990);
});

// ---------------------------------------------------------------------------
// Conflict, concurrency, idempotency
// ---------------------------------------------------------------------------

test('a stale If-Match is a 409 with the current revision; nothing is written and the revision does not move', async () => {
  const h = harness();
  const shown = await readBody(h);
  const before = JSON.stringify(prefsOf(h));
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  const envelope = await expectEnvelope(await patch(h, body, { revision: 3 }), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason', 'revision'] });
  assert.deepEqual([envelope.reason, envelope.revision], ['stale_revision', 4]);
  assert.equal(JSON.stringify(prefsOf(h)), before);
  assert.equal(opRow(h, body.operationId).status, 'failed');
});

test('two saves holding the same revision: exactly one wins, and the loser wrote nothing', async () => {
  const h = harness();
  const shown = await readBody(h);
  const a = saveBody(shown, 'luna', { values: (v) => { v.luna = { tasks: true, home: true, projects: true }; } });
  const b = saveBody(shown, 'display', { display: { appearance: 'system' }, values: (v) => { v.language = 'es'; } });
  const [ra, rb] = await Promise.all([patch(h, a, { revision: 4 }), patch(h, b, { revision: 4 })]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  assert.equal(prefsOf(h).revision, 5, 'advanced once');
  const loser = ra.status === 409 ? 'luna' : 'display';
  if (loser === 'display') {
    assert.equal(prefsOf(h).display_appearance, SETTINGS.alice.display_appearance);
    assert.equal(profileOf(h).locale, 'en');
  } else {
    assert.equal(prefsOf(h).luna_home, SETTINGS.alice.luna_home);
  }
});

test('the compare-and-set is the lock: a save whose read saw the revision but whose write lost the race is a 409', async () => {
  const h = harness();
  const shown = await readBody(h);
  // Another writer advances the revision between the save's own read and its compare-and-set.
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name !== 'profile_preferences') return builder;
    const realUpdate = builder.update.bind(builder);
    builder.update = (values) => {
      const chained = realUpdate(values);
      if (values.revision !== 5) return chained;
      h.db.from = from;
      const realThen = chained.then.bind(chained);
      chained.then = (ok, ko) =>
        from('profile_preferences').update({ revision: 5 }).eq('profile_id', h.identities.alice.id).then(() => realThen(ok, ko));
      return chained;
    };
    return builder;
  };
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  const envelope = await expectEnvelope(await patch(h, body, { revision: 4 }), { status: 409, code: 'conflict', extraKeys: ['reason', 'revision'] });
  assert.deepEqual([envelope.reason, envelope.revision], ['stale_revision', 5], 'save_settings reports the revision it found');
  assert.equal(prefsOf(h).revision, 5, 'only the other writer advanced it');
  assert.equal(prefsOf(h).luna_home, SETTINGS.alice.luna_home);
});

test('replaying the same operation id returns the first receipt and applies nothing twice', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.projects = !v.luna.projects; } });
  const first = await (await patch(h, body, { revision: 4 })).json();
  const again = await patch(h, body, { revision: 4 });
  assert.equal(again.status, 200, 'a lost response replays as the success it was, not as a conflict');
  assert.deepEqual(await again.json(), first);
  assert.equal(prefsOf(h).revision, 5);
});

test('the same operation id with a different body is a 409 operation_mismatch, and nothing changes', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.projects = !v.luna.projects; } });
  await patch(h, body, { revision: 4 });
  const other = { ...body, values: { ...body.values, luna: { tasks: false, home: false, projects: false } } };
  const envelope = await expectEnvelope(await patch(h, other, { revision: 5 }), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'operation_mismatch');
  assert.equal(prefsOf(h).revision, 5);
});

test('replaying an id whose save failed in process (result null) is a terminal 409 operation_failed, not a 5xx and not "not found"', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  await patch(h, body, { revision: 3 }); // refused as stale, settled failed with no result
  assert.deepEqual([opRow(h, body.operationId).status, opRow(h, body.operationId).result ?? null], ['failed', null]);
  for (let i = 0; i < 2; i += 1) {
    const envelope = await expectEnvelope(await patch(h, body, { revision: 3 }), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
    assert.equal(envelope.reason, 'operation_failed');
    assert.doesNotMatch(envelope.message, /not found/i);
  }
  assert.equal(prefsOf(h).revision, 4);
});

test('replaying an id the reaper settled as abandoned is a terminal 409 operation_abandoned', async () => {
  const ABANDONED = '5e771265-bbbb-4000-8000-000000000001';
  const h = harness({ operations: [{ operation_id: ABANDONED, status: 'failed', result: { status: 'failed', reason: 'abandoned' }, created_at: ago(10 * 60 * 1000) }] });
  const shown = await readBody(h);
  assert.deepEqual(shown.unresolvedOperations, [], 'a settled row is not a lock');
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } }, ABANDONED);
  // The ledger's request hash has to match for a replay; the seeded row has none, so any body replays.
  const envelope = await expectEnvelope(await patch(h, body, { revision: 4 }), { status: 409, code: 'conflict', retryable: false, extraKeys: ['reason'] });
  assert.equal(envelope.reason, 'operation_abandoned');
  assert.equal(prefsOf(h).revision, 4, 'nothing applied');
});

test('replaying an id still in flight answers pending, which the client parks and reconciles', async () => {
  const PENDING = '5e771265-dddd-4000-8000-000000000001';
  const h = harness({ operations: [{ operation_id: PENDING }] });
  const shown = await readBody(h);
  const res = await patch(h, saveBody(shown, 'luna', {}, PENDING), { revision: 4 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { operationId: PENDING, status: 'pending' });
});

test('a success receipt leaves out its own id but keeps another pending settings operation', async () => {
  const OTHER = '5e771265-eeee-4000-8000-000000000001';
  const h = harness({ operations: [{ operation_id: OTHER }] });
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.deepEqual(receipt.snapshot.unresolvedOperations, [OTHER]);
  // Ruling S14: that list is the direct answer's alone. The receipt the ledger
  // keeps, which a replay and GET /api/operations serve, is history, not a lock.
  const historical = { ...receipt, snapshot: { ...receipt.snapshot, unresolvedOperations: [] } };
  assert.deepEqual(opRow(h, body.operationId).result, historical);
  assert.deepEqual(await (await patch(h, body, { revision: 4 })).json(), historical, 'a replay is the stored receipt');
  const reconciled = await (await h.call('/api/operations', 'GET', { as: 'alice', url: `/api/operations?operationId=${body.operationId}&domain=settings` })).json();
  assert.deepEqual([reconciled.status, reconciled.snapshot], ['succeeded', historical.snapshot]);
});

// ---------------------------------------------------------------------------
// Group scope and ownership
// ---------------------------------------------------------------------------

test('a save of one group never writes another group\'s stale values back', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', {
    values: (v) => {
      v.luna.home = !v.luna.home;
      // Everything below is what a stale or tampered client might carry in the other groups.
      v.notifications = Object.fromEntries(notificationKinds.map((k) => [k, false]));
      v.quiet = { enabled: false, from: '01:00', to: '02:00', zone: 'UTC' };
      v.language = 'es';
      v.home = { year: '1801', water: 'utility', tenure: 'renter' };
    },
  });
  const receipt = await (await patch(h, body, { revision: 4 })).json();
  assertReceipt(receipt, body.operationId);
  assert.deepEqual({ ...receipt.snapshot.values, luna: shown.values.luna }, shown.values);
  assert.deepEqual(receipt.snapshot.display, shown.display);
  assert.deepEqual(receipt.snapshot.calendar, shown.calendar);
  assert.equal(h.db.queryLog.filter((q) => ['profiles', 'notification_prefs', 'household_bands'].includes(q.table) && q.operation !== 'select').length, 0);
});

test('PATCH: every statement is scoped to the caller, a body naming another profile is refused, a query naming one is ignored, and bob is unchanged', async () => {
  const ctx = setup();
  installSettingsDb(ctx.h.db);
  const bobRows = () => JSON.stringify(OWNED.map((t) => ctx.rowsOf(t, 'bob')));
  const before = bobRows();
  const shown = await (await audited(ctx.h, 'alice', ROUTE, 'GET')).json();
  const headers = (body, revision = shown.revision) => ({ 'if-match': String(revision), 'idempotency-key': body.operationId });

  const smuggled = { ...saveBody(shown, 'luna'), profile_id: ctx.id('bob') };
  const refused = await audited(ctx.h, 'alice', ROUTE, 'PATCH', { body: smuggled, headers: headers(smuggled) });
  const envelope = await expectEnvelope(refused, { status: 422, code: 'validation_failed' });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), [['profile_id', 'unknown_field']]);

  const body = saveBody(shown, 'home', { values: (v) => { v.home.tenure = 'other'; }, household: { has_teen: true } });
  const res = await audited(ctx.h, 'alice', ROUTE, 'PATCH', { url: `${ROUTE}?profile_id=${ctx.id('bob')}`, body, headers: { ...headers(body), 'x-user-id': ctx.id('bob') } });
  assertReceipt(await res.json(), body.operationId);
  ctx.assertNoLeak('alice', await (await audited(ctx.h, 'alice', ROUTE, 'GET')).json(), 'GET after PATCH');

  // bob's revision is a number alice can send, and gains her nothing.
  const bobsRevision = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  await expectEnvelope(await audited(ctx.h, 'alice', ROUTE, 'PATCH', { body: bobsRevision, headers: headers(bobsRevision, SETTINGS.bob.revision) }), { status: 409, code: 'conflict', extraKeys: ['reason', 'revision'] });
  assert.equal(bobRows(), before, 'bob is byte for byte unchanged');
});

test('S12 and S13: the legacy writers stay owner scoped, and what the database does for them touches only the caller', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const ctx = setup();
  registerSaveHousehold(ctx.h.db);
  installSettingsDb(ctx.h.db);
  const queriesBefore = ctx.h.db.queryLog.length;
  assert.equal((await ctx.h.call('/api/household', 'PUT', { as: 'alice', body: { has_child: true, renter_mode: true, profile_id: ctx.id('bob') } })).status, 200);
  assert.equal((await ctx.h.call('/api/notifications', 'PUT', { as: 'alice', body: { preferences: { radon_season: false } } })).status, 200);
  auditOwnerScope(ctx.h.db.queryLog.slice(queriesBefore), ctx.id('alice'), 'legacy writers');
  assert.equal(ctx.rowsOf('profile_preferences', 'bob')[0].revision, SETTINGS.bob.revision);
  // One advance per statement that changed a value: the bands, then renter_mode (with tenure), then a switch.
  assert.equal(ctx.rowsOf('profile_preferences', 'alice')[0].revision, SETTINGS.alice.revision + 3);
  assert.equal(ctx.rowsOf('profiles', 'alice')[0].tenure, 'renter', 'an owner who now rents reads as a renter (Ruling S13)');
  assert.equal(ctx.rowsOf('profiles', 'bob')[0].tenure, 'renter');
});

// ---------------------------------------------------------------------------
// Invalid input is a 422 that touches nothing
// ---------------------------------------------------------------------------

const INVALID = [
  ['quiet hours on with equal times (0021 refuses it; this must not be a 500)', 'notifications', { values: (v) => { v.quiet = { enabled: true, from: '22:00', to: '22:00', zone: 'UTC' }; } }, [['values.quiet.to', 'quiet_window']]],
  ['a quiet time that is not HH:MM', 'notifications', { values: (v) => { v.quiet.from = '24:90'; v.quiet.to = '9:00'; } }, [['values.quiet.from', 'invalid_time'], ['values.quiet.to', 'invalid_time']]],
  ['a zone Intl does not know', 'notifications', { values: (v) => { v.quiet.zone = 'Not/A_Zone'; } }, [['values.quiet.zone', 'invalid_zone']]],
  ['an offset Intl accepts but the column refuses', 'display', { calendar: { zone: '+05:00' } }, [['calendar.zone', 'invalid_zone']]],
  ['a notification switch that is not a boolean', 'notifications', { values: (v) => { v.notifications.radon_season = 'false'; } }, [['values.notifications.radon_season', 'invalid_boolean']]],
  ['a tenure outside the three', 'home', { values: (v) => { v.home.tenure = 'landlord'; } }, [['values.home.tenure', 'invalid_option']]],
  ['a null tenure', 'home', { values: (v) => { v.home.tenure = null; } }, [['values.home.tenure', 'invalid_option']]],
  ['a water source outside the four', 'home', { values: (v) => { v.home.water = 'city'; } }, [['values.home.water', 'invalid_option']]],
  ['a year that is not four digits', 'home', { values: (v) => { v.home.year = '75'; } }, [['values.home.year', 'invalid_year']]],
  ['a year before 1700', 'home', { values: (v) => { v.home.year = '1650'; } }, [['values.home.year', 'invalid_year']]],
  ['a year as a number', 'home', { values: (v) => { v.home.year = 1975; } }, [['values.home.year', 'invalid_year']]],
  ['a household band that is not a boolean', 'home', { household: { has_child: 1 } }, [['household.has_child', 'invalid_boolean']]],
  ['a scale as a number', 'display', { display: { scale: 100 } }, [['display.scale', 'invalid_option']]],
  ['a palette of null', 'display', { display: { palette: null } }, [['display.palette', 'invalid_option']]],
  ['an unknown motion', 'display', { display: { motion: 'reduced' } }, [['display.motion', 'invalid_option']]],
  ['a language outside en and es', 'display', { values: (v) => { v.language = 'fr'; } }, [['values.language', 'invalid_option']]],
  ['a Luna switch that is not a boolean', 'luna', { values: (v) => { v.luna.home = 'yes'; } }, [['values.luna.home', 'invalid_boolean']]],
];

for (const [label, group, edit, expected] of INVALID) {
  test(`422: ${label}, and nothing is written or claimed`, async () => {
    const h = harness();
    const shown = await readBody(h);
    const before = tablesSnapshot(h);
    const logBefore = h.db.queryLog.length;
    const body = saveBody(shown, group, edit);
    const envelope = await expectEnvelope(await patch(h, body, { revision: 4 }), { status: 422, code: 'validation_failed', retryable: false });
    assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(envelope.error.includes('—'), false);
    assert.equal(tablesSnapshot(h), before);
    assert.equal(h.db.queryLog.length, logBefore, 'no statement ran');
  });
}

test('422: the request itself (group, keys, If-Match, operation id) is checked before anything is read', async () => {
  const h = harness();
  const shown = await readBody(h);
  const logBefore = h.db.queryLog.length;
  const cases = [
    [{ ...saveBody(shown, 'luna'), group: 'privacy' }, 4, [['group', 'nothing_to_save']]],
    [{ ...saveBody(shown, 'luna'), group: 'everything' }, 4, [['group', 'invalid_option']]],
    [{ ...saveBody(shown, 'luna'), household: { has_child: true } }, 4, [['household', 'unknown_field']]],
    [{ ...saveBody(shown, 'luna'), values: 'all' }, 4, [['values', 'invalid_object']]],
    [saveBody(shown, 'luna'), undefined, [['If-Match', 'precondition_required']]],
    [saveBody(shown, 'luna'), 0, [['If-Match', 'precondition_required']]],
    [saveBody(shown, 'luna'), 'four', [['If-Match', 'precondition_required']]],
    [{ ...saveBody(shown, 'luna'), operationId: 'not-a-uuid' }, 4, [['operationId', 'invalid_uuid']]],
  ];
  for (const [body, revision, expected] of cases) {
    const envelope = await expectEnvelope(await patch(h, body, { revision }), { status: 422, code: 'validation_failed' });
    assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected, JSON.stringify(expected));
  }
  const body = saveBody(shown, 'luna');
  const mismatch = await patch(h, body, { revision: 4, headers: { 'idempotency-key': nextOp() } });
  assert.equal((await expectEnvelope(mismatch, { status: 422, code: 'validation_failed' })).field_errors[0].code, 'idempotency_key_mismatch');
  assert.equal(h.db.queryLog.length, logBefore);
  await expectEnvelope(await h.call(ROUTE, 'PATCH', { as: 'alice', rawBody: '{nope' }), { status: 400, code: 'bad_request' });
  await expectEnvelope(await h.call(ROUTE, 'PATCH', { body }), { status: 401, code: 'auth_required' });
});

test('If-Match also accepts the revision as an entity tag', async () => {
  const h = harness();
  const shown = await readBody(h);
  const body = saveBody(shown, 'luna', { values: (v) => { v.luna.home = !v.luna.home; } });
  assertReceipt(await (await patch(h, body, { headers: { 'if-match': '"4"' } })).json(), body.operationId);
});

test('the route bounds its run time inside the ledger\'s 120 s window (maxDuration)', async () => {
  const route = await import('../app/api/settings/route.js');
  assert.equal(route.maxDuration, 60);
});
