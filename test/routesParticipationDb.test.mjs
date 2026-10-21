/**
 * B18 the participation directory end to end (docs/backend/plans/b18-participation-directory.md):
 * the three routes with migration 0032's REAL read functions on PGlite below
 * them (test/helpers/participationWorld.mjs) and the CLIENT's own code above
 * them: the frontend runtime, validators and `opportunityState` compiled from
 * this tree, and the two screens' consumption lines transcribed verbatim
 * (test/helpers/frontendB18.mjs, drift-tested below). Each scenario ends on
 * what the screen shows.
 *
 * Rows are written by hand as the migration owner, the only writer there is,
 * relative to the real clock, because the routes read the real clock.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDb } from './db/pgliteHarness.mjs';
import { LIMITER_UNAVAILABLE, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { createWorld, ensureOrg, insertListing, opportunityRow, profileRow } from './helpers/participationWorld.mjs';
import * as fe from './helpers/frontendB18.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { placeById } from '../lib/places.js';

const { FrontendServiceError } = await loadFrontend('production/runtime');

const MECKLENBURG = placeById('us-county:37119');
const CHARLOTTE = placeById('us-place:3712000');
const ZIP_28208 = placeById('us-zcta:28208');
const UNION = placeById('us-county:37179');
const UNAVAILABLE = 'This service is unavailable. Try again later.';
// A 503 feature_unavailable read (flag off, or before 0032) is settled: the screen says not available yet (no retry).
const LISTINGS_OFF = 'Local listings are not available yet. Use the organizers’ official sites below.';
const ORGANIZATIONS_OFF = 'Organization profiles are not available yet. Use the official resources below.';
const VALIDATION = 'Check the highlighted information and try again.';
const PATHS = { opportunities: '/api/opportunities', detail: '/api/opportunities/detail', organizations: '/api/explore/organizations' };
const q = (params) => `?${new URLSearchParams(params)}`;

let db;
before(async () => {
  db = await createDb();
  await ensureOrg(db);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.participation_opportunities; delete from public.participation_profiles;');
});
const now = () => new Date();
const opp = (over) => insertListing(db, 'participation_opportunities', opportunityRow({ now: now(), ...over }));
const prof = (over) => insertListing(db, 'participation_profiles', profileRow({ now: now(), ...over }));
const rejection = (promise) => promise.then(() => null, (error) => error);

// ------------------------------------------------------------------- drift

test('the transcribed screen lines still match the two Explore screens character for character, and the registry paths are the routes', async () => {
  const mine = await readFile(new URL('./helpers/frontendB18.mjs', import.meta.url), 'utf8');
  for (const [file, fragments] of Object.entries(fe.FRAGMENTS)) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const fragment of fragments) {
      assert.ok(source.includes(fragment), `${file} no longer contains: ${fragment}`);
      assert.ok(mine.includes(fragment), `the transcription no longer contains: ${fragment}`);
    }
  }
  const runtime = await readFile(new URL('../lib/frontend/production/runtime.ts', import.meta.url), 'utf8');
  for (const line of [
    "'opportunities.search': {path:'/api/opportunities'},",
    "'opportunities.detail': {path:'/api/opportunities/detail'},",
    "'organizations.search': {path:'/api/explore/organizations'},",
  ]) assert.ok(runtime.includes(line), line);
});

// ---------------------------------------------------- nothing verified yet

test('with no verified listing the honest empty states: no reviewed local coverage, and no organizations returned', async () => {
  await opp({ id: 'unverified', verified: false });
  await prof({ id: 'unverified', verified: false });
  const w = createWorld(db);
  const s = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
  assert.ok(s.result, 'the body passes validOpportunityResults');
  assert.deepEqual(s.live.data, { items: [], nextCursor: null, areaLabel: 'Mecklenburg County, NC', checkedAt: '', availability: 'no_coverage', complete: false });
  assert.equal(s.empty, 'No reviewed local coverage');
  assert.equal(s.status, null);
  assert.equal(s.location, 'Mecklenburg County, NC');
  assert.equal(s.coverage, 'Sources checked . More listings may be available.');
  const o = await fe.organizationsScreen(w.runtime(), { area: MECKLENBURG });
  assert.deepEqual(o.live.data, { items: [], complete: false, nextCursor: null });
  assert.equal(o.line, 'No matching organizations were returned. Try the official discovery routes.');
  // And the unverified listing has no detail either: the same 404 as an unknown id.
  const missing = await rejection(w.runtime().request('opportunities.detail', { id: 'unverified' }));
  const unknown = await rejection(w.runtime().request('opportunities.detail', { id: 'never-existed' }));
  assert.ok(missing instanceof FrontendServiceError && missing.code === 'unavailable');
  assert.deepEqual([unknown.code, unknown.message], [missing.code, missing.message]);
  const raw = await w.get(PATHS.detail, q({ id: 'unverified' }));
  assert.equal(raw.status, 404);
  assert.deepEqual(w.h.blockedFetches, []);
});

// ------------------------------------------------------ verified listings

test('verified listings: the screen shows the upcoming and rolling ones, never a started, cancelled, full, postponed or stale one; each detail is valid', async () => {
  await opp({ id: 'soon', startsInDays: 2, title: 'Soon cleanup' });
  await opp({ id: 'later', startsInDays: 9, interest: 'Trees & habitat', artwork: 'tree', title: 'Tree planting' });
  await opp({ id: 'program', kind: 'rolling', title: 'Adopt a stream', time_label: 'Any week, on your schedule' });
  await opp({ id: 'started', startsInDays: -0.01 });
  await opp({ id: 'cancelled', status: 'cancelled' });
  await opp({ id: 'full', status: 'full' });
  await opp({ id: 'postponed', status: 'postponed' });
  await opp({ id: 'stale', verifiedDaysAgo: 40 });
  await opp({ id: 'meeting', startsInDays: 4, title: 'Meeting point test', meeting_address: '1 Creek Road, Charlotte, NC 28208',
    venue_timezone: 'America/New_York', venue_timezone_basis: 'source' });
  const w = createWorld(db);
  const s = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
  assert.ok(s.result);
  assert.equal(s.result.availability, 'ready');
  assert.deepEqual(s.shown, ['soon', 'meeting', 'later', 'program']);
  assert.deepEqual(s.result.items.map((item) => item.id), s.shown, 'the server sent nothing the screen hides');
  assert.equal(s.empty, null);
  assert.equal(s.staleCoverage, false);
  assert.match(s.coverage, /^Sources checked \d{4}-\d{2}-\d{2}\. More listings may be available\.$/);
  const program = s.result.items.find((item) => item.id === 'program');
  assert.equal(program.kind, 'rolling');
  assert.equal(fe.opportunityState(program, Date.now()), 'rolling');
  assert.ok(!('startsAt' in program));
  const meeting = s.result.items.find((item) => item.id === 'meeting');
  assert.equal(meeting.address, '1 Creek Road, Charlotte, NC 28208');
  assert.equal(meeting.venue, 'Creek greenway trailhead');
  assert.equal(meeting.venueTimezoneBasis, 'source');
  // The detail: the same item for a listed one, and the client labels the others.
  for (const [id, state] of [['soon', 'upcoming'], ['cancelled', 'cancelled'], ['full', 'full'], ['postponed', 'postponed'], ['started', 'past'], ['stale', 'needs-check']]) {
    const item = await w.runtime().request('opportunities.detail', { id });
    assert.ok(fe.validOpportunity(item), id);
    assert.equal(fe.opportunityState(item, Date.now()), state, id);
  }
  assert.deepEqual(await w.runtime().request('opportunities.detail', { id: 'soon' }), s.result.items[0]);
});

test('the area: a city and a ZIP see their county\'s listings by Census point; a neighbouring county sees none; no area is no coverage', async () => {
  await opp({ id: 'mecklenburg' });
  await opp({ id: 'statewide', served_place_ids: ['us-state:NC'], title: 'Statewide program', kind: 'rolling', time_label: 'Any time' });
  await prof({ id: 'meck-profile' });
  const w = createWorld(db);
  for (const area of [MECKLENBURG, CHARLOTTE, ZIP_28208]) {
    const s = await fe.opportunitiesScreen(w.runtime(), { area });
    assert.deepEqual(s.shown, ['mecklenburg', 'statewide'], area.label);
    assert.equal(s.location, area.label);
    assert.deepEqual((await fe.organizationsScreen(w.runtime(), { area })).shown, ['meck-profile'], area.label);
  }
  const union = await fe.opportunitiesScreen(w.runtime(), { area: UNION });
  assert.deepEqual(union.shown, ['statewide']);
  assert.deepEqual((await fe.organizationsScreen(w.runtime(), { area: UNION })).shown, []);
  const none = await fe.opportunitiesScreen(w.runtime());
  assert.deepEqual([none.result.availability, none.shown, none.location, none.empty], ['no_coverage', [], 'Choose your area', 'No reviewed local coverage']);
  // An id outside the gazetteer is no area, never a guess.
  const outside = await fe.opportunitiesScreen(w.runtime(), { area: { id: 'us-county:45091', place: 'York County', state: 'SC', label: 'York County, SC', timezone: 'America/New_York' } });
  assert.deepEqual([outside.result.availability, outside.result.areaLabel], ['no_coverage', '']);
  // Nothing about distance anywhere in an answer.
  assert.ok(!/distance|radius|near/i.test(JSON.stringify((await fe.opportunitiesScreen(w.runtime(), { area: CHARLOTTE })).live.data)));
});

test('filters: an interest, a search or a timing that removes every listing is empty, not no coverage', async () => {
  await opp({ id: 'cleanup' });
  await opp({ id: 'garden-day', interest: 'Gardening', artwork: 'garden', title: 'Garden workday', summary: 'Weed the community beds.' });
  await opp({ id: 'program', kind: 'rolling', title: 'Adopt a stream', time_label: 'Any week' });
  await prof({ id: 'cleanups' });
  await prof({ id: 'garden-club', interest: 'Gardening', title: 'Join the garden club', work: 'Weekly garden help.' });
  const w = createWorld(db);
  const r = w.runtime();
  assert.deepEqual((await fe.opportunitiesScreen(r, { area: MECKLENBURG, interest: 'Gardening' })).shown, ['garden-day']);
  assert.deepEqual((await fe.opportunitiesScreen(r, { area: MECKLENBURG, search: 'WEED beds' })).shown, ['garden-day']);
  assert.deepEqual((await fe.opportunitiesScreen(r, { area: MECKLENBURG, timing: 'rolling' })).shown, ['program']);
  assert.deepEqual((await fe.opportunitiesScreen(r, { area: MECKLENBURG, timing: 'upcoming' })).shown.sort(), ['cleanup', 'garden-day']);
  const none = await fe.opportunitiesScreen(r, { area: MECKLENBURG, interest: 'Community learning' });
  assert.deepEqual([none.result.availability, none.empty], ['empty', 'No matching upcoming listings']);
  assert.match(none.coverage, /^Sources checked \d{4}-\d{2}-\d{2}\./, 'the area still has checked coverage');
  assert.deepEqual((await fe.organizationsScreen(r, { area: MECKLENBURG, interest: 'Gardening' })).shown, ['garden-club']);
  assert.deepEqual((await fe.organizationsScreen(r, { area: MECKLENBURG, search: 'garden club' })).shown, ['garden-club']);
});

test('pagination: 20 a page with an opaque cursor bound to its query; a cursor from another query is a validation error', async () => {
  for (let at = 0; at < 25; at += 1) await opp({ id: `program-${String(at).padStart(2, '0')}`, kind: 'rolling', title: `Program ${String(at).padStart(2, '0')}`, time_label: 'Any week' });
  for (let at = 0; at < 22; at += 1) await prof({ id: `profile-${String(at).padStart(2, '0')}`, title: `Profile ${String(at).padStart(2, '0')}` });
  const w = createWorld(db);
  const first = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
  assert.equal(first.shown.length, 20);
  assert.ok(first.next);
  const second = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG, cursor: first.next });
  assert.deepEqual(second.shown, ['program-20', 'program-21', 'program-22', 'program-23', 'program-24']);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.shown, ...second.shown]).size, 25);
  const crossed = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG, interest: 'Gardening', cursor: first.next });
  assert.deepEqual([crossed.result, crossed.status, crossed.empty], [null, VALIDATION, null]);
  const forged = await w.get(PATHS.opportunities, q({ area: JSON.stringify(MECKLENBURG), cursor: 'bm90LWEtY3Vyc29y' }));
  assert.equal(forged.status, 400);
  const orgs = await fe.organizationsScreen(w.runtime(), { area: MECKLENBURG });
  assert.equal(orgs.shown.length, 20);
  const orgs2 = await fe.organizationsScreen(w.runtime(), { area: MECKLENBURG, cursor: orgs.next });
  assert.deepEqual(orgs2.shown, ['profile-20', 'profile-21']);
  assert.equal(orgs2.next, null);
});

test('two households, a foreign home context and a smuggled profile id get the identical body; only the area and the clock reach the database', async () => {
  await opp({ id: 'soon' });
  await prof({ id: 'meck-profile' });
  const w = createWorld(db);
  const query = q({ area: JSON.stringify(MECKLENBURG), interest: 'All interests', search: '', timing: 'all', profile_id: w.h.identities.bob.id });
  const strip = (body) => body;
  const a = strip(await (await w.get(PATHS.opportunities, query, { as: 'alice' })).json());
  const b = strip(await (await w.get(PATHS.opportunities, query, { as: 'bob', headers: { 'X-Halo-Home-Context': crypto.randomUUID() } })).json());
  assert.deepEqual(a, b);
  const oa = await (await w.get(PATHS.organizations, query, { as: 'alice' })).json();
  const ob = await (await w.get(PATHS.organizations, query, { as: 'bob' })).json();
  assert.deepEqual(oa, ob);
  for (const call of w.calls) {
    assert.deepEqual(Object.keys(call.args).sort(), call.name === 'read_participation_opportunity' ? ['p_id', 'p_now'] : ['p_now', 'p_place_ids']);
    if (call.args.p_place_ids) assert.deepEqual(call.args.p_place_ids, ['us-county:37119', 'us-state:NC']);
  }
  assert.deepEqual(w.h.db.queryLog, [], 'no table is read through the client');
});

// -------------------------------------------------------------- refusals

test('no session is a 401; the flag off is the non-retryable 503 with nothing read, and the screens show an error, never "no matches"', async () => {
  await opp({ id: 'soon' });
  const w = createWorld(db, { env: {} });
  for (const path of Object.values(PATHS)) {
    const res = await w.get(path, path === PATHS.detail ? q({ id: 'soon' }) : '', { as: null });
    assert.equal(res.status, 401, path);
    const off = await w.get(path, path === PATHS.detail ? q({ id: 'soon' }) : '');
    assert.equal(off.status, 503, path);
    const body = await off.json();
    assert.deepEqual([body.code, body.retryable], ['feature_unavailable', false]);
    assert.equal(off.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.deepEqual(w.calls, [], 'off by the flag nothing is read');
  const s = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
  assert.deepEqual([s.result, s.status, s.empty], [null, LISTINGS_OFF, null]);
  const o = await fe.organizationsScreen(w.runtime(), { area: MECKLENBURG });
  assert.equal(o.line, ORGANIZATIONS_OFF);
});

test('before 0032 every route is the same 503; a failed directory read is a 500; neither is ever an empty list on screen', async (t) => {
  const before0032 = createWorld(db, { migrated: false });
  for (const path of Object.values(PATHS)) {
    const res = await before0032.get(path, path === PATHS.detail ? q({ id: 'soon' }) : q({ area: JSON.stringify(MECKLENBURG) }));
    assert.equal(res.status, 503, path);
    assert.equal((await res.json()).code, 'feature_unavailable');
  }
  // Even with no area, the read is made, so a missing migration is never answered as "no coverage".
  assert.equal((await before0032.get(PATHS.opportunities)).status, 503);
  const failing = createWorld(db, { wrap: {
    read_participation_opportunities: () => { throw rpcError('57014', 'canceling statement due to statement timeout'); },
    read_participation_profiles: () => { throw rpcError('08006', 'connection failure'); },
    read_participation_opportunity: () => { throw rpcError('XX000', 'internal'); },
  } });
  const errors = muteConsoleError(t);
  for (const path of Object.values(PATHS)) {
    const res = await failing.get(path, path === PATHS.detail ? q({ id: 'soon' }) : q({ area: JSON.stringify(MECKLENBURG) }));
    assert.equal(res.status, 500, path);
    assert.ok(!('items' in await res.json()));
  }
  assert.ok(errors.mock.calls.every((call) => !JSON.stringify(call).includes('us-county')), 'no area id in a log line');
  const s = await fe.opportunitiesScreen(failing.runtime(), { area: MECKLENBURG });
  assert.deepEqual([s.result, s.status, s.empty], [null, UNAVAILABLE, null]);
  const o = await fe.organizationsScreen(failing.runtime(), { area: MECKLENBURG });
  assert.equal(o.line, UNAVAILABLE);
  const s0 = await fe.opportunitiesScreen(before0032.runtime(), { area: MECKLENBURG });
  assert.deepEqual([s0.status, s0.empty], [LISTINGS_OFF, null]);
});

test('malformed queries are 400s with field errors, before anything is read', async () => {
  const w = createWorld(db);
  const cases = [
    [PATHS.opportunities, { interest: 'Water' }, 'interest'],
    [PATHS.opportunities, { timing: 'soon' }, 'timing'],
    [PATHS.opportunities, { search: 'x'.repeat(161) }, 'search'],
    [PATHS.opportunities, { search: 'a\u0007b' }, 'search'],
    [PATHS.opportunities, { area: '{not json' }, 'area'],
    [PATHS.opportunities, { area: '"Charlotte"' }, 'area'],
    [PATHS.opportunities, { area: JSON.stringify({ id: 42 }) }, 'area'],
    [PATHS.organizations, { interest: 'Advocacy' }, 'interest'],
    [PATHS.organizations, { cursor: '!!' }, 'cursor'],
    [PATHS.detail, {}, 'id'],
    [PATHS.detail, { id: 'Not An Id' }, 'id'],
    [PATHS.detail, { id: 'x'.repeat(81) }, 'id'],
  ];
  for (const [path, params, field] of cases) {
    const res = await w.get(path, q(params));
    assert.equal(res.status, 400, `${path} ${JSON.stringify(params)}`);
    const body = await res.json();
    assert.deepEqual(body.field_errors.map((error) => error.field), [field]);
  }
  assert.deepEqual(w.calls, []);
  // Organizations take no timing: one sent is ignored, not refused.
  assert.equal((await w.get(PATHS.organizations, q({ timing: 'soon' }))).status, 200);
});

test('the limiter: a 429 with Retry-After keyed by the verified caller only, and an outage lets reads through', async (t) => {
  await opp({ id: 'soon' });
  const keys = [];
  const limited = createWorld(db, { rateLimit: (key) => { keys.push(key); return false; } });
  const res = await limited.get(PATHS.opportunities, q({ area: JSON.stringify(MECKLENBURG) }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  assert.deepEqual(keys, [`participation:${limited.h.identities.alice.id}`]);
  const s = await fe.opportunitiesScreen(limited.runtime(), { area: MECKLENBURG });
  assert.equal(s.status, 'Please wait before trying again.');
  muteConsoleError(t);
  const outage = createWorld(db, { rateLimit: () => LIMITER_UNAVAILABLE });
  assert.equal((await outage.get(PATHS.opportunities, q({ area: JSON.stringify(MECKLENBURG) }))).status, 200);
});

test('a stored row the client would refuse is withheld and the answer says partial; never repaired or sent', async (t) => {
  muteConsoleError(t);
  await opp({ id: 'good' });
  await prof({ id: 'good-profile' });
  const w = createWorld(db, { wrap: {
    read_participation_opportunities: async (_args, call) => [...await call(), { id: 'broken', title: 'No other fields' }],
    read_participation_profiles: async (_args, call) => [...await call(), { id: 'broken-profile', url: 'http://example.org' }],
    read_participation_opportunity: async () => ({ id: 'broken' }),
  } });
  const s = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
  assert.deepEqual([s.result.availability, s.shown], ['partial', ['good']]);
  assert.deepEqual((await fe.organizationsScreen(w.runtime(), { area: MECKLENBURG })).shown, ['good-profile']);
  const detail = await w.get(PATHS.detail, q({ id: 'broken' }));
  assert.equal(detail.status, 500);
});

test('every answer is bare, private and no-store, holds no em dash, and no route reached the network', async () => {
  await opp({ id: 'soon' });
  await prof({ id: 'meck-profile' });
  const w = createWorld(db);
  for (const [path, query] of [[PATHS.opportunities, q({ area: JSON.stringify(MECKLENBURG) })], [PATHS.organizations, q({ area: JSON.stringify(MECKLENBURG) })], [PATHS.detail, q({ id: 'soon' })], [PATHS.detail, q({ id: 'nope' })], [PATHS.opportunities, q({ interest: 'x' })]]) {
    const res = await w.get(path, query);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store', `${path}${query}`);
    const text = await res.text();
    assert.ok(!text.includes(String.fromCharCode(0x2014)), `${path}${query}`);
    assert.ok(!Object.hasOwn(JSON.parse(text), 'data'), 'never wrapped in data');
  }
  assert.deepEqual(w.h.blockedFetches, []);
});
