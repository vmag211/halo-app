/**
 * B18 adversarial probes (docs/backend/plans/b18-participation-directory.md).
 * Written to BREAK the directory against the plan's acceptance and against the
 * frontend's own consumption logic (real validators, real opportunityState,
 * the two screens transcribed in test/helpers/frontendB18.mjs).
 *
 * A "gap probe" inserts a row the migration owner could write by hand. The
 * property: either the 0032 CHECKs refuse it, or, once verified, the route
 * serves it in a form the client's validator accepts (availability `ready`,
 * the item on screen). A row that is accepted and then silently withheld, or
 * that turns a route into a 500, is a gap between the CHECKs and the client.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './db/pgliteHarness.mjs';
import { muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { createWorld, ensureOrg, insertListing, opportunityRow, profileRow, pgArray } from './helpers/participationWorld.mjs';
import * as fe from './helpers/frontendB18.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { placeById, allPlaces } from '../lib/places.js';
import { parseSearchQuery, placeIdsFor, searchOpportunities, searchOrganizations, readOpportunity, encodeCursor, MESSAGES } from '../lib/participation.js';

const { opportunityLocalDate } = await loadFrontend('explore-opportunities');

const MECKLENBURG = placeById('us-county:37119');
const EM = String.fromCharCode(0x2014);
const HOUR = 3600000;
const DAY = 86400000;
const UNAVAILABLE = 'This service is unavailable. Try again later.';
const PATHS = { opportunities: '/api/opportunities', detail: '/api/opportunities/detail', organizations: '/api/explore/organizations' };
const q = (params) => `?${new URLSearchParams(params)}`;
const AREA = JSON.stringify(MECKLENBURG);

let db;
before(async () => {
  db = await createDb();
  await ensureOrg(db);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.participation_opportunities; delete from public.participation_profiles;');
});

const real = () => new Date();
const opp = (over) => insertListing(db, 'participation_opportunities', opportunityRow({ now: real(), ...over }));
const prof = (over) => insertListing(db, 'participation_profiles', profileRow({ now: real(), ...over }));

/** A supabase-like client over the REAL 0032 read functions, at a chosen session time zone. */
function sqlClient({ tz } = {}) {
  const sigs = {
    read_participation_opportunities: [['p_place_ids', 'text[]'], ['p_now', 'timestamptz']],
    read_participation_opportunity: [['p_id', 'text'], ['p_now', 'timestamptz']],
    read_participation_profiles: [['p_place_ids', 'text[]'], ['p_now', 'timestamptz']],
  };
  return {
    async rpc(name, args) {
      const params = sigs[name];
      const sql = `select public.${name}(${params.map(([, type], at) => `$${at + 1}::${type}`).join(', ')}) as result`;
      const values = params.map(([param, type]) => (type === 'text[]' ? pgArray(args[param] ?? []) : args[param] ?? null));
      try {
        const data = await db.asService(async (tx) => {
          if (tz) await tx.exec(`set local timezone = '${tz}'`);
          return (await tx.query(sql, values)).rows[0].result;
        });
        return { data, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  };
}

const FIXED = new Date('2026-10-20T12:00:00Z');
const queryOf = (extra = {}, { withTiming = true, area = AREA } = {}) => {
  const params = new URLSearchParams(area === null ? {} : { area });
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const parsed = parseSearchQuery(params, { withTiming });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
};

/** Every page of the search at `now`, following cursors. */
async function drain(sb, now, extra = {}) {
  const items = [];
  let cursor = null;
  let first = null;
  for (let page = 0; page < 80; page += 1) {
    const result = await searchOpportunities(sb, queryOf(cursor ? { ...extra, cursor } : extra), now);
    first ??= result;
    assert.ok(fe.validOpportunityResults(result), 'every page passes validOpportunityResults');
    items.push(...result.items);
    if (!result.nextCursor) return { items, first };
    cursor = result.nextCursor;
  }
  throw new Error('pagination did not end');
}

// =========================================================== route inputs

test('area: arrays, nested ids, huge and non-object JSON are 400; an unknown or hostile id is no area, never a 500', async () => {
  const w = createWorld(db);
  for (const area of ['[]', '[{"id":"us-county:37119"}]', 'null', '1', '"x"', '{"id":{"a":1}}', '{"id":["us-county:37119"]}', '{"id":true}',
    JSON.stringify({ id: 'x'.repeat(81) }), JSON.stringify({ id: 'us-county:37119', pad: 'x'.repeat(2000) }), '', '{', '{"id":"us-county:37119"}{"id":"x"}']) {
    const res = await w.get(PATHS.opportunities, q({ area }));
    assert.equal(res.status, 400, JSON.stringify(area).slice(0, 60));
    const body = await res.json();
    assert.deepEqual(body.field_errors.map((e) => e.field), ['area']);
    assert.ok(!JSON.stringify(body).includes('xxxxxxxx'), 'input not echoed');
  }
  for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'us-county:３７１１９', 'US-COUNTY:37119', 'us-county:37119 ', ' us-county:37119',
    'us-county:37119\n', 'us-county:99999', '‮', '😀', 'us-state:SC', 'us-state:NC']) {
    const res = await w.get(PATHS.opportunities, q({ area: JSON.stringify({ id }) }));
    assert.equal(res.status, 200, id);
    const body = await res.json();
    assert.ok(fe.validOpportunityResults(body), id);
    assert.equal(body.availability, 'no_coverage', id);
  }
  // Same for organizations.
  for (const id of ['constructor', '__proto__']) assert.equal((await w.get(PATHS.organizations, q({ area: JSON.stringify({ id }) }))).status, 200);
});

test('area: every gazetteer place resolves without throwing, includes its own id and the statewide id, and a place in no county still works', async () => {
  const noCounty = [];
  for (const place of allPlaces()) {
    const ids = placeIdsFor(place);
    assert.ok(ids.includes(place.id) && ids.includes('us-state:NC'), place.id);
    assert.ok(ids.every((id) => /^(us-state:NC|us-county:37\d{3}|us-place:37\d{5}|us-zcta:\d{5})$/.test(id)), `${place.id} -> ${ids}`);
    if (!place.id.startsWith('us-county:') && ids.length === 2) noCounty.push(place.id);
  }
  // Serve a statewide listing and an own-id listing for a place with no county, if one exists.
  await opp({ id: 'statewide-one', served_place_ids: ['us-state:NC'], kind: 'rolling', time_label: 'Any time' });
  if (noCounty.length) {
    const target = noCounty[0];
    await opp({ id: 'own-id-only', served_place_ids: [target], kind: 'rolling', time_label: 'Any time', title: 'Own id' });
    const w = createWorld(db);
    const s = await fe.opportunitiesScreen(w.runtime(), { area: placeById(target) });
    assert.deepEqual(s.shown.sort(), ['own-id-only', 'statewide-one']);
  }
});

test('search: regex characters, unicode, whitespace and the 160 boundary are literal text and never an error', async () => {
  await opp({ id: 'plain', title: 'Creek (cleanup) [A+B] $1', summary: 'Litter pickup at the Straße by İstanbul Road.' });
  await opp({ id: 'plain-2', title: 'Other thing', summary: 'Nothing special here.' });
  const w = createWorld(db);
  const shown = async (search) => (await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG, search })).shown;
  assert.deepEqual(await shown('(cleanup)'), ['plain']);
  assert.deepEqual(await shown('[A+B]'), ['plain']);
  assert.deepEqual(await shown('$1'), ['plain']);
  assert.deepEqual(await shown('.*'), [], 'a regex is not a wildcard');
  assert.deepEqual(await shown('\\'), []);
  assert.deepEqual(await shown('straße'), ['plain']);
  assert.deepEqual(await shown('STRASSE'), [], 'no ß folding on either side (fixture parity)');
  assert.deepEqual(await shown('İstanbul'), ['plain']);
  assert.deepEqual(await shown('istanbul'), [], 'no accent folding (fixture parity)');
  assert.deepEqual((await shown('   ')).sort(), ['plain', 'plain-2']);
  assert.deepEqual(await shown(' creek '), ['plain'], 'NBSP is whitespace like the fixture');
  for (const search of ['x'.repeat(160), '😀'.repeat(80)]) assert.equal((await w.get(PATHS.opportunities, q({ area: AREA, search }))).status, 200, `${search.length}`);
  for (const search of ['x'.repeat(161), '😀'.repeat(81)]) assert.equal((await w.get(PATHS.opportunities, q({ area: AREA, search }))).status, 400, `${search.length}`);
  // Raw percent-encoded oddities.
  for (const raw of ['%ED%A0%80', '%00', '%1F', '%7F', '%C2%80', '%E2%80%94']) {
    const res = await w.get(PATHS.opportunities, `?area=${encodeURIComponent(AREA)}&search=${raw}`);
    assert.ok([200, 400].includes(res.status), raw);
    assert.ok(!(await res.text()).includes(EM));
  }
});

