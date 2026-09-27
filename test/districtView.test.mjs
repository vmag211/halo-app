import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDistrictView, householdCounty } from '../lib/districtView.js';

const over = { PFOS: [{ date: '7/1/2025', value_ppt: 8 }] };
const under = { PFOS: [{ date: '7/1/2025', value_ppt: 1 }] };
const utilities = [
  { pwsid: 'NC_MONROE', contaminants: over },     // Union County, in NC-08
  { pwsid: 'NC_ALBEMARLE', contaminants: under }, // Stanly County, in NC-08
  { pwsid: 'NC_RALEIGH', contaminants: over },    // Wake County, outside
  { pwsid: 'NC_NOWHERE', contaminants: over },    // no mapped service area
];
const geo = new Map([
  ['NC_MONROE', { lat: 34.9854, lng: -80.5495, population: 1000 }],
  ['NC_ALBEMARLE', { lat: 35.3502, lng: -80.2001, population: 3000 }],
  ['NC_RALEIGH', { lat: 35.7796, lng: -78.6382, population: 9000 }],
]);

test('district figures use only systems inside NC-08', () => {
  const v = buildDistrictView({ utilities, geo, radonZones: { 'Union County': 3, 'Stanly County': 2 } });
  assert.equal(v.scope, 'NC-08');
  assert.equal(v.total_systems, 2);
  assert.equal(v.systems_over_limit, 1);
  assert.equal(v.affected_population, 1000);
  assert.equal(v.exceedance_lines.PFOS, '1 of 2 systems tested for PFOS exceed the limit.');
  assert.equal(v.unlocated_systems, 1);
});

test('per-county rows cover all nine NC-08 counties with radon', () => {
  const v = buildDistrictView({ utilities, geo, radonZones: { 'Union County': 3, 'Stanly County': 2 } });
  assert.equal(v.counties.length, 9);
  const union = v.counties.find((c) => c.county === 'Union County');
  assert.deepEqual(
    { systems: union.systems, over: union.systems_over_limit, worst: union.worst_water_severity, in: union.in_district, zone: union.radon_zone, radon: union.radon_severity },
    { systems: 1, over: 1, worst: 'severe', in: 'whole', zone: 3, radon: 'good' },
  );
  const anson = v.counties.find((c) => c.county === 'Anson County');
  assert.equal(anson.systems, 0);
  assert.equal(anson.worst_water_severity, 'no_data');
  assert.equal(v.counties.find((c) => c.county === 'Cabarrus County').in_district, 'partial');
});

test('state comparison: district vs statewide share of tested systems over a limit', () => {
  const v = buildDistrictView({ utilities, geo });
  assert.equal(v.state_comparison.district_share_over, 0.5); // 1 of 2
  assert.equal(v.state_comparison.state_share_over, 0.75); // 3 of 4 statewide
});

test('county ranking: lowest share of population on over-limit systems ranks 1', () => {
  const v = buildDistrictView({ utilities, geo });
  assert.equal(householdCounty(v, 'Stanly County').water_rank, 1); // 0% over
  assert.equal(householdCounty(v, 'Union County').water_rank, 2); // ties with Wake at 100%
  assert.equal(householdCounty(v, 'Wake County').water_rank, 2);
  assert.equal(householdCounty(v, 'Union County').of, 3);
  assert.equal(householdCounty(v, 'Anson County').water_rank, null); // no data → unranked, not "best"
  assert.equal(householdCounty(v, null), null);
});
