import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterPayload, radonPayload, readLayer } from '../lib/mapBuild.js';

const utilities = [
  { pwsid: 'NC0000001', pws_name: 'A', status: 'measured', contaminants: { PFOS: [{ date: '10/23/2024', value_ppt: 8 }, { date: '1/7/2025', value_ppt: 3 }] } },
  { pwsid: 'NC0000002', pws_name: 'B', status: 'measured', contaminants: { PFOA: [{ date: '1/7/2025', value_ppt: 1 }] } },
];
const geo = new Map([['NC0000001', { lat: 35, lng: -80, population: 10 }]]);

test('water payload joins geometry and reports located count, quarters, counts', () => {
  const p = waterPayload(utilities, geo);
  assert.equal(p.count, 2);
  assert.equal(p.located, 1);
  assert.deepEqual(p.quarters, ['2024Q4', '2025Q1']);
  assert.equal(p.counts.by_contaminant.PFOS.tested, 1);
  assert.equal(p.counts.by_contaminant.PFOS.over, 0); // most recent reading (3) is under
  assert.match(p.note, /1 of 2 systems have no mapped service area/);
});

test('a quarter shows the system as it was then, and drops systems with nothing that quarter', () => {
  const q4 = waterPayload(utilities, geo, { quarter: '2024Q4' });
  assert.equal(q4.quarter, '2024Q4');
  assert.equal(q4.count, 1);
  assert.equal(q4.features[0].contaminants.PFOS.value_ppt, 8);
  assert.equal(q4.counts.by_contaminant.PFOS.over, 1);
});

test('radon payload covers every NC county', () => {
  assert.equal(radonPayload().count, 100);
});

test('readLayer: missing table, missing row, or stale row → null; fresh row → payload', async () => {
  const db = (result) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) });
  assert.equal(await readLayer(db({ data: null, error: { message: 'no table' } }), 'water'), null);
  assert.equal(await readLayer(db({ data: null, error: null }), 'water'), null);
  const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  assert.equal(await readLayer(db({ data: { payload: { a: 1 }, assembled_at: old }, error: null }), 'water'), null);
  const fresh = new Date().toISOString();
  assert.deepEqual(await readLayer(db({ data: { payload: { a: 1 }, assembled_at: fresh }, error: null }), 'water'), { a: 1 });
});
