// The UCMR5 importer (uploadData.js via lib/ucmr5Import.cjs) keeps documented non-detects
// ('<' rows) with their sample date and reporting limit, in the shape lib/scoring.js reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import importer from '../lib/ucmr5Import.cjs';
import { getWaterRisk } from '../lib/scoring.js';
import { waterDetailSeverity } from '../lib/severity.js';

const { parseUcmr5Lines } = importer;

const header = ['PWSID', 'PWSName', 'CollectionDate', 'Contaminant', 'MRL', 'Units', 'AnalyticalResultsSign', 'AnalyticalResultValue'].join('\t');
const row = (...cells) => cells.join('\t');
const fixture = [
  header,
  // A system with only non-detects, all reporting limits at or below the MCLs.
  row('NC0000001', 'Nondetect Water', '3/4/2024', 'PFOA', '0.004', 'µg/L', '<', ''),
  row('NC0000001', 'Nondetect Water', '3/4/2024', 'PFOA', '0.004', 'µg/L', '<', ''), // second sample point
  row('NC0000001', 'Nondetect Water', '3/4/2024', 'PFOS', '0.004', 'µg/L', '<', ''),
  row('NC0000001', 'Nondetect Water', '3/4/2024', 'HFPO-DA', '0.005', 'µg/L', '<', ''),
  // A detection beside a non-detect.
  row('NC0000002', 'Mixed Water', '7/1/2025', 'PFOS', '0.004', 'µg/L', '=', '0.0081'),
  row('NC0000002', 'Mixed Water', '7/1/2025', 'PFOA', '0.004', 'µg/L', '<', ''),
  // A non-detect with no reporting limit, and a row in other units.
  row('NC0000003', 'Odd Water', '7/1/2025', 'PFOA', '', 'µg/L', '<', ''),
  row('NC0000003', 'Odd Water', '7/1/2025', 'PFOS', '4', 'ng/L', '=', '9'),
  // An unreadable detection value.
  row('NC0000004', 'Blank Water', '7/1/2025', 'PFOS', '0.004', 'µg/L', '=', ''),
];

test('non-detects are kept with sample date and reporting limit in ppt, once per compound, date and limit', () => {
  const { utilities, stats } = parseUcmr5Lines(fixture);
  const byId = Object.fromEntries(utilities.map((u) => [u.pwsid, u]));
  assert.deepEqual(byId.NC0000001.contaminants.PFOA, [{ date: '3/4/2024', non_detect: true, reporting_limit_ppt: 4 }]);
  assert.deepEqual(byId.NC0000001.contaminants['HFPO-DA'], [{ date: '3/4/2024', non_detect: true, reporting_limit_ppt: 5 }]);
  assert.deepEqual(byId.NC0000002.contaminants.PFOS, [{ date: '7/1/2025', value_ppt: 8.1 }]);
  assert.deepEqual(byId.NC0000003.contaminants.PFOA, [{ date: '7/1/2025', non_detect: true, reporting_limit_ppt: null }]);
  assert.equal(byId.NC0000003.contaminants.PFOS, undefined, 'a value in other units is not converted as if it were µg/L');
  assert.deepEqual(byId.NC0000004.contaminants, {}, 'an unreadable value is not stored as a result');
  assert.deepEqual(stats, { detections: 1, non_detects: 5, duplicate_non_detects: 1, skipped_units: 1, skipped_unreadable: 1, skipped_other_sign: 0 });
  assert.equal(byId.NC0000001.status, 'measured');
});

test('imported rows score as their own categories', () => {
  const byId = Object.fromEntries(parseUcmr5Lines(fixture).utilities.map((u) => [u.pwsid, u]));
  const nondetect = getWaterRisk(byId.NC0000001.contaminants);
  assert.equal(nondetect.coverage, 'no_detections');
  assert.equal(nondetect.risk, 0);
  assert.equal(waterDetailSeverity(nondetect), 'good');
  assert.deepEqual(nondetect.regulated_panel.non_detect, ['PFOA', 'PFOS', 'HFPO-DA']);

  const mixed = getWaterRisk(byId.NC0000002.contaminants);
  assert.equal(waterDetailSeverity(mixed), 'high');

  const odd = getWaterRisk(byId.NC0000003.contaminants);
  assert.equal(odd.risk, null, 'a non-detect with no reporting limit is not a comparison');
  assert.equal(waterDetailSeverity(odd), 'no_data');

  const blank = getWaterRisk(byId.NC0000004.contaminants);
  assert.equal(waterDetailSeverity(blank), 'no_data');
});

test('a file without a required column is refused, and one without Units or MRL still loads', () => {
  assert.throws(() => parseUcmr5Lines(['PWSID\tPWSName']), /missing/);
  const legacy = ['PWSID\tPWSName\tCollectionDate\tContaminant\tAnalyticalResultsSign\tAnalyticalResultValue', 'NC1\tW\t1/1/2024\tPFOA\t<\t', 'NC1\tW\t1/1/2024\tPFOS\t=\t0.002'];
  const [u] = parseUcmr5Lines(legacy).utilities;
  assert.deepEqual(u.contaminants, { PFOA: [{ date: '1/1/2024', non_detect: true, reporting_limit_ppt: null }], PFOS: [{ date: '1/1/2024', value_ppt: 2 }] });
});

test('a Latin-1 µ read as UTF-8 (U+FFFD) still counts as µg/L, as in the EPA file', () => {
  const lines = [header, row('NC0000009', 'Latin Water', '7/1/2025', 'PFOS', '0.004', '\uFFFDg/L', '=', '0.0081'), row('NC0000009', 'Latin Water', '7/1/2025', 'PFOA', '0.004', '\uFFFDg/L', '<', '')];
  const { utilities, stats } = parseUcmr5Lines(lines);
  assert.equal(stats.skipped_units, 0);
  assert.deepEqual(utilities[0].contaminants, { PFOS: [{ date: '7/1/2025', value_ppt: 8.1 }], PFOA: [{ date: '7/1/2025', non_detect: true, reporting_limit_ppt: 4 }] });
});
