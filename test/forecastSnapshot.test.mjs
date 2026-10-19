// B10 Task 7: the forecast snapshot builder (lib/forecast/snapshot.js) and its
// copy table (lib/forecast/copy.js). Pure: no network, no clock, no store.
// Every body is run through the client's own validator and screen decisions,
// transcribed in test/helpers/frontendB10.mjs, and the assertions are on what
// the screen would then show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFrontend } from './frontend-test-loader.mjs';
import {
  FRAGMENTS, TRANSCRIPTIONS, forecastScreenText, forecastTime, outdoorDecisions, productionForecast,
} from './helpers/frontendB10.mjs';
import {
  DEFAULT_RETRY_SECONDS, EMPTY_ZONE, FORECAST_RULES_VERSION, FORECAST_WINDOWS, buildForecastSnapshot, emptySnapshot, localDateIn, zonedInstant,
} from '../lib/forecast/snapshot.js';
import { AIRNOW_CATEGORIES, COPY, WARNINGS_UNAVAILABLE, WMO_CODES, presentable, wmoCode } from '../lib/forecast/copy.js';

const EM_DASH = String.fromCharCode(0x2014);
const HOUR = 3_600_000;
const MIN = 60_000;
const ZONE = 'America/New_York';
const weekPreview = await loadFrontend('week-preview');
const expandedPreview = await loadFrontend('expanded-preview');
const evidencePreview = await loadFrontend('week-evidence-preview');
const evidenceCopy = evidencePreview.weekEvidenceCopy;

// ---------------------------------------------------------------------------
// Fixtures: provider answers in the adapters' exact output shapes
// ---------------------------------------------------------------------------

const TODAY = '2026-10-19';
const NOW = Date.parse('2026-10-19T13:10:00Z'); // 09:10 EDT
const FETCHED = '2026-10-19T13:05:00.000Z';
const RUN = '2026-10-19T06:00:00.000Z';

const CHARLOTTE = Object.freeze({ kind: 'matched', id: 'us-place:3712000', label: 'Charlotte, NC', lat: 35.208, lng: -80.831, timezone: ZONE });
const HOME = Object.freeze({ kind: 'home' });

const addDays = (date, n) => weekPreview.dayAdd(date, n);
const hourFormats = new Map();
function localHour(t, zone = ZONE) {
  if (!hourFormats.has(zone)) hourFormats.set(zone, new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }));
  return Number(hourFormats.get(zone).format(new Date(t)));
}

/** A typical October day: values by local hour, a thunderstorm and rain at 15:00. */
function typicalHour(t, zone = ZONE) {
  const h = localHour(t, zone);
  return {
    t,
    temperatureF: 58 + h / 2,
    apparentF: 59 + h / 2,
    precipPct: null,
    precipIn: h === 15 ? 0.1 : 0,
    weatherCode: h === 15 ? 95 : 2,
    windMph: 5 + (h % 4),
    uv: Math.max(0, 6 - Math.abs(13 - h)),
  };
}

/** Hourly series from local midnight of `today` for `days` local days, as the adapter returns it. */
function hoursFrom(today, { days = 8, zone = ZONE, value = typicalHour } = {}) {
  const first = Date.parse(zonedInstant(today, '00:00', zone));
  const last = Date.parse(zonedInstant(addDays(today, days), '00:00', zone));
  const out = [];
  for (let t = first; t < last; t += HOUR) out.push(value(t, zone));
  return out;
}

function openMeteo({ today = TODAY, hours, fetchedAt = FETCHED, run = RUN, timezone = ZONE } = {}) {
  return {
    ok: true, timezone, model: 'ncep_gfs_global', runInitialisedAt: run, runAvailableAt: '2026-10-19T11:36:06.000Z', fetchedAt, hours: hours ?? hoursFrom(today),
  };
}

const airRow = (over = {}) => ({
  dateIssue: '2026-10-19', dateForecast: '2026-10-20', reportingArea: 'Charlotte', stateCode: 'NC', parameter: 'O3', aqi: 55, category: 'Moderate', actionDay: false, ...over,
});
const airNowOk = (rows = [airRow(), airRow({ parameter: 'PM2.5', aqi: 30, category: 'Good' })], fetchedAt = FETCHED) => ({ ok: true, fetchedAt, rows });
const alertsOk = (alerts = [], fetchedAt = '2026-10-19T13:06:00.000Z') => ({ ok: true, fetchedAt, alerts });

function build(over = {}) {
  return buildForecastSnapshot({
    place: CHARLOTTE, date: '2026-10-20', now: NOW, openMeteo: openMeteo(), airNow: airNowOk(), alerts: alertsOk(), ...over,
  });
}

/** A build at another moment, with every provider fetched five minutes before it (one hour bucket). */
function buildAt(now, over = {}, { today = TODAY } = {}) {
  const fetchedAt = new Date(now - 5 * MIN).toISOString();
  return build({ now, openMeteo: openMeteo({ today, fetchedAt }), airNow: airNowOk(undefined, fetchedAt), ...over });
}

/** Every string anywhere in a value. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** The body as the client receives it: validated, then the screen's decisions and text. */
function onScreen(body, { date, period = 'Morning', now = NOW, place = '' } = {}) {
  const read = productionForecast({ data: body, error: null, loading: false });
  const live = { ...read, production: true };
  const draft = { key: 'outdoors:k', activity: 'Walk', place, date: date ?? TODAY, period, duration: 60, watch: false };
  const decisions = outdoorDecisions({
    live, draft, today: TODAY, review: { forecast: 'unavailable' }, state: { actions: [] }, now, acknowledged: '', pauseForecast: false,
    validActionDate: expandedPreview.validActionDate, dayAdd: weekPreview.dayAdd, forecastFixture: evidencePreview.forecastFixture,
  });
  const text = forecastScreenText(live, decisions.currentPeriod);
  const periodsText = decisions.periods.map((p) => ({ name: p.name, from: forecastTime(p.start, live.data.zone), to: forecastTime(p.end, live.data.zone) }));
  // The message under the empty period buttons (WeekOutdoors.tsx:45, production: review.forecast is idle).
  const emptyMessage = decisions.periods.length ? null : decisions.far ? evidenceCopy.future : evidenceCopy.forecastUnavailable;
  return { read, live, ...decisions, text, periodsText, emptyMessage };
}

function assertClientAccepts(body, label = '') {
  const read = productionForecast({ data: body, error: null });
  assert.equal(read.error, null, `${label}: the client must accept the body`);
  assert.equal(read.data, body, label);
}

// ---------------------------------------------------------------------------
// 1. The client's code, transcribed
// ---------------------------------------------------------------------------

function stripped(t, sourceText) {
  const lines = sourceText.split(/\r?\n/);
  let text = lines.slice(t.line - 1, t.line - 1 + t.lines).join('\n');
  for (const [from, to] of t.strip) {
    const at = text.indexOf(from);
    assert.ok(at >= 0 && text.indexOf(from, at + 1) < 0, `${t.file}:${t.line}: "${from}" occurs exactly once`);
    text = text.slice(0, at) + to + text.slice(at + from.length);
  }
  if (t.before !== undefined) assert.equal(lines[t.line - 2], t.before, `${t.file}:${t.line - 1} is the hook's forecast.read call`);
  return text;
}
const transcribed = (t) => {
  const text = t.fn.toString();
  return t.body ? text.split('\n').slice(1, 1 + t.lines).join('\n') : text;
};

