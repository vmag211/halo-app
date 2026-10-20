/**
 * lib/dailyMaxima.js: the daily-maximum method and the evidence answer
 * (B08 Task 2; docs/backend/plans/b08-evidence.md, rulings E1 to E24).
 *
 * Five parts, in order.
 *
 *  1. The client's code. readingLabel, analyzeHistory and the hook's
 *     validator come from test/helpers/frontendB08.mjs (the first two are the real .ts functions, the hook is a transcription); the drift
 *     test reads the frontend source now and requires it to equal the
 *     transcription once its types are stripped, the transcription is shown
 *     rejecting what the client rejects, and the two real .ts functions are
 *     run beside their transcriptions.
 *  2. The day (E2) and the coverage threshold (E3), DST included.
 *  3. The two series (E3, E6, E8): AirNow stations and Open-Meteo models.
 *  4. Settling (E4), the Air kind (E8), first full day (E9), the run's days.
 *  5. The snapshot (E12 to E18), then copy and purity (E1, E16, E24).
 *
 * Pure: no database, no network, no clock. Every date is fixed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFrontend } from './frontend-test-loader.mjs';
import { TRANSCRIPTIONS, analyzeHistory, productionHistory, readingLabel } from './helpers/frontendB08.mjs';
import {
  HISTORY_FACTORS, ISSUED_UNKNOWN, METHOD_VERSION, MISSING, NOT_RECORDED_SOURCE, SOURCE_LABELS, STATION_RADIUS_KM,
  airCoverageFor, airNowDailyMaxima, airSourceCode, buildHistorySnapshot, chooseAirKind, completedDays,
  coverageNeeded, firstFullDay, haversineKm, isCalendarDate, localDaySlots, openMeteoDailyMaxima, settleDay,
} from '../lib/dailyMaxima.js';
import { addDays } from '../lib/localDate.js';

const EM_DASH = String.fromCharCode(0x2014);
const SOURCE = await readFile(new URL('../lib/dailyMaxima.js', import.meta.url), 'utf8');
const real = await loadFrontend('week-evidence-preview');

const SPRING = '2026-03-08'; // 23 hours in New York
const FALL = '2026-11-01'; // 25 hours
const NORMAL = '2026-10-18';
const TODAY = '2026-10-19';
const CONTEXT = '11111111-1111-4111-8111-111111111111';
const HOME = { lat: 35.0, lng: -80.6 };
// Along a meridian, a degree of latitude is this many km at the module's radius.
const KM_PER_DEG = (6371.0088 * Math.PI) / 180;
const north = (km) => ({ lat: HOME.lat + km / KM_PER_DEG, lng: HOME.lng });

// ---------------------------------------------------------------------------
// 1. The client's code
// ---------------------------------------------------------------------------

/** The frontend text for one transcription, with its recorded annotations removed. */
function stripped(t, sourceText) {
  const lines = sourceText.split(/\r?\n/);
  let text = lines.slice(t.line - 1, t.line - 1 + t.lines).join('\n');
  for (const [from, to] of t.strip) {
    const at = text.indexOf(from);
    assert.ok(at >= 0 && text.indexOf(from, at + 1) < 0, `${t.file}:${t.line}: "${from}" occurs exactly once`);
    text = text.slice(0, at) + to + text.slice(at + from.length);
  }
  if (t.before !== undefined) assert.equal(lines[t.line - 2], t.before, `${t.file}:${t.line - 1} is the hook's evidence.read call`);
  return text;
}
const transcribed = (t) => {
  const text = t.fn.toString();
  return t.body ? text.split('\n').slice(1, -1).join('\n') : text;
};

test('drift: each transcription is its frontend source, read now, with only the recorded types stripped', async () => {
  assert.equal(TRANSCRIPTIONS.length, 1, 'only the .tsx hook is still transcribed; the two .ts functions are imported');
  for (const t of TRANSCRIPTIONS) {
    const sourceText = await readFile(new URL(`../${t.file}`, import.meta.url), 'utf8');
    assert.equal(stripped(t, sourceText), transcribed(t), `${t.file}:${t.line} changed; re-transcribe it`);
  }
});

test('drift: the comparison notices a one-character change in the frontend source', async () => {
  for (const t of TRANSCRIPTIONS) {
    const sourceText = await readFile(new URL(`../${t.file}`, import.meta.url), 'utf8');
    const lines = sourceText.split(/\r?\n/);
    // Weaken the first strict comparison in the transcribed range by one character.
    const i = range(t.lines, t.line - 1).find((n) => lines[n].includes('==='));
    assert.ok(i !== undefined, `${t.file}:${t.line} has a comparison to change`);
    lines[i] = lines[i].replace('===', '==');
    assert.notEqual(stripped(t, lines.join('\n')), transcribed(t), `${t.file}:${t.line}`);
  }
});

const goodSnapshot = () => buildHistorySnapshot({
  from: addDays(TODAY, -83), to: TODAY, today: TODAY, context: CONTEXT,
  rows: [stored({ local_date: '2026-10-18', value: 42 }), stored({ local_date: '2026-10-18', factor: 'uv', value: 3.4 })],
  recordingFrom: '2026-10-01', firstFullDay: '2026-09-01',
});
const runtimeFor = (homeContextId) => ({ homeContextId });