test('repeated query keys: the first value decides, deterministically, and a bad later value cannot change the answer or crash', async () => {
  await opp({ id: 'a' });
  const w = createWorld(db);
  const base = `area=${encodeURIComponent(AREA)}`;
  const one = await (await w.get(PATHS.opportunities, `?${base}&interest=Cleanup`)).json();
  const two = await w.get(PATHS.opportunities, `?${base}&interest=Cleanup&interest=Water`);
  assert.equal(two.status, 200);
  assert.deepEqual(await two.json(), one);
  const flipped = await w.get(PATHS.opportunities, `?${base}&interest=Water&interest=Cleanup`);
  assert.equal(flipped.status, 400);
  const dupArea = await w.get(PATHS.opportunities, `?${base}&area=%7B%7D`);
  assert.equal(dupArea.status, 200);
  assert.equal((await dupArea.json()).availability, 'ready');
});

test('cursor tampering: offsets that are negative, fractional, unaligned, huge, unsafe or of another query are 400; past the end is an empty page, not an error', async () => {
  for (let at = 0; at < 25; at += 1) await opp({ id: `p-${String(at).padStart(2, '0')}`, kind: 'rolling', title: `Program ${String(at).padStart(2, '0')}`, time_label: 'Any week' });
  const w = createWorld(db);
  const first = await (await w.get(PATHS.opportunities, q({ area: AREA }))).json();
  const decoded = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8'));
  const forge = (patch) => Buffer.from(JSON.stringify({ ...decoded, ...patch })).toString('base64url');
  const status = async (cursor) => (await w.get(PATHS.opportunities, q({ area: AREA, cursor }))).status;
  for (const o of [0, -20, 10, 30, 21, 20.5, 1e21, Number.MAX_SAFE_INTEGER + 1, '20', null, [20], { a: 1 }, true]) assert.equal(await status(forge({ o })), 400, JSON.stringify(o));
  assert.equal(await status(forge({ v: 2 })), 400);
  assert.equal(await status(forge({ q: 'other' })), 400);
  assert.equal(await status(Buffer.from('[20]').toString('base64url')), 400);
  assert.equal(await status(first.nextCursor + '='), 400);
  assert.equal(await status(first.nextCursor + 'A'.repeat(2000)), 400);
  assert.equal(await status(first.nextCursor.slice(0, -2)), 400);
  assert.equal(await status(''), 400);
  assert.equal(await status(Buffer.from('{"v":1,"o":20,"q":"x"').toString('base64url')), 400);
  // Valid, aligned, but beyond the list: an empty page with no next cursor, still valid for the client.
  for (const o of [40, 60, 2000]) {
    const res = await w.get(PATHS.opportunities, q({ area: AREA, cursor: forge({ o }) }));
    assert.equal(res.status, 200, String(o));
    const body = await res.json();
    assert.ok(fe.validOpportunityResults(body));
    assert.deepEqual([body.items.length, body.nextCursor], [0, null]);
  }
});

test('a cursor from the opportunities route is bound to ITS query: the organizations route must not accept it (plan P9)', async () => {
  for (let at = 0; at < 25; at += 1) await opp({ id: `p-${String(at).padStart(2, '0')}`, kind: 'rolling', title: `Program ${String(at).padStart(2, '0')}`, time_label: 'Any week' });
  for (let at = 0; at < 25; at += 1) await prof({ id: `o-${String(at).padStart(2, '0')}`, title: `Org ${String(at).padStart(2, '0')}` });
  const w = createWorld(db);
  const first = await (await w.get(PATHS.opportunities, q({ area: AREA }))).json();
  const res = await w.get(PATHS.organizations, q({ area: AREA, cursor: first.nextCursor }));
  assert.equal(res.status, 400, 'the cursor key has no route in it, so a cursor from another route is accepted');
});

test('detail ids at the boundary: 80 characters ok (404 when unknown), 81, empty, hostile and repeated ids are 400, and a stored 80-character id is served', async () => {
  const id80 = `a${'b'.repeat(79)}`;
  await opp({ id: id80, kind: 'rolling', time_label: 'Any time' });
  const w = createWorld(db);
  assert.equal((await w.get(PATHS.detail, q({ id: id80 }))).status, 200);
  assert.equal((await w.get(PATHS.detail, q({ id: `a${'b'.repeat(78)}` }))).status, 404);
  assert.equal((await w.get(PATHS.detail, q({ id: `a${'b'.repeat(80)}` }))).status, 400);
  for (const id of ['', ' ', '-a', 'A', 'a b', 'a\n', 'a%', "a'; drop table x;--", 'é', 'a/b', '../x', '😀']) {
    assert.equal((await w.get(PATHS.detail, q({ id }))).status, 400, JSON.stringify(id));
  }
  const dup = await w.get(PATHS.detail, `?id=${id80}&id=nope`);
  assert.equal(dup.status, 200);
  assert.equal((await w.get(PATHS.detail, `?id=nope&id=${id80}`)).status, 404);
  // A one-character id.
  await opp({ id: 'z', kind: 'rolling', time_label: 'Any time', title: 'Z' });
  assert.equal((await w.get(PATHS.detail, q({ id: 'z' }))).status, 200);
});

// ====================================================== time boundaries

test('a served search item is ALWAYS upcoming or rolling on the screen: sweep of start and verification instants against four server clocks', async () => {
  const rows = [];
  const verifiedOffsets = [0, -1, 1, HOUR, 12 * HOUR, 23 * HOUR + 59 * 60000, DAY, 28 * DAY, 29 * DAY - 1, 29 * DAY, 29 * DAY + 1, 29 * DAY + HOUR, 30 * DAY, 31 * DAY, -1000, -HOUR, -DAY];
  const startOffsets = [-1, 0, 1, 1000, HOUR, DAY];
  let n = 0;
  for (const kind of ['scheduled', 'rolling']) {
    for (const v of verifiedOffsets) {
      for (const s of kind === 'scheduled' ? startOffsets : [0]) {
        const id = `sweep-${n += 1}`;
        rows.push(opportunityRow({
          id, kind, now: FIXED, title: `Sweep ${String(n).padStart(3, '0')}`, time_label: 'Sweep', startsInDays: s / DAY,
          verified_at: new Date(FIXED.getTime() - v), verified_by: 'VM',
        }));
      }
    }
  }
  for (const row of rows) await insertListing(db, 'participation_opportunities', row);
  for (const serverNow of [new Date('2026-10-20T00:00:00Z'), new Date('2026-10-20T00:00:01Z'), new Date('2026-10-20T12:00:00Z'), new Date('2026-10-20T23:59:59Z')]) {
    // Rows were written relative to FIXED; move the clock instead of the rows.
    const { items } = await drain(sqlClient(), serverNow);
    for (const clientNow of [serverNow.getTime(), serverNow.getTime() + 1000]) {
      for (const item of items) {
        const state = fe.opportunityState(item, clientNow);
        // A start within the final second of slack is the one unavoidable race.
        if (item.kind === 'scheduled' && Date.parse(item.startsAt) <= clientNow) continue;
        assert.ok(['upcoming', 'rolling'].includes(state), `${item.id} ${item.checkedAt} start ${item.startsAt} is ${state} at ${new Date(clientNow).toISOString()} (server ${serverNow.toISOString()})`);
      }
    }
  }
});