test('drift: each transcribed function equals its frontend source with only the recorded annotations removed', async () => {
  assert.equal(TRANSCRIPTIONS.length, 3);
  for (const t of TRANSCRIPTIONS) {
    const sourceText = await readFile(new URL(`../${t.file}`, import.meta.url), 'utf8');
    assert.equal(stripped(t, sourceText), transcribed(t), `${t.file}:${t.line} changed; re-transcribe it`);
  }
});

test('drift: every screen fragment occurs in its frontend line and in the transcription', async () => {
  for (const f of FRAGMENTS) {
    const lines = (await readFile(new URL(`../${f.file}`, import.meta.url), 'utf8')).split(/\r?\n/);
    assert.ok(lines[f.line - 1].includes(f.text), `${f.file}:${f.line} no longer contains ${f.text}`);
    assert.ok(f.fn.toString().includes(f.text), `the transcription lacks ${f.text}`);
  }
});

test('drift: the comparison notices a one-character change in the frontend source', async () => {
  for (const t of TRANSCRIPTIONS) {
    const sourceText = await readFile(new URL(`../${t.file}`, import.meta.url), 'utf8');
    const lines = sourceText.split(/\r?\n/);
    const i = Array.from({ length: t.lines }, (_, n) => t.line - 1 + n).find((n) => lines[n].includes(')'));
    assert.ok(i !== undefined, `${t.file}:${t.line} has a parenthesis to change`);
    // The last one, so the recorded type annotations still match.
    const at = lines[i].lastIndexOf(')');
    lines[i] = `${lines[i].slice(0, at)}) ${lines[i].slice(at + 1)}`;
    assert.notEqual(stripped(t, lines.join('\n')), transcribed(t), `${t.file}:${t.line}`);
  }
});

test('the transcribed validator says no where the client says no', () => {
  const { body } = build();
  assertClientAccepts(body, 'baseline');
  const broken = [
    ['an offset-less period start', { ...body, periods: [{ ...body.periods[0], start: '2026-10-20T08:00' }] }],
    ['an unparseable issuedAt', { ...body, issuedAt: 'Monday' }],
    ['an invalid zone', { ...body, zone: 'Mars/Olympus_Mons' }],
    ['a numeric pollen', { ...body, periods: [{ ...body.periods[0], pollen: 3 }] }],
    ['no coverage', { ...body, coverage: undefined }],
  ];
  for (const [label, data] of broken) {
    const read = productionForecast({ data, error: null });
    assert.equal(read.data, null, label);
    assert.equal(read.error, 'Forecast information could not be verified.', label);
  }
});

// ---------------------------------------------------------------------------
// 2. Times (trap 15) and DST
// ---------------------------------------------------------------------------

