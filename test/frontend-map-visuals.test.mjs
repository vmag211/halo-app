import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { recordDensity, densityRGBA } = await loadFrontend('map-visuals');
const { waterFeatures, waterMapReading, waterSampleDate, observationTime } = await loadFrontend('map-preview');
const { fitRecordView, findMapRecords, distanceMiles } = await loadFrontend('map-tools');
const { waterSymbolRadius, mapSymbols, mapNumberLayout } = await loadFrontend('map-symbols');

test('bounded heat accumulation matches the reference kernel, including offscreen sources', () => {
  const sources = [[-4, 8], [12, 16], [18, 14], [120, 120]];
  const { field, cols, rows } = recordDensity(sources, 41, 35, 15);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const expected = sources.reduce((sum, [sx, sy]) => {
      const d2 = ((x * 4 - sx) ** 2 + (y * 4 - sy) ** 2) / 15 ** 2;
      return sum + (d2 < 1 ? (1 - d2) ** 2 : 0);
    }, 0);
    assert.ok(Math.abs(field[y * cols + x] - expected) < .000001);
  }
});
test('record density remains additive and pan invariant with a fixed radius', () => {
  const one = recordDensity([[12, 12]], 32, 32, 8);
  const two = recordDensity([[12, 12], [12, 12]], 32, 32, 8);
  assert.equal(one.field[3 * one.cols + 3], 1);
  assert.equal(two.field[3 * two.cols + 3], 2);
  const moved = recordDensity([[16, 16]], 36, 36, 8);
  assert.equal(moved.field[4 * moved.cols + 4], one.field[3 * one.cols + 3]);
  assert.deepEqual(densityRGBA(2), densityRGBA(20));
});
test('empty and invalid density do not paint a low-value pollution surface', () => {
  assert.ok(recordDensity([], 40, 40, 15).field.every(v => v === 0));
  assert.ok(recordDensity([[10, 10]], 40, 40, 0).field.every(v => v === 0));
  assert.deepEqual(densityRGBA(0), [0, 0, 0, 0]);
  assert.deepEqual(densityRGBA(NaN), [0, 0, 0, 0]);
});
test('point and list readings preserve zero, missing, selected units and index', () => {
  const records = waterFeatures();
  assert.equal(waterMapReading(records[3], 'pfoa'), '0 ppt');
  assert.equal(waterMapReading(records[5], 'pfoa'), 'No detection reported');
  assert.equal(waterMapReading(records[5], 'overall'), 'No comparable result');
  assert.equal(waterMapReading(records[0], 'pfoa'), '5.8 ppt');
  assert.equal(waterMapReading(records[0], 'overall'), '2 over limit');
  assert.equal(waterMapReading({ ...records[0], hazard_index: null }, 'hazard'), 'No index available');
});
test('selected compound dates do not borrow a newer system sample, and station times are explicit', () => {
  const record = waterFeatures()[0];
  const changed = { ...record, latest_sample_iso:'2026-01-01', contaminants:{ ...record.contaminants, PFOA:{...record.contaminants.PFOA, date_iso:'2025-01-01'} } };
  assert.equal(waterSampleDate(changed, 'pfoa'), '2025-01-01');
  assert.equal(waterSampleDate(changed, 'overall'), '2026-01-01');
  assert.equal(waterSampleDate({...changed, contaminants:{}}, 'pfoa'), undefined);
  assert.match(observationTime('2026-10-01T10:00:00Z'), /10:00 AM UTC/);
  assert.equal(observationTime(null), 'No observation time available');
});

test('semantic symbols share paths and population sizing keeps unknown small', () => {
  assert.equal(waterSymbolRadius(null), 8);
  assert.equal(waterSymbolRadius(0), 8);
  assert.equal(waterSymbolRadius(10000000), 16);
  assert.ok(waterSymbolRadius(60000) > waterSymbolRadius(20000));
  assert.notEqual(mapSymbols.water.body, mapSymbols.facilities.body);
  assert.equal(mapSymbols.air.body, '');
  assert.ok(mapSymbols.air.detail.includes('M2 12'));
});
test('canvas numbers have equal digit advances without changing source text', () => {
  const measure = c => c === '1' ? 3 : c === '8' ? 8 : 5;
  const one = mapNumberLayout('11.1 ppt', measure), eight = mapNumberLayout('88.8 ppt', measure);
  assert.equal(one.width, eight.width);
  assert.equal(one.characters.map(c=>c.character).join(''), '11.1 ppt');
  assert.equal(one.characters[1].x - one.characters[0].x, 8);
});
test('fit ignores invalid or out-of-atlas positions and accommodates a phone extent', () => {
  assert.equal(fitRecordView([], 375, 420), null);
  assert.equal(fitRecordView([{lat:NaN,lng:-80}], 375, 420), null);
  assert.equal(fitRecordView([{lat:50,lng:100}], 375, 420), null);
  assert.equal(fitRecordView([{lat:35,lng:-80}], 0, 420), null);
  const locations = [{lat:33.7529,lng:-84.3218},{lat:36.5881,lng:-75.4001}];
  const view = fitRecordView(locations, 375, 420);
  assert.ok(view.zoom >= 5 && view.zoom < 6);
  const scale=256*2**view.zoom;
  assert.ok((locations[1].lng-locations[0].lng)/360*scale <= 245.001);
  assert.equal(fitRecordView([{lat:35,lng:-80}], 375, 420).zoom, 10);
});
test('search intersects map scope, supports multiple terms and sorts unknown location last', () => {
  const records=[
    {id:'one',name:'Zeta Water',sub:'Service-area center',lat:35,lng:-80},
    {id:'two',name:'Alpha Water',sub:'No mapped location',lat:null,lng:null},
    {id:'three',name:'Beta Facility',sub:'Selected facility',lat:36,lng:-80},
  ];
  assert.deepEqual(findMapRecords(records,' WATER  one ',null,null).map(p=>p.id),['one']);
  assert.deepEqual(findMapRecords(records,'',[],null),[]);
  assert.deepEqual(findMapRecords(records,'water',['one'],null).map(p=>p.id),['one']);
  assert.deepEqual(findMapRecords(records,'',null,{lat:35,lng:-80}).map(p=>p.id),['one','three','two']);
  assert.equal(findMapRecords(records,'two',null,{lat:35,lng:-80})[0].distance,null);
  assert.equal(distanceMiles({lat:35,lng:-80},{lat:35,lng:-80}),0);
});
