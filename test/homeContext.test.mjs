/**
 * lib/homeContext.js: the pure half of home contexts (migration 0016).
 *
 * The database half is test/homeContextDb.test.mjs, which also checks that the
 * SQL and shouldOpenNewContext decide every coordinate pair in
 * test/helpers/homeContextCases.mjs the same way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COORDINATE_CASES } from './helpers/homeContextCases.mjs';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ES modules without the typeless-package warning

const homeContext = await import('../lib/homeContext.js');
const { toContextAttributes, shouldOpenNewContext, contextSummary, comparability } = homeContext;
const { roundCoord } = await import('../lib/geocode.js');

const CURRENT = 'c0000000-0000-4000-8000-000000000002';
const EARLIER = 'c0000000-0000-4000-8000-000000000001';

/** A home_contexts row as the RPCs and PostgREST return it. */
const ROW = Object.freeze({
  id: CURRENT,
  profile_id: 'a11ce000-0000-4000-8000-000000000001',
  sequence: 2,
  revision: 3,
  origin: 'move',
  lat: 35.409,
  lng: -80.58,
  county: 'Cabarrus County',
  state: 'NC',
  pwsid: 'NC0125010',
  service_area_status: 'measured',
  water_source: 'utility',
  home_year: 1988,
  match_method: 'mapbox_geocode_arcgis_point',
  onboard_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  backfill_state: 'complete',
  backfill_from: '2026-09-04',
  backfill_to: '2026-10-03',
  backfill_updated_at: '2026-10-04T12:01:00+00:00',
  effective_from: '2026-10-04T12:00:00+00:00',
  effective_to: null,
  closed_reason: null,
  created_at: '2026-10-04T12:00:00+00:00',
  updated_at: '2026-10-04T12:01:00+00:00',
});

test('lib/homeContext.js exports exactly the four helpers', () => {
  assert.deepEqual(Object.keys(homeContext).sort(), ['comparability', 'contextSummary', 'shouldOpenNewContext', 'toContextAttributes']);
  for (const fn of Object.values(homeContext)) assert.equal(typeof fn, 'function');
});

// ---------------------------------------------------------------------------
// toContextAttributes
// ---------------------------------------------------------------------------