test('trap 15: every period start and end is a Z instant that parses, with end after start', () => {
  for (const date of [TODAY, '2026-10-20', '2026-10-25']) {
    const { body } = build({ date });
    assert.ok(body.periods.length > 0, date);
    for (const p of body.periods) {
      assert.match(p.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.match(p.end, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.ok(Date.parse(p.end) > Date.parse(p.start));
    }
    assert.ok(!strings(body).some((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)), 'no zone-naive instant');
  }
});

test('DST: Morning is 12:00Z on 2026-03-08 (EDT) and 13:00Z on 2026-11-01 (EST); periods are 4, 5 and 4 hours', () => {
  for (const [today, date, morning] of [['2026-03-07', '2026-03-08', '2026-03-08T12:00:00Z'], ['2026-10-31', '2026-11-01', '2026-11-01T13:00:00Z']]) {
    const now = Date.parse(zonedInstant(today, '10:00', ZONE));
    const { status, body } = buildAt(now, { date }, { today });
    assert.equal(status, 200);
    assert.deepEqual(body.periods.map((p) => p.name), ['Morning', 'Afternoon', 'Evening']);
    assert.equal(body.periods[0].start, morning);
    assert.deepEqual(body.periods.map((p) => (Date.parse(p.end) - Date.parse(p.start)) / HOUR), [4, 5, 4]);
    assertClientAccepts(body, date);
    // What the screen prints: local wall times in the zone.
    const screen = onScreen(body, { date, now });
    assert.deepEqual(screen.periodsText, [
      { name: 'Morning', from: '08:00', to: '12:00' }, { name: 'Afternoon', from: '12:00', to: '17:00' }, { name: 'Evening', from: '17:00', to: '21:00' },
    ]);
  }
});

test('DST: on 2026-10-24 Morning is 12:00Z to 16:00Z', () => {
  const { body } = build({ date: '2026-10-24' });
  assert.equal(body.periods[0].start, '2026-10-24T12:00:00Z');
  assert.equal(body.periods[0].end, '2026-10-24T16:00:00Z');
});

test('zonedInstant converts local wall time across both transitions and refuses a skipped local time', () => {
  assert.equal(zonedInstant('2026-03-08', '08:00', ZONE), '2026-03-08T12:00:00Z');
  assert.equal(zonedInstant('2026-03-07', '08:00', ZONE), '2026-03-07T13:00:00Z');
  assert.equal(zonedInstant('2026-11-01', '08:00', ZONE), '2026-11-01T13:00:00Z');
  assert.equal(zonedInstant('2026-10-31', '21:00', ZONE), '2026-11-01T01:00:00Z');
  // Just after each transition, where the first offset guess is on the wrong side of it.
  assert.equal(zonedInstant('2026-03-08', '03:00', ZONE), '2026-03-08T07:00:00Z');
  assert.equal(zonedInstant('2026-11-01', '03:00', ZONE), '2026-11-01T08:00:00Z');
  assert.equal(zonedInstant('2026-07-01', '12:00', 'UTC'), '2026-07-01T12:00:00Z');
  assert.equal(zonedInstant('2026-07-01', '12:00', 'Asia/Kolkata'), '2026-07-01T06:30:00Z');
  assert.throws(() => zonedInstant('2026-03-08', '02:30', ZONE), RangeError);
  assert.throws(() => zonedInstant('2026-02-30', '08:00', ZONE), TypeError);
  assert.throws(() => zonedInstant('2026-03-08', '8:00', ZONE), TypeError);
  assert.throws(() => zonedInstant('2026-03-08', '08:00', 'Nowhere/Here'), RangeError);
  // The windows themselves never touch a transition hour.
  for (const w of FORECAST_WINDOWS) assert.ok(w.start >= '08:00' && w.end <= '21:00');
});

// ---------------------------------------------------------------------------
// 3. The horizon (F12)
// ---------------------------------------------------------------------------

test('F12: eight days of hours give horizonEnd today plus 6, the same for every requested date', () => {
  const seen = new Set();
  for (let i = -2; i <= 9; i += 1) {
    const { body } = build({ date: addDays(TODAY, i) });
    assert.equal(body.horizonStart, TODAY);
    assert.equal(body.horizonEnd, addDays(TODAY, 6));
    seen.add(`${body.horizonStart}..${body.horizonEnd}`);
  }
  assert.equal(seen.size, 1);
});

test('F12: a series cut mid-afternoon on today plus 3 ends the horizon on today plus 2', () => {
  const cut = Date.parse(zonedInstant(addDays(TODAY, 3), '14:00', ZONE));
  const hours = hoursFrom(TODAY).filter((h) => h.t < cut);
  for (const date of [TODAY, addDays(TODAY, 2), addDays(TODAY, 3), addDays(TODAY, 5)]) {
    const { body } = build({ date, openMeteo: openMeteo({ hours }) });
    assert.equal(body.horizonEnd, addDays(TODAY, 2), date);
  }
  // Past the horizon: no periods, and the screen shows "future" with a check-again date.
  const { body } = build({ date: addDays(TODAY, 3), openMeteo: openMeteo({ hours }) });
  assert.deepEqual(body.periods, []);
  const screen = onScreen(body, { date: addDays(TODAY, 3) });
  assert.equal(screen.far, true);
  assert.equal(screen.emptyMessage, evidenceCopy.future);
});

test('F12, F21: a date after the horizon gives periods [] with full metadata and the client\'s far is true', () => {
  const { status, body } = build({ date: addDays(TODAY, 7) });
  assert.equal(status, 200);
  assert.deepEqual(body.periods, []);
  assertClientAccepts(body);
  const screen = onScreen(body, { date: addDays(TODAY, 7) });
  assert.equal(screen.far, true);
  assert.equal(screen.emptyMessage, evidenceCopy.future);
  // The last date inside the horizon is served and is not far.
  const inside = build({ date: addDays(TODAY, 6) }).body;
  assert.equal(inside.periods.length, 3);
  assert.equal(onScreen(inside, { date: addDays(TODAY, 6) }).far, false);
});

test('F21: a past date gives periods [] and the screen shows forecastUnavailable, not future', () => {
  const { status, body } = build({ date: addDays(TODAY, -1) });
  assert.equal(status, 200);
  assert.deepEqual(body.periods, []);
  const screen = onScreen(body, { date: addDays(TODAY, -1) });
  assert.equal(screen.far, false);
  assert.equal(screen.emptyMessage, evidenceCopy.forecastUnavailable);
});

test('F13: today after 21:00 local has no periods; at 13:00 local only Afternoon and Evening', () => {
  const late = Date.parse(zonedInstant(TODAY, '21:30', ZONE));
  assert.deepEqual(buildAt(late, { date: TODAY }).body.periods, []);
  const atNine = Date.parse(zonedInstant(TODAY, '21:00', ZONE));
  assert.deepEqual(buildAt(atNine, { date: TODAY }).body.periods, [], 'an Evening ending exactly now is over');
  const one = Date.parse(zonedInstant(TODAY, '13:00', ZONE));
  const { body } = buildAt(one, { date: TODAY });
  assert.deepEqual(body.periods.map((p) => p.name), ['Afternoon', 'Evening']);
  const screen = onScreen(body, { date: TODAY, now: one, period: 'Morning' });
  assert.equal(screen.currentPeriod, undefined, 'a passed Morning cannot be chosen');
});

test('F12: no complete date in the series is a 503, not an invented horizon', () => {
  const hours = hoursFrom(TODAY).map((h) => ({ ...h, temperatureF: localHour(h.t) === 10 ? null : h.temperatureF }));
  const result = build({ openMeteo: openMeteo({ hours }) });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'open_meteo_incomplete');
  assert.ok(result.retryAfter > 0);
});

// ---------------------------------------------------------------------------
// 4. Never invent
// ---------------------------------------------------------------------------

function withHour(date, hhmm, change) {
  const t = Date.parse(zonedInstant(date, hhmm, ZONE));
  return hoursFrom(TODAY).map((h) => (h.t === t ? { ...h, ...change } : h));
}

test('never invent: one missing temperature hour drops that period only', () => {
  const { body } = build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '13:00', { temperatureF: null }) }) });
  assert.deepEqual(body.periods.map((p) => p.name), ['Morning', 'Evening']);
  // The date is no longer complete, so the horizon is unaffected only if a later date is complete.
  assert.equal(body.horizonEnd, addDays(TODAY, 6));
});

test('never invent: an hour absent from the series, or a code outside the WMO table, drops the period', () => {
  const t = Date.parse(zonedInstant('2026-10-20', '18:00', ZONE));
  const gap = build({ openMeteo: openMeteo({ hours: hoursFrom(TODAY).filter((h) => h.t !== t) }) }).body;
  assert.deepEqual(gap.periods.map((p) => p.name), ['Morning', 'Afternoon']);
  const odd = build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '09:00', { weatherCode: 42 }) }) }).body;
  assert.deepEqual(odd.periods.map((p) => p.name), ['Afternoon', 'Evening']);
  const noCode = build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '09:00', { weatherCode: null }) }) }).body;
  assert.deepEqual(noCode.periods.map((p) => p.name), ['Afternoon', 'Evening']);
});

test('never invent: one missing UV hour makes uv null, not a smaller maximum; the screen says Unavailable', () => {
  const full = build().body.periods.find((p) => p.name === 'Afternoon');
  assert.equal(full.uv, 6);
  const { body } = build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '13:00', { uv: null }) }) });
  const afternoon = body.periods.find((p) => p.name === 'Afternoon');
  assert.equal(afternoon.uv, null);
  assert.equal(body.periods.find((p) => p.name === 'Morning').uv, 4);
  assert.equal(onScreen(body, { date: '2026-10-20', period: 'Afternoon' }).text.cells.uv, 'Unavailable');
});

test('never invent: a modelled evening UV of 0 stays 0 and renders as 0', () => {
  const hours = hoursFrom(TODAY).map((h) => (localHour(h.t) >= 17 ? { ...h, uv: 0 } : h));
  const { body } = build({ openMeteo: openMeteo({ hours }) });
  const evening = body.periods.find((p) => p.name === 'Evening');
  assert.equal(evening.uv, 0);
  assert.equal(onScreen(body, { date: '2026-10-20', period: 'Evening' }).text.cells.uv, '0 UV index');
});

test('never invent: air is null in every period whatever AirNow says, and pollen is always null', () => {
  for (const airNow of [airNowOk(), airNowOk([airRow({ aqi: 180, category: 'Unhealthy' })]), { ok: false, reason: 'timeout' }, undefined]) {
    const { body } = build({ airNow });
    for (const p of body.periods) {
      assert.equal(p.air, null);
      assert.equal(p.pollen, null);
    }
    const screen = onScreen(body, { date: '2026-10-20' });
    assert.equal(screen.text.cells.air, 'Unavailable');
    assert.equal(screen.text.cells.pollen, 'Unavailable');
  }
});

