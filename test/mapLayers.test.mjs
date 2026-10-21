import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complianceStatus, parseEchoFacility, parseAirNowStations } from '../lib/mapLayers.js';

test('ECHO compliance text maps onto the closed set', () => {
  assert.equal(complianceStatus('No Violation Identified'), 'no_violation');
  assert.equal(complianceStatus('Significant Violation'), 'significant_violation');
  assert.equal(complianceStatus('Violation Identified'), 'violation');
  assert.equal(complianceStatus(''), 'unknown');
  assert.equal(complianceStatus('Unknown'), 'unknown');
});

test('an ECHO row becomes a facility feature with programs, counts and dollars', () => {
  const f = parseEchoFacility({
    RegistryID: '110072166877', FacName: 'ATI SPECIALTY MATERIALS', FacLat: '34.98548', FacLong: '-80.5195', FacCounty: 'UNION',
    FacComplianceStatus: 'Violation Identified', CWAComplianceStatus: 'Violation Identified', CAAComplianceStatus: 'No Violation Identified',
    FacQtrsWithNC: '9', FacTotalPenalties: '$1,234,500', FacDateLastInspection: '03/25/2026',
    NPDESFlag: 'Y', AIRFlag: 'N', TRIFlag: 'Y',
  });
  assert.equal(f.id, '110072166877');
  assert.deepEqual(f.programs, ['Clean Water Act', 'Toxics Release Inventory']);
  assert.equal(f.compliance_status, 'violation');
  assert.equal(f.severity, 'elevated');
  assert.equal(f.open_violations, 1);
  assert.equal(f.recent_violations, 9);
  assert.equal(f.penalties, 1234500);
  assert.equal(f.last_inspection, '2026-03-25');
});

test('a facility without coordinates is dropped', () => {
  assert.equal(parseEchoFacility({ RegistryID: '1', FacLat: null, FacLong: '-80' }), null);
});

test('AirNow rows collapse to one station at its latest hour, worst pollutant', () => {
  const s = parseAirNowStations([
    { FullAQSCode: 'A', SiteName: 'Monroe', Latitude: 35, Longitude: -80.5, UTC: '2026-09-27T17:00', Parameter: 'PM2.5', AQI: 80 },
    { FullAQSCode: 'A', SiteName: 'Monroe', Latitude: 35, Longitude: -80.5, UTC: '2026-09-27T18:00', Parameter: 'OZONE', AQI: 41 },
    { FullAQSCode: 'A', SiteName: 'Monroe', Latitude: 35, Longitude: -80.5, UTC: '2026-09-27T18:00', Parameter: 'PM2.5', AQI: 55 },
    { FullAQSCode: 'B', SiteName: 'Rockingham', Latitude: 34.9, Longitude: -79.8, UTC: '2026-09-27T18:00', Parameter: 'OZONE', AQI: -999 },
  ]);
  assert.equal(s.length, 1);
  assert.equal(s[0].aqi, 55);
  assert.equal(s[0].dominant_pollutant, 'PM2.5');
  assert.equal(s[0].severity, 'moderate');
  assert.equal(s[0].last_reading_at, '2026-09-27T18:00:00Z');
});

import { fetchAirStations } from '../lib/mapLayers.js';

test('every source request carries a timeout signal', async () => {
  let signal = null;
  await fetchAirStations({ apiKey: 'k', fetchImpl: async (_url, init) => { signal = init?.signal; return { ok: true, json: async () => [] }; } });
  assert.ok(signal, 'a signal was passed');
  assert.equal(typeof signal.aborted, 'boolean');
});

// ------------------------------------------- ECHO facilities: columns by name

import { echoColumnIds, fetchFacilities, NC08_COUNTY_FIPS } from '../lib/mapLayers.js';
import { buildAndStoreAll } from '../lib/mapBuild.js';
import { ECHO_COLUMN_IDS, echoMetadata, fakeEcho } from './helpers/echoMetadata.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';

const MONROE = {
  RegistryID: '110000000001',
  FacName: 'Monroe Test Plant',
  FacLat: '34.985',
  FacLong: '-80.549',
  FacCounty: 'UNION',
  FacComplianceStatus: 'Significant Violation',
  CWAComplianceStatus: 'Violation Identified',
  FacQtrsWithNC: '6',
  FacTotalPenalties: '$12,500',
  FacDateLastInspection: '03/15/2026',
  NPDESFlag: 'Y',
  TRIFlag: 'Y',
};
const RALEIGH = { ...MONROE, RegistryID: '110000000009', FacName: 'Raleigh Test Plant', FacLat: '35.78', FacLong: '-78.64' };
const idsWithout = (...names) => Object.fromEntries(Object.entries(ECHO_COLUMN_IDS).filter(([k]) => !names.includes(k)));
const qcolumnsOf = (calls) => new URL(calls.find((u) => u.includes('.get_qid?'))).searchParams.get('qcolumns');