test('boundaries: starts exactly now is not served, one minute later is; verified exactly 29 days ago at midnight UTC is served, a second before the cutoff is not; verified in the future is not served and has no detail', async () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const midnight29 = new Date('2026-09-21T00:00:00Z');
  await insertListing(db, 'participation_opportunities', opportunityRow({ id: 'starts-now', now, verifiedDaysAgo: 1, starts_at: new Date(now.getTime()), ends_at: new Date(now.getTime() + 3 * HOUR) }));
  await insertListing(db, 'participation_opportunities', opportunityRow({ id: 'starts-soon', now, verifiedDaysAgo: 1, title: 'Starts soon', starts_at: new Date(now.getTime() + 60000), ends_at: new Date(now.getTime() + 3 * HOUR) }));
  await insertListing(db, 'participation_opportunities', opportunityRow({ id: 'v-midnight-29', now, kind: 'rolling', verified_at: midnight29, title: 'Verified at midnight 29' }));
  await insertListing(db, 'participation_opportunities', opportunityRow({ id: 'v-30', now, kind: 'rolling', verified_at: new Date(midnight29.getTime() - 1000), title: 'Verified before cutoff' }));
  await insertListing(db, 'participation_opportunities', opportunityRow({ id: 'v-future', now, kind: 'rolling', verified_at: new Date(now.getTime() + 1000), title: 'Verified future' }));
  await insertListing(db, 'participation_opportunities', opportunityRow({ id: 'v-now', now, kind: 'rolling', verified_at: now, title: 'Verified now' }));
  const sb = sqlClient();
  const { items } = await drain(sb, now);
  assert.deepEqual(items.map((i) => i.id).sort(), ['starts-soon', 'v-midnight-29', 'v-now']);
  for (const item of items) assert.ok(['upcoming', 'rolling'].includes(fe.opportunityState(item, now.getTime())), item.id);
  assert.equal(await readOpportunity(sb, 'v-future', now), null);
  assert.ok(await readOpportunity(sb, 'v-now', now));
  // Late in the same UTC day, the 29-day day-start boundary moves: the midnight listing is no longer served.
  const late = new Date('2026-10-20T23:59:59Z');
  const lateItems = (await drain(sb, late)).items.map((i) => i.id);
  assert.ok(!lateItems.includes('v-midnight-29'), 'verified on the 21st of September is 29 days and 23h59 old at 23:59:59, which is more than 29 days');
});

test('profiles: served while the verification day starts within 180 days of the clock, not a day older, never when verified in the future', async () => {
  const now = new Date('2026-10-20T12:00:00Z');
  await insertListing(db, 'participation_profiles', profileRow({ id: 'p-fresh', now, verified_at: new Date('2026-04-24T00:00:00Z'), verified_by: 'VM' }));
  await insertListing(db, 'participation_profiles', profileRow({ id: 'p-edge', now, title: 'Edge', verified_at: new Date('2026-04-23T23:59:59Z'), verified_by: 'VM' }));
  await insertListing(db, 'participation_profiles', profileRow({ id: 'p-old', now, title: 'Old', verified_at: new Date('2026-04-22T23:59:59Z'), verified_by: 'VM' }));
  await insertListing(db, 'participation_profiles', profileRow({ id: 'p-future', now, title: 'Future', verified_at: new Date(now.getTime() + 1), verified_by: 'VM' }));
  const result = await searchOrganizations(sqlClient(), queryOf({}, { withTiming: false }), now);
  assert.ok(fe.validOrganizations(result));
  assert.deepEqual(result.items.map((i) => i.id), ['p-fresh'], 'only a verification on 24 April or later is within 180 days by day');
});

test('the session time zone never changes an answer: every served instant and date is identical under Pacific/Kiritimati and America/Pago_Pago', async () => {
  await opp({ id: 'tz-1', venue_timezone: 'Pacific/Kiritimati', venue_timezone_basis: 'source', venue_local_date: null, startsInDays: 5, title: 'Tz one' });
  await opp({ id: 'tz-2', kind: 'rolling', verified_at: new Date(Date.now() - 29 * DAY + 30000), title: 'Tz two', time_label: 'Any time' });
  const now = real();
  const utc = JSON.stringify((await drain(sqlClient({ tz: 'UTC' }), now)).items);
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York']) {
    assert.equal(JSON.stringify((await drain(sqlClient({ tz }), now)).items), utc, tz);
  }
});