test('never invent: missing feels-like, wind or rain hours say unavailable instead of a value', () => {
  const { body } = build({
    openMeteo: openMeteo({
      hours: hoursFrom(TODAY).map((h) => {
        const at = h.t === Date.parse(zonedInstant('2026-10-20', '09:00', ZONE));
        return at ? { ...h, apparentF: null, windMph: null, precipIn: null } : h;
      }),
    }),
  });
  const morning = body.periods.find((p) => p.name === 'Morning');
  assert.match(morning.weather, /feels-like temperature unavailable/);
  assert.match(morning.weather, /wind unavailable/);
  assert.match(morning.weather, /model rain unavailable/);
  assert.doesNotMatch(morning.weather, /feels like up to|wind up to|no rain in the model/);
});

test('rain: the model amount is the sum of the period\'s preceding-hour values, never a chance or a percentage', () => {
  // The preceding-hour hour stamped 12:00 belongs to Morning (start < t <= end), not Afternoon.
  const hours = hoursFrom(TODAY).map((h) => {
    const at = (hhmm) => h.t === Date.parse(zonedInstant('2026-10-20', hhmm, ZONE));
    if (at('12:00')) return { ...h, precipIn: 0.25, precipPct: 90 };
    if (at('08:00')) return { ...h, precipIn: 0.5, precipPct: 100 };
    return { ...h, precipPct: 40 };
  });
  const { body } = build({ openMeteo: openMeteo({ hours }) });
  const [morning, afternoon] = body.periods;
  assert.match(morning.weather, /model rain 0\.25 in/, '08:00 is the hour before Morning');
  assert.match(afternoon.weather, /model rain 0\.10 in/);
  for (const p of body.periods) {
    assert.doesNotMatch(`${p.weather} ${p.tradeoff}`, /%|chance|probab/i);
  }
  const trace = build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '10:00', { precipIn: 0.004 }) }) }).body.periods[0];
  assert.match(trace.weather, /model rain under 0\.01 in/);
  assert.match(build().body.periods[0].weather, /no rain in the model/);
});

test('weather: the most severe code by rank, marked "at times" when the period varies; °F with °C arithmetic', () => {
  const afternoon = build().body.periods.find((p) => p.name === 'Afternoon');
  assert.equal(afternoon.weather, '64 to 66 °F (18 to 19 °C), thunderstorm at times, feels like up to 67 °F, model rain 0.10 in, wind up to 8 mph');
  const morning = build().body.periods.find((p) => p.name === 'Morning');
  assert.match(morning.weather, /, partly cloudy,/);
  // Freezing rain outranks heavy rain; fog is described when it occurs.
  const icy = build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '09:00', { weatherCode: 65 }).map((h) => (h.t === Date.parse(zonedInstant('2026-10-20', '10:00', ZONE)) ? { ...h, weatherCode: 66 } : h)) }) }).body.periods[0];
  assert.match(icy.weather, /light freezing rain at times/);
  const foggy = build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '09:00', { weatherCode: 45 }) }) }).body.periods[0];
  assert.match(foggy.weather, /fog at times/);
  const flat = build({ openMeteo: openMeteo({ hours: hoursFrom(TODAY).map((h) => ({ ...h, temperatureF: 70, weatherCode: 0 })) }) }).body.periods[0];
  assert.match(flat.weather, /^70 °F \(21 °C\), clear sky,/);
});

