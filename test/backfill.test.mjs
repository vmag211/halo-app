import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackfillRows, backfillHousehold, recordToday } from '../lib/backfill.js';

const air = {
  hourly: {
    time: ['2026-09-25T00:00', '2026-09-25T14:00', '2026-09-26T09:00', '2026-09-27T10:00'],
    us_aqi: [30, 61, 44, 50],
  },
};
const weather = {
  daily: {
    time: ['2026-09-25', '2026-09-26', '2026-09-27'],
    uv_index_max: [6.1, null, 5],
    relative_humidity_2m_mean: [82, 55, 60],
    precipitation_probability_max: [40, 0, 10],
  },
};

test('builds one row per past day: daily peak AQI, max UV, mold from the day’s inputs', () => {
  const rows = buildBackfillRows({ air, weather, existingDates: [], today: '2026-09-27', profileId: 'p1' });
  assert.equal(rows.length, 2); // today is excluded
  const [a, b] = rows;
  assert.equal(a.date, '2026-09-25');
  assert.equal(a.aqi, 61); // peak, not the first hour
  assert.equal(a.uv_index, 6.1);
  assert.equal(a.mold_risk, 'high'); // 82% humidity + 40% rain
  assert.deepEqual(a.details.mold_basis, { humidity_pct: 82, precip_pct: 40 });
  assert.equal(a.aqi_source, 'open-meteo');
  assert.equal(a.details.backfilled, true);
  assert.equal(b.uv_index, null); // missing stays missing
});

test('pollen is recorded as missing, never zero', () => {
  const [row] = buildBackfillRows({ air, weather, existingDates: [], today: '2026-09-27', profileId: 'p1' });
  assert.deepEqual(JSON.parse(row.pollen_level), { tree: null, grass: null, weed: null });
});

test('never overwrites a day that already has a reading', () => {
  const rows = buildBackfillRows({ air, weather, existingDates: new Set(['2026-09-25']), today: '2026-09-27', profileId: 'p1' });
  assert.deepEqual(rows.map((r) => r.date), ['2026-09-26']);
});

test('a day with no readings at all is skipped', () => {
  const rows = buildBackfillRows({
    air: { hourly: { time: [], us_aqi: [] } },
    weather: { daily: { time: ['2026-09-20'], uv_index_max: [null], relative_humidity_2m_mean: [null], precipitation_probability_max: [null] } },
    existingDates: [], today: '2026-09-27', profileId: 'p1',
  });
  assert.equal(rows.length, 0);
});

// A fake Supabase: records inserts, returns existing dates.
function fakeDb(existing = []) {
  const inserted = [];
  const q = {
    select() { return q; }, eq() { return q; }, gte() { return q; },
    lte() { return Promise.resolve({ data: existing.map((date) => ({ date })), error: null }); },
    insert(rows) { inserted.push(...rows); return Promise.resolve({ error: null }); },
  };
  return { inserted, from: () => q };
}

test('backfillHousehold inserts missing days and never throws', async () => {
  const db = fakeDb(['2026-09-26']);
  const fetchImpl = async (url) => ({ ok: true, json: async () => (url.includes('air-quality') ? air : weather) });
  const r = await backfillHousehold(db, 'p1', { lat: 35.4, lng: -80.6 }, { fetchImpl, today: '2026-09-27' });
  assert.equal(r.inserted, 1);
  assert.equal(db.inserted[0].date, '2026-09-25');

  const failing = await backfillHousehold(fakeDb(), 'p1', { lat: 1, lng: 1 }, { fetchImpl: async () => ({ ok: false, status: 500 }), today: '2026-09-27' });
  assert.equal(failing.inserted, 0);
  assert.ok(failing.error);
});

test('recordToday skips a household that already has today’s reading', async () => {
  const r = await recordToday(fakeDb(['2026-09-27']), { id: 'p1', lat: 1, lng: 1 }, { today: '2026-09-27' });
  assert.equal(r, 'already_had_one');
});
