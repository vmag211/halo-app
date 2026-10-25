/**
 * F05: a saved household summary with "Today & Homeguard scores" and "Factors
 * & sources" selected saves the scores and factors, dated, from the same
 * server computations the score endpoints answer with, and the PDF the device
 * builds from that saved report carries them.
 *
 * On the B15 world (test/helpers/summariesWorld.mjs: the real routes, 0017,
 * 0026 and 0029 on PGlite, the client's own runtime). The expected lines are
 * built by calling GET /api/daily-score and GET /api/home-guard for the same
 * household through the same harness and mapping both answers with the
 * screens' own buildStageData, so "same as the screen" is checked, not assumed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
import { createDb } from './db/pgliteHarness.mjs';
import { createSummaryWorld } from './helpers/summariesWorld.mjs';
import { productionSelection, validSummarySnapshot } from './helpers/frontendB15.mjs';
import { PUBLIC_PROFILE, UTILITY_ROW, WELL_PROFILE, buildStageData, dailyRow } from './helpers/summaryEvidenceFixtures.mjs';
import { pdfText } from './helpers/pdfText.mjs';
import { localDate } from '../lib/localDate.js';
import { scoreLine, factorLine, FACTOR_KEYS } from '../lib/summaryStore.js';

const filename = fileURLToPath(new URL('../lib/frontend/household-pdf.ts', import.meta.url));
const compiled = new Module(filename); compiled.filename = filename; compiled.require = createRequire(filename);
compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { createHouseholdPdf } = compiled.exports;
const font = new Uint8Array(readFileSync(new URL('../public/fonts/instrument-sans-report.ttf', import.meta.url)));
const fallback = new Uint8Array(readFileSync(new URL('../public/fonts/onest-variable.ttf', import.meta.url)));

const POINT = { lat: 35.409, lng: -80.58 };

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

const selectionFor = (sections, over = {}) => {
  const base = productionSelection(2026);
  return { ...base, ...over, sections: { ...base.sections, ...sections } };
};

async function world(profile, { today = true, utility = true } = {}) {
  const w = await createSummaryWorld(db, { profile: { ...profile, ...POINT } });
  const created = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const rows = [
    // An older day's reading, newer by insert time, never stands in for today's.
    dailyRow({ profile_id: w.ids.alice, date: '2026-01-02', aqi: 180, created_at: new Date().toISOString() }),
    ...(today ? [dailyRow({ profile_id: w.ids.alice, date: localDate(), created_at: created })] : []),
  ];
  w.h.db.seed('daily_scores', rows);
  if (utility) w.h.db.seed('ucmr5_utilities', [UTILITY_ROW]);
  return w;
}

/** What Today and Homeguard show this household right now, from their own routes. */
async function screens(w) {
  const daily = await w.h.call('/api/daily-score', 'GET', { as: 'alice' });
  const home = await w.h.call('/api/home-guard', 'GET', { as: 'alice' });
  assert.equal(home.status, 200);
  const profile = { profile: (await w.h.call('/api/profile', 'GET', { as: 'alice' }).then((r) => r.json()).catch(() => ({})))?.profile ?? { ...PUBLIC_PROFILE }, home_context: { id: w.home.alice } };
  return { daily: daily.status === 200 ? await daily.json() : null, home: await home.json(), profile };
}

async function prepare(w, selection) {
  const screen = w.summary('alice');
  await screen.loadList();
  const snapshot = await screen.prepare({ selection, records: [], homeContextId: w.home.alice });
  assert.ok(snapshot, screen.message);
  assert.equal(validSummarySnapshot(snapshot), true);
  return snapshot;
}

const section = (snapshot, title) => snapshot.report.sections.find((s) => s.title === title)?.lines ?? null;

async function pdfOf(report) {
  const built = await createHouseholdPdf(report, font, () => {}, new AbortController().signal, fallback, true);
  return pdfText(built.bytes);
}