test('copy: the WMO table is the documented code set, ranked with thunderstorms above freezing precipitation above rain', () => {
  assert.deepEqual(WMO_CODES.map(([c]) => c).sort((a, b) => a - b), [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
  const ranks = WMO_CODES.map(([, e]) => e.rank);
  assert.equal(new Set(ranks).size, ranks.length, 'ranks are distinct');
  assert.ok(wmoCode(95).rank > wmoCode(67).rank && wmoCode(67).rank > wmoCode(65).rank && wmoCode(65).rank > wmoCode(45).rank && wmoCode(45).rank > wmoCode(3).rank);
  assert.equal(wmoCode(4), null);
  assert.throws(() => { WMO_CODES[0][1].rank = 99; }, TypeError);
  assert.ok(Object.isFrozen(COPY) && Object.isFrozen(COPY.coverage) && Object.isFrozen(COPY.emptyWhy));
});

// ---------------------------------------------------------------------------
// 5. Coverage (trap 16, F15), source (F16), warnings (F7)
// ---------------------------------------------------------------------------

const KEYS = ['Air', 'Pollen', 'UV', 'Weather'];
function assertCoverage(body, prefix, label) {
  assert.deepEqual(Object.keys(body.coverage).sort(), KEYS, label);
  for (const key of KEYS) {
    assert.equal(typeof body.coverage[key], 'string', `${label}: ${key}`);
    assert.ok(body.coverage[key].startsWith(prefix), `${label}: ${key} starts with "${prefix}": ${body.coverage[key]}`);
  }
}

test('trap 16, F15: the eight adapter combinations; coverage has exactly four string keys starting with the place', () => {
  const omStates = { ok: openMeteo(), failed: { ok: false, reason: 'timeout' } };
  const airStates = { ok: airNowOk(), failed: { ok: false, reason: 'http_500' } };
  const nwsStates = { ok: alertsOk([{ id: 'urn:a', event: 'Flood Watch', ends: null }]), failed: { ok: false, reason: 'timeout' } };
  let cases = 0;
  for (const [om, o] of Object.entries(omStates)) {
    for (const [an, a] of Object.entries(airStates)) {
      for (const [nw, n] of Object.entries(nwsStates)) {
        cases += 1;
        const label = `openMeteo ${om}, airNow ${an}, nws ${nw}`;
        for (const [place, prefix] of [[CHARLOTTE, 'For Charlotte, NC (Census internal point): '], [HOME, 'For your home area: ']]) {
          const result = build({ place, openMeteo: o, airNow: a, alerts: n });
          if (om === 'failed') {
            assert.equal(result.status, 503, label);
            assert.ok(Number.isInteger(result.retryAfter) && result.retryAfter > 0, label);
            assert.equal(result.body, undefined, label);
            continue;
          }
          assert.equal(result.status, 200, label);
          assertCoverage(result.body, prefix, label);
          assertClientAccepts(result.body, label);
          const screen = onScreen(result.body, { date: '2026-10-20' });
          for (const key of KEYS) assert.equal(screen.text.coverage[key], result.body.coverage[key], `${label}: the ${key} cell shows the string`);
          assert.match(result.body.coverage.Air, an === 'ok' ? /EPA AirNow forecast for the Charlotte, NC reporting area/ : /Air was not checked\. The EPA AirNow forecast could not be reached\./, label);
          assert.equal(screen.text.notices, nw === 'ok' ? result.body.warningStatus : WARNINGS_UNAVAILABLE, label);
          assert.equal(result.body.warningStatus.startsWith(nw === 'ok' ? 'Active National Weather Service alerts' : 'Warnings unavailable'), true, label);
        }
      }
    }
  }
  assert.equal(cases, 8);
});

test('F15: Weather coverage names the model, its run, the windows, the horizon, interpolation and the CC BY 4.0 credit', () => {
  const { coverage } = build().body;
  assert.equal(coverage.Weather, [
    'For Charlotte, NC (Census internal point): Open-Meteo GFS Global model forecast, run 2026-10-19 06:00 UTC, hourly values summarised by period',
    ' (Morning 08:00 to 12:00, Afternoon 12:00 to 17:00, Evening 17:00 to 21:00, America/New_York time), for 2026-10-19 through 2026-10-25.',
    ' Rain is the model\'s amount in inches, not a chance of rain.',
    ' From 2026-10-24, Open-Meteo interpolates hourly values from 3-hourly model steps.',
    ' Weather data by Open-Meteo.com (CC BY 4.0).',
  ].join(''));
  assert.match(coverage.UV, /Open-Meteo GFS model UV index, the highest hourly value in each period, through 2026-10-25\. Modelled, not measured\./);
  assert.equal(coverage.Pollen, 'For Charlotte, NC (Census internal point): Unavailable. HALO has no free pollen forecast for this area.');
});

test('F15: Air coverage when AirNow is not connected (absent, no_key) or over budget says air was not checked', () => {
  for (const [airNow, expected] of [
    [undefined, COPY.coverage.airNotConnected],
    [{ ok: false, reason: 'no_key' }, COPY.coverage.airNotConnected],
    [{ ok: false, reason: 'budget' }, COPY.coverage.airBudget],
    [{ ok: false, reason: 'invalid' }, COPY.coverage.airFailed],
  ]) {
    const { status, body } = build({ airNow });
    assert.equal(status, 200);
    assert.equal(body.coverage.Air, `For Charlotte, NC (Census internal point): ${expected}`);
    assert.match(expected, /^Air was not checked\./);
    for (const p of body.periods) assert.match(p.tradeoff, /Air was not checked for this date\.$/);
    assert.doesNotMatch(body.source, /AirNow/);
  }
});

test('F16: source names only the providers that contributed, and the place', () => {
  assert.equal(build().body.source, 'Open-Meteo, EPA AirNow and the National Weather Service, for Charlotte, NC');
  assert.equal(build({ airNow: undefined }).body.source, 'Open-Meteo and the National Weather Service, for Charlotte, NC');
  assert.equal(build({ alerts: { ok: false, reason: 'no_contact' } }).body.source, 'Open-Meteo and EPA AirNow, for Charlotte, NC');
  assert.equal(build({ place: HOME, airNow: { ok: false, reason: 'timeout' }, alerts: undefined }).body.source, 'Open-Meteo, for your home area');
  // AirNow answered but had nothing for this date: it contributed nothing.
  assert.equal(build({ airNow: airNowOk([airRow({ dateForecast: '2026-10-21' })]) }).body.source, 'Open-Meteo and the National Weather Service, for Charlotte, NC');
  // The screen's Source row and the saved task reason carry it.
  const screen = onScreen(build().body, { date: '2026-10-20' });
  assert.equal(screen.text.sourceName, 'Open-Meteo, EPA AirNow and the National Weather Service, for Charlotte, NC');
});

test('F7: warningStatus says none, lists active events as received, or falls back; all "as of" the lookup in the zone', () => {
  assert.equal(build().body.warningStatus, 'No National Weather Service alerts are active for this area as of 09:06 EDT. Check the official site before going.');
  const active = build({ alerts: alertsOk([
    { id: 'urn:1', event: 'Heat Advisory', ends: null },
    { id: 'urn:2', event: 'Flood Watch', ends: '2026-10-19T20:00:00.000Z' },
    { id: 'urn:3', event: 'Heat Advisory', ends: null },
  ]) }).body;
  assert.equal(active.warningStatus, 'Active National Weather Service alerts as of 09:06 EDT: Heat Advisory and Flood Watch. Check the official site.');
  for (const alerts of [undefined, { ok: false, reason: 'timeout' }, { ok: true, alerts: [] }, { ok: true, fetchedAt: 'later', alerts: [] }, alertsOk([{ id: '', event: 'Tornado Warning' }])]) {
    assert.equal(build({ alerts }).body.warningStatus, WARNINGS_UNAVAILABLE);
  }
  assert.equal(WARNINGS_UNAVAILABLE, 'Warnings unavailable. Check the official site.');
});

// ---------------------------------------------------------------------------
// 6. AirNow as received (F6)
// ---------------------------------------------------------------------------

test('F6: a category-only row shows its category and no number; two pollutants keep their own values', () => {
  const { body } = build({ airNow: airNowOk([airRow({ aqi: null, category: 'Moderate' }), airRow({ parameter: 'PM2.5', aqi: 30, category: 'Good' })]) });
  assert.match(body.coverage.Air, /ozone Moderate \(category only, no AQI number issued\) and PM2\.5 Good \(AQI 30\)/);
  assert.doesNotMatch(body.coverage.Air, /ozone Moderate \(AQI/);
  for (const p of body.periods) assert.match(p.tradeoff, /Air is a daily AirNow forecast, the same for every period: ozone Moderate \(category only, no AQI number issued\) and PM2\.5 Good \(AQI 30\)\.$/);
  const two = build().body.coverage.Air;
  assert.match(two, /issued 2026-10-19, for 2026-10-20 as a whole day: ozone Moderate \(AQI 55\) and PM2\.5 Good \(AQI 30\)\./);
  assert.match(two, /Forecast by the state or local air agency, via the EPA AirNow program\./);
});

test('F6: unusable rows are dropped, never defaulted; other dates, no rows, latest issue and action day', () => {
  // An unknown category with no number is not a reading.
  const unknown = build({ airNow: airNowOk([airRow({ category: 'Fine', aqi: null })]) }).body.coverage.Air;
  assert.equal(unknown, `For Charlotte, NC (Census internal point): ${COPY.coverage.airNoArea}`);
  // A number without a category is shown as a number only.
  assert.match(build({ airNow: airNowOk([airRow({ category: 'Fine', aqi: 61 })]) }).body.coverage.Air, /ozone AQI 61 \(no category issued\)/);
  // Rows for other dates only.
  const other = build({ airNow: airNowOk([airRow({ dateForecast: '2026-10-21' }), airRow({ dateForecast: '2026-10-19' })]) }).body;
  assert.match(other.coverage.Air, /EPA AirNow issued no air forecast for 2026-10-20 for the Charlotte, NC reporting area\. AirNow forecast dates for this area: 2026-10-19 and 2026-10-21\./);
  for (const p of other.periods) assert.match(p.tradeoff, /No air forecast for this date\.$/);
  // An empty answer is a real "no forecast for this area".
  assert.match(build({ airNow: airNowOk([]) }).body.coverage.Air, /EPA AirNow has no air forecast for this area\./);
  // Two issues for one date: the later one is used, as received.
  const reissued = build({ airNow: airNowOk([airRow({ dateIssue: '2026-10-18', aqi: 80 }), airRow({ dateIssue: '2026-10-19', aqi: 55 })]) }).body;
  assert.match(reissued.coverage.Air, /issued 2026-10-19, for 2026-10-20 as a whole day: ozone Moderate \(AQI 55\)\./);
  assert.doesNotMatch(reissued.coverage.Air, /AQI 80/);
  assert.match(build({ airNow: airNowOk([airRow({ actionDay: true })]) }).body.coverage.Air, /An air quality action day is declared\./);
  // Category names are AirNow's six.
  assert.deepEqual(AIRNOW_CATEGORIES, ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous']);
});

// ---------------------------------------------------------------------------
// 7. Issue time (F17), expiry (F18), version (F19)
// ---------------------------------------------------------------------------

test('F17: issuedAt is the model run initialisation, never the fetch or the answer time; the screen prints it', () => {
  const { body } = build();
  assert.equal(body.issuedAt, '2026-10-19T06:00:00.000Z');
  assert.notEqual(Date.parse(body.issuedAt), Date.parse(FETCHED));
  assert.notEqual(Date.parse(body.issuedAt), NOW);
  assert.equal(onScreen(body, { date: '2026-10-20' }).text.issued, '2026-10-19T06:00:00.000Z');
});

test('F17, F21: run_unknown is a 503 with a positive retryAfter, exact when the adapter knows it', () => {
  assert.deepEqual(build({ openMeteo: { ok: false, reason: 'run_unknown', retryAfterMs: 125_400 } }), { status: 503, retryAfter: 126, reason: 'open_meteo_run_unknown' });
  assert.deepEqual(build({ openMeteo: { ok: false, reason: 'run_unknown', retryAfterMs: 1 } }), { status: 503, retryAfter: 1, reason: 'open_meteo_run_unknown' });
  assert.deepEqual(build({ openMeteo: { ok: false, reason: 'run_unknown' } }), { status: 503, retryAfter: DEFAULT_RETRY_SECONDS, reason: 'open_meteo_run_unknown' });
});

test('F21: Open-Meteo ok:false gives 503 for every reason the adapters and the route can produce', () => {
  for (const reason of ['timeout', 'network', 'http_500', 'http_429', 'too_large', 'invalid', 'no_timeout', 'bad_headers', 'budget', 'run_unknown']) {
    const result = build({ openMeteo: { ok: false, reason } });
    assert.equal(result.status, 503, reason);
    assert.ok(result.retryAfter >= 1, reason);
    assert.equal(result.reason, `open_meteo_${reason}`);
  }
  assert.equal(build({ openMeteo: undefined }).status, 503);
  assert.equal(build({ openMeteo: { ...openMeteo(), runInitialisedAt: 'yesterday' } }).status, 503);
  assert.equal(build({ openMeteo: { ...openMeteo(), hours: 'none' } }).status, 503);
});

test('F12, F21: an unusable home zone is a 503; a gazetteer place uses its own zone', () => {
  assert.deepEqual(build({ place: HOME, openMeteo: openMeteo({ timezone: 'Mars/Olympus_Mons' }) }), { status: 503, retryAfter: 60, reason: 'zone' });
  assert.equal(build({ place: HOME, openMeteo: openMeteo({ timezone: '' }) }).status, 503);
  const { body } = build({ place: CHARLOTTE, openMeteo: openMeteo({ timezone: 'GMT' }) });
  assert.equal(body.zone, ZONE);
  assert.equal(build({ place: HOME }).body.zone, ZONE);
  assert.equal(build({ place: { ...CHARLOTTE, timezone: 'Nowhere/Here' } }).status, 503);
});

test('F18, trap 19: expiresAt is at least 30 minutes ahead for any now in the data\'s hour bucket', () => {
  const bucket = Date.parse('2026-10-19T13:00:00Z');
  for (let fetched = bucket; fetched < bucket + HOUR; fetched += 7 * MIN) {
    for (let now = fetched; now < bucket + HOUR; now += 3 * MIN) {
      const { status, body } = build({ now, openMeteo: openMeteo({ fetchedAt: new Date(fetched).toISOString() }), airNow: airNowOk(undefined, new Date(fetched).toISOString()) });
      assert.equal(status, 200);
      assert.equal(Date.parse(body.expiresAt), fetched + 90 * MIN);
      assert.ok(Date.parse(body.expiresAt) - now >= 30 * MIN);
      assert.equal(onScreen(body, { date: '2026-10-20', now }).expired, false);
    }
  }
});

test('F18: the earliest fetch of the data used sets expiry; NWS never shortens it; an expired answer is never served', () => {
  const earlyAir = build({ airNow: airNowOk(undefined, '2026-10-19T12:40:00.000Z') }).body;
  assert.equal(earlyAir.expiresAt, '2026-10-19T14:10:00.000Z');
  const earlyAlerts = build({ alerts: alertsOk([], '2026-10-19T12:01:00.000Z') }).body;
  assert.equal(earlyAlerts.expiresAt, '2026-10-19T14:35:00.000Z');
  const failedAir = build({ airNow: { ok: false, reason: 'timeout' } }).body;
  assert.equal(failedAir.expiresAt, '2026-10-19T14:35:00.000Z');
  // At expiry the screen's own decision is "expired"; the builder refuses to serve it.
  const body = build().body;
  assert.equal(onScreen(body, { date: '2026-10-20', now: Date.parse(body.expiresAt) }).expired, true);
  assert.deepEqual(build({ now: Date.parse(body.expiresAt) }), { status: 503, retryAfter: 60, reason: 'stale' });
});

// Stale-serve (ruling on the Task 7 report, item 7): Task 8 passes stale: true when it
// serves the last confirmed forecast during Open-Meteo run_unknown.
const STALE_NOTE = 'A newer model run is not yet confirmed, so this is the last confirmed run. Refresh shortly for the newer run.';

test('stale-serve: 7h59m after the fetch is a 200 expiring 30 minutes ahead, with the coverage note', () => {
  const now = Date.parse(FETCHED) + 7 * HOUR + 59 * MIN;
  const { status, body } = build({ now, stale: true });
  assert.equal(status, 200);
  assert.equal(Date.parse(body.expiresAt), now + 30 * MIN);
  assert.ok(body.coverage.Weather.startsWith('For Charlotte, NC (Census internal point): '));
  assert.ok(body.coverage.Weather.includes(STALE_NOTE), body.coverage.Weather);
  assert.equal(body.issuedAt, RUN, 'the last confirmed run keeps its own issue time');
  for (const s of strings(body)) assert.ok(!s.includes(EM_DASH) && !/\bsafe\b/i.test(s), s);
  assertClientAccepts(body, 'stale');
  // On screen: not expired, so a period can be chosen and saved; expired only at its own expiry.
  assert.equal(onScreen(body, { date: '2026-10-20', now }).expired, false);
  assert.equal(onScreen(body, { date: '2026-10-20', now: now + 30 * MIN }).expired, true);
  // Exactly eight hours is still served ("more than 8 hours" is refused).
  assert.equal(build({ now: Date.parse(FETCHED) + 8 * HOUR, stale: true }).status, 200);
  // The note appears only when stale.
  assert.ok(!build().body.coverage.Weather.includes('not yet confirmed'));
});

test('stale-serve: 8h01m after the fetch is a 503 stale with retryAfter 60', () => {
  const now = Date.parse(FETCHED) + 8 * HOUR + MIN;
  assert.deepEqual(build({ now, stale: true }), { status: 503, retryAfter: 60, reason: 'stale' });
});

test('stale-serve: without stale, an expired answer is still a 503', () => {
  for (const offset of [90 * MIN, 2 * HOUR, 7 * HOUR + 59 * MIN]) {
    assert.deepEqual(build({ now: Date.parse(FETCHED) + offset }), { status: 503, retryAfter: 60, reason: 'stale' }, `${offset / MIN} min`);
    assert.deepEqual(build({ now: Date.parse(FETCHED) + offset, stale: false }), { status: 503, retryAfter: 60, reason: 'stale' });
  }
});

test('stale-serve: the version is the same with and without stale for the same data', () => {
  for (const now of [NOW, NOW + 40 * MIN]) {
    const fresh = build({ now }).body;
    const served = build({ now, stale: true }).body;
    assert.equal(served.version, fresh.version);
    assert.deepEqual(served.periods, fresh.periods);
    assert.notEqual(served.coverage.Weather, fresh.coverage.Weather);
  }
  // Across the stale window the selection signature holds, so no false "forecast changed".
  const later = Date.parse(FETCHED) + 3 * HOUR;
  const a = onScreen(build({ stale: true, now: later }).body, { date: '2026-10-20', now: later });
  const b = onScreen(build().body, { date: '2026-10-20' });
  assert.equal(a.selectionSignature, b.selectionSignature);
});

test('F18: empty answers expire 24 hours out and are not expired 23 hours later', () => {
  const { body } = emptySnapshot({ place: { kind: 'no_home' }, date: TODAY, now: NOW });
  assert.equal(Date.parse(body.expiresAt) - NOW, 24 * HOUR);
  assert.equal(onScreen(body, { now: NOW + 23 * HOUR }).expired, false);
});

test('F19: the same provider data at different times in the bucket keeps the version; content changes change it', () => {
  const base = build().body;
  const later = build({ now: NOW + 40 * MIN, alerts: alertsOk([], '2026-10-19T13:41:00.000Z') }).body;
  assert.equal(later.version, base.version, 'answer and lookup times are not content');
  assert.notEqual(later.warningStatus, base.warningStatus, 'the as-of time did move');
  assert.equal(build({ openMeteo: openMeteo({ fetchedAt: '2026-10-19T13:30:00.000Z' }) }).body.version, base.version);
  const changes = {
    'an hourly value': build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '14:00', { windMph: 30 }) }) }).body,
    'a new alert id': build({ alerts: alertsOk([{ id: 'urn:new', event: 'Flood Watch', ends: null }]) }).body,
    'another place': build({ place: { ...CHARLOTTE, id: 'us-place:3719000', label: 'Durham, NC' } }).body,
    'the home': build({ place: HOME }).body,
    'another run': build({ openMeteo: openMeteo({ run: '2026-10-19T00:00:00.000Z' }) }).body,
    'another date': build({ date: '2026-10-21' }).body,
    'an AirNow value': build({ airNow: airNowOk([airRow({ aqi: 56 })]) }).body,
    'AirNow failing': build({ airNow: { ok: false, reason: 'timeout' } }).body,
    'NWS failing': build({ alerts: { ok: false, reason: 'timeout' } }).body,
  };
  for (const [label, body] of Object.entries(changes)) assert.notEqual(body.version, base.version, label);
  assert.match(base.version, /^fc1-[0-9a-f]{16}$/);
  // Alert order is not content.
  const ab = build({ alerts: alertsOk([{ id: 'a', event: 'X Watch', ends: null }, { id: 'b', event: 'X Watch', ends: null }]) }).body.version;
  const ba = build({ alerts: alertsOk([{ id: 'b', event: 'X Watch', ends: null }, { id: 'a', event: 'X Watch', ends: null }]) }).body.version;
  assert.equal(ab, ba);
  assert.match(FORECAST_RULES_VERSION, /^b10-/);
});