test('toContextAttributes splits a profile-like object into the two RPC arguments and rounds the point to 3 decimals', () => {
  const profileUpdate = {
    id: 'a11ce000-0000-4000-8000-000000000001',
    lat: 35.408812,
    lng: -80.579521,
    county: 'Cabarrus County',
    state: 'NC',
    zip: null,
    pwsid: 'NC0125010',
    service_area_status: 'measured',
    water_source: 'utility',
    home_year: 1988,
    match_method: 'mapbox_geocode_arcgis_point',
    onboard_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  assert.deepEqual(toContextAttributes(profileUpdate), {
    location: { lat: 35.409, lng: -80.58, county: 'Cabarrus County', state: 'NC' },
    attributes: {
      pwsid: 'NC0125010',
      service_area_status: 'measured',
      water_source: 'utility',
      home_year: 1988,
      match_method: 'mapbox_geocode_arcgis_point',
    },
  });
});

test('toContextAttributes leaves out what was not given (so the database keeps it) and keeps an explicit null (so it clears it)', () => {
  // The onboard route leaves pwsid, state, water_source and home_year out when it has no answer.
  assert.deepEqual(toContextAttributes({ lat: 35.4, lng: -80.5, county: null, service_area_status: 'lookup_failed' }), {
    location: { lat: 35.4, lng: -80.5, county: null },
    attributes: { service_area_status: 'lookup_failed' },
  });
  assert.deepEqual(toContextAttributes({ lat: 35.4, lng: -80.5, water_source: null, home_year: undefined }), {
    location: { lat: 35.4, lng: -80.5 },
    attributes: { water_source: null },
  });
});

test('toContextAttributes never passes on identity, the request id, a ZIP code or anything it does not know', () => {
  const { location, attributes } = toContextAttributes({
    lat: 35.4, lng: -80.5, id: 'x', profile_id: 'x', onboard_request_id: 'x', zip: '28025', sequence: 9, revision: 9,
    origin: 'legacy_migration', effective_to: 'x', backfill_state: 'complete', address: '1 Main St',
  });
  assert.deepEqual(Object.keys(location), ['lat', 'lng']);
  assert.deepEqual(attributes, {});
});

test('toContextAttributes always gives lat and lng, as null when missing or not a finite number', () => {
  for (const input of [undefined, null, {}, { lat: '35.4', lng: '-80.5' }, { lat: Number.NaN, lng: Infinity }]) {
    assert.deepEqual(toContextAttributes(input), { location: { lat: null, lng: null }, attributes: {} }, JSON.stringify(input));
  }
});

// ---------------------------------------------------------------------------
// shouldOpenNewContext: the coordinate table the SQL is checked against too
// ---------------------------------------------------------------------------

test('the boundary cases round the way the table says (JavaScript rounds a half toward +infinity)', () => {
  assert.equal(roundCoord(35.1235), 35.124);
  assert.equal(roundCoord(-80.4565), -80.456); // Postgres round(numeric) would give -80.457: the rounding happens only here
  assert.equal(roundCoord(1.0005), 1.001);
  assert.ok(roundCoord(-0.0005) === 0, 'it is -0, which === 0'); // and JSON sends it to the database as 0
  assert.equal(JSON.stringify({ lat: roundCoord(-0.0005) }), '{"lat":0}');
});

test('shouldOpenNewContext: a new context opens for the first location and for a move, and never for the same rounded point', () => {
  for (const [label, current, next, expected] of COORDINATE_CASES) {
    assert.equal(shouldOpenNewContext(current, next), expected, label);
  }
});

test('shouldOpenNewContext reads a contextSummary as well as a row', () => {
  const summary = contextSummary(ROW);
  assert.equal(shouldOpenNewContext(summary, { lat: 35.4091, lng: -80.5799 }), false);
  assert.equal(shouldOpenNewContext(summary, { lat: 35.41, lng: -80.58 }), true);
});

test('shouldOpenNewContext refuses a new location without finite coordinates, as the database does', () => {
  for (const next of [undefined, null, {}, { lat: 35.1 }, { lat: '35.1', lng: '-80.1' }, { lat: Number.NaN, lng: 1 }, { lat: 1, lng: Infinity }]) {
    assert.throws(() => shouldOpenNewContext(ROW, next), TypeError, JSON.stringify(next));
  }
});

// ---------------------------------------------------------------------------
// contextSummary
// ---------------------------------------------------------------------------

test('contextSummary is the public shape: location grouped, backfill grouped, current from effective_to', () => {
  assert.deepEqual(contextSummary(ROW), {
    id: CURRENT,
    sequence: 2,
    revision: 3,
    origin: 'move',
    current: true,
    location: { lat: 35.409, lng: -80.58, county: 'Cabarrus County', state: 'NC' },
    pwsid: 'NC0125010',
    service_area_status: 'measured',
    water_source: 'utility',
    home_year: 1988,
    match_method: 'mapbox_geocode_arcgis_point',
    backfill: { state: 'complete', from: '2026-09-04', to: '2026-10-03', updated_at: '2026-10-04T12:01:00+00:00' },
    effective_from: '2026-10-04T12:00:00+00:00',
    effective_to: null,
    closed_reason: null,
  });
  const closed = contextSummary({ ...ROW, effective_to: '2026-10-05T08:00:00+00:00', closed_reason: 'moved' });
  assert.equal(closed.current, false);
  assert.deepEqual([closed.effective_to, closed.closed_reason], ['2026-10-05T08:00:00+00:00', 'moved']);
});

test('contextSummary never exposes the owner id, the request id or the row bookkeeping, and adds nothing it was not given', () => {
  const summary = contextSummary({ ...ROW, address: '1 Main St', zip: '28025', extra: 'x' });
  const text = JSON.stringify(summary);
  for (const hidden of [ROW.profile_id, ROW.onboard_request_id, '1 Main St', '28025']) {
    assert.equal(text.includes(hidden), false, `the summary contains ${hidden}`);
  }
  for (const key of ['profile_id', 'onboard_request_id', 'created_at', 'updated_at', 'address', 'zip', 'extra']) {
    assert.equal(key in summary, false, key);
  }
});

test('contextSummary of nothing is null, and a missing field is null rather than undefined', () => {
  assert.equal(contextSummary(null), null);
  assert.equal(contextSummary(undefined), null);
  const sparse = contextSummary({ id: CURRENT, sequence: 1, revision: 1, origin: 'onboard', lat: 35.4, lng: -80.5 });
  assert.deepEqual(sparse.location, { lat: 35.4, lng: -80.5, county: null, state: null });
  assert.deepEqual(sparse.backfill, { state: null, from: null, to: null, updated_at: null });
  assert.equal(sparse.current, true);
  for (const value of [sparse.pwsid, sparse.service_area_status, sparse.water_source, sparse.home_year, sparse.match_method, sparse.effective_from, sparse.effective_to, sparse.closed_reason]) {
    assert.equal(value, null);
  }
  assert.equal(JSON.stringify(sparse).includes('undefined'), false);
});

// ---------------------------------------------------------------------------
// comparability
// ---------------------------------------------------------------------------

test('comparability: a reading from the current context is current_context, from any other context earlier_home', () => {
  assert.equal(comparability({ home_context_id: CURRENT, home_context_origin: 'onboard' }, CURRENT), 'current_context');
  assert.equal(comparability({ home_context_id: CURRENT, home_context_origin: 'move' }, CURRENT), 'current_context');
  assert.equal(comparability({ home_context_id: EARLIER, home_context_origin: 'onboard' }, CURRENT), 'earlier_home');
  assert.equal(comparability({ home_context_id: EARLIER, home_context_origin: 'move' }, CURRENT), 'earlier_home');
});

test('comparability: the current context made by the legacy migration is legacy_assumed, a closed one is an earlier home', () => {
  assert.equal(comparability({ home_context_id: CURRENT, home_context_origin: 'legacy_migration' }, CURRENT), 'legacy_assumed');
  // After a move the legacy context is closed: its readings were taken at the old home.
  assert.equal(comparability({ home_context_id: EARLIER, home_context_origin: 'legacy_migration' }, CURRENT), 'earlier_home');
});

test('comparability: a reading with no context is legacy_assumed, and with no current context any linked reading is an earlier home', () => {
  assert.equal(comparability({ home_context_id: null }, CURRENT), 'legacy_assumed');
  assert.equal(comparability({}, CURRENT), 'legacy_assumed');
  assert.equal(comparability({ home_context_id: null }, null), 'legacy_assumed');
  assert.equal(comparability({ home_context_id: EARLIER, home_context_origin: 'onboard' }, null), 'earlier_home');
  assert.equal(comparability({ home_context_id: EARLIER, home_context_origin: 'legacy_migration' }, undefined), 'earlier_home');
});

test('comparability needs the row\'s context origin only to flag the legacy case; without it a current reading counts as current', () => {
  assert.equal(comparability({ home_context_id: CURRENT }, CURRENT), 'current_context');
  assert.equal(comparability(null, CURRENT), 'legacy_assumed');
});