test('scores and factors selected: the saved summary holds both scores and all seven factors, the same lines the screens build, and the PDF shows them', async () => {
  const w = await world(PUBLIC_PROFILE);
  const snapshot = await prepare(w, selectionFor({ scores: true, factors: true }, { appendix: true }));

  const { daily, home, profile } = await screens(w);
  assert.ok(daily, 'Today answered from its stored reading');
  const stage = buildStageData(daily, home, profile);
  assert.equal(typeof stage.today.score, 'number');
  assert.equal(typeof stage.home.score, 'number');

  const scores = section(snapshot, 'Two score snapshot');
  assert.equal(scores[0], scoreLine(false, stage.today, false));
  // The Homeguard line carries its assembly time; everything before it must match exactly.
  const homeLine = scoreLine(true, stage.home, false);
  assert.equal(scores[1].replace(/ · [^·]+\.$/, ''), homeLine.replace(/ · [^·]+\.$/, ''));
  assert.match(scores[0], /^Today: \d+ \/ 100 · /);
  assert.match(scores[1], /^Homeguard: \d+ \/ 100 · /);

  const factors = section(snapshot, 'Seven factors, with their original dates');
  assert.equal(factors.length, 7);
  for (const [index, key] of FACTOR_KEYS.entries()) assert.equal(factors[index], factorLine(key, stage.readings[key], false, false), key);
  assert.match(factors[4], /Sample collected Mar 14, 2024/, 'PFAS keeps its sample date');

  const scope = section(snapshot, 'Omissions and scope');
  assert.equal(scope[0], 'Selected sections: Today & Homeguard scores; Factors & sources. Included: Today & Homeguard scores; Factors & sources.');
  assert.ok(!JSON.stringify(snapshot).includes('not included in saved summaries yet'));
  assert.ok(!snapshot.omissions.some((line) => /scores|Factors/.test(line)));
  assert.ok(!JSON.stringify(snapshot).includes('—'));

  // Read back exactly as saved.
  const detail = await (await w.detail(snapshot.id)).json();
  assert.deepEqual(detail.report, snapshot.report);

  const text = await pdfOf(detail.report);
  assert.ok(text.includes(scores[0]), `PDF shows "${scores[0]}"`);
  assert.ok(text.includes(scores[1]), `PDF shows "${scores[1]}"`);
  for (const line of factors) assert.ok(text.includes(line), `PDF shows "${line.slice(0, 60)}..."`);
  assert.ok(text.includes('Saved household summary. Each reading keeps its original source date.'));
  assert.ok(!text.includes('Sample-data review'), 'a saved production summary is not stamped as sample data');
});

test('no reading stored today: Today says unavailable (an older day is never reused), Homeguard is still composed', async () => {
  const w = await world(PUBLIC_PROFILE, { today: false });
  const snapshot = await prepare(w, selectionFor({ scores: true, factors: true }));
  const scores = section(snapshot, 'Two score snapshot');
  assert.equal(scores[0], 'Today: unavailable for the current home. No score is inferred.');
  assert.match(scores[1], /^Homeguard: \d+ \/ 100/);
  assert.ok(!JSON.stringify(snapshot).includes('180 AQI'));
});

test('a private well: no Homeguard score and the PFAS line says the utility result does not apply, in the saved copy and the PDF', async () => {
  const w = await world(WELL_PROFILE, { utility: false });
  const snapshot = await prepare(w, selectionFor({ scores: true, factors: true }));
  const scores = section(snapshot, 'Two score snapshot');
  assert.equal(scores[1], 'Homeguard: unavailable for the current home. No score is inferred.');
  const factors = section(snapshot, 'Seven factors, with their original dates');
  assert.match(factors[4], /^PFAS in water: missing household measurement\. Private well or spring; the utility result does not apply\./);
  const text = await pdfOf(snapshot.report);
  assert.ok(text.includes('Homeguard: unavailable for the current home. No score is inferred.'));
});

test('only Factors selected: the factors are saved and no score section appears; the scope line says exactly what was asked and kept', async () => {
  const w = await world(PUBLIC_PROFILE);
  const snapshot = await prepare(w, selectionFor({ scores: false, factors: true }));
  assert.equal(section(snapshot, 'Two score snapshot'), null);
  assert.equal(section(snapshot, 'Seven factors, with their original dates').length, 7);
  assert.equal(section(snapshot, 'Omissions and scope')[0], 'Selected sections: Factors & sources. Included: Factors & sources.');
  assert.ok(snapshot.omissions.includes('Today & Homeguard scores were not selected.'));
});

test('no county and no reading today: each line says unavailable, and the scope and omissions say neither section held a reading', async () => {
  const w = await world({ ...PUBLIC_PROFILE, county: null }, { today: false });
  const snapshot = await prepare(w, selectionFor({ scores: true, factors: true }));
  assert.equal(section(snapshot, 'Two score snapshot')[0], 'Today: unavailable for the current home. No score is inferred.');
  assert.equal(section(snapshot, 'Two score snapshot')[1], 'Homeguard: unavailable for the current home. No score is inferred.');
  const scope = section(snapshot, 'Omissions and scope');
  assert.equal(scope[0], 'Selected sections: Today & Homeguard scores; Factors & sources. Included: none.');
  assert.equal(scope[1], 'Selected but unavailable when this summary was prepared: Today & Homeguard scores; Factors & sources.');
  assert.ok(snapshot.omissions.includes('Today & Homeguard scores were unavailable when this summary was prepared.'));
  assert.ok(snapshot.omissions.includes('Factors & sources were unavailable when this summary was prepared.'));
});

test('a failed evidence read never blocks the selected records: the summary saves and says scores and factors were unavailable', async (t) => {
  t.mock.method(console, 'error', () => {});
  const w = await createSummaryWorld(db, { profile: { ...PUBLIC_PROFILE, ...POINT }, evidenceTables: false });
  const snapshot = await prepare(w, selectionFor({ scores: true, factors: true }));
  assert.deepEqual(section(snapshot, 'Two score snapshot'), ['Omitted: this optional section is unavailable. The remaining selected evidence is retained. Retry this section before exporting if it is needed.']);
  assert.ok(snapshot.omissions.includes('Today & Homeguard scores were unavailable when this summary was prepared.'));
  assert.ok(snapshot.omissions.includes('Factors & sources were unavailable when this summary was prepared.'));
});