test('F19: an unchanged re-fetch keeps the screen\'s selectionSignature, so no false "forecast changed"', () => {
  const first = onScreen(build().body, { date: '2026-10-20', period: 'Afternoon' });
  const again = onScreen(build({ now: NOW + 20 * MIN, openMeteo: openMeteo({ fetchedAt: '2026-10-19T13:25:00.000Z' }) }).body, { date: '2026-10-20', period: 'Afternoon', now: NOW + 20 * MIN });
  assert.equal(again.selectionSignature, first.selectionSignature);
  assert.equal(again.changed, false);
  assert.equal(again.needsReview, false);
});

test('F19: period versions are readable provenance under 300 characters', () => {
  assert.equal(build().body.periods[0].version, 'Open-Meteo GFS run 2026-10-19T06Z; AirNow 2026-10-19');
  assert.equal(build({ airNow: undefined }).body.periods[0].version, 'Open-Meteo GFS run 2026-10-19T06Z');
  for (const p of build({ place: { ...CHARLOTTE, label: 'A'.repeat(100) } }).body.periods) assert.ok(p.version.length < 300);
  // The saved task's reason, as the screen writes it (WeekOutdoors.tsx:38), stays well-formed.
  const screen = onScreen(build().body, { date: '2026-10-20' });
  const reason = `Outdoor plan. Forecast ${screen.currentPeriod.version}, ${screen.text.sourceName}. Review conditions before going.`;
  assert.equal(reason, 'Outdoor plan. Forecast Open-Meteo GFS run 2026-10-19T06Z; AirNow 2026-10-19, Open-Meteo, EPA AirNow and the National Weather Service, for Charlotte, NC. Review conditions before going.');
});

