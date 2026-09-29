import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMapboxFeature, roundCoord, serviceAreaFromArcgis, validateHomeYear, radonAppliesTo, parseRequestId, locationMoved } from '../lib/geocode.js';

const feature = (regionCode, countyText = 'Union County') => ({
  center: [-80.54321, 35.012345],
  context: [
    { id: 'postcode.1', text: '28173' },
    { id: 'district.2', text: countyText },
    { id: 'region.3', text: 'X', short_code: regionCode },
  ],
});

test('state comes from the region short_code', () => {
  assert.equal(parseMapboxFeature(feature('US-NC')).state, 'NC');
  assert.equal(parseMapboxFeature(feature('US-SC')).state, 'SC');
  assert.equal(parseMapboxFeature(feature('ca-on')).state, null); // not a US state
  assert.equal(parseMapboxFeature({ center: [0, 0], context: [] }).state, null);
});

test('county and coordinates parse as before', () => {
  const p = parseMapboxFeature(feature('US-NC'));
  assert.equal(p.county, 'Union County');
  assert.equal(p.lat, 35.012345);
  assert.equal(p.lng, -80.54321);
});

test('radon applies to NC, and to legacy profiles with no state, never elsewhere', () => {
  assert.equal(radonAppliesTo('NC'), true);
  assert.equal(radonAppliesTo(null), true);
  assert.equal(radonAppliesTo('SC'), false);
});

test('coordinates round to ~100 m', () => {
  assert.equal(roundCoord(35.012345), 35.012);
  assert.equal(roundCoord(-80.54361), -80.544);
  assert.equal(roundCoord(NaN), null);
});

test('ArcGIS: found / not found / failed are three different outcomes', () => {
  assert.deepEqual(serviceAreaFromArcgis({ ok: true, json: { features: [{ attributes: { PWSID: 'NC0113010' } }] } }), { pwsid: 'NC0113010', status: 'measured' });
  assert.deepEqual(serviceAreaFromArcgis({ ok: true, json: { features: [] } }), { pwsid: null, status: 'outside_known_area' });
  assert.equal(serviceAreaFromArcgis(null).status, 'lookup_failed');
  assert.equal(serviceAreaFromArcgis({ ok: false }).status, 'lookup_failed');
  assert.equal(serviceAreaFromArcgis({ ok: true, json: { error: { code: 400 } } }).status, 'lookup_failed');
});

test('home year: integers 1700–now or blank; everything else rejected', () => {
  const now = new Date('2026-09-27');
  assert.deepEqual(validateHomeYear(1975, now), { ok: true, value: 1975 });
  assert.deepEqual(validateHomeYear('1988', now), { ok: true, value: 1988 });
  assert.deepEqual(validateHomeYear('', now), { ok: true, value: null });
  assert.deepEqual(validateHomeYear(null, now), { ok: true, value: null });
  for (const bad of [1699, 2027, 1975.5, 'abc', '19 75', -1]) {
    assert.equal(validateHomeYear(bad, now).ok, false, String(bad));
  }
});

test('request id: a UUID (lowercased) or null, never an error', () => {
  assert.equal(parseRequestId('0F8FAD5B-D9CB-469F-A165-70867728950E'), '0f8fad5b-d9cb-469f-a165-70867728950e');
  for (const bad of [undefined, null, '', 'abc', 42, '0f8fad5b-d9cb-469f-a165-70867728950e; drop']) {
    assert.equal(parseRequestId(bad), null, String(bad));
  }
});

test('location moved: only a different stored point counts', () => {
  assert.equal(locationMoved({ lat: 35.1, lng: -80.2 }, { lat: 35.1, lng: -80.2 }), false);
  assert.equal(locationMoved({ lat: 35.1, lng: -80.2 }, { lat: 35.101, lng: -80.2 }), true);
  assert.equal(locationMoved({ lat: null, lng: null }, { lat: 35.1, lng: -80.2 }), false);
  assert.equal(locationMoved(null, { lat: 35.1, lng: -80.2 }), false);
});
