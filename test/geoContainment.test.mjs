import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countyForPoint, inNc08, allCounties, pointInGeometry } from '../lib/geoContainment.js';

test('known points land in the right county', () => {
  assert.equal(countyForPoint(35.3846, -80.6003), 'Cabarrus County'); // Concord service-area centroid
  assert.equal(countyForPoint(34.9854, -80.5495), 'Union County'); // Monroe
  assert.equal(countyForPoint(35.7796, -78.6382), 'Wake County'); // Raleigh
  assert.equal(countyForPoint(35.5951, -82.5515), 'Buncombe County'); // Asheville
  assert.equal(countyForPoint(40.7128, -74.006), null); // New York
});

test('NC-08 membership follows the district line, not county names', () => {
  assert.equal(inNc08(34.9854, -80.5495), true); // Monroe, Union County — wholly in NC-08
  assert.equal(inNc08(35.3502, -80.2001), true); // Albemarle, Stanly County
  assert.equal(inNc08(35.7796, -78.6382), false); // Raleigh
  assert.equal(inNc08(35.5951, -82.5515), false); // Asheville
});

test('100 NC counties are loaded', () => {
  assert.equal(allCounties().length, 100);
});

test('holes are respected', () => {
  const donut = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(pointInGeometry(2, 2, donut), true);
  assert.equal(pointInGeometry(5, 5, donut), false);
});