// ---------------------------------------------------------------------------
// 8. Empty answers (F1, F21)
// ---------------------------------------------------------------------------

const EMPTY_CASES = [
  [{ kind: 'no_home' }, 'For your home area: ', /No home location is saved\. Finish setup, or type a North Carolina city, county or ZIP code\./],
  [{ kind: 'unmatched', reason: 'not a North Carolina ZIP code' }, 'For the place you typed: ', /did not match a North Carolina county, city, town or ZIP code \(not a North Carolina ZIP code\)\./],
  [{ kind: 'unmatched' }, 'For the place you typed: ', /did not match a North Carolina county, city, town or ZIP code\. Type/],
  [{ kind: 'ambiguous', labels: ['Fairview (Buncombe County)', 'Fairview (Union County)'] }, 'For the place you typed: ', /more than one North Carolina place: Fairview \(Buncombe County\) and Fairview \(Union County\)\./],
  [{ kind: 'outside' }, 'For the place you typed: ', /outside North Carolina/],
];

test('F21: every empty reason is a 200 with periods [], valid metadata and four string coverage cells', () => {
  for (const [place, prefix, why] of EMPTY_CASES) {
    for (const result of [emptySnapshot({ place, date: TODAY, now: NOW }), build({ place, openMeteo: undefined, airNow: undefined, alerts: undefined })]) {
      assert.equal(result.status, 200, place.kind);
      const { body } = result;
      assert.deepEqual(body.periods, []);
      assertCoverage(body, prefix, place.kind);
      for (const key of KEYS) assert.match(body.coverage[key], why);
      assert.equal(body.zone, EMPTY_ZONE);
      assert.equal(body.horizonStart, TODAY);
      assert.equal(body.horizonEnd, addDays(TODAY, 6));
      assert.equal(body.issuedAt, new Date(NOW).toISOString());
      assert.equal(body.warningStatus, WARNINGS_UNAVAILABLE);
      assert.doesNotMatch(body.source, /Open-Meteo|AirNow|National Weather Service/);
      assert.match(body.version, /^fc1-[0-9a-f]{16}$/);
      assertClientAccepts(body, place.kind);
      const screen = onScreen(body, { date: '2026-10-20' });
      assert.equal(screen.far, false);
      assert.equal(screen.emptyMessage, evidenceCopy.forecastUnavailable);
      assert.equal(screen.text.horizon, `${TODAY} through ${addDays(TODAY, 6)}`);
    }
  }
});