test('ECHO qcolumns are resolved by name from the current metadata', () => {
  const ids = echoColumnIds(echoMetadata());
  assert.deepEqual(ids.split(',').map(Number).slice(0, 4), [1, 6, 19, 20], 'FacName, RegistryID, FacLat, FacLong');
  assert.equal(ids.split(',').length, 18, 'every field the parser reads');
  assert.ok(!ids.split(',').includes('8'), 'columns the parser does not read are not requested');
});

test('renumbered ECHO columns still produce located, complete facilities', async () => {
  // Every id moved again: the fetcher must follow the metadata, not a pinned list.
  const moved = Object.fromEntries(Object.keys(ECHO_COLUMN_IDS).map((name, i) => [name, 500 + i]));
  const echo = fakeEcho({ metadata: echoMetadata(moved), facilities: [MONROE, RALEIGH] });
  const features = await fetchFacilities({ fetchImpl: echo.fetchImpl });
  assert.equal(echo.calls.filter((u) => u.includes('.metadata?')).length, 1, 'metadata once per run');
  assert.ok(qcolumnsOf(echo.calls).split(',').every((id) => Number(id) >= 500));
  assert.equal(features.length, 1, 'Raleigh sits outside NC-08');
  assert.deepEqual(features[0], {
    id: '110000000001',
    name: 'Monroe Test Plant',
    lat: 34.985,
    lng: -80.549,
    county: 'UNION',
    programs: ['Clean Water Act', 'Toxics Release Inventory'],
    compliance_status: 'significant_violation',
    severity: 'high',
    open_violations: 1,
    recent_violations: 6,
    penalties: 12500,
    last_inspection: '2026-03-15',
  });
});

test('metadata without a required column fails before any facility query', async () => {
  for (const name of ['FacLat', 'FacLong', 'RegistryID', 'FacName']) {
    const rest = idsWithout(name);
    assert.throws(() => echoColumnIds(echoMetadata(rest)), new RegExp(`missing required columns: ${name}`));
    const echo = fakeEcho({ metadata: echoMetadata(rest), facilities: [MONROE] });
    await assert.rejects(fetchFacilities({ fetchImpl: echo.fetchImpl }), /missing required columns/);
    assert.equal(echo.calls.length, 1, 'only the metadata was asked for');
  }
  assert.throws(() => echoColumnIds({ Results: { Message: 'Error' } }), /no result columns/);
  assert.throws(() => echoColumnIds(null), /no result columns/);
});

test('an optional column missing from metadata is dropped, not fatal', async () => {
  const echo = fakeEcho({ metadata: echoMetadata(idsWithout('TRIFlag', 'FacTotalPenalties')), facilities: [MONROE] });
  const [f] = await fetchFacilities({ fetchImpl: echo.fetchImpl });
  assert.deepEqual(f.programs, ['Clean Water Act']);
  assert.equal(f.penalties, 0);
});

test('a head query with no QueryID is a failure, not a skipped county', async () => {
  const echo = fakeEcho({ facilities: [MONROE], head: () => ({ Results: { Error: { ErrorMessage: 'busy' } } }) });
  await assert.rejects(fetchFacilities({ fetchImpl: echo.fetchImpl }), /no query id/);
  const bad = fakeEcho({ facilities: [MONROE], head: () => ({ Results: { QueryID: 'q1' } }) });
  await assert.rejects(fetchFacilities({ fetchImpl: bad.fetchImpl }), /no row count/);
});

test('rows reported but none located is a failure (the October 2026 column renumbering)', async () => {
  // ECHO answered the ids, but with other columns: no FacLat/FacLong in any row.
  const unlocated = { ...MONROE, FacLat: undefined, FacLong: undefined };
  const echo = fakeEcho({ facilities: [unlocated, { ...unlocated, RegistryID: '2' }] });
  await assert.rejects(fetchFacilities({ fetchImpl: echo.fetchImpl }), /reported 36 facility rows but none had a location/);
});

test('zero rows everywhere is a real empty layer, with no get_qid calls', async () => {
  const echo = fakeEcho({ facilities: [] });
  assert.deepEqual(await fetchFacilities({ fetchImpl: echo.fetchImpl }), []);
  assert.equal(echo.calls.filter((u) => u.includes('.get_facilities?')).length, NC08_COUNTY_FIPS.length * 2);
  assert.equal(echo.calls.filter((u) => u.includes('.get_qid?')).length, 0);
});

