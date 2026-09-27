import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toIsoDate, contaminantsWithIso, scoredWithFlags, excludedWithIso, latestUnregulated, waterConfidence,
} from '../lib/waterPresentation.js';

test('M/D/YYYY and ISO both become YYYY-MM-DD; junk is null', () => {
  assert.equal(toIsoDate('10/23/2024'), '2024-10-23');
  assert.equal(toIsoDate('1/7/2025'), '2025-01-07');
  assert.equal(toIsoDate('2025-04-01T00:00:00Z'), '2025-04-01');
  assert.equal(toIsoDate('13/1/2025'), null);
  assert.equal(toIsoDate(undefined), null);
});

test('every reading keeps its old date and gains date_iso', () => {
  const c = contaminantsWithIso({ PFOS: [{ date: '10/23/2024', value_ppt: 8.2 }] });
  assert.deepEqual(c.PFOS[0], { date: '10/23/2024', value_ppt: 8.2, date_iso: '2024-10-23' });
});

test('exceeds_limit is value > limit, strictly', () => {
  const [a, b, c] = scoredWithFlags([
    { contaminant: 'PFOS', value_ppt: 7.3, limit_ppt: 4, date: '7/1/2025' },
    { contaminant: 'PFOA', value_ppt: 4, limit_ppt: 4 },
    { contaminant: 'X', value_ppt: 1, limit_ppt: null },
  ]);
  assert.equal(a.exceeds_limit, true);
  assert.equal(a.date_iso, '2025-07-01');
  assert.equal(b.exceeds_limit, false); // at the limit is not above it
  assert.equal(c.exceeds_limit, false);
});

test('excluded entries gain date_iso', () => {
  assert.equal(excludedWithIso([{ contaminant: 'lithium', date: '4/1/2025' }])[0].date_iso, '2025-04-01');
});

test('latest unregulated reading is chosen by date, not array order', () => {
  const out = latestUnregulated(
    { PFPeA: [{ date: '4/1/2025', value_ppt: 3 }, { date: '10/23/2024', value_ppt: 9 }] },
    ['PFPeA', 'Missing'],
  );
  assert.deepEqual(out, [{ contaminant: 'PFPeA', value_ppt: 3, date_iso: '2025-04-01' }]);
});

test('confidence: limited only for partial coverage; age only ever makes it stale', () => {
  assert.equal(waterConfidence('complete', 800), 'full'); // 2–3 years old is still full
  assert.equal(waterConfidence('excluded_only', 100), 'full'); // lithium-only
  assert.equal(waterConfidence('partial', 100), 'limited');
  assert.equal(waterConfidence('complete', 1200), 'stale');
  assert.equal(waterConfidence('partial', 1200), 'stale');
  assert.equal(waterConfidence('unscoreable', 10), 'none');
  assert.equal(waterConfidence(null, null), 'none');
});