test('F21: empty horizons use New York\'s date, even when UTC has rolled over', () => {
  const lateEvening = Date.parse('2026-10-20T02:30:00Z'); // 22:30 EDT on the 19th
  assert.equal(localDateIn(lateEvening, ZONE), TODAY);
  assert.equal(emptySnapshot({ place: { kind: 'outside' }, date: TODAY, now: lateEvening }).body.horizonStart, TODAY);
});

test('F21: empty versions are stable for one reason and day, and differ by reason and candidates', () => {
  const v = (place, now = NOW) => emptySnapshot({ place, date: TODAY, now }).body.version;
  assert.equal(v({ kind: 'outside' }), v({ kind: 'outside' }, NOW + 2 * HOUR));
  assert.notEqual(v({ kind: 'outside' }), v({ kind: 'no_home' }));
  assert.notEqual(v({ kind: 'ambiguous', labels: ['A', 'B'] }), v({ kind: 'ambiguous', labels: ['A', 'C'] }));
});

test('inputs: programming errors throw, they are not answered', () => {
  assert.throws(() => build({ date: '2026-02-30' }), TypeError);
  assert.throws(() => build({ date: '20261020' }), TypeError);
  assert.throws(() => build({ now: 'now' }), TypeError);
  assert.throws(() => build({ place: { kind: 'somewhere' } }), TypeError);
  assert.throws(() => build({ place: null }), TypeError);
  assert.throws(() => emptySnapshot({ place: { kind: 'home' }, date: TODAY, now: NOW }), TypeError);
});

// ---------------------------------------------------------------------------
// 9. Contract hygiene (F14, F20, F23)
// ---------------------------------------------------------------------------

function allBodies() {
  const bodies = [];
  const push = (r) => { if (r.status === 200) bodies.push(r.body); };
  for (let i = -1; i <= 7; i += 1) push(build({ date: addDays(TODAY, i) }));
  for (const place of [CHARLOTTE, HOME]) {
    for (const airNow of [airNowOk(), airNowOk([airRow({ aqi: null })]), airNowOk([]), airNowOk([airRow({ dateForecast: '2026-10-22', actionDay: true })]), { ok: false, reason: 'budget' }, { ok: false, reason: 'no_key' }, undefined]) {
      for (const alerts of [alertsOk(), alertsOk([{ id: 'u', event: 'Heat Advisory', ends: null }]), { ok: false, reason: 'timeout' }]) push(build({ place, airNow, alerts }));
    }
  }
  push(build({ openMeteo: openMeteo({ hours: withHour('2026-10-20', '13:00', { uv: null, apparentF: null, windMph: null, precipIn: null }) }) }));
  for (const [place] of EMPTY_CASES) push(emptySnapshot({ place, date: TODAY, now: NOW }));
  return bodies;
}

test('F20, F21: no changedMessage and no top-level data key, ever; every body passes the client', () => {
  const bodies = allBodies();
  assert.ok(bodies.length > 50);
  for (const body of bodies) {
    assert.equal(Object.hasOwn(body, 'changedMessage'), false);
    assert.equal(Object.hasOwn(body, 'data'), false);
    assert.deepEqual(Object.keys(body).sort(), ['coverage', 'expiresAt', 'horizonEnd', 'horizonStart', 'issuedAt', 'periods', 'source', 'version', 'warningStatus', 'zone']);
    assertClientAccepts(body);
    assert.equal(onScreen(body, { date: '2026-10-20' }).needsReview, false);
  }
});

test('F14, F23: no string contains U+2014 or the word "safe"; tradeoff is never empty', () => {
  for (const body of allBodies()) {
    for (const s of strings(body)) {
      assert.ok(!s.includes(EM_DASH), s);
      assert.doesNotMatch(s, /\bsafe(?:ly|ty)?\b/i, s);
    }
    for (const p of body.periods) assert.ok(p.tradeoff.trim().length > 0);
  }
  // The copy table itself, including every template.
  const templates = strings(COPY);
  for (const s of templates) assert.ok(!s.includes(EM_DASH) && !/\bsafe\b/i.test(s), s);
});

test('F15, F23: provider text with U+2014 or control characters is made presentable, not shown raw', () => {
  const { body } = build({
    airNow: airNowOk([airRow({ reportingArea: `Charlotte${EM_DASH}Gastonia`, parameter: `O3${EM_DASH}8hr` })]),
    alerts: alertsOk([{ id: 'u', event: `Heat Advisory ${EM_DASH} Updated\u0007`, ends: null }]),
  });
  assert.match(body.coverage.Air, /the Charlotte, Gastonia, NC reporting area/);
  assert.match(body.warningStatus, /Heat Advisory, Updated\. Check/);
  for (const s of strings(body)) assert.ok(!s.includes(EM_DASH) && !s.includes('\u0007'));
  assert.equal(presentable(`a ${EM_DASH} b\n c`), 'a, b c');
});

test('tradeoff: comparisons only between periods present, ties named as joint, one period says so', () => {
  const { body } = build();
  const [morning, afternoon, evening] = body.periods;
  assert.match(afternoon.tradeoff, /^Highest UV of these periods\. Most model rain of these periods\. Air is/);
  assert.match(morning.tradeoff, /^Coolest feels-like temperature of these periods\. Joint least model rain of these periods\./);
  assert.match(evening.tradeoff, /^Lowest UV of these periods\. Warmest feels-like temperature of these periods\./);
  const lateDay = Date.parse(zonedInstant(TODAY, '18:00', ZONE));
  const only = buildAt(lateDay, { date: TODAY }).body.periods;
  assert.equal(only.length, 1);
  assert.equal(only[0].tradeoff, 'No other period of this date is left to compare. No air forecast for this date.');
  const flat = build({ openMeteo: openMeteo({ hours: hoursFrom(TODAY).map((h) => ({ ...h, uv: 3, apparentF: 70, precipIn: 0 })) }) }).body.periods;
  for (const p of flat) assert.match(p.tradeoff, /^UV, feels-like temperature and model rain do not separate these periods\. Air is/);
});