test('located rows outside NC-08 only are a real empty layer', async () => {
  const echo = fakeEcho({ facilities: [RALEIGH] });
  assert.deepEqual(await fetchFacilities({ fetchImpl: echo.fetchImpl }), []);
});

test('the daily build keeps the stored facilities layer when ECHO rows have no location', async () => {
  const previous = { layer: 'facilities', count: 1, features: [{ id: 'kept' }], assembled_at: '2026-10-19T06:00:00.000Z' };
  const db = createFakeSupabase({
    tables: haloTables('map_layers', 'ucmr5_utilities'),
    seed: { map_layers: [{ layer: 'facilities', payload: previous, assembled_at: previous.assembled_at }] },
  });
  const unlocated = { ...MONROE, FacLat: undefined, FacLong: undefined };
  const echo = fakeEcho({ facilities: [unlocated] });
  const report = await buildAndStoreAll(db, Promise.reject(new Error('geography offline')), { fetchImpl: echo.fetchImpl, apiKey: 'k' });
  assert.equal(report.facilities.ok, false);
  assert.match(report.facilities.error, /none had a location/);
  const row = db.rows('map_layers').find((r) => r.layer === 'facilities');
  assert.deepEqual(row.payload, previous, 'the last stored layer is untouched');
});

test('the daily build stores a true zero as an empty facilities layer', async () => {
  const db = createFakeSupabase({ tables: haloTables('map_layers', 'ucmr5_utilities') });
  const echo = fakeEcho({ facilities: [] });
  const report = await buildAndStoreAll(db, Promise.reject(new Error('geography offline')), { fetchImpl: echo.fetchImpl, apiKey: 'k' });
  assert.deepEqual(report.facilities, { ok: true, count: 0 });
  assert.equal(db.rows('map_layers').find((r) => r.layer === 'facilities').payload.count, 0);
});

test('echoColumnIds skips unusable ids and keeps the first of a duplicated name', () => {
  const col = (ObjectName, ColumnID) => ({ ObjectName, ColumnID });
  const meta = {
    Results: {
      ResultColumns: [col('FacName', '1'), col('FacName', '99'), col('RegistryID', 'x'), col('RegistryID', '6'), col('FacLat', '0'), col('FacLat', '19'), col('FacLong', 20), col('FacCounty', '-3'), null],
    },
  };
  assert.equal(echoColumnIds(meta), '1,6,19,20');
  assert.throws(() => echoColumnIds({ Results: { ResultColumns: [col('FacName', '1'), col('RegistryID', '6'), col('FacLat', '0'), col('FacLong', '')] } }), /missing required columns: FacLat, FacLong/);
});

test('QueryRows pages by 1000 and accepts a thousands separator', async () => {
  const echo = fakeEcho({ facilities: [MONROE], head: () => ({ Results: { QueryID: 'q1', QueryRows: '1,500' } }) });
  await fetchFacilities({ fetchImpl: echo.fetchImpl });
  const pages = echo.calls.filter((u) => u.includes('.get_qid?'));
  assert.equal(pages.length, NC08_COUNTY_FIPS.length * 2 * 2, 'two pages per query');
  assert.ok(pages.some((u) => u.includes('pageno=2')));
});

test('an unreadable or negative QueryRows fails the fetch', async () => {
  for (const QueryRows of ['', 'many', '-1']) {
    const echo = fakeEcho({ facilities: [MONROE], head: () => ({ Results: { QueryID: 'q1', QueryRows } }) });
    await assert.rejects(fetchFacilities({ fetchImpl: echo.fetchImpl }), /no row count/, `QueryRows ${JSON.stringify(QueryRows)}`);
  }
});

test('a metadata HTTP error rejects, so the build keeps the stored layer', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(fetchFacilities({ fetchImpl }));
});

test('a get_qid page without Facilities fails the run; rows without RegistryID count as unlocated', async () => {
  // Only the second page of the last query is missing: still a failure, never a partial layer.
  const bare = async (url) => {
    const href = String(url);
    const lastQuery = href.includes('qid=37179-qiv');
    const body = href.includes('.metadata?')
      ? echoMetadata()
      : href.includes('.get_facilities?')
        ? { Results: { QueryID: href.includes('p_fips=37179&p_act=Y&p_qiv') ? '37179-qiv' : 'q', QueryRows: '1500' } }
        : lastQuery && href.includes('pageno=2')
          ? { Results: {} }
          : { Results: { Facilities: [MONROE] } };
    return { ok: true, json: async () => body };
  };
  await assert.rejects(fetchFacilities({ fetchImpl: bare }), /no facility list/);
  const noId = fakeEcho({ facilities: [{ ...MONROE, RegistryID: undefined }] });
  await assert.rejects(fetchFacilities({ fetchImpl: noId.fetchImpl }), /none had a location/);
});
