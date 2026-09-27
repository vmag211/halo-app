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