test('the transcribed validator rejects what the client rejects, and accepts the snapshot', () => {
  const ok = productionHistory({ data: goodSnapshot(), error: null }, runtimeFor(CONTEXT));
  assert.ok(ok.data, 'the snapshot passes for a client on the same context');
  assert.equal(ok.error, null);
  const refused = (mutate, runtime = runtimeFor(CONTEXT)) => {
    const data = structuredClone(goodSnapshot());
    mutate(data);
    return productionHistory({ data, error: null }, runtime);
  };
  const cases = {
    'app-time basis': (d) => { d.comparison.basis = 'app-time observation'; },
    'a value as a string': (d) => { d.rows.find((r) => r.value !== null).value = '32'; },
    'a non-finite value': (d) => { d.rows[0].value = Infinity; },
    'complete missing': (d) => { delete d.complete; },
    'an unknown factor': (d) => { d.rows[0].factor = 'Water'; },
    'a bad date': (d) => { d.rows[0].date = '2026-10-1'; },
    'issued missing': (d) => { delete d.rows[0].issued; },
    'a row context missing': (d) => { delete d.rows[0].context; },
    'version not a string': (d) => { d.comparison.version = 1; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const r = refused(mutate);
    assert.equal(r.data, null, name);
    assert.equal(r.error, 'History could not be verified.', name);
  }
  const stale = productionHistory({ data: goodSnapshot(), error: null }, runtimeFor('22222222-2222-4222-8222-222222222222'));
  assert.equal(stale.data, null, 'a mismatched context');
  assert.equal(stale.error, 'History could not be verified.');
  const nullClient = productionHistory({ data: goodSnapshot(), error: null }, runtimeFor(null));
  assert.equal(nullClient.data, null, 'a client without a context does not take a context\'s rows');
});

test('the helper hands the suites the real readingLabel and analyzeHistory, and they run on the snapshot', () => {
  assert.equal(readingLabel, real.readingLabel);
  assert.equal(analyzeHistory, real.analyzeHistory);
  const snap = goodSnapshot();
  for (const row of [...snap.rows.slice(0, 8), ...snap.rows.slice(-8), undefined]) {
    assert.equal(readingLabel(row), real.readingLabel(row));
  }
  const entries = checkins(['2026-10-18'], true);
  for (const factor of HISTORY_FACTORS) {
    assert.deepEqual(
      analyzeHistory(entries, snap.rows, addDays(TODAY, -83), TODAY, 'household', factor, snap.comparison),
      real.analyzeHistory(entries, snap.rows, addDays(TODAY, -83), TODAY, 'household', factor, snap.comparison),
      factor,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. The day and the coverage threshold (E2, E3)
// ---------------------------------------------------------------------------

test('E2: a New York day is 24 hours, 23 on spring-forward and 25 on fall-back, midnight to midnight', () => {
  const normal = localDaySlots(NORMAL);
  assert.equal(normal.length, 24);
  assert.equal(normal[0], '2026-10-18T04:00:00.000Z', 'local midnight, EDT');
  assert.equal(normal.at(-1), '2026-10-19T03:00:00.000Z');
  const spring = localDaySlots(SPRING);
  assert.equal(spring.length, 23);
  assert.equal(spring[0], '2026-03-08T05:00:00.000Z', 'local midnight, EST');
  assert.equal(spring.at(-1), '2026-03-09T03:00:00.000Z', 'the last hour before EDT midnight');
  const fall = localDaySlots(FALL);
  assert.equal(fall.length, 25);
  assert.equal(fall[0], '2026-11-01T04:00:00.000Z', 'local midnight, EDT');
  assert.equal(fall.at(-1), '2026-11-02T04:00:00.000Z', 'the last hour before EST midnight');
  assert.equal(localDaySlots('2026-01-15').length, 24);
  assert.ok(Object.isFrozen(normal));
  // Consecutive days tile time with no gap and no overlap.
  for (const date of ['2026-03-07', SPRING, '2026-10-31', FALL]) {
    const next = localDaySlots(addDays(date, 1));
    assert.equal(Date.parse(next[0]) - Date.parse(localDaySlots(date).at(-1)), 3600000, date);
  }
  assert.throws(() => localDaySlots('2026-02-30'), TypeError);
  assert.throws(() => localDaySlots('2026-1-05'), TypeError);
});

test('E3: coverage is ceil(75 percent) of the day: 18 of 24, 18 of 23, 19 of 25', () => {
  assert.equal(coverageNeeded(localDaySlots(NORMAL)), 18);
  assert.equal(coverageNeeded(localDaySlots(SPRING)), 18);
  assert.equal(coverageNeeded(localDaySlots(FALL)), 19);
  assert.equal(coverageNeeded(24), 18);
  assert.throws(() => coverageNeeded(0), TypeError);
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
});

// ---------------------------------------------------------------------------
// 3. The series
// ---------------------------------------------------------------------------

/** AirNow `aq/data` rows (W: lib/mapLayers.js:86-110) for one station, pollutant and day. */
function airRows({ id = '370710016', at = north(5), date = NORMAL, parameter = 'OZONE', hours = null, aqi = (i) => 20 + i, extra = {} } = {}) {
  const slots = localDaySlots(date);
  const pick = hours ?? slots.map((_, i) => i);
  return pick.map((i) => ({
    FullAQSCode: id, IntlAQSCode: `840${id}`, SiteName: 'Example Site Name', AgencyName: 'Example Agency',
    Latitude: at.lat, Longitude: at.lng, UTC: slots[i].slice(0, 16), Parameter: parameter, Unit: 'UG/M3',
    Value: 1, Category: 1, AQI: typeof aqi === 'function' ? aqi(i) : aqi, ...extra,
  }));
}
const range = (n, from = 0) => Array.from({ length: n }, (_, i) => from + i);
const oneDay = (rows, date = NORMAL, point = HOME) => airNowDailyMaxima(rows, point, [date])[0];

test('AirNow: the hourly AQI is the worst pollutant, and the day is the largest hour', () => {
  const rows = [
    ...airRows({ parameter: 'OZONE', aqi: (i) => (i === 15 ? 71 : 30) }),
    ...airRows({ parameter: 'PM2.5', aqi: (i) => (i === 3 ? 64 : 40) }),
  ];
  assert.deepEqual(oneDay(rows), { date: NORMAL, stationFound: true, stationId: '370710016', value: 71, hoursExpected: 24, hoursObserved: 24 });
  // Within an hour the larger pollutant wins; a smaller one never lowers it.
  const flat = [...airRows({ parameter: 'OZONE', aqi: 50 }), ...airRows({ parameter: 'PM2.5', aqi: 12 })];
  assert.equal(oneDay(flat).value, 50);
});

test('AirNow, E3 per pollutant: PM2.5 at 17 of 24 hours is a gap even with full ozone, 18 of 24 is not', () => {
  const ozone = airRows({ parameter: 'OZONE', aqi: 30 });
  const at17 = oneDay([...ozone, ...airRows({ parameter: 'PM2.5', hours: range(17), aqi: 55 })]);
  assert.equal(at17.value, null);
  assert.equal(at17.hoursObserved, 17, 'the least-covered pollutant\'s count');
  assert.equal(at17.stationFound, true, 'the station reported; its day is a gap');
  const at18 = oneDay([...ozone, ...airRows({ parameter: 'PM2.5', hours: range(18), aqi: 55 })]);
  assert.equal(at18.value, 55);
  assert.equal(at18.hoursObserved, 18);
  // A station that never reports PM2.5 that day is judged on what it reports.
  assert.equal(oneDay(ozone).value, 30);
});

test('AirNow, E3 on the DST days: 17 of 23 is a gap and 18 of 23 is not; 18 of 25 is a gap and 19 of 25 is not', () => {
  assert.equal(oneDay(airRows({ date: SPRING, hours: range(17) }), SPRING).value, null);
  assert.equal(oneDay(airRows({ date: SPRING, hours: range(18), aqi: 33 }), SPRING).value, 33);
  assert.equal(oneDay(airRows({ date: FALL, hours: range(18) }), FALL).value, null);
  assert.equal(oneDay(airRows({ date: FALL, hours: range(19), aqi: 33 }), FALL).value, 33);
});

test('AirNow, E2: a normal day\'s 24 UTC hours on a DST date are not the local day', () => {
  // 24 hours from local midnight in EST on the spring date: the last one is already the next day.
  const start = Date.parse('2026-03-08T05:00:00Z');
  const fixed = range(24).map((i) => ({ ...airRows({ date: SPRING, hours: [0] })[0], UTC: new Date(start + i * 3600000).toISOString().slice(0, 16), AQI: i === 23 ? 99 : 40 }));
  const spring = oneDay(fixed, SPRING);
  assert.equal(spring.hoursObserved, 23, 'only the day\'s 23 hours count');
  assert.equal(spring.value, 40, 'the hour after local midnight is not in the day');
  // On the fall date, 24 hours are 24 of 25: not complete.
  const fall = oneDay(airRows({ date: FALL, hours: range(24), aqi: 41 }), FALL);
  assert.equal(fall.hoursObserved, 24);
  assert.equal(fall.hoursExpected, 25);
  assert.equal(settleDay({ attempt: 1, coverage: fall, providerOk: true, kind: 'airnow_station' }).missing_code, 'pending', 'not mistaken for complete');
  // The repeated 01:00 hour of the fall-back night counts once in each offset.
  const repeated = oneDay(airRows({ date: FALL, aqi: (i) => (i === 2 ? 77 : 20) }), FALL);
  assert.equal(repeated.value, 77);
  assert.equal(localDaySlots(FALL)[2], '2026-11-01T06:00:00.000Z', 'the second 01:00, in EST');
});

test('E6: a single hourly value is never a daily maximum', () => {
  const single = oneDay(airRows({ hours: [12], aqi: 88 }));
  assert.equal(single.value, null);
  assert.equal(single.hoursObserved, 1);
  for (const attempt of [1, 2, 3, 7]) {
    assert.equal(settleDay({ attempt, coverage: single, providerOk: true, kind: 'airnow_station' }).value, null, `attempt ${attempt}`);
  }
  const [om] = openMeteoDailyMaxima(meteo(NORMAL, { us_aqi: (i) => (i === 12 ? 88 : null) }), 'us_aqi', [NORMAL]);
  assert.equal(om.value, null);
  assert.equal(om.hoursObserved, 1);
});

test('AirNow, E8: a station at 40.3 km is not selected, one at 40.2 km is, and the nearer of two wins', () => {
  assert.ok(Math.abs(haversineKm(HOME, north(40.3)) - 40.3) < 1e-6, 'the fixture is where it says');
  assert.equal(STATION_RADIUS_KM, 40.234);
  const far = oneDay(airRows({ id: 'FAR', at: north(40.3) }));
  assert.deepEqual(far, { date: NORMAL, stationFound: false, stationId: null, value: null, hoursExpected: 24, hoursObserved: 0 });
  assert.equal(oneDay(airRows({ id: 'IN', at: north(40.2) })).stationId, 'IN');
  const two = [...airRows({ id: 'B-FAR', at: north(30), aqi: 90 }), ...airRows({ id: 'A-NEAR', at: north(10), aqi: 20 })];
  assert.equal(oneDay(two).stationId, 'A-NEAR');
  assert.equal(oneDay(two).value, 20, 'the farther station\'s higher value is not taken');
  assert.equal(oneDay([...two].reverse()).stationId, 'A-NEAR', 'row order does not matter');
  // The nearest station that reported THAT day: a nearer one silent today is passed over.
  const silent = [...airRows({ id: 'NEAR', at: north(3), date: '2026-10-17' }), ...airRows({ id: 'FARTHER', at: north(20) })];
  const [yesterday, day] = airNowDailyMaxima(silent, HOME, ['2026-10-17', NORMAL]);
  assert.equal(yesterday.stationId, 'NEAR');
  assert.equal(day.stationId, 'FARTHER');
  assert.equal(day.value, 43);
});

test('AirNow: -999 and negative values are dropped, and do not count as hours or as reporting', () => {
  const ozone = airRows({ parameter: 'OZONE', aqi: 30 });
  // PM2.5 valid for 14 hours, sentinel for the other 10: 14 of 24 is a gap.
  const pm = airRows({ parameter: 'PM2.5', aqi: (i) => (i < 14 ? 45 : -999) });
  const day = oneDay([...ozone, ...pm]);
  assert.equal(day.hoursObserved, 14);
  assert.equal(day.value, null);
  // A nearer station reporting only sentinels and negatives has not reported.
  const junk = airRows({ id: 'JUNK', at: north(1), aqi: (i) => (i % 2 ? -999 : -4) });
  assert.equal(oneDay([...junk, ...airRows({ id: 'GOOD', at: north(9), aqi: 25 })]).stationId, 'GOOD');
  // Malformed rows are ignored, never read as zero.
  const malformed = [
    { ...ozone[0], AQI: '45' }, { ...ozone[0], AQI: null }, { ...ozone[0], UTC: '2026-10-18 10:00' }, { ...ozone[0], UTC: '2026-10-18T10:30' },
    { ...ozone[0], Latitude: '35.0' }, { ...ozone[0], FullAQSCode: undefined, IntlAQSCode: undefined }, { ...ozone[0], Parameter: '' }, null,
  ];
  assert.equal(oneDay(malformed).stationFound, false);
  // An empty FullAQSCode falls back to IntlAQSCode, as the map parser does (lib/mapLayers.js:91).
  const intl = oneDay(airRows({ id: '370710016', aqi: 26 }).map((r) => ({ ...r, FullAQSCode: '' })));
  assert.deepEqual([intl.stationId, intl.value], ['840370710016', 26]);
  assert.equal(oneDay(airRows({ aqi: 0 })).value, 0, 'a reported 0 is a 0');
  assert.deepEqual(airNowDailyMaxima('not rows', HOME, [NORMAL])[0].stationFound, false);
});

test('AirNow: one call\'s rows serve several days, each judged on its own hours', () => {
  const rows = [...airRows({ date: '2026-10-16', aqi: 31 }), ...airRows({ date: '2026-10-17', hours: range(5), aqi: 99 }), ...airRows({ date: NORMAL, aqi: 33 })];
  const days = airNowDailyMaxima(rows, HOME, ['2026-10-16', '2026-10-17', NORMAL]);
  assert.deepEqual(days.map((d) => [d.date, d.value, d.hoursObserved]), [['2026-10-16', 31, 24], ['2026-10-17', null, 5], [NORMAL, 33, 24]]);
  assert.throws(() => airNowDailyMaxima(rows, { lat: '35', lng: -80 }, [NORMAL]), TypeError);
  assert.throws(() => airNowDailyMaxima(rows, HOME, ['2026-13-01']), TypeError);
});

/**
 * An Open-Meteo `hourly` answer as the recorder requests it (E2, R1):
 * `past_days=3&forecast_days=1&timeformat=unixtime`, no `timezone`, so GMT.
 * The run is on `runDay` (default: the day after `date`); `time` is Unix
 * seconds from 00:00Z three days before it to 23:00Z on it, 96 hours. Each
 * field's function gets the slot index within `date`'s New York day, or is
 * not called for an hour outside it, which takes `outside`.
 */
function meteo(date, fields, { runDay = addDays(date, 1), outside = 1, utcOffset = 0, timezone = 'GMT' } = {}) {
  const start = Date.parse(`${addDays(runDay, -3)}T00:00:00Z`) / 1000;
  const time = range(96).map((i) => start + i * 3600);
  const slots = localDaySlots(date);
  const hourly = { time };
  for (const [name, fn] of Object.entries(fields)) {
    hourly[name] = time.map((t) => {
      const i = slots.indexOf(new Date(t * 1000).toISOString());
      return i < 0 ? outside : typeof fn === 'function' ? fn(i) : fn;
    });
  }
  return { latitude: HOME.lat, longitude: HOME.lng, generationtime_ms: 0.1, utc_offset_seconds: utcOffset, timezone, timezone_abbreviation: timezone, hourly_units: { time: 'unixtime' }, hourly };
}
const epoch = (iso) => Date.parse(iso) / 1000;

test('Open-Meteo: the day\'s largest modeled value, AQI an integer and UV to 0.1', () => {
  const [air] = openMeteoDailyMaxima(meteo(NORMAL, { us_aqi: (i) => (i === 14 ? 57.4 : 21) }, { outside: 300 }), 'us_aqi', [NORMAL]);
  assert.deepEqual(air, { date: NORMAL, value: 57, hoursExpected: 24, hoursObserved: 24 }, 'hours of other days never count');
  const [uv] = openMeteoDailyMaxima(meteo(NORMAL, { uv_index: (i) => (i === 13 ? 6.46 : 0) }), 'uv_index', [NORMAL]);
  assert.equal(uv.value, 6.5);
  const [night] = openMeteoDailyMaxima(meteo(NORMAL, { uv_index: 0 }), 'uv_index', [NORMAL]);
  assert.equal(night.value, 0, 'a modeled 0 is a 0');
  assert.throws(() => openMeteoDailyMaxima(meteo(NORMAL, { pm10: 1 }), 'pm10', [NORMAL]), TypeError);
  assert.throws(() => openMeteoDailyMaxima({ hourly: { time: [epoch('2026-10-18T04:00:00Z')], us_aqi: [] } }, 'us_aqi', [NORMAL]), TypeError, 'lengths differ');
  assert.throws(() => openMeteoDailyMaxima({}, 'us_aqi', [NORMAL]), TypeError);
});

test('Open-Meteo: an answer that is not whole hours in Unix seconds is refused, not read as gaps', () => {
  const good = meteo(NORMAL, { us_aqi: 30 });
  const withTimes = (time) => ({ ...good, hourly: { ...good.hourly, time } });
  // A request that forgot timeformat=unixtime: ISO local stamps.
  const iso = good.hourly.time.map((t) => new Date(t * 1000).toISOString().slice(0, 16));
  assert.throws(() => openMeteoDailyMaxima(withTimes(iso), 'us_aqi', [NORMAL]), /Unix seconds/);
  assert.throws(() => openMeteoDailyMaxima(withTimes(good.hourly.time.map(String)), 'us_aqi', [NORMAL]), /Unix seconds/);
  assert.throws(() => openMeteoDailyMaxima(withTimes(good.hourly.time.map((t) => t + 1800)), 'us_aqi', [NORMAL]), /Unix seconds/, 'half hours');
  assert.throws(() => openMeteoDailyMaxima(withTimes(good.hourly.time.map((t) => t + 0.5)), 'us_aqi', [NORMAL]), /Unix seconds/);
  const repeated = [...good.hourly.time];
  repeated[40] = repeated[39];
  assert.throws(() => openMeteoDailyMaxima(withTimes(repeated), 'us_aqi', [NORMAL]), /repeats an hour/);
  // Order does not matter, and hours outside the requested days are ignored.
  const reversed = { ...good, hourly: { time: [...good.hourly.time].reverse(), us_aqi: [...good.hourly.us_aqi].reverse() } };
  assert.deepEqual(openMeteoDailyMaxima(reversed, 'us_aqi', [NORMAL]), openMeteoDailyMaxima(good, 'us_aqi', [NORMAL]));
});

test('Open-Meteo, E3: 17 of 24 is a gap and 18 of 24 is not; nulls and negatives are not hours', () => {
  const at = (n) => openMeteoDailyMaxima(meteo(NORMAL, { us_aqi: (i) => (i < n ? 30 : i % 2 ? null : -1) }, { outside: 30 }), 'us_aqi', [NORMAL])[0];
  assert.equal(at(17).value, null);
  assert.equal(at(17).hoursObserved, 17);
  assert.equal(at(18).value, 30);
  assert.equal(at(18).hoursObserved, 18);
});

test('Open-Meteo, E2: 8 March is 23 real hours and takes a value on the first run', () => {
  const answer = meteo(SPRING, { us_aqi: (i) => (i === 22 ? 61 : 30) }, { outside: 200 });
  const [s] = openMeteoDailyMaxima(answer, 'us_aqi', [SPRING]);
  assert.deepEqual(s, { date: SPRING, value: 61, hoursExpected: 23, hoursObserved: 23 });
  assert.equal(settleDay({ attempt: 1, coverage: s, providerOk: true, kind: 'open_meteo_cams' }).value, 61, 'complete, not a gap');
  // The day before the change: 05:00Z on 7 March to 04:00Z on 8 March, 24 hours.
  const before = meteo('2026-03-07', { us_aqi: 30 }, { runDay: SPRING, outside: 140 });
  const [b] = openMeteoDailyMaxima(before, 'us_aqi', ['2026-03-07']);
  assert.deepEqual([b.value, b.hoursObserved, b.hoursExpected], [30, 24, 24], '04:00Z on 7 March is 23:00 on 6 March');
});

test('Open-Meteo, E2: 31 October does not take 1 November\'s first hour, and 1 November is 25 hours', () => {
  // The run on 1 November at 12:00Z (EST by then) covers 29 to 31 October.
  const run = completedDays(new Date('2026-11-01T12:00:00Z'));
  assert.deepEqual(run, ['2026-10-29', '2026-10-30', '2026-10-31']);
  const leak = epoch('2026-11-01T04:00:00Z'); // 00:00 EDT on 1 November
  const own = epoch('2026-10-31T04:00:00Z'); // 00:00 EDT on 31 October
  const answer = meteo('2026-10-31', { us_aqi: 30 }, { runDay: FALL, outside: 30 });
  answer.hourly.us_aqi[answer.hourly.time.indexOf(leak)] = 150;
  answer.hourly.us_aqi[answer.hourly.time.indexOf(own)] = 45;
  // A response that also carried the request-time offset reads the same: it is ignored.
  for (const [utcOffset, timezone] of [[0, 'GMT'], [-18000, 'America/New_York']]) {
    const days = openMeteoDailyMaxima({ ...answer, utc_offset_seconds: utcOffset, timezone }, 'us_aqi', run);
    const oct31 = days[2];
    assert.deepEqual([oct31.value, oct31.hoursObserved, oct31.hoursExpected], [45, 24, 24], `offset ${utcOffset}`);
    assert.equal(settleDay({ attempt: 1, coverage: oct31, providerOk: true, kind: 'open_meteo_cams' }).value, 45);
  }
  // 1 November, from the run on 2 November: 04:00Z to 04:00Z the next day, 25 hours.
  const fall = meteo(FALL, { us_aqi: (i) => (i === 2 ? 77 : 20) }, { outside: 300 });
  const days = openMeteoDailyMaxima(fall, 'us_aqi', completedDays(new Date('2026-11-02T12:00:00Z')));
  assert.deepEqual(days.map((d) => d.date), ['2026-10-30', '2026-10-31', FALL]);
  assert.deepEqual(days[2], { date: FALL, value: 77, hoursExpected: 25, hoursObserved: 25 }, 'the second 01:00 counts');
  assert.equal(settleDay({ attempt: 1, coverage: days[2], providerOk: true, kind: 'open_meteo_cams' }).value, 77, 'complete on the first run');
  const short = { ...fall, hourly: { ...fall.hourly, us_aqi: fall.hourly.us_aqi.map((v, i) => (fall.hourly.time[i] === epoch('2026-11-02T04:00:00Z') ? null : v)) } };
  const [, , f24] = openMeteoDailyMaxima(short, 'us_aqi', completedDays(new Date('2026-11-02T12:00:00Z')));
  assert.deepEqual([f24.hoursObserved, f24.hoursExpected], [24, 25]);
  assert.equal(settleDay({ attempt: 1, coverage: f24, providerOk: true, kind: 'open_meteo_cams' }).missing_code, 'pending', '24 of 25 is not complete');
  assert.equal(settleDay({ attempt: 2, coverage: f24, providerOk: true, kind: 'open_meteo_cams' }).value, 77, 'but it is covered');
});

test('Open-Meteo: one past_days answer serves the run\'s three days, each its own hours', () => {
  const days = completedDays(new Date(`${TODAY}T12:00:00Z`));
  const answer = meteo(NORMAL, { us_aqi: 0 });
  answer.hourly.us_aqi = answer.hourly.time.map((t) => {
    const at = new Date(t * 1000).toISOString();
    const day = days.findIndex((d) => localDaySlots(d).includes(at));
    return day < 0 ? 999 : (day + 1) * 10 + (localDaySlots(days[day]).indexOf(at) === 9 ? 5 : 0);
  });
  assert.deepEqual(openMeteoDailyMaxima(answer, 'us_aqi', days).map((d) => [d.value, d.hoursObserved]), [[15, 24], [25, 24], [35, 24]]);
});

// ---------------------------------------------------------------------------
// 4. Settling, the Air kind, the first full day and the run's days
// ---------------------------------------------------------------------------

const cov = (hoursObserved, value = 40, hoursExpected = 24, extra = {}) => ({ value: hoursObserved >= Math.ceil(0.75 * hoursExpected) ? value : null, hoursExpected, hoursObserved, ...extra });

test('E4: first run needs every hour, the second and third take coverage, the third settles the rest', () => {
  const s = (attempt, coverage, providerOk = true, kind = 'open_meteo_forecast') => settleDay({ attempt, coverage, providerOk, kind });
  assert.deepEqual(s(1, cov(23)), { value: null, missing_code: 'pending', source_code: 'open_meteo_forecast', station_id: null, hours_observed: 23 }, 'first attempt with 23 of 24 is pending');
  assert.deepEqual(s(1, cov(24)), { value: 40, missing_code: null, source_code: 'open_meteo_forecast', station_id: null, hours_observed: 24 });
  assert.equal(s(1, cov(23, 3, 23)).value, 3, 'a 23-hour day is complete at 23');
  assert.equal(s(1, cov(24, 3, 25)).missing_code, 'pending', 'a 25-hour day is not complete at 24');
  assert.equal(s(1, cov(25, 3, 25)).value, 3);
  assert.equal(s(2, cov(18)).value, 40, 'second attempt with 18 of 24 is a value');
  assert.equal(s(2, cov(17)).missing_code, 'pending');
  assert.equal(s(3, cov(18)).value, 40);
  assert.deepEqual(s(3, cov(17)), { value: null, missing_code: 'source_gap', source_code: 'open_meteo_forecast', station_id: null, hours_observed: 17 }, 'third attempt short is a gap');
  assert.equal(s(3, cov(0, 40, 24)).missing_code, 'source_gap');
  assert.equal(s(1, null, false).missing_code, 'pending', 'a provider failure waits');
  assert.equal(s(2, null, false).missing_code, 'pending');
  assert.deepEqual(s(3, null, false), { value: null, missing_code: 'unavailable', source_code: 'open_meteo_forecast', station_id: null, hours_observed: 0 }, 'provider failure on the third is unavailable');
  assert.equal(s(3, cov(24), false).missing_code, 'unavailable', 'coverage from a failed call is not used');
  assert.equal(s(4, cov(17)).missing_code, 'source_gap', 'past the third run it stays final');
  // The threshold is checked here too, not only by the series functions.
  assert.equal(s(2, { value: 40, hoursExpected: 24, hoursObserved: 17 }).value, null);
  assert.equal(s(2, { value: 40, hoursExpected: 23, hoursObserved: 17 }).value, null, '17 of 23 is short');
  assert.equal(s(2, { value: 40, hoursExpected: 25, hoursObserved: 18 }).value, null, '18 of 25 is short');
  assert.equal(s(2, { value: 40, hoursExpected: 25, hoursObserved: 19 }).value, 40);
  assert.throws(() => s(0, cov(24)), TypeError);
  assert.throws(() => s(1.5, cov(24)), TypeError);
  assert.throws(() => s(1, null, true), TypeError, 'an answer needs its coverage');
  assert.throws(() => s(1, cov(24), true, 'openuv'), TypeError);
});

test('E4, E8: an AirNow row carries its station; without one it has no source', () => {
  const found = { ...cov(24, 51), stationId: '370710016', stationFound: true };
  assert.deepEqual(settleDay({ attempt: 1, coverage: found, providerOk: true, kind: 'airnow_station' }),
    { value: 51, missing_code: null, source_code: 'airnow_station', station_id: '370710016', hours_observed: 24 });
  const gap = { ...cov(10, 51), stationId: '370710016', stationFound: true };
  assert.deepEqual(settleDay({ attempt: 3, coverage: gap, providerOk: true, kind: 'airnow_station' }),
    { value: null, missing_code: 'source_gap', source_code: 'airnow_station', station_id: '370710016', hours_observed: 10 });
  const none = { value: null, hoursExpected: 24, hoursObserved: 0, stationId: null, stationFound: false };
  assert.deepEqual(settleDay({ attempt: 3, coverage: none, providerOk: true, kind: 'airnow_station' }),
    { value: null, missing_code: 'source_gap', source_code: null, station_id: null, hours_observed: 0 });
  assert.deepEqual(settleDay({ attempt: 3, coverage: null, providerOk: false, kind: 'airnow_station' }),
    { value: null, missing_code: 'unavailable', source_code: null, station_id: null, hours_observed: 0 });
  // An undecided kind never takes a value, whatever the coverage says.
  assert.equal(settleDay({ attempt: 1, coverage: cov(24), providerOk: true, kind: null }).missing_code, 'pending');
  assert.equal(settleDay({ attempt: 3, coverage: cov(24), providerOk: true, kind: null }).missing_code, 'unavailable');
});

test('E8: the Air kind is fixed by the first recorded day; a modeled home never becomes measured', () => {
  assert.equal(chooseAirKind(null, true), 'measured');
  assert.equal(chooseAirKind(null, false), 'modeled');
  assert.equal(chooseAirKind(null, null), null, 'AirNow did not answer: undecided');
  assert.equal(chooseAirKind(null, undefined), null);
  assert.equal(chooseAirKind({ source_code: 'open_meteo_cams' }, true), 'modeled', 'a station opening later changes nothing');
  assert.equal(chooseAirKind({ source_code: 'airnow_station', station_id: 'X' }, false), 'measured', 'a silent station changes nothing');
  assert.throws(() => chooseAirKind({ source_code: null }, true), TypeError);
  assert.throws(() => chooseAirKind({ source_code: 'open_meteo_forecast' }, true), TypeError);
  assert.equal(airSourceCode('measured'), 'airnow_station');
  assert.equal(airSourceCode('modeled'), 'open_meteo_cams');
  assert.throws(() => airSourceCode('either'), TypeError);
});

test('E8: a measured home\'s station gap is a gap, never a modeled value; a modeled home ignores stations', () => {
  const stationGap = oneDay([...airRows({ parameter: 'OZONE', aqi: 30 }), ...airRows({ parameter: 'PM2.5', hours: range(12), aqi: 30 })]);
  const [modelFull] = openMeteoDailyMaxima(meteo(NORMAL, { us_aqi: 44 }), 'us_aqi', [NORMAL]);
  assert.equal(modelFull.value, 44, 'the model had a full day');
  for (const attempt of [1, 2, 3]) {
    const coverage = airCoverageFor('measured', { station: stationGap, modeled: modelFull });
    assert.equal(coverage, stationGap);
    const row = settleDay({ attempt, coverage, providerOk: true, kind: airSourceCode('measured') });
    assert.equal(row.value, null, `attempt ${attempt}`);
    assert.equal(row.source_code, 'airnow_station');
  }
  // A measured home whose AirNow call failed has no coverage at all, not the model's.
  assert.equal(airCoverageFor('measured', { station: undefined, modeled: modelFull }), null);
  const stationFull = oneDay(airRows({ aqi: 90 }));
  assert.equal(airCoverageFor('modeled', { station: stationFull, modeled: modelFull }), modelFull);
  assert.equal(airCoverageFor(null, { station: stationFull, modeled: modelFull }), null);
  assert.throws(() => airCoverageFor('either', { station: stationFull, modeled: modelFull }), TypeError);
});

test('E9: a home\'s first full day is the local day after it began, so a move day belongs to neither', () => {
  assert.equal(firstFullDay('2026-10-01T14:00:00+00:00'), '2026-10-02');
  assert.equal(firstFullDay('2026-10-02T02:30:00Z'), '2026-10-02', '22:30 on 1 October in New York');
  assert.equal(firstFullDay('2026-10-02T04:00:00.000Z'), '2026-10-03', 'local midnight starts 2 October');
  assert.equal(firstFullDay(new Date('2026-03-08T06:59:00Z')), '2026-03-09');
  assert.throws(() => firstFullDay('2026-10-01'), TypeError, 'a bare date has no instant');
  assert.throws(() => firstFullDay('2026-10-01T14:00:00'), TypeError, 'a zoneless time is ambiguous');
  assert.throws(() => firstFullDay(null), TypeError);
});

test('E4, E5: the run takes the three completed local days before now; now is injected', () => {
  assert.deepEqual(completedDays(new Date('2026-10-19T12:00:00Z')), ['2026-10-16', '2026-10-17', '2026-10-18']);
  assert.deepEqual(completedDays(new Date('2026-10-20T03:30:00Z')), ['2026-10-16', '2026-10-17', '2026-10-18'], '23:30 on the 19th in New York');
  assert.deepEqual(completedDays(new Date('2026-11-02T12:00:00Z')), ['2026-10-30', '2026-10-31', FALL]);
  assert.deepEqual(completedDays(new Date('2026-03-09T12:00:00Z'), 1), [SPRING]);
  assert.throws(() => completedDays('2026-10-19'), TypeError);
  assert.throws(() => completedDays(new Date('nope')), TypeError);
});

// ---------------------------------------------------------------------------
// 5. The snapshot
// ---------------------------------------------------------------------------

/** A stored daily_maxima row (0025's columns). */
function stored(over = {}) {
  const factor = over.factor ?? 'air';
  const row = {
    profile_id: '99999999-9999-4999-8999-999999999999', home_context_id: CONTEXT, local_date: NORMAL, factor,
    value: 40, unit: factor === 'air' ? 'AQI' : 'UV index', source_code: factor === 'air' ? 'open_meteo_cams' : 'open_meteo_forecast',
    station_id: null, method_version: METHOD_VERSION, time_zone: 'America/New_York', hours_expected: 24, hours_observed: 24,
    missing_code: null, retrieved_at: '2026-10-19T12:00:05.000Z', ...over,
  };
  if (row.value === null && over.missing_code === undefined) row.missing_code = 'pending';
  return row;
}
const patterns = (rows, extra = {}) => buildHistorySnapshot({ from: addDays(TODAY, -83), to: TODAY, today: TODAY, context: CONTEXT, rows, recordingFrom: '2026-07-01', firstFullDay: '2026-07-01', ...extra });
const find = (snap, date, factor) => snap.rows.filter((r) => r.date === date && r.factor === factor);
function checkins(dates, fine) {
  return dates.map((date) => ({ date, band: 'household', fine, recalled: false, illness: false, symptoms: fine ? [] : ['Sneezing'], homeContextId: CONTEXT }));
}

test('snapshot: 84 days give exactly 336 rows, oldest first, Air, UV, Pollen, Outdoor mold each date', () => {
  const snap = patterns([]);
  assert.equal(snap.rows.length, 336);
  const dates = [...new Set(snap.rows.map((r) => r.date))];
  assert.equal(dates.length, 84);
  assert.equal(dates[0], '2026-07-28');
  assert.equal(dates.at(-1), TODAY);
  assert.deepEqual(dates, [...dates].sort());
  snap.rows.forEach((r, i) => {
    assert.equal(r.date, dates[Math.floor(i / 4)]);
    assert.equal(r.factor, HISTORY_FACTORS[i % 4]);
  });
  assert.deepEqual(HISTORY_FACTORS, ['Air', 'UV', 'Pollen', 'Outdoor mold']);
  assert.equal(snap.complete, true);
  assert.deepEqual(Object.keys(snap).sort(), ['comparison', 'complete', 'rows'], 'no data key, no cursor');
  assert.deepEqual(snap.comparison, { context: CONTEXT, basis: 'daily maximum', version: 'daily-max-v1' });
  assert.ok(productionHistory({ data: snap, error: null }, runtimeFor(CONTEXT)).data);
});

test('snapshot, E7: every Pollen and Outdoor mold row is null with its reason, and never joins a mean', () => {
  const snap = patterns([stored({ local_date: '2026-10-10', value: 40 })]);
  for (const r of snap.rows.filter((x) => x.factor === 'Pollen')) {
    assert.deepEqual([r.value, r.missing, r.unit, r.source], [null, 'Pollen has a daily forecast index, not a daily maximum.', 'category', NOT_RECORDED_SOURCE]);
  }
  for (const r of snap.rows.filter((x) => x.factor === 'Outdoor mold')) {
    assert.deepEqual([r.value, r.missing, r.unit, r.source], [null, 'No compatible historical mold series', 'category', NOT_RECORDED_SOURCE]);
  }
  for (const r of snap.rows.filter((x) => x.factor === 'Pollen' || x.factor === 'Outdoor mold')) assert.equal(readingLabel(r), 'Unavailable');
  const entries = [...checkins(['2026-10-10', '2026-10-11', '2026-10-12'], false), ...checkins(['2026-10-13', '2026-10-14', '2026-10-15'], true)];
  for (const factor of ['Pollen', 'Outdoor mold']) {
    const report = analyzeHistory(entries, snap.rows, addDays(TODAY, -83), TODAY, 'household', factor, snap.comparison);
    assert.deepEqual([report.comparable, report.symptomMean, report.missing, report.enough], [0, null, 6, false], factor);
  }
});

test('snapshot: today is not complete, and a later date is not recorded yet, even with a stored row', () => {
  const snap = buildHistorySnapshot({ from: '2026-10-18', to: '2026-10-21', today: TODAY, context: CONTEXT, rows: [stored({ local_date: TODAY, value: 40 }), stored({ local_date: '2026-10-20', value: 41 })], recordingFrom: '2026-07-01', firstFullDay: null });
  for (const factor of ['Air', 'UV']) {
    assert.deepEqual(find(snap, TODAY, factor).map((r) => [r.value, r.missing]), [[null, 'Current day is not complete']], factor);
    assert.deepEqual(find(snap, '2026-10-21', factor).map((r) => [r.value, r.missing]), [[null, 'Not recorded yet']], factor);
  }
  assert.equal(find(snap, '2026-10-20', 'Air')[0].value, null);
});

test('snapshot, E9: before the first run or the home\'s first full day there is no maximum, never a 0 and never a backfill', () => {
  const rows = [stored({ local_date: '2026-09-29', value: 55 }), stored({ local_date: '2026-10-05', value: 56 })];
  const byRecorder = patterns(rows, { recordingFrom: '2026-10-01', firstFullDay: '2026-08-01' });
  assert.deepEqual(find(byRecorder, '2026-09-29', 'Air').map((r) => [r.value, r.missing]), [[null, 'Recorded from 2026-10-01. Earlier days have no daily maximum.']]);
  assert.deepEqual(find(byRecorder, '2026-09-30', 'UV').map((r) => [r.value, r.missing]), [[null, 'Recorded from 2026-10-01. Earlier days have no daily maximum.']]);
  assert.equal(find(byRecorder, '2026-10-05', 'Air')[0].value, 56);
  const byHome = patterns(rows, { recordingFrom: '2026-09-01', firstFullDay: '2026-10-03' });
  assert.equal(find(byHome, '2026-10-02', 'Air')[0].missing, 'Recorded from 2026-10-03. Earlier days have no daily maximum.', 'the later of the two');
  assert.equal(find(byHome, '2026-09-29', 'Air')[0].value, null);
  assert.equal(find(byHome, '2026-10-05', 'Air')[0].value, 56);
  // Before any run nothing is claimed as a start, and nothing is a value.
  const neverRun = patterns([], { recordingFrom: null, firstFullDay: '2026-08-01' });
  assert.ok(neverRun.rows.every((r) => r.value === null && !String(r.missing).startsWith('Recorded from')));
  assert.equal(find(neverRun, '2026-10-18', 'Air')[0].missing, 'Not recorded yet');
  assert.equal(find(neverRun, '2026-10-01', 'Air')[0].missing, 'No reading for this day');
});

test('snapshot, E14: dates older than today minus 83 carry the window reason, even when a value is stored', () => {
  // A Summer request (Jun 1 to Aug 31) from 19 October.
  const snap = buildHistorySnapshot({ from: '2026-06-01', to: '2026-08-31', today: TODAY, context: CONTEXT, rows: [stored({ local_date: '2026-07-27', value: 60 }), stored({ local_date: '2026-07-28', value: 61 })], recordingFrom: '2026-06-01', firstFullDay: null });
  assert.equal(snap.rows.length, 92 * 4, 'the longest season');
  assert.deepEqual(find(snap, '2026-07-27', 'Air').map((r) => [r.value, r.missing]), [[null, 'Outside the twelve-week history window']]);
  assert.equal(find(snap, '2026-07-28', 'Air')[0].value, 61, 'today minus 83 is inside');
  assert.ok(snap.rows.filter((r) => r.date < '2026-07-28' && (r.factor === 'Air' || r.factor === 'UV')).every((r) => r.missing === 'Outside the twelve-week history window'));
  assert.ok(productionHistory({ data: snap, error: null }, runtimeFor(CONTEXT)).data);
  assert.throws(() => buildHistorySnapshot({ from: '2026-06-01', to: '2026-09-01', today: TODAY, context: CONTEXT, rows: [] }), RangeError, '93 days');
  assert.throws(() => buildHistorySnapshot({ from: '2026-10-02', to: '2026-10-01', today: TODAY, context: CONTEXT, rows: [] }), RangeError);
  assert.throws(() => buildHistorySnapshot({ from: '2026-02-30', to: '2026-03-01', today: TODAY, context: CONTEXT, rows: [] }), TypeError);
});

test('snapshot, E13: stored codes and absent rows become the frontend\'s reasons', () => {
  const rows = [
    stored({ local_date: '2026-10-01', value: null, missing_code: 'source_gap' }),
    stored({ local_date: '2026-10-02', value: null, missing_code: 'unavailable' }),
    stored({ local_date: '2026-10-03', value: null, missing_code: 'pending' }),
    stored({ local_date: '2026-10-16', value: null, missing_code: 'pending' }),
    stored({ local_date: '2026-10-17', value: 0, factor: 'uv' }),
  ];
  const snap = patterns(rows);
  const reason = (date, factor = 'Air') => find(snap, date, factor)[0].missing;
  assert.equal(reason('2026-10-01'), 'Source gap');
  assert.equal(reason('2026-10-02'), 'No reading for this day');
  assert.equal(reason('2026-10-03'), 'No reading for this day', 'a pending row past the settling window');
  assert.equal(reason('2026-10-16'), 'Not recorded yet', 'a pending row inside the window (today minus 3)');
  assert.equal(reason('2026-10-15'), 'No reading for this day', 'no row, outside the window');
  assert.equal(reason('2026-10-16', 'UV'), 'Not recorded yet', 'no row, inside the window');
  assert.equal(reason('2026-10-18', 'UV'), 'Not recorded yet');
  assert.equal(find(snap, '2026-10-17', 'UV')[0].value, 0, 'a stored 0 is the source\'s 0');
  assert.equal(Object.hasOwn(find(snap, '2026-10-17', 'UV')[0], 'missing'), false, 'a value has no missing reason');
  // No row is ever 0 unless the source said 0.
  assert.deepEqual(snap.rows.filter((r) => r.value === 0).map((r) => [r.date, r.factor]), [['2026-10-17', 'UV']]);
  assert.ok(snap.rows.every((r) => (r.value === null) === (typeof r.missing === 'string')));
});

test('snapshot, E16 and E17: issued is Unknown everywhere, and every field is from the frozen tables', () => {
  const rows = [stored({ local_date: '2026-10-10', value: 40, source_code: 'airnow_station', station_id: '370710016' }), stored({ local_date: '2026-10-10', factor: 'uv', value: 5.1 })];
  const snap = patterns(rows);
  assert.ok(snap.rows.every((r) => r.issued === ISSUED_UNKNOWN && r.issued === 'Unknown'));
  assert.equal(JSON.stringify(snap).includes('2026-10-19T12:00:05'), false, 'retrieval time is never emitted');
  assert.ok(snap.rows.every((r) => r.basis === 'daily maximum' && r.version === 'daily-max-v1' && r.context === CONTEXT));
  const air = find(snap, '2026-10-10', 'Air')[0];
  assert.deepEqual(air, { date: '2026-10-10', factor: 'Air', value: 40, unit: 'AQI', source: 'AirNow monitoring station, measured, preliminary', issued: 'Unknown', basis: 'daily maximum', context: CONTEXT, version: 'daily-max-v1' });
  const uv = find(snap, '2026-10-10', 'UV')[0];
  assert.deepEqual([uv.value, uv.unit, uv.source], [5.1, 'UV index', 'Open-Meteo forecast model, modeled, not measured']);
  assert.equal(readingLabel(air), '40 AQI');
  assert.equal(readingLabel(uv), '5.1 UV index');
  const allowed = new Set([...Object.values(SOURCE_LABELS), NOT_RECORDED_SOURCE]);
  assert.ok(snap.rows.every((r) => allowed.has(r.source)));
  assert.equal(JSON.stringify(snap).includes('370710016'), false, 'no station code is emitted');
  assert.equal(JSON.stringify(snap).includes('Example'), false, 'no provider text is emitted');
  // Vibhav's decision: modeled values say so in the source line; measured ones do not.
  assert.match(SOURCE_LABELS.open_meteo_cams, /modeled, not measured/);
  assert.match(SOURCE_LABELS.open_meteo_forecast, /modeled, not measured/);
  assert.doesNotMatch(SOURCE_LABELS.airnow_station, /modeled/);
});

test('snapshot, E12: a household with no current context gets exactly the empty, null-context body', () => {
  const expected = { rows: [], comparison: { context: null, basis: 'daily maximum', version: 'daily-max-v1' }, complete: true };
  assert.deepEqual(buildHistorySnapshot({ from: addDays(TODAY, -83), to: TODAY, today: TODAY, context: null, rows: [stored()], recordingFrom: '2026-07-01' }), expected);
  assert.deepEqual(buildHistorySnapshot({ from: TODAY, to: TODAY, today: TODAY, context: undefined, rows: [] }), expected);
  const body = buildHistorySnapshot({ from: TODAY, to: TODAY, today: TODAY, context: null, rows: [] });
  assert.ok(productionHistory({ data: body, error: null }, runtimeFor(null)).data, 'valid for a null-context client');
  assert.equal(productionHistory({ data: body, error: null }, runtimeFor(CONTEXT)).data, null, 'and for no other');
  assert.throws(() => buildHistorySnapshot({ from: TODAY, to: TODAY, today: TODAY, context: '', rows: [] }), TypeError);
});

test('snapshot, E8: measured and modeled Air are never one series, and rows are only this context\'s', () => {
  const mixed = [stored({ local_date: '2026-10-10', source_code: 'airnow_station', station_id: 'S' }), stored({ local_date: '2026-10-11', source_code: 'open_meteo_cams' })];
  assert.throws(() => patterns(mixed), /measured and modeled Air are mixed/);
  // A measured home's gap row with no station beside its measured values is one series.
  assert.doesNotThrow(() => patterns([mixed[0], stored({ local_date: '2026-10-11', value: null, missing_code: 'source_gap', source_code: null })]));
  assert.throws(() => patterns([stored({ home_context_id: '22222222-2222-4222-8222-222222222222' })]), /another home context/);
  const unscoped = stored();
  delete unscoped.home_context_id;
  assert.throws(() => patterns([unscoped]), /another home context/, 'a row without its context is refused, not trusted');
  assert.throws(() => patterns(undefined), /rows must be/, 'a missing list is a bug, not an empty household');
  assert.throws(() => patterns({}), /rows must be/);
  // Every Air row that names a source counts, valued or not (M1).
  const otherKindGap = stored({ local_date: '2026-10-11', value: null, missing_code: 'source_gap', source_code: 'open_meteo_cams' });
  assert.throws(() => patterns([mixed[0], otherKindGap]), /measured and modeled Air are mixed/);
  const twoNulls = [stored({ local_date: '2026-10-10', value: null, missing_code: 'pending', source_code: 'airnow_station', station_id: 'S' }), otherKindGap];
  assert.throws(() => patterns(twoNulls), /measured and modeled Air are mixed/);
  // Outside the range too: the home has one kind, wherever its rows fall.
  assert.throws(() => patterns([mixed[0], stored({ local_date: '2026-01-05', source_code: 'open_meteo_cams' })]), /measured and modeled Air are mixed/);
  assert.throws(() => patterns([stored({ factor: 'pollen' })]), TypeError);
  assert.throws(() => patterns([stored({ factor: 'uv', source_code: 'open_meteo_cams' })]), TypeError);
  assert.throws(() => patterns([stored(), stored()]), /two stored rows/);
  assert.throws(() => patterns([stored({ value: -1 })]), TypeError);
  assert.throws(() => patterns([stored({ value: 3, source_code: null })]), TypeError);
});

test('snapshot through the client: three symptom and three fine days give a comparable Air mean, and UV likewise', () => {
  const symptom = ['2026-10-10', '2026-10-11', '2026-10-12'];
  const fine = ['2026-10-13', '2026-10-14', '2026-10-15'];
  const rows = [...symptom, ...fine].flatMap((date, i) => [stored({ local_date: date, value: i < 3 ? 80 : 20 }), stored({ local_date: date, factor: 'uv', value: i < 3 ? 7.5 : 1.5 })]);
  const snap = patterns(rows);
  const entries = [...checkins(symptom, false), ...checkins(fine, true), ...checkins(['2026-07-15'], true)];
  const air = analyzeHistory(entries, snap.rows, addDays(TODAY, -83), TODAY, 'household', 'Air', snap.comparison);
  assert.deepEqual([air.enough, air.symptomMean, air.fineMean, air.comparable], [true, 80, 20, 6]);
  const uv = analyzeHistory(entries, snap.rows, addDays(TODAY, -83), TODAY, 'household', 'UV', snap.comparison);
  assert.deepEqual([uv.enough, uv.symptomMean, uv.fineMean], [true, 7.5, 1.5]);
  // Check-ins on dates before recording started are counted missing, never values.
  const late = analyzeHistory(entries, patterns(rows, { recordingFrom: '2026-10-12' }).rows, addDays(TODAY, -83), TODAY, 'household', 'Air', snap.comparison);
  assert.deepEqual([late.comparable, late.missing, late.enough, late.symptomMean], [4, 2, false, 80]);
});

test('snapshot: a DST date has exactly one row per factor', () => {
  const snap = buildHistorySnapshot({ from: '2026-10-30', to: '2026-11-03', today: '2026-11-04', context: CONTEXT, rows: [stored({ local_date: FALL, value: 30, hours_expected: 25, hours_observed: 25 })], recordingFrom: '2026-10-01' });
  for (const factor of HISTORY_FACTORS) assert.equal(find(snap, FALL, factor).length, 1, factor);
  assert.equal(snap.rows.length, 20);
  assert.equal(find(snap, FALL, 'Air')[0].value, 30);
});

// ---------------------------------------------------------------------------
// Copy and purity
// ---------------------------------------------------------------------------

test('E24: no U+2014 in any string the module can emit, or anywhere in its source', () => {
  const strings = [...Object.values(SOURCE_LABELS), NOT_RECORDED_SOURCE, ISSUED_UNKNOWN, METHOD_VERSION,
    ...Object.values(MISSING).map((m) => (typeof m === 'function' ? m('2026-10-01') : m))];
  for (const s of strings) assert.equal(s.includes(EM_DASH), false, s);
  assert.equal(SOURCE.includes(EM_DASH), false);
  assert.equal(SOURCE.includes('\\u2014'), false);
  const snaps = [patterns([stored({ local_date: '2026-10-01', value: null, missing_code: 'source_gap' })]), buildHistorySnapshot({ from: '2026-06-01', to: '2026-08-31', today: TODAY, context: CONTEXT, rows: [], recordingFrom: '2026-08-15' })];
  for (const snap of snaps) assert.equal(JSON.stringify(snap).includes(EM_DASH), false);
  // The window reason outranks Recorded from: 1 July is both outside the window and before 15 August.
  assert.equal(find(snaps[1], '2026-07-01', 'Air')[0].missing, 'Outside the twelve-week history window');
  assert.equal(find(snaps[1], '2026-08-01', 'Air')[0].missing, 'Recorded from 2026-08-15. Earlier days have no daily maximum.');
  assert.ok(Object.isFrozen(MISSING) && Object.isFrozen(SOURCE_LABELS) && Object.isFrozen(HISTORY_FACTORS));
});

test('E1 and purity: no clock, no network, no environment, no daily_scores, one import', () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /Date\.now|new Date\(\)|performance\.now/, 'no clock');
  assert.doesNotMatch(code, /\bfetch\b|XMLHttpRequest|process\.|supabase/i, 'no I/O');
  assert.doesNotMatch(SOURCE, /daily_scores/, 'app-time readings are never an input');
  assert.deepEqual([...SOURCE.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['./localDate.js']);
});