test('DST and date-line: for every PostgreSQL zone the CHECK/trigger accepts, the database date equals the client\'s Intl date at the instants around transitions, and every accepted zone name passes the client', async () => {
  const names = (await db.query(`select name from pg_catalog.pg_timezone_names where name ~ '^([A-Za-z]+(/[A-Za-z0-9_+-]+)+|UTC)$'`)).rows.map((r) => r.name);
  assert.ok(names.length > 100, `only ${names.length} zones`);
  const instants = ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-03-29T00:59:59Z', '2026-03-29T01:00:00Z', '2026-04-05T02:59:59Z', '2026-04-05T03:00:00Z',
    '2026-10-04T15:29:59Z', '2026-10-04T15:30:00Z', '2026-10-25T00:59:59Z', '2026-10-25T01:00:00Z', '2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z', '2026-12-31T23:59:59Z',
    '2026-12-31T10:00:00Z', '2026-06-30T23:30:00Z', '2027-01-01T00:00:00Z'];
  const badZones = [];
  for (const name of names) {
    try { new Intl.DateTimeFormat('en', { timeZone: name }).format(); } catch { badZones.push(name); }
  }
  const mismatches = [];
  const rows = (await db.query(`select z.name, i.ts::text as ts, (i.ts at time zone z.name)::date::text as d from unnest($1::text[]) z(name), unnest($2::timestamptz[]) i(ts)`, [pgArray(names), pgArray(instants)])).rows;
  for (const { name, ts, d } of rows) {
    if (badZones.includes(name)) continue;
    const iso = new Date(ts).toISOString();
    const parts = new Intl.DateTimeFormat('en', { timeZone: name, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const part = (t) => parts.find((p) => p.type === t).value;
    const derived = `${part('year')}-${part('month')}-${part('day')}`;
    if (derived !== d) mismatches.push(`${name} @ ${iso}: sql ${d} intl ${derived}`);
  }
  assert.deepEqual(badZones, [], 'zone names PostgreSQL knows and the trigger accepts but the client\'s Intl refuses (the row would be withheld)');
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} date disagreements`);
});

test('a source-zone listing through DST gaps and folds is served and valid, venueLocalDate agreeing with the client\'s own derivation', async () => {
  const cases = [
    ['America/New_York', '2026-11-01T05:30:00Z'], ['America/New_York', '2026-11-01T06:30:00Z'], ['America/New_York', '2027-03-14T06:59:00Z'], ['America/New_York', '2027-03-14T07:01:00Z'],
    ['Australia/Lord_Howe', '2027-04-03T15:15:00Z'], ['Pacific/Kiritimati', '2026-12-31T10:00:00Z'], ['Pacific/Pago_Pago', '2026-12-31T10:00:00Z'], ['Asia/Kolkata', '2026-12-31T19:00:00Z'],
    ['America/St_Johns', '2026-11-01T02:45:00Z'], ['UTC', '2026-12-31T23:59:00Z'],
  ];
  let n = 0;
  for (const [zone, start] of cases) {
    n += 1;
    const date = (await db.query(`select (($1::timestamptz) at time zone $2)::date::text as d`, [start, zone])).rows[0].d;
    await insertListing(db, 'participation_opportunities', opportunityRow({
      id: `dst-${n}`, title: `Dst ${String(n).padStart(2, '0')}`, now: FIXED, starts_at: new Date(start), ends_at: new Date(Date.parse(start) + 2 * HOUR), kind: 'scheduled',
      venue_timezone: zone, venue_timezone_basis: 'source', venue_local_date: date,
    }));
  }
  const now = new Date('2026-10-20T12:00:00Z');
  const sb = sqlClient();
  const { items, first } = await drain(sb, now);
  assert.equal(first.availability, 'ready');
  assert.equal(items.length, cases.length);
  for (const item of items) {
    assert.ok(fe.validOpportunity(item), item.id);
    assert.equal(opportunityLocalDate(item), item.venueLocalDate, item.id);
  }
  // Re-verified detail equals the search item.
  for (const item of items) assert.deepEqual(await readOpportunity(sb, item.id, now), item);
});

test('a venue_local_date that disagrees with the source zone is refused by the trigger, on insert and on update', async () => {
  const bad = opportunityRow({ id: 'bad-date', now: FIXED, starts_at: new Date('2026-12-31T23:30:00Z'), ends_at: new Date('2027-01-01T01:00:00Z'),
    venue_timezone: 'America/New_York', venue_timezone_basis: 'source', venue_local_date: '2027-01-01' });
  await assert.rejects(insertListing(db, 'participation_opportunities', bad), /HALO_INVALID_INPUT/);
  await insertListing(db, 'participation_opportunities', { ...bad, venue_local_date: '2026-12-31' });
  await assert.rejects(db.query(`update public.participation_opportunities set venue_local_date = '2027-01-01' where id = 'bad-date'`), /HALO_INVALID_INPUT/);
  await assert.rejects(db.query(`update public.participation_opportunities set venue_timezone = 'Asia/Tokyo' where id = 'bad-date'`), /HALO_INVALID_INPUT/);
  await assert.rejects(db.query(`update public.participation_opportunities set venue_timezone = 'Nowhere/Land' where id = 'bad-date'`), /HALO_INVALID_INPUT/);
});

// ======================================================== SQL vs client

/**
 * Inserts `row` as the owner. Accepted means a person could write it, so the
 * route must then serve it validly (ready, on the screen, a valid detail).
 */
async function gapProbe(kind, row) {
  const table = kind === 'opportunity' ? 'participation_opportunities' : 'participation_profiles';
  try {
    await insertListing(db, table, row);
  } catch (error) {
    assert.ok(/check|violates|HALO_INVALID_INPUT|constraint/i.test(String(error?.message)), `unexpected failure: ${error?.message}`);
    return 'refused';
  }
  const w = createWorld(db);
  if (kind === 'opportunity') {
    const res = await w.get(PATHS.opportunities, q({ area: AREA }));
    const body = await res.json();
    assert.equal(res.status, 200);
    const ids = (body.items ?? []).map((i) => i.id);
    assert.equal(body.availability, 'ready', `accepted by the CHECKs but WITHHELD by the server (availability ${body.availability}); the screen would say "No matching upcoming listings"`);
    assert.ok(ids.includes(row.id), 'not served');
    assert.ok(fe.validOpportunityResults(body), 'fails the client validator');
    const detail = await w.get(PATHS.detail, q({ id: row.id }));
    assert.equal(detail.status, 200, `detail of an accepted, verified row answers ${detail.status}`);
    assert.ok(fe.validOpportunity(await detail.json()));
    const screen = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
    assert.ok(screen.shown.includes(row.id), 'hidden on screen');
  } else {
    const res = await w.get(PATHS.organizations, q({ area: AREA }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(fe.validOrganizations(body));
    assert.ok(body.items.some((i) => i.id === row.id), 'accepted by the CHECKs but SILENTLY DROPPED by the server (organizations have no availability field: the screen says "No matching organizations were returned")');
  }
  return 'served';
}

const oppCase = (name, over) => test(`gap: opportunity ${name}`, async (t) => { muteConsoleError(t); await gapProbe('opportunity', opportunityRow({ id: 'gap', now: real(), ...over })); });
const profCase = (name, over) => test(`gap: profile ${name}`, async (t) => { muteConsoleError(t); await gapProbe('profile', profileRow({ id: 'gap', now: real(), ...over })); });

// URL forms the client's `new URL` refuses.
oppCase('url with port 99999', { url: 'https://example.org:99999/x' });
oppCase('url with an impossible IPv4 host', { url: 'https://999.1.1.1/x' });
oppCase('url with a control character in the path', { url: 'https://example.org/a\u0001b' });
oppCase('url with an em dash in the path', { url: `https://example.org/a${EM}b` });
oppCase('url with a DEL and C1 control in the path', { url: 'https://example.org/a\u007f\u0085b' });
profCase('url with port 99999', { url: 'https://example.org:99999/x' });
profCase('url with an em dash in the path', { url: `https://example.org/a${EM}b` });
profCase('extra source with port 99999', { extra_sources: [{ title: 'More', url: 'https://example.org:99999/' }] });
profCase('extra source with an em dash in the url', { extra_sources: [{ title: 'More', url: `https://example.org/${EM}` }] });

// Whitespace-only and blank text the client trims or the server rejects.
for (const [label, blank] of [['tab', '\t'], ['newline', '\n'], ['no-break space', ' '], ['em space', ' '], ['ideographic space', '　'], ['carriage return', '\r']]) {
  oppCase(`summary only a ${label}`, { summary: blank });
  oppCase(`time_label only a ${label}`, { time_label: blank });
  oppCase(`work item only a ${label}`, { work: ['Pick up litter', blank] });
  oppCase(`cost only a ${label}`, { cost: blank });
  profCase(`mission only a ${label}`, { mission: blank });
  profCase(`step text only a ${label}`, { steps: [{ title: 'Choose', text: blank }] });
  profCase(`step title only a ${label}`, { steps: [{ title: blank, text: 'Use the page.' }] });
}

// Times the instant formatter cannot express exactly.
oppCase('start and end inside the same second', {
  starts_at: new Date('2026-12-01T10:00:00.200Z'), ends_at: new Date('2026-12-01T10:00:00.800Z'), startsInDays: undefined,
});
oppCase('start in year 10000', { starts_at: '10000-01-01T10:00:00Z', ends_at: '10000-01-01T12:00:00Z' });
oppCase('start with milliseconds', { starts_at: new Date(Date.now() + 5 * DAY + 123), ends_at: new Date(Date.now() + 5 * DAY + 3 * HOUR + 456) });

// Em dash in every other served column.
for (const column of ['organizer', 'title', 'time_label', 'area', 'venue', 'meeting_address', 'summary', 'duration', 'cost', 'age', 'access', 'bring', 'join_text', 'safety', 'verified_by']) {
  oppCase(`${column} with an em dash`, { [column]: `A${EM}B` });
}
oppCase('work item with an em dash', { work: [`A${EM}B`] });
for (const column of ['title', 'organizer', 'area', 'mission', 'work', 'source_title', 'effort', 'age', 'cost', 'access', 'bring', 'followup', 'contact', 'verified_by']) {
  profCase(`${column} with an em dash`, { [column]: `A${EM}B` });
}
profCase('address and role with an em dash', { address: `1 A${EM}B St`, address_kind: 'office', address_role: 'Office address.' });
profCase('address_role with an em dash', { address: '1 A St', address_kind: 'office', address_role: `Office${EM}only.` });
profCase('step with an em dash', { steps: [{ title: `A${EM}B`, text: 'x' }] });
profCase('extra source title with an em dash', { extra_sources: [{ title: `A${EM}B`, url: 'https://example.org/x' }] });

// Odd but allowed forms must be served.
oppCase('url with a normal query and fragment', { url: 'https://example.org/events?id=1&b=2#top' });
oppCase('url on a hyphenated multi-label host with a port', { url: 'https://a-b.example.co.uk:8443/e' });
oppCase('summary with angle brackets used as comparison (should the CHECK refuse it?)', { summary: 'Groups under <12 need a guardian.' });
oppCase('a very long url (2000 chars)', { url: `https://example.org/${'a'.repeat(1980)}` });
oppCase('a 20-item work list at 500 characters each', { work: Array.from({ length: 20 }, (_, i) => `${i} ${'w'.repeat(490)}`) });
oppCase('unicode text', { title: 'Cleanup at Straße 東京 😀', summary: 'Ünïcödé text with emoji 🌳.' });
profCase('30 steps at the maximum sizes', { steps: Array.from({ length: 30 }, (_, i) => ({ title: `Step ${i} ${'t'.repeat(190)}`, text: 'x'.repeat(1000) })) });
profCase('20 extra sources', { extra_sources: Array.from({ length: 20 }, (_, i) => ({ title: `Source ${i}`, url: `https://example.org/s${i}` })) });
profCase('address of each kind', { address: '1 Main St, Charlotte, NC', address_kind: 'meeting', address_role: 'Where volunteers meet.' });

test('a response that is large but legal still passes the client validators (20 maximum-size opportunities on one page)', async () => {
  for (let i = 0; i < 21; i += 1) {
    await opp({ id: `big-${String(i).padStart(2, '0')}`, title: `Big ${String(i).padStart(2, '0')} ${'t'.repeat(180)}`, summary: 's'.repeat(2000), work: Array.from({ length: 20 }, () => 'w'.repeat(500)), kind: 'rolling', time_label: 'Any time', url: `https://example.org/${'a'.repeat(1900)}${i}` });
  }
  const w = createWorld(db);
  const res = await w.get(PATHS.opportunities, q({ area: AREA }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(fe.validOpportunityResults(body));
  assert.equal(body.items.length, 20);
});

// ------------------------------------------------- un-verify on every change

test('every served column of an opportunity un-verifies the row when changed without a new verified_at, and raises the revision', async () => {
  const sets = {
    id: `id = 'renamed'`, organizer: `organizer = 'Other org'`, title: `title = 'Other title'`, interest: `interest = 'Gardening'`, artwork: `artwork = 'tree'`,
    time_label: `time_label = 'Other label'`, status: `status = 'cancelled'`, area: `area = 'Other area'`, served_place_ids: `served_place_ids = '{us-state:NC}'`,
    venue: `venue = 'Other venue'`, meeting_address: `meeting_address = '1 Main St'`, url: `url = 'https://example.org/other'`, summary: `summary = 'Other.'`,
    work: `work = '{Only this}'`, duration: `duration = 'Other'`, cost: `cost = 'Other'`, age: `age = 'Other'`, access: `access = 'Other'`, bring: `bring = 'Other'`,
    join_text: `join_text = 'Other'`, safety: `safety = 'Other'`, starts_at: `starts_at = starts_at + interval '1 minute'`, ends_at: `ends_at = ends_at + interval '1 minute'`,
    zone: `venue_timezone = 'America/Chicago'`, basis: `venue_timezone = 'America/Chicago', venue_timezone_basis = 'inferred'`,
    kind: `kind = 'rolling', starts_at = null, ends_at = null`, org: `org_id = (select id from public.volunteer_orgs where name <> 'B18 Test Riverkeeper' limit 1)`,
  };
  for (const [name, set] of Object.entries(sets)) {
    await db.exec('delete from public.participation_opportunities');
    await opp({ id: 'subject', verified_by: 'VM' });
    const before = (await db.query(`select revision from public.participation_opportunities where id = 'subject'`)).rows[0].revision;
    await db.query(`update public.participation_opportunities set ${set} where id = 'subject'`);
    const row = (await db.query(`select id, verified_by, verified_at, revision from public.participation_opportunities where id in ('subject','renamed')`)).rows[0];
    if (name === 'org' && !row) continue;
    assert.deepEqual([row.verified_by, row.verified_at], [null, null], `changing ${name} left the row verified`);
    assert.equal(row.revision, before + 1, name);
    const { items } = await drain(sqlClient(), real());
    assert.deepEqual(items, [], `${name}: still served`);
    assert.equal(await readOpportunity(sqlClient(), row.id, real()), null, `${name}: detail still served`);
  }
});

test('every served column of a profile un-verifies the row when changed without a new verified_at', async () => {
  const sets = {
    title: `title = 'Other'`, organizer: `organizer = 'Other'`, interest: `interest = 'Gardening'`, area: `area = 'Other'`, served_place_ids: `served_place_ids = '{us-state:NC}'`,
    mission: `mission = 'Other'`, work: `work = 'Other'`, url: `url = 'https://example.org/other'`, source_title: `source_title = 'Other'`,
    extra_sources: `extra_sources = '[{"title":"A","url":"https://example.org/a"}]'::jsonb`, address: `address = '1 Main St', address_kind = 'office', address_role = 'Office.'`,
    contact: `contact = 'a@example.org'`, effort: `effort = 'Other'`, age: `age = 'Other'`, cost: `cost = 'Other'`, access: `access = 'Other'`,
    steps: `steps = '[{"title":"A","text":"B"}]'::jsonb`, bring: `bring = 'Other'`, followup: `followup = 'Other'`,
  };
  for (const [name, set] of Object.entries(sets)) {
    await db.exec('delete from public.participation_profiles');
    await prof({ id: 'subject' });
    await db.query(`update public.participation_profiles set ${set} where id = 'subject'`);
    const row = (await db.query(`select verified_by, verified_at, revision from public.participation_profiles where id = 'subject'`)).rows[0];
    assert.deepEqual([row.verified_by, row.verified_at], [null, null], `changing ${name} left the row verified`);
    assert.equal(row.revision, 2, name);
  }
});

test('the guard: re-verifying keeps the row served, a no-content update keeps the verification, revision and created_at cannot be forged, a content change WITH a new verified_at stays verified', async () => {
  await opp({ id: 'subject', kind: 'rolling', time_label: 'Any time' });
  const read = async () => (await db.query(`select * from public.participation_opportunities where id = 'subject'`)).rows[0];
  const a = await read();
  await db.query(`update public.participation_opportunities set title = title, revision = 99, created_at = '2000-01-01', updated_at = '2000-01-01' where id = 'subject'`);
  const b = await read();
  assert.equal(b.verified_by, 'VM');
  assert.equal(b.revision, 2);
  assert.deepEqual(b.created_at, a.created_at);
  assert.notEqual(String(b.updated_at), '2000-01-01');
  await db.query(`update public.participation_opportunities set revision = 1 where id = 'subject'`);
  assert.equal((await read()).revision, 3, 'a lower revision cannot be written');
  await db.query(`update public.participation_opportunities set verified_by = 'Someone else' where id = 'subject'`);
  assert.equal((await read()).verified_by, 'Someone else');
  await db.query(`update public.participation_opportunities set title = 'Rechecked', verified_at = now(), verified_by = 'VM' where id = 'subject'`);
  const c = await read();
  assert.equal(c.title, 'Rechecked');
  assert.equal(c.verified_by, 'VM');
  assert.equal(c.revision, 5);
  // Same-value verified_at together with a change still un-verifies.
  await db.query(`update public.participation_opportunities set title = 'Changed again', verified_at = verified_at where id = 'subject'`);
  assert.equal((await read()).verified_at, null);
  // verified_by without verified_at, and the reverse, are refused.
  await assert.rejects(db.query(`update public.participation_opportunities set verified_by = 'X' where id = 'subject'`), /verified_check/);
  await assert.rejects(db.query(`update public.participation_opportunities set verified_at = now() where id = 'subject'`), /verified_check/);
});

test('served revision is the stored revision, and an unverify-and-reverify raises it for the client', async () => {
  await opp({ id: 'subject', kind: 'rolling', time_label: 'Any time' });
  const sb = sqlClient();
  assert.equal((await readOpportunity(sb, 'subject')).revision, 1);
  await db.query(`update public.participation_opportunities set summary = 'Edited.' where id = 'subject'`);
  assert.equal(await readOpportunity(sb, 'subject'), null, 'unverified by the edit');
  await db.query(`update public.participation_opportunities set verified_by = 'VM', verified_at = now() where id = 'subject'`);
  const again = await readOpportunity(sb, 'subject');
  assert.equal(again.revision, 3);
  assert.equal(again.summary, 'Edited.');
});

test('browser roles can read neither table nor call any of the read, shape or guard functions', async () => {
  await opp({ id: 'subject' });
  await prof({ id: 'subject' });
  const calls = [
    `select * from public.participation_opportunities`, `select * from public.participation_profiles`,
    `select public.read_participation_opportunities('{us-state:NC}', now())`, `select public.read_participation_profiles('{us-state:NC}', now())`,
    `select public.read_participation_opportunity('subject', now())`, `select public.participation_text_ok('x', 10)`, `select public.participation_url_ok('https://a.b')`,
    `insert into public.participation_opportunities (id) values ('x')`, `update public.participation_opportunities set title = 'x'`, `delete from public.participation_opportunities`,
    `select public.participation_opportunity_json(o) from public.participation_opportunities o`,
  ];
  for (const role of ['anon', 'authenticated']) {
    for (const sql of calls) {
      const userId = role === 'authenticated' ? '11111111-1111-4111-8111-111111111111' : null;
      await assert.rejects(db.asRole(role, userId, (tx) => tx.query(sql)), /permission denied|row-level security|must be owner/i, `${role}: ${sql}`);
    }
  }
});

// ======================================================= household blindness

test('three identities, hostile household parameters and headers: byte-identical bodies on all three routes, and no table is read through the client', async () => {
  await opp({ id: 'soon' });
  await opp({ id: 'program', kind: 'rolling', title: 'Program', time_label: 'Any time' });
  await prof({ id: 'meck-profile' });
  const w = createWorld(db);
  const hostile = [
    {}, { 'X-Halo-Home-Context': crypto.randomUUID() }, { 'X-Halo-Home-Context': 'not-a-uuid' }, { 'X-Halo-Home-Context': "' or 1=1 --" },
    { 'X-Halo-Home-Context': '' }, { 'X-Halo-Profile-Id': w.h.identities.bob.id },
  ];
  const extra = { profile_id: w.h.identities.bob.id, household_id: 'x', home_context_id: crypto.randomUUID(), homeContextId: 'y', user_id: w.h.identities.alice.id };
  for (const [path, base] of [[PATHS.opportunities, { area: AREA }], [PATHS.organizations, { area: AREA }], [PATHS.detail, { id: 'soon' }]]) {
    const bodies = new Set();
    for (const who of ['alice', 'bob']) {
      for (const headers of hostile) {
        for (const params of [base, { ...base, ...extra }]) {
          const res = await w.get(path, q(params), { as: who, headers });
          assert.equal(res.status, 200, `${path} ${who} ${JSON.stringify(headers)}`);
          bodies.add(await res.text());
        }
      }
    }
    assert.equal(bodies.size, 1, `${path}: ${bodies.size} different bodies`);
  }
  assert.deepEqual(w.h.db.queryLog, []);
  for (const call of w.calls) assert.ok(!JSON.stringify(call.args).includes(w.h.identities.alice.id) && !JSON.stringify(call.args).includes(w.h.identities.bob.id));
});

// ============================================ flag, migration, failed reads

test('flag: anything but on/true is a 503 on all three routes, before the query is even parsed, and nothing is read', async () => {
  await opp({ id: 'soon' });
  for (const value of ['off', 'false', '0', '1', 'yes', '', 'ONN', 'nope']) {
    const w = createWorld(db, { env: { HALO_FEATURE_PARTICIPATION: value } });
    for (const [path, query] of [[PATHS.opportunities, q({ area: AREA })], [PATHS.opportunities, q({ interest: 'bogus' })], [PATHS.organizations, q({ cursor: '!!' })], [PATHS.detail, q({ id: 'soon' })], [PATHS.detail, q({ id: 'BAD ID' })]]) {
      const res = await w.get(path, query);
      assert.equal(res.status, 503, `${JSON.stringify(value)} ${path}${query}`);
      assert.equal((await res.json()).retryable, false);
    }
    assert.deepEqual(w.calls, []);
  }
  for (const value of ['on', 'true']) {
    const w = createWorld(db, { env: { HALO_FEATURE_PARTICIPATION: value } });
    assert.equal((await w.get(PATHS.opportunities, q({ area: AREA }))).status, 200, value);
  }
  // Other capabilities being on does not turn this one on.
  const other = createWorld(db, { env: { HALO_FEATURE_TASKS: 'on', HALO_FEATURE_WORKSPACE: 'on', HALO_FEATURE_PROJECTS: 'on' } });
  assert.equal((await other.get(PATHS.opportunities, q({ area: AREA }))).status, 503);
});

test('missing migration: a valid query is always a 503 (any filter, any area, any cursor shape), never a 200 with empty items', async () => {
  const w = createWorld(db, { migrated: false });
  for (const [path, params] of [
    [PATHS.opportunities, {}], [PATHS.opportunities, { area: AREA }], [PATHS.opportunities, { area: AREA, interest: 'Gardening', timing: 'rolling', search: 'x' }],
    [PATHS.opportunities, { area: JSON.stringify({ id: 'nowhere' }) }], [PATHS.opportunities, { area: JSON.stringify({}) }],
    [PATHS.organizations, {}], [PATHS.organizations, { area: AREA, search: 'water' }], [PATHS.detail, { id: 'anything' }],
  ]) {
    const res = await w.get(path, q(params));
    assert.equal(res.status, 503, `${path} ${JSON.stringify(params)}`);
    const body = await res.json();
    assert.equal(body.code, 'feature_unavailable');
    assert.ok(!('items' in body));
  }
});

test('any failing or malformed read is a 5xx that the screens show as an error, never "No matching" or "No reviewed local coverage"', async (t) => {
  muteConsoleError(t);
  const failures = {
    'statement timeout': () => { throw rpcError('57014', 'canceling statement due to statement timeout'); },
    'permission denied': () => { throw rpcError('42501', 'permission denied for function read_participation_opportunities'); },
    'jwt expired': () => { throw rpcError('PGRST301', 'JWT expired'); },
    'raise exception': () => { throw rpcError('P0001', 'HALO_INVALID_INPUT'); },
    'no code at all': () => { throw rpcError('', 'fetch failed'); },
    'a plain Error': () => { throw new Error('boom'); },
    'null data': () => null,
    'object instead of array': () => ({}),
    'string': () => 'x',
    'number': () => 0,
  };
  for (const [label, fail] of Object.entries(failures)) {
    const w = createWorld(db, { wrap: { read_participation_opportunities: fail, read_participation_profiles: fail, read_participation_opportunity: label === 'null data' ? () => { throw new Error('x'); } : fail } });
    for (const [path, params] of [[PATHS.opportunities, { area: AREA }], [PATHS.opportunities, {}], [PATHS.organizations, { area: AREA }], [PATHS.detail, { id: 'soon' }]]) {
      const res = await w.get(path, q(params));
      assert.ok(res.status >= 500, `${label} ${path}: ${res.status}`);
      assert.ok(!('items' in await res.json()), `${label} ${path}: items present on a failure`);
    }
    const s = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
    assert.deepEqual([s.result, s.empty, s.status], [null, null, UNAVAILABLE], `${label}: screen`);
    const o = await fe.organizationsScreen(w.runtime(), { area: MECKLENBURG });
    assert.equal(o.line, UNAVAILABLE, `${label}: organizations screen`);
    const nobody = await fe.opportunitiesScreen(w.runtime());
    assert.deepEqual([nobody.result, nobody.empty], [null, null], `${label}: no area`);
  }
});

test('a detail read that returns something other than an opportunity or null is a 500, never a 200 body and never a 404', async (t) => {
  muteConsoleError(t);
  for (const data of [[], [{ id: 'x' }], {}, false, 0, '', 'x', { id: 'x' }, { ...opportunityRow({ now: real() }), verified_by: 'VM' }]) {
    const w = createWorld(db, { wrap: { read_participation_opportunity: () => data } });
    const res = await w.get(PATHS.detail, q({ id: 'x' }));
    assert.equal(res.status, 500, JSON.stringify(data)?.slice(0, 40));
  }
});

test('the limiter is shared by the three routes, keyed per identity, and runs before the query is parsed', async () => {
  const keys = [];
  const w = createWorld(db, { rateLimit: (key) => { keys.push(key); return keys.length <= 3; } });
  assert.equal((await w.get(PATHS.opportunities, q({ area: AREA }))).status, 200);
  assert.equal((await w.get(PATHS.organizations, q({ area: AREA }))).status, 200);
  assert.equal((await w.get(PATHS.detail, q({ id: 'nope' }))).status, 404);
  const res = await w.get(PATHS.opportunities, q({ interest: 'bogus' }));
  assert.equal(res.status, 429, 'a malformed query still spends the limit');
  assert.ok(new Set(keys).size === 1);
  const bob = await w.get(PATHS.opportunities, q({ area: AREA }), { as: 'bob' });
  assert.equal(bob.status, 429);
  assert.notEqual(keys.at(-1), keys[0], 'bob has his own key');
});

// ============================================================ pagination

test('pagination boundaries: exactly 20 has no next cursor, 21 has one and the second page holds one; no duplicates or gaps; every cursor survives a round trip through the real validators', async () => {
  for (let i = 0; i < 21; i += 1) await opp({ id: `r-${String(i).padStart(2, '0')}`, kind: 'rolling', title: `Rolling ${String(i).padStart(2, '0')}`, time_label: 'Any time' });
  const sb = sqlClient();
  const now = real();
  const p1 = await searchOpportunities(sb, queryOf({}), now);
  assert.equal(p1.items.length, 20);
  assert.ok(p1.nextCursor);
  const p2 = await searchOpportunities(sb, queryOf({ cursor: p1.nextCursor }), now);
  assert.deepEqual(p2.items.map((i) => i.id), ['r-20']);
  assert.equal(p2.nextCursor, null);
  await db.query(`delete from public.participation_opportunities where id = 'r-20'`);
  const exactly = await searchOpportunities(sb, queryOf({}), now);
  assert.equal(exactly.items.length, 20);
  assert.equal(exactly.nextCursor, null);
  // Items shrink between pages: the old cursor lands on an empty page, still a valid 200.
  const stale = await searchOpportunities(sb, queryOf({ cursor: p1.nextCursor }), now);
  assert.ok(fe.validOpportunityResults(stale));
  assert.equal(stale.items.length, 0);
});

test('scheduled listings come before rolling ones, soonest first, ties by title then id, and the order never depends on the id collation', async () => {
  const day = (n) => n;
  await opp({ id: 'b-late', startsInDays: day(9), title: 'Zulu' });
  await opp({ id: 'a-early', startsInDays: day(2), title: 'Yankee' });
  await opp({ id: 'c-roll', kind: 'rolling', title: 'Alpha roll', time_label: 'Any' });
  await opp({ id: 'd-roll', kind: 'rolling', title: 'Alpha roll', time_label: 'Any' });
  await opp({ id: 'e-roll', kind: 'rolling', title: 'alpha lower', time_label: 'Any' });
  const { items } = await drain(sqlClient(), real());
  assert.deepEqual(items.map((i) => i.id).slice(0, 2), ['a-early', 'b-late']);
  assert.deepEqual(items.slice(2).map((i) => i.kind), ['rolling', 'rolling', 'rolling']);
  assert.ok(items.slice(2).map((i) => i.id).indexOf('c-roll') < items.slice(2).map((i) => i.id).indexOf('d-roll'));
});

test('more than 1000 servable listings: a 200 that says partial, 20 valid items, and no crash', async () => {
  await opp({ id: 'seed', kind: 'rolling', time_label: 'Any time' });
  await db.exec(`insert into public.participation_opportunities
    (id, org_id, organizer, title, interest, artwork, kind, time_label, status, area, served_place_ids, venue, url, summary, work, duration, cost, age, access, bring, join_text, safety, verified_by, verified_at)
    select 'bulk-' || g, org_id, organizer, 'Bulk ' || lpad(g::text, 5, '0'), interest, artwork, kind, time_label, status, area, served_place_ids, venue, url, summary, work, duration, cost, age, access, bring, join_text, safety, verified_by, now()
      from public.participation_opportunities, generate_series(1, 1005) g where id = 'seed'`);
  const w = createWorld(db);
  const res = await w.get(PATHS.opportunities, q({ area: AREA }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(fe.validOpportunityResults(body));
  assert.equal(body.items.length, 20);
  assert.equal(body.availability, 'partial');
});

// ============================================================ the screens

test('no area, one statewide listing: the screen says no reviewed local coverage and the location label asks for an area; a withheld-only area never says "No reviewed local coverage"', async (t) => {
  muteConsoleError(t);
  await opp({ id: 'statewide', served_place_ids: ['us-state:NC'], kind: 'rolling', time_label: 'Any time' });
  const w = createWorld(db);
  const s = await fe.opportunitiesScreen(w.runtime());
  assert.deepEqual([s.empty, s.location, s.result.availability], ['No reviewed local coverage', 'Choose your area', 'no_coverage']);
  const s2 = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG });
  assert.deepEqual(s2.shown, ['statewide']);
});

test('filters that leave nothing are `empty` and keep a real checkedAt; an interest/search/timing combo never reports no_coverage while coverage exists', async () => {
  await opp({ id: 'one' });
  await opp({ id: 'two', kind: 'rolling', title: 'Two', time_label: 'Any' });
  const w = createWorld(db);
  for (const filter of [{ interest: 'Gardening' }, { search: 'zzzz' }, { timing: 'rolling', interest: 'Gardening' }, { search: 'creek', timing: 'rolling' }]) {
    const s = await fe.opportunitiesScreen(w.runtime(), { area: MECKLENBURG, ...filter });
    if (s.shown.length) continue;
    assert.equal(s.result.availability, 'empty', JSON.stringify(filter));
    assert.match(s.result.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(s.empty, 'No matching upcoming listings');
  }
});

test('the top-level checkedAt is the oldest verification among the area\'s listings and a valid day', async () => {
  await opp({ id: 'new', verifiedDaysAgo: 1 });
  await opp({ id: 'old', verifiedDaysAgo: 20, title: 'Old', kind: 'rolling', time_label: 'Any' });
  const w = createWorld(db);
  const body = await (await w.get(PATHS.opportunities, q({ area: AREA }))).json();
  const expected = new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10);
  assert.equal(body.checkedAt, expected);
  assert.equal(Math.min(...body.items.map((i) => Date.parse(i.checkedAt))), Date.parse(`${expected}T00:00:00Z`));
});

// ============================================================== em dash

test('no response body, header or error message contains an em dash, whatever was sent', async () => {
  await opp({ id: 'soon' });
  await prof({ id: 'meck-profile' });
  const w = createWorld(db);
  const hostile = `${EM}x`;
  const requests = [
    [PATHS.opportunities, q({ area: AREA })], [PATHS.opportunities, q({ area: AREA, search: hostile })], [PATHS.opportunities, q({ interest: hostile })],
    [PATHS.opportunities, q({ timing: hostile })], [PATHS.opportunities, q({ area: hostile })], [PATHS.opportunities, q({ area: JSON.stringify({ id: hostile }) })],
    [PATHS.opportunities, q({ cursor: hostile })], [PATHS.organizations, q({ area: AREA })], [PATHS.organizations, q({ search: hostile })], [PATHS.organizations, q({ interest: hostile })],
    [PATHS.detail, q({ id: hostile })], [PATHS.detail, q({ id: 'soon' })], [PATHS.detail, q({ id: 'nope' })],
  ];
  for (const [path, query] of requests) {
    const res = await w.get(path, query, { headers: { 'X-Request-Id': 'abcdefgh-1234' } });
    const text = await res.text();
    assert.ok(!text.includes(EM), `${path}${query}: ${text.slice(0, 100)}`);
    for (const [k, v] of res.headers) assert.ok(!v.includes(EM) && !k.includes(EM), `${k}: ${v}`);
  }
  for (const message of Object.values(MESSAGES)) assert.ok(!message.includes(EM), message);
  for (const place of allPlaces()) assert.ok(!JSON.stringify(place).includes(EM), place.id);
  // Flag-off and 401 bodies too.
  const off = createWorld(db, { env: {} });
  assert.ok(!(await (await off.get(PATHS.opportunities, '')).text()).includes(EM));
  assert.ok(!(await (await off.get(PATHS.opportunities, '', { as: null })).text()).includes(EM));
});

test('a client-supplied X-Request-Id is echoed only when well formed; a malformed one never reaches a body or header', async () => {
  const w = createWorld(db);
  const evil = ['short', 'a'.repeat(65), 'has space ok1234', `${EM}${EM}${EM}${EM}${EM}${EM}${EM}${EM}`, 'ok-12345678\r\nSet-Cookie: x=1'];
  for (const id of evil) {
    let res;
    try { res = await w.get(PATHS.opportunities, q({ interest: 'bad' }), { headers: { 'X-Request-Id': id } }); } catch { continue; }
    const text = await res.text();
    assert.ok(!text.includes('Set-Cookie') && !text.includes(EM), id);
    assert.ok(!res.headers.get('Set-Cookie'));
  }
});

test('impossible shapes are refused at the table: ends not after start, rolling with dates or a venue date, scheduled without dates, a basis without a zone, a status outside the four', async () => {
  const start = new Date(Date.now() + 5 * DAY);
  const cases = [
    { ends_at: new Date(start.getTime() - 1000) }, { ends_at: start }, { kind: 'rolling', starts_at: start, ends_at: new Date(start.getTime() + HOUR) }, { kind: 'rolling', starts_at: null, ends_at: null, venue_local_date: '2030-01-01' },
    { starts_at: null, ends_at: null }, { starts_at: start, ends_at: null }, { venue_timezone_basis: 'source' }, { status: 'sold-out' }, { status: 'Listed' },
    { venue_timezone: 'x'.repeat(101) }, { venue_timezone_basis: 'guessed', venue_timezone: 'UTC' }, { interest: 'cleanup' }, { artwork: 'river' },
    { work: [] }, { work: Array.from({ length: 21 }, () => 'w') }, { served_place_ids: [] }, { served_place_ids: ['us-county:45091'] }, { served_place_ids: ['us-state:SC'] },
    { url: 'http://example.org/x' }, { url: 'https://user:pw@example.org/x' }, { url: 'https://example.org/a b' }, { url: 'ftp://example.org' }, { url: 'javascript:alert(1)' },
    { summary: '<script>x</script>' }, { summary: 'Fill in <your summary here>' }, { summary: 'a\u0007b' }, { id: 'Has Capital' }, { revision: 0 },
  ];
  let n = 0;
  for (const over of cases) {
    n += 1;
    const row = opportunityRow({ id: `shape-${n}`, now: real(), ...over });
    await assert.rejects(insertListing(db, 'participation_opportunities', row), /check|violates|HALO_INVALID_INPUT/i, JSON.stringify(over));
  }
});

// ======================================================= unused guards

test('a gazetteer-valid but unlisted place sees only statewide and its own listings, never a neighbour\'s (no proximity)', async () => {
  await opp({ id: 'meck', title: 'Mecklenburg', served_place_ids: ['us-county:37119'] });
  await opp({ id: 'union', title: 'Union', served_place_ids: ['us-county:37179'] });
  await opp({ id: 'state', title: 'State', served_place_ids: ['us-state:NC'], kind: 'rolling', time_label: 'Any' });
  await opp({ id: 'charlotte', title: 'Charlotte', served_place_ids: ['us-place:3712000'], kind: 'rolling', time_label: 'Any' });
  const w = createWorld(db);
  const union = await fe.opportunitiesScreen(w.runtime(), { area: placeById('us-county:37179') });
  assert.deepEqual(union.shown.sort(), ['state', 'union']);
  const charlotte = await fe.opportunitiesScreen(w.runtime(), { area: placeById('us-place:3712000') });
  assert.deepEqual(charlotte.shown.sort(), ['charlotte', 'meck', 'state']);
  const zip = await fe.opportunitiesScreen(w.runtime(), { area: placeById('us-zcta:28208') });
  assert.ok(zip.shown.includes('meck') && !zip.shown.includes('union'));
});

test('searchOrganizations / searchOpportunities against the lib directly: an unreadable directory throws instead of returning an empty list', async () => {
  const failing = { rpc: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) };
  await assert.rejects(searchOpportunities(failing, queryOf({}), real()));
  await assert.rejects(searchOrganizations(failing, queryOf({}, { withTiming: false }), real()));
  await assert.rejects(readOpportunity(failing, 'x', real()));
  const nothing = { rpc: async () => ({ data: undefined, error: null }) };
  await assert.rejects(searchOpportunities(nothing, queryOf({}), real()));
  await assert.rejects(searchOrganizations(nothing, queryOf({}, { withTiming: false }), real()));
  // encodeCursor round trip sanity.
  assert.ok(encodeCursor(20, 'k'));
});

// ================================================== transport and exposure

test('only GET exists: every other method is a 405 on all three routes', async () => {
  const w = createWorld(db);
  for (const path of Object.values(PATHS)) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await w.h.call(path, method, { as: 'alice', body: { id: 'x' } });
      assert.equal(res.status, 405, `${method} ${path}`);
    }
  }
  assert.deepEqual(w.calls, []);
});

test('Cache-Control private, no-store on every status the routes can answer (200, 400, 401, 404, 429, 500, 503)', async (t) => {
  muteConsoleError(t);
  await opp({ id: 'soon' });
  const w = createWorld(db);
  const statuses = new Map();
  const note = async (label, res) => { statuses.set(res.status, label); assert.equal(res.headers.get('Cache-Control'), 'private, no-store', `${label} ${res.status}`); };
  await note('200', await w.get(PATHS.opportunities, q({ area: AREA })));
  await note('400', await w.get(PATHS.opportunities, q({ interest: 'x' })));
  await note('401', await w.get(PATHS.opportunities, '', { as: null }));
  await note('401 bad token', await w.get(PATHS.opportunities, '', { as: null, headers: { Authorization: 'Bearer garbage' } }));
  await note('404', await w.get(PATHS.detail, q({ id: 'nope' })));
  await note('429', await createWorld(db, { rateLimit: () => false }).get(PATHS.opportunities, q({ area: AREA })));
  await note('500', await createWorld(db, { wrap: { read_participation_opportunities: () => { throw new Error('x'); } } }).get(PATHS.opportunities, q({ area: AREA })));
  await note('503', await createWorld(db, { env: {} }).get(PATHS.opportunities, q({ area: AREA })));
  assert.deepEqual([...statuses.keys()].sort(), [200, 400, 401, 404, 429, 500, 503]);
});

test('an auth outage or a bad token is never a 200 and never an empty list', async (t) => {
  muteConsoleError(t);
  const w = createWorld(db);
  w.h.forceAuthOutage('returned');
  for (const path of Object.values(PATHS)) {
    const res = await w.get(path, path === PATHS.detail ? q({ id: 'x' }) : q({ area: AREA }));
    assert.ok(res.status >= 400, `${path} ${res.status}`);
    assert.ok(!('items' in await res.json()));
  }
  w.h.forceAuthOutage('thrown');
  for (const path of Object.values(PATHS)) {
    const res = await w.get(path, path === PATHS.detail ? q({ id: 'x' }) : q({ area: AREA }));
    assert.ok(res.status >= 400, `${path} ${res.status}`);
  }
});

test('served items expose exactly the client fields plus revision: no verifier, organization id, place ids or address kind', async () => {
  await opp({ id: 'soon', meeting_address: '1 Main St', venue_timezone: 'America/New_York', venue_timezone_basis: 'source' });
  await opp({ id: 'program', kind: 'rolling', title: 'Program', time_label: 'Any time' });
  await prof({ id: 'meck-profile', address: '1 Main St', address_kind: 'office', address_role: 'The office, not a meeting place.', contact: 'volunteer@example.org',
    extra_sources: [{ title: 'More', url: 'https://example.org/more' }] });
  const w = createWorld(db);
  const o = await (await w.get(PATHS.opportunities, q({ area: AREA }))).json();
  const opportunityKeys = new Set(['id', 'organizer', 'title', 'interest', 'artwork', 'scopes', 'area', 'venue', 'address', 'kind', 'startsAt', 'endsAt', 'timeLabel', 'venueLocalDate', 'venueTimezone', 'venueTimezoneBasis', 'checkedAt', 'status', 'url', 'summary', 'work', 'duration', 'cost', 'age', 'access', 'bring', 'join', 'safety', 'revision']);
  for (const item of o.items) for (const key of Object.keys(item)) assert.ok(opportunityKeys.has(key), `unexpected key ${key}`);
  const p = await (await w.get(PATHS.organizations, q({ area: AREA }))).json();
  const profileKeys = new Set(['id', 'title', 'organizer', 'interest', 'scopes', 'area', 'mission', 'work', 'url', 'sourceTitle', 'extraSources', 'address', 'addressRole', 'contact', 'effort', 'age', 'cost', 'access', 'steps', 'bring', 'followup', 'checkedAt', 'revision']);
  for (const item of p.items) for (const key of Object.keys(item)) assert.ok(profileKeys.has(key), `unexpected key ${key}`);
  const everything = JSON.stringify([o, p]);
  assert.ok(!/verified|VM"|org_id|served_place|address_kind|"office"/.test(everything), 'a bookkeeping field leaked');
  const rolling = o.items.find((i) => i.id === 'program');
  assert.ok(!('startsAt' in rolling) && !('endsAt' in rolling) && !('venueLocalDate' in rolling));
  assert.equal(p.items[0].addressRole, 'The office, not a meeting place.');
  assert.equal(o.items.find((i) => i.id === 'soon').address, '1 Main St');
});
